const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

function checkSS(file, isLink, completion) {
	if (isLink) {
		if (file.split('.').pop() == 'dat') {
			file = file.replace('https://cdn.discordapp.com/', '/cors/discord-cdn/');
			var xhr = new XMLHttpRequest();
			xhr.open('GET', file, true);
			xhr.responseType = 'blob';

			xhr.onload = function () {
				checkSSFile(xhr.response, completion);
			};
			xhr.send();
		} else {
			completion({errorMessage: 'Wrong link format'});
		}
	} else {
		checkSSFile(file, completion);
	}
}

function checkSSFile(file, completion) {
	var reader = new FileReader();
	reader.onload = function (e) {
		decode(e.target.result, completion);
	};
	reader.onerror = function (e) {
		// error occurred
		completion({errorMessage: 'Error: ' + e.type});
	};
	reader.readAsArrayBuffer(file);
}

function ssReplayToBSOR(ssReplay) {
	var result = {ssReplay: true};

	result.info = ssReplay.info;
	if (ssReplay.dynamicHeight) {
		result.heights = ssReplay.dynamicHeight.map(el => ({time: el.a, height: el.h}));
	}

	result.notes = [];
	result.walls = [];
	ssReplay.scores.forEach((score, i) => {
		if (i < ssReplay.noteInfos.length) {
			var note = {};
			const info = ssReplay.noteInfos[i];
			var noteType = parseInt(info[3]);
			if (isNaN(noteType)) {
				noteType = 3;
			}
			note.noteID = parseInt(info[0]) * 1000 + parseInt(info[1]) * 100 + noteType * 10 + parseInt(info[2]);
			note.eventTime = ssReplay.noteTime[i];
			note.spawnTime = i;
			note.eventType = score > 0 ? NoteEventType.good : (score + 1) * -1;
			note.score = score;
			result.notes.push(note);
		} else {
			var wall = {};
			wall.time = ssReplay.noteTime[i];
			result.walls.push(wall);
		}
	});
	result.frames = ssReplay.frames;
	result.frames.forEach(frame => {
		frame.time = frame.a;
		frame.fps = frame.i;
	});

	return result;
}

const NoteEventType = {
	good: 0,
	bad: 1,
	miss: 2,
	bomb: 3,
};

function decode(arrayBuffer, completion) {
	var bytes = new TextEncoder().encode('ScoreSaber Replay \uD83D\uDC4C\uD83E\uDD20\r\n');
	var sourceIndex = bytes.length;
	var start = new Int8Array(arrayBuffer.slice(0, sourceIndex));
	var flag = false;

	for (var index = 0; index < sourceIndex - 12 && start[index] === bytes[index]; ++index) {
		if (index === sourceIndex - 19) {
			flag = true;
		}
	}

	if (!flag) {
		completion({errorMessage: 'Old SS replays are not supported'});
		return;
	}

	var LZMA = require('../vendor/lzma-min.js');

	var my_lzma = new LZMA.LZMA('vendor/lzma_worker.js');
	var data = new Uint8Array(arrayBuffer.slice(sourceIndex));

	my_lzma.decompress(
		data,
		(result, error) => {
			if (result) {
				const dataView = new DataView(new Uint8Array(result).buffer);
				dataView.pointer = 0;
				continueDecode(dataView, completion);
			} else {
				completion({errorMessage: "Can't unzip the replay"});
			}
		},
		percent => {
			console.log(percent);
		}
	);
}

// WARNING
// Attrocious code. It's reverse engineered code
// I'm just copying now spending as little time as I can
// to save $15/month on server

// Want to improve it? Feel free to do that!
// I'll spend as little time on SS support as I can.
function continueDecode(dataView, completion) {
	const offsets = decodeOffsets(dataView);

	var info = decodeInfo(dataView, offsets.replayInfo);
	const frames = decodeFrames(dataView, offsets.zcYpPUYq3RAHg);
	const automaticHeight = decodeFFArray(dataView, offsets.zJbk_r2VWJKCY);
	var thirdArray = decodeThirdArray(dataView, offsets.zuWYxiBCiOOO);
	const fourthArray = decodeIAFArray(dataView, offsets.zWVthFsNiRgp);
	const fifthArray = decodeIAFArray(dataView, offsets.zjjCMbAVve_UJ);

	info.totalScore = fourthArray[fourthArray.length - 1].i;

	var result = {};
	result.frames = frames;
	var intList1 = [];
	var intList2 = [];
	var floatList = [];
	var stringList = [];
	var intAndFloatList = fifthArray;
	for (var index1 = fifthArray.length - 1; index1 >= 0; --index1) {
		for (var index2 = 0; index2 < thirdArray.length; ++index2) {
			if (thirdArray[index2].songTime == fifthArray[index1].a && thirdArray[index2].combo == -1) {
				thirdArray[index2].combo = fifthArray[index1].i;
				intAndFloatList.splice(index1, 1);
				break;
			}
		}
	}
	var num1 = 0.0;
	var num2 = 0;
	for (var index = 0; index < thirdArray.length; ++index) {
		if (thirdArray[index].combo == -1) thirdArray[index].combo = num2;
		else if (thirdArray[index].songTime > num1) {
			num2 = thirdArray[index].combo;
			num1 = thirdArray[index].songTime;
		}
	}
	thirdArray = thirdArray.sort(function (a, b) {
		if (a.noteData.songTime < b.noteData.songTime) return -1;
		if (a.noteData.songTime > b.noteData.songTime) return 1;
		return 0;
	});
	for (var index = 0; index < thirdArray.length; ++index) {
		var somethingBig = thirdArray[index];
		var num3 = Math.round(70 * somethingBig.beforeCutRating);
		var num4 = Math.round(30 * somethingBig.afterCutRating);
		var num5 = Math.round(15 * (1 - clamp(somethingBig.cutDistanceToCenter / 0.3, 0, 1)));
		if (somethingBig.type == 1) intList1.push(num3 + num4 + num5);
		else intList1.push(-somethingBig.type);
		intList2.push(somethingBig.combo >= 0 ? somethingBig.combo : 1);
		floatList.push(somethingBig.songTime);
		stringList.push(
			'' +
				somethingBig.noteData.lineIndex +
				somethingBig.noteData.noteLineLayer +
				somethingBig.noteData.cutDirection +
				somethingBig.noteData.colorType
		);
	}
	result.info = info;
	for (var index = 0; index < intAndFloatList.length; ++index) {
		intList1.push(-5);
		intList2.push(intAndFloatList[index].i);
		floatList.push(intAndFloatList[index].a);
	}
	result.scores = intList1;
	result.combos = intList2;
	result.noteTime = floatList;
	result.noteInfos = stringList;
	result.dynamicHeight = automaticHeight;

	completion(ssReplayToBSOR(result));
}

function decodeOffsets(dataView) {
	var result = {};
	result.replayInfo = DecodeInt(dataView);
	result.zcYpPUYq3RAHg = DecodeInt(dataView);
	result.zJbk_r2VWJKCY = DecodeInt(dataView);
	result.zuWYxiBCiOOO = DecodeInt(dataView);
	result.zWVthFsNiRgp = DecodeInt(dataView);
	result.zjjCMbAVve_UJ = DecodeInt(dataView);
	result.zVWDENm4dsje6Q2VyAc0ji18 = DecodeInt(dataView);
	result.zKQ4Y1J0ZmL3z7FdHXw = DecodeInt(dataView);
	result.zXAxGrPnBYXhi = DecodeInt(dataView);
	return result;
}

function decodeInfo(dataView, offset) {
	var replayInfoo = {};
	dataView.pointer = offset;
	replayInfoo.version = DecodeString(dataView);
	replayInfoo.hash = DecodeString(dataView);
	replayInfoo.difficulty = DecodeInt(dataView);
	replayInfoo.mode = DecodeString(dataView);
	replayInfoo.environment = DecodeString(dataView);
	replayInfoo.modifiers = DecodeStringArray(dataView);
	replayInfoo.noteJumpStartBeatOffset = DecodeFloat(dataView);
	replayInfoo.leftHanded = DecodeBool(dataView);
	replayInfoo.height = DecodeFloat(dataView);
	replayInfoo.rr = DecodeFloat(dataView);
	replayInfoo.room = decodeHZ1(dataView);
	replayInfoo.st = DecodeFloat(dataView);

	return replayInfoo;
}

function decodeHZ1(dataView) {
	var result = {};
	result.x = DecodeFloat(dataView);
	result.y = DecodeFloat(dataView);
	result.z = DecodeFloat(dataView);
	return result;
}

function decodeFrames(dataView, offset) {
	dataView.pointer = offset;
	var num = DecodeInt(dataView);
	var frameList = [];
	for (var index = 0; index < num; ++index) frameList.push(DecodeFrame(dataView));
	return frameList;
}

function DecodeFrame(dataView) {
	var result = {};
	result.head = Decode34(dataView);
	result.left = Decode34(dataView);
	result.right = Decode34(dataView);
	result.i = DecodeInt(dataView);
	result.a = DecodeFloat(dataView);
	return result;
}

function Decode34(dataView) {
	var result = {};
	result.position = Decode3(dataView);
	result.rotation = Decode4(dataView);
	return result;
}

function Decode3(dataView) {
	var result = {};
	result.x = DecodeFloat(dataView);
	result.y = DecodeFloat(dataView);
	result.z = DecodeFloat(dataView);
	return result;
}

function Decode4(dataView) {
	var result = {};
	result.x = DecodeFloat(dataView);
	result.y = DecodeFloat(dataView);
	result.z = DecodeFloat(dataView);
	result.w = DecodeFloat(dataView);
	return result;
}

function decodeFFArray(dataView, offset) {
	dataView.pointer = offset;
	var num = DecodeInt(dataView);
	var twoFloatList = [];
	for (var index = 0; index < num; ++index) twoFloatList.push(Decode2(dataView));
	return twoFloatList;
}

function Decode2(dataView) {
	var result = {};
	result.h = DecodeFloat(dataView);
	result.a = DecodeFloat(dataView);
	return result;
}

function DecodeDK(dataView) {
	var result = {};
	result.songTime = DecodeFloat(dataView);
	result.noteLineLayer = DecodeInt(dataView);
	result.lineIndex = DecodeInt(dataView);
	result.colorType = DecodeInt(dataView);
	result.cutDirection = DecodeInt(dataView);
	return result;
}

function decodeThirdArray(dataView, offset) {
	dataView.pointer = offset;
	var num = DecodeInt(dataView);
	var somethingBigList = [];
	for (var index = 0; index < num; ++index) somethingBigList.push(DecodeSomethingBig(dataView));
	return somethingBigList;
}

function DecodeSomethingBig(dataView) {
	var result = {};
	result.noteData = DecodeDK(dataView);
	result.type = DecodeInt(dataView);
	result.cutPoint = Decode3(dataView);
	result.cutNormal = Decode3(dataView);
	result.saberDir = Decode3(dataView);
	result.saberType = DecodeInt(dataView);
	result.directionOK = DecodeBool(dataView);
	result.saberSpeed = DecodeFloat(dataView);
	result.cutAngle = DecodeFloat(dataView);
	result.cutDistanceToCenter = DecodeFloat(dataView);
	result.cutDirDeviation = DecodeFloat(dataView);
	result.beforeCutRating = DecodeFloat(dataView);
	result.afterCutRating = DecodeFloat(dataView);
	result.songTime = DecodeFloat(dataView);
	result.timeScale = DecodeFloat(dataView);
	result.timeScale2 = DecodeFloat(dataView);
	result.combo = -1;

	return result;
}

function decodeIAFArray(dataView, offset) {
	dataView.pointer = offset;
	var num = DecodeInt(dataView);
	if (num > 10000) {
		num = 1;
	}
	var intAndFloatList = [];
	for (var index = 0; index < num; ++index)
		intAndFloatList.push({
			i: DecodeInt(dataView),
			a: DecodeFloat(dataView),
		});
	return intAndFloatList;
}

function DecodeInt(dataView) {
	const result = dataView.getInt32(dataView.pointer, true);
	dataView.pointer += 4;
	return result;
}

function DecodeUint8(dataView) {
	const result = dataView.getUint8(dataView.pointer, true);
	dataView.pointer++;
	return result;
}

function DecodeStringArray(dataView) {
	var length = DecodeInt(dataView);
	var strArray = [];
	for (var index = 0; index < length; ++index) strArray.push(DecodeString(dataView));
	return strArray;
}

function DecodeString(dataView) {
	const length = dataView.getInt32(dataView.pointer, true);
	if (length < 0 || length > 1000) {
		dataView.pointer += 1;
		return DecodeString(dataView);
	}
	var enc = new TextDecoder('utf-8');
	const string = enc.decode(new Int8Array(dataView.buffer.slice(dataView.pointer + 4, length + dataView.pointer + 4)));
	dataView.pointer += length + 4;
	return string;
}

function DecodeFloat(dataView) {
	const result = dataView.getFloat32(dataView.pointer, true);
	dataView.pointer += 4;
	return result;
}

function DecodeBool(dataView) {
	const result = dataView.getUint8(dataView.pointer, true) != 0;
	dataView.pointer++;
	return result;
}

module.exports.checkSS = checkSS;
