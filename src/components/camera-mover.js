AFRAME.registerComponent('camera-mover', {
	schema: {},

	init: function () {
		this.pov = false;
		this.defaultCameraRig = this.el.sceneEl.querySelectorAll('.floatingCamera')[0];
		this.povCameraRig = this.el.sceneEl.querySelectorAll('.headCamera')[0];

		this.defaultCamera = this.el.sceneEl.querySelectorAll('.mainCamera')[0];
		this.defaultCamera.setAttribute('camera', 'active', true);

		this.lookControls = this.defaultCamera.components['look-controls'];
		this.povCamera = this.el.sceneEl.querySelectorAll('.povCamera')[0];

		this.restoreButton = document.getElementById('cameraRestore');
		this.saveButton = document.getElementById('cameraSave');

		this.settings = this.el.sceneEl.components.settings;
	},

	play: function () {
		let powHandler = () => {
			if (this.pov) {
				this.povCamera.setAttribute('camera', 'active', false);
				this.defaultCamera.setAttribute('camera', 'active', true);
			} else {
				this.defaultCamera.setAttribute('camera', 'active', false);
				this.povCamera.setAttribute('camera', 'active', true);
			}
			this.pov = !this.pov;
			this.updateSaveButtons();
			this.el.sceneEl.emit('povchanged', {newPov: this.pov}, false);
		};
		document.getElementById('povswitch').addEventListener('click', e => {
			e.preventDefault();
			powHandler();
		});

		let toLeftHandler = () => {
			this.defaultCamera.object3D.position.y = 1.75;
			this.defaultCamera.object3D.position.x = -2.0;
			this.defaultCamera.object3D.position.z = 0.0;

			this.lookControls.pitchObject.rotation.x = 0;
			this.lookControls.yawObject.rotation.y = -Math.PI / 2;

			this.disablePovIfNeeded();
		};

		document.getElementById('cameraToLeft').addEventListener('click', toLeftHandler);

		let toCenterHandler = () => {
			this.defaultCamera.object3D.position.y = 1.75;
			this.defaultCamera.object3D.position.x = 0.0;
			this.defaultCamera.object3D.position.z = 2.0;

			this.lookControls.pitchObject.rotation.x = 0;
			this.lookControls.yawObject.rotation.y = 0;

			this.disablePovIfNeeded();
		};

		document.getElementById('cameraToCenter').addEventListener('click', toCenterHandler);

		let toRightHandler = () => {
			this.defaultCamera.object3D.position.y = 1.75;
			this.defaultCamera.object3D.position.x = 2.0;
			this.defaultCamera.object3D.position.z = 0.0;

			this.lookControls.pitchObject.rotation.x = 0;
			this.lookControls.yawObject.rotation.y = Math.PI / 2;

			this.disablePovIfNeeded();
		};

		document.getElementById('cameraToRight').addEventListener('click', toRightHandler);

		document.addEventListener('keydown', e => {
			if (e.keyCode === 70 && e.shiftKey) {
				// f + Shift
				powHandler();
			}
			if (e.keyCode === 81 && e.shiftKey) {
				// q + Shift
				toLeftHandler();
			}
			if (e.keyCode === 82 && e.shiftKey) {
				// r + Shift
				toCenterHandler();
			}
			if (e.keyCode === 69 && e.shiftKey) {
				// e + Shift
				toRightHandler();
			}
		});

		let restoreButton = document.getElementById('cameraRestore');
		restoreButton.addEventListener('click', e => {
			this.restoreCameraFromSettings();
		});
		if (!this.settings.settings.camera) {
			restoreButton.disabled = true;
		}

		document.getElementById('cameraSave').addEventListener('click', e => {
			const position = this.defaultCamera.object3D.position;
			const rotation = this.defaultCamera.object3D.rotation;

			const camera = {
				px: position.x,
				py: position.y,
				pz: position.z,
				rx: this.lookControls.pitchObject.rotation.x,
				ry: this.lookControls.yawObject.rotation.y,
			};
			this.settings.settings.camera = camera;
			this.settings.sync();
			this.restoreButton.disabled = false;
		});

		const settings = this.settings.settings;
		if (settings.savedCameraDefault && settings.camera) {
			this.restoreCameraFromSettings();
		} else {
			this.defaultCamera.object3D.position.z = 2.0;
		}
	},

	disablePovIfNeeded: function () {
		if (this.pov) {
			this.pov = false;
			this.povCamera.setAttribute('camera', 'active', false);
			this.defaultCamera.setAttribute('camera', 'active', true);
			this.el.sceneEl.emit('povchanged', {newPov: this.pov}, false);
			this.updateSaveButtons();
		}
	},

	updateSaveButtons: function () {
		if (this.pov) {
			this.restoreButton.disabled = true;
			this.saveButton.disabled = true;
		} else {
			this.restoreButton.disabled = !this.settings.settings.camera;
			this.saveButton.disabled = false;
		}
	},

	restoreCameraFromSettings: function () {
		const position = this.defaultCamera.object3D.position;
		const camera = this.settings.settings.camera;

		position.x = camera.px;
		position.y = camera.py;
		position.z = camera.pz;

		this.lookControls.pitchObject.rotation.x = camera.rx;
		this.lookControls.yawObject.rotation.y = camera.ry;
	},
});
