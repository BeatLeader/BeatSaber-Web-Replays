/* global localStorage */
var utils = require('../utils');

const DAMAGE_DECAY = 0.25;
const DAMAGE_MAX = 10;

const DEBUG_CHALLENGE = {
  author: 'Superman',
  difficulty: 'Expert',
  id: '31',
  image: 'assets/img/molerat.jpg',
  songName: 'Friday',
  songSubName: 'Rebecca Black'
};

const emptyChallenge = {
  audio: '',
  author: '',
  difficulty: '',
  id: '',
  image: 'assets/img/logo.png',
  songName: '',
  songNameMedium: '',
  songNameShort: '',
  songSubName: '',
  songSubNameShort: ''
};

const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 &&
                 navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

let beatmaps;
let difficulties;

/**
 * State handler.
 *
 * 1. `handlers` is an object of events that when emitted to the scene will run the handler.
 *
 * 2. The handler function modifies the state.
 *
 * 3. Entities and components that are `bind`ed automatically update:
 *    `bind__<componentName>="<propertyName>: some.item.in.state"`
 */
AFRAME.registerState({
  initialState: {
    activeHand: localStorage.getItem('hand') || 'right',
    challenge: Object.assign({  // Actively playing challenge.
      hasLoadError: isSafari,
      isLoading: false,
      isBeatsPreloaded: false,  // Whether we have passed the negative time.
      loadErrorText: isSafari ? 'iOS and Safari support coming soon! We need to convert songs to MP3 first.' : '',
    }, emptyChallenge),
    score: {
      accuracy: 0,  // Out of 100.
      beatsHit: 0,
      beatsMissed: 0,
      beatsText: '',
      combo: 0,
      maxCombo: 0,
      multiplier: 1,
      rank: '',  // Grade (S to F).
      score: 0
    },
    player: {
      name: '',
      avatar: ''
    },
    controllerType: '',
    damage: 0,
    hasReceivedUserGesture: false,
    inVR: false,
    isPaused: false,  // Playing, but paused.
    isPlaying: false,  // Actively playing.
    isFinished: false,
    isSafari: isSafari,
    isSongBufferProcessing: false,
  },

  handlers: {
    beatloaderpreloadfinish: state => {
      state.challenge.isBeatsPreloaded = true;
    },

    challengeimage: (state, payload) => {
      state.challenge.image = payload;
    },

    challengeloadstart: (state, payload) => {
      state.challenge.isLoading = true;
    },

    challengeloadend: (state, payload) => {
      beatmaps = payload.beatmaps;
      difficulties = payload.difficulties;

      state.challenge.audio = payload.audio;
      state.challenge.author = payload.info._levelAuthorName;

      const mode = state.challenge.mode = payload.beatmaps.Standard
        ? 'Standard'
        : Object.keys(payload.beatmaps)[0];
      state.challenge.difficulties = difficulties[mode];

      if (!state.challenge.difficulty || !payload.beatmaps[mode][state.challenge.difficulty]) {
        state.challenge.difficulty = payload.difficulty;
      }

      state.challenge.id = payload.isDragDrop ? '' : payload.id;
      if (payload.image) {
        state.challenge.image = payload.image;
      }
      
      state.challenge.songName = payload.info._songName;
      state.challenge.songNameShort = truncate(payload.info._songName, 18);
      state.challenge.songNameMedium = truncate(payload.info._songName, 30);

      state.challenge.songSubName = payload.info._songSubName || payload.info._songAuthorName;
      state.challenge.songSubNameShort = truncate(state.challenge.songSubName, 21);

      document.title = `ScoreSaber Replays | ${state.player.name} | ${payload.info._songName}`;
    },

    replayloaded: (state, payload) => {
      state.challenge.isLoading = false;
    },

    userloaded: (state, payload) => {
      state.player = payload;

      document.title = `ScoreSaber Replays | ${state.player.name} | ${state.challenge.songName}`;
    },

    challengeloaderror: (state, payload) => {
      state.challenge.hasLoadError = true;
      state.challenge.isLoading = false;
      state.challenge.loadErrorText = `Sorry, song ${AFRAME.utils.getUrlParameter('id')} was not found or ZIP requires CORS headers.`;
    },

    controllerconnected: (state, payload) => {
      state.controllerType = payload.name;
    },

    beathit: (state, payload) => {
      if (state.damage > DAMAGE_DECAY) {
        state.damage -= DAMAGE_DECAY;
      }
      state.score.beatsHit++;
      state.score.combo++;
      if (state.score.combo > state.score.maxCombo) {
        state.score.maxCombo = state.score.combo;
      }

      payload.score = isNaN(payload.score) ? 100 : payload.score;
      state.score.score += Math.floor(payload.score * state.score.multiplier);

      // Might be a math formula for this, but the multiplier system is easy reduced.
      if (state.score.combo < 2) {
        state.score.multiplier = 1;
      } else if (state.score.combo < 6) {
        state.score.multiplier = 2;
      } else if (state.score.combo < 14) {
        state.score.multiplier = 4;
      } else {
        state.score.multiplier = 8;
      }

      updateScoreAccuracy(state);
    },

    beatmiss: state => {
      state.score.beatsMissed++;
      takeDamage(state);
      updateScoreAccuracy(state);
    },

    beatwrong: state => {
      state.score.beatsMissed++;
      takeDamage(state);
      updateScoreAccuracy(state);
    },

    minehit: state => {
      takeDamage(state);
    },

    victory: function (state) {
      state.isVictory = true;

      // Percentage is score divided by total possible score.
      const accuracy = (state.score.score / (state.challenge.numBeats * 110)) * 100;
      state.score.accuracy = isNaN(accuracy) ? 0 : accuracy;
      state.score.score = isNaN(state.score.score) ? 0 : state.score.score;

      if (accuracy >= 95) {
        state.score.rank = 'S';
      } else if (accuracy >= 93) {
        state.score.rank = 'A';
      } else if (accuracy >= 90) {
        state.score.rank = 'A-';
      } else if (accuracy >= 88) {
        state.score.rank = 'B+';
      } else if (accuracy >= 83) {
        state.score.rank = 'B';
      } else if (accuracy >= 80) {
        state.score.rank = 'B-';
      } else if (accuracy >= 78) {
        state.score.rank = 'C+';
      } else if (accuracy >= 73) {
        state.score.rank = 'C';
      } else if (accuracy >= 70) {
        state.score.rank = 'C-';
      } else if (accuracy >= 60) {
        state.score.rank = 'D';
      } else {
        state.score.rank = 'F';
      }

      computeBeatsText(state);
    },

    victoryfake: function (state) {
      state.score.accuracy = '74.99';
      state.score.rank = 'C';
    },

    wallhitstart: function (state) {
      takeDamage(state);
    },

    /**
     * ?debugstate=loading
     */
    debugloading: state => {
      DEBUG_CHALLENGE.id = '-1';
      Object.assign(state.challenge, DEBUG_CHALLENGE);
      state.challenge.isLoading = true;
    },

    difficultyselect: (state, payload) => {
      state.challenge.difficulty = payload;
      state.challenge.isBeatsPreloaded = false;
      state.isPaused = false;
      state.isFinished = false;
    },

    gamemenuresume: state => {
      state.isPaused = false;
    },

    gamemenurestart: state => {
      state.challenge.isBeatsPreloaded = false;
      state.isPaused = false;
      state.isFinished = false;
      state.isSongBufferProcessing = true;
    },

    modeselect: (state, payload) => {
      state.challenge.mode = payload;
      state.challenge.isBeatsPreloaded = false;
      state.isPaused = false;
      state.isFinished = false;

      state.challenge.difficulties = difficulties[payload];
      state.challenge.difficulty = state.challenge.difficulties[0]._difficulty;
    },

    pausegame: state => {
      if (!state.isPlaying) { return; }
      state.isPaused = true;
    },

    finishgame: state => {
      if (!state.isPlaying) { return; }
      state.isPaused = true;
      state.isFinished = true;
    },

    songprocessingfinish: state => {
      state.isSongBufferProcessing = false;
    },

    songprocessingstart: state => {
      state.isSongBufferProcessing = true;
    },

    /**
     * From search.
     */
    songselect: (state, payload) => {
      state.challenge = Object.assign(state.challenge, emptyChallenge);
      state.challenge.id = payload.id;
      state.challenge.author = payload.metadata.levelAuthorName;
      state.challenge.image = utils.beatsaverCdnCors(payload.versions[0].coverURL);
      state.challenge.songName = payload.metadata.songName;
      state.challenge.songNameShort = truncate(payload.metadata.songName, 18);
      state.challenge.songNameMedium = truncate(payload.metadata.songName, 30);
      state.challenge.songSubName = payload.metadata.songSubName;
      state.challenge.songSubNameShort = truncate(payload.metadata.songSubName, 21);
      state.challenge.isBeatsPreloaded = false;
      state.challenge.isLoading = true;

      state.hasReceivedUserGesture = false;
      state.isPaused = false;
      state.isFinished = false;
      state.isSongBufferProcessing = false;
    },

    usergesturereceive: state => {
      state.hasReceivedUserGesture = true;
    },

    'enter-vr': state => {
      state.inVR = true;
    },

    'exit-vr': state => {
      state.inVR = false;
    }
  },

  /**
   * Post-process the state after each action.
   */
  computeState: state => {
    state.isPlaying =
      !state.isPaused && !state.isSongBufferProcessing &&
      !state.challenge.isLoading && state.hasReceivedUserGesture;
  }
});

function truncate (str, length) {
  if (!str) { return ''; }
  if (str.length >= length) {
    return str.substring(0, length - 2) + '..';
  }
  return str;
}

function takeDamage (state) {
  if (!state.isPlaying) { return; }
  state.score.combo = 0;
  state.score.multiplier = state.score.multiplier > 1
    ? Math.ceil(state.score.multiplier / 2)
    : 1;
  if (AFRAME.utils.getUrlParameter('godmode')) { return; }
  state.damage++;
  // checkGameOver(state);
}

function updateScoreAccuracy (state) {
  // Update live accuracy.
  const currentNumBeats = state.score.beatsHit + state.score.beatsMissed;
  state.score.accuracy = ((state.score.score / (currentNumBeats * 115)) * 100).toFixed(2);
}

