const dragDrop = require('drag-drop');
import {checkBSOR, NoteEventType} from '../open-replay-decoder';
import {checkSS} from '../ss-replay-decoder';
import {Mirror_Horizontal, Mirror_Horizontal_Note} from '../chirality-support';
import {MultiplierCounter} from '../utils/MultiplierCounter';

import {NoteCutDirection, difficultyFromName, clamp, ScoringType} from '../utils';

AFRAME.registerComponent('replay-loader', {
	schema: {
		playerID: {default: AFRAME.utils.getUrlParameter('playerID')},
		link: {default: AFRAME.utils.getUrlParameter('link')},
		isSafari: {default: false},
		difficulty: {default: AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus'},
		mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'},
		scoreId: {default: AFRAME.utils.getUrlParameter('scoreId')},
	},

	init: function () {
		this.replay = null;
		this.user = null;

		let captureThis = this;
		if (this.data.link.length) {
			setTimeout(() => this.fetchByFile(this.data.link, true), 300);
		} else if (this.data.scoreId.length) {
			captureThis.downloadReplay(null, this.data.scoreId);
		} else if (!this.data.playerID.length) {
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
				captureThis.downloadSSReplay(e.detail.hash);
			});
		}

		this.el.addEventListener('challengeloadend', e => {
			captureThis.challengeloadend(e.detail);
		});
	},

	downloadReplay: function (hash, scoreId, error) {
		this.el.sceneEl.emit('replayloadstart', null);
		fetch(
			'https://api.beatleader.xyz/score/' +
				(scoreId ? `${scoreId}?fallbackToRedirect=true` : `${this.data.playerID}/${hash}/${this.data.difficulty}/${this.data.mode}`)
		).then(async response => {
			let data = response.status == 200 ? await response.json() : null;
			if (data && data.playerId) {
				let splittedName = data.replay.split(/\.|-|\//);
				if (splittedName.length > 4 && splittedName.length < 12) {
					this.el.sceneEl.emit(
						'replayInfofetched',
						{
							hash: splittedName[splittedName.length - 2],
							leaderboardId: data.leaderboardId,
							difficulty: difficultyFromName(splittedName[splittedName.length - 4]),
							mode: splittedName[splittedName.length - 3],
						},
						null
					);
				}

				checkBSOR(data.replay, true, replay => {
					if (replay && replay.frames) {
						if (replay.frames.length == 0) {
							this.el.sceneEl.emit('replayloadfailed', {error: 'Replay broken, redownload and reinstall mod, please'}, null);
						} else {
							this.replay = replay;
							const jd = replay.info.jumpDistance > 5 ? replay.info.jumpDistance : undefined;
							this.el.sceneEl.emit(
								'replayfetched',
								{hash: replay.info.hash, difficulty: difficultyFromName(replay.info.difficulty), mode: replay.info.mode, jd},
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
						avatar: this.user.avatar,
						country: this.user.country,
						countryIcon: `assets/flags/${this.user.country.toLowerCase()}.png`,
						profileLink: `https://beatleader.xyz/u/${this.user.id}`,
						id: this.user.id,
					},
					null
				);
				let profileSettings = data.player.profileSettings;
				if (profileSettings) {
					this.el.sceneEl.emit('colorsFetched', {playerId: data.player.id, features: profileSettings}, null);
				}
				fetch('https://api.beatleader.xyz/watched/' + data.id, {credentials: 'include'});
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

	downloadSSReplay: function (hash) {
		this.el.sceneEl.emit('replayloadstart', null);
		fetch(`/cors/score-saber/api/leaderboard/by-hash/${hash}/info?difficulty=${difficultyFromName(this.data.difficulty)}`, {
			referrer: 'https://www.beatlooser.com',
		}).then(res => {
			res.json().then(leaderbord => {
				checkSS(`/cors/score-saber/game/replays/${leaderbord.id}-${this.data.playerID}.dat`, true, replay => {
					if (replay.frames) {
						this.replay = replay;
						this.el.sceneEl.emit(
							'replayfetched',
							{hash: replay.info.hash, difficulty: replay.info.difficulty, mode: replay.info.mode},
							null
						);
						if (this.challenge) {
							this.processScores();
						}
					} else {
						if (replay.errorMessage && replay.errorMessage != 'Replay not found. Try better ranked play.') {
							this.el.sceneEl.emit('replayloadfailed', {error: replay.errorMessage}, null);
						} else {
							this.downloadReplay(hash);
						}
					}
				});
			});
		});
		this.fetchSSPlayer(this.data.playerID);
	},

	fetchByFile: function (file, itsLink) {
		this.el.sceneEl.emit('replayloadstart', null);
		checkBSOR(file, itsLink, replay => {
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
				this.fetchSSFile(file, itsLink);
			}
		});
	},

	fetchSSFile: function (file, itsLink) {
		if (!itsLink && file.size > 40000000) {
			// 40 MB cap
			this.el.sceneEl.emit('replayloadfailed', {error: 'File is too big'}, null);
			return;
		}
		checkSS(file, itsLink, replay => {
			if (replay.frames) {
				this.replay = replay;
				this.cleanup && this.cleanup();
				this.el.sceneEl.emit('replayfetched', {hash: replay.info.hash, difficulty: replay.info.difficulty, mode: replay.info.mode}, null);
				if (this.challenge) {
					this.processScores();
				}
			} else {
				this.el.sceneEl.emit('replayloadfailed', {error: replay.errorMessage}, null);
			}
		});
		let playerId = (itsLink ? file : file.name).split(/\.|-|\//).find(el => (el.length == 16 || el.length == 17) && parseInt(el, 10));
		if (playerId) {
			this.fetchSSPlayer(playerId);
		}
	},

	fetchPlayer: function (playerID) {
		fetch(`https://api.beatleader.xyz/player/${playerID}`).then(res => {
			res.json().then(data => {
				this.user = data;
				this.el.sceneEl.emit(
					'userloaded',
					{
						name: this.user.name,
						avatar: this.user.avatar,
						country: this.user.country,
						countryIcon: `assets/flags/${this.user.country.toLowerCase()}.png`,
						profileLink: `https://beatleader.xyz/u/${this.user.id}`,
						id: this.user.id,
					},
					null
				);
			});
		});
	},

	fetchSSPlayer: function (playerID) {
		fetch(`/cors/score-saber/api/player/${playerID}/full`, {referrer: 'https://www.beatlooser.com'}).then(res => {
			res.json().then(data => {
				this.user = data;
				this.el.sceneEl.emit(
					'userloaded',
					{
						name: this.user.name,
						avatar: this.user.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/'),
						country: this.user.country,
						countryIcon: `assets/flags/${this.user.country.toLowerCase()}.png`,
						profileLink: `https://scoresaber.com/u/${this.user.id}`,
						id: this.user.id,
					},
					null
				);
			});
		});
	},

	processScores: function () {
		const replay = this.replay;
		const map = this.challenge.beatmaps[this.challenge.mode][this.challenge.difficulty];
		var mapnotes = [].concat(map._notes, map._chains);

		mapnotes = mapnotes
			.sort((a, b) => {
				return a._time - b._time;
			})
			.filter(a => a._type == 0 || a._type == 1);
		var leftHanded = this.applyLeftHanded(map, replay);
		this.applyModifiers(map, replay);
		this.setIds(map, replay);

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

		var group,
			groupIndex,
			groupTime,
			offset = 0,
			stop = false;

		const processGroup = () => {
			for (var j = 0; j < group.length; j++) {
				const mapnote = mapnotes[group[j]];
				for (var m = 0; m < group.length; m++) {
					const replaynote = noteStructs[groupIndex + offset + m];
					const scoringType = mapnote._scoringType ? mapnote._scoringType + 2 : 3;

					if (!replaynote) {
						stop = true;
						return;
					}

					if (
						replaynote.index == undefined &&
						(replaynote.id == mapnote._id || replaynote.id == mapnote._idWithScoring || replaynote.id == mapnote._idWithAlternativeScoring)
					) {
						replaynote.index = group[j];
						replaynote.colorType = mapnote._type;
						replaynote.lineIndex = mapnote._lineIndex;
						replaynote.cutDirection = mapnote._cutDirection;
						replaynote.lineLayer = mapnote._lineLayer;
						replaynote.mapnote = mapnote;
						replaynote.scoringType = scoringType - 2;
						mapnote.found = true;
						break;
					}
				}
			}
		};

		for (var i = 0; i < mapnotes.length && !stop; i++) {
			if (!group) {
				if (i + offset == noteStructs.length) {
					group = [];
					break;
				}

				if (mapnotes[i]._songTime < noteStructs[i + offset].spawnTime - 0.0001 && !mapnotes[i]._tailTime && !replay.ssReplay) {
					offset--;
					continue;
				}
				if (i > 0 && noteStructs.length > mapnotes.length && noteStructs[i + offset].spawnTime == noteStructs[i + offset - 1].spawnTime) {
					offset++;
					i--;
					continue;
				}

				group = [i];
				groupIndex = i;
				groupTime = mapnotes[i]._tailTime || mapnotes[i]._time;
			} else {
				if (Math.abs(groupTime - mapnotes[i]._time) < 0.0001 || Math.abs(groupTime - mapnotes[i]._tailTime) < 0.0001) {
					group.push(i);
				} else {
					processGroup();
					group = null;
					i--;
				}
			}
		}
		if (group) {
			processGroup();
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
			return 0;
		});

		for (var i = 0; i < allStructs.length; i++) {
			var note = allStructs[i];
			note.i = i;
			if (!note.score) {
				note.score = ScoreForNote(note.eventType, note.cutInfo, note.scoringType);
			}
		}

		var energy = 0.5;
		var score = 0,
			maxScore = 0,
			fcScore = 0,
			combo = 0,
			misses = 0;

		const maxCounter = new MultiplierCounter();
		const normalCounter = new MultiplierCounter();

		for (var i = 0; i < allStructs.length; i++) {
			let note = allStructs[i];

			var scoreForMaxScore = 115;
			if (note.scoringType == ScoringType.BurstSliderHead) {
				scoreForMaxScore = 85;
			} else if (note.scoringType == ScoringType.BurstSliderElement) {
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
						if (note.scoringType == ScoringType.BurstSliderElement) {
							energy -= 0.025;
						} else {
							energy -= 0.1;
						}
						break;
					case -3: // miss
					case -4: // bomb
						if (note.scoringType == ScoringType.BurstSliderElement) {
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
				if (note.scoringType == ScoringType.BurstSliderElement) {
					energy += 1 / 500;
				} else {
					energy += 0.01;
				}
				if (energy > 1) {
					energy = 1;
				}
				combo++;
			}

			note.multiplier = normalCounter.Multiplier;
			note.totalScore = score;
			note.combo = combo;
			note.misses = misses;
			note.energy = energy;
			note.maxScore = scoreForMaxScore;

			if (note.isBlock) {
				note.accuracy = (note.totalScore / maxScore) * 100;
				note.fcAccuracy = (fcScore / maxScore) * 100;
			} else {
				note.accuracy = i == 0 ? 0 : allStructs[i - 1].accuracy;
				note.fcAccuracy = i == 0 ? 100 : allStructs[i - 1].fcAccuracy;
			}
		}
		this.allStructs = allStructs;
		this.notes = noteStructs;
		this.bombs = bombStructs;
		this.walls = wallStructs;

		this.el.sceneEl.emit('replayloaded', {notes: allStructs, replay: replay, leftHanded}, null);
	},

	applyLeftHanded: function (map, replay) {
		if (map && replay && replay.notes) {
			var mapnotes = [].concat(map._notes, map._chains);
			mapnotes = mapnotes
				.sort((a, b) => {
					return a._time - b._time;
				})
				.filter(a => a._type == 0 || a._type == 1);

			var replayNotes = replay.notes;
			replayNotes = replayNotes
				.sort((a, b) => {
					return a.spawnTime - b.spawnTime;
				})
				.filter(a => a.eventType != NoteEventType.bomb);

			let unIndex = 0;
			let notFound = false;
			for (let i = 0; i < mapnotes.length - 1; i++) {
				if (
					(i == 0 || mapnotes[i - 1]._time.toFixed(2) != mapnotes[i]._time.toFixed(2)) &&
					mapnotes[i]._time.toFixed(2) != mapnotes[i + 1]._time.toFixed(2)
				) {
					unIndex = i;
					break;
				} else if (i == mapnotes.length - 2) {
					notFound = true;
				}
			}

			let checkAndMirror = (replayNote, mapNote, mape, skip) => {
				if (mapNote && replayNote) {
					let mirroredNote = Object.assign({}, mapNote);
					Mirror_Horizontal_Note(mirroredNote, 4, true);

					const replayNoteId = replayNote.noteID;
					const mirroredNoteId =
						mirroredNote._lineIndex * 1000 + mirroredNote._lineLayer * 100 + mirroredNote._type * 10 + mirroredNote._cutDirection;

					const scoringType = mirroredNote._scoringType ? mirroredNote._scoringType + 2 : 3;
					if (!skip && (replayNoteId == mirroredNoteId || replayNoteId == mirroredNoteId + scoringType * 10000)) {
						Mirror_Horizontal(mape, 4, true, false);
						return true;
					}

					return false;
				}

				return false;
			};

			var result = checkAndMirror(replayNotes ? replayNotes[unIndex] : null, mapnotes ? mapnotes[unIndex] : null, map, notFound);

			if (notFound && mapnotes.length > 2) {
				result = checkAndMirror(replayNotes ? replayNotes[unIndex + 2] : null, mapnotes ? mapnotes[unIndex + 2] : null, map, false);
			}

			return result;
		}
	},

	challengeloadend: function (event) {
		this.challenge = event;
		if (!this.notes && this.replay) {
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
			if (mapnote._scoringType == ScoringType.BurstSliderHead) {
				altscoringType = ScoringType.SliderHead + 2;
			} else if (mapnote._scoringType == ScoringType.SliderHead) {
				altscoringType = ScoringType.BurstSliderHead + 2;
			} else if (
				gameVersion >= 29 &&
				mapnote._scoringType == ScoringType.BurstSliderElement &&
				mapnote._sliceIndex == mapnote._sliceCount - 1
			) {
				id = mapnote._tailLineIndex * 1000 + mapnote._tailLineLayer * 100 + colorType * 10 + cutDirection;
			}
			mapnote._idWithAlternativeScoring = id + altscoringType * 10000;
		});
	},
});

function CutScoresForNote(cut, scoringType) {
	var beforeCutRawScore = 0;
	if (scoringType != ScoringType.BurstSliderElement) {
		if (scoringType == ScoringType.SliderTail) {
			beforeCutRawScore = 70;
		} else {
			beforeCutRawScore = clamp(Math.round(70 * cut.beforeCutRating), 0, 70);
		}
	}
	var afterCutRawScore = 0;
	if (scoringType != ScoringType.BurstSliderElement) {
		if (scoringType == ScoringType.BurstSliderHead) {
			afterCutRawScore = 0;
		} else if (scoringType == ScoringType.SliderHead) {
			afterCutRawScore = 30;
		} else {
			afterCutRawScore = clamp(Math.round(30 * cut.afterCutRating), 0, 30);
		}
	}
	var cutDistanceRawScore = 0;
	if (scoringType == ScoringType.BurstSliderElement) {
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
