import {BEAT_WARMUP_OFFSET, BEAT_WARMUP_SPEED, BEAT_WARMUP_TIME} from '../constants/beat';
import {NoteCutDirection, SWORD_OFFSET, clone} from '../utils';

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

const RIDICULOUS_MAP_EX_CONSTANT = 4001;
const WALL_HEIGHT_MIN = 0;
const WALL_HEIGHT_MAX = 1000;
const WALL_START_BASE = 100;
const WALL_START_MAX = 400;

/**
 * Load beat data (all the beats and such).
 */
AFRAME.registerComponent('beat-generator', {
	dependencies: ['stage-colors'],

	schema: {
		beatWarmupTime: {default: BEAT_WARMUP_TIME},
		beatWarmupSpeed: {default: BEAT_WARMUP_SPEED},
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
		this.beatContainer = document.getElementById('beatContainer');
		this.beatsTime = undefined;
		this.beatsPreloadTime = 0;
		this.bpm = undefined;
		this.stageColors = this.el.components['stage-colors'];
		// Beats arrive at sword stroke distance synced with the music.
		this.swordOffset = SWORD_OFFSET;
		this.twister = document.getElementById('twister');
		this.leftStageLasers = document.getElementById('leftStageLasers');
		this.rightStageLasers = document.getElementById('rightStageLasers');

		this.el.addEventListener('cleargame', this.clearBeats.bind(this));
		this.el.addEventListener('challengeloadend', evt => {
			this.beatmaps = evt.detail.beatmaps;
			this.beatData = this.beatmaps[evt.detail.mode][this.data.difficulty || evt.detail.difficulty];
			this.customData = evt.detail.customData[evt.detail.mode][this.data.difficulty || evt.detail.difficulty];
			this.beatSpeeds = evt.detail.beatSpeeds;
			this.beatOffsets = evt.detail.beatOffsets;
			this.info = evt.detail.info;
			this.processBeats();

			// Mapping extensions.
			// https://github.com/joshwcomeau/beatmapper/tree/master/src/helpers/obstacles.helpers.js
			if (evt.detail.mappingExtensions && evt.detail.mappingExtensions.isEnabled) {
				this.mappingExtensions = evt.detail.mappingExtensions;
				console.log(this.mappingExtensions);
			} else {
				this.mappingExtensions = null;
			}

			this.noodleExtensions = this.customData._requirements.includes("Noodle Extensions");

		});
		this.el.addEventListener('songprocessingfinish', evt => {
			this.beatsTime = 0;
		});
		this.el.addEventListener('replayfetched', evt => {
			if (evt.detail.jd != null) {
				if (this.bpm) {
					this.updateJD(evt.detail.jd);
				} else {
					this.jdToSet = evt.detail.jd;
				}
			}
		});
	},

	update: function (oldData) {
		if (!this.beatmaps) {
			return;
		}

		if ((oldData.difficulty && oldData.difficulty !== this.data.difficulty) || (oldData.mode && oldData.mode !== this.data.mode)) {
			this.beatData = this.beatmaps[this.data.mode][this.data.difficulty];
			if (this.beatData) {
				this.processBeats();
			}
		}
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
		// Reset variables used during playback.
		// Beats spawn ahead of the song and get to the user in sync with the music.
		this.beatsTime = 0;
		this.beatsPreloadTime = 0;
		this.beatData._events.sort(lessThan);
		this.beatData._obstacles.sort(lessThan);
		this.beatData._notes.sort(lessThan);
		this.beatSpeed = this.beatSpeedOrDefault();
		this.beatOffset = this.beatOffsetOrDefault();
		this.bpm = this.info._beatsPerMinute;

		this.updateJD(queryJD, true);
		if (this.jdToSet) {
			this.updateJD(this.jdToSet);
		}

		this.beatsPreloadTimeTotal = this.beatAnticipationTime + this.data.beatWarmupTime;

		// Some events have negative time stamp to initialize the stage.
		const events = this.beatData._events;
		if (events.length && events[0]._time < 0) {
			for (let i = 0; events[i]._time < 0; i++) {
				this.generateEvent(events[i]);
			}
		}

		this.beatDataProcessed = true;
		console.log('[beat-generator] Finished processing beat data.');
	},

	/**
	 * Generate beats and stuff according to timestamp.
	 */
	tick: function (time, delta) {
		const song = this.el.components.song;
		if (!this.data.isPlaying || !this.beatData) {
			return;
		}

		const prevBeatsTime = this.beatsTime + skipDebug;
		const prevEventsTime = this.eventsTime + skipDebug;

		if (this.beatsPreloadTime === undefined) {
			// Get current song time.
			if (!song.isPlaying) {
				return;
			}
			this.beatsTime = song.getCurrentTime() + this.beatAnticipationTime + this.data.beatWarmupTime;
			this.eventsTime = song.getCurrentTime();
		} else {
			// Song is not playing and is preloading beats, use maintained beat time.
			this.beatsTime = this.beatsPreloadTime;
			this.eventsTime = song.getCurrentTime();
		}

		// Load in stuff scheduled between the last timestamp and current timestamp.
		// Beats.
		const beatsTime = this.beatsTime + skipDebug;

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
				if (noteTime + noteDuration / 2 > prevBeatsTime && noteTime - noteDuration / 2 <= beatsTime) {
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
			const eventsTime = this.eventsTime + skipDebug;
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
		}

		if (this.beatsPreloadTime >= this.beatsPreloadTimeTotal) {
			// Finished preload.
			this.el.sceneEl.emit('beatloaderpreloadfinish', null, false);
			this.beatsPreloadTime = undefined;
		} else {
			// Continue preload.
			this.beatsPreloadTime += delta / 1000;
		}
	},

	seek: function (time) {
		this.clearBeats(true);
		this.beatsTime = time;
		this.isSeeking = true;
	},

	generateBeat: function (note) {
		const data = this.data;

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

			// Apply sword offset. Blocks arrive on beat in front of the user.
			beatObj.anticipationPosition = -this.beatAnticipationTime * this.beatSpeed - this.swordOffset;
			beatObj.color = color;
			beatObj.cutDirection = this.orientationsHumanized[note._cutDirection];

			if (note._angleOffset) {
				beatObj.rotationOffset = note._angleOffset;
			} else {
				beatObj.rotationOffset = note.cutDirectionAngleOffset ? note.cutDirectionAngleOffset : 0;
			}

			beatObj.speed = this.beatSpeed;
			beatObj.size = 0.4;
			beatObj.type = type;
			beatObj.warmupPosition = -data.beatWarmupTime * data.beatWarmupSpeed;
			beatObj.index = note._index;

			beatObj.time = note._songTime;
			beatObj.anticipationTime = this.beatAnticipationTime;
			beatObj.warmupTime = data.beatWarmupTime;
			beatObj.warmupSpeed = data.beatWarmupSpeed;

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
			
			if (this.noodleExtensions && note._customData) {
				if (note._customData._position) {
					beatObj.horizontalPosition = note._customData._position[0] + 4 / 2
					beatObj.verticalPosition = note._customData._position[1];
				}
				if (note._customData._cutDirection || note._customData._cutDirection === 0) {
					beatObj.rotationOffset = note._customData._cutDirection;
				}
			}

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

	generateWall: (function () {
		const wallObj = {};
		const WALL_THICKNESS = 0.6;

		return function (wall) {
			const el = this.el.sceneEl.components.pool__wall.requestEntity();

			if (!el) {
				return;
			}

			const data = this.data;
			const speed = this.beatSpeed;

			const durationSeconds = wall._songDuration;
			wallObj.anticipationPosition = -this.beatAnticipationTime * this.beatSpeed - this.swordOffset;
			wallObj.durationSeconds = durationSeconds;
			wallObj.horizontalPosition = wall._lineIndex;
			wallObj.isCeiling = wall._type === 1;
			wallObj.speed = speed;
			wallObj.warmupPosition = -data.beatWarmupTime * data.beatWarmupSpeed;
			// wall._width can be like 1 or 2. Map that to 0.6 thickness.
			wallObj.width = wall._width * WALL_THICKNESS;

			wallObj.time = wall._songTime;
			wallObj.anticipationTime = this.beatAnticipationTime;
			wallObj.warmupTime = data.beatWarmupTime;
			wallObj.warmupSpeed = data.beatWarmupSpeed;

			if (this.customData && this.customData._obstacleColor) {
				wallObj.color = this.customData._obstacleColor;
			}

			if (this.mappingExtensions) {
				if (wall._lineIndex <= -1000 || wall._lineIndex >= 1000) {
					wallObj.horizontalPosition = wall._lineIndex < 0 ? wall._lineIndex / 1000 + 1 : wall._lineIndex / 1000 - 1;
				}

				wallObj.width = ((wall._width - 1000) / 1000) * WALL_THICKNESS;
			}

			el.setAttribute('wall', wallObj);

			// Handle mapping extensions wall format.
			if (this.mappingExtensions) {
				const obstacleType = wall._type;

				if ((obstacleType >= 1000 && obstacleType <= 4000) || (obstacleType >= 4001 && obstacleType <= 4005000)) {
					let obsHeight;
					var value = obstacleType;
					if (obstacleType >= 4001 && obstacleType <= 4100000) {
						value -= 4001;
						obsHeight = value / 1000;
					} else {
						obsHeight = value - 1000;
					}
					var height = (obsHeight / 1000) * 5;
					height = height * 1000 + 1000;

					var startHeight = 0;
					var value1 = obstacleType;
					if (obstacleType >= 4001 && obstacleType <= 4100000) {
						value1 -= 4001;
						startHeight = value1 % 1000;
					}

					var layer = (startHeight / 750) * 5;
					layer = layer * 1000 + 1334;

					el.components.wall.setMappingExtensionsHeight(layer / 1000 - 2, (height - 1000) / 1000);
				}
			}

			el.components.wall.onGenerate(this.mappingExtensions);
			el.play();
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

			// Apply sword offset. Blocks arrive on beat in front of the user.
			beatObj.anticipationPosition = -this.beatAnticipationTime * this.beatSpeed - this.swordOffset;
			beatObj.color = color;
			beatObj.cutDirection = this.orientationsHumanized[note._cutDirection];
			beatObj.tailCutDirection = this.orientationsHumanized[note._tailCutDirection];

			if (note._angleOffset) {
				beatObj.rotationOffset = note._angleOffset;
			} else {
				beatObj.rotationOffset = note.cutDirectionAngleOffset ? note.cutDirectionAngleOffset : 0;
			}
			beatObj.speed = this.beatSpeed;
			beatObj.warmupPosition = -data.beatWarmupTime * data.beatWarmupSpeed;

			beatObj.time = note._songTime;
			beatObj.tailTime = note._songTailTime;
			beatObj.hasTailNote = note.tail != null;
			beatObj.anticipationTime = this.beatAnticipationTime;
			beatObj.warmupTime = data.beatWarmupTime;
			beatObj.warmupSpeed = data.beatWarmupSpeed;

			if (this.mappingExtensions) {
				note._lineIndex = note._lineIndex < 0 ? note._lineIndex / 1000 + 1 : note._lineIndex / 1000 - 1;
				note._lineLayer = note._lineLayer < 0 ? note._lineLayer / 1000 + 1 : note._lineLayer / 1000 - 1;
				if (this.mappingExtensions.colWidth) {
					beatObj.size *= this.mappingExtensions.colWidth;
				}
			}
			beatObj.horizontalPosition = note._lineIndex;
			beatObj.verticalPosition = note._lineLayer;

			beatObj.tailHorizontalPosition = note._tailLineIndex;
			beatObj.tailVerticalPosition = note._tailLineLayer;

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
				break;
			case 3:
				this.stageColors.setColor('rightlaser', event._value);
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
				this.leftStageLasers.components['stage-lasers'].pulse(event._value);
				break;
			case 13:
				this.rightStageLasers.components['stage-lasers'].pulse(event._value);
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

	calculateJumpTime: function (bpm, njs, offset) {
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

	updateJD: function (newJD, itsDefault = false) {
		const defaultJT = this.calculateJumpTime(this.bpm, this.beatSpeed, this.beatOffset);
		const defaultJD = (60 / this.bpm) * defaultJT * this.beatSpeed * 2;

		var jt, jd;
		if (newJD != null) {
			jt = newJD / (60 / this.bpm) / this.beatSpeed / 2;
			jd = newJD;
		} else {
			jt = defaultJT;
			jd = defaultJD;
		}

		if (!itsDefault || this.beatAnticipationTime == null) {
			this.beatAnticipationTime = (60 / this.bpm) * jt;
			this.el.sceneEl.emit('jdCalculated', {jd, defaultJd: itsDefault ? defaultJD : null}, false);
		} else if (itsDefault) {
			this.el.sceneEl.emit('jdCalculated', {defaultJd: defaultJD}, false);
		}

		if (!itsDefault) {
			for (let i = 0; i < this.beatContainer.children.length; i++) {
				let child = this.beatContainer.children[i];
				if (child.components.beat) {
					child.components.beat.data.anticipationTime = this.beatAnticipationTime;
					child.components.beat.data.anticipationPosition = -this.beatAnticipationTime * this.beatSpeed - this.swordOffset;
				}
				if (child.components.wall) {
					child.components.wall.data.anticipationTime = this.beatAnticipationTime;
					child.components.wall.data.anticipationPosition = -this.beatAnticipationTime * this.beatSpeed - this.swordOffset;
				}
			}
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

/**
 * Say I have a value, 15, out of a range between 0 and 30.
 * I might want to know what that is on a scale of 1-5 instead.
 */
function normalize(number, currentScaleMin, currentScaleMax, newScaleMin, newScaleMax) {
	// First, normalize the value between 0 and 1.
	const standardNormalization = (number - currentScaleMin) / (currentScaleMax - currentScaleMin);

	// Next, transpose that value to our desired scale.
	return (newScaleMax - newScaleMin) * standardNormalization + newScaleMin;
}

function roundToNearest(number, nearest) {
	return Math.round(number / nearest) * nearest;
}
