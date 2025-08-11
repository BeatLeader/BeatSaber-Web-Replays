import {clamp} from '../utils';
function FindFrameIndexByTime(frames, songTime, startFrom = 0) {
	var index = startFrom;

	if (songTime >= frames[index].time) {
		//Search forwards
		for (var i = index; i < frames.length; ++i) {
			if (songTime < frames[i].time) break;
			index = i;
		}

		return index;
	}

	//Search backwards
	for (var i = index; i >= 0; --i) {
		if (songTime > frames[i].time) break;
		index = i;
	}

	return index;
}
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

		this._frameIndex = 0;
		this._heightFrameIndex = 0;
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
			const frameIndex = (this._frameIndex = FindFrameIndexByTime(frames, currentTime, this._frameIndex));
			const frame = frames[frameIndex];
			const nextFrame = frames[frameIndex + 1];

			if (frame.time == 0 && nextFrame.time == 0) return;

			this.fpsCounter.replayFps = frame.fps;
			this.firstSaberControl.frameIndex = frameIndex;
			this.secondSaberControl.frameIndex = frameIndex;
			this.frameTime = frame.time;

			var replayHeight;
			if (replay.heights.length) {
				const heightFrameIndex = (this._heightFrameIndex = FindFrameIndexByTime(replay.heights, currentTime, this._heightFrameIndex));
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
		// sabers
		this.updateSaber(this.saberEls[0].object3D, this.firstSaberControl.hitboxSaber, frame.left, nextFrame.left, height, slerpValue);
		this.updateSaber(this.saberEls[1].object3D, this.secondSaberControl.hitboxSaber, frame.right, nextFrame.right, height, slerpValue);

		// hmd | camera
		const headset = this.headset.object3D;
		const povCamera = this.povCameraRig.object3D;

		const v1 = this.v1;
		const v2 = this.v2;

		const euler = this.euler;
		const q1 = this.q1;
		const q2 = this.q2;

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

	updateSaber: function (saber, hitbox, frameData, nextFrameData, height, slerpValue) {
		const showTreecks = this.settings.settings.showTreecks;

		// position
		const originalPosition = frameData.position;
		const modifiedPosition = showTreecks && frameData.trickPosition ? frameData.trickPosition : frameData.position;
		const nextModifiedPosition = showTreecks && nextFrameData.trickPosition ? nextFrameData.trickPosition : nextFrameData.position;

		const v1 = this.v1;
		const v2 = this.v2;

		//hitbox position
		hitbox.position.set(originalPosition.x, originalPosition.y - height, -originalPosition.z);

		// saber position
		v1.set(modifiedPosition.x, modifiedPosition.y, modifiedPosition.z);
		v2.set(nextModifiedPosition.x, nextModifiedPosition.y, nextModifiedPosition.z);

		const lerpPosition = this.v1.lerp(this.v2, slerpValue);
		saber.position.set(lerpPosition.x, lerpPosition.y - height, -lerpPosition.z);

		// rotation
		const euler = this.euler;
		const q1 = this.q1;
		const q2 = this.q2;

		const originalRotation = frameData.rotation;
		const modifiedRotation = showTreecks && frameData.trickRotation ? frameData.trickRotation : frameData.rotation;
		const nextModifiedRotation = showTreecks && nextFrameData.trickRotation ? nextFrameData.trickRotation : nextFrameData.rotation;

		// hitbox rotation
		q1.set(originalRotation.w, originalRotation.z, originalRotation.y, originalRotation.x);
		let rotation = euler.setFromQuaternion(q1);
		hitbox.rotation.set(rotation.x, rotation.y + Math.PI, -rotation.z);

		// saber rotation
		q1.set(modifiedRotation.w, modifiedRotation.z, modifiedRotation.y, modifiedRotation.x);
		q2.set(nextModifiedRotation.w, nextModifiedRotation.z, nextModifiedRotation.y, nextModifiedRotation.x);

		const lquat = q1.slerp(q2, slerpValue);
		const slerpRotation = euler.setFromQuaternion(lquat);
		saber.rotation.set(slerpRotation.x, slerpRotation.y + Math.PI, -slerpRotation.z);

		const saberOffset = Number(this.settings.settings.saberOffset);
		saber.translateZ(-saberOffset);
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
