let current = null;

function setMediaMetadata({title, artist, album, image}) {
	if (!window.MediaMetadata || !navigator.mediaSession || !title) return;
	const key = [title, artist, album, image].join('\n');
	if (key === current && navigator.mediaSession.metadata) return;
	current = key;
	navigator.mediaSession.metadata = new MediaMetadata({title, artist, album, artwork: image ? [{src: image}] : []});
}

module.exports = {setMediaMetadata};
