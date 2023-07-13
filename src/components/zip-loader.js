const utils = require('../utils');
const dragDrop = require('drag-drop');
import JSZip from 'jszip';
import {Mirror_Inverse, Mirror_Horizontal, Mirror_Vertical} from '../chirality-support';
import {postprocess, processNoodle} from '../utils/mapPostprocessor';

AFRAME.registerComponent('zip-loader', {
	schema: {
		id: {default: AFRAME.utils.getUrlParameter('id')},
		hash: {default: AFRAME.utils.getUrlParameter('hash')},
		mapLink: {default: AFRAME.utils.getUrlParameter('mapLink')},
		difficulty: {default: AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus'},
		mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'},
	},

	init: function () {
		this.fetchedZip = '';
		this.fetched = false;

		let fetchCallback = e => {
			if (!this.fetched) {
				this.fetched = true;
				this.leaderboardId = e.detail.leaderboardId;
				this.data.difficulty = this.difficultyFromId(e.detail.difficulty);
				this.data.mode = e.detail.mode;
				if (this.data.mapLink) {
					this.fetchZip(this.data.mapLink.replace('https://cdn.discordapp.com/', '/cors/discord-cdn/'));
				} else {
					this.fetchData(e.detail.hash.replace('custom_level_', ''), true);
				}
			}
		};

		if (!this.data.id && !this.data.hash) {
			this.el.sceneEl.addEventListener('replayInfofetched', fetchCallback);
			this.el.sceneEl.addEventListener('replayfetched', fetchCallback);
		}
	},

	update: function (oldData) {
		this.el.sceneEl.emit('cleargame', null, false);
		if (this.fetched) return;
		if (this.data.id && !this.data.hash) {
			if (oldData.id !== this.data.id) {
				this.fetchData(this.data.id);
			}
		} else if (this.data.hash && !this.data.id) {
			if (oldData.hash !== this.data.hash) {
				this.fetchData(this.data.hash, true);
			}
		}
	},

	play: function () {
		this.loadingIndicator = document.getElementById('challengeLoadingIndicator');
	},

	processFiles: async function (files, info) {
		const event = {
			audio: '',
			beatmaps: {Standard: {}},
			beatSpeeds: {Standard: {}},
			beatOffsets: {Standard: {}},
			difficulties: {Standard: []},
			customData: {Standard: []},
			id: this.data.id,
			image: '',
			info,
			mappingExtensions: {isEnabled: false},
		};

		// See whether we need mapping extensions (per difficulty).
		const customData = event.info._customData;
		if (
			customData &&
			customData._editorSettings &&
			customData._editorSettings.modSettings &&
			customData._editorSettings.modSettings.mappingExtensions &&
			customData._editorSettings.modSettings.mappingExtensions.isEnabled
		) {
			event.mappingExtensions = event.info._customData._editorSettings.modSettings.mappingExtensions;
		}

		// Index beatmaps (modes + difficulties).
		const beatmapSets = event.info._difficultyBeatmapSets;
		for (let index = 0; index < beatmapSets.length; index++) {
			const set = beatmapSets[index];
			const mode = set._beatmapCharacteristicName;
			event.beatmaps[mode] = {};
			event.beatSpeeds[mode] = {};
			event.beatOffsets[mode] = {};
			event.customData[mode] = {};

			const diffBeatmaps = set._difficultyBeatmaps.sort(d => d._difficultyRank);
			for (let index = 0; index < diffBeatmaps.length; index++) {
				const diff = diffBeatmaps[index];
				const fileArray = await files[diff._beatmapFilename].async('uint8array');

				var mapJson;
				try {
					var fileData = new TextDecoder().decode(fileArray);
					mapJson = JSON.parse(fileData);
				} catch (e) {
					var fileData = new TextDecoder('UTF-16LE').decode(fileArray);
					mapJson = JSON.parse(fileData);
				}
				let map = postprocess(mapJson, event.info);
				event.beatmaps[mode][diff._difficulty] = map;
				event.beatSpeeds[mode][diff._difficulty] = diff._noteJumpMovementSpeed;
				event.beatOffsets[mode][diff._difficulty] = diff._noteJumpStartBeatOffset;
				event.customData[mode][diff._difficulty] = diff._customData;

				// TODO: Assume for now if one difficulty wants extensions, they all do. Fix later.
				if (
					diff._customData &&
					diff._customData._requirements &&
					(diff._customData._requirements.indexOf('Mapping Extensions') !== -1 ||
						diff._customData._requirements.indexOf('Noodle Extensions') !== -1)
				) {
					event.mappingExtensions = {isEnabled: true};
					map = processNoodle(map);
				}
			}

			// Get difficulties.
			event.difficulties[mode] = diffBeatmaps;
		}

		if (!event.beatmaps[this.data.mode]) {
			generateMode(event, this.data.difficulty, this.data.mode);
		}

		// Default to hardest of first beatmap.
		if (!event.difficulty) {
			event.difficulty = this.data.difficulty || event.difficulties[this.data.mode][0]._difficulty;
		}
		event.mode = this.data.mode;

		let extractAsBlobUrl = async (name, type) => {
			return URL.createObjectURL(new Blob([await files[name].async('arraybuffer')], {type}));
		};

		let keys = Object.keys(files);
		for (let index = 0; index < keys.length; index++) {
			const filename = keys[index];
			if (!event.audio) {
				if (filename.endsWith('egg') || filename.endsWith('ogg')) {
					event.audio = await extractAsBlobUrl(filename, 'audio/ogg');
				}
				if (filename.endsWith('wav')) {
					event.audio = await extractAsBlobUrl(filename, 'audio/wav');
				}
				if (filename.endsWith('mp3')) {
					event.audio = await extractAsBlobUrl(filename, 'audio/mp3');
				}
			}
			if (!event.image) {
				if (filename.endsWith('jpg') || filename.endsWith('jpeg')) {
					event.image = await extractAsBlobUrl(filename, 'image/jpeg');
				}
				if (filename.endsWith('png')) {
					event.image = await extractAsBlobUrl(filename, 'image/png');
				}
			}
		}

		this.isFetching = '';
		console.log(event);
		this.el.emit('challengeloadend', event, false);
	},

	processInfo: function (files) {
		let captureSelf = this;
		var processed = false;
		Object.keys(files).forEach(filename => {
			if (filename.toLowerCase().endsWith('info.dat')) {
				processed = true;
				files[filename].async('string').then(function (fileData) {
					captureSelf.processFiles(files, jsonParseClean(fileData));
				});
			}
		});

		if (!processed) {
			this.postchallengeloaderror(this.data.hash);
		}
	},

	postchallengeloaderror: function (hash) {
		const gestureListener = e => {
			if (this.fetching) {
				return;
			}
			var input = document.createElement('input');
			input.type = 'file';
			input.accept = '.zip';
			input.webkitdirectory = '';
			input.directory = '';

			input.onchange = e => {
				if (e.target.files[0].name.includes('.zip')) {
					this.el.removeEventListener('usergesturereceive', gestureListener);
					this.cleanup && this.cleanup();
					this.el.emit('challengeloadstart', this.data.id, false);
					JSZip.loadAsync(e.target.files[0]).then(zip => {
						this.fetchedZip = this.data.id;
						this.processInfo(zip.files);
					});
				}
			};

			input.click();
		};
		this.el.sceneEl.addEventListener('usergesturereceive', gestureListener);
		this.cleanup = dragDrop('#body', files => {
			this.el.removeEventListener('usergesturereceive', gestureListener);
			this.cleanup && this.cleanup();
			this.el.emit('challengeloadstart', this.data.id, false);
			JSZip.loadAsync(files[0]).then(zip => {
				this.fetchedZip = this.data.id;
				this.processInfo(zip.files);
			});
		});

		this.el.emit('challengeloaderror', {hash});
	},

	/**
	 * Read API first to get hash and URLs.
	 */
	fetchData: function (id, byHash) {
		this.fetched = true;
		document.cookie = 'aprilFools=1; expires=Sat, 03 Apr 2022 00:00:00 UTC; path=/';
		return fetch(`/cors/beat-saver2/api/maps/${byHash ? 'hash' : 'id'}/${id}`).then(res => {
			res.json().then(data => {
				if (data.versions) {
					const currentVersion = data.versions[0];
					const desiredHash = byHash ? id : currentVersion.hash;

					let callback = (hash, cover, zipUrl, fallbackUrls) => {
						data.image = cover;
						data.hash = hash;
						data.leaderboardId = this.leaderboardId;
						this.data.hash = hash;

						this.el.sceneEl.emit('songFetched', data);

						this.fetchZip(zipUrl, fallbackUrls);
					};
					if (desiredHash.toLowerCase() == currentVersion.hash.toLowerCase()) {
						callback(currentVersion.hash, currentVersion.coverURL, currentVersion.downloadURL);
					} else {
						let urls = ['r2cdn', 'cdn'].map(prefix => 'https://' + prefix + '.beatsaver.com/' + desiredHash.toLowerCase() + '.zip');
						callback(desiredHash, currentVersion.coverURL, urls[0], [urls[1], currentVersion.downloadURL]);
					}
				} else {
					this.postchallengeloaderror(id);
				}
			});
		});
	},

	fetchZip: function (zipUrl, fallbackUrls) {
		// Already fetching.
		if (this.isFetching === zipUrl || (this.data.id && this.fetchedZip & (this.fetchedZip === this.data.id))) {
			return;
		}

		this.el.emit('challengeloadstart', this.data.id, false);
		this.isFetching = zipUrl;

		const xhr = new XMLHttpRequest();
		xhr.open('GET', zipUrl, true);
		xhr.responseType = 'arraybuffer';

		xhr.onprogress = e => {
			this.loadingIndicator.object3D.visible = true;
			this.loadingIndicator.setAttribute('material', 'progress', e.loaded / e.total);
		};

		var errorHandler = () => {
			if (fallbackUrls && fallbackUrls.length) {
				this.fetchZip(fallbackUrls.pop(), fallbackUrls);
			} else {
				this.postchallengeloaderror(this.data.hash);
				this.isFetching = '';
			}
		};

		xhr.onload = () => {
			if (xhr.status == 200) {
				JSZip.loadAsync(xhr.response).then(zip => {
					this.fetchedZip = this.data.id;
					this.processInfo(zip.files);
				});
			} else {
				errorHandler();
			}
		};

		xhr.onerror = event => {
			errorHandler();
		};

		xhr.send();
	},

	difficultyFromId: function (diffId) {
		switch (diffId) {
			case 1:
				return 'Easy';
			case 3:
				return 'Normal';
			case 5:
				return 'Hard';
			case 7:
				return 'Expert';
			case 9:
				return 'ExpertPlus';
		}
	},
});

/**
 * Beatsaver JSON sometimes have weird characters in front of JSON in utf16le encoding.
 */
function jsonParseClean(str) {
	try {
		str = str.trim();
		str = str.replace(/\u0000/g, '').replace(/\u\d\d\d\d/g, '');
		str = str.replace('\b', ' ');
		if (str[0] !== '{') {
			str = str.substring(str.indexOf('{'), str.length);
		}

		// Remove Unicode escape sequences.
		// stringified = stringified.replace(/\\u..../g, ' ');
		return jsonParseLoop(str, 0);
	} catch (e) {
		// Should not reach here.
		console.log(e, str);
		return null;
	}
}

const errorRe1 = /column (\d+)/m;
const errorRe2 = /position (\d+)/m;

function jsonParseLoop(str, i) {
	try {
		return JSON.parse(str);
	} catch (e) {
		let match = e.toString().match(errorRe1);
		if (!match) {
			match = e.toString().match(errorRe2);
		}
		if (!match) {
			throw e;
		}
		const errorPos = parseInt(match[1]);
		str = str.replace(str[errorPos], 'x');
		str = str.replace(str[errorPos + 1], 'x');
		str = str.replace(str[errorPos + 2], 'x');
		return jsonParseLoop(str, i + 1);
	}
}

function generateMode(event, difficulty, mode) {
	if (mode.includes('Standard')) {
		event.beatmaps[mode] = {};
		event.beatSpeeds[mode] = {};
		event.beatOffsets[mode] = {};

		event.beatmaps[mode][difficulty] = event.beatmaps['Standard'][difficulty];
		event.beatSpeeds[mode][difficulty] = event.beatSpeeds['Standard'][difficulty];
		event.beatOffsets[mode][difficulty] = event.beatOffsets['Standard'][difficulty];
		event.difficulties[mode] = event.difficulties['Standard'];
		event.customData[mode] = event.customData['Standard'];

		switch (mode) {
			case 'VerticalStandard':
				Mirror_Vertical(event.beatmaps[mode][difficulty], false, false);
				break;
			case 'HorizontalStandard':
				Mirror_Horizontal(event.beatmaps[mode][difficulty], 4, false, false);
				break;
			case 'InverseStandard':
				Mirror_Inverse(event.beatmaps[mode][difficulty], 4, true, true, false);
				break;
			case 'InvertedStandard':
				Mirror_Inverse(event.beatmaps[mode][difficulty], 4, false, false, false);
				break;

			default:
				break;
		}
	}
}
