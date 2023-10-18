 AFRAME.registerComponent('stage-lasers', {
	schema: {
		visible: {default: true},
		rotating: {default: true},
	},

	init: function () {
		this.speed = 0;
		this.lasers = [this.el.children[0].object3D, this.el.children[1].object3D, this.el.children[2].object3D, this.el.children[3].object3D, this.el.children[4].object3D];
		this.lasers.forEach(element => {
			element.visible = false;
		});
	},

	SetVis: function (state) {
		if (state) {

			this.lasers.forEach(element => {
				element.visible = true;
			});
		}
		else {

			this.lasers.forEach(element => {
				element.visible = false;
			});
		}
	},


	//does the if up here, rather than inside tick
	isLeft: function (state) {
		this.LeftorRight = 1;
		if (state) {
			this.LeftorRight = -1;
		}
	},


	//ToRad = 0.01745329;
	//ToDeg = 57.29578;
	SetSpeed: function (speed) {
		this.speed = 0.01745329 * 45 * speed;

		//gives each laser a random y offset
		this.lasers.forEach(element => {
			element.rotation.y =  Math.random() * (15 - 10) + 10;
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
				element.rotation.set(0, 0.6108652 * this.LeftorRight, 0.8726646 * this.LeftorRight);
			});
		}

		this.lasers.forEach(element => {
			element.rotation.y += this.speed * delta * this.LeftorRight;
		});
	},
});
