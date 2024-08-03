/**
 * Tell app to pause game if playing.
 */
AFRAME.registerComponent('pauser', {
	schema: {
		enabled: {default: true},
		pauseOnUnfocus: {default: false},
	},

	init: function () {
		this.pauseGame = this.pauseGame.bind(this);
		this.songControls = this.el.sceneEl.components['song-controls'];
		this.replayLoader = this.el.sceneEl.components['replay-loader'];
		this.settings = this.el.sceneEl.components.settings;
		document.addEventListener('visibilitychange', () => {
			if (this.data.pauseOnUnfocus && document.visibilityState === 'hidden') {
				this.pauseGame();
			}
		});

		setInterval(() => {
			this.checkSongFinish();
		}, 10);
	},

	pauseGame: function () {
		if (!this.data.enabled) {
			return;
		}
		this.el.sceneEl.emit('pausegame', null, false);
	},

	checkSongFinish: function () {
		const song = this.el.sceneEl.components.song;
		const source = song.source;
		if (!source) {
			return;
		}

		if (song.isPlaying && song.getCurrentTime() >= source.buffer.duration) {
			if (this.settings.settings.loopReplays) {
				this.songControls.seek(0);
			} else {
				this.el.sceneEl.emit('finishgame', null, false);
			}
		}

		const replay = this.replayLoader.replay;
		if (replay && replay.info.failTime && song.getCurrentTime() >= replay.info.failTime) {
			if (this.settings.settings.loopReplays) {
				this.songControls.seek(0);
			} else {
				this.el.sceneEl.emit('finishgame', null, false);
			}
		}
	},
});
