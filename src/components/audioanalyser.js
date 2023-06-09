if (typeof AFRAME === 'undefined') {
	throw new Error('Component attempted to register before AFRAME was available.');
}

var audioBufferCache = {};

const {WAAPlayer} = require('../../vendor/phase-vocoder-2');
var BUFFER_SIZE = 4096;
var FRAME_SIZE = 1024;

/**
 * Audio visualizer component for A-Frame using AnalyserNode.
 */
AFRAME.registerComponent('audioanalyser', {
	schema: {
		buffer: {default: false},
		isSafari: {default: false},
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
		this.refreshSource();
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

	initContext: async function () {
		var data = this.data;
		var analyser;
		var gainNode;

		this.context = new (window.webkitAudioContext || window.AudioContext)();
		analyser = this.analyser = this.context.createAnalyser();
		gainNode = this.gainNode = this.context.createGain();
		gainNode.connect(analyser);

		try {
			await this.context.audioWorklet.addModule('vendor/phase-vocoder-2.js');
		} catch (err) {
			throw new Error(`Error adding module: ${err}`);
		}

		this.vocoder = new WAAPlayer(this.context, FRAME_SIZE, BUFFER_SIZE); // new AudioWorkletNode(this.context, 'phase-vocoder-processor', {});
		// this.vocoder.connect();
		analyser.connect(this.vocoder.node);

		// analyser.connect(gainNode);
		analyser.fftSize = data.fftSize;
		analyser.smoothingTimeConstant = data.smoothingTimeConstant;

		// gainNode.connect(this.context.destination);
		this.vocoder.node.connect(this.context.destination);
		this.levels = new Uint8Array(analyser.frequencyBinCount);
		this.waveform = new Uint8Array(analyser.fftSize);
	},

	refreshSource: function () {
		var analyser = this.analyser;
		var data = this.data;

		if (data.buffer && data.src.constructor === String) {
			this.getBufferSource().then(source => {
				this.source = source;
				this.source.connect(this.gainNode);
			});
		} else {
			this.source = this.getMediaSource();
			this.source.connect(this.gainNode);
		}
	},

	suspendContext: function () {
		this.context.suspend();
	},

	resumeContext: function () {
		this.context.resume();
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
				const res = this.context[this.data.isSafari ? 'decodeOggData' : 'decodeAudioData'](xhr.response, cb);
				if (res && res.constructor === Promise) {
					res.then(cb).catch(console.error);
				}
			});
			xhr.send();
		});
		return audioBufferCache[src];
	},

	getBufferSource: function () {
		var data = this.data;
		return this.fetchAudioBuffer(data.src)
			.then(() => {
				var source;
				source = this.context.createBufferSource();
				source.buffer = audioBufferCache[data.src];
				this.vocoder.setBuffer(source.buffer);
				source.vocoder = this.vocoder;
				this.el.emit('audioanalyserbuffersource', source, false);
				return source;
			})
			.catch(console.error);
	},

	getMediaSource: (function () {
		const nodeCache = {};

		return function () {
			const src = this.data.src.constructor === String ? this.data.src : this.data.src.src;
			if (nodeCache[src]) {
				return nodeCache[src];
			}

			if (this.data.src.constructor === String) {
				this.audio = document.createElement('audio');
				this.audio.crossOrigin = 'anonymous';
				this.audio.setAttribute('src', this.data.src);
			} else {
				this.audio = this.data.src;
			}
			const node = this.context.createMediaElementSource(this.audio);

			nodeCache[src] = node;
			return node;
		};
	})(),
});
