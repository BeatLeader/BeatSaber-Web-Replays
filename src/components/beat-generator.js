import {BEAT_WARMUP_OFFSET, BEAT_WARMUP_SPEED, BEAT_WARMUP_TIME} from '../constants/beat';
import {get2DNoteOffset, directionVector, NoteCutDirection, signedAngle, SWORD_OFFSET} from '../utils';

let skipDebug = AFRAME.utils.getUrlParameter('skip') || 0;
skipDebug = parseInt(skipDebug, 10);

let queryJD = AFRAME.utils.getUrlParameter('jd') || -1;
queryJD = parseFloat(queryJD);
if (queryJD < 5 || queryJD > 50) {
  queryJD = -1;
}

const RIDICULOUS_MAP_EX_CONSTANT = 4001;
const WALL_HEIGHT_MIN = 0;
const WALL_HEIGHT_MAX = 1000;
const WALL_START_BASE = 100;
const WALL_START_MAX = 400;
const ANY_CUT_DIRECTION = NoteCutDirection.Any;

/**
 * Load beat data (all the beats and such).
 */
AFRAME.registerComponent('beat-generator', {
  dependencies: ['stage-colors'],

  schema: {
    beatWarmupTime: {default: BEAT_WARMUP_TIME / 1000},
    beatWarmupSpeed: {default: BEAT_WARMUP_SPEED},
    difficulty: {type: 'string'},
    isPlaying: {default: false},
    mode: {default: 'Standard'},
    noEffects: {default: false}
  },

  orientationsHumanized: [
    'up',
    'down',
    'left',
    'right',
    'upleft',
    'upright',
    'downleft',
    'downright'
  ],

  horizontalPositions: [-0.75, -0.25, 0.25, 0.75],

  init: function () {
    this.audioAnalyserEl = document.getElementById('audioanalyser');
    this.beatData = null;
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
    });
    this.el.addEventListener('songprocessingfinish', evt => {
      this.beatsTime = 0;
    });
  },

  update: function (oldData) {
    if (!this.beatmaps) { return; }

    if ((oldData.difficulty && oldData.difficulty !== this.data.difficulty) ||
        (oldData.mode && oldData.mode !== this.data.mode)) {
      this.beatData = this.beatmaps[this.data.mode][this.data.difficulty];
      if (this.beatData) {
        this.processBeats();
      }
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
    this.beatSpeed = this.beatSpeeds[this.data.mode][this.data.difficulty];
    this.beatOffset = this.beatOffsets[this.data.mode][this.data.difficulty];
    this.bpm = this.info._beatsPerMinute;

    this.updateJD(queryJD, false);
    this.beatsPreloadTimeTotal =
      (this.beatAnticipationTime + this.data.beatWarmupTime) * 1000;

    // Some events have negative time stamp to initialize the stage.
    const events = this.beatData._events;
    if (events.length && events[0]._time < 0) {
      for (let i = 0; events[i]._time < 0; i++) {
        this.generateEvent(events[i]);
      }
    }

    var group, groupTime;

    const processGroup = () => {
      var leftNotes = []
      var rightNotes = []
      group.forEach(note => {
        (note._type ? leftNotes : rightNotes).push(note);
      });

      this.processNotesByColorType(leftNotes);
      this.processNotesByColorType(rightNotes);
    };

    const notes = this.beatData._notes;
    var index = 0;
    for (var i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note._type == 0 || note._type == 1) {
        note.index = index;
        index++;

        if (!group) {
          group = [note];
          groupTime = note._time;
        } else {
          if (Math.abs(groupTime - note._time) < 0.0001) {
            group.push(note);
          } else {
            processGroup();
            group = null;
            i--;
            index--;
          }
        }
      }
    }
    processGroup();

    this.beatDataProcessed = true;
    console.log('[beat-generator] Finished processing beat data.');
  },

  /**
   * Generate beats and stuff according to timestamp.
   */
  tick: function (time, delta) {
    const song = this.el.components.song;
    if (!this.data.isPlaying || !this.beatData) { return; }

    const prevBeatsTime = this.beatsTime + skipDebug;
    const prevEventsTime = this.eventsTime + skipDebug;

    if (this.beatsPreloadTime === undefined) {
      // Get current song time.
      if (!song.isPlaying) { return; }
      this.beatsTime = (song.getCurrentTime() + this.beatAnticipationTime +
                        this.data.beatWarmupTime) * 1000;
      this.eventsTime = song.getCurrentTime() * 1000;
    } else {
      // Song is not playing and is preloading beats, use maintained beat time.
      this.beatsTime = this.beatsPreloadTime;
      this.eventsTime = song.getCurrentTime() * 1000;
    }

    // Load in stuff scheduled between the last timestamp and current timestamp.
    // Beats.
    const beatsTime = this.beatsTime + skipDebug;

    const msPerBeat = 1000 * 60 / this.bpm;
    const notes = this.beatData._notes;
    for (let i = 0; i < notes.length; ++i) {
      let noteTime = notes[i]._time * msPerBeat;
      if (noteTime > prevBeatsTime && noteTime <= beatsTime) {
        notes[i].time = noteTime;
        this.generateBeat(notes[i]);
      }
    }

    // Walls.
    const obstacles = this.beatData._obstacles;
    for (let i = 0; i < obstacles.length; ++i) {
      let noteTime = obstacles[i]._time * msPerBeat;
      let noteDuration = obstacles[i]._duration * msPerBeat;
      if (this.isSeeking) {
        if ((noteTime + noteDuration / 2) > prevBeatsTime && (noteTime - noteDuration / 2) <= beatsTime) {
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
        let noteTime = events[i]._time * msPerBeat;
        if (noteTime > prevEventsTime && noteTime <= eventsTime) {
          this.generateEvent(events[i]);
        }
      }
    }

    if (this.isSeeking) {
      this.isSeeking = false;
    }

    if (this.beatsPreloadTime === undefined) { return; }

    if (this.beatsPreloadTime >= this.beatsPreloadTimeTotal) {
      // Finished preload.
      this.el.sceneEl.emit('beatloaderpreloadfinish', null, false);
      this.beatsPreloadTime = undefined;
    } else {
      // Continue preload.
      this.beatsPreloadTime += delta;
    }
  },

  seek: function (time) {
    this.clearBeats(true);
    this.beatsTime = (
      time
    ) * 1000;
    this.isSeeking = true;
  },

  generateBeat: function (note) {
    const data = this.data;

    // if (Math.random() < 0.8) { note._type = 3; } // To debug mines.
    let color;
    let type = note._cutDirection === 8 ? 'dot' : 'arrow';
    if (note._type === 0) {
      color = 'red';
    } else if (note._type === 1) {
      color = 'blue';
    } else {
      type = 'mine';
      color = undefined;
    }

    const beatEl = this.requestBeat(type, color);
    if (!beatEl) { return; }

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
      beatObj.rotationOffset = note.cutDirectionAngleOffset ? note.cutDirectionAngleOffset : 0;
      beatObj.speed = this.beatSpeed;
      beatObj.size = 0.4;
      beatObj.type = type;
      beatObj.warmupPosition = -data.beatWarmupTime * data.beatWarmupSpeed;
      beatObj.index = note.index;

      beatObj.time = note._time * (60 / this.bpm);
      beatObj.anticipationTime = this.beatAnticipationTime;
      beatObj.warmupTime = data.beatWarmupTime;
      beatObj.warmupSpeed = data.beatWarmupSpeed;

      if (this.mappingExtensions) {
        note._lineIndex = note._lineIndex < 0
          ? note._lineIndex / 1000 + 1
          : note._lineIndex / 1000 - 1;
        note._lineLayer = note._lineLayer < 0
          ? note._lineLayer / 1000 + 1
          : note._lineLayer / 1000 - 1;
        if (this.mappingExtensions.colWidth) {
          beatObj.size *= this.mappingExtensions.colWidth;
        }
      }
      beatObj.horizontalPosition = note._lineIndex;
      beatObj.verticalPosition = note._lineLayer,

      beatEl.setAttribute('beat', beatObj);
      beatEl.components.beat.onGenerate(this.mappingExtensions);
      beatEl.play();
    };
  })(),

  generateWall: (function () {
    const wallObj = {};
    const WALL_THICKNESS = 0.6;

    return function (wall) {
      const el = this.el.sceneEl.components.pool__wall.requestEntity();

      if (!el) { return; }

      const data = this.data;
      const speed = this.beatSpeed;

      const durationSeconds = 60 * (wall._duration / this.bpm);
      wallObj.anticipationPosition =
        -this.beatAnticipationTime * this.beatSpeed - this.swordOffset;
      wallObj.durationSeconds = durationSeconds;
      wallObj.horizontalPosition = wall._lineIndex;
      wallObj.isCeiling = wall._type === 1;
      wallObj.speed = speed;
      wallObj.warmupPosition = -data.beatWarmupTime * data.beatWarmupSpeed;
      // wall._width can be like 1 or 2. Map that to 0.6 thickness.
      wallObj.width = wall._width * WALL_THICKNESS;

      wallObj.time = wall._time * (60 / this.bpm);
      wallObj.anticipationTime = this.beatAnticipationTime;
      wallObj.warmupTime = data.beatWarmupTime;
      wallObj.warmupSpeed = data.beatWarmupSpeed;

      if (this.mappingExtensions) {
        wallObj.horizontalPosition = wall._lineIndex < 0
          ? wall._lineIndex / 1000 + 1
          : wall._lineIndex / 1000 - 1;
        wallObj.width = ((wall._width - 1000) / 1000) * WALL_THICKNESS
      }

      el.setAttribute('wall', wallObj);

      // Handle mapping extensions wall format.
      if (this.mappingExtensions) {
        const typeValue = wall._type - RIDICULOUS_MAP_EX_CONSTANT;
        let height = Math.round(typeValue / 1000);
        let startHeight = typeValue % 1000;

				height = roundToNearest(
					normalize(
						height,
						WALL_HEIGHT_MIN,
						WALL_HEIGHT_MAX,
						0,
						5
					),
					0.001
				);
				startHeight = roundToNearest(
					normalize(startHeight, WALL_START_BASE, WALL_START_MAX, 0, 1.3),
					0.01
				);

        el.components.wall.setMappingExtensionsHeight(startHeight, height);
      }

      el.components.wall.onGenerate(this.mappingExtensions);
      el.play();
    };
  })(),

  generateEvent: function (event) {
    switch(event._type) {
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
    if (color) { beatPoolName += '-' + color; }
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
      if (njs <= 0.01) // Is it ok to == a 0f?
          njs = 10;

      while (njs * num * halfjump > 18)
          halfjump /= 2;

      halfjump += offset;
      if (halfjump < 0.25)
          halfjump = 0.25;
 
      return halfjump;
  },

  updateJD: function (newJD, updateChildren = true) {
    const defaultJT = this.calculateJumpTime(this.bpm, this.beatSpeed, this.beatOffset);
    const defaultJD = (60 / this.bpm) * defaultJT * this.beatSpeed * 2;
    
    var jt;
    if (newJD != -1) {
      jt = ((newJD / (60 / this.bpm)) / this.beatSpeed) / 2;
      this.jd = newJD;
    } else {
      jt = defaultJT;
      this.jd = defaultJD;
    }
    this.el.sceneEl.emit('jdCalculated', {jd: this.jd, defaultJd: !updateChildren ? defaultJD : null}, false);
    this.beatAnticipationTime = (60 / this.bpm) * jt;

    if (updateChildren) {
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

  processNotesByColorType: function (notesWithTheSameColorTypeList) {
    if (notesWithTheSameColorTypeList.length != 2) return;
    const theSameColorType1 = notesWithTheSameColorTypeList[0];
    const theSameColorType2 = notesWithTheSameColorTypeList[1];

    if (theSameColorType1._cutDirection != theSameColorType2._cutDirection && theSameColorType1._cutDirection != ANY_CUT_DIRECTION && theSameColorType2._cutDirection != ANY_CUT_DIRECTION) return;
    var noteData1;
    var noteData2;
    if (theSameColorType1._cutDirection != ANY_CUT_DIRECTION) {
      noteData1 = theSameColorType1;
      noteData2 = theSameColorType2;
    } else {
      noteData1 = theSameColorType2;
      noteData2 = theSameColorType1;
    }
    var line1 = get2DNoteOffset(noteData2._lineIndex, noteData2._lineLayer).sub(get2DNoteOffset(noteData1._lineIndex, noteData1._lineLayer))
    var line2 = this.signedAngleToLine((noteData1._cutDirection == ANY_CUT_DIRECTION ? new THREE.Vector2(0, 1) : directionVector(noteData1._cutDirection)), line1);
    if (noteData2._cutDirection == ANY_CUT_DIRECTION && noteData1._cutDirection == ANY_CUT_DIRECTION) {
      noteData1.cutDirectionAngleOffset = line2;
      noteData2.cutDirectionAngleOffset = line2;
    } else {
      if (Math.abs(line2) > 40) return;
      noteData1.cutDirectionAngleOffset = line2;
      if (noteData2._cutDirection == ANY_CUT_DIRECTION && noteData1._cutDirection > NoteCutDirection.Right) {
        noteData2.cutDirectionAngleOffset = line2 + 45;
      } else {
        noteData2.cutDirectionAngleOffset = line2;
      }
    }
  },

  signedAngleToLine: function(vec, line) {
    const f1 = signedAngle(vec, line);
    const f2 = signedAngle(vec, line.negate());
    return Math.abs(f1) >= Math.abs(f2) ? f2 : f1;
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

function lessThan (a, b) { return a._time - b._time; }

/**
 * Say I have a value, 15, out of a range between 0 and 30.
 * I might want to know what that is on a scale of 1-5 instead.
 */
function normalize (number, currentScaleMin, currentScaleMax, newScaleMin, newScaleMax) {
  // First, normalize the value between 0 and 1.
  const standardNormalization =
    (number - currentScaleMin) / (currentScaleMax - currentScaleMin);

  // Next, transpose that value to our desired scale.
  return (newScaleMax - newScaleMin) * standardNormalization + newScaleMin;
};

function roundToNearest (number, nearest) {
  return Math.round(number / nearest) * nearest;
}
