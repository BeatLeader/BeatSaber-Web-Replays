{
	/* <a-mixin id="bgColorAnimation"
  animation__bgcoloroff="isRawProperty: true; property: systems.materials.stageNormal.uniforms.backglowColor.value; type: color; to: {{ COLORS.BG_OFF }}; dur: 500; easing: linear; startEvents: bgcoloroff"
  animation__bgcolorblue="isRawProperty: true; property: systems.materials.stageNormal.uniforms.backglowColor.value; type: color; to: {{ COLORS.BG_DARK_BLUE }}; dur: 5; easing: linear; startEvents: bgcolorblue"
  animation__bgcolorbluefade="isRawProperty: true; property: systems.materials.stageNormal.uniforms.backglowColor.value; type: color; from: {{ COLORS.BG_BRIGHTBLUE }}; to: {{ COLORS.BG_DARK_BLUE }}; dur: 500; easing: linear; startEvents: bgcolorbluefade"
  animation__bgcolorred="isRawProperty: true; property: systems.materials.stageNormal.uniforms.backglowColor.value; type: color; to: {{ COLORS.BG_RED }}; dur: 5; easing: linear; startEvents: bgcolorred"
  animation__bgcolorredfade="isRawProperty: true; property: systems.materials.stageNormal.uniforms.backglowColor.value; type: color; from: {{ COLORS.BG_BRIGHTRED }}; to: {{ COLORS.BG_RED }}; dur: 500; easing: linear; startEvents: bgcolorredfade"
  animation__skycoloroff="isRawProperty: true; property: systems.materials.stageNormal.uniforms.skyColor.value; type: color; to: {{ COLORS.SKY_OFF }}; dur: 500; easing: linear; startEvents: bgcoloroff"
  animation__skycolorblue="isRawProperty: true; property: systems.materials.stageNormal.uniforms.skyColor.value; type: color; to: {{ COLORS.SKY_BLUE }}; dur: 5; easing: linear; startEvents: bgcolorblue"
  animation__skycolorred="isRawProperty: true; property: systems.materials.stageNormal.uniforms.skyColor.value; type: color; to: {{ COLORS.SKY_RED }}; dur: 5; easing: linear; startEvents: bgcolorred"
  animation__bgcolorgameover="isRawProperty: true; property: systems.materials.stageNormal.uniforms.backglowColor.value; type: color; to: {{ COLORS.BG_OFF }}; dur: 500; easing: linear; startEvents: bgcolorgameover"
  animation__skycolorgameover="isRawProperty: true; property: systems.materials.stageNormal.uniforms.skyColor.value; type: color; to: {{ COLORS.SKY_BLUE }}; dur: 5; easing: linear; startEvents: bgcolorgameover"></a-mixin>

<a-mixin id="tunnelColorAnimation"
  animation__tunnelcoloroff="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.tunnelNeon.value; type: color; to: {{ COLORS.NEON_OFF }}; dur: 500; easing: linear; startEvents: tunnelcoloroff"
  animation__tunnelcolorblue= {{ COLORS.NEON_BLUE }}; dur: 5; easing: linear; startEvents: tunnelcolorblue"
  animation__tunnelcolorbluefade=" {{ COLORS.NEON_BRIGHTBLUE }}; to: {{ COLORS.NEON_BLUE }}; dur: 500; easing: linear; startEvents: tunnelcolorbluefade"
  animation__tunnelcolorred="is {{ COLORS.NEON_RED }}; dur: 5; easing: linear; startEvents: tunnelcolorred"
  animation__tunnelcolorredfade= from: {{ COLORS.NEON_BRIGHTRED }}; to: {{ COLORS.NEON_RED }}; dur: 500; easing: linear; startEvents: tunnelcolorredfade"></a-mixin>

<a-mixin id="floorColorAnimation"
  animation__floorcoloroff="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.floorNeon.value; type: color; to: {{ COLORS.NEON_OFF }}; dur: 500; easing: linear; startEvents: floorcoloroff"
  animation__floorcolorblue="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.floorNeon.value; type: color; to: {{ COLORS.NEON_BLUE }}; dur: 5; easing: linear; startEvents: floorcolorblue"
  animation__floorcolorbluefade="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.floorNeon.value; type: color; from: {{ COLORS.NEON_BRIGHTBLUE }}; to: {{ COLORS.NEON_BLUE }}; dur: 500; easing: linear; startEvents: floorcolorbluefade"
  animation__floorcolorred="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.floorNeon.value; type: color; to: {{ COLORS.NEON_RED }}; dur: 5; easing: linear; startEvents: floorcolorred"
  animation__floorcolorredfade="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.floorNeon.value; type: color; from: {{ COLORS.NEON_BRIGHTRED }}; to: {{ COLORS.NEON_RED }}; dur: 500; easing: linear; startEvents: floorcolorredfade"></a-mixin>

<a-mixin id="leftLaserColorAnimation"
  animation__leftlasercoloroff="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.leftLaser.value; type: color; to: {{ COLORS.NEON_OFF }}; dur: 500; easing: linear; startEvents: leftlasercoloroff"
  animation__leftlasercolorblue="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.leftLaser.value; type: color; to: {{ COLORS.NEON_BLUE }}; dur: 5; easing: linear; startEvents: leftlasercolorblue"
  animation__leftlasercolorbluefade="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.leftLaser.value; type: color; from: {{ COLORS.NEON_BRIGHTBLUE }}; to: {{ COLORS.NEON_BLUE }}; dur: 500; easing: linear; startEvents: leftlasercolorbluefade"
  animation__leftlasercolorred="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.leftLaser.value; type: color; to: {{ COLORS.NEON_RED }}; dur: 5; easing: linear; startEvents: leftlasercolorred"
  animation__leftlasercolorredfade="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.leftLaser.value; type: color; from: {{ COLORS.NEON_BRIGHTRED }}; to: {{ COLORS.NEON_RED }}; dur: 500; easing: linear; startEvents: leftlasercolorredfade"></a-mixin>

<a-mixin id="rightLaserColorAnimation"
  animation__rightlasercoloroff="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.rightLaser.value; type: color; to: {{ COLORS.NEON_OFF }}; dur: 500; easing: linear; startEvents: rightlasercoloroff"
  animation__rightlasercolorblue="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.rightLaser.value; type: color; to: {{ COLORS.NEON_BLUE }}; dur: 5; easing: linear; startEvents: rightlasercolorblue"
  animation__rightlasercolorbluefade="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.rightLaser.value; type: color; from: {{ COLORS.NEON_BRIGHTBLUE }}; to: {{ COLORS.NEON_BLUE }}; dur: 500; easing: linear; startEvents: rightlasercolorbluefade"
  animation__rightlasercolorred="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.rightLaser.value; type: color; to: {{ COLORS.NEON_RED }}; dur: 5; easing: linear; startEvents: rightlasercolorred"
  animation__rightlasercolorredfade="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.rightLaser.value; type: color; from: {{ COLORS.NEON_BRIGHTRED }}; to: {{ COLORS.NEON_RED }}; dur: 500; easing: linear; startEvents: rightlasercolorredfade"></a-mixin>

<a-mixin id="textGlowColorAnimation"
  animation__textglowoff="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.textGlow.value; type: color; to: {{ COLORS.TEXT_OFF }}; dur: 5; easing: easeInOutCubic; startEvents: textglowoff"
  animation__textglownormal="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.textGlow.value; type: color; to: {{ COLORS.TEXT_NORMAL }}; dur: 750; easing: easeInOutCubic; delay: 100; startEvents: textglownormal"
  animation__textglowbold="isRawProperty: true; property: systems.materials.stageAdditive.uniforms.textGlow.value; type: color; from: {{ COLORS.TEXT_BOLD }}; to: {{ COLORS.TEXT_NORMAL }}; dur: 500; easing: easeInOutCubic; startEvents: textglowbold"
  ></a-mixin> */
}

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

		let wallColorInput = document.getElementById('wallsColor');
		wallColorInput.value = this.settings.settings.wallColor;
		wallColorInput.addEventListener('input', e => {
			this.settings.settings.wallColor = e.target.value;
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
				if (roles.includes('tipper') || roles.includes('supporter') || roles.includes('supporter')) {
					this.currentPlayer = data.player.id;
				}
			}
		});
	},

	getColors: completion => {
		fetch('https://api.beatleader.xyz/user', {credentials: 'include'})
			.then(response => response.json())
			.then(async data => {
				completion(data);
			});
	},

	changeColor: (hand, color) => {
		if (this.playerId == this.replayPlayerId) {
			this.start = new Date().getTime();
			setTimeout(() => {
				if (new Date().getTime() - this.start > 999) {
					fetch(`https://api.beatleader.xyz/user?${hand}=${encodeURIComponent(color)}`, {
						method: 'PATCH',
						credentials: 'include',
					});
				}
			}, 1000);
		}
	},

	update: function (oldData) {},
});
