/* global THREE */

/**
 * Custom/BloomPrePassLine — the screen-space line a TubeBloomPrePassLight draws into the bloom prepass
 * (TubeBloomPrePassLight.FillMeshData). A faithful port of the decompiled shader + mesh generation.
 *
 * FillMeshData projects the tube's two local-Y endpoints ([-length*center, +length*(1-center)]) to clip
 * space and builds a quad whose width is a CONSTANT number of SCREEN PIXELS (lineWidth × _lightWidthMultiplier
 * × per-end width taper) — so the laser keeps a constant on-screen thickness at any distance/angle. The
 * vertex color carries (boostedRGB, gamma(alpha)) per end (start/end taper).
 *
 * Decompiled frag (docs/shaderdump/dxbc/Custom_BloomPrePassLine__sub0_pass0_{vert,frag}.hlsl):
 *   vert: o.rgb = sRGBToLinear(vColor.rgb);  o.a = vColor.a            (rgb gamma->linear; alpha passthrough)
 *   frag: tex = sample(uv);  o.rgb = (vColor.rgb*tex.rgb) * (vColor.a^2 * tex.a);  o.a = vColor.a^2 * tex.a
 * _MainTex defaults to "white" -> tex = 1 -> a SOLID band across the width (NO per-fragment core/halo). The
 * soft glow is the bloom-prepass blur, not a cross-section profile — so the invented uHalo/uWhiteCore/uCapSize
 * core terms are gone. Our rig color is already linear (Unity float colors), so no extra linearization; the
 * vColor.a^2 brightness = gamma(intensity)^2 (≈ intensity^0.91), matching FillMeshData's LinearToGammaSpace.
 *
 * Additive (premultiplied: ONE/ONE), depthWrite off, double-sided. The fog chunk attenuates distant beams.
 */

const {FOG_VARYINGS, FOG_FRAGMENT, makeFogUniforms, makeBloomUniforms} = require('./fog.js');

const VERTEX_SHADER = `
	precision highp float;
	attribute float aEndpoint;   // 0 = from-point (start), 1 = to-point (end)
	attribute float aSide;       // -1 / +1 across the width
	uniform vec3 uFrom;
	uniform vec3 uTo;
	uniform float uWidth;        // base half-width in pixels (constant on-screen width)
	uniform float uLightWidthMultiplier; // TubeBloomPrePassLight _lightWidthMultiplier (screen-width scale)
	uniform float uStartWidth;   // per-end width taper (_startWidth/_endWidth)
	uniform float uEndWidth;
	uniform vec2 uResolution;
	${FOG_VARYINGS}
	varying float vAlong;        // 0 at start -> 1 at end (length taper)
	void main() {
		vec4 clipA = projectionMatrix * modelViewMatrix * vec4(uFrom, 1.0);
		vec4 clipB = projectionMatrix * modelViewMatrix * vec4(uTo, 1.0);
		// Near-plane line clip (port of FillMeshData frustum clip): slide an endpoint that's behind the
		// near plane ALONG the line to the near plane rather than culling the whole quad (so wide-sweeping
		// rotating lasers with one end behind the camera still draw their visible part). Both behind -> discard.
		vec3 pFrom = uFrom;
		vec3 pTo = uTo;
		float NEAR_W = 0.02;
		if (clipA.w < NEAR_W && clipB.w < NEAR_W) {
			gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
			return;
		}
		if (clipA.w < NEAR_W) {
			float t = (NEAR_W - clipA.w) / (clipB.w - clipA.w);
			clipA = mix(clipA, clipB, t);
			pFrom = mix(uFrom, uTo, t);
		} else if (clipB.w < NEAR_W) {
			float t = (NEAR_W - clipB.w) / (clipA.w - clipB.w);
			clipB = mix(clipB, clipA, t);
			pTo = mix(uTo, uFrom, t);
		}
		vec4 clip = mix(clipA, clipB, aEndpoint);
		// Fog terms from this vertex's (clipped) endpoint along the beam.
		vec3 fogPoint = mix(pFrom, pTo, aEndpoint);
		vFogDist = length((modelViewMatrix * vec4(fogPoint, 1.0)).xyz);
		vWorldY = (modelMatrix * vec4(fogPoint, 1.0)).y;
		// Screen-space (pixel) line direction from the FIXED endpoints — same perpendicular for all 4 verts,
		// so the quad is a proper rectangle (per-vertex this->other would flip and pinch it to a bowtie).
		vec2 sFrom = (clipA.xy / clipA.w) * 0.5 * uResolution;
		vec2 sTo = (clipB.xy / clipB.w) * 0.5 * uResolution;
		vec2 d = sTo - sFrom;
		float l = length(d);
		vec2 dir = l > 0.0 ? d / l : vec2(1.0, 0.0);
		vec2 perp = vec2(-dir.y, dir.x);
		float widthMul = mix(uStartWidth, uEndWidth, aEndpoint);
		vec2 offsetPx = perp * (aSide * uWidth * widthMul * uLightWidthMultiplier);
		clip.xy += (offsetPx / (0.5 * uResolution)) * clip.w; // back to clip (×w so perspective divide restores px)
		vScreenUv = clip.xy / clip.w * 0.5 + 0.5;
		gl_Position = clip;
		vAlong = aEndpoint;
	}
`;

const FRAGMENT_SHADER = `
	precision highp float;
	${FOG_VARYINGS}
	${FOG_FRAGMENT}
	uniform vec3 uColor;
	uniform float uIntensity;
	uniform float uFxAlpha;
	uniform float uAlphaStart;   // _startAlpha / _endAlpha length taper
	uniform float uAlphaEnd;
	uniform float uColorAlphaMul; // _colorAlphaMultiplier
	uniform float uBoostToWhite;  // _boostToWhite: flat per-channel white offset (FillMeshData num18 = _color.r + boost)
	varying float vAlong;
	void main() {
		// BloomPrePassLine frag with _MainTex = white: o.rgb = vColor.rgb * vColor.a^2; o.a = vColor.a^2.
		// vColor.a (per end) = startAlpha->endAlpha taper * gamma(intensity); the frag squares it.
		float taper = mix(uAlphaStart, uAlphaEnd, vAlong);
		taper *= taper;                                  // vColor.a^2 over the length (start->end)
		float gi = pow(max(uIntensity, 0.0), 1.0 / 2.2); // LinearToGammaSpace(intensity)
		float i2 = gi * gi;                              // gamma(intensity)^2 (the prepass brightness)
		float m = taper * uColorAlphaMul * uFxAlpha;
		vec3 c = (uColor + vec3(uBoostToWhite)) * i2 * m; // uniform across the width (solid band)
		c = applyBsFog(c, uIntensity);                   // distant beams fade with distance
		float fogA = uInBloomPrePass > 0.5 ? 1.0 : (1.0 - bsFog(uIntensity));
		gl_FragColor = vec4(c, i2 * m * fogA);           // premultiplied additive
	}
`;

let LineMaterial = null;
let sharedGeometry = null;

function makeClass() {
	class BsBloomPrePassLineMaterial extends THREE.ShaderMaterial {
		constructor(resolutionUniform) {
			super({
				uniforms: Object.assign(
					{
						uFrom: {value: new THREE.Vector3()},
						uTo: {value: new THREE.Vector3()},
						uColor: {value: new THREE.Color(0, 0, 0)},
						uIntensity: {value: 1},
						uFxAlpha: {value: 1},
						uWidth: {value: 6.0}, // base half-width in px — tunable
						uLightWidthMultiplier: {value: 1},
						uStartWidth: {value: 1},
						uEndWidth: {value: 1},
						uAlphaStart: {value: 1},
						uAlphaEnd: {value: 1},
						uColorAlphaMul: {value: 1},
						uBoostToWhite: {value: 0},
						uResolution: resolutionUniform || {value: new THREE.Vector2(1, 1)},
					},
					makeFogUniforms(),
					makeBloomUniforms()
				),
				vertexShader: VERTEX_SHADER,
				fragmentShader: FRAGMENT_SHADER,
				transparent: true,
				blending: THREE.CustomBlending, // premultiplied additive (ONE, ONE)
				blendEquation: THREE.AddEquation,
				blendSrc: THREE.OneFactor,
				blendDst: THREE.OneFactor,
				blendEquationAlpha: THREE.AddEquation,
				blendSrcAlpha: THREE.OneFactor,
				blendDstAlpha: THREE.OneFactor,
				depthWrite: false,
				side: THREE.DoubleSide,
				fog: false,
			});
			this.isBsLibraryMaterial = true;
		}
		setLightColor(r, g, b, intensity) {
			this.uniforms.uColor.value.setRGB(r, g, b);
			this.uniforms.uIntensity.value = intensity === undefined ? 1 : intensity;
		}
		setFxAlpha(value) {
			this.uniforms.uFxAlpha.value = value;
		}
		setDisplacement() {}
		setSpectrogram() {}
	}
	return BsBloomPrePassLineMaterial;
}

/** Shared 4-vert billboard-line quad (endpoint 0/1, side -1/+1). Built once; all lines reuse it. */
function lineGeometry() {
	if (sharedGeometry) {
		return sharedGeometry;
	}
	// THREE r95: BufferGeometry uses addAttribute (renamed to setAttribute in r110).
	const g = new THREE.BufferGeometry();
	g.addAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 3));
	g.addAttribute('aEndpoint', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
	g.addAttribute('aSide', new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
	g.setIndex([0, 1, 2, 2, 1, 3]);
	sharedGeometry = g;
	return g;
}

/**
 * Builds a BloomPrePassLine material for a tube-light meta record. Endpoints are the BS local-Y span
 * [-length*center, length*(1-center)]; seeded with the authored color; the rig recolors via setLightColor.
 * `sys` is the bs-materials system (for the shared resolution uniform + fog/bloom wiring).
 */
function createLine(meta, sys) {
	if (!LineMaterial) {
		LineMaterial = makeClass();
	}
	const len = meta.tubeLength;
	const center = meta.tubeCenter == null ? 0.5 : meta.tubeCenter;
	const m = new LineMaterial(sys.sharedUniforms.uResolution);
	m.uniforms.uFrom.value.set(0, -len * center, 0);
	m.uniforms.uTo.value.set(0, len * (1 - center), 0);
	if (meta.color) {
		m.uniforms.uColor.value.setRGB(meta.color[0], meta.color[1], meta.color[2]);
	}
	m.uniforms.uAlphaStart.value = meta.startAlpha == null ? 1 : meta.startAlpha;
	m.uniforms.uAlphaEnd.value = meta.endAlpha == null ? 1 : meta.endAlpha;
	m.uniforms.uStartWidth.value = meta.startWidth == null ? 1 : meta.startWidth;
	m.uniforms.uEndWidth.value = meta.endWidth == null ? 1 : meta.endWidth;
	m.uniforms.uColorAlphaMul.value = meta.colorAlphaMultiplier == null ? 1 : meta.colorAlphaMultiplier;
	m.uniforms.uLightWidthMultiplier.value = meta.lightWidthMultiplier == null ? 1 : meta.lightWidthMultiplier;
	m.uniforms.uBoostToWhite.value = meta.boostToWhite == null ? 0 : meta.boostToWhite;
	sys.applyFog(m, 1); // attenuate with distance (HDR-bright; the glow is the screen bloom)
	sys.applyBloom(m);
	m.userData.bsShaderId = 'tube';
	return m;
}

module.exports = {createLine, lineGeometry};
