AFRAME.registerComponent('energy-bar', {
	dependencies: ['geometry', 'material'],

	schema: {
		enabled: {default: false},
		energy: {default: 0.5},
	},

	init: function () {
		this.progress = this.el.getObject3D('mesh').material.uniforms.progress;
	},

	update: function () {
		this.progress.value = this.data.energy;
	},
});
