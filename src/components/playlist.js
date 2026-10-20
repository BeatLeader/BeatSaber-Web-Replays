const {getWebsiteUrl, getUrlParameter, getDiffInfo} = require('../utils');
const {element, icon, iconButton, image, plural} = require('../utils/dom');
const {api, errorText, checkLogin, isVoteRunning, playlistCover} = require('../utils/playlists');

const AUTOPLAY_DELAY = 5;
const MAX_AUTOPLAY_FAILURES = 3;
const MAX_SKIPPED_MAPS = 30;
const ENTRY_BATCH = 3;
const RENDER_STEP = 200;
const REFRESH_INTERVAL = 30000;
const VOTE_POLL_INTERVAL = 30000;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const END_TYPES = {1: 'Clear', 2: 'Fail', 3: 'Restart', 4: 'Quit', 5: 'Practice'};
const VOTE_RESULTS_NOTES = {voted: 'Results show once you vote.', ended: 'Results show when the vote ends.'};

function cover(src, placeholderIcon) {
	const placeholder = element('span', 'playlistItemCover');
	placeholder.append(icon(placeholderIcon));
	if (!src) return placeholder;
	const img = image('playlistItemCover', src);
	img.addEventListener('error', () => img.replaceWith(placeholder));
	return img;
}

function difficultyBadge(difficulty, mode) {
	const info = getDiffInfo(difficulty);
	const badge = element('span', 'playlistItemDifficulty', (mode && mode !== 'Standard' ? mode + ' ' : '') + (info ? info.name : difficulty));
	badge.style.backgroundColor = info ? info.color : '';
	return badge;
}

function entryKey(entry) {
	return entry.difficulty ? `${entry.difficulty}/${entry.mode}` : null;
}

function isPlayable(entry) {
	return !entry.hidden && !!(entry.scoreId || entry.replay);
}

function timeLeft(endsAt) {
	const secs = Math.max(0, Math.round(endsAt - Date.now() / 1000));
	const days = Math.floor(secs / 86400);
	const hours = Math.floor((secs % 86400) / 3600);
	const minutes = Math.floor((secs % 3600) / 60);
	if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
	if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${secs}s`;
}

AFRAME.registerComponent('playlist', {
	init: function () {
		const sceneEl = this.el.sceneEl;
		this.replayLoader = sceneEl.components['replay-loader'];
		this.settings = sceneEl.components.settings;

		this.active = false;
		this.playlistId = null;
		this.playlist = null;
		this.items = [];
		this.currentId = null;
		this.currentEntry = null;
		this.currentIndex = -1;
		this.fetchId = 0;
		this.navigationId = 0;
		this.mutations = Promise.resolve();
		this.autoplayFailures = 0;
		this.renderLimit = RENDER_STEP;
		this.pickSettings = this.currentPickSettings();

		this.panel = document.getElementById('playlistPanel');
		this.itemsEl = document.getElementById('playlistItems');
		this.statusEl = document.getElementById('playlistStatus');
		this.positionEl = document.getElementById('playlistPosition');
		this.countdownText = document.getElementById('playlistCountdownText');

		this.setupPanel();
		this.setupItems();

		sceneEl.addEventListener('replayunload', e => this.onReplayUnload(e.detail));
		sceneEl.addEventListener('replayfetched', e => this.matchMapItem(e.detail.hash));
		sceneEl.addEventListener('finishgame', () => this.startCountdown());
		sceneEl.addEventListener('replayloaded', () => (this.autoplayFailures = 0));
		sceneEl.addEventListener('replayloadfailed', () => this.onLoadFailed());
		sceneEl.addEventListener('challengeloaderror', () => this.onLoadFailed());
		sceneEl.addEventListener('settingsChanged', () => this.onPickSettingsChanged());
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) this.refreshIfStale();
		});

		const playlistId = getUrlParameter('playlist');
		if (playlistId) {
			this.open(playlistId);
		}
	},

	setupPanel: function () {
		const panel = this.panel;
		const toggle = document.getElementById('playlistToggle');
		panel.classList.toggle('collapsed', !!this.settings.settings.playlistCollapsed);
		toggle.addEventListener('click', () => {
			const collapsed = panel.classList.toggle('collapsed');
			toggle.title = collapsed ? 'Show playlist' : 'Hide playlist';
			this.settings.settings.playlistCollapsed = collapsed;
			this.settings.sync();
		});

		// Keeps focus in text fields, so typing doesn't trigger hotkeys and Space doesn't re-press buttons.
		panel.addEventListener('mousedown', e => {
			if (e.target.closest('button, .playlistToggleLabel')) e.preventDefault();
		});
		panel.addEventListener('keydown', e => {
			if (e.target.closest('textarea, select, input:not([type=checkbox])')) e.stopPropagation();
		});

		document.getElementById('playlistPrevious').addEventListener('click', () => this.previous());
		document.getElementById('playlistNext').addEventListener('click', () => this.next());
		document.getElementById('playlistCountdownCancel').addEventListener('click', () => this.stopCountdown());

		const notify = (text, iconClass) => found => found && this.el.sceneEl.emit('showHotkeyNotification', {text, icon: iconClass});
		document.addEventListener('keydown', e => {
			if (!this.active || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.code === 'KeyN') {
				this.next().then(notify('Next replay', 'fas fa-forward-step'));
			} else if (e.code === 'KeyP') {
				this.previous().then(notify('Previous replay', 'fas fa-backward-step'));
			}
		});

		const titleInput = document.getElementById('playlistTitleInput');
		const descriptionInput = document.getElementById('playlistDescriptionInput');
		document.getElementById('playlistEditInfo').addEventListener('click', () => {
			titleInput.value = this.playlist.title || '';
			descriptionInput.value = this.playlist.description || '';
			panel.classList.add('editingInfo');
			titleInput.focus();
		});
		document.getElementById('playlistInfoCancel').addEventListener('click', () => panel.classList.remove('editingInfo'));
		document.getElementById('playlistInfoForm').addEventListener('submit', e => {
			e.preventDefault();
			const title = titleInput.value.trim();
			const description = descriptionInput.value.trim();
			panel.classList.remove('editingInfo');
			if (!title || (title === this.playlist.title && description === (this.playlist.description || ''))) return;
			this.mutate('', {method: 'PATCH', body: {title, description}}, () => {
				this.playlist.title = title;
				this.playlist.description = description;
			});
		});

		document.getElementById('playlistVisibility').addEventListener('click', () => {
			const isPublic = !this.playlist.isPublic;
			this.mutate('', {method: 'PATCH', body: {isPublic}}, () => (this.playlist.isPublic = isPublic));
		});

		const coverInput = document.getElementById('playlistCoverInput');
		coverInput.addEventListener('change', () => {
			const file = coverInput.files[0];
			coverInput.value = '';
			if (!file) return;
			if (file.size > MAX_COVER_SIZE) {
				this.flash('The cover must be smaller than 5 MB.', true);
				return;
			}
			this.mutate('/cover', {method: 'PUT', body: file}).then(result => {
				if (result) {
					this.playlist.cover = result.cover;
					this.renderHeader();
				}
			});
		});
	},

	setupItems: function () {
		const itemsEl = this.itemsEl;
		const rowItem = row => row && this.items.find(item => item.id === Number(row.dataset.id));

		itemsEl.addEventListener('click', e => {
			const pick = e.target.closest('.playlistVotePick');
			if (pick) {
				this.togglePick(Number(pick.dataset.option));
				return;
			}
			if (e.target.closest('button, form')) return;
			const item = rowItem(e.target.closest('.playlistItem'));
			if (!item) return;

			const chip = e.target.closest('[data-entry]');
			if (chip) {
				const entry = item.entries.find(entry => entryKey(entry) === chip.dataset.entry);
				if (isPlayable(entry) && !(item.id === this.currentId && chip.dataset.entry === this.currentEntry)) {
					this.playItem(item, entry);
				}
			} else if (item.id !== this.currentId && !item.hidden) {
				this.playFirst(item);
			}
		});

		let dragged = null;
		let dropTarget = null;
		const clearDropMarks = () => {
			itemsEl.querySelectorAll('.dropBefore, .dropAfter').forEach(row => row.classList.remove('dropBefore', 'dropAfter'));
		};
		itemsEl.addEventListener('dragstart', e => {
			dragged = rowItem(e.target.closest('.playlistItem'));
			if (!dragged) return;
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(dragged.id));
			e.target.closest('.playlistItem').classList.add('dragging');
		});
		itemsEl.addEventListener('dragover', e => {
			const row = dragged && e.target.closest('.playlistItem');
			if (!row) return;
			e.preventDefault();
			const rect = row.getBoundingClientRect();
			const after = e.clientY > rect.top + rect.height / 2;
			clearDropMarks();
			row.classList.add(after ? 'dropAfter' : 'dropBefore');
			dropTarget = {item: rowItem(row), after};
		});
		itemsEl.addEventListener('drop', e => {
			e.preventDefault();
			if (dragged && dropTarget) {
				this.moveItem(dragged, dropTarget.item, dropTarget.after);
			}
		});
		itemsEl.addEventListener('dragend', () => {
			clearDropMarks();
			itemsEl.querySelectorAll('.dragging').forEach(row => row.classList.remove('dragging'));
			dragged = dropTarget = null;
		});
	},

	open: function (playlistId) {
		this.closeVote();
		this.playlistId = String(playlistId);
		this.playlist = null;
		this.items = [];
		this.setCurrent(null);
		this.renderLimit = RENDER_STEP;
		this.setActive(true);
		this.render();
		this.setStatus('Loading the playlist...');

		this.fetchPlaylist().then(
			loaded => loaded && this.onLoaded(),
			error => {
				if (error.status === 401) {
					this.setStatus('This playlist is private. If it was shared with you, log in on BeatLeader.', true);
				} else if (error.status === 404) {
					this.setStatus(this.isGuid() ? 'This link was turned off or replaced.' : 'Playlist not found.', true);
				} else {
					this.setStatus("Couldn't load the playlist.", true);
				}
			}
		);
	},

	isGuid: function () {
		return /^[0-9a-f]{32}$/i.test(this.playlistId) || !/^\d+$/.test(this.playlistId);
	},

	readPath: function () {
		const id = encodeURIComponent(this.playlistId.toLowerCase());
		return this.isGuid() ? `/v2/playlist/guid/${id}` : `/v2/playlist/${id}`;
	},

	fetchPlaylist: async function () {
		const fetchId = ++this.fetchId;
		const path = this.readPath();
		const [playlist, replays] = await Promise.all([
			api(path),
			api(path + '/replays').catch(error => (error.status === 400 ? null : Promise.reject(error))),
		]);
		if (fetchId !== this.fetchId) {
			return false;
		}
		if (this.isMapPlaylist()) {
			const entries = new Map(this.items.map(item => [item.id, item.entries]));
			playlist.items.forEach(item => (item.entries = entries.get(item.id)));
		}
		this.playlist = playlist;
		this.items = replays || playlist.items;
		this.loadedAt = Date.now();
		return true;
	},

	onLoaded: function () {
		this.setStatus('');
		const source = this.replayLoader.source;
		if (source && source.playlistId === this.playlistId) {
			const item = this.findItem(source);
			this.setCurrent(item, item && source.playlistEntry);
			this.render();
			this.updateCurrent(true);
			if (!item && this.replayLoader.replay) {
				this.matchMapItem(this.replayLoader.replay.info.hash);
			}
			this.prefetch();
		} else {
			this.render();
			this.go(1, {replaceUrl: true}).then(found => {
				if (!found && this.currentId == null && !this.statusEl.textContent) {
					this.setStatus('There are no replays to watch in this playlist.', true);
				}
			});
		}
	},

	reload: async function () {
		try {
			if (await this.fetchPlaylist()) {
				this.votePolledAt = 0;
				this.render();
			}
		} catch (error) {
			this.flash("Couldn't reload the playlist.", true);
		}
	},

	refreshIfStale: function () {
		if (!this.active || !this.playlist || this.isEditing() || Date.now() - this.loadedAt < REFRESH_INTERVAL) return;
		this.loadedAt = Date.now();
		this.mutations = this.mutations.then(() => this.reload());
	},

	mutate: function (path, options, apply) {
		if (apply) {
			apply();
			this.render();
		}
		const playlistId = this.playlistId;
		const result = this.mutations.then(async () => {
			if (playlistId !== this.playlistId) return null;
			const revision = this.playlist.revision;
			try {
				const result = await api(`/v2/playlist/${this.playlist.id}${path}`, options);
				if (playlistId !== this.playlistId) return null;
				// Any other revision means someone else changed the playlist meanwhile, so it's reloaded.
				if (result && result.revision === revision + 1) {
					this.playlist.revision = result.revision;
					return result;
				}
			} catch (error) {
				if (playlistId !== this.playlistId) return null;
				const fallback = "Couldn't save the change, the playlist was reloaded.";
				this.flash(error.status === 401 ? "You can't edit this playlist anymore." : errorText(error, fallback), true);
			}
			await this.reload();
			return null;
		});
		this.mutations = result;
		return result;
	},

	moveItem: function (item, target, after) {
		if (item === target) return;
		const items = this.items.filter(other => other !== item);
		const index = items.indexOf(target) + (after ? 1 : 0);
		items.splice(index, 0, item);
		if (items.every((other, i) => other === this.items[i])) return;

		const previous = items[index - 1];
		this.mutate(`/items/${item.id}/move?afterItemId=${previous ? previous.id : 0}`, {method: 'POST'}, () => (this.items = items));
	},

	removeItem: function (item) {
		this.mutate(`/items/${item.id}`, {method: 'DELETE'}, () => {
			this.items = this.items.filter(other => other !== item);
			this.playlist.itemCount = this.items.length;
		});
	},

	saveNote: function (item, description) {
		if (description === (item.description || '')) {
			this.render();
			return;
		}
		this.mutate(`/items/${item.id}`, {method: 'PATCH', body: {description}}, () => {
			item.description = description;
			(item.entries || []).forEach(entry => (entry.description = description));
		});
	},

	setActive: function (active) {
		this.active = active;
		document.body.classList.toggle('playlistOpen', active);
		if (!active) {
			this.stopCountdown();
		}
	},

	isEditing: function () {
		return !!this.noteEditor || this.panel.classList.contains('editingInfo');
	},

	isMapPlaylist: function () {
		return !!this.playlist && this.playlist.type === 'maps';
	},

	canEdit: function () {
		return !!this.playlist && (this.playlist.role === 'owner' || this.playlist.role === 'editor');
	},

	canEditItems: function () {
		const followsSearch = !!this.playlist.source;
		return this.canEdit() && !followsSearch && !isVoteRunning(this.playlist.vote);
	},

	// A map item plays as one entry per difficulty, a replay item is its own entry.
	entriesOf: function (item) {
		if (this.isMapPlaylist()) return item.entries;
		return item.hidden ? [] : [item];
	},

	currentPickSettings: function () {
		const settings = this.settings.settings;
		return `${settings.playlistPick}/${settings.playlistAllDifficulties}`;
	},

	loadEntries: function (item) {
		const entries = this.entriesOf(item);
		if (entries) return Promise.resolve(entries);

		if (!item.loading) {
			const index = this.items.indexOf(item);
			const batch = this.items.slice(index, index + ENTRY_BATCH).filter(other => !other.entries && !other.loading);
			const settings = this.settings.settings;
			const params = new URLSearchParams({
				itemIds: batch.map(other => other.id).join(','),
				pick: settings.playlistPick,
				allDifficulties: settings.playlistAllDifficulties,
			});
			const pickSettings = this.pickSettings;
			const request = api(`${this.readPath()}/scores?${params}`).then(
				entries => {
					if (pickSettings !== this.pickSettings) return;
					batch.forEach(other => {
						other.entries = entries.filter(entry => entry.itemId === other.id);
						other.loading = null;
						this.renderRow(other);
					});
					this.updateCurrent();
				},
				error => {
					batch.forEach(other => (other.loading = null));
					throw error;
				}
			);
			batch.forEach(other => {
				other.loading = request.then(() => other.entries || []);
				other.loading.catch(() => {});
			});
		}
		return item.loading;
	},

	prefetch: function () {
		const next = this.isMapPlaylist() && this.currentIndex >= 0 && this.items[this.currentIndex + 1];
		if (next) {
			this.loadEntries(next).catch(() => {});
		}
	},

	onPickSettingsChanged: function () {
		const pickSettings = this.currentPickSettings();
		if (pickSettings === this.pickSettings) return;
		this.pickSettings = pickSettings;
		if (!this.isMapPlaylist()) return;

		this.navigationId++;
		this.items.forEach(item => {
			item.entries = undefined;
			item.loading = null;
		});
		this.render();
		const current = this.items[this.currentIndex];
		if (current) {
			this.loadEntries(current).catch(() => {});
		}
	},

	findItem: function (source) {
		if (source.playlistItemId) {
			const item = this.items.find(item => item.id === source.playlistItemId);
			if (item) return item;
		}
		if (this.isMapPlaylist()) {
			return null;
		}
		if (source.scoreId) {
			return this.items.find(item => !item.hidden && String(item.scoreId) === String(source.scoreId));
		}
		if (source.link) {
			return this.items.find(item => !item.hidden && !item.scoreId && item.replay === source.link);
		}
		return null;
	},

	// A shared map playlist link has only the score id, so its map is found by the replay's hash.
	matchMapItem: function (hash) {
		const source = this.replayLoader.source;
		if (!this.active || !this.isMapPlaylist() || this.currentId != null || !hash || !source || source.playlistId !== this.playlistId) return;
		const item = this.items.find(item => item.hash && item.hash.toLowerCase() === hash.toLowerCase());
		if (!item) return;

		this.setCurrent(item);
		this.updateCurrent(true);
		this.loadEntries(item).then(entries => {
			const entry = entries.find(entry => String(entry.scoreId) === String(source.scoreId));
			if (entry && this.currentId === item.id) {
				this.currentEntry = entryKey(entry);
				this.renderRow(item);
				this.updateCurrent();
			}
		}, () => {});
	},

	currentReplay: function () {
		const item = this.active && this.items.find(item => item.id === this.currentId);
		const entry = item && (this.entriesOf(item) || []).find(entry => entryKey(entry) === this.currentEntry);
		return entry && entry.replayId ? {replayType: entry.replayType, id: entry.replayId} : null;
	},

	setCurrent: function (item, entry) {
		this.currentId = item ? item.id : null;
		this.currentEntry = entry || null;
		this.currentIndex = item ? this.items.indexOf(item) : -1;
	},

	nextIndex: function (direction) {
		const index = this.items.findIndex(item => item.id === this.currentId);
		if (index >= 0) return index + direction;
		return direction > 0 ? Math.max(this.currentIndex, 0) : this.currentIndex - 1;
	},

	stepWithinItem: function (direction) {
		const item = this.items.find(item => item.id === this.currentId);
		const entries = item && this.entriesOf(item);
		const position = entries ? entries.findIndex(entry => entryKey(entry) === this.currentEntry) : -1;
		if (position < 0) return null;
		for (let i = position + direction; i >= 0 && i < entries.length; i += direction) {
			if (isPlayable(entries[i])) return {item, entry: entries[i]};
		}
		return null;
	},

	hasNeighbor: function (direction) {
		if (this.stepWithinItem(direction)) return true;
		for (let i = this.nextIndex(direction); i >= 0 && i < this.items.length; i += direction) {
			const entries = this.entriesOf(this.items[i]);
			if (!entries || entries.some(isPlayable)) return true;
		}
		return false;
	},

	find: async function (direction) {
		const withinItem = this.stepWithinItem(direction);
		if (withinItem) return withinItem;

		const navigationId = ++this.navigationId;
		let skipped = 0;
		for (let i = this.nextIndex(direction); i >= 0 && i < this.items.length && skipped < MAX_SKIPPED_MAPS; i += direction) {
			const item = this.items[i];
			const entries = (await this.loadEntries(item)).filter(isPlayable);
			if (navigationId !== this.navigationId) return null;
			if (entries.length) {
				return {item, entry: direction > 0 ? entries[0] : entries[entries.length - 1]};
			}
			skipped++;
		}
		return null;
	},

	go: async function (direction, options) {
		try {
			const target = await this.find(direction);
			if (target) {
				this.playItem(target.item, target.entry, options);
				return true;
			}
		} catch (error) {
			const ownScores = error.status === 400 && this.settings.settings.playlistPick === 'player';
			this.flash(ownScores ? 'Log in on BeatLeader to watch your own scores.' : "Couldn't load the scores for this map.", true);
		}
		return false;
	},

	next: function (options) {
		return this.active && this.playlist ? this.go(1, options) : Promise.resolve(false);
	},

	previous: function () {
		return this.active && this.playlist ? this.go(-1) : Promise.resolve(false);
	},

	playFirst: function (item) {
		this.loadEntries(item).then(
			entries => {
				const entry = entries.find(isPlayable);
				if (entry) {
					this.playItem(item, entry);
				} else {
					this.flash('There is no score to watch on this map.', true);
				}
			},
			() => this.flash("Couldn't load the scores for this map.", true)
		);
	},

	playItem: function (item, entry, {auto = false, replaceUrl = false} = {}) {
		this.navigationId++;
		const source = entry.scoreId ? {scoreId: String(entry.scoreId)} : {link: entry.replay};
		this.replayLoader.openReplay(
			{...source, playlistId: this.playlistId, playlistItemId: item.id, playlistEntry: entryKey(entry) || undefined},
			{replaceUrl, countWatch: !auto}
		);
		this.autoplaying = auto;
	},

	onReplayUnload: function (source) {
		this.stopCountdown();
		clearTimeout(this.skipTimeout);
		this.autoplaying = false;

		if (!source.playlistId) {
			this.setActive(false);
		} else if (source.playlistId !== this.playlistId) {
			this.open(source.playlistId);
		} else {
			this.setActive(true);
			if (this.playlist) {
				const previous = this.items.find(item => item.id === this.currentId);
				const item = this.findItem(source);
				this.setCurrent(item, item && source.playlistEntry);
				if (this.isMapPlaylist()) {
					[previous, item].forEach(changed => changed && this.renderRow(changed));
				}
				this.updateCurrent(true);
				this.prefetch();
			}
		}
	},

	onLoadFailed: function () {
		const item = this.active && this.items.find(item => item.id === this.currentId);
		if (!item) return;
		item.failed = true;
		this.updateCurrent();

		if (this.autoplaying && this.settings.settings.playlistAutoplay && this.autoplayFailures < MAX_AUTOPLAY_FAILURES) {
			this.autoplayFailures++;
			this.skipTimeout = setTimeout(() => this.next({auto: true}), 2000);
		}
	},

	startCountdown: function () {
		if (!this.active || this.countdown || !this.settings.settings.playlistAutoplay || !this.hasNeighbor(1)) return;

		const state = this.el.sceneEl.systems.state.state;
		let seconds = AUTOPLAY_DELAY;
		const tick = () => {
			if (!state.isFinished) {
				this.stopCountdown();
			} else if (seconds === 0) {
				this.stopCountdown();
				this.next({auto: true});
			} else {
				this.countdownText.textContent = `Next in ${seconds--}s`;
			}
		};
		this.countdown = setInterval(tick, 1000);
		this.panel.classList.add('countingDown');
		tick();
	},

	stopCountdown: function () {
		clearInterval(this.countdown);
		this.countdown = null;
		this.panel.classList.remove('countingDown');
	},

	setStatus: function (text, isError) {
		clearTimeout(this.statusTimeout);
		this.statusEl.textContent = text;
		this.statusEl.classList.toggle('error', !!isError);
	},

	flash: function (text, isError) {
		this.setStatus(text, isError);
		this.statusTimeout = setTimeout(() => this.setStatus(''), 6000);
	},

	syncVote: function () {
		const summary = this.playlist && this.playlist.vote;
		if (!isVoteRunning(summary)) {
			this.closeVote();
		} else if (this.vote && this.vote.id === summary.id) {
			this.renderVote();
		} else if (this.loadingVoteId !== summary.id) {
			this.loadVote(summary.id);
		}
	},

	votePath: function (voteId, action = '') {
		const guid = this.isGuid() ? '?guid=' + encodeURIComponent(this.playlistId.toLowerCase()) : '';
		return `/v2/playlist/${this.playlist.id}/votes/${voteId}${action}${guid}`;
	},

	loadVote: async function (voteId) {
		this.closeVote();
		this.loadingVoteId = voteId;
		try {
			const [vote, loggedIn] = await Promise.all([api(this.votePath(voteId)), checkLogin()]);
			if (this.loadingVoteId !== voteId) return;
			this.isLoggedIn = loggedIn;
			this.applyVote(vote, true);
			this.votePolledAt = Date.now();
			this.voteTimer = setInterval(() => this.voteTick(), 1000);
		} catch (error) {
			if (this.loadingVoteId === voteId) {
				this.flash("Couldn't load the vote.", true);
			}
		}
		if (this.loadingVoteId === voteId) {
			this.loadingVoteId = null;
		}
	},

	closeVote: function () {
		clearInterval(this.voteTimer);
		this.voteTimer = null;
		this.loadingVoteId = null;
		if (this.vote) {
			this.vote = null;
			this.renderVote();
		}
	},

	applyVote: function (vote, resetPicks) {
		this.vote = vote;
		this.voteOptions = new Map(vote.options.map(option => [option.itemId, option]));
		if (resetPicks) {
			this.votePicks = new Set(vote.myChoices || []);
		}
		this.renderVote();
	},

	voteTick: function () {
		if (!isVoteRunning(this.vote)) {
			this.closeVote();
			this.reload();
			return;
		}
		const time = document.getElementById('playlistVoteTime');
		if (time && this.vote.endsAt) {
			time.textContent = 'Ends in ' + timeLeft(this.vote.endsAt);
		}
		if (this.active && !document.hidden && Date.now() - this.votePolledAt > VOTE_POLL_INTERVAL) {
			this.votePolledAt = Date.now();
			const voteId = this.vote.id;
			api(this.votePath(voteId)).then(
				vote => this.vote && this.vote.id === voteId && this.applyVote(vote, false),
				() => {}
			);
		}
	},

	hasVoted: function () {
		return !!this.vote.myChoices && this.vote.myChoices.length > 0;
	},

	canPick: function () {
		return !!this.vote && this.isLoggedIn && isVoteRunning(this.vote) && (!this.hasVoted() || this.vote.allowChange);
	},

	togglePick: function (optionId) {
		if (!this.canPick() || this.voteBusy) return;
		const picks = this.votePicks;
		if (picks.has(optionId)) {
			picks.delete(optionId);
		} else if (this.vote.maxChoices === 1) {
			picks.clear();
			picks.add(optionId);
		} else if (picks.size < this.vote.maxChoices) {
			picks.add(optionId);
		}
		this.renderVote();
	},

	submitBallot: async function (optionIds) {
		const voted = this.hasVoted();
		const voteId = this.vote.id;
		this.voteBusy = true;
		this.renderVote();
		try {
			const vote = await api(this.votePath(voteId, '/ballot'), {method: 'PUT', body: {optionIds}});
			if (this.vote && this.vote.id === voteId) {
				this.applyVote(vote, true);
				this.flash(optionIds.length ? (voted ? 'Vote changed.' : 'Vote counted.') : 'Vote taken back.');
			}
		} catch (error) {
			this.flash(error.status === 401 ? 'Log in on BeatLeader to vote.' : errorText(error, "Couldn't send the vote."), true);
		}
		this.voteBusy = false;
		this.renderVote();
	},

	endVote: async function () {
		try {
			await api(this.votePath(this.vote.id, '/end'), {method: 'POST'});
			this.flash('Vote ended. Its results are on the playlist page.');
			this.closeVote();
			this.reload();
		} catch (error) {
			this.flash(errorText(error, "Couldn't end the vote."), true);
		}
	},

	render: function () {
		this.noteEditor = null;
		this.panel.classList.toggle('loaded', !!this.playlist);
		this.panel.classList.toggle('mapPlaylist', this.isMapPlaylist());
		this.panel.classList.toggle('editable', this.canEdit());
		if (!this.playlist) {
			this.itemsEl.replaceChildren();
			return;
		}
		this.renderHeader();

		const limit = Math.max(this.renderLimit, this.currentIndex + 50);
		const rows = this.items.slice(0, limit).map((item, index) => this.renderItem(item, index));
		if (this.items.length > limit) {
			const more = element('button', 'playlistMore', `Show more (${this.items.length - limit} left)`);
			more.addEventListener('click', () => {
				this.renderLimit = limit + RENDER_STEP;
				this.render();
			});
			rows.push(more);
		}
		this.itemsEl.replaceChildren(...rows);
		this.updateCurrent();
		this.syncVote();
	},

	renderRow: function (item) {
		const row = this.itemsEl.querySelector(`.playlistItem[data-id="${item.id}"]`);
		if (row && !(this.noteEditor && row.contains(this.noteEditor))) {
			row.replaceWith(this.renderItem(item, this.items.indexOf(item)));
		}
	},

	renderHeader: function () {
		const playlist = this.playlist;
		const isOwner = playlist.role === 'owner';

		document.getElementById('playlistCover').src = playlistCover(playlist);
		document.getElementById('playlistCoverInput').disabled = !this.canEdit();

		const title = document.getElementById('playlistTitle');
		title.textContent = playlist.title;
		title.title = playlist.title;
		title.href = `${getWebsiteUrl()}/playlist/${this.isGuid() ? this.playlistId : playlist.id}`;

		const owner = document.getElementById('playlistOwner');
		owner.style.display = playlist.owner ? '' : 'none';
		if (playlist.owner) {
			owner.href = `${getWebsiteUrl()}/u/${playlist.owner.alias || playlist.owner.id}`;
			document.getElementById('playlistOwnerAvatar').src = playlist.owner.avatar;
			document.getElementById('playlistOwnerName').textContent = playlist.owner.name;
		}

		const visibility = document.getElementById('playlistVisibility');
		visibility.replaceChildren(icon(playlist.isPublic ? 'fa-globe' : 'fa-lock'), ' ' + (playlist.isPublic ? 'Public' : 'Private'));
		visibility.classList.toggle('public', playlist.isPublic);
		visibility.disabled = !isOwner;
		visibility.title = isOwner ? (playlist.isPublic ? 'Make private' : 'Make public') : '';
		document.getElementById('playlistRole').style.display = playlist.role === 'editor' ? '' : 'none';

		document.getElementById('playlistDescription').textContent = playlist.description || '';
	},

	renderItem: function (item, index) {
		const editable = this.canEditItems();
		const row = element('div', 'playlistItem');
		row.dataset.id = item.id;
		row.draggable = editable;

		const position = element('span', 'playlistItemPosition');
		position.append(element('span', 'playlistItemNumber', String(index + 1)));
		if (editable) {
			position.classList.add('draggable');
			position.append(icon('fa-grip-vertical'));
		}
		row.append(position);

		const info = element('div', 'playlistItemInfo');
		if (this.isMapPlaylist()) {
			this.renderMapItem(item, row, info);
		} else if (item.hidden) {
			row.classList.add('unavailable');
			row.append(cover(null, 'fa-eye-slash'));
			info.append(element('span', 'playlistItemSong', 'This replay is private or was deleted'));
		} else {
			const leaderboard = item.leaderboard;
			row.append(cover(leaderboard.coverImage, 'fa-music'));
			row.title = `${leaderboard.songName} by ${leaderboard.author}, mapped by ${leaderboard.mapper}`;
			info.append(element('span', 'playlistItemSong', leaderboard.songName));

			const map = element('span', 'playlistItemMap');
			map.append(difficultyBadge(leaderboard.difficultyName, leaderboard.modeName));
			if (leaderboard.stars) {
				map.append(element('span', 'playlistItemStars', `★${leaderboard.stars.toFixed(2)}`));
			}
			map.append(element('span', 'playlistItemMapper', leaderboard.mapper));
			info.append(map, this.renderScore(item));
		}

		if (item.description) {
			info.append(element('span', 'playlistItemNote', item.description));
		}
		row.append(info);
		this.renderVoteParts(row, item);

		if (editable) {
			const actions = element('span', 'playlistItemActions');
			const editNote = iconButton('fa-pen', 'Edit note');
			editNote.addEventListener('click', () => this.editNote(item));
			const remove = iconButton('fa-trash-can', 'Remove from playlist');
			remove.addEventListener('click', () => this.removeItem(item));
			actions.append(editNote, remove);
			row.append(actions);
		}
		return row;
	},

	renderMapItem: function (item, row, info) {
		const entries = item.entries;
		const isCurrent = item.id === this.currentId;
		const shown = entries && (entries.find(entry => isCurrent && entryKey(entry) === this.currentEntry) || entries.find(isPlayable));
		const leaderboard = (shown || (entries || []).find(entry => entry.leaderboard) || {}).leaderboard;

		const coverUrl = leaderboard ? leaderboard.coverImage : item.hash && `https://cdn.beatsaver.com/${item.hash.toLowerCase()}.jpg`;
		row.append(cover(coverUrl, 'fa-music'));
		info.append(element('span', 'playlistItemSong', item.songName || (leaderboard && leaderboard.songName) || item.hash || item.key));

		const map = element('span', 'playlistItemMap');
		if (entries) {
			entries.forEach(entry => {
				const badge = difficultyBadge(entry.difficulty || '?', entry.mode);
				badge.dataset.entry = entryKey(entry);
				badge.classList.toggle('empty', !isPlayable(entry));
				badge.classList.toggle('current', isCurrent && entryKey(entry) === this.currentEntry);
				badge.title = isPlayable(entry) ? 'Watch this difficulty' : 'No score to watch';
				map.append(badge);
			});
		} else {
			(item.difficulties || []).forEach(difficulty => {
				const name = difficulty.name.charAt(0).toUpperCase() + difficulty.name.slice(1);
				map.append(difficultyBadge(name, difficulty.characteristic));
			});
		}
		map.append(element('span', 'playlistItemMapper', item.levelAuthorName || (leaderboard && leaderboard.mapper) || ''));
		info.append(map);

		if (shown) {
			info.append(this.renderScore(shown));
		} else if (entries) {
			row.classList.add('unavailable');
			const reason = entries.some(entry => !entry.hidden) ? 'No score to watch' : 'This map is not on BeatLeader';
			info.append(element('span', 'playlistItemPlayer', reason));
		}
	},

	renderScore: function (entry) {
		const player = element('span', 'playlistItemPlayer');
		if (entry.player) {
			player.append(image('playlistItemAvatar', entry.player.avatar), element('span', 'playlistItemPlayerName', entry.player.name));
		}
		if (entry.replayType === 'attempt') {
			player.append(element('span', 'playlistItemEndType', END_TYPES[entry.endType] || 'Attempt'));
		}
		const stats = element('span', 'playlistItemStats');
		if (entry.accuracy) {
			stats.append(element('span', '', (entry.accuracy * 100).toFixed(2) + '%'));
		}
		if (entry.pp) {
			stats.append(element('span', 'playlistItemPp', entry.pp.toFixed(2) + 'pp'));
		}
		player.append(stats);
		return player;
	},

	renderVote: function () {
		const box = document.getElementById('playlistVote');
		const vote = this.vote;
		box.replaceChildren();
		const itemsById = new Map(this.items.map(item => [item.id, item]));
		this.itemsEl.querySelectorAll('.playlistItem').forEach(row => this.renderVoteParts(row, itemsById.get(Number(row.dataset.id))));
		if (!vote) return;

		const noun = this.isMapPlaylist() ? 'maps' : 'replays';
		const head = element('div', 'playlistVoteHead');
		head.append(icon('fa-square-poll-vertical'), element('b', '', vote.question || `Vote for your favorite ${noun}`));
		box.append(head);

		const meta = element('div', 'playlistVoteMeta');
		const time = element('span', '', vote.endsAt ? 'Ends in ' + timeLeft(vote.endsAt) : 'No time limit');
		time.id = 'playlistVoteTime';
		if (vote.endsAt) time.title = 'Ends ' + new Date(vote.endsAt * 1000).toLocaleString();
		meta.append(
			time,
			element('span', '', vote.maxChoices === 1 ? 'One pick' : `Up to ${vote.maxChoices} picks`),
			element('span', '', plural(vote.voterCount, 'voter'))
		);
		if (!vote.allowChange) {
			meta.append(element('span', '', 'Votes are final'));
		}
		box.append(meta);

		const actions = element('div', 'playlistVoteActions');
		const voted = this.hasVoted();
		if (!this.isLoggedIn) {
			actions.append(element('span', '', 'Log in on BeatLeader to vote.'));
		} else if (this.canPick()) {
			const picks = [...this.votePicks];
			const myChoices = vote.myChoices || [];
			const changed = picks.length !== myChoices.length || picks.some(id => !myChoices.includes(id));
			const count = vote.maxChoices > 1 ? ` (${picks.length}/${vote.maxChoices})` : '';
			const submit = element('button', 'playlistButton', voted ? 'Change vote' : 'Submit vote' + count);
			submit.disabled = this.voteBusy || !changed || !picks.length;
			submit.addEventListener('click', () => this.submitBallot(picks));
			actions.append(submit);
			if (voted) {
				const takeBack = element('button', 'playlistVoteLink', 'Take back my vote');
				takeBack.disabled = this.voteBusy;
				takeBack.addEventListener('click', () => this.submitBallot([]));
				actions.append(takeBack);
			} else {
				actions.append(element('span', '', `Pick ${vote.maxChoices === 1 ? 'one' : `up to ${vote.maxChoices}`} below.`));
			}
		} else if (voted) {
			actions.append(element('span', '', 'Your vote is in.'));
		}
		if (this.playlist.role === 'owner') {
			const confirm = element('button', 'playlistVoteLink danger', 'End vote');
			confirm.addEventListener('click', () => this.endVote());
			const keep = element('button', 'playlistVoteLink', 'Keep it');
			keep.addEventListener('click', () => this.renderVote());
			const end = element('button', 'playlistVoteLink danger', 'End vote');
			end.title = 'End the vote now, its results stay';
			end.addEventListener('click', () => end.replaceWith(element('span', '', 'End it now?'), confirm, keep));
			actions.append(end);
		}
		if (actions.children.length) {
			box.append(actions);
		}

		const notes = [];
		if (!vote.resultsVisible && VOTE_RESULTS_NOTES[vote.results]) {
			notes.push(VOTE_RESULTS_NOTES[vote.results]);
		}
		if (this.canEdit()) {
			notes.push(`The ${noun} can't change while the vote runs.`);
		}
		if (notes.length) {
			box.append(element('div', 'playlistVoteNote', notes.join(' ')));
		}
	},

	renderVoteParts: function (row, item) {
		row.querySelectorAll('.playlistVotePick, .playlistVoteTally').forEach(part => part.remove());
		const vote = this.vote;
		const option = vote && item && this.voteOptions.get(item.id);
		if (!option) return;

		if (this.isLoggedIn && isVoteRunning(vote)) {
			const picked = this.votePicks.has(option.id);
			const single = vote.maxChoices === 1;
			const full = !single && this.votePicks.size >= vote.maxChoices;
			const canPick = this.canPick();
			const pick = element('button', 'playlistVotePick');
			pick.type = 'button';
			pick.dataset.option = option.id;
			pick.classList.toggle('single', single);
			pick.classList.toggle('on', picked);
			pick.classList.toggle('ghost', !canPick && !picked);
			pick.disabled = !canPick || (full && !picked);
			if (picked) pick.append(icon('fa-check'));
			pick.title = !canPick ? (picked ? 'Your pick' : '') : picked ? 'Unpick' : full ? `You picked ${vote.maxChoices} already` : 'Pick';
			row.insertBefore(pick, row.querySelector('.playlistItemCover'));
		}

		if (vote.resultsVisible && option.votes != null) {
			const percent = vote.voterCount > 0 ? Math.round((option.votes / vote.voterCount) * 100) : 0;
			const tally = element('span', 'playlistVoteTally');
			tally.title = `${plural(option.votes, 'vote')}, ${percent}% of voters`;
			const bar = element('span', 'playlistVoteBar');
			const fill = element('span');
			fill.style.width = percent + '%';
			bar.append(fill);
			tally.append(bar, element('b', '', String(option.votes)), element('span', '', percent + '%'));
			row.querySelector('.playlistItemInfo').append(tally);
		}
	},

	editNote: function (item) {
		if (this.noteEditor) {
			this.render();
		}
		const row = this.itemsEl.querySelector(`.playlistItem[data-id="${item.id}"]`);
		const info = row.querySelector('.playlistItemInfo');
		const form = element('form', 'playlistNoteForm');
		const textarea = element('textarea', 'playlistField');
		textarea.maxLength = 500;
		textarea.rows = 3;
		textarea.placeholder = 'A note shown with this replay';
		textarea.value = item.description || '';
		const cancel = iconButton('fa-xmark', 'Cancel');
		const save = iconButton('fa-check', 'Save (Ctrl+Enter)');
		save.type = 'submit';
		const buttons = element('span', 'playlistFormButtons');
		buttons.append(save, cancel);
		form.append(textarea, buttons);

		form.addEventListener('submit', e => {
			e.preventDefault();
			this.saveNote(item, textarea.value.trim());
		});
		cancel.addEventListener('click', () => this.render());
		textarea.addEventListener('keydown', e => {
			if (e.key === 'Escape') {
				this.render();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				form.requestSubmit();
			}
		});

		const note = info.querySelector('.playlistItemNote');
		if (note) note.remove();
		info.append(form);
		row.draggable = false;
		this.noteEditor = form;
		textarea.focus();
	},

	scrollToRow: function (row) {
		const list = this.itemsEl;
		if (row.offsetTop < list.scrollTop) {
			list.scrollTop = row.offsetTop;
		} else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
			list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
		}
	},

	updateCurrent: function (scroll) {
		const index = this.items.findIndex(item => item.id === this.currentId);
		if (index >= 0) {
			this.currentIndex = index;
		}
		if (index >= this.itemsEl.querySelectorAll('.playlistItem').length) {
			this.render();
		}

		const itemsById = new Map(this.items.map(item => [item.id, item]));
		for (const row of this.itemsEl.querySelectorAll('.playlistItem')) {
			const item = itemsById.get(Number(row.dataset.id));
			const isCurrent = !!item && item.id === this.currentId;
			row.classList.toggle('current', isCurrent);
			row.classList.toggle('failed', !!item && !!item.failed);
			if (isCurrent && scroll) {
				this.scrollToRow(row);
			}
		}

		const count = this.items.length;
		this.positionEl.textContent = index >= 0 ? `${index + 1} / ${count}` : plural(count, this.isMapPlaylist() ? 'map' : 'replay');
		document.getElementById('playlistPrevious').disabled = !this.hasNeighbor(-1);
		document.getElementById('playlistNext').disabled = !this.hasNeighbor(1);
	},
});
