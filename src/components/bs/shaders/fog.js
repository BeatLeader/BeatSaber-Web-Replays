/* global THREE */

/**
 * Shared BloomFog GLSL chunk + per-material uniform factories (docs/WebShaderLibrary.design.md §7.2).
 *
 * Beat Saber runs a custom per-fragment fog inside (nearly) every environment shader — the dominant
 * atmosphere/depth cue and the reason the long background TubeBloomPrePassLight beams fade to faint
 * washes. It is NOT three.js scene fog: a distance + height falloff driven by the global
 * `BloomFogEnvironmentParams` (lighting.json.fog) scaled per material (`_Fog*`).
 *
 * This module is the single home of that chunk so every ported shader (tube line/box, the generic
 * library, etc.) shares the SAME GLSL + the SAME global uniform-object references. The `bs-materials`
 * system owns the global uniform objects (this.fog/this.bloom) and swaps them into each material via
 * `applyFog`/`applyBloom`; the factories here produce a material's own (default) copies before that swap.
 *
 * Decompiled refs: docs/shaderdump/dxbc/Custom_OpaqueNeonLight__sub0_pass0_frag__ENABLE_BLOOM_FOG*.hlsl,
 * docs/decompiled/bloom/{BloomFogEnvironment,BloomFogEnvironmentParams,BloomFogSO}.cs.
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
			// Mode 1 (tube line/box, TransparentNeonLight): ATTENUATE to black; the composite adds the glow.
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
 * Excludes `uResolution` — each material owns/shares that separately.
 */
function makeBloomUniforms() {
	return {
		uBloomTex: {value: null},
		uBloomTexToScreenRatio: {value: new THREE.Vector2(1, 1)},
		uBloomEnabled: {value: 0},
		uInBloomPrePass: {value: 0},
	};
}

/** Fresh per-material uniform objects for the fog terms (globals are swapped for shared refs in `applyFog`). */
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

module.exports = {FOG_VARYINGS, FOG_FRAGMENT, makeFogUniforms, makeBloomUniforms};
