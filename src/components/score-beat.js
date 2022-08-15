/**
 * Score beat, auto-return to pool in 1.2s.
 */
AFRAME.registerComponent('score-beat', {
	schema: {
		type: {type: 'string'},
	},

	play: function () {
		this.poolComponent = `pool__beatscore${this.data.type}`;
		this.startTime = this.el.sceneEl.time;
		this.animationDuration = Math.min(this.el.getAttribute('animation__motionz', 'dur').dur, 3000);
	},

	tick: function (time) {
		if (time > this.startTime + this.animationDuration) {
			this.el.sceneEl.components[this.poolComponent].returnEntity(this.el);
		}
	},
});
