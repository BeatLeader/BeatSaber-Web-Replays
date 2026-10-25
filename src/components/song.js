const utils = require('../utils');
var {queryParams} = require('../query-params');
const {locate} = require('../utils/media-capture');

const GAME_OVER_LENGTH = 3.5;
const ONCE = {once: true};
const BASE_VOLUME = 0.35;
const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

const MEDIA_SEEKED_LAG = isSafari ? 0.25 : 0;
const MEDIA_START_LAG = isSafari ? 0.3 : 0;
const MEDIA_SEEK_TIMEOUT = 3;
const MEDIA_RESUME_RETRY = 1;
// First guess of how far ahead of currentTime WebAudio receives the element's audio, until checkMedia measures it.
const MEDIA_LEAD = isSafari ? 0.095 : utils.isFirefox() ? 0.02 : 0;
const MEDIA_SYNC_SETTLE = isSafari ? 1 : 0.3; // s, <audio> position is unreliable this long after a (re)start or rate change
const MEDIA_SYNC_WINDOW = 0.5; // s of song time to average over, Firefox moves <audio> currentTime in ~40 ms steps
const MEDIA_SYNC_TOLERANCE = 0.005;
const MEDIA_SYNC_SLEW = 0.25; // max share of song progress used to absorb a correction
const MEDIA_CHECK_DELAY = 0.4;
const MEDIA_CHECK_INTERVAL = 2;
const MEDIA_CHECK_RANGE = 0.5;
const MEDIA_CAPTURE = 8192;
const MEDIA_MATCH = 0.85;
const MEDIA_SAMPLES = 5;
const MEDIA_MAX_STALL = 0.06;
const BUFFER_START_AHEAD = 0.04;

let skipDebug = AFRAME.utils.getUrlParameter('skip');
if (!!skipDebug) {
	skipDebug = parseInt(skipDebug) / 1000;
} else {
	skipDebug = 0;
}

let songSpeed = AFRAME.utils.getUrlParameter('speed');
if (!!songSpeed) {
	songSpeed = parseFloat(songSpeed) / 100;
	if (songSpeed < 0 || songSpeed > 2) {
		songSpeed = 1.0;
	}
} else {
	songSpeed = 1.0;
}

/**
 * Active challenge song / audio.
 *
 * Order of song init in conjuction with beat-generator:
 *
 * 1. previewStartTime is playing
 * 2. songloadfinish
 * 3. beat-generator preloading
 * 4. preloaded beats generated
 * 5. beat-generator preloading finish
 * 6. startAudio / songStartTime is set
 * 7. beat-generator continues off song current time
 */
AFRAME.registerComponent('song', {
	schema: {
		audio: {default: ''},
		analyserEl: {type: 'selector', default: '#audioAnalyser'},
		difficulty: {default: ''},
		isBeatsPreloaded: {default: false},
		isReplayLoading: {default: true},
		isPaused: {default: queryParams.time !== undefined},
		isPlaying: {default: false},
		isFinished: {default: false},
		pitchCompensation: {default: true},
		mode: {default: 'Standard'},
	},

	init: function () {
		this.analyserSetter = {};
		this.audioAnalyser = this.data.analyserEl.components.audioanalyser;
		this.context = this.audioAnalyser.context;
		this.isPlaying = false;
		this.songLoadingIndicator = document.getElementById('songLoadingIndicator');
		this.speed = songSpeed;
		this.hasReceivedUserGesture = false;
		this.silentAudio = this.audio = document.createElement('audio');
		this.audio.volume = utils.isFirefox() ? 0.0001 : 0; // Firefox really does not like zeros
		this.settings = this.el.sceneEl.components.settings;

		this.audioAnalyser.gainNode.gain.value = this.settings.settings.volume || BASE_VOLUME;
		this.mediaLead = MEDIA_LEAD;
		this.leadSamples = [MEDIA_LEAD];
		this.seekLag = MEDIA_SEEKED_LAG;
		this.seekLagSamples = [MEDIA_SEEKED_LAG];
		this.resetMediaSync();

		this.el.addEventListener('gamemenurestart', this.onRestart.bind(this));
		this.el.addEventListener('wallhitstart', this.onWallHitStart.bind(this));
		this.el.addEventListener('wallhitend', this.onWallHitEnd.bind(this));
		this.el.addEventListener('replayunload', this.unloadAudio.bind(this));

		const gestureListener = () => {
			if (!this.hitSound) {
				this.hitSound = this.el.components['beat-hit-sound'];
			}
			this.hasReceivedUserGesture = true;

			this.audioAnalyser.suspendContext();
			this.audioAnalyser.resumeContext();

			this.hitSound.suspendContext();
			this.hitSound.resumeContext();

			if (this.data.isPaused && !this.data.isReplayLoading && this.source && this.songStartTime === undefined) {
				this.startAudio(queryParams.time);
			}

			this.el.removeEventListener('usergesturereceive', gestureListener);
		};

		this.el.addEventListener('usergesturereceive', gestureListener);

		const resume = () => this.resumeStoppedAudio();
		['click', 'touchend', 'keydown'].forEach(type => document.addEventListener(type, resume, true));
		this.context.addEventListener('statechange', resume);
	},

	resumeStoppedAudio: function () {
		if (this.isPlaying && !this.data.isPaused && this.audio.paused && !this.audio.ended) {
			this.playMediaSession();
		}
	},

	pauseAudio: function () {
		if (this.playRequest) {
			this.playRequest
				.then(_ => {
					if (!this.isPlaying) {
						this.audio.pause();
					}
				})
				.catch(() => {});
		} else {
			this.audio.pause();
		}
	},

	update: function (oldData) {
		const data = this.data;

		if (!this.el.sceneEl.isPlaying) {
			return;
		}

		this.isBufferSource = (isSafari && !utils.isAacSong(data.audio)) || !data.pitchCompensation;

		// Resume.
		if (oldData.isPaused && !data.isPaused) {
			this.audioAnalyser.resumeContext();
			if (this.source) {
				this.playMediaSession();
			}
			this.isPlaying = true;
		}

		// New challenge, load audio and play when ready.
		if (oldData.audio !== data.audio && data.audio) {
			this.el.sceneEl.emit('songprocessingstart', null, false);
			this.getAudio()
				.then(source => {
					if (this.data.isBeatsPreloaded) {
						this.startAudio(queryParams.time);
					}
					this.el.sceneEl.emit('songprocessingfinish', null, false);
				})
				.catch(console.error);
			return;
		}

		// Difficulty select
		if ((oldData.difficulty && oldData.difficulty !== data.difficulty) || (oldData.mode && oldData.mode !== data.mode)) {
			this.onRestart();
		}

		// Play if we have loaded and were waiting for beats to preload.
		if (!oldData.isBeatsPreloaded && this.data.isBeatsPreloaded && this.source) {
			if (data.isPaused) {
				this.audioAnalyser.suspendContext();
				this.pauseAudio();
				this.isPlaying = false;
			} else {
				this.startAudio(queryParams.time);
			}
		}

		// Pause / stop.
		if (!oldData.isPaused && data.isPaused) {
			this.audioAnalyser.suspendContext();
			this.pauseAudio();
			this.isPlaying = false;
		}

		if (oldData.pitchCompensation !== data.pitchCompensation) {
			this.setPlaybackRate(this.speed);
		}
	},

	pause: function () {
		if (this.data.isPlaying) {
			this.audioAnalyser.suspendContext();
			this.pauseAudio();
		}
	},

	play: function () {
		if (this.data.isPlaying) {
			this.audioAnalyser.resumeContext();
			this.playMediaSession();
		}
	},

	getAudio: function () {
		const data = this.data;

		this.isPlaying = false;
		return new Promise(resolve => {
			this.audioSourceListener = evt => {
				this.audioSourceListener = null;
				this.takeSource(evt.detail);
				resolve(this.source);
			};
			data.analyserEl.addEventListener('audioanalysersource', this.audioSourceListener, ONCE);
			const sameSong = this.audioAnalyser.data.src === this.data.audio;
			this.analyserSetter.src = this.data.audio;
			this.analyserSetter.speed = this.speed;
			data.analyserEl.setAttribute('audioanalyser', this.analyserSetter);
			if (sameSong) {
				this.audioAnalyser.refreshSource(this.speed);
			}
		});
	},

	stopAudio: function () {
		if (!this.source) {
			console.warn('[song] Tried to stopAudio, but not playing.');
			return;
		}
		if (this.source && this.source.stop) {
			this.source.stop();
			this.source = null;
		}
		if (this.source != this.mediaSource && this.mediaSource && this.mediaSource.stop) {
			this.mediaSource.stop();
		}
		if (this.audio) {
			this.pauseAudio();
		}

		this.isPlaying = false;
	},

	onRestart: function () {
		this.isPlaying = false;
		this.lastCurrentTime = null;
		this.lastContextTime = null;
		this.lastFrameNow = null;
		this.songStartTime = undefined;

		// Clear gain interpolation values from game over.
		const gain = this.audioAnalyser.gainNode.gain;
		gain.cancelScheduledValues(0);

		this.el.sceneEl.emit('songprocessingstart', null, false);
		this.data.analyserEl.addEventListener(
			'audioanalysersource',
			evt => {
				this.takeSource(evt.detail);

				if (this.data.isPlaying) {
					this.startAudio();
				}
				this.el.sceneEl.emit('songprocessingfinish', null, false);
			},
			ONCE
		);
		this.audioAnalyser.refreshSource(this.speed);
	},

	unloadAudio: function () {
		if (this.audioSourceListener) {
			this.data.analyserEl.removeEventListener('audioanalysersource', this.audioSourceListener);
			this.audioSourceListener = null;
		}
		if (this.source && this.source.stop) {
			try {
				this.source.stop();
			} catch (e) {}
		}
		this.audio.pause();

		this.source = null;
		this.mediaSource = null;
		this.duration = 0;
		this.playRequest = null;
		this.metadataAudioLoading = false;
		this.isPlaying = false;
		this.songStartTime = undefined;
		this.lastCurrentTime = null;
		this.lastContextTime = null;
		this.lastFrameNow = null;
		this.mediaSeek = null;
		this.resetMediaSync();

		const gain = this.audioAnalyser.gainNode.gain;
		gain.cancelScheduledValues(0);
		gain.value = this.settings.settings.volume;
	},

	takeSource: function ({source, mediaSource, duration, audio}) {
		this.source = source;
		this.mediaSource = mediaSource;
		this.duration = duration;
		this.audio = audio || this.silentAudio;
		if (!audio) {
			this.setSilence();
		}
	},

	setSilence: function () {
		if (this.silenceUrl) {
			URL.revokeObjectURL(this.silenceUrl);
		}
		this.silenceUrl = this.audio.src = utils.createSilence(this.duration);
	},

	onWallHitStart: function () {
		const gain = this.audioAnalyser.gainNode.gain;
		const volume = this.el.sceneEl.components.settings.settings.volume || BASE_VOLUME;
		gain.linearRampToValueAtTime(0.35 * volume, this.context.currentTime + 0.1);
	},

	onWallHitEnd: function () {
		const gain = this.audioAnalyser.gainNode.gain;
		const volume = this.el.sceneEl.components.settings.settings.volume || BASE_VOLUME;
		gain.linearRampToValueAtTime(volume, this.context.currentTime + 0.1);
	},

	playMediaSession: function () {
		if (!this.metadataAudioLoading) {
			try {
				const playRequest = (this.playRequest = this.audio.play());
				playRequest
					.then(_ => {
						if (this.playRequest !== playRequest) return;
						this.playRequest = null;
						this.metadataAudioLoading = false;
						this.holdMediaSync();

						this.el.emit('songstartaudio');
					})
					.catch(() => {
						if (this.playRequest !== playRequest) return;
						this.playRequest = null;
						this.metadataAudioLoading = false;
					});

				this.metadataAudioLoading = true;
			} catch (e) {
				console.log(e);
			}
		}
	},

	startAudio: function (time) {
		this.isPlaying = true;
		const playTime = time || skipDebug || 0;

		this.source = this.activateSource();

		const startAt = this.context.currentTime + (this.source === this.mediaSource ? 0 : BUFFER_START_AHEAD);
		this.songStartTime = (startAt * this.speed - playTime) / (this.speed > 0.01 ? this.speed : 0.01);
		if (this.source.start) {
			try {
				this.source.start(startAt, playTime);
			} catch (e) {
				console.log(e);
			}
		}
		if (this.source != this.mediaSource && this.mediaSource && this.mediaSource.start) {
			try {
				this.mediaSource.start(0, playTime);
			} catch (e) {
				console.log(e);
			}
		}

		this.lastCurrentTime = this.speed > 0.01 ? 0 : time;
		this.lastContextTime = null;
		this.lastFrameNow = null;
		this.mediaSync.pending = 0;
		this.holdMediaSync();

		this.seekAudio(playTime);
		if (this.source && this.source.playbackRate) {
			this.source.playbackRate.value = this.speed;
		}
		if (this.mediaSource && this.mediaSource.playbackRate) {
			this.mediaSource.playbackRate.value = this.speed;
		}
		this.audio.playbackRate = Math.max(this.speed, this.settings.settings.pitchCompensationTreshold);

		if (this.speed > 0 && 'mediaSession' in navigator) {
			navigator.mediaSession.setPositionState({
				duration: this.getDuration(),
				playbackRate: this.speed,
				position: playTime,
			});
		}

		this.playMediaSession();
	},

	// Chrome can land Ogg seeks up to a second early in parts of the file it already played, while
	// currentTime reports the target. Reloading the element first makes the seek exact.
	seekAudio: function (time) {
		if (this.source === this.mediaSource && this.audio.src && this.audio.played.length && !utils.isAacSong(this.audio.src)) {
			this.playRequest = null;
			this.metadataAudioLoading = false;
			this.audio.load();
		}
		this.holdUntilSeeked(time);
		this.audio.currentTime = time;
	},

	holdUntilSeeked: function (time) {
		if (MEDIA_SEEKED_LAG && this.source === this.mediaSource) {
			this.seekHeld = true;
			const seek = (this.mediaSeek = {position: time - this.seekLag, until: performance.now() / 1000 + MEDIA_SEEK_TIMEOUT});
			this.audio.addEventListener('seeked', () => this.mediaSeek === seek && (this.mediaSeek = null), ONCE);
		}
	},

	// Safari's <audio> ignores playbackRate once routed through WebAudio, so other speeds play the decoded copy there.
	wantsBufferSource: function () {
		const duration = this.getDuration();
		const canUseBuffer = duration > 0 ? duration <= (this.isBufferSource || !isSafari ? 1800 : utils.MAX_SPARE_DECODE) : true;
		const speed = this.speed;
		return canUseBuffer && (this.isBufferSource || speed < this.settings.settings.pitchCompensationTreshold || (isSafari && speed !== 1));
	},

	activateSource: function () {
		const buffer = this.wantsBufferSource() && this.audioAnalyser.activateBufferSource();
		if (buffer) {
			return buffer;
		}
		if (this.wantsBufferSource() && this.awaitedCopy !== this.data.audio) {
			this.switchToCopyWhenDecoded(this.data.audio);
		}
		return this.audioAnalyser.activateMediaSource();
	},

	switchToCopyWhenDecoded: function (src) {
		this.awaitedCopy = src;
		this.audioAnalyser.getBufferSource().then(() => {
			this.awaitedCopy = null;
			const stillWanted = this.data.audio === src && this.isPlaying && this.source === this.mediaSource && this.wantsBufferSource();
			if (stillWanted && this.audioAnalyser.audioSource) {
				this.setPlaybackRate(this.speed);
			}
		});
	},

	setPlaybackRate: function (rate) {
		const rateChanged = rate !== this.speed;
		const now = this.context.currentTime;
		if (this.lastContextTime && now > this.lastContextTime) {
			this.lastCurrentTime += (now - this.lastContextTime) * this.speed;
			this.lastContextTime = now;
			this.lastFrameNow = performance.now() / 1000;
		}
		this.speed = rate;

		const newSource = this.activateSource();

		if (newSource != this.source) {
			if (this.source && this.source.stop) {
				this.source.stop();
				this.source = null;
			}
			if (this.source != this.mediaSource && this.mediaSource && this.mediaSource.stop) {
				this.mediaSource.stop();
			}

			this.source = newSource;
			const startAt = now + (this.source === this.mediaSource ? 0 : BUFFER_START_AHEAD);
			const position = Math.max(0, (this.lastCurrentTime || 0) + (startAt - now) * rate);

			if (this.source.start) {
				try {
					this.source.start(startAt, position);
				} catch (e) {
					console.log(e);
				}
			}

			if (this.source != this.mediaSource && this.mediaSource && this.mediaSource.start) {
				try {
					this.mediaSource.start(0, position);
				} catch (e) {
					console.log(e);
				}
			}

			if (this.lastCurrentTime !== undefined) {
				this.holdUntilSeeked(position);
				this.audio.currentTime = position;
			}

			this.resetMediaSync();
		} else if (rateChanged) {
			this.holdMediaSync();
		}

		if (this.source && this.source.playbackRate) {
			this.source.playbackRate.value = rate;
		}
		if (this.mediaSource && this.mediaSource.playbackRate) {
			this.mediaSource.playbackRate.value = rate;
		}
		this.audio.playbackRate = Math.max(rate, this.settings.settings.pitchCompensationTreshold);
	},

	getDuration: function () {
		if (this.source && this.source.buffer) {
			return this.source.buffer.duration;
		}
		if (this.duration) return this.duration;
		if (this.audio && isFinite(this.audio.duration)) return this.audio.duration;
		return 0;
	},

	getCurrentTime: function () {
		if (this.songStartTime === undefined) return queryParams.time !== undefined ? queryParams.time : 0;

		let lastCurrentTime = this.lastCurrentTime;
		let currentTime = this.context.currentTime;

		const nowSeconds = performance.now() / 1000;
		const frameDelta = this.lastFrameNow != null ? Math.max(0, nowSeconds - this.lastFrameNow) : 0;

		if (this.lastContextTime && currentTime - this.lastContextTime < 1e-6) {
			currentTime = this.lastContextTime + (this.source && this.source.context.state === 'running' ? frameDelta : 0);
		}

		var newCurrent;
		if (lastCurrentTime) {
			newCurrent = lastCurrentTime + (currentTime - this.lastContextTime) * this.speed;
		} else {
			newCurrent = (currentTime - this.songStartTime) * this.speed;
		}

		const streamPosition = this.streamPosition(currentTime);
		if (streamPosition !== null) {
			newCurrent = streamPosition;
			this.songStartTime = currentTime - newCurrent / (this.speed > 0.01 ? this.speed : 0.01);
			this.mediaSync.pending = 0;
			this.holdMediaSync();
		} else {
			newCurrent = this.syncToMedia(newCurrent, newCurrent - (lastCurrentTime || 0), nowSeconds);
		}
		const clock = this.mediaClock;
		if (clock && (!clock.length || currentTime > clock[clock.length - 1][0])) {
			clock.push([currentTime, newCurrent, this.audio.currentTime]);
		}
		this.checkMedia(nowSeconds);

		this.lastCurrentTime = newCurrent;
		this.lastContextTime = currentTime;
		this.lastFrameNow = nowSeconds;

		return Math.max(0, newCurrent + parseFloat(this.settings.settings.soundDelay));
	},

	streamPosition: function (contextTime) {
		if (!this.isPlaying || !this.source) {
			return null;
		}
		if (this.source === this.mediaSource) {
			if (this.mediaSeek && performance.now() / 1000 < this.mediaSeek.until) {
				return this.mediaSeek.position;
			}
			this.mediaSeek = null;
			const stopped = this.audio.paused && !this.audio.ended;
			if (stopped && performance.now() / 1000 > (this.resumeRetryAt || 0)) {
				this.resumeRetryAt = performance.now() / 1000 + MEDIA_RESUME_RETRY;
				this.resumeStoppedAudio();
			}
			if (!stopped && this.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
				return null;
			}
			this.seekHeld = false;
			return this.audio.currentTime - (stopped ? 0 : MEDIA_START_LAG);
		}
		if (this.source.stalledAt != null) {
			return this.source.stalledAt;
		}
		const resumed = this.source.takeResume && this.source.takeResume();
		return resumed ? resumed.position + Math.max(0, contextTime - resumed.time) * this.speed : null;
	},

	resetMediaSync: function () {
		this.mediaSync = {pending: 0, holds: 0, nextCheckAt: 0};
		this.holdMediaSync();
	},

	holdMediaSync: function () {
		const sync = this.mediaSync;
		const now = performance.now() / 1000;
		sync.sum = sync.count = 0;
		sync.settleAt = now + MEDIA_SYNC_SETTLE;
		sync.checkAt = now + MEDIA_CHECK_DELAY;
		sync.holds++;
	},

	// The <audio> element loses a bit of position on starts, seeks, playbackRate changes and resumes, while song time
	// follows the AudioContext clock. Keep their offset at the element's lead, slewing corrections in.
	syncToMedia: function (current, advanced, now) {
		const sync = this.mediaSync;
		if (!this.isPlaying || this.source !== this.mediaSource || this.audio.paused) return current;

		const step = Math.sign(sync.pending) * Math.min(Math.abs(sync.pending), Math.max(0, advanced) * MEDIA_SYNC_SLEW);
		sync.pending -= step;
		current -= step;

		if (now < sync.settleAt) return current;
		if (!sync.count) sync.windowStart = current;
		sync.sum += current - sync.pending - this.audio.currentTime;
		sync.count++;
		if (current - sync.windowStart < MEDIA_SYNC_WINDOW) return current;

		const offset = sync.sum / sync.count;
		sync.sum = sync.count = 0;
		if (Math.abs(offset - this.mediaLead) > MEDIA_SYNC_TOLERANCE) sync.pending += offset - this.mediaLead;
		return current;
	},

	checkMedia: function (now) {
		const sync = this.mediaSync;
		const playing = this.isPlaying && this.source === this.mediaSource && !this.audio.paused && this.speed === 1;
		const early = sync.checkAt !== null && now >= sync.checkAt;
		if (this.mediaCheck || !playing || !(early || (now >= sync.settleAt && now >= sync.nextCheckAt))) return;
		sync.checkAt = null;
		sync.nextCheckAt = now + MEDIA_CHECK_INTERVAL;
		const audio = this.audio;
		const holds = sync.holds;
		this.mediaCheck = this.measureMedia()
			.then(result => {
				if (this.audio !== audio || this.mediaSync !== sync || sync.holds !== holds) return;
				if (!result) {
					if (early) sync.checkAt = performance.now() / 1000 + MEDIA_CHECK_DELAY;
				} else if (early) {
					sync.pending = result.song - result.real;
					if (this.seekHeld) {
						this.seekHeld = false;
						this.seekLag = learn(this.seekLagSamples, this.seekLag - (result.real - result.song));
					}
				} else {
					this.mediaLead = learn(this.leadSamples, result.real - result.element);
				}
			})
			.catch(console.error)
			.finally(() => (this.mediaCheck = null));
	},

	measureMedia: async function () {
		const clock = (this.mediaClock = []);
		const capture = await this.audioAnalyser.captureMedia(MEDIA_CAPTURE);
		this.mediaClock = null;
		const song = capture && clock.length > 1 ? clockAt(clock, capture.time, 1) : null;
		if (song === null) return null;
		const rate = this.context.sampleRate;
		const from = Math.max(0, Math.round((song - MEDIA_CHECK_RANGE) * rate));
		const reference = await this.audioAnalyser.readSong(from / rate, MEDIA_CAPTURE + Math.round(2 * MEDIA_CHECK_RANGE * rate));
		if (!reference) return null;
		const {lag, match} = locate(reference, capture.samples);
		return match < MEDIA_MATCH ? null : {real: (from + lag) / rate, song, element: clockAt(clock, capture.time, 2)};
	},
});

function learn(samples, value) {
	samples.push(value);
	if (samples.length > MEDIA_SAMPLES) samples.shift();
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[sorted.length >> 1];
}

function clockAt(rows, t, column) {
	let i = 0;
	while (i < rows.length - 2 && rows[i + 1][0] < t) i++;
	const [a, b] = [rows[i], rows[i + 1]];
	if (b[0] - a[0] > MEDIA_MAX_STALL || t < a[0] - MEDIA_MAX_STALL || t > b[0] + MEDIA_MAX_STALL) return null;
	return a[column] + ((t - a[0]) / (b[0] - a[0])) * (b[column] - a[column]);
}
