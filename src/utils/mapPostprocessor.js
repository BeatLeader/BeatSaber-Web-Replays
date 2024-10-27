const {get2DNoteOffset, directionVector, NoteCutDirection, signedAngleToLine, ScoringType, clone, LerpUnclamped} = require('../utils.js');
const {Mirror_Inverse, Mirror_Horizontal, Mirror_Vertical} = require('./chirality-support.js');

const ANY_CUT_DIRECTION = NoteCutDirection.Any;

function zeroIfUndefined(value) {
	return value === undefined ? 0 : value;
}

function upgrade(map) {
	if (map['version'] && parseInt(map['version'].split('.')[0]) == 3) {
		let notes = [];
		map['colorNotes'].forEach(note => {
			var resultNote = {
				_time: zeroIfUndefined(note['b']),
				_lineIndex: zeroIfUndefined(note['x']),
				_lineLayer: zeroIfUndefined(note['y']),
				_type: zeroIfUndefined(note['c']),
				_cutDirection: zeroIfUndefined(note['d']),
				_angleOffset: zeroIfUndefined(note['a']),
				_scoringType: ScoringType.Normal,
			};

			if (note.customData) {
				resultNote._customData = {
					_position: note.customData.coordinates,
				};
			}

			notes.push(resultNote);
		});
		map['bombNotes'].forEach(bomb => {
			notes.push({
				_time: zeroIfUndefined(bomb['b']),
				_lineIndex: zeroIfUndefined(bomb['x']),
				_lineLayer: zeroIfUndefined(bomb['y']),
				_angleOffset: 0,
				_type: 3,
				_cutDirection: NoteCutDirection.Any,
				_scoringType: ScoringType.NoScore,
			});
		});

		map['_notes'] = notes;

		let obstacles = [];
		map['obstacles'].forEach(wall => {
			var resultWall = {
				_time: zeroIfUndefined(wall['b']),
				_lineIndex: zeroIfUndefined(wall['x']),
				_lineLayer: zeroIfUndefined(wall['y']),
				_type: zeroIfUndefined(wall['y']) / 2,
				_duration: zeroIfUndefined(wall['d']),
				_width: zeroIfUndefined(wall['w']),
				_height: zeroIfUndefined(wall['h']),
			};

			if (wall.customData) {
				resultWall._customData = {
					_position: wall.customData.coordinates,
					_color: wall.customData.color,
					_scale: wall.customData.size,
					_localRotation: wall.customData.localRotation,
					_rotation: wall.customData.worldRotation,
				};
			}
			obstacles.push(resultWall);
		});

		map['_obstacles'] = obstacles;

		let events = [];
		map['basicBeatmapEvents'].forEach(event => {
			events.push({
				_time: zeroIfUndefined(event['b']),
				_type: zeroIfUndefined(event['et']),
				_value: zeroIfUndefined(event['i']),
				_floatValue: zeroIfUndefined(event['f']),
			});
		});
		map['rotationEvents'].forEach(event => {
			var value = (Math.abs(zeroIfUndefined(event['r'])) - 60) / -15;
			events.push({
				_time: zeroIfUndefined(event['b']),
				_type: zeroIfUndefined(event['e']) == 1 ? 15 : 14,
				_value: value < 4 ? value : value - 1,
				_inverted: event['r'] > 0,
			});
		});

		map['_events'] = events;

		let sliders = [];
		map['sliders'].forEach(slider => {
			const resultSlider = {
				_time: zeroIfUndefined(slider['b']),
				_lineIndex: zeroIfUndefined(slider['x']),
				_lineLayer: zeroIfUndefined(slider['y']),
				_type: zeroIfUndefined(slider['c']),
				_cutDirection: zeroIfUndefined(slider['d']),
				_tailTime: zeroIfUndefined(slider['tb']),
				_tailLineIndex: zeroIfUndefined(slider['tx']),
				_tailLineLayer: zeroIfUndefined(slider['ty']),
				_headControlPointLengthMultiplier: zeroIfUndefined(slider['mu']),
				_tailControlPointLengthMultiplier: zeroIfUndefined(slider['tmu']),
				_tailCutDirection: zeroIfUndefined(slider['tc']),
				_arcMidAnchorMode: zeroIfUndefined(slider['m']),
			};

			if (slider.customData) {
				resultSlider._customData = {
					_position: slider.customData.coordinates,
					_tailPosition: slider.customData.tailCoordinates,
				};
			}

			sliders.push(resultSlider);
		});

		map['_sliders'] = sliders;

		let burstSliders = [];
		map['burstSliders'].forEach(slider => {
			const resultSlider = {
				_time: zeroIfUndefined(slider['b']),
				_lineIndex: zeroIfUndefined(slider['x']),
				_lineLayer: zeroIfUndefined(slider['y']),
				_type: zeroIfUndefined(slider['c']),
				_cutDirection: zeroIfUndefined(slider['d']),
				_tailTime: zeroIfUndefined(slider['tb']),
				_tailLineIndex: zeroIfUndefined(slider['tx']),
				_tailLineLayer: zeroIfUndefined(slider['ty']),
				_sliceCount: zeroIfUndefined(slider['sc']),
				_squishAmount: zeroIfUndefined(slider['s']),
			};

			if (slider.customData) {
				resultSlider._customData = {
					_position: slider.customData.coordinates,
					_tailPosition: slider.customData.tailCoordinates,
				};
			}

			burstSliders.push(resultSlider);
		});
		map['_burstSliders'] = burstSliders;

		let bpmevents = [];
		map['bpmEvents'].forEach(event => {
			bpmevents.push({
				_time: zeroIfUndefined(event['b']),
				_bpm: zeroIfUndefined(event['m']),
			});
		});

		map['_bpmEvents'] = bpmevents;
	} else {
		map['_sliders'] = [];
		map['_burstSliders'] = [];

		if (!map['_bpmEvents']) {
			let bpmevents = [];
			map['_events'].forEach(event => {
				if (event._type == 100 && event._floatValue) {
					bpmevents.push({
						_time: event._time,
						_bpm: event._floatValue,
					});
				}
			});

			if (bpmevents.length) {
				map['_bpmEvents'] = bpmevents;
			}
		}
	}

	return map;
}

function processNoodle(map) {
	[...map._notes].forEach(note => {
		if (note._customData && note._customData._cutDirection !== undefined) {
			note._cutDirection =
				note._cutDirection !== 8 && note._customData && note._customData._cutDirection !== undefined ? 1 : note._cutDirection;
		}
	});

	return map;
}

function processNotesByColorType(notesWithTheSameColorTypeList) {
	if (notesWithTheSameColorTypeList.length != 2) return;
	const theSameColorType1 = notesWithTheSameColorTypeList[0];
	const theSameColorType2 = notesWithTheSameColorTypeList[1];

	if (
		theSameColorType1._cutDirection != theSameColorType2._cutDirection &&
		theSameColorType1._cutDirection != ANY_CUT_DIRECTION &&
		theSameColorType2._cutDirection != ANY_CUT_DIRECTION
	)
		return;
	var noteData1;
	var noteData2;
	if (theSameColorType1._cutDirection != ANY_CUT_DIRECTION) {
		noteData1 = theSameColorType1;
		noteData2 = theSameColorType2;
	} else {
		noteData1 = theSameColorType2;
		noteData2 = theSameColorType1;
	}
	var line1 = get2DNoteOffset(noteData2._lineIndex, noteData2._lineLayer).sub(get2DNoteOffset(noteData1._lineIndex, noteData1._lineLayer));
	var line2 = signedAngleToLine(
		noteData1._cutDirection == ANY_CUT_DIRECTION ? new THREE.Vector2(0, 1) : directionVector(noteData1._cutDirection),
		line1
	);
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

function SetNoteFlipToNote(thisNote, targetNote) {
	thisNote._flipLineIndex = targetNote._lineIndex;
	thisNote._flipYSide = thisNote._lineIndex > targetNote._lineIndex ? 1 : -1;
	if (
		(thisNote._lineIndex <= targetNote._lineIndex || thisNote._lineLayer >= targetNote._lineLayer) &&
		(thisNote._lineIndex >= targetNote._lineIndex || thisNote._lineLayer <= targetNote._lineLayer)
	)
		return;
	thisNote._flipYSide *= -1;
}

var columns = {};

function addBeforeJumpLineLayer(currentTimeSlice) {
	columns = {};
	currentTimeSlice.forEach(element => {
		if (columns[element._lineIndex]) {
			columns[element._lineIndex].push(element);
		} else {
			columns[element._lineIndex] = [element];
		}
	});

	Object.keys(columns).forEach(key => {
		var column = columns[key];
		column.sort((a, b) => a._lineLayer - b._lineLayer);
		column.forEach((element, index) => {
			element._beforeJumpLineLayer = index;
		});
	});
}

function addRabbitJumps(currentTimeSlice, currentTimeSliceTime, previousTimeSlice) {
	if (previousTimeSlice) {
		previousTimeSlice.forEach(noteData => {
			noteData._timeToNextColorNote = currentTimeSliceTime - noteData._time;
		});
	}

	if (currentTimeSlice.length != 2) return;

	// uh oh what a condition
	// if (items.length != 2
	// 	|| (Math.abs(this._currentTimeSliceAllNotesAndSliders.time - currentTimeSliceTime) >= 1.0 / 1000.0
	// 		|| !this._currentTimeSliceAllNotesAndSliders.items.Any<BeatmapDataItem>(
	// 			(item => item is SliderData
	// 			|| item is BeatmapObjectsInTimeRowProcessor.SliderTailData))
	// 			? (this._unprocessedSliderTails.Any<SliderData>((tail =>
	// 				Math.Abs(tail.tailTime - currentTimeSliceTime) < 1.0 / 1000.0)) ? 1 : 0) : 1) != 0)
	//   return;
	const targetNote1 = currentTimeSlice[0];
	const targetNote2 = currentTimeSlice[1];
	if (
		targetNote1._type == targetNote2._type ||
		((targetNote1._type != 0 || targetNote1._lineIndex <= targetNote2._lineIndex) &&
			(targetNote1._type != 1 || targetNote1._lineIndex >= targetNote2._lineIndex))
	)
		return;
	if (targetNote1._scoringType != ScoringType.Normal || targetNote2._scoringType != ScoringType.Normal) return;

	SetNoteFlipToNote(targetNote1, targetNote2);
	SetNoteFlipToNote(targetNote2, targetNote1);
}

function processTimingGroups(map) {
	var group, groupTime, previousGroup;

	const processGroup = () => {
		var leftNotes = [];
		var rightNotes = [];
		if (group) {
			group.forEach(note => {
				(note._type ? leftNotes : rightNotes).push(note);
			});

			processNotesByColorType(leftNotes);
			processNotesByColorType(rightNotes);

			addRabbitJumps(group, groupTime, previousGroup);
			previousGroup = group;
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

	group = null;
	for (var i = 0; i < notes.length; i++) {
		const note = notes[i];
		if (!group) {
			group = [note];
			groupTime = note._time;
		} else {
			if (Math.abs(groupTime - note._time) < 0.0001) {
				group.push(note);
			} else {
				addBeforeJumpLineLayer(group);
				group = null;
				i--;
			}
		}
	}
	if (group) {
		addBeforeJumpLineLayer(group);
	}
}

function compareSlider(note, slider, tail) {
	if (note._time.toFixed(2) != slider[`_${tail ? 'tailT' : 't'}ime`].toFixed(2)) return false;

	if (note._lineIndex == slider[`_${tail ? 'tailL' : 'l'}ineIndex`] && note._lineLayer == slider[`_${tail ? 'tailL' : 'l'}ineLayer`])
		return true;

	if (note._customData && note._customData._position) {
		if (slider._customData && slider._customData[`_${tail ? 'tailP' : 'p'}osition`]) {
			if (
				note._customData._position[0].toFixed(2) == slider._customData[`_${tail ? 'tailP' : 'p'}osition`][0].toFixed(2) &&
				note._customData._position[1].toFixed(2) == slider._customData[`_${tail ? 'tailP' : 'p'}osition`][1].toFixed(2)
			)
				return true;
		} else {
			if (
				Math.round(note._customData._position[0] + 4 / 2) == slider[`_${tail ? 'tailL' : 'l'}ineIndex`] &&
				Math.round(note._customData._position[1]) == slider[`_${tail ? 'tailL' : 'l'}ineLayer`]
			)
				return true;
		}
	}

	return false;
}

function addScoringTypeAndChains(map) {
	const mapnotes = map._notes;

	mapnotes.forEach(note => {
		if (note._type == 1 || note._type == 0) {
			note._scoringType = ScoringType.Normal;
		} else {
			note._scoringType = ScoringType.NoScore;
		}
	});

	map._sliders.forEach(slider => {
		var head = mapnotes.find(n => compareSlider(n, slider));
		if (head && head._scoringType == ScoringType.Normal) {
			head._scoringType = ScoringType.SliderHead;
		}
		var tail = mapnotes.find(n => compareSlider(n, slider, true));
		if (head) {
			head.tail = tail;
		}

		slider.tail = tail;
		if (tail && tail._scoringType == ScoringType.Normal) {
			tail._scoringType = ScoringType.SliderTail;
		}
	});

	var chains = [];

	map._burstSliders.forEach(slider => {
		var head = mapnotes.find(n => compareSlider(n, slider));
		if (head) {
			if (head._scoringType == ScoringType.Normal) {
				head._scoringType = ScoringType.BurstSliderHead;
			}
			if (head._scoringType == ScoringType.SliderHead && head.tail) {
				let nextHead = map._burstSliders.find(n => compareSlider(n, head.tail));
				if (nextHead) {
					head._scoringType = ScoringType.BurstSliderHead;
				}
			}
			head.sliderhead = slider;
		}
		for (var i = 1; i < slider._sliceCount; ++i) {
			let chain = clone(slider);
			chain._headCutDirection = slider._cutDirection;
			chain._cutDirection = ANY_CUT_DIRECTION;
			chain._scoringType = ScoringType.BurstSliderElement;
			chain._sliceIndex = i;

			chain._time = LerpUnclamped(chain._time, chain._tailTime, chain._sliceIndex / (slider._sliceCount - 1));

			chains.push(chain);
		}
	});

	map._chains = chains;
}

function indexNotes(map) {
	var mapnotes = []
		.concat(map._notes, map._chains)
		.sort((a, b) => {
			return a._time - b._time;
		})
		.filter(a => a._type == 0 || a._type == 1);

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
	return bpmChangeData.bpmChangeStartTime + ((beatTime - bpmChangeData.bpmChangeStartBpmTime) / bpmChangeData.bpm) * 60.0;
}

function convertSongToBeatTime(songTime, bpm, bpmChangeDataList) {
	if (bpmChangeDataList.length === 0) {
		return songTime / (60 / bpm);
	}

	let currentBpm = bpm;
	let lastBpmTime = 0;
	let lastSongTime = 0;

	for (let i = 0; i < bpmChangeDataList.length; i++) {
		const bpmChangeData = bpmChangeDataList[i];
		const nextSongTime = bpmChangeData.bpmChangeStartTime;
		if (songTime < nextSongTime) {
			return lastBpmTime + ((songTime - lastSongTime) * currentBpm) / 60.0;
		}
		lastBpmTime += ((nextSongTime - lastSongTime) * currentBpm) / 60.0;
		lastSongTime = nextSongTime;
		currentBpm = bpmChangeData.bpm;
	}

	// If song time is beyond all changes
	return lastBpmTime + ((songTime - lastSongTime) * currentBpm) / 60.0;
}

function calculateSongTimes(map, info) {
	var startBpm = info._beatsPerMinute;
	var bpmChangeDataList = [];

	const bpmEvents = map._bpmEvents;
	if (bpmEvents && bpmEvents.length != 0) {
		if (bpmEvents[0]._time == 0) {
			startBpm = bpmEvents[0]._bpm;
			bpmChangeDataList = [{bpmChangeStartTime: 0.0, bpmChangeStartBpmTime: 0.0, bpm: startBpm}];
		}
		for (var index = bpmEvents[0]._time == 0 ? 1 : 0; index < bpmEvents.length; ++index) {
			var bpmChangeData = bpmChangeDataList[bpmChangeDataList.length - 1];
			const beat = bpmEvents[index]._time;
			const bpm = bpmEvents[index]._bpm;

			if (bpmChangeData == null) {
				bpmChangeData = {bpmChangeStartTime: 0.0, bpmChangeStartBpmTime: 0.0, bpm: startBpm};
			}

			bpmChangeDataList.push({
				bpmChangeStartTime: bpmChangeData.bpmChangeStartTime + ((beat - bpmChangeData.bpmChangeStartBpmTime) / bpmChangeData.bpm) * 60.0,
				bpmChangeStartBpmTime: beat,
				bpm,
			});
		}
	}

	map.timeConvertor = bpm_time => {
		return convertBeatToSongTime(bpm_time, startBpm, bpmChangeDataList);
	};

	map.reverseTimeConvertor = song_time => {
		return convertSongToBeatTime(song_time, startBpm, bpmChangeDataList);
	};

	[map['_notes'], map['_obstacles'], map['_events']].forEach(collection => {
		if (!collection) return;
		collection.forEach(o => {
			o._songTime = map.timeConvertor(o._time);
			if (o._duration) {
				o._songDuration = map.timeConvertor(o._time + o._duration) - o._songTime;
			}
		});
	});
	[map['_sliders'], map['_burstSliders'], map['_chains']].forEach(collection => {
		if (!collection) return;
		collection.forEach(o => {
			o._songTime = map.timeConvertor(o._time);
			o._songTailTime = map.timeConvertor(o._tailTime);
		});
	});
}

function postprocess(map, info, mode) {
	var result = upgrade(map);

	switch (mode) {
		case 'VerticalStandard':
			Mirror_Vertical(result, false, false);
			break;
		case 'HorizontalStandard':
			Mirror_Horizontal(result, 4, false, false);
			break;
		case 'InverseStandard':
			Mirror_Inverse(result, 4, true, true, false);
			break;
		case 'InvertedStandard':
			Mirror_Inverse(result, 4, false, false, false);
			break;

		default:
			break;
	}

	addScoringTypeAndChains(result);
	processTimingGroups(result);

	filterFakeNotes(result);
	indexNotes(result);
	calculateSongTimes(result, info);

	return result;
}

module.exports.postprocess = postprocess;
module.exports.processNoodle = processNoodle;
