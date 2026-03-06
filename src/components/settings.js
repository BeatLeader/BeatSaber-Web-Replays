const defaultHitSound = require('../../assets/sounds/defaulthitsound.js');
const {getUrlParameter, pageInIframe, DEFAULT_COLORS} = require('../utils.js');
const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;
const CUSTOM_LEVELS_DB_NAME = 'beatleader-web-replays';
const CUSTOM_LEVELS_DB_VERSION = 1;
const CUSTOM_LEVELS_STORE_NAME = 'fileSystemHandles';
const CUSTOM_LEVELS_HANDLE_KEY = 'customLevelsDirectory';

function supportsCustomLevelsLookup() {
	return typeof window.showDirectoryPicker === 'function' && typeof window.indexedDB !== 'undefined';
}

function getDirectoryHandlePath(handle) {
	if (!handle) {
		return '';
	}

	const candidates = [handle.path, handle.fullPath, handle._path];
	for (let index = 0; index < candidates.length; index++) {
		const value = candidates[index];
		if (typeof value === 'string' && value.length) {
			return value;
		}
	}

	return '';
}

function openHandlesDb() {
	return new Promise((resolve, reject) => {
		if (typeof window.indexedDB === 'undefined') {
			resolve(null);
			return;
		}

		const request = window.indexedDB.open(CUSTOM_LEVELS_DB_NAME, CUSTOM_LEVELS_DB_VERSION);
		request.onupgradeneeded = event => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(CUSTOM_LEVELS_STORE_NAME)) {
				db.createObjectStore(CUSTOM_LEVELS_STORE_NAME);
			}
		};
		request.onsuccess = event => resolve(event.target.result);
		request.onerror = () => reject(request.error);
	});
}

async function saveCustomLevelsHandle(handle) {
	const db = await openHandlesDb();
	if (!db) {
		return;
	}

	try {
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(CUSTOM_LEVELS_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(CUSTOM_LEVELS_STORE_NAME);
			if (handle) {
				store.put(handle, CUSTOM_LEVELS_HANDLE_KEY);
			} else {
				store.delete(CUSTOM_LEVELS_HANDLE_KEY);
			}
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

async function loadCustomLevelsHandle() {
	const db = await openHandlesDb();
	if (!db) {
		return null;
	}

	try {
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction(CUSTOM_LEVELS_STORE_NAME, 'readonly');
			const store = transaction.objectStore(CUSTOM_LEVELS_STORE_NAME);
			const request = store.get(CUSTOM_LEVELS_HANDLE_KEY);
			request.onsuccess = () => resolve(request.result || null);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

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
			pitchCompensation: true,
			pitchCompensationTreshold: 0.1,
			customLevelsFolderName: '',
			customLevelsFolderPath: '',

			autoplayRandomScore: true,
			randomScoreSource: 'all',
			randomScoreEmptyPlayer: true,

			// Saber
			showSaberAxes: false,
			saberOffset: 0,

			autoSkipIntro: false,
			autoSkipOutro: false,

			// Extensions (custom data)
			showHeartrate: true,
			showTreecks: true,

			// Misses slow-mode
			autoSpeedControls: false,
			speedSlow: 0.2,
			offsetSlowBeginning: -0.4,
			offsetSlowEnding: 0,

			slowOnMiss: true,
			slowOnBadCut: true,
			slowOnBomb: true,
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

			// Migrate legacy boolean randomScoreFromFriends -> randomScoreSource
			if (!this.settings.randomScoreSource && storedSettings.hasOwnProperty('randomScoreFromFriends')) {
				this.settings.randomScoreSource = storedSettings.randomScoreFromFriends ? 'friends' : 'all';
			}
		} catch (e) {}

		this.customLevelsDirectoryHandle = null;
		this.customLevelsHandleLoadPromise = this.loadCustomLevelsDirectoryHandle();

		this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);

		Object.keys(this.settings).forEach(key => {
			let toggle = document.getElementById(key);
			if (!toggle) return; // Someone else handling setting.
			if (key === 'pitchCompensation' && isSafari) {
				const container = document.getElementById('pitchCompensationContainer');
				if (container) container.style.display = 'none';
				return; // Do not bind hidden control
			}
			if (key === 'pitchCompensationTreshold' && isSafari) {
				const container = document.getElementById('pitchCompensationTresholdContainer');
				if (container) container.style.display = 'none';
				return; // Do not bind hidden control
			}
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

	loadCustomLevelsDirectoryHandle: async function () {
		if (!this.supportsCustomLevelsLookup()) {
			return null;
		}

		try {
			this.customLevelsDirectoryHandle = await loadCustomLevelsHandle();
			const folderName = this.customLevelsDirectoryHandle && this.customLevelsDirectoryHandle.name ? this.customLevelsDirectoryHandle.name : '';
			const folderPath = getDirectoryHandlePath(this.customLevelsDirectoryHandle);
			if (this.settings.customLevelsFolderName !== folderName || this.settings.customLevelsFolderPath !== folderPath) {
				this.settings.customLevelsFolderName = folderName;
				this.settings.customLevelsFolderPath = folderPath;
				localStorage.setItem('settings', JSON.stringify(this.settings));
			}
		} catch (error) {
			console.warn('Could not load saved CustomLevels directory handle', error);
			this.customLevelsDirectoryHandle = null;
		}
		return this.customLevelsDirectoryHandle;
	},

	supportsCustomLevelsLookup: function () {
		return supportsCustomLevelsLookup();
	},

	getCustomLevelsDirectoryHandle: async function (requestPermission = false) {
		if (!this.supportsCustomLevelsLookup()) {
			return null;
		}

		if (this.customLevelsHandleLoadPromise) {
			await this.customLevelsHandleLoadPromise;
			this.customLevelsHandleLoadPromise = null;
		}

		if (!this.customLevelsDirectoryHandle) {
			return null;
		}

		if (!requestPermission) {
			return this.customLevelsDirectoryHandle;
		}

		let permission = 'prompt';
		try {
			permission = await this.customLevelsDirectoryHandle.queryPermission({mode: 'read'});
		} catch (error) {
			return null;
		}

		if (permission !== 'granted') {
			try {
				permission = await this.customLevelsDirectoryHandle.requestPermission({mode: 'read'});
			} catch (error) {
				return null;
			}
		}

		return permission === 'granted' ? this.customLevelsDirectoryHandle : null;
	},

	setCustomLevelsDirectoryHandle: async function (handle) {
		this.customLevelsDirectoryHandle = handle || null;
		this.settings.customLevelsFolderName = handle && handle.name ? handle.name : '';
		this.settings.customLevelsFolderPath = getDirectoryHandlePath(handle);
		this.sync();

		if (!this.supportsCustomLevelsLookup()) {
			return;
		}

		try {
			await saveCustomLevelsHandle(this.customLevelsDirectoryHandle);
		} catch (error) {
			console.warn('Could not save CustomLevels directory handle', error);
		}
	},

	pickCustomLevelsDirectoryHandle: async function () {
		if (!this.supportsCustomLevelsLookup()) {
			return null;
		}

		const handle = await window.showDirectoryPicker();
		await this.setCustomLevelsDirectoryHandle(handle);
		return handle;
	},

	clearCustomLevelsDirectoryHandle: async function () {
		await this.setCustomLevelsDirectoryHandle(null);
	},

	getCustomLevelsFolderDisplayPath: function (handle) {
		const preferredHandle = handle || this.customLevelsDirectoryHandle;
		const fullPath = getDirectoryHandlePath(preferredHandle) || this.settings.customLevelsFolderPath;
		if (fullPath) {
			return fullPath;
		}

		if (preferredHandle && preferredHandle.name) {
			return preferredHandle.name;
		}

		return this.settings.customLevelsFolderName || '';
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
