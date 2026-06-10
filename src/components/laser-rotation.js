/* global AFRAME, THREE */

/**
 * V2 event-driven laser rotation — the "rotating lasers" (e.g. bigmirror's RotatingLasersPair and the
 * spinning light wrappers). These objects are real exported nodes (their tube beams come from the
 * tube-light system); only the spin is missing. The V3 rotation path (light-events-v3) doesn't apply
 * to V2 envs, so this drives them from the basic beatmap events instead.
 *
 * Faithful port of the decompiled effects (docs/decompiled/):
 *   LightRotationEventEffect      — on a value>0 event: random start (0..180°) + ±direction, then spin
 *                                   continuously about _rotationVector at value*mult*20 °/s. value 0 → rest.
 *   LightPairRotationEventEffect  — a counter-rotating pair: _transformL/_transformR with ±_startRotation
 *                                   rest offset and a *shared* (mirrored) random start (0..360°)/direction.
 *
 * The exporter tags each rotated node with {rotId, eventType, axis, speedMult, startAngle, randomSign,
 * randomRange}; a pair's two sides share rotId so they get the same (mirrored) random draw. Because the
 * speed is constant between events, the angle is **closed-form** (last event ≤ now), so it's seekable
 * with no simulation. Coordinate note: BS rotates by `angle` about `axis` in the node's local space; the
 * exporter's Z-negation maps that to `angle` about `(-axis.x, -axis.y, axis.z)` (the rest quaternion is
 * already converted), and we post-multiply onto the rest pose.
 */
AFRAME.registerComponent('laser-rotation', {
	init: function () {
		this.nodes = []; // [{obj, rest:Quaternion, tags:[...]}]
		this.events = null; // beatData._events (V2 basic events)
		this.built = false;
		this._q = new THREE.Quaternion();
		this.el.addEventListener('light-rig-ready', () => this.tryBuild());
		this.el.sceneEl.addEventListener('challengeloadend', evt => this.onChallenge(evt.detail));
	},

	onChallenge: function (detail) {
		const beatData = detail.beatmaps && detail.beatmaps[detail.mode] && detail.beatmaps[detail.mode][detail.difficulty];
		this.events = (beatData && beatData._events) || null;
		this.built = false;
		this.nodes = [];
	},

	tryBuild: function () {
		if (this.built) {
			return;
		}
		const rig = this.el.components['light-rig'];
		if (!rig || !rig.ready || !rig.envRoot) {
			return;
		}
		this.build(rig.envRoot);
		this.built = true;
		if (this.nodes.length) {
			console.warn(`[laser-rotation] driving ${this.nodes.length} rotator node(s)`);
		}
	},

	build: function (root) {
		this.nodes = [];
		root.traverse(o => {
			const tags = o.userData && o.userData.laserRot;
			if (!Array.isArray(tags) || tags.length === 0) {
				return;
			}
			const built = tags.map(t => ({
				rotId: t.rotId || 0,
				// Unity axis -> glTF: negate x/y (the Z-negation conjugation), then normalize.
				axis: new THREE.Vector3(-t.axis[0], -t.axis[1], t.axis[2]).normalize(),
				speedMult: t.speedMult === undefined ? 1 : t.speedMult,
				startAngle: t.startAngle || 0,
				randomSign: t.randomSign || 1,
				randomRange: t.randomRange || 360,
				events: this.collectEvents(t.eventType),
			}));
			this.nodes.push({obj: o, rest: o.quaternion.clone(), tags: built});
		});
	},

	/** Sorted [{t, value}] of basic events of `type` (the effect's _event/_eventL/_eventR). */
	collectEvents: function (type) {
		const out = [];
		if (type === undefined || type === null || type < 0 || !this.events) {
			return out;
		}
		for (const e of this.events) {
			if (e._type === type) {
				out.push({t: e._songTime || 0, value: e._value || 0});
			}
		}
		out.sort((a, b) => a.t - b.t);
		return out;
	},

	tick: function () {
		if (!this.built || this.nodes.length === 0) {
			return;
		}
		const song = this.el.sceneEl.components.song;
		if (!song) {
			return;
		}
		const now = song.getCurrentTime();
		for (let i = 0; i < this.nodes.length; i++) {
			this.apply(this.nodes[i], now);
		}
	},

	apply: function (node, now) {
		node.obj.quaternion.copy(node.rest);
		for (let i = 0; i < node.tags.length; i++) {
			const tag = node.tags[i];
			const angle = this.angleAt(tag, now);
			this._q.setFromAxisAngle(tag.axis, angle * DEG2RAD);
			node.obj.quaternion.multiply(this._q);
		}
	},

	/** Closed-form rotation angle (deg) at song time `now` from the last event ≤ now. */
	angleAt: function (tag, now) {
		const list = tag.events;
		let lo = 0;
		let hi = list.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const m = (lo + hi) >> 1;
			if (list[m].t <= now) {
				idx = m;
				lo = m + 1;
			} else {
				hi = m - 1;
			}
		}
		if (idx < 0) {
			return tag.startAngle; // before any event: rest pose (+ pair's ±_startRotation offset)
		}
		const ev = list[idx];
		if (ev.value <= 0) {
			return tag.startAngle; // value 0 = stop + reset to rest
		}
		// Random start/direction, deterministic per (rotId, event time) so a pair's L/R sides — which
		// share rotId and fire on the same beat — draw the same values and mirror via randomSign.
		const rng = mulberry32((Math.imul(tag.rotId + 1, 0x9e3779b9) ^ Math.round(ev.t * 1000)) >>> 0);
		const randomStart = rng() * tag.randomRange;
		const randomDir = rng() < 0.5 ? 1 : -1;
		const offset = tag.randomSign * randomStart;
		const dir = tag.randomSign * randomDir;
		const speed = ev.value * tag.speedMult * 20 * dir; // BS kSpeedMultiplier = 20
		return tag.startAngle + offset + speed * (now - ev.t);
	},
});

const DEG2RAD = Math.PI / 180;

// mulberry32 — deterministic PRNG standing in for BS's injected IRandom (exact values needn't match,
// only be stable across seeks). Returns a function yielding [0,1).
function mulberry32(seed) {
	let s = seed >>> 0;
	return function () {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
