import {clamp} from '../utils';
AFRAME.registerComponent('replay-player', {
	schema: {},

	init: function () {
		this.saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');

		this.firstSaberControl = this.saberEls[0].components['saber-controls'];
		this.secondSaberControl = this.saberEls[1].components['saber-controls'];

		this.replayDecoder = this.el.sceneEl.components['replay-loader'];
		this.fpsCounter = this.el.sceneEl.components['fps-counter'];
		this.song = this.el.sceneEl.components.song;
		this.cameraXRotationSlider = document.querySelector('#cameraXRotation');
		this.settings = this.el.sceneEl.components.settings;
		this.score = {
			totalScore: 0,
			combo: 0,
			acc: 0,
			lastNoteScore: 0,
			multiplier: 1,
		};

		this.saberEls[0].object3D.position.y = 1.4;
		this.saberEls[0].object3D.position.x = -0.4;

		this.saberEls[1].object3D.position.y = 1.4;
		this.saberEls[1].object3D.position.x = 0.4;

		this.euler = new THREE.Euler();
		this.v1 = new THREE.Vector3();
		this.v2 = new THREE.Vector3();
		this.v3 = new THREE.Vector3();

		this.q1 = new THREE.Quaternion();
		this.q2 = new THREE.Quaternion();
	},

	play: function () {
		this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
		this.headset.object3D.position.y = 1.75;

		this.povCameraRig = this.el.sceneEl.querySelectorAll('.headCamera')[0];
	},

	tock: function (time, delta) {
		let replay = this.replayDecoder.replay;
		if (replay && !this.headRotationOffset) {
			this.calculateHeadRotationOffset(replay);
			this.supports360 = replay.info.mode == '360Degree' || replay.info.mode == '90Degree';
		}

		if (this.song.isPlaying && replay) {
			const currentTime = this.song.getCurrentTime();
			const frames = this.replayDecoder.replay.frames;
			var frameIndex = 0;
			while (frameIndex < frames.length - 2 && frames[frameIndex + 1].time < currentTime) {
				frameIndex++;
			}
			const frame = frames[frameIndex];
			const nextFrame = frames[frameIndex + 1];

			if (frame.time == 0 && nextFrame.time == 0) return;

			this.fpsCounter.replayFps = frame.fps;
			this.firstSaberControl.frameIndex = frameIndex;
			this.secondSaberControl.frameIndex = frameIndex;
			this.frameTime = frame.time;

			var replayHeight;
			if (replay.heights.length) {
				var heightFrameIndex = 0;
				while (heightFrameIndex < replay.heights.length - 2 && replay.heights[heightFrameIndex + 1].time < currentTime) {
					heightFrameIndex++;
				}
				replayHeight = replay.heights[heightFrameIndex].height;
			} else {
				replayHeight = replay.info.height;
			}

			let height = clamp((replayHeight - 1.8) * 0.5, -0.2, 0.6);
			let slerpValue = (currentTime - frame.time) / Math.max(1e-6, nextFrame.time - frame.time);

			this.movementsTock(frame, nextFrame, height, slerpValue, delta);
		}
	},
	movementsTock: function (frame, nextFrame, height, slerpValue, delta) {
		const leftSaber = this.saberEls[0].object3D;
		const rightSaber = this.saberEls[1].object3D;
		const leftHitboxSaber = this.firstSaberControl.hitboxSaber;
		const rightHitboxSaber = this.secondSaberControl.hitboxSaber;
		const headset = this.headset.object3D;
		const povCamera = this.povCameraRig.object3D;
		const showTreecks = this.settings.settings.showTreecks;

		const offsetInput = document.getElementById('saberOffset');

		const v1 = this.v1;
		const v2 = this.v2;

		const leftPosition = showTreecks && frame.left.trickPosition ? frame.left.trickPosition : frame.left.position;
		v1.set(leftPosition.x, leftPosition.y, leftPosition.z);
		const leftNextPosition = showTreecks && nextFrame.left.trickPosition ? nextFrame.left.trickPosition : nextFrame.left.position;
		v2.set(leftNextPosition.x, leftNextPosition.y, leftNextPosition.z);
		leftHitboxSaber.position.set(v1.x, v1.y - height, -v1.z);
		const lposition = v1.lerp(v2, slerpValue);
		leftSaber.position.set(lposition.x, lposition.y - height, -lposition.z);

		const rightPosition = showTreecks && frame.right.trickPosition ? frame.right.trickPosition : frame.right.position;
		v1.set(rightPosition.x, rightPosition.y, rightPosition.z);
		const rightNextPosition = showTreecks && nextFrame.right.trickPosition ? nextFrame.right.trickPosition : nextFrame.right.position;
		v2.set(rightNextPosition.x, rightNextPosition.y, rightNextPosition.z);
		rightHitboxSaber.position.set(v1.x, v1.y - height, -v1.z);
		const rposition = v1.lerp(v2, slerpValue);
		rightSaber.position.set(rposition.x, rposition.y - height, -rposition.z);

		const euler = this.euler;
		const q1 = this.q1;
		const q2 = this.q2;

		const leftRotation = showTreecks && frame.left.trickRotation ? frame.left.trickRotation : frame.left.rotation;
		q1.set(leftRotation.w, leftRotation.z, leftRotation.y, leftRotation.x);
		const leftNextRotation = showTreecks && nextFrame.left.trickRotation ? nextFrame.left.trickRotation : nextFrame.left.rotation;
		q2.set(leftNextRotation.w, leftNextRotation.z, leftNextRotation.y, leftNextRotation.x);
		let lrotation = euler.setFromQuaternion(q1);
		leftHitboxSaber.rotation.set(lrotation.x, lrotation.y + Math.PI, -lrotation.z);

		const lquat = q1.slerp(q2, slerpValue);
		lrotation = euler.setFromQuaternion(lquat);
		leftSaber.rotation.set(lrotation.x, lrotation.y + Math.PI, -lrotation.z);

		const rightRotation = showTreecks && frame.right.trickRotation ? frame.right.trickRotation : frame.right.rotation;
		q1.set(rightRotation.w, rightRotation.z, rightRotation.y, rightRotation.x);
		const rightNextRotation = showTreecks && nextFrame.right.trickRotation ? nextFrame.right.trickRotation : nextFrame.right.rotation;
		q2.set(rightNextRotation.w, rightNextRotation.z, rightNextRotation.y, rightNextRotation.x);
		let rrotation = euler.setFromQuaternion(q1);
		rightHitboxSaber.rotation.set(rrotation.x, rrotation.y + Math.PI, -rrotation.z);

		const rquat = q1.slerp(q2, slerpValue);
		rrotation = euler.setFromQuaternion(rquat);
		rightSaber.rotation.set(rrotation.x, rrotation.y + Math.PI, -rrotation.z);

		if (!!offsetInput) {
			leftSaber.translateZ(-offsetInput.value);
			rightSaber.translateZ(-offsetInput.value);
			document.getElementById('saberOffsetLabel').textContent = offsetInput.value;
		}

		v1.set(frame.head.position.x, frame.head.position.y, frame.head.position.z);
		v2.set(nextFrame.head.position.x, nextFrame.head.position.y, nextFrame.head.position.z);
		const hpostion = v1.lerp(v2, slerpValue);
		headset.position.set(hpostion.x, hpostion.y - height, -hpostion.z);

		q1.set(frame.head.rotation.w, frame.head.rotation.z, frame.head.rotation.y, frame.head.rotation.x);
		q2.set(nextFrame.head.rotation.w, nextFrame.head.rotation.z, nextFrame.head.rotation.y, nextFrame.head.rotation.x);
		var hquat = q1.slerp(q2, slerpValue);
		var hrotation = euler.setFromQuaternion(hquat);
		headset.rotation.set(hrotation.x, hrotation.y + Math.PI, -hrotation.z + Math.PI);

		this.v3.copy(headset.position);

		if (this.supports360) {
			povCamera.getWorldDirection(this.v1);
			const offset = this.v1.multiplyScalar(parseFloat(this.settings.settings.cameraZPosition));

			this.v3.z += offset.z;
			this.v3.x += offset.x;
		} else {
			this.v3.z += parseFloat(this.settings.settings.cameraZPosition);
		}

		const normalizedDelta = delta > 1000 ? 0.01 : delta / 1000;
		povCamera.position.copy(povCamera.position.lerp(this.v3, 5 * normalizedDelta));

		if (povCamera.hquat) {
			hquat = povCamera.hquat.slerp(hquat, 5 * normalizedDelta);
		} else {
			hquat = new THREE.Quaternion().copy(hquat);
		}
		hrotation = euler.setFromQuaternion(hquat);

		let forceForwardLookDirection = this.settings.settings.forceForwardLookDirection;
		let headRotationOffset = this.headRotationOffset;
		if (!this.supports360 && headRotationOffset && forceForwardLookDirection) {
			hrotation.x += headRotationOffset.x;
			hrotation.z += headRotationOffset.z;
			this.cameraXRotationSlider.disabled = true;
		} else {
			hrotation.x += this.settings.settings.cameraXRotation * 0.017453;
			this.cameraXRotationSlider.disabled = false;
		}

		povCamera.rotation.set(hrotation.x, hrotation.y + Math.PI, -hrotation.z + Math.PI);
		povCamera.hquat = hquat;
	},

	calculateHeadRotationOffset: function (replay) {
		const headQ = new THREE.Quaternion(),
			headEuler = new THREE.Euler();
		var x = 0,
			z = 0;
		for (var i = 0; i < replay.frames.length; i++) {
			var rotation = replay.frames[i].head.rotation;
			headQ.set(rotation.x, rotation.y, rotation.z, rotation.w);
			headEuler.setFromQuaternion(headQ);
			x += headEuler.x;
			z += headEuler.z;
		}
		x /= replay.frames.length;
		z /= replay.frames.length;
		this.headRotationOffset = {x: x, z: z};
	},
});
