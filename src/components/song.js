const utils = require('../utils');
var {queryParamTime} = require('../query-params');

const GAME_OVER_LENGTH = 3.5;
const ONCE = {once: true};
const BASE_VOLUME = 0.35;
const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

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
		mode: {default: 'Standard'},
	},

	init: function () {
		this.analyserSetter = {buffer: true};
		this.audioAnalyser = this.data.analyserEl.components.audioanalyser;
		this.context = this.audioAnalyser.context;
		this.isPlaying = false;
		this.songLoadingIndicator = document.getElementById('songLoadingIndicator');
		this.speed = songSpeed;
		this.hasReceivedUserGesture = false;
		this.audio = document.createElement('audio');
		this.audio.volume = utils.isFirefox() ? 0.0001 : 0; // Firefox really does not like zeros

		this.audioAnalyser.gainNode.gain.value = this.el.sceneEl.components.settings.settings.volume || BASE_VOLUME;

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

	update: function (oldData) {
		const data = this.data;

		if (!this.el.sceneEl.isPlaying) {
			return;
		}

		// Resume.
		if (oldData.isPaused && !data.isPaused) {
			this.audioAnalyser.resumeContext();
			this.playMediaSession();
			this.isPlaying = true;
		}

		// New challenge, load audio and play when ready.
		if (oldData.audio !== data.audio && data.audio) {
			this.el.sceneEl.emit('songprocessingstart', null, false);
			this.getAudio()
				.then(source => {
					this.el.sceneEl.emit('songprocessingfinish', null, false);
					if (this.data.isPlaying && this.data.isBeatsPreloaded) {
						this.startAudio(queryParamTime);
					}
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
			this.startAudio();
			if (data.isPaused) {
				this.audioAnalyser.suspendContext();
				this.audio.pause();
				this.isPlaying = false;
			}
		}

		// Pause / stop.
		if (!oldData.isPaused && data.isPaused) {
			this.audioAnalyser.suspendContext();
			this.audio.pause();
			this.isPlaying = false;
		}
	},

	pause: function () {
		if (this.data.isPlaying) {
			this.audioAnalyser.suspendContext();
			this.audio.pause();
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
				'audioanalyserbuffersource',
				evt => {
					// Finished decoding.
					this.source = evt.detail;
					if (isSafari) {
						this.audio.src = utils.createSilence(evt.detail.buffer.duration);
					} else {
						this.audio.src = this.audioAnalyser.data.src;
					}
					resolve(this.source);
				},
				ONCE
			);
			this.analyserSetter.src = this.data.audio;
			data.analyserEl.setAttribute('audioanalyser', this.analyserSetter);
		});
	},

	stopAudio: function () {
		if (!this.source) {
			console.warn('[song] Tried to stopAudio, but not playing.');
			return;
		}
		this.source.stop();
		this.source.disconnect();

		this.source = null;
		this.isPlaying = false;
	},

	onRestart: function () {
		this.isPlaying = false;
		this.lastCurrentTime = null;
		this.songStartTime = undefined;

		// Restart, get new buffer source node and play.
		if (this.source) {
			this.source.disconnect();
		}

		// Clear gain interpolation values from game over.
		const gain = this.audioAnalyser.gainNode.gain;
		gain.cancelScheduledValues(0);

		this.el.sceneEl.emit('songprocessingstart', null, false);
		this.data.analyserEl.addEventListener(
			'audioanalyserbuffersource',
			evt => {
				this.source = evt.detail;
				if (isSafari) {
					this.audio.src = utils.createSilence(evt.detail.buffer.duration);
				} else {
					this.audio.src = this.audioAnalyser.data.src;
				}
				this.el.sceneEl.emit('songprocessingfinish', null, false);
				if (this.data.isPlaying) {
					this.startAudio();
				}
			},
			ONCE
		);
		this.audioAnalyser.refreshSource();
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
			
			this.audio.play().then(_ => {
				navigator.mediaSession.metadata = new MediaMetadata({});
				this.metadataAudioLoading = false;

				this.el.emit('songstartaudio');
			});
		}
	},

	startAudio: function (time) {
		this.isPlaying = true;
		const playTime = time || skipDebug || 0;
		this.songStartTime = (this.context.currentTime * this.speed - playTime) / (this.speed > 0.01 ? this.speed : 0.01);
		this.source.start(0, playTime);

		this.lastCurrentTime = this.speed > 0.01 ? 0 : time;

		this.source.playbackRate = this.speed;

		this.audio.currentTime = playTime;

		if (this.speed > 0 && 'mediaSession' in navigator) {
			navigator.mediaSession.setPositionState({
				duration: this.source.buffer.duration,
				playbackRate: this.speed,
				position: playTime,
			});
		}

		this.playMediaSession();
	},

	getCurrentTime: function () {
		if (this.songStartTime === undefined) return queryParamTime;

		let lastCurrentTime = this.lastCurrentTime;
		const currentTime = this.context.currentTime;
		var newCurrent;
		if (lastCurrentTime) {
			newCurrent = lastCurrentTime + (currentTime - this.lastContextTime) * this.speed;
		} else {
			newCurrent = (currentTime - this.songStartTime) * this.speed;
		}

		this.lastCurrentTime = newCurrent;
		this.lastContextTime = currentTime;

		return newCurrent;
	},
});
