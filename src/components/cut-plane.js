AFRAME.registerComponent('cut-plane', {
	schema: {
		enabled: {default: false},
		hand: {type: 'string'},
	},

	init: function () {
		this.saberEl = this.el.querySelector('.blade');

		this.saberTopLocal = new THREE.Vector3();
		this.saberBotLocal = new THREE.Vector3();

		this.previousFrameSaberTop = new THREE.Vector3();
		this.currentFrameSaberTop = new THREE.Vector3();
		this.currentFrameSaberCenter = new THREE.Vector3();
	},

	tick: function (time, delta) {
		if (!this.data.enabled) return;

		const saberObject = this.saberEl.object3D;

		this.saberTopLocal.set(0, 0.5, 0);
		this.saberBotLocal.set(0, -0.5, 0);

		saberObject.parent.updateMatrixWorld();
		saberObject.localToWorld(this.saberTopLocal);
		saberObject.localToWorld(this.saberBotLocal);

		this.previousFrameSaberTop.copy(this.currentFrameSaberTop);
		this.currentFrameSaberTop.copy(this.saberTopLocal);

		this.saberBotLocal.add(this.saberTopLocal).multiplyScalar(0.5);
		this.currentFrameSaberCenter.copy(this.saberBotLocal);
	},
});
