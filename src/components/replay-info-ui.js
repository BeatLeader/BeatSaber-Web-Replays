AFRAME.registerComponent('replay-info-ui', {
	schema: {},
	init: function () {
		this.replayLoader = this.el.sceneEl.components['replay-loader'];
		this.zipLoader = this.el.sceneEl.components['zip-loader'];

		this.el.addEventListener('replayfetched', evt => {
			this.updateUI();
			this.checkMapVersion();
		});

		this.el.addEventListener('challengeloadend', evt => {
			this.checkMapVersion();
		});
	},

	updateUI: function () {
		const modifiers = this.replayLoader.replay.info.modifiers;
		let modifiersLabel = document.getElementById('modifiers');
		modifiersLabel.innerHTML = modifiers;

		modifiersLabel.title = this.describeModifiersAndMultipliers(Array.isArray(modifiers) ? modifiers : modifiers.split(','));
	},

	checkMapVersion: function () {
		if (
			this.replayLoader.replay &&
			this.zipLoader.fetchedZipUrl &&
			this.zipLoader.fetchedZipUrl.includes('beatsaver') &&
			!this.zipLoader.fetchedZipUrl.includes(this.replayLoader.replay.info.hash.substring(0, 40).toLowerCase())
		) {
			let outdatedMap = document.getElementById('outdatedMap');
			outdatedMap.style.display = 'block';
		}
	},

	userDescriptionForModifier: function (modifier) {
		switch (modifier) {
			case 'DA':
				return 'Dissapearing Arrows';
			case 'FS':
				return '"Faster Song" - song is 25% faster';
			case 'SS':
				return '"Slower Song" - song is 25% slower';
			case 'SF':
				return '"Super Fast Song" - song is 50% faster';
			case 'GN':
				return 'Ghost Notes';
			case 'NA':
				return 'No Arrows';
			case 'NB':
				return 'No Bombs';
			case 'NF':
				return 'No Fail';
			case 'NO':
				return 'No Obstacles(Walls)';
		}
		return 'Undefined modifier';
	},

	describeModifiersAndMultipliers: function (modifiers) {
		if (modifiers) {
			let result = 'Modifiers:';
			modifiers.forEach(key => {
				result += '\n' + this.userDescriptionForModifier(key);
			});
			return result;
		} else {
			return '';
		}
	},
});
