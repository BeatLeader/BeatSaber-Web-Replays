/* global AFRAME */

/**
 * Audio-reactive spectrogram for exported environments. Two BS paths, one 64-band FFT source
 * (`BasicSpectrogramData`-style ProcessedSamples), reused by both:
 *  - **TransformSpectrogram** (docs/decompiled/spectro/TransformSpectrogram.cs): bar transforms move
 *    along an axis by `lerp(min, max, ProcessedSamples[band])` (extras.spec tags).
 *  - **shader Spectrogram** (`Custom/Spectrogram`, ~20 envs): a vertex-displaced mesh fed
 *    `_SpectrogramData` (the same 64 samples). The material-mapper swaps these meshes to the
 *    `bs-materials` spectrogram material (the faithful displacement shader); here we feed each one
 *    `setSpectrogram(samples)` every frame, matching `Spectrogram._setAsGlobal` (all such materials).
 *
 * Reuses the player's audio (taps the audioanalyser's gainNode with our own AnalyserNode so beat
 * detection is untouched). Collected on `materials-mapped` so the swapped spectrogram materials exist.
 */
AFRAME.registerComponent('env-spectrogram', {
	init: function () {
		this.bars = []; // {o, base, band, axis, min, max}
		this.specMats = []; // swapped shader-spectrogram materials (setSpectrogram each frame)
		this.spectrum = new Float32Array(64);
		this.fft = null; // our own AnalyserNode
		this.freq = null; // Uint8Array
		// Collect after the material swap so the shader-spectrogram materials are in place; the
		// transform-bar nodes (extras.spec) are present regardless. materials-mapped always fires.
		this.el.addEventListener('materials-mapped', () => this.collect());
	},

	collect: function () {
		this.bars = [];
		this.specMats = [];
		const root = this.el.getObject3D('mesh');
		if (!root) {
			return;
		}
		const seen = new Set();
		root.traverse(o => {
			const s = o.userData && o.userData.spec;
			if (s) {
				this.bars.push({o: o, base: o.position.clone(), band: s.band, axis: s.axis, min: s.min, max: s.max});
			}
			if (o.isMesh && o.material) {
				const mats = Array.isArray(o.material) ? o.material : [o.material];
				for (const m of mats) {
					if (m && typeof m.setSpectrogram === 'function' && m.userData && m.userData.bsShaderId === 'spectrogram' && !seen.has(m)) {
						seen.add(m);
						this.specMats.push(m);
					}
				}
			}
		});
		if (this.bars.length || this.specMats.length) {
			console.warn(`[env-spectrogram] driving ${this.bars.length} transform bar(s) + ${this.specMats.length} shader-spectrogram material(s)`);
		}
	},

	// Lazily create our own analyser tapping the shared gainNode (independent of beat detection).
	ensureFft: function () {
		if (this.fft) {
			return true;
		}
		const el = document.getElementById('audioAnalyser');
		const aa = el && el.components && el.components.audioanalyser;
		if (!aa || !aa.context || !aa.gainNode) {
			return false;
		}
		this.fft = aa.context.createAnalyser();
		this.fft.fftSize = 1024; // 512 bins -> 64 bands
		this.fft.smoothingTimeConstant = 0.5;
		aa.gainNode.connect(this.fft);
		this.freq = new Uint8Array(this.fft.frequencyBinCount);
		return true;
	},

	tick: function (time, dt) {
		if ((!this.bars.length && !this.specMats.length) || !this.ensureFft()) {
			return;
		}
		this.computeSpectrum(dt);

		// Transform bars: localPosition += direction * lerp(min, max, sample) (TransformSpectrogram).
		for (let i = 0; i < this.bars.length; i++) {
			const b = this.bars[i];
			const v = this.spectrum[b.band] || 0;
			const p = b.min + (b.max - b.min) * v; // lerp(min, max, t)
			b.o.position.copy(b.base);
			if (b.axis === 0) b.o.position.x = p;
			else if (b.axis === 1) b.o.position.y = p;
			else b.o.position.z = -p; // Z negated to match the GLB coordinate convention
		}

		// Shader spectrogram: feed the 64-band samples into _SpectrogramData (vertex displacement).
		for (let i = 0; i < this.specMats.length; i++) {
			this.specMats[i].setSpectrogram(this.spectrum);
		}
	},

	// Downsample the 512-bin FFT to 64 bands (0..1) with BS-like asymmetric attack/decay smoothing.
	computeSpectrum: function (dt) {
		this.fft.getByteFrequencyData(this.freq);
		const bins = this.freq.length;
		const per = bins / 64;
		const d = Math.min((dt || 16) / 1000, 0.05);
		for (let i = 0; i < 64; i++) {
			const s = Math.floor(i * per);
			const e = Math.floor((i + 1) * per);
			let sum = 0;
			for (let j = s; j < e; j++) {
				sum += this.freq[j];
			}
			const target = sum / Math.max(1, e - s) / 255;
			const cur = this.spectrum[i];
			if (target > cur) {
				this.spectrum[i] = target - cur > 0.1 ? target : cur + (target - cur) * d * 8;
			} else {
				this.spectrum[i] = cur + (target - cur) * d * 4;
			}
		}
	},
});
