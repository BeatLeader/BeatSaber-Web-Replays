// Zero-phase smoothing for replay movements: a Gaussian-weighted average of the interpolated signal at evenly
// spaced times around the playback time. It looks ahead as much as behind, so smoothed sabers and gaze don't
// lag behind the notes, and with a zero window it's plain interpolation.

const MAX_TAP_SPACING = 0.004;
const kernels = new Map();

export function getSmoothingKernel(window) {
	window = window > 0 ? window : 0;
	let kernel = kernels.get(window);
	if (kernel) return kernel;

	const half = Math.ceil(window / 2 / MAX_TAP_SPACING);
	const offsets = [];
	const weights = [];
	let sum = 0;
	for (let i = -half; i <= half; i++) {
		const offset = half ? (i / half) * (window / 2) : 0;
		const weight = half ? Math.exp(-0.5 * Math.pow(offset / (window / 4), 2)) : 1;
		offsets.push(offset);
		weights.push(weight);
		sum += weight;
	}
	kernel = {offsets, weights: weights.map(weight => weight / sum)};
	kernels.set(window, kernel);
	return kernel;
}

export function smoothingWindow(milliseconds) {
	const value = parseFloat(milliseconds);
	return value > 0 ? value / 1000 : 0;
}

export function findTimeIndex(items, time, hint) {
	let index = hint >= 0 && hint < items.length ? hint : 0;
	while (index + 1 < items.length && items[index + 1].time <= time) index++;
	while (index > 0 && items[index].time > time) index--;
	return index;
}

export class PoseAverage {
	constructor() {
		this.position = new THREE.Vector3();
		this.rotation = new THREE.Quaternion();
		this.weight = 0;
	}

	reset() {
		this.position.set(0, 0, 0);
		this.rotation.set(0, 0, 0, 0);
		this.weight = 0;
	}

	add(position, rotation, weight) {
		const r = this.rotation;
		const sign = this.weight > 0 && r.x * rotation.x + r.y * rotation.y + r.z * rotation.z + r.w * rotation.w < 0 ? -weight : weight;
		this.position.x += position.x * weight;
		this.position.y += position.y * weight;
		this.position.z += position.z * weight;
		r.set(r.x + rotation.x * sign, r.y + rotation.y * sign, r.z + rotation.z * sign, r.w + rotation.w * sign);
		this.weight += weight;
	}

	finish() {
		if (this.weight > 0) this.position.multiplyScalar(1 / this.weight);
		this.rotation.normalize();
	}
}
