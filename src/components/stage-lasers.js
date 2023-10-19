AFRAME.registerComponent('stage-lasers', {
	schema: {
		visible: {default: true},
		rotating: {default: true},
		side: {default: 'right', oneOf: ['left', 'right']},
	},

	init: function () {
		this.speed = 0;
		this.lasers = Array.from(this.el.children).map(c => c.object3D);
		this.lasers.forEach(element => {
			element.visible = false;
		});
	},

	update: function () {
		if (this.data.side == 'right') {
			this.rotationDirection = 1;
		} else {
			this.rotationDirection = -1;
		}
	},

	setVisible: function (state) {
		if (state) {
			this.lasers.forEach(element => {
				element.visible = true;
			});
		} else {
			this.lasers.forEach(element => {
				element.visible = false;
			});
		}
	},

	//ToRad = 0.01745329;
	//ToDeg = 57.29578;
	setSpeed: function (speed) {
		this.speed = 0.01745329 * 45 * speed;

		//gives each laser a random y offset
		this.lasers.forEach(element => {
			element.rotation.y = Math.random() * (15 - 10) + 10;
		});
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
			//nice little slow down thing. i like it. picasso.
			this.speed *= 0.97;
			if (Math.abs(this.speed) < 0.01) {
				this.speed = 0;
			}
		}

		//35 degrees and -50 degrees for y and z
		if (this.speed == 0) {
			this.lasers.forEach(element => {
				element.rotation.set(0, 0.6108652 * this.rotationDirection, 0.8726646 * this.rotationDirection);
			});
		}

		this.lasers.forEach(element => {
			element.rotation.y += this.speed * delta * this.rotationDirection;
		});
	},
});
