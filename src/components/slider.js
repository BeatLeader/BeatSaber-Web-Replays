import {getHorizontalPosition, getVerticalPosition, rotateAboutPoint} from '../utils';
const COLORS = require('../constants/colors.js');

AFRAME.registerComponent('slider', {
	schema: {
		anticipationPosition: {default: 0},
		color: {default: 'red', oneOf: ['red', 'blue']},
		cutDirection: {default: 'down'},
		tailCutDirection: {default: 'down'},
		rotationOffset: {default: 0},
		horizontalPosition: {default: 1},
		verticalPosition: {default: 1},
		tailHorizontalPosition: {default: 1},
		tailVerticalPosition: {default: 1},
		speed: {default: 8.0},

		warmupPosition: {default: 0},
		time: {default: 0},
		tailTime: {default: 0},
		hasTailNote: {default: false},
		halfJumpDuration: {default: 0},
		warmupTime: {default: 0},
		warmupSpeed: {default: 0},
		blue: {default: COLORS.BEAT_BLUE},
		red: {default: COLORS.BEAT_RED},

		spawnRotation: {default: 0},
		tailSpawnRotation: {default: 0},
	},

	cutColor: {
		blue: '#fff',
		red: '#fff',
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
		this.currentRotationWarmupTime = 0;

		this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
		this.song = this.el.sceneEl.components.song;

		this.saberColors = {right: 'blue', left: 'red'};
		this.glow = null;

		this.initBlock();
	},

	pause: function () {
		this.el.object3D.visible = false;
	},

	play: function () {
		this.el.object3D.visible = true;
	},

	updatePosition: function () {
		const el = this.el;
		const data = this.data;
		const position = el.object3D.position;
		const song = this.song;

		var newPosition = 0;

		var timeOffset = data.time - song.getCurrentTime() - data.halfJumpDuration - data.warmupTime;

		if (timeOffset <= -data.warmupTime) {
			newPosition = data.anticipationPosition;
			timeOffset += data.warmupTime;
			newPosition += -timeOffset * data.speed;
		} else {
			newPosition = data.anticipationPosition + data.warmupPosition + data.warmupSpeed * -timeOffset;
		}

		newPosition += this.headset.object3D.position.z;

		if (data.spawnRotation == 0) {
			position.z = newPosition;
		} else {
			var direction = this.startPosition.clone().sub(this.origin).normalize();
			el.object3D.position.copy(direction.multiplyScalar(-newPosition).add(this.origin));
		}

		if (this.splineObject.material.uniforms.start) {
			this.splineObject.material.uniforms.start.value = this.headset.object3D.position.z;
			this.splineObject.material.uniforms.finish.value = data.anticipationPosition;
		}
	},

	tock: function (time, timeDelta) {
		this.updatePosition();

		if (this.song.getCurrentTime() > this.data.tailTime) {
			this.returnToPool();
		}
	},

	/**
	 * Called when summoned by beat-generator.
	 */
	onGenerate: function () {
		const data = this.data;
		const el = this.el;

		this.updateBlock();

		// Set position.
		el.object3D.position.set(0, 0, data.anticipationPosition + data.warmupPosition);

		if (data.spawnRotation) {
			let axis = new THREE.Vector3(0, 1, 0);
			let theta = data.spawnRotation * 0.0175;
			let origin = new THREE.Vector3(0, 0, 0);

			origin.applyAxisAngle(axis, theta);
			this.origin = origin;

			rotateAboutPoint(el.object3D, new THREE.Vector3(0, 0, this.headset.object3D.position.z), axis, theta, true);
			el.object3D.lookAt(origin);
			this.startPosition = el.object3D.position.clone();
			this.startRotation = el.object3D.quaternion.clone();
		}

		// Reset the state properties.
		this.returnToPoolTimeStart = undefined;

		this.updatePosition();
	},

	initBlock: function () {
		var el = this.el;
		var blockEl = (this.blockEl = document.createElement('a-entity'));
		el.appendChild(blockEl);
	},

	updateBlock: function () {
		const blockEl = this.blockEl;
		if (!blockEl) {
			return;
		}

		if (this.splineObject) {
			this.el.object3D.remove(this.splineObject);
		}

		const data = this.data;

		const headX = getHorizontalPosition(data.horizontalPosition);
		const headY = getVerticalPosition(data.verticalPosition);
		const headAngle = THREE.Math.degToRad(this.rotations[data.cutDirection] + (this.data.rotationOffset ? this.data.rotationOffset : 0.0));

		const tailX = getHorizontalPosition(data.tailHorizontalPosition);
		const tailY = getVerticalPosition(data.tailVerticalPosition);
		const tailZ = -data.speed * (data.tailTime - data.time);
		const tailAngle =
			Math.PI + THREE.Math.degToRad(this.rotations[data.tailCutDirection] + (this.data.rotationOffset ? this.data.rotationOffset : 0.0));

		let points = [new THREE.Vector3(headX, headY, 0)];
		if (tailZ <= -0.6) {
			points.push(new THREE.Vector3(headX + 0.6 * Math.sin(headAngle), headY - 0.6 * Math.cos(headAngle), -0.3));
			if (data.hasTailNote) {
				points.push(new THREE.Vector3(tailX + 0.6 * Math.sin(tailAngle), tailY - 0.6 * Math.cos(tailAngle), tailZ + 0.3));
			}
		}
		points.push(new THREE.Vector3(tailX, tailY, tailZ));

		const pipeSpline = new THREE.CatmullRomCurve3(points);

		const geometry = new THREE.TubeGeometry(pipeSpline, 30, 0.05, 6, false);

		const material = this.el.sceneEl.systems.materials['splinematerial' + this.data.color];

		const splineObject = new THREE.Mesh(geometry, material);

		material.uniforms.mainColor.value = new THREE.Color(this.data[this.data.color]);
		material.emissive = this.data[this.data.color];
		material.emissiveIntensity = 0.15;

		splineObject.renderOrder = 6;
		this.splineObject = splineObject;
		this.el.object3D.add(splineObject);
	},

	returnToPool: function () {
		this.el.sceneEl.components[`pool__slider-${this.data.color}`].returnEntity(this.el);
	},
});
