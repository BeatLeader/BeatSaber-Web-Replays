const HIT_LEFT = 'hitLeft';
const HIT_RIGHT = 'hitRight';
const LEFT = 'left';
const RIGHT = 'right';

/**
 * Show particles when touched by saber.
 */
AFRAME.registerComponent('saber-particles', {
	schema: {
		enabled: {default: false},
		hand: {type: 'string'},
	},

	init: function () {
		this.hiddenIntersection = {x: 999, y: 0, z: 0};
		this.intersectedEl = null;

		this.particles = document.getElementById('sparkParticles');
		this.particleEventDetail = {position: new THREE.Vector3(), rotation: new THREE.Euler()};
		this.particleEvent = {detail: this.particleEventDetail};
		this.particleSystem = null;

		this.saberEnter = this.saberEnter.bind(this);
		this.saberLeave = this.saberLeave.bind(this);
	},

	pause: function () {
		this.el.removeEventListener('raycaster-intersection', this.saberEnter);
		this.el.removeEventListener('raycaster-intersection-cleared', this.saberLeave);
	},

	play: function () {
		this.el.addEventListener('raycaster-intersection', this.saberEnter);
		this.el.addEventListener('raycaster-intersection-cleared', this.saberLeave);
		this.particlesDur = this.particles.getAttribute('particleplayer').dur;
	},

	saberEnter: function (evt) {
		if (!this.data.enabled) {
			return;
		}

		this.intersectedEl = evt.detail.els.filter(el => el.hasAttribute('data-saber-particles'));
	},

	saberLeave: function (evt) {
		evt.detail.clearedEls.forEach(el => {
			if (el.components.wall || el.id === 'floor') {
				const uniform = this.data.hand === RIGHT ? HIT_RIGHT : HIT_LEFT;
				const material = el.getObject3D('mesh').material;
				material.uniforms[uniform].value = this.hiddenIntersection;
			}
		});
		// Hide hit intersection texture.

		this.intersectedEl = null;
		this.particleSystem = null;
	},

	tick: function (time, delta) {
		if (!this.data.enabled || !this.intersectedEl) {
			return;
		}

		const raycaster = this.el.components.raycaster;

		for (var i = 0; i < this.intersectedEl.length; i++) {
			const intersectedEl = this.intersectedEl[i];

			const intersection = raycaster.getIntersection(intersectedEl);

			if (!intersection) {
				return;
			}

			// Update intersection material if necessary.

			if (intersectedEl.components.wall || intersectedEl.id === 'floor') {
				const uniform = this.data.hand === RIGHT ? HIT_RIGHT : HIT_LEFT;
				const material = intersectedEl.getObject3D('mesh').material;
				material.uniforms[uniform].value = intersection.point;
			}

			if (this.particleSystem && this.particleSystem.active) {
				// Update particle position.
				this.particleSystem.mesh.position.copy(intersection.point);
			} else {
				// Start particle system.
				this.particleEventDetail.position.copy(intersection.point);
				this.particleSystem = this.particles.components.particleplayer.startAfterDelay(this.particleEvent);
			}
		}
	},
});
