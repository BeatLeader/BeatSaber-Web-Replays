AFRAME.registerComponent('fps-counter', {
	schema: {
		enabled: {default: false},
	},

	init: function () {
		this.replayFps = 0;
		this.label = document.getElementById('fps');
		this.setupFps();
	},

	setupFps: function () {
		const times = [];
		let captureThis = this;

		function refreshLoop() {
			window.requestAnimationFrame(() => {
				const now = performance.now();
				while (times.length > 0 && times[0] <= now - 1000) {
					times.shift();
				}
				times.push(now);
				fps = times.length;
				captureThis.showFps(times.length, captureThis);
				refreshLoop();
			});
		}

		refreshLoop();
	},
	showFps: function (fps, captureThis) {
		if (captureThis.data.enabled) {
			captureThis.label.setAttribute('text', 'value', 'Your: ' + fps + '\nReplay: ' + captureThis.replayFps);
		}
	},
});
