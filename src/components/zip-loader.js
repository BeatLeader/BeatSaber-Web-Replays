const utils = require('../utils');
const dragDrop = require('drag-drop');
import JSZip from 'jszip';
import {postprocess, processNoodle} from '../utils/mapPostprocessor';

const chiralityModes = ['VerticalStandard', 'HorizontalStandard', 'InverseStandard', 'InvertedStandard'];
const CUSTOM_LEVEL_PREFIX = 'custom_level_';
const INFO_DAT_FILE_NAME = 'info.dat';
const LOCAL_HASH_CACHE_DB_NAME = 'beatleader-web-replays-local-map-cache';
const LOCAL_HASH_CACHE_DB_VERSION = 1;
const LOCAL_HASH_CACHE_STORE_NAME = 'hashCache';

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
		this.localHashCache = {};
		this.lastLocalLookupAttemptHash = '';
		this.currentCustomLevelsRootName = '';
		this.persistentFolderHashCache = {};
		this.persistentHashFolderCache = {};
		this.persistentHashCacheKey = '';
		this.persistentHashCacheLoaded = false;
		this.persistentHashCacheDirty = false;

		let fetchCallback = e => {
			if (!this.fetched) {
				this.fetched = true;
				this.leaderboardId = e.detail.leaderboardId;
				this.data.difficulty = this.difficultyFromId(e.detail.difficulty);
				this.data.mode = e.detail.mode;
				if (this.data.mapLink) {
					this.fetchZip(this.data.mapLink.replace('https://cdn.discordapp.com/attachments/', 'https://discord.beatleader.pro/'));
				} else if (e.detail.hash.length >= 40) {
					this.fetchData(e.detail.hash.replace(CUSTOM_LEVEL_PREFIX, '').substring(0, 40).toLowerCase(), true);
				} else {
					this.el.sceneEl.emit('songFetched', {leaderboardId: this.leaderboardId, metadata: e.detail.metadata});
					this.fetchZip(`https://cdn.songs.beatleader.xyz/${e.detail.hash}.zip`);
				}
			}
		};

		this.el.sceneEl.addEventListener('replayloadstart', () => {
			this.fetchedZip = '';
			this.fetched = false;
			this.lastLocalLookupAttemptHash = '';
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
						mapJson = JSON.parse(fileData.replaceAll('NaN', '0'));
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
				if (utils.getUrlParameter('songLink')) {
					event.audio = utils.getUrlParameter('songLink').replace('https://cdn.discordapp.com/attachments/', 'https://discord.beatleader.pro/');
				} else {
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

	tryLoadFromCustomLevels: async function (hash, options = {}) {
		const requestPermission = options.requestPermission !== undefined ? options.requestPermission : true;
		const targetHash = normalizeReplayHash(hash);
		if (!targetHash) {
			return {loaded: false, attempted: false};
		}

		const settings = this.el.sceneEl.components.settings;
		if (!settings || !settings.supportsCustomLevelsLookup || !settings.supportsCustomLevelsLookup()) {
			return {loaded: false, attempted: false};
		}

		const rootDirectoryHandle = await settings.getCustomLevelsDirectoryHandle(requestPermission);
		if (!rootDirectoryHandle) {
			return {loaded: false, attempted: false};
		}

		if (!requestPermission) {
			let permission = 'prompt';
			try {
				permission = await rootDirectoryHandle.queryPermission({mode: 'read'});
			} catch (error) {
				return {loaded: false, attempted: false};
			}
			if (permission !== 'granted') {
				return {loaded: false, attempted: false};
			}
		}

		if (this.currentCustomLevelsRootName !== rootDirectoryHandle.name) {
			this.localHashCache = {};
			this.currentCustomLevelsRootName = rootDirectoryHandle.name;
		}

		try {
			const files = await this.findMapInCustomLevels(rootDirectoryHandle, targetHash);
			if (!files) {
				return {loaded: false, attempted: true};
			}

			this.fetchedZip = this.data.id;
			this.el.emit('challengeloadstart', this.data.id, false);
			this.fetchedZipUrl = `local-customlevels://${rootDirectoryHandle.name}/${targetHash}`;
			this.processInfo(files);
			return {loaded: true, attempted: true};
		} catch (error) {
			console.warn('Error while scanning CustomLevels directory', error);
			return {loaded: false, attempted: true};
		}
	},

	getPersistentCacheKeyForRoot: function (rootDirectoryHandle) {
		return rootDirectoryHandle && rootDirectoryHandle.name ? rootDirectoryHandle.name.toLowerCase() : '';
	},

	ensurePersistentLocalHashCache: async function (rootDirectoryHandle) {
		const cacheKey = this.getPersistentCacheKeyForRoot(rootDirectoryHandle);
		if (cacheKey && this.persistentHashCacheLoaded && this.persistentHashCacheKey === cacheKey) {
			return;
		}

		this.persistentHashCacheKey = cacheKey;
		this.persistentFolderHashCache = {};
		this.persistentHashFolderCache = {};
		this.persistentHashCacheLoaded = true;
		this.persistentHashCacheDirty = false;

		if (!cacheKey) {
			return;
		}

		try {
			const cached = await readPersistedLocalHashCache(cacheKey);
			if (cached && cached.folderHashes && cached.hashFolders) {
				this.persistentFolderHashCache = cached.folderHashes;
				this.persistentHashFolderCache = cached.hashFolders;
			}
		} catch (error) {
			console.warn('Could not load persisted local hash cache', error);
		}
	},

	setPersistentFolderHash: function (folderName, hash) {
		if (!folderName || !hash) {
			return;
		}

		const normalizedFolder = folderName.toLowerCase();
		const normalizedHash = hash.toLowerCase();
		const previousHash = this.persistentFolderHashCache[normalizedFolder];
		if (previousHash === normalizedHash) {
			return;
		}

		if (previousHash && this.persistentHashFolderCache[previousHash] === normalizedFolder) {
			delete this.persistentHashFolderCache[previousHash];
		}

		this.persistentFolderHashCache[normalizedFolder] = normalizedHash;
		this.persistentHashFolderCache[normalizedHash] = normalizedFolder;
		this.persistentHashCacheDirty = true;
	},

	pruneMissingFoldersFromPersistentCache: function (directoryByName) {
		const cachedFolderNames = Object.keys(this.persistentFolderHashCache);
		for (let index = 0; index < cachedFolderNames.length; index++) {
			const folderName = cachedFolderNames[index];
			if (!directoryByName[folderName]) {
				const hash = this.persistentFolderHashCache[folderName];
				delete this.persistentFolderHashCache[folderName];
				if (hash && this.persistentHashFolderCache[hash] === folderName) {
					delete this.persistentHashFolderCache[hash];
				}
				this.persistentHashCacheDirty = true;
			}
		}
	},

	flushPersistentLocalHashCache: async function () {
		if (!this.persistentHashCacheDirty || !this.persistentHashCacheKey) {
			return;
		}

		this.persistentHashCacheDirty = false;
		try {
			await writePersistedLocalHashCache(this.persistentHashCacheKey, {
				folderHashes: this.persistentFolderHashCache,
				hashFolders: this.persistentHashFolderCache,
			});
		} catch (error) {
			console.warn('Could not persist local hash cache', error);
		}
	},

	findMapInCustomLevels: async function (rootDirectoryHandle, targetHash) {
		if (this.localHashCache[targetHash]) {
			try {
				const cachedDirectoryFiles = await this.collectDirectoryFiles(this.localHashCache[targetHash]);
				return this.buildVirtualFiles(cachedDirectoryFiles);
			} catch (error) {
				delete this.localHashCache[targetHash];
			}
		}

		await this.ensurePersistentLocalHashCache(rootDirectoryHandle);

		const directoryHandles = [];
		const directoryByName = {};
		const directoriesIterator = rootDirectoryHandle.entries();
		while (true) {
			const step = await directoriesIterator.next();
			if (step.done) {
				break;
			}

			const handle = step.value[1];
			if (handle.kind === 'directory') {
				directoryHandles.push(handle);
				directoryByName[handle.name.toLowerCase()] = handle;
			}
		}

		this.pruneMissingFoldersFromPersistentCache(directoryByName);

		const cachedFolderForHash = this.persistentHashFolderCache[targetHash];
		if (cachedFolderForHash && directoryByName[cachedFolderForHash]) {
			const cachedHandle = directoryByName[cachedFolderForHash];
			const cachedDirectoryFiles = await this.collectDirectoryFiles(cachedHandle);
			this.localHashCache[targetHash] = cachedHandle;
			await this.flushPersistentLocalHashCache();
			return this.buildVirtualFiles(cachedDirectoryFiles);
		}

		const prioritizedDirectories = [];
		const remainingDirectories = [];
		for (let index = 0; index < directoryHandles.length; index++) {
			const directoryHandle = directoryHandles[index];
			const directoryName = directoryHandle.name.toLowerCase();
			if (directoryName.includes(targetHash) || directoryName.includes(CUSTOM_LEVEL_PREFIX + targetHash)) {
				prioritizedDirectories.push(directoryHandle);
			} else {
				remainingDirectories.push(directoryHandle);
			}
		}

		const orderedDirectories = prioritizedDirectories.concat(remainingDirectories);
		const canHash = typeof window.crypto !== 'undefined' && window.crypto.subtle;

		for (let index = 0; index < orderedDirectories.length; index++) {
			const directoryHandle = orderedDirectories[index];
			const directoryName = directoryHandle.name.toLowerCase();
			const cachedHash = this.persistentFolderHashCache[directoryName];

			try {
				if (directoryName.includes(targetHash) || directoryName.includes(CUSTOM_LEVEL_PREFIX + targetHash)) {
					const directoryFiles = await this.collectDirectoryFiles(directoryHandle);
					this.localHashCache[targetHash] = directoryHandle;
					await this.flushPersistentLocalHashCache();
					return this.buildVirtualFiles(directoryFiles);
				}

				if (cachedHash) {
					if (cachedHash === targetHash) {
						const directoryFiles = await this.collectDirectoryFiles(directoryHandle);
						this.localHashCache[targetHash] = directoryHandle;
						await this.flushPersistentLocalHashCache();
						return this.buildVirtualFiles(directoryFiles);
					}
					continue;
				}

				if (!canHash) {
					continue;
				}

				const directoryFiles = await this.collectDirectoryFiles(directoryHandle);
				const computedHash = await this.computeCustomLevelHash(directoryFiles);
				if (!computedHash) {
					continue;
				}

				this.setPersistentFolderHash(directoryName, computedHash);
				this.localHashCache[computedHash] = directoryHandle;
				if (computedHash === targetHash) {
					await this.flushPersistentLocalHashCache();
					return this.buildVirtualFiles(directoryFiles);
				}
			} catch (error) {
				console.warn('Could not read map folder from CustomLevels', error);
			}
		}

		await this.flushPersistentLocalHashCache();
		return null;
	},

	collectDirectoryFiles: async function (directoryHandle) {
		const fileHandles = {};
		await this.collectDirectoryFilesRecursive(directoryHandle, fileHandles, '');
		return fileHandles;
	},

	collectDirectoryFilesRecursive: async function (directoryHandle, fileHandles, relativePath) {
		const filesIterator = directoryHandle.entries();
		while (true) {
			const step = await filesIterator.next();
			if (step.done) {
				break;
			}

			const [name, handle] = step.value;
			const path = relativePath ? `${relativePath}/${name}` : name;
			if (handle.kind === 'file') {
				fileHandles[path] = handle;
			} else if (handle.kind === 'directory') {
				await this.collectDirectoryFilesRecursive(handle, fileHandles, path);
			}
		}
	},

	buildVirtualFiles: function (fileHandles) {
		const files = {};
		Object.keys(fileHandles).forEach(path => {
			const handle = fileHandles[path];
			files[path] = {
				async: async type => {
					const file = await handle.getFile();
					if (type === 'string') {
						return file.text();
					}
					if (type === 'uint8array') {
						return new Uint8Array(await file.arrayBuffer());
					}
					if (type === 'arraybuffer') {
						return file.arrayBuffer();
					}
					if (type === 'blob') {
						return file;
					}
					return file.arrayBuffer();
				},
			};
		});
		return files;
	},

	computeCustomLevelHash: async function (fileHandles) {
		const infoFilePath = findInfoFilePath(fileHandles);
		if (!infoFilePath) {
			return '';
		}

		const infoText = await readJsonTextWithEncodingFallback(fileHandles[infoFilePath]);
		if (!infoText) {
			return '';
		}

		const infoJson = jsonParseClean(infoText);
		if (!infoJson) {
			return '';
		}

		const hashInputFiles = getHashInputFiles(infoJson);
		const filePathLookup = {};
		Object.keys(fileHandles).forEach(path => {
			filePathLookup[normalizeFilePath(path)] = path;
		});

		const chunks = [];
		let byteCount = 0;

		const infoBytes = new TextEncoder().encode(infoText);
		chunks.push(infoBytes);
		byteCount += infoBytes.length;

		for (let index = 0; index < hashInputFiles.length; index++) {
			const desiredPath = normalizeFilePath(hashInputFiles[index]);
			const actualPath = filePathLookup[desiredPath];
			if (!actualPath) {
				continue;
			}

			const fileBuffer = await (await fileHandles[actualPath].getFile()).arrayBuffer();
			const fileBytes = new Uint8Array(fileBuffer);
			chunks.push(fileBytes);
			byteCount += fileBytes.length;
		}

		const combined = new Uint8Array(byteCount);
		let offset = 0;
		for (let index = 0; index < chunks.length; index++) {
			combined.set(chunks[index], offset);
			offset += chunks[index].length;
		}

		const hashBuffer = await window.crypto.subtle.digest('SHA-1', combined.buffer);
		return arrayBufferToHex(hashBuffer).toLowerCase();
	},

	postchallengeloaderror: async function (hash) {
		const normalizedHash = normalizeReplayHash(hash);
		let localLookupResult = {loaded: false, attempted: false};
		if (normalizedHash && this.lastLocalLookupAttemptHash !== normalizedHash) {
			localLookupResult = await this.tryLoadFromCustomLevels(normalizedHash);
			if (localLookupResult.attempted) {
				this.lastLocalLookupAttemptHash = normalizedHash;
			}
			if (localLookupResult.loaded) {
				return;
			}
		}

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

		this.el.emit('challengeloaderror', {
			hash,
			text: localLookupResult.attempted
				? 'Map was not found in saved CustomLevels folder. Drop or click to select zip locally'
				: 'Map was not found. Drop or click to select zip locally',
		});
	},

	/**
	 * Read API first to get hash and URLs.
	 */
	fetchData: async function (id, byHash) {
		this.fetched = true;
		document.cookie = 'aprilFools=1; expires=Sat, 03 Apr 2022 00:00:00 UTC; path=/';

		if (byHash) {
			const localLookupResult = await this.tryLoadFromCustomLevels(id, {requestPermission: false});
			if (localLookupResult.loaded) {
				return;
			}
		}

		return fetch(`/cors/beat-saver2/api/maps/${byHash ? 'hash' : 'id'}/${id}`, {
			signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : null,
		})
			.then(res => {
				res.json().then(data => {
					if (data.versions) {
						const currentVersion = data.versions[0];
						const desiredHash = byHash ? id : currentVersion.hash;

						let callback = async (hash, cover, zipUrl, fallbackUrls) => {
							data.image = cover;
							data.hash = hash;
							data.leaderboardId = this.leaderboardId;
							this.data.hash = hash;

							this.el.sceneEl.emit('songFetched', data);

							const localLookupResult = await this.tryLoadFromCustomLevels(hash, {requestPermission: false});
							if (localLookupResult.loaded) {
								return;
							}
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

function openLocalHashCacheDb() {
	return new Promise((resolve, reject) => {
		if (typeof window.indexedDB === 'undefined') {
			resolve(null);
			return;
		}

		const request = window.indexedDB.open(LOCAL_HASH_CACHE_DB_NAME, LOCAL_HASH_CACHE_DB_VERSION);
		request.onupgradeneeded = event => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(LOCAL_HASH_CACHE_STORE_NAME)) {
				db.createObjectStore(LOCAL_HASH_CACHE_STORE_NAME);
			}
		};
		request.onsuccess = event => resolve(event.target.result);
		request.onerror = () => reject(request.error);
	});
}

async function readPersistedLocalHashCache(cacheKey) {
	const db = await openLocalHashCacheDb();
	if (!db) {
		return null;
	}

	try {
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction(LOCAL_HASH_CACHE_STORE_NAME, 'readonly');
			const store = transaction.objectStore(LOCAL_HASH_CACHE_STORE_NAME);
			const request = store.get(cacheKey);
			request.onsuccess = () => resolve(request.result || null);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

async function writePersistedLocalHashCache(cacheKey, value) {
	const db = await openLocalHashCacheDb();
	if (!db) {
		return;
	}

	try {
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(LOCAL_HASH_CACHE_STORE_NAME, 'readwrite');
			const store = transaction.objectStore(LOCAL_HASH_CACHE_STORE_NAME);
			store.put(value, cacheKey);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

function normalizeReplayHash(hash) {
	if (!hash || typeof hash !== 'string') {
		return '';
	}
	const normalized = hash.toLowerCase().replace(CUSTOM_LEVEL_PREFIX, '');
	return normalized.length >= 40 ? normalized.substring(0, 40) : '';
}

function normalizeFilePath(path) {
	if (!path || typeof path !== 'string') {
		return '';
	}
	return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function arrayBufferToHex(arrayBuffer) {
	const byteArray = new Uint8Array(arrayBuffer);
	let hex = '';
	for (let index = 0; index < byteArray.length; index++) {
		const byte = byteArray[index].toString(16).padStart(2, '0');
		hex += byte;
	}
	return hex;
}

function findInfoFilePath(fileHandles) {
	const paths = Object.keys(fileHandles);
	let preferredPath = '';
	for (let index = 0; index < paths.length; index++) {
		const path = paths[index];
		const fileName = normalizeFilePath(path).split('/').pop();
		if (fileName !== INFO_DAT_FILE_NAME) {
			continue;
		}
		if (path.indexOf('/') === -1) {
			return path;
		}
		if (!preferredPath || preferredPath.split('/').length > path.split('/').length) {
			preferredPath = path;
		}
	}
	return preferredPath;
}

async function readJsonTextWithEncodingFallback(fileHandle) {
	const fileBuffer = await (await fileHandle.getFile()).arrayBuffer();
	const utf8Text = new TextDecoder().decode(fileBuffer);
	if (jsonParseClean(utf8Text)) {
		return utf8Text;
	}

	const utf16Text = new TextDecoder('UTF-16LE').decode(fileBuffer);
	if (jsonParseClean(utf16Text)) {
		return utf16Text;
	}

	return '';
}

function getHashInputFiles(info) {
	if (!info) {
		return [];
	}

	if (info.version && info.version.startsWith('4')) {
		const files = [];
		if (info.audio && info.audio.audioDataFilename) {
			files.push(info.audio.audioDataFilename);
		}
		if (info.difficultyBeatmaps) {
			for (let index = 0; index < info.difficultyBeatmaps.length; index++) {
				const difficulty = info.difficultyBeatmaps[index];
				if (difficulty.beatmapDataFilename) {
					files.push(difficulty.beatmapDataFilename);
				}
				if (difficulty.lightshowDataFilename) {
					files.push(difficulty.lightshowDataFilename);
				}
			}
		}
		return files;
	}

	if (!info._difficultyBeatmapSets) {
		return [];
	}

	return info._difficultyBeatmapSets
		.reduce((all, set) => all.concat(set._difficultyBeatmaps || []), [])
		.map(difficulty => difficulty._beatmapFilename)
		.filter(Boolean);
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
