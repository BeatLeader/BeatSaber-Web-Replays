const utils = require('../utils');
var {queryParams} = require('../query-params');

const GAME_OVER_LENGTH = 3.5;
const ONCE = {once: true};
const BASE_VOLUME = 0.35;
const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

const MEDIA_SYNC_SETTLE = 0.3; // s, <audio> position is unreliable this long after a (re)start or rate change
const MEDIA_SYNC_WINDOW = 0.5; // s of song time to average over, Firefox moves <audio> currentTime in ~40 ms steps
const MEDIA_SYNC_TOLERANCE = 0.005;
const MEDIA_SYNC_SLEW = 0.25; // max share of song progress used to absorb a correction

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
		this.audio = document.createElement('audio');
		this.audio.volume = utils.isFirefox() ? 0.0001 : 0; // Firefox really does not like zeros
		this.settings = this.el.sceneEl.components.settings;

		this.audioAnalyser.gainNode.gain.value = this.settings.settings.volume || BASE_VOLUME;
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
				this.source = evt.detail.source;
				this.mediaSource = evt.detail.mediaSource;
				this.duration = evt.detail.duration;
				if (evt.detail.audio) {
					this.audio = evt.detail.audio;
				}
				if (isSafari) {
					this.setSilence();
				}
				resolve(this.source);
			};
			data.analyserEl.addEventListener('audioanalysersource', this.audioSourceListener, ONCE);
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
				this.source = evt.detail.source;
				this.mediaSource = evt.detail.mediaSource;
				this.duration = evt.detail.duration;
				if (isSafari) {
					this.setSilence();
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
		this.resetMediaSync();

		const gain = this.audioAnalyser.gainNode.gain;
		gain.cancelScheduledValues(0);
		gain.value = this.settings.settings.volume;
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

		newCurrent = this.syncToMedia(newCurrent, newCurrent - (lastCurrentTime || 0), nowSeconds);

		this.lastCurrentTime = newCurrent;
		this.lastContextTime = currentTime;
		this.lastFrameNow = nowSeconds;

		return Math.max(0, newCurrent + parseFloat(this.settings.settings.soundDelay));
	},

	resetMediaSync: function () {
		this.mediaSync = {ref: null, pending: 0};
		this.holdMediaSync();
	},

	holdMediaSync: function () {
		this.mediaSync.sum = this.mediaSync.count = 0;
		this.mediaSync.settleAt = performance.now() / 1000 + MEDIA_SYNC_SETTLE;
	},

	// The <audio> element loses a bit of position on playbackRate changes and resumes, while song time
	// follows the AudioContext clock. Keep their offset at what it was after start, slewing corrections in.
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
		if (sync.ref === null) sync.ref = offset;
		else if (Math.abs(offset - sync.ref) > MEDIA_SYNC_TOLERANCE) sync.pending += offset - sync.ref;
		return current;
	},
});
