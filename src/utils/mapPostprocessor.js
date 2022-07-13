const {get2DNoteOffset, directionVector, NoteCutDirection, signedAngleToLine, ScoringType, clone} = require('../utils.js');

const ANY_CUT_DIRECTION = NoteCutDirection.Any;

function upgrade(map) {
    if (map["version"] && parseInt(map["version"].split(".")[0]) == 3) {
      let notes = [];
      map["colorNotes"].forEach(note => {
        notes.push({
          _time: note["b"],
          _lineIndex: note["x"],
          _lineLayer: note["y"],
          _type: note["c"],
          _cutDirection: note["d"],
          _angleOffset: note["a"],
          _scoringType: ScoringType.Normal
        });
      });
      map["bombNotes"].forEach(bomb => {
        notes.push({
          _time: bomb["b"],
          _lineIndex: bomb["x"],
          _lineLayer: bomb["y"],
          _angleOffset: 0,
          _type: 2,
          _cutDirection: 9,
          _scoringType: ScoringType.NoScore
        });
      });

      map["_notes"] = notes;

      let obstacles = [];
      map["obstacles"].forEach(wall => {
        obstacles.push({
          _time: wall["b"],
          _lineIndex: wall["x"],
          _type: wall["y"] / 2,
          _duration: wall["d"],
          _width: wall["w"],
          _height: wall["h"]
        });
      });

      map["_obstacles"] = obstacles;

      let events = [];
      map["basicBeatmapEvents"].forEach(event => {
        events.push({
          _time: event["b"],
          _type: event["et"],
          _value: event["i"],
          _floatValue: event["f"],
        });
      });

      map["_events"] = events;

      let sliders = [];
      map["sliders"].forEach(slider => {
        sliders.push({
          _time: slider["b"],
          _lineIndex: slider["x"],
          _lineLayer: slider["y"],
          _type: slider["c"],
          _cutDirection: slider["d"],
          _tailTime: slider["tb"],
          _tailLineIndex: slider["tx"],
          _tailLineLayer: slider["ty"],
          _headControlPointLengthMultiplier: slider["mu"],
          _tailControlPointLengthMultiplier: slider["tmu"],
          _tailCutDirection: slider["tc"],
          _arcMidAnchorMode: slider["m"]
        });
      });

      map["_sliders"] = sliders;

      let burstSliders = [];
      map["burstSliders"].forEach(slider => {
        burstSliders.push({
          _time: slider["b"],
          _lineIndex: slider["x"],
          _lineLayer: slider["y"],
          _type: slider["c"],
          _cutDirection: slider["d"],
          _tailTime: slider["tb"],
          _tailLineIndex: slider["tx"],
          _tailLineLayer: slider["ty"],
          _sliceCount: slider["sc"],
          _squishAmount: slider["s"]
        });
      });
      map["_burstSliders"] = burstSliders;

      let bpmevents = [];
      map["bpmEvents"].forEach(event => {
        bpmevents.push({
          _time: event["b"],
          _bpm: event["m"],
        });
      });

      map["_bpmEvents"] = bpmevents;
    } else {
        map["_sliders"] = [];
        map["_burstSliders"] = [];
    }

    return map;
}

function processNotesByColorType(notesWithTheSameColorTypeList) {
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
    var line2 = signedAngleToLine((noteData1._cutDirection == ANY_CUT_DIRECTION ? new THREE.Vector2(0, 1) : directionVector(noteData1._cutDirection)), line1);
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
}

function calculateRotationOffsets(map) {
    var group, groupTime;

    const processGroup = () => {
      var leftNotes = []
      var rightNotes = []
      if (group) {
        group.forEach(note => {
            (note._type ? leftNotes : rightNotes).push(note);
          });
    
          processNotesByColorType(leftNotes);
          processNotesByColorType(rightNotes);
      }
    };

    let notes = map._notes;
    for (var i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note._type == 0 || note._type == 1) {
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
          }
        }
      }
    }
    processGroup();
}

function addScoringTypeAndChains(map) {
    const mapnotes = map._notes;

    map._sliders.forEach(slider => {
        var head = mapnotes.find(n => n._time == slider._time && n._lineIndex == slider._lineIndex && n._lineLayer == slider._lineLayer);
        if (head && head._scoringType == ScoringType.Normal) {
            head._scoringType = ScoringType.SliderHead;
        }
        var tail = mapnotes.find(n => n._time == slider._tailTime && n._lineIndex == slider._tailLineIndex && n._lineLayer == slider._tailLineLayer);
        if (tail && tail._scoringType == ScoringType.Normal) {
            tail._scoringType = ScoringType.SliderTail;
        }
    });

    var chains = [];

    map._burstSliders.forEach(slider => {
        var head = mapnotes.find(n => n._time == slider._time && n._lineIndex == slider._lineIndex && n._lineLayer == slider._lineLayer);
        if (head) {
            if (head._scoringType == ScoringType.Normal) {
                head._scoringType = ScoringType.BurstSliderHead;
            }
            head.sliderhead = slider;
        }
        for (var i = 0; i < slider._sliceCount - 1; i++) {
            let chain = clone(slider);
            chain._headCutDirection = slider._cutDirection;
            chain._cutDirection = ANY_CUT_DIRECTION;
            chain._scoringType = ScoringType.BurstSliderElement;
            chain._sliceIndex = i + 1;
        
            chains.push(chain);
        }
    });

    map._chains = chains;
}

function indexNotes(map) {
    var mapnotes = [].concat(map._notes, map._chains).sort((a, b) => { return a._time - b._time; }).filter(a => a._type == 0 || a._type == 1);

    mapnotes.forEach((note, i) => {
        note._index = i;
    });
}

function filterFakeNotes(map) {
  map._notes = map._notes.filter(a => a._customData == null || !a._customData._fake);
}

function convertBeatToSongTime(beatTime, bpm, bpmChangeDataList) {
  if (bpmChangeDataList.length == 0) return beatTime * (60 / bpm);

  var i = 0;
  while (i < bpmChangeDataList.length - 1 && bpmChangeDataList[i + 1].bpmChangeStartBpmTime < beatTime) {
    i++;
  }
  const bpmChangeData = bpmChangeDataList[i];
  return bpmChangeData.bpmChangeStartTime + ((beatTime - bpmChangeData.bpmChangeStartBpmTime) / bpmChangeData.bpm * 60.0);
}

function calculateSongTimes(map, info) {
  var startBpm = info._beatsPerMinute;
  var bpmChangeDataList = [];

  const bpmEvents = map._bpmEvents;
  if (bpmEvents && bpmEvents.length != 0 && bpmEvents[0]._time == 0) {
    startBpm = bpmEvents[0]._bpm;
    bpmChangeDataList = [{bpmChangeStartTime: 0.0, bpmChangeStartBpmTime: 0.0, bpm: startBpm}];
    for (var index = 1; index < bpmEvents.length; ++index)
    {
      const bpmChangeData = bpmChangeDataList[bpmChangeDataList.length - 1];
      const beat = bpmEvents[index]._time;
      const bpm = bpmEvents[index]._bpm;

      bpmChangeDataList.push({
        bpmChangeStartTime: bpmChangeData.bpmChangeStartTime + ((beat - bpmChangeData.bpmChangeStartBpmTime) / bpmChangeData.bpm * 60.0), 
        bpmChangeStartBpmTime: beat, 
        bpm
      });
    }
  }
  
  [map["_notes"], map["_obstacles"], map["_events"]].forEach(collection => {
    collection.forEach(o => {
      o._songTime = convertBeatToSongTime(o._time, startBpm, bpmChangeDataList);
      if (o._duration) {
        o._songDuration = convertBeatToSongTime(o._duration, startBpm, bpmChangeDataList);
      }
    });
  });
  [map["_sliders"], map["_burstSliders"], map["_chains"]].forEach(collection => {
    collection.forEach(o => {
      o._songTime = convertBeatToSongTime(o._time, startBpm, bpmChangeDataList);
      o._songTailTime = convertBeatToSongTime(o._tailTime, startBpm, bpmChangeDataList);
    });
  });
}

function postprocess(map, info) {
    var result = upgrade(map);

    calculateRotationOffsets(result);
    addScoringTypeAndChains(result);
    filterFakeNotes(result);
    indexNotes(result);
    calculateSongTimes(result, info);

    return result;
}

module.exports.postprocess = postprocess;