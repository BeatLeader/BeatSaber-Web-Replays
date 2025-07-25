const utils = require('../utils');
const dragDrop = require('drag-drop');
import JSZip from 'jszip';
import {postprocess, processNoodle} from '../utils/mapPostprocessor';

const chiralityModes = ['VerticalStandard', 'HorizontalStandard', 'InverseStandard', 'InvertedStandard'];

AFRAME.registerComponent('zip-loader', {
	schema: {
		id: {default: utils.getUrlParameter('id')},
		hash: {default: utils.getUrlParameter('hash')},
		mapLink: {default: utils.getUrlParameter('mapLink')},
		difficulty: {default: utils.getUrlParameter('difficulty') || 'ExpertPlus'},
		mode: {default: utils.getUrlParameter('mode') || 'Standard'},
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
					this.fetchZip(this.data.mapLink.replace('https://cdn.discordapp.com/attachments/', 'https://discord.beatleader.pro/'));
				} else if (e.detail.hash.length >= 40) {
					this.fetchData(e.detail.hash.replace('custom_level_', '').substring(0, 40).toLowerCase(), true);
				} else {
					this.el.sceneEl.emit('songFetched', {leaderboardId: this.leaderboardId, metadata: e.detail.metadata});
					this.fetchZip(`https://cdn.songs.beatleader.xyz/${e.detail.hash}.zip`);
				}
			}
		};

		this.el.sceneEl.addEventListener('replayloadstart', () => {
			this.fetchedZip = '';
			this.fetched = false;
		});

		if (!this.data.id && !this.data.hash) {
			this.el.sceneEl.addEventListener('replayInfofetched', fetchCallback);
			this.el.sceneEl.addEventListener('replayfetched', fetchCallback);
		}
	},

	update: function (oldData) {
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

		if (info._audioDataFile) {
			const fileArray = await files[Object.keys(files).find(f => f.toLowerCase() == info._audioDataFile.toLowerCase())].async('uint8array');
			var audioDataJson;
			try {
				var fileData = new TextDecoder().decode(fileArray);
				audioDataJson = JSON.parse(fileData);
			} catch (e) {
				var fileData = new TextDecoder('UTF-16LE').decode(fileArray);
				audioDataJson = JSON.parse(fileData);
			}
			info.audioData = audioDataJson;
		}

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

		if (!event.info._difficultyBeatmapSets) return;

		// Index beatmaps (modes + difficulties).
		const beatmapSets = event.info._difficultyBeatmapSets.reduce((acc, curr) => {
			const existing = acc.find(x => x._beatmapCharacteristicName === curr._beatmapCharacteristicName);
			if (!existing || curr._difficultyBeatmaps.length > existing._difficultyBeatmaps.length) {
				const filtered = acc.filter(x => x._beatmapCharacteristicName !== curr._beatmapCharacteristicName);
				return [...filtered, curr];
			}
			return acc;
		}, []);

		try {
			for (let index = 0; index < beatmapSets.length; index++) {
				const set = beatmapSets[index];
				var mode = set._beatmapCharacteristicName;

				if (mode == 'Standard' && this.data.mode && chiralityModes.includes(this.data.mode)) {
					mode = this.data.mode;
				}

				event.beatmaps[mode] = {};
				event.beatSpeeds[mode] = {};
				event.beatOffsets[mode] = {};
				event.customData[mode] = {};

				const diffBeatmaps = set._difficultyBeatmaps.sort(d => d._difficultyRank);
				for (let index = 0; index < diffBeatmaps.length; index++) {
					const diff = diffBeatmaps[index];
					const fileArray = await files[Object.keys(files).find(f => f.toLowerCase() == diff._beatmapFilename.toLowerCase())].async(
						'uint8array'
					);

					var mapJson;
					try {
						var fileData = new TextDecoder().decode(fileArray);
						mapJson = JSON.parse(fileData);
					} catch (e) {
						var fileData = new TextDecoder('UTF-16LE').decode(fileArray);
						mapJson = JSON.parse(fileData);
					}
					mapJson.info = event.info;
					mapJson.audioData = info.audioData;
					let map = postprocess(mapJson, mode);
					event.beatmaps[mode][diff._difficulty] = map;
					event.beatSpeeds[mode][diff._difficulty] = diff._noteJumpMovementSpeed;
					event.beatOffsets[mode][diff._difficulty] = diff._noteJumpStartBeatOffset;
					event.customData[mode][diff._difficulty] = diff._customData;

					// TODO: Assume for now if one difficulty wants extensions, they all do. Fix later.
					if (diff._customData && diff._customData._requirements && diff._customData._requirements.indexOf('Mapping Extensions') !== -1) {
						event.mappingExtensions = {isEnabled: true};
					}

					if (diff._customData && diff._customData._requirements && diff._customData._requirements.indexOf('Noodle Extensions') !== -1) {
						map = processNoodle(map);
					}
				}

				// Get difficulties.
				event.difficulties[mode] = diffBeatmaps;
			}
		} catch (e) {
			this.postchallengeloaderror(this.data.hash);
			return;
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
					let info = jsonParseClean(fileData);

					if (info.version && info.version.startsWith('4')) {
						let v2Info = {
							_version: '2.1.0',
							_songName: info.song.title,
							_songSubName: info.song.subTitle || '',
							_songAuthorName: info.song.author,
							_levelAuthorName: info.difficultyBeatmaps[0].beatmapAuthors.mappers[0],
							_beatsPerMinute: info.audio.bpm,
							_audioDataFile: info.audio.audioDataFilename,
							_songTimeOffset: 0,
							_shuffle: 0,
							_shufflePeriod: 0,
							_previewStartTime: info.audio.previewStartTime,
							_previewDuration: info.audio.previewDuration,
							_songFilename: info.audio.songFilename,
							_coverImageFilename: info.coverImageFilename,
							_environmentName: info.environmentNames[0],
							_allDirectionsEnvironmentName: info.environmentNames[1],
							_environmentNames: info.environmentNames,
							_colorSchemes: info.colorSchemes,
							_difficultyBeatmapSets: info.difficultyBeatmaps.reduce((sets, diff) => {
								const characteristic = diff.characteristic || 'Standard';
								const existingSet = sets.find(set => set._beatmapCharacteristicName === characteristic);

								const beatmap = {
									_difficulty: diff.difficulty,
									_difficultyRank:
										diff.difficulty === 'Easy'
											? 1
											: diff.difficulty === 'Normal'
											? 3
											: diff.difficulty === 'Hard'
											? 5
											: diff.difficulty === 'Expert'
											? 7
											: diff.difficulty === 'ExpertPlus'
											? 9
											: 1,
									_beatmapFilename: diff.beatmapDataFilename,
									_noteJumpMovementSpeed: diff.noteJumpMovementSpeed,
									_noteJumpStartBeatOffset: diff.noteJumpStartBeatOffset,
									_beatmapColorSchemeIdx: diff.beatmapColorSchemeIdx,
									_environmentNameIdx: diff.environmentNameIdx,
								};

								if (existingSet) {
									existingSet._difficultyBeatmaps.push(beatmap);
								} else {
									sets.push({
										_beatmapCharacteristicName: characteristic,
										_difficultyBeatmaps: [beatmap],
									});
								}
								return sets;
							}, []),
						};
						captureSelf.processFiles(files, v2Info);
					} else {
						captureSelf.processFiles(files, info);
					}
				});
			}
		});

		if (!processed) {
			this.postchallengeloaderror(this.data.hash);
		}
	},

	postchallengeloaderror: function (hash) {
		if (utils.getCookie('autoplayReplay')) {
			this.el.sceneEl.components['random-replay'].fetchRandomReplay(true);
		}

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
		return fetch(`/cors/beat-saver2/api/maps/${byHash ? 'hash' : 'id'}/${id}`, {
			signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : null,
		})
			.then(res => {
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
			})
			.catch(_ => {
				let urls = ['r2cdn', 'cdn'].map(prefix => 'https://' + prefix + '.beatsaver.com/' + id.toLowerCase() + '.zip');
				this.fetchZip(urls[0], [urls[1]]);
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
				this.fetchZip(fallbackUrls.shift(), fallbackUrls);
			} else {
				this.postchallengeloaderror(this.data.hash);
				this.isFetching = '';
			}
		};

		xhr.onload = () => {
			if (xhr.status == 200) {
				JSZip.loadAsync(xhr.response).then(zip => {
					this.fetchedZip = this.data.id;
					this.fetchedZipUrl = zipUrl;
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
	var modeNames = Object.keys(event.beatmaps);
	for (let i = 0; i < modeNames.length; i++) {
		const defaultMode = modeNames[i];
		if (mode.toLowerCase().includes(defaultMode.toLowerCase())) {
			event.beatmaps[mode] = {};
			event.beatSpeeds[mode] = {};
			event.beatOffsets[mode] = {};

			event.beatmaps[mode][difficulty] = event.beatmaps[defaultMode][difficulty];
			event.beatSpeeds[mode][difficulty] = event.beatSpeeds[defaultMode][difficulty];
			event.beatOffsets[mode][difficulty] = event.beatOffsets[defaultMode][difficulty];
			event.difficulties[mode] = event.difficulties[defaultMode];
			event.customData[mode] = event.customData[defaultMode];

			break;
		}
	}
}
