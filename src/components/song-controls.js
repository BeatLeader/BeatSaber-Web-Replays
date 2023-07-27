var utils = require('../utils');
const ONCE = {once: true};

const NoSleep = require('nosleep.js');
const noSleep = new NoSleep();

let queryParamTime = AFRAME.utils.getUrlParameter('time').trim();
if (!queryParamTime || isNaN(queryParamTime)) {
	queryParamTime = undefined;
} else {
	queryParamTime = parseFloat(queryParamTime) / 1000;
}

var deviceHasTouchScreen = utils.hasTouchScreen();

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
		isSafari: {default: false},
	},

	init: function () {
		this.customDifficultyLabels = {};
		this.song = this.el.components.song;
		this.settings = this.el.components.settings;
		this.hitSound = this.el.components['beat-hit-sound'];
		this.tick = AFRAME.utils.throttleTick(this.tick.bind(this), 100);

		// Seek to ?time if specified.
		if (queryParamTime !== undefined) {
			this.el.sceneEl.addEventListener(
				'songstartaudio',
				() => {
					setTimeout(() => {
						if (queryParamTime >= 0 && queryParamTime <= this.song.source.buffer.duration) {
							this.seek(queryParamTime, false);
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
			if (this.shouldShowMisses) {
				this.makeTimelineOverlay(this.replayData, evt.detail.buffer, this);
				this.shouldShowMisses = false;
			}
			if (queryParamTime >= 0 && queryParamTime <= songDuration) {
				const percent = queryParamTime / songDuration;
				const progress = Math.max(0, Math.min(100, 100 * percent));
				this.playhead.style.width = progress + '%';

				document.getElementById('songProgress').innerHTML = formatSeconds(queryParamTime);
				this.timelineFilter.style.width = this.timeline.getBoundingClientRect().width * percent + 'px';
			}
		});

		this.el.sceneEl.addEventListener('replayloaded', event => {
			if (this.song.source && this.song.source.buffer) {
				this.makeTimelineOverlay(event.detail, this.song.source.buffer, this);
			} else {
				this.shouldShowMisses = true;
			}
			this.replayData = event.detail;

			if (AFRAME.utils.getUrlParameter('speed')) {
				// keep speed from url param
			} else {
				let replay = event.detail.replay;
				if (replay) {
					let speedSlider = document.querySelectorAll('.speedSlider');
					let speed = 1;
					if (replay.info.speed > 0.0001) {
						speed = replay.info.speed;
					} else {
						if (replay.info.modifiers.includes('SS')) {
							speed = 0.85;
						}
						if (replay.info.modifiers.includes('FS')) {
							speed = 1.2;
						}
						if (replay.info.modifiers.includes('SF')) {
							speed = 1.5;
						}
					}
					this.el.addEventListener(
						'songstartaudio',
						() => {
							speedSlider.forEach(element => {
								element.value = speed;
								element.dispatchEvent(new Event('input', {bubbles: true}));
							});
						},
						{once: true}
					);
				}
			}
		});

		this.songProgress = document.getElementById('songProgress');
		this.songSpeedPercent = document.querySelectorAll('.songSpeedPercent');
	},

	update: function (oldData) {
		const data = this.data;

		if (!this.controls) {
			return;
		}

		if (data.isPlaying) {
			document.body.classList.add('isPlaying');
		} else if (oldData.isPlaying) {
			document.body.classList.remove('isPlaying');
		}

		if (data.showControls && !oldData.showControls) {
			document.body.classList.add('showControls');
		} else if (!data.showControls && oldData.showControls) {
			document.body.classList.remove('showControls');
		}

		if (data.songImage != oldData.songImage) {
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
		const timelineCursor = document.getElementById('timelineCursor');

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
			const player = evt.detail;
			document.getElementById('playerAvatar').src = player.avatar;
			document.getElementById('playerName').innerHTML = player.name;
			document.getElementById('playerName').setAttribute('title', player.name);
			document.getElementById('playerCountry').src = player.countryIcon;
			document.getElementById('playerCountry').setAttribute('title', player.country);
			document.getElementById('playerLink').setAttribute('href', player.profileLink);
			document.getElementById('playerInfoOverlay').style.display = 'flex';
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
			const seconds = percent * this.song.source.buffer.duration;

			var previousNote = null;
			var note = null;
			for (let index = 0; index < this.replayData.notes.length; index++) {
				const element = this.replayData.notes[index];
				if (element.time > seconds) {
					note = element;
					if (index > 0) {
						previousNote = this.replayData.notes[index - 1];
					}
					break;
				}
			}

			timelineHover.style.left = marginLeft - 17 + 'px';
			var hoverText = formatSeconds(seconds, this.settings.settings.timeInBeats);

			if (note) {
				if (this.settings.settings.timeInBeats) {
					hoverText += '\nBeat ' + note.mapnote._time.toFixed(3) + '\n';
				}

				hoverText += ' ' + note.accuracy.toFixed(2) + '%';
				timelineHover.style.bottom = ((note.accuracy - this.minAcc) / (this.maxAcc - this.minAcc)) * 40 + 5 + 'px';
			}

			timelineHover.innerHTML = hoverText;

			timelineCursor.style.left = marginLeft + 'px';
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
					if (deviceHasTouchScreen) {
						noSleep.enable();
					}
				}
			} else {
				if (pauseButton.classList.contains('pause')) {
					pauseButton.classList.remove('pause');
					pauseButton.classList.add('play');
					if (deviceHasTouchScreen) {
						noSleep.disable();
					}
				}
			}
		};

		this.el.sceneEl.addEventListener('pausegame', e => {
			togglePause(false);
		});

		this.el.sceneEl.addEventListener('gamemenuresume', e => {
			togglePause(true);
		});
		this.el.sceneEl.addEventListener('gamemenurestart', e => {
			this.finished = false;
			togglePause(true);
			this.el.components['beat-generator'].seek(0);
		});
		this.el.sceneEl.addEventListener('usergesturereceive', e => {
			if (!this.song.data.isPaused) {
				togglePause(true);
			}
			if (this.song.data.isPaused && !this.initialUnpause) {
				this.initialUnpause = true;
				this.el.sceneEl.emit('gamemenuresume', null, false);
			}
			if (this.finished) {
				this.el.sceneEl.emit('gamemenurestart', null, false);
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

		document.getElementById('main-canvas').addEventListener(
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

		const copyURL = (target, time, camera) => {
			let input = document.createElement('input');
			target.appendChild(input);

			let jdParam = '';
			if (this.jdChanged) {
				jdParam = '&jd=' + document.getElementById('jdLabel').innerHTML;
			} else if (AFRAME.utils.getUrlParameter('jd')) {
				jdParam = '&jd=' + AFRAME.utils.getUrlParameter('jd');
			}
			let modeParam = '';
			if (AFRAME.utils.getUrlParameter('mode') && AFRAME.utils.getUrlParameter('mode') != 'Standard') {
				modeParam = '&mode=' + AFRAME.utils.getUrlParameter('mode');
			}

			let baseParams = '';
			if (AFRAME.utils.getUrlParameter('link')) {
				baseParams = `?link=${AFRAME.utils.getUrlParameter('link')}${modeParam}${jdParam}`;
			} else if (AFRAME.utils.getUrlParameter('scoreId')) {
				baseParams = `?scoreId=${AFRAME.utils.getUrlParameter('scoreId')}${modeParam}${jdParam}`;
			} else {
				let songParam = AFRAME.utils.getUrlParameter('id')
					? `?id=${AFRAME.utils.getUrlParameter('id')}`
					: `?hash=${AFRAME.utils.getUrlParameter('hash')}`;
				baseParams = `${songParam}&playerID=${AFRAME.utils.getUrlParameter('playerID')}&difficulty=${AFRAME.utils.getUrlParameter(
					'difficulty'
				)}${modeParam}${jdParam}`;
			}

			if (camera) {
				baseParams += '&' + this.el.components['camera-mover'].cameraPositionQuery();
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
		document.getElementById('copyURLcamera').addEventListener('click', evt => {
			copyURL(evt.currentTarget, true, true);
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
					this.song.audioAnalyser.zeroFirefox();
				} else if (this.song.audioAnalyser.firefoxZeroed) {
					this.song.audioAnalyser.unzeroFirefox(this.song.isPlaying);
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
				if (this.song.data.isPlaying) {
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

		let hitSoundButton = document.getElementById('hitsounds-button');
		let resetHitsounds = document.getElementById('resetHitsounds');

		if (this.settings.settings.hitsoundName.length) {
			hitSoundButton.innerText = this.settings.settings.hitsoundName;
			resetHitsounds.style.display = 'block';
		}

		let hitSoundPicker = document.getElementById('hitSoundPicker');
		hitSoundPicker.addEventListener('input', e => {
			let sound = e.target.files[0];
			if (!sound) return;

			const dataArrayReader = new FileReader();
			dataArrayReader.onload = e => {
				this.settings.settings.hitsoundName = sound.name;
				hitSoundButton.innerText = sound.name;
				resetHitsounds.style.display = 'block';
				this.settings.settings.hitSound = Buffer.from(e.target.result).toString('base64');
				this.settings.sync();

				this.hitSound.refreshBuffer();
			};
			dataArrayReader.readAsArrayBuffer(sound);
		});

		resetHitsounds.addEventListener('click', e => {
			this.settings.resetHitsound();
			this.hitSound.refreshBuffer();

			hitSoundButton.innerText = 'Change hitsounds';
			resetHitsounds.style.display = 'none';
		});
	},

	makeTimelineOverlay: (replayData, buffer, target) => {
		const notes = replayData.notes;
		const pauses = replayData.replay.pauses;

		const timeline = target.timeline;
		const height = 40;
		const width = timeline.getBoundingClientRect().width;
		const duration = buffer.duration;

		const container = document.createElement('div');

		const canvas = document.createElement('canvas');
		canvas.className = 'acc-canvas';
		canvas.style.width = width + 'px';
		const canvas2 = document.createElement('canvas');
		canvas2.className = 'acc-canvas-filter';
		canvas2.style.width = width + 'px';

		const context = canvas.getContext('2d');
		const context2 = canvas2.getContext('2d');
		var minAcc = 100,
			maxAcc = 0;

		for (var i = 0; i < notes.length; i++) {
			if (notes[i].accuracy < minAcc) {
				minAcc = notes[i].accuracy;
			}

			if (notes[i].accuracy > maxAcc) {
				maxAcc = notes[i].accuracy;
			}
		}

		context.scale(300 / width, 1);
		context.beginPath();
		context.moveTo(0, height);

		context2.scale(300 / width, 1);
		context2.beginPath();
		context2.moveTo(0, height);

		var unasignedPauseIndex = 0;
		notes.forEach(note => {
			if (pauses && unasignedPauseIndex < pauses.length && pauses[unasignedPauseIndex].time < note.time) {
				let pause = pauses[unasignedPauseIndex];
				pause.accuracy = note.accuracy;
				unasignedPauseIndex++;

				const img = document.createElement('img');
				img.src = 'assets/img/pause-timeline.png';
				img.className = 'missMark';
				img.style.left = (pause.time / duration) * width - 6 + 'px';
				img.style.setProperty('--hover-bottom', ((pause.accuracy - minAcc) / (maxAcc - minAcc)) * height + 5 + 'px');
				img.title += 'Pause at ' + formatSeconds(pause.time) + ' for ' + formatSeconds(parseInt(pause.duration));

				container.appendChild(img);
			}

			if (note.score < 0) {
				const img = document.createElement('img');
				img.className = 'missMark';
				img.style.left = (note.time / duration) * width - 6 + 'px';
				img.style.setProperty('--hover-bottom', ((note.accuracy - minAcc) / (maxAcc - minAcc)) * height + 5 + 'px');

				if (note.score == -3) {
					img.title = 'Miss';
					img.src = 'assets/img/miss-timeline.png';
				} else if (note.score == -2) {
					img.title = 'Bad cut';
					img.src = 'assets/img/badcut-timeline.png';
				} else if (note.score == -5) {
					img.title = 'Wall hit';
					img.src = 'assets/img/wall-timeline.png';
				} else if (note.score == -4) {
					img.title = 'Bomb hit';
					img.src = 'assets/img/bomb-timeline.png';
				}
				img.title += ' at ' + formatSeconds(note.time);

				container.appendChild(img);
			}

			context.lineTo((note.time / duration) * width, height - (((note.accuracy - minAcc) / (maxAcc - minAcc)) * height + 5));
			context2.lineTo((note.time / duration) * width, height - (((note.accuracy - minAcc) / (maxAcc - minAcc)) * height + 5));
		});

		context.lineTo((notes[notes.length - 1].time / duration) * width, height);
		context.lineTo(0, height);
		context.fillStyle = '#d11769';
		context.fill();

		context2.lineTo((notes[notes.length - 1].time / duration) * width, height);
		context2.lineTo(0, height);
		context2.fillStyle = 'white';
		context2.fill();

		const filter = document.createElement('div');
		filter.className = 'timeline-filter';
		filter.style.width = '0px';
		filter.style.height = height + 'px';
		target.timelineFilter = filter;

		filter.appendChild(canvas2);
		container.appendChild(filter);
		container.appendChild(canvas);
		timeline.appendChild(container);

		target.minAcc = minAcc;
		target.maxAcc = maxAcc;
	},

	tick: function () {
		if (!this.song.isPlaying || !this.song.source) {
			return;
		}
		this.updatePlayhead();
		this.songProgress.innerHTML = formatSeconds(this.song.getCurrentTime());
	},

	seek: function (time, clearBeats = true) {
		this.song.stopAudio();

		// Get new audio buffer source (needed every time audio is stopped).
		this.song.data.analyserEl.addEventListener(
			'audioanalyserbuffersource',
			evt => {
				// Start audio at seek time.
				const source = (this.song.source = evt.detail);

				this.song.startAudio(time);

				if (clearBeats) {
					// Tell beat generator about seek.
					this.el.components['beat-generator'].seek(time);
				}

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
		const percent = this.song.getCurrentTime() / this.song.source.buffer.duration;
		const progress = Math.max(0, Math.min(100, 100 * percent));
		this.playhead.style.width = progress + '%';
		if (seek) {
			this.el.sceneEl.emit('timechanged', {newTime: this.song.getCurrentTime()}, null);
		}

		this.timelineFilter.style.width = this.timeline.getBoundingClientRect().width * percent + 'px';
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
			this.hitSound.setVolume(hitsoundSlider.value);
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
				volumeSlider.valueAsNumber += e.shiftKey ? 0.025 : 0.05;
				masterVolumeHandler();
			}

			if (e.keyCode === 40) {
				// down
				volumeSlider.value -= e.shiftKey ? 0.025 : 0.05;
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

			if (e.keyCode === 72) {
				// h

				if (!this.data.showControls) {
					document.body.classList.add('showControls');
				} else {
					document.body.classList.remove('showControls');
				}
				this.data.showControls = !this.data.showControls;
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
});

function formatSeconds(time, precise) {
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
	if (precise) {
		ret += '.' + Math.round((time - Math.floor(time)) * 1000);
	}
	return ret;
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
			return {name: 'Expert+', shortName: 'E+', difficulty: 9, color: diffColors[name]};

		default:
			return null;
	}
}
