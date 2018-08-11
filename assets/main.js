$(function() {
	var client = ZAFClient.init();
	var ticketID,
		ticketSubject,
		restrictedArticles,
		readerGroups,
		createArticles,
		artCategory,
		artStatus,
		articleLimit,
		lastSearch,
		searchTimer,
		globalIgnoreSearchResults;
	var searching = false;
	var searchBox = $('#ko-search');
	var statusMap = {
		'draft': 'draft',
		'ready to publish': 'ready',
		'published': 'published',
		'needs review': 'review'
	};
	
	//resize the widget dimensions on initial load
	resizeWidget();
	
	//get app meta data settings
	client.metadata().then(function(metadata) {
		articleLimit = metadata.settings.articlelimit;
		createArticles = metadata.settings.allowcreate;
		artCategory = metadata.settings.createcategory ? metadata.settings.createcategory : '';
		restrictedArticles = metadata.settings.restrictedArticles;
		readerGroups = metadata.settings.readerGroups;
		globalIgnoreSearchResults = metadata.settings.ignoreSearchResults;

		//simple validation for some of the manifest values since ZD does not allow regex validation
		validateManifest();
		
		//set the correct artStatus using the statusMap
		var artStatusSetting = metadata.settings.artstatus;
		if(createArticles) {
			artStatus = statusMap[artStatusSetting.toLowerCase()] ? statusMap[artStatusSetting.toLowerCase()] : 'draft';
		} else { 
			//remove article create option if setting is false
			$('.ko-create-cntr, .ko-slidetrigger-cntr').remove();
			$('#ko-content').addClass('no-create');
			//resize dimensions now that the create markup is gone
			resizeWidget();
		}
	});
	
	//get current ticket id
	client.get('ticket.id').then(function(data) {
		ticketID = data['ticket.id'];
	});
	
	//get ticket subject and do the initial article search with it. Do not track search results for this search
	client.get('ticket.subject').then(function(data) {
		ticketSubject = data['ticket.subject'];
		getSuggestedArticles(ticketSubject, true);
	});
	
	//bind the enter key to search for articles. Track search results unless globally specified not to
	searchBox.on('keydown', function(e){
		var code = e.which;
		if(code==13) {
			e.stopPropagation;
		    e.preventDefault;
		    clearTimeout(searchTimer);
			var phrase = lastSearch = searchBox.val();
			getSuggestedArticles(phrase);
	    }
	});
	
	//bind the search to space key event and more than 3 chars typed. Do not track search results for these partial searches
	searchBox.on('keyup', function(e){
		clearTimeout(searchTimer);
		var code = e.which;
		if(code==32 && searchBox.value != lastSearch) {
			var phrase = lastSearch = searchBox.val();
			getSuggestedArticles(phrase, true);
		} else if(code !== 13) {
			var phrase = searchBox.val();
			searchTimer = setTimeout(function(){getSuggestedArticles(phrase, true);}, 750);
	    }
	});
	
	//toggle the article create panel
	$('.ko-createfrom').on('click', function(){
		//disabled
		if(!createArticles)
			return false;

		//clear out the article name field
		$('#article-name').val('');
		//get the current reply text and populate article create textarea
		client.get('ticket.comment').then(function(data) {
			var ticketHtml = data['ticket.comment'].text;
			//do our best to clean the text in case they are using rich text
			ticketHtml = ticketHtml.replace(/<br.*?>/g, "\n");
			ticketHtml = $.parseHTML(ticketHtml);
			ticketHtml = $(ticketHtml).text();
			$('#article-body').val(ticketHtml);
		});
		
		//toggle article create markup
		$('.ko-articles-cntr').removeClass('current').addClass('moved-left');
		$('.ko-create-cntr').show().removeClass('moved-right').addClass('current');
		//resize dimensions after animation stops
		setTimeout(resizeWidget(), 510);
	});
	
	//toggle the article list panel
	$('.ko-createback').on('click', function(){
		$('.ko-create-cntr').removeClass('current').addClass('moved-right');
		$('.ko-articles-cntr').show().removeClass('moved-left').addClass('current');
		//resize dimensions after animation stops
		setTimeout(resizeWidget(), 510);
	});
	
	//post the article to KO
	$('#create-art').on('click', function(){
		//disabled
		if(!createArticles)
			return false;
		
		//grab form fields and covert body to simple html
		var artName = $('#article-name').val();
		var artBody = '<p>' + $('#article-body').val().replace(/\r\n|\r|\n/g,"</p><p>") + '</p>';
		//remove empty paragraphs
		artBody = artBody.replace(/<p><\/p>/g, "");
		
		//make sure required fields are filled out, else show error
		if($.trim(artName) == '' || $.trim(artBody) == '') {
			$('.create-error').show().delay(2500).fadeOut(800);
			if($.trim(artName) == '')
				$('#article-name').focus();
			else
				$('#article-body').focus();
		} else {
			//show the working message
			$('.working-message').removeClass('error').find('span').text('Creating article...');
			$('.working-overlay, .working-message-cntr').show();
			
			//set the ajax settings
			var createArticleApiSettings = {
				url:"https://app.knowledgeowl.com/api/head/article.json?_authbykey={{setting.apikey}}",
				type:'POST',
				dataType: 'json',
				contentType: 'application/json',
				secure: true,
				data: JSON.stringify({
					'status': artStatus,
					'visibility': 'public',
					'category': artCategory,
					'index': $.now(),
					'name': artName,
					'current_version': artBody,
					'project_id': '{{setting.kbid}}'
				})
			};
			
			//post the article
			client.request(createArticleApiSettings).then(
				function(data) {
					if(data && data.valid == true) {
						$('.working-message span').text('Article created!');
						setTimeout(function(){$('.working-overlay, .working-message-cntr').fadeOut(500);}, 500);
						setTimeout(function(){$('.ko-createback').click();}, 1000);
					} else {
						//alert user to problem creating article
						console.log(data);
						$('.working-message').addClass('error').find('span').text('Error creating article');
						setTimeout(function(){$('.working-overlay, .working-message-cntr').fadeOut(500);}, 2000);
					}
				},
				function(response) {
					//alert user to problem creating article
					console.log(response);
					$('.working-message').addClass('error').find('span').text('Error creating article');
					setTimeout(function(){$('.working-overlay, .working-message-cntr').fadeOut(500);}, 2000);
				}
			);
		}
			
	});

	//make sure the user inputted values are valid
	function validateManifest() {
		//KO hex ID
		var idRegex = new RegExp('^[0-9a-fA-F]{24}$');
		//validate number of articles to search for
		if(articleLimit <= 0 || articleLimit > 20){
			articleLimit = 10;
		}
		//override reader groups if searching all restricted
		if(restrictedArticles === true){
			readerGroups = false;
		}
		//valid reader group IDs
		if(readerGroups){
			var validGroups = [];
			var readerGroupIDs = readerGroups.split(',');
			$.each(readerGroupIDs, function(index, groupID){
				groupID = $.trim(groupID);
				if(idRegex.test(groupID))
					validGroups.push(groupID);
				else {
					//inform customer of issue with meta data settings
					$('.ko-articles-cntr').html('<div class="install-error">There is an error with your installation:<br /><br />Invalid reader group IDs for searching.</div>');
					return false;
				}
			});
			readerGroups = $.unique(validGroups).join(',');
		}
		//valid KO category ID
		if(createArticles && artCategory && !idRegex.test(artCategory)) {
			//inform customer of issue with meta data settings
			$('.ko-articles-cntr').html('<div class="install-error">There is an error with your installation:<br /><br />Invalid category ID for creating new articles.</div>');
		}
	}

	//attach events after we fetch articles	
	function bindArtEvents() {
		//paste the link in the ticket body
		$('.paste-article-link').on('click', function(){
			var articleHref = $(this).next('td').find('.ko-article-link').attr('href');
			client.invoke('ticket.comment.appendText', articleHref).then(function() {
				//nothing to do here unless we want to provide a feedback msg that the link was added
			});
		});
	}
	
	//find articles based on search phrase
	function getSuggestedArticles(phrase, ignoreSearchResults) {
		//bring back the subject results if search is blank
		if($.trim(phrase) == '')
			phrase = ticketSubject;
		//don't record search results in KO reporting if specified
		var ignoreSearchResultsParam = '';
		if(globalIgnoreSearchResults === true || ignoreSearchResults === true)
			ignoreSearchResultsParam = '&trackRes=false';
		//display the now searching text and hide previous results
		toggleSearching(true);
		
		//set the ajax settings
		var articleApiSettings = {
			url:'https://app.knowledgeowl.com/javascript/remote-suggest?type=article&zid=' + ticketID + '&limit=' + articleLimit + '&kbid={{setting.kbid}}&phrase=' + phrase + ignoreSearchResultsParam,
			type:'GET',
			dataType: 'json',
			contentType: 'application/json',
			secure: true,
		};

		//restricted content
		if(!restrictedArticles && readerGroups){
			articleApiSettings['url'] += '&groups=' + readerGroups;
		} else if(restrictedArticles) {
			articleApiSettings['url'] += '&restricted=true';
		}
		
		//retrieve search results
		client.request(articleApiSettings).then(
			function(data) {
				var source = $("#article-results").html();
				var template = Handlebars.compile(source);
				var html = template(data);
				$("#ko-content").html(html);
				toggleSearching(false);
				resizeWidget();
				bindArtEvents();
			},
			function(response) {
				//inform customer of issue with meta data settings
				$('.ko-searching').text('There is an error with your installation.');
				console.log(response);
			}
		);
	}

	//resize the iframe
	function resizeWidget() {
		//hide any slide that isn't current
		$('.slide').not('.current').hide();
		var bodyHeight = $('.slide.current').outerHeight();
		client.invoke('resize', { width: '100%', height: bodyHeight + 'px' });
	}
	
	//toggle search results and searching message
	function toggleSearching(searching) {
		$('.ko-searching').toggle(searching);
		$('#ko-content').toggle(!searching);
	}
});