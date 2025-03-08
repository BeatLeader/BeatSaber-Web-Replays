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

	// TODO: If convert this to cycle - ThreeJS will use only first material for some reason
	createRainbowMaterials: function (texture) {
		this.redBlockRainbowMaterial = new THREE.MeshStandardMaterial({
			metalness: 0.98,
			roughness: 0.0,
			color: COLORS.BEAT_RED,
			envMap: texture,
			emissive: COLORS.BEAT_RED,
			emissiveIntensity: 0.3,
			onBeforeCompile: shader => {
				shader.vertexShader = shader.vertexShader.replace(
					'void main() {',
					`varying vec3 vPosition;
					void main() {
						vPosition = position;`
				);

				shader.fragmentShader =
					`
					vec3 hueToRgb(float hue) {
						float r = abs(hue * 6.0 - 3.0) - 1.0;
						float g = 2.0 - abs(hue * 6.0 - 2.0);
						float b = 2.0 - abs(hue * 6.0 - 4.0);
						return clamp(vec3(r, g, b), 0.0, 1.0);
					}
					varying vec3 vPosition;
					` + shader.fragmentShader;

				var fragmentToken =
					'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;';
				var injection = `
					float angle = 0.785398163; // 45 degrees in radians
					float rotatedY = vPosition.x * sin(angle) + vPosition.y * cos(angle);
					float normalizedY = rotatedY * 4.0 + 0.1;
					vec3 rainbowColor = hueToRgb(normalizedY);
					vec3 outgoingLight = vec3(0, 0, 0);
					if (rainbowColor.r > 0.6) {
						outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
					} else {
						outgoingLight = mix(reflectedLight.directDiffuse.rgb, rainbowColor, 0.6) + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
					}
					`;
				shader.fragmentShader = shader.fragmentShader.replace(fragmentToken, injection);
			},
		});
		this.blueBlockRainbowMaterial = new THREE.MeshStandardMaterial({
			metalness: 0.98,
			roughness: 0.0,
			color: COLORS.BEAT_BLUE,
			envMap: texture,
			emissive: COLORS.BEAT_BLUE,
			emissiveIntensity: 0.3,
			onBeforeCompile: shader => {
				shader.vertexShader = shader.vertexShader.replace(
					'void main() {',
					`varying vec3 vPosition;
					void main() {
						vPosition = position;`
				);

				shader.fragmentShader =
					`
					vec3 hueToRgb(float hue) {
						float r = abs(hue * 6.0 - 3.0) - 1.0;
						float g = 2.0 - abs(hue * 6.0 - 2.0);
						float b = 2.0 - abs(hue * 6.0 - 4.0);
						return clamp(vec3(r, g, b), 0.0, 1.0);
					}
					varying vec3 vPosition;
					` + shader.fragmentShader;

				var fragmentToken =
					'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;';
				var injection = `
					float angle =  -0.785398163; // 45 degrees in radians
					float rotatedY = vPosition.x * sin(angle) + vPosition.y * cos(angle);
					float normalizedY = 0.5 - rotatedY * 4.0; 
					if (normalizedY > 0.65) {normalizedY = 0.65;}if (normalizedY < 0.0) {normalizedY = 1.0 + normalizedY;}
					vec3 rainbowColor = hueToRgb(normalizedY);
					vec3 outgoingLight = vec3(0, 0, 0);
					if (rainbowColor.b > 0.6) {
						outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
					} else {
						outgoingLight = mix(reflectedLight.directDiffuse.rgb, rainbowColor, 0.6) + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
					}
					`;

				shader.fragmentShader = shader.fragmentShader.replace(fragmentToken, injection);
			},
		});
	},

	createMaterials: function (atlas) {
		this.stageNormal = new THREE.ShaderMaterial({
			uniforms: {
				skyColor: {value: new THREE.Color(COLORS.SKY_BLUE)},
				backglowColor: {value: new THREE.Color(COLORS.SKY_BLUE)},
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
			flatShading: true,
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
			flatShading: true,
		});

		this.mineMaterialred = new THREE.MeshStandardMaterial({
			roughness: 0.68,
			metalness: 0.48,
			color: new THREE.Color(COLORS.MINE_RED),
			envMap: new THREE.TextureLoader().load('assets/img/mineenviro-red.jpg'),
		});

		this.mineMaterialblue = new THREE.MeshStandardMaterial({
			roughness: 0.68,
			metalness: 0.48,
			color: new THREE.Color(COLORS.MINE_BLUE),
			envMap: new THREE.TextureLoader().load('assets/img/mineenviro-blue.jpg'),
		});

		this.mineMaterialyellow = new THREE.MeshStandardMaterial({
			roughness: 0.38,
			metalness: 0.48,
			color: new THREE.Color('yellow'),
			emissive: new THREE.Color('yellow'),
			envMap: new THREE.TextureLoader().load('assets/img/mineenviro-blue.jpg'),
		});
		new THREE.TextureLoader().load('assets/img/envmap.jpg', texture => {
			texture.needsUpdate = true;
			texture.mapping = THREE.SphericalReflectionMapping;

			this.createRainbowMaterials(texture);

			texture.needsUpdate = true;
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
