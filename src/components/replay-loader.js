const dragDrop = require('drag-drop');
import {
	checkBSOR,
	NoteEventType,
	StructType,
	DecodeInfo,
	DecodeFrames,
	DecodeNotes,
	DecodeWalls,
	DecodeHeight,
	DecodePauses,
	DecodeInt,
	DecodeFloat,
	DecodeBool,
	DecodeUint8,
} from '../open-replay-decoder';
import {checkSS} from '../ss-replay-decoder';
import {Mirror_Horizontal, Mirror_Horizontal_Note} from '../utils/chirality-support';
import {MultiplierCounter} from '../utils/MultiplierCounter';
var queryParams = require('../query-params');

import {
	NoteCutDirection,
	difficultyFromName,
	clamp,
	ScoringType,
	getUrlParameter,
	getApiUrl,
	getStreamUrl,
	getWebsiteUrl,
	replaceCdnUrl,
	getCookie,
} from '../utils';
import {updateScoringAndTypes} from '../utils/mapPostprocessor';
function floorToTwo(num) {
	return Math.floor(num * 100) / 100;
}

function assignNote(replaynote, mapnote) {
	const scoringType = mapnote._scoringType ? mapnote._scoringType + 2 : 3;
	replaynote.index = mapnote._index;
	replaynote.colorType = mapnote._type;
	replaynote.lineIndex = mapnote._lineIndex;
	replaynote.cutDirection = mapnote._cutDirection;
	replaynote.lineLayer = mapnote._lineLayer;
	replaynote.mapnote = mapnote;
	replaynote.scoringType = scoringType - 2;
	mapnote.found = true;
}

AFRAME.registerComponent('replay-loader', {
	schema: {
		playerID: {default: getUrlParameter('playerID')},
		playerId: {default: getUrlParameter('playerId')},
		link: {default: getUrlParameter('link')},
		isSafari: {default: false},
		difficulty: {default: getUrlParameter('difficulty') || 'ExpertPlus'},
		mode: {default: getUrlParameter('mode') || 'Standard'},
		scoreId: {default: getUrlParameter('scoreId')},
		context: {default: getUrlParameter('context') || 'general'},
	},

	init: function () {
		this.replay = null;
		this.user = null;
		this.streamSocket = null;
		this.isStreaming = false;

		this._streamState = null;
		this._streamNoteCallbacks = new Map();

		let captureThis = this;
		if (this.data.playerId.length) {
			this.connectToStream(this.data.playerId);
		} else if (this.data.link.length) {
			setTimeout(() => this.fetchByFile(this.data.link, true), 300);
		} else if (this.data.scoreId.length) {
			captureThis.downloadReplay(null, this.data.scoreId);
		} else if (!this.data.playerID.length) {
			this.empty = true;
			this.cleanup = dragDrop('#body', files => {
				if (files[0].name.includes('.bsor') || files[0].name.includes('.dat')) {
					this.fetchByFile(files[0]);
				}
			});
			this.el.sceneEl.addEventListener('usergesturereceive', e => {
				if (this.replay || this.fetching) {
					return;
				}
				this.fetching = true;
				var input = document.createElement('input');
				input.type = 'file';
				input.accept = '.bsor, .bsortemp, .dat';

				input.onchange = e => {
					this.fetchByFile(e.target.files[0]);
				};

				input.click();
			});

			this.el.sceneEl.addEventListener('replayloadfailed', e => {
				this.fetching = false;
			});
		} else {
			document.addEventListener('songFetched', e => {
				captureThis.downloadReplay(e.detail.hash);
			});
		}

		this.el.addEventListener('challengeloadend', e => {
			captureThis.challengeloadend(e.detail);
		});
	},

	downloadReplay: function (hash, scoreId, error) {
		this.el.sceneEl.emit('replayloadstart', null);
		this.challenge = null;
		this.notes = null;
		fetch(
			getApiUrl() +
				'/score/' +
				(scoreId
					? `${scoreId}?fallbackToRedirect=true`
					: `${this.data.context}/${this.data.playerID}/${hash}/${this.data.difficulty}/${this.data.mode}`)
		).then(async response => {
			let data = response.status == 200 ? await response.json() : null;
			if (data && data.playerId) {
				if (/googlebot/i.test(navigator.userAgent)) {
					document.title = `Replay | ${data.player.name} | ${data.song.name}`;
					document.querySelector('meta[property="og:title"]').setAttribute('content', `Replay | ${data.player.name} | ${data.song.name}`);
					return;
				}

				this.el.sceneEl.emit(
					'replayInfofetched',
					{
						hash: data.song.hash,
						leaderboardId: data.leaderboardId,
						difficulty: data.difficulty.value,
						mode: data.difficulty.modeName,
						playerId: data.playerId,
						metadata: {
							songName: data.song.name,
							songAuthorName: data.song.author,
							songSubName: data.song.subName,
							levelAuthorName: data.song.mapper,
						},
					},
					null
				);

				checkBSOR(replaceCdnUrl(data.replay), true, replay => {
					if (replay && replay.frames) {
						if (replay.frames.length == 0) {
							this.el.sceneEl.emit('replayloadfailed', {error: 'Replay broken, redownload and reinstall mod, please'}, null);
						} else {
							replay.leaderboardContexts = data.validContexts;
							this.replay = replay;
							const jd = replay.info.jumpDistance > 5 ? replay.info.jumpDistance : undefined;
							this.el.sceneEl.emit(
								'replayfetched',
								{
									hash: replay.info.hash,
									difficulty: difficultyFromName(replay.info.difficulty),
									mode: replay.info.mode,
									jd,
									playerId: data.playerId,
								},
								null
							);
							if (this.challenge) {
								this.processScores();
							}
						}
					} else {
						this.el.sceneEl.emit('replayloadfailed', {error: replay.errorMessage}, null);
					}
				});
				this.user = data.player;
				this.el.sceneEl.emit(
					'userloaded',
					{
						name: this.user.name,
						avatar: replaceCdnUrl(this.user.avatar),
						country: this.user.country,
						countryIcon: `assets/flags/${this.user.country.toLowerCase()}.png`,
						profileLink: `${getWebsiteUrl()}/u/${this.user.alias ? this.user.alias : this.user.id}`,
						id: this.user.id,
					},
					null
				);
				let profileSettings = data.player.profileSettings;
				if (profileSettings) {
					this.el.sceneEl.emit('colorsFetched', {playerId: data.player.id, features: profileSettings}, null);
				}
				if (!getCookie('autoplayReplay')) {
					fetch(getApiUrl() + '/watched/' + data.id, {credentials: 'include'});
				}
			} else {
				this.el.sceneEl.emit(
					'replayloadfailed',
					{
						error:
							data == null
								? hash
									? 'Sorry, this ScoreSaber replay is not available'
									: 'This score was improved.'
								: data.errorMessage || error,
					},
					null
				);
			}
		});
	},

	fetchByFile: function (file, itsLink) {
		this.el.sceneEl.emit('replayloadstart', null);
		this.challenge = null;
		this.notes = null;
		checkBSOR(itsLink ? replaceCdnUrl(file) : file, itsLink, replay => {
			if (replay && replay.frames) {
				this.replay = replay;
				this.fetchPlayer(replay.info.playerID);
				this.el.sceneEl.emit(
					'replayfetched',
					{
						hash: replay.info.hash,
						difficulty: difficultyFromName(replay.info.difficulty),
						mode: replay.info.mode,
						jd: replay.info.jumpDistance,
					},
					null
				);
			} else {
				var replayError = replay;
				if (replayError == null) {
					replayError = 'Error: please check the replay file or link';
				}
				if (itsLink && file.includes('discordapp')) {
					replayError = 'Error: please provide full Discord file url (with params)';
				}
				this.el.sceneEl.emit('replayloadfailed', {error: replayError}, null);
			}
		});
	},

	fetchPlayer: function (playerID) {
		fetch(`${getApiUrl()}/player/${playerID}`).then(res => {
			res.json().then(data => {
				this.user = data;
				this.el.sceneEl.emit(
					'userloaded',
					{
						name: this.user.name,
						avatar: replaceCdnUrl(this.user.avatar),
						country: this.user.country,
						countryIcon: `assets/flags/${this.user.country.toLowerCase()}.png`,
						profileLink: `${getWebsiteUrl()}/u/${this.user.alias ? this.user.alias : this.user.id}`,
						id: this.user.id,
					},
					null
				);
				let profileSettings = data.profileSettings;
				if (profileSettings) {
					this.el.sceneEl.emit('colorsFetched', {playerId: data.id, features: profileSettings}, null);
				}
			});
		});
	},

	connectToStream: function (playerId) {
		this.el.sceneEl.emit('replayloadstart', null);
		this.challenge = null;
		this.notes = null;
		this.isStreaming = true;

		this.fetchPlayer(playerId);

		const wsUrl = `${getStreamUrl()}/stream/player/listen`;
		const ws = new WebSocket(wsUrl);
		this.streamSocket = ws;

		ws.binaryType = 'arraybuffer';

		ws.onopen = () => {
			ws.send(JSON.stringify({action: 'replay', playerId}));
		};

		ws.onmessage = (event) => {
			if (typeof event.data === 'string') {
				try {
					const msg = JSON.parse(event.data);
					if (msg.error) {
						this.el.sceneEl.emit('replayloadfailed', {error: msg.error}, null);
					}
				} catch (e) {}
				return;
			}

			this.processStreamChunk(event.data);
		};

		ws.onerror = () => {
			this.el.sceneEl.emit('replayloadfailed', {error: 'Stream connection error'}, null);
		};

		ws.onclose = () => {
			this.isStreaming = false;
			this.streamSocket = null;
		};
	},

	processStreamChunk: function (arrayBuffer) {
		const dataView = new DataView(arrayBuffer);
		dataView.pointer = 0;

		while (dataView.pointer < dataView.byteLength) {
			const typeByte = DecodeUint8(dataView);

			if (typeByte === 99) {
				if (this.replay) {
					this.replay.info = DecodeInfo(dataView);
				}
				const endType = DecodeInt(dataView);
				const failTime = DecodeFloat(dataView);
				const shouldUpload = DecodeBool(dataView);

				if (failTime > 0.01) {
					this.replay.info.failTime = failTime;
				}
				this.el.sceneEl.emit('streamended', {endType, failTime, shouldUpload}, null);
				continue;
			}

			switch (typeByte) {
				case StructType.info:
					this.onStreamInfo(DecodeInfo(dataView));
					break;
				case StructType.frames:
					this.onStreamFrames(DecodeFrames(dataView));
					break;
				case StructType.notes:
					this.onStreamNotes(DecodeNotes(dataView));
					break;
				case StructType.walls:
					this.onStreamWalls(DecodeWalls(dataView));
					break;
				case StructType.heights:
					this.onStreamHeights(DecodeHeight(dataView));
					break;
				case StructType.pauses:
					this.onStreamPauses(DecodePauses(dataView));
					break;
				default:
					return;
			}
		}
	},

	onStreamInfo: function (info) {
		const isMapChange = this.replay != null;

		this.replay = {
			info,
			frames: [],
			notes: [],
			walls: [],
			heights: [],
			pauses: [],
		};

		this.challenge = null;
		this.notes = null;
		this.allStructs = null;
		this.bombs = null;
		this.walls = null;
		this.resetStreamState();

		const jd = info.jumpDistance > 5 ? info.jumpDistance : undefined;
		const difficulty = difficultyFromName(info.difficulty);

		if (isMapChange) {
			this.el.sceneEl.emit('streammapchange', {
				hash: info.hash,
				difficulty,
				mode: info.mode,
				jd,
			}, null);
		} else {
			this.el.sceneEl.emit('streamstarted', null, null);
		}

		this.el.sceneEl.emit(
			'replayfetched',
			{
				hash: info.hash,
				difficulty,
				mode: info.mode,
				jd,
				streaming: true,
			},
			null
		);
	},

	onStreamFrames: function (frames) {
		if (!this.replay) return;
		this.replay.frames.push(...frames);

		if (frames.length > 0) {
			const lastTime = frames[frames.length - 1].time;
			this.el.sceneEl.emit('streambuffered', {time: lastTime}, null);
		}

		this.el.sceneEl.emit('streamframes', {frames}, null);
	},

	onStreamNotes: function (newNotes) {
		if (!this.replay) return;
		this.replay.notes.push(...newNotes);

		if (this.challenge) {
			this.processIncrementalNotes(newNotes);
		} else {
			if (!this._pendingNotes) this._pendingNotes = [];
			this._pendingNotes.push(...newNotes);
		}
	},

	onStreamWalls: function (newWalls) {
		if (!this.replay) return;
		this.replay.walls.push(...newWalls);

		if (this.challenge) {
			this.processIncrementalWalls(newWalls);
		} else {
			if (!this._pendingWalls) this._pendingWalls = [];
			this._pendingWalls.push(...newWalls);
		}
	},

	onStreamHeights: function (heights) {
		if (!this.replay) return;
		this.replay.heights.push(...heights);
	},

	onStreamPauses: function (pauses) {
		if (!this.replay) return;
		this.replay.pauses.push(...pauses);
		this.el.sceneEl.emit('streampauses', {pauses}, null);
	},

	resetStreamState: function () {
		this._streamState = {
			normalCounter: new MultiplierCounter(),
			maxCounter: new MultiplierCounter(),
			score: 0,
			maxScore: 0,
			fcScore: 0,
			combo: 0,
			misses: 0,
			energy: 0.5,
			streak: 0,
			maxStreak: 0,
			streakId: -1,
			maxStreakId: -1,
			failRecorded: false,
			allStructs: [],
			noteStructs: [],
			bombStructs: [],
			wallStructs: [],
			mapnotes: null,
			leftHanded: false,
			mapPrepared: false,
		};
		this._pendingNotes = [];
		this._pendingWalls = [];
		this._streamNoteCallbacks.clear();
	},

	registerStreamNoteCallback: function (noteIndex, callback) {
		this._streamNoteCallbacks.set(noteIndex, callback);
	},

	unregisterStreamNoteCallback: function (noteIndex) {
		this._streamNoteCallbacks.delete(noteIndex);
	},

	prepareMapForStream: function () {
		const ss = this._streamState;
		if (ss.mapPrepared || !this.challenge || !this.replay) return;

		const map = this.challenge.beatmaps[this.challenge.mode][this.challenge.difficulty];
		this.applyModifiers(map, this.replay);
		this.setIds(map, this.replay);

		ss.mapnotes = []
			.concat(map._notes, map._chains)
			.sort((a, b) => a._time - b._time)
			.filter(a => a._type == 0 || a._type == 1);
		ss.mapPrepared = true;
	},

	processIncrementalNotes: function (newRawNotes) {
		const ss = this._streamState;
		if (!ss) return;

		this.prepareMapForStream();
		const replay = this.replay;

		const newNoteStructs = [];
		const newBombStructs = [];

		for (let i = 0; i < newRawNotes.length; i++) {
			const info = newRawNotes[i];
			let note = {
				eventType: info.eventType,
				cutInfo: info.noteCutInfo,
				spawnTime: info.spawnTime,
				time: info.eventTime,
				id: info.noteID,
				score: info.score,
				cutPoint: info.noteCutInfo ? info.noteCutInfo.cutPoint : null,
			};

			if (note.id == -1) {
				note.eventType = NoteEventType.bomb;
				note.id += 39;
				note.score = -4;
			}
			if (note.id > 0 && note.id < 100000) {
				if (note.id % 100 == 99) {
					note.eventType = NoteEventType.bomb;
					note.id += 39;
					note.score = -4;
				} else if (note.id % 10 == 9) {
					note.eventType = NoteEventType.bomb;
					note.id -= 1;
					note.score = -4;
				}
			}
			if (note.eventType == NoteEventType.bomb) {
				newBombStructs.push(note);
			} else {
				note.isBlock = true;
				newNoteStructs.push(note);
			}
		}

		if (ss.mapnotes) {
			for (let j = 0; j < ss.mapnotes.length; j++) {
				const mapnote = ss.mapnotes[j];
				if (mapnote.found) continue;
				for (let m = 0; m < newNoteStructs.length; m++) {
					const replaynote = newNoteStructs[m];
					if (replaynote.index != undefined) continue;

					const absDiff = Math.abs(replaynote.spawnTime - mapnote._songTime);
					if (
						absDiff < 0.0005 &&
						(replaynote.id == mapnote._id ||
							replaynote.id == mapnote._idWithScoring ||
							replaynote.id == mapnote._idWithAlternativeScoring ||
							replaynote.id == mapnote._idWithLegacyScoring)
					) {
						assignNote(replaynote, mapnote);
						break;
					}
				}
			}

			for (let j = 0; j < ss.mapnotes.length; j++) {
				const mapnote = ss.mapnotes[j];
				if (mapnote.found) continue;
				for (let m = 0; m < newNoteStructs.length; m++) {
					const replaynote = newNoteStructs[m];
					if (replaynote.index != undefined) continue;
					if (
						replaynote.id == mapnote._id ||
						replaynote.id == mapnote._idWithScoring ||
						replaynote.id == mapnote._idWithAlternativeScoring ||
						replaynote.id == mapnote._idWithLegacyScoring
					) {
						assignNote(replaynote, mapnote);
						break;
					}
				}
			}
		}

		ss.noteStructs.push(...newNoteStructs);
		ss.bombStructs.push(...newBombStructs);

		const newAll = [].concat(newBombStructs, newNoteStructs);
		newAll.sort((a, b) => {
			if (a.time < b.time) return -1;
			if (a.time > b.time) return 1;
			if (a.time === b.time && a.cutPoint && b.cutPoint) {
				if (a.cutPoint.z < b.cutPoint.z) return -1;
				if (a.cutPoint.z > b.cutPoint.z) return 1;
			}
			return 0;
		});

		for (let i = 0; i < newAll.length; i++) {
			const note = newAll[i];
			note.i = ss.allStructs.length;

			if (!note.score) {
				note.score = ScoreForNote(note.eventType, note.cutInfo, note.scoringType);
			}

			let scoreForMaxScore = 115;
			if (note.scoringType == ScoringType.ChainHead) {
				scoreForMaxScore = 85;
			} else if (note.scoringType == ScoringType.ChainLink || note.scoringType == ScoringType.ChainLinkArcHead) {
				scoreForMaxScore = 20;
			}

			if (note.isBlock) {
				ss.maxCounter.Increase();
				ss.maxScore += ss.maxCounter.Multiplier * scoreForMaxScore;
			}

			if (note.score < 0) {
				if (note.isBlock) {
					if (ss.allStructs.length == 0) {
						ss.fcScore += ss.maxCounter.Multiplier * scoreForMaxScore;
					} else {
						const prev = ss.allStructs[ss.allStructs.length - 1];
						ss.fcScore += (ss.maxCounter.Multiplier * prev.accuracy * scoreForMaxScore) / 100;
					}
				}
				ss.normalCounter.Decrease();
				ss.combo = 0;
				ss.misses++;
				switch (note.score) {
					case -2:
						ss.energy -= note.scoringType == ScoringType.ChainLink ? 0.025 : 0.1;
						break;
					case -3:
					case -4:
						ss.energy -= note.scoringType == ScoringType.ChainLink ? 0.03 : 0.15;
						break;
				}
			} else {
				ss.normalCounter.Increase();
				ss.score += ss.normalCounter.Multiplier * note.score;
				ss.fcScore += ss.maxCounter.Multiplier * note.score;

				if (ss.energy > 0 || (!replay.info.modifiers.includes('NF') && !replay.info.failTime)) {
					ss.energy += note.scoringType == ScoringType.ChainLink ? 1 / 500 : 0.01;
				}
				if (ss.energy > 1) ss.energy = 1;
				ss.combo++;

				if (note.scoringType != ScoringType.ChainLink) {
					if (note.score == 115) {
						ss.streak++;
						if (ss.streakId == -1) ss.streakId = note.i;
					} else if (note.isBlock) {
						if (ss.streak > ss.maxStreak) {
							ss.maxStreak = ss.streak;
							ss.maxStreakId = ss.streakId;
						}
						ss.streak = 0;
						ss.streakId = -1;
					}
				}
			}

			note.multiplier = ss.normalCounter.Multiplier;
			note.totalScore = ss.score;
			note.combo = ss.combo;
			note.misses = ss.misses;
			note.energy = ss.energy;
			note.maxScore = scoreForMaxScore;

			if (ss.energy <= 0 && !ss.failRecorded) {
				ss.failRecorded = true;
				note.fail = true;
			}

			if (note.isBlock) {
				note.accuracy = (note.totalScore / ss.maxScore) * 100;
				note.fcAccuracy = (ss.fcScore / ss.maxScore) * 100;
			} else {
				const prev = ss.allStructs.length > 0 ? ss.allStructs[ss.allStructs.length - 1] : null;
				note.accuracy = prev ? prev.accuracy : 0;
				note.fcAccuracy = prev ? prev.fcAccuracy : 100;
			}

			ss.allStructs.push(note);
		}

		if (ss.streak > ss.maxStreak) {
			ss.maxStreak = ss.streak;
			ss.maxStreakId = ss.streakId;
		}

		this.allStructs = ss.allStructs;
		this.notes = ss.noteStructs;
		this.bombs = ss.bombStructs;
		this.walls = ss.wallStructs;

		if (this._streamNoteCallbacks.size > 0) {
			for (let i = 0; i < newAll.length; i++) {
				const note = newAll[i];
				if (note.index !== undefined) {
					const cb = this._streamNoteCallbacks.get(note.index);
					if (cb) {
						this._streamNoteCallbacks.delete(note.index);
						cb(note);
					}
				}
			}
		}

		this.el.sceneEl.emit(
			'replayloaded',
			{notes: ss.allStructs, replay: this.replay, leftHanded: ss.leftHanded, streaming: true},
			null
		);
	},

	processIncrementalWalls: function (newRawWalls) {
		const ss = this._streamState;
		if (!ss) return;

		const newWallStructs = [];
		for (let i = 0; i < newRawWalls.length; i++) {
			const info = newRawWalls[i];
			newWallStructs.push({
				time: info.time,
				id: info.wallID,
				score: -5,
			});
		}

		ss.wallStructs.push(...newWallStructs);

		for (let i = 0; i < newWallStructs.length; i++) {
			const note = newWallStructs[i];
			note.i = ss.allStructs.length;

			ss.normalCounter.Decrease();
			ss.combo = 0;

			note.multiplier = ss.normalCounter.Multiplier;
			note.totalScore = ss.score;
			note.combo = ss.combo;
			note.misses = ss.misses;
			note.energy = ss.energy;

			const prev = ss.allStructs.length > 0 ? ss.allStructs[ss.allStructs.length - 1] : null;
			note.accuracy = prev ? prev.accuracy : 0;
			note.fcAccuracy = prev ? prev.fcAccuracy : 100;

			ss.allStructs.push(note);
		}

		this.allStructs = ss.allStructs;
		this.walls = ss.wallStructs;

		this.el.sceneEl.emit(
			'replayloaded',
			{notes: ss.allStructs, replay: this.replay, leftHanded: ss.leftHanded, streaming: true},
			null
		);
	},

	tryFindingNotes: function (map, replay, noteStructs, mapnotes, indexToBeat = null) {
		this.setIds(map, replay);
		const remainingNoteStructs = [].concat(noteStructs);
		for (var j = 0; j < mapnotes.length; j++) {
			const mapnote = mapnotes[j];
			for (var m = 0; m < remainingNoteStructs.length; m++) {
				const replaynote = remainingNoteStructs[m];

				if (replaynote.index == undefined) {
					var diff = replaynote.spawnTime - mapnote._songTime;
					if (diff > 1) {
						if (indexToBeat !== null && m > indexToBeat) {
							return;
						}
						break;
					}
					var absDiff = Math.abs(diff);
					if (
						absDiff < 0.0005 &&
						(replaynote.id == mapnote._id ||
							replaynote.id == mapnote._idWithScoring ||
							replaynote.id == mapnote._idWithAlternativeScoring ||
							replaynote.id == mapnote._idWithLegacyScoring)
					) {
						assignNote(replaynote, mapnote);
						remainingNoteStructs.splice(m, 1);
						break;
					}
				}
			}
		}
	},

	processScores: function () {
		const replay = this.replay;
		const map = this.challenge.beatmaps[this.challenge.mode][this.challenge.difficulty];

		var mapnotes = []
			.concat(map._notes, map._chains)
			.sort((a, b) => {
				return a._time - b._time;
			})
			.filter(a => a._type == 0 || a._type == 1);
		this.applyModifiers(map, replay);

		var noteStructs = new Array();
		var bombStructs = new Array();
		for (var i = 0; i < replay.notes.length; i++) {
			const info = replay.notes[i];
			let note = {
				eventType: info.eventType,
				cutInfo: info.noteCutInfo,
				spawnTime: info.spawnTime,
				time: info.eventTime,
				id: info.noteID,
				score: info.score,
				cutPoint: info.noteCutInfo ? info.noteCutInfo.cutPoint : null,
			};

			if (note.id == -1) {
				note.eventType = NoteEventType.bomb;
				note.id += 39;
				note.score = -4;
			}
			if (note.id > 0 && note.id < 100000) {
				if (note.id % 100 == 99) {
					note.eventType = NoteEventType.bomb;
					note.id += 39;
					note.score = -4;
				} else if (note.id % 10 == 9) {
					note.eventType = NoteEventType.bomb;
					note.id -= 1;
					note.score = -4;
				}
			}
			if (note.eventType == NoteEventType.bomb) {
				bombStructs.push(note);
			} else {
				note.isBlock = true;
				noteStructs.push(note);
			}
		}

		noteStructs.sort(function (a, b) {
			if (a.spawnTime < b.spawnTime) return -1;
			if (a.spawnTime > b.spawnTime) return 1;
			return 0;
		});

		var wallStructs = new Array();
		for (var i = 0; i < replay.walls.length; i++) {
			const info = replay.walls[i];
			let note = {
				time: info.time,
				id: info.wallID,
				score: -5,
			};
			wallStructs.push(note);
		}

		var leftHanded = false;

		this.tryFindingNotes(map, replay, noteStructs, mapnotes);

		var brokenNotesCount = 0;
		for (var i = 0; i < noteStructs.length; i++) {
			if (noteStructs[i].index == undefined) {
				brokenNotesCount++;
			}
		}

		if (brokenNotesCount > noteStructs.length / 10) {
			const mirrorAndRecalculate = () => {
				Mirror_Horizontal(map, 4, true, false);
				updateScoringAndTypes(map);
				mapnotes = []
					.concat(map._notes, map._chains)
					.sort((a, b) => {
						return a._time - b._time;
					})
					.filter(a => a._type == 0 || a._type == 1);
				for (let i = 0; i < noteStructs.length; i++) {
					const element = noteStructs[i];
					element.index = undefined;
				}
				this.tryFindingNotes(map, replay, noteStructs, mapnotes, brokenNotesCount);
			};

			mirrorAndRecalculate();

			var mirroredbrokenNotesCount = 0;
			for (var i = 0; i < noteStructs.length; i++) {
				if (noteStructs[i].index == undefined) {
					mirroredbrokenNotesCount++;
				}
			}
			if (mirroredbrokenNotesCount < brokenNotesCount) {
				leftHanded = true;
				console.log('Applied left-handed mode');
			} else {
				brokenNotesCount = null;
				mirrorAndRecalculate();
			}
		}

		for (var j = 0; j < mapnotes.length; j++) {
			const mapnote = mapnotes[j];
			if (!mapnote.found) {
				for (var m = 0; m < noteStructs.length; m++) {
					const replaynote = noteStructs[m];

					if (replaynote.index == undefined) {
						if (
							replaynote.id == mapnote._id ||
							replaynote.id == mapnote._idWithScoring ||
							replaynote.id == mapnote._idWithAlternativeScoring ||
							replaynote.id == mapnote._idWithLegacyScoring
						) {
							assignNote(replaynote, mapnote);
							break;
						}
					}
				}
			}
		}

		for (var i = 0; i < noteStructs.length; i++) {
			if (noteStructs[i].index == undefined) {
				console.log("Couldn't find replay note " + i);
				console.log(noteStructs[i]);
			}
		}

		for (var i = 0; i < mapnotes.length; i++) {
			if (!mapnotes[i].found) {
				console.log("Couldn't find map note " + i);
				console.log(mapnotes[i]);
			}
		}

		const allStructs = [].concat(bombStructs, noteStructs, wallStructs);
		allStructs.sort(function (a, b) {
			if (a.time < b.time) return -1;
			if (a.time > b.time) return 1;
			if (a.time === b.time && a.cutPoint && b.cutPoint) {
				if (a.cutPoint.z < b.cutPoint.z) return -1;
				if (a.cutPoint.z > b.cutPoint.z) return 1;
			}
			return 0;
		});

		for (var i = 0; i < allStructs.length; i++) {
			var note = allStructs[i];
			note.i = i;
			if (!note.score) {
				note.score = ScoreForNote(note.eventType, note.cutInfo, note.scoringType);
			}
		}

		if (replay.info.startTime && allStructs.length) {
			allStructs[0].start = true;
		}

		var energy = 0.5;
		var score = 0,
			maxScore = 0,
			fcScore = 0,
			combo = 0,
			misses = 0;
		var streak = 0,
			maxStreak = 0,
			streakId = -1,
			maxStreakId = -1;

		var failRecorded = false;

		const maxCounter = new MultiplierCounter();
		const normalCounter = new MultiplierCounter();

		for (var i = 0; i < allStructs.length; i++) {
			let note = allStructs[i];

			var scoreForMaxScore = 115;
			if (note.scoringType == ScoringType.ChainHead) {
				scoreForMaxScore = 85;
			} else if (note.scoringType == ScoringType.ChainLink || note.scoringType == ScoringType.ChainLinkArcHead) {
				scoreForMaxScore = 20;
			}

			if (note.isBlock) {
				maxCounter.Increase();
				maxScore += maxCounter.Multiplier * scoreForMaxScore;
			}

			if (note.score < 0) {
				if (note.isBlock) {
					if (i == 0) {
						fcScore += maxCounter.Multiplier * scoreForMaxScore;
					} else {
						fcScore += (maxCounter.Multiplier * allStructs[i - 1].accuracy * scoreForMaxScore) / 100;
					}
				}
				normalCounter.Decrease();
				combo = 0;
				misses++;
				switch (note.score) {
					case -2: // badcut
						if (note.scoringType == ScoringType.ChainLink) {
							energy -= 0.025;
						} else {
							energy -= 0.1;
						}
						break;
					case -3: // miss
					case -4: // bomb
						if (note.scoringType == ScoringType.ChainLink) {
							energy -= 0.03;
						} else {
							energy -= 0.15;
						}
						break;

					default:
						break;
				}
			} else {
				normalCounter.Increase();
				score += normalCounter.Multiplier * note.score;
				fcScore += maxCounter.Multiplier * note.score;

				if (energy > 0 || (!replay.info.modifiers.includes('NF') && !replay.info.failTime)) {
					if (note.scoringType == ScoringType.ChainLink) {
						energy += 1 / 500;
					} else {
						energy += 0.01;
					}
				}
				if (energy > 1) {
					energy = 1;
				}
				combo++;

				if (note.scoringType != ScoringType.ChainLink) {
					if (note.score == 115) {
						streak++;
						if (streakId == -1) {
							streakId = i;
						}
					} else if (note.isBlock) {
						if (streak > maxStreak) {
							maxStreak = streak;
							maxStreakId = streakId;
						}
						streak = 0;
						streakId = -1;
					}
				}
			}

			note.multiplier = normalCounter.Multiplier;
			note.totalScore = score;
			note.combo = combo;
			note.misses = misses;
			note.energy = energy;
			note.maxScore = scoreForMaxScore;

			if (energy <= 0 && !failRecorded) {
				failRecorded = true;
				note.fail = true;
			}

			if (note.isBlock) {
				note.accuracy = (note.totalScore / maxScore) * 100;
				note.fcAccuracy = (fcScore / maxScore) * 100;
			} else {
				note.accuracy = i == 0 ? 0 : allStructs[i - 1].accuracy;
				note.fcAccuracy = i == 0 ? 100 : allStructs[i - 1].fcAccuracy;
			}
		}
		if (streak > maxStreak) {
			maxStreak = streak;
			maxStreakId = streakId;
		}

		if (maxStreakId > -1) {
			allStructs[maxStreakId].maxStreak = maxStreak;
		}

		this.allStructs = allStructs;
		this.notes = noteStructs;
		this.bombs = bombStructs;
		this.walls = wallStructs;

		this.el.sceneEl.emit('replayloaded', {notes: allStructs, replay: replay, leftHanded}, null);
	},

	challengeloadend: function (event) {
		this.challenge = event;

		if (this.isStreaming && this.replay) {
			this.prepareMapForStream();

			if (this._pendingNotes && this._pendingNotes.length > 0) {
				this.processIncrementalNotes(this._pendingNotes);
				this._pendingNotes = [];
			}
			if (this._pendingWalls && this._pendingWalls.length > 0) {
				this.processIncrementalWalls(this._pendingWalls);
				this._pendingWalls = [];
			}
		} else if (!this.notes && this.replay) {
			this.processScores();
		}
	},

	applyModifiers: function (map, replay) {
		if (replay.info.modifiers.includes('NA')) {
			map._notes.forEach(note => {
				note._cutDirection = NoteCutDirection.Any;
			});
		}
		if (replay.info.modifiers.includes('NB')) {
			map._notes = map._notes.filter(a => a._type == 0 || a._type == 1);
		}
		if (replay.info.modifiers.includes('NO')) {
			map._obstacles = [];
		}
	},

	setIds: function (map, replay) {
		[].concat(map._notes, map._chains).forEach((mapnote, i) => {
			var lineIndex = mapnote._lineIndex;
			var colorType = mapnote._type;
			var cutDirection = colorType != 3 ? mapnote._cutDirection : NoteCutDirection.Any;
			var lineLayer = mapnote._lineLayer;
			var scoringType = mapnote._scoringType !== undefined ? mapnote._scoringType + 2 : colorType == 3 ? 2 : 3;

			var id = lineIndex * 1000 + lineLayer * 100 + colorType * 10 + cutDirection;
			mapnote._id = id;
			mapnote._idWithScoring = id + scoringType * 10000;

			var gameVersion = 0;
			if (replay.info.gameVersion && replay.info.gameVersion.split('.').length == 3) {
				gameVersion = parseInt(replay.info.gameVersion.split('.')[1]);
			}

			var altscoringType = scoringType;
			var legacyScoringType = scoringType;
			if (mapnote._scoringType == ScoringType.ChainHead) {
				altscoringType = ScoringType.ArcHead + 2;
			} else if (mapnote._scoringType == ScoringType.ArcHead) {
				altscoringType = ScoringType.ChainHead + 2;
			} else if (mapnote._scoringType == ScoringType.ChainHeadArcTail) {
				altscoringType = ScoringType.ArcTail + 2;
			} else if (mapnote._scoringType == ScoringType.ChainHeadArcHead) {
				altscoringType = ScoringType.ArcHead + 2;
			} else if (mapnote._scoringType == ScoringType.ChainHeadArcHeadArcTail) {
				altscoringType = ScoringType.ArcTail + 2;
			} else if (mapnote._scoringType == ScoringType.ChainLinkArcHead) {
				altscoringType = ScoringType.ChainLink + 2;
				if (gameVersion >= 29 && mapnote._sliceIndex == mapnote._sliceCount - 1) {
					id = mapnote._tailLineIndex * 1000 + mapnote._tailLineLayer * 100 + colorType * 10 + cutDirection;
				}
			} else if (mapnote._scoringType == ScoringType.ArcHeadArcTail) {
				altscoringType = ScoringType.ArcHead + 2;
			} else if (gameVersion >= 29 && mapnote._scoringType == ScoringType.ChainLink && mapnote._sliceIndex == mapnote._sliceCount - 1) {
				id = mapnote._tailLineIndex * 1000 + mapnote._tailLineLayer * 100 + colorType * 10 + cutDirection;
			}

			if (mapnote._scoringType == ScoringType.ArcTail) {
				legacyScoringType = ScoringType.Normal + 2;
			} else if (mapnote._scoringType == ScoringType.ArcHeadArcTail) {
				legacyScoringType = ScoringType.ArcTail + 2;
			} else if (mapnote._scoringType == ScoringType.ChainHeadArcTail) {
				legacyScoringType = ScoringType.ChainHead + 2;
			} else if (mapnote._scoringType == ScoringType.ChainLinkArcHead) {
				legacyScoringType = ScoringType.ChainLink + 2;
			} else if (mapnote._scoringType == ScoringType.ChainHeadArcHead) {
				legacyScoringType = ScoringType.ChainHead + 2;
			} else if (mapnote._scoringType == ScoringType.ChainHeadArcHeadArcTail) {
				legacyScoringType = ScoringType.ChainHeadArcTail + 2;
			}

			mapnote._idWithAlternativeScoring = id + altscoringType * 10000;
			mapnote._idWithLegacyScoring = id + legacyScoringType * 10000;
		});
	},
});

function CutScoresForNote(cut, scoringType) {
	var beforeCutRawScore = 0;
	if (scoringType != ScoringType.ChainLink && scoringType != ScoringType.ChainLinkArcHead) {
		if (scoringType == ScoringType.ArcTail || scoringType == ScoringType.ArcHeadArcTail || scoringType == ScoringType.ChainHeadArcTail) {
			beforeCutRawScore = 70;
		} else {
			beforeCutRawScore = clamp(Math.round(70 * cut.beforeCutRating), 0, 70);
		}
	}
	var afterCutRawScore = 0;
	if (scoringType != ScoringType.ChainLink && scoringType != ScoringType.ChainLinkArcHead) {
		if (scoringType == ScoringType.ChainHead) {
			afterCutRawScore = 0;
		} else if (
			scoringType == ScoringType.ArcHead ||
			scoringType == ScoringType.ArcHeadArcTail ||
			scoringType == ScoringType.ChainHeadArcTail
		) {
			afterCutRawScore = 30;
		} else {
			afterCutRawScore = clamp(Math.round(30 * cut.afterCutRating), 0, 30);
		}
	}
	var cutDistanceRawScore = 0;
	if (scoringType == ScoringType.ChainLink || scoringType == ScoringType.ChainLinkArcHead) {
		cutDistanceRawScore = 20;
	} else {
		var num = 1 - clamp(cut.cutDistanceToCenter / 0.3, 0, 1);
		cutDistanceRawScore = Math.round(15 * num);
	}

	return [beforeCutRawScore, afterCutRawScore, cutDistanceRawScore];
}

function ScoreForNote(eventType, cutInfo, scoringType) {
	if (eventType == NoteEventType.good) {
		const scores = CutScoresForNote(cutInfo, scoringType);
		const result = scores[0] + scores[1] + scores[2];

		return result > 115 ? -2 : result;
	} else {
		switch (eventType) {
			case NoteEventType.bad:
				return -2;
			case NoteEventType.miss:
				return -3;
			case NoteEventType.bomb:
				return -4;
		}
	}
}
