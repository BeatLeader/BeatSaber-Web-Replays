function checkBSOR(file, isLink, completion) {
    if (isLink) {
        if (file.split(".").pop() == "bsor") {
            file = file.replace('https://cdn.discordapp.com/', '/cors/discord-cdn/');
            var xhr = new XMLHttpRequest();
            xhr.open('GET', file, true);
            xhr.responseType = 'blob';

            xhr.onload = function () {
                checkBSORFile(xhr.response, completion);
            };
            xhr.send();
        } else {
            completion(null);
        }
    } else {
        checkBSORFile(file, completion);
    }
}

function checkBSORFile(file, completion) {
    var reader = new FileReader();
	reader.onload = function(e) {
		decode(e.target.result, completion);
	};
	reader.onerror = function(e) {
		// error occurred
		completion('Error: ' + e.type);
	};
	reader.readAsArrayBuffer(file);
}

function ssReplayToBSOR(ssReplay) {
    var result = {};
    
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
            note.noteID = parseInt(info[0])*1000 + parseInt(info[1])*100 + noteType*10 + parseInt(info[2]);
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

const StructType = {
    info: 0,
    frames: 1,
    notes: 2,
    walls: 3,
    heights: 4,
    pauses: 5
}

const NoteEventType = {
    good: 0,
    bad: 1,
    miss: 2,
    bomb: 3
}

function decode(arrayBuffer, completion) {
    const dataView = new DataView(arrayBuffer);
    dataView.pointer = 0;

    const magic = DecodeInt(dataView);
    const version = DecodeUint8(dataView);

    if (version == 1 && magic == 0x442d3d69) {
        var replay = {};

        for (var a = 0; a < StructType.pauses + 1; a++) {
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
            }
        }

        completion(replay);
    } else {
        completion(null);
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
    console.log("frames");
    const length = DecodeInt(dataView);
    var result = [];
    for (var i = 0; i < length; i++)
    {
        result.push(DecodeFrame(dataView));
    }
    return result;
}

function DecodeFrame(dataView) {
    var result = {};
    result.time = DecodeFloat(dataView);
    result.fps = DecodeInt(dataView);
    result.h = DecodeEuler(dataView);
    result.l = DecodeEuler(dataView);
    result.r = DecodeEuler(dataView);

    return result;
}

function DecodeNotes(dataView) {
    const length = DecodeInt(dataView);
    var result = [];
    for (var i = 0; i < length; i++)
    {
        result.push(DecodeNote(dataView));
    }
    return result;
}

function DecodeWalls(dataView) {
    const length = DecodeInt(dataView);
    var result = [];
    for (var i = 0; i < length; i++)
    {
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
    for (var i = 0; i < length; i++)
    {
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
    for (var i = 0; i < length; i++)
    {
        var pause = {};
        pause.duration = DecodeFloat(dataView);
        pause.time = DecodeFloat(dataView);
        result.push(pause);
    }
    return result;
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

function DecodeEuler(dataView)
{
    var result = {};
    result.p = DecodeVector3(dataView);
    result.r = DecodeQuaternion(dataView);

    return result;
}

function DecodeVector3(dataView)
{
    var result = {};

    result.x = DecodeFloat(dataView);
    result.y = DecodeFloat(dataView);
    result.z = DecodeFloat(dataView);

    return result;
}

function DecodeQuaternion(dataView)
{
    var result = {};

    result.x = DecodeFloat(dataView);
    result.y = DecodeFloat(dataView);
    result.z = DecodeFloat(dataView);
    result.w = DecodeFloat(dataView);

    return result;
}

function DecodeInt(dataView) {
    const result = dataView.getInt32(dataView.pointer, true);
    dataView.pointer += 4;
    return result;
}

function DecodeUint8(dataView)
{
    const result = dataView.getUint8(dataView.pointer, true);
    dataView.pointer++;
    return result;
}

function DecodeString(dataView)
{
    const length = dataView.getInt32(dataView.pointer, true);
    if (length > 1000) { 
        dataView.pointer += 1;
        return DecodeString(dataView);
     }
    var enc = new TextDecoder("utf-8");
    const string = enc.decode(new Int8Array(dataView.buffer.slice(dataView.pointer + 4, length + dataView.pointer + 4)));
    dataView.pointer += length + 4;
    return string;
}

function DecodeName(dataView)
{
    const length = dataView.getInt32(dataView.pointer, true);
    var enc = new TextDecoder("utf-8");
    let lengthOffset = 0;
    if (length > 0) {
        while (dataView.getInt32(length + dataView.pointer + 4 + lengthOffset, true) != 6 && dataView.getInt32(length + dataView.pointer + 4 + lengthOffset, true) != 5) {
            lengthOffset++;
        }
    }
    
    const string = enc.decode(new Int8Array(dataView.buffer.slice(dataView.pointer + 4, length + dataView.pointer + 4 + lengthOffset)));
    dataView.pointer += length + 4 + lengthOffset;
    return string;
}

function DecodeFloat(dataView)
{
    const result = dataView.getFloat32(dataView.pointer, true);
    dataView.pointer += 4;
    return result;
}

function DecodeBool(dataView)
{
    const result = dataView.getUint8(dataView.pointer, true) != 0;
    dataView.pointer++;
    return result;
}


module.exports.checkBSOR = checkBSOR;
module.exports.ssReplayToBSOR = ssReplayToBSOR;
module.exports.NoteEventType = NoteEventType;