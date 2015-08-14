
var env       = require('node-env-file'),
    flag      = require('node-env-flag'),
    fs        = require('fs'),
    async     = require('async'),
    _         = require('underscore'),
    google    = require('googleapis'),
    mailchimp = require('mailchimp').MailChimpAPI;

var envPath = __dirname + '/.env.' + process.env.NODE_RUN_ENV;

if(fs.existsSync(envPath)){
	env(envPath);
}

var interval = 60; // minutes

var jwtClient = new google.auth.JWT(
	process.env.GOOGLE_JWT_CLIENT_ADDRESS,
	null,
	process.env.GOOGLE_JWT_PRIVATE_KEY.replace(/(\\n)/gm, "\n"),
	[
		'https://www.googleapis.com/auth/admin.directory.group',
		'https://www.googleapis.com/auth/admin.directory.group.member',
		'https://www.googleapis.com/auth/admin.directory.orgunit',
		'https://www.googleapis.com/auth/admin.directory.user',
		'https://www.googleapis.com/auth/admin.directory.user.alias'
	],
	process.env.GOOGLE_ADMIN_ADDRESS
);

var init = function()
{
	try { 
		GLOBAL.mailchimpApi = new mailchimp(process.env.MAILCHIMP_API_KEY, { version : '2.0' });
		console.log('Setting up Mailchimp API');
		run();
	} catch (error) {
		console.log(error.message);
		process.exit(1);
	}
};

var run = function() {

	checkMailingList();

	setTimeout(run, interval * 60 * 1000);

}

var checkMailingList = function()
{
	mailchimpApi.call('lists', 'list', { start: 0, limit: 25 }, function (error, response) {
		if (error) {
			console.log(error.message);
			process.exit(1);
		} else {
			var mailingListId = false;
			var lists = response.data;

			for(var i in lists) {
				var list = lists[i];

				if(list.name == process.env.MAILCHIMP_LIST_NAME) {
					mailingListId = list.id;
					break;
				}
			}

			if(mailingListId === false){
				console.log('Mailing list "' + process.env.MAILCHIMP_LIST_NAME + '" does not exist, please create the list before continuing');
					process.exit(1);
			}

			async.parallel({
				mailchimp: async.apply(getMailchimpList, mailingListId),
				google: async.apply(getGoogleList, process.env.GOOGLE_GROUP_ADDRESS)
			}, async.apply(compareLists, mailingListId));

		}
	});

};

var mailchimpUnsubscribe = function(listId, emails, callback)
{
	if(emails.length == 0) {
		callback(null);
		return;
	}

	var formattedEmails = _.map(emails, function(addr){ return { email: addr }; });

	mailchimpApi.call('lists', 'batch_unsubscribe', {
		id: listId,
		batch: formattedEmails,
		delete_member: true,
		send_goodbye: false,
		send_notify: false
	}, function (error, response) {

		if (error) {
			console.log(error.message);
			process.exit(1);
		} else {
			console.log('Unsubscribed:', emails.join(', '))
			callback(null);
		}

	});
};

var mailchimpSubscribe = function(listId, emailData, callback)
{

	if(_.keys(emailData).length == 0) {
		callback(null);
		return;
	}

	var formattedEmailData = [];

	for(var addr in emailData){
		formattedEmailData.push({
			email: {
				email: addr
			}
		});
	}

	mailchimpApi.call('lists', 'batch_subscribe', {
		id: listId,
		batch: formattedEmailData,
		double_optin: false,
		update_existing: true
	}, function (error, response) {

		if (error) {
			console.log(error.message);
			process.exit(1);
		} else {
			console.log('Updated list:', response.add_count, 'added,', response.update_count, 'updated');
			callback(null);
		}

	});
};

var compareLists = function(listId, error, lists)
{
	var unsubscribe = _.difference(lists.mailchimp, lists.google.emails),
	    subscribe = lists.google.data;

	async.series([
		async.apply(mailchimpUnsubscribe, listId, unsubscribe),
		async.apply(mailchimpSubscribe, listId, subscribe),
	], function(err, results){
		console.log('DONE');
	});
};

var getMailchimpList = function(listId, callback)
{
	// TODO: Add paging support. Probably not a priority just yet...
	console.log('Fetching members from Mailchimp list "' + listId + '"')

	mailchimpApi.call('lists', 'members', { id: listId, opts: {limit: 100} }, function (error, response) {
		if (error) {
			console.log(error.message);
			process.exit(1);
		} else {
			var members = response.data,
			    mailchimpMembers = [];

			for(var i in members){
				var member = members[i];

				mailchimpMembers.push(members[i].email.toLowerCase());
			}

			callback(null, mailchimpMembers);
		}
	});
};

var getGoogleList = function(list, callback)
{
	// TODO: Add proper error handling
	console.log('Fetching members from Google list "' + list + '"')
	google.admin('directory_v1').members.list({ auth: jwtClient, groupKey: list }, function(error, response){

		if (error){
			console.log(error.message);
			process.exit(1);
		} else {
			var members = response.members,
			    googleMembers = [],
			    googleMembersData = [];

			for(var i in members){
				var member = members[i];

				googleMembers.push(members[i].email.toLowerCase());
				googleMembersData[member.email] = {
					firstName: '',
					lastName: ''
				}
			}

			callback(null, {
				emails: googleMembers,
				data: googleMembersData
			});
		}

	});

};


init();
