const utils = require('../utils');
var {queryParamTime} = require('../query-params');

const GAME_OVER_LENGTH = 3.5;
const ONCE = {once: true};
const BASE_VOLUME = 0.35;
const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

// Song time is integrated from the AudioContext clock, but with pitch compensation the music
// comes from an <audio> element. Changing that element's playbackRate (speed slider, slow-mo on
// mistakes) makes it lose some media time, so the music falls behind the notes a bit more on
// every change. After such a change we wait for the element to settle, compare its position
// with the song time and gently pull the song time back to the offset it had before.
const MEDIA_SYNC_SAMPLE_INTERVAL = 0.04; // s (wall clock) between offset samples
const MEDIA_SYNC_REF_SAMPLES = 8; // steady-state samples kept for the reference offset
const MEDIA_SYNC_MEASURE_SAMPLES = 6; // samples taken after a disturbance
const MEDIA_SYNC_SETTLE_TIME = 0.3; // s (wall clock) to wait after the last disturbance
const MEDIA_SYNC_MIN_CORRECTION = 0.002; // s, smaller differences are left alone
const MEDIA_SYNC_SLEW = 0.15; // share of song progress used to absorb a correction
const MEDIA_SYNC_FAST_SLEW = 0.5; // same, for corrections above MEDIA_SYNC_FAST_SLEW_FROM
const MEDIA_SYNC_FAST_SLEW_FROM = 0.1; // s

function median(values) {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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
		isPaused: {default: queryParamTime !== undefined},
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
		this.audio = document.createElement('audio');
		this.audio.volume = utils.isFirefox() ? 0.0001 : 0; // Firefox really does not like zeros
		this.settings = this.el.sceneEl.components.settings;

		this.audioAnalyser.gainNode.gain.value = this.settings.settings.volume || BASE_VOLUME;
		this.resetMediaSync();

		this.el.addEventListener('gamemenurestart', this.onRestart.bind(this));
		this.el.addEventListener('wallhitstart', this.onWallHitStart.bind(this));
		this.el.addEventListener('wallhitend', this.onWallHitEnd.bind(this));

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
				this.startAudio(queryParamTime);
			}

			this.el.removeEventListener('usergesturereceive', gestureListener);
		};

		this.el.addEventListener('usergesturereceive', gestureListener);
	},

	pauseAudio: function () {
		if (this.playRequest) {
			this.playRequest.then(_ => {
				if (!this.isPlaying) {
					this.audio.pause();
				}
			});
		} else {
			this.audio.pause();
		}
	},

	update: function (oldData) {
		const data = this.data;

		if (!this.el.sceneEl.isPlaying) {
			return;
		}

		this.isBufferSource = isSafari || !data.pitchCompensation;

		// Resume.
		if (oldData.isPaused && !data.isPaused) {
			this.audioAnalyser.resumeContext();
			if (this.source) {
				this.playMediaSession();
			}
			this.isPlaying = true;
			this.markMediaSyncDisturbed();
		}

		// New challenge, load audio and play when ready.
		if (oldData.audio !== data.audio && data.audio) {
			this.el.sceneEl.emit('songprocessingstart', null, false);
			this.getAudio()
				.then(source => {
					if (this.data.isBeatsPreloaded) {
						this.startAudio(queryParamTime);
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
				this.startAudio(queryParamTime);
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
			this.markMediaSyncDisturbed();
		}
	},

	getAudio: function () {
		const data = this.data;

		this.isPlaying = false;
		return new Promise(resolve => {
			data.analyserEl.addEventListener(
				'audioanalysersource',
				evt => {
					this.source = evt.detail.source;
					this.mediaSource = evt.detail.mediaSource;
					this.duration = evt.detail.duration;
					if (evt.detail.audio) {
						this.audio = evt.detail.audio;
					}
					if (isSafari) {
						this.audio.src = utils.createSilence(this.duration);
					}
					resolve(this.source);
				},
				ONCE
			);
			this.analyserSetter.src = this.data.audio;
			this.analyserSetter.speed = this.speed;
			data.analyserEl.setAttribute('audioanalyser', this.analyserSetter);
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
		this.resetMediaSync();
	},

	onRestart: function () {
		this.isPlaying = false;
		this.lastCurrentTime = null;
		this.lastContextTime = null;
		this.lastFrameNow = null;
		this.songStartTime = undefined;
		this.resetMediaSync();

		// Clear gain interpolation values from game over.
		const gain = this.audioAnalyser.gainNode.gain;
		gain.cancelScheduledValues(0);

		this.el.sceneEl.emit('songprocessingstart', null, false);
		this.data.analyserEl.addEventListener(
			'audioanalysersource',
			evt => {
				this.source = evt.detail.source;
				this.mediaSource = evt.detail.mediaSource;
				this.duration = evt.detail.duration;
				if (isSafari) {
					this.audio.src = utils.createSilence(this.duration);
				}

				if (this.data.isPlaying) {
					this.startAudio();
				}
				this.el.sceneEl.emit('songprocessingfinish', null, false);
			},
			ONCE
		);
		this.audioAnalyser.refreshSource(this.speed);
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
				this.playRequest = this.audio.play();
				this.playRequest.then(_ => {
					this.playRequest = null;
					this.metadataAudioLoading = false;

					this.el.emit('songstartaudio');
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

		const duration = this.getDuration();
		const canUseBuffer = duration > 0 ? duration <= 1800 : true;
		if ((this.isBufferSource || this.speed < this.settings.settings.pitchCompensationTreshold) && canUseBuffer) {
			this.source = this.audioAnalyser.activateBufferSource();
		} else {
			this.source = this.audioAnalyser.activateMediaSource();
		}

		this.songStartTime = (this.context.currentTime * this.speed - playTime) / (this.speed > 0.01 ? this.speed : 0.01);
		if (this.source.start) {
			try {
				this.source.start(0, playTime);
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
		this.resetMediaSync();

		this.audio.currentTime = playTime;
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

	setPlaybackRate: function (rate) {
		const rateChanged = rate !== this.speed;
		this.speed = rate;

		const duration = this.getDuration();
		const canUseBuffer = duration > 0 ? duration <= 1800 : true;
		var newSource = null;
		if ((this.isBufferSource || this.speed < this.settings.settings.pitchCompensationTreshold) && canUseBuffer) {
			newSource = this.audioAnalyser.activateBufferSource();
		} else {
			newSource = this.audioAnalyser.activateMediaSource();
		}

		if (newSource != this.source) {
			if (this.source && this.source.stop) {
				this.source.stop();
				this.source = null;
			}
			if (this.source != this.mediaSource && this.mediaSource && this.mediaSource.stop) {
				this.mediaSource.stop();
			}

			this.source = newSource;

			if (this.source.start) {
				try {
					this.source.start(0, this.lastCurrentTime);
				} catch (e) {
					console.log(e);
				}
			}

			if (this.source != this.mediaSource && this.mediaSource && this.mediaSource.start) {
				try {
					this.mediaSource.start(0, this.lastCurrentTime);
				} catch (e) {
					console.log(e);
				}
			}

			if (this.lastCurrentTime !== undefined) {
				this.audio.currentTime = this.lastCurrentTime;
			}

			// Different source, the old reference offset no longer applies.
			this.resetMediaSync();
		} else if (rateChanged) {
			this.markMediaSyncDisturbed();
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
		if (this.songStartTime === undefined) return queryParamTime !== undefined ? queryParamTime : 0;

		let lastCurrentTime = this.lastCurrentTime;
		let currentTime = this.context.currentTime;

		const nowSeconds = performance.now() / 1000;
		const frameDelta = this.lastFrameNow != null ? Math.max(0, nowSeconds - this.lastFrameNow) : 0;

		if (this.source && this.source.context.state === 'running' && this.lastContextTime && currentTime - this.lastContextTime < 1e-6) {
			currentTime = this.lastContextTime + frameDelta;
		}

		var newCurrent;
		if (lastCurrentTime) {
			newCurrent = lastCurrentTime + (currentTime - this.lastContextTime) * this.speed;
		} else {
			newCurrent = (currentTime - this.songStartTime) * this.speed;
		}

		newCurrent = this.updateMediaSync(newCurrent, lastCurrentTime || 0, nowSeconds);

		this.lastCurrentTime = newCurrent;
		this.lastContextTime = currentTime;
		this.lastFrameNow = nowSeconds;

		return Math.max(0, newCurrent + parseFloat(this.settings.settings.soundDelay));
	},

	resetMediaSync: function () {
		// changedAt also delays the first steady samples, so start/seek transients don't end up in the reference.
		this.mediaSync = {phase: 'steady', samples: [], ref: null, lastSampleAt: 0, changedAt: performance.now() / 1000, remaining: 0};
	},

	usesMediaClock: function () {
		return !!(this.source && this.source === this.mediaSource && this.audio);
	},

	// The <audio> element may lose or gain media time (playback rate change, resume).
	// Keep the offset measured before the disturbance and re-measure once playback settles.
	markMediaSyncDisturbed: function () {
		if (!this.mediaSync || !this.usesMediaClock()) {
			this.resetMediaSync();
			return;
		}
		const ms = this.mediaSync;
		// Without a reference yet (just started or seeked) there is nothing to restore, keep warming up.
		ms.phase = ms.ref === null ? 'steady' : 'settling';
		ms.changedAt = performance.now() / 1000;
		ms.samples = [];
		ms.remaining = 0;
	},

	// Called from getCurrentTime with the freshly integrated song time, returns the corrected one.
	updateMediaSync: function (current, previous, now) {
		const ms = this.mediaSync;
		if (!ms || !this.isPlaying || !this.usesMediaClock() || this.audio.paused || this.context.state !== 'running') {
			return current;
		}

		if (ms.phase === 'slewing') {
			// Absorb the correction while the song moves forward, so time never jumps or goes backwards.
			const advanced = current - previous;
			if (advanced > 0) {
				const slew = Math.abs(ms.remaining) > MEDIA_SYNC_FAST_SLEW_FROM ? MEDIA_SYNC_FAST_SLEW : MEDIA_SYNC_SLEW;
				const step = Math.min(Math.abs(ms.remaining), advanced * slew);
				const signedStep = ms.remaining > 0 ? step : -step;
				current -= signedStep;
				ms.remaining -= signedStep;
			}
			if (Math.abs(ms.remaining) < 1e-5) {
				ms.phase = 'steady';
				ms.samples = [];
				ms.remaining = 0;
			}
			return current;
		}

		if (now - ms.lastSampleAt < MEDIA_SYNC_SAMPLE_INTERVAL) return current;
		if (now - ms.changedAt < MEDIA_SYNC_SETTLE_TIME) return current;
		if (ms.phase === 'settling') ms.phase = 'measuring';

		ms.lastSampleAt = now;
		ms.samples.push(current - this.audio.currentTime);

		if (ms.phase === 'steady') {
			if (ms.samples.length > MEDIA_SYNC_REF_SAMPLES) ms.samples.shift();
			if (ms.samples.length >= 3) ms.ref = median(ms.samples);
		} else if (ms.samples.length >= MEDIA_SYNC_MEASURE_SAMPLES) {
			const correction = median(ms.samples) - ms.ref;
			ms.samples = [];
			if (Math.abs(correction) >= MEDIA_SYNC_MIN_CORRECTION) {
				ms.phase = 'slewing';
				ms.remaining = correction;
			} else {
				ms.phase = 'steady';
			}
		}
		return current;
	},
});
