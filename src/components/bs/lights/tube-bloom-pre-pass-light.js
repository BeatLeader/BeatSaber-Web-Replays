/* global THREE */

/**
 * TubeBloomPrePassLight(WithId) — the BS tube-light component port (docs/decompiled/TubeBloomPrePassLight.cs).
 * Builds the three.js meshes for one exported tube-light meta record, choosing the faithful render path:
 *
 *  - Body: when the tube has a ParametricBoxController (`meta.boxBody`), a solid 3D TransparentNeonLight box
 *    (the visible body; scales with distance like in-game).
 *  - Glow: with the bloom prepass ON (`_mainEffectPostProcessEnabled && !_forceUseBakedGlow`, the normal
 *    case) the BloomPrePassLine screen-space line — drawn into the bloom prepass as the glow source, NOT a
 *    visible main-pass line when a box body is present (that was the "beam doesn't scale / over-bright center"
 *    bug). With bloom OFF / forced, the Parametric3SliceSprite baked glow instead.
 *
 * A pure tube with no box renders the line in the main pass too (it IS the visible thin laser). No `kind`/
 * width-heuristic fallback: the exporter supplies `boxBody`/`bakedGlow`/`mainEffectEnabled`/`forceBakedGlow`
 * (re-export an env to populate them).
 */

const line = require('../shaders/bloom-pre-pass-line.js');
const box = require('../shaders/transparent-neon-light.js');
const sprite = require('../shaders/parametric-3-slice-sprite.js');

/**
 * Returns the meshes for a tube light (registered under the tube's lightId by the caller; driven by the
 * shared setLightColor contract). `meta` is the lighting.json tube record; `sys` is the bs-materials system.
 */
function buildTubeMeshes(meta, sys) {
	const meshes = [];
	const bloomOff = meta.mainEffectEnabled === false || meta.forceBakedGlow === true;
	const hasBox = !!meta.boxBody;

	// (1) Solid 3D box body (Custom/TransparentNeonLight) — the visible body + a bloom-prepass source.
	if (hasBox) {
		const b = new THREE.Mesh(box.boxGeometry(meta), box.createBox(meta, sys));
		b.frustumCulled = false;
		b.userData.bsTubeBeam = true;
		sys.markBloomLayer(b);
		meshes.push(b);
	}

	// (2) Glow path.
	if (bloomOff && meta.bakedGlow) {
		// Bloom off: the baked 3-slice sprite IS the glow (no prepass blur to rely on).
		const s = new THREE.Mesh(sprite.spriteGeometry(meta), sprite.createSprite(meta, sys));
		s.frustumCulled = false;
		s.userData.bsTubeBeam = true;
		sys.markBloomLayer(s);
		meshes.push(s);
	} else {
		// Bloom on: the BloomPrePassLine screen-space line (the prepass glow source).
		const ln = new THREE.Mesh(line.lineGeometry(), line.createLine(meta, sys));
		ln.frustumCulled = false;
		ln.userData.bsTubeBeam = true;
		if (hasBox) {
			ln.layers.set(sys.BLOOM_LAYER); // prepass-ONLY: the box is the visible body
		} else {
			sys.markBloomLayer(ln); // no box -> the line is the visible thin laser (main + prepass)
		}
		meshes.push(ln);
	}

	return meshes;
}

module.exports = {buildTubeMeshes};
