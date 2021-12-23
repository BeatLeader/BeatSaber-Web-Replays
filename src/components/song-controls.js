const ONCE = {once: true};

let queryParamTime = AFRAME.utils.getUrlParameter('time').trim();
if (!queryParamTime || isNaN(queryParamTime)) {
  queryParamTime = undefined;
} else {
  queryParamTime = parseFloat(queryParamTime) / 1000;
}

/**
 * Update the 2D UI. Handle pause and seek.
 */
AFRAME.registerComponent('song-controls', {
  dependencies: ['song'],

  schema: {
    difficulty: {default: ''},
    mode: {default: 'Standard'},
    songName: {default: ''},
    songSubName: {default: ''},
    songImage: {default: ''},
    isPlaying: {default: false}
  },

  init: function () {
    this.customDifficultyLabels = {};
    this.song = this.el.components.song;
    this.settings = this.el.components.settings;
    this.tick = AFRAME.utils.throttleTick(this.tick.bind(this), 100);

    // Seek to ?time if specified.
    if (queryParamTime !== undefined) {
      this.el.sceneEl.addEventListener('songstartaudio', () => {
        setTimeout(() => {
          if (queryParamTime >= 0 && queryParamTime <= this.song.source.buffer.duration) {
            this.seek(queryParamTime);
          }
          
        }, 100);
      }, ONCE);
    }

    const analyser = document.getElementById('audioAnalyser');
    analyser.addEventListener('audioanalyserbuffersource', evt => {
      document.getElementById('songDuration').innerHTML =
        formatSeconds(evt.detail.buffer.duration);
        if (this.notes) {
          this.showMisses(this.notes, this.bombs, evt.detail.buffer, this);
          this.notes = null;
        }
    });

    this.el.sceneEl.addEventListener('replayloaded', (event) => {
      if (this.song.source && this.song.source.buffer) {
        this.showMisses(event.detail.notes, event.detail.bombs, this.song.source.buffer, this);
      }
      else {
        this.notes = event.detail.notes;
        this.bombs = event.detail.bombs;
      }
    });

    this.songProgress = document.getElementById('songProgress');
    this.songSpeedPercent = document.getElementById('songSpeedPercent');
  },

  update: function (oldData) {
    const data = this.data;

    if (!this.controls) { return; }

    if (data.isPlaying) {
      document.body.classList.add('isPlaying');
    } else {
      document.body.classList.remove('isPlaying');
    }

    document.getElementById('songImage').src = data.songImage;
    document.getElementById('songName').innerHTML = truncate(data.songName, 14);
    document.getElementById('songName').setAttribute('title', data.songName);
    document.getElementById('songSubName').innerHTML = truncate(data.songSubName, 15);
    document.getElementById('songSubName').setAttribute('title', data.songSubName);

    document.getElementById('controlsDifficulty').innerHTML =
      this.customDifficultyLabels[data.difficulty] || data.difficulty;
    // document.getElementById('controlsMode').innerHTML = data.mode;

    if ((oldData.difficulty && oldData.difficulty !== data.difficulty) ||
        (oldData.mode && oldData.mode !== data.mode)) {
      removeTimeQueryParam();
    }

    if (oldData.mode && oldData.mode !== data.mode) {
      this.updateDifficultyOptions();
    }
  },

  play: function () {
    const controls = this.controls = document.getElementById('controls');
    this.difficulty = document.getElementById('controlsDifficulty');
    this.difficultyOptions = document.getElementById('controlsDifficultyOptions');
    this.modeDropdownEl = document.getElementById('controlsMode');
    this.modeOptionEls = document.getElementById('controlsModes');
    this.playhead = document.getElementById('playhead');
    const timeline = this.timeline = document.getElementById('timeline');
    const timelineHover = this.timelineHover = document.getElementById('timelineHover');

    const timelineWidth = timeline.offsetWidth;

    this.el.sceneEl.addEventListener('challengeloadend', evt => {
      this.beatmaps = evt.detail.beatmaps;
      this.difficulties = evt.detail.difficulties;
      this.info = evt.detail.info;

      this.customDifficultyLabels = {};

      // Show controls on load.
      controls.classList.add('challengeLoaded');

      this.updateDifficultyOptions();
      this.updateModeOptions();
    });

    var timelineClicked = false, timelineHovered = false;

    let doSeek = (event, fromTime) => {
      var time;
      if (!fromTime) {
        const marginLeft = (event.clientX - timeline.getBoundingClientRect().left);
        const percent = marginLeft / timeline.getBoundingClientRect().width;
        time = percent * this.song.source.buffer.duration;
      } else {
        time = fromTime;
      }

      // Get new audio buffer source (needed every time audio is stopped).
      // Start audio at seek time.
      
      this.seek(time >= 0 ? time : 0);
    }

    // Seek.
    let handleClick = event => {
      if (!this.song.source) { return; }

      doSeek(event);
      timelineClicked = true;
    };

    handleMove = event => {
      if (!this.song.source || !timelineClicked) { return; }

      doSeek(event);
    };

    handleUp = event => {
      timelineClicked = false;
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
      if (!this.song.source) { return; }
      timelineHover.classList.add('timelineHoverActive');
      timelineHovered = true;
    });
    timeline.addEventListener('mousemove', evt => {
      const marginLeft = (evt.clientX - timeline.getBoundingClientRect().left);
      const percent = marginLeft / timeline.getBoundingClientRect().width;
      timelineHover.style.left = marginLeft - 17 + 'px';
      timelineHover.innerHTML = formatSeconds(percent * this.song.source.buffer.duration);
    });
    timeline.addEventListener('mouseleave', evt => {
      timelineHover.classList.remove('timelineHoverActive');
      timelineClicked = false;
      timelineHovered = false;
    });
    let captureThis = this;
    timeline.addEventListener("wheel", function(e){
      let currentTime = captureThis.song.getCurrentTime();
      doSeek(null, currentTime - e.deltaY / 356);
      e.preventDefault();
      e.stopPropagation();
    })

    // Pause.
    let pauseButton = document.getElementById('controlsPause');
    pauseButton.addEventListener('click', (e) => {
      e.preventDefault();
      if (pauseButton.classList.contains('play')) {
        this.el.sceneEl.emit('usergesturereceive', null, false);
        this.el.sceneEl.emit('gamemenuresume', null, false);
      } else {
        this.el.sceneEl.emit('pausegame', null, false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        if (this.song.isPlaying) {
          this.el.sceneEl.emit('pausegame', null, false);
        } else {
          this.el.sceneEl.emit('gamemenuresume', null, false);
        }
      }
    });

    this.el.sceneEl.addEventListener('pausegame', (e) => {
      if (pauseButton.classList.contains('pause')) {
        pauseButton.classList.remove('pause');
        pauseButton.classList.add('play');
      }
    });

    let showPause = () => {
      if (pauseButton.classList.contains('play')) {
        pauseButton.classList.remove('play');
        pauseButton.classList.add('pause');
      }
    };

    this.el.sceneEl.addEventListener('gamemenuresume', (e) => { showPause() });
    this.el.sceneEl.addEventListener('usergesturereceive', (e) => {
      if (!this.song.data.isPaused) {
        showPause() 
      }
    });

    this.el.sceneEl.addEventListener('finishgame', (e) => {
      pauseButton.style.display = "none";
    });

    this.el.sceneEl.addEventListener('gamemenurestart', (e) => {
      pauseButton.style.display = "inline-block";
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
    this.difficultyOptions.addEventListener('click', evt => {
      this.songProgress.innerHTML = formatSeconds(0);
      this.playhead.style.width = '0%';
      this.el.sceneEl.emit('difficultyselect', evt.target.dataset.difficulty, false);
      this.difficulty.innerHTML = evt.target.innerHTML;
      controls.classList.remove('difficultyOptionsActive');
    });

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
      var ctxMenu = document.getElementById("ctxMenu");
      ctxMenu.style.display = "none";

      if (!evt.target.closest('#volumeSliderContainer') &&
          !evt.target.closest('#controlsVolume')) {
        const slider = document.getElementById('volumeSliderContainer');
        const active = slider.classList.contains('volumeActive');
        if (active) {
          slider.classList.remove('volumeActive');
        }
      }

      if (!evt.target.closest('#settingsContainer') &&
          !evt.target.closest('#controlsSettings')) {
            const container = document.getElementById('settingsContainer');
        const active = container.classList.contains('settingsActive');
        if (active) {
          container.classList.remove('settingsActive');
        }
      }
    });

    document.addEventListener("contextmenu",function(event){
      event.preventDefault();
      var ctxMenu = document.getElementById("ctxMenu");
      ctxMenu.style.display = "block";
      ctxMenu.style.left = (event.pageX - 10)+"px";
      ctxMenu.style.top = (event.pageY - 10)+"px";
    },false);

    const copyURL = (target, time) => {
      let input = document.createElement('input');
      target.appendChild(input);
      let base = location.protocol + "//" + location.host + "/" + `?id=${AFRAME.utils.getUrlParameter('id')}&playerID=${AFRAME.utils.getUrlParameter('playerID')}&difficulty=${AFRAME.utils.getUrlParameter('difficulty')}`
      input.value = base + (time ? `&time=${Math.round(this.song.getCurrentTime()*1000)}&speed=${Math.round(this.song.speed * 100000)}` : "" );
      input.select();
      document.execCommand("copy");
      target.removeChild(input);
    };

    document.getElementById('copyURL').addEventListener('click', evt => {
      copyURL(evt.currentTarget);
    });
    document.getElementById('copyURLtime').addEventListener('click', evt => {
      copyURL(evt.currentTarget, true);
    });
    document.getElementById('showInspector').addEventListener('click', evt => {
      
    });

    // Toggle volume slider.
    document.getElementById('controlsVolume').addEventListener('click', evt => {
      document.getElementById('volumeSliderContainer').classList.toggle('volumeActive');
    });

    document.getElementById('controlsSettings').addEventListener('click', evt => {
      document.getElementById('settingsContainer').classList.toggle('settingsActive');
    });

    // Update volume.
    let volumeSlider = document.getElementById('volumeSlider');
    let volumeHandler = () => {
      this.song.audioAnalyser.gainNode.gain.cancelScheduledValues(0);
      this.song.audioAnalyser.gainNode.gain.value = volumeSlider.value;
      this.settings.settings.volume = volumeSlider.value;
      this.settings.sync();
      document.getElementById('beatContainer').components['beat-hit-sound']
        .setVolume(volumeSlider.value);
    }
    volumeSlider.addEventListener('input', evt => {
      volumeHandler();
    });
    volumeSlider.value = this.settings.settings.volume;

    volumeSlider.addEventListener("wheel", function(e){
      if (e.deltaY < 0){
        volumeSlider.valueAsNumber += 0.05;
      }else{
        volumeSlider.value -= 0.05;
      }
      volumeHandler();
      e.preventDefault();
      e.stopPropagation();
    })

    let speedSlider = document.getElementById('speedSlider');
    let speedHandler = () => {
      this.song.source.playbackRate.value = speedSlider.value;
      this.song.speed = speedSlider.value;
      this.songSpeedPercent.innerHTML = (Math.round(speedSlider.value * 10000) / 100) + "%";
    };
    
    speedSlider.addEventListener('input', evt => {
      speedHandler();
    });

    speedSlider.addEventListener("wheel", function(e){
      if (e.deltaY < 0){
        speedSlider.valueAsNumber += 0.01;
      }else{
        speedSlider.value -= 0.01;
      }
      speedHandler();
      e.preventDefault();
      e.stopPropagation();
    })

    this.songSpeedPercent.innerHTML = (this.song.speed * 100) + "%";
    speedSlider.value = this.song.speed;
  },

  showMisses: (notes, bombs, buffer, target) => {
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
        img.className = "missMark";
        img.style.left = (((note.time) / duration) * width - 6) + 'px';
        if (note.score == -2) {
          img.title = "Miss"
        } else if (note.score == -3) {
          img.title = "Bad cut"
        }
        img.title += " at " + formatSeconds(note.time);
        
        container.appendChild(img);
      }
    }

    if (bombs) {
      for (var i = 0; i < bombs.length; i++) {
        const note = bombs[i];
        const img = document.createElement('img');
        img.src = 'assets/img/explode.png';
        img.className = "missMark";
        img.style.left = (((note.time) / duration) * width - 6) + 'px';
        img.title = "Bomb hit at " + formatSeconds(note.time);
        
        container.appendChild(img);
      }
    }
    

    timeline.appendChild(container);
  },

  tick: function () {
    if (!this.song.isPlaying || !this.song.source) { return; }
    this.updatePlayhead();
    this.songProgress.innerHTML = formatSeconds(this.song.getCurrentTime());
  },

  seek: function (time) {
    this.song.stopAudio();

    // Get new audio buffer source (needed every time audio is stopped).
    this.song.data.analyserEl.addEventListener('audioanalyserbuffersource', evt => {
      // Start audio at seek time.
      const source = this.song.source = evt.detail;

      this.song.startAudio(time);

      // Tell beat generator about seek.
      this.el.components['beat-generator'].seek(time);

      this.updatePlayhead(true);
    }, ONCE);

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
    for (let i = 0; i < this.difficultyOptions.children.length; i++) {
      const option = this.difficultyOptions.children[i];
      option.style.display = 'none';
      option.innerHTML = option.dataset.difficulty;
    }
    this.difficulties[this.data.mode].forEach(difficulty => {
      const option = this.difficultyOptions.querySelector(`[data-difficulty="${difficulty._difficulty}"]`);
      option.style.display = 'inline-block';

      // Custom difficulty labels.
      if (!this.info._difficultyBeatmapSets) { return; }
      this.info._difficultyBeatmapSets.forEach(set => {
        if (set._beatmapCharacteristicName !== 'Standard') { return; }
        set._difficultyBeatmaps.forEach(diff => {
          const customLabel = diff._customData._difficultyLabel;
          if (!customLabel) { return; }

          this.customDifficultyLabels[diff._difficulty] = customLabel;
          if (this.difficulty.innerHTML === diff._difficulty) {
            this.difficulty.innerHTML = customLabel;
          }

          if (diff._difficulty !== difficulty._difficulty) { return; }
          option.innerHTML = customLabel;
        });
      });
    });
  },

  updatePlayhead: function (seek) {
    const progress = Math.max(
      0,
      Math.min(100, 100 * (this.song.getCurrentTime() / this.song.source.buffer.duration)));
    this.playhead.style.width = progress + '%';
    if (seek) {
      this.el.sceneEl.emit('timechanged', { newTime: this.song.getCurrentTime() }, null);
    }
  }
});

function truncate (str, length) {
  if (!str) { return ''; }
  if (str.length >= length) {
    return str.substring(0, length - 2) + '..';
  }
  return str;
}

const timeRe = /time=\d+/
function setTimeQueryParam (time) {
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
  window.history.pushState({path: url},'', url);
}

function formatSeconds (time) {
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

function removeTimeQueryParam () {
  let search = window.location.search.toString();
  search = search.replace(timeRe, '');
  let url = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
  url += search;
  window.history.pushState({path: url},'', url);
}
