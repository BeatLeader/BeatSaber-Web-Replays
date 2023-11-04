import {
	getHorizontalPosition,
	getVerticalPosition,
	highestJumpPosYForLineLayer,
	NoteErrorType,
	SWORD_OFFSET,
	BezierCurve,
	rotateAboutPoint,
	NoteLineLayer,
	LerpUnclamped,
} from '../utils';
const COLORS = require('../constants/colors.js');

const auxObj3D = new THREE.Object3D();
const collisionZThreshold = -2.6;
const DESTROYED_SPEED = 1.0;
const ONCE = {once: true};

const SOUND_STATE = {
	initial: 0,
	waitingForHitSound: 1,
	hitPlayed: 2,
};

const RandomRotations = [
	new THREE.Vector3(-0.9543871, -0.1183784, 0.2741019),
	new THREE.Vector3(0.7680854, -0.08805521, 0.6342642),
	new THREE.Vector3(-0.6780157, 0.306681, -0.6680131),
	new THREE.Vector3(0.1255014, 0.9398643, 0.3176546),
	new THREE.Vector3(0.365105, -0.3664974, -0.8557909),
	new THREE.Vector3(-0.8790653, -0.06244748, -0.4725934),
	new THREE.Vector3(0.01886305, -0.8065798, 0.5908241),
	new THREE.Vector3(-0.1455435, 0.8901445, 0.4318099),
	new THREE.Vector3(0.07651193, 0.9474725, -0.3105508),
	new THREE.Vector3(0.1306983, -0.2508438, -0.9591639),
];

var saberEls;
var headset;
var replayLoader;
var replayPlayer;
var settings;
var song;

var mineParticles;
var hitSound;

function initStatic(sceneEl) {
	saberEls = sceneEl.querySelectorAll('[saber-controls]');
	headset = sceneEl.querySelectorAll('.headset')[0];
	replayLoader = sceneEl.components['replay-loader'];
	replayPlayer = sceneEl.components['replay-player'];
	settings = sceneEl.components['settings'];
	song = sceneEl.components.song;
	hitSound = sceneEl.components['beat-hit-sound'];

	mineParticles = document.getElementById('mineParticles');
}

function InOutQuad(t) {
	return t >= 0.5 ? (4.0 - 2.0 * t) * t - 1.0 : 2 * t * t;
}

function getCurrentTime() {
	return settings.settings.showHitboxes ? replayPlayer.frameTime : song.getCurrentTime();
}

/**
 * Bears, beats, Battlestar Galactica.
 * Create beat from pool, collision detection, movement, scoring.
 */
AFRAME.registerComponent('beat', {
	schema: {
		index: {default: 0},
		type: {default: 'arrow', oneOf: ['arrow', 'dot', 'mine', 'spline']},
		color: {default: 'red', oneOf: ['red', 'blue']},
		cutDirection: {default: 'down'},
		rotationOffset: {default: 0},
		horizontalPosition: {default: 1},
		verticalPosition: {default: 1},
		size: {default: 0.4},
		warmupPosition: {default: 0},
		time: {default: -1},
		noteId: {default: 0},
		noteIdWithScoring: {default: 0},
		seeking: {default: false},

		// Z Movement
		time: {default: 0},
		speed: {default: 8.0},
		halfJumpPosition: {default: 0},
		warmupPosition: {default: 0},
		halfJumpDuration: {default: 0},
		moveTime: {default: 0},
		warmupSpeed: {default: 0},
		beforeJumpLineLayer: {default: 0},

		// Colors
		blue: {default: COLORS.BEAT_BLUE},
		red: {default: COLORS.BEAT_RED},

		// V3
		headCutDirection: {default: 'down'},
		tailHorizontalPosition: {default: 0},
		tailVerticalPosition: {default: 0},
		sliceCount: {default: 0},
		sliceIndex: {default: 0},
		tailTime: {default: 0},
		squishAmount: {default: 0},

		// 90/360
		spawnRotation: {default: 0},

		// Rabbit jump animation
		flip: {default: false},
		flipHorizontalPosition: {default: 0},
		flipYSide: {default: 0},

		// Loading cubes
		loadingCube: {default: false},
		visible: {default: true},
		animating: {default: true},

		// Debug
		debug: {default: false},
	},

	cutColor: {
		blue: '#fff',
		red: '#fff',
	},

	models: {
		arrow: 'beatObjTemplate',
		dot: 'beatObjTemplate',
		mine: 'mineObjTemplate',
		sliderhead: 'sliderheadObjTemplate',
		sliderchain: 'sliderchainObjTemplate',
	},

	signModels: {
		arrowred: 'arrowRedObjTemplate',
		arrowblue: 'arrowBlueObjTemplate',
		sliderheadred: 'arrowRedObjTemplate',
		sliderheadblue: 'arrowBlueObjTemplate',
		dotred: 'dotRedObjTemplate',
		dotblue: 'dotBlueObjTemplate',
		sliderchainred: 'dotRedObjTemplate',
		sliderchainblue: 'dotBlueObjTemplate',
	},

	rotations: {
		up: 180,
		down: 0,
		left: 270,
		right: 90,
		upleft: 225,
		upright: 135,
		downleft: 315,
		downright: 45,
	},

	init: function () {
		this.beatBoundingBox = new THREE.Box3();
		this.beatBigBoundingBox = new THREE.Box3();
		this.currentRotationmoveTime = 0;
		this.cutDirection = new THREE.Vector3();
		this.destroyed = false;
		this.gravityVelocity = 0;

		this.hitEventDetail = {};
		this.hitSoundState = SOUND_STATE.initial;

		this.poolName = undefined;
		this.returnToPoolTimeStart = undefined;
		this.rotationAxis = new THREE.Vector3();

		this.scoreEl = null;
		this.rightCutPlanePoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
		this.leftCutPlanePoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

		if (!replayLoader) {
			initStatic(this.el.sceneEl);
		}

		this.explodeEventDetail = {position: new THREE.Vector3(), rotation: new THREE.Euler()};
		this.saberColors = {right: 'blue', left: 'red'};
		this.glow = null;

		this.onEndStroke = this.onEndStroke.bind(this);

		this.strokeDirectionVector = new THREE.Vector3();
		this.bladeTipPosition = new THREE.Vector3();
		this.startStrokePosition = new THREE.Vector3();
		this.startRotation = new THREE.Quaternion(0, 0, 0, 1);

		this.initBlock();
	},

	update: function (oldData) {
		if (this.data.time == -1 && !this.data.loadingCube) return;

		this.updateBlock();

		if (this.data.type === 'mine') {
			this.poolName = `pool__beat-mine`;
		} else {
			this.poolName = `pool__beat-${this.data.type}-${this.data.color}`;
		}

		if (this.data.loadingCube) {
			if (!oldData.visible && this.data.visible) {
				this.signEl.object3D.visible = false;
				this.setObjModelFromTemplate(
					this.signEl,
					this.signModels[this.data.type + this.data.color],
					this.el.sceneEl.systems.materials.beatSignMaterial
				);
				this.el.object3D.rotation.y = ((this.data.color == 'red' ? 1 : -1) * Math.PI) / 4;
				this.el.object3D.rotation.z = ((this.data.color == 'red' ? 1 : -1) * Math.PI) / 4;
			} else if (oldData.visible && !this.data.visible) {
				this.returnToPool();
			}
		}
	},

	play: function () {
		if (!this.hitSaberEl) {
			this.blockEl.object3D.visible = true;
			this.destroyed = false;
			this.el.object3D.visible = true;
		}
	},

	getZPos: function (start, end, headOffsetZ, t) {
		return LerpUnclamped(start + headOffsetZ * Math.min(1, t * 2), end + headOffsetZ, t);
	},

	updatePosition: function () {
		const el = this.el;
		const data = this.data;
		const disableJumps = settings.settings.disableJumps;

		var position = el.object3D.position;
		var newPosition = 0;

		const songTime = getCurrentTime();

		var num1 = songTime - (data.time - data.halfJumpDuration);
		var t = num1 / (data.halfJumpDuration * 2);

		var newX = t < 0 ? this.startPos.x : t >= 0.25 ? this.endPos.x : this.startPos.x + (this.endPos.x - this.startPos.x) * InOutQuad(t * 4);
		var newY = 0;

		var timeOffset = data.time - songTime - data.halfJumpDuration - data.moveTime;
		if (timeOffset <= -data.moveTime) {
			newPosition = this.getZPos(
				data.halfJumpPosition - SWORD_OFFSET,
				-data.halfJumpPosition - SWORD_OFFSET,
				headset.object3D.position.z,
				t
			);

			newY = this.startPos.y + this.startVerticalVelocity * num1 - this.gravity * num1 * num1 * 0.5;
		} else {
			newY = this.startPos.y;
			newPosition = data.halfJumpPosition + data.warmupPosition + data.warmupSpeed * -timeOffset - SWORD_OFFSET;
		}

		if (disableJumps) {
			newX = this.endPos.x;
			newY = this.endPos.y;
		}

		position.y = newY;

		if (data.spawnRotation == 0) {
			position.z = newPosition;
			position.x = newX;
		} else {
			var direction = this.startPosition.clone().sub(this.origin).normalize();
			el.object3D.position.copy(direction.multiplyScalar(-newPosition).add(this.origin));
			position = el.object3D.position;
			const xDiff = newX - this.endPos.x;
			position.z -= xDiff * Math.cos((90 - data.spawnRotation) * 0.0175);
			position.x += xDiff * Math.sin((90 - data.spawnRotation) * 0.0175);
		}

		this.currentPositionZ = newPosition;

		if (!disableJumps && this.yAvoidance != 0 && t > 0 && t < 0.25) {
			position.y += (0.5 - Math.cos(t * 8.0 * Math.PI) * 0.5) * this.yAvoidance;
		}

		if (t >= 0 && t <= 0.5 && data.type != 'mine') {
			var a = this.endRotation.clone();
			if (!disableJumps) {
				if (t >= 0.125) {
					a = this.middleRotation.clone().slerp(this.endRotation, Math.sin((t - 0.125) * Math.PI * 2.0));
				} else {
					a = this.startRotation.clone().slerp(this.middleRotation, Math.sin(t * Math.PI * 4.0));
				}
			}

			var headPseudoLocalPos = headset.object3D.position.clone();
			var localPosition = position.clone();

			headPseudoLocalPos.y = THREE.Math.lerp(headPseudoLocalPos.y, localPosition.y, 0.8);

			el.object3D.up = new THREE.Vector3(-Math.sin(this.zRotation), Math.cos(this.zRotation), 0);
			el.object3D.lookAt(headPseudoLocalPos);

			if (data.spawnRotation == 0) {
				let rotation = new THREE.Euler().setFromQuaternion(a.clone().slerp(el.object3D.quaternion, t * 2));
				el.object3D.rotation.set(rotation.x, rotation.y, rotation.z);
			} else {
				// TODO: figure out the look on player in 90/360
				const inverseWorldRotation = new THREE.Vector3(0, -data.spawnRotation, 0);
				let rotation = new THREE.Euler().setFromQuaternion(a);
				el.object3D.rotation.set(rotation.x, rotation.y, rotation.z);
			}
		} else if (disableJumps) {
			el.object3D.rotation.set(this.endRotationEuler.x, this.endRotationEuler.y, this.endRotationEuler.z);
		}
	},

	tock: function (time, timeDelta) {
		if (this.data.loadingCube) {
			if (this.data.animating) {
				if (!this.signEl.object3D.visible && this.signEl.getObject3D('mesh') && this.signEl.getObject3D('mesh').material) {
					this.signEl.object3D.visible = true;
				}
				let object = this.el.object3D;
				const m = Math.cos(time / 300);
				const m2 = Math.cos(time / 300 - Math.PI / 2);
				object.rotation.y += m2 * 0.003;
				object.rotation.z += (this.data.color == 'red' ? 1 : -1) * m2 * 0.003;
				object.scale.multiplyScalar(m * 0.003 + 1);
			}

			return;
		}

		if (!settings.realHitsounds) {
			this.checkStaticHitsound();
			if (this.hitSoundState == SOUND_STATE.waitingForHitSound) {
				return;
			}
		}
		const el = this.el;

		if (this.destroyed) {
			if (!settings.settings.reducedDebris) {
				this.tockDestroyed(timeDelta);
			} else if (this.partRightEl) {
				this.returnToPool(true);
			}
			// Check to remove score entity from pool.
		} else {
			if (!this.replayNote.cutPoint && this.currentPositionZ > collisionZThreshold) {
				this.checkCollisions();
			}

			this.updatePosition();

			if (
				this.data.type != 'mine' &&
				this.replayNote.score != NoteErrorType.Miss &&
				((this.replayNote.cutPoint &&
					this.currentPositionZ - -1 * this.replayNote.cutPoint.z > -0.05 &&
					(settings.settings.reducedDebris || !this.checkCollisions())) ||
					getCurrentTime() >= this.replayNote.time)
			) {
				this.showScore();
				this.destroyBeat(saberEls[this.replayNote.colorType]);
				this.postScoreEvent();
			} else {
				this.backToPool = this.currentPositionZ >= 2;
				if (this.backToPool) {
					this.missHit();
				}
			}

			if (this.data.type === 'mine' && this.replayNote.totalScore != -1 && getCurrentTime() >= this.replayNote.time) {
				if (this.replayNote) {
					this.postScoreEvent();
				}

				this.destroyMine();
			}
		}
		if (this.hitboxObject) {
			this.hitboxObject.visible = !this.destroyed && settings.settings.showHitboxes;
		}
		if (this.smallHitObject) {
			this.smallHitObject.visible = !this.destroyed && settings.settings.showHitboxes;
		}
		if (this.rainbowShader && !this.blockEl.materialToReset && this.blockEl.getObject3D('mesh').material.envMap) {
			this.blockEl.materialToReset = this.blockEl.getObject3D('mesh').material;
			this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials[this.data.color + 'BlockRainbowMaterial'];
		}

		this.returnToPool();
	},

	/**
	 * Called when summoned by beat-generator.
	 */
	onGenerate: function () {
		const data = this.data;
		const el = this.el;

		if (!settings.settings.reducedDebris) {
			if (this.data.type === 'mine' && !this.mineBroken) {
				this.initMineFragments();
			} else if (!this.partRightEl) {
				this.initFragments();
			}
		}

		if (this.mineBroken || this.partRightEl) {
			this.updateFragments();
		}

		// Set position.
		if (data.type == 'sliderchain' || (data.type == 'sliderhead' && data.sliceCount > 1)) {
			const headX = getHorizontalPosition(data.horizontalPosition);
			const headY = highestJumpPosYForLineLayer(data.verticalPosition);

			const tailX = getHorizontalPosition(data.tailHorizontalPosition);
			const tailY = highestJumpPosYForLineLayer(data.tailVerticalPosition);

			const p2 = new THREE.Vector2(tailX - headX, tailY - headY);
			const magnitude = p2.length();

			const f = THREE.Math.degToRad(this.rotations[data.headCutDirection] + (this.data.rotationOffset ? this.data.rotationOffset : 0.0));
			const p1 = new THREE.Vector2(Math.sin(f), -Math.cos(f)).multiplyScalar(0.5 * magnitude);

			var t = (data.sliceIndex / (data.sliceCount - 1)) * data.squishAmount;
			var curve = BezierCurve(new THREE.Vector2(0.0, 0.0), p1, p2, t);
			const pos = curve[0];
			const tangent = curve[1];

			this.startPos = new THREE.Vector3(headX, getVerticalPosition(0) + pos.y, data.halfJumpPosition + data.warmupPosition - SWORD_OFFSET);
			this.endPos = new THREE.Vector3(pos.x + headX, pos.y + headY, -SWORD_OFFSET);

			el.object3D.position.copy(this.startPos);
			el.object3D.rotation.set(0, 0, 0);

			this.zRotation = Math.atan2(tangent.x, -tangent.y) + THREE.Math.degToRad(this.data.rotationOffset ? this.data.rotationOffset : 0.0);
			const endRotation = new THREE.Euler(0, data.spawnRotation * 0.0175, this.zRotation, data.spawnRotation != 0 ? 'YZX' : 'YXZ');

			this.endRotationEuler = endRotation;
			this.endRotation = new THREE.Quaternion().setFromEuler(endRotation);
			this.middleRotation = new THREE.Quaternion().setFromEuler(endRotation);
			this.gravity = this.noteJumpGravityForLineLayer(data.verticalPosition, 0);
		} else {
			this.startPos = new THREE.Vector3(
				data.flip ? getHorizontalPosition(data.flipHorizontalPosition) : getHorizontalPosition(data.horizontalPosition),
				getVerticalPosition(data.beforeJumpLineLayer),
				data.halfJumpPosition + data.warmupPosition - SWORD_OFFSET
			);

			this.endPos = new THREE.Vector3(
				getHorizontalPosition(data.horizontalPosition),
				highestJumpPosYForLineLayer(data.verticalPosition),
				-SWORD_OFFSET
			);

			el.object3D.position.copy(this.startPos);
			el.object3D.rotation.set(0, 0, 0);

			var index = Math.abs(Math.round(data.time * 10.0 + this.endPos.x * 2.0 + this.endPos.y * 2.0) % RandomRotations.length);
			this.zRotation = THREE.Math.degToRad(this.rotations[data.cutDirection] + (this.data.rotationOffset ? this.data.rotationOffset : 0.0));

			const endRotation = new THREE.Euler(0, data.spawnRotation * 0.0175, this.zRotation, data.spawnRotation != 0 ? 'YZX' : 'YXZ');
			const randomRotation = RandomRotations[index];
			const middleRotation = new THREE.Euler(
				THREE.Math.degToRad(randomRotation.x * 20) + endRotation.x,
				THREE.Math.degToRad(randomRotation.y * 20) + endRotation.y,
				THREE.Math.degToRad(randomRotation.z * 20) + endRotation.z,
				data.spawnRotation != 0 ? 'YZX' : 'YXZ'
			);

			this.endRotationEuler = endRotation;
			this.endRotation = new THREE.Quaternion().setFromEuler(endRotation);
			this.middleRotation = new THREE.Quaternion().setFromEuler(middleRotation);
			this.gravity = this.noteJumpGravityForLineLayer(data.verticalPosition, data.beforeJumpLineLayer);
		}

		if (data.spawnRotation) {
			let axis = new THREE.Vector3(0, 1, 0);
			let theta = data.spawnRotation * 0.0175;
			let origin = new THREE.Vector3(getHorizontalPosition(data.horizontalPosition), getVerticalPosition(data.verticalPosition), 0);

			origin.applyAxisAngle(axis, theta);
			this.origin = origin;

			rotateAboutPoint(el.object3D, new THREE.Vector3(0, 0, headset.object3D.position.z), axis, theta, true);

			el.object3D.lookAt(origin);
			this.startPosition = el.object3D.position.clone();
			this.startRotation = el.object3D.quaternion.clone();
		}

		if (data.flip) {
			this.yAvoidance = data.flipYSide <= 0.0 ? data.flipYSide * 0.15 : data.flipYSide * 0.45;
		} else {
			this.yAvoidance = 0;
		}
		this.startVerticalVelocity = this.gravity * data.halfJumpDuration;

		// Reset the state properties.
		this.returnToPoolTimeStart = undefined;
		this.hitSoundState = SOUND_STATE.initial;
		this.hitSaberEl = null;

		// Find corresponding score from replay
		this.replayNote = null;
		if (data.type == 'mine') {
			// Reset mine.
			this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];
			this.resetMineFragments();

			const bombs = replayLoader.bombs;
			if (bombs) {
				for (var i = 0; i < bombs.length; i++) {
					if (
						bombs[i].spawnTime < data.time + 0.01 &&
						bombs[i].spawnTime > data.time - 0.01 &&
						(!bombs[i].id || bombs[i].id == data.noteId || bombs[i].id == data.noteIdWithScoring)
					) {
						this.replayNote = bombs[i];
						break;
					}
				}
			}
		} else {
			const notes = replayLoader.allStructs;
			const index = this.data.index;
			var result;
			for (var i = 0; i < notes.length; i++) {
				if (notes[i].index == index) {
					result = notes[i];
					break;
				}
			}
			this.replayNote = result;
		}

		if (this.replayNote == null) {
			this.replayNote = {
				score: 1,
				totalScore: -1,
			};
		}

		if (settings.settings.highlightErrors && this.replayNote && this.replayNote.score < 0) {
			if (data.type == 'mine') {
				this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials['mineMaterialyellow'];
			} else {
				this.blockEl.setAttribute('material', `color: yellow; emissive: ${this.data[this.data.color]}; emissiveIntensity: 0.7`);
			}
		}

		this.rainbowShader = false;
		if (settings.settings.highlight115s && this.replayNote && this.replayNote.score == 115) {
			if (data.type != 'mine') {
				this.rainbowShader = true;
			}
		}

		const replay = replayLoader.replay;
		const modifiers = replay.info.modifiers;

		if (modifiers.includes('GN') && settings.settings.showNoteModifierVisuals) {
			this.blockEl.setAttribute('material', 'visible: ' + (this.data.index == 0));
		} else {
			this.blockEl.setAttribute('material', 'visible: true');
		}
		if ((modifiers.includes('GN') || modifiers.includes('DA')) && settings.settings.showNoteModifierVisuals) {
			const signMaterial = this.el.sceneEl.systems.materials.beatSignMaterial;
			signMaterial.uniforms.start.value = data.halfJumpPosition + (headset.object3D.position.z - data.halfJumpPosition) * 0.3;
			signMaterial.uniforms.finish.value = data.halfJumpPosition + (headset.object3D.position.z - data.halfJumpPosition) * 0.7;
		} else {
			const signMaterial = this.el.sceneEl.systems.materials.beatSignMaterial;
			signMaterial.uniforms.start.value = 10000;
			signMaterial.uniforms.finish.value = 10000;
		}

		let itsMine = this.data.type === 'mine';
		let smallCubes = modifiers.includes('SC');
		let proMode = modifiers.includes('PM');
		const SCScale = 0.5;
		let noteScale = smallCubes && !itsMine ? SCScale : 1;

		if (smallCubes && settings.settings.showNoteModifierVisuals) {
			this.blockEl.object3D.scale.set(1, 1, 1).multiplyScalar(3.45).multiplyScalar(this.data.size).multiplyScalar(noteScale);
		}
		let gameVersion = (replay.info.gameVersion || '0.0.0').split('.'); // SS doesn't have a game version
		let oldDots =
			modifiers.includes('OD') || replay.info.mode.includes('OldDots') || (gameVersion.length == 3 && parseInt(gameVersion[1]) < 20);

		let boxSettings = {
			scale: noteScale,
			oldDots: oldDots,
			proMode: proMode,
			isDot: this.data.type == 'dot',
		};

		this.updatePosition();

		if (!this.hitboxObject && (!this.replayNote.cutPoint || settings.settings.showHitboxes || !settings.settings.reducedDebris)) {
			const hitbox = new THREE.WireframeGeometry(itsMine ? new THREE.SphereGeometry(0.18, 16, 8) : this.toBigBox(boxSettings));
			const material = new THREE.LineBasicMaterial({
				color: 0xff0000,
				linewidth: 1,
			});
			const line = new THREE.LineSegments(hitbox, material);
			line.geometry.computeBoundingBox();
			line.visible = settings.settings.showHitboxes;
			el.object3D.add(line);
			if (!itsMine) {
				if (!proMode) line.position.z += 0.25 * noteScale;

				const smallhitbox = new THREE.WireframeGeometry(this.toSmallBox(boxSettings));
				const material2 = new THREE.LineBasicMaterial({
					color: 0xff00ff,
					linewidth: 1,
				});
				const line2 = new THREE.LineSegments(smallhitbox, material2);
				line2.geometry.computeBoundingBox();
				line2.visible = settings.settings.showHitboxes;

				el.object3D.add(line2);

				this.smallHitObject = line2;
			}
			this.hitboxObject = line;
		}
	},

	toSmallBox: function (boxSettings) {
		return this.toScaledBox(0.48, 0.48, 0.48, boxSettings);
	},

	toBigBox: function (boxSettings) {
		let height = boxSettings.isDot && !boxSettings.oldDots ? 0.8 : 0.5;
		return this.toScaledBox(0.8, height, 1.0, boxSettings);
	},

	toScaledBox: function (width, height, depth, boxSettings) {
		let box = boxSettings.proMode ? new THREE.BoxGeometry(0.5, 0.5, 0.5) : new THREE.BoxGeometry(width, height, depth);
		box.scale(boxSettings.scale, boxSettings.scale, boxSettings.scale);
		return box;
	},

	initBlock: function () {
		var el = this.el;
		var blockEl = (this.blockEl = document.createElement('a-entity'));
		var signEl = (this.signEl = document.createElement('a-entity'));
		signEl.setAttribute('render-order', 'walls');
		blockEl.appendChild(signEl);
		el.appendChild(blockEl);
	},

	updateBlock: function () {
		const blockEl = this.blockEl;
		const signEl = this.signEl;
		if (!blockEl) {
			return;
		}

		if (this.data.type === 'mine') {
			blockEl.setAttribute('material', {
				roughness: 0.68,
				metalness: 0.48,
				sphericalEnvMap: '#mineTexture',
				color: new THREE.Color(COLORS.MINE_RED),
			});
		} else {
			if (blockEl.materialToReset) {
				this.blockEl.getObject3D('mesh').material = blockEl.materialToReset;
				blockEl.materialToReset = null;
			}
			blockEl.setAttribute('material', {
				metalness: 0.98,
				roughness: 0.0,
				color: this.data[this.data.color],
				sphericalEnvMap: '#envmapTexture',
				emissive: this.data[this.data.color],
				emissiveIntensity: 0.3,
			});
		}
		this.setObjModelFromTemplate(blockEl, this.models[this.data.type]);

		if (this.data.type !== 'mine') {
			// Uncomment in case of new Chrome version
			// signEl.setAttribute('materials', "name: beatSignMaterial");
			this.setObjModelFromTemplate(
				signEl,
				this.signModels[this.data.type + this.data.color],
				this.el.sceneEl.systems.materials.beatSignMaterial
			);
		}

		if (this.data.type === 'sliderchain') {
			blockEl.object3D.scale.set(1, 1, 1);
			signEl.object3D.scale.set(0.3, 0.3, 1);
		} else {
			// Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
			blockEl.object3D.scale.set(1, 1, 1);
		}

		blockEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
	},

	initFragments: function () {
		var cutEl;
		var partEl;

		partEl = this.partLeftEl = document.createElement('a-entity');
		cutEl = this.cutLeftEl = document.createElement('a-entity');

		partEl.appendChild(cutEl);
		this.el.appendChild(partEl);

		partEl = this.partRightEl = document.createElement('a-entity');
		cutEl = this.cutRightEl = document.createElement('a-entity');

		partEl.appendChild(cutEl);
		this.el.appendChild(partEl);

		this.initCuttingClippingPlanes();
	},

	initMineFragments: function () {
		var fragment;
		var fragments = this.el.sceneEl.systems['mine-fragments-loader'].fragments.children;
		var material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];

		this.mineFragments = [];
		this.mineBroken = document.createElement('a-entity');
		this.el.appendChild(this.mineBroken);

		for (var i = 0; i < fragments.length; i++) {
			fragment = new THREE.Mesh(fragments[i].geometry, material);
			fragment.speed = new THREE.Vector3();
			fragment.speed.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
			this.mineFragments.push(fragment);
			this.mineBroken.object3D.add(fragment);
		}
	},

	updateFragments: function () {
		var cutLeftEl = this.cutLeftEl;
		var cutRightEl = this.cutRightEl;
		var partLeftEl = this.partLeftEl;
		var partRightEl = this.partRightEl;
		var fragment;
		if (!partLeftEl) {
			return;
		}
		if (this.data.type === 'mine') {
			this.resetMineFragments();
			return;
		}

		partLeftEl.setAttribute('material', {
			metalness: 0.7,
			roughness: 0.1,
			sphericalEnvMap: '#envmapTexture',
			emissive: this.data[this.data.color],
			emissiveIntensity: 0.05,
			color: this.data[this.data.color],
			side: 'double',
		});
		this.setObjModelFromTemplate(partLeftEl, this.models[this.data.type]);
		// Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
		partLeftEl.object3D.scale.set(1, 1, 1);
		partLeftEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
		partLeftEl.object3D.visible = false;

		cutLeftEl.setAttribute('material', {
			shader: 'flat',
			color: this.data.cutColor,
			side: 'double',
		});
		this.setObjModelFromTemplate(cutLeftEl, this.models[this.data.type]);

		partRightEl.setAttribute('material', {
			metalness: 0.7,
			roughness: 0.1,
			sphericalEnvMap: '#envmapTexture',
			emissive: this.data[this.data.color],
			emissiveIntensity: 0.05,
			color: this.data[this.data.color],
			side: 'double',
		});
		this.setObjModelFromTemplate(partRightEl, this.models[this.data.type]);
		// Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
		partRightEl.object3D.scale.set(1, 1, 1);
		partRightEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
		partRightEl.object3D.visible = false;

		cutRightEl.setAttribute('material', {
			shader: 'flat',
			color: this.data.cutColor,
			side: 'double',
		});
		this.setObjModelFromTemplate(cutRightEl, this.models[this.data.type]);
	},

	resetMineFragments: function () {
		if (this.data.type !== 'mine' || !this.mineFragments) {
			return;
		}
		for (let i = 0; i < this.mineFragments.length; i++) {
			let fragment = this.mineFragments[i];
			fragment.visible = false;
			fragment.position.set(0, 0, 0);
			fragment.scale.set(1, 1, 1);
			fragment.speed.set(Math.random() * 5 - 2.5, Math.random() * 5 - 2.5, Math.random() * 5 - 2.5);
		}
	},

	missHit: function (hand) {
		if (this.data.type === 'mine') {
			if (this.replayNote && this.replayNote.totalScore != -1) {
				this.postScoreEvent();
			}
			return;
		}

		if (this.replayNote.score > 0) {
			this.el.emit('wrongMiss', null, true);
		}

		this.postScoreEvent();
		this.showScore(hand);
	},

	postScoreEvent: function () {
		if (!this.replayNote.time) return;
		const timeToScore = this.replayNote.time - getCurrentTime();
		const payload = {index: this.replayNote.i};
		const scoreChanged = () => this.el.emit('scoreChanged', payload, true);
		if (timeToScore < 0) {
			scoreChanged();
		} else {
			setTimeout(scoreChanged, timeToScore * 1000);
		}
	},

	destroyMine: function () {
		if (!settings.settings.reducedDebris) {
			for (let i = 0; i < this.mineFragments.length; i++) {
				this.mineFragments[i].visible = true;
			}

			this.blockEl.object3D.visible = false;
			this.destroyed = true;
			this.gravityVelocity = 0.1;
			this.returnToPoolTimer = 800;
		} else {
			this.destroyed = true;
			this.returnToPool(true);
		}

		if (!settings.settings.noEffects) {
			this.explodeEventDetail.position.copy(this.el.object3D.position);
			this.explodeEventDetail.rotation.copy(new THREE.Vector3(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI));
			mineParticles.emit('explode', this.explodeEventDetail, false);
		}
	},

	destroyBeat: (function () {
		var parallelPlaneMaterial = new THREE.MeshBasicMaterial({
			color: '#00008b',
			side: THREE.DoubleSide,
		});
		var planeMaterial = new THREE.MeshBasicMaterial({color: 'grey', side: THREE.DoubleSide});
		var point1 = new THREE.Vector3();
		var point2 = new THREE.Vector3();
		var point3 = new THREE.Vector3();

		return function (saberEl) {
			if (!settings.settings.reducedDebris && this.partRightEl) {
				var coplanarPoint;
				var cutThickness = (this.cutThickness = 0.02);
				var direction = this.cutDirection;
				var leftBorderInnerPlane = this.leftBorderInnerPlane;
				var leftBorderOuterPlane = this.leftBorderOuterPlane;
				var leftCutPlane = this.leftCutPlane;
				var planeGeometry;
				var planeMesh;
				var rightBorderInnerPlane = this.rightBorderInnerPlane;
				var rightBorderOuterPlane = this.rightBorderOuterPlane;
				var rightCutPlane = this.rightCutPlane;
				var cutPlaneComponent = saberEl.components['cut-plane'];

				point1.copy(cutPlaneComponent.currentFrameSaberTop);
				point2.copy(cutPlaneComponent.currentFrameSaberCenter);
				point3.copy(cutPlaneComponent.previousFrameSaberTop);
				direction.copy(point1).sub(point3);

				this.partRightEl.object3D.position.set(0, 0, 0);
				this.partRightEl.object3D.rotation.set(0, 0, 0);
				this.partRightEl.object3D.updateMatrixWorld();

				this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[0].copy(point1));
				this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[1].copy(point2));
				this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[2].copy(point3));

				this.partLeftEl.object3D.position.set(0, 0, 0);
				this.partLeftEl.object3D.rotation.set(0, 0, 0);
				this.partLeftEl.object3D.updateMatrixWorld();

				this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[0].copy(point3));
				this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[1].copy(point2));
				this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[2].copy(point1));

				this.generateCutClippingPlanes();

				if (this.data.debug) {
					coplanarPoint = new THREE.Vector3();
					planeGeometry = new THREE.PlaneGeometry(4.0, 4.0, 1.0, 1.0);

					rightCutPlane.coplanarPoint(coplanarPoint);
					planeGeometry.lookAt(rightCutPlane.normal);
					planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

					planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
					this.el.sceneEl.setObject3D('rightCutPlane', planeMesh);

					planeGeometry = new THREE.PlaneGeometry(4.0, 4.0, 1.0, 1.0);

					rightBorderOuterPlane.coplanarPoint(coplanarPoint);
					planeGeometry.lookAt(rightBorderOuterPlane.normal);
					planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

					const parallelPlaneMesh = new THREE.Mesh(planeGeometry, parallelPlaneMaterial);
					this.el.sceneEl.setObject3D('planeParallel', parallelPlaneMesh);
				}

				this.blockEl.object3D.visible = false;

				const partRightMaterial = this.partRightEl.getObject3D('mesh').material;
				partRightMaterial.clippingPlanes = partRightMaterial.clippingPlanes || [];
				partRightMaterial.clippingPlanes.length = 0;
				partRightMaterial.clippingPlanes.push(rightCutPlane);

				const cutRightMaterial = this.cutRightEl.getObject3D('mesh').material;
				cutRightMaterial.clippingPlanes = cutRightMaterial.clippingPlanes || [];
				cutRightMaterial.clippingPlanes.length = 0;
				cutRightMaterial.clippingPlanes.push(rightBorderOuterPlane);
				cutRightMaterial.clippingPlanes.push(rightBorderInnerPlane);

				const partLeftMaterial = this.partLeftEl.getObject3D('mesh').material;
				partLeftMaterial.clippingPlanes = partLeftMaterial.clippingPlanes || [];
				partLeftMaterial.clippingPlanes.length = 0;
				partLeftMaterial.clippingPlanes.push(leftCutPlane);

				const cutLeftMaterial = this.cutLeftEl.getObject3D('mesh').material;
				cutLeftMaterial.clippingPlanes = cutLeftMaterial.clippingPlanes || [];
				cutLeftMaterial.clippingPlanes.length = 0;
				cutLeftMaterial.clippingPlanes.push(leftBorderInnerPlane);
				cutLeftMaterial.clippingPlanes.push(leftBorderOuterPlane);

				this.partLeftEl.object3D.visible = true;
				this.partRightEl.object3D.visible = true;

				this.el.sceneEl.renderer.localClippingEnabled = true;
				this.destroyed = true;
				this.gravityVelocity = 0.1;

				this.rotationAxis.copy(this.rightCutPlanePoints[0]).sub(this.rightCutPlanePoints[1]);

				this.returnToPoolTimer = 800;

				auxObj3D.up.copy(rightCutPlane.normal);
				auxObj3D.lookAt(direction);
			} else {
				this.destroyed = true;
				if (!settings.realHitsounds && this.hitSoundState != SOUND_STATE.hitPlayed) {
					this.el.object3D.visible = false;
					this.hitSoundState = SOUND_STATE.waitingForHitSound;
				} else {
					this.returnToPool(true);
				}
			}

			// if (!settings.settings.noEffects) {
			//   this.explodeEventDetail.position = this.el.object3D.position;
			//   this.explodeEventDetail.rotation = auxObj3D.rotation;
			//   this.particles.emit('explode', this.explodeEventDetail, false);
			// }
		};
	})(),

	initCuttingClippingPlanes: function () {
		this.leftCutPlanePointsWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
		this.rightCutPlanePointsWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

		this.rightCutPlane = new THREE.Plane();
		this.rightBorderOuterPlane = new THREE.Plane();
		this.rightBorderInnerPlane = new THREE.Plane();

		this.leftCutPlane = new THREE.Plane();
		this.leftBorderOuterPlane = new THREE.Plane();
		this.leftBorderInnerPlane = new THREE.Plane();
	},

	generateCutClippingPlanes: function () {
		var leftBorderInnerPlane = this.leftBorderInnerPlane;
		var leftBorderOuterPlane = this.leftBorderOuterPlane;
		var leftCutPlane = this.leftCutPlane;
		var leftCutPlanePointsWorld = this.leftCutPlanePointsWorld;
		var partLeftEl = this.partLeftEl;
		var partRightEl = this.partRightEl;
		var rightBorderInnerPlane = this.rightBorderInnerPlane;
		var rightBorderOuterPlane = this.rightBorderOuterPlane;
		var rightCutPlane = this.rightCutPlane;
		var rightCutPlanePointsWorld = this.rightCutPlanePointsWorld;

		partRightEl.object3D.updateMatrixWorld();
		partRightEl.object3D.localToWorld(rightCutPlanePointsWorld[0].copy(this.rightCutPlanePoints[0]));
		partRightEl.object3D.localToWorld(rightCutPlanePointsWorld[1].copy(this.rightCutPlanePoints[1]));
		partRightEl.object3D.localToWorld(rightCutPlanePointsWorld[2].copy(this.rightCutPlanePoints[2]));

		partLeftEl.object3D.updateMatrixWorld();
		partLeftEl.object3D.localToWorld(leftCutPlanePointsWorld[0].copy(this.leftCutPlanePoints[0]));
		partLeftEl.object3D.localToWorld(leftCutPlanePointsWorld[1].copy(this.leftCutPlanePoints[1]));
		partLeftEl.object3D.localToWorld(leftCutPlanePointsWorld[2].copy(this.leftCutPlanePoints[2]));

		rightCutPlane.setFromCoplanarPoints(rightCutPlanePointsWorld[0], rightCutPlanePointsWorld[1], rightCutPlanePointsWorld[2]);
		rightBorderOuterPlane.set(rightCutPlane.normal, rightCutPlane.constant + this.cutThickness);

		leftCutPlane.setFromCoplanarPoints(leftCutPlanePointsWorld[0], leftCutPlanePointsWorld[1], leftCutPlanePointsWorld[2]);
		leftBorderOuterPlane.set(leftCutPlane.normal, leftCutPlane.constant + this.cutThickness);

		rightBorderInnerPlane.setFromCoplanarPoints(rightCutPlanePointsWorld[2], rightCutPlanePointsWorld[1], rightCutPlanePointsWorld[0]);
		leftBorderInnerPlane.setFromCoplanarPoints(leftCutPlanePointsWorld[2], leftCutPlanePointsWorld[1], leftCutPlanePointsWorld[0]);
	},

	returnToPool: function (force) {
		if (!this.backToPool && !force) {
			return;
		}

		if (this.el.sceneEl.components[this.poolName]) {
			this.el.sceneEl.components[this.poolName].returnEntity(this.el);
		}
	},

	checkBigCollider: function (collider, hand, saberControls) {
		const saberColors = this.saberColors;

		if (!saberControls.hitboxGood || !saberControls.boundingBox.intersectsBox(collider)) {
			return false;
		}

		return this.data.color === saberColors[hand] && this.replayNote && this.replayNote.score > 0;
	},

	checkCollisions: function () {
		if (!this.hitboxObject) return;
		this.beatBigBoundingBox.copy(this.hitboxObject.geometry.boundingBox).applyMatrix4(this.hitboxObject.matrixWorld);
		const beatBigBoundingBox = this.beatBigBoundingBox;

		if (this.smallHitObject) {
			this.beatBoundingBox.copy(this.smallHitObject.geometry.boundingBox).applyMatrix4(this.smallHitObject.matrixWorld);
		}

		const beatSmallBoundingBox = this.smallHitObject ? this.beatBoundingBox : this.beatBigBoundingBox;

		// const position = this.el.object3D.position;

		for (let i = 0; i < saberEls.length; i++) {
			let saberControls = saberEls[i].components['saber-controls'];
			let saberBoundingBox = saberControls.boundingBox;
			// let maxAngle;

			if (!saberBoundingBox) {
				return false;
			}

			const hand = saberControls.data.hand;

			if (
				(saberControls.hitboxGood &&
					saberBoundingBox.intersectsBox(beatSmallBoundingBox) &&
					this.replayNote &&
					this.replayNote.score != -3) ||
				this.checkBigCollider(beatBigBoundingBox, hand, saberControls)
			) {
				// Sound.

				if (this.data.type !== 'sliderchain' && settings.realHitsounds) {
					hitSound.playSound();
				}

				if (this.data.type === 'mine') {
					if (this.replayNote.totalScore != -1) {
						if (this.replayNote) {
							this.postScoreEvent();
						}

						this.destroyMine();
					}

					return true;
				}

				this.postScoreEvent();
				this.destroyBeat(saberEls[i]);

				this.hitSaberEl = saberEls[i];
				if (settings.settings.reducedDebris) {
					this.onEndStroke();
				} else {
					this.hitSaberEl.addEventListener('strokeend', this.onEndStroke, ONCE);
				}

				// this.hitHand = hand;

				// saberControls.maxAnglePlaneX = 0;
				// saberControls.maxAnglePlaneY = 0;
				// saberControls.maxAnglePlaneXY = 0;

				// if (this.data.type === 'arrow') {
				//   saberControls.updateStrokeDirection();

				// if (cutDirection === 'up' || cutDirection === 'down') {
				//   maxAngle = saberControls.maxAnglePlaneX;
				// } else if (cutDirection === 'left' || cutDirection === 'right') {
				// maxAngle = saberControls.maxAnglePlaneY;
				// } else {
				//   maxAngle = saberControls.maxAnglePlaneXY;
				// }
				// } else {
				//   maxAngle = Math.max(saberControls.maxAnglePlaneX, saberControls.maxAnglePlaneY,
				//                       saberControls.maxAnglePlaneXY);
				// }
				// this.angleBeforeHit = maxAngle;
				return true;
			}
		}
	},

	onEndStroke: function () {
		// var cutDirection = this.data.cutDirection;
		// var hitEventDetail = this.hitEventDetail;
		// var maxAngle;
		// var saberControls = this.hitSaberEl.components['saber-controls'];
		// var scoreText;

		// // Harcoded temporarily.
		// const saberRotation = 3.14 / 12;

		// if (cutDirection === 'up' || cutDirection === 'down') {
		//   maxAngle = saberControls.maxAnglePlaneX;
		// } else if (cutDirection === 'left' || cutDirection === 'right') {
		//   maxAngle = saberControls.maxAnglePlaneY;
		// } else {
		//   maxAngle = saberControls.maxAnglePlaneXY;
		// }

		// const angleBeforeHit = Math.max(0, (this.angleBeforeHit - saberRotation) * 180 / Math.PI);
		// const angleAfterHit = Math.max(0, (maxAngle - saberRotation) * 180 / Math.PI);

		// let score = 0;
		// score += angleBeforeHit >= 85 ? 70 : (angleBeforeHit / 80) * 70;
		// score += angleAfterHit >= 60 ? 30 : (angleAfterHit / 60) * 30;

		// hitEventDetail.score = score;
		this.el.sceneEl.emit('textglowbold', null, false);

		// let beatScorePool;
		// if (score < 60) { beatScorePool = SCORE_POOL.OK; }
		// else if (score < 80) { beatScorePool = SCORE_POOL.GOOD; }
		// else if (score < 100) { beatScorePool = SCORE_POOL.GREAT; }
		// else {
		//   beatScorePool = SCORE_POOL.SUPER;
		// }

		this.showScore();
	},

	showScore: function (hand) {
		let score = this.replayNote.score;
		let data = this.data;
		if (score < 0) {
			if (score == -3) {
				const missEl = this.el.sceneEl.components['pool__beatscoremiss'].requestEntity();
				missEl.object3D.rotation.set(0, 0, 0);
				missEl.object3D.position.copy(this.el.object3D.position);
				missEl.object3D.position.y += 0.2;
				missEl.object3D.visible = true;

				if (data.spawnRotation) {
					missEl.object3D.lookAt(this.origin);
					missEl.object3D.rotation.y += Math.PI;
					var direction = this.startPosition.clone().sub(this.origin).normalize();
					const vector = direction.multiplyScalar(8).add(this.origin);

					missEl.setAttribute('animation__motionz', 'to', vector.z);
					missEl.setAttribute('animation__motionx', 'to', vector.x);
				} else {
					missEl.object3D.position.x += 0.6; // One block right
					missEl.object3D.position.z -= 0.2;

					missEl.setAttribute('animation__motionz', 'to', -8);
					missEl.setAttribute('animation__motionx', 'to', missEl.object3D.position.x);
				}

				missEl.play();
				missEl.emit('beatmiss', null, true);
			} else if (score == -2) {
				const wrongEl = this.el.sceneEl.components['pool__beatscorewrong'].requestEntity();
				wrongEl.object3D.rotation.set(0, 0, 0);
				wrongEl.object3D.position.copy(this.el.object3D.position);
				wrongEl.object3D.position.y += 0.2;
				wrongEl.object3D.visible = true;

				if (data.spawnRotation) {
					wrongEl.object3D.lookAt(this.origin);

					var direction = wrongEl.object3D.position.clone().sub(this.origin).normalize();
					const vector = direction.multiplyScalar(8).add(this.origin);

					wrongEl.setAttribute('animation__motionz', 'to', vector.z);
					wrongEl.setAttribute('animation__motionx', 'to', vector.x);
				} else {
					wrongEl.object3D.position.x += 0.6; // One block right
					wrongEl.object3D.position.z -= 0.2;
					wrongEl.setAttribute('animation__motionz', 'to', -8);
					wrongEl.setAttribute('animation__motionx', 'to', wrongEl.object3D.position.x);
				}

				wrongEl.play();
				wrongEl.emit('beatwrong', null, true);
			}
		} else {
			const scoreEl = this.el.sceneEl.components['pool__beatscoreok'].requestEntity();
			const colorAndScale = this.colorAndScaleForScore(this.replayNote);
			scoreEl.setAttribute('text', 'value', '' + score);

			let duration = 500 / song.speed;
			if (settings.settings.colorScores) {
				scoreEl.setAttribute('text', 'color', colorAndScale.color);
				scoreEl.setAttribute('text', 'wrapCount', 33 - colorAndScale.scale * 15);
				scoreEl.setAttribute('animation__motionz', 'dur', duration * 3);
				scoreEl.setAttribute('animation__motionz', 'easing', 'linear');
			} else {
				scoreEl.setAttribute('text', 'color', '#fff');
				scoreEl.setAttribute('text', 'wrapCount', 18);
				scoreEl.setAttribute('animation__motionz', 'dur', duration);
				scoreEl.setAttribute('animation__motionz', 'easing', 'easeOutQuart');
			}

			scoreEl.setAttribute('animation__opacityin', 'dur', duration / 2);
			scoreEl.setAttribute('animation__opacityout', 'dur', duration);

			scoreEl.setAttribute('animation__motiony', 'dur', duration);

			let random = Math.random() / 4;

			scoreEl.setAttribute('animation__motiony', 'to', -1 + this.el.object3D.position.y / 3);
			scoreEl.object3D.rotation.set(0, 0, 0);
			scoreEl.object3D.position.copy(this.el.object3D.position);

			if (data.spawnRotation) {
				scoreEl.object3D.lookAt(this.origin);

				var direction = scoreEl.object3D.position.clone().sub(this.origin).normalize();
				const vector = direction.multiplyScalar(8 + random).add(this.origin);

				scoreEl.setAttribute('animation__motionz', 'to', vector.z);
				scoreEl.setAttribute('animation__motionx', 'to', vector.x);
			} else {
				scoreEl.object3D.position.x += 0.6; // One block right
				scoreEl.object3D.position.z -= 1.5;

				scoreEl.setAttribute('animation__motionz', 'to', -8 - random);
				scoreEl.setAttribute('animation__motionx', 'to', scoreEl.object3D.position.x);
			}
			scoreEl.play();
			scoreEl.emit('beatscorestart', null, false);
		}
	},

	noteJumpGravityForLineLayer: function (lineLayer, beforeJumpLineLayer) {
		var num = ((-2 * this.data.halfJumpPosition) / this.data.speed) * 0.5;
		return (2.0 * (highestJumpPosYForLineLayer(lineLayer) - getVerticalPosition(beforeJumpLineLayer))) / (num * num);
	},

	colorAndScaleForScore: (function () {
		var color = new THREE.Color();

		return function (replayNote) {
			const judgments = HSVConfig['judgments'];
			let judgment;
			const score = (replayNote.score / replayNote.maxScore) * 115;

			for (var i = 0; i <= judgments.length - 1; i++) {
				if (judgments[i].threshold <= score) {
					judgment = judgments[i];
					break;
				}
			}

			if (!judgment) return {color: '#fff', scale: 0};

			color.setRGB(judgment.color[0], judgment.color[1], judgment.color[2]);

			return {color: '#' + color.getHexString(), scale: 1.4};
		};
	})(),

	checkStaticHitsound: function () {
		if (this.data.type === 'mine' || this.hitSoundState == SOUND_STATE.hitPlayed) return;

		const currentTime = getCurrentTime();
		const noteTime = this.data.time - 0.2;

		if (currentTime > noteTime && !this.data.seeking) {
			if (this.data.type !== 'sliderchain') {
				hitSound.playSound();
			}

			if (this.hitSoundState == SOUND_STATE.waitingForHitSound) {
				this.returnToPool(true);
			}
			this.hitSoundState = SOUND_STATE.hitPlayed;
		}
	},

	tockDestroyed: (function () {
		var leftCutNormal = new THREE.Vector3();
		var leftRotation = 0;
		var rightCutNormal = new THREE.Vector3();
		var rightRotation = 0;
		var rotationStep = (2 * Math.PI) / 150 / 3;
		var fragment;

		return function (timeDelta) {
			// Update gravity velocity.
			this.gravityVelocity = getGravityVelocity(this.gravityVelocity, timeDelta);
			this.el.object3D.position.y += this.gravityVelocity * (timeDelta / 1000) * song.speed;

			if (this.data.type == 'mine') {
				for (var i = 0; i < this.mineFragments.length; i++) {
					fragment = this.mineFragments[i];
					if (!fragment.visible) {
						continue;
					}
					fragment.position.addScaledVector(fragment.speed, (timeDelta / 1000) * song.speed);
					fragment.scale.multiplyScalar(1 - 0.03 * song.speed);

					if (fragment.scale.y < 0.1 || this.el.object3D.position.y < -1) {
						fragment.visible = false;
						this.backToPool = true;
					}
				}
				return;
			}

			if (!this.partRightEl) return;
			rightCutNormal.copy(this.rightCutPlane.normal).multiplyScalar(DESTROYED_SPEED * (timeDelta / 500) * song.speed);
			rightCutNormal.y = 0; // Y handled by gravity.
			this.partRightEl.object3D.position.add(rightCutNormal);
			this.partRightEl.object3D.setRotationFromAxisAngle(this.rotationAxis, rightRotation);
			rightRotation = rightRotation >= 2 * Math.PI ? 0 : rightRotation + rotationStep * song.speed;

			leftCutNormal.copy(this.leftCutPlane.normal).multiplyScalar(DESTROYED_SPEED * (timeDelta / 500) * song.speed);
			leftCutNormal.y = 0; // Y handled by gravity.
			this.partLeftEl.object3D.position.add(leftCutNormal);
			this.partLeftEl.object3D.setRotationFromAxisAngle(this.rotationAxis, leftRotation);
			leftRotation = leftRotation >= 2 * Math.PI ? 0 : leftRotation + rotationStep * song.speed;

			this.generateCutClippingPlanes();

			this.returnToPoolTimer -= timeDelta * song.speed;
			this.backToPool = this.returnToPoolTimer <= 0 || this.el.object3D.position.y < -1;
		};
	})(),

	/**
	 * Load OBJ from already parsed and loaded OBJ template.
	 */
	setObjModelFromTemplate: (function () {
		const geometries = {};

		return function (el, templateId, material) {
			if (!geometries[templateId]) {
				const templateEl = document.getElementById(templateId);
				if (templateEl.getObject3D('mesh')) {
					geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
				} else {
					templateEl.addEventListener('model-loaded', () => {
						geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
						this.setObjModelFromTemplate(el, templateId, material);
					});
					return;
				}
			}

			if (!el.getObject3D('mesh')) {
				el.setObject3D('mesh', new THREE.Mesh());
			}
			el.getObject3D('mesh').geometry = geometries[templateId];
			if (material) {
				el.getObject3D('mesh').material = material;
			}
		};
	})(),
});

/**
 * Get velocity given current velocity using gravity acceleration.
 */
function getGravityVelocity(velocity, timeDelta) {
	const GRAVITY = -9.8;
	return velocity + GRAVITY * (timeDelta / 1000);
}

const HSVConfig = {
	judgments: [
		{
			threshold: 115,
			text: '<size=200%>%s</size>',
			color: [1.0, 1.0, 1.0, 1.0],
		},
		{
			threshold: 113,
			text: '<size=200%>%s</size>',
			color: [0.5215, 0.0, 1.0, 1.0],
		},
		{
			threshold: 110,
			text: '<size=200%>%s</size>',
			color: [0.0, 0.6392, 1.0, 1.0],
		},
		{
			threshold: 106,
			text: '<size=200%>%s</size>',
			color: [0.0, 1.0, 0.0, 1.0],
		},
		{
			threshold: 100,
			text: '<size=200%>%s</size>',
			color: [1.0, 1.0, 0.0, 1.0],
		},
		{
			threshold: -1,
			text: '<size=200%>%s</size>',
			color: [1.0, 0.0, 0.22, 1.0],
		},
	],
};
