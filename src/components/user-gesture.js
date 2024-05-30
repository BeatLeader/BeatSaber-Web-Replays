/**
 * Lame Chrome user gesture policy.
 */
AFRAME.registerComponent('user-gesture', {
	init: function () {
		this.userActivity = true;
		this.userActive = false;
		this.settings = this.el.sceneEl.components['settings'];
	},
	play: function () {
		document.addEventListener('click', evt => {
			if (evt.target.closest('#controls')) {
				return;
			}
			this.el.sceneEl.emit('usergesturereceive', null, false);
		});

		if (this.settings.settings.autoplayOnLoad) {
			setTimeout(() => {
				this.el.sceneEl.emit('usergesturereceive', null, false);
			}, 1000);
		}

		const captureThis = this;
		['mousemove', 'gesturechange', 'touchchange'].forEach(e => {
			document.addEventListener(e, function () {
				captureThis.userActivity = true;
			});
		});

		['gesturestart', 'touchstart'].forEach(e => {
			document.addEventListener(e, function () {
				captureThis.disableInactivityCheck();
				captureThis.changeUserActive(true);
			});
		});

		['gesturend', 'touchend'].forEach(e => {
			document.addEventListener(e, function () {
				captureThis.userActivity = true;
				captureThis.enableInactivityCheck();
			});
		});

		const controls = document.getElementById('controls');
		controls.addEventListener('mouseenter', evt => {
			captureThis.disableInactivityCheck();
		});

		controls.addEventListener('mouseleave', evt => {
			captureThis.enableInactivityCheck();
		});

		this.enableInactivityCheck();
	},

	enableInactivityCheck: function () {
		const captureThis = this;
		this.activityCheck = setInterval(function () {
			// Check to see if the mouse has been moved
			if (captureThis.userActivity) {
				// Reset the activity tracker
				captureThis.userActivity = false;

				// If the user state was inactive, set the state to active
				if (captureThis.userActive === false) {
					captureThis.changeUserActive(true);
				}

				// Clear any existing inactivity timeout to start the timer over
				clearTimeout(captureThis.inactivityTimeout);

				// In X seconds, if no more activity has occurred
				// the user will be considered inactive
				captureThis.inactivityTimeout = setTimeout(function () {
					// Protect against the case where the inactivity timeout can trigger
					// before the next user activity is picked up  by the
					// activityCheck loop.
					if (!captureThis.userActivity) {
						captureThis.changeUserActive(false);
					}
				}, 3000);
			}
		}, 250);
	},

	disableInactivityCheck: function () {
		clearTimeout(this.activityCheck);
		clearTimeout(this.inactivityTimeout);
	},

	changeUserActive: function (isActive) {
		this.userActive = isActive;

		this.el.sceneEl.emit('useractive', {isActive}, false);
	},
});
