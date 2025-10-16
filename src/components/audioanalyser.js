if (typeof AFRAME === 'undefined') {
	throw new Error('Component attempted to register before AFRAME was available.');
}

var audioBufferCache = {};

/**
 * Audio visualizer component for A-Frame using AnalyserNode.
 */
AFRAME.registerComponent('audioanalyser', {
	schema: {
		isSafari: {default: false},
		pitchCompensationTreshold: {default: 0.1},
		beatDetectionDecay: {default: 0.99},
		beatDetectionMinVolume: {default: 15},
		beatDetectionThrottle: {default: 250},
		cache: {default: false},
		enabled: {default: true},
		enableBeatDetection: {default: true},
		enableLevels: {default: true},
		enableWaveform: {default: true},
		enableVolume: {default: true},
		fftSize: {default: 2048},
		smoothingTimeConstant: {default: 0.8},
		pitchCompensation: {default: true},
		speed: {default: 1.0},
		src: {
			parse: function (val) {
				if (val.constructor !== String) {
					return val;
				}
				if (val.startsWith('#') || val.startsWith('.')) {
					return document.querySelector(val);
				}
				return val;
			},
		},
		unique: {default: false},
	},

	init: function () {
		this.audioEl = null;
		this.levels = null;
		this.waveform = null;
		this.volume = 0;
		this.xhr = null;

		this.initContext();
	},

	update: function (oldData) {
		var analyser = this.analyser;
		var data = this.data;

		// Update analyser stuff.
		if (oldData.fftSize !== data.fftSize || oldData.smoothingTimeConstant !== data.smoothingTimeConstant) {
			analyser.fftSize = data.fftSize;
			analyser.smoothingTimeConstant = data.smoothingTimeConstant;
			this.levels = new Uint8Array(analyser.frequencyBinCount);
			this.waveform = new Uint8Array(analyser.fftSize);
		}

		if (!data.src) {
			return;
		}
		if (!this.mediaSource && !this.audioSource) {
			this.refreshSource(data.speed);
		}
	},

	/**
	 * Update spectrum on each frame.
	 */
	tick: function (t, dt) {
		var data = this.data;
		var volume;

		if (!data.enabled) {
			return;
		}

		// Levels (frequency).
		if (data.enableLevels || data.enableVolume) {
			this.analyser.getByteFrequencyData(this.levels);
		}

		// Waveform.
		if (data.enableWaveform) {
			this.analyser.getByteTimeDomainData(this.waveform);
		}

		// Average volume.
		if (data.enableVolume || data.enableBeatDetection) {
			var sum = 0;
			for (var i = 0; i < this.levels.length; i++) {
				sum += this.levels[i];
			}
			this.volume = sum / this.levels.length;
		}

		// Beat detection.
		if (data.enableBeatDetection) {
			volume = this.volume;
			if (!this.beatCutOff) {
				this.beatCutOff = volume;
			}
			if (volume > this.beatCutOff && volume > this.data.beatDetectionMinVolume) {
				this.beatCutOff = volume * 1.5;
				this.beatTime = 0;
			} else {
				if (this.beatTime <= this.data.beatDetectionThrottle) {
					this.beatTime += dt;
				} else {
					this.beatCutOff *= this.data.beatDetectionDecay;
					this.beatCutOff = Math.max(this.beatCutOff, this.data.beatDetectionMinVolume);
				}
			}
		}
	},

	initContext: function () {
		var data = this.data;
		var analyser;
		var gainNode;

		const contextConfig = {
			latencyHint: 'interactive',
			sinkId: 'default',
		};

		this.context = new (window.webkitAudioContext || window.AudioContext)(contextConfig);

		analyser = this.analyser = this.context.createAnalyser();
		gainNode = this.gainNode = this.context.createGain();
		this.mediaGainNode = this.context.createGain();
		gainNode.connect(analyser);
		analyser.connect(this.context.destination);
		analyser.fftSize = data.fftSize;
		analyser.smoothingTimeConstant = data.smoothingTimeConstant;
		this.levels = new Uint8Array(analyser.frequencyBinCount);
		this.waveform = new Uint8Array(analyser.fftSize);
	},

	refreshSource: function (speed) {
		if (this.data.isSafari || speed < this.data.pitchCompensationTreshold) {
			this.getBufferSource().then(bufferSource => {
				this.el.emit(
					'audioanalysersource',
					{source: bufferSource, mediaSource: null, audio: null, duration: bufferSource.buffer.duration},
					false
				);
			})
		} else {
			this.getMediaSource().then(source => {
				if (this.audio && this.audio.duration && this.audio.duration > 0 && this.audio.duration <= 1800) {
					this.getBufferSource().then(bufferSource => {
						if (!this.data.pitchCompensation) {
							this.mediaGainNode.gain.value = 0;
						} else {
							this.mediaGainNode.gain.value = 1;
						}
						this.el.emit(
							'audioanalysersource',
							{source: this.data.pitchCompensation ? source : bufferSource, mediaSource: source, audio: this.audio, duration: bufferSource.buffer.duration},
							false
						);
					})
				} else {
					this.el.emit(
						'audioanalysersource',
						{source, mediaSource: source, audio: this.audio, duration: this.audio.duration},
						false
					);
				}
			});
		}
	},

	activateBufferSource: function () {
		// Disconnect media if connected, connect buffer source
		if (this.mediaSource && this.mediaConnected) {
			try {
				this.mediaGainNode.gain.value = 0;
			} catch (e) {
				console.log(e);
			}
			this.mediaConnected = false;
		}

		if (this.audioSource && !this.bufferConnected) {
			try {
				this.audioSource.connect(this.gainNode);
			} catch (e) {
				console.log(e);
			}
			this.bufferConnected = true;
		}
		return this.audioSource;
	},

	activateMediaSource: function () {
		// Disconnect buffer if connected, connect media node
		if (this.audioSource && this.bufferConnected) {
			try {
				this.audioSource.disconnect();
				this.getBufferSource(false);
			} catch (e) {
				console.log(e);
			}
			this.bufferConnected = false;
		}
		if (this.mediaSource && !this.mediaConnected) {
			try {
				this.mediaGainNode.gain.value = 1;
				
			} catch (e) {
				console.log(e);
			}
			this.mediaConnected = true;
		}
		return this.mediaSource;
	},

	suspendContext: function () {
		this.context.suspend();
	},

	resumeContext: function () {
		if (!this.firefoxZeroed) {
			this.context.resume();
		}
	},

	zeroFirefox: function () {
		this.firefoxZeroed = true;
		this.suspendContext();
	},

	unzeroFirefox: function (startPlaying) {
		this.firefoxZeroed = undefined;
		if (startPlaying) {
			this.resumeContext();
		}
	},

	/**
	 * Fetch and parse buffer to audio buffer. Resolve a source.
	 */
	fetchAudioBuffer: function (src) {
		// From cache.
		if (audioBufferCache[src]) {
			if (audioBufferCache[src].constructor === Promise) {
				return audioBufferCache[src];
			} else {
				return Promise.resolve(audioBufferCache[src]);
			}
		}

		if (!this.data.cache) {
			Object.keys(audioBufferCache).forEach(function (src) {
				delete audioBufferCache[src];
			});
		}

		audioBufferCache[src] = new Promise(resolve => {
			// Fetch if does not exist.
			const xhr = (this.xhr = new XMLHttpRequest());
			xhr.open('GET', src);
			xhr.responseType = 'arraybuffer';
			xhr.addEventListener('load', () => {
				// Support Webkit with callback.
				function cb(audioBuffer) {
					audioBufferCache[src] = audioBuffer;
					resolve(audioBuffer);
				}
				var res = this.context[this.data.isSafari ? 'decodeOggData' : 'decodeAudioData'](xhr.response, cb);
				if (!res && this.data.isSafari) {
					res = this.context['decodeAudioData'](xhr.response, cb);
				}
				if (res && res.constructor === Promise) {
					res.then(cb).catch(console.error);
				}
			});
			xhr.send();
		});
		return audioBufferCache[src];
	},

	getBufferSource: function (onlySource = false) {
		var data = this.data;
		if (this.audioSource) {
			this.audioSource.disconnect();
		}
		return this.fetchAudioBuffer(data.src)
			.then(() => {
				var source = this.audioSource;

				source = this.context.createBufferSource();
				source.buffer = audioBufferCache[data.src];
				this.audioSource = source;
				if (this.bufferConnected) {
					source.connect(this.gainNode);
				}
				
				return source;
			})
			.catch(console.error);
	},

	getMediaSource: function (onlySource = false) {
		const nodeCache = {};

		const captureThis = this;
		return new Promise(resolve => {
			const src = captureThis.data.src.constructor === String ? captureThis.data.src : captureThis.data.src.src;
			if (nodeCache[src]) {
				resolve(nodeCache[src]);
				return;
			}

			if (captureThis.data.src.constructor === String) {
				captureThis.audio = document.createElement('audio');
				captureThis.audio.crossOrigin = 'anonymous';
				captureThis.audio.preload = 'metadata';
				captureThis.audio.setAttribute('src', captureThis.data.src);
			} else {
				captureThis.audio = captureThis.data.src;
			}
			const node = captureThis.context.createMediaElementSource(captureThis.audio);

			captureThis.mediaSource = node;
			captureThis.mediaSource.connect(captureThis.mediaGainNode);
			captureThis.mediaGainNode.connect(captureThis.gainNode);

			nodeCache[src] = node;

			const onMeta = () => {
				resolve(node);
			};

			if (isFinite(captureThis.audio.duration) && captureThis.audio.duration > 0) {
				onMeta();
			} else if (captureThis.audio) {
				captureThis.audio.addEventListener('loadedmetadata', onMeta, {once: true});
			}
		});
	},
});
