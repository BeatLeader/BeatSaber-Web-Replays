function beatsaverCdnCors(url) {
	return url.replace('https://eu.cdn.beatsaver.com/', '/cors/beat-saver-cdn/');
}

// From game
const _noteLinesCount = 4;
const _noteLinesDistance = 0.6;

function getHorizontalPosition(lineIndex) {
	return (-(_noteLinesCount - 1) * 0.5 + lineIndex) * _noteLinesDistance;
}

function getVerticalPosition(lineLayer) {
	return 0.25 + 0.6 * (lineLayer + 1) - lineLayer * 0.05;
}

function get2DNoteOffset(noteLineIndex, noteLineLayer) {
	return new THREE.Vector2(getHorizontalPosition(noteLineIndex), getVerticalPosition(noteLineLayer));
}

const NoteLineLayer = {
	Base: 0,
	Upper: 1,
	Top: 2,
};

const NoteCutDirection = {
	Up: 0,
	Down: 1,
	Left: 2,
	Right: 3,
	UpLeft: 4,
	UpRight: 5,
	DownLeft: 6,
	DownRight: 7,
	Any: 8,
	None: 9,
};

const NoteErrorType = {
	BadCut: -2,
	Miss: -3,
	Bomb: -4,
	Wall: -5,
};

const ScoringType = {
	Ignore: -1,
	NoScore: 0,
	Normal: 1,
	SliderHead: 2,
	SliderTail: 3,
	BurstSliderHead: 4,
	BurstSliderElement: 5,
};

const SWORD_OFFSET = 0.8;

function mirrorDirection(cutDirection) {
	switch (cutDirection) {
		case NoteCutDirection.Up:
			return NoteCutDirection.Up;
		case NoteCutDirection.Down:
			return NoteCutDirection.Down;
		case NoteCutDirection.Left:
			return NoteCutDirection.Right;
		case NoteCutDirection.Right:
			return NoteCutDirection.Left;
		case NoteCutDirection.UpLeft:
			return NoteCutDirection.UpRight;
		case NoteCutDirection.UpRight:
			return NoteCutDirection.UpLeft;
		case NoteCutDirection.DownLeft:
			return NoteCutDirection.DownRight;
		case NoteCutDirection.DownRight:
			return NoteCutDirection.DownLeft;
		default:
			return cutDirection;
	}
}

function directionVector(cutDirection) {
	switch (cutDirection) {
		case NoteCutDirection.Up:
			return new THREE.Vector2(0.0, 1);
		case NoteCutDirection.Down:
			return new THREE.Vector2(0.0, -1);
		case NoteCutDirection.Left:
			return new THREE.Vector2(-1, 0.0);
		case NoteCutDirection.Right:
			return new THREE.Vector2(1, 0.0);
		case NoteCutDirection.UpLeft:
			return new THREE.Vector2(-0.7071, 0.7071);
		case NoteCutDirection.UpRight:
			return new THREE.Vector2(0.7071, 0.7071);
		case NoteCutDirection.DownLeft:
			return new THREE.Vector2(-0.7071, -0.7071);
		case NoteCutDirection.DownRight:
			return new THREE.Vector2(0.7071, -0.7071);
		default:
			return new THREE.Vector2(0.0, 0.0);
	}
}

function difficultyFromName(name) {
	switch (name) {
		case 'Easy':
		case 'easy':
			return 1;
		case 'Normal':
		case 'normal':
			return 3;
		case 'Hard':
		case 'hard':
			return 5;
		case 'Expert':
		case 'expert':
			return 7;
		case 'ExpertPlus':
		case 'expertPlus':
			return 9;

		default:
			return 0;
	}
}

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

function angleBetween(from, to) {
	const num = Math.sqrt(from.lengthSq() * to.lengthSq());
	return num < 1.00000000362749e-15 ? 0.0 : Math.acos(clamp(from.dot(to) / num, -1, 1)) * 57.29578;
}

function signedAngle(from, to) {
	return angleBetween(from, to) * Math.sign(from.x * to.y - from.y * to.x);
}

function signedAngleToLine(vec, line) {
	const f1 = signedAngle(vec, line);
	const f2 = signedAngle(vec, line.negate());
	return Math.abs(f1) >= Math.abs(f2) ? f2 : f1;
}

function clone(obj) {
	if (null == obj || 'object' != typeof obj) return obj;
	var copy = obj.constructor();
	for (var attr in obj) {
		if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
	}
	return copy;
}

function BezierCurve(p0, p1, p2, t) {
	var num = 1 - t;
	const pos = new THREE.Vector2()
		.addScaledVector(p0, num * num)
		.addScaledVector(p1, 2 * num * t)
		.addScaledVector(p2, t * t);
	const tangent = new THREE.Vector2()
		.subVectors(p1, p0)
		.multiplyScalar(2.0 * (1.0 - t))
		.addScaledVector(new THREE.Vector2().subVectors(p2, p1), 2.0 * t);

	return [pos, tangent];
}

module.exports.beatsaverCdnCors = beatsaverCdnCors;
module.exports.getHorizontalPosition = getHorizontalPosition;
module.exports.getVerticalPosition = getVerticalPosition;
module.exports.get2DNoteOffset = get2DNoteOffset;
module.exports.directionVector = directionVector;
module.exports.NoteCutDirection = NoteCutDirection;
module.exports.NoteErrorType = NoteErrorType;
module.exports.mirrorDirection = mirrorDirection;
module.exports.signedAngle = signedAngle;
module.exports.signedAngleToLine = signedAngleToLine;
module.exports.clamp = clamp;
module.exports.clone = clone;
module.exports.SWORD_OFFSET = SWORD_OFFSET;
module.exports.difficultyFromName = difficultyFromName;
module.exports.ScoringType = ScoringType;
module.exports.BezierCurve = BezierCurve;
module.exports.NoteLineLayer = NoteLineLayer;
