/* global AFRAME, THREE */

/**
 * §7.1 — Selective BloomPrePass (docs/WebShaderLibrary.design.md, faithful port of
 * docs/decompiled/bloom/BloomPrePass.cs + BloomPrePassRendererSO.cs).
 *
 * Beat Saber's bloom is selective by GEOMETRY, not luminance: each frame, BEFORE the main scene
 * renders (BS `OnPreRender`), it renders ONLY the registered light renderers (our tube/glow/opaque/
 * glass library materials + the sky-gradient background) into a low-res HDR buffer cleared to black,
 * blurs it (the pyramid — added in a later phase), and publishes it as the global `_BloomPrePassTexture`
 * (+ `_CustomFogTextureToScreenRatio`). The environment shaders then sample that buffer at screen UV for
 * the fog ambient (bs-materials `applyBsFog`), and a final MainEffect pass composites it over the frame.
 *
 * Hook: a sentinel mesh at `renderOrder = -100000` whose `onBeforeRender` runs the pre-pass once per
 * frame with the real main camera (the mirror.js precedent — same `setRenderTarget` dance). Guarded so
 * it does NOT re-run for the mirror's virtual camera. Selective rendering uses `camera.layers` — light
 * meshes carry BLOOM_LAYER (set by bs-materials/light-rig/environment-background) alongside layer 0.
 *
 * Phase status: renders + publishes the (currently UNBLURRED) light buffer; the pyramid blur and the
 * MainEffect composite are inserted in following phases.
 */
const BLOOM_LAYER = 10; // must match bs-materials `this.BLOOM_LAYER`

// Fullscreen-quad pass shaders, translated 1:1 from the decompiled Unity PostProcessing pyramid bloom
// (docs/shaderdump/dxbc/Hidden_PostProcessing_Bloom__sub0_pass{0,2,5}_frag.hlsl, the passes
// PyramidBloomRendererSO.cs drives: Downsample13 / UpsampleTent). PlaneBufferGeometry(2,2) spans the
// clip-space quad, so the vertex pass-through writes position.xy directly.
const QUAD_VERTEX = `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}
`;

// DownsampleBox13Tap (Bloom pass 2). 13 taps: inner 2x2 box (weight 0.5 total) + four overlapping outer
// 2x2 boxes of the 3x3 ring (weight 0.125 each) — div = (1/4)*vec2(0.5, 0.125) = (0.125, 0.03125).
const DOWNSAMPLE_FRAGMENT = `
	precision highp float;
	varying vec2 vUv;
	uniform sampler2D uTex;
	uniform vec2 uTexel; // 1 / source size
	void main() {
		vec2 t = uTexel;
		vec4 A = texture2D(uTex, vUv + t * vec2(-1.0, -1.0));
		vec4 B = texture2D(uTex, vUv + t * vec2( 0.0, -1.0));
		vec4 C = texture2D(uTex, vUv + t * vec2( 1.0, -1.0));
		vec4 D = texture2D(uTex, vUv + t * vec2(-0.5, -0.5));
		vec4 E = texture2D(uTex, vUv + t * vec2( 0.5, -0.5));
		vec4 F = texture2D(uTex, vUv + t * vec2(-1.0,  0.0));
		vec4 G = texture2D(uTex, vUv);
		vec4 H = texture2D(uTex, vUv + t * vec2( 1.0,  0.0));
		vec4 I = texture2D(uTex, vUv + t * vec2(-0.5,  0.5));
		vec4 J = texture2D(uTex, vUv + t * vec2( 0.5,  0.5));
		vec4 K = texture2D(uTex, vUv + t * vec2(-1.0,  1.0));
		vec4 L = texture2D(uTex, vUv + t * vec2( 0.0,  1.0));
		vec4 M = texture2D(uTex, vUv + t * vec2( 1.0,  1.0));
		vec4 o = (D + E + I + J) * 0.125;
		o += (A + B + G + F) * 0.03125;
		o += (B + C + H + G) * 0.03125;
		o += (F + G + L + K) * 0.03125;
		o += (G + H + M + L) * 0.03125;
		gl_FragColor = o;
	}
`;

// UpsampleTent (Bloom pass 5): a 9-tap tent of the upsampled source (offsets scaled by _SampleScale)
// combined with this level's down mip (_BloomTex): out = tent(source)*_CombineSrc + bloom*_CombineDst.
const UPSAMPLE_FRAGMENT = `
	precision highp float;
	varying vec2 vUv;
	uniform sampler2D uTex;       // _MainTex (the accumulated higher mip, being upsampled)
	uniform sampler2D uBloomTex;  // _BloomTex (this level's down mip)
	uniform vec2 uTexel;          // 1 / source size
	uniform float uSampleScale;   // _SampleScale
	uniform float uCombineSrc;    // _CombineSrc (intensity)
	uniform float uCombineDst;    // _CombineDst
	void main() {
		vec4 d = uTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0) * uSampleScale;
		vec4 s = texture2D(uTex, vUv - d.xy);
		s += texture2D(uTex, vUv - d.wy) * 2.0;
		s += texture2D(uTex, vUv - d.zy);
		s += texture2D(uTex, vUv + d.zw) * 2.0;
		s += texture2D(uTex, vUv) * 4.0;
		s += texture2D(uTex, vUv + d.xw) * 2.0;
		s += texture2D(uTex, vUv + d.zy);
		s += texture2D(uTex, vUv + d.wy) * 2.0;
		s += texture2D(uTex, vUv + d.xy);
		vec4 tent = s * 0.0625;
		gl_FragColor = tent * uCombineSrc + texture2D(uBloomTex, vUv) * uCombineDst;
	}
`;

// Alpha-weighted bloom PREFILTER (BS PyramidBloomMainEffectSO + Hidden/PostProcessing/Bloom Prefilter4:
// docs/shaderdump/dxbc/Hidden_PostProcessing_Bloom__sub0_pass0_frag.hlsl line `saturate(_AlphaWeights*a)*rgb`).
// The scene's ALPHA channel is BS's bloom mask: light shaders write brightness into alpha, everything
// else writes 0. Masking by saturate(alphaWeights*alpha) BEFORE the blur is what makes the BS screen
// bloom selective (only lights glow) without a luminance threshold and without a separate light pass.
const PREFILTER_FRAGMENT = `
	precision highp float;
	varying vec2 vUv;
	uniform sampler2D uTex;
	uniform float uAlphaWeights;
	void main() {
		vec4 s = texture2D(uTex, vUv);
		gl_FragColor = vec4(s.rgb * clamp(uAlphaWeights * s.a, 0.0, 1.0), s.a);
	}
`;

// MainEffect composite (docs/shaderdump/dxbc/Hidden_MainEffect__sub0_pass0_frag.hlsl + the ACES tonemap
// from Hidden_PostProcessing_Bloom__sub0_pass13_frag.hlsl): add the blurred bloom buffer over the HDR
// scene with a blue-noise dither, scale by intensity, then ACES tone-map HDR→display. (The exact
// 4-tap box-glow alpha-threshold term is a refinement; the additive bloom buffer is the dominant glow.)
const COMPOSITE_FRAGMENT = `
	precision highp float;
	varying vec2 vUv;
	uniform sampler2D uScene;   // the HDR scene render
	uniform sampler2D uBloom;   // the blurred FINAL frame (screen bloom)
	uniform sampler2D uNoise;   // blue-noise dither (tiled)
	uniform vec2 uResolution;
	uniform vec2 uBloomRatio;
	uniform float uBloomIntensity;
	uniform float uIntensity;
	uniform float uExposure;
	uniform float uTonemap;     // 1 = ACES
	uniform float uDebug;       // 1 = show the bloom buffer; 2 = show the alpha bloom-mask (inspection)
	uniform float uLocalGlow;     // MainEffect local self-glow intensity (cb0[2].w): box(alpha)^2 * this
	uniform float uLocalGlowBias; // local self-glow bias/threshold (cb0[3].x)
	uniform float uLocalGlowPx;   // local self-glow 4-tap radius in pixels (cb0[5].xy)
	uniform sampler2D uBloomAvg;       // smallest bloom mip (~average bloom luminance) for auto-exposure
	uniform float uAutoExposure;       // 1 = apply BS bloom auto-exposure
	uniform float uAutoExposureLimit;  // BloomFog autoExposureLimit (clamps the boost to 0.004*limit)
	uniform sampler2D uLightGlow;      // light-only prepass buffer (the constant-width BloomPrePassLine glow)
	uniform float uLightGlowIntensity; // how strongly that glow composites to screen (keeps thin beams visible)
	vec3 aces(vec3 x) {
		return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
	}
	void main() {
		vec4 sceneTap = texture2D(uScene, vUv);
		vec3 scene = sceneTap.rgb;
		vec2 buv = (vUv - 0.5) * uBloomRatio + 0.5;
		vec3 bloom = texture2D(uBloom, buv).rgb;
		// Bloom auto-exposure (BS PyramidBloom final pass): boost the glow inversely to the average bloom
		// luminance, clamped by autoExposureLimit. Lifts sparse/dim light glow in dark scenes WITHOUT
		// brightening the (saturated) surfaces — the reason BS lasers read bright but the stage doesn't blow out.
		if (uAutoExposure > 0.5) {
			float avgLum = dot(texture2D(uBloomAvg, vec2(0.5, 0.5)).rgb, vec3(0.3, 0.59, 0.11));
			bloom *= min(0.1 / sqrt(max(avgLum, 1e-6)), 0.004 * uAutoExposureLimit);
		}
		// uDebug 2 = show the raw scene alpha (BS bloom mask): bright where lights wrote brightness into
		// alpha, black on structure/sky/mirror (which now write 0). 1 = show the selective bloom buffer.
		// uDebug 3 = RAW scene rgb (the material output, BEFORE local-glow/bloom/tone). If lights are
		// white here, the whitening is in the material (white-boost / color); if colored here but white
		// in the final frame, it's the composite (local-glow / bloom). Isolates material vs composite.
		if (uDebug > 2.5) { gl_FragColor = vec4(scene, 1.0); return; }
		if (uDebug > 1.5) { gl_FragColor = vec4(vec3(clamp(sceneTap.a, 0.0, 1.0)), 1.0); return; }
		if (uDebug > 0.5) { gl_FragColor = vec4(bloom, 1.0); return; }
		float n = texture2D(uNoise, vUv * uResolution / 64.0).r;
		// Local self-glow (BS Hidden/MainEffect frag): box-average the scene ALPHA (the bloom mask),
		// square it, scale by uLocalGlow and subtract uLocalGlowBias, then add as a tight white core.
		// This is the alpha-as-brightness self-bloom the per-material uWhiteCore hack was approximating.
		vec2 lg = vec2(uLocalGlowPx) / uResolution;
		float aSum = sceneTap.a
			+ texture2D(uScene, vUv + lg * vec2(-0.5, 0.5)).a
			+ texture2D(uScene, vUv + lg * vec2( 0.5, 0.5)).a
			+ texture2D(uScene, vUv + lg * vec2( 0.0, -0.5)).a;
		// Bound to BS's range: the scene alpha is a^2 in [0,1], but the web port's profile (core+halo)
		// can exceed 1, which inflated aAvg^2 and white-washed the whole light. Clamp so the local glow
		// only ever adds up to uLocalGlow of white at the very brightest core.
		float aAvg = clamp(0.25 * aSum, 0.0, 1.0);
		float localGlow = max(aAvg * aAvg * uLocalGlow - uLocalGlowBias, 0.0);
		float dither = (n - 0.5) * (1.0 / 255.0);
		// Light-only prepass glow (BS BloomPrePassLine buffer): the constant-width laser glow. Compositing
		// it keeps THIN/DISTANT beams visible over the empty background — their physical box body is
		// sub-pixel + fogged-to-black there, so without this they vanish (only the surface fog showed them).
		vec3 lightGlow = texture2D(uLightGlow, vUv).rgb * uLightGlowIntensity;
		vec3 base = scene + vec3(localGlow);
		vec3 c;
		if (uTonemap > 0.5) {
			// Legacy: ACES tone-map the WHOLE composite. NOT BS-faithful — ACES desaturates as values
			// rise, so bright/distant lights wash to white and the bloom is compressed into invisibility.
			// Kept for A/B (bloom-prepass="tonemap: true").
			c = aces((base + bloom * uBloomIntensity + lightGlow + dither) * uExposure);
		} else {
			// BS MainEffect (Hidden/MainEffect frag): SATURATE the scene+local-glow (per-channel clip —
			// hue-preserving, NOT desaturating), then add the bloom glow ON TOP, then a final exposure
			// gain. BS never tone-maps the frame; only the bloom is gamma-toned (UpsampleBoxGamma). This
			// keeps light COLORS at any brightness/distance and lets the bloom read as a visible halo.
			c = (clamp(base, 0.0, 1.0) + bloom * uBloomIntensity + lightGlow + dither) * uExposure;
		}
		gl_FragColor = vec4(c, 1.0);
	}
`;

AFRAME.registerSystem('bloom-prepass', {
	schema: {
		enabled: {default: true},
		resolutionScale: {default: 0.5}, // bloom buffer = half screen res (BS uses a reduced texture)
		// Real BS values (BloomPrePassBloomTextureEffectSO "HD" + PyramidBloomMainEffectSO, decompiled):
		radius: {default: 10.0}, // prepass _radius
		intensity: {default: 0.75}, // prepass _intensity (upsample _CombineSrc)
		composite: {default: true}, // run the MainEffect screen composite
		compositeRadius: {default: 16.0}, // MainEffect _bloomRadius (PyramidBloomMainEffectSO=16) — wide glow spread
		bloomIntensity: {default: 0.6}, // MainEffect _bloomBlendFactor (BS default 1.0; 0.6 conservative, tune up)
		// BS bloom auto-exposure (PyramidBloom final pass): scale the glow by min(0.1/sqrt(avgBloomLum),
		// 0.004*autoExposureLimit). In dark scenes (sparse/dim lights) this boosts the glow several-fold so
		// sparse lasers + fog haze read bright — WITHOUT touching the saturated surfaces (no supernova).
		autoExposure: {default: true},
		autoExposureLimit: {default: 1000.0}, // BloomFog autoExposureLimit (set per-env from lighting.json.fog)
		// Adding the CRISP light-prepass buffer fullscreen re-drew the tubes OVER all scene geometry
		// (no depth) — the "tubes draw over everything like a postprocess" bug. Each tube's visible mesh
		// (box body / thin-tube line / 3-slice sprite) already renders depth-correctly in the MAIN pass,
		// and its soft glow comes from the blurred screen bloom (uBloom). So this crisp fullscreen add is
		// a redundant over-draw — OFF by default. (Set >0 only to A/B the old crisp-beam look.)
		lightGlow: {default: 0.0},
		exposure: {default: 1.0}, // ACES pre-exposure
		// Our scene is HDR (premultiplied-additive lights exceed 1), so it needs a tone-map for display or
		// the bloom blows out. BS bakes ACES into the prepass; we apply it on the composite instead.
		// Composite tone path: false = BS-faithful saturate(scene)+bloom (hue-preserving, default);
		// true = legacy ACES over the whole frame (desaturates bright/distant lights — A/B only).
		tonemap: {default: false},
		debug: {default: false}, // show the published bloom buffer fullscreen instead of compositing (inspection)
		fogDebug: {default: false}, // make the env shaders output the raw fog amount (grayscale) — fog diagnostic
		// Diagnostic isolation toggles (bloom-prepass="fog: false; screenBloom: false"):
		fog: {default: true}, // false = force the per-material BloomFog OFF (un-dim distant lasers, isolate the fog's effect)
		screenBloom: {default: true}, // false = disable the whole-frame (second) pyramid bloom, leaving only the light prepass glow
		blur: {default: true}, // run the pyramid blur (set false to publish the raw light buffer — isolates blur bugs)
		// PyramidBloomMainEffectSO._alphaWeights (BS default 4): the SCREEN bloom is a whole-frame
		// PyramidBloom, but its prefilter weights each pixel by saturate(alphaWeights*sceneAlpha). The
		// scene alpha channel is BS's bloom MASK — light/neon shaders write brightness into alpha,
		// structure/notes write 0 (decompiled Custom_SimpleLit/NoteHD: o0.w = 0). So only lights bloom.
		alphaWeights: {default: 4.0},
		maskDebug: {default: false}, // show the alpha bloom-mask saturate(alphaWeights*alpha) as grayscale
		sceneDebug: {default: false}, // show RAW scene rgb (material output before local-glow/bloom/tone)
		// MainEffect local self-glow (Hidden/MainEffect frag: 4-tap box-avg of the scene ALPHA, squared,
		// * scale - bias, added to the scene). The tight white-hot core the alpha-brightness produces;
		// distinct from the wide pyramid bloom above. Set localGlow:0 to disable (A/B).
		// Subtle white-hot core boost (BS _BaseColorBoost). 1.0 white-washed every lit pixel; the real
		// BS value is small (couldn't recover the serialized SO — tune against in-game). 0.2 = a faint
		// white tip on the brightest cores only; set 0 to disable, raise for hotter cores.
		localGlow: {default: 0.2},
		localGlowBias: {default: 0.0},
		localGlowPx: {default: 1.5}, // tap radius (px) of the 4-tap alpha box
	},

	init: function () {
		this.bsMaterials = null;
		this.target = null;
		this.hdr = false;
		this._probed = false;
		this._inPrepass = false;
		this._size = new THREE.Vector2();
		this._rtW = 0;
		this._rtH = 0;
		this._prevClear = new THREE.Color();
		// 1x1 black fallback bound to the auto-exposure sampler until the screen pyramid exists.
		this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
		this.blackTex.needsUpdate = true;

		// Pre-pass camera: a clone driven from the main camera each frame, restricted to BLOOM_LAYER so
		// `renderer.render(scene, bloomCamera)` draws only the light meshes (+ sky dome).
		this.bloomCamera = new THREE.PerspectiveCamera();
		this.bloomCamera.layers.set(BLOOM_LAYER);
		this.bloomCamera.matrixAutoUpdate = false;

		this.sentinel = this.makeSentinel();
		this.sceneEl.object3D.add(this.sentinel);

		// Settings > Visuals drives the user-facing fog/bloom toggles (legacy on/off is driven by
		// environment-glb via data.enabled, since it must follow the ACTUAL env state, ?env= included).
		this.sceneEl.addEventListener('settingsChanged', evt => {
			const settings = evt.detail && evt.detail.settings;
			if (!settings) {
				return;
			}
			if (settings.environmentFog !== undefined) {
				this.data.fog = !!settings.environmentFog;
			}
			if (settings.environmentBloom !== undefined) {
				this.data.screenBloom = !!settings.environmentBloom;
			}
		});
	},

	/** Invisible degenerate mesh drawn first (renderOrder -100000); its onBeforeRender = BS OnPreRender. */
	makeSentinel: function () {
		const geo = new THREE.BufferGeometry();
		// r95: BufferGeometry uses addAttribute (renamed to setAttribute in r110).
		geo.addAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
		const mat = new THREE.MeshBasicMaterial({depthTest: false, depthWrite: false, colorWrite: false});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = -100000;
		const self = this;
		mesh.onBeforeRender = function (renderer, scene, camera) {
			self.onBeforeMainRender(renderer, scene, camera);
		};
		return mesh;
	},

	/** Probe whether a linear-filterable HDR (half-float) render target is usable; else fall back to 8-bit. */
	probe: function (renderer) {
		this._probed = true;
		this.hdr = false;
		try {
			const ext = renderer.extensions;
			const half = ext.get('OES_texture_half_float');
			const halfLinear = ext.get('OES_texture_half_float_linear');
			// WebGL2 exposes half-float RT + linear natively (no extensions reported the same way).
			const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && renderer.getContext() instanceof WebGL2RenderingContext;
			if (isWebGL2 || (half && halfLinear)) {
				// Confirm the framebuffer is actually complete with a half-float color attachment.
				const probe = new THREE.WebGLRenderTarget(4, 4, {
					type: THREE.HalfFloatType, format: THREE.RGBAFormat,
					minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
					depthBuffer: false, stencilBuffer: false,
				});
				const prev = renderer.getRenderTarget();
				renderer.setRenderTarget(probe);
				const gl = renderer.getContext();
				const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
				renderer.setRenderTarget(prev);
				probe.dispose();
				this.hdr = ok;
			}
		} catch (e) {
			this.hdr = false;
		}
		console.warn(`[bloom-prepass] HDR buffer: ${this.hdr ? 'HalfFloat RGBA' : 'UnsignedByte (clamped fallback)'}`);
	},

	/** Physical drawing-buffer size (CSS size × devicePixelRatio) — render targets must match this, not CSS. */
	physicalSize: function (renderer) {
		const s = renderer.getSize(this._size);
		const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
		const w = (s && s.width !== undefined ? s.width : this._size.x) || 1;
		const h = (s && s.height !== undefined ? s.height : this._size.y) || 1;
		return {w: Math.max(1, Math.floor(w * pr)), h: Math.max(1, Math.floor(h * pr))};
	},

	/** (Re)allocate the light-only render target at the current half-res (physical) screen size. */
	ensureTarget: function (renderer) {
		const p = this.physicalSize(renderer);
		const scale = this.data.resolutionScale;
		const tw = Math.max(1, Math.floor(p.w * scale));
		const th = Math.max(1, Math.floor(p.h * scale));
		if (this.target && tw === this._rtW && th === this._rtH) {
			return;
		}
		if (this.target) {
			this.target.dispose();
		}
		this.target = new THREE.WebGLRenderTarget(tw, th, {
			type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
			format: THREE.RGBAFormat,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: true, // the additive light meshes don't need depth, but the dome/box do
			stencilBuffer: false,
		});
		this._rtW = tw;
		this._rtH = th;
	},

	/** Lazily build the fullscreen-quad infra + the two blur pass materials (once). */
	initBlur: function () {
		if (this.quadScene) {
			return;
		}
		this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.quadMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
		this.quadMesh.frustumCulled = false;
		this.quadScene = new THREE.Scene();
		this.quadScene.add(this.quadMesh);
		this.downMat = new THREE.ShaderMaterial({
			uniforms: {uTex: {value: null}, uTexel: {value: new THREE.Vector2()}},
			vertexShader: QUAD_VERTEX, fragmentShader: DOWNSAMPLE_FRAGMENT, depthTest: false, depthWrite: false,
		});
		this.upMat = new THREE.ShaderMaterial({
			uniforms: {
				uTex: {value: null}, uBloomTex: {value: null}, uTexel: {value: new THREE.Vector2()},
				uSampleScale: {value: 1}, uCombineSrc: {value: 1}, uCombineDst: {value: 1},
			},
			vertexShader: QUAD_VERTEX, fragmentShader: UPSAMPLE_FRAGMENT, depthTest: false, depthWrite: false,
		});
		// Alpha-weighted prefilter (the scene-alpha bloom mask) — applied to sceneRT before the screen
		// bloom pyramid so only light pixels glow (BS PyramidBloomMainEffectSO, Prefilter4 + _alphaWeights).
		this.prefilterMat = new THREE.ShaderMaterial({
			uniforms: {uTex: {value: null}, uAlphaWeights: {value: this.data.alphaWeights}},
			vertexShader: QUAD_VERTEX, fragmentShader: PREFILTER_FRAGMENT, depthTest: false, depthWrite: false,
		});
		this.lightPyr = null; // prepass bloom pyramid (half-res light buffer → fog ambient)
		this.screenPyr = null; // screen bloom pyramid (full-res masked sceneRT → MainEffect composite)
	},

	/** Allocate a single HDR ping target at WxH (reused across frames). */
	makeRT: function (w, h) {
		return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
			type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
			format: THREE.RGBAFormat,
			minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
			depthBuffer: false, stencilBuffer: false,
		});
	},

	/** One fullscreen blit of `material` into `dst`. */
	blit: function (renderer, material, dst) {
		this.quadMesh.material = material;
		renderer.render(this.quadScene, this.quadCamera, dst); // target as 3rd arg (see pre-pass note)
	},

	/** Dispose a pyramid descriptor's render targets. */
	disposePyr: function (p) {
		if (!p) {
			return;
		}
		if (p.publish) { p.publish.dispose(); }
		for (let i = 0; i < p.pyramid.length; i++) {
			if (p.pyramid[i].down) { p.pyramid[i].down.dispose(); }
			if (p.pyramid[i].up) { p.pyramid[i].up.dispose(); }
		}
	},

	/**
	 * Build (and cache under this[slot]) a mip pyramid for a source of size W×H and blur `radius`.
	 * Mirrors PyramidBloomRendererSO: levels = clamp(floor(log2(max(w,h)) + min(radius,10) - 10), 1, 16)
	 * on the half-of-source descriptor (downsampleOnFirstPass); sampleScale = 0.5 + frac. Reused for
	 * both the light prepass buffer (half-res) and the full-res screen bloom.
	 */
	ensurePyr: function (slot, W, H, radius) {
		const cur = this[slot];
		if (cur && cur.W === W && cur.H === H && cur.radius === radius) {
			return cur;
		}
		this.disposePyr(cur);
		const b0w = Math.max(1, W >> 1);
		const b0h = Math.max(1, H >> 1);
		const num = Math.log(Math.max(b0w, b0h)) / Math.LN2 + Math.min(radius, 10) - 10;
		const levels = Math.max(1, Math.min(16, Math.floor(num)));
		const pyramid = [];
		for (let i = 0; i < levels; i++) {
			const lw = Math.max(1, b0w >> i);
			const lh = Math.max(1, b0h >> i);
			pyramid.push({down: this.makeRT(lw, lh), up: i > 0 ? this.makeRT(lw, lh) : null, w: lw, h: lh});
		}
		const p = {W: W, H: H, radius: radius, levels: levels, sampleScale: 0.5 + (num - Math.floor(num)), publish: this.makeRT(W, H), pyramid: pyramid};
		this[slot] = p;
		return p;
	},

	/**
	 * Pyramid blur of `srcRT` (size srcW×srcH) into `p.publish` using pyramid descriptor `p`. Downsample13
	 * chain (each reading the previous level's texel size), then UpsampleTent chain accumulating each down
	 * mip. `intensity` is the upsample _CombineSrc. Returns the blurred RT.
	 */
	blurInto: function (renderer, srcRT, srcW, srcH, p, intensity) {
		const P = p.pyramid;
		const N = P.length;
		let src = srcRT;
		let sw = srcW;
		let sh = srcH;
		for (let i = 0; i < N; i++) {
			this.downMat.uniforms.uTex.value = src.texture;
			this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
			this.blit(renderer, this.downMat, P[i].down);
			src = P[i].down; sw = P[i].w; sh = P[i].h;
		}
		let source = P[N - 1].down;
		let sourceW = P[N - 1].w;
		let sourceH = P[N - 1].h;
		for (let n = N - 2; n >= 0; n--) {
			const dst = n === 0 ? p.publish : P[n].up;
			this.upMat.uniforms.uTex.value = source.texture;
			this.upMat.uniforms.uBloomTex.value = P[n].down.texture;
			this.upMat.uniforms.uTexel.value.set(1 / sourceW, 1 / sourceH);
			this.upMat.uniforms.uSampleScale.value = p.sampleScale;
			this.upMat.uniforms.uCombineSrc.value = intensity;
			this.upMat.uniforms.uCombineDst.value = 1;
			this.blit(renderer, this.upMat, dst);
			source = dst; sourceW = n === 0 ? p.W : P[n].w; sourceH = n === 0 ? p.H : P[n].h;
		}
		return N === 1 ? P[0].down : p.publish;
	},

	/**
	 * BS OnPreRender: render only the light layer into the HDR buffer, then publish it. Runs from the
	 * sentinel's onBeforeRender at the very start of the main scene render, with the real camera.
	 */
	onBeforeMainRender: function (renderer, scene, camera) {
		if (this._inPrepass) {
			return; // re-entrancy guard (our own render() re-traverses the scene)
		}
		if (camera !== this.sceneEl.camera) {
			return; // skip the mirror's virtual-camera scene render
		}
		if (!this.data.enabled) {
			// Release the composite render hook too, so the main scene renders straight to the
			// screen (legacy mode must look exactly like the pre-environment-port web).
			this.composeReady = false;
			return;
		}
		if (!this.bsMaterials) {
			this.bsMaterials = this.sceneEl.systems['bs-materials'];
		}
		if (!this.bsMaterials) {
			return;
		}
		if (!this._probed) {
			this.probe(renderer);
		}
		this.ensureTarget(renderer);
		if (!this.target) {
			return;
		}
		// Diagnostic: force the per-material BloomFog off when data.fog is false (un-dim distant lasers to
		// isolate the fog's contribution). Remember the configured state so toggling back on restores it.
		if (this.bsMaterials.fog.uFogEnabled.value > 0) {
			this._fogWasOn = true;
		}
		if (this._fogWasOn) {
			this.bsMaterials.fog.uFogEnabled.value = this.data.fog ? 1 : 0;
		}

		// Drive the pre-pass camera from the main camera (full world transform + projection; the BS
		// fov-crop via _CustomFogTextureToScreenRatio is skipped — we render the same frustum, ratio 1).
		const cam = this.bloomCamera;
		cam.matrixWorld.copy(camera.matrixWorld);
		cam.matrixWorldInverse.copy(camera.matrixWorldInverse);
		cam.projectionMatrix.copy(camera.projectionMatrix);

		this._inPrepass = true;
		const prevTarget = renderer.getRenderTarget();
		const prevVr = renderer.vr ? renderer.vr.enabled : false;
		const prevShadow = renderer.shadowMap.autoUpdate;
		const prevAlpha = renderer.getClearAlpha();
		this._prevClear.copy(renderer.getClearColor()); // r95: getClearColor() returns the Color directly
		if (renderer.vr) {
			renderer.vr.enabled = false;
		}
		renderer.shadowMap.autoUpdate = false;
		// Periodic diagnostic (logs a few times across the first frames so it captures the post-load count).
		this._diagN = (this._diagN || 0) + 1;
		if (this._diagN % 100 === 1 && (this._diagLogs || 0) < 6) {
			this._diagLogs = (this._diagLogs || 0) + 1;
			let total = 0;
			let onLayer = 0;
			const names = [];
			scene.traverse(o => {
				if (!o.isMesh) { return; }
				total++;
				if (o.layers.test(cam.layers)) {
					onLayer++;
					if (names.length < 8) { names.push((o.userData && o.userData.bsShaderId) || o.name || 'mesh'); }
				}
			});
			console.warn(`[bloom-prepass] frame ${this._diagN}: ${total} meshes, ${onLayer} on bloom layer [${names.join(', ')}]`);
		}

		let published = this.target;
		try {
			renderer.setRenderTarget(this.target);
			renderer.setClearColor(0x000000, 1); // BS clears the light buffer to black
			renderer.clear(true, true, false);
			this.bsMaterials.bloom.uInBloomPrePass.value = 1; // full-bright lights (skip fog) into the buffer
			// Pass the target as the 3rd arg: this fork's render() resets the target to null when it's
			// omitted (it does NOT honor a prior setRenderTarget), so we MUST pass it explicitly.
			renderer.render(scene, cam, this.target);
			this.bsMaterials.bloom.uInBloomPrePass.value = 0;
			// Prepass bloom: blur the light buffer for the SHADERS to sample (fog ambient + neon read).
			if (this.data.blur) {
				this.initBlur();
				const lp = this.ensurePyr('lightPyr', this._rtW, this._rtH, this.data.radius);
				published = this.blurInto(renderer, this.target, this._rtW, this._rtH, lp, this.data.intensity);
			}
		} catch (e) {
			if (!this._renderErr) {
				this._renderErr = true;
				console.error('[bloom-prepass] pre-pass render failed:', e && e.message);
			}
		}
		renderer.setClearColor(this._prevClear, prevAlpha);
		if (renderer.vr) {
			renderer.vr.enabled = prevVr;
		}
		renderer.shadowMap.autoUpdate = prevShadow;
		renderer.setRenderTarget(prevTarget);
		this._inPrepass = false;

		// Publish: every library material references these shared uniform objects (bs-materials.applyBloom).
		const b = this.bsMaterials.bloom;
		b.uBloomTex.value = published.texture;
		b.uBloomTexToScreenRatio.value.set(1, 1);
		b.uBloomEnabled.value = 1;
		this.bsMaterials.fog.uFogDebug.value = this.data.fogDebug ? 1 : 0; // fog diagnostic toggle

		// Install/refresh the MainEffect composite (takes effect from the next main render).
		this.ensureComposite(renderer);
	},

	/**
	 * Lazily build the composite resources (full-res HDR scene target, dither noise, composite material)
	 * and install the render hook that routes the MAIN scene render through sceneRT → MainEffect → screen.
	 * The hook wraps renderer.render once: only the main `(object3D, sceneEl.camera)` render is taken over;
	 * our own pre-pass/blit renders (other camera/scene) pass straight through.
	 */
	ensureComposite: function (renderer) {
		if (!this.data.composite) {
			this.composeReady = false;
			return;
		}
		this.initBlur(); // shares the quad scene/camera
		if (!this.compositeMat) {
			this.compositeMat = new THREE.ShaderMaterial({
				uniforms: {
					uScene: {value: null}, uBloom: {value: null}, uNoise: {value: this.makeNoise()},
					uResolution: {value: new THREE.Vector2(1, 1)}, uBloomRatio: {value: new THREE.Vector2(1, 1)},
					uBloomIntensity: {value: this.data.bloomIntensity}, uIntensity: {value: 1},
					uExposure: {value: this.data.exposure}, uTonemap: {value: this.data.tonemap ? 1 : 0},
					uDebug: {value: 0},
					uLocalGlow: {value: this.data.localGlow}, uLocalGlowBias: {value: this.data.localGlowBias},
					uLocalGlowPx: {value: this.data.localGlowPx},
					uBloomAvg: {value: this.blackTex}, uAutoExposure: {value: this.data.autoExposure ? 1 : 0},
					uAutoExposureLimit: {value: this.data.autoExposureLimit},
					uLightGlow: {value: this.blackTex}, uLightGlowIntensity: {value: this.data.lightGlow},
				},
				vertexShader: QUAD_VERTEX, fragmentShader: COMPOSITE_FRAGMENT, depthTest: false, depthWrite: false,
			});
		}
		// (Re)allocate the full-res (physical) scene target on size change.
		const p = this.physicalSize(renderer);
		const w = p.w;
		const h = p.h;
		if (!this.sceneRT || this._sceneW !== w || this._sceneH !== h) {
			if (this.sceneRT) { this.sceneRT.dispose(); }
			this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
				type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
				format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
				depthBuffer: true, stencilBuffer: false,
			});
			this._sceneW = w;
			this._sceneH = h;
		}
		this.installRenderHook(renderer);
		this.composeReady = true;
	},

	/** 64×64 white-noise dither texture (the ±0.5/255 dither just breaks banding in the HDR→LDR map). */
	makeNoise: function () {
		const n = 64 * 64;
		const data = new Uint8Array(n * 4);
		for (let i = 0; i < n; i++) {
			const v = Math.floor(Math.random() * 256);
			data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
			data[i * 4 + 3] = 255;
		}
		const tex = new THREE.DataTexture(data, 64, 64, THREE.RGBAFormat);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.needsUpdate = true;
		return tex;
	},

	/** Wrap renderer.render once so the main scene render is taken over for the MainEffect composite. */
	installRenderHook: function (renderer) {
		if (this._hooked) {
			return;
		}
		this._hooked = true;
		const self = this;
		const orig = renderer.render.bind(renderer);
		this._origRender = orig;
		renderer.render = function (scene, camera, target, forceClear) {
			const isMain = scene === self.sceneEl.object3D && camera === self.sceneEl.camera;
			if (isMain && self.composeReady && !self._inComposite) {
				// Clear sceneRT explicitly: A-Frame's clear targets the screen, not our redirected target,
				// so envs with no full-screen background (e.g. weave has no sky dome) would smear old frames.
				renderer.setRenderTarget(self.sceneRT);
				renderer.clear(true, true, false);
				orig(scene, camera, self.sceneRT, forceClear); // main scene → HDR sceneRT
				self.composite(renderer);                       // MainEffect → screen
			} else {
				// Honor a prior setRenderTarget() for passthrough callers (e.g. the mirror): this fork's
				// render() resets to null when target is omitted, which would break their render-to-texture.
				const t = target !== undefined ? target : renderer.getRenderTarget();
				orig(scene, camera, t, forceClear);
			}
		};
	},

	/**
	 * Fullscreen MainEffect composite (faithful port of PyramidBloomMainEffectSO): the BS screen bloom is
	 * a WHOLE-FRAME PyramidBloom, but its prefilter is alpha-weighted — the scene's alpha channel is the
	 * bloom MASK (light shaders write brightness into alpha, structure/notes write 0), so only lights
	 * bloom even though the whole frame is blurred. We prefilter sceneRT by saturate(alphaWeights*alpha)
	 * into prefilterRT, blur that, and add it over the (unmasked) scene. This is BS's actual selectivity
	 * mechanism — not a luminance threshold and not a separate light-only pass (that pass exists too, but
	 * it drives the FOG ambient via lightPyr, not this screen composite).
	 */
	composite: function (renderer) {
		const m = this.compositeMat;
		let screenBloom = this.sceneRT;
		if (this.data.blur && this.sceneRT) {
			const sp = this.ensurePyr('screenPyr', this._sceneW, this._sceneH, this.data.compositeRadius);
			// Alpha-weighted prefilter (BS bloom mask): mask sceneRT by saturate(alphaWeights*alpha) so
				// only light pixels bloom, then pyramid-blur the masked buffer (PyramidBloomMainEffectSO).
				if (!this.prefilterRT || this.prefilterRT.width !== this._sceneW || this.prefilterRT.height !== this._sceneH) {
					if (this.prefilterRT) { this.prefilterRT.dispose(); }
					this.prefilterRT = this.makeRT(this._sceneW, this._sceneH);
				}
				this.prefilterMat.uniforms.uTex.value = this.sceneRT.texture;
				this.prefilterMat.uniforms.uAlphaWeights.value = this.data.alphaWeights;
				this.blit(renderer, this.prefilterMat, this.prefilterRT);
				screenBloom = this.blurInto(renderer, this.prefilterRT, this._sceneW, this._sceneH, sp, 1.0);
		}
		m.uniforms.uScene.value = this.sceneRT.texture;
		m.uniforms.uBloom.value = screenBloom.texture;
		m.uniforms.uBloomRatio.value.set(1, 1); // screen bloom covers the full frame (no fov crop)
		m.uniforms.uResolution.value.set(this._sceneW, this._sceneH);
		// screenBloom toggle: the whole-frame (second) pyramid bloom — set 0 to isolate the light prepass.
		m.uniforms.uBloomIntensity.value = this.data.screenBloom ? this.data.bloomIntensity : 0;
		m.uniforms.uExposure.value = this.data.exposure;
		m.uniforms.uTonemap.value = this.data.tonemap ? 1 : 0;
		m.uniforms.uDebug.value = this.data.sceneDebug ? 3 : (this.data.maskDebug ? 2 : (this.data.debug ? 1 : 0));
		m.uniforms.uLocalGlow.value = this.data.localGlow;
		m.uniforms.uLocalGlowBias.value = this.data.localGlowBias;
		m.uniforms.uLocalGlowPx.value = this.data.localGlowPx;
		// Auto-exposure: source the average bloom luminance from the smallest pyramid mip.
		if (this.data.blur && this.screenPyr) {
			const pyr = this.screenPyr.pyramid;
			m.uniforms.uBloomAvg.value = pyr[pyr.length - 1].down.texture;
			m.uniforms.uAutoExposure.value = this.data.autoExposure ? 1 : 0;
		} else {
			m.uniforms.uAutoExposure.value = 0;
		}
		m.uniforms.uAutoExposureLimit.value = this.data.autoExposureLimit;
		// Crisp light-buffer fullscreen add — OFF by default (data.lightGlow=0): it re-drew the tubes over
		// all geometry with no depth. The visible beam is the depth-correct main-pass mesh; the soft halo
		// is the screen bloom above. Wired only so the toggle still works for A/B.
		m.uniforms.uLightGlow.value = (this.target && this.target.texture) || this.blackTex;
		m.uniforms.uLightGlowIntensity.value = this.data.lightGlow;
		this._inComposite = true;
		this.quadMesh.material = m;
		renderer.render(this.quadScene, this.quadCamera, null); // composite to the screen
		this._inComposite = false;
	},

	/** Apply exported bloom params (lighting.json.bloom) — called by light-rig on env load. */
	setBloom: function (bloom) {
		if (!bloom) {
			return;
		}
		if (bloom.radius != null) {
			this.data.radius = bloom.radius;
		}
		if (bloom.intensity != null) {
			this.data.intensity = bloom.intensity;
		}
		if (bloom.bloomIntensity != null) {
			this.data.bloomIntensity = bloom.bloomIntensity;
		}
		if (bloom.exposure != null) {
			this.data.exposure = bloom.exposure;
		}
		// NOTE: the exported bloom.tonemap describes the FOG prepass's final pass (ACES/None), NOT the
		// screen composite. The MainEffect screen composite is gamma (UpsampleBoxGamma), never ACES, so
		// we deliberately do NOT drive data.tonemap from it — the composite stays the BS-faithful
		// saturate path. (Set bloom-prepass="tonemap: true" by hand only for an A/B against legacy ACES.)
		// ensurePyr rebuilds automatically when radius changes (it caches by W/H/radius).
	},
});
