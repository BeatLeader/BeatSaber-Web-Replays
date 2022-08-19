import {BEAT_WARMUP_OFFSET, BEAT_WARMUP_SPEED, BEAT_WARMUP_TIME} from '../constants/beat';

// So wall does not clip the stage ground.
const RAISE_Y_OFFSET = 0.15;

const CEILING_THICKNESS = 1.5;
const CEILING_HEIGHT = 1.4 + CEILING_THICKNESS / 2;
const CEILING_WIDTH = 4;

const _noteLinesCount = 4;
const _noteLinesDistance = 0.6;

function getHorizontalPosition(lineIndex) {
	return (-(_noteLinesCount - 1) * 0.5 + lineIndex) * _noteLinesDistance;
}

/**
 * Wall to dodge.
 */
AFRAME.registerComponent('wall', {
	schema: {
		anticipationPosition: {default: 0},
		durationSeconds: {default: 0},
		height: {default: 1.3},
		horizontalPosition: {default: 1},
		verticalPosition: {default: 0},
		isCeiling: {default: false},
		speed: {default: 1.0},
		warmupPosition: {default: 0},
		width: {default: 1},
		positionOffset: {default: 0},
		time: {default: 0},
		anticipationTime: {default: 0},
		warmupTime: {default: 0},
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
		const position = this.el.object3D.position;
		const song = this.song;

		// Move.
		this.el.object3D.visible = true;

		var newPosition = 0;
		const currentTime = song.getCurrentTime();

		var timeOffset = data.time - currentTime - data.anticipationTime - data.warmupTime;

		if (timeOffset <= -data.warmupTime) {
			newPosition = data.anticipationPosition - halfDepth;
			timeOffset += data.warmupTime;
			newPosition += -timeOffset * data.speed;
		} else {
			newPosition = data.anticipationPosition - halfDepth + data.warmupPosition + data.warmupSpeed * -timeOffset;
		}

		newPosition += this.headset.object3D.position.z;
		position.z = newPosition;

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

		if (data.isCeiling) {
			el.object3D.position.set(
				getHorizontalPosition(data.horizontalPosition) + width / 2 - 0.25,
				CEILING_HEIGHT,
				data.anticipationPosition + data.warmupPosition - halfDepth
			);
			el.object3D.scale.set(width, CEILING_THICKNESS, data.durationSeconds * data.speed);
			return;
		}

		// Box geometry is constructed from the local 0,0,0 growing in the positive and negative
		// x and z axis. We have to shift by half width and depth to be positioned correctly.
		el.object3D.position.set(
			getHorizontalPosition(data.horizontalPosition) + width / 2 - 0.25,
			data.height + RAISE_Y_OFFSET,
			data.anticipationPosition + data.warmupPosition - halfDepth
		);
		el.object3D.scale.set(width, 2.5, data.durationSeconds * data.speed);
	},

	setMappingExtensionsHeight: function (startHeight, height) {
		const data = this.data;
		const el = this.el;

		const halfDepth = (data.durationSeconds * (data.speed * this.song.speed)) / 2;

		el.object3D.position.set(
			getHorizontalPosition(data.horizontalPosition) + (data.width - _noteLinesDistance) / 2,
			startHeight * 0.25 + RAISE_Y_OFFSET,
			data.anticipationPosition + data.warmupPosition - halfDepth
		);

		el.object3D.scale.set(data.width * 0.98, height * 0.3, data.durationSeconds * (data.speed * this.song.speed));
	},

	pause: function () {
		this.el.object3D.visible = false;
		this.el.removeAttribute('data-collidable-head');
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
