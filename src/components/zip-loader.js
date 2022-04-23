const utils = require('../utils');
import ZipLoader from 'zip-loader';
import {Mirror_Inverse, Mirror_Horizontal, Mirror_Vertical} from '../chirality-support';

const zipUrl = AFRAME.utils.getUrlParameter('zip');

AFRAME.registerComponent('zip-loader', {
  schema: {
    id: {default: AFRAME.utils.getUrlParameter('id')},
    hash: {default: AFRAME.utils.getUrlParameter('hash')},
    difficulty: {default: (AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus')},
    mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'}
  },

  init: function () {
    this.fetchedZip = ''
    this.hash = '';
    this.id = '';

    if (zipUrl) {
      this.fetchZip(zipUrl);
    }

    if (!this.data.id && !this.data.hash) {
      this.el.sceneEl.addEventListener('replayfetched', (e) => {
        this.data.difficulty = this.difficultyFromId(e.detail.difficulty);
        this.data.mode = e.detail.mode;
        this.fetchData(e.detail.hash.replace("custom_level_", ""), true);
      });
    }
  },

  update: function (oldData) {
    this.el.sceneEl.emit('cleargame', null, false);

    if (this.data.id && !this.data.hash) { 
      if ((oldData.id !== this.data.id)) {
        this.fetchData(this.data.id);
      }
     } else if (this.data.hash && !this.data.id) {
      if ((oldData.hash !== this.data.hash)) {
        this.fetchData(this.data.hash, true);
      }
     }
  },

  play: function () {
    this.loadingIndicator = document.getElementById('challengeLoadingIndicator');
  },

  processFiles: function (loader, isDragDrop) {
    let imageBlob;
    let songBlob;
    const event = {
      audio: '',
      beatmaps: {Standard: {}},
      beatSpeeds: {Standard: {}},
      beatOffsets: {Standard: {}},
      difficulties: {Standard: []},
      id: isDragDrop ? '' : this.data.id,
      image: '',
      info: '',
      isDragDrop: isDragDrop,
      mappingExtensions: {isEnabled: false}
    };

    // Process info first.
    Object.keys(loader.files).forEach(filename => {
      if (filename.toLowerCase().endsWith('info.dat')) {
        event.info = jsonParseClean(loader.extractAsText(filename));
      }
    });

    // See whether we need mapping extensions (per difficulty).
    const customData = event.info._customData;
    if (customData &&
        customData._editorSettings &&
        customData._editorSettings.modSettings &&
        customData._editorSettings.modSettings.mappingExtensions &&
        customData._editorSettings.modSettings.mappingExtensions.isEnabled) {
      event.mappingExtensions = event.info._customData._editorSettings.modSettings.mappingExtensions;
    }

    // Index beatmaps (modes + difficulties).
    const beatmapSets = event.info._difficultyBeatmapSets;
    beatmapSets.forEach(set => {
      const mode = set._beatmapCharacteristicName;
      event.beatmaps[mode] = {};
      event.beatSpeeds[mode] = {};
      event.beatOffsets[mode] = {};

      const diffBeatmaps = set._difficultyBeatmaps.sort(d => d._difficultyRank);
      diffBeatmaps.forEach(diff => {
        event.beatmaps[mode][diff._difficulty] = loader.extractAsJSON(diff._beatmapFilename);
        event.beatSpeeds[mode][diff._difficulty] = diff._noteJumpMovementSpeed;
        event.beatOffsets[mode][diff._difficulty] = diff._noteJumpStartBeatOffset;

        // TODO: Assume for now if one difficulty wants extensions, they all do. Fix later.
        // if (diff._customData &&
        //     diff._customData._requirements &&
        //     diff._customData._requirements.indexOf('Mapping Extensions') !== -1) {
        //   event.mappingExtensions = {isEnabled: true};
        // }
      });

      // Get difficulties.
      event.difficulties[mode] = diffBeatmaps;
    });

    if (!event.beatmaps[this.data.mode]) {
      generateMode(event, this.data.difficulty, this.data.mode);
    }

    // Default to hardest of first beatmap.
    if (!event.difficulty) {
      event.difficulty = this.data.difficulty || event.difficulties[this.data.mode][0]._difficulty;
    }
    event.mode = this.data.mode;

    Object.keys(loader.files).forEach(filename => {
      // Only needed if loading ZIP directly and not from API.
      if (!this.data.id) {
        if (filename.endsWith('jpg')) {
          event.image = loader.extractAsBlobUrl(filename, 'image/jpg');
        }
        if (filename.endsWith('png')) {
          event.image = loader.extractAsBlobUrl(filename, 'image/png');
        }
      }
      if (filename.endsWith('egg') || filename.endsWith('ogg')) {
        event.audio = loader.extractAsBlobUrl(filename, 'audio/ogg');
      }
    });

    if (!event.image && !this.data.id) {
      event.image = 'assets/img/favicon-196x196.png';
    }

    event.id = this.id;

    this.isFetching = '';
    console.log(event);
    this.el.emit('challengeloadend', event, false);
  },

  /**
   * Read API first to get hash and URLs.
   */
  fetchData: function (id, byHash) {
    document.cookie = "aprilFools=1; expires=Sat, 03 Apr 2022 00:00:00 UTC; path=/";
    return fetch(`/cors/beat-saver2/api/maps/${byHash ? 'hash' : 'id'}/${id}`).then(res => {
      res.json().then(data => {
        if (data.versions) {
          this.hash = data.versions[0].hash;
          this.id = data.id;
          data.image = utils.beatsaverCdnCors(data.versions[0].coverURL);
          data.hash = data.versions[0].hash;
          this.el.sceneEl.emit('songFetched', data);
          this.fetchZip(zipUrl || `${data.versions[0].downloadURL}`);
        } else {
          this.el.emit('challengeloaderror', null);
        }
        
      });
    });
  },

  fetchZip: function (zipUrl) {

    // Already fetching.
    if (this.isFetching === zipUrl ||
        (this.data.id && this.fetchedZip & this.fetchedZip === this.data.id)) { return; }

    this.el.emit('challengeloadstart', this.data.id, false);
    this.isFetching = zipUrl;

    // Fetch and unzip.
    const loader = new ZipLoader(zipUrl);

    loader.on('error', err => {
      this.el.emit('challengeloaderror', null);
      this.isFetching = '';
    });

    loader.on('progress', evt => {
      this.loadingIndicator.object3D.visible = true;
      this.loadingIndicator.setAttribute('material', 'progress',
                                         evt.loaded / evt.total);
    });

    loader.on('load', () => {
      this.fetchedZip = this.data.id;
      this.processFiles(loader);
    });

    loader.load();
  },

  difficultyFromId: function (diffId) {
    switch (diffId) {
      case 1: return "Easy"
      case 3: return "Normal"
      case 5: return "Hard"
      case 7: return "Expert"
      case 9: return "ExpertPlus"
    }
  }
});

/**
 * Beatsaver JSON sometimes have weird characters in front of JSON in utf16le encoding.
 */
function jsonParseClean (str) {
  try {
    str = str.trim();
    str = str.replace(/\u0000/g, '').replace(/\u\d\d\d\d/g, '');
    str = str.replace('\b', ' ');
    if (str[0] !== '{') {
      str = str.substring(str.indexOf('{'), str.length);
    }

    // Remove Unicode escape sequences.
    // stringified = stringified.replace(/\\u..../g, ' ');
    return jsonParseLoop(str, 0);
  } catch (e) {
    // Should not reach here.
    console.log(e, str);
    return null;
  }
}

const errorRe1 = /column (\d+)/m;
const errorRe2 = /position (\d+)/m;

function jsonParseLoop (str, i) {
  try {
    return JSON.parse(str);
  } catch (e) {
    let match = e.toString().match(errorRe1);
    if (!match) { match = e.toString().match(errorRe2); }
    if (!match) { throw e; }
    const errorPos = parseInt(match[1]);
    str = str.replace(str[errorPos], 'x');
    str = str.replace(str[errorPos + 1], 'x');
    str = str.replace(str[errorPos + 2], 'x');
    return jsonParseLoop(str, i + 1);
  }
}

function getZipUrl (key, hash) {
  return `https://beatsaver.com/cdn/${key}/${hash}.zip`;
}

// Push state URL in browser.
const idRe = /&?id=[\d\w-]+/
function removeIdQueryParam () {
  let search = window.location.search.toString();
  search = search.replace(idRe, '');
  let url = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
  url += search;
  window.history.pushState({path: url},'', url);
}

function generateMode(event, difficulty, mode) {
  if (mode.includes("Standard")) {
    event.beatmaps[mode] = {};
      event.beatSpeeds[mode] = {};
      event.beatOffsets[mode] = {};

    event.beatmaps[mode][difficulty] = event.beatmaps["Standard"][difficulty];
    event.beatSpeeds[mode][difficulty] = event.beatSpeeds["Standard"][difficulty];
    event.beatOffsets[mode][difficulty] = event.beatOffsets["Standard"][difficulty];
    event.difficulties[mode] = event.difficulties["Standard"];

    switch (mode) {
      case "VerticalStandard":
        Mirror_Vertical(event.beatmaps[mode][difficulty], false, false);
        break;
      case "HorizontalStandard":
        Mirror_Horizontal(event.beatmaps[mode][difficulty], 4, false, false);
        break;
      case "InverseStandard":
        Mirror_Inverse(event.beatmaps[mode][difficulty], 4, true, true, false);
        break;
      case "InvertedStandard":
        Mirror_Inverse(event.beatmaps[mode][difficulty], 4, false, false, false);
        break;
    
      default:
        break;
    }
  }
}