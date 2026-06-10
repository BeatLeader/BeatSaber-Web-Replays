/* global AFRAME */

/**
 * TrackLaneRings — "the spinner".
 *
 * Beat Saber's TrackLaneRingsManager spawns N copies of a single ring prefab spaced along Z, and a
 * TrackLaneRingsRotationEffect spins them with a per-ring propagation delay (the signature wave). The
 * exporter emits only the one template ring mesh (the prefab), tags the template + manager nodes, and
 * writes the manager/effect/spawner params into `lighting.json.rings`. This component reproduces the
 * rest at runtime: it clones the template `ringCount` times under the manager, then drives the wave
 * from the map's ring events.
 *
 * Faithful port of the decompiled classes (docs/decompiled/):
 *   TrackLaneRingsManager      — spawns rings at local (0,0,i*ringPositionStep)
 *   TrackLaneRing              — per-ring spring follow: rotZ/posZ lerp toward dest at flexy/move speed
 *   TrackLaneRingsRotationEffect          — startup buildup + active effects that propagate ring→ring
 *   TrackLaneRingsRotationEffectSpawner   — on a beatmap event: random step/dir, angle accumulates
 *   TrackLaneRingsPositionStepEffectSpawner — on a beatmap event: ring i moves to z=i*step ("zoom")
 *
 * The physics are an Euler/fixed-step simulation (BS's FixedUpdate), so to stay seekable the sim is
 * deterministic (seeded RNG, replayed from t=0 on any backward jump). Coordinate notes match the
 * exporter's Unity(LH)→glTF(RH) Z-negation: clones parent to the manager node and use local
 * (0,0,-i*step); a Unity Z rotation survives sign-preserved, so rotЗ maps straight to `rotation.z`.
 */
AFRAME.registerComponent('track-lane-rings', {
	FIXED_DT: 0.02, // Unity default fixed timestep (50 Hz) — TrackLaneRing physics run here.
	MAX_FORWARD_STEPS: 256, // clamp catch-up after a frame hitch / tab unblur
	MAX_RESEEK_STEPS: 30000, // clamp full replay on a backward seek (~10 min at 50 Hz)

	init: function () {
		this.systems = []; // built ring systems (see buildSystems)
		this.built = false;
		this.events = null; // beatData._events (basic V2 events; ring events live here)
		this.el.addEventListener('light-rig-ready', () => this.tryBuild());
		this.el.sceneEl.addEventListener('challengeloadend', evt => this.onChallenge(evt.detail));
	},

	onChallenge: function (detail) {
		const beatData = detail.beatmaps && detail.beatmaps[detail.mode] && detail.beatmaps[detail.mode][detail.difficulty];
		this.events = (beatData && beatData._events) || null;
		this.built = false;
		this.systems = [];
	},

	tryBuild: function () {
		if (this.built) {
			return;
		}
		const rig = this.el.components['light-rig'];
		if (!rig || !rig.ready || !rig.envRoot || !rig.lightingData) {
			return;
		}
		const defs = rig.lightingData.rings;
		if (!defs || defs.length === 0) {
			this.built = true; // nothing to do for this env
			return;
		}
		this.buildSystems(rig.envRoot, defs);
		this.built = true;
		const total = this.systems.reduce((n, s) => n + s.rings.length, 0);
		console.warn(`[track-lane-rings] built ${this.systems.length} ring system(s), ${total} ring(s)`);
	},

	/** Locate each system's manager + template nodes, clone the template, and seed sim state. */
	buildSystems: function (root, defs) {
		const managers = new Map(); // id -> node
		const templates = new Map(); // id -> node
		root.traverse(o => {
			const ud = o.userData;
			if (!ud) {
				return;
			}
			if (ud.ringManager !== undefined && ud.ringManager !== null) {
				managers.set(ud.ringManager, o);
			}
			if (ud.ringTemplate !== undefined && ud.ringTemplate !== null) {
				templates.set(ud.ringTemplate, o);
			}
		});

		for (const def of defs) {
			const manager = managers.get(def.id);
			const template = templates.get(def.id);
			if (!manager || !template) {
				console.warn(`[track-lane-rings] system ${def.id}: missing ${!manager ? 'manager' : 'template'} node — skipped`);
				continue;
			}

			// The template is the prefab source — hide it; the clones are the real rings.
			template.visible = false;

			const step = def.ringPositionStep || 0;
			const rings = [];
			for (let i = 0; i < (def.ringCount || 0); i++) {
				const obj = template.clone(true);
				obj.visible = true;
				obj.userData = {ringClone: def.id, ringIndex: i};
				// BS TrackLaneRing.Init overwrites localPosition/rotation; only the prefab scale carries
				// over. Parenting to the manager reproduces both spawn modes (children, or world via the
				// manager's forward) since the manager node already holds the world transform.
				obj.position.set(0, 0, -i * step); // Unity local (0,0,i*step) -> glTF -Z
				obj.rotation.set(0, 0, 0);
				manager.add(obj);
				rings.push({
					obj,
					rotZ: 0,
					destRotZ: 0,
					rotSpeed: 0,
					posZ: i * step,
					destPosZ: 0,
					moveSpeed: 0,
				});
			}

			this.systems.push({
				def,
				rings,
				rot: def.rotation || null,
				step: def.positionStep || null,
				rotEvents: this.collectEvents(def.rotation && def.rotation.eventType),
				stepEvents: this.collectEvents(def.positionStep && def.positionStep.eventType),
				active: [], // live RingRotationEffects (the propagating waves)
				rngState: 0,
				simTime: 0,
				nextRot: 0,
				nextStep: 0,
			});
		}

		for (const s of this.systems) {
			this.resetSim(s);
		}
	},

	/** Sorted song-times of basic events of `type` (the spawner's _beatmapEventType). */
	collectEvents: function (type) {
		if (type === undefined || type === null || type < 0 || !this.events) {
			return [];
		}
		const out = [];
		for (const e of this.events) {
			if (e._type === type) {
				out.push(e._songTime || 0);
			}
		}
		out.sort((a, b) => a - b);
		return out;
	},

	/** Restore the system to its t=0 state: rings at rest, RNG reseeded, startup wave queued. */
	resetSim: function (s) {
		const step = s.def.ringPositionStep || 0;
		for (let i = 0; i < s.rings.length; i++) {
			const r = s.rings[i];
			r.rotZ = 0;
			r.destRotZ = 0;
			r.rotSpeed = 0;
			r.posZ = i * step;
			r.destPosZ = 0;
			r.moveSpeed = 0;
		}
		s.active.length = 0;
		// TrackLaneRingsRotationEffect.Start adds the one-time startup buildup wave.
		if (s.rot) {
			s.active.push({
				angle: s.rot.startupAngle || 0,
				step: s.rot.startupStep || 0,
				propagationSpeed: s.rot.startupPropagationSpeed || 1,
				flexySpeed: s.rot.startupFlexySpeed || 0,
				progressPos: 0,
			});
		}
		s.rngState = (0x9e3779b9 + s.def.id * 0x85ebca6b) >>> 0; // deterministic per-system seed
		s.simTime = 0;
		s.nextRot = 0;
		s.nextStep = 0;
	},

	tick: function () {
		if (!this.built || this.systems.length === 0) {
			return;
		}
		const song = this.el.sceneEl.components.song;
		if (!song) {
			return;
		}
		const now = song.getCurrentTime();
		for (let i = 0; i < this.systems.length; i++) {
			this.stepSystem(this.systems[i], now);
		}
	},

	/** Advance one system's fixed-step sim to song time `now`, then push transforms to the rings. */
	stepSystem: function (s, now) {
		const dt = this.FIXED_DT;
		if (now < s.simTime - 1e-4) {
			this.resetSim(s); // backward seek — replay deterministically from the start
		}

		let budget = s.simTime === 0 && now > 1 ? this.MAX_RESEEK_STEPS : this.MAX_FORWARD_STEPS;
		while (s.simTime + dt <= now + 1e-6 && budget-- > 0) {
			const chunkEnd = s.simTime + dt;

			// Events that fire within this fixed step queue/apply their effect (BeatmapCallbacks).
			while (s.nextRot < s.rotEvents.length && s.rotEvents[s.nextRot] <= chunkEnd) {
				this.handleRotEvent(s);
				s.nextRot++;
			}
			while (s.nextStep < s.stepEvents.length && s.stepEvents[s.nextStep] <= chunkEnd) {
				this.handleStepEvent(s, s.nextStep);
				s.nextStep++;
			}

			this.fixedUpdateEffects(s); // TrackLaneRingsRotationEffect.FixedUpdate (exec order -3)
			this.fixedUpdateRings(s, dt); // manager.FixedUpdate -> ring.FixedUpdateRing (-2)
			s.simTime = chunkEnd;
		}
		if (budget <= 0) {
			s.simTime = now; // gave up catching up; resync the clock so we don't spin next frame
		}

		this.applyTransforms(s);
	},

	// TrackLaneRingsRotationEffectSpawner.HandleBeatmapEvent
	handleRotEvent: function (s) {
		const rot = s.rot;
		if (!rot) {
			return;
		}
		const rs = rot.step || 0;
		let step;
		if (rot.stepType === 0) {
			step = this.rngRange(s, 0, rs); // Range0ToMax
		} else if (rot.stepType === 2) {
			step = this.rngBool(s) ? rs : 0; // MaxOr0
		} else {
			step = this.rngRange(s, -rs, rs); // Range (default)
		}
		const dir = this.rngBool(s) ? -1 : 1; // BS: GetBool() -> -1, else 1
		const angle = (s.rings.length ? s.rings[0].destRotZ : 0) + (rot.rotation || 0) * dir;
		s.active.push({
			angle,
			step,
			propagationSpeed: rot.propagationSpeed || 1,
			flexySpeed: rot.flexySpeed || 0,
			progressPos: 0,
		});
	},

	// TrackLaneRingsPositionStepEffectSpawner.HandleBeatmapEvent (sameTypeIndex parity picks min/max)
	handleStepEvent: function (s, sameTypeIndex) {
		const ps = s.step;
		if (!ps) {
			return;
		}
		const amount = sameTypeIndex % 2 === 0 ? ps.maxPositionStep || 0 : ps.minPositionStep || 0;
		for (let i = 0; i < s.rings.length; i++) {
			s.rings[i].destPosZ = i * amount;
			s.rings[i].moveSpeed = ps.moveSpeed || 0;
		}
	},

	// TrackLaneRingsRotationEffect.FixedUpdate — propagate each active wave ring→ring.
	fixedUpdateEffects: function (s) {
		const rings = s.rings;
		for (let n = s.active.length - 1; n >= 0; n--) {
			const e = s.active[n];
			for (let i = e.progressPos; i < e.progressPos + e.propagationSpeed && i < rings.length; i++) {
				rings[i].destRotZ = e.angle + i * e.step;
				rings[i].rotSpeed = e.flexySpeed;
			}
			e.progressPos += e.propagationSpeed;
			if (e.progressPos >= rings.length) {
				s.active.splice(n, 1);
			}
		}
	},

	// TrackLaneRing.FixedUpdateRing — spring follow toward dest rotation/position.
	fixedUpdateRings: function (s, dt) {
		for (let i = 0; i < s.rings.length; i++) {
			const r = s.rings[i];
			r.rotZ = lerp(r.rotZ, r.destRotZ, clamp01(dt * r.rotSpeed));
			r.posZ = lerp(r.posZ, r.destPosZ, clamp01(dt * r.moveSpeed));
		}
	},

	applyTransforms: function (s) {
		for (let i = 0; i < s.rings.length; i++) {
			const r = s.rings[i];
			r.obj.rotation.set(0, 0, r.rotZ * DEG2RAD); // Unity Z rotation -> glTF +Z (sign preserved)
			r.obj.position.set(0, 0, -r.posZ); // Unity local +Z -> glTF -Z
		}
	},

	// Deterministic RNG (mulberry32) standing in for BS's injected IRandom — exact angles needn't
	// match BS, only be stable across seeks so the wave replays identically.
	rngNext: function (s) {
		s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
		let t = s.rngState;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	},
	rngRange: function (s, min, max) {
		return min + this.rngNext(s) * (max - min);
	},
	rngBool: function (s) {
		return this.rngNext(s) < 0.5;
	},
});

const DEG2RAD = Math.PI / 180;

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function clamp01(t) {
	return t < 0 ? 0 : t > 1 ? 1 : t;
}
