const {getApiUrl, getWebsiteUrl} = require('../utils');

async function api(path, {method = 'GET', body} = {}) {
	const isJson = body !== undefined && !(body instanceof Blob);
	const response = await fetch(getApiUrl() + path, {
		method,
		credentials: 'include',
		headers: isJson ? {'Content-Type': 'application/json'} : undefined,
		body: isJson ? JSON.stringify(body) : body,
	});
	if (!response.ok) {
		const error = new Error(response.statusText);
		error.status = response.status;
		error.body = await response.text().catch(() => '');
		throw error;
	}
	const text = await response.text();
	return text ? JSON.parse(text) : null;
}

function errorText(error, fallback) {
	const reason = (error.status === 400 || error.status === 409) && error.body;
	return reason && !reason.startsWith('{') ? reason : fallback;
}

let loginCheck = null;
function checkLogin() {
	if (!loginCheck) {
		loginCheck = fetch(getApiUrl() + '/user/id', {credentials: 'include'})
			.then(response => (response.ok ? response.text() : ''))
			.then(id => !!id.trim(), () => false);
	}
	return loginCheck;
}

function isVoteRunning(vote) {
	return !!vote && vote.active && !vote.endedAt && (!vote.endsAt || vote.endsAt * 1000 > Date.now());
}

function playlistCover(playlist) {
	return playlist.cover || `${getWebsiteUrl()}/assets/defaultplaylisticon.png`;
}

module.exports = {api, errorText, checkLogin, isVoteRunning, playlistCover};
