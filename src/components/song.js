const utils = require('../utils');
var {queryParamTime} = require('../query-params');

const GAME_OVER_LENGTH = 3.5;
const ONCE = {once: true};
const BASE_VOLUME = 0.35;
const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;
const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
const isMacFirefox = isMac && utils.isFirefox();

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
		isPaused: {default: queryParamTime != 0},
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

			if (this.data.isPaused && this.data.isBeatsPreloaded && this.source) {
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

		this.isBufferSource = isSafari || isMacFirefox || !data.pitchCompensation;

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
			this.startAudio(queryParamTime);
			if (data.isPaused) {
				this.audioAnalyser.suspendContext();
				this.pauseAudio();
				this.isPlaying = false;
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
			this.metadataAudioLoading = true;

			this.playRequest = this.audio.play();
			this.playRequest.then(_ => {
				this.playRequest = null;
				navigator.mediaSession.metadata = new MediaMetadata({});
				this.metadataAudioLoading = false;

				this.el.emit('songstartaudio');
			});
		}
	},

	startAudio: function (time) {
		this.isPlaying = true;
		const playTime = time || skipDebug || 0;

		const duration = this.getDuration();
		const canUseBuffer = duration > 0 ? duration <= 1800 : true;
		if ((this.isBufferSource || this.speed < 0.5) && canUseBuffer) {
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

		this.audio.currentTime = playTime;
		if (this.source && this.source.playbackRate) {
			this.source.playbackRate.value = this.speed;
		}
		if (this.mediaSource && this.mediaSource.playbackRate) {
			this.mediaSource.playbackRate.value = this.speed;
		}
		this.audio.playbackRate = Math.max(this.speed, 0.0001);

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
		this.speed = rate;

		const duration = this.getDuration();
		const canUseBuffer = duration > 0 ? duration <= 1800 : true;
		var newSource = null;
		if ((this.isBufferSource || this.speed < 0.5) && canUseBuffer) {
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
		}

		if (this.source && this.source.playbackRate) {
			this.source.playbackRate.value = rate;
		}
		if (this.mediaSource && this.mediaSource.playbackRate) {
			this.mediaSource.playbackRate.value = rate;
		}
		this.audio.playbackRate = Math.max(rate, 0.5);
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
		if (this.songStartTime === undefined) return queryParamTime;

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

		this.lastCurrentTime = newCurrent;
		this.lastContextTime = currentTime;
		this.lastFrameNow = nowSeconds;

		return Math.max(0, newCurrent + parseFloat(this.settings.settings.soundDelay));
	},
});
