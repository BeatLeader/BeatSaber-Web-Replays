import {getHorizontalPosition, getHorizontalWallPosition, getVerticalPosition, rotateAboutPoint, SWORD_OFFSET} from '../utils';

// So wall does not clip the stage ground.
const RAISE_Y_OFFSET = 0.1;

const _noteLinesDistance = 0.6;
const EMPTY_ROTATION = new THREE.Euler(0, 0, 0);

/**
 * Wall to dodge.
 */
AFRAME.registerComponent('wall', {
	schema: {
		durationSeconds: {default: 0},
		height: {default: 1.3},
		horizontalPosition: {default: 1},
		verticalPosition: {default: 0},
		isV3: {default: false},
		isCeiling: {default: false},
		width: {default: 1},
		positionOffset: {default: 0},
		spawnRotation: {default: null},
		time: {default: 0},
		moveTime: {default: 0},
		color: {default: null},
		scale: {default: null},
		localRotation: {default: null},
		customPosition: {default: null},
		definitePosition: {default: null},
		movementData: {default: {}},
	},

	init: function () {
		this.maxZ = 30;
		this.song = this.el.sceneEl.components.song;
		this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
		this.settings = this.el.sceneEl.components.settings;
		this.replayLoader = this.el.sceneEl.components['replay-loader'];
		this.replayPlayer = this.el.sceneEl.components['replay-player'];
	},

	getCurrentTime: function () {
		return this.settings.settings.showHitboxes ? this.replayPlayer.frameTime : this.song.getCurrentTime();
	},

	updatePosition: function () {
		const data = this.data;
		const movementData = data.movementData;
		if (data.definitePosition) return;

		// Move.
		this.el.object3D.visible = true;

		var newPosition = 0;
		var currentTime = this.getCurrentTime();
		var moveTime = data.moveTime;

		var timeOffset = data.time - currentTime - movementData.halfJumpDuration - moveTime;

		if (data.durationSeconds < 0) {
			moveTime -= data.durationSeconds / 2;
		}

		if (timeOffset <= -moveTime) {
			newPosition = movementData.halfJumpPosition;
			timeOffset += moveTime;
			newPosition += -timeOffset * movementData.noteJumpMovementSpeed;
		} else {
			newPosition = movementData.halfJumpPosition + movementData.warmupPosition + movementData.warmupSpeed * -timeOffset;
		}

		newPosition += this.headset.object3D.position.z - SWORD_OFFSET;

		var direction = this.startPosition.clone().sub(this.origin).normalize();
		this.el.object3D.position.copy(direction.multiplyScalar(-newPosition).add(this.origin));
		this.lastPosition = newPosition;

		if (this.hit && currentTime > this.hitWall.time) {
			this.hit = false;
			this.el.emit('scoreChanged', {index: this.hitWall.i}, true);
		}
	},

	onGenerate: function () {
		this.updatePosition();
	},

	update: function () {
		const el = this.el;
		const data = this.data;
		const movementData = data.movementData;
		var width = data.width;
		var length = Math.abs(data.durationSeconds) * movementData.noteJumpMovementSpeed;

		this.hit = false;
		const walls = this.replayLoader.walls;

		if (walls) {
			const durationSeconds = this.data.durationSeconds;
			for (var i = 0; i < walls.length; i++) {
				if (walls[i].time < data.time + durationSeconds && walls[i].time > data.time) {
					this.hit = true;
					this.hitWall = walls[i];
					break;
				}
			}
		}

		const material = el.getObject3D('mesh').material;
		material.uniforms['highlight'].value = this.hit && this.settings.settings.highlightErrors;
		material.uniforms['wallColor'].value = new THREE.Color(data.color ? data.color : this.settings.settings.wallColor);

		const halfDepth = (data.durationSeconds * movementData.noteJumpMovementSpeed) / 2;
		var origin;
		var height = data.height;
		if (data.isV3) {
			let y = getVerticalPosition(data.verticalPosition) + RAISE_Y_OFFSET;
			origin = new THREE.Vector3(getHorizontalWallPosition(data.horizontalPosition), y, -SWORD_OFFSET);

			if (height < 0) {
				height *= -1;
				origin.y -= height * _noteLinesDistance;
			}
		} else {
			if (data.isCeiling) {
				let y = Math.max(getVerticalPosition(2) + RAISE_Y_OFFSET, 0.1);
				origin = new THREE.Vector3(getHorizontalWallPosition(data.horizontalPosition), y, -SWORD_OFFSET);
				height = 3;
			} else {
				let y = Math.max(getVerticalPosition(0) + RAISE_Y_OFFSET, 0.1);
				origin = new THREE.Vector3(getHorizontalWallPosition(data.horizontalPosition), y, -SWORD_OFFSET);
				height = 5;
			}
		}

		if (data.scale) {
			width = data.scale.x * _noteLinesDistance;
			height = data.scale.y;
			if (data.scale.z) {
				length = data.scale.z * _noteLinesDistance;
			}
		}
		height = height * _noteLinesDistance;
		if (data.definitePosition) {
			origin = data.definitePosition;
		}

		origin.x += width / 2;
		el.object3D.scale.set(width, height, length);
		if (!data.definitePosition) {
			el.object3D.position.set(origin.x, origin.y, origin.z + movementData.halfJumpPosition + movementData.warmupPosition);
		} else {
			el.object3D.position.set(origin.x, origin.y, origin.z);
		}
		el.object3D.rotation.copy(EMPTY_ROTATION);

		if (!data.spawnRotation || typeof data.spawnRotation !== 'object') {
			let axis = new THREE.Vector3(0, 1, 0);
			let theta = (data.spawnRotation ? -data.spawnRotation : 0) * 0.0175;

			origin.applyAxisAngle(axis, theta);
			rotateAboutPoint(el.object3D, new THREE.Vector3(0, 0, this.headset.object3D.position.z), axis, theta, true);
		} else {
			var rotationEuler = new THREE.Euler(data.spawnRotation.x * 0.0175, data.spawnRotation.y * 0.0175, data.spawnRotation.z * 0.0175);
			origin.applyEuler(rotationEuler);
			this.rotateAboutPointEuler(el.object3D, new THREE.Vector3(0, 0, this.headset.object3D.position.z), rotationEuler, true);
		}

		this.origin = origin;

		el.object3D.lookAt(origin);

		if (data.localRotation) {
			const obj = el.object3D;

			const q = new THREE.Quaternion().setFromEuler(data.localRotation);
			obj.quaternion.multiply(q);
		}

		this.startPosition = el.object3D.position.clone();
	},

	rotateAboutPoint: function (obj, point, axis, theta, pointIsWorld) {
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
	},

	rotateAboutPointEuler: function (obj, point, euler, pointIsWorld) {
		pointIsWorld = pointIsWorld === undefined ? false : pointIsWorld;

		if (pointIsWorld) {
			obj.parent.localToWorld(obj.position); // compensate for world coordinate
		}

		let rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);
		obj.position.sub(point);
		obj.position.applyMatrix4(rotationMatrix);
		obj.position.add(point);

		if (pointIsWorld) {
			obj.parent.worldToLocal(obj.position); // undo world coordinates compensation
		}
	},

	tock: function (time, timeDelta) {
		const data = this.data;
		const currentTime = this.getCurrentTime();

		this.updatePosition();

		if (this.hit && currentTime > this.hitWall.time) {
			this.hit = false;
			this.el.emit('scoreChanged', {index: this.hitWall.i}, true);
		}

		if (currentTime > data.time + data.durationSeconds + data.movementData.halfJumpDuration) {
			this.returnToPool();
			return;
		}
	},

	returnToPool: function () {
		this.el.sceneEl.components.pool__wall.returnEntity(this.el);
		this.el.object3D.position.z = 9999;
		this.el.pause();
	},
});
