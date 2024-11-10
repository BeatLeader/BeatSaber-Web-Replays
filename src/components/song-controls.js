var utils = require('../utils');
var {queryParamTime} = require('../query-params');
const ONCE = {once: true};

const NoSleep = require('nosleep.js');
const noSleep = new NoSleep();

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
		autoplayOnLoad: {default: false},
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
			if (this.replayData) {
				this.makeTimelineOverlay(this.replayData, evt.detail.buffer, this);
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
			}
			this.replayData = event.detail;

			if (utils.getUrlParameter('speed')) {
				// keep speed from url param
			} else {
				let replay = event.detail.replay;
				if (replay) {
					let speedSlider = document.querySelectorAll('.speedSlider');
					let speed = 1;

					const addRangePoint = (modifier, speedValue) => {
						const rangePoints = document.querySelector('.rangeTicks');
						if (!rangePoints) return;

						const svg = rangePoints.querySelector('svg');
						const newPoint = document.createElementNS('http://www.w3.org/2000/svg', 'text');
						newPoint.setAttribute('class', 'range__point');
						newPoint.setAttribute('x', `${(speedValue / 2) * 100}%`);
						newPoint.setAttribute('y', '8');
						newPoint.setAttribute('text-anchor', 'middle');
						newPoint.style.fontSize = '8px';
						newPoint.textContent = modifier;
						svg.appendChild(newPoint);

						newPoint.addEventListener('click', evt => {
							speedSlider.forEach(element => {
								element.value = speedValue;
								element.dispatchEvent(new Event('input', {bubbles: true}));
							});
						});
					};

					if (replay.info.speed > 0.0001) {
						speed = replay.info.speed;
					} else {
						const modifierSpeeds = {
							SS: 0.85,
							FS: 1.2,
							SF: 1.5,
						};

						for (const [modifier, speedValue] of Object.entries(modifierSpeeds)) {
							if (replay.info.modifiers.includes(modifier)) {
								speed = speedValue;
								if (modifier === 'SF') {
									// Remove the 75% tick mark for SF
									const rangeTicks = document.querySelector('.rangeTicks');
									if (rangeTicks) {
										const tickToRemove = rangeTicks.querySelector('rect[x="75%"]');
										if (tickToRemove) {
											tickToRemove.remove();
										}
									}
								}
								addRangePoint(modifier, speedValue);
							}
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

		if (data.autoplayOnLoad && !oldData.autoplayOnLoad) {
			utils.checkAutoplay().then(canAutoplay => {
				if (!canAutoplay) {
					document.getElementById('autoplayWarning').style.display = 'block';
					if (utils.isFirefox()) {
						document.getElementById('firefoxAutoplayWarning').style.display = 'block';
					}
				} else {
					document.getElementById('autoplayWarning').style.display = 'none';
					document.getElementById('firefoxAutoplayWarning').style.display = 'none';
				}
			});
		} else if (!data.autoplayOnLoad && oldData.autoplayOnLoad) {
			document.getElementById('autoplayWarning').style.display = 'none';
			document.getElementById('firefoxAutoplayWarning').style.display = 'none';
		}

		if (data.songImage != oldData.songImage) {
			document.getElementById('songImage').src = data.songImage;
			document.getElementById('songName').innerHTML = data.songName;
			document.getElementById('songName').setAttribute('title', data.songName);
			document.getElementById('songSubName').innerHTML = data.songSubName;
			document.getElementById('songSubName').setAttribute('title', data.songSubName);
			if (data.leaderboardId.length) {
				document.getElementById('songLink').setAttribute('href', utils.getWebsiteUrl() + '/leaderboard/global/' + data.leaderboardId);
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
			this.beatData = this.beatmaps[this.data.mode][this.data.difficulty];

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

			if (evt.detail.customData && evt.detail.customData[evt.detail.mode][evt.detail.difficulty]) {
				const removal = evt.detail.customData[evt.detail.mode][evt.detail.difficulty]['_environmentRemoval'];
				if (removal) {
					var settings = this.settings.settings;

					removal.forEach(element => {
						switch (element) {
							case 'Spectrograms':
								settings.showAudioColumns = false;
								break;
							case 'Floor':
								settings.showFloor = false;
								break;
							case 'TrackLaneRing':
								settings.showTwister = false;
								break;
							case 'BackColumns':
								settings.showLasers = false;
								settings.showPlatform = false;
								break;
							case 'Frame':
								settings.showHud = false;
								break;

							default:
								break;
						}
					});

					// Don't persist the settings
					this.el.sceneEl.emit('settingsChanged', {settings}, false);
				}
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
					navigator.mediaSession.playbackState = 'playing';
				}
			} else {
				if (pauseButton.classList.contains('pause')) {
					pauseButton.classList.remove('pause');
					pauseButton.classList.add('play');
					if (deviceHasTouchScreen) {
						noSleep.disable();
					}
					navigator.mediaSession.playbackState = 'paused';
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

		this.el.sceneEl.addEventListener('useractive', evt => {
			if (evt.detail.isActive) {
				setTimeout(() => {
					this.userActive = evt.detail.isActive;
				}, 1500);
			} else {
				this.userActive = evt.detail.isActive;
			}
		});

		// Hide volume if click anywhere.
		document.addEventListener('click', evt => {
			if (!this.userActive) return;

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
			} else if (utils.getUrlParameter('jd')) {
				jdParam = '&jd=' + utils.getUrlParameter('jd');
			}
			let modeParam = '';
			if (utils.getUrlParameter('mode') && utils.getUrlParameter('mode') != 'Standard') {
				modeParam = '&mode=' + utils.getUrlParameter('mode');
			}

			let baseParams = '';
			if (utils.getUrlParameter('link')) {
				baseParams = `?link=${utils.getUrlParameter('link')}${modeParam}${jdParam}`;
			} else if (utils.getUrlParameter('scoreId')) {
				baseParams = `?scoreId=${utils.getUrlParameter('scoreId')}${modeParam}${jdParam}`;
			} else {
				let songParam = utils.getUrlParameter('id') ? `?id=${utils.getUrlParameter('id')}` : `?hash=${utils.getUrlParameter('hash')}`;
				baseParams = `${songParam}&playerID=${utils.getUrlParameter('playerID')}&difficulty=${utils.getUrlParameter(
					'difficulty'
				)}${modeParam}${jdParam}`;
			}

			if (camera) {
				baseParams += '&' + this.el.components['camera-mover'].cameraPositionQuery();
			}

			if (utils.getUrlParameter('mapLink')) {
				baseParams += '&mapLink=' + utils.getUrlParameter('mapLink');
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
			if (utils.isFirefox()) {
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

		const togglePlayback = () => {
			if (this.song.data.isPlaying) {
				this.el.sceneEl.emit('pausegame', null, false);
			} else {
				this.el.sceneEl.emit('usergesturereceive', null, false);
				this.el.sceneEl.emit('gamemenuresume', null, false);
			}
		};

		const seekRight = (divider = 0.2) => {
			let currentTime = captureThis.song.getCurrentTime();
			doSeek(null, currentTime + Math.max(0.01, captureThis.song.speed / divider));
		};

		const seekLeft = (divider = 0.2) => {
			let currentTime = captureThis.song.getCurrentTime();
			doSeek(null, currentTime - Math.max(0.01, captureThis.song.speed / divider));
		};

		const seekRightBeats = (step = 0) => {
			let currentTime = captureThis.song.getCurrentTime();
			let currentBeat = captureThis.beatData.reverseTimeConvertor(currentTime);

			doSeek(null, captureThis.beatData.timeConvertor(parseFloat(currentBeat) + step));
		};

		const seekLeftBeats = (step = 0) => {
			let currentTime = captureThis.song.getCurrentTime();
			let currentBeat = captureThis.beatData.reverseTimeConvertor(currentTime);

			doSeek(null, captureThis.beatData.timeConvertor(parseFloat(currentBeat) - step));
		};

		const toggleiosfullscreen = async () => {
			if (!this.video) {
				this.video = document.createElement('video');
				this.video.muted = true;
				this.video.playsInline = true;
				this.video.style.position = 'fixed';
				this.video.style.top = '0';
				this.video.style.left = '0';
				this.video.style.width = '100%';
				this.video.style.height = '100%';
				this.video.style.objectFit = 'contain';
				this.video.style.backgroundColor = 'black';

				this.video.addEventListener('seeked', function () {
					seekLeft();
				});
				this.video.addEventListener('seekforward', function () {
					seekRight();
				});
				const mainCanvas = document.getElementById('main-canvas');
				this.video.srcObject = mainCanvas.captureStream(60);

				document.body.appendChild(this.video);
				await this.video.play();
			}

			try {
				if (!this.song.data.isPlaying) {
					this.video.pause();
				}

				const playbackListener = () => {
					if (this.video.webkitDisplayingFullscreen) {
						togglePlayback();
					}
				};

				setTimeout(() => {
					this.video.addEventListener('play', playbackListener);

					this.video.addEventListener('pause', playbackListener);
				}, 100);

				this.video.webkitEnterFullscreen();

				var exitFullscreen = null;
				const leavepictureinpicture = () => {
					setTimeout(() => {
						if (this.video.webkitDisplayingFullscreen) {
							document.body.appendChild(this.video);
							this.video.addEventListener('webkitendfullscreen', exitFullscreen);
							fullscreenHandler(true);
						} else {
							this.video.removeEventListener('play', playbackListener);
							this.video.removeEventListener('pause', playbackListener);
							this.video.pause();
							this.video.srcObject = null;

							this.video.removeEventListener('leavepictureinpicture', leavepictureinpicture);
							this.video = null;
						}
					}, 200);
				};

				exitFullscreen = () => {
					setTimeout(() => {
						if (document.pictureInPictureElement === this.video) {
							this.video.addEventListener('leavepictureinpicture', leavepictureinpicture);
							document.body.removeChild(this.video);
							this.video.removeEventListener('webkitendfullscreen', exitFullscreen);
						} else {
							this.video.removeEventListener('play', playbackListener);
							this.video.removeEventListener('pause', playbackListener);
							this.video.pause();
							this.video.srcObject = null;

							document.body.removeChild(this.video);
							this.video.removeEventListener('webkitendfullscreen', exitFullscreen);
							this.video = null;
						}

						fullscreenHandler(false);
					}, 200);
				};

				this.video.addEventListener('webkitendfullscreen', exitFullscreen);
			} catch (error) {
				console.error('Error entering fullscreen:', error);
				document.body.removeChild(this.video);
			}
		};

		const toggleFullscreen = () => {
			if (fullscreen[0].classList.contains('inFullscreen')) {
				if (this.data.isSafari) {
					document.webkitCancelFullScreen();
				} else if (document.exitFullscreen) {
					document.exitFullscreen();
				} else if (document.webkitExitFullscreen) {
					document.webkitExitFullscreen();
				}
				fullscreenHandler(false);
			} else {
				if (this.data.isSafari) {
					try {
						document.body.webkitRequestFullscreen();
					} catch (error) {
						toggleiosfullscreen();
					}
				} else if (document.body.requestFullscreen) {
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
			if (e.key === ' ' || e.keyCode == 75) {
				togglePlayback();
			}
			if (e.keyCode === 70 && !e.shiftKey) {
				// f
				toggleFullscreen();
			}
			if (e.keyCode === 39 || e.keyCode == 76) {
				// right
				seekRight(e.shiftKey ? 2 : 0.2);
			}
			if (e.keyCode === 37 || e.keyCode == 74) {
				// left
				seekLeft(e.shiftKey ? 2 : 0.2);
			}

			if (e.keyCode === 190) {
				// right
				seekRightBeats(e.shiftKey ? 0.1 : 1);
			}
			if (e.keyCode === 188) {
				// left
				seekLeftBeats(e.shiftKey ? 0.1 : 1);
			}

			if (!e.ctrlKey && (e.keyCode === 189 || e.keyCode === 173)) {
				// -
				const currentSpeed = parseFloat(this.song.speed);
				const change = e.shiftKey ? 0.01 : 0.1;

				speedHandler(Math.max(currentSpeed - change, 0));
			}
			if (!e.ctrlKey && (e.keyCode === 187 || e.keyCode === 61)) {
				// +
				const currentSpeed = parseFloat(this.song.speed);
				const change = e.shiftKey ? 0.01 : 0.1;

				speedHandler(Math.min(currentSpeed + change, 2));
			}
		});

		if ('mediaSession' in navigator) {
			navigator.mediaSession.setActionHandler('play', function () {
				if (!this.video) {
					togglePlayback();
				}
			});
			navigator.mediaSession.setActionHandler('pause', function () {
				if (!this.video) {
					togglePlayback();
				}
			});
			navigator.mediaSession.setActionHandler('seekbackward', function () {
				seekLeft();
			});
			navigator.mediaSession.setActionHandler('seekforward', function () {
				seekRight();
			});
			if (utils.getCookie('autoplayReplay')) {
				navigator.mediaSession.setActionHandler('previoustrack', function () {
					utils.setCookie('autoplayReplay', true, 30);
					window.history.go(-1);
				});
			}
			navigator.mediaSession.setActionHandler('nexttrack', function () {
				utils.setCookie('autoplayReplay', true, 30);
				window.history.forward();
				captureThis.el.sceneEl.components['random-replay'].fetchRandomReplay(true);
			});
			try {
				navigator.mediaSession.setActionHandler('enterpictureinpicture', async function () {
					if (!this.video) {
						const video = document.createElement('video');
						video.srcObject = document.getElementById('main-canvas').captureStream(25);
						video.muted = true;
						this.video = video;
					}
					await this.video.play();
					await this.video.requestPictureInPicture();
				});
			} catch (error) {
				console.log('Warning! The "enterpictureinpicture" media session action is not supported.');
			}
			try {
				navigator.mediaSession.setActionHandler('seekto', function (event) {
					doSeek(null, event.seekTime);
				});
			} catch (error) {
				console.log('Warning! The "seekto" media session action is not supported.');
			}
		}

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

	makeTimelineOverlay: function (replayData, buffer, target) {
		const notes = replayData.notes;
		const pauses = replayData.replay.pauses;

		const timeline = target.timeline;
		const height = 40;
		const width = timeline.getBoundingClientRect().width;
		const duration = buffer.duration;

		let containers = document.querySelectorAll('.timeline-container');
		containers.forEach(element => {
			timeline.removeChild(element);
		});

		const container = document.createElement('div');
		container.className = 'timeline-container';

		const canvas = document.createElement('canvas');
		canvas.className = 'acc-canvas';
		canvas.width = width;
		canvas.style.width = width + 'px';

		const canvas2 = document.createElement('canvas');
		canvas2.className = 'acc-canvas-filter';
		canvas2.width = width;
		canvas2.style.width = width + 'px';

		const markersCanvas = document.createElement('canvas');
		markersCanvas.className = 'markers-canvas';
		markersCanvas.width = width * window.devicePixelRatio;
		markersCanvas.height = height * window.devicePixelRatio;
		markersCanvas.style.width = width + 'px';

		const context = canvas.getContext('2d', {alpha: false});
		const context2 = canvas2.getContext('2d', {alpha: false});
		const markersContext = markersCanvas.getContext('2d');

		markersContext.scale(window.devicePixelRatio, window.devicePixelRatio);

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

		context.beginPath();
		context.moveTo(0, height);

		context2.beginPath();
		context2.moveTo(0, height);

		const markers = [];
		const markerImages = {};
		const markerTypes = ['pause', 'fail', 'start', 'maxStreak', 'miss', 'badCut', 'wall', 'bomb'];
		let loadedImages = 0;

		markerTypes.forEach(type => {
			const img = new Image();
			img.src = `assets/img/${type}-timeline.png`;
			img.onload = () => {
				loadedImages++;
				if (loadedImages === markerTypes.length) {
					drawMarkers();
				}
				markerImages[type] = img;
			};
		});

		var unasignedPauseIndex = 0;
		notes.forEach(note => {
			if (pauses && unasignedPauseIndex < pauses.length && pauses[unasignedPauseIndex].time < note.time) {
				let pause = pauses[unasignedPauseIndex];
				pause.accuracy = note.accuracy;
				unasignedPauseIndex++;

				markers.push({
					type: 'pause',
					x: (pause.time / duration) * width,
					y: height - ((pause.accuracy - minAcc) / (maxAcc - minAcc)) * height,
					time: pause.time,
					duration: pause.duration,
				});
			}

			if (note.fail || note.start) {
				markers.push({
					type: note.fail ? 'fail' : 'start',
					x: (note.time / duration) * width,
					y: height - ((note.accuracy - minAcc) / (maxAcc - minAcc)) * height,
					time: note.time,
					spawnTime: note.spawnTime,
				});
			}

			if (note.maxStreak) {
				markers.push({
					type: 'maxStreak',
					x: (note.time / duration) * width,
					y: height - ((note.accuracy - minAcc) / (maxAcc - minAcc)) * height,
					time: note.time,
					spawnTime: note.spawnTime,
					maxStreak: note.maxStreak,
				});
			}

			if (note.score < 0) {
				markers.push({
					type:
						note.score === -3 ? 'miss' : note.score === -2 ? 'badCut' : note.score === -5 ? 'wall' : note.score === -4 ? 'bomb' : 'unknown',
					x: (note.time / duration) * width,
					y: height - ((note.accuracy - minAcc) / (maxAcc - minAcc)) * height,
					time: note.time,
					spawnTime: note.spawnTime,
				});
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
		container.appendChild(markersCanvas);
		timeline.appendChild(container);

		target.minAcc = minAcc;
		target.maxAcc = maxAcc;

		let hoveredMarkers = [];
		let isHovering = false;

		const drawMarkers = () => {
			markersContext.clearRect(0, 0, width, height);
			markers.forEach(marker => {
				if (this.settings.settings[marker.type + 'Markers']) {
					const img = markerImages[marker.type];
					if (img) {
						const size = hoveredMarkers.includes(marker) ? 15 : 10;
						const y = isHovering ? marker.y : height - size / 2;
						if (hoveredMarkers.includes(marker)) {
							markersContext.shadowColor = 'black';
							markersContext.shadowBlur = 0;
							markersContext.shadowOffsetX = 2;
							markersContext.shadowOffsetY = 0;
							markersContext.drawImage(img, marker.x - size / 2, y - size / 2, size, size);
							markersContext.shadowOffsetX = -2;
							markersContext.drawImage(img, marker.x - size / 2, y - size / 2, size, size);
							markersContext.shadowOffsetX = 0;
							markersContext.shadowOffsetY = 2;
							markersContext.drawImage(img, marker.x - size / 2, y - size / 2, size, size);
							markersContext.shadowOffsetY = -2;
							markersContext.drawImage(img, marker.x - size / 2, y - size / 2, size, size);
						} else {
							markersContext.shadowColor = 'transparent';
							markersContext.shadowBlur = 0;
							markersContext.shadowOffsetX = 0;
							markersContext.shadowOffsetY = 0;
							markersContext.drawImage(img, marker.x - size / 2, y - size / 2, size, size);
						}
					}
				}
			});
		};

		const animateMarkers = () => {
			if (isHovering) {
				let animationComplete = true;
				markers.forEach(marker => {
					if (Math.abs(marker.currentY - marker.y) > 0.01) {
						marker.currentY += (marker.y - marker.currentY) * 0.01;
						animationComplete = false;
					} else {
						marker.currentY = marker.y;
					}
				});
				drawMarkers();
				if (!animationComplete) {
					requestAnimationFrame(animateMarkers);
				}
			}
		};

		const getTooltipContent = markers => {
			return markers
				.map(marker => {
					switch (marker.type) {
						case 'pause':
							return `Pause at ${formatSeconds(marker.time)} for ${formatSeconds(parseInt(marker.duration))}`;
						case 'fail':
							return `Failed at ${formatSeconds(marker.time)}`;
						case 'start':
							return `Started at ${formatSeconds(marker.time)}`;
						case 'maxStreak':
							return `${marker.maxStreak} streak of 115s at ${formatSeconds(marker.time)}`;
						case 'miss':
							return `Miss at ${formatSeconds(marker.time)}`;
						case 'badCut':
							return `Bad cut at ${formatSeconds(marker.time)}`;
						case 'wall':
							return `Wall hit at ${formatSeconds(marker.time)}`;
						case 'bomb':
							return `Bomb hit at ${formatSeconds(marker.time)}`;
						default:
							return `Event at ${formatSeconds(marker.time)}`;
					}
				})
				.join('\n');
		};

		const handleHover = e => {
			const rect = markersCanvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;

			hoveredMarkers = markers.filter(marker => Math.abs(marker.x - x) < 7.5 && Math.abs(marker.currentY - y) < 7.5);

			drawMarkers();
			if (hoveredMarkers.length > 0 && hoveredMarkers.every(marker => this.settings.settings[marker.type + 'Markers'])) {
				markersCanvas.title = getTooltipContent(hoveredMarkers);
			} else {
				markersCanvas.removeAttribute('title');
			}
		};

		const handleMouseEnter = () => {
			isHovering = true;
			markers.forEach(marker => {
				marker.currentY = height - 5;
			});
			animateMarkers();
		};

		const handleMouseLeave = () => {
			isHovering = false;
			hoveredMarkers = [];
			markersCanvas.removeAttribute('title');
			drawMarkers();
		};

		const handleClick = e => {
			const rect = markersCanvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;

			const clickedMarker = markers.find(marker => Math.abs(marker.x - x) < 7.5 && Math.abs(marker.currentY - y) < 7.5);

			if (clickedMarker) {
				this.seek(clickedMarker.spawnTime ? clickedMarker.spawnTime - 0.3 : clickedMarker.time - 0.3);
			}
		};

		markersCanvas.addEventListener('mousemove', handleHover);
		timeline.addEventListener('mouseenter', handleMouseEnter);
		timeline.addEventListener('mouseleave', handleMouseLeave);
		markersCanvas.addEventListener('click', handleClick);

		const updateMarkers = () => {
			drawMarkers();
		};

		setTimeout(() => {
			updateMarkers();
		}, 200);

		this.el.sceneEl.addEventListener('settingsChanged', e => {
			updateMarkers();
		});
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

		if (this.song.speed > 0 && 'mediaSession' in navigator) {
			navigator.mediaSession.setPositionState({
				duration: this.song.source.buffer.duration,
				playbackRate: this.song.speed,
				position: Math.min(this.song.getCurrentTime(), this.song.source.buffer.duration),
			});
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
