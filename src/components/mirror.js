/* global AFRAME, THREE */

/**
 * Phase 2 — `bs/mirror`: planar reflection for the environment mirror floor.
 *
 * Beat Saber's mirror floor is a mesh with a `Mirror` component (a planar reflector), NOT a
 * "Mirror"-named material — the exporter tags those meshes with `userData.mirror = true`. Here we
 * build ONE planar reflector covering the floor plane (all mirror meshes are coplanar) and hide the
 * original mirror meshes, so the cost is a single extra scene render per frame (only when an env
 * actually has a mirror).
 *
 * The reflector is a self-contained port of three.js's `Reflector` (the vendored A-Frame ships only
 * `MirroredRepeatWrapping`, no reflector), adapted for the vendored THREE r95
 * (`setRenderTarget`/`render(scene, camera)`).
 */

function boxIsFinite(b) {
	return isFinite(b.min.x) && isFinite(b.min.y) && isFinite(b.min.z) &&
		isFinite(b.max.x) && isFinite(b.max.y) && isFinite(b.max.z);
}

const ReflectorShader = {
	uniforms: {
		color: {value: null},
		tDiffuse: {value: null},
		textureMatrix: {value: null},
	},
	vertexShader: `
		uniform mat4 textureMatrix;
		varying vec4 vUv;
		void main() {
			vUv = textureMatrix * vec4(position, 1.0);
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: `
		uniform vec3 color;
		uniform sampler2D tDiffuse;
		varying vec4 vUv;
		void main() {
			vec4 base = texture2DProj(tDiffuse, vUv);
			// Dark-tinted reflection + a faint floor base so the surface is always visible (a missing
			// reflection reads as a dark floor, never transparent).
			// Alpha = BS bloom mask: the mirror floor is structural, not a bloom source, so write 0
			// (the alpha-weighted screen-bloom prefilter must not bloom the whole floor).
			gl_FragColor = vec4(base.rgb * color + vec3(0.02, 0.02, 0.035), 0.0);
		}
	`,
};

function makeReflector(geometry, options) {
	const Mesh = THREE.Mesh;
	const mirror = new Mesh(geometry);
	mirror.type = 'Reflector';

	const color = options.color !== undefined ? new THREE.Color(options.color) : new THREE.Color(0x7f7f7f);
	const textureWidth = options.textureWidth || 512;
	const textureHeight = options.textureHeight || 512;
	const clipBias = options.clipBias || 0;

	const reflectorPlane = new THREE.Plane();
	const normal = new THREE.Vector3();
	const reflectorWorldPosition = new THREE.Vector3();
	const cameraWorldPosition = new THREE.Vector3();
	const rotationMatrix = new THREE.Matrix4();
	const lookAtPosition = new THREE.Vector3(0, 0, -1);
	const clipPlane = new THREE.Vector4();
	const view = new THREE.Vector3();
	const target = new THREE.Vector3();
	const q = new THREE.Vector4();
	const textureMatrix = new THREE.Matrix4();
	const virtualCamera = new THREE.PerspectiveCamera();

	const renderTarget = new THREE.WebGLRenderTarget(textureWidth, textureHeight, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBFormat,
		stencilBuffer: false,
	});

	const material = new THREE.ShaderMaterial({
		uniforms: THREE.UniformsUtils.clone(ReflectorShader.uniforms),
		fragmentShader: ReflectorShader.fragmentShader,
		vertexShader: ReflectorShader.vertexShader,
	});
	material.uniforms.tDiffuse.value = renderTarget.texture;
	material.uniforms.color.value = color;
	material.uniforms.textureMatrix.value = textureMatrix;
	mirror.material = material;

	mirror.onBeforeRender = function (renderer, scene, camera) {
		reflectorWorldPosition.setFromMatrixPosition(mirror.matrixWorld);
		cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

		rotationMatrix.extractRotation(mirror.matrixWorld);
		normal.set(0, 0, 1).applyMatrix4(rotationMatrix);

		view.subVectors(reflectorWorldPosition, cameraWorldPosition);
		// Avoid rendering when reflector is facing away from the camera.
		if (view.dot(normal) > 0) {
			return;
		}
		view.reflect(normal).negate().add(reflectorWorldPosition);

		rotationMatrix.extractRotation(camera.matrixWorld);
		lookAtPosition.set(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraWorldPosition);
		target.subVectors(reflectorWorldPosition, lookAtPosition);
		target.reflect(normal).negate().add(reflectorWorldPosition);

		virtualCamera.position.copy(view);
		virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
		virtualCamera.lookAt(target);
		virtualCamera.far = camera.far;
		virtualCamera.updateMatrixWorld();
		virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

		// Texture matrix: world -> reflection-camera-projected UV.
		textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
		textureMatrix.multiply(virtualCamera.projectionMatrix);
		textureMatrix.multiply(virtualCamera.matrixWorldInverse);
		textureMatrix.multiply(mirror.matrixWorld);

		// Oblique near-plane clipping so geometry behind the mirror isn't reflected.
		reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
		reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
		clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);

		const projectionMatrix = virtualCamera.projectionMatrix;
		q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
		q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
		q.z = -1.0;
		q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
		clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
		projectionMatrix.elements[2] = clipPlane.x;
		projectionMatrix.elements[6] = clipPlane.y;
		projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
		projectionMatrix.elements[14] = clipPlane.w;

		// Render the scene from the mirrored camera into the reflection target.
		mirror.visible = false;
		const currentRenderTarget = renderer.getRenderTarget();
		const currentVrEnabled = renderer.vr ? renderer.vr.enabled : false;
		const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
		if (renderer.vr) {
			renderer.vr.enabled = false; // avoid camera modification
		}
		renderer.shadowMap.autoUpdate = false;
		try {
			renderer.setRenderTarget(renderTarget);
			renderer.clear();
			renderer.render(scene, virtualCamera);
		} catch (e) {
			if (!mirror.userData._reflErr) {
				mirror.userData._reflErr = true;
				console.error('[mirror] reflection render failed:', e && e.message);
			}
		}
		if (renderer.vr) {
			renderer.vr.enabled = currentVrEnabled;
		}
		renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
		renderer.setRenderTarget(currentRenderTarget);
		mirror.visible = true;
	};

	mirror.frustumCulled = false;

	mirror.getRenderTarget = function () { return renderTarget; };
	return mirror;
}

// Settings > Visuals "Mirrors" quality -> reflection texture resolution (multiplied by DPR).
// 'off' skips the reflector entirely (the original mirror meshes stay visible as a plain floor).
const MIRROR_RESOLUTIONS = {low: 256, middle: 512, high: 1024};

AFRAME.registerComponent('mirror', {
	schema: {
		tint: {default: '#9099a8'}, // reflection tint (dark mirror floor)
		resolution: {default: 512}, // fallback when no environmentMirror setting is present
	},

	init: function () {
		this.reflector = null;
		this.quality = null;
		this.el.addEventListener('environment-loaded', () => this.onEnvLoaded());
		this.el.addEventListener('environment-unloaded', () => this.teardown());
		this.el.sceneEl.addEventListener('settingsChanged', evt => {
			const settings = evt.detail && evt.detail.settings;
			const quality = (settings && settings.environmentMirror) || 'middle';
			if (quality === this.quality) {
				return;
			}
			this.quality = quality;
			if (this.el.getObject3D('mesh')) {
				this.onEnvLoaded(); // rebuild the reflector at the new quality
			}
		});
	},

	mirrorQuality: function () {
		if (this.quality) {
			return this.quality;
		}
		const settingsComp = this.el.sceneEl.components.settings;
		return (settingsComp && settingsComp.settings && settingsComp.settings.environmentMirror) || 'middle';
	},

	onEnvLoaded: function () {
		this.teardown();
		if (this.mirrorQuality() === 'off') {
			return; // no reflector; the env's own mirror meshes stay visible as a plain floor
		}
		const root = this.el.getObject3D('mesh');
		if (!root) {
			return;
		}
		root.updateMatrixWorld(true); // ensure world matrices are current before computing bounds

		// Mirror-tagged nodes carry userData.mirror (the Mirror component). For each, collect its
		// renderable meshes (the node itself, or — for multi-primitive nodes — its child meshes).
		const mirrorNodes = [];
		root.traverse(o => {
			if (o.userData && o.userData.mirror) {
				mirrorNodes.push(o);
			}
		});
		const mirrors = [];
		mirrorNodes.forEach(node => {
			node.traverse(o => { if (o.isMesh) { mirrors.push(o); } });
		});

		const box = new THREE.Box3();
		const tmp = new THREE.Box3();
		let finite = 0;
		mirrors.forEach(o => {
			tmp.setFromObject(o);
			if (!tmp.isEmpty() && boxIsFinite(tmp)) { box.union(tmp); finite++; }
		});

		// The exported env can carry NaN bounds (a degenerate mesh/transform), which poisons the mirror
		// box. Fall back to the floor plane derived from the FINITE env geometry.
		if (mirrors.length === 0) {
			console.warn('[mirror] no mirror meshes found');
			return;
		}
		if (finite === 0 || !boxIsFinite(box) || box.isEmpty()) {
			const envBox = new THREE.Box3();
			root.traverse(o => {
				if (o.isMesh) {
					tmp.setFromObject(o);
					if (!tmp.isEmpty() && boxIsFinite(tmp)) { envBox.union(tmp); }
				}
			});
			if (boxIsFinite(envBox) && !envBox.isEmpty()) {
				box.copy(envBox);
				box.max.y = box.min.y; // collapse to the floor plane
			} else {
				box.set(new THREE.Vector3(-40, 0, -60), new THREE.Vector3(40, 0, 60));
			}
			console.warn('[mirror] mirror bounds NaN/empty -> using finite env/default floor plane');
		}
		console.warn(`[mirror] ${mirrorNodes.length} mirror node(s), ${mirrors.length} mesh(es), finite=${finite}`);

		// One reflector plane on the floor (mirror meshes are coplanar); hide the originals.
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const w = Math.max(size.x, 0.1) * 1.05;
		const d = Math.max(size.z, 0.1) * 1.05;
		const floorY = center.y;

		const dpr = (this.el.sceneEl.renderer && this.el.sceneEl.renderer.getPixelRatio) ? this.el.sceneEl.renderer.getPixelRatio() : 1;
		const res = (MIRROR_RESOLUTIONS[this.mirrorQuality()] || this.data.resolution) * dpr;
		const geo = new THREE.PlaneBufferGeometry(w, d);
		const reflector = makeReflector(geo, {
			color: new THREE.Color(this.data.tint),
			textureWidth: res,
			textureHeight: res,
			clipBias: 0.003,
		});
		reflector.rotation.x = -Math.PI / 2; // plane normal +Z -> +Y (up)
		reflector.position.set(center.x, floorY, center.z);
		reflector.renderOrder = -1; // draw the floor before the additive lights

		this.el.sceneEl.object3D.add(reflector);
		this.reflector = reflector;

		mirrors.forEach(m => { m.visible = false; });
		this.hidden = mirrors;
		console.warn(`[mirror] reflector ${w.toFixed(1)}x${d.toFixed(1)} at (${center.x.toFixed(1)}, ${floorY.toFixed(2)}, ${center.z.toFixed(1)}); hid ${mirrors.length} mesh(es)`);
	},

	teardown: function () {
		if (this.reflector) {
			this.el.sceneEl.object3D.remove(this.reflector);
			this.reflector.material.dispose();
			this.reflector.geometry.dispose();
			this.reflector = null;
		}
		if (this.hidden) {
			this.hidden.forEach(m => { m.visible = true; });
			this.hidden = null;
		}
	},
});
