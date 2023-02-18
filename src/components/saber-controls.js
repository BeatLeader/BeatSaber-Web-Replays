/**
 * Controller, cursor, raycaster.
 */
AFRAME.registerComponent('saber-controls', {
	schema: {
		bladeEnabled: {default: true},
		enabled: {default: true},
		hand: {default: 'right', oneOf: ['left', 'right']},
		isPaused: {default: false},
		strokeMinSpeed: {default: 0.002},
		strokeMinDuration: {default: 40},
		hiddenSaber: {default: ''},
	},

	init: function () {
		var el = this.el;
		var data = this.data;

		this.boundingBox = new THREE.Box3();
		this.controllerType = '';
		this.xPlaneNormal = new THREE.Vector3(0, 1, 0);
		this.yPlaneNormal = new THREE.Vector3(1, 0, 0);
		this.xyPlaneNormal = new THREE.Vector3(1, 1, 0);
		this.bladeTipPosition = new THREE.Vector3();
		this.bladePosition = new THREE.Vector3();
		this.bladeVector = new THREE.Vector3();
		this.bladeTipPreviousPosition = new THREE.Vector3();
		this.bladePreviousPosition = new THREE.Vector3();
		this.projectedBladeVector = new THREE.Vector3();
		this.saberPosition = new THREE.Vector3();
		this.swinging = false;
		this.strokeCount = 0;
		this.distanceSamples = [];
		this.deltaSamples = [];
		this.startStrokePosition = new THREE.Vector3();
		this.strokeDirectionVector = new THREE.Vector3();
		this.strokeDirection = {
			down: false,
			left: false,
			right: false,
			up: false,
		};
		this.accumulatedDistance = 0;
		this.accumulatedDelta = 0;
		this.frameIndex = -1;
		this.previousFrameIndex = -1;

		const hand = {hand: data.hand, model: false};

		this.bladeEl = this.el.querySelector('.blade');
		this.containerEl = this.el.querySelector('.saberContainer');

		this.hitboxSaber = this.el.object3D.clone();
		this.hitboxSaber.visible = false;
		this.containerEl.sceneEl.object3D.add(this.hitboxSaber);

		this.hitboxBladeTipPreviousPosition = new THREE.Vector3();
		this.hitboxBladePreviousPosition = new THREE.Vector3();
		this.hitboxBladeTipPosition = new THREE.Vector3();
		this.hitboxBladePosition = new THREE.Vector3();

		this.el.sceneEl.addEventListener('colorChanged', e => {
			if (e.detail.hand == this.data.hand && e.detail.color) {
				this.el.components.trail.data.color = e.detail.color;
				this.el.components.trail.updateColor();
				this.el.querySelector('.saberHandle').setAttribute('material', 'color', e.detail.color);
				this.el.querySelector('.saberglow').setAttribute('material', 'color', e.detail.color);
			}
		});

		this.initBoxVars();
	},

	play: function () {
		this.settings = this.el.sceneEl.components.settings;
	},

	update: function (oldData) {
		if (this.data.hiddenSaber == this.data.hand) {
			this.el.object3D.visible = false;
		}
		if (!oldData.bladeEnabled && this.data.bladeEnabled) {
			this.bladeEl.emit('drawblade');
		}
	},

	tick: function (time, delta) {
		if (!this.data.bladeEnabled) {
			return;
		}

		if (!this.settings.settings.showHitboxes && this.settings.settings.reducedDebris) {
			if (this.line) {
				this.line.visible = false;
			}

			return;
		}
		this.detectStroke(delta);

		if (this.line) {
			this.line.visible = this.settings.settings.showHitboxes;
			if (this.hitboxGood) {
				this.line.geometry.computeBoundingBox();
				this.boundingBox.copy(this.line.geometry.boundingBox).applyMatrix4(this.line.matrixWorld);
			}
		}
	},

	detectStroke: function (delta) {
		var distance;
		var distanceSamples = this.distanceSamples;
		var data = this.data;
		var directionChange;

		// Tip of the blade position in world coordinates.
		this.bladeTipPosition.set(0, 0, -1);
		this.bladePosition.set(0, 0, 0.0);

		const saberObj = this.el.object3D;
		saberObj.parent.updateMatrixWorld();
		saberObj.localToWorld(this.bladeTipPosition);
		saberObj.localToWorld(this.bladePosition);

		if (this.frameIndex != this.previousFrameIndex) {
			this.hitboxBladeTipPosition.set(0, 0, -1);
			this.hitboxBladePosition.set(0, 0, 0);

			const hitboxSaber = this.hitboxSaber;
			hitboxSaber.parent.updateMatrixWorld();
			hitboxSaber.localToWorld(this.hitboxBladeTipPosition);
			hitboxSaber.localToWorld(this.hitboxBladePosition);

			this.threePointsToBox(
				this.hitboxBladeTipPosition,
				this.hitboxBladePosition,
				new THREE.Vector3().addVectors(this.hitboxBladePreviousPosition, this.hitboxBladeTipPreviousPosition).multiplyScalar(0.5)
			);

			this.hitboxBladePreviousPosition.copy(this.hitboxBladePosition);
			this.hitboxBladeTipPreviousPosition.copy(this.hitboxBladeTipPosition);
			this.previousFrameIndex = this.frameIndex;
		}

		// Angles between saber and major planes.
		this.bladeVector.copy(this.bladeTipPosition).sub(this.bladePosition).normalize();
		var anglePlaneX = this.projectedBladeVector.copy(this.bladeTipPosition).projectOnPlane(this.xPlaneNormal).angleTo(this.bladeVector);
		var anglePlaneY = this.projectedBladeVector.copy(this.bladeTipPosition).projectOnPlane(this.yPlaneNormal).angleTo(this.bladeVector);
		var anglePlaneXY = this.projectedBladeVector.copy(this.bladeTipPosition).projectOnPlane(this.xyPlaneNormal).angleTo(this.bladeVector);

		// Distance covered but the saber tip in one frame.
		distance = this.bladeTipPreviousPosition.sub(this.bladeTipPosition).length();
		this.bladeSpeed = distance / delta;

		// Sample distance of the last 5 frames.
		if (this.distanceSamples.length === 5) {
			this.accumulatedDistance -= this.distanceSamples.shift();
			this.accumulatedDelta -= this.deltaSamples.shift();
		}
		this.distanceSamples.push(distance);
		this.accumulatedDistance += distance;

		this.deltaSamples.push(delta);
		this.accumulatedDelta += delta;

		// Filter out saber movements that are too slow. Too slow is considered wrong hit.
		if (this.accumulatedDistance / this.accumulatedDelta > this.data.strokeMinSpeed) {
			// This filters out unintentional swings.
			if (!this.swinging) {
				this.startStrokePosition.copy(this.bladeTipPosition);
				this.swinging = true;
				this.strokeDuration = 0;
				this.maxAnglePlaneX = 0;
				this.maxAnglePlaneY = 0;
				this.maxAnglePlaneXY = 0;
			}
			this.updateStrokeDirection();
			this.strokeDuration += delta;
			const anglePlaneXIncreased = anglePlaneX > this.maxAnglePlaneX;
			const anglePlaneYIncreased = anglePlaneY > this.maxAnglePlaneY;
			const anglePlaneXYIncreased = anglePlaneXY > this.maxAnglePlaneXY;
			this.maxAnglePlaneX = anglePlaneXIncreased ? anglePlaneX : this.maxAnglePlaneX;
			this.maxAnglePlaneY = anglePlaneYIncreased ? anglePlaneY : this.maxAnglePlaneY;
			this.maxAnglePlaneXY = anglePlaneXYIncreased ? anglePlaneXY : this.maxAnglePlaneXY;
			if (!anglePlaneXIncreased && !anglePlaneYIncreased) {
				this.endStroke();
			}
		} else {
			this.endStroke();
		}

		this.bladePreviousPosition.copy(this.bladePosition);
		this.bladeTipPreviousPosition.copy(this.bladeTipPosition);
	},

	endStroke: function () {
		if (!this.swinging || this.strokeDuration < this.data.strokeMinDuration) {
			return;
		}

		this.el.emit('strokeend');
		this.swinging = false;
		// Stroke finishes. Reset swinging state.
		this.accumulatedDistance = 0;
		this.accumulatedDelta = 0;
		this.maxAnglePlaneX = 0;
		this.maxAnglePlaneY = 0;
		this.maxAnglePlaneXY = 0;
		for (let i = 0; i < this.distanceSamples.length; i++) {
			this.distanceSamples[i] = 0;
		}
		for (let i = 0; i < this.deltaSamples.length; i++) {
			this.deltaSamples[i] = 0;
		}
	},

	initBoxVars: function () {
		this.zeroVector = new THREE.Vector3(0, 0, 0);
		this.v1 = new THREE.Vector3();
		this.v2 = new THREE.Vector3();
		this.v3 = new THREE.Vector3();
		this.v4 = new THREE.Vector3();
		this.v5 = new THREE.Vector3();

		this.orientation = new THREE.Quaternion();
		this.matrix = new THREE.Matrix4();
		this.plane = new THREE.Plane();
	},

	// saberBladeTopPos, saberBladeBottomPos, (bottomPos + topPos) * 0.5f
	threePointsToBox: function (p0, p1, p2) {
		var normalized1 = this.v1.crossVectors(this.v2.subVectors(p1, p2), this.v3.subVectors(p0, p2)).normalize();
		if (normalized1.lengthSq() > 9.99999974737875e-6) {
			var normalized2 = this.v2.subVectors(p0, p1).normalize();
			var inNormal = this.v3.crossVectors(normalized2, normalized1);

			var mx = this.matrix.lookAt(normalized2, this.zeroVector, normalized1);
			this.orientation.setFromRotationMatrix(mx);

			var num1 = Math.abs(this.plane.setFromNormalAndCoplanarPoint(inNormal, p0).distanceToPoint(p2));
			var num2 = this.v4.subVectors(p0, p1).length();
			var vector3 = this.v5.addVectors(p0, p1).multiplyScalar(0.5);

			const saberOrigin = vector3.sub(inNormal.multiplyScalar(num1).multiplyScalar(0.5));

			var line;

			if (this.line) {
				line = this.line;
			} else {
				this.saberBox = new THREE.BoxGeometry(1, 1, 1);
				const material = new THREE.MeshBasicMaterial({
					color: 0xff00ff,
				});
				line = new THREE.Mesh(this.saberBox, material);
				this.line = line;
				line.position.copy(saberOrigin);
				this.containerEl.sceneEl.object3D.add(line);
			}

			line.scale.set(0.0001, Math.max(num1, 0.0001), num2);
			line.quaternion.copy(this.orientation);
			line.position.copy(saberOrigin);
			line.rotation.z += Math.PI / 2;

			line.updateMatrixWorld();

			this.hitboxGood = true;
		} else {
			this.hitboxGood = false;
		}
	},

	updateStrokeDirection: function () {
		this.strokeDirectionVector.copy(this.bladeTipPosition).sub(this.startStrokePosition);
		if (this.strokeDirectionVector.x === 0 && this.strokeDirectionVector.y === 0) {
			return;
		}
		this.strokeDirection.right = this.strokeDirectionVector.x > 0;
		this.strokeDirection.left = this.strokeDirectionVector.x < 0;
		this.strokeDirection.up = this.strokeDirectionVector.y > 0;
		this.strokeDirection.down = this.strokeDirectionVector.y < 0;
	},

	initSaber: function (evt) {},
});
