// From game
const _noteLinesCount = 4;
const _noteLinesDistance = 0.6;

function getApiUrl() {
	if (location.host.includes('beatleader.net')) {
		return 'https://api.beatleader.net';
	} else if (location.host.includes('beatleader.xyz')) {
		return 'https://api.beatleader.xyz';
	}
	return 'https://api.beatleader.com';
}

function getWebsiteUrl() {
	if (location.host.includes('beatleader.net')) {
		return 'https://beatleader.net';
	} else if (location.host.includes('beatleader.com')) {
		return 'https://beatleader.com';
	}
	return 'https://beatleader.xyz';
}

function replaceCdnUrl(url) {
	if (location.host.includes('beatleader.net')) {
		return url.replace('beatleader.xyz', 'beatleader.net');
	} else if (location.host.includes('beatleader.com')) {
		return url.replace('beatleader.xyz', 'beatleader.com');
	}
	return url;
}

const LeaderboardContexts = {
	None: 0,
	General: 1 << 1,
	NoMods: 1 << 2,
	NoPause: 1 << 3,
	Golf: 1 << 4,
	SCPM: 1 << 5,
	Speedrun: 1 << 6,
	SpeedrunBackup: 1 << 7,
	Funny: 1 << 8,
};

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
	SliderHeadSliderTail: 6,
	BurstSliderHeadSliderTail: 7,
	BurstSliderElementSliderHead: 8,
};

const EaseType = {
	None: -1,
	Linear: 0,
	InQuad: 1,
	OutQuad: 2,
	InOutQuad: 3,
	InSine: 4,
	OutSine: 5,
	InOutSine: 6,
	InCubic: 7,
	OutCubic: 8,
	InOutCubic: 9,
	InQuart: 10,
	OutQuart: 11,
	InOutQuart: 12,
	InQuint: 13,
	OutQuint: 14,
	InOutQuint: 15,
	InExpo: 16,
	OutExpo: 17,
	InOutExpo: 18,
	InCirc: 19,
	OutCirc: 20,
	InOutCirc: 21,
	InBack: 22,
	OutBack: 23,
	InOutBack: 24,
	InElastic: 25,
	OutElastic: 26,
	InOutElastic: 27,
	InBounce: 28,
	OutBounce: 29,
	InOutBounce: 30,
	BeatSaberInOutBack: 100,
	BeatSaberInOutElastic: 101,
	BeatSaberInOutBounce: 102,
};

const Easing = {
	Linear: t => t,

	InSine: t => 1 - Math.cos((t * Math.PI) / 2),

	OutSine: t => Math.sin((t * Math.PI) / 2),

	InOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,

	InQuad: t => t * t,

	OutQuad: t => 1 - (1 - t) * (1 - t),

	InOutQuad: t => (t >= 0.5 ? (4 - 2 * t) * t - 1 : 2 * t * t),

	InCubic: t => t * t * t,

	OutCubic: t => 1 - Math.pow(1 - t, 3),

	InOutCubic: t => (t >= 0.5 ? 1 - Math.pow(-2 * t + 2, 3) / 2 : 4 * t * t * t),

	InQuart: t => t * t * t * t,

	OutQuart: t => 1 - Math.pow(1 - t, 4),

	InOutQuart: t => (t >= 0.5 ? 1 - Math.pow(-2 * t + 2, 4) / 2 : 8 * t * t * t * t),

	InQuint: t => t * t * t * t * t,

	OutQuint: t => 1 - Math.pow(1 - t, 5),

	InOutQuint: t => (t >= 0.5 ? 1 - Math.pow(-2 * t + 2, 5) / 2 : 16 * t * t * t * t * t),

	InExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),

	OutExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

	InOutExpo: t => {
		if (t === 0) return 0;
		if (t === 1) return 1;
		return t >= 0.5 ? (2 - Math.pow(2, -20 * t + 10)) / 2 : Math.pow(2, 20 * t - 10) / 2;
	},

	InCirc: t => 1 - Math.sqrt(1 - Math.pow(t, 2)),

	OutCirc: t => Math.sqrt(1 - Math.pow(t - 1, 2)),

	InOutCirc: t => (t >= 0.5 ? (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2 : (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2),

	InBack: t => 2.70158 * t * t * t - 1.70158 * t * t,

	OutBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),

	InOutBack: t =>
		t >= 0.5
			? (Math.pow(2 * t - 2, 2) * (3.5949094 * (2 * t - 2) + 2.5949094) + 2) / 2
			: (Math.pow(2 * t, 2) * (7.189819 * t - 2.5949094)) / 2,

	InElastic: t => {
		if (t === 0) return 0;
		if (t === 1) return 1;
		return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * 2.0944);
	},

	OutElastic: t => {
		if (t === 0) return 0;
		if (t === 1) return 1;
		return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * 2.0944) + 1;
	},

	InOutElastic: t => {
		if (t === 0) return 0;
		if (t === 1) return 1;
		return t >= 0.5
			? (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * 1.3963)) / 2 + 1
			: -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * 1.3963)) / 2;
	},

	InBounce: t => 1 - Easing.OutBounce(1 - t),

	OutBounce: t => {
		if (t < 0.36364) return (121 / 16) * t * t;
		if (t < 0.72727) return (121 / 16) * (t -= 0.54545) * t + 0.75;
		if (t < 0.90909) return (121 / 16) * (t -= 0.81818) * t + 15 / 16;
		return (121 / 16) * (t -= 0.95455) * t + 63 / 64;
	},

	InOutBounce: t => (t >= 0.5 ? (1 + Easing.OutBounce(2 * t - 1)) / 2 : (1 - Easing.OutBounce(1 - 2 * t)) / 2),

	BeatSaberInOutBack: t =>
		t >= 0.517 ? 1 + 2.70158 * Math.pow(1.665 * (t - 0.4) - 1, 3) + 1.70158 * Math.pow(1.665 * (t - 0.4) - 1, 2) : 5.014 * t * t * t,

	BeatSaberInOutElastic: t => (t >= 0.3 ? Math.pow(2, -10 * (t - 0.2)) * Math.sin(t * 10 * 2.0944) + 1 : 37.037 * t * t * t),

	BeatSaberInOutBounce: t => {
		if (t >= 0.72727) {
			if (t < 0.90909) return (121 / 16) * (t -= 0.81818) * t + 15 / 16;
			return (121 / 16) * (t -= 0.95455) * t + 63 / 64;
		}
		if (t < 0.36364) return 20.796 * t * t * t;
		return (121 / 16) * (t -= 0.54545) * t + 0.75;
	},
};

function Interpolate(t, easeType) {
	switch (easeType) {
		case EaseType.Linear:
			return Easing.Linear(t);
		case EaseType.InSine:
			return Easing.InSine(t);
		case EaseType.OutSine:
			return Easing.OutSine(t);
		case EaseType.InOutSine:
			return Easing.InOutSine(t);
		case EaseType.InQuad:
			return Easing.InQuad(t);
		case EaseType.OutQuad:
			return Easing.OutQuad(t);
		case EaseType.InOutQuad:
			return Easing.InOutQuad(t);
		case EaseType.InCubic:
			return Easing.InCubic(t);
		case EaseType.OutCubic:
			return Easing.OutCubic(t);
		case EaseType.InOutCubic:
			return Easing.InOutCubic(t);
		case EaseType.InQuart:
			return Easing.InQuart(t);
		case EaseType.OutQuart:
			return Easing.OutQuart(t);
		case EaseType.InOutQuart:
			return Easing.InOutQuart(t);
		case EaseType.InQuint:
			return Easing.InQuint(t);
		case EaseType.OutQuint:
			return Easing.OutQuint(t);
		case EaseType.InOutQuint:
			return Easing.InOutQuint(t);
		case EaseType.InExpo:
			return Easing.InExpo(t);
		case EaseType.OutExpo:
			return Easing.OutExpo(t);
		case EaseType.InOutExpo:
			return Easing.InOutExpo(t);
		case EaseType.InCirc:
			return Easing.InCirc(t);
		case EaseType.OutCirc:
			return Easing.OutCirc(t);
		case EaseType.InOutCirc:
			return Easing.InOutCirc(t);
		case EaseType.InBack:
			return Easing.InBack(t);
		case EaseType.OutBack:
			return Easing.OutBack(t);
		case EaseType.InOutBack:
			return Easing.InOutBack(t);
		case EaseType.InElastic:
			return Easing.InElastic(t);
		case EaseType.OutElastic:
			return Easing.OutElastic(t);
		case EaseType.InOutElastic:
			return Easing.InOutElastic(t);
		case EaseType.InBounce:
			return Easing.InBounce(t);
		case EaseType.OutBounce:
			return Easing.OutBounce(t);
		case EaseType.InOutBounce:
			return Easing.InOutBounce(t);
		case EaseType.BeatSaberInOutBack:
			return Easing.BeatSaberInOutBack(t);
		case EaseType.BeatSaberInOutElastic:
			return Easing.BeatSaberInOutElastic(t);
		case EaseType.BeatSaberInOutBounce:
			return Easing.BeatSaberInOutBounce(t);
		default:
			return Easing.Linear(t);
	}
}

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

var cached;
async function checkAutoplay() {
	if (cached === undefined) {
		const dummyAudio = document.createElement('audio');
		dummyAudio.src = '/assets/sounds/silence.mp3';
		document.body.appendChild(dummyAudio);

		try {
			await dummyAudio.play();
			console.log('Autoplay is enabled');
			cached = true;
		} catch (error) {
			console.log('Autoplay is disabled', error);
			cached = false;
		}
	}

	return cached;
}

function isFirefox() {
	return navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}

function createSilence(seconds = 1) {
	const sampleRate = 8000;
	const numChannels = 1;
	const bitsPerSample = 8;

	const blockAlign = (numChannels * bitsPerSample) / 8;
	const byteRate = sampleRate * blockAlign;
	const dataSize = Math.ceil(seconds * sampleRate) * blockAlign;
	const chunkSize = 36 + dataSize;
	const byteLength = 8 + chunkSize;

	const buffer = new ArrayBuffer(byteLength);
	const view = new DataView(buffer);

	view.setUint32(0, 0x52494646, false); // Chunk ID 'RIFF'
	view.setUint32(4, chunkSize, true); // File size
	view.setUint32(8, 0x57415645, false); // Format 'WAVE'
	view.setUint32(12, 0x666d7420, false); // Sub-chunk 1 ID 'fmt '
	view.setUint32(16, 16, true); // Sub-chunk 1 size
	view.setUint16(20, 1, true); // Audio format
	view.setUint16(22, numChannels, true); // Number of channels
	view.setUint32(24, sampleRate, true); // Sample rate
	view.setUint32(28, byteRate, true); // Byte rate
	view.setUint16(32, blockAlign, true); // Block align
	view.setUint16(34, bitsPerSample, true); // Bits per sample
	view.setUint32(36, 0x64617461, false); // Sub-chunk 2 ID 'data'
	view.setUint32(40, dataSize, true); // Sub-chunk 2 size

	for (let offset = 44; offset < byteLength; offset++) {
		view.setUint8(offset, 128);
	}

	const blob = new Blob([view], {type: 'audio/wav'});
	const url = URL.createObjectURL(blob);

	return url;
}

module.exports.getApiUrl = getApiUrl;
module.exports.getWebsiteUrl = getWebsiteUrl;
module.exports.replaceCdnUrl = replaceCdnUrl;
module.exports.LeaderboardContexts = LeaderboardContexts;
module.exports.getHorizontalPosition = getHorizontalPosition;
module.exports.getHorizontalWallPosition = getHorizontalWallPosition;
module.exports.getVerticalPosition = getVerticalPosition;
module.exports.highestJumpPosYForLineLayer = highestJumpPosYForLineLayer;
module.exports.get2DNoteOffset = get2DNoteOffset;
module.exports.directionVector = directionVector;
module.exports.NoteCutDirection = NoteCutDirection;
module.exports.NoteErrorType = NoteErrorType;
module.exports.EaseType = EaseType;
module.exports.Interpolate = Interpolate;
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
module.exports.checkAutoplay = checkAutoplay;
module.exports.isFirefox = isFirefox;
module.exports.createSilence = createSilence;
