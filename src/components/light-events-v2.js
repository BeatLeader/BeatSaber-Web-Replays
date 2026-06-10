/* global AFRAME, THREE */

/**
 * Step C — V2 lighting front for exported environments.
 *
 * Reimplements the decompiled LightSwitchEventEffect (docs/decompiled/LightSwitchEventEffect.cs
 * + BeatmapEventDataLightsExtensions.cs): maps basic beatmap events (_type/_value/_floatValue)
 * through the environment's switch table (eventType -> lightsId, from lighting.json) and pushes
 * colors into the shared light-rig via setColorForId.
 *
 * State is *sampled by song time* every tick rather than fired on event edges, so scrubbing /
 * seeking stays correct without replaying the timeline. The actual mesh coloring lives in
 * light-rig (the shared sink for both V2 and V3). Lives on the same entity as light-rig.
 *
 * value -> color slot (decompiled): 1-4 -> Color0, 5-8 -> Color1, 9-12 -> ColorW.
 * value -> behaviour: 0 off; 1/5/9 on; 4/8/12 on + fade to next; 2/6/10 flash (0.6s OutCubic);
 *                     -1/3/7/11 fade to black (1.5s OutExpo).
 */
AFRAME.registerComponent('light-events-v2', {
	init: function () {
		this.rig = this.el.components['light-rig'];
		this.byType = new Map(); // eventType -> sorted [{t, value, fv}]
		this.switches = []; // [{eventType, lightsId}]
		this.ready = false;

		// Color slots (Color0 / Color1 / ColorW). Defaults to red / blue / white; a future
		// export can override via lighting.json colorScheme.
		this.color0 = new THREE.Color(0.85, 0.08, 0.08);
		this.color1 = new THREE.Color(0.05, 0.45, 0.9);
		this.colorW = new THREE.Color(1, 1, 1);
		this.color0Boost = new THREE.Color(0.85, 0.08, 0.08);
		this.color1Boost = new THREE.Color(0.05, 0.45, 0.9);
		this.colorWBoost = new THREE.Color(1, 1, 1);
		this._boost = false;
		this._c = {r: 0, g: 0, b: 0, a: 0};

		const onLoad = evt => this.onChallenge(evt.detail);
		this.el.sceneEl.addEventListener('challengeloadend', onLoad);
	},

	onChallenge: function (detail) {
		const beatmaps = detail.beatmaps;
		if (!beatmaps) {
			return;
		}
		const beatData = beatmaps[detail.mode] && beatmaps[detail.mode][detail.difficulty];
		if (!beatData || !beatData._events) {
			return;
		}

		// Bucket every basic event by type, sorted by song time (seconds). The switch table
		// (eventType -> lightsId) is read from the rig lazily in tick, since lighting.json may
		// still be loading when this fires.
		this.byType.clear();
		for (const ev of beatData._events) {
			let arr = this.byType.get(ev._type);
			if (!arr) {
				arr = [];
				this.byType.set(ev._type, arr);
			}
			arr.push({t: ev._songTime, value: ev._value, fv: ev._floatValue === undefined ? 1 : ev._floatValue});
		}
		for (const arr of this.byType.values()) {
			arr.sort((a, b) => a.t - b.t);
		}
		this.ready = true;
	},

	tick: function () {
		if (!this.ready) {
			return;
		}
		const rig = this.rig || (this.rig = this.el.components['light-rig']);
		if (!rig || !rig.ready) {
			return;
		}
		if (!this._appliedScheme) {
			applyColorScheme(this, rig.lightingData && rig.lightingData.colorScheme);
			this._appliedScheme = true;
		}
		const song = this.el.sceneEl.components.song;
		if (!song) {
			return;
		}
		const now = song.getCurrentTime();
		this._boost = rig.boostActiveAt(now);

		const switches = rig.switches || [];
		for (let i = 0; i < switches.length; i++) {
			this.sampleSwitch(switches[i].lightsId, this.byType.get(switches[i].eventType), now);
		}
	},

	sampleSwitch: function (lightsId, arr, now) {
		if (!arr || arr.length === 0) {
			return;
		}
		// Active event = last whose time <= now.
		let lo = 0;
		let hi = arr.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (arr[mid].t <= now) {
				idx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (idx < 0) {
			this.setRgb(lightsId, 0, 0, 0, 0); // before first event: off
			return;
		}

		const E = arr[idx];
		const N = idx + 1 < arr.length ? arr[idx + 1] : null;
		const v = E.value;
		const slot = this.slotFor(v);

		if (v === 0) {
			this.setRgb(lightsId, 0, 0, 0, 0);
			return;
		}

		const tIn = now - E.t;

		if (v === 2 || v === 6 || v === 10) {
			// flash: highlight -> normal over 0.6s, OutCubic
			const k = outCubic(clamp01(tIn / 0.6));
			const a = E.fv * (1.4 + (1 - 1.4) * k); // brighten then settle
			this.setRgb(lightsId, slot.r, slot.g, slot.b, a);
			return;
		}

		if (v === -1 || v === 3 || v === 7 || v === 11) {
			// fade to black over 1.5s, OutExpo
			const k = outExpo(clamp01(tIn / 1.5));
			const a = E.fv * (1.4 * (1 - k));
			this.setRgb(lightsId, slot.r, slot.g, slot.b, a);
			return;
		}

		// on values: 1,5,9 constant; 4,8,12 fade toward the next event's color across the segment
		if ((v === 4 || v === 8 || v === 12) && N) {
			const seg = N.t - E.t;
			const t = seg > 0 ? clamp01(tIn / seg) : 1;
			const nslot = this.slotFor(N.value);
			const na = N.value === 0 ? 0 : N.fv;
			this.setRgb(
				lightsId,
				slot.r + (nslot.r - slot.r) * t,
				slot.g + (nslot.g - slot.g) * t,
				slot.b + (nslot.b - slot.b) * t,
				E.fv + (na - E.fv) * t
			);
			return;
		}

		this.setRgb(lightsId, slot.r, slot.g, slot.b, E.fv);
	},

	slotFor: function (value) {
		if (value >= 5 && value <= 8) {
			return this._boost ? this.color1Boost : this.color1;
		}
		if (value >= 9 && value <= 12) {
			return this._boost ? this.colorWBoost : this.colorW;
		}
		return this._boost ? this.color0Boost : this.color0; // -1,0,1,2,3,4
	},

	setRgb: function (lightsId, r, g, b, a) {
		this._c.r = r;
		this._c.g = g;
		this._c.b = b;
		this._c.a = a;
		this.rig.setColorForId(lightsId, this._c);
	},
});

// Apply the exported environment color scheme (Color0/Color1/ColorW) to a front's slots.
function applyColorScheme(front, scheme) {
	if (!scheme) {
		return;
	}
	const set = (col, v) => {
		if (v) {
			col.setRGB(v[0], v[1], v[2]);
		}
	};
	set(front.color0, scheme.color0);
	set(front.color1, scheme.color1);
	set(front.colorW, scheme.colorW);
	// Boost colors fall back to the normal slot when the env doesn't define them.
	set(front.color0Boost, scheme.color0Boost || scheme.color0);
	set(front.color1Boost, scheme.color1Boost || scheme.color1);
	set(front.colorWBoost, scheme.colorWBoost || scheme.colorW);
}

function clamp01(t) {
	return t < 0 ? 0 : t > 1 ? 1 : t;
}
function outCubic(t) {
	const u = 1 - t;
	return 1 - u * u * u;
}
function outExpo(t) {
	return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
