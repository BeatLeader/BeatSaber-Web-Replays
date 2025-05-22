function getApiUrl() {
	if (location.host.includes('beatleader.net')) {
		return 'https://api.beatleader.net';
	} else if (location.host.includes('beatleader.xyz')) {
		return 'https://api.beatleader.xyz';
	}
	return 'https://api.beatleader.com';
}

function checkBSOR(file, isLink, completion) {
	if (isLink) {
		const filename = file.split('?')[0];
		if (filename.split('.').pop() == 'bsor' || filename.split('.').pop() == 'bsortemp') {
			file = file.replace('https://cdn.discordapp.com/attachments/', 'https://discord.beatleader.pro/');
			file = file.replace('https://api.beatleader.com', getApiUrl());
			file = file.replace('https://api.beatleader.xyz', getApiUrl());
			file = file.replace('https://api.beatleader.net', getApiUrl());
			var xhr = new XMLHttpRequest();
			xhr.open('GET', file, true);
			xhr.withCredentials = file.includes('/otherreplays/');
			xhr.responseType = 'blob';

			xhr.onload = function () {
				if (xhr.status == 200) {
					checkBSORFile(xhr.response, completion);
				} else {
					completion('Error: failed to download replay');
				}
			};
			xhr.send();
		} else {
			completion('Error: wrong file format');
		}
	} else {
		checkBSORFile(file, completion);
	}
}

function checkBSORFile(file, completion) {
	var reader = new FileReader();
	reader.onload = function (e) {
		decode(e.target.result, completion);
	};
	reader.onerror = function (e) {
		// error occurred
		completion('Error: ' + e.type);
	};
	reader.readAsArrayBuffer(file);
}

const StructType = {
	info: 0,
	frames: 1,
	notes: 2,
	walls: 3,
	heights: 4,
	pauses: 5,
	offset: 6,
	customData: 7,
};

const NoteEventType = {
	good: 0,
	bad: 1,
	miss: 2,
	bomb: 3,
};

function decode(arrayBuffer, completion) {
	const dataView = new DataView(arrayBuffer);
	dataView.pointer = 0;

	const magic = DecodeInt(dataView);
	const version = DecodeUint8(dataView);

	if (version == 1 && magic == 0x442d3d69) {
		var replay = {};

		for (var a = 0; a < StructType.customData + 1 && dataView.pointer < dataView.byteLength; a++) {
			const type = DecodeUint8(dataView);
			switch (type) {
				case StructType.info:
					replay.info = DecodeInfo(dataView);
					break;
				case StructType.frames:
					replay.frames = DecodeFrames(dataView);
					break;
				case StructType.notes:
					replay.notes = DecodeNotes(dataView);
					break;
				case StructType.walls:
					replay.walls = DecodeWalls(dataView);
					break;
				case StructType.heights:
					replay.heights = DecodeHeight(dataView);
					break;
				case StructType.pauses:
					replay.pauses = DecodePauses(dataView);
					break;
				case StructType.offset:
					replay.offset = DecodeOffsets(dataView);
					break;
				case StructType.customData:
					replay.customData = DecodeCustomData(dataView);
					ParseKnownCustomData(replay);
					break;
			}
		}

		completion(replay);
	} else {
		completion('Error: failed to decode replay');
	}
}

function DecodeInfo(dataView) {
	var result = {};

	result.version = DecodeString(dataView);
	result.gameVersion = DecodeString(dataView);
	result.timestamp = DecodeString(dataView);

	result.playerID = DecodeString(dataView);
	result.playerName = DecodeName(dataView);
	result.platform = DecodeString(dataView);

	result.trackingSystem = DecodeString(dataView);
	result.hmd = DecodeString(dataView);
	result.controller = DecodeString(dataView);

	result.hash = DecodeString(dataView);
	result.songName = DecodeString(dataView);
	result.mapper = DecodeString(dataView);
	result.difficulty = DecodeString(dataView);

	result.score = DecodeInt(dataView);
	result.mode = DecodeString(dataView);
	result.environment = DecodeString(dataView);
	result.modifiers = DecodeString(dataView);
	result.jumpDistance = DecodeFloat(dataView);
	result.leftHanded = DecodeBool(dataView);
	result.height = DecodeFloat(dataView);

	result.startTime = DecodeFloat(dataView);
	result.failTime = DecodeFloat(dataView);
	result.speed = DecodeFloat(dataView);

	return result;
}

function DecodeFrames(dataView) {
	const length = DecodeInt(dataView);
	var result = [];
	for (var i = 0; i < length; i++) {
		var frame = DecodeFrame(dataView);
		if (frame.time != 0 && (result.length == 0 || frame.time != result[result.length - 1].time)) {
			result.push(frame);
		}
	}
	return result;
}

function DecodeFrame(dataView) {
	var result = {};
	result.time = DecodeFloat(dataView);
	result.fps = DecodeInt(dataView);
	result.head = DecodeEuler(dataView);
	result.left = DecodeEuler(dataView);
	result.right = DecodeEuler(dataView);

	return result;
}

function DecodeNotes(dataView) {
	const length = DecodeInt(dataView);
	var result = [];
	for (var i = 0; i < length; i++) {
		result.push(DecodeNote(dataView));
	}
	return result;
}

function DecodeWalls(dataView) {
	const length = DecodeInt(dataView);
	var result = [];
	for (var i = 0; i < length; i++) {
		var wall = {};
		wall.wallID = DecodeInt(dataView);
		wall.energy = DecodeFloat(dataView);
		wall.time = DecodeFloat(dataView);
		wall.spawnTime = DecodeFloat(dataView);
		result.push(wall);
	}
	return result;
}

function DecodeHeight(dataView) {
	const length = DecodeInt(dataView);
	var result = [];
	for (var i = 0; i < length; i++) {
		var height = {};
		height.height = DecodeFloat(dataView);
		height.time = DecodeFloat(dataView);
		result.push(height);
	}
	return result;
}

function DecodePauses(dataView) {
	const length = DecodeInt(dataView);
	var result = [];
	for (var i = 0; i < length; i++) {
		var pause = {};
		pause.duration = DecodeLong(dataView);
		pause.time = DecodeFloat(dataView);
		result.push(pause);
	}
	return result;
}

function DecodeOffsets(dataView) {
	var result = {};
	result.leftSaberPos = DecodeVector3(dataView);
	result.leftSaberRot = DecodeQuaternion(dataView);
	result.rightSaberPos = DecodeVector3(dataView);
	result.rightSaberRot = DecodeQuaternion(dataView);
	return result;
}

function DecodeCustomData(dataView) {
	var result = {};
	const length = DecodeInt(dataView);
	for (var i = 0; i < length; i++) {
		const key = DecodeString(dataView);
		const customDataLength = DecodeInt(dataView);
		const value = new Int8Array(dataView.buffer.slice(dataView.pointer, customDataLength + dataView.pointer));
		result[key] = value;
	}
	return result;
}

function ParseKnownCustomData(replay) {
	replay.parsedCustomData = {};
	if (replay.customData) {
		if (replay.customData['HeartBeatQuest']) {
			var result = {};
			const dataView = new DataView(replay.customData['HeartBeatQuest'].buffer);
			dataView.pointer = 0;

			const version = DecodeInt(dataView);
			if (version == 1) {
				const length = DecodeInt(dataView);
				result.frames = [];
				for (var i = 0; i < length; i++) {
					var frame = {};
					frame.time = DecodeFloat(dataView);
					frame.heartrate = DecodeInt(dataView);
					result.frames.push(frame);
				}
				result.device = DecodeString(dataView);
				replay.parsedCustomData['HeartBeatQuest'] = result;
			}
		}
		if (replay.customData['reesabers:tricks-replay']) {
			var result = {};
			const dataView = new DataView(replay.customData['reesabers:tricks-replay'].buffer);
			dataView.pointer = 0;

			const magic = DecodeInt(dataView);
			if (magic === 1630166513) {
				const version = DecodeInt(dataView);
				result.version = version;

				result.left = DecodeHandReplay(dataView);
				result.right = DecodeHandReplay(dataView);

				replay.parsedCustomData['reesabers:tricks-replay'] = result;

				AddTricksToReplay(replay, result);
			}
		}
	}
}

function AddTricksToReplay(replay, tricksReplay) {
	if (!replay.frames || !replay.frames.length) return;

	if (tricksReplay.left) {
		let frameIndex = 0;
		for (const segment of tricksReplay.left.segmentsArray) {
			for (const trickFrame of segment.framesArray) {
				// Find appropriate frame
				while (frameIndex < replay.frames.length - 1 && replay.frames[frameIndex + 1].time <= trickFrame.songTime) {
					frameIndex++;
				}

				if (frameIndex < replay.frames.length) {
					// Apply pose to frame
					AddPoseToFrame(replay.frames[frameIndex].left, trickFrame);
				}
			}
		}
	}

	if (tricksReplay.right) {
		let frameIndex = 0;
		for (const segment of tricksReplay.right.segmentsArray) {
			for (const trickFrame of segment.framesArray) {
				// Find appropriate frame
				while (frameIndex < replay.frames.length - 1 && replay.frames[frameIndex + 1].time <= trickFrame.songTime) {
					frameIndex++;
				}

				if (frameIndex < replay.frames.length) {
					// Apply pose to frame
					AddPoseToFrame(replay.frames[frameIndex].right, trickFrame);
				}
			}
		}
	}
}

function AddPoseToFrame(framePose, trickPose) {
	framePose.trickPosition = {
		x: trickPose.posX,
		y: trickPose.posY,
		z: trickPose.posZ,
	};

	framePose.trickRotation = {
		x: trickPose.rotX,
		y: trickPose.rotY,
		z: trickPose.rotZ,
		w: trickPose.rotW,
	};
}

function DecodeNote(dataView) {
	var result = {};

	result.noteID = DecodeInt(dataView);
	result.eventTime = DecodeFloat(dataView);
	result.spawnTime = DecodeFloat(dataView);
	result.eventType = DecodeInt(dataView);
	if (result.eventType == NoteEventType.good || result.eventType == NoteEventType.bad) {
		result.noteCutInfo = DecodeCutInfo(dataView);
	}

	return result;
}

function DecodeCutInfo(dataView) {
	var result = {};

	result.speedOK = DecodeBool(dataView);
	result.directionOK = DecodeBool(dataView);
	result.saberTypeOK = DecodeBool(dataView);
	result.wasCutTooSoon = DecodeBool(dataView);
	result.saberSpeed = DecodeFloat(dataView);
	result.saberDir = DecodeVector3(dataView);
	result.saberType = DecodeInt(dataView);
	result.timeDeviation = DecodeFloat(dataView);
	result.cutDirDeviation = DecodeFloat(dataView);
	result.cutPoint = DecodeVector3(dataView);
	result.cutNormal = DecodeVector3(dataView);
	result.cutDistanceToCenter = DecodeFloat(dataView);
	result.cutAngle = DecodeFloat(dataView);
	result.beforeCutRating = DecodeFloat(dataView);
	result.afterCutRating = DecodeFloat(dataView);

	return result;
}

function DecodeEuler(dataView) {
	var result = {};
	result.position = DecodeVector3(dataView);
	result.rotation = DecodeQuaternion(dataView);

	return result;
}

function DecodeVector3(dataView) {
	var result = {};

	result.x = DecodeFloat(dataView);
	result.y = DecodeFloat(dataView);
	result.z = DecodeFloat(dataView);

	return result;
}

function DecodeQuaternion(dataView) {
	var result = {};

	result.x = DecodeFloat(dataView);
	result.y = DecodeFloat(dataView);
	result.z = DecodeFloat(dataView);
	result.w = DecodeFloat(dataView);

	return result;
}

function DecodeLong(dataView) {
	const result = dataView.getBigInt64(dataView.pointer, true);
	dataView.pointer += 8;
	return result;
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

function DecodeString(dataView) {
	const length = dataView.getInt32(dataView.pointer, true);
	if (length < 0 || length > 300) {
		dataView.pointer += 1;
		return DecodeString(dataView);
	}
	var enc = new TextDecoder('utf-8');
	const string = enc.decode(new Int8Array(dataView.buffer.slice(dataView.pointer + 4, length + dataView.pointer + 4)));
	dataView.pointer += length + 4;
	return string;
}

function DecodeName(dataView) {
	const length = dataView.getInt32(dataView.pointer, true);
	var enc = new TextDecoder('utf-8');
	let lengthOffset = 0;
	if (length > 0) {
		while (
			dataView.getInt32(length + dataView.pointer + 4 + lengthOffset, true) != 6 &&
			dataView.getInt32(length + dataView.pointer + 4 + lengthOffset, true) != 5 &&
			dataView.getInt32(length + dataView.pointer + 4 + lengthOffset, true) != 8
		) {
			lengthOffset++;
		}
	}

	const string = enc.decode(new Int8Array(dataView.buffer.slice(dataView.pointer + 4, length + dataView.pointer + 4 + lengthOffset)));
	dataView.pointer += length + 4 + lengthOffset;
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

function DecodeHandReplay(dataView) {
	var result = {};
	result.segmentsCount = DecodeInt(dataView);
	result.segmentsArray = [];

	for (var i = 0; i < result.segmentsCount; i++) {
		result.segmentsArray.push(DecodeSegment(dataView));
	}

	return result;
}

function DecodeSegment(dataView) {
	var result = {};
	result.framesCount = DecodeInt(dataView);
	result.framesArray = [];

	for (var i = 0; i < result.framesCount; i++) {
		result.framesArray.push(DecodeTrickFrame(dataView));
	}

	return result;
}

function DecodeTrickFrame(dataView) {
	var result = {};
	result.songTime = DecodeFloat(dataView);
	result.posX = DecodeFloat(dataView);
	result.posY = DecodeFloat(dataView);
	result.posZ = DecodeFloat(dataView);
	result.rotX = DecodeFloat(dataView);
	result.rotY = DecodeFloat(dataView);
	result.rotZ = DecodeFloat(dataView);
	result.rotW = DecodeFloat(dataView);
	return result;
}

module.exports.checkBSOR = checkBSOR;
module.exports.NoteEventType = NoteEventType;
