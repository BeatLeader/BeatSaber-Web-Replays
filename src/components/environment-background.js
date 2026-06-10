/* global AFRAME, THREE */

/**
 * Environment background — the `BloomPrePassBackground*` family (docs/WebShaderLibrary.design.md).
 *
 * Beat Saber fills the screen behind the scene with a "non-light" BloomPrePass background pass that
 * also seeds the bloom prepass. Stock envs (bigmirror included) use a
 * `BloomPrePassBackgroundColorsGradient`: a vertical sky gradient (the `Hidden/SkyGradient` shader)
 * sampled by the view ray's vertical angle — bigmirror's is the signature teal horizon glow over
 * black. A sibling `BloomPrePassBackgroundColorsGradientFromColorSchemeColors` overrides some
 * gradient stops from the live color scheme (environmentColor0/1[Boost] × intensity); the exporter
 * captures those override descriptors and we resolve them here against the env color scheme.
 *
 * The exporter writes the background into `lighting.json.background`
 * (`{type:'gradient', tintColor, elements:[{color,startT,exp}], fromColorScheme:[...]}`). We build
 * the gradient material (bs-materials.createSkyGradient) and render it on a sky dome (BackSide,
 * depthTest off, rendered first) that is re-centred on the camera each frame so it reads as infinite.
 * The mirror reflects it for free (it re-renders the whole scene, dome included).
 *
 * Lives on the same entity as `environment-glb`; reacts to `environment-loaded` so the background
 * follows the per-map environment. Static for now (boost-driven stops are a refinement — bigmirror's
 * overrides use the non-boost Color0/Color1, so its background doesn't change on boost anyway).
 */
AFRAME.registerComponent('environment-background', {
	init: function () {
		this.dome = null;
		this._camPos = new THREE.Vector3();
		this.el.addEventListener('environment-loaded', evt => this.onEnvLoaded(evt.detail));
		this.el.addEventListener('environment-unloaded', () => this.teardown());
	},

	onEnvLoaded: function (detail) {
		this.teardown();
		const env = (detail && detail.env) || 'weave';
		const url = `assets/environments/${env}.lighting.json`;
		fetch(url)
			.then(r => (r.ok ? r.json() : null))
			.catch(() => null)
			.then(j => this.build(j));
	},

	build: function (lighting) {
		const bg = lighting && lighting.background;
		if (!bg || bg.type !== 'gradient' || !bg.elements || !bg.elements.length) {
			return; // env has no exported background gradient
		}
		const sys = this.el.sceneEl.systems['bs-materials'];
		if (!sys) {
			return;
		}

		const resolved = {
			tintColor: bg.tintColor,
			elements: this.resolveSchemeColors(bg, this.colorScheme(lighting)),
		};
		const material = sys.createSkyGradient(resolved);

		// Sky dome: large enough to surround the scene but inside the camera far plane (clip-space
		// clipping still applies even with depthTest off). Re-centred on the camera each frame.
		const cam = this.el.sceneEl.camera;
		const far = (cam && cam.far) || 10000;
		const radius = Math.max(100, far * 0.45);
		const geo = new THREE.SphereBufferGeometry(radius, 32, 16);
		const dome = new THREE.Mesh(geo, material);
		dome.frustumCulled = false;
		dome.renderOrder = -10000; // draw before everything (mirror, lights, structure)
		dome.userData.bsShaderId = 'sky-gradient';
		// §7.1: the sky gradient is BS's "before-blur non-light" background pass — render it into the bloom
		// buffer so fog (lights + structure) fades toward the blurred sky HAZE, not black. (The composite
		// now adds bloom at the real 0.3 blend, so the old over-bright sky halo is much fainter.)
		sys.markBloomLayer(dome);

		this.el.sceneEl.object3D.add(dome);
		this.dome = dome;

		// Drive the flat fog/haze color (structural BloomFog fades toward it) from the gradient's brightest
		// stop — the horizon band, the env's signature haze color — so distant structure reads as that haze
		// instead of fading toward black (which is invisible on a dark env).
		// Distant structure should recede into DARKNESS (the BS tunnel goes near-black far), not a bright
		// colored haze. Use a DARK, desaturated tint of the gradient's average so the recession matches
		// the env mood without a strong color cast (the bright-stop approach made bigmirror's red band
		// flood the whole scene). Clamp to a low peak.
		let avg = [0, 0, 0];
		resolved.elements.forEach(el => {
			const c = el.color || [0, 0, 0, 1];
			avg[0] += c[0]; avg[1] += c[1]; avg[2] += c[2];
		});
		const n = Math.max(1, resolved.elements.length);
		avg = avg.map(v => v / n);
		const peak = Math.max(avg[0], avg[1], avg[2], 1e-4);
		const k = 0.05 / peak; // scale the average down to a dark ambient (peak ~0.05)
		sys.setFogColor(avg[0] * k, avg[1] * k, avg[2] * k);
		console.warn(`[environment-background] sky gradient: ${resolved.elements.length} stop(s); fogColor=${avg.map(v => (v * k).toFixed(3))}`);
	},

	/**
	 * The color scheme the background's `FromColorScheme` overrides resolve against. Prefer the
	 * exported `lighting.colorScheme`; when it's absent (many stock envs, incl. bigmirror, carry no
	 * ColorSchemeSO) fall back to the SAME defaults `light-events-v2` uses, so the background tint
	 * stays consistent with the lights the player actually renders.
	 */
	colorScheme: function (lighting) {
		const cs = lighting && lighting.colorScheme;
		if (cs && (cs.color0 || cs.color1)) {
			return cs;
		}
		// Mirrors light-events-v2 defaults (red / blue).
		return {
			color0: [0.85, 0.08, 0.08],
			color1: [0.05, 0.45, 0.9],
			color0Boost: [0.85, 0.08, 0.08],
			color1Boost: [0.05, 0.45, 0.9],
		};
	},

	/**
	 * Applies the `FromColorSchemeColors` overrides: each gradient stop whose descriptor has
	 * `loadFromColorScheme` takes `environmentColor{0,1}[Boost] × intensity` (alpha kept from the
	 * stop). Returns a fresh element list so the source data isn't mutated.
	 */
	resolveSchemeColors: function (bg, colorScheme) {
		const overrides = bg.fromColorScheme || [];
		return bg.elements.map((el, i) => {
			const ov = overrides[i];
			const src = el.color || [0, 0, 0, 1];
			if (ov && ov.loadFromColorScheme) {
				const base = this.schemeColor(colorScheme, ov.environmentColor);
				const k = ov.intensity == null ? 1 : ov.intensity;
				return {color: [base[0] * k, base[1] * k, base[2] * k, src[3]], startT: el.startT, exp: el.exp};
			}
			return {color: src, startT: el.startT, exp: el.exp};
		});
	},

	// environmentColor enum -> color-scheme entry (0=Color0,1=Color1,2=Color0Boost,3=Color1Boost).
	schemeColor: function (cs, idx) {
		if (!cs) {
			return [1, 1, 1];
		}
		switch (idx) {
			case 1:
				return cs.color1 || [1, 1, 1];
			case 2:
				return cs.color0Boost || cs.color0 || [1, 1, 1];
			case 3:
				return cs.color1Boost || cs.color1 || [1, 1, 1];
			case 0:
			default:
				return cs.color0 || [1, 1, 1];
		}
	},

	tick: function () {
		if (!this.dome) {
			return;
		}
		const cam = this.el.sceneEl.camera;
		if (!cam) {
			return;
		}
		cam.getWorldPosition(this._camPos);
		this.dome.position.copy(this._camPos);
	},

	teardown: function () {
		if (this.dome) {
			this.el.sceneEl.object3D.remove(this.dome);
			this.dome.geometry.dispose();
			if (this.dome.material.uniforms.uGradient.value) {
				this.dome.material.uniforms.uGradient.value.dispose();
			}
			this.dome.material.dispose();
			this.dome = null;
		}
	},

	remove: function () {
		this.teardown();
	},
});
