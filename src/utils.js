function beatsaverCdnCors(url) {
  return url.replace('https://eu.cdn.beatsaver.com/', '/cors/beat-saver-cdn/');
}

// From game
const _noteLinesCount = 4;
const _noteLinesDistance = 0.6;

function getHorizontalPosition (lineIndex) {
  return (-(_noteLinesCount - 1) * 0.5 + lineIndex) * _noteLinesDistance;
}

function getVerticalPosition (lineLayer) {
  return 0.25 + 0.6 * (lineLayer + 1) - lineLayer * 0.05; 
}

function get2DNoteOffset(noteLineIndex, noteLineLayer) {
  return new THREE.Vector2(getHorizontalPosition(noteLineIndex), getVerticalPosition(noteLineLayer));
}

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
}

const NoteErrorType = {
  BadCut: -2,
  Miss: -3,
  Bomb: -4,
  Wall: -5
}

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

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

function angleBetween(from, to) {
  const num = Math.sqrt(from.lengthSq() * to.lengthSq());
  return num < 1.00000000362749E-15 ? 0.0 : Math.acos(clamp(from.dot(to) / num, -1, 1)) * 57.29578;
}

function signedAngle(from, to) {
  return angleBetween(from, to) * Math.sign((from.x * to.y - from.y * to.x));
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
module.exports.clamp = clamp;
