var times = [];
var captureThis = this;

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
		this.showFps();
	},

	showFps: function () {
		if (captureThis.data.enabled) {
			captureThis.label.setAttribute('text', 'value', 'FPS\nyour: ' + times.length + '\nreplay: ' + captureThis.replayFps);
		}

		setTimeout(captureThis.showFps, 100);
	},
});
