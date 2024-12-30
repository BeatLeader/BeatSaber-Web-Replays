import JSZip from 'jszip';

import {getApiUrl} from '../utils';

AFRAME.registerComponent('tree-loader', {
	schema: {
		tree: {type: 'selector', default: '#tree'},
	},

	init: function () {
		this.ornamentObjects = new THREE.Group();
		this.el.object3D.add(this.ornamentObjects);
		this.clock = new THREE.Clock();
		this.allMaterials = [];
		this.materialsSystem = this.el.sceneEl.systems.materials;

		this.el.object3D.parent.position.set(2, 0, 0);

		this.el.object3D.parent.updateMatrixWorld();
		this.el.object3D.parent.updateMatrix();

		this.el.sceneEl.addEventListener('userloaded', evt => {
			const player = evt.detail;
			this.loadOrnaments(player.id);
		});

		this.el.sceneEl.addEventListener('settingsChanged', evt => {
			this.el.object3D.parent.updateMatrixWorld();
			this.el.object3D.parent.updateMatrix();
		});
	},

	loadOrnaments: async function (playerId) {
		try {
			const response = await fetch(`${getApiUrl()}/projecttree/${playerId}`, {credentials: 'include'});
			const data = await response.json();

			const loadedBundles = new Map(); // Track loaded bundle promises

			// First load all unique bundles
			const bundlePromises = data.ornaments.map(ornament => {
				if (!loadedBundles.has(ornament.bundleId)) {
					const promise = this.loadBundle(ornament.bundleId);
					loadedBundles.set(ornament.bundleId, promise);
					return promise;
				}
				return loadedBundles.get(ornament.bundleId);
			});

			await Promise.all(bundlePromises);

			// Then create all ornaments
			for (const ornament of data.ornaments) {
				const bundle = await loadedBundles.get(ornament.bundleId);
				if (bundle) {
					this.createOrnament(ornament, bundle);
				}
			}
			this.el.object3D.parent.updateMatrixWorld();
			this.el.object3D.parent.updateMatrix();

			this.el.sceneEl.emit('treeLoaded', null, false);
			this.el.object3D.parent.updateMatrixWorld();
			this.el.object3D.parent.updateMatrix();
		} catch (err) {
			console.error('Error loading ornaments:', err);
		}
	},

	loadBundle: async function (bundleId) {
		const bundleUrl = `https://cdn.assets.beatleader.xyz/project_tree_web_bundle_${bundleId}.zip`;
		// const bundleUrl = `assets/models/project_tree_web_bundle_${bundleId}.zip`;

		try {
			const response = await fetch(bundleUrl);
			const blob = await response.blob();
			const zip = await JSZip.loadAsync(blob);

			// Load and parse GLTF
			const gltfFile = await zip.file('model.gltf').async('text');

			// Load materials
			const materialsJs = await zip.file('materials.js').async('text');

			// Pre-process the materials.js content to replace image paths with ObjectURLs
			let processedJs = materialsJs;
			const imageRegex = /'([^']+\.(png|jpg|jpeg))'/gi;
			const matches = materialsJs.matchAll(imageRegex);

			for (const match of matches) {
				const imagePath = match[1];
				const imageFile = await zip.file(imagePath).async('blob');
				const imageUrl = URL.createObjectURL(imageFile);
				processedJs = processedJs.replace(`'${imagePath}'`, `'${imageUrl}'`);
			}

			// Convert export statement to return
			const materialsFn = new Function(processedJs);
			const materials = materialsFn();

			// Load all referenced textures from zip
			const texturePromises = materials.map(async material => {
				if (material.map) {
					const textureFile = await zip.file(material.map).async('blob');
					const textureUrl = URL.createObjectURL(textureFile);
					material.map = new THREE.TextureLoader().load(textureUrl);
				}
				material.renderOrder = 10;
				if (material.uniforms && material.uniforms.mainTex && material.uniforms.mainTex.value === null) {
					// Create a 1x1 white pixel texture
					const data = new Uint8Array([255, 255, 255, 255]);
					const whiteTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
					whiteTexture.needsUpdate = true;
					material.uniforms.mainTex.value = whiteTexture;
				}
				return material;
			});

			const processedMaterials = await Promise.all(texturePromises);
			this.allMaterials.push(...processedMaterials);

			// Load geometry from GLTF
			const loader = new THREE.GLTFLoader();
			const gltfBlob = new Blob([gltfFile], {type: 'model/gltf+json'});
			const gltfUrl = URL.createObjectURL(gltfBlob);

			const gltf = await new Promise((resolve, reject) => {
				loader.load(gltfUrl, resolve, undefined, reject);
			});

			return {
				geometry: gltf.scene.children[0].geometry,
				materials: processedMaterials,
			};
		} catch (err) {
			console.error(`Error loading bundle ${bundleId}:`, err);
			return null;
		}
	},

	createOrnament: function (ornamentData, bundle) {
		const {geometry, materials} = bundle;

		// Create mesh with geometry and material
		const mesh = new THREE.Mesh(geometry, materials); // Assuming first material

		// Set position
		mesh.position.set(ornamentData.pose.position.x, ornamentData.pose.position.y, -ornamentData.pose.position.z);

		const quaternion = new THREE.Quaternion(
			ornamentData.pose.rotation.w,
			ornamentData.pose.rotation.z,
			ornamentData.pose.rotation.y,
			ornamentData.pose.rotation.x
		);

		var v = new THREE.Euler();
		v.setFromQuaternion(quaternion);

		v.y += Math.PI; // Y is 180 degrees off
		v.x -= Math.PI / 2;

		v.z *= -1; // flip Z
		mesh.rotation.set(v.x, v.y, v.z, 'YZX');
		mesh.renderOrder = 10;

		mesh.scale.set(0.01, 0.01, 0.01);
		// mesh.localRotation.set(Math.PI / 2, 0, 0);

		this.ornamentObjects.add(mesh);
	},

	remove: function () {
		if (this.ornamentObjects) {
			this.el.object3D.remove(this.ornamentObjects);
			this.ornamentObjects.traverse(child => {
				if (child.geometry) child.geometry.dispose();
				if (child.material) {
					if (child.material.map) child.material.map.dispose();
					child.material.dispose();
				}
			});
		}
	},

	tick: function () {
		const elapsedTime = this.clock.getElapsedTime();
		this.allMaterials.forEach(material => {
			if (material.uniforms && material.uniforms.time) {
				material.uniforms.time.value = elapsedTime;
			}
		});

		this.materialsSystem.christmasTree.uniforms.time.value = elapsedTime;
		this.materialsSystem.christmasLights[0].uniforms.time.value = elapsedTime;
		this.materialsSystem.christmasLights[1].uniforms.time.value = elapsedTime;
	},
});
