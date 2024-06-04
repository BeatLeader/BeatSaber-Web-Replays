const {setCookie} = require('../utils');

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
	},

	manualTick: function () {
		const song = this.song;
		const source = song.source;

		if (
			!this.canceled &&
			this.settings.settings.autoplayRandomScore &&
			((source && song.getCurrentTime() >= source.buffer.duration - 10) ||
				(this.settings.settings.randomScoreEmptyPlayer && this.replayLoader.cleanup))
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
			fetch(
				`https://api.beatleader.xyz/score/random?scoreSource=${this.settings.settings.randomScoreFromFriends ? 'friends' : 'general'}`,
				{
					credentials: 'include',
				}
			)
				.then(r => r.json())
				.then(score => {
					this.score = score;
					this.loadingScore = false;
					this.randomReplay.style.display = 'flex';
					this.randomReplayImage.src = score.song.cover;

					this.randomReplayPlayerName.innerHTML = score.player.name;
					this.randomReplaySongName.innerHTML = score.song.name;
					this.randomReplayNext.href = location.protocol + '//' + location.host + '?scoreId=' + score.id;

					if (instant) {
						this.playScore(score);
					}
				});
		}
	},
});
