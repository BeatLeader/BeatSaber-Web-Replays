const COLORS = require('../constants/colors.js');
const stageAdditiveShaders = require('../../assets/shaders/stageAdditive.js');
const beatArrowShaders = require('../../assets/shaders/beatArrow.js');
const stageNormalShaders = require('../../assets/shaders/stageNormal.js');
const energyShaders = require('../../assets/shaders/energy.js');
const splineShaders = require('../../assets/shaders/spline.js');

AFRAME.registerShader('energy', {
	schema: {
		progress: {default: 0, is: 'uniform'},
	},

	vertexShader: energyShaders.vertexShader,
	fragmentShader: energyShaders.fragmentShader,
});

AFRAME.registerSystem('materials', {
	init: function () {
		const atlas = new THREE.TextureLoader().load('assets/img/atlas.png');
		this.createMaterials(atlas);
	},

	createMaterials: function (atlas) {
		this.stageNormal = new THREE.ShaderMaterial({
			uniforms: {
				skyColor: {value: new THREE.Color(COLORS.SKY_BLUE)},
				backglowColor: {value: new THREE.Color(COLORS.BG_BLUE)},
				src: {
					value: atlas,
				},
			},
			vertexShader: stageNormalShaders.vertexShader,
			fragmentShader: stageNormalShaders.fragmentShader,
			fog: false,
			transparent: true,
		});

		this.stageAdditive = new THREE.ShaderMaterial({
			uniforms: {
				tunnelNeon: {value: new THREE.Color(COLORS.NEON_RED)},
				floorNeon: {value: new THREE.Color(COLORS.NEON_RED)},
				leftLaser: {value: new THREE.Color(COLORS.NEON_BLUE)},
				rightLaser: {value: new THREE.Color(COLORS.NEON_BLUE)},
				textGlow: {value: new THREE.Color(COLORS.TEXT_OFF)},
				src: {
					value: atlas,
				},
			},
			vertexShader: stageAdditiveShaders.vertexShader,
			fragmentShader: stageAdditiveShaders.fragmentShader,
			blending: THREE.AdditiveBlending,
			fog: false,
			depthWrite: false,
			transparent: true,
		});

		this.beatSignMaterial = new THREE.ShaderMaterial({
			uniforms: {
				src: {
					value: atlas,
				},
				start: {value: 10000},
				finish: {value: 10000},
			},
			vertexShader: beatArrowShaders.vertexShader,
			fragmentShader: beatArrowShaders.fragmentShader,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			transparent: true,
		});

		this.splinematerialred = new THREE.ShaderMaterial({
			uniforms: {
				mainColor: {value: new THREE.Color(COLORS.NEON_RED)},
				start: {value: 100},
				finish: {value: -100},
			},
			vertexShader: splineShaders.vertexShader,
			fragmentShader: splineShaders.fragmentShader,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			transparent: true,
		});

		this.splinematerialblue = new THREE.ShaderMaterial({
			uniforms: {
				mainColor: {value: new THREE.Color(COLORS.NEON_BLUE)},
				start: {value: 100},
				finish: {value: -100},
			},
			vertexShader: splineShaders.vertexShader,
			fragmentShader: splineShaders.fragmentShader,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false,
			transparent: true,
		});

		this.mineMaterialred = new THREE.MeshStandardMaterial({
			roughness: 0.38,
			metalness: 0.48,
			color: new THREE.Color(COLORS.MINE_RED),
			emissive: new THREE.Color(COLORS.MINE_RED_EMISSION),
			envMap: new THREE.TextureLoader().load('assets/img/mineenviro-red.jpg'),
		});

		this.mineMaterialblue = new THREE.MeshStandardMaterial({
			roughness: 0.38,
			metalness: 0.48,
			color: new THREE.Color(COLORS.MINE_BLUE),
			emissive: new THREE.Color(COLORS.MINE_BLUE_EMISSION),
			envMap: new THREE.TextureLoader().load('assets/img/mineenviro-blue.jpg'),
		});

		this.mineMaterialyellow = new THREE.MeshStandardMaterial({
			roughness: 0.38,
			metalness: 0.48,
			color: new THREE.Color('yellow'),
			emissive: new THREE.Color('yellow'),
			envMap: new THREE.TextureLoader().load('assets/img/mineenviro-blue.jpg'),
		});
	},
});

AFRAME.registerComponent('materials', {
	schema: {
		name: {default: ''},
		recursive: {default: true},
	},

	update: function () {
		if (this.data.name === '') {
			return;
		}

		const material = this.system[this.data.name];
		if (!material) {
			console.warn(`undefined material "${this.system[this.data.name]}"`);
			return;
		}

		const mesh = this.el.getObject3D('mesh');
		if (!mesh) {
			this.el.addEventListener('model-loaded', this.applyMaterial.bind(this));
		} else {
			this.applyMaterial(mesh);
		}
	},

	applyMaterial: function (obj) {
		const material = this.system[this.data.name];
		if (obj['detail']) {
			obj = obj.detail.model;
		}
		if (this.data.recursive) {
			obj.traverse(o => {
				if (o.type === 'Mesh') {
					o.material = material;
				}
			});
		} else {
			obj.material = material;
		}
	},
});
