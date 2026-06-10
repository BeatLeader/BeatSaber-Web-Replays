/* global AFRAME, THREE */
import {EaseType, Interpolate} from '../utils';

/**
 * Step D — V3 lighting front for exported environments.
 *
 * Ports the decompiled V3 light-group pipeline (docs/decompiled/): the v3 beatmap's
 * lightColorEventBoxGroups are expanded (per IndexFilter + beat/brightness distribution,
 * BeatmapEventDataBox/LightColorBeatmapEventDataBox + IndexFilterConverter) into per-element
 * color events, keyed to lightId = group.startLightId + elementId (LightColorGroupEffectManager),
 * then sampled by song time (LightColorGroupEffect) and pushed to the shared light-rig.
 *
 * This is the path Weave (a V3 environment) actually uses. The box groups survive on beatData
 * (the map postprocessor converts basicBeatmapEvents -> _events but leaves the v3 light box
 * groups untouched). Times are beats -> seconds via constant BPM.
 *
 * Known simplifications (POC): no random/shuffle filters, constant BPM, strobe ignored,
 * rotation/translation groups not yet applied (motion, not lit/unlit). v3 transitions are
 * only None/Linear so color tweens are linear.
 */
AFRAME.registerComponent('light-events-v3', {
	init: function () {
		this.rig = this.el.components['light-rig'];
		this.timelines = new Map(); // lightId -> sorted [{t, r,g,b, a, ease}]
		this.rotTimelines = new Map(); // `${groupId}:${axis}:${elementId}` -> sorted rotation events
		this.rotNodes = []; // [{object3D, tags:[{groupId,axis,elementId,mirror}]}]
		this.transTimelines = new Map(); // `${groupId}:${axis}:${elementId}` -> sorted translation events
		this.transNodes = []; // [{object3D, tags}]
		this.transLimits = new Map(); // `${groupId}:${axis}` -> {tl:[x,y], dl:[x,y]}
		this.fxTimelines = new Map(); // `${groupId}:${elementId}` -> sorted float-fx events
		this.fxNodes = []; // [{object3D, tags, base}]
		this.raw = null; // lightColorEventBoxGroups (raw v3)
		this.rawRot = null; // lightRotationEventBoxGroups (raw v3)
		this.rawTrans = null; // lightTranslationEventBoxGroups (raw v3)
		this.rawFx = null; // vfxEventBoxGroups (raw v3)
		this.fxColl = null; // _fxEventsCollection._fl (float fx values)
		this.bpm = 0;
		this.built = false;
		this._q = new THREE.Quaternion();
		this._v = new THREE.Vector3();
		this._axisVec = {x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1)};

		// Color slots (Color0 / Color1 / ColorW) + boost variants. Match the V2 front.
		this.slots = [new THREE.Color(0.85, 0.08, 0.08), new THREE.Color(0.05, 0.45, 0.9), new THREE.Color(1, 1, 1)];
		this.boostSlots = [new THREE.Color(0.85, 0.08, 0.08), new THREE.Color(0.05, 0.45, 0.9), new THREE.Color(1, 1, 1)];
		this._boost = false;
		this._c = {r: 0, g: 0, b: 0, a: 0};

		this.el.sceneEl.addEventListener('challengeloadend', evt => this.onChallenge(evt.detail));
	},

	onChallenge: function (detail) {
		const beatmaps = detail.beatmaps;
		const beatData = beatmaps && beatmaps[detail.mode] && beatmaps[detail.mode][detail.difficulty];
		if (!beatData) {
			return;
		}
		// Raw v3 box groups survive postprocessing (only basicBeatmapEvents are translated).
		this.beatData = beatData;
		this.raw = beatData.lightColorEventBoxGroups || null;
		this.rawRot = beatData.lightRotationEventBoxGroups || null;
		this.rawTrans = beatData.lightTranslationEventBoxGroups || null;
		this.rawFx = beatData.vfxEventBoxGroups || null;
		this.fxColl = (beatData._fxEventsCollection && beatData._fxEventsCollection._fl) || null;
		this.bpm = (detail.info && detail.info._beatsPerMinute) || beatData._beatsPerMinute || 0;
		this.built = false;
		this.timelines.clear();
		this.rotTimelines.clear();
		this.rotNodes = [];
		this.transTimelines.clear();
		this.transNodes = [];
		this.transLimits.clear();
		this.fxTimelines.clear();
		this.fxNodes = [];
	},

	tryBuild: function () {
		if (this.built || !this.bpm || (!this.raw && !this.rawRot && !this.rawTrans && !this.rawFx)) {
			return;
		}
		const rig = this.rig || (this.rig = this.el.components['light-rig']);
		if (!rig || !rig.ready) {
			return;
		}
		this.expand(rig);
		this.built = true;
		console.warn(
			`[light-events-v3] expanded ${this.timelines.size} color + ${this.rotTimelines.size} rotation + ` +
				`${this.transTimelines.size} translation + ${this.fxTimelines.size} fx timelines ` +
				`(${this.rotNodes.length} rot, ${this.transNodes.length} trans, ${this.fxNodes.length} fx nodes)`
		);
	},

	/** Expand box groups -> per-lightId sorted color-event timelines (one-time, at load). */
	expand: function (rig) {
		// Beat -> seconds via the map's timeConvertor (handles variable BPM / bpmEvents), the same
		// converter used for notes/events; fall back to constant BPM if it isn't available yet.
		this.secPerBeat = 60 / this.bpm;
		const toSec =
			this.beatData && typeof this.beatData.timeConvertor === 'function'
				? this.beatData.timeConvertor
				: b => b * this.secPerBeat;

		// Use the environment's real lighting colors (exported in lighting.json) when present.
		const cs = rig.lightingData && rig.lightingData.colorScheme;
		if (cs) {
			const set = (col, v) => {
				if (v) col.setRGB(v[0], v[1], v[2]);
			};
			set(this.slots[0], cs.color0);
			set(this.slots[1], cs.color1);
			set(this.slots[2], cs.colorW);
			set(this.boostSlots[0], cs.color0Boost || cs.color0);
			set(this.boostSlots[1], cs.color1Boost || cs.color1);
			set(this.boostSlots[2], cs.colorWBoost || cs.colorW);
		}

		this.expandColor(rig, toSec);
		this.expandRotation(rig, toSec);
		this.expandTranslation(rig, toSec);
		this.expandFx(rig, toSec);
		this.collectRotNodes(rig);
		this.collectTransNodes(rig);
		this.collectFxNodes(rig);
	},

	/** Expand vfxEventBoxGroups -> per (groupId, elementId) float-value timelines. */
	expandFx: function (rig, toSec) {
		if (!this.rawFx || !this.fxColl) {
			return;
		}
		for (const grp of this.rawFx) {
			const groupBeat = grp.b || 0;
			const gdef = rig.groupById(grp.g);
			if (!gdef) {
				continue;
			}
			const groupSize = gdef.count;

			for (const box of grp.e || []) {
				const filter = buildIndexFilter(box.f || {}, groupSize);
				if (!filter || filter.entries.length === 0) {
					continue;
				}
				// box.l indexes into _fxEventsCollection._fl; build the base list of {b,v,e,p}.
				const baseList = (box.l || []).map(i => this.fxColl[i]).filter(Boolean);
				if (baseList.length === 0) {
					continue;
				}
				const lastBeat = baseList[baseList.length - 1].b || 0;
				const durCount = filter.limitsDuration ? filter.visibleCount : filter.count;
				const beatStep = getBeatStep(box.d || 0, box.w || 0, durCount, lastBeat);
				const distCount = filter.limitsDistribution ? filter.visibleCount : filter.count;
				const affectFirst = box.b === 1;
				const distEase = box.i;

				for (const entry of filter.entries) {
					if (entry.element >= groupSize) {
						continue;
					}
					const key = grp.g + ':' + entry.element;
					const durOffset = entry.durationOrder * beatStep;
					for (let j = 0; j < baseList.length; j++) {
						const base = baseList[j];
						const off = getDistribution(j === 0, entry.distributionOrder, affectFirst, box.s || 0, box.t || 0, distCount, distEase);
						let arr = this.fxTimelines.get(key);
						if (!arr) {
							arr = [];
							this.fxTimelines.set(key, arr);
						}
						arr.push({
							t: toSec(groupBeat + (base.b || 0) + durOffset),
							value: (base.v || 0) + off,
							ease: base.i === undefined ? -1 : base.i,
							usePrev: base.p === 1,
						});
					}
				}
			}
		}

		for (const arr of this.fxTimelines.values()) {
			arr.sort((a, b) => a.t - b.t);
			for (let i = 0; i < arr.length; i++) {
				if (arr[i].usePrev && i > 0) {
					arr[i].value = arr[i - 1].value;
				}
			}
		}
	},

	collectFxNodes: function (rig) {
		const root = rig.envRoot;
		if (!root) {
			return;
		}
		root.traverse(o => {
			if (o.userData && Array.isArray(o.userData.fx) && o.userData.fx.length > 0) {
				this.fxNodes.push({object3D: o, tags: o.userData.fx, base: o.scale.clone()});
			}
		});
	},

	expandColor: function (rig, toSec) {
		if (!this.raw) {
			return;
		}
		for (const grp of this.raw) {
			const groupBeat = grp.b || 0;
			const gdef = rig.groupById(grp.g);
			if (!gdef) {
				continue;
			}
			const groupSize = gdef.count;
			const startLightId = gdef.startLightId;
			const boxes = grp.e || [];

			for (const box of boxes) {
				const filter = buildIndexFilter(box.f || {}, groupSize);
				if (!filter || filter.entries.length === 0) {
					continue;
				}
				const baseList = box.e || [];
				if (baseList.length === 0) {
					continue;
				}
				const lastBeat = baseList[baseList.length - 1].b || 0;
				const durCount = filter.limitsDuration ? filter.visibleCount : filter.count;
				const beatStep = getBeatStep(box.d || 0, box.w || 0, durCount, lastBeat);
				const distCount = filter.limitsDistribution ? filter.visibleCount : filter.count;
				const affectFirst = box.b === 1;

				for (const entry of filter.entries) {
					if (entry.element >= groupSize) {
						continue;
					}
					const lightId = startLightId + entry.element;
					const durOffset = entry.durationOrder * beatStep;

					for (let j = 0; j < baseList.length; j++) {
						const base = baseList[j];
						const bdist = getDistribution(j === 0, entry.distributionOrder, affectFirst, box.r || 0, box.t || 0, distCount);
						const beatAbs = groupBeat + (base.b || 0) + durOffset;
						this.push(lightId, {
							t: toSec(beatAbs),
							colorType: base.c,
							brightness: (base.s || 0) + bdist,
							transition: base.i || 0,
							strobeFreq: base.f || 0, // strobes per beat
							strobeBri: base.sb || 0, // brightness during strobe off-phase
							strobeFade: base.sf === 1,
						});
					}
				}
			}
		}

		// Resolve each timeline: sort, apply extend (usePreviousValue), record slot index + alpha.
		// Actual RGB is resolved at sample time so boost can switch palettes mid-song.
		for (const list of this.timelines.values()) {
			list.sort((a, b) => a.t - b.t);
			for (let i = 0; i < list.length; i++) {
				const ev = list[i];
				const extend = ev.transition === 2; // Extend
				ev.ease = ev.transition === 1 ? 1 : 0; // Interpolate -> Linear, else None
				const colorType = extend && i > 0 ? list[i - 1].colorType : ev.colorType;
				ev.slot = colorType === 1 ? 1 : colorType === 2 ? 2 : 0; // Color0/1/W index
				ev.a = ev.brightness;
			}
		}
	},

	push: function (lightId, ev) {
		let arr = this.timelines.get(lightId);
		if (!arr) {
			arr = [];
			this.timelines.set(lightId, arr);
		}
		arr.push(ev);
	},

	/** Expand lightRotationEventBoxGroups -> per (groupId, axis, elementId) rotation timelines. */
	expandRotation: function (rig, toSec) {
		if (!this.rawRot) {
			return;
		}
		const axisNames = ['x', 'y', 'z'];

		for (const grp of this.rawRot) {
			const groupBeat = grp.b || 0;
			const gdef = rig.groupById(grp.g);
			if (!gdef) {
				continue;
			}
			const groupSize = gdef.count;
			const boxes = grp.e || [];

			for (const box of boxes) {
				const filter = buildIndexFilter(box.f || {}, groupSize);
				if (!filter || filter.entries.length === 0) {
					continue;
				}
				const baseList = box.l || []; // rotation box uses 'l' for its data list
				if (baseList.length === 0) {
					continue;
				}
				const axis = axisNames[box.a || 0];
				const flip = (box.r || 0) === 1 ? -1 : 1;
				const lastBeat = baseList[baseList.length - 1].b || 0;
				const durCount = filter.limitsDuration ? filter.visibleCount : filter.count;
				const beatStep = getBeatStep(box.d || 0, box.w || 0, durCount, lastBeat);
				const distCount = filter.limitsDistribution ? filter.visibleCount : filter.count;
				const affectFirst = box.b === 1;
				const distEase = box.i;

				for (const entry of filter.entries) {
					if (entry.element >= groupSize) {
						continue;
					}
					const key = grp.g + ':' + axis + ':' + entry.element;
					const durOffset = entry.durationOrder * beatStep;

					for (let j = 0; j < baseList.length; j++) {
						const base = baseList[j];
						let dist = getDistribution(j === 0, entry.distributionOrder, affectFirst, box.s || 0, box.t || 0, distCount, distEase);
						const extraLoops = Math.floor(Math.abs(dist) / 360);
						dist = (Math.abs(dist) % 360) * Math.sign(dist);
						let arr = this.rotTimelines.get(key);
						if (!arr) {
							arr = [];
							this.rotTimelines.set(key, arr);
						}
						arr.push({
							t: toSec(groupBeat + (base.b || 0) + durOffset),
							rotation: (dist + (base.r || 0)) * flip,
							ease: base.e === undefined ? -1 : base.e,
							loopCount: (base.l || 0) + extraLoops,
							direction: base.o || 0,
							usePrev: base.p === 1,
						});
					}
				}
			}
		}

		for (const arr of this.rotTimelines.values()) {
			arr.sort((a, b) => a.t - b.t);
			for (let i = 0; i < arr.length; i++) {
				if (arr[i].usePrev && i > 0) {
					arr[i].rotation = arr[i - 1].rotation; // usePreviousEventRotationValue
				}
			}
		}
	},

	/** Collect GLB nodes carrying rotation tags (extras.rot) for fast per-frame driving. */
	collectRotNodes: function (rig) {
		const root = rig.envRoot;
		if (!root) {
			return;
		}
		root.traverse(o => {
			if (o.userData && Array.isArray(o.userData.rot) && o.userData.rot.length > 0) {
				this.rotNodes.push({object3D: o, tags: o.userData.rot});
			}
		});
	},

	/** Expand lightTranslationEventBoxGroups -> per (groupId, axis, elementId) translation timelines. */
	expandTranslation: function (rig, toSec) {
		// Per (groupId, axis) translation/distribution limits (from lighting.json translationGroups).
		const tg = (rig.lightingData && rig.lightingData.translationGroups) || [];
		for (const g of tg) {
			this.transLimits.set(g.groupId + ':' + g.axis, {tl: g.translationLimits, dl: g.distributionLimits});
		}

		if (!this.rawTrans) {
			return;
		}
		const axisNames = ['x', 'y', 'z'];

		for (const grp of this.rawTrans) {
			const groupBeat = grp.b || 0;
			const gdef = rig.groupById(grp.g);
			if (!gdef) {
				continue;
			}
			const groupSize = gdef.count;
			const boxes = grp.e || [];

			for (const box of boxes) {
				const filter = buildIndexFilter(box.f || {}, groupSize);
				if (!filter || filter.entries.length === 0) {
					continue;
				}
				const baseList = box.l || []; // translation box uses 'l' for its data list
				if (baseList.length === 0) {
					continue;
				}
				const axis = axisNames[box.a || 0];
				const flip = (box.r || 0) === 1 ? -1 : 1;
				const lastBeat = baseList[baseList.length - 1].b || 0;
				const durCount = filter.limitsDuration ? filter.visibleCount : filter.count;
				const beatStep = getBeatStep(box.d || 0, box.w || 0, durCount, lastBeat);
				const distCount = filter.limitsDistribution ? filter.visibleCount : filter.count;
				const affectFirst = box.b === 1;
				const distEase = box.i;

				for (const entry of filter.entries) {
					if (entry.element >= groupSize) {
						continue;
					}
					const key = grp.g + ':' + axis + ':' + entry.element;
					const durOffset = entry.durationOrder * beatStep;

					for (let j = 0; j < baseList.length; j++) {
						const base = baseList[j];
						const dist = getDistribution(j === 0, entry.distributionOrder, affectFirst, box.s || 0, box.t || 0, distCount, distEase);
						let arr = this.transTimelines.get(key);
						if (!arr) {
							arr = [];
							this.transTimelines.set(key, arr);
						}
						arr.push({
							t: toSec(groupBeat + (base.b || 0) + durOffset),
							translation: (base.t || 0) * flip,
							distribution: dist * flip,
							ease: base.e === undefined ? -1 : base.e,
							usePrev: base.p === 1,
						});
					}
				}
			}
		}

		for (const arr of this.transTimelines.values()) {
			arr.sort((a, b) => a.t - b.t);
			for (let i = 0; i < arr.length; i++) {
				if (arr[i].usePrev && i > 0) {
					arr[i].translation = arr[i - 1].translation; // usePreviousEventTranslationValue
				}
			}
		}
	},

	collectTransNodes: function (rig) {
		const root = rig.envRoot;
		if (!root) {
			return;
		}
		root.traverse(o => {
			if (o.userData && Array.isArray(o.userData.trans) && o.userData.trans.length > 0) {
				this.transNodes.push({object3D: o, tags: o.userData.trans});
			}
		});
	},

	tick: function () {
		this.tryBuild();
		if (!this.built) {
			return;
		}
		const rig = this.rig;
		const song = this.el.sceneEl.components.song;
		if (!rig || !rig.ready || !song) {
			return;
		}
		const now = song.getCurrentTime();
		this._boost = rig.boostActiveAt(now);
		this._slots = this._boost ? this.boostSlots : this.slots;

		for (const [lightId, list] of this.timelines) {
			this.sample(lightId, list, now);
		}

		for (let i = 0; i < this.rotNodes.length; i++) {
			this.sampleRotation(this.rotNodes[i], now);
		}
		for (let i = 0; i < this.transNodes.length; i++) {
			this.sampleTranslation(this.transNodes[i], now);
		}
		for (let i = 0; i < this.fxNodes.length; i++) {
			this.sampleFx(this.fxNodes[i], now);
		}
	},

	/**
	 * Drive a FloatFx-tagged node. `alpha` -> material opacity (faithful). `displace` -> approximate
	 * per-axis scale from the displacement ranges (the real effect is vertex-shader displacement via
	 * _DisplacementAxisMultiplier, which needs the deferred custom shaders to be exact).
	 */
	sampleFx: function (node, now) {
		for (let i = 0; i < node.tags.length; i++) {
			const tag = node.tags[i];
			const v = this.fxValueAt(this.fxTimelines.get(tag.groupId + ':' + tag.elementId), now);
			if (v === null) {
				continue;
			}
			if (tag.type === 'displace') {
				const r = tag.ranges || [0, 0, 0];
				node.object3D.scale.set(node.base.x * (1 + v * r[0]), node.base.y * (1 + v * r[1]), node.base.z * (1 + v * r[2]));
			} else if (tag.type === 'alpha') {
				node.object3D.traverse(o => {
					if (!o.isMesh) return;
					const mats = Array.isArray(o.material) ? o.material : [o.material];
					for (const m of mats) {
						m.transparent = true;
						m.opacity = v;
					}
				});
			}
		}
	},

	fxValueAt: function (list, now) {
		if (!list || list.length === 0) {
			return null;
		}
		let lo = 0;
		let hi = list.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid].t <= now) {
				idx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (idx < 0) {
			return 0; // before first event the FloatTween rests at 0
		}
		const E = list[idx];
		const N = idx + 1 < list.length ? list[idx + 1] : null;
		if (N && N.ease !== EaseType.None && now < N.t) {
			return E.value + (N.value - E.value) * Interpolate((now - E.t) / (N.t - E.t), N.ease);
		}
		return E.value;
	},

	/** Drive a translation-tagged node from its (groupId, axis, elementId) timeline(s). */
	sampleTranslation: function (node, now) {
		this._v.set(0, 0, 0);
		let any = false;
		for (let i = 0; i < node.tags.length; i++) {
			const tag = node.tags[i];
			const limits = this.transLimits.get(tag.groupId + ':' + tag.axis);
			if (!limits) {
				continue;
			}
			const list = this.transTimelines.get(tag.groupId + ':' + tag.axis + ':' + tag.elementId);
			const pos = this.translationAt(list, now, limits, tag.mirror);
			if (pos === null) {
				continue;
			}
			any = true;
			// Unity localPosition along the axis; our GLB negates Z.
			if (tag.axis === 'x') this._v.x = pos;
			else if (tag.axis === 'y') this._v.y = pos;
			else this._v.z = -pos;
		}
		if (any) {
			node.object3D.position.copy(this._v);
		}
	},

	translationAt: function (list, now, limits, mirror) {
		if (!list || list.length === 0) {
			return null;
		}
		let lo = 0;
		let hi = list.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid].t <= now) {
				idx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (idx < 0) {
			return 0; // before first event the tween rests at 0 (matches LightTranslationGroupEffect)
		}
		const E = list[idx];
		const N = idx + 1 < list.length ? list[idx + 1] : null;
		const from = computeTranslation(E.translation, limits.tl, E.distribution, limits.dl, mirror);
		if (N && N.ease !== EaseType.None && now < N.t) {
			const to = computeTranslation(N.translation, limits.tl, N.distribution, limits.dl, mirror);
			const k = Interpolate((now - E.t) / (N.t - E.t), N.ease);
			return from + (to - from) * k;
		}
		return from;
	},

	/** Drive a rotation-tagged node from its (groupId, axis, elementId) timeline(s). */
	sampleRotation: function (node, now) {
		const obj = node.object3D;
		for (let i = 0; i < node.tags.length; i++) {
			const tag = node.tags[i];
			const list = this.rotTimelines.get(tag.groupId + ':' + tag.axis + ':' + tag.elementId);
			const theta = this.rotationAt(list, now); // Unity degrees (after Repeat / tween)
			if (theta === null) {
				continue;
			}
			// Unity SetRotation applies mirror before the axis; our GLB negates Z, so X/Y flip
			// sign and Z keeps it (see design doc §14 coordinate notes).
			const phi = tag.mirror ? -theta : theta;
			const deg = tag.axis === 'z' ? phi : -phi;
			this._q.setFromAxisAngle(this._axisVec[tag.axis], deg * DEG2RAD);
			if (node.tags.length === 1) {
				obj.quaternion.copy(this._q);
			} else if (i === 0) {
				obj.quaternion.copy(this._q);
			} else {
				obj.quaternion.multiply(this._q);
			}
		}
	},

	rotationAt: function (list, now) {
		if (!list || list.length === 0) {
			return null;
		}
		let lo = 0;
		let hi = list.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid].t <= now) {
				idx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (idx < 0) {
			return 0;
		}
		const E = list[idx];
		const N = idx + 1 < list.length ? list[idx + 1] : null;
		let angle = repeat360(E.rotation);
		if (N && N.ease !== EaseType.None && now < N.t) {
			const target = computeTargetAngle(angle, repeat360(N.rotation), N.loopCount, N.direction);
			const k = Interpolate((now - E.t) / (N.t - E.t), N.ease);
			angle = angle + (target - angle) * k;
		}
		return angle;
	},

	sample: function (lightId, list, now) {
		// Active event = last with t <= now (binary search).
		let lo = 0;
		let hi = list.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid].t <= now) {
				idx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (idx < 0) {
			this._c.r = this._c.g = this._c.b = this._c.a = 0; // before first event: off
			this.rig.setColorForId(lightId, this._c);
			return;
		}

		const E = list[idx];
		const N = idx + 1 < list.length ? list[idx + 1] : null;
		const eC = this._slots[E.slot]; // resolve palette (normal/boost) at sample time

		// Transition into N is driven by N's ease (LightColorGroupEffect): lerp E -> N if eased.
		if (N && N.ease !== 0 && now < N.t) {
			const nC = this._slots[N.slot];
			const t = (now - E.t) / (N.t - E.t);
			this._c.r = eC.r + (nC.r - eC.r) * t;
			this._c.g = eC.g + (nC.g - eC.g) * t;
			this._c.b = eC.b + (nC.b - eC.b) * t;
			this._c.a = E.a + (N.a - E.a) * t;
		} else {
			this._c.r = eC.r;
			this._c.g = eC.g;
			this._c.b = eC.b;
			this._c.a = E.a;
		}

		// Strobe (LightColorGroupEffect.SetColor): modulate brightness between the color's alpha
		// and strobeBrightness at the (ramping) strobe frequency. Frequencies are per beat -> per second.
		if (E.strobeFreq > 0 || (N && N.strobeFreq > 0)) {
			const dur = (N ? N.t : E.t + 1000) - E.t;
			if (dur > 0) {
				const fromFreq = E.strobeFreq / this.secPerBeat;
				const toFreq = (N ? N.strobeFreq : E.strobeFreq) / this.secPerBeat;
				const num = now - E.t;
				const num2 = (num * num) / (2 * dur);
				let phase = (-fromFreq * num2 + fromFreq * num + toFreq * num2) % 1;
				if (phase < 0) phase += 1;
				const tt = num / dur;
				const sAlpha = E.strobeBri + ((N ? N.strobeBri : E.strobeBri) - E.strobeBri) * tt;
				if (E.strobeFade) {
					const k = Interpolate(1 - Math.abs(phase * 2 - 1), EaseType.InOutCubic);
					this._c.a = this._c.a + (sAlpha - this._c.a) * k;
				} else if (phase > 0.5) {
					this._c.a = sAlpha;
				}
			}
		}

		this.rig.setColorForId(lightId, this._c);
	},
});

// ---- decompiled V3 distribution/filter math (BeatmapEventDataBox / IndexFilter) ----------

function getBeatStep(distType, param, count, lastBaseBeat) {
	// DistributionParamType: 1 = Wave, 2 = Step.
	if (distType === 1) {
		return Math.max(param - lastBaseBeat, 0) / Math.max(count - 1, 1);
	}
	return param; // Step
}

function getDistribution(isFirst, distOrder, affectFirst, param, distType, count, easeType) {
	if (!affectFirst && isFirst) {
		return 0;
	}
	const ease = t => (easeType === undefined || easeType === EaseType.None ? t : Interpolate(t, easeType));
	if (distType === 1) {
		return param * ease(distOrder / Math.max(count - 1, 1)); // Wave
	}
	return param * ease(distOrder / count) * count; // Step
}

// Port of LightTranslationGroupEffect.ComputeTranslation: maps the event value (+ per-element
// distribution) into a local position via unclamped lerp within the group's limits.
function computeTranslation(translation, translationLimits, distribution, distributionLimits, mirror) {
	const t = ((mirror ? -translation : translation) + 1) * 0.5;
	const t2 = ((mirror ? -distribution : distribution) + 1) * 0.5;
	return lerpUnclamped(translationLimits[0], translationLimits[1], t) + lerpUnclamped(distributionLimits[0], distributionLimits[1], t2);
}

function lerpUnclamped(a, b, t) {
	return a + (b - a) * t;
}

const DEG2RAD = Math.PI / 180;

function repeat360(x) {
	return ((x % 360) + 360) % 360;
}

function deltaAngle(a, b) {
	let d = (b - a) % 360;
	if (d > 180) {
		d -= 360;
	}
	if (d < -180) {
		d += 360;
	}
	return d;
}

// Port of LightRotationGroupEffect.ComputeTargetAngle (Automatic / Clockwise / Counterclockwise).
function computeTargetAngle(startAngle, targetAngle, loopCount, direction) {
	const delta = deltaAngle(startAngle, targetAngle);
	let num = 0;
	let num2 = 0;
	if (direction === 1) {
		// Clockwise
		num = delta >= 0 ? startAngle + delta : startAngle + delta + 360;
		num2 = loopCount * 360;
	} else if (direction === 2) {
		// Counterclockwise
		num = delta <= 0 ? startAngle + delta : startAngle + delta - 360;
		num2 = -loopCount * 360;
	} else {
		// Automatic
		num = startAngle + delta;
		num2 = Math.sign(delta) * loopCount * 360;
	}
	return num + num2;
}

/**
 * Port of IndexFilterConverter.Convert + IndexFilter enumeration (no random/shuffle).
 * Returns {entries:[{element,durationOrder,distributionOrder}], count, visibleCount,
 * limitsDuration, limitsDistribution}.
 */
function buildIndexFilter(f, groupSize) {
	const chunks = f.c || 0;
	const chunkSize = chunks === 0 ? 1 : Math.ceil(groupSize / chunks);
	const num2 = Math.ceil(groupSize / chunkSize);
	const type = f.f || 0;
	const p = f.p || 0;
	const t = f.t || 0;
	const reversed = (f.r || 0) === 1;
	const limit = f.l || 0;
	const limitAffects = f.d || 0; // bit1 = Duration, bit2 = Distribution

	let start;
	let step;
	let count;

	if (type === 1) {
		// Division
		const sections = Math.max(p, 1);
		const sectionSize = Math.ceil(num2 / sections);
		if (reversed) {
			start = num2 - sectionSize * t - 1;
			const end = Math.max(0, start - sectionSize + 1);
			step = end - start >= 0 ? 1 : -1;
			count = Math.abs(end - start) + 1;
		} else {
			start = sectionSize * t;
			const end = Math.min(num2 - 1, start + sectionSize - 1);
			step = end - start >= 0 ? 1 : -1;
			count = Math.abs(end - start) + 1;
		}
	} else if (type === 2) {
		// StepAndOffset
		const span = num2 - p;
		if (span <= 0) {
			return null;
		}
		count = t === 0 ? 1 : Math.ceil(span / t);
		if (reversed) {
			start = num2 - 1 - p;
			step = -t;
		} else {
			start = p;
			step = t;
		}
	} else {
		return null;
	}

	const visibleCount = limit === 0 || limit === 1 ? count : Math.ceil(count * limit);
	const limitsDuration = (limitAffects & 1) !== 0;
	const limitsDistribution = (limitAffects & 2) !== 0;

	const entries = [];
	let limitedOrderIndex = 0;
	for (let i = 0; i < count; i++) {
		if (visibleCount < count && i >= visibleCount) {
			break; // TakeWithTombstone: only first visibleCount are yielded
		}
		const elementBase = start + i * step;
		for (let lc = 0; lc < chunkSize; lc++) {
			const el = elementBase * chunkSize + lc;
			if (el >= groupSize) {
				break;
			}
			entries.push({
				element: el,
				durationOrder: limitsDuration ? limitedOrderIndex : i,
				distributionOrder: limitsDistribution ? limitedOrderIndex : i,
			});
		}
		limitedOrderIndex++;
	}

	return {entries, count, visibleCount, limitsDuration, limitsDistribution};
}
