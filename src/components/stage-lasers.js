AFRAME.registerComponent('stage-lasers', {
	schema: {
		visible: {default: true},
		rotating: {default: true},
	},

	init: function () {
		this.speed = 0;
		this.lasers = [this.el.children[0].object3D, this.el.children[1].object3D, this.el.children[2].object3D];
		this.lasers.forEach(element => {
			element.visible = false;
		});
	},

	pulse: function (speed) {
		this.speed = speed / 8;
	},

	tick: function (time, delta) {
		if (!this.loaded) {
			this.lasers.forEach(element => {
				element.visible = true;
			});
			this.loaded = true;
		}
		delta /= 1000;
		if (!this.data.rotating) {
			this.speed *= 0.97;
			if (Math.abs(this.speed) < 0.01) {
				this.speed = 0;
			}
		}
		this.lasers[0].rotation.z += this.speed * delta;
		this.lasers[1].rotation.z -= this.speed * delta * 1.01;
		this.lasers[2].rotation.z += this.speed * delta * 1.02;
	},
});
