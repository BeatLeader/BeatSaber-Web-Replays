import {getHorizontalPosition, highestJumpPosYForLineLayer, rotateAboutPoint, SWORD_OFFSET} from '../utils';

// So wall does not clip the stage ground.
const RAISE_Y_OFFSET = 0.15;

const CEILING_THICKNESS = 1.5;
const CEILING_HEIGHT = 1.4 + CEILING_THICKNESS / 2;
const _noteLinesDistance = 0.6;

/**
 * Wall to dodge.
 */
AFRAME.registerComponent('wall', {
	schema: {
		halfJumpPosition: {default: 0},
		durationSeconds: {default: 0},
		height: {default: 1.3},
		horizontalPosition: {default: 1},
		verticalPosition: {default: 0},
		isV3: {default: false},
		isCeiling: {default: false},
		speed: {default: 1.0},
		warmupPosition: {default: 0},
		width: {default: 1},
		positionOffset: {default: 0},
		spawnRotation: {default: 0},
		time: {default: 0},
		halfJumpDuration: {default: 0},
		moveTime: {default: 0},
		warmupSpeed: {default: 0},
	},

	init: function () {
		this.maxZ = 10;
		this.song = this.el.sceneEl.components.song;
		this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
		this.settings = this.el.sceneEl.components.settings;
		this.replayLoader = this.el.sceneEl.components['replay-loader'];
	},

	updatePosition: function () {
		const data = this.data;
		const halfDepth = (data.durationSeconds * data.speed) / 2;
		const song = this.song;

		// Move.
		this.el.object3D.visible = true;

		var newPosition = 0;
		const currentTime = song.getCurrentTime();

		var timeOffset = data.time - currentTime - data.halfJumpDuration - data.moveTime;

		if (timeOffset <= -data.moveTime) {
			newPosition = data.halfJumpPosition - halfDepth;
			timeOffset += data.moveTime;
			newPosition += -timeOffset * data.speed;
		} else {
			newPosition = data.halfJumpPosition - halfDepth + data.warmupPosition + data.warmupSpeed * -timeOffset;
		}

		newPosition += this.headset.object3D.position.z - SWORD_OFFSET;

		var direction = this.startPosition.clone().sub(this.origin).normalize();
		this.el.object3D.position.copy(direction.multiplyScalar(-newPosition).add(this.origin));

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
		const width = data.width;

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

		const halfDepth = (data.durationSeconds * data.speed) / 2;
		var origin;
		if (data.isV3) {
			let y = Math.max(highestJumpPosYForLineLayer(data.verticalPosition) + RAISE_Y_OFFSET, 0.1);
			origin = new THREE.Vector3(getHorizontalPosition(data.horizontalPosition) + width / 2 - 0.25, y, -SWORD_OFFSET);

			el.object3D.position.set(origin.x, origin.y, origin.z + data.halfJumpPosition + data.warmupPosition - halfDepth);
			el.object3D.scale.set(width, Math.min(data.height * _noteLinesDistance, 3.1 - y), data.durationSeconds * data.speed);
		} else {
			if (data.isCeiling) {
				origin = new THREE.Vector3(getHorizontalPosition(data.horizontalPosition) + width / 2 - 0.25, CEILING_HEIGHT, -SWORD_OFFSET);

				el.object3D.position.set(origin.x, origin.y, origin.z + data.halfJumpPosition + data.warmupPosition - halfDepth);
				el.object3D.scale.set(width, CEILING_THICKNESS, data.durationSeconds * data.speed);
			} else {
				// Box geometry is constructed from the local 0,0,0 growing in the positive and negative
				// x and z axis. We have to shift by half width and depth to be positioned correctly.
				origin = new THREE.Vector3(
					getHorizontalPosition(data.horizontalPosition) + width / 2 - 0.25,
					data.height + RAISE_Y_OFFSET,
					-SWORD_OFFSET
				);
				el.object3D.position.set(origin.x, origin.y, origin.z + data.halfJumpPosition + data.warmupPosition - halfDepth);
				el.object3D.scale.set(width, 2.5, data.durationSeconds * data.speed);
			}
		}

		let axis = new THREE.Vector3(0, 1, 0);
		let theta = data.spawnRotation * 0.0175;

		origin.applyAxisAngle(axis, theta);
		this.origin = origin;

		rotateAboutPoint(el.object3D, new THREE.Vector3(0, 0, this.headset.object3D.position.z), axis, theta, true);
		el.object3D.lookAt(origin);

		this.startPosition = el.object3D.position.clone();
	},

	setMappingExtensionsHeight: function (startHeight, height) {
		const data = this.data;
		const el = this.el;

		const halfDepth = (data.durationSeconds * (data.speed * this.song.speed)) / 2;

		el.object3D.position.set(
			getHorizontalPosition(data.horizontalPosition) + (data.width - _noteLinesDistance) / 2,
			startHeight * 0.25 + RAISE_Y_OFFSET,
			data.halfJumpPosition + data.warmupPosition - halfDepth - SWORD_OFFSET
		);

		el.object3D.scale.set(data.width * 0.98, height * 0.3, data.durationSeconds * (data.speed * this.song.speed));
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

	play: function () {
		this.el.object3D.visible = true;
		this.el.setAttribute('data-collidable-head', '');
		this.el.setAttribute('data-saber-particles', '');
		this.el.setAttribute('raycastable-game', '');
	},

	tock: function (time, timeDelta) {
		const data = this.data;
		const halfDepth = (data.durationSeconds * data.speed) / 2;
		const position = this.el.object3D.position;
		const currentTime = this.song.getCurrentTime();

		this.updatePosition();

		if (this.hit && currentTime > this.hitWall.time) {
			this.hit = false;
			this.el.emit('scoreChanged', {index: this.hitWall.i}, true);
		}

		if (position.z > this.maxZ + halfDepth) {
			this.returnToPool();
			return;
		}
	},

	returnToPool: function () {
		this.el.sceneEl.components.pool__wall.returnEntity(this.el);
		this.el.object3D.position.z = 9999;
		this.el.pause();
		this.el.removeAttribute('data-collidable-head');
		this.el.removeAttribute('raycastable-game');
	},
});
