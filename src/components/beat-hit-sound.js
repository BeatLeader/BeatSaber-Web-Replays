var sourceCreatedCallback;

const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

AFRAME.registerComponent('beat-hit-sound', {
	init: function () {
		// Create audio context with background audio flag
		const contextConfig = {
			latencyHint: 'interactive',
			sinkId: 'default',
		};
		if (typeof AudioContext !== 'undefined') {
			contextConfig.sampleRate = 44100;
		}
		this.context = new (window.webkitAudioContext || window.AudioContext)(contextConfig);

		this.settings = this.el.sceneEl.components['settings'];
		this.song = this.el.sceneEl.components.song;

		this.gainNode = this.context.createGain();
		this.gainNode.connect(this.context.destination);
		this.setVolume(this.settings.settings.hitSoundVolume);
		this.sources = [];

		this.beatGenerator = this.el.sceneEl.components['beat-generator'];
		this.beatIndex = -1;
		this.beatSeekReset = false;
		this.el.sceneEl.addEventListener('gamemenurestart', e => {
			this.beatIndex = -1;
		});

		this.refreshBuffer();
		setInterval(() => {
			this.checkStaticHitsound();
		}, 10);
	},

	suspendContext: function () {
		this.context.suspend();
	},

	resumeContext: function () {
		this.context.resume();
	},

	setVolume: function (value) {
		this.gainNode.gain.value = value * 0.3;
	},

	refreshBuffer: function () {
		var buffer = Buffer.from(this.settings.settings.hitSound, 'base64');
		const captureThis = this;

		this.context[isSafari ? 'decodeOggData' : 'decodeAudioData'](buffer.buffer, function (buffer) {
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

		if (!this.settings.settings.realHitsounds) {
			source.start(0);
		} else {
			source.start(0, 0.15);
		}
		setTimeout(() => {
			this.addNewSource();
		}, 1000);
	},

	checkStaticHitsound: function () {
		if (!this.beatGenerator.beatData) return;
		if (this.beatGenerator.isSeeking) {
			this.beatIndex = -1;
			return;
		}

		var skipNextHitsounds = false;
		if (this.beatSeekReset) {
			this.beatIndex = -1;
			this.beatSeekReset = false;
			skipNextHitsounds = true;
		}

		if (!this.settings.settings.realHitsounds && !this.song.data.isPaused) {
			const playbackSpeedPercent = this.song.speed;
			const currentTime = this.song.getCurrentTime();

			const notes = this.beatGenerator.beatData._notes;
			for (let i = this.beatIndex + 1; i < notes.length; ++i) {
				let noteTime = notes[i]._songTime - 0.2 * playbackSpeedPercent;

				if (noteTime > currentTime + 1 * playbackSpeedPercent) {
					break;
				} else if ((notes[i]._type == 0 || notes[i]._type == 1) && currentTime - noteTime > 0.01 * playbackSpeedPercent) {
					this.beatIndex = i;
					if (!skipNextHitsounds) {
						skipNextHitsounds = true;
						this.playSound();
					}
				} else if ((notes[i]._type == 0 || notes[i]._type == 1) && Math.abs(currentTime - noteTime) < 0.01 * playbackSpeedPercent) {
					this.playSound();
					this.beatIndex = i;
					break;
				}
			}
		}
	},
});
