/* global THREE */

/**
 * Custom/TransparentNeonLight — the solid 3D BODY of a tube light (the ParametricBoxController mesh).
 * Faithful port of the decompiled fragment: a box with a UNIFORM cross-section whose brightness varies
 * only along the length.
 *
 * Decompiled frag (docs/shaderdump/dxbc/Custom_TransparentNeonLight__sub0_pass0_frag.hlsl):
 *   a1 = w1*w1;  a3 = w1*a1;  intensity = a3*a3 = w1^6;   o.rgb = saturate(color*intensity + boost…);  o.a = intensity
 * where w1 = the per-vertex alpha interpolated start->end along the box's local Y. So the body brightens
 * as color * intensity^2(=our uIntensity, the rig alpha) * w1^6 (the start->end taper). Cull Front, additive,
 * depthWrite off — a real 3D object, so wide rectangular pylon lights read as 3D (no billboard pinch).
 *
 * docs/decompiled/bloom/ParametricBoxController.cs: box = unit cube scaled to (width, length, width),
 * positioned so heightCenter splits the length; alphaEnd is lerp(start,end) by collision fraction.
 */

const {FOG_VARYINGS, FOG_FRAGMENT, makeFogUniforms, makeBloomUniforms} = require('./fog.js');

const VERTEX_SHADER = `
	precision highp float;
	${FOG_VARYINGS}
	uniform float uYMin;   // tube local-Y start (= -length*center)
	uniform float uLen;
	varying float vAlong;  // 0 at start -> 1 at end
	void main() {
		vAlong = clamp((position.y - uYMin) / max(uLen, 0.0001), 0.0, 1.0);
		vFogDist = length((modelViewMatrix * vec4(position, 1.0)).xyz);
		vWorldY = (modelMatrix * vec4(position, 1.0)).y;
		vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		vScreenUv = clip.xy / clip.w * 0.5 + 0.5;
		gl_Position = clip;
	}
`;

const FRAGMENT_SHADER = `
	precision highp float;
	${FOG_VARYINGS}
	${FOG_FRAGMENT}
	uniform vec3 uColor;
	uniform float uIntensity;
	uniform float uFxAlpha;
	uniform float uAlphaStart;
	uniform float uAlphaEnd;
	uniform float uColorAlphaMul;
	uniform float uBoostToWhite; // _boostToWhite
	varying float vAlong;
	void main() {
		// TransparentNeonLight: r = intensity * w1^3; r *= r -> intensity^2 * w1^6; color * r.
		float w1 = mix(uAlphaStart, uAlphaEnd, vAlong);
		float r = uIntensity * pow(max(w1, 0.0), 3.0);
		r = r * r;
		r *= uColorAlphaMul * uFxAlpha;
		vec3 c = applyBsFog((uColor + vec3(uBoostToWhite)) * r, uIntensity);
		float fogA = uInBloomPrePass > 0.5 ? 1.0 : (1.0 - bsFog(uIntensity));
		gl_FragColor = vec4(c, r * fogA);
	}
`;

let BoxMaterial = null;

function makeClass() {
	class BsTransparentNeonLightMaterial extends THREE.ShaderMaterial {
		constructor() {
			super({
				uniforms: Object.assign(
					{
						uColor: {value: new THREE.Color(0, 0, 0)},
						uIntensity: {value: 1},
						uFxAlpha: {value: 1},
						uAlphaStart: {value: 1},
						uAlphaEnd: {value: 1},
						uColorAlphaMul: {value: 1},
						uYMin: {value: 0},
						uLen: {value: 1},
						uBoostToWhite: {value: 0},
						uResolution: {value: new THREE.Vector2(1, 1)},
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
				side: THREE.FrontSide, // BS Cull Front
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
	return BsTransparentNeonLightMaterial;
}

/** Per-tube box geometry: a world (width × length × width) box spanning the tube's local-Y range. */
function boxGeometry(meta) {
	const len = meta.tubeLength;
	const center = meta.tubeCenter == null ? 0.5 : meta.tubeCenter;
	const w = meta.tubeWidth > 0 ? meta.tubeWidth : 0.5;
	const g = new THREE.BoxBufferGeometry(w, len, w); // r95: BoxBufferGeometry
	g.translate(0, len * (0.5 - center), 0); // span local Y [-len*center, len*(1-center)]
	return g;
}

/** Builds the TransparentNeonLight box-body material for a tube-light meta record. */
function createBox(meta, sys) {
	if (!BoxMaterial) {
		BoxMaterial = makeClass();
	}
	const len = meta.tubeLength;
	const center = meta.tubeCenter == null ? 0.5 : meta.tubeCenter;
	const m = new BoxMaterial();
	m.uniforms.uYMin.value = -len * center;
	m.uniforms.uLen.value = len;
	if (meta.color) {
		m.uniforms.uColor.value.setRGB(meta.color[0], meta.color[1], meta.color[2]);
	}
	m.uniforms.uAlphaStart.value = meta.startAlpha == null ? 1 : meta.startAlpha;
	m.uniforms.uAlphaEnd.value = meta.endAlpha == null ? 1 : meta.endAlpha;
	m.uniforms.uColorAlphaMul.value = meta.colorAlphaMultiplier == null ? 1 : meta.colorAlphaMultiplier;
	m.uniforms.uBoostToWhite.value = meta.boostToWhite == null ? 0 : meta.boostToWhite;
	sys.applyFog(m, 1); // attenuate with distance (HDR-bright; the glow is the screen bloom)
	sys.applyBloom(m);
	m.userData.bsShaderId = 'tube';
	return m;
}

module.exports = {createBox, boxGeometry};
