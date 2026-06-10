/* global AFRAME, THREE */

/**
 * Loads a self-contained environment GLB (exported by BSDlcConverter.EnvDebug) into the scene,
 * choosing which environment from the loaded map (info._environmentName), so the right stage
 * loads automatically per replay. The `environmentOverride` setting (Settings > Visuals) forces a
 * specific environment instead, or — with the value 'legacy' — disables the exported-environment
 * system entirely and shows the old hardcoded web stage. `?env=<name|legacy>` overrides everything;
 * if no matching GLB exists the legacy stage is kept as a fallback.
 *
 * Emits `environment-loaded` {env} once the GLB is in the scene; light-rig + light-events-* hang
 * off that. Emits `environment-unloaded` when switching to legacy so the env-bound components
 * (mirror, environment-background, light-rig) tear down. Material/shader fidelity and the lighting
 * runtime live in the sibling components.
 */
AFRAME.registerComponent('environment-glb', {
	schema: {
		src: {default: ''}, // explicit override; normally derived from the map
		hideLegacy: {default: true},
	},

	init: function () {
		this.loader = new THREE.GLTFLoader();
		this.loadedEnv = null;
		this.legacyActive = false;
		this.lastDetail = null;
		this._loadId = 0; // bumped on every load/unload so stale async loads are dropped

		if (this.data.src) {
			this.load(this.data.src, null);
			return;
		}
		this.el.sceneEl.addEventListener('challengeloadend', evt => {
			this.lastDetail = evt.detail;
			this.refresh();
		});
		// The environment dropdown (Settings > Visuals) switches environments at runtime.
		this.el.sceneEl.addEventListener('settingsChanged', () => this.refresh());
		// Apply a persisted override (forced env or legacy) from page load, not first map load.
		this.refresh();
	},

	refresh: function () {
		const env = this.resolveEnvName();
		if (!env) {
			return; // nothing to show yet (no map loaded, no forced environment)
		}
		if (env === 'legacy') {
			this.setLegacy();
			return;
		}
		if (env === this.loadedEnv && !this.legacyActive) {
			return; // already showing this environment
		}
		this.load(`assets/environments/${env}.glb`, env);
	},

	/**
	 * Map -> environment-file name. Beat Saber's info._environmentName is e.g. "WeaveEnvironment";
	 * exported GLBs are named by the bundle prefix without the "environment" suffix ("weave").
	 * Priority: `?env=` URL param > environmentOverride setting > map > weave default.
	 */
	resolveEnvName: function () {
		const override = AFRAME.utils.getUrlParameter('env');
		if (override) {
			return override;
		}
		const settingsComp = this.el.sceneEl.components.settings;
		const settings = settingsComp && settingsComp.settings;
		if (settings && settings.environmentOverride) {
			return settings.environmentOverride;
		}
		if (!this.lastDetail) {
			return null;
		}
		const info = this.lastDetail.info;
		const name = info && (info._environmentName || (info._environmentNames && info._environmentNames[0]));
		if (name) {
			return name.toLowerCase().replace(/environment$/, '');
		}
		return 'weave';
	},

	load: function (src, env) {
		const loadId = ++this._loadId;
		this.loader.load(
			src,
			gltf => {
				if (loadId !== this._loadId) {
					return; // a newer load/legacy switch superseded this request
				}
				this.onLoaded(gltf, env);
			},
			undefined,
			err => {
				console.warn('[environment-glb] could not load', src, '- keeping legacy stage', err && err.message);
				this.el.emit('environment-load-failed', {env}, false);
			}
		);
	},

	onLoaded: function (gltf, env) {
		const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
		if (!root) {
			console.error('[environment-glb] GLB has no scene', env);
			return;
		}

		if (this.el.getObject3D('mesh')) {
			this.el.removeObject3D('mesh'); // replace a previously loaded environment
		}
		this.el.setObject3D('mesh', root);
		this.loadedEnv = env;
		this.legacyActive = false;

		let meshCount = 0;
		const bounds = new THREE.Box3().setFromObject(root);
		root.traverse(o => {
			if (o.isMesh) {
				meshCount++;
				o.frustumCulled = false;
			}
		});
		const size = bounds.getSize(new THREE.Vector3());
		console.warn(
			`[environment-glb] loaded ${env}: ${meshCount} meshes, bounds ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`
		);

		if (this.data.hideLegacy) {
			this.hideLegacyStage();
		}
		this.setBloomEnabled(true);
		this.el.emit('environment-loaded', {env: env, meshCount: meshCount}, false);
	},

	/** Drop the exported environment (if any) and go back to the old hardcoded web stage. */
	setLegacy: function () {
		this.setBloomEnabled(false);
		if (this.legacyActive) {
			return;
		}
		this.legacyActive = true;
		this._loadId++; // invalidate any in-flight GLB load
		if (this.el.getObject3D('mesh')) {
			this.el.removeObject3D('mesh');
		}
		this.loadedEnv = null;
		this.showLegacyStage();
		this.el.emit('environment-unloaded', {}, false);
	},

	/** The exported-env render pipeline (prepass + composite) must not touch the legacy scene. */
	setBloomEnabled: function (enabled) {
		const bloomSys = this.el.sceneEl.systems['bloom-prepass'];
		if (bloomSys) {
			bloomSys.data.enabled = enabled;
		}
	},

	hideLegacyStage: function () {
		['substage', 'twister', 'audioColumns'].forEach(id => {
			const el = document.getElementById(id);
			if (el && el.object3D) {
				el.object3D.visible = false;
			}
		});
	},

	/** Inverse of hideLegacyStage, honoring the legacy visibility settings. */
	showLegacyStage: function () {
		const settingsComp = this.el.sceneEl.components.settings;
		const settings = (settingsComp && settingsComp.settings) || {};
		const visible = {
			substage: true,
			twister: settings.showTwister !== false,
			audioColumns: settings.showAudioColumns !== false,
		};
		Object.keys(visible).forEach(id => {
			const el = document.getElementById(id);
			if (el && el.object3D) {
				el.object3D.visible = visible[id];
			}
		});
	},
});
