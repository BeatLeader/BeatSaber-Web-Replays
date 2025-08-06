const defaultHitSound = require('../../assets/sounds/defaulthitsound.js');
const {getUrlParameter, pageInIframe, DEFAULT_COLORS} = require('../utils.js');

AFRAME.registerComponent('settings', {
	schema: {},

	init: function () {
		this.settings = {
			headsetOpacity: 100,
			reducedDebris: true,
			noEffects: false,
			showHitboxes: false,
			pixelRatio: 1,
			saberWidth: 100,
			showHud: true,
			showFps: false,
			showNoteModifierVisuals: true,
			savedCameraDefault: false,
			highlightErrors: false,
			highlight115s: false,
			colorScores: true,
			realHitsounds: false,
			disableJumps: false,

			timeInBeats: false,

			// Colors
			blueEventColor: DEFAULT_COLORS.blueEventColor,
			blueBrightEventColor: DEFAULT_COLORS.blueBrightEventColor,
			redEventColor: DEFAULT_COLORS.redEventColor,
			redBrightEventColor: DEFAULT_COLORS.redBrightEventColor,
			blueBGColor: DEFAULT_COLORS.blueBGColor,
			blueBrightBGColor: DEFAULT_COLORS.blueBrightBGColor,
			redBGColor: DEFAULT_COLORS.redBGColor,
			redBrightBGColor: DEFAULT_COLORS.redBrightBGColor,
			wallColor: DEFAULT_COLORS.wallColor,
			bombColor: DEFAULT_COLORS.bombColor,
			backgroundColor: DEFAULT_COLORS.backgroundColor,

			// Camera
			cameraZPosition: 1,
			fov: 60,
			forceForwardLookDirection: false,
			cameraXRotation: 0,
			orthographicBackEnabled: document.body.clientWidth > 600,
			orthographicBackFrustum: 1.4,
			orthographicBackFar: 25,
			orthographicRightEnabled: false,
			orthographicRightFrustum: 2,
			orthographicRightFar: 10,
			orthographicTopEnabled: false,
			orthographicTopFrustum: 2.4,
			orthographicTopFar: 10,
			fpvCameraIsOn: false,
			saveFpvToggle: true,

			// Visuals
			showLasers: true,
			showTwister: true,
			showPlatform: true,
			showAudioColumns: true,
			showLight: true,
			showFloor: true,

			// Volume
			volume: 0.3,
			hitSoundVolume: 0.3,
			volumeMixed: false,
			soundDelay: 0,

			// Narkers
			pauseMarkers: true,
			missMarkers: true,
			badCutMarkers: true,
			bombMarkers: true,
			wallMarkers: true,
			failMarkers: true,
			maxStreakMarkers: true,

			// HitSound
			hitsoundName: '',
			hitSound: defaultHitSound,

			// Trails
			trailType: 'bright',
			trailLength: 20,
			goodTdColor: '#00FF00',
			badTdColor: '#FF0000',

			// Playback
			pauseOnUnfocus: false,
			autoplayOnLoad: false,
			loopReplays: false,

			autoplayRandomScore: true,
			randomScoreFromFriends: true,
			randomScoreEmptyPlayer: true,

			// Saber
			showSaberAxes: false,
			saberOffset: 0,

			autoSkipIntro: false,
			autoSkipOutro: false,

			// Extensions (custom data)
			showHeartrate: true,
			showTreecks: true,
		};

		this.units = {
			headsetOpacity: '%',
			saberWidth: '%',
			cameraZPosition: 'm',
			fov: '°',
			cameraXRotation: '°',
		};

		try {
			let storedSettings = JSON.parse(localStorage.getItem('settings'));
			Object.keys(storedSettings).forEach(key => {
				this.settings[key] = storedSettings[key];
			});
		} catch (e) {}

		this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);

		Object.keys(this.settings).forEach(key => {
			let toggle = document.getElementById(key);
			if (!toggle) return; // Someone else handling setting.
			if (toggle.type == 'checkbox') {
				toggle.addEventListener('input', event => {
					this.settings[key] = event.srcElement.checked;
					localStorage.setItem('settings', JSON.stringify(this.settings));
					this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);
				});
				toggle.checked = this.settings[key];
			} else if (toggle.type == 'range') {
				let label = document.getElementById(key + 'Label');
				toggle.addEventListener('input', event => {
					this.settings[key] = event.srcElement.value;
					label.textContent = this.settings[key] + (this.units[key] ? this.units[key] : '');
					localStorage.setItem('settings', JSON.stringify(this.settings));
					this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);
				});
				toggle.value = this.settings[key];
				label.textContent = this.settings[key] + (this.units[key] ? this.units[key] : '');
			} else if (toggle.type == 'select-one') {
				toggle.addEventListener('change', event => {
					this.settings[key] = event.srcElement.value;
					localStorage.setItem('settings', JSON.stringify(this.settings));
					this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);
				});
				toggle.value = this.settings[key];
			}
		});
	},
	sync: function () {
		localStorage.setItem('settings', JSON.stringify(this.settings));
		this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);
	},
	resetHitsound: function () {
		this.settings.hitSound = defaultHitSound;
		this.settings.hitsoundName = '';
		this.sync();
	},

	shouldLoopReplays: function () {
		if (pageInIframe()) {
			const loopQuery = getUrlParameter('loop');
			if (loopQuery == 'true') {
				return true;
			} else if (loopQuery == 'false') {
				return false;
			}
		}
		return this.settings.loopReplays;
	},

	shouldAutoplayOnLoad: function () {
		if (pageInIframe()) {
			const autoplayQuery = getUrlParameter('autoplay');
			if (autoplayQuery == 'true') {
				return true;
			} else if (autoplayQuery == 'false') {
				return false;
			}
		}
		return this.settings.autoplayOnLoad;
	},
});
