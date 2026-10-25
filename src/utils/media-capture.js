// Captures what WebAudio receives from an <audio> element, to find in the decoded song where it really plays.

const PROCESSOR = `
class MediaCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.pending = null;
		this.port.onmessage = ({data}) => (this.pending = {samples: new Float32Array(data.length), filled: 0, frame: null});
	}

	process(inputs) {
		const pending = this.pending;
		const input = inputs[0];
		if (pending && input.length) {
			const left = input[0];
			const right = input[1] || left;
			if (pending.frame === null) pending.frame = currentFrame;
			const count = Math.min(left.length, pending.samples.length - pending.filled);
			for (let i = 0; i < count; i++) pending.samples[pending.filled + i] = (left[i] + right[i]) / 2;
			pending.filled += count;
			if (pending.filled === pending.samples.length) {
				this.port.postMessage({frame: pending.frame, samples: pending.samples}, [pending.samples.buffer]);
				this.pending = null;
			}
		}
		return true;
	}
}
registerProcessor('media-capture', MediaCaptureProcessor);
`;

const COARSE = 16;
const CAPTURE_TIMEOUT = 2000;

const processors = new WeakMap();

function loadProcessor(context) {
	if (!processors.has(context)) {
		const url = URL.createObjectURL(new Blob([PROCESSOR], {type: 'application/javascript'}));
		processors.set(context, context.audioWorklet.addModule(url));
	}
	return processors.get(context);
}

class MediaCapture {
	constructor(context, input) {
		this.context = context;
		this.input = input;
	}

	async capture(length) {
		if (!this.node) {
			await loadProcessor(this.context);
			this.node = new AudioWorkletNode(this.context, 'media-capture', {outputChannelCount: [1]});
			this.input.connect(this.node);
			// The output stays silent, it only keeps the node processing.
			this.node.connect(this.context.destination);
		}
		return new Promise(resolve => {
			const timeout = setTimeout(() => resolve(null), CAPTURE_TIMEOUT);
			this.node.port.onmessage = ({data}) => {
				clearTimeout(timeout);
				resolve({time: data.frame / this.context.sampleRate, samples: data.samples});
			};
			this.node.port.postMessage({length});
		});
	}
}

function average(samples, factor) {
	const out = new Float32Array(Math.floor(samples.length / factor));
	for (let i = 0; i < out.length; i++) {
		let sum = 0;
		for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
		out[i] = sum / factor;
	}
	return out;
}

function bestLag(reference, probe, from, to) {
	const probeNorm = Math.sqrt(probe.reduce((sum, value) => sum + value * value, 0));
	let best = {lag: from, match: -Infinity};
	for (let lag = from; lag <= to; lag++) {
		let dot = 0;
		let energy = 0;
		for (let i = 0; i < probe.length; i++) {
			const value = reference[lag + i];
			dot += value * probe[i];
			energy += value * value;
		}
		const match = dot / (Math.sqrt(energy) * probeNorm + 1e-9);
		if (match > best.match) best = {lag, match};
	}
	return best;
}

function locate(reference, probe) {
	const coarseReference = average(reference, COARSE);
	const coarseProbe = average(probe, COARSE);
	const coarse = bestLag(coarseReference, coarseProbe, 0, coarseReference.length - coarseProbe.length);
	const from = Math.max(0, (coarse.lag - 1) * COARSE);
	const to = Math.min(reference.length - probe.length, (coarse.lag + 1) * COARSE);
	return bestLag(reference, probe, from, to);
}

module.exports = {MediaCapture, locate};
