'use strict';

const BUFFERED_BLOCK_SIZE = 4096;
const WEBAUDIO_BLOCK_SIZE = 128;

function FFT(size) {
	this.size = size | 0;
	if (this.size <= 1 || (this.size & (this.size - 1)) !== 0) throw new Error('FFT size must be a power of two and bigger than 1');

	this._csize = size << 1;

	// NOTE: Use of `var` is intentional for old V8 versions
	var table = new Array(this.size * 2);
	for (var i = 0; i < table.length; i += 2) {
		const angle = (Math.PI * i) / this.size;
		table[i] = Math.cos(angle);
		table[i + 1] = -Math.sin(angle);
	}
	this.table = table;

	// Find size's power of two
	var power = 0;
	for (var t = 1; this.size > t; t <<= 1) power++;

	// Calculate initial step's width:
	//   * If we are full radix-4 - it is 2x smaller to give inital len=8
	//   * Otherwise it is the same as `power` to give len=4
	this._width = power % 2 === 0 ? power - 1 : power;

	// Pre-compute bit-reversal patterns
	this._bitrev = new Array(1 << this._width);
	for (var j = 0; j < this._bitrev.length; j++) {
		this._bitrev[j] = 0;
		for (var shift = 0; shift < this._width; shift += 2) {
			var revShift = this._width - shift - 2;
			this._bitrev[j] |= ((j >>> shift) & 3) << revShift;
		}
	}

	this._out = null;
	this._data = null;
	this._inv = 0;
}

FFT.prototype.fromComplexArray = function fromComplexArray(complex, storage) {
	var res = storage || new Array(complex.length >>> 1);
	for (var i = 0; i < complex.length; i += 2) res[i >>> 1] = complex[i];
	return res;
};

FFT.prototype.createComplexArray = function createComplexArray() {
	const res = new Array(this._csize);
	for (var i = 0; i < res.length; i++) res[i] = 0;
	return res;
};

FFT.prototype.toComplexArray = function toComplexArray(input, storage) {
	var res = storage || this.createComplexArray();
	for (var i = 0; i < res.length; i += 2) {
		res[i] = input[i >>> 1];
		res[i + 1] = 0;
	}
	return res;
};

FFT.prototype.completeSpectrum = function completeSpectrum(spectrum) {
	var size = this._csize;
	var half = size >>> 1;
	for (var i = 2; i < half; i += 2) {
		spectrum[size - i] = spectrum[i];
		spectrum[size - i + 1] = -spectrum[i + 1];
	}
};

FFT.prototype.transform = function transform(out, data) {
	if (out === data) throw new Error('Input and output buffers must be different');

	this._out = out;
	this._data = data;
	this._inv = 0;
	this._transform4();
	this._out = null;
	this._data = null;
};

FFT.prototype.realTransform = function realTransform(out, data) {
	if (out === data) throw new Error('Input and output buffers must be different');

	this._out = out;
	this._data = data;
	this._inv = 0;
	this._realTransform4();
	this._out = null;
	this._data = null;
};

FFT.prototype.inverseTransform = function inverseTransform(out, data) {
	if (out === data) throw new Error('Input and output buffers must be different');

	this._out = out;
	this._data = data;
	this._inv = 1;
	this._transform4();
	for (var i = 0; i < out.length; i++) out[i] /= this.size;
	this._out = null;
	this._data = null;
};

// radix-4 implementation
//
// NOTE: Uses of `var` are intentional for older V8 version that do not
// support both `let compound assignments` and `const phi`
FFT.prototype._transform4 = function _transform4() {
	var out = this._out;
	var size = this._csize;

	// Initial step (permute and transform)
	var width = this._width;
	var step = 1 << width;
	var len = (size / step) << 1;

	var outOff;
	var t;
	var bitrev = this._bitrev;
	if (len === 4) {
		for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
			const off = bitrev[t];
			this._singleTransform2(outOff, off, step);
		}
	} else {
		// len === 8
		for (outOff = 0, t = 0; outOff < size; outOff += len, t++) {
			const off = bitrev[t];
			this._singleTransform4(outOff, off, step);
		}
	}

	// Loop through steps in decreasing order
	var inv = this._inv ? -1 : 1;
	var table = this.table;
	for (step >>= 2; step >= 2; step >>= 2) {
		len = (size / step) << 1;
		var quarterLen = len >>> 2;

		// Loop through offsets in the data
		for (outOff = 0; outOff < size; outOff += len) {
			// Full case
			var limit = outOff + quarterLen;
			for (var i = outOff, k = 0; i < limit; i += 2, k += step) {
				const A = i;
				const B = A + quarterLen;
				const C = B + quarterLen;
				const D = C + quarterLen;

				// Original values
				const Ar = out[A];
				const Ai = out[A + 1];
				const Br = out[B];
				const Bi = out[B + 1];
				const Cr = out[C];
				const Ci = out[C + 1];
				const Dr = out[D];
				const Di = out[D + 1];

				// Middle values
				const MAr = Ar;
				const MAi = Ai;

				const tableBr = table[k];
				const tableBi = inv * table[k + 1];
				const MBr = Br * tableBr - Bi * tableBi;
				const MBi = Br * tableBi + Bi * tableBr;

				const tableCr = table[2 * k];
				const tableCi = inv * table[2 * k + 1];
				const MCr = Cr * tableCr - Ci * tableCi;
				const MCi = Cr * tableCi + Ci * tableCr;

				const tableDr = table[3 * k];
				const tableDi = inv * table[3 * k + 1];
				const MDr = Dr * tableDr - Di * tableDi;
				const MDi = Dr * tableDi + Di * tableDr;

				// Pre-Final values
				const T0r = MAr + MCr;
				const T0i = MAi + MCi;
				const T1r = MAr - MCr;
				const T1i = MAi - MCi;
				const T2r = MBr + MDr;
				const T2i = MBi + MDi;
				const T3r = inv * (MBr - MDr);
				const T3i = inv * (MBi - MDi);

				// Final values
				const FAr = T0r + T2r;
				const FAi = T0i + T2i;

				const FCr = T0r - T2r;
				const FCi = T0i - T2i;

				const FBr = T1r + T3i;
				const FBi = T1i - T3r;

				const FDr = T1r - T3i;
				const FDi = T1i + T3r;

				out[A] = FAr;
				out[A + 1] = FAi;
				out[B] = FBr;
				out[B + 1] = FBi;
				out[C] = FCr;
				out[C + 1] = FCi;
				out[D] = FDr;
				out[D + 1] = FDi;
			}
		}
	}
};

// radix-2 implementation
//
// NOTE: Only called for len=4
FFT.prototype._singleTransform2 = function _singleTransform2(outOff, off, step) {
	const out = this._out;
	const data = this._data;

	const evenR = data[off];
	const evenI = data[off + 1];
	const oddR = data[off + step];
	const oddI = data[off + step + 1];

	const leftR = evenR + oddR;
	const leftI = evenI + oddI;
	const rightR = evenR - oddR;
	const rightI = evenI - oddI;

	out[outOff] = leftR;
	out[outOff + 1] = leftI;
	out[outOff + 2] = rightR;
	out[outOff + 3] = rightI;
};

// radix-4
//
// NOTE: Only called for len=8
FFT.prototype._singleTransform4 = function _singleTransform4(outOff, off, step) {
	const out = this._out;
	const data = this._data;
	const inv = this._inv ? -1 : 1;
	const step2 = step * 2;
	const step3 = step * 3;

	// Original values
	const Ar = data[off];
	const Ai = data[off + 1];
	const Br = data[off + step];
	const Bi = data[off + step + 1];
	const Cr = data[off + step2];
	const Ci = data[off + step2 + 1];
	const Dr = data[off + step3];
	const Di = data[off + step3 + 1];

	// Pre-Final values
	const T0r = Ar + Cr;
	const T0i = Ai + Ci;
	const T1r = Ar - Cr;
	const T1i = Ai - Ci;
	const T2r = Br + Dr;
	const T2i = Bi + Di;
	const T3r = inv * (Br - Dr);
	const T3i = inv * (Bi - Di);

	// Final values
	const FAr = T0r + T2r;
	const FAi = T0i + T2i;

	const FBr = T1r + T3i;
	const FBi = T1i - T3r;

	const FCr = T0r - T2r;
	const FCi = T0i - T2i;

	const FDr = T1r - T3i;
	const FDi = T1i + T3r;

	out[outOff] = FAr;
	out[outOff + 1] = FAi;
	out[outOff + 2] = FBr;
	out[outOff + 3] = FBi;
	out[outOff + 4] = FCr;
	out[outOff + 5] = FCi;
	out[outOff + 6] = FDr;
	out[outOff + 7] = FDi;
};

// Real input radix-4 implementation
FFT.prototype._realTransform4 = function _realTransform4() {
	const out = this._out;
	const size = this._csize;
	const bitrev = this._bitrev;
	const table = this.table;
	const inv = this._inv ? -1 : 1;

	// Initial step (permute and transform)
	let width = this._width;
	let step = 1 << width;
	let len = (size / step) << 1;

	// Optimize initial transform based on length
	if (len === 4) {
		for (let outOff = 0, t = 0; outOff < size; outOff += len, t++) {
			const off = bitrev[t];
			this._singleRealTransform2(outOff, off >>> 1, step >>> 1);
		}
	} else {
		for (let outOff = 0, t = 0; outOff < size; outOff += len, t++) {
			const off = bitrev[t];
			this._singleRealTransform4(outOff, off >>> 1, step >>> 1);
		}
	}

	// Loop through steps in decreasing order
	for (step >>= 2; step >= 2; step >>= 2) {
		len = (size / step) << 1;
		const halfLen = len >>> 1;
		const quarterLen = halfLen >>> 1;
		const hquarterLen = quarterLen >>> 1;

		// Loop through offsets in the data
		for (let outOff = 0; outOff < size; outOff += len) {
			for (let i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
				const A = outOff + i;
				const B = A + quarterLen;
				const C = B + quarterLen;
				const D = C + quarterLen;

				// Load values
				const Ar = out[A],
					Ai = out[A + 1];
				const Br = out[B],
					Bi = out[B + 1];
				const Cr = out[C],
					Ci = out[C + 1];
				const Dr = out[D],
					Di = out[D + 1];

				// Table lookups
				const tableBr = table[k],
					tableBi = inv * table[k + 1];
				const tableCr = table[k << 1],
					tableCi = inv * table[(k << 1) + 1];
				const tableDr = table[k * 3],
					tableDi = inv * table[k * 3 + 1];

				// Compute middle values
				const MBr = Br * tableBr - Bi * tableBi;
				const MBi = Br * tableBi + Bi * tableBr;
				const MCr = Cr * tableCr - Ci * tableCi;
				const MCi = Cr * tableCi + Ci * tableCr;
				const MDr = Dr * tableDr - Di * tableDi;
				const MDi = Dr * tableDi + Di * tableDr;

				// Pre-final values
				const T0r = Ar + MCr,
					T0i = Ai + MCi;
				const T1r = Ar - MCr,
					T1i = Ai - MCi;
				const T2r = MBr + MDr,
					T2i = MBi + MDi;
				const T3r = inv * (MBr - MDr),
					T3i = inv * (MBi - MDi);

				// Store final values
				out[A] = T0r + T2r;
				out[A + 1] = T0i + T2i;
				out[B] = T1r + T3i;
				out[B + 1] = T1i - T3r;

				// Handle middle point
				if (i === 0) {
					out[C] = T0r - T2r;
					out[C + 1] = T0i - T2i;
					continue;
				}

				if (i === hquarterLen) continue;

				// Compute flipped case
				const SA = outOff + quarterLen - i;
				const SB = outOff + halfLen - i;

				const ST0r = T1r,
					ST0i = -T1i;
				const ST1r = T0r,
					ST1i = -T0i;
				const ST2r = -inv * T3i,
					ST2i = -inv * T3r;
				const ST3r = -inv * T2i,
					ST3i = -inv * T2r;

				out[SA] = ST0r + ST2r;
				out[SA + 1] = ST0i + ST2i;
				out[SB] = ST1r + ST3i;
				out[SB + 1] = ST1i - ST3r;
			}
		}
	}
};

// radix-2 implementation
//
// NOTE: Only called for len=4
FFT.prototype._singleRealTransform2 = function _singleRealTransform2(outOff, off, step) {
	const out = this._out;
	const data = this._data;

	const evenR = data[off];
	const oddR = data[off + step];

	const leftR = evenR + oddR;
	const rightR = evenR - oddR;

	out[outOff] = leftR;
	out[outOff + 1] = 0;
	out[outOff + 2] = rightR;
	out[outOff + 3] = 0;
};

// radix-4
//
// NOTE: Only called for len=8
FFT.prototype._singleRealTransform4 = function _singleRealTransform4(outOff, off, step) {
	const out = this._out;
	const data = this._data;
	const inv = this._inv ? -1 : 1;
	const step2 = step * 2;
	const step3 = step * 3;

	// Original values
	const Ar = data[off];
	const Br = data[off + step];
	const Cr = data[off + step2];
	const Dr = data[off + step3];

	// Pre-Final values
	const T0r = Ar + Cr;
	const T1r = Ar - Cr;
	const T2r = Br + Dr;
	const T3r = inv * (Br - Dr);

	// Final values
	const FAr = T0r + T2r;

	const FBr = T1r;
	const FBi = -T3r;

	const FCr = T0r - T2r;

	const FDr = T1r;
	const FDi = T3r;

	out[outOff] = FAr;
	out[outOff + 1] = 0;
	out[outOff + 2] = FBr;
	out[outOff + 3] = FBi;
	out[outOff + 4] = FCr;
	out[outOff + 5] = 0;
	out[outOff + 6] = FDr;
	out[outOff + 7] = FDi;
};

/** Overlap-Add Node */
class OLAProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super(options);

		this.nbInputs = options.numberOfInputs;
		this.nbOutputs = options.numberOfOutputs;

		this.blockSize = options.processorOptions.blockSize;
		// TODO for now, the only support hop size is the size of a web audio block
		this.hopSize = WEBAUDIO_BLOCK_SIZE;

		this.nbOverlaps = this.blockSize / this.hopSize;

		// pre-allocate input buffers (will be reallocated if needed)
		this.inputBuffers = new Array(this.nbInputs);
		this.inputBuffersHead = new Array(this.nbInputs);
		this.inputBuffersToSend = new Array(this.nbInputs);
		// default to 1 channel per input until we know more
		for (var i = 0; i < this.nbInputs; i++) {
			this.allocateInputChannels(i, 1);
		}
		// pre-allocate input buffers (will be reallocated if needed)
		this.outputBuffers = new Array(this.nbOutputs);
		this.outputBuffersToRetrieve = new Array(this.nbOutputs);
		// default to 1 channel per output until we know more
		for (var i = 0; i < this.nbOutputs; i++) {
			this.allocateOutputChannels(i, 1);
		}
	}

	/** Handles dynamic reallocation of input/output channels buffer
     (channel numbers may vary during lifecycle) **/
	reallocateChannelsIfNeeded(inputs, outputs) {
		for (var i = 0; i < this.nbInputs; i++) {
			let nbChannels = inputs[i].length;
			if (nbChannels != this.inputBuffers[i].length) {
				this.allocateInputChannels(i, nbChannels);
			}
		}

		for (var i = 0; i < this.nbOutputs; i++) {
			let nbChannels = outputs[i].length;
			if (nbChannels != this.outputBuffers[i].length) {
				this.allocateOutputChannels(i, nbChannels);
			}
		}
	}

	allocateInputChannels(inputIndex, nbChannels) {
		// allocate input buffers

		this.inputBuffers[inputIndex] = new Array(nbChannels);
		for (var i = 0; i < nbChannels; i++) {
			this.inputBuffers[inputIndex][i] = new Float32Array(this.blockSize + WEBAUDIO_BLOCK_SIZE);
			this.inputBuffers[inputIndex][i].fill(0);
		}

		// allocate input buffers to send and head pointers to copy from
		// (cannot directly send a pointer/subarray because input may be modified)
		this.inputBuffersHead[inputIndex] = new Array(nbChannels);
		this.inputBuffersToSend[inputIndex] = new Array(nbChannels);
		for (var i = 0; i < nbChannels; i++) {
			this.inputBuffersHead[inputIndex][i] = this.inputBuffers[inputIndex][i].subarray(0, this.blockSize);
			this.inputBuffersToSend[inputIndex][i] = new Float32Array(this.blockSize);
		}
	}

	allocateOutputChannels(outputIndex, nbChannels) {
		// allocate output buffers
		this.outputBuffers[outputIndex] = new Array(nbChannels);
		for (var i = 0; i < nbChannels; i++) {
			this.outputBuffers[outputIndex][i] = new Float32Array(this.blockSize);
			this.outputBuffers[outputIndex][i].fill(0);
		}

		// allocate output buffers to retrieve
		// (cannot send a pointer/subarray because new output has to be add to exising output)
		this.outputBuffersToRetrieve[outputIndex] = new Array(nbChannels);
		for (var i = 0; i < nbChannels; i++) {
			this.outputBuffersToRetrieve[outputIndex][i] = new Float32Array(this.blockSize);
			this.outputBuffersToRetrieve[outputIndex][i].fill(0);
		}
	}

	/** Read next web audio block to input buffers **/
	readInputs(inputs) {
		// when playback is paused, we may stop receiving new samples
		if (inputs[0].length && inputs[0][0].length == 0) {
			for (var i = 0; i < this.nbInputs; i++) {
				for (var j = 0; j < this.inputBuffers[i].length; j++) {
					this.inputBuffers[i][j].fill(0, this.blockSize);
				}
			}
			return;
		}

		for (var i = 0; i < this.nbInputs; i++) {
			for (var j = 0; j < this.inputBuffers[i].length; j++) {
				let webAudioBlock = inputs[i][j];
				this.inputBuffers[i][j].set(webAudioBlock, this.blockSize);
			}
		}
	}

	/** Write next web audio block from output buffers **/
	writeOutputs(outputs) {
		for (var i = 0; i < this.nbInputs; i++) {
			for (var j = 0; j < this.inputBuffers[i].length; j++) {
				let webAudioBlock = this.outputBuffers[i][j].subarray(0, WEBAUDIO_BLOCK_SIZE);
				outputs[i][j].set(webAudioBlock);
			}
		}
	}

	/** Shift left content of input buffers to receive new web audio block **/
	shiftInputBuffers() {
		for (var i = 0; i < this.nbInputs; i++) {
			for (var j = 0; j < this.inputBuffers[i].length; j++) {
				this.inputBuffers[i][j].copyWithin(0, WEBAUDIO_BLOCK_SIZE);
			}
		}
	}

	/** Shift left content of output buffers to receive new web audio block **/
	shiftOutputBuffers() {
		for (var i = 0; i < this.nbOutputs; i++) {
			for (var j = 0; j < this.outputBuffers[i].length; j++) {
				this.outputBuffers[i][j].copyWithin(0, WEBAUDIO_BLOCK_SIZE);
				this.outputBuffers[i][j].subarray(this.blockSize - WEBAUDIO_BLOCK_SIZE).fill(0);
			}
		}
	}

	/** Copy contents of input buffers to buffer actually sent to process **/
	prepareInputBuffersToSend() {
		for (var i = 0; i < this.nbInputs; i++) {
			for (var j = 0; j < this.inputBuffers[i].length; j++) {
				this.inputBuffersToSend[i][j].set(this.inputBuffersHead[i][j]);
			}
		}
	}

	/** Add contents of output buffers just processed to output buffers **/
	handleOutputBuffersToRetrieve() {
		for (var i = 0; i < this.nbOutputs; i++) {
			for (var j = 0; j < this.outputBuffers[i].length; j++) {
				for (var k = 0; k < this.blockSize; k++) {
					this.outputBuffers[i][j][k] += this.outputBuffersToRetrieve[i][j][k] / this.nbOverlaps;
				}
			}
		}
	}

	process(inputs, outputs, params) {
		this.reallocateChannelsIfNeeded(inputs, outputs);

		this.readInputs(inputs);
		this.shiftInputBuffers();
		this.prepareInputBuffersToSend();
		this.processOLA(this.inputBuffersToSend, this.outputBuffersToRetrieve, params);
		this.handleOutputBuffersToRetrieve();
		this.writeOutputs(outputs);
		this.shiftOutputBuffers();

		return true;
	}

	processOLA(inputs, outputs, params) {
		console.assert(false, 'Not overriden');
	}
}

function genHannWindow(length) {
	let win = new Float32Array(length);
	for (var i = 0; i < length; i++) {
		win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
	}
	return win;
}

class PhaseVocoderProcessor extends OLAProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: 'pitchFactor',
				defaultValue: 1.0,
			},
		];
	}

	constructor(options) {
		options.processorOptions = {
			blockSize: BUFFERED_BLOCK_SIZE,
		};
		super(options);

		this.fftSize = this.blockSize;
		this.timeCursor = 0;

		// Pre-calculate Hann window
		this.hannWindow = genHannWindow(this.blockSize);

		// Pre-allocate reusable arrays
		this.fft = new FFT(this.fftSize);
		this.freqComplexBuffer = this.fft.createComplexArray();
		this.freqComplexBufferShifted = this.fft.createComplexArray();
		this.timeComplexBuffer = this.fft.createComplexArray();
		this.magnitudes = new Float32Array(this.fftSize / 2 + 1);
		this.peakIndexes = new Int32Array(this.magnitudes.length);
		this.nbPeaks = 0;

		// Pre-calculate constants
		this.TWO_PI = 2 * Math.PI;
		this.INV_FFT_SIZE = 1 / this.fftSize;
	}

	processOLA(inputs, outputs, parameters) {
		const pitchFactor = parameters.pitchFactor[parameters.pitchFactor.length - 1];

		// Fast path for no pitch shift
		if (Math.abs(pitchFactor - 1.0) < 0.001) {
			for (let i = 0; i < this.nbInputs; i++) {
				for (let j = 0; j < inputs[i].length; j++) {
					outputs[i][j].set(inputs[i][j]);
				}
			}
			this.timeCursor += this.hopSize;
			return;
		}

		const volumeCompensation = 4.0;

		for (let i = 0; i < this.nbInputs; i++) {
			for (let j = 0; j < inputs[i].length; j++) {
				const input = inputs[i][j];
				const output = outputs[i][j];

				this.applyHannWindow(input);
				this.fft.realTransform(this.freqComplexBuffer, input);
				this.computeMagnitudes();
				this.findPeaks();
				this.shiftPeaks(pitchFactor);

				// Batch multiply for volume compensation
				const len = this.freqComplexBufferShifted.length;
				for (let k = 0; k < len; k += 4) {
					this.freqComplexBufferShifted[k] *= volumeCompensation;
					this.freqComplexBufferShifted[k + 1] *= volumeCompensation;
					this.freqComplexBufferShifted[k + 2] *= volumeCompensation;
					this.freqComplexBufferShifted[k + 3] *= volumeCompensation;
				}

				this.fft.completeSpectrum(this.freqComplexBufferShifted);
				this.fft.inverseTransform(this.timeComplexBuffer, this.freqComplexBufferShifted);
				this.fft.fromComplexArray(this.timeComplexBuffer, output);
				this.applyHannWindow(output);
			}
		}

		this.timeCursor += this.hopSize;
	}

	applyHannWindow(input) {
		const len = this.blockSize;
		for (let i = 0; i < len; i += 4) {
			input[i] *= this.hannWindow[i];
			input[i + 1] *= this.hannWindow[i + 1];
			input[i + 2] *= this.hannWindow[i + 2];
			input[i + 3] *= this.hannWindow[i + 3];
		}
	}

	computeMagnitudes() {
		let i = 0,
			j = 0;
		const len = this.magnitudes.length;
		while (i < len) {
			const real = this.freqComplexBuffer[j];
			const imag = this.freqComplexBuffer[j + 1];
			this.magnitudes[i] = real * real + imag * imag;
			i++;
			j += 2;
		}
	}

	findPeaks() {
		this.nbPeaks = 0;
		let i = 2;
		const end = this.magnitudes.length - 2;

		while (i < end) {
			const mag = this.magnitudes[i];
			if (
				this.magnitudes[i - 1] >= mag ||
				this.magnitudes[i - 2] >= mag ||
				this.magnitudes[i + 1] >= mag ||
				this.magnitudes[i + 2] >= mag
			) {
				i++;
				continue;
			}

			this.peakIndexes[this.nbPeaks++] = i;
			i += 2;
		}
	}

	shiftPeaks(pitchFactor) {
		this.freqComplexBufferShifted.fill(0);

		const windowSizeMultiplier = Math.min(2, Math.max(1, 1 / pitchFactor));
		const maxFreqIndex = this.magnitudes.length - 1;

		for (let i = 0; i < this.nbPeaks; i++) {
			const peakIndex = this.peakIndexes[i];
			const peakIndexShifted = Math.round(peakIndex * pitchFactor);

			if (peakIndexShifted >= maxFreqIndex) continue;

			// Calculate window parameters
			const freqRatio = peakIndex / maxFreqIndex;
			const baseWidth = Math.floor(64 * windowSizeMultiplier);
			const maxWidth = Math.max(8, Math.floor(baseWidth * Math.pow(1 - freqRatio, 0.7)));
			const halfWidth = maxWidth >> 1;

			const startIndex = Math.max(0, peakIndex - halfWidth);
			const endIndex = Math.min(this.fftSize, peakIndex + halfWidth);

			// Pre-calculate phase shift values
			const omegaDelta = this.TWO_PI * (peakIndexShifted - peakIndex) * this.INV_FFT_SIZE;
			const phaseShiftReal = Math.cos(omegaDelta * this.timeCursor);
			const phaseShiftImag = Math.sin(omegaDelta * this.timeCursor);

			// Calculate amplitude scaling once
			let amplitudeScale = 1.0;
			const freqPos = peakIndexShifted / maxFreqIndex;
			if (freqPos > 0.4) {
				amplitudeScale *= Math.pow(1 - (freqPos - 0.4) / 0.6, 1.5);
			}
			amplitudeScale *= pitchFactor > 1 ? Math.pow(1 / pitchFactor, 0.6) : Math.pow(pitchFactor, 0.3);

			for (let binIndex = startIndex; binIndex < endIndex; binIndex++) {
				const binIndexShifted = Math.round(binIndex * pitchFactor);
				if (binIndexShifted >= maxFreqIndex || binIndexShifted < 0) continue;

				const indexReal = binIndex << 1;
				const indexShiftedReal = binIndexShifted << 1;

				const valueReal = this.freqComplexBuffer[indexReal] * amplitudeScale;
				const valueImag = this.freqComplexBuffer[indexReal + 1] * amplitudeScale;

				this.freqComplexBufferShifted[indexShiftedReal] += valueReal * phaseShiftReal - valueImag * phaseShiftImag;
				this.freqComplexBufferShifted[indexShiftedReal + 1] += valueReal * phaseShiftImag + valueImag * phaseShiftReal;
			}
		}
	}
}

registerProcessor('phase-vocoder-processor', PhaseVocoderProcessor);
