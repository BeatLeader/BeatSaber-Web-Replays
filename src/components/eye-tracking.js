const BEAM_LENGTH = 6;
const BEAM_START = 0.08;
const RING_DISTANCE = 3;
const COLOR = 0xffd966;
const MAX_GAZE_GAP = 0.1;
const MAX_EYELIDS_GAP = 0.25;
const BLINK_START = 0.6;
const BLINK_END = 0.95;

function FindSampleIndex(samples, time, hint) {
	if (hint >= 0 && hint < samples.length && samples[hint].time <= time) {
		if (hint + 1 >= samples.length || samples[hint + 1].time > time) return hint;
		if (hint + 2 >= samples.length || samples[hint + 2].time > time) return hint + 1;
	}

	let lo = 0;
	let hi = samples.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (samples[mid].time <= time) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
}

AFRAME.registerComponent('eye-tracking', {
	init: function () {
		this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
		this.eyeTracking = null;
		this.gazeIndex = -1;
		this.eyelidsIndex = -1;
		this.headTime = null;

		this.localGaze = new THREE.Vector3();
		this.nextGaze = new THREE.Vector3();
		this.forward = new THREE.Vector3(0, 0, -1);
		this.localRotation = new THREE.Quaternion();
		this.color = new THREE.Color(COLOR);

		this.group = this.createVisuals();
		this.group.visible = false;
		this.el.setObject3D('mesh', this.group);
	},

	createVisuals: function () {
		const group = new THREE.Group();

		const beamGeometry = new THREE.CylinderBufferGeometry(0.012, 0.003, BEAM_LENGTH, 8, 16, true);
		beamGeometry.rotateX(-Math.PI / 2);
		beamGeometry.translate(0, 0, -BEAM_LENGTH / 2 - BEAM_START);

		const positions = beamGeometry.attributes.position;
		const colors = new Float32Array(positions.count * 3);
		for (let i = 0; i < positions.count; i++) {
			const distance = (-positions.getZ(i) - BEAM_START) / BEAM_LENGTH;
			const intensity = Math.pow(1 - distance, 2);
			colors[i * 3] = this.color.r * intensity;
			colors[i * 3 + 1] = this.color.g * intensity;
			colors[i * 3 + 2] = this.color.b * intensity;
		}
		beamGeometry.addAttribute('color', new THREE.BufferAttribute(colors, 3));

		this.beamMaterial = new THREE.MeshBasicMaterial({
			vertexColors: THREE.VertexColors,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		group.add(new THREE.Mesh(beamGeometry, this.beamMaterial));

		const ringGeometry = new THREE.RingBufferGeometry(0.04, 0.055, 32);
		ringGeometry.translate(0, 0, -RING_DISTANCE);
		this.ringMaterial = new THREE.MeshBasicMaterial({
			color: COLOR,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		group.add(new THREE.Mesh(ringGeometry, this.ringMaterial));

		return group;
	},

	tock: function () {
		const song = this.el.sceneEl.components.song;
		if (song && song.isPlaying) {
			this.headTime = song.getCurrentTime();
		}
	},

	tick: function () {
		const eyeTracking = this.getEyeTracking();
		const settings = this.el.sceneEl.components.settings;
		const enabled = eyeTracking && this.headTime !== null && settings && settings.settings.showEyeTracking;
		this.group.visible = Boolean(enabled) && this.updateGaze(eyeTracking, this.headTime);
	},

	getEyeTracking: function () {
		const replayLoader = this.el.sceneEl.components['replay-loader'];
		const replay = replayLoader && replayLoader.replay;
		const eyeTracking = (replay && replay.parsedCustomData && replay.parsedCustomData['EyeTracking']) || null;
		if (eyeTracking !== this.eyeTracking) {
			this.eyeTracking = eyeTracking;
			this.gazeIndex = -1;
			this.eyelidsIndex = -1;
		}
		return eyeTracking;
	},

	updateGaze: function (eyeTracking, time) {
		const samples = eyeTracking.gaze;
		const i = (this.gazeIndex = FindSampleIndex(samples, time, this.gazeIndex));
		if (i < 0 || i >= samples.length - 1) return false;
		const a = samples[i];
		const b = samples[i + 1];
		if (b.time - a.time > MAX_GAZE_GAP) return false;

		const t = (time - a.time) / Math.max(1e-6, b.time - a.time);
		this.localGaze
			.set(a.x, a.y, -a.z)
			.lerp(this.nextGaze.set(b.x, b.y, -b.z), t)
			.normalize();

		const head = this.headset.object3D;
		this.group.position.copy(head.position);
		this.localRotation.setFromUnitVectors(this.forward, this.localGaze);
		this.group.quaternion.copy(head.quaternion).multiply(this.localRotation);

		const openness = 1 - this.getBlink(eyeTracking, time);
		this.beamMaterial.color.setScalar(openness);
		this.ringMaterial.color.copy(this.color).multiplyScalar(openness);
		return openness > 0.02;
	},

	getBlink: function (eyeTracking, time) {
		const samples = eyeTracking.eyelids;
		const i = (this.eyelidsIndex = FindSampleIndex(samples, time, this.eyelidsIndex));
		if (i < 0 || i >= samples.length - 1) return 0;
		const a = samples[i];
		const b = samples[i + 1];
		if (b.time - a.time > MAX_EYELIDS_GAP) return 0;

		const t = (time - a.time) / Math.max(1e-6, b.time - a.time);
		const left = a.left + (b.left - a.left) * t;
		const right = a.right + (b.right - a.right) * t;
		const closed = Math.min(left, right);
		return Math.min(1, Math.max(0, (closed - BLINK_START) / (BLINK_END - BLINK_START)));
	},
});
