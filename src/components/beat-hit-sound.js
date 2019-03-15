var sourceCreatedCallback;

const LAYER_BOTTOM = 'bottom';
const LAYER_MIDDLE = 'middle';
const LAYER_TOP = 'top';
const VOLUME = 0.2;

// Allows for modifying detune. PR has been sent to three.js.
THREE.Audio.prototype.play = function () {
  if (this.isPlaying === true) {
    console.warn('THREE.Audio: Audio is already playing.');
    return;
  }

  if (this.hasPlaybackControl === false) {
    console.warn('THREE.Audio: this Audio has no playback control.');
    return;
  }

  var source = this.context.createBufferSource();
  source.buffer = this.buffer;
  source.detune.value = this.detune;
  source.loop = this.loop;
  source.onended = this.onEnded.bind(this);
  source.playbackRate.setValueAtTime(this.playbackRate, this.startTime);
  this.startTime = this.context.currentTime;
  if (sourceCreatedCallback) { sourceCreatedCallback(source); }
  source.start(this.startTime, this.offset);

  this.isPlaying = true;

  this.source = source;
  return this.connect();
};

/**
 * Beat hit sound using positional audio and audio buffer source.
 */
AFRAME.registerComponent('beat-hit-sound', {
  directionsToSounds: {
    up: '',
    down: '',
    upleft: 'left',
    upright: 'right',
    downleft: 'left',
    downright: 'right',
    left: 'left',
    right: 'right'
  },

  init: function () {
    this.currentBeatEl = null;
    this.currentCutDirection = '';
    this.processSound = this.processSound.bind(this);
    sourceCreatedCallback = this.sourceCreatedCallback.bind(this);

    // Sound pools.
    for (let i = 1; i <= 10; i++) {
      this.el.setAttribute(`sound__beathit${i}`, {
        poolSize: 4,
        src: `#hitSound${i}`,
        volume: VOLUME
      });
      this.el.setAttribute(`sound__beathit${i}left`, {
        poolSize: 4,
        src: `#hitSound${i}left`,
        volume: VOLUME
      });
      this.el.setAttribute(`sound__beathit${i}right`, {
        poolSize: 4,
        src: `#hitSound${i}right`,
        volume: VOLUME
      });
    }
  },

  play: function () {
    // Kick three.js loader...Don't know why sometimes doesn't load.
    for (let i = 1; i <= 10; i++) {
      setTimeout(() => {
        if (!this.el.components[`sound__beathit${i}`].loaded) {
          this.el.setAttribute(`sound__beathit${i}`, 'src', '');
          this.el.setAttribute(`sound__beathit${i}`, 'src', `#hitSound${i}`);
        }
      }, i * 10);
      setTimeout(() => {
        if (!this.el.components[`sound__beathit${i}left`].loaded) {
          this.el.setAttribute(`sound__beathit${i}left`, 'src', '');
          this.el.setAttribute(`sound__beathit${i}left`, 'src', `#hitSound${i}left`);
        }
      }, i * 20);
      setTimeout(() => {
        if (!this.el.components[`sound__beathit${i}right`].loaded) {
          this.el.setAttribute(`sound__beathit${i}right`, 'src', '');
          this.el.setAttribute(`sound__beathit${i}right`, 'src', `#hitSound${i}right`);
        }
      }, i * 30);
    }
  },

  playSound: function (beatEl, cutDirection) {
    const rand = 1 + Math.floor(Math.random() * 10);
    const dir = this.directionsToSounds[cutDirection || 'up'];
    const soundPool = this.el.components[`sound__beathit${rand}${dir}`];
    this.currentBeatEl = beatEl;
    soundPool.playSound(this.processSound);
  },

  /**
   * Set audio stuff before playing.
   */
  processSound: function (audio) {
    audio.detune = 0;
    this.currentBeatEl.object3D.getWorldPosition(audio.position);
  },

  /**
   * Function callback to process source buffer once created.
   * Set detune for pitch and inflections.
   */
  sourceCreatedCallback: function (source) {
    // Pitch based on layer.
    const layer = this.getLayer(this.currentBeatEl.object3D.position.y);
    if (layer === LAYER_BOTTOM) {
      source.detune.setValueAtTime(-400, 0);
    } else if (layer === LAYER_TOP) {
      source.detune.setValueAtTime(200, 0);
    }

    // Inflection on strike down or up.
    if (this.currentCutDirection === 'down') {
      source.detune.linearRampToValueAtTime(-400, 1);
    }
    if (this.currentCutDirection === 'up') {
      source.detune.linearRampToValueAtTime(400, 1);
    }
	},

  /**
   * Get whether beat is on bottom, middle, or top layer.
   */
  getLayer: function (y) {
    if (y === 1) { return LAYER_BOTTOM; }
    if (y === 1.70) { return LAYER_TOP; }
    return LAYER_MIDDLE;
  },

  setVolume: function (volume) {
    volume = volume * 0.4;
    for (let i = 1; i <= 10; i++) {
      for (let j = 0; j < 4; j++) {
        this.el.components[`sound__beathit${i}`].pool.children[j].setVolume(volume);
        this.el.components[`sound__beathit${i}left`].pool.children[j].setVolume(volume);
        this.el.components[`sound__beathit${i}right`].pool.children[j].setVolume(volume);
      }
    }
  }
});
