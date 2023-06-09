import {FFT} from './dsp.js';
import {CBuffer} from './cbuffer.js';

function PhaseVocoder(winSize, sampleRate) {
	var _sampleRate = sampleRate;
	var _Hs = 0;
	var _Ha = 0;
	var _omega;

	var _previousInputPhase;
	var _previousOutputPhase;
	var _framingWindow;

	var _squaredFramingWindow;
	var _winSize = winSize;

	var _overlapBuffers;
	var _owOverlapBuffers;

	var _first = true;

	var _overlapFactor = 4;

	var _lastInputAlpha = 1;

	/*****************************************************/
	/******************* dsp.js FFT **********************/
	/*****************************************************/

	var fft = new FFT(_winSize, sampleRate);
	/*****************************************************/
	/*****************************************************/
	/*****************************************************/

	var sqrt = Math.sqrt;
	var cos = Math.cos;
	var sin = Math.sin;
	var atan2 = Math.atan2;
	var round = Math.round;
	var max = Math.max;
	var ceil = Math.ceil;
	var pow = Math.pow;
	var PI = Math.PI;

	/*****************************************************/
	/***************PRE-ALLOCATE MEMORY*******************/
	/*****************************************************/

	//find_peaks
	var _hlfSize = round(_winSize / 2) + 1;

	// // process
	var _process = {
		fftObj: {
			real: new Float32Array(_hlfSize),
			imag: new Float32Array(_hlfSize),
			magnitude: new Float32Array(_hlfSize),
			phase: new Float32Array(_hlfSize),
		},
		pvOut: {
			real: create_constant_array(_winSize, 0, Float32Array),
			imag: create_constant_array(_winSize, 0, Float32Array),
			magnitude: create_constant_array(_winSize, 0, Float32Array),
			phase: create_constant_array(_winSize, 0, Float32Array),
		},
		processedFrame: new Float32Array(_winSize),
	};

	var _pv_step = {
		instPhaseAdv: new Float32Array(_hlfSize),
		phTh: new Float32Array(_hlfSize),
	};

	var _STFT = {
		_inputFrame: new Float32Array(_winSize),
		_zeros: new Float32Array(_winSize),
	};
	/*****************************************************/
	/*****************************************************/
	/*****************************************************/

	var phTh_idx = 0;
	var twoPI = 2 * PI;
	var expectedPhaseAdv, auxHeterodynedPhaseIncr, heterodynedPhaseIncr, instPhaseAdvPerSampleHop, instPhaseAdv_, prevInstPhaseAdv_;

	function overlap_and_slide(Hs, inF, squaredWinF, oBuf, owOBuf, windowSize, outF) {
		// console.log(outF);
		var owSample,
			oSample = 0;

		for (var i = 0; i < Hs; i++) {
			owSample = owOBuf.shift() || 0;
			oSample = oBuf.shift() || 0;
			outF.push(oSample / (owSample < 10e-3 ? 1 : owSample));
			oBuf.push(0);
			owOBuf.push(0);
		}

		for (var i = 0; i < windowSize; i++) {
			oSample = oBuf.shift();
			oBuf.push(inF[i] + oSample);
			owSample = owOBuf.shift();
			owOBuf.push(squaredWinF[i] + owSample);
		}
	}

	function pv_step(fftObj, prevInPh, prevOutPh, omega, Ha, Hs, out) {
		var currInPh = fftObj.phase;
		var mag = fftObj.magnitude;
		var instPhaseAdv = _pv_step.instPhaseAdv;
		var phTh = _pv_step.phTh;

		var peak, prevPeak, reg, regStart, prevRegEnd, prevRegStart, d, i;
		phTh_idx = 0;

		for (i = 0; i < omega.length; i++) {
			expectedPhaseAdv = omega[i] * Ha;

			auxHeterodynedPhaseIncr = currInPh[i] - prevInPh[i] - expectedPhaseAdv;
			heterodynedPhaseIncr = auxHeterodynedPhaseIncr - twoPI * round(auxHeterodynedPhaseIncr / twoPI);

			instPhaseAdvPerSampleHop = omega[i] + heterodynedPhaseIncr / Ha;

			instPhaseAdv_ = instPhaseAdvPerSampleHop * Hs;

			if (mag[i] > max(mag[i - 2] | 0, mag[i - 1] | 0, mag[i + 1] | 0, mag[i + 2] | 0)) {
				// if (mag[i] > (mag[i-2]|0) && mag[i] > (mag[i-1]|0) && mag[i] > (mag[i+1]|0) && mag[i] > (mag[i+2]|0)) {
				peak = i;
				regStart = ceil((prevPeak + peak) / 2) | 0;
				prevRegEnd = regStart - 1;
				reg = max(0, prevRegEnd - prevRegStart + 1);
				prevRegStart = regStart;
				for (d = 0; d < reg; d++, phTh_idx++) {
					phTh[phTh_idx] = prevOutPh[prevPeak] + prevInstPhaseAdv_ - currInPh[prevPeak];
				}
				prevPeak = peak;
				prevInstPhaseAdv_ = instPhaseAdv_;
			}
		}

		for (var i = 0; i < phTh.length; i++) {
			var theta = phTh[i];

			var phThRe = cos(phTh[i]);
			var phThIm = sin(phTh[i]);

			out.real[i] = phThRe * fftObj.real[i] - phThIm * fftObj.imag[i];
			out.imag[i] = phThRe * fftObj.imag[i] + phThIm * fftObj.real[i];
			out.phase[i] = atan2(out.imag[i], out.real[i]);
		}

		return;
	}

	this.process = function (inputArray, outputArray) {
		var _ = this;

		var __Hs = _Hs;
		var __Ha = _Ha;

		// ----------------------------------
		// ----------ANALYSIS STEP-----------
		// ----------------------------------

		var processedFrame = _process.processedFrame;
		var fftObj = _process.fftObj;
		// FOR SOME REASON, IF I DON'T CREATE A NEW "phase" ARHaY, I GET ARTIFACTS.
		// fftObj.phase = new Float32Array(_hlfSize);
		var pvOut = _process.pvOut;
		_.STFT(inputArray, _framingWindow, _hlfSize, fftObj);
		pv_step(fftObj, _previousInputPhase, _previousOutputPhase, _omega, __Ha, __Hs, pvOut);
		_previousOutputPhase = pvOut.phase;
		// The "phase" issue mentioned above is related to this line.
		// If I create a new Float array using the phase array, I get no issues.
		_previousInputPhase = new Float32Array(fftObj.phase);
		_.ISTFT(pvOut.real, pvOut.imag, _framingWindow, false, processedFrame);

		// ----------------------------------
		// ------OVERLAP AND SLIDE STEP------
		// ----------------------------------
		// var outputFrame = new Array(__Hs);

		overlap_and_slide(__Hs, processedFrame, _squaredFramingWindow, _overlapBuffers, _owOverlapBuffers, _winSize, outputArray);

		return __Hs;
	};

	this.STFT = function (inputFrame, windowFrame, wantedSize, out) {
		this.STFT_drom(inputFrame, windowFrame, wantedSize, out);
	};

	this.STFT_drom = function (inputFrame, windowFrame, wantedSize, out) {
		var winSize = windowFrame.length;
		var _inputFrame = _STFT._inputFrame;

		for (var i = 0; i < winSize; i++) {
			_inputFrame[i] = inputFrame[i] * windowFrame[i];
		}

		fft.forward(_inputFrame);
		out.real = fft.real;
		out.imag = fft.imag;

		var R = out.real;
		var I = out.imag;
		var P = out.phase;
		var M = out.magnitude;

		for (var p = 0; p < winSize && p < wantedSize; p++) {
			M[p] = sqrt(I[p] * I[p] + R[p] * R[p]) * 1000;
			P[p] = atan2(I[p], R[p]);
		}

		return;
	};

	this.ISTFT = function (real, imag, windowFrame, restoreEnergy, timeFrame) {
		this.ISTFT_drom(real, imag, windowFrame, restoreEnergy, timeFrame);
	};

	this.ISTFT_drom = function (real, imag, windowFrame, restoreEnergy, timeFrame) {
		fft.inverse(real, imag, timeFrame);

		return;
	};

	this.init = function () {
		_omega = create_omega_array(winSize);

		this.reset_phases_and_overlap_buffers();

		_framingWindow = create_sin_beta_window_array(winSize, 1);

		_squaredFramingWindow = _framingWindow.map(function (x, i) {
			return x * x;
		});

		this.set_alpha(1);
	};

	function create_omega_array(size) {
		return Array.apply(null, Array(size / 2 + 1)).map(function (x, i) {
			return (twoPI * i) / size;
		});
	}

	function create_sin_beta_window_array(size, beta) {
		return Array.apply(null, Array(size)).map(function (x, i) {
			return pow(sin((PI * i) / size), beta);
		});
	}

	function create_constant_array(size, constant, ArrayType) {
		var arr = new (ArrayType ? ArrayType : Array)(size);
		for (var i = 0; i < size; i++) arr[i] = constant;
		return arr;
	}

	this.reset_phases_and_overlap_buffers = function () {
		_previousInputPhase = create_constant_array(winSize / 2, 0);
		_previousOutputPhase = create_constant_array(winSize / 2, 0);

		_overlapBuffers = new CBuffer(winSize);
		_owOverlapBuffers = new CBuffer(winSize);
		for (var i = 0; i < winSize; i++) {
			_overlapBuffers.push(0);
			_owOverlapBuffers.push(0);
		}

		_first = true;
	};

	this.reset_phases = function () {
		_previousInputPhase = create_constant_array(winSize / 2, 0);
		_previousOutputPhase = create_constant_array(winSize / 2, 0);

		_first = true;
	};

	this.get_previous_input_phase = function () {
		return _previousInputPhase;
	};

	this.get_previous_output_phase = function () {
		return _previousOutputPhase;
	};

	this.get_analysis_hop = function () {
		return _Ha;
	};

	this.get_synthesis_hop = function () {
		return _Hs;
	};

	this.get_alpha = function () {
		return _Hs / _Ha;
	};

	this.get_framing_window = function () {
		return _framingWindow;
	};

	this.get_squared_framing_window = function () {
		return _squaredFramingWindow;
	};

	this.set_alpha = function (newAlpha) {
		_lastInputAlpha = newAlpha;
		if (newAlpha <= 0.8) _overlapFactor = 2;
		else if (newAlpha <= 1) _overlapFactor = 4;
		else _overlapFactor = 5;

		/* "Fixed" synthesis hop size. */
		_Ha = round(_winSize / _overlapFactor);
		_Hs = round(newAlpha * _Ha);

		// _Hs = _Ha;

		// _Hs = round(_winSize/2);
		// _Ha = round(_Hs / newAlpha);
	};

	this.get_alpha_step = function () {
		return 1 / _Ha;
	};

	this.set_hops = function (Ha, Hs) {
		_Ha = Ha;
		_Hs = Hs;
	};

	this.get_specified_alpha = function () {
		return _lastInputAlpha;
	};

	this.set_overlap_factor = function (overlapFactor) {
		_overlapFactor = overlapFactor;
		this.set_alpha(_lastInputAlpha);
	};
}

function BufferedPV(frameSize) {
	var _frameSize = frameSize || 4096;
	var _pvL = new PhaseVocoder(_frameSize, 44100);
	_pvL.init();
	var _pvR = new PhaseVocoder(_frameSize, 44100);
	_pvR.init();
	var _buffer;
	var _position = 0;
	var _newAlpha = 1;

	var _midBufL = new CBuffer(Math.round(_frameSize * 2));
	var _midBufR = new CBuffer(Math.round(_frameSize * 2));

	this.process = function (outputAudioBuffer) {
		if (!_buffer) return;

		var sampleCounter = 0;

		var il = _buffer.getChannelData(0);
		var ir = _buffer.getChannelData(0);
		var ol = outputAudioBuffer.getChannelData(0);
		var or = outputAudioBuffer.getChannelData(1);

		while (_midBufR.size > 0 && sampleCounter < outputAudioBuffer.length) {
			var i = sampleCounter++;
			ol[i] = _midBufL.shift();
			or[i] = _midBufR.shift();
		}

		if (sampleCounter == outputAudioBuffer.length) return;

		do {
			var bufL = il.subarray(_position, _position + _frameSize);
			var bufR = ir.subarray(_position, _position + _frameSize);

			if (_newAlpha != undefined && _newAlpha != _pvL.get_alpha()) {
				_pvL.set_alpha(_newAlpha);
				_pvR.set_alpha(_newAlpha);
				_newAlpha = undefined;
			}

			/* LEFT */
			_pvL.process(bufL, _midBufL);
			_pvR.process(bufR, _midBufR);
			for (var i = sampleCounter; _midBufL.size > 0 && i < outputAudioBuffer.length; i++) {
				ol[i] = _midBufL.shift();
				or[i] = _midBufR.shift();
			}

			sampleCounter += _pvL.get_synthesis_hop();

			_position += _pvL.get_analysis_hop();
		} while (sampleCounter < outputAudioBuffer.length);
	};

	this.set_audio_buffer = function (newBuffer) {
		_buffer = newBuffer;
		_position = 0;
		_newAlpha = 1;
	};

	Object.defineProperties(this, {
		position: {
			get: function () {
				return _position;
			},
			set: function (newPosition) {
				_position = newPosition;
			},
		},
		alpha: {
			get: function () {
				return _pvL.get_alpha();
			},
			set: function (newAlpha) {
				_newAlpha = newAlpha;
			},
		},
	});
}

export function WAAPlayer(audioContext, frameSize, bufferSize) {
	var _audioCtx = audioContext;

	var _node = audioContext.createScriptProcessor(bufferSize, 2);

	var _pv = new BufferedPV(frameSize);

	var _audioBuffer = null;

	var _newAlpha = 1;

	var _newPosition = 0;

	var _canPlay = false;

	_node.onaudioprocess = function (e) {
		// if (_canPlay) {
		_pv.alpha = _newAlpha;

		if (_newPosition != undefined) {
			_pv.position = _newPosition;
			_newPosition = undefined;
		}
		_pv.process(e.outputBuffer);
		// }
	};

	this.play = function () {
		_canPlay = true;
	};

	this.stop = function () {
		_canPlay = false;
	};

	this.setBuffer = function (buffer) {
		_audioBuffer = buffer;
		_pv.set_audio_buffer(buffer);
	};

	this.connect = function (destination) {
		_node.connect(destination);
	};

	this.disconnect = function () {
		_node.disconnect();
	};

	Object.defineProperties(this, {
		position: {
			get: function () {
				return _newPosition || _pv.position;
			},
			set: function (newPosition) {
				_newPosition = newPosition;
			},
		},
		time: {
			get: function () {
				return (_newPosition || _pv.position) / _audioCtx.sampleRate;
			},
			set: function (newTime) {
				_newPosition = newTime * _audioCtx.sampleRate;
			},
		},
		speed: {
			get: function () {
				return _newAlpha || _pv.alpha;
			},
			set: function (newSpeed) {
				_newAlpha = 1 / newSpeed;
			},
		},
		context: {
			get: function () {
				return _audioCtx;
			},
		},
		audioBuffer: {
			get: function () {
				return _audioBuffer;
			},
		},
		node: {
			get: function () {
				return _node;
			},
		},
	});
}
