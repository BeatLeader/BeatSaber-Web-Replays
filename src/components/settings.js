const defaultHitSound = require('../../assets/sounds/defaulthitsound.js');

AFRAME.registerComponent('settings', {
	schema: {},

	init: function () {
		this.settings = {
			showHeadset: true,
			reducedDebris: true,
			noEffects: false,
			showHitboxes: false,
			pixelRatio: 1,
			saberWidth: 100,
			showFps: false,
			showNoteModifierVisuals: true,
			savedCameraDefault: false,
			highlightErrors: false,
			colorScores: true,
			realHitsounds: false,
			trailType: 'bright',
			trailLength: 20,
			disableJumps: false,

			timeInBeats: false,

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

			// Volume
			volume: 0.3,
			hitSoundVolume: 0.3,
			volumeMixed: false,

			// HitSound
			hitsoundName: '',
			hitSound: defaultHitSound,
		};

		this.units = {
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
					label.innerHTML = this.settings[key] + (this.units[key] ? this.units[key] : '');
					localStorage.setItem('settings', JSON.stringify(this.settings));
					this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);
				});
				toggle.value = this.settings[key];
				label.innerHTML = this.settings[key] + (this.units[key] ? this.units[key] : '');
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
});
