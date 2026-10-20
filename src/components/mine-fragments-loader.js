const objLoader = new THREE.OBJLoader();

AFRAME.registerSystem('mine-fragments-loader', {
	init: function () {
		this.fragments = null;
		this.el.addEventListener('loaded', () => {
			this.fragments = objLoader.parse(document.getElementById('mineBrokenObj').data);
		});
	},
});
