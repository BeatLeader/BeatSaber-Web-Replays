var times = [];
var captureThis = this;

AFRAME.registerComponent('heartrate-counter', {
	schema: {
		enabled: {default: false},
	},

	init: function () {
		this.replayFps = 0;
		this.label = document.getElementById('heartrate');
		this.replayLoader = this.el.sceneEl.components['replay-loader'];
		this.song = this.el.sceneEl.components['song'];
		this.setupHeartrate();
	},

	setupHeartrate: function () {
		function refreshLoop() {
			window.requestAnimationFrame(() => {
				const now = performance.now();
				while (times.length > 0 && times[0] <= now - 1000) {
					times.shift();
				}
				times.push(now);
				refreshLoop();
			});
		}

		captureThis = this;

		refreshLoop();
		this.showHeartrate();
	},

	showHeartrate: function () {
		if (captureThis.data.enabled) {
			const replay = captureThis.replayLoader.replay;
			const song = captureThis.el.sceneEl.components.song;
			if (replay && replay.parsedCustomData['HeartBeatQuest']) {
				const frames = replay.parsedCustomData['HeartBeatQuest'].frames;
				const songTime = song.getCurrentTime();
				for (let i = 0; i < frames.length; i++) {
					const frame = frames[i];
					if (frame.time >= songTime) {
						captureThis.label.setAttribute('text', 'value', frame.heartrate);
						break;
					}
				}
			}
		}

		setTimeout(captureThis.showHeartrate, 100);
	},
});
