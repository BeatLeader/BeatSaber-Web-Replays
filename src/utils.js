// From game
const _noteLinesCount = 4;
const _noteLinesDistance = 0.6;

function getHorizontalPosition(lineIndex) {
	return (-(_noteLinesCount - 1) * 0.5 + lineIndex) * _noteLinesDistance;
}

function getHorizontalWallPosition(lineIndex) {
	return (lineIndex - 2) * _noteLinesDistance;
}

// 0.85 1.4 1.9
function highestJumpPosYForLineLayer(lineLayer) {
	return 0.6 * (lineLayer + 1) + 0.05 * (5 - lineLayer - (lineLayer > 1 ? 1 : 0));
}
// 0.25 0.85 1.45
function getVerticalPosition(lineLayer) {
	return 0.25 + 0.6 * lineLayer;
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

const SWORD_OFFSET = 0.9;

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

function LerpUnclamped(a, b, t) {
	return a + (b - a) * t;
}

// obj - your object (THREE.Object3D or derived)
// point - the point of rotation (THREE.Vector3)
// axis - the axis of rotation (normalized THREE.Vector3)
// theta - radian value of rotation
// pointIsWorld - boolean indicating the point is in world coordinates (default = false)
function rotateAboutPoint(obj, point, axis, theta, pointIsWorld) {
	pointIsWorld = pointIsWorld === undefined ? false : pointIsWorld;

	if (pointIsWorld) {
		obj.parent.localToWorld(obj.position); // compensate for world coordinate
	}

	obj.position.sub(point); // remove the offset
	obj.position.applyAxisAngle(axis, theta); // rotate the POSITION
	obj.position.add(point); // re-add the offset

	if (pointIsWorld) {
		obj.parent.worldToLocal(obj.position); // undo world coordinates compensation
	}
}

function hasTouchScreen() {
	var result = false;

	if ('maxTouchPoints' in navigator) {
		result = navigator.maxTouchPoints > 0;
	} else if ('msMaxTouchPoints' in navigator) {
		result = navigator.msMaxTouchPoints > 0;
	} else {
		var mQ = window.matchMedia && matchMedia('(pointer:coarse)');
		if (mQ && mQ.media === '(pointer:coarse)') {
			result = !!mQ.matches;
		} else if ('orientation' in window) {
			result = true; // deprecated, but good fallback
		} else {
			// Only as a last resort, fall back to user agent sniffing
			var UA = navigator.userAgent;
			result = /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(UA) || /\b(Android|Windows Phone|iPad|iPod)\b/i.test(UA);
		}
	}

	return result;
}

function getUrlParameter(name, url = window.location.href) {
	name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
	const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
	const results = regex.exec(url);
	if (!results) {
		return '';
	}
	const value = results[1];
	if (value.includes('cdn.discordapp')) {
		const cdnAndOthers = url.substring(results.index + 2 + name.length);
		return `${value}&is=${getUrlParameter('is', cdnAndOthers)}&hm=${getUrlParameter('hm', cdnAndOthers)}`;
	}
	return decodeURIComponent(value.replace(/\+/g, ' '));
}

function setCookie(name, value, seconds) {
	var expires = '';
	if (seconds) {
		var date = new Date();
		date.setTime(date.getTime() + seconds * 1000);
		expires = '; expires=' + date.toUTCString();
	}
	document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Lax';
}
function getCookie(name) {
	var nameEQ = name + '=';
	var ca = document.cookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') c = c.substring(1, c.length);
		if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
	}
	return null;
}

module.exports.getHorizontalPosition = getHorizontalPosition;
module.exports.getHorizontalWallPosition = getHorizontalWallPosition;
module.exports.getVerticalPosition = getVerticalPosition;
module.exports.highestJumpPosYForLineLayer = highestJumpPosYForLineLayer;
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
module.exports.rotateAboutPoint = rotateAboutPoint;
module.exports.LerpUnclamped = LerpUnclamped;
module.exports.hasTouchScreen = hasTouchScreen;
module.exports.getUrlParameter = getUrlParameter;
module.exports.setCookie = setCookie;
module.exports.getCookie = getCookie;
