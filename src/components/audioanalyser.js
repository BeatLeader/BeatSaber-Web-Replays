if (typeof AFRAME === 'undefined') {
	throw new Error('Component attempted to register before AFRAME was available.');
}

const {StreamedSong, supportsStreamedSong} = require('../utils/streamed-song');

var audioBufferCache = {};

const MAX_PRELOADED_SONGS = 3;

function createSongElement(src) {
	const audio = document.createElement('audio');
	audio.crossOrigin = 'anonymous';
	audio.preload = 'metadata';
	audio.setAttribute('src', src);
	return audio;
}

function whenPlaying(audio) {
	if (!audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
		return Promise.resolve();
	}
	return new Promise(resolve => audio.addEventListener('playing', resolve, {once: true}));
}

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
		downloadFilesFirst: {default: false},
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
		this.preloadedSongs = new Map();

		this.initContext();
		this.el.sceneEl.addEventListener('songpreload', e => this.preloadSong(e.detail.src));
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
		if (oldData.src !== data.src) {
			this.releaseSources();
		}
		if (!this.mediaSource && !this.audioSource) {
			this.refreshSource(data.speed);
		}
	},

	releaseSources: function () {
		if (this.xhr) {
			this.xhr.abort();
			this.xhr = null;
		}
		if (this.streamedSong) {
			this.streamedSong.release();
			this.streamedSong = null;
		}
		if (this.audioSource) {
			this.audioSource.disconnect();
			this.audioSource = null;
		}
		if (this.mediaSource) {
			this.mediaSource.disconnect();
			this.mediaSource = null;
		}
		if (this.audio) {
			this.audio.pause();
			this.releaseRetiredAudio();
			this.retiredAudio = this.audio;
			this.audio = null;
		}
		this.mediaNodeCache = {};
		this.bufferConnected = false;
		this.mediaConnected = false;
	},

	releaseRetiredAudio: function () {
		if (this.retiredAudio) {
			this.retiredAudio.removeAttribute('src');
			this.retiredAudio.load();
			this.retiredAudio = null;
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
		const src = this.data.src;
		const isStale = () => this.data.src !== src;

		if (this.data.isSafari) {
			this.getBufferSource().then(bufferSource => {
				if (isStale()) return;
				this.el.emit(
					'audioanalysersource',
					{source: bufferSource, mediaSource: null, audio: null, duration: bufferSource.buffer.duration},
					false
				);
			});
		} else {
			this.getMediaSource().then(source => {
				if (isStale()) return;
				if (this.audio && this.audio.duration && this.audio.duration > 0 && this.audio.duration <= 1800) {
					const mediaFirst = this.data.pitchCompensation && speed >= this.data.pitchCompensationTreshold;
					if (mediaFirst) {
						this.el.emit(
							'audioanalysersource',
							{source: source, mediaSource: source, audio: this.audio, duration: this.audio.duration},
							false
						);
					}
					const streaming = mediaFirst && !/^(blob|data):/.test(src);
					(streaming ? whenPlaying(this.audio) : Promise.resolve()).then(() => {
						if (isStale()) return;
						this.getBufferSource().then(bufferSource => {
							if (isStale()) return;
							this.mediaGainNode.gain.value = mediaFirst ? 1 : 0;
							if (!mediaFirst) {
								this.el.emit(
									'audioanalysersource',
									{source: bufferSource, mediaSource: source, audio: this.audio, duration: bufferSource.buffer.duration},
									false
								);
							}
						});
					});
				} else {
					this.el.emit('audioanalysersource', {source, mediaSource: source, audio: this.audio, duration: this.audio.duration}, false);
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
		const src = data.src;
		const decodeWhole = () => this.fetchAudioBuffer(src).then(() => this.createFullBufferSource(src));
		const song = this.getStreamedSong(src);
		const ready = song
			? song.playable.then(
					() => song.createSource(),
					error => {
						console.warn('Could not stream the song', error);
						this.streamedSongFailed = src;
						return decodeWhole();
					}
				)
			: decodeWhole();
		return ready
			.then(source => {
				this.audioSource = source;
				if (this.bufferConnected) {
					source.connect(this.gainNode);
				}

				return source;
			})
			.catch(console.error);
	},

	createFullBufferSource: function (src) {
		const source = this.context.createBufferSource();
		source.buffer = audioBufferCache[src];
		return source;
	},

	getStreamedSong: function (src) {
		// Safari decodes Ogg with oggdec, which only takes whole files.
		const canStream = !this.data.isSafari && !this.data.downloadFilesFirst && supportsStreamedSong(this.context);
		if (!canStream || this.streamedSongFailed === src) {
			return null;
		}
		if (!this.streamedSong || this.streamedSong.src !== src) {
			if (this.streamedSong) {
				this.streamedSong.release();
			}
			this.streamedSong = new StreamedSong(this.context, src, this.audio && isFinite(this.audio.duration) ? this.audio.duration : 0);
		}
		return this.streamedSong;
	},

	preloadSong: function (src) {
		const preloaded = this.preloadedSongs;
		if (preloaded.has(src) || (this.mediaNodeCache && this.mediaNodeCache[src])) {
			return;
		}
		preloaded.set(src, createSongElement(src));
		if (preloaded.size > MAX_PRELOADED_SONGS) {
			const [oldest, audio] = preloaded.entries().next().value;
			preloaded.delete(oldest);
			audio.removeAttribute('src');
			audio.load();
		}
	},

	takePreloadedSong: function (src) {
		const audio = this.preloadedSongs.get(src);
		this.preloadedSongs.delete(src);
		return audio;
	},

	getMediaSource: function (onlySource = false) {
		const nodeCache = this.mediaNodeCache || (this.mediaNodeCache = {});

		const captureThis = this;
		return new Promise(resolve => {
			const src = captureThis.data.src.constructor === String ? captureThis.data.src : captureThis.data.src.src;
			const cached = nodeCache[src];
			if (cached) {
				captureThis.audio = cached.audio;
				captureThis.mediaSource = cached.node;
				if (isFinite(cached.audio.duration)) {
					resolve(cached.node);
				} else {
					cached.audio.addEventListener('loadedmetadata', () => resolve(cached.node), {once: true});
				}
				return;
			}

			if (captureThis.data.src.constructor === String) {
				captureThis.audio = captureThis.takePreloadedSong(src) || createSongElement(src);
			} else {
				captureThis.audio = captureThis.data.src;
			}
			captureThis.audio.addEventListener('playing', () => captureThis.releaseRetiredAudio(), {once: true});
			const node = captureThis.context.createMediaElementSource(captureThis.audio);

			captureThis.mediaSource = node;
			captureThis.mediaSource.connect(captureThis.mediaGainNode);
			captureThis.mediaGainNode.connect(captureThis.gainNode);

			nodeCache[src] = {node, audio: captureThis.audio};

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
