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
	songSubName: 'Rebecca Black',
};

const emptyChallenge = {
	audio: '',
	author: '',
	difficulty: '',
	id: '',
	image: '',
	songName: '',
	songNameMedium: '',
	songNameShort: '',
	songSubName: '',
	songSubNameShort: '',
};

const emptyScore = {
	accuracy: 0,
	beatsHit: 0,
	beatsMissed: 0,
	beatsText: '',
	combo: 0,
	maxCombo: 0,
	multiplier: 1,
	energy: 0.5,
	rank: '',
	score: 0,
	scoreDescription: '',
	misses: 0,
};

const isSafari = navigator.userAgent.toLowerCase().indexOf('safari') !== -1 && navigator.userAgent.toLowerCase().indexOf('chrome') === -1;

if (isSafari) {
	var module = require('../lib/oggdec');
	const decodeOggData = module().decodeOggData;
	const decodeAudioData = (data, completion) => {
		decodeOggData(data).then(completion);
	};
	(window.AudioContext || window.webkitAudioContext).prototype.decodeOggData = decodeAudioData;
}

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
		challenge: Object.assign(
			{
				// Actively playing challenge.
				hasLoadError: false,
				isLoading: false,
				isBeatsPreloaded: false, // Whether we have passed the negative time.
				loadErrorText: '',
			},
			emptyChallenge
		),
		score: emptyScore,
		notes: null,
		replay: {
			isLoading: false,
			hasError: false,
			errorText: '',
		},
		controllerType: '',
		damage: 0,
		hasReceivedUserGesture: false,
		inVR: false,
		pov: false,
		isPaused: false, // Playing, but paused.
		isPlaying: false, // Actively playing.
		isFinished: false,
		isSafari: isSafari,
		isSongBufferProcessing: false,
		useractive: false,
		showControls: true,
		wrongMisses: 0,
		spawnRotation: 0,
		saberScale: new THREE.Vector3(1, 1, 1),
		saberGlowScale: new THREE.Vector3(1, 1.1, 1),
		settings: {showHeadset: false, volume: 0.0},
		replaysCount: (() => {
			if (AFRAME.utils.getUrlParameter('players').length > 0) {
				return AFRAME.utils.getUrlParameter('players').split(',').length;
			} else if (AFRAME.utils.getUrlParameter('links').length > 0) {
				return AFRAME.utils.getUrlParameter('links').split(',').length;
			} else {
				return 1;
			}
		})(),
		localReplay: !AFRAME.utils.getUrlParameter('id') && !AFRAME.utils.getUrlParameter('hash'),
	},

	handlers: {
		beatloaderpreloadfinish: state => {
			state.challenge.isBeatsPreloaded = true;
		},

		songFetched: (state, payload) => {
			state.challenge.image = payload.image;
			state.challenge.author = payload.metadata.levelAuthorName;

			state.challenge.songName = payload.metadata.songName;
			state.challenge.songNameShort = truncate(payload.metadata.songName, 18);
			state.challenge.songNameMedium = truncate(payload.metadata.songName, 30);

			state.challenge.songSubName = payload.metadata.songSubName || payload.metadata.songAuthorName;
			state.challenge.songSubNameShort = truncate(state.challenge.songSubName, 21);

			if (payload.leaderboardId) {
				state.challenge.leaderboardId = payload.leaderboardId;
			} else {
				state.challenge.id = payload.id;
			}

			document.title = `Battle royale | ${payload.metadata.songName}`;
			document.querySelector('meta[property="og:title"]').setAttribute('content', `Battle royale | ${payload.metadata.songName}`);
		},

		challengeloadstart: (state, payload) => {
			state.challenge.isLoading = true;
		},

		challengeloadend: (state, payload) => {
			beatmaps = payload.beatmaps;
			difficulties = payload.difficulties;

			state.challenge.audio = payload.audio;

			const mode = payload.mode;
			state.challenge.mode = mode;
			state.challenge.difficulties = difficulties[mode];

			if (!state.challenge.difficulty || !payload.beatmaps[mode][state.challenge.difficulty]) {
				state.challenge.difficulty = payload.difficulty;
			}

			state.challenge.id = payload.isDragDrop ? '' : payload.id;

			state.challenge.songName = payload.info._songName;
			state.challenge.songNameShort = truncate(payload.info._songName, 18);
			state.challenge.songNameMedium = truncate(payload.info._songName, 30);

			state.challenge.songSubName = payload.info._songSubName || payload.info._songAuthorName;
			state.challenge.songSubNameShort = truncate(state.challenge.songSubName, 21);

			document.title = `Battle royale | ${payload.info._songName}`;
			state.challenge.isLoading = false;
		},

		replayloadstart: (state, payload) => {
			state.localReplay = false;
			state.replay.isLoading = true;
			state.replay.hasError = false;
			state.replay.errorText = null;
		},

		replayloaded: (state, payload) => {
			state.replay.isLoading = !payload.allProcessed;
			state.notes = payload.notes;
		},

		replayloadfailed: (state, payload) => {
			state.replay.isLoading = false;
			state.replay.hasError = true;
			state.replay.errorText = payload.error;
			state.localReplay = !AFRAME.utils.getUrlParameter('id') && !AFRAME.utils.getUrlParameter('hash');
		},

		userloaded: (state, payload) => {
			document.title = `Battle royale | ${state.challenge.songName}`;
			document.querySelector('meta[property="og:title"]').setAttribute('content', `Battle royale | ${state.challenge.songName}`);
		},

		challengeloaderror: (state, payload) => {
			state.challenge.hasLoadError = true;
			state.challenge.isLoading = false;
			state.challenge.loadErrorText = `Sorry, song ${payload.hash} was not found.`;
		},

		controllerconnected: (state, payload) => {
			state.controllerType = payload.name;
		},

		scoreChanged: (state, payload) => {
			updateScore(state, {index: payload.index});
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
			state.score = emptyScore;
			state.lastNoteTime = 0;
		},

		timechanged: (state, payload) => {
			state.isFinished = false;
			let notes = state.notes;
			for (var i = notes.length; --i > 0; ) {
				if (notes[i].time < payload.newTime) {
					updateScore(state, {index: i});
					return;
				}
			}

			state.score = {
				accuracy: 0,
				combo: 0,
				maxCombo: 0,
				multiplier: 1,
				score: 0,
			};
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
			if (!state.isPlaying) {
				return;
			}
			state.isPaused = true;
		},

		finishgame: state => {
			if (!state.isPlaying) {
				return;
			}
			state.isPaused = true;
			state.isFinished = true;
		},

		songprocessingfinish: state => {
			state.isSongBufferProcessing = false;
		},

		songprocessingstart: state => {
			state.isSongBufferProcessing = true;
		},

		usergesturereceive: state => {
			state.hasReceivedUserGesture = true;
		},

		settingsChanged: (state, payload) => {
			state.settings = payload.settings;

			const saberScale = payload.settings.saberWidth / 100;

			state.saberScale = new THREE.Vector3(saberScale, 1, saberScale);
			state.saberGlowScale = new THREE.Vector3(saberScale, 1.1, saberScale);
		},

		povchanged: (state, payload) => {
			state.pov = payload.newPov;
		},

		useractive: (state, payload) => {
			state.useractive = payload.isActive;
		},

		wrongMiss: (state, payload) => {
			state.wrongMisses++;
			console.log('Wrong miss #' + state.wrongMisses);
		},

		'enter-vr': state => {
			state.inVR = true;
		},

		'exit-vr': state => {
			state.inVR = false;
		},
	},

	/**
	 * Post-process the state after each action.
	 */
	computeState: state => {
		state.isPlaying =
			!state.isPaused &&
			!state.isSongBufferProcessing &&
			!state.challenge.isLoading &&
			!state.replay.isLoading &&
			!state.challenge.hasLoadError &&
			!state.replay.hasError &&
			state.hasReceivedUserGesture &&
			!state.localReplay;

		state.showControls = state.useractive || !state.isPlaying;
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

function updateScore(state, payload) {
	let note = state.notes[payload.index];

	state.score.score = note.totalScore;
	state.score.scoreDescription = (note.totalScore + '').replace(/(\d)(?=(\d{3})+$)/g, '$1 ');
	state.score.combo = note.combo;
	state.score.multiplier = note.multiplier;
	state.score.accuracy = note.accuracy;
	state.score.misses = note.misses;
	state.score.energy = note.energy;
	state.lastNoteTime = note.time;

	// console.log(note.totalScore + " - " + note.index + " - " + note.i + " - " + note.time + " - " + payload.index + " - " + note.score);
}
