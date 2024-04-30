const ONCE = {once: true};
const NoSleep = require('nosleep.js');
const noSleep = new NoSleep();

let queryParamTime = AFRAME.utils.getUrlParameter('time').trim();
if (!queryParamTime || isNaN(queryParamTime)) {
	queryParamTime = undefined;
} else {
	queryParamTime = parseFloat(queryParamTime) / 1000;
}

let disabledRoyale = AFRAME.utils.getUrlParameter('noRoyale');

const isValidDate = d => d instanceof Date && !isNaN(d);

const dateFromUnix = str => {
	const date = new Date(parseInt(str, 10) * 1000);

	return isValidDate(date) ? date : null;
};

function formatDateWithOptions(val, options = {localeMatcher: 'best fit'}, locale = navigator.language) {
	if (!isValidDate(val)) return null;

	const rtf = new Intl.DateTimeFormat(locale, options);

	return rtf.format(val);
}

function formatDate(val, dateStyle = 'short', timeStyle = 'medium', locale = navigator.language) {
	return formatDateWithOptions(
		val,
		{
			localeMatcher: 'best fit',
			dateStyle,
			timeStyle,
		},
		locale
	);
}

/**
 * Update the 2D UI. Should handle pause and seek.
 */

// TODO: Divide this component
AFRAME.registerComponent('song-controls', {
	dependencies: ['song'],

	schema: {
		difficulty: {default: ''},
		mode: {default: 'Standard'},
		songName: {default: ''},
		songSubName: {default: ''},
		songImage: {default: ''},
		songId: {default: ''},
		leaderboardId: {default: ''},
		isPlaying: {default: false},
		showControls: {default: true},
		replaysCount: {default: 1},
		isSafari: {default: false},
		disabledRoyale: {default: !disabledRoyale},
		showColorInputs: {default: false},
		showPovs: {default: true},
	},

	init: function () {
		this.customDifficultyLabels = {};
		this.song = this.el.components.song;
		this.settings = this.el.components.settings;
		this.tick = AFRAME.utils.throttleTick(this.tick.bind(this), 100);
		this.headsetStates = [];
		this.switchParents = [];
		this.colorInputs = [];

		// Seek to ?time if specified.
		if (queryParamTime !== undefined) {
			this.el.sceneEl.addEventListener(
				'songstartaudio',
				() => {
					setTimeout(() => {
						if (queryParamTime >= 0 && queryParamTime <= this.song.source.buffer.duration) {
							this.seek(queryParamTime);
							queryParamTime = undefined;
						}
					}, 100);
				},
				ONCE
			);
		}

		const analyser = document.getElementById('audioAnalyser');
		analyser.addEventListener('audioanalyserbuffersource', evt => {
			const songDuration = evt.detail.buffer.duration;
			document.getElementById('songDuration').innerHTML = formatSeconds(songDuration);
			if (this.notes) {
				this.showMisses(this.notes, evt.detail.buffer, this);
				this.notes = null;
			}
			if (queryParamTime >= 0 && queryParamTime <= songDuration) {
				const progress = Math.max(0, Math.min(100, 100 * (queryParamTime / songDuration)));
				this.playhead.style.width = progress + '%';
				document.getElementById('songProgress').innerHTML = formatSeconds(queryParamTime);
			}
		});

		this.el.sceneEl.addEventListener('replayloaded', event => {
			if (this.song.source && this.song.source.buffer) {
				this.showMisses(event.detail.notes, this.song.source.buffer, this);
			} else {
				this.notes = event.detail.notes;
			}
		});

		this.el.sceneEl.addEventListener('povchanged', event => {
			if (event.detail.outside) return;
			if (event.detail.newPov) {
				if (this.povUserIndex !== undefined) {
					this.lastpovswitch.classList.toggle('selected');
				} else {
					this.povUserIndex = 0;

					document.querySelectorAll('.povswitch').forEach(element => {
						if (element.user.replay && element.user.replay.index == 0) {
							element.classList.toggle('selected');
							this.lastpovswitch = element;
						}
					});
				}
			} else {
				if (this.povUserIndex !== undefined) {
					this.lastpovswitch.classList.toggle('selected');
				}
			}
		});

		this.songProgress = document.getElementById('songProgress');
		this.songSpeedPercent = document.querySelectorAll('.songSpeedPercent');
		this.loadedUsersCount = 0;
	},

	update: function (oldData) {
		const data = this.data;

		if (!this.controls) {
			return;
		}

		if (data.isPlaying) {
			document.body.classList.add('isPlaying');

			if (!oldData.isPlaying) {
				const headsets = this.el.sceneEl.querySelectorAll('.headset');
				headsets.forEach((element, index) => {
					element.object3D.visible = element.object3D.visible && this.headsetStates[index];
				});
			}
		} else {
			document.body.classList.remove('isPlaying');
		}

		if (data.showControls && !oldData.showControls) {
			document.body.classList.add('showControls');
		} else if (!data.showControls && oldData.showControls) {
			document.body.classList.remove('showControls');
		}

		document.getElementById('songImage').src = data.songImage;
		document.getElementById('songName').innerHTML = data.songName;
		document.getElementById('songName').setAttribute('title', data.songName);
		document.getElementById('songSubName').innerHTML = data.songSubName;
		document.getElementById('songSubName').setAttribute('title', data.songSubName);
		if (data.leaderboardId.length) {
			document.getElementById('songLink').setAttribute('href', 'https://beatleader.xyz/leaderboard/global/' + data.leaderboardId);
		} else {
			document.getElementById('songLink').setAttribute('href', 'https://beatsaver.com/maps/' + data.songId);
		}

		// document.getElementById('controlsMode').innerHTML = data.mode;

		if ((oldData.difficulty && oldData.difficulty !== data.difficulty) || (oldData.mode && oldData.mode !== data.mode)) {
			removeTimeQueryParam();
		}

		if (oldData.mode && oldData.mode !== data.mode) {
			this.updateDifficultyOptions();
		}

		var updateDivs = false;
		if (oldData.showColorInputs != data.showColorInputs) {
			updateDivs = true;
			const colorInputs = document.querySelectorAll('.colorInput');
			colorInputs.forEach(element => {
				element.style.display = data.showColorInputs ? 'block' : 'none';
			});
		}

		if (oldData.showPovs != data.showPovs) {
			updateDivs = true;
			this.colorInputs.forEach(element => {
				element.style.display = data.showPovs ? 'block' : 'none';
			});
		}

		if (updateDivs) {
			this.switchParents.forEach(element => {
				element.style.display = data.showColorInputs || data.showPovs ? 'flex' : 'none';
			});
		}
	},

	play: function () {
		const controls = (this.controls = document.getElementById('controls'));
		// this.difficulty = document.getElementById('controlsDifficulty');
		// this.difficultyOptions = document.getElementById('controlsDifficultyOptions');
		this.modeDropdownEl = document.getElementById('controlsMode');
		this.modeOptionEls = document.getElementById('controlsModes');
		this.playhead = document.getElementById('playhead');
		const timeline = (this.timeline = document.getElementById('timeline'));
		const timelineHover = (this.timelineHover = document.getElementById('timelineHover'));

		const timelineWidth = timeline.offsetWidth;

		this.el.sceneEl.addEventListener('challengeloadend', evt => {
			this.beatmaps = evt.detail.beatmaps;
			this.difficulties = evt.detail.difficulties;
			this.info = evt.detail.info;

			this.customDifficultyLabels = {};

			// Show controls on load.
			controls.classList.add('challengeLoaded');

			this.updateDifficultyOptions();
			// document.getElementById('difficultyLabel').setAttribute('text', 'value',
			// this.customDifficultyLabels[this.data.difficulty] + "\n(" + this.data.difficulty + ")");

			let diffInfo = getDiffInfo(this.data.difficulty);
			let songDifficulty = document.getElementById('songDifficulty');
			songDifficulty.innerHTML = diffInfo.name;
			songDifficulty.setAttribute('title', diffInfo.name);
			songDifficulty.style.backgroundColor = diffInfo.color;
			document.getElementById('songInfoOverlay').style.display = 'flex';

			if (this.customDifficultyLabels[evt.detail.mode]) {
				let customDiff = this.customDifficultyLabels[evt.detail.mode][evt.detail.difficulty];
				if (customDiff) {
					document.getElementById('songCustomDifficulty').innerHTML = customDiff;
					document.getElementById('songCustomDifficulty').setAttribute('title', customDiff);
				}
			}

			if (evt.detail.mode != 'Standard') {
				document.getElementById('songMode').innerHTML = evt.detail.mode;
				document.getElementById('songMode').style.display = 'block';
			}

			// this.updateModeOptions();
		});

		this.el.sceneEl.addEventListener('userloaded', evt => {
			if (this.data.replaysCount == 1) {
				const player = evt.detail;
				document.getElementById('playerAvatar').src = player.avatar;
				document.getElementById('playerName').innerHTML = player.name;
				document.getElementById('playerName').setAttribute('title', player.name);
				document.getElementById('playerCountry').src = player.countryIcon;
				document.getElementById('playerCountry').setAttribute('title', player.country);
				document.getElementById('playerLink').setAttribute('href', player.profileLink);
				document.getElementById('playerInfoOverlay').style.display = 'flex';
			} else {
				this.loadedUsersCount++;
				if (this.loadedUsersCount == this.data.replaysCount) {
					this.setupPlayersBoard();
				}
			}
		});

		var timelineClicked = false,
			timelineHovered = false;

		let doSeek = (event, fromTime) => {
			var time;
			if (!fromTime) {
				const marginLeft = event.clientX - timeline.getBoundingClientRect().left;
				const percent = marginLeft / timeline.getBoundingClientRect().width;
				time = percent * this.song.source.buffer.duration;
			} else {
				time = fromTime;
			}

			// Get new audio buffer source (needed every time audio is stopped).
			// Start audio at seek time.
			if (time > this.song.source.buffer.duration) {
				this.seek(this.song.source.buffer.duration);
			} else {
				this.seek(time >= 0 ? time : 0);
			}
		};

		// Seek.
		let handleClick = event => {
			if (!this.song.source) {
				return;
			}

			doSeek(event);
			timelineClicked = true;
		};

		handleMove = event => {
			if (!this.song.source || !timelineClicked) {
				return;
			}

			doSeek(event);
		};

		handleUp = event => {
			timelineClicked = false;
		};

		handleLeave = event => {
			timelineHover.classList.remove('timelineHoverActive');
			timelineClicked = false;
			timelineHovered = false;
		};

		if ('onpointerdown' in window) {
			timeline.addEventListener('pointerdown', handleClick);
		} else {
			timeline.addEventListener('touchstart', handleClick);
		}

		if ('onpointermove' in window) {
			timeline.addEventListener('pointermove', handleMove);
		} else {
			timeline.addEventListener('touchmove', handleMove);
		}

		if ('onpointerup' in window) {
			timeline.addEventListener('pointerup', handleUp);
		} else {
			timeline.addEventListener('touchend', handleUp);
		}

		// Seek hover.
		timeline.addEventListener('mouseenter', evt => {
			if (!this.song.source) {
				return;
			}
			timelineHover.classList.add('timelineHoverActive');
			timelineHovered = true;
		});
		timeline.addEventListener('mousemove', evt => {
			const marginLeft = evt.clientX - timeline.getBoundingClientRect().left;
			var percent = marginLeft / timeline.getBoundingClientRect().width;
			if (percent < 0 && percent > -0.05) {
				percent = 0;
			}
			if (percent < 0 || percent > 1) {
				handleLeave();
				return;
			}
			timelineHover.style.left = marginLeft - 17 + 'px';
			timelineHover.innerHTML = formatSeconds(percent * this.song.source.buffer.duration);
		});
		timeline.addEventListener('mouseleave', handleLeave);

		let captureThis = this;
		timeline.addEventListener('wheel', function (e) {
			let currentTime = captureThis.song.getCurrentTime();
			doSeek(null, currentTime - (e.deltaY / 356) * Math.max(captureThis.song.speed, 0.01));
			e.preventDefault();
			e.stopPropagation();
		});

		// Pause.
		let pauseButton = document.getElementById('controlsPause');
		pauseButton.addEventListener('click', e => {
			e.preventDefault();
			if (pauseButton.classList.contains('play')) {
				if (!this.finished) {
					this.el.sceneEl.emit('usergesturereceive', null, false);
					this.el.sceneEl.emit('gamemenuresume', null, false);
				} else {
					this.el.sceneEl.emit('gamemenurestart', null, false);
				}
			} else {
				this.el.sceneEl.emit('pausegame', null, false);
			}
		});

		let togglePause = value => {
			if (value) {
				if (pauseButton.classList.contains('play')) {
					pauseButton.classList.remove('play');
					pauseButton.classList.add('pause');
					noSleep.enable();
				}
			} else {
				if (pauseButton.classList.contains('pause')) {
					pauseButton.classList.remove('pause');
					pauseButton.classList.add('play');
					noSleep.disable();
				}
			}
		};

		this.el.sceneEl.addEventListener('pausegame', e => {
			togglePause(false);
		});

		this.el.sceneEl.addEventListener('gamemenuresume', e => {
			togglePause(true);
		});
		this.el.sceneEl.addEventListener('usergesturereceive', e => {
			if (!this.song.data.isPaused) {
				togglePause(true);
			}
		});

		this.el.sceneEl.addEventListener('finishgame', e => {
			this.finished = true;
			togglePause(false);
		});

		this.el.sceneEl.addEventListener('timechanged', () => {
			this.finished = false;
		});

		// Difficulty dropdown.
		// this.difficulty.addEventListener('click', () => {
		//   controls.classList.remove('modeOptionsActive');
		//   controls.classList.toggle('difficultyOptionsActive');
		// });
		// this.el.sceneEl.addEventListener('click', evt => {
		//   controls.classList.remove('difficultyOptionsActive');
		// });

		// Difficulty select.
		// this.difficultyOptions.addEventListener('click', evt => {
		//   this.songProgress.innerHTML = formatSeconds(0);
		//   this.playhead.style.width = '0%';
		//   this.el.sceneEl.emit('difficultyselect', evt.target.dataset.difficulty, false);
		//   this.difficulty.innerHTML = evt.target.innerHTML;
		//   controls.classList.remove('difficultyOptionsActive');
		// });

		// Mode dropdown.
		// this.modeDropdownEl.addEventListener('click', () => {
		//   controls.classList.remove('difficultyOptionsActive');
		//   controls.classList.toggle('modeOptionsActive');
		// });
		// this.el.sceneEl.addEventListener('click', evt => {
		//   controls.classList.remove('modeOptionsActive');
		// });

		// Mode select.
		// this.modeOptionEls.addEventListener('click', evt => {
		//   this.songProgress.innerHTML = formatSeconds(0);
		//   this.playhead.style.width = '0%';
		//   this.el.sceneEl.emit('modeselect', evt.target.dataset.mode, false);
		//   this.modeDropdownEl.innerHTML = evt.target.innerHTML;
		//   controls.classList.remove('modeOptionsActive');
		// });

		document.addEventListener('searchOpen', () => {
			controls.classList.remove('difficultyOptionsActive');
			controls.classList.remove('modeOptionsActive');
		});

		// Hide volume if click anywhere.
		document.addEventListener('click', evt => {
			var ctxMenu = document.getElementById('ctxMenu');
			ctxMenu.style.display = 'none';

			if (!evt.target.closest('#volumeSliderContainer') && !evt.target.closest('#controlsVolume')) {
				const slider = document.getElementById('volumeSliderContainer');
				const active = slider.classList.contains('volumeActive');
				if (active) {
					slider.classList.remove('volumeActive');
				}
			}

			if (!evt.target.closest('#settingsContainer') && !evt.target.closest('.controlsSettings')) {
				const container = document.getElementById('settingsContainer');
				const active = container.classList.contains('settingsActive');
				if (active) {
					container.classList.remove('settingsActive');
				}
			}

			if (!evt.target.closest('#cameraSettingsContainer') && !evt.target.closest('.controlsCamera')) {
				const container = document.getElementById('cameraSettingsContainer');
				const active = container.classList.contains('settingsActive');
				if (active) {
					container.classList.remove('settingsActive');
				}
			}

			if (!evt.target.closest('#mobileContainer') && !evt.target.closest('.controlsMobile')) {
				const container = document.getElementById('mobileContainer');
				const active = container.classList.contains('settingsActive');
				if (active) {
					container.classList.remove('settingsActive');
				}
			}
		});

		let contextHandler = (event, touch) => {
			var ctxMenu = document.getElementById('ctxMenu');
			ctxMenu.style.display = 'block';
			ctxMenu.style.left = event.pageX - (touch ? 100 : 10) + 'px';
			ctxMenu.style.top = event.pageY - (touch ? 100 : 10) + 'px';
		};

		this.el.sceneEl.addEventListener(
			'contextmenu',
			function (event) {
				event.preventDefault();
				contextHandler(event);
			},
			false
		);

		var timer;
		var taphold;

		this.el.sceneEl.addEventListener('touchstart', function (e) {
			taphold = false;
			timer = setTimeout(function () {
				taphold = true;
				contextHandler(e, true);
			}, 1100);
		});

		this.el.sceneEl.addEventListener('touchend', function (e) {
			if (taphold) {
				e.preventDefault();
			} else {
				clearTimeout(timer);
			}
		});

		this.el.sceneEl.addEventListener('touchmove', function (e) {
			if (taphold) {
				e.preventDefault();
			} else {
				clearTimeout(timer);
			}
		});

		this.el.addEventListener('spawnRotationChanged', event => {
			['scoreContainer', 'lightFixture'].forEach(id => {
				let scoreContainer = document.getElementById(id);
				scoreContainer.setAttribute('animation__rotationY', 'from', event.detail.oldSpawnRotation);
				scoreContainer.setAttribute('animation__rotationY', 'to', event.detail.spawnRotation);
				scoreContainer.emit('spawnRotationStart', null, false);
			});
		});

		const copyURL = (target, time) => {
			let input = document.createElement('input');
			target.appendChild(input);

			let jdParam = '';
			if (this.jdChanged) {
				jdParam = '&jd=' + document.getElementById('jdLabel').innerHTML;
			} else if (AFRAME.utils.getUrlParameter('jd')) {
				jdParam = '&jd=' + AFRAME.utils.getUrlParameter('jd');
			}
			let modeParam = '';
			if (AFRAME.utils.getUrlParameter('mode') != 'Standard') {
				modeParam = '&mode=' + AFRAME.utils.getUrlParameter('mode');
			}

			let baseParams = '';
			if (AFRAME.utils.getUrlParameter('links')) {
				baseParams = `?links=${AFRAME.utils.getUrlParameter('links')}${modeParam}${jdParam}`;
			} else {
				let playerParam = AFRAME.utils.getUrlParameter('playerID')
					? `&playerID=${AFRAME.utils.getUrlParameter('playerID')}`
					: `&players=${AFRAME.utils.getUrlParameter('players')}`;
				let songParam = AFRAME.utils.getUrlParameter('id')
					? `?id=${AFRAME.utils.getUrlParameter('id')}`
					: `?hash=${AFRAME.utils.getUrlParameter('hash')}`;
				baseParams = `${songParam}${playerParam}&difficulty=${AFRAME.utils.getUrlParameter('difficulty')}${modeParam}${jdParam}`;
			}
			let base = location.protocol + '//' + location.host + '/' + baseParams;
			input.value =
				base + (time ? `&time=${Math.round(this.song.getCurrentTime() * 1000)}&speed=${Math.round(this.song.speed * 100)}` : '');
			input.select();
			document.execCommand('copy');
			target.removeChild(input);
		};

		document.getElementById('copyURL').addEventListener('click', evt => {
			copyURL(evt.currentTarget);
		});
		document.getElementById('copyURLtime').addEventListener('click', evt => {
			copyURL(evt.currentTarget, true);
		});

		// Toggle volume slider.
		document.getElementById('controlsVolume').addEventListener('click', evt => {
			document.getElementById('volumeSliderContainer').classList.toggle('volumeActive');
		});

		document.querySelectorAll('.controlsSettings').forEach(element => {
			element.addEventListener('click', evt => {
				document.getElementById('settingsContainer').classList.toggle('settingsActive');
			});
		});

		document.querySelectorAll('.controlsCamera').forEach(element => {
			element.addEventListener('click', evt => {
				document.getElementById('cameraSettingsContainer').classList.toggle('settingsActive');
			});
		});

		document.querySelectorAll('.controlsMobile').forEach(element => {
			console.log('HUI');
			element.addEventListener('click', evt => {
				document.getElementById('mobileContainer').classList.toggle('settingsActive');
			});
		});

		this.setupVolumeControls();
		this.setupOrtoCameraControls();

		let speedSlider = document.querySelectorAll('.speedSlider');

		let firefoxHandler = () => {
			// Firefox seems to not like zeros
			if (navigator.userAgent.toLowerCase().indexOf('firefox') > -1) {
				if (speedSlider[0].value == 0) {
					this.song.audioAnalyser.suspendContext();
					this.firefoxZeroed = true;
				} else if (this.firefoxZeroed && this.song.isPlaying) {
					this.song.audioAnalyser.resumeContext();
					this.firefoxZeroed = undefined;
				}
			}
		};

		let speedHandler = value => {
			firefoxHandler();
			this.song.source.playbackRate.value = value;

			this.song.speed = value;
			speedSlider.forEach(element => {
				element.value = value;
				element.style.setProperty('--value', element.value);
			});

			this.songSpeedPercent.forEach(element => {
				element.innerHTML = Math.round(value * 10000) / 10000 + 'x';
			});
		};

		speedSlider.forEach(element => {
			element.addEventListener('input', evt => {
				speedHandler(evt.target.value);
			});

			element.addEventListener('wheel', function (e) {
				if (e.deltaY < 0) {
					element.valueAsNumber += 0.01;
				} else {
					element.value -= 0.01;
				}
				speedHandler(element.value);
				e.preventDefault();
				e.stopPropagation();
			});

			this.songSpeedPercent.forEach(element => {
				element.innerHTML = this.song.speed + 'x';
			});

			element.value = this.song.speed;
			element.style.setProperty('--value', this.song.speed);
		});

		const rangePoints = document.querySelectorAll('.range__point');
		rangePoints.forEach((el, i) => {
			el.addEventListener('click', evt => {
				const value = (i % 5) * (4 / (rangePoints.length - 2));
				speedSlider.forEach(element => {
					element.valueAsNumber = value;
				});
				speedHandler(value);
			});
		});

		this.el.addEventListener('songstartaudio', () => {
			firefoxHandler();
		});

		let fullscreen = document.querySelectorAll('.controlsFullscreen');

		const fullscreenHandler = inFullscreen => {
			fullscreen.forEach(element => {
				if (inFullscreen) {
					element.classList.add('inFullscreen');
					element.title = 'Exit fullscreen (f)';
				} else {
					element.classList.remove('inFullscreen');
					element.title = 'Enter fullscreen (f)';
				}
			});
		};

		const toggleFullscreen = () => {
			if (fullscreen[0].classList.contains('inFullscreen')) {
				if (this.data.isSafari) {
					document.webkitCancelFullScreen();
				} else {
					document.exitFullscreen();
				}
				fullscreenHandler(false);
			} else {
				if (this.data.isSafari) {
					document.body.webkitRequestFullScreen();
				} else {
					document.body.requestFullscreen();
				}

				fullscreenHandler(true);
			}
		};

		fullscreen.forEach(element => {
			element.addEventListener('click', () => {
				toggleFullscreen();
			});
		});

		document.addEventListener('fullscreenchange', () => {
			fullscreenHandler(document.fullscreenElement);
		});

		document.addEventListener('keydown', e => {
			if (e.key === ' ') {
				if (this.song.isPlaying) {
					this.el.sceneEl.emit('pausegame', null, false);
				} else {
					this.el.sceneEl.emit('usergesturereceive', null, false);
					this.el.sceneEl.emit('gamemenuresume', null, false);
				}
			}
			if (e.keyCode === 70 && !e.shiftKey) {
				// f
				toggleFullscreen();
			}
			if (e.keyCode === 39) {
				// right
				let currentTime = captureThis.song.getCurrentTime();
				doSeek(null, currentTime + Math.max(0.01, 5 * captureThis.song.speed));
			}
			if (e.keyCode === 37) {
				// left
				let currentTime = captureThis.song.getCurrentTime();
				doSeek(null, currentTime - Math.max(0.01, 5 * captureThis.song.speed));
			}
		});

		let jd = document.getElementById('jd');
		let jdLabel = document.getElementById('jdLabel');
		let jdPoint = document.getElementById('jdPoint');
		let jdTick = document.getElementById('jdTick');
		jd.addEventListener('input', () => {
			this.el.components['beat-generator'].updateJD(jd.valueAsNumber);
			this.jdChanged = true;
		});
		this.el.sceneEl.addEventListener('jdCalculated', e => {
			const newJD = e.detail.jd;

			if (newJD != null) {
				const newJDString = '' + newJD.toFixed(2);

				jd.value = newJD;
				jdLabel.innerHTML = newJDString;
			}

			if (e.detail.defaultJd != null) {
				const percent = ((e.detail.defaultJd - jd.min) / (jd.max - jd.min)) * 100;
				jdPoint.attributes.x.value = percent * 0.9 + (50 - percent) / 5 - 10 + '%';
				jdPoint.innerHTML = '' + e.detail.defaultJd.toFixed(2);
				jdTick.attributes.x.value = percent * 0.9 + '%';
			}
		});

		jdPoint.addEventListener('click', evt => {
			this.el.components['beat-generator'].updateJD(parseFloat(jdPoint.innerHTML));
			this.jdChanged = false;
		});

		let pcorner = document.getElementById('patreon-corner');
		let dcorner = document.getElementById('discord-corner');
		if (Math.random() > 0.5) {
			pcorner.style.display = 'block';
		} else {
			dcorner.style.display = 'block';
		}
	},

	showMisses: (notes, buffer, target) => {
		const timeline = target.timeline;

		const marginLeft = timeline.getBoundingClientRect().left;
		const width = timeline.getBoundingClientRect().width;
		const duration = buffer.duration;

		const container = document.createElement('div');

		for (var i = 0; i < notes.length; i++) {
			const note = notes[i];

			if (note.score < 0) {
				const img = document.createElement('img');
				img.src = 'assets/img/wrong.png';
				img.className = 'missMark';
				img.style.left = (note.time / duration) * width - 6 + 'px';
				if (note.score == -3) {
					img.title = 'Miss';
				} else if (note.score == -2) {
					img.title = 'Bad cut';
				} else if (note.score == -5) {
					img.title = 'Wall hit';
				} else if (note.score == -4) {
					img.title = 'Bomb hit';
					img.src = 'assets/img/explode.png';
				}
				img.title += ' at ' + formatSeconds(note.time);

				container.appendChild(img);
			}
		}

		timeline.appendChild(container);
	},

	tick: function () {
		if (!this.song.isPlaying || !this.song.source) {
			return;
		}
		this.updatePlayhead();
		this.songProgress.innerHTML = formatSeconds(this.song.getCurrentTime());
	},

	seek: function (time) {
		this.song.stopAudio();

		// Get new audio buffer source (needed every time audio is stopped).
		this.song.data.analyserEl.addEventListener(
			'audioanalyserbuffersource',
			evt => {
				// Start audio at seek time.
				const source = (this.song.source = evt.detail);

				this.song.startAudio(time);

				// Tell beat generator about seek.
				this.el.components['beat-generator'].seek(time);

				this.updatePlayhead(true);
			},
			ONCE
		);

		this.song.audioAnalyser.refreshSource();
	},

	updateModeOptions: function () {
		// Update mode list.
		for (let i = 0; i < this.modeOptionEls.children.length; i++) {
			const option = this.modeOptionEls.children[i];
			option.style.display = 'none';
			option.innerHTML = option.dataset.mode;
		}
		// Object.keys(this.beatmaps).forEach(mode => {
		//   const option = this.modeOptionEls.querySelector(`[data-mode="${mode}"]`);
		//   option.style.display = 'inline-block';
		// });
	},

	updateDifficultyOptions: function () {
		// Update difficulty list.
		// for (let i = 0; i < this.difficultyOptions.children.length; i++) {
		//   const option = this.difficultyOptions.children[i];
		//   option.style.display = 'none';
		//   option.innerHTML = option.dataset.difficulty;
		// }
		if (!this.difficulties) return;
		this.difficulties[this.data.mode].forEach(difficulty => {
			// const option = this.difficultyOptions.querySelector(`[data-difficulty="${difficulty._difficulty}"]`);
			// option.style.display = 'inline-block';

			// Custom difficulty labels.
			if (!this.info._difficultyBeatmapSets) {
				return;
			}
			this.info._difficultyBeatmapSets.forEach(set => {
				this.customDifficultyLabels[set._beatmapCharacteristicName] = {};
				set._difficultyBeatmaps.forEach(diff => {
					const customLabel = diff._customData ? diff._customData._difficultyLabel : null;
					if (!customLabel) {
						return;
					}

					this.customDifficultyLabels[set._beatmapCharacteristicName][diff._difficulty] = customLabel;
					// if (this.difficulty.innerHTML === diff._difficulty) {
					//   this.difficulty.innerHTML = customLabel;
					// }

					// if (diff._difficulty !== difficulty._difficulty) { return; }
					// option.innerHTML = customLabel;
				});
			});
		});
	},

	updatePlayhead: function (seek) {
		const progress = Math.max(0, Math.min(100, 100 * (this.song.getCurrentTime() / this.song.source.buffer.duration)));
		this.playhead.style.width = progress + '%';
		if (seek) {
			this.el.sceneEl.emit('timechanged', {newTime: this.song.getCurrentTime()}, null);
		}
	},

	setupVolumeControls: function () {
		// Update volume.
		let volumeSlider = document.getElementById('volumeSlider');
		let hitsoundSlider = document.getElementById('hitsoundSlider');
		let musicSlider = document.getElementById('musicSlider');
		let mixerButton = document.getElementById('mixer');
		const captureThis = this;

		let volumeHandler = () => {
			this.song.audioAnalyser.gainNode.gain.cancelScheduledValues(0);
			this.song.audioAnalyser.gainNode.gain.value = musicSlider.value;

			this.settings.settings.volume = musicSlider.value;
			this.settings.settings.hitSoundVolume = hitsoundSlider.value;

			this.settings.sync();
			document.getElementById('beatContainer').components['beat-hit-sound'].setVolume(hitsoundSlider.value);
		};

		let masterVolumeHandler = () => {
			hitsoundSlider.value = volumeSlider.value * this.soundKoeff;
			musicSlider.value = volumeSlider.value;
			volumeHandler();
		};
		volumeSlider.addEventListener('input', evt => {
			masterVolumeHandler();
		});
		musicSlider.addEventListener('input', evt => {
			volumeSlider.value = musicSlider.value;
			captureThis.soundKoeff = hitsoundSlider.value / Math.max(musicSlider.value, 0.01);
			volumeHandler();
		});
		hitsoundSlider.addEventListener('input', evt => {
			captureThis.soundKoeff = hitsoundSlider.value / Math.max(musicSlider.value, 0.01);
			volumeHandler();
		});

		volumeSlider.value = this.settings.settings.volume;
		musicSlider.value = this.settings.settings.volume;
		hitsoundSlider.value = this.settings.settings.hitSoundVolume;
		this.soundKoeff = hitsoundSlider.value / Math.max(musicSlider.value, 0.01);
		document.getElementById('beatContainer').components['beat-hit-sound'].setVolume(hitsoundSlider.value);

		[volumeSlider, hitsoundSlider, musicSlider].forEach(el => {
			el.addEventListener('wheel', function (e) {
				if (e.deltaY < 0) {
					el.valueAsNumber += 0.05;
				} else {
					el.value -= 0.05;
				}
				if (el == volumeSlider) {
					masterVolumeHandler();
				} else {
					volumeHandler();
				}

				e.preventDefault();
				e.stopPropagation();
			});
		});

		let mixerContainer = document.getElementById('mixerContainer');
		mixerButton.addEventListener('click', function () {
			if (mixerButton.classList.contains('selected')) {
				mixerButton.classList.remove('selected');
				volumeSlider.classList.remove('volumeHide');
				mixerContainer.classList.add('volumeHide');
			} else {
				mixerButton.classList.add('selected');
				volumeSlider.classList.add('volumeHide');
				mixerContainer.classList.remove('volumeHide');
			}

			captureThis.settings.settings.volumeMixed = !captureThis.settings.settings.volumeMixed;
			captureThis.settings.sync();
		});

		if (this.settings.settings.volumeMixed) {
			mixerButton.classList.add('selected');
			volumeSlider.classList.add('volumeHide');
			mixerContainer.classList.remove('volumeHide');
		}

		document.addEventListener('keydown', e => {
			if (e.keyCode === 38) {
				// up
				volumeSlider.valueAsNumber += 0.05;
				masterVolumeHandler();
			}

			if (e.keyCode === 40) {
				// up
				volumeSlider.value -= 0.05;
				masterVolumeHandler();
			}

			if (e.keyCode === 77) {
				// m
				if (this.lastVolume == null) {
					this.lastVolume = volumeSlider.value;
					this.lastHitsoundVolume = hitsoundSlider.value;
					volumeSlider.valueAsNumber = 0;
					hitsoundSlider.valueAsNumber = 0;
					musicSlider.valueAsNumber = 0;
				} else if (this.lastVolume) {
					volumeSlider.valueAsNumber = this.lastVolume;
					hitsoundSlider.valueAsNumber = this.lastHitsoundVolume;
					musicSlider.valueAsNumber = this.lastVolume;
					this.lastVolume = null;
				}
				volumeHandler();
			}
		});
	},
	setupOrtoCameraControls: function () {
		var cameraToggles = {};
		var fullscreenCamera = 'Main';
		['Back', 'Right', 'Top', 'Main'].forEach(
			element => (cameraToggles[element] = document.getElementById('orthographic' + element + 'Fullscreen'))
		);
		const updateToggles = () => {
			Object.keys(cameraToggles).forEach(key => {
				const toggle = cameraToggles[key];

				toggle.style.display = this.settings.settings['orthographic' + key + 'Enabled'] ? 'block' : 'none';
				if (fullscreenCamera != key) {
					toggle.classList.remove('inFullscreen');
				} else {
					toggle.classList.add('inFullscreen');
				}
				if (key != 'Main') {
					let camera = this.el.sceneEl.querySelectorAll('.orthographic' + key)[0];
					if (camera.components) {
						camera.setAttribute('orthographic-camera', 'fullscreen', fullscreenCamera == key);
					}
				} else {
					const mainCamera = this.el.sceneEl.querySelectorAll('.mainCamera')[0];
					if (mainCamera.components) {
						mainCamera.components.camera.data.fullscreen = fullscreenCamera == key;
					}
					const povCamera = this.el.sceneEl.querySelectorAll('.povCamera')[0];
					if (povCamera.components) {
						povCamera.components.camera.data.fullscreen = fullscreenCamera == key;
					}
					toggle.style.display = fullscreenCamera != key ? 'block' : 'none';
				}
			});
		};
		this.el.sceneEl.addEventListener('settingsChanged', e => {
			if (fullscreenCamera != 'Main' && !this.settings.settings['orthographic' + fullscreenCamera + 'Enabled']) {
				fullscreenCamera = 'Main';
			}
			updateToggles();
		});
		updateToggles();
		Object.keys(cameraToggles).forEach(key => {
			cameraToggles[key].addEventListener('click', evt => {
				fullscreenCamera = fullscreenCamera == key ? 'Main' : key;
				updateToggles();
			});
		});
	},
	setupPlayersBoard: function () {
		const loader = this.el.sceneEl.components['replay-loader'];
		const cameraMover = this.el.sceneEl.components['camera-mover'];
		const saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');
		const headsets = this.el.sceneEl.querySelectorAll('.headset');

		let usersContainer = document.getElementById('usersContainer');
		let table = document.createElement('table');
		table.className = 'usersTable';
		table.style = 'overflow: auto; border-collapse: collapse';

		usersContainer.append(table);

		const singlePlayer = loader.users.every(u => u.profileLink == loader.users[0].profileLink);

		loader.users.forEach((user, index) => {
			let tableBodyRow = document.createElement('tr');
			tableBodyRow.className = 'playerTableRow';
			tableBodyRow.style.height = '40px';
			tableBodyRow.style.cursor = 'pointer';

			let colorInput = document.createElement('input');
			colorInput.type = 'color';
			colorInput.className = 'colorInput';
			colorInput.style.display = this.data.showColorInputs ? 'block' : 'none';

			const replay = loader.replays.find(el => el && el.info.playerID == user.id);
			if (replay) {
				tableBodyRow.style.backgroundColor = replay.color;
				colorInput.value = replay.color;
				user.replay = replay;
			} else {
				this.el.sceneEl.addEventListener('replayfetched', event => {
					if (event.detail.playerID == user.id) {
						colorInput.value = event.detail.color;
						tableBodyRow.style.backgroundColor = event.detail.color;
						user.replay = loader.replays.find(el => el && el.info.playerID == user.id);
					}
				});
			}

			let div = document.createElement('div');
			div.style.display = 'flex';
			div.style.alignItems = 'center';

			let nameLabel = document.createElement('tb');
			nameLabel.innerHTML = '<b>' + (singlePlayer ? formatDate(dateFromUnix(user.replay.info.timestamp)) : user.name) + '</b>';
			nameLabel.style.display = 'inline';
			nameLabel.style.color = 'white';

			let avatar = document.createElement('img');
			avatar.src = user.avatar;
			avatar.style.display = 'inline';
			avatar.style.width = '20px';
			avatar.style.height = '20px';
			avatar.style.margin = '3px';

			let countryIcon = document.createElement('img');
			countryIcon.src = user.countryIcon;
			countryIcon.style.display = 'inline';
			countryIcon.style.margin = '5px';
			countryIcon.style.width = '15px';
			countryIcon.style.height = '11px';

			div.append(avatar, nameLabel, countryIcon);

			let div2 = document.createElement('div');
			div2.style.display = 'flex';
			div2.style.alignItems = 'center';
			div2.style.justifyContent = 'space-between';

			let scoreLabel = document.createElement('tb');
			scoreLabel.innerHTML = '0';
			scoreLabel.className = 'scoreLabel';
			scoreLabel.style.color = 'white';
			scoreLabel.style.margin = '2px';

			let accLabel = document.createElement('tb');
			accLabel.innerHTML = '100%';
			accLabel.style.color = 'white';
			accLabel.style.margin = '2px';

			colorInput.addEventListener('input', evt => {
				tableBodyRow.style.backgroundColor = evt.target.value;
				this.el.sceneEl.emit('colorChanged', {index: user.replay.index, color: evt.target.value}, null);
			});

			let div3 = document.createElement('div');
			div3.style.display = 'flex';
			div3.style.alignItems = 'center';
			div3.className = 'colorpovswitchdiv';
			div3.style.justifyContent = 'space-between';
			this.switchParents.push(div3);

			let povswitch = document.createElement('button');
			povswitch.title = 'First person view (shift+f)';
			povswitch.className = 'povswitch';
			povswitch.style.display = this.data.showPovs ? 'block' : 'none';
			povswitch.user = user;
			this.colorInputs.push(povswitch);

			povswitch.addEventListener('click', e => {
				if (this.povUserIndex === undefined || this.povUserIndex == user.replay.index) {
					cameraMover.togglePov();
					if (this.povUserIndex !== undefined) {
						this.povUserIndex = undefined;
					} else {
						this.povUserIndex = user.replay.index;
					}
				} else {
					this.povUserIndex = user.replay.index;
				}

				loader.povReplayIndex = user.replay.index;

				if (this.lastpovswitch) {
					if (this.povUserIndex !== undefined) {
						this.lastpovswitch.classList.toggle('selected');
						this.lastpovswitch = povswitch;
					} else {
						this.lastpovswitch = undefined;
					}
				} else if (this.lastpovswitch != povswitch) {
					this.lastpovswitch = povswitch;
				}
				povswitch.classList.toggle('selected');
			});

			div3.style.display = this.data.showPovs || this.data.showColorInputs ? 'flex' : 'none';

			div3.append(povswitch, colorInput);
			div2.append(scoreLabel, accLabel, div3);

			const selectUser = () => {
				tableBodyRow.style.border = '3px solid white';
				loader.users.forEach((inneruser, index) => {
					if (inneruser.replay.index == user.replay.index) {
						this.el.sceneEl.emit('colorChanged', {index: user.replay.index, color: 'white', opacity: 1.0}, null);
					} else {
						this.el.sceneEl.emit('colorChanged', {index: inneruser.replay.index, color: inneruser.replay.color, opacity: 0.25}, null);
					}
				});
				this.selectedUserIndex = user.replay.index;
				this.selectedRow = tableBodyRow;
			};
			const unselectUser = () => {
				if (this.selectedRow) {
					this.selectedRow.style.border = '';
				}
				loader.users.forEach((user, index) => {
					this.el.sceneEl.emit('colorChanged', {index: user.replay.index, color: user.replay.color}, null);
				});
			};

			tableBodyRow.addEventListener('mouseenter', evt => {
				if (tableBodyRow.visible == false) return;
				if (!this.userSelected) {
					selectUser();
				}
			});
			tableBodyRow.addEventListener('click', evt => {
				if (evt.target.classList.contains('povswitch') || evt.target.classList.contains('colorInput')) return;
				if (tableBodyRow.visible == false) return;
				if (this.userSelected && this.selectedUserIndex != user.replay.index) {
					unselectUser();
					selectUser();
				} else {
					this.userSelected = !this.userSelected;
				}
			});
			tableBodyRow.addEventListener('mouseleave', evt => {
				if (tableBodyRow.visible == false) return;
				if (!this.userSelected) {
					unselectUser();
				}
			});

			tableBodyRow.append(div, div2);
			table.append(tableBodyRow);

			this.el.sceneEl.addEventListener('scoreChanged', event => {
				if (user.replay) {
					let note = user.replay.noteStructs[event.detail.index];
					let headset = headsets[user.replay.index];
					const leftSaberEl = saberEls[user.replay.index * 2];
					const rightSaberEl = saberEls[user.replay.index * 2 + 1];
					if (this.data.disabledRoyale) {
						scoreLabel.innerHTML = '' + note.totalScore;
						if (!leftSaberEl.object3D.visible) {
							tableBodyRow.visible = true;
							tableBodyRow.style.cursor = 'pointer';
							tableBodyRow.style.opacity = 1;
							leftSaberEl.object3D.visible = true;
							leftSaberEl.components.trail.data.eliminated = false;
							leftSaberEl.components.trail.data.enabled = true;
							leftSaberEl.components.trail.mesh.visible = true;
							rightSaberEl.object3D.visible = true;
							rightSaberEl.components.trail.data.eliminated = false;
							rightSaberEl.components.trail.data.enabled = true;
							rightSaberEl.components.trail.mesh.visible = true;
							headset.object3D.visible = true;
							this.headsetStates[user.replay.index] = true;
						}
					} else {
						if (event.detail.index > loader.noteCountForBattle * Math.max(loader.replays.length - 1 - tableBodyRow.rowIndex, 0.8)) {
							scoreLabel.innerHTML = '' + 0;
							if (leftSaberEl.object3D.visible) {
								tableBodyRow.visible = false;
								tableBodyRow.style.cursor = '';
								tableBodyRow.style.opacity = 0;
								leftSaberEl.object3D.visible = false;
								leftSaberEl.components.trail.data.enabled = false;
								leftSaberEl.components.trail.data.eliminated = true;
								leftSaberEl.components.trail.mesh.visible = false;
								rightSaberEl.object3D.visible = false;
								rightSaberEl.components.trail.data.enabled = false;
								rightSaberEl.components.trail.data.eliminated = true;
								rightSaberEl.components.trail.mesh.visible = false;
								headset.object3D.visible = false;
								this.headsetStates[user.replay.index] = false;

								if (this.selectedUserIndex == user.replay.index) {
									unselectUser();
								}
							}
						} else {
							scoreLabel.innerHTML = '' + note.totalScore;
							if (!leftSaberEl.object3D.visible) {
								tableBodyRow.visible = true;
								tableBodyRow.style.cursor = 'pointer';
								tableBodyRow.style.opacity = 1;
								leftSaberEl.object3D.visible = true;
								leftSaberEl.components.trail.data.eliminated = false;
								leftSaberEl.components.trail.data.enabled = true;
								leftSaberEl.components.trail.mesh.visible = true;
								rightSaberEl.object3D.visible = true;
								rightSaberEl.components.trail.data.eliminated = false;
								rightSaberEl.components.trail.data.enabled = true;
								rightSaberEl.components.trail.mesh.visible = true;
								headset.object3D.visible = true;
								this.headsetStates[user.replay.index] = true;
							}
						}
					}

					accLabel.innerHTML = '' + note.accuracy + '%';
					this.sortTable();
				}
			});
		});
	},
	sortTable: function () {
		var table, rows, switching, i, x, y, shouldSwitch;
		table = document.querySelectorAll('.usersTable')[0];
		switching = true;
		/* Make a loop that will continue until
    no switching has been done: */
		while (switching) {
			// Start by saying: no switching is done:
			switching = false;
			rows = table.rows;
			/* Loop through all table rows (except the
      first, which contains table headers): */
			for (i = rows.length - 2; i >= 0; i--) {
				// Start by saying there should be no switching:
				shouldSwitch = false;
				/* Get the two elements you want to compare,
        one from current row and one from the next: */
				x = rows[i].querySelectorAll('.scoreLabel')[0];
				y = rows[i + 1].querySelectorAll('.scoreLabel')[0];
				// Check if the two rows should switch place:
				if (parseInt(x.innerHTML) < parseInt(y.innerHTML)) {
					// If so, mark as a switch and break the loop:
					shouldSwitch = true;
					break;
				}
			}
			if (shouldSwitch) {
				/* If a switch has been marked, make the switch
        and mark that a switch has been done: */
				rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
				switching = true;
			}
		}
	},
});

function truncate(str, length) {
	if (!str) {
		return '';
	}
	if (str.length >= length) {
		return str.substring(0, length - 2) + '..';
	}
	return str;
}

const timeRe = /time=\d+/;
function setTimeQueryParam(time) {
	time = parseInt(time);
	let search = window.location.search.toString();
	if (search) {
		if (search.match(timeRe)) {
			search = search.replace(timeRe, `time=${time}`);
		} else {
			search += `&time=${time}`;
		}
	} else {
		search = `?time=${time}`;
	}

	let url = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
	url += search;
	window.history.pushState({path: url}, '', url);
}

function formatSeconds(time) {
	// Hours, minutes, and seconds.
	const hrs = ~~(time / 3600);
	const mins = ~~((time % 3600) / 60);
	const secs = ~~time % 60;

	// Output like '1:01' or '4:03:59' or '123:03:59'.
	let ret = '';
	if (hrs > 0) {
		ret += '' + hrs + ':' + (mins < 10 ? '0' : '');
	}
	ret += '' + mins + ':' + (secs < 10 ? '0' : '');
	ret += '' + secs;
	return ret;
}

function removeTimeQueryParam() {
	let search = window.location.search.toString();
	search = search.replace(timeRe, '');
	let url = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
	url += search;
	window.history.pushState({path: url}, '', url);
}

const diffColors = {
	Easy: 'MediumSeaGreen',
	Normal: '#59b0f4',
	Hard: 'tomato',
	Expert: '#bf2a42',
	ExpertPlus: '#8f48db',
};

function getDiffInfo(name) {
	switch (name) {
		case 'Easy':
			return {name, shortName: 'Es', difficulty: 1, color: diffColors[name]};
		case 'Normal':
			return {name, shortName: 'N', difficulty: 3, color: diffColors[name]};
		case 'Hard':
		case 'hard':
			return {name, shortName: 'H', difficulty: 5, color: diffColors[name]};
		case 'Expert':
			return {name, shortName: 'Ex', difficulty: 7, color: diffColors[name]};
		case 'ExpertPlus':
			return {
				name: 'Expert+',
				shortName: 'E+',
				difficulty: 9,
				color: diffColors[name],
			};

		default:
			return null;
	}
}
