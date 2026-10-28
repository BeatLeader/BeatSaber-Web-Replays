import {clamp} from '../utils';
import {findTimeIndex, getSmoothingKernel, PoseAverage, smoothingWindow} from '../utils/motion-smoothing';

function partPosition(frame, part, tricks) {
	const data = frame[part];
	return tricks && data.trickPosition ? data.trickPosition : data.position;
}

function partRotation(frame, part, tricks) {
	const data = frame[part];
	return tricks && data.trickRotation ? data.trickRotation : data.rotation;
}

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
		this.poses = {head: new PoseAverage(), left: new PoseAverage(), right: new PoseAverage(), camera: new PoseAverage()};
		this.cameraRotation = new THREE.Quaternion();
		this.snapCamera = true;

		this.headEuler = new THREE.Euler();
		this.headQ1 = new THREE.Quaternion();
		this.headQ2 = new THREE.Quaternion();

		this._frameIndex = 0;
		this._heightFrameIndex = 0;
		this._headFrameIndex = 0;

		this.el.addEventListener('replayunload', () => {
			this.headRotationOffset = null;
			this._frameIndex = 0;
			this._heightFrameIndex = 0;
			this._headFrameIndex = 0;
			this.snapCamera = true;
		});
		this.el.addEventListener('replayframesloaded', () => (this.headRotationOffset = null));
		this.el.sceneEl.addEventListener('timechanged', () => (this.snapCamera = true));
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

			if (!frame || !nextFrame || (frame.time == 0 && nextFrame.time == 0)) return;

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

			const settings = this.settings.settings;
			this.samplePoses(frames, currentTime, smoothingWindow(settings.movementSmoothing), settings.showTreecks);
			this.movementsTock(frame, height, delta);
		}
	},

	samplePoses: function (frames, time, window, tricks) {
		const {offsets, weights} = getSmoothingKernel(window);
		const {head, left, right, camera} = this.poses;
		head.reset();
		left.reset();
		right.reset();
		camera.reset();

		let index = this._frameIndex;
		for (let i = 0; i < offsets.length; i++) {
			const tapTime = time + offsets[i];
			index = findTimeIndex(frames, tapTime, index);
			const a = frames[index];
			const b = frames[Math.min(index + 1, frames.length - 1)];
			const t = b.time > a.time ? clamp((tapTime - a.time) / (b.time - a.time), 0, 1) : 0;

			this.addInterpolatedPose(head, a, b, 'head', false, t, weights[i]);
			this.addInterpolatedPose(left, a, b, 'left', tricks, t, weights[i]);
			this.addInterpolatedPose(right, a, b, 'right', tricks, t, weights[i]);
			if (offsets[i] === 0) this.addInterpolatedPose(camera, a, b, 'head', false, t, 1);
		}

		head.finish();
		left.finish();
		right.finish();
		camera.finish();
	},

	addInterpolatedPose: function (average, a, b, part, tricks, t, weight) {
		const p1 = partPosition(a, part, tricks);
		const p2 = partPosition(b, part, tricks);
		const r1 = partRotation(a, part, tricks);
		const r2 = partRotation(b, part, tricks);

		this.v1.set(p1.x, p1.y, p1.z).lerp(this.v2.set(p2.x, p2.y, p2.z), t);
		this.q1.set(r1.x, r1.y, r1.z, r1.w).slerp(this.q2.set(r2.x, r2.y, r2.z, r2.w), t);
		average.add(this.v1, this.q1, weight);
	},

	getHeadQuaternion: function (time, out) {
		const replay = this.replayDecoder.replay;
		if (!replay || !replay.frames.length) return false;

		const frames = replay.frames;
		const index = (this._headFrameIndex = findTimeIndex(frames, time, this._headFrameIndex));
		const a = frames[index];
		const b = frames[Math.min(index + 1, frames.length - 1)];
		const t = b.time > a.time ? clamp((time - a.time) / (b.time - a.time), 0, 1) : 0;

		const r1 = a.head.rotation;
		const r2 = b.head.rotation;
		this.headQ1.set(r1.w, r1.z, r1.y, r1.x).slerp(this.headQ2.set(r2.w, r2.z, r2.y, r2.x), t);
		const rotation = this.headEuler.setFromQuaternion(this.headQ1);
		rotation.set(rotation.x, rotation.y + Math.PI, -rotation.z + Math.PI);
		out.setFromEuler(rotation);
		return true;
	},

	movementsTock: function (frame, height, delta) {
		// sabers
		this.updateSaber(this.saberEls[0].object3D, this.firstSaberControl.hitboxSaber, frame.left, this.poses.left, height);
		this.updateSaber(this.saberEls[1].object3D, this.secondSaberControl.hitboxSaber, frame.right, this.poses.right, height);

		// hmd
		const headset = this.headset.object3D;
		const euler = this.euler;
		const head = this.poses.head;

		const hpostion = head.position;
		headset.position.set(hpostion.x, hpostion.y - height, -hpostion.z);

		const hquat = this.q1.set(head.rotation.w, head.rotation.z, head.rotation.y, head.rotation.x);
		let hrotation = euler.setFromQuaternion(hquat);
		headset.rotation.set(hrotation.x, hrotation.y + Math.PI, -hrotation.z + Math.PI);

		// camera
		const povCamera = this.povCameraRig.object3D;
		const camera = this.poses.camera;
		this.v3.set(camera.position.x, camera.position.y - height, -camera.position.z);
		this.q1.set(camera.rotation.w, camera.rotation.z, camera.rotation.y, camera.rotation.x);

		if (this.supports360) {
			povCamera.getWorldDirection(this.v1);
			const offset = this.v1.multiplyScalar(parseFloat(this.settings.settings.cameraZPosition));

			this.v3.z += offset.z;
			this.v3.x += offset.x;
		} else {
			this.v3.z += parseFloat(this.settings.settings.cameraZPosition);
		}

		// The same smoothing as the Camera2 mod's first person camera
		if (this.snapCamera) {
			povCamera.position.copy(this.v3);
			this.cameraRotation.copy(this.q1);
			this.snapCamera = false;
		} else {
			const seconds = delta / 1000;
			povCamera.position.lerp(this.v3, Math.min(seconds * parseFloat(this.settings.settings.cameraPositionSmoothing), 1));
			this.cameraRotation.slerp(this.q1, Math.min(seconds * parseFloat(this.settings.settings.cameraRotationSmoothing), 1));
		}
		hrotation = euler.setFromQuaternion(this.cameraRotation);

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
	},

	updateSaber: function (saber, hitbox, frameData, pose, height) {
		// hitbox position, from the frame itself so smoothing doesn't move it
		const originalPosition = frameData.position;
		hitbox.position.set(originalPosition.x, originalPosition.y - height, -originalPosition.z);

		// saber position
		const position = pose.position;
		saber.position.set(position.x, position.y - height, -position.z);

		// rotation
		const euler = this.euler;
		const q1 = this.q1;
		const originalRotation = frameData.rotation;

		// hitbox rotation
		q1.set(originalRotation.w, originalRotation.z, originalRotation.y, originalRotation.x);
		let rotation = euler.setFromQuaternion(q1);
		hitbox.rotation.set(rotation.x, rotation.y + Math.PI, -rotation.z);

		// saber rotation
		const poseRotation = pose.rotation;
		q1.set(poseRotation.w, poseRotation.z, poseRotation.y, poseRotation.x);
		const slerpRotation = euler.setFromQuaternion(q1);
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
