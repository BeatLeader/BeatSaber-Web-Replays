/* global AFRAME, THREE */

const tube = require('./bs/lights/tube-bloom-pre-pass-light.js');

/**
 * Step B — shared lighting apply-layer for exported environments.
 *
 * Indexes the loaded environment GLB's tagged nodes (node.userData.lightId, written by
 * BSDlcConverter.EnvDebug into glTF `extras`) into `lightId -> meshes`, and implements the
 * shared sink that BOTH the V2 and V3 event fronts call: `setColorForId(lightId, color)`,
 * mirroring the decompiled LightWithIdManager.SetColorForId -> LightWithId.ColorWasSet
 * (MaterialLightWithId / TubeBloomPrePassLightWithId). See design doc §14.
 *
 * No event wiring or debug flashing here — the V2 (light-events-v2) and V3 (light-events-v3)
 * fronts call into this; visual verification happens once Step D lands.
 *
 * Lives on the same entity as `environment-glb`; reads `lighting.json` for the scene-level
 * switch/group tables (consumed by the event fronts, exposed here for them).
 *
 * Usage: <a-entity environment-glb="..." light-rig="lighting: assets/environments/lighting.json">
 */
// HDR intensity is the light-rig `hdrBoost` data field (default 1.0). BS lasers are HDR-bright, so after
// the distance fog attenuates the bloom mask (alpha = a^2 * fogDist) they still bloom; with our LDR
// intensities (<=1) that mask is ~0 at distance, so far lasers vanish. Raising hdrBoost is now SAFE — the
// composite is hue-preserving saturate, not ACES (which previously washed boosted lights white). Tune it
// live to VERIFY whether HDR brightness is what keeps far lasers visible:
//   document.querySelector('[light-rig]').components['light-rig'].data.hdrBoost = 3

AFRAME.registerComponent('light-rig', {
	schema: {
		lighting: {type: 'string'}, // url to lighting.json
		hdrBoost: {default: 1.0}, // HDR intensity multiplier (BS lasers are HDR; raise to survive distance fog)
	},

	init: function () {
		this.byId = new Map(); // lightId -> { meta, meshes: [] }
		this.switches = []; // V2: [{eventType, lightsId}]
		this.groups = []; // V3: [{groupId, startLightId, count, sameIdElements}]
		this.lightingData = null;
		this.envRoot = null;
		this.ready = false;

		this._scratch = new THREE.Color();

		// Color-boost is global state over song time; build it once here so both light fronts
		// share it (v2 _events type 5, v3/v4 colorBoostBeatmapEvents).
		this.boostTimeline = [];
		this.el.sceneEl.addEventListener('challengeloadend', evt => this.onChallenge(evt.detail));

		// Driven by environment-glb: when an environment loads, fetch its matching lighting
		// sidecar and (re)build the index. This makes the rig follow the per-map environment.
		this.el.addEventListener('environment-loaded', evt => this.onEnvLoaded(evt.detail));
		// Legacy mode: drop the index so the event fronts' setColorForId calls become no-ops.
		this.el.addEventListener('environment-unloaded', () => this.onEnvUnloaded());

		// The material-mapper swaps in the library materials (HDR-emissive light materials) before
		// we index; build only once both the lighting sidecar AND the swap are done so we drive the
		// library materials via setLightColor. (Falls back to baked materials if no mapper present.)
		this.mapped = false;
		this.built = false;
		this.el.addEventListener('materials-mapped', () => this.onMaterialsMapped());
	},

	onChallenge: function (detail) {
		const beatData = detail.beatmaps && detail.beatmaps[detail.mode] && detail.beatmaps[detail.mode][detail.difficulty];
		const bpm = (detail.info && detail.info._beatsPerMinute) || (beatData && beatData._beatsPerMinute) || 0;
		const tl = [];
		if (beatData && beatData.colorBoostBeatmapEvents && bpm) {
			const k = 60 / bpm;
			for (const e of beatData.colorBoostBeatmapEvents) {
				tl.push({t: (e.b || 0) * k, on: !!e.o});
			}
		} else if (beatData && beatData._events) {
			for (const e of beatData._events) {
				if (e._type === 5) {
					tl.push({t: e._songTime, on: e._value !== 0});
				}
			}
		}
		tl.sort((a, b) => a.t - b.t);
		this.boostTimeline = tl;
	},

	/** Whether color boost is active at song time `now` (last boost event <= now). */
	boostActiveAt: function (now) {
		const tl = this.boostTimeline;
		let lo = 0;
		let hi = tl.length - 1;
		let on = false;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (tl[mid].t <= now) {
				on = tl[mid].on;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return on;
	},

	onEnvLoaded: function (detail) {
		this.ready = false;
		this.mapped = false;
		this.built = false;
		this.byId.clear();
		this.envRoot = this.el.getObject3D('mesh');
		this.lightingData = null;

		const env = (detail && detail.env) || 'weave';
		const url = this.data.lighting || `assets/environments/${env}.lighting.json`;
		fetch(url)
			.then(r => r.json())
			.then(j => {
				this.lightingData = j;
				this.switches = j.switches || [];
				this.groups = j.groups || [];
				// Build once the material-mapper has emitted `materials-mapped` (it always does, even on
				// fetch failure), so the index sees the swapped library materials.
				this.tryBuild();
			})
			.catch(e => console.error('[light-rig] failed to load', url, e));
	},

	onMaterialsMapped: function () {
		this.mapped = true;
		this.tryBuild();
	},

	onEnvUnloaded: function () {
		this.ready = false;
		this.mapped = false;
		this.built = false;
		this.byId.clear();
		this.envRoot = null;
		this.lightingData = null;
		this.switches = [];
		this.groups = [];
	},

	tryBuild: function () {
		if (this.built || !this.envRoot || !this.lightingData || !this.mapped) {
			return;
		}
		this.built = true;
		// Push the global BloomFog params (§7.2) into the shared fog uniforms before building meshes,
		// so the tube beams/boxes generated in buildIndex (and the already-swapped light materials) all
		// fade with distance. No-op when the env wasn't re-exported with a `fog` block.
		const sys = this.el.sceneEl.systems['bs-materials'];
		if (sys && sys.setFog) {
			sys.setFog(this.lightingData.fog);
		}
		// §7.1 bloom render params (radius/intensity/tonemap) → the bloom-prepass system.
		const bloomSys = this.el.sceneEl.systems['bloom-prepass'];
		if (bloomSys && bloomSys.setBloom) {
			bloomSys.setBloom(this.lightingData.bloom);
		}
		// BloomFog autoExposureLimit (clamps the bloom auto-exposure boost) is in the fog block.
		const fog = this.lightingData.fog;
		if (bloomSys && fog && fog.autoExposureLimit != null) {
			bloomSys.data.autoExposureLimit = fog.autoExposureLimit;
		}
		this.buildIndex();
		this.ready = true;
		console.warn(`[light-rig] indexed ${this.byId.size} light ids across ${this._meshCount} meshes`);
		this.el.emit('light-rig-ready', {lightIds: this.byId.size}, false);
	},

	/**
	 * Build lightId -> meshes. Each mesh is assigned to its nearest self-or-ancestor node
	 * that carries a lightId tag (handles mesh-on-light-node and mesh-as-child, and lets a
	 * nested light win over its parent). Materials are cloned per mesh so a per-light color
	 * change can't bleed across the deduped shared materials (three.js analogue of BS's
	 * per-renderer MaterialPropertyBlock).
	 */
	buildIndex: function () {
		const tagged = new Map(); // object3D -> meta
		this.envRoot.traverse(o => {
			const id = o.userData && o.userData.lightId;
			if (id !== undefined && id !== null && id !== -1) {
				tagged.set(o, o.userData);
			}
		});

		this._meshCount = 0;
		this.envRoot.traverse(o => {
			if (!o.isMesh) {
				return;
			}
			// Color ONLY the light's own renderer, not descendants. BS's MaterialLightWithId drives a
			// single serialized _meshRenderer (always on the same GameObject as the light component) —
			// never child models like the laser head (`LightSource`/`DynamicLightSource`), which must
			// stay dark. So a mesh is a light iff its own node carries the lightId tag.
			const meta = tagged.get(o);
			if (!meta) {
				return;
			}

			// Library materials from the material-mapper are already per-mesh instances, so they
			// give us per-light isolation without cloning. Only baked (shared) materials still need
			// cloning (three.js analogue of BS's per-renderer MaterialPropertyBlock).
			const isolate = m => (m && m.isBsLibraryMaterial ? m : m.clone());
			o.material = Array.isArray(o.material) ? o.material.map(isolate) : isolate(o.material);

			let entry = this.byId.get(meta.lightId);
			if (!entry) {
				entry = {meta: meta, meshes: []};
				this.byId.set(meta.lightId, entry);
			}
			entry.meshes.push(o);
			this._meshCount++;
		});

		// Tube lights (TubeBloomPrePassLight) carry NO mesh in the scene — Beat Saber draws their
		// beams with a global procedural renderer (FillMeshData: a screen-space line along the node's
		// local Y from -length*center to +length*(1-center), thickness _width). The export captures
		// those params, so generate beam geometry here and register it under the tube's lightId so the
		// existing lighting events drive it. Without this the fixtures light up but no beams appear.
		const sys = this.el.sceneEl.systems['bs-materials'];
		let beams = 0;
		tagged.forEach((meta, obj) => {
			// Key on the REAL component class (TubeBloomPrePassLightWithId -> 'tube'). No `kind` fallback —
			// re-export the env to populate `class`.
			if (!sys || sys.classFamily(meta.class) !== 'tube' || !(meta.tubeLength > 0)) {
				return;
			}
			let entry = this.byId.get(meta.lightId);
			if (!entry) {
				entry = {meta: meta, meshes: []};
				this.byId.set(meta.lightId, entry);
			}
			const meshes = tube.buildTubeMeshes(meta, sys);
			for (let i = 0; i < meshes.length; i++) {
				obj.add(meshes[i]);
				entry.meshes.push(meshes[i]);
				this._meshCount++;
			}
			beams++;
		});
		if (beams) {
			console.warn(`[light-rig] generated ${beams} tube-light beam(s)`);
		}

		// Initialize every indexed light to OFF (black). Beat Saber lights are dark until the show
		// drives them; the event fronts turn them on per the timeline. Without this, any light whose
		// group has no events in the loaded map keeps its seeded baked color and glows incorrectly.
		const off = {r: 0, g: 0, b: 0, a: 0};
		this.byId.forEach(entry => {
			for (let i = 0; i < entry.meshes.length; i++) {
				this.applyColor(entry.meshes[i], entry.meta, off);
			}
		});

		// Static tubes (TubeBloomPrePassLight with no LightWithId, e.g. the wide rectangular pylon
		// panels): not event-driven — generate the beam/box and leave it ALWAYS ON at its authored
		// color. These carry userData.static + tube params but lightId -1, so they aren't in `tagged`.
		let statics = 0;
		if (sys) {
			this.envRoot.traverse(o => {
				const ud = o.userData;
				if (!ud || sys.classFamily(ud.class) !== 'tube' || !ud.static || !(ud.tubeLength > 0)) {
					return;
				}
				const col = ud.color || [1, 1, 1, 1];
				const meshes = tube.buildTubeMeshes(ud, sys);
				for (let i = 0; i < meshes.length; i++) {
					o.add(meshes[i]);
					const mats = Array.isArray(meshes[i].material) ? meshes[i].material : [meshes[i].material];
					for (let k = 0; k < mats.length; k++) {
						if (typeof mats[k].setLightColor === 'function') {
							mats[k].setLightColor(col[0], col[1], col[2], (col[3] == null ? 1 : col[3]) * this.data.hdrBoost);
						}
					}
					this._meshCount++;
				}
				statics++;
			});
		}
		if (statics) {
			console.warn(`[light-rig] generated ${statics} static tube(s)`);
		}
	},

	/**
	 * Shared sink — mirrors LightWithIdManager.SetColorForId. `color` is {r,g,b,a} in 0..1
	 * (a = brightness/intensity). Called by the V2 and V3 event fronts.
	 */
	setColorForId: function (lightId, color) {
		const entry = this.byId.get(lightId);
		if (!entry) {
			return;
		}
		for (let i = 0; i < entry.meshes.length; i++) {
			this.applyColor(entry.meshes[i], entry.meta, color);
		}
	},

	/**
	 * Read-only diagnostic (call from the console: `...components['light-rig'].dumpLights()`).
	 * Logs each lightId's mesh count and the LIVE uColor/uIntensity of its first library material —
	 * so we can see whether a light is driven (intensity>0) and what color it actually got. Run it on
	 * a frame where the suspect light is lit. (eventType->lightsId switch table logged too.)
	 */
	dumpLights: function () {
		console.warn('[light-rig] switches ' + JSON.stringify((this.switches || []).map(s => s.eventType + '->' + s.lightsId)) + '; ' + this.byId.size + ' lightIds');
		this.byId.forEach((entry, id) => {
			let info = '';
			for (const mesh of entry.meshes) {
				const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
				for (const m of mats) {
					if (m.uniforms && m.uniforms.uColor) {
						const c = m.uniforms.uColor.value;
						const it = m.uniforms.uIntensity ? m.uniforms.uIntensity.value : -1;
						info = ` ${m.userData.bsShaderId || '?'} col=(${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}) i=${(+it).toFixed(3)}`;
						break;
					}
				}
				if (info) {
					break;
				}
			}
			console.warn(`  lightId ${id}: class=${entry.meta.class} meshes=${entry.meshes.length}${info}`);
		});
	},

	/**
	 * Mirrors MaterialLightWithId / TubeBloomPrePassLightWithId ColorWasSet (simplified for
	 * Step B; emissive used so lights read as glowing on the basic exported materials —
	 * faithful bloom/shaders come later).
	 */
	applyColor: function (mesh, meta, color) {
		let a = color.a === undefined ? 1 : color.a;
		a *= meta.alphaIntensity === undefined ? 1 : meta.alphaIntensity;

		let r = color.r;
		let g = color.g;
		let b = color.b;

		let mul = 1;
		if (meta.multiplyColorWithAlpha) {
			mul *= a;
		}
		if (meta.multiplyColor) {
			mul *= meta.colorMultiplier === undefined ? 1 : meta.colorMultiplier;
		}
		if (meta.multiplyColorWithAlpha || meta.multiplyColor) {
			r *= mul;
			g *= mul;
			b *= mul;
		}

		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (let i = 0; i < mats.length; i++) {
			const m = mats[i];
			if (typeof m.setLightColor === 'function') {
				// Library material decides how color/intensity render (emissive -> bloom). Pass the
				// already-multiplied color plus `a` as intensity; with multiplyColorWithAlpha that
				// yields color*a^2, matching the decompiled BS neon shaders (docs/shaderdump).
				// hdrBoost (light-rig schema) scales our LDR (intensity<=1) lights toward BS's HDR brightness:
				// brighter cores that survive the distance fog (alpha = a^2*fogDist) and bloom. The composite
				// saturates per-channel (hue-preserving) — so boosting past 1 no longer washes lights white.
				m.setLightColor(r, g, b, a * this.data.hdrBoost);
				continue;
			}
			// Baked (non-library) material. When the material-mapper ran, only properly-classified
			// lights were swapped to library materials; a baked mesh here is a physical fixture
			// (e.g. RotationBase/DynamicBase, driven by InstancedMaterialLightWithId) whose real BS
			// shader renders it mostly dark — so leave it dark rather than making the whole mesh glow.
			// Only fall back to direct color/emissive when there's no mapper at all.
			if (this.mapped) {
				continue;
			}
			if (m.color) {
				m.color.setRGB(r, g, b);
			}
			if (m.emissive) {
				m.emissive.setRGB(r, g, b);
				m.emissiveIntensity = a;
			}
		}
	},

	/** Convenience for the V3 front: element -> lightId is startLightId + elementId. */
	groupById: function (groupId) {
		for (let i = 0; i < this.groups.length; i++) {
			if (this.groups[i].groupId === groupId) {
				return this.groups[i];
			}
		}
		return null;
	},
});
