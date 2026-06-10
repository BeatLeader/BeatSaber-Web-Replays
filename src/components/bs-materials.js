/* global AFRAME, THREE */

/**
 * Phase 1 of the web-shader library (docs/WebShaderLibrary.design.md).
 *
 * Beat Saber's environment materials use custom shaders whose compiled GPU bytecode isn't
 * portable, so we hand-author a small fixed set of three.js materials keyed by a stable
 * `shaderId` and classify each exported Unity material into one of them. The shaders here are
 * authored from the decompiled BS HLSL (docs/shaderdump): the neon/tube look is an additive,
 * HDR-emissive `color * intensity` (BS multiplies color by intensity^2 — reproduced via the
 * light-rig passing pre-multiplied color *and* intensity), optionally modulated by a texture.
 *
 * Every library material exposes the §4 contract the runtime drives:
 *   setLightColor(r,g,b,intensity)  — from light-rig (HDR allowed; feeds bloom later)
 *   setFxAlpha(value)               — FloatFx alpha target
 *   setDisplacement(x,y,z)          — FloatFx vertex displacement (approx for now)
 *   setSpectrogram(float[64])       — shader spectrogram (no-op on light materials)
 *
 * Per the design doc's guiding principle, materials write physically-correct HDR emissive from
 * the start; the bloom post-pass that composites that into glow is the final step (added later).
 */

/**
 * BloomFog (docs/WebShaderLibrary.design.md §7.2). Beat Saber applies a custom per-fragment fog
 * inside (nearly) every environment shader — the dominant atmosphere/depth cue and the reason the
 * long background TubeBloomPrePassLight beams (`_length` 500–5000) fade to faint washes instead of
 * staying full-bright. It is NOT three.js scene fog: it's a distance + height falloff driven by the
 * global `BloomFogEnvironmentParams` (`lighting.json.fog`) scaled per material (`_Fog*`), that for
 * additive lights fades the emissive toward black and for opaque surfaces lerps toward the bloom/
 * ambient color (approximated here by `uFogColor` until the §7.1 bloom pre-pass lands).
 *
 * Each library material shares the GLOBAL fog uniforms (uFog*) via the bs-materials system so a
 * single `setFog` updates them all; the per-material scalars (uMat*) are seeded at create time.
 */
const FOG_VARYINGS = `
	varying float vFogDist;  // distance from camera (view space) -> distance fog
	varying float vWorldY;   // world-space Y -> height fog
	varying vec2 vScreenUv;  // clip-space-derived 0..1 screen UV (resolution-independent) -> bloom sample
`;

const FOG_FRAGMENT = `
	uniform float uFogEnabled;
	uniform float uFogAtten;          // _CustomFogAttenuation (per-unit distance falloff rate)
	uniform float uFogOffset;         // _CustomFogOffset
	uniform float uFogHeightStartY;   // _CustomFogHeightFogStartY
	uniform float uFogHeightSize;     // _CustomFogHeightFogHeight
	uniform vec3 uFogColor;           // flat fog/haze color (structure fades toward this; also the legacy tint)
	uniform float uFogMode;           // 0 = lerp toward bloom buffer; 1 = attenuate to black; 2 = lerp toward uFogColor
	uniform float uMatFogScale;       // _FogScale
	uniform float uMatFogStartOffset; // _FogStartOffset
	uniform float uMatHeightFog;      // _EnableHeightFog
	uniform float uMatFogHeightScale; // _FogHeightScale
	uniform float uMatFogHeightOffset;// _FogHeightOffset
	// §7.1 bloom pre-pass buffer (the blurred light/ambient texture BS shaders sample at screen UV).
	uniform sampler2D uBloomTex;
	uniform vec2 uBloomTexToScreenRatio; // _CustomFogTextureToScreenRatio (fov crop)
	uniform float uBloomEnabled;
	uniform float uInBloomPrePass;       // 1 while rendering INTO the bloom buffer: skip fog (full-bright lights)
	uniform float uFogDebug;             // diagnostic: 1 -> output the raw fog amount as grayscale
	uniform vec2 uResolution;            // screen size (px), for the screen-space bloom UV
	// 0 (clear, near) .. 1 (fully fogged, far/below-band). Port of the decompiled BloomFog
	// (docs/shaderdump/dxbc/Custom_OpaqueNeonLight__sub0_pass0_frag__ENABLE_BLOOM_FOG_ENABLE_HEIGHT_FOG.hlsl):
	//   distTerm = max(0, (sqDist - offset)*attenuation / max(1,brightness))   // inverse falloff of SQUARED dist
	//   fogDist  = 1 / (1 + distTerm)
	//   height   = smoothstep((worldY*_FogHeightScale+_FogHeightOffset - startY - height)/height)
	//   fog      = 1 - height*fogDist
	// The distance term uses ONLY the global attenuation/offset — the per-material _FogScale/_FogStartOffset
	// are the WHITE-ADDITIVE params (cb0[4]), NOT distance-fog scaling. Feeding them here exploded the fog
	// (weave's _FogScale=30 / _FogStartOffset=-200 -> fog≈1 everywhere -> flat, no gradient). The
	// /max(1,brightness) is BS's auto-exposure coupling: bright lights fog far less than dim ones.
	float bsFog(float lightIntensity) {
		if (uFogEnabled < 0.5) { return 0.0; }
		float brightness = max(1.0, lightIntensity * lightIntensity);
		float sqDist = vFogDist * vFogDist;
		float distTerm = max(0.0, (sqDist - uFogOffset) * uFogAtten / brightness);
		float fogDist = 1.0 / (1.0 + distTerm);
		float hf = 1.0;
		if (uMatHeightFog > 0.5) {
			float yr = vWorldY * uMatFogHeightScale + uMatFogHeightOffset;
			float t = clamp((yr - uFogHeightStartY - uFogHeightSize) / max(uFogHeightSize, 1e-4), 0.0, 1.0);
			hf = t * t * (3.0 - 2.0 * t); // hermite smoothstep (matches ParametricBoxFakeGlow)
		}
		return clamp(1.0 - hf * fogDist, 0.0, 1.0);
	}
	// Screen-space UV into the bloom pre-pass buffer (BS samples it at the fragment's projected position,
	// cropped by the texture/screen fov ratio). vScreenUv is derived from clip space in the vertex shader,
	// so it's correct regardless of devicePixelRatio (gl_FragCoord/uResolution would mismatch under DPR>1).
	vec2 bsBloomUv() {
		return (vScreenUv - 0.5) * uBloomTexToScreenRatio + 0.5;
	}
	vec3 applyBsFog(vec3 c, float lightIntensity) {
		// While rendering INTO the bloom pre-pass buffer, emit the light full-bright (no fog) — the buffer
		// IS what the main pass fades toward, so fogging here would feed back and decay it to black.
		if (uInBloomPrePass > 0.5) { return c; }
		float fog = bsFog(lightIntensity);
		if (uFogDebug > 0.5) { return vec3(fog); } // diagnostic: show the raw fog amount (grayscale)
		if (uBloomEnabled > 0.5) {
			// Mode 2 (structure): fade toward a FLAT haze color. Solid surfaces must NOT sample the
			// screen-space bloom buffer — that shows the lights at their screen positions with no depth,
			// so a wall in front of a laser would mirror the laser's glow (the "mirrory"/"draws over" bug).
			if (uFogMode > 1.5) { return mix(c, uFogColor, fog); }
			// Mode 1 (tube beam/box, TransparentNeonLight): ATTENUATE to black; the composite adds the glow.
			if (uFogMode > 0.5) { return c * (1.0 - fog); }
			// Mode 0 (glow/opaque/glass, Glowing/OpaqueNeonLight): lerp toward the bloom buffer (emissive
			// lights dissolving into their own luminous haze — fine, they have no solid surface to mirror).
			vec3 ambient = texture2D(uBloomTex, bsBloomUv()).rgb;
			return mix(c, ambient, fog);
		}
		// Legacy stub (bloom pipeline off / un-re-exported env): fade toward the flat fog tint.
		return mix(c, uFogColor, fog);
	}
`;

/**
 * Fresh per-material bloom-buffer uniform objects (swapped for the system's shared refs in `applyBloom`).
 * Excludes `uResolution` — each material owns/shares that separately (beams already get a shared one).
 */
function makeBloomUniforms() {
	return {
		uBloomTex: {value: null},
		uBloomTexToScreenRatio: {value: new THREE.Vector2(1, 1)},
		uBloomEnabled: {value: 0},
		uInBloomPrePass: {value: 0},
	};
}

/** Fresh per-material uniform objects for the fog terms (globals are swapped for shared refs in `create`). */
function makeFogUniforms() {
	return {
		uFogEnabled: {value: 0},
		uFogAtten: {value: 0},
		uFogOffset: {value: 0},
		uFogHeightStartY: {value: -300},
		uFogHeightSize: {value: 10},
		uFogColor: {value: new THREE.Color(0, 0, 0)},
		uFogMode: {value: 0},
		uFogDebug: {value: 0},
		uMatFogScale: {value: 1},
		uMatFogStartOffset: {value: 0},
		uMatHeightFog: {value: 0},
		uMatFogHeightScale: {value: 1},
		uMatFogHeightOffset: {value: 0},
	};
}

const VERTEX_SHADER = `
	varying vec2 vUv;
	${FOG_VARYINGS}
	uniform vec3 uDisplace;
	void main() {
		vUv = uv;
		// FloatFx vertex displacement (_DisplacementAxisMultiplier). Approximate object-space
		// offset for now; the faithful per-axis range mapping is a later phase.
		vec3 transformed = position + uDisplace;
		vec4 viewPos = modelViewMatrix * vec4(transformed, 1.0);
		vFogDist = length(viewPos.xyz);
		vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
		vec4 clip = projectionMatrix * viewPos;
		vScreenUv = clip.xy / clip.w * 0.5 + 0.5;
		gl_Position = clip;
	}
`;

const FRAGMENT_SHADER = `
	precision mediump float;
	varying vec2 vUv;
	${FOG_VARYINGS}
	${FOG_FRAGMENT}
	uniform vec3 uColor;       // light color (already alpha-pre-multiplied by the rig)
	uniform float uIntensity;  // brightness; with pre-multiplied color this yields color*a^2 (BS-faithful)
	uniform float uFxAlpha;    // FloatFx alpha multiplier
	uniform float uOpacity;    // base opacity (glass/transparent); 1 for opaque/additive
	uniform sampler2D uTex;
	uniform float uHasTex;
	uniform float uGlowFalloff; // 1 for sprite/quad glows -> soft round glow instead of a hard square
	uniform float uHalo;        // baked-bloom halo strength
	uniform float uWhiteCore;   // baked-bloom white-hot center
	uniform float uWhiteBoost;  // §7.3 _WhiteBoost*: shift the lit color toward white as intensity rises
	uniform float uBloomMaskAlpha; // 1 = write brightness^2 bloom mask to alpha (additive/opaque lights); 0 = blend alpha (glass)
	void main() {
		vec3 c = uColor * uIntensity * uFxAlpha;
		// White-boost (BS _WhiteBoostType, gated). OpaqueNeonLight adds a STEEP additive term to every
		// channel: saturate(color*a^2 + a^4*boost). a^4 means only the brightest core whitens while hue
		// is preserved everywhere else. (Previously a LINEAR mix toward the peak channel — that washed
		// every lit light fully white near intensity 1, the "all lights equally white" bug.)
		// uWhiteBoost = _WhiteBoostMultiplier when _WhiteBoostType != None, else 0.
		c += vec3(pow(uIntensity, 4.0) * uWhiteBoost * uFxAlpha);
		if (uHasTex > 0.5) {
			c *= texture2D(uTex, vUv).rgb;
		}
		float profile = 1.0; // glow coverage shape (1 for non-sprite families); mask alpha computed below
		if (uGlowFalloff > 0.5) {
			float r = length(vUv - vec2(0.5)) * 2.0; // 0 center -> 1 at quad edge
			float t = clamp(1.0 - r, 0.0, 1.0);
			// Baked bloom: tight bright core + wide soft halo + white-hot center.
			float core = pow(t, 4.0);
			float halo = pow(t, 1.2) * uHalo;
			profile = core + halo;
			c = c * profile + vec3(1.0) * core * uWhiteCore * uIntensity * uFxAlpha;
		}
		// Alpha channel = BS bloom mask (OpaqueNeonLight writes o0.w = intensity^2): additive/opaque
		// light families write brightness^2 * coverage so brighter lights bloom more; glass keeps its
		// real blend alpha (uOpacity) because NormalBlending uses it to composite.
		float a = (uBloomMaskAlpha > 0.5)
			? uIntensity * uIntensity * profile * uFxAlpha
			: uOpacity * uFxAlpha * profile;
		// BloomFog (§7.2): fade toward the bloom/ambient buffer (or legacy tint) by distance/height.
		c = applyBsFog(c, uIntensity);
		// BS fogs the bloom-mask ALPHA too (decompiled OpaqueNeonLight: o0.w = a^2 * fogDist). Without
		// this, a light fogged toward black at distance keeps a full mask and stays bright in the bloom /
		// local-glow -> white-out with distance. Fade the alpha by the same fog clarity.
		float fogA = uInBloomPrePass > 0.5 ? 1.0 : (1.0 - bsFog(uIntensity));
		gl_FragColor = vec4(c, a * fogA);
	}
`;

/**
 * Single shader-material implementation behind all light families; the per-family differences
 * (additive vs opaque vs transparent) are render-state, set by the system's `create`. Using one
 * THREE.ShaderMaterial subclass means `.clone()` (via `new this.constructor().copy(this)`) keeps
 * the contract methods and copies render-state + uniforms automatically.
 */
function makeBsMaterialClass() {
	class BsLibraryMaterial extends THREE.ShaderMaterial {
		constructor() {
			super({
				uniforms: Object.assign(
					{
						uColor: {value: new THREE.Color(0, 0, 0)},
						uIntensity: {value: 1},
						uFxAlpha: {value: 1},
						uOpacity: {value: 1},
						uDisplace: {value: new THREE.Vector3(0, 0, 0)},
						uTex: {value: null},
						uHasTex: {value: 0},
						uGlowFalloff: {value: 0},
						uHalo: {value: 0.6}, // baked-bloom halo strength (glow sprites)
						uWhiteCore: {value: 0.0}, // RETIRED: white core now comes from the faithful composite local self-glow (alpha^4)
						uWhiteBoost: {value: 0}, // §7.3 white-boost (driven from materials.json params)
						uBloomMaskAlpha: {value: 0}, // brightness^2 bloom mask vs blend alpha (see fragment)
						uResolution: {value: new THREE.Vector2(1, 1)}, // screen size (shared in applyBloom)
					},
					makeFogUniforms(),
					makeBloomUniforms()
				),
				vertexShader: VERTEX_SHADER,
				fragmentShader: FRAGMENT_SHADER,
				fog: false,
			});
			this.isBsLibraryMaterial = true;
		}

		// ---- §4 material contract ----------------------------------------
		setLightColor(r, g, b, intensity) {
			this.uniforms.uColor.value.setRGB(r, g, b);
			this.uniforms.uIntensity.value = intensity === undefined ? 1 : intensity;
		}
		setFxAlpha(value) {
			this.uniforms.uFxAlpha.value = value;
		}
		setDisplacement(x, y, z) {
			this.uniforms.uDisplace.value.set(x, y, z);
		}
		setSpectrogram(/* arr */) {
			/* no-op: only the spectrogram shader (later phase) consumes this */
		}
	}
	return BsLibraryMaterial;
}

// (Tube light shaders/materials moved to bs/shaders/{bloom-pre-pass-line,transparent-neon-light,
// parametric-3-slice-sprite}.js + the tube component port bs/lights/tube-bloom-pre-pass-light.js.)

AFRAME.registerSystem('bs-materials', {
	init: function () {
		this.BsLibraryMaterial = makeBsMaterialClass();

		// The exported environment uses MeshStandard for structural geometry (`bs/pbr`) and the scene
		// has no other lights, so without this the whole structure renders black. Add a subtle
		// hemisphere + ambient so it reads as dark-but-visible (the BS stage is dark metal). The
		// emissive light materials are unlit ShaderMaterials, so these don't affect the lights.
		const scene = this.sceneEl.object3D;
		// Keep the structure dark/moody (BS is a dark stage); just enough fill so it reads as dark metal,
		// not pure black. Too much fill washes out the contrast vs. the game's near-black structure.
		const hemi = new THREE.HemisphereLight(0x556070, 0x0a0a10, 0.28);
		const ambient = new THREE.AmbientLight(0x202833, 0.16);
		scene.add(hemi);
		scene.add(ambient);

		// One shared resolution uniform, updated each frame, referenced by every tube line material so
		// the screen-space width stays correct on resize. (The tube line geometry is owned by
		// bs/shaders/bloom-pre-pass-line.js now.)
		this.sharedUniforms = {uResolution: {value: new THREE.Vector2(1, 1)}};
		this._size = new THREE.Vector2();

		// Shared GLOBAL BloomFog uniforms (§7.2). Every library material references THESE objects, so
		// `setFog` (called by light-rig from lighting.json.fog) updates the whole scene at once. Fog is
		// OFF until setFog runs, so envs without exported fog data render exactly as before.
		this.fog = {
			uFogEnabled: {value: 0},
			uFogAtten: {value: 0},
			uFogOffset: {value: 0},
			uFogHeightStartY: {value: -300},
			uFogHeightSize: {value: 10},
			uFogDebug: {value: 0}, // diagnostic toggle (set by bloom-prepass `fogDebug`)
			// Dim cool stand-in for the bloom/ambient tint distant lights fade INTO (so they read as a
			// faint haze, not as vanishing). Tunable; overridden by setFog's color arg. Used only while
			// the §7.1 bloom pre-pass is off; once on, opaque surfaces sample the real bloom buffer.
			uFogColor: {value: new THREE.Color(0.03, 0.04, 0.06)},
		};

		// §7.1 selective bloom pre-pass (rendered by the `bloom-prepass` system). Light meshes are tagged
		// onto BLOOM_LAYER (kept alongside layer 0) so the pre-pass camera can render ONLY them. These
		// shared uniforms are the `_BloomPrePassTexture` + `_CustomFogTextureToScreenRatio` analogues;
		// every library material references them, so one publish updates the whole scene. uBloomEnabled
		// stays 0 (legacy fog) until the bloom-prepass system publishes a buffer.
		this.BLOOM_LAYER = 10;
		// 1×1 black so the sampler is always bound (before the pre-pass publishes a real buffer, and
		// whenever bloom is off) — an unbound sampler2D warns/garbage-samples on some drivers.
		const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
		black.needsUpdate = true;
		this.bloom = {
			uBloomTex: {value: black},
			uBloomTexToScreenRatio: {value: new THREE.Vector2(1, 1)},
			uBloomEnabled: {value: 0},
			uInBloomPrePass: {value: 0},
		};
	},

	/** Sets the flat fog/haze color (mode-2 structure fades toward this). Driven from the sky gradient. */
	setFogColor: function (r, g, b) {
		this.fog.uFogColor.value.setRGB(r, g, b);
	},

	/** Tags a mesh onto the bloom layer (keeping layer 0) so the pre-pass renders it. No-op if absent. */
	markBloomLayer: function (mesh) {
		if (mesh && mesh.layers) {
			mesh.layers.enable(this.BLOOM_LAYER);
		}
	},

	/**
	 * Shares the global bloom uniforms (and the screen-resolution uniform) into a freshly-built library
	 * material, mirroring `applyFog`. After this, the `bloom-prepass` system's single publish (setting
	 * `this.bloom.uBloomTex`/ratio/enabled) reaches every material at once.
	 */
	applyBloom: function (m) {
		const u = m.uniforms;
		u.uBloomTex = this.bloom.uBloomTex;
		u.uBloomTexToScreenRatio = this.bloom.uBloomTexToScreenRatio;
		u.uBloomEnabled = this.bloom.uBloomEnabled;
		u.uInBloomPrePass = this.bloom.uInBloomPrePass;
		u.uResolution = this.sharedUniforms.uResolution;
	},

	/**
	 * Injects the BloomFog into a baked `MeshStandardMaterial` (the structural `bs/pbr` geometry) via
	 * onBeforeCompile, so the structure recedes into the fog too — BS runs BloomFog in nearly every env
	 * shader, not only the lights. Structure is opaque → it LERPS toward the bloom buffer (like
	 * OpaqueNeonLight). Shares the same global fog/bloom uniforms as the library materials, so a single
	 * setFog/publish drives everything. Idempotent (skips if already injected); skip spectrogram (it
	 * already owns onBeforeCompile for vertex displacement) and library materials.
	 */
	applyFogToStandard: function (material, params) {
		if (!material || material.userData.bsFogInjected) {
			return;
		}
		material.userData.bsFogInjected = true;
		const sys = this;
		const p = params || {};
		material.onBeforeCompile = function (shader) {
			Object.assign(shader.uniforms, makeFogUniforms(), makeBloomUniforms(), {uResolution: {value: new THREE.Vector2(1, 1)}});
			// Share the global fog/bloom uniform objects (so setFog/publish reach the structure too).
			shader.uniforms.uFogEnabled = sys.fog.uFogEnabled;
			shader.uniforms.uFogAtten = sys.fog.uFogAtten;
			shader.uniforms.uFogOffset = sys.fog.uFogOffset;
			shader.uniforms.uFogHeightStartY = sys.fog.uFogHeightStartY;
			shader.uniforms.uFogHeightSize = sys.fog.uFogHeightSize;
			shader.uniforms.uFogColor = sys.fog.uFogColor;
			shader.uniforms.uFogDebug = sys.fog.uFogDebug;
			shader.uniforms.uBloomTex = sys.bloom.uBloomTex;
			shader.uniforms.uBloomTexToScreenRatio = sys.bloom.uBloomTexToScreenRatio;
			shader.uniforms.uBloomEnabled = sys.bloom.uBloomEnabled;
			shader.uniforms.uInBloomPrePass = sys.bloom.uInBloomPrePass;
			shader.uniforms.uResolution = sys.sharedUniforms.uResolution;
			// Structure fades toward the BLOOM BUFFER (the light-only haze), like BS's opaque BloomFog —
			// this is the visible glowing fog. (Was mode 2 = flat dark, which made fog invisible: the
			// light-glow buffer was computed but nothing composited it.) The buffer is light-only, so
			// where no light is on-screen it fades toward black anyway; where a light is, structure picks
			// up its haze — the intended atmosphere, not a hard mirror.
			shader.uniforms.uFogMode.value = 0;
			shader.uniforms.uMatFogScale.value = p._FogScale == null ? 1 : p._FogScale;
			shader.uniforms.uMatFogStartOffset.value = p._FogStartOffset == null ? 0 : p._FogStartOffset;
			shader.uniforms.uMatHeightFog.value = p._EnableHeightFog == null ? 0 : p._EnableHeightFog;
			shader.uniforms.uMatFogHeightScale.value = p._FogHeightScale == null ? 1 : p._FogHeightScale;
			shader.uniforms.uMatFogHeightOffset.value = p._FogHeightOffset == null ? 0 : p._FogHeightOffset;

			// DIAGNOSTIC: confirm the injection targets exist in the RUNNING three.js (vendored bundle may
			// differ from the fork source). If either is false, the fog code isn't wired into this shader.
			const vertTarget = shader.vertexShader.indexOf('#include <project_vertex>') >= 0;
			const fragTarget = shader.fragmentShader.indexOf('gl_FragColor = vec4( outgoingLight, diffuseColor.a );') >= 0;
			if (!sys._fogInjectLogged) {
				sys._fogInjectLogged = true;
				console.warn(`[fog-inject] onBeforeCompile ran for "${material.name}": vertTarget=${vertTarget}, fragTarget=${fragTarget}`);
			}

			shader.vertexShader = FOG_VARYINGS + '\n' + shader.vertexShader.replace(
				'#include <project_vertex>',
				'#include <project_vertex>\n' +
					'\tvFogDist = length(mvPosition.xyz);\n' +
					'\tvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;\n' +
					'\tvScreenUv = gl_Position.xy / gl_Position.w * 0.5 + 0.5;\n'
			);
			shader.fragmentShader = FOG_VARYINGS + '\n' + FOG_FRAGMENT + '\n' + shader.fragmentShader.replace(
				'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
				'gl_FragColor = vec4( outgoingLight, diffuseColor.a );\n' +
					'\tgl_FragColor.rgb = applyBsFog(gl_FragColor.rgb, 1.0);\n' +
					// Alpha = BS bloom mask. Structural geometry is NOT a bloom source (decompiled
					// Custom_SimpleLit writes o0.w = 0), so it must write 0 alpha or the alpha-weighted
					// screen-bloom prefilter (PyramidBloomMainEffectSO) would bloom the whole stage.
					'\tgl_FragColor.a = 0.0;'
			);
		};
		material.needsUpdate = true;
	},

	/**
	 * Applies the GLOBAL fog params (from lighting.json.fog) to the shared fog uniforms; every library
	 * material already references these objects, so this recolours/retunes the fog for all of them.
	 * `color` (optional [r,g,b]) is what opaque surfaces fade toward — the bloom/ambient tint, which is
	 * approximated until the §7.1 bloom pre-pass lands; defaults to black (additive lights just fade out).
	 */
	setFog: function (fog, color) {
		const f = this.fog;
		f.uFogEnabled.value = fog ? 1 : 0;
		console.warn(`[fog] setFog: enabled=${f.uFogEnabled.value}, atten=${fog && fog.attenuation}, offset=${fog && fog.offset}`);
		if (color) {
			f.uFogColor.value.setRGB(color[0], color[1], color[2]);
		}
		if (!fog) {
			return;
		}
		f.uFogAtten.value = fog.attenuation == null ? 0 : fog.attenuation;
		f.uFogOffset.value = fog.offset == null ? 0 : fog.offset;
		f.uFogHeightStartY.value = fog.heightFogStartY == null ? -300 : fog.heightFogStartY;
		f.uFogHeightSize.value = fog.heightFogHeight == null ? 10 : fog.heightFogHeight;
	},

	/**
	 * Wires a freshly-built library material into the fog system: swaps its global fog uniforms for the
	 * shared references and seeds the per-material BloomFog scalars from the material's `params`
	 * (`_FogScale`/`_FogStartOffset`/`_EnableHeightFog`/`_FogHeightScale`/`_FogHeightOffset`).
	 * `mode` picks the blend behaviour (0 = lerp toward bloom buffer, 1 = attenuate to black).
	 */
	applyFog: function (m, mode, params) {
		const u = m.uniforms;
		u.uFogEnabled = this.fog.uFogEnabled;
		u.uFogAtten = this.fog.uFogAtten;
		u.uFogOffset = this.fog.uFogOffset;
		u.uFogHeightStartY = this.fog.uFogHeightStartY;
		u.uFogHeightSize = this.fog.uFogHeightSize;
		u.uFogColor = this.fog.uFogColor;
		u.uFogDebug = this.fog.uFogDebug;
		u.uFogMode.value = mode | 0;
		const p = params || {};
		u.uMatFogScale.value = p._FogScale == null ? 1 : p._FogScale;
		u.uMatFogStartOffset.value = p._FogStartOffset == null ? 0 : p._FogStartOffset;
		u.uMatHeightFog.value = p._EnableHeightFog == null ? 0 : p._EnableHeightFog;
		u.uMatFogHeightScale.value = p._FogHeightScale == null ? 1 : p._FogHeightScale;
		u.uMatFogHeightOffset.value = p._FogHeightOffset == null ? 0 : p._FogHeightOffset;
	},

	// Keep the shared screen resolution current (screen-space line width depends on it).
	tick: function () {
		const r = this.sceneEl && this.sceneEl.renderer;
		if (!r) {
			return;
		}
		// THREE r95's getSize() returns a {width,height} object; newer versions fill a target vector.
		const s = r.getSize(this._size);
		const w = s && s.width !== undefined ? s.width : this._size.x;
		const h = s && s.height !== undefined ? s.height : this._size.y;
		this.sharedUniforms.uResolution.value.set(w, h);
	},

	/**
	 * Maps a material's REAL Unity shader name (exporter `materials.json.shader`, resolved cross-bundle
	 * from `mat.m_Shader`) to the coarse render family this system builds. This is the SOLE material
	 * classifier — the old name-regex (`classify`) and coarse `shaderId` are gone. Returns null for a
	 * shader with no family yet; the caller then keeps the material baked (no guessing).
	 *
	 * The coarse families still drive the current generic materials; the faithful per-shader 1-to-1 ports
	 * (a registry keyed on these exact names) and the glass-vs-opaque-from-TransparentNeonLight nuance
	 * (via material props) come next.
	 */
	shaderFamily: function (shaderName) {
		switch (shaderName) {
			case 'Custom/BloomPrePassLine':
				return 'tube';
			case 'Custom/OpaqueNeonLight':
			case 'Custom/TransparentNeonLight':
				return 'opaque';
			case 'Custom/Glowing':
			case 'Custom/GlowingInstancedHD':
			case 'Custom/GlowingInstancedLW':
			case 'Custom/Glowing Pointer':
			case 'Custom/Parametric3SliceSprite':
			case 'Custom/ParametricBoxFakeGlow':
			case 'Custom/CustomParticles': // LightGlow/SourceGlow sprites — additive glow
				return 'glow';
			case 'Custom/Spectrogram':
			case 'Custom/UnlitSpectrogram':
				return 'spectrogram';
			case 'Custom/Mirror':
				return 'mirror';
			case 'Custom/SimpleLit':
				return 'pbr';
			default:
				return null; // unknown shader -> caller keeps the material baked (no fallback)
		}
	},

	/** Whether a shaderId is one of the light families this system builds materials for. */
	isLight: function (shaderId) {
		return shaderId === 'tube' || shaderId === 'glow' || shaderId === 'glass' || shaderId === 'opaque';
	},

	/**
	 * Maps a light's REAL LightWithId component class (lighting.json `lights[].class`, e.g.
	 * TubeBloomPrePassLightWithId / MaterialLightWithId / InstancedMaterialLightWithId /
	 * SpriteLightWithId) to its behaviour family. Mirrors the exporter's LightMeta classification
	 * (Contains "Tube" / "Material"); the authoritative replacement for the coarse `kind`, which is
	 * kept only as a fallback for envs not yet re-exported. Returns null when no class is present.
	 */
	classFamily: function (className) {
		if (!className) {
			return null;
		}
		if (className.indexOf('Tube') >= 0) {
			return 'tube';
		}
		if (className.indexOf('Material') >= 0) {
			return 'material';
		}
		return 'other';
	},

	/**
	 * Whether a glow material is a camera-facing SPRITE (BS billboards these — EnvLightSpriteGlow /
	 * CircleBloom …). Excludes glows that are NOT billboarded (skybox/world quads, lines). NOTE: bare
	 * `LightGlow` is NOT billboarded — it's a disc fixed to the (rotating) laser-head fixture
	 * (RotationBase > LightSource > LightGlow), so it must inherit the fixture's orientation, not face
	 * the camera (billboarding it left the glow circles parallel to the ground). `LightGlowBillboard`
	 * still billboards (caught by `GlowBillboard`).
	 */
	isBillboardSprite: function (name) {
		if (!name) {
			return false;
		}
		if (/Skybox|Quad|Line|World|NoBillboard/.test(name)) {
			return false;
		}
		return /SpriteGlow|BillboardSpriteGlow|CircleBloom|DiskGlow|Halo|LensFlare|Flare|GlowSprite|GlowBillboard/.test(name);
	},

	/**
	 * Builds a fresh per-mesh library material for `shaderId`, seeding color/texture/side from the
	 * baked source material so it shows something before any light event drives it.
	 */
	create: function (shaderId, src, params) {
		const m = new this.BsLibraryMaterial();

		switch (shaderId) {
			case 'tube':
			case 'glow':
				// Premultiplied additive (ONE, ONE) — the frag outputs color*brightness in rgb, so the
				// blend must not re-apply alpha (same convention as the tube line/box materials).
				m.blending = THREE.CustomBlending;
				m.blendEquation = THREE.AddEquation;
				m.blendSrc = THREE.OneFactor;
				m.blendDst = THREE.OneFactor;
				m.blendEquationAlpha = THREE.AddEquation;
				m.blendSrcAlpha = THREE.OneFactor;
				m.blendDstAlpha = THREE.OneFactor;
				m.transparent = true;
				m.depthWrite = false;
				m.uniforms.uOpacity.value = 1;
				break;
			case 'glass':
				m.blending = THREE.NormalBlending;
				m.transparent = true;
				m.depthWrite = false;
				m.uniforms.uOpacity.value = src && src.opacity != null ? src.opacity : 0.5;
				break;
			case 'opaque':
			default:
				m.blending = THREE.NormalBlending;
				m.transparent = false;
				m.depthWrite = true;
				m.uniforms.uOpacity.value = 1;
				break;
		}

		// Sprite/quad glows get a soft round falloff so they read as glows, not hard squares.
		if (shaderId === 'glow') {
			m.uniforms.uGlowFalloff.value = 1;
		}

		if (src) {
			// Prefer a non-black emissive as the seed (that's the lit color); else the base color.
			const e = src.emissive;
			const seed = e && (e.r || e.g || e.b) ? e : src.color;
			if (seed) {
				m.uniforms.uColor.value.copy(seed);
			}
			if (src.map) {
				m.uniforms.uTex.value = src.map;
				m.uniforms.uHasTex.value = 1;
			}
			if (src.side !== undefined) {
				m.side = src.side;
			}
			m.name = src.name || '';
		}

		// White-boost (§7.3): _WhiteBoostType is a KeywordEnum(None, MainEffect, Always) gate (0/1/2);
		// _WhiteBoostMultiplier (default 1, present only on a few shaders) scales the strength. We can't
		// distinguish MainEffect (boost only while bloom is active) from Always until the §7.1 bloom
		// pre-pass lands, so both gate ON for now — the design sequences white-boost before bloom.
		const p = params || {};
		const wbType = p._WhiteBoostType == null ? 0 : p._WhiteBoostType;
		m.uniforms.uWhiteBoost.value = wbType >= 0.5 ? (p._WhiteBoostMultiplier == null ? 1 : p._WhiteBoostMultiplier) : 0;
		// Alpha = bloom mask for additive/opaque light families (write brightness^2); glass keeps blend alpha.
		m.uniforms.uBloomMaskAlpha.value = shaderId === 'glass' ? 0 : 1;

		// BloomFog: tube/opaque/glass ATTENUATE with distance (mode 1) so they visibly dim into the fog
		// (they're HDR-bright now, so they don't read as faint, and the depth-correct screen bloom glows
		// them — no screen-space mirror). Only glow SPRITES lerp toward the bloom buffer (mode 0): they're
		// small/billboarded, so sampling the screen-space buffer reads as their own glow, not a mirror.
		const mode = shaderId === 'glow' ? 0 : 1;
		this.applyFog(m, mode, p);
		this.applyBloom(m);

		m.userData.bsShaderId = shaderId;
		return m;
	},

	/**
	 * Spectrogram material (`Custom/Spectrogram`). The signature effect is **vertex displacement**:
	 * the decompiled vertex shader pushes each vertex along `_PeakOffset` (object space) by
	 * `(1 - data[band])`, where `band = floor(uv.x * 63)` and the push is scaled by the row's V
	 * coordinate — so the mesh is authored at full height and collapses toward the base when a band
	 * is quiet, rising back on loud bands. Built on `MeshStandardMaterial` (this is `bs/pbr` + the
	 * displacement) so it shares the scene's PBR lighting/fog with the rest of the structure; the
	 * 64-band data is fed each frame via `setSpectrogram` (env-spectrogram). Coordinate note: the
	 * exporter flips V (glTF uv.y = 1 - unityV) and negates Z, so the shader uses `(1 - uv.y)` for the
	 * unity-V factor and the exported `peakOffset` already has Z negated.
	 */
	createSpectrogram: function (src, params) {
		const peak = (params && params.peakOffset) || [0, 0, -8];
		const m = new THREE.MeshStandardMaterial({color: new THREE.Color(0, 0, 0), metalness: 0.3, roughness: 0.6});
		if (src && src.color) {
			m.color.copy(src.color);
		}
		const spectro = new Float32Array(64);
		m.onBeforeCompile = shader => {
			shader.uniforms.uSpectro = {value: spectro};
			shader.uniforms.uPeak = {value: new THREE.Vector3(peak[0], peak[1], peak[2])};
				// Spectrogram is NOT a bloom source (decompiled Custom_Spectrogram frag: o0.w = 0), so
				// write 0 alpha — otherwise the alpha-weighted screen bloom would bloom the whole bar field.
				shader.fragmentShader = shader.fragmentShader.replace(
					'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
					'gl_FragColor = vec4( outgoingLight, diffuseColor.a );\n\tgl_FragColor.a = 0.0;'
				);
			// r95 declares `attribute vec2 uv;` unconditionally in the vertex prefix, so we must NOT
			// redeclare it (just add our uniforms).
			shader.vertexShader =
				'uniform float uSpectro[64];\nuniform vec3 uPeak;\n' +
				shader.vertexShader.replace(
					'#include <begin_vertex>',
					'#include <begin_vertex>\n' +
						'	int _sBand = int(floor(uv.x * 63.0));\n' +
						'	float _sAmp = uSpectro[_sBand];\n' +
						'	transformed -= (1.0 - _sAmp) * uPeak * (1.0 - uv.y);\n'
				);
		};

		// ---- §4 contract: only setSpectrogram is meaningful here ----------------
		m.setSpectrogram = function (arr) {
			for (let i = 0; i < 64; i++) {
				spectro[i] = arr[i] || 0;
			}
		};
		m.setLightColor = function () {};
		m.setFxAlpha = function () {};
		m.setDisplacement = function () {};
		m.userData.bsShaderId = 'spectrogram';
		return m;
	},

	/**
	 * `BloomPrePassBackgroundColorsGradient` — the environment background (the BS `Hidden/SkyGradient`
	 * pass). Faithful port of the decompiled `EvaluateColor`: a 128×1 gradient texture built from the
	 * stops (`{color, startT, exp}`) with piecewise `LerpUnclamped(a, b, pow(localT, exp))`, sampled
	 * by the view ray's vertical angle (`ray.y*0.5+0.5`, so the horizon is the gradient mid-point — the
	 * teal band in bigmirror). Rendered on a camera-centred sky dome (BackSide) behind everything.
	 *
	 * `elements`/`tint` are expected pre-resolved (the `environment-background` component applies the
	 * `FromColorSchemeColors` overrides against the env color scheme before calling this). Color/Y
	 * conventions match the rest of the port: Y is up in both Unity and the exported glTF, so the
	 * vertical mapping needs no flip. BS tone-maps this pass when it runs after the bloom blur; we skip
	 * it (the stops are low-intensity LDR, where the tonemap is ≈ identity).
	 */
	buildGradientTexture: function (elements) {
		const W = 128;
		const data = new Uint8Array(W * 4);
		const stops =
			elements && elements.length
				? elements
				: [{color: [0, 0, 0, 1], startT: 0, exp: 1}]; // degenerate -> black
		// Port of BloomPrePassBackgroundColorsGradient.EvaluateColor.
		const evalColor = t => {
			for (let n = stops.length - 2; n >= 0; n--) {
				const e = stops[n];
				if (t >= (e.startT || 0)) {
					const e2 = stops[n + 1];
					const span = (e2.startT || 0) - (e.startT || 0);
					const f = span > 0 ? Math.pow((t - (e.startT || 0)) / span, e.exp || 1) : 0;
					const a = e.color || [0, 0, 0, 1];
					const b = e2.color || [0, 0, 0, 1];
					return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
				}
			}
			const last = stops[stops.length - 1].color || [0, 0, 0, 1];
			return [last[0], last[1], last[2]];
		};
		for (let i = 0; i < W; i++) {
			const c = evalColor(i / (W - 1));
			data[i * 4 + 0] = Math.max(0, Math.min(255, Math.round(c[0] * 255)));
			data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
			data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(c[2] * 255)));
			data[i * 4 + 3] = 255;
		}
		const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.needsUpdate = true;
		return tex;
	},

	/**
	 * Builds the sky-gradient material for a resolved background `{tintColor:[r,g,b,a], elements:[...]}`.
	 * Per-fragment view direction is taken from the camera currently rendering (`cameraPosition`), so
	 * it stays correct for the mirror's reflection camera too.
	 */
	createSkyGradient: function (bg) {
		const tex = this.buildGradientTexture(bg && bg.elements);
		const tint = (bg && bg.tintColor) || [1, 1, 1, 1];
		const m = new THREE.ShaderMaterial({
			uniforms: {
				uGradient: {value: tex},
				uTint: {value: new THREE.Color(tint[0], tint[1], tint[2])},
			},
			vertexShader: `
				varying vec3 vDir;
				void main() {
					vec4 wp = modelMatrix * vec4(position, 1.0);
					vDir = wp.xyz - cameraPosition;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				precision mediump float;
				varying vec3 vDir;
				uniform sampler2D uGradient;
				uniform vec3 uTint;
				void main() {
					vec3 d = normalize(vDir);
					float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
					vec3 c = texture2D(uGradient, vec2(t, 0.5)).rgb * uTint;
					gl_FragColor = vec4(c, 0.0); // alpha=0: sky is not in the BS MainEffect screen-bloom mask
				}
			`,
			side: THREE.BackSide,
			depthWrite: false,
			depthTest: false,
			fog: false,
		});
		m.userData.bsShaderId = 'sky-gradient';
		return m;
	},
});
