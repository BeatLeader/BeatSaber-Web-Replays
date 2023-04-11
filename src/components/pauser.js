/**
 * Tell app to pause game if playing.
 */
AFRAME.registerComponent('pauser', {
	schema: {
		enabled: {default: true},
	},

	init: function () {
		this.pauseGame = this.pauseGame.bind(this);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				this.pauseGame();
			}
		});
	},

	pauseGame: function () {
		if (!this.data.enabled) {
			return;
		}
		this.el.sceneEl.emit('pausegame', null, false);
	},

	tick: function () {
		const song = this.el.sceneEl.components.song;
		const source = song.source;
		if (!source) {
			return;
		}

		if (song.isPlaying && song.getCurrentTime() >= source.buffer.duration) {
			this.el.sceneEl.emit('finishgame', null, false);
		}

		const replay = this.el.sceneEl.components['replay-loader'].replay;
		if (replay && song.getCurrentTime() >= replay.info.failTime) {
			this.el.sceneEl.emit('finishgame', null, false);
		}
	},
});
