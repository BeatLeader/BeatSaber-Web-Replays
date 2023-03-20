const utils = require('../utils');

const GAME_OVER_LENGTH = 3.5;
const ONCE = {once: true};
const BASE_VOLUME = 0.35;

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

let queryParamTime = AFRAME.utils.getUrlParameter('time').trim();
if (!queryParamTime || isNaN(queryParamTime)) {
	queryParamTime = 0;
} else {
	queryParamTime = parseFloat(queryParamTime) / 1000;
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
		this.hitSound = this.el.components['beat-hit-sound'];

		this.audioAnalyser.gainNode.gain.value = this.el.sceneEl.components.settings.settings.volume || BASE_VOLUME;

		this.el.addEventListener('gamemenurestart', this.onRestart.bind(this));
		this.el.addEventListener('wallhitstart', this.onWallHitStart.bind(this));
		this.el.addEventListener('wallhitend', this.onWallHitEnd.bind(this));

		const gestureListener = () => {
			this.hasReceivedUserGesture = true;

			this.audioAnalyser.suspendContext();
			this.audioAnalyser.resumeContext();

			this.hitSound.suspendContext();
			this.hitSound.resumeContext();

			if (this.data.isPaused && this.data.isBeatsPreloaded) {
				this.startAudio();
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
			this.isPlaying = true;
		}

		// New challenge, load audio and play when ready.
		if (oldData.audio !== data.audio && data.audio) {
			this.el.sceneEl.emit('songprocessingstart', null, false);
			this.getAudio()
				.then(source => {
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
			this.startAudio();
			if (data.isPaused) {
				this.audioAnalyser.suspendContext();
				this.isPlaying = false;
			}
		}

		// Pause / stop.
		if (!oldData.isPaused && data.isPaused) {
			this.audioAnalyser.suspendContext();
			this.isPlaying = false;
		}
	},

	pause: function () {
		if (this.data.isPlaying) {
			this.audioAnalyser.suspendContext();
		}
	},

	play: function () {
		if (this.data.isPlaying) {
			this.audioAnalyser.resumeContext();
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

	startAudio: function (time) {
		this.isPlaying = true;
		const playTime = time || skipDebug || 0;
		this.songStartTime = (this.context.currentTime * this.speed - playTime) / (this.speed > 0.01 ? this.speed : 0.01);
		this.source.start(0, playTime);
		this.el.emit('songstartaudio');
		this.lastCurrentTime = this.speed > 0.01 ? 0 : time;

		this.source.playbackRate.value = this.speed;
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
