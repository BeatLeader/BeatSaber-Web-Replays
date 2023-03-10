var sourceCreatedCallback;

AFRAME.registerComponent('beat-hit-sound', {
	init: function () {
		this.context = new (window.webkitAudioContext || window.AudioContext)();
		this.settings = this.el.sceneEl.components['settings'];

		this.gainNode = this.context.createGain();
		this.gainNode.connect(this.context.destination);
		this.setVolume(this.settings.settings.hitSoundVolume);
		this.sources = [];

		this.refreshBuffer();
	},

	suspendContext: function () {
		this.context.suspend();
	},

	resumeContext: function () {
		this.context.resume();
	},

	setVolume: function (value) {
		this.gainNode.gain.value = value * 0.2;
	},

	refreshBuffer: function () {
		var buffer = Buffer.from(this.settings.settings.hitSound, 'base64');
		const captureThis = this;

		this.context.decodeAudioData(buffer.buffer, function (buffer) {
			captureThis.sources = [];
			for (let index = 0; index < 100; index++) {
				var source = captureThis.context.createBufferSource();
				source.buffer = buffer;
				source.connect(captureThis.gainNode);

				captureThis.sources.push(source);
			}
			captureThis.audioBuffer = buffer;
		});
	},

	addNewSource: function () {
		var source = this.context.createBufferSource();
		source.buffer = this.audioBuffer;
		source.connect(this.gainNode);

		this.sources.push(source);
	},

	playSound: function () {
		var source = this.sources.pop();
		if (source == null) return;

		source.start(0);
		setTimeout(() => {
			this.addNewSource();
		}, 1000);
	},
});
