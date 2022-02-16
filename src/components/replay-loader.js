const dragDrop = require('drag-drop');
import {checkBSOR, NoteEventType, ssReplayToBSOR} from '../open-replay-decoder';
const DECODER_LINK = 'https://sspreviewdecode.azurewebsites.net'

import {mirrorDirection} from '../utils';

AFRAME.registerComponent('replay-loader', {
    schema: {
      playerID: {default: (AFRAME.utils.getUrlParameter('playerID'))},
      link: {default: (AFRAME.utils.getUrlParameter('link'))},
      isSafari: {default: false},
      difficulty: {default: (AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus' )},
      mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'}
    },
  
    init: function () {
      this.replay = null;
      this.user = null;
    },

    update: function () {
      let captureThis = this;
      if (this.data.link.length) {
        setTimeout(() => this.fetchByFile(this.data.link, true), 300);
      } else if (!this.data.playerID.length) {
        this.cleanup = dragDrop('#body', (files) => {
          this.fetchByFile(files[0]);
        });
      } else {
        document.addEventListener('songFetched', (e) => {
          captureThis.downloadSSReplay(e.detail.hash);
        });
      }

      this.el.addEventListener('challengeloadend', (e) => {
        captureThis.challengeloadend(e.detail);
      });
    },

    difficultyNumber: function (name) {
      switch(name) {
        case 'Easy':
        case 'easy':
          return 1;
        case 'Normal':
        case 'normal':
          return 3;
        case 'Hard':
        case 'hard':
          return 5;
        case 'Expert':
        case 'expert':
          return 7;
        case 'ExpertPlus':
        case 'expertPlus':
          return 9;
    
        default: return 0;
      }
    },

    downloadSSReplay: function (hash) {
      this.el.sceneEl.emit('replayloadstart', null);
      fetch(`/cors/score-saber/api/leaderboard/by-hash/${hash}/info?difficulty=${this.difficultyNumber(this.data.difficulty)}`, {referrer: "https://www.beatlooser.com"}).then(res => {
        res.json().then(leaderbord => {
          fetch(`${DECODER_LINK}/?playerID=${this.data.playerID}&songID=${leaderbord.id}`).then(res => {
            res.json().then(data => {
              let replay = ssReplayToBSOR(JSON.parse(data));
              if (replay.frames) {
                this.replay = replay;
                this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: replay.info.difficulty, mode: replay.info.mode }, null);
                if (this.challenge) {
                  this.processScores();
                }
              } else {
                this.el.sceneEl.emit('replayloadfailed', { error: replay.errorMessage }, null);
              }
            });
          });
        });
      });
      this.fetchPlayer(this.data.playerID);
    },

    fetchByFile: function (file, itsLink) {
      this.el.sceneEl.emit('replayloadstart', null);
      checkBSOR(file, itsLink, (replay) => {
        if (replay && replay.frames) {
          this.replay = replay;
          this.fetchPlayer(replay.info.playerID);
          this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: this.difficultyNumber(replay.info.difficulty), mode: replay.info.mode }, null);
        } else {
          this.fetchSSFile(file, itsLink);
        }
      });
    },

    fetchSSFile: function (file, itsLink) {
      if (!itsLink && file.size > 40000000) { // 40 MB cap
        this.el.sceneEl.emit('replayloadfailed', { error: "File is too big" }, null);
        return;
      }
      (!itsLink
      ? fetch(DECODER_LINK, { method: 'POST', body: file })
      : fetch(`${DECODER_LINK}/?link=${file}`))
      .then(response => response.json()).then(
        data => {
          let replay = ssReplayToBSOR(JSON.parse(data));
          if (replay.frames) {
            this.replay = replay;
            this.cleanup && this.cleanup();
            this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: replay.info.difficulty, mode: replay.info.mode  }, null);
            if (this.challenge) {
              this.processScores();
            }
          } else {
            this.el.sceneEl.emit('replayloadfailed', { error: replay.errorMessage }, null);
          }
      }).catch(
        error => this.el.sceneEl.emit('replayloadfailed', {error}, null) // Handle the error response object
      );
      let playerId = (itsLink ? file : file.name).split(/\.|-|\//).find(el => (el.length == 16 || el.length == 17) && parseInt(el, 10));
      if (playerId) {
        this.fetchPlayer(playerId);
      }
    },

    // TODO: Move to beatleader
    fetchPlayer: function (playerID) {
      fetch(`/cors/score-saber/api/player/${playerID}/full`, {referrer: "https://www.beatlooser.com"}).then(res => {
        res.json().then(data => {
            this.user = data;
            this.el.sceneEl.emit('userloaded', {
              name: this.user.name, 
              avatar: this.user.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/'),
              country: this.user.country,
              countryIcon: `/cors/score-saber/imports/images/flags/${this.user.country.toLowerCase()}.png`,
              id: this.user.id
            }, null);
        });
      });
    },
    processScores: function () {
      const replay = this.replay;
      var mapnotes = this.challenge.beatmaps[this.challenge.mode][this.challenge.difficulty]._notes;
      mapnotes = mapnotes.sort((a, b) => { return a._time - b._time; }).filter(a => a._type == 0 || a._type == 1);

      var noteStructs = new Array();
      var bombStructs = new Array();
      for (var i = 0; i < replay.notes.length; i++) {
        const info = replay.notes[i];
        let note = {
          cutInfo: info.noteCutInfo,
          spawnTime: info.spawnTime,
          time: info.eventTime,
          id: info.noteID,
          score: info.score ? info.score : ScoreForNote(info)
        }
        if (note.eventType == NoteEventType.bomb) {
          bombStructs.push(note);
        } else {
          note.isBlock = true;
          noteStructs.push(note);
        }
      }

      noteStructs.sort(function(a, b) {
        if (a.spawnTime < b.spawnTime) return -1;
        if (a.spawnTime > b.spawnTime) return 1;
        return 0;
      });

      var wallStructs = new Array();
      for (var i = 0; i < replay.walls.length; i++) {
        const info = replay.walls[i];
        let note = {
          time: info.time,
          id: info.wallID,
          score: -5
        }
        wallStructs.push(note);
      }

      var group, groupIndex, groupTime;
      const leftHanded = replay.info.leftHanded;

      const processGroup = () => {
        for (var j = 0; j < group.length; j++) {
          const mapnote = mapnotes[group[j]];
          for (var m = 0; m < group.length; m++) {
            const replaynote = noteStructs[groupIndex + m];

            const lineIndex = leftHanded ? 3 - mapnote._lineIndex : mapnote._lineIndex;
            const colorType = leftHanded ? 1 - mapnote._type : mapnote._type;
            const cutDirection = leftHanded ? mirrorDirection(mapnote._cutDirection) : mapnote._cutDirection;
            const lineLayer = mapnote._lineLayer;
            const id = lineIndex * 1000 + lineLayer * 100 + colorType * 10 + cutDirection;

            if (replaynote.id == id) {
                replaynote.index = group[j];
                break;
            }
          }
        }
      }

      for (var i = 0; i < mapnotes.length && i < noteStructs.length; i++) {
        if (!group) {
          group = [i];
          groupIndex = i;
          groupTime = mapnotes[i]._time;
        } else {
          if (Math.abs(groupTime - mapnotes[i]._time) < 0.0001) {
            group.push(i);
          } else {
            processGroup();
            group = null;
            i--;
          }
        }
      }
      processGroup();

      for (var i = 0; i < noteStructs.length; i++) {
        if (noteStructs[i].index == undefined) {
          console.log(noteStructs[i]);
        }
      }

      const allStructs = [].concat(bombStructs, noteStructs, wallStructs);
      allStructs.sort(function(a, b) {
        if (a.time < b.time) return -1;
        if (a.time > b.time) return 1;
        if (a.index < b.index) return -1;
        if (a.index > b.index) return 1;
        return 0;
      });

      for (var i = 0; i < allStructs.length; i++) {
        allStructs[i].i = i;
      }

      var multiplier = 1, lastmultiplier = 1;
      var score = 0, noteIndex = 0;
      var combo = 0;
      var misses = 0;

      for (var i = 0; i < allStructs.length; i++) {
        let note = allStructs[i];

        if (note.score < 0) {
          multiplier = multiplier > 1 ? Math.ceil(multiplier / 2) : 1;
          lastmultiplier = multiplier;
          combo = 0;
          misses++;
        } else {
          score += multiplier * note.score;
          combo++;
          multiplier = this.multiplierForCombo(this.comboForMultiplier(lastmultiplier) + combo);
        }

        note.multiplier = multiplier;
        note.totalScore = score;
        note.combo = combo;
        note.misses = misses;

        if (note.isBlock) {
          note.accuracy = (note.totalScore / this.maxScoreForNote(noteIndex) * 100).toFixed(2);
          noteIndex++;
        } else {
          note.accuracy = i == 0 ? 0 : allStructs[i - 1].accuracy;
        }
      }
      this.allStructs = allStructs;
      this.notes = noteStructs;
      this.bombs = bombStructs;
      this.walls = wallStructs;

      this.el.sceneEl.emit('replayloaded', { notes: allStructs}, null);
    },
    challengeloadend: function(event) {
      this.challenge = event;
      if (!this.notes && this.replay) {
        this.processScores();
      }
    },
    maxScoreForNote(index) {
      const note_score = 115;
      const notes = index + 1;

      if (notes <= 1) // x1 (+1 note)
          return note_score * (0 + (notes - 0) * 1);
      if (notes <= 5) // x2 (+4 notes)
          return note_score * (1 + (notes - 1) * 2);
      if (notes <= 13) // x4 (+8 notes)
          return note_score * (9 + (notes - 5) * 4);
      // x8
      return note_score * (41 + (notes - 13) * 8);
    }, 
    multiplierForCombo(combo) {
      if (combo < 1) {
        return 1;
      } if (combo < 5) {
        return 2;
      } if (combo < 13) {
        return 4;
      } else {
        return 8;
      }
    },
    comboForMultiplier(multiplier) {
      if (multiplier == 1) {
        return 0;
      } if (multiplier == 2) {
        return 1;
      } if (multiplier == 4) {
        return 6;
      } else {
        return 13;
      }
    },
});

function Clamp(value) {
	if (value < 0.0) return 0.0;
	return value > 1.0 ? 1.0 : value;
}

function ScoreForNote(note) {
  if (note.eventType == NoteEventType.good) {
    const cut = note.noteCutInfo;
    const beforeCutRawScore = Math.round(70 * cut.beforeCutRating);
    const afterCutRawScore = Math.round(30 * cut.afterCutRating);
    const num = 1 - Clamp(cut.cutDistanceToCenter / 0.3);
    const cutDistanceRawScore = Math.round(15 * num);
  
    return beforeCutRawScore + afterCutRawScore + cutDistanceRawScore;
  } else {
    switch (note.eventType) {
      case NoteEventType.bad:
        return -2;
      case NoteEventType.miss:
        return -3;
      case NoteEventType.bomb:
        return -4;
    }
  } 
}