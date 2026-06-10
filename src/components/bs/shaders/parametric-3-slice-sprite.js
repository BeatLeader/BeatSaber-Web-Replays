/* global THREE */

/**
 * Custom/Parametric3SliceSprite — a TubeBloomPrePassLight's BAKED-GLOW fallback (the _dynamic3SliceSprite
 * controller), used when the bloom prepass is OFF (`!_mainEffectPostProcessEnabled || _forceUseBakedGlow`).
 * With bloom on (the normal case) the glow is the prepass blur instead, so this path is rare.
 *
 * Decompiled frag (docs/shaderdump/dxbc/Custom_Parametric3SliceSprite__sub0_pass0_frag.hlsl):
 *   o.rgb = _Color.rgb * (w1^3 * _AlphaEnd * tex.a^2);   o.a = cb0[4].y * (w1^3 * _AlphaEnd * tex.a^2)
 * w1 = the per-vertex alpha (start->end taper). The TEXTURE (tex.a) is the soft glow shape. The exporter
 * now writes the REAL _MainTex sidecar PNG (lighting.json tube `glowTex`); we load + sample it (tex.a^2)
 * when present, and fall back to a procedural soft cross-section × end-cap (_CapUVSize) feather otherwise.
 *
 * docs/decompiled/bloom/Parametric3SliceSpriteController.cs: 8-vert 3-slice stretched sprite (cap/middle/cap),
 * _SizeParams = (width, length, center, width*2), _CapUVSize feather. We flatten that to a single quad with a
 * procedural feather (concise; the controller's exact slicing only matters with the real texture). Additive.
 */

const {FOG_VARYINGS, FOG_FRAGMENT, makeFogUniforms, makeBloomUniforms} = require('./fog.js');

// position.x = side (-1/+1 across the cross-section), position.y = local Y along the laser axis (the
// 3-slice cap rows are pre-extended beyond the body in the geometry). uv = the 3-slice UV (caps 0-0.25
// & 0.75-1, middle 0.25-0.75). The cross-section half-width is applied here (uHalfWidth × start/end
// taper); _EnableYAxisBillboard rotates that cross-section to face the camera around the laser axis.
const VERTEX_SHADER = `
	precision highp float;
	${FOG_VARYINGS}
	uniform float uHalfWidth;
	uniform float uStartWidth;
	uniform float uEndWidth;
	uniform float uBillboard; // 1 = _EnableYAxisBillboard
	uniform float uYMin;      // local-Y of the body start (= -length*center)
	uniform float uLen;
	varying vec2 vSpriteUv;    // 3-slice UV for the texture
	varying float vAlong;      // 0..1 linear along the laser length (alpha taper)
	void main() {
		float side = position.x;
		float localY = position.y;
		vAlong = clamp((localY - uYMin) / max(uLen, 1e-4), 0.0, 1.0);
		float hw = uHalfWidth * mix(uStartWidth, uEndWidth, vAlong);
		vec4 centerMv = modelViewMatrix * vec4(0.0, localY, 0.0, 1.0); // the laser-axis point (view space)
		vec4 mv;
		if (uBillboard > 0.5) {
			// Offset the cross-section perpendicular to BOTH the laser axis and the view ray (view space),
			// so the flat ribbon always faces the camera around the laser's length axis.
			vec3 axisV = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
			vec3 wdir = cross(normalize(axisV), normalize(centerMv.xyz));
			float wl = length(wdir);
			wdir = wl > 1e-4 ? wdir / wl : vec3(1.0, 0.0, 0.0);
			mv = vec4(centerMv.xyz + wdir * (side * hw), 1.0);
		} else {
			mv = modelViewMatrix * vec4(side * hw, localY, 0.0, 1.0);
		}
		vSpriteUv = uv;
		vFogDist = length(mv.xyz);
		vWorldY = (modelMatrix * vec4(0.0, localY, 0.0, 1.0)).y;
		vec4 clip = projectionMatrix * mv;
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
	uniform float uMinAlpha;            // controller minAlpha (brightness floor)
	uniform float uWhiteBoost;          // _WhiteBoostType > 0 (shift bright core toward white)
	uniform float uWhiteBoostMultiplier;
	uniform float uBoostToWhite;
	uniform float uCapSize;   // _CapUVSize end-cap feather
	uniform sampler2D uTex;   // the REAL _MainTex glow shape (exported sidecar PNG)
	uniform float uHasTex;    // 1 when uTex is loaded
	varying vec2 vSpriteUv;
	varying float vAlong;
	void main() {
		// w1 = start->end alpha taper along the LENGTH (vAlong); the frag uses w1^3.
		float w1 = mix(uAlphaStart, uAlphaEnd, vAlong);
		float v3 = w1 * w1 * w1;
		float texA2;
		if (uHasTex > 0.5) {
			float ta = texture2D(uTex, vSpriteUv).a; // the real glow shape's alpha (3-slice mapped)
			texA2 = ta * ta;                          // tex.a^2 (faithful)
		} else {
			// Procedural stand-in: soft cross-section × cap feather over the 3-slice UV.y (caps 0-0.25/0.75-1).
			float crossSec = 1.0 - abs(vSpriteUv.x * 2.0 - 1.0);
			float cap = smoothstep(0.0, 0.25, min(vSpriteUv.y, 1.0 - vSpriteUv.y) / 0.25);
			texA2 = crossSec * crossSec * clamp(cap, 0.0, 1.0);
		}
		// _Color.a = max(intensity × alphaMultiplier, minAlpha) (controller.Refresh); the frag multiplies the
		// rgb by it. minAlpha floors the brightness so a low-intensity laser still keeps a bright source.
		float base = max(uIntensity * uColorAlphaMul, uMinAlpha);
		float a = base * v3 * texA2 * uFxAlpha;
		vec3 c0 = (uColor + vec3(uBoostToWhite)) * a;
		// White-boost (_WhiteBoostType None/MainEffect/Always; =Always on weave lasers). An additive a^4
		// white term whitens ONLY the brightest core (the laser source), fading to the laser's hue along
		// the length — the in-game "white at the source, colored fade" gradient. Hue-preserving elsewhere.
		if (uWhiteBoost > 0.5) {
			c0 += vec3(pow(a, 4.0) * uWhiteBoostMultiplier);
		}
		vec3 c = applyBsFog(c0, uIntensity);
		float fogA = uInBloomPrePass > 0.5 ? 1.0 : (1.0 - bsFog(uIntensity));
		gl_FragColor = vec4(c, a * fogA);
	}
`;

let SpriteMaterial = null;

function makeClass() {
	class BsParametric3SliceSpriteMaterial extends THREE.ShaderMaterial {
		constructor() {
			super({
				uniforms: Object.assign(
					{
						uColor: {value: new THREE.Color(0, 0, 0)},
						uIntensity: {value: 1},
						uFxAlpha: {value: 1},
						uAlphaStart: {value: 1},
						uAlphaEnd: {value: 1},
						uColorAlphaMul: {value: 1}, // controller alphaMultiplier (= tube _colorAlphaMultiplier when synced)
						uMinAlpha: {value: 0},      // controller minAlpha (brightness floor)
						uWhiteBoost: {value: 0},    // _WhiteBoostType > 0 (shift bright core toward white)
						uWhiteBoostMultiplier: {value: 1},
						uBoostToWhite: {value: 0},
						uCapSize: {value: 0.25}, // _CapUVSize default
						uHalfWidth: {value: 0.075},
						uStartWidth: {value: 1},
						uEndWidth: {value: 1},
						uBillboard: {value: 1}, // _EnableYAxisBillboard (default on for glow sprites)
						uYMin: {value: 0},
						uLen: {value: 1},
						uTex: {value: null},
						uHasTex: {value: 0},
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
	return BsParametric3SliceSpriteMaterial;
}

/** The glow cross-section HALF-width (the X extent). Faithful to the decompiled controller: _SizeParams.x =
 * controller.width × _widthMultiplier, and the mesh X is ±1 so the rendered span is ±SizeParams.x. With
 * controller.width = tubeWidth × _bakedGlowWidthScale (tube line 432), the half-width is
 * tubeWidth × _bakedGlowWidthScale × _widthMultiplier (NOT ×0.5 — SizeParams.x IS the half extent;
 * _widthMultiplier=8 on weave). Shared by the geometry (cap length) + the shader (uHalfWidth). */
function spriteHalfWidth(meta) {
	const scale = (meta.bakedGlowWidthScale == null ? 1 : meta.bakedGlowWidthScale) * (meta.widthMultiplier == null ? 1 : meta.widthMultiplier);
	const w = (meta.tubeWidth > 0 ? meta.tubeWidth : 0.02) * scale;
	return Math.max(w, 0.01);
}

/**
 * The 3-slice sprite mesh (Parametric3SliceSpriteController.CreateMesh): 8 verts = 4 rows × 2 sides, UV.y
 * = {0, 0.25, 0.75, 1} so the texture's caps (top/bottom 25%) map to fixed-size ENDS and the middle (50%)
 * stretches along the length. The two cap rows are extended beyond the body by ~the width (the rounded soft
 * ends). position.x carries the side (-1/+1); position.y the local-Y row (the shader applies the width +
 * billboard). vAlong (length taper) is recomputed in the shader from uYMin/uLen, so the 3-slice UV doesn't
 * distort the taper.
 */
function spriteGeometry(meta) {
	const len = meta.tubeLength;
	const center = meta.tubeCenter == null ? 0.5 : meta.tubeCenter;
	const yStart = -len * center;
	const yEnd = len * (1 - center);
	const cap = Math.min(spriteHalfWidth(meta), (yEnd - yStart) * 0.5); // rounded end ~ half-width (radius), bounded
	const rowsY = [yStart - cap, yStart, yEnd, yEnd + cap];
	const rowsUv = [0.0, 0.25, 0.75, 1.0];
	const pos = [];
	const uv = [];
	for (let r = 0; r < 4; r++) {
		pos.push(-1, rowsY[r], 0, 1, rowsY[r], 0); // side -1, +1
		uv.push(0, rowsUv[r], 1, rowsUv[r]);
	}
	const idx = [];
	for (let r = 0; r < 3; r++) {
		const a = r * 2;
		const b = r * 2 + 1;
		const c = (r + 1) * 2;
		const d = (r + 1) * 2 + 1;
		idx.push(a, c, b, b, c, d);
	}
	const g = new THREE.BufferGeometry();
	g.addAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); // r95: addAttribute
	g.addAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
	g.setIndex(idx);
	return g;
}

// Glow-texture cache: many tubes share one _MainTex (exported once, deduped), so load each file once.
const texCache = {};
function loadGlowTex(filename) {
	if (texCache[filename]) {
		return texCache[filename];
	}
	// Sidecar PNGs live next to the env GLBs. flipY=false matches the exporter's flip:true decode (glTF convention).
	const tex = new THREE.TextureLoader().load('assets/environments/textures/' + filename);
	tex.flipY = false;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	texCache[filename] = tex;
	return tex;
}

/** Builds the baked-glow sprite material for a tube-light meta record. */
function createSprite(meta, sys) {
	if (!SpriteMaterial) {
		SpriteMaterial = makeClass();
	}
	const m = new SpriteMaterial();
	const len = meta.tubeLength;
	const center = meta.tubeCenter == null ? 0.5 : meta.tubeCenter;
	if (meta.color) {
		m.uniforms.uColor.value.setRGB(meta.color[0], meta.color[1], meta.color[2]);
	}
	m.uniforms.uAlphaStart.value = meta.startAlpha == null ? 1 : meta.startAlpha;
	m.uniforms.uAlphaEnd.value = meta.endAlpha == null ? 1 : meta.endAlpha;
	// Prefer the controller's own alphaMultiplier (authoritative for the sprite); fall back to the tube's
	// _colorAlphaMultiplier (synced) then 1. minAlpha floors the brightness (bright source at low intensity).
	m.uniforms.uColorAlphaMul.value = meta.alphaMultiplier != null ? meta.alphaMultiplier : (meta.colorAlphaMultiplier == null ? 1 : meta.colorAlphaMultiplier);
	m.uniforms.uMinAlpha.value = meta.minAlpha == null ? 0 : meta.minAlpha;
	m.uniforms.uWhiteBoost.value = meta.whiteBoostType > 0 ? 1 : 0; // _WhiteBoostType None(0)/MainEffect(1)/Always(2)
	m.uniforms.uWhiteBoostMultiplier.value = meta.whiteBoostMultiplier == null ? 1 : meta.whiteBoostMultiplier;
	m.uniforms.uBoostToWhite.value = meta.boostToWhite == null ? 0 : meta.boostToWhite;
	m.uniforms.uHalfWidth.value = spriteHalfWidth(meta);
	m.uniforms.uStartWidth.value = meta.startWidth == null ? 1 : meta.startWidth;
	m.uniforms.uEndWidth.value = meta.endWidth == null ? 1 : meta.endWidth;
	m.uniforms.uBillboard.value = meta.billboard === false ? 0 : 1; // _EnableYAxisBillboard (default on)
	m.uniforms.uCapSize.value = meta.capUVSize == null ? 0.25 : meta.capUVSize;
	m.uniforms.uYMin.value = -len * center;
	m.uniforms.uLen.value = len;
	if (meta.glowTex) {
		// Use the REAL exported glow texture (tex.a^2 shape); else the procedural fallback stays.
		m.uniforms.uTex.value = loadGlowTex(meta.glowTex);
		m.uniforms.uHasTex.value = 1;
	}
	sys.applyFog(m, 1);
	sys.applyBloom(m);
	m.userData.bsShaderId = 'tube';
	return m;
}

module.exports = {createSprite, spriteGeometry};
