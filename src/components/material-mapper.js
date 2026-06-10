/* global AFRAME, THREE */

/**
 * Phase 1 — material-mapper (docs/WebShaderLibrary.design.md §5–6).
 *
 * After the environment GLB loads, map each mesh's material to a library render family and, for the
 * driven light families, swap in a per-mesh library material (built by the `bs-materials` system)
 * that preserves the baked color/texture.
 *
 * The family comes SOLELY from the REAL Unity shader name in the exporter-generated
 * `<env>.materials.json` (material name -> {shader, color, hasMainTex, params}) via
 * `bs-materials.shaderFamily`. There is no name-regex fallback: a material with no resolved/known
 * shader stays baked (re-export the env to populate `shader`). A mesh becomes an emissive light ONLY
 * when its family is a light family AND its own node is driven by a LightWithId (has a lightId) — so
 * static fixture models (e.g. the laser head `DynamicLightSource`/`DynamicBase`) keep their baked
 * material and stay dark, matching the game. Structural geometry and the not-yet-ported families
 * (mirror/spectrogram/fog) are left baked.
 *
 * Emits `materials-mapped` (always — even on fetch failure) so the light-rig builds its index after
 * the swap and drives the lights via the §4 `setLightColor` contract.
 */
AFRAME.registerComponent('material-mapper', {
	init: function () {
		this.materials = null; // material name -> {shader, color, hasMainTex, params}
		this.billboards = []; // glow-sprite meshes oriented camera-facing each frame
		this._camQuat = new THREE.Quaternion();
		this._parentQuat = new THREE.Quaternion();
		this.el.addEventListener('environment-loaded', evt => this.onEnvLoaded(evt.detail));
	},

	// Orient glow sprites to face the camera (BS billboards EnvLightSpriteGlow/LightGlow/…). Setting a
	// mesh's local quaternion to parentWorld^-1 * cameraWorld makes its world orientation match the
	// camera, so the quad always faces the viewer regardless of the (rotating) laser head it hangs off.
	tick: function () {
		const cam = this.el.sceneEl && this.el.sceneEl.camera;
		if (!cam || this.billboards.length === 0) {
			return;
		}
		cam.getWorldQuaternion(this._camQuat);
		for (let i = 0; i < this.billboards.length; i++) {
			const m = this.billboards[i];
			if (m.parent) {
				m.parent.getWorldQuaternion(this._parentQuat);
				m.quaternion.copy(this._parentQuat.inverse()).multiply(this._camQuat);
			} else {
				m.quaternion.copy(this._camQuat);
			}
		}
	},

	onEnvLoaded: function (detail) {
		const env = (detail && detail.env) || 'weave';
		const url = `assets/environments/${env}.materials.json`;
		fetch(url)
			.then(r => (r.ok ? r.json() : null))
			.catch(() => null)
			.then(map => {
				this.materials = map;
				this.applyMaterials();
			});
	},

	applyMaterials: function () {
		const root = this.el.getObject3D('mesh');
		const sys = this.el.sceneEl.systems['bs-materials'];
		if (!root || !sys) {
			this.el.emit('materials-mapped', {swapped: 0}, false);
			return;
		}

		const counts = {};
		let swapped = 0;
		this.billboards = [];

		root.traverse(o => {
			if (!o.isMesh || !o.material) {
				return;
			}
			// A mesh is a driven light only when its own node carries a lightId (a LightWithId renderer);
			// static models keep their baked material even if the name/shaderId looks light-ish.
			const lid = o.userData && o.userData.lightId;
			const isDrivenLight = lid !== undefined && lid !== null && lid !== -1;
			let billboard = false;

			const mapOne = src => {
				const name = src && src.name;
				const entry = this.materials && name ? this.materials[name] : null;
				// The render family comes SOLELY from the real Unity shader name (exporter
				// materials.json.shader, resolved cross-bundle) via bs-materials.shaderFamily. No fallback:
				// a material with no resolved shader (or an unmapped one) stays baked. Re-export an env to
				// give its materials.json the `shader` field.
				const id = entry ? sys.shaderFamily(entry.shader) : null;
				counts[id || 'baked'] = (counts[id || 'baked'] || 0) + 1;
				// Spectrogram is driven by the audio (env-spectrogram), not a LightWithId — swap it
				// regardless of lightId so its vertex displacement runs. `entry.peakOffset` also flags it
				// (covers the rare visor that uses a different shader but the same _PeakOffset displacement).
				if (id === 'spectrogram' || (entry && entry.peakOffset)) {
					swapped++;
					return sys.createSpectrogram(src, entry);
				}
				if (!sys.isLight(id) || !isDrivenLight) {
					return src; // structural / static / unmapped -> keep baked
				}
				swapped++;
				if (id === 'glow' && sys.isBillboardSprite(name)) {
					billboard = true;
				}
				return sys.create(id, src, entry && entry.params);
			};

			o.material = Array.isArray(o.material) ? o.material.map(mapOne) : mapOne(o.material);
			o.userData.bsShaderId = Array.isArray(o.material) ? o.material[0].userData.bsShaderId : o.material.userData.bsShaderId;
			// Tag swapped library LIGHT meshes onto the bloom layer (§7.1) so the selective pre-pass
			// renders them. isBsLibraryMaterial is exactly the light families (not the spectrogram/PBR).
			const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
			if (m0 && m0.isBsLibraryMaterial) {
				sys.markBloomLayer(o);
			}
			// Inject BloomFog into the kept-baked STRUCTURAL materials (bs/pbr) so the structure also
			// recedes into the fog. Skip library lights (already fogged) and the spectrogram (owns its
			// own onBeforeCompile for displacement).
			const finalMats = Array.isArray(o.material) ? o.material : [o.material];
			finalMats.forEach(mm => {
				if (mm && mm.isMeshStandardMaterial && !mm.isBsLibraryMaterial && (!mm.userData || mm.userData.bsShaderId !== 'spectrogram')) {
					const e = this.materials && mm.name ? this.materials[mm.name] : null;
					if (!mm.userData.bsFogInjected) { this._fogInjected = (this._fogInjected || 0) + 1; }
					sys.applyFogToStandard(mm, e && e.params);
				}
			});
			if (billboard) {
				this.billboards.push(o);
			}
		});

		const matCount = this.materials ? Object.keys(this.materials).length : 'none';
		console.warn(`[material-mapper] swapped ${swapped} light material(s), ${this._fogInjected || 0} structural fog-injected, ${this.billboards.length} billboard sprite(s); materials.json=${matCount}; classes=${JSON.stringify(counts)}`);
		this.el.emit('materials-mapped', {swapped: swapped, classes: counts}, false);
	},
});
