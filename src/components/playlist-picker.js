const {element, icon, image, plural} = require('../utils/dom');
const {api, errorText, checkLogin, isVoteRunning, playlistCover} = require('../utils/playlists');

const NOTE_SAVE_DELAY = 700;
const NOTE_PLACEHOLDER = 'Note for this replay, e.g. what to watch for (optional)';

AFRAME.registerComponent('playlist-picker', {
	init: function () {
		const sceneEl = this.el.sceneEl;
		this.replayLoader = sceneEl.components['replay-loader'];
		this.loggedIn = false;
		checkLogin().then(loggedIn => (this.loggedIn = loggedIn));

		this.overlay = document.getElementById('playlistPicker');
		this.list = document.getElementById('playlistPickerList');
		this.note = document.getElementById('playlistPickerNote');
		this.noteHint = document.getElementById('playlistPickerNoteHint');
		this.status = document.getElementById('playlistPickerStatus');
		this.createForm = document.getElementById('playlistPickerCreate');

		const menuItem = document.getElementById('addToPlaylist');
		sceneEl.addEventListener('contextmenuopen', () => {
			menuItem.style.display = this.loggedIn && this.currentReplay() ? '' : 'none';
		});
		menuItem.addEventListener('click', () => {
			document.getElementById('ctxMenu').style.display = 'none';
			this.open();
		});

		document.getElementById('playlistPickerClose').addEventListener('click', () => this.close());
		this.overlay.addEventListener('click', e => {
			if (e.target === this.overlay) this.close();
		});
		document.addEventListener(
			'keydown',
			e => {
				if (!this.overlay.classList.contains('open')) return;
				if (e.key === 'Escape') {
					this.close();
				}
				e.stopPropagation();
			},
			true
		);

		this.note.addEventListener('input', () => {
			this.noteHint.textContent = this.noteHintText(false);
			clearTimeout(this.noteTimer);
			this.noteTimer = setTimeout(() => this.saveNote(), NOTE_SAVE_DELAY);
		});
		this.note.addEventListener('blur', () => this.flushNote());

		document.getElementById('playlistPickerNew').addEventListener('click', () => {
			this.createForm.classList.add('open');
			document.getElementById('playlistPickerTitle').focus();
		});
		this.createForm.addEventListener('submit', e => {
			e.preventDefault();
			this.create(document.getElementById('playlistPickerTitle').value.trim());
		});
	},

	currentReplay: function () {
		const fromPlaylist = this.el.sceneEl.components.playlist.currentReplay();
		const source = this.replayLoader.source;
		return fromPlaylist || (source && source.scoreId ? {replayType: 'score', id: Number(source.scoreId)} : null);
	},

	open: async function () {
		this.replay = this.currentReplay();
		if (!this.replay) return;
		this.playlists = null;
		this.note.value = '';
		this.note.placeholder = NOTE_PLACEHOLDER;
		this.noteHint.textContent = '';
		this.status.textContent = 'Loading your playlists...';
		this.createForm.classList.remove('open');
		this.overlay.classList.add('open');
		this.render();

		try {
			const playlists = await api('/v2/user/playlists');
			this.playlists = playlists.filter(
				playlist => playlist.type === 'replays' && (playlist.role === 'owner' || playlist.role === 'editor') && !isVoteRunning(playlist.vote)
			);
			this.status.textContent = '';
			this.loadNote();
		} catch (error) {
			this.status.textContent = "Couldn't load your playlists.";
		}
		this.render();
	},

	close: function () {
		this.flushNote();
		this.overlay.classList.remove('open');
	},

	entryIn: function (playlist) {
		return playlist.items.find(item => item.replayType === this.replay.replayType && item.replayId === this.replay.id);
	},

	containing: function () {
		return (this.playlists || []).filter(playlist => this.entryIn(playlist));
	},

	loadNote: function () {
		const notes = [...new Set(this.containing().map(playlist => this.entryIn(playlist).description || ''))];
		this.note.value = notes.length === 1 ? notes[0] : '';
		if (notes.length > 1) {
			this.note.placeholder = `Its notes differ between the ${notes.length} playlists that have it, type one to use everywhere`;
		}
		this.noteHint.textContent = this.noteHintText(false);
	},

	noteHintText: function (saved) {
		const count = this.containing().length;
		if (!count) return '';
		const where = count === 1 ? 'the playlist' : `the ${count} playlists`;
		return saved ? `Saved to ${where} that have it.` : `Note changes save to ${where} that have it, and go with new adds.`;
	},

	flushNote: function () {
		if (this.noteTimer) {
			this.saveNote();
		}
	},

	saveNote: async function () {
		clearTimeout(this.noteTimer);
		this.noteTimer = null;
		const description = this.note.value.trim();
		const targets = this.containing().filter(playlist => (this.entryIn(playlist).description || '') !== description);
		if (!targets.length) return;

		try {
			await Promise.all(
				targets.map(playlist => {
					const entry = this.entryIn(playlist);
					entry.description = description;
					return api(`/v2/playlist/${playlist.id}/items/${entry.id}`, {method: 'PATCH', body: {description}});
				})
			);
			this.noteHint.textContent = this.noteHintText(true);
		} catch (error) {
			this.status.textContent = errorText(error, "Couldn't save the note.");
		}
		targets.forEach(playlist => this.refreshPanel(playlist));
	},

	toggle: async function (playlist) {
		this.busyId = playlist.id;
		this.status.textContent = '';
		this.render();

		const entry = this.entryIn(playlist);
		try {
			if (entry) {
				await api(`/v2/playlist/${playlist.id}/items/${entry.id}`, {method: 'DELETE'});
				playlist.items = playlist.items.filter(item => item !== entry);
			} else {
				const item = {...this.replay, description: this.note.value.trim() || undefined};
				const result = await api(`/v2/playlist/${playlist.id}/items`, {method: 'POST', body: [item]});
				playlist.items.push(result.items[0]);
			}
			this.refreshPanel(playlist);
		} catch (error) {
			this.status.textContent = errorText(error, "Couldn't change the playlist.");
		}
		this.busyId = null;
		this.noteHint.textContent = this.noteHintText(false);
		this.render();
	},

	create: async function (title) {
		if (!title) return;
		this.status.textContent = '';
		try {
			const item = {...this.replay, description: this.note.value.trim() || undefined};
			const playlist = await api('/v2/playlist?type=replays', {method: 'POST', body: {playlistTitle: title, replays: [item]}});
			this.playlists.unshift(playlist);
			this.createForm.classList.remove('open');
		} catch (error) {
			this.status.textContent = errorText(error, "Couldn't create the playlist.");
		}
		this.noteHint.textContent = this.noteHintText(false);
		this.render();
	},

	refreshPanel: function (playlist) {
		const panel = this.el.sceneEl.components.playlist;
		if (panel.playlist && panel.playlist.id === playlist.id) {
			panel.reload();
		}
	},

	render: function () {
		if (!this.playlists) {
			this.list.replaceChildren();
			return;
		}
		if (!this.playlists.length) {
			this.list.replaceChildren(element('p', 'playlistPickerEmpty', 'No replay playlists you can edit yet.'));
			return;
		}
		this.list.replaceChildren(
			...this.playlists.map(playlist => {
				const isIn = !!this.entryIn(playlist);
				const row = element('button', 'playlistPickerRow');
				row.type = 'button';
				row.disabled = this.busyId === playlist.id;
				row.classList.toggle('in', isIn);
				row.title = isIn ? 'Remove the replay from this playlist' : 'Add the replay to this playlist';
				const text = element('span', 'playlistPickerText');
				const details = plural(playlist.items.length, 'replay') + (playlist.role === 'editor' ? ' · shared with you' : '');
				text.append(element('b', '', playlist.title), element('small', '', details));
				row.append(image('', playlistCover(playlist)), text, isIn ? icon('fa-circle-check') : icon('fa-circle', 'far'));
				row.addEventListener('click', () => this.toggle(playlist));
				return row;
			})
		);
	},
});
