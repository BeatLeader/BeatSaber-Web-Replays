const {getApiUrl} = require('../utils');

function hexToHSL(hex) {
	let r = parseInt(hex.slice(1, 3), 16);
	let g = parseInt(hex.slice(3, 5), 16);
	let b = parseInt(hex.slice(5, 7), 16);
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h,
		s,
		l = (max + min) / 2;
	if (max === min) {
		h = s = 0;
	} else {
		let d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			case b:
				h = (r - g) / d + 4;
				break;
		}
		h /= 6;
	}
	return [h, s, l];
}

function hslToHex(h, s, l) {
	let r, g, b;
	if (s === 0) {
		r = g = b = l;
	} else {
		const hue2rgb = (p, q, t) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		let p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}
	return (
		'#' +
		[r, g, b]
			.map(x => {
				const hex = Math.round(x * 255).toString(16);
				return hex.length === 1 ? '0' + hex : hex;
			})
			.join('')
	);
}

function brighten(hex) {
	let [h, s, l] = hexToHSL(hex);
	h = Math.max(0, h - 0.2);
	s = Math.min(1, s + 0.1);
	return hslToHex(h, s, l);
}

AFRAME.registerComponent('colors', {
	schema: {},

	updateColors: function () {
		var settings = this.settings.settings;

		var stageAUniforms = this.materials.stageAdditive.uniforms;
		stageAUniforms.tunnelNeon.value = new THREE.Color(settings.redEventColor);
		stageAUniforms.floorNeon.value = new THREE.Color(settings.redEventColor);
		stageAUniforms.leftLaser.value = new THREE.Color(settings.blueEventColor);
		stageAUniforms.rightLaser.value = new THREE.Color(settings.blueEventColor);

		var stageNUniforms = this.materials.stageNormal.uniforms;
		stageNUniforms.backglowColor.value = new THREE.Color(settings.blueBGColor);

		var animationsContainer = this.el.sceneEl;

		['tunnelcolor', 'floorcolor', 'leftlasercolor', 'rightlasercolor'].forEach(eventType => {
			['blue', 'red'].forEach(colorType => {
				animationsContainer.setAttribute(`animation__${eventType}${colorType}`, 'to', settings[colorType + 'EventColor']);

				animationsContainer.setAttribute(`animation__${eventType}${colorType}fade`, 'from', settings[colorType + 'BrightEventColor']);
				animationsContainer.setAttribute(`animation__${eventType}${colorType}fade`, 'to', settings[colorType + 'EventColor']);
			});
		});
		['bgcolor'].forEach(eventType => {
			['blue', 'red'].forEach(colorType => {
				animationsContainer.setAttribute(`animation__${eventType}${colorType}`, 'to', settings[colorType + 'BGColor']);

				animationsContainer.setAttribute(`animation__${eventType}${colorType}fade`, 'from', settings[colorType + 'BrightBGColor']);
				animationsContainer.setAttribute(`animation__${eventType}${colorType}fade`, 'to', settings[colorType + 'BGColor']);
			});
		});
	},

	init: function () {
		this.settings = this.el.components.settings;
		this.materials = this.el.sceneEl.systems.materials;

		this.updateColors();

		['Event', 'BG'].forEach(type => {
			['red', 'blue'].forEach(element => {
				var key = element + type + 'Color';
				let eventColorInput = document.getElementById(key);
				eventColorInput.value = this.settings.settings[key];
				eventColorInput.addEventListener('input', e => {
					this.settings.settings[key] = e.target.value;
					this.settings.settings[element + `Bright${type}Color`] = brighten(this.settings.settings[key]);
					this.updateColors();
					this.settings.sync();
				});
			});
		});

		let backgroundColorInput = document.getElementById('backgroundColor');
		backgroundColorInput.value = this.settings.settings['backgroundColor'];
		backgroundColorInput.addEventListener('input', e => {
			this.settings.settings['backgroundColor'] = e.target.value;
			this.settings.sync();
		});

		let wallColorInput = document.getElementById('wallsColor');
		wallColorInput.value = this.settings.settings.wallColor;
		wallColorInput.addEventListener('input', e => {
			this.settings.settings.wallColor = e.target.value;
			this.settings.sync();
		});

		let bombColorInput = document.getElementById('bombsColor');
		bombColorInput.value = this.settings.settings.bombColor;
		bombColorInput.addEventListener('input', e => {
			this.settings.settings.bombColor = e.target.value;
			this.settings.sync();
		});

		let leftSaberColorInput = document.getElementById('leftSaberColor');
		leftSaberColorInput.addEventListener('input', e => {
			this.el.sceneEl.emit('colorChanged', {hand: 'left', color: e.target.value}, null);
			this.changeColor('leftSaberColor', e.target.value);
		});

		let rightSaberColorInput = document.getElementById('rightSaberColor');
		rightSaberColorInput.addEventListener('input', e => {
			this.el.sceneEl.emit('colorChanged', {hand: 'right', color: e.target.value}, null);
			this.changeColor('rightSaberColor', e.target.value);
		});

		let goodTdColorInput = document.getElementById('goodTdColor');
		goodTdColorInput.value = this.settings.settings.goodTdColor;
		goodTdColorInput.addEventListener('input', e => {
			this.settings.settings.goodTdColor = e.target.value;
			this.settings.sync();
		});

		let badTdColorInput = document.getElementById('badTdColor');
		badTdColorInput.value = this.settings.settings.badTdColor;
		badTdColorInput.addEventListener('input', e => {
			this.settings.settings.badTdColor = e.target.value;
			this.settings.sync();
		});

		const updateTdColorPickers = () => {
			if (this.settings.settings.trailType == 'timeDependence') {
				badTdColorInput.parentElement.style.display = 'block';
				goodTdColorInput.parentElement.style.display = 'block';
			} else {
				badTdColorInput.parentElement.style.display = 'none';
				goodTdColorInput.parentElement.style.display = 'none';
			}
		};
		updateTdColorPickers();

		this.el.sceneEl.addEventListener('settingsChanged', e => {
			updateTdColorPickers();
		});

		this.el.sceneEl.addEventListener('colorsFetched', e => {
			const profileSettings = e.detail.features;
			if (profileSettings.leftSaberColor) {
				leftSaberColorInput.value = profileSettings.leftSaberColor;
				this.el.sceneEl.emit('colorChanged', {hand: 'left', color: profileSettings.leftSaberColor}, null);
			}

			if (profileSettings.rightSaberColor) {
				rightSaberColorInput.value = profileSettings.rightSaberColor;
				this.el.sceneEl.emit('colorChanged', {hand: 'right', color: profileSettings.rightSaberColor}, null);
			}

			this.replayPlayerId = e.detail.playerId;
		});

		this.getColors(data => {
			if (data.player) {
				let roles = data.player.role;
				if (
					roles.includes('tipper') ||
					roles.includes('supporter') ||
					roles.includes('supporter') ||
					roles.includes('admin') ||
					roles.includes('ranked') ||
					roles.includes('quality')
				) {
					this.currentPlayerId = data.player.id;
				}
			}
		});
	},

	getColors: function (completion) {
		fetch(getApiUrl() + '/user', {credentials: 'include'})
			.then(response => response.json())
			.then(async data => {
				completion(data);
			});
	},

	changeColor: function (hand, color) {
		if (this.currentPlayerId == this.replayPlayerId) {
			this.start = new Date().getTime();
			setTimeout(() => {
				if (new Date().getTime() - this.start > 999) {
					fetch(`${getApiUrl()}/user?${hand}=${encodeURIComponent(color)}`, {
						method: 'PATCH',
						credentials: 'include',
					});
				}
			}, 1000);
		}
	},

	update: function (oldData) {},
});
