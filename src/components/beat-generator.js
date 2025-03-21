import {EaseType, Interpolate} from '../utils';

const BEAT_WARMUP_SPEED = 200;
const BEAT_WARMUP_TIME = 0.3;

let skipDebug = AFRAME.utils.getUrlParameter('skip') || 0;
skipDebug = parseInt(skipDebug, 10);

let queryJD = AFRAME.utils.getUrlParameter('jd');
if (queryJD.length == 0) {
	queryJD = null;
} else {
	queryJD = parseFloat(queryJD);
	if (queryJD < 5 || queryJD > 50) {
		queryJD = null;
	}
}

/**
 * Load beat data (all the beats and such).
 */
AFRAME.registerComponent('beat-generator', {
	dependencies: ['stage-colors'],

	schema: {
		moveTime: {default: BEAT_WARMUP_TIME},
		moveSpeed: {default: BEAT_WARMUP_SPEED},
		difficulty: {type: 'string'},
		isPlaying: {default: false},
		mode: {default: 'Standard'},
		noEffects: {default: false},
	},

	orientationsHumanized: ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'],

	horizontalPositions: [-0.75, -0.25, 0.25, 0.75],

	init: function () {
		this.audioAnalyserEl = document.getElementById('audioanalyser');
		this.beatData = null;
		this.customData = null;
		this.beatDataProcessed = false;

		this.beatsTime = undefined;
		this.eventsTime = undefined;
		this.bpm = undefined;
		this.colors = {};
		this.spawnRotation = {rotation: 0};
		this.spawnRotationKeys = [];
		this.spawnRotations = {};

		this.beatContainer = document.getElementById('beatContainer');
		this.stageColors = this.el.components['stage-colors'];
		this.twister = document.getElementById('twister');
		this.leftStageLasers = document.getElementById('leftStageLasers');
		this.rightStageLasers = document.getElementById('rightStageLasers');

		this.movementData = {
			noteJumpMovementSpeed: 0,
			targetNoteJumpMovementSpeed: 0,
			beatOffset: 0,
			jumpDistance: 0,
			jumpDuration: 0,
			halfJumpDuration: 0,
			moveDuration: 0.5,
			spawnAheadTime: 0,
			interpolation: {
				fromValue: 0,
				toValue: 0,
				fromTime: 0,
				duration: 0,
				easeType: EaseType.None,

				setValues: function (fromValue, toValue, fromTime, toTime, easeType) {
					this.fromValue = fromValue;
					this.toValue = toValue;
					this.fromTime = fromTime;
					this.easeType = easeType;
					this.duration = toTime - fromTime;
				},

				getValue: function (time) {
					if (this.easeType !== EaseType.None) {
						const t = this.duration > 0 ? Math.min(Math.max((time - this.fromTime) / this.duration, 0), 1) : 1;
						return this.fromValue + (this.toValue - this.fromValue) * Interpolate(t, this.easeType);
					}
					return time >= this.fromTime + this.duration ? this.toValue : this.fromValue;
				},
			},
		};

		this.el.addEventListener('cleargame', this.clearBeats.bind(this));
		this.el.addEventListener('challengeloadend', evt => {
			this.beatmaps = evt.detail.beatmaps;
			this.beatData = this.beatmaps[evt.detail.mode][this.data.difficulty || evt.detail.difficulty];
			this.customData = evt.detail.customData[evt.detail.mode][this.data.difficulty || evt.detail.difficulty];
			this.beatSpeeds = evt.detail.beatSpeeds;
			this.beatOffsets = evt.detail.beatOffsets;
			this.info = evt.detail.info;

			// Mapping extensions.
			// https://github.com/joshwcomeau/beatmapper/tree/master/src/helpers/obstacles.helpers.js
			if (evt.detail.mappingExtensions && evt.detail.mappingExtensions.isEnabled) {
				this.mappingExtensions = evt.detail.mappingExtensions;
			} else {
				this.mappingExtensions = null;
			}

			if (this.customData && this.customData._requirements) {
				this.noodleExtensions = this.customData._requirements.includes('Noodle Extensions');
			}
		});
		this.el.addEventListener('replayloadstart', evt => {
			this.replayFetched = false;
			this.beatData = null;
			this.customData = null;
			this.beatDataProcessed = false;

			this.beatsTime = undefined;
			this.eventsTime = undefined;

			this.bpm = undefined;
			this.colors = {};
			this.spawnRotation = {rotation: 0};
			this.spawnRotationKeys = [];
			this.spawnRotations = {};
			this.beatData = null;
			this.beatsPreloadTime = undefined;
			this.clearBeats(true);
		});
		this.el.addEventListener('replayfetched', evt => {
			if (evt.detail.jd != null) {
				this.jdToSet = evt.detail.jd;
				if (this.bpm) {
					this.updateJD(evt.detail.jd);
				}
			}

			this.replayFetched = true;
		});

		this.el.addEventListener('songprocessingfinish', evt => {
			this.processBeats();
		});
		this.el.sceneEl.addEventListener('colorChanged', e => {
			if (e.detail.color) {
				this.colors[e.detail.hand] = e.detail.color;
			}
		});

		setInterval(() => {
			this.manualTick();
		}, 0);
	},

	beatSpeedOrDefault: function () {
		const result = this.beatSpeeds[this.data.mode][this.data.difficulty];
		if (result <= 0) {
			switch (this.data.difficulty) {
				case 'Easy':
				case 'Normal':
				case 'Hard':
					return 10;
				case 'Expert':
					return 12;
				case 'ExpertPlus':
					return 16;
				default:
					return 5;
			}
		} else {
			return result;
		}
	},

	beatOffsetOrDefault: function () {
		const result = this.beatOffsets[this.data.mode][this.data.difficulty];
		if (result <= 0) {
			return 0.5;
		} else {
			return result;
		}
	},

	/**
	 * Load the beat data into the game.
	 */
	processBeats: function () {
		const data = this.data;
		// Reset variables used during playback.
		// Beats spawn ahead of the song and get to the user in sync with the music.
		this.beatsTime = 0;
		this.beatsPreloadTime = this.el.components.song.getCurrentTime();
		this.beatData._events.sort(lessThan);
		this.beatData._obstacles.sort(lessThan);
		this.beatData._notes.sort(lessThan);
		this.movementData.targetNoteJumpMovementSpeed =
			this.movementData.noteJumpMovementSpeed =
			this.movementData.baseNoteJumpMovementSpeed =
				this.beatSpeedOrDefault();
		this.movementData.beatOffset = this.beatOffsetOrDefault();
		this.movementData.warmupPosition = -data.moveTime * data.moveSpeed;
		this.movementData.warmupSpeed = data.moveSpeed;
		this.bpm = this.info._beatsPerMinute;

		this.updateJD(queryJD, true);
		if (this.jdToSet && !queryJD) {
			this.updateJD(this.jdToSet);
		}

		// Some events have negative time stamp to initialize the stage.
		const events = this.beatData._events;
		if (events.length && events[0]._time < 0) {
			for (let i = 0; events[i]._time < 0; i++) {
				this.generateEvent(events[i]);
			}
		}

		let spawnRotation = 0;

		events.forEach(event => {
			if ((event._type == 15 || event._type == 14) && event._value <= 24) {
				spawnRotation += (60 - (event._value < 4 ? event._value : event._value + 1) * 15) * (event._inverted ? -1 : 1);
				this.spawnRotationKeys.push(event._songTime);
				this.spawnRotations[event._songTime] = {rotation: spawnRotation, early: event._type == 14};
			}
		});
		this.beatDataProcessed = true;
		console.log('[beat-generator] Finished processing beat data.');
	},

	/**
	 * Generate beats and stuff according to timestamp.
	 */
	manualTick: function () {
		const song = this.el.components.song;
		const data = this.data;
		if (!this.data.isPlaying || !this.beatData || !this.replayFetched) {
			return;
		}

		var prevBeatsTime;
		var prevEventsTime;

		if (this.beatsPreloadTime === undefined) {
			prevBeatsTime = this.beatsTime + skipDebug;
			prevEventsTime = this.eventsTime + skipDebug;

			// Get current song time.
			this.beatsTime = song.getCurrentTime() + this.movementData.halfJumpDuration + this.data.moveTime;

			this.eventsTime = song.getCurrentTime();
		} else {
			prevBeatsTime = this.beatsPreloadTime;
			prevEventsTime = this.beatsPreloadTime;

			// Song is not playing and is preloading beats, use maintained beat time.
			this.beatsTime = this.beatsPreloadTime + this.movementData.halfJumpDuration + this.data.moveTime;
			this.eventsTime = song.getCurrentTime();
		}

		if (!this.isSeeking && this.beatsTime <= prevBeatsTime) {
			this.beatsTime = prevBeatsTime;
			this.eventsTime = prevEventsTime;
			return;
		}

		// Load in stuff scheduled between the last timestamp and current timestamp.
		// Beats.
		const beatsTime = this.beatsTime + skipDebug;
		const eventsTime = this.eventsTime + skipDebug;

		if (this.beatData._njsEvents && this.beatData._njsEvents.length > 0) {
			const njsEvents = this.beatData._njsEvents;
			for (let i = 0; i < njsEvents.length; i++) {
				let event = njsEvents[i];
				if (event._songTime > prevEventsTime && event._songTime <= eventsTime) {
					const sameTypeEventData = i < njsEvents.length - 1 && njsEvents[i + 1];
					const time = event._songTime;
					let toTime = time;
					const relativeNoteJumpSpeed = event._delta;
					let toValue = relativeNoteJumpSpeed;
					let easeType = EaseType.None;
					if (sameTypeEventData && sameTypeEventData._easing !== EaseType.None) {
						toTime = sameTypeEventData._songTime;
						toValue = sameTypeEventData._delta;
						easeType = sameTypeEventData._easing;
					}
					this.movementData.interpolation.setValues(relativeNoteJumpSpeed, toValue, time, toTime, easeType);
				}
			}

			this.movementData.targetNoteJumpMovementSpeed = Math.max(
				this.movementData.baseNoteJumpMovementSpeed + this.movementData.interpolation.getValue(eventsTime),
				0.01
			);

			if (this.movementData.noteJumpMovementSpeed !== this.movementData.targetNoteJumpMovementSpeed) {
				this.movementData.noteJumpMovementSpeed = this.movementData.targetNoteJumpMovementSpeed;
				this.movementData.interpolation.updatedThisFrame = true;
				this.updateJD(null, true);
			}
		}

		var oldSpawnRotation = this.spawnRotation;
		const rotations = this.spawnRotationKeys;
		for (let i = 0; i < rotations.length; ++i) {
			let noteTime = rotations[i];
			if (noteTime > prevEventsTime && noteTime <= eventsTime) {
				this.spawnRotation = this.spawnRotations[rotations[i]].rotation;
				if (this.spawnRotation != oldSpawnRotation) {
					this.el.sceneEl.emit('spawnRotationChanged', {spawnRotation: this.spawnRotation, oldSpawnRotation}, false);
					oldSpawnRotation = this.spawnRotation;
				}
			}
		}

		const notes = this.beatData._notes;
		for (let i = 0; i < notes.length; ++i) {
			let noteTime = notes[i]._songTime;
			if (noteTime > prevBeatsTime && noteTime <= beatsTime) {
				notes[i].time = noteTime;
				this.generateBeat(notes[i]);
			}
		}

		const sliders = this.beatData._sliders;
		for (let i = 0; i < sliders.length; ++i) {
			let noteTime = sliders[i]._songTime;
			if (noteTime > prevBeatsTime && noteTime <= beatsTime) {
				sliders[i].time = noteTime;
				this.generateSlider(sliders[i]);
			}
		}

		const chains = this.beatData._chains;
		for (let i = 0; i < chains.length; ++i) {
			let noteTime = chains[i]._songTime;
			if (noteTime > prevBeatsTime && noteTime <= beatsTime) {
				chains[i].time = noteTime;
				this.generateChain(chains[i]);
			}
		}

		// Walls.
		const obstacles = this.beatData._obstacles;
		for (let i = 0; i < obstacles.length; ++i) {
			let noteTime = obstacles[i]._songTime;
			let noteDuration = obstacles[i]._songDuration;
			if (this.isSeeking) {
				if (noteTime + noteDuration + 2 > prevBeatsTime && noteTime - noteDuration - 2 <= beatsTime) {
					this.generateWall(obstacles[i]);
				}
			} else {
				if (noteTime > prevBeatsTime && noteTime <= beatsTime) {
					this.generateWall(obstacles[i]);
				}
			}
		}

		if (!this.data.noEffects && !this.isSeeking) {
			// Stage events.
			const events = this.beatData._events;
			for (let i = 0; i < events.length; ++i) {
				let noteTime = events[i]._songTime;
				if (noteTime > prevEventsTime && noteTime <= eventsTime) {
					this.generateEvent(events[i]);
				}
			}
		}

		if (this.isSeeking) {
			this.isSeeking = false;
		}

		if (this.beatsPreloadTime === undefined) {
			return;
		} else {
			// Finished preload.
			this.el.sceneEl.emit('beatloaderpreloadfinish', null, false);
			this.beatsPreloadTime = undefined;
		}
	},

	seek: function (time) {
		this.clearBeats(true);
		this.beatsTime = time;
		this.isSeeking = true;
		this.el.sceneEl.components['beat-hit-sound'].beatSeekReset = true;

		if (this.getRotation(time) != this.spawnRotation.rotation) {
			this.el.sceneEl.emit('spawnRotationChanged', {spawnRotation: this.getRotation(time), oldSpawnRotation: this.spawnRotation}, false);
		}
	},

	getRotation: function (time) {
		const rotations = this.spawnRotationKeys;
		if (rotations.length == 0) return 0;

		for (let i = rotations.length - 1; i >= 0; i--) {
			let eventTime = rotations[i];
			var timeDiff = eventTime - time;
			if (Math.abs(timeDiff) < 0.001 || timeDiff < 0) {
				var spawnRotation = this.spawnRotations[eventTime];

				if (Math.abs(timeDiff) < 0.001) {
					if (spawnRotation.early) {
						return spawnRotation.rotation;
					} else if (i == 0) {
						return 0;
					} else {
						this.spawnRotations[rotations[i - 1]].rotation;
					}
				} else {
					return spawnRotation.rotation;
				}
			}
		}

		return 0;
	},

	generateBeat: function (note) {
		// if (Math.random() < 0.8) { note._type = 3; } // To debug mines.
		let color;
		let type;

		if (note.sliderhead) {
			type = 'sliderhead';
		} else {
			type = note._cutDirection === 8 ? 'dot' : 'arrow';
		}

		if (note._type === 0) {
			color = 'red';
		} else if (note._type === 1) {
			color = 'blue';
		} else {
			type = 'mine';
			color = undefined;
		}

		const beatEl = this.requestBeat(type, color);
		if (!beatEl) {
			return;
		}

		if (!beatEl.components.beat || !beatEl.components.beat.data) {
			beatEl.addEventListener('loaded', () => {
				this.doGenerateBeat(beatEl, note, type, color);
			});
		} else {
			this.doGenerateBeat(beatEl, note, type, color);
		}
	},

	doGenerateBeat: (function () {
		const beatObj = {};

		return function (beatEl, note, type, color) {
			const data = this.data;
			beatObj.movementData = this.movementData;
			beatObj.color = color;
			beatObj.cutDirection = this.orientationsHumanized[note._cutDirection];

			if (note.cutDirectionAngleOffset !== undefined) {
				beatObj.rotationOffset = note.cutDirectionAngleOffset;
			} else if (note._angleOffset !== undefined) {
				beatObj.rotationOffset = note._angleOffset;
			} else {
				beatObj.rotationOffset = 0;
			}

			beatObj.size = 0.4;
			beatObj.type = type;
			beatObj.index = note._index;
			beatObj.time = note._songTime;
			beatObj.spawnRotation = this.getRotation(note._songTime);
			beatObj.moveTime = data.moveTime;
			beatObj.beforeJumpLineLayer = note._beforeJumpLineLayer;

			if (note._sliceCount || note.sliderhead) {
				var slider = note;

				if (note.sliderhead) {
					slider = note.sliderhead;
					beatObj.sliceIndex = 0;
					beatObj.headCutDirection = beatObj.cutDirection;
				} else {
					beatObj.sliceIndex = slider._sliceIndex;
					beatObj.headCutDirection = this.orientationsHumanized[slider._headCutDirection];
				}

				beatObj.tailHorizontalPosition = slider._tailLineIndex;
				beatObj.tailVerticalPosition = slider._tailLineLayer;
				beatObj.tailTime = slider._songTailTime;
				beatObj.sliceCount = slider._sliceCount;
				beatObj.squishAmount = slider._squishAmount;
			}

			if (this.colors['right']) {
				beatObj.blue = this.colors['right'];
			}

			if (this.colors['left']) {
				beatObj.red = this.colors['left'];
			}

			if (this.mappingExtensions) {
				if (note._lineIndex <= -1000 || note._lineIndex >= 1000) {
					note._lineIndex = note._lineIndex < 0 ? note._lineIndex / 1000 + 1 : note._lineIndex / 1000 - 1;
				}

				if (note._lineLayer <= -1000 || note._lineLayer >= 1000) {
					note._lineLayer = note._lineLayer < 0 ? note._lineLayer / 1000 + 1 : note._lineLayer / 1000 - 1;
				}

				if (this.mappingExtensions.colWidth) {
					beatObj.size *= this.mappingExtensions.colWidth;
				}

				if (note._cutDirection >= 1000 && note._cutDirection <= 1360) {
					beatObj.rotationOffset = 1000 - note._cutDirection;
				} else if (note._cutDirection >= 2000 && note._cutDirection <= 2360) {
					beatObj.rotationOffset = 2000 - note._cutDirection;
				}
			}
			beatObj.horizontalPosition = note._lineIndex;
			beatObj.verticalPosition = note._lineLayer;
			beatObj.noteId = note._id;
			beatObj.noteIdWithScoring = note._idWithScoring;

			if (this.noodleExtensions && note._customData) {
				if (note._customData._position) {
					beatObj.horizontalPosition = note._customData._position[0] + 4 / 2;
					beatObj.verticalPosition = note._customData._position[1];
				}
				if (note._customData._cutDirection || note._customData._cutDirection === 0) {
					beatObj.rotationOffset = note._customData._cutDirection;
				}

				if (note._customData._rotation) {
					if (Array.isArray(note._customData._rotation)) {
						beatObj.spawnRotation = -note._customData._rotation[1];
					} else {
						beatObj.spawnRotation = note._customData._rotation;
					}
				}
			}

			beatObj.flip = note._flipLineIndex !== undefined;
			beatObj.flipHorizontalPosition = note._flipLineIndex;
			beatObj.flipYSide = note._flipYSide;

			beatEl.setAttribute('beat', beatObj);
			beatEl.components.beat.onGenerate(this.mappingExtensions);
			beatEl.play();
		};
	})(),

	generateChain: function (note) {
		let color;

		if (note._type === 0) {
			color = 'red';
		} else if (note._type === 1) {
			color = 'blue';
		} else {
			type = 'mine';
			color = undefined;
		}

		var type = 'sliderchain';

		const beatEl = this.requestBeat(type, color);
		if (!beatEl) {
			return;
		}

		if (!beatEl.components.beat || !beatEl.components.beat.data) {
			beatEl.addEventListener('loaded', () => {
				this.doGenerateBeat(beatEl, note, type, color);
			});
		} else {
			this.doGenerateBeat(beatEl, note, type, color);
		}
	},

	generateWall: function (wall) {
		const wallEl = this.el.sceneEl.components.pool__wall.requestEntity();
		if (!wallEl) {
			return;
		}

		if (!wallEl.components.wall || !wallEl.components.wall.data) {
			wallEl.addEventListener('loaded', () => {
				this.doGenerateWall(wallEl, wall);
			});
		} else {
			this.doGenerateWall(wallEl, wall);
		}
	},

	doGenerateWall: (function () {
		const wallObj = {};
		const WALL_THICKNESS = 0.6;

		return function (wallEl, wall) {
			const data = this.data;

			if (wall._customData && (wall._customData._noteJumpMovementSpeed || wall._customData._noteJumpStartBeatOffset)) {
				wallObj.movementData = {
					noteJumpMovementSpeed: wall._customData._noteJumpMovementSpeed
						? wall._customData._noteJumpMovementSpeed
						: this.movementData.noteJumpMovementSpeed,
					noteJumpStartBeatOffset: wall._customData._noteJumpStartBeatOffset
						? wall._customData._noteJumpStartBeatOffset
						: this.movementData.noteJumpStartBeatOffset,
					halfJumpDuration:
						(60 / this.bpm) *
						this.calculateHalfJumpDuration(
							this.bpm,
							wallObj.movementData.noteJumpMovementSpeed,
							wallObj.movementData.noteJumpStartBeatOffset
						),
					halfJumpPosition: -wallObj.movementData.noteJumpStartBeatOffset * wallObj.movementData.noteJumpMovementSpeed,
					warmupPosition: -data.moveTime * data.moveSpeed,
					warmupSpeed: data.moveSpeed,
				};
			} else {
				wallObj.movementData = this.movementData;
			}

			wallObj.durationSeconds = wall._songDuration;
			wallObj.horizontalPosition = wall._lineIndex;
			if (wall._lineLayer != undefined) {
				wallObj.verticalPosition = wall._lineLayer;
				wallObj.height = wall._height;
				wallObj.isV3 = true;
			} else {
				wallObj.isV3 = false;
			}
			wallObj.isCeiling = wall._type === 1;
			if (wall._width < 0) {
				wallObj.horizontalPosition += wall._width;
			}
			wallObj.width = Math.abs(wall._width * WALL_THICKNESS);

			wallObj.spawnRotation = this.getRotation(wall._songTime);
			wallObj.time = wall._songTime;
			wallObj.moveTime = data.moveTime;

			if (this.customData && this.customData._obstacleColor) {
				wallObj.color = this.customData._obstacleColor;
			}

			wallObj.scale = null;
			wallObj.color = null;
			wallObj.customPosition = null;
			wallObj.localRotation = null;
			wallObj.definitePosition = null;

			if (wall._customData) {
				if (wall._customData._scale) {
					wallObj.scale = {x: wall._customData._scale[0], y: wall._customData._scale[1], z: wall._customData._scale[2]};
				}

				if (wall._customData._position) {
					wallObj.isV3 = true;
					wallObj.horizontalPosition = wall._customData._position[0] + 2;
					wallObj.verticalPosition = wall._customData._position[1];
				}

				if (wall._customData._color) {
					wallObj.color = new THREE.Color(wall._customData._color[0], wall._customData._color[1], wall._customData._color[2]);
				}

				if (wall._customData._localRotation) {
					wallObj.localRotation = new THREE.Euler(
						wall._customData._localRotation[0] * 0.0175,
						wall._customData._localRotation[1] * 0.0175,
						wall._customData._localRotation[2] * 0.0175,
						'YZX'
					);
				}

				if (wall._customData._rotation) {
					if (Array.isArray(wall._customData._rotation)) {
						wallObj.spawnRotation = new THREE.Vector3(
							wall._customData._rotation[0],
							wall._customData._rotation[1],
							wall._customData._rotation[2]
						);
					} else {
						wallObj.spawnRotation = wall._customData._rotation;
					}
				}

				// Copium TODO: add animations support
				if (wall._customData._animation) {
					if (wall._customData._animation._definitePosition) {
						wall._customData._animation._definitePosition.forEach(element => {
							if (element.length >= 4 && element[3] == 1) {
								wallObj.definitePosition = new THREE.Vector3(element[0], element[1], -element[2]);
							}
						});
					}
				}
			}

			if (this.mappingExtensions) {
				if (wall._lineIndex <= -1000 || wall._lineIndex >= 1000) {
					wallObj.horizontalPosition = wall._lineIndex < 0 ? wall._lineIndex / 1000 + 1 : wall._lineIndex / 1000 - 1;
				}
				if (wall._width >= 1000 || wall._width <= -1000) {
					wallObj.width = (((wall._width <= -1000 ? wall._width + 2000 : wall._width) - 1000) / 1000) * WALL_THICKNESS;
				}
			}

			// Handle mapping extensions wall format.
			if (this.mappingExtensions) {
				const obstacleType = wall._type;

				if ((obstacleType >= 1000 && obstacleType <= 4000) || (obstacleType >= 4001 && obstacleType <= 4005000)) {
					let obsHeight;
					let startHeight = 0;
					var value = obstacleType;
					if (obstacleType >= 4001 && obstacleType <= 4100000) {
						value -= 4001;
						obsHeight = value / 1000;
						startHeight = value % 1000;
					} else {
						obsHeight = value - 1000;
					}

					var height = (obsHeight / 1000) * 5;
					height = height * 1000 + 1000;

					var layer = (startHeight / 750) * 5;
					layer = layer * 1000 + 1334;

					wallObj.verticalPosition = layer / 1000 - 2;
					wallObj.height = (height - 1000) / 1000;
					wallObj.isV3 = true;
				}
			}

			wallEl.setAttribute('wall', wallObj);

			wallEl.components.wall.onGenerate(this.mappingExtensions);
			wallEl.play();
		};
	})(),

	generateSlider: function (slider) {
		let color;

		if (slider._type === 0) {
			color = 'red';
		} else if (slider._type === 1) {
			color = 'blue';
		}

		const sliderEl = this.requestSlider(color);
		if (!sliderEl) {
			return;
		}

		if (!sliderEl.components.slider || !sliderEl.components.slider.data) {
			sliderEl.addEventListener('loaded', () => {
				this.doGenerateSlider(sliderEl, slider, color);
			});
		} else {
			this.doGenerateSlider(sliderEl, slider, color);
		}
	},

	doGenerateSlider: (function () {
		const beatObj = {};

		return function (beatEl, note, color) {
			const data = this.data;

			beatObj.color = color;
			beatObj.movementData = this.movementData;
			beatObj.cutDirection = this.orientationsHumanized[note._cutDirection];
			beatObj.tailCutDirection = this.orientationsHumanized[note._tailCutDirection];

			if (note.cutDirectionAngleOffset !== undefined) {
				beatObj.rotationOffset = note.cutDirectionAngleOffset;
			} else if (note._angleOffset !== undefined) {
				beatObj.rotationOffset = note._angleOffset;
			} else {
				beatObj.rotationOffset = 0;
			}

			beatObj.time = note._songTime;
			beatObj.tailTime = note._songTailTime;
			beatObj.hasTailNote = note.tail != null;
			beatObj.moveTime = data.moveTime;

			beatObj.spawnRotation = this.getRotation(note._songTime);
			beatObj.tailSpawnRotation = this.getRotation(note._songTailTime);

			if (this.colors['right']) {
				beatObj.blue = this.colors['right'];
			}

			if (this.colors['left']) {
				beatObj.red = this.colors['left'];
			}

			if (this.mappingExtensions) {
				if (note._lineIndex <= -1000 || note._lineIndex >= 1000) {
					note._lineIndex = note._lineIndex < 0 ? note._lineIndex / 1000 + 1 : note._lineIndex / 1000 - 1;
				}
				if (note._lineLayer <= -1000 || note._lineLayer >= 1000) {
					note._lineLayer = note._lineLayer < 0 ? note._lineLayer / 1000 + 1 : note._lineLayer / 1000 - 1;
				}
				if (this.mappingExtensions.colWidth) {
					beatObj.size *= this.mappingExtensions.colWidth;
				}
			}
			beatObj.horizontalPosition = note._lineIndex;
			beatObj.verticalPosition = note._lineLayer;

			beatObj.tailHorizontalPosition = note._tailLineIndex;
			beatObj.tailVerticalPosition = note._tailLineLayer;

			if (this.noodleExtensions && note._customData) {
				if (note._customData._position) {
					beatObj.horizontalPosition = note._customData._position[0] + 4 / 2;
					beatObj.verticalPosition = note._customData._position[1];
				}

				if (note._customData._tailPosition) {
					beatObj.tailHorizontalPosition = note._customData._tailPosition[0] + 4 / 2;
					beatObj.tailVerticalPosition = note._customData._tailPosition[1];
				}
			}

			beatObj.flipHorizontalPosition = note._flipLineIndex;
			beatObj.flipYSide = note._flipYSide;

			beatEl.setAttribute('slider', beatObj);
			beatEl.components.slider.onGenerate(this.mappingExtensions);
			beatEl.play();
		};
	})(),

	generateEvent: function (event) {
		switch (event._type) {
			case 0:
				this.stageColors.setColor('bg', event._value);
				break;
			case 1:
				this.stageColors.setColor('tunnel', event._value);
				break;
			case 2:
				this.stageColors.setColor('leftlaser', event._value);
				this.leftStageLasers.components['stage-lasers'].setVisible(event._value);
				break;
			case 3:
				this.stageColors.setColor('rightlaser', event._value);
				this.rightStageLasers.components['stage-lasers'].setVisible(event._value);
				break;
			case 4:
				this.stageColors.setColor('floor', event._value);
				break;
			case 8:
				this.twister.components.twister.pulse(event._value);
				break;
			case 9:
				// zoom was a bit disturbing
				this.twister.components.twister.pulse(event._value);
				break;
			case 12:
				this.leftStageLasers.components['stage-lasers'].setSpeed(event._value);
				break;
			case 13:
				this.rightStageLasers.components['stage-lasers'].setSpeed(event._value);
				break;
		}
	},

	requestBeat: function (type, color) {
		var beatPoolName = 'pool__beat-' + type;
		var pool;
		if (color) {
			beatPoolName += '-' + color;
		}
		pool = this.el.sceneEl.components[beatPoolName];
		if (!pool) {
			console.warn('Pool ' + beatPoolName + ' unavailable');
			return;
		}
		return pool.requestEntity();
	},

	requestSlider: function (color) {
		var beatPoolName = 'pool__slider';
		var pool;
		if (color) {
			beatPoolName += '-' + color;
		}
		pool = this.el.sceneEl.components[beatPoolName];
		if (!pool) {
			console.warn('Pool ' + beatPoolName + ' unavailable');
			return;
		}
		return pool.requestEntity();
	},

	calculateHalfJumpDuration: function (bpm, njs, offset) {
		let halfjump = 4;
		let num = 60 / bpm;

		// Need to repeat this here even tho it's in BeatmapInfo because sometimes we call this function directly
		if (njs <= 0.01)
			// Is it ok to == a 0f?
			njs = 10;

		while (njs * num * halfjump > 18) halfjump /= 2;

		halfjump += offset;
		if (halfjump < 0.25) halfjump = 0.25;

		return halfjump;
	},

	setNewJD: function (newJD) {
		this.jdToSet = newJD;
		this.updateJD(newJD, false);
	},

	updateJD: function (newJD, itsDefault = false) {
		if (this.beatData._njsEvents && this.beatData._njsEvents.length > 0 && newJD != null) {
			this.el.sceneEl.emit('jdDisabled', {}, false);
			return;
		}

		const movementData = this.movementData;
		const defaultHalfJumpDuration = this.calculateHalfJumpDuration(
			this.bpm,
			movementData.baseNoteJumpMovementSpeed,
			movementData.beatOffset
		);
		const defaultJumpDistance = (60 / this.bpm) * defaultHalfJumpDuration * movementData.noteJumpMovementSpeed * 2;

		var jt, jd;
		if (newJD != null) {
			jt = newJD / (60 / this.bpm) / movementData.noteJumpMovementSpeed / 2;
			jd = newJD;
		} else {
			jt = defaultHalfJumpDuration;
			jd = defaultJumpDistance;
		}

		movementData.jumpDistance = jd;
		movementData.halfJumpDuration = (60 / this.bpm) * jt;
		movementData.jumpDuration = movementData.halfJumpDuration * 2;
		movementData.halfJumpPosition = -movementData.halfJumpDuration * movementData.noteJumpMovementSpeed;

		if (!itsDefault || movementData.halfJumpDuration == null) {
			this.el.sceneEl.emit('jdCalculated', {jd, defaultJd: itsDefault ? defaultJumpDistance : null}, false);
		} else if (itsDefault) {
			this.el.sceneEl.emit('jdCalculated', {defaultJd: defaultJumpDistance}, false);
		}
	},

	/**
	 * Restart by returning all beats to pool.
	 */
	clearBeats: function (isSeeking) {
		if (!isSeeking) {
			this.beatsPreloadTime = 0;
			this.beatsTime = 0;
			this.eventsTime = 0;
		}
		for (let i = 0; i < this.beatContainer.children.length; i++) {
			let child = this.beatContainer.children[i];
			if (child.components.beat) {
				child.components.beat.returnToPool(true);
			}
			if (child.components.wall) {
				child.components.wall.returnToPool();
			}
		}
	},
});

function lessThan(a, b) {
	return a._time - b._time;
}
