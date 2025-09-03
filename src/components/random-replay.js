const {setCookie, getApiUrl} = require('../utils');

AFRAME.registerComponent('random-replay', {
	schema: {
		enabled: {default: true},
		difficulty: {type: 'string'},
	},

	init: function () {
		this.songControls = this.el.sceneEl.components['song-controls'];
		this.replayLoader = this.el.sceneEl.components['replay-loader'];
		this.settings = this.el.sceneEl.components.settings;
		this.song = this.songControls.song;

		this.randomReplay = document.getElementById('randomReplay');
		this.randomReplayImage = document.getElementById('randomReplayImage');
		this.randomReplayNext = document.getElementById('randomReplayNext');
		this.randomReplayPlayerName = document.getElementById('randomReplayPlayerName');
		this.randomReplaySongName = document.getElementById('randomReplaySongName');

		setInterval(() => {
			this.manualTick();
		}, 100);

		document.getElementById('randomReplayReroll').onclick = () => {
			this.score = null;
			this.seconds = 10;
			this.fetchRandomReplay();
		};

		document.getElementById('randomReplayCancel').onclick = () => {
			this.canceled = true;
			clearInterval(this.interval);
		};

		const randomSourceSelect = document.getElementById('randomScoreSource');
		if (randomSourceSelect) {
			randomSourceSelect.disabled = true;

			const handleAuth = () => {
				if (this.settings.settings.randomScoreSource !== 'all') {
					this.settings.settings.randomScoreSource = 'all';
					randomSourceSelect.value = 'all';
					this.settings.sync();
				}
				randomSourceSelect.disabled = true;
			};
			fetch(getApiUrl() + '/user', {credentials: 'include'})
				.then(r => (r.ok ? r.json() : null))
				.then(data => {
					if (data && data.player) {
						randomSourceSelect.disabled = false;
					} else {
						handleAuth();
					}
				})
				.catch(() => {
					handleAuth();
				});
		}
	},

	manualTick: function () {
		const song = this.song;
		const source = song.source;

		if (
			!this.canceled &&
			this.settings.settings.autoplayRandomScore &&
			!this.settings.shouldLoopReplays() &&
			((source && Math.abs(song.getCurrentTime() - source.buffer.duration) < 0.1) ||
				(this.settings.settings.randomScoreEmptyPlayer && this.replayLoader.empty && !this.replayLoader.replay))
		) {
			this.fetchRandomReplay();
		} else if (this.randomReplay.style.display == 'flex') {
			clearInterval(this.interval);
			this.interval = null;
			this.randomReplay.style.display = 'none';
			this.randomReplay.classList = [];
		}
	},

	playScore: function (score) {
		setCookie('autoplayReplay', true, 30);

		let base = location.protocol + '//' + location.host + '?scoreId=' + score.id;
		window.location.assign(base);
	},

	fetchRandomReplay: function (instant) {
		if (this.score) {
			if (instant) {
				this.playScore(this.score);
				return;
			}
			this.randomReplay.style.display = 'flex';
			if (!this.interval) {
				this.seconds = this.replayLoader.cleanup ? 30 : 10;
				this.interval = setInterval(() => {
					this.randomReplayNext.innerHTML = 'Next in ' + this.seconds + ' sec...';
					this.seconds--;
					if (this.seconds == 0) {
						this.playScore(this.score);
					}
				}, 1000);
			}
		} else if (!this.loadingScore) {
			this.loadingScore = true;
			let source = this.settings.settings.randomScoreSource || 'all';
			// Map UI values to backend values
			const sourceToApi = {
				all: 'general',
				friends: 'friends',
				me: 'self',
			};
			let apiSource = sourceToApi[source] || 'general';
			fetch(`${getApiUrl()}/score/random?scoreSource=${apiSource}`, {
				credentials: 'include',
			})
				.then(r => (r.ok ? r.json() : Promise.reject()))
				.then(score => {
					this.score = score;
					this.loadingScore = false;
					this.randomReplay.style.display = 'flex';
					this.randomReplayImage.src = score.song.cover;

					this.randomReplayPlayerName.textContent = score.player.name;
					this.randomReplaySongName.textContent = score.song.name;
					this.randomReplayNext.href = location.protocol + '//' + location.host + '?scoreId=' + score.id;

					if (instant) {
						this.playScore(score);
					}
				})
				.catch(() => {
					// Fallback to general if request failed (e.g., not authenticated for friends/self)
					fetch(`${getApiUrl()}/score/random?scoreSource=general`, {credentials: 'include'})
						.then(r => (r.ok ? r.json() : Promise.reject()))
						.then(score => {
							this.score = score;
							this.loadingScore = false;
							this.randomReplay.style.display = 'flex';
							this.randomReplayImage.src = score.song.cover;

							this.randomReplayPlayerName.textContent = score.player.name;
							this.randomReplaySongName.textContent = score.song.name;
							this.randomReplayNext.href = location.protocol + '//' + location.host + '?scoreId=' + score.id;

							if (instant) {
								this.playScore(score);
							}
						});
				});
		}
	},
});
