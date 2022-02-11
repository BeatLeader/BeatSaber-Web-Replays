const dragDrop = require('drag-drop');
const DECODER_LINK = 'https://sspreviewdecode.azurewebsites.net'

import {mirrorDirection, getRandomColor} from '../utils';

AFRAME.registerComponent('replay-loader', {
    schema: {
      playerID: {default: (AFRAME.utils.getUrlParameter('playerID'))},
      players: {default: (AFRAME.utils.getUrlParameter('players'))},
      link: {default: (AFRAME.utils.getUrlParameter('link'))},
      isSafari: {default: false},
      difficulty: {default: (AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus' )},
      mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'}
    },
  
    init: function () {
      this.replays = [];
      this.users = [];
    },

    update: function () {
      let captureThis = this;
      if (this.data.link.length) {
        setTimeout(() => this.fetchByFile(this.data.link, true), 300);
      } else if (!this.data.playerID.length && !this.data.players.length) {
        this.cleanup = dragDrop('#body', (files) => {
          this.fetchByFile(files[0]);
        });
      } else {
        this.userIds = this.data.playerID.length ? [this.data.playerID] : this.data.players.split(",");
        document.addEventListener('songFetched', (e) => {
          captureThis.songFetched(e.detail.hash);
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

    songFetched: function (hash) {
      console.log("fetched");
      this.el.sceneEl.emit('replayloadstart', null);
      fetch(`/cors/score-saber/api/leaderboard/by-hash/${hash}/info?difficulty=${this.difficultyNumber(this.data.difficulty)}`, {referrer: "https://www.beatlooser.com"}).then(res => {
        res.json().then(leaderbord => {
          this.userIds.forEach((playerID, i) => {
            const index = i;
            fetch(`${DECODER_LINK}/?playerID=${playerID}&songID=${leaderbord.id}`).then(res => {
              res.json().then(data => {
                let replay = JSON.parse(data);
                if (replay.frames) {
                  replay.color = getRandomColor();
                  replay.info.playerID = playerID;
                  this.replays[index] = replay;
                  this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: replay.info.difficulty, index, color: replay.color, playerID }, null);
                  if (this.challenge) {
                    this.processScores(replay);
                  }
                } else {
                  this.el.sceneEl.emit('replayloadfailed', { error: replay.errorMessage }, null);
                }
              });
            });
          });
        });
      });
      this.userIds.forEach(playerID => {
        fetch(`/cors/score-saber/api/player/${playerID}/full`, {referrer: "https://www.beatlooser.com"}).then(res => {
          res.json().then(data => {
              const user = {
                name: data.name, 
                avatar: data.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/'),
                country: data.country,
                countryIcon: `/cors/score-saber/imports/images/flags/${data.country.toLowerCase()}.png`,
                id: data.id
              };
              this.users.push(user);
              this.el.sceneEl.emit('userloaded', user, null);
          });
        });
      });
    },

    fetchByFile: function (file, itsLink) {
      if (!itsLink && file.size > 40000000) { // 40 MB cap
        this.el.sceneEl.emit('replayloadfailed', { error: "File is too big" }, null);
        return;
      }
      this.el.sceneEl.emit('replayloadstart', null);
      (!itsLink
      ? fetch(DECODER_LINK, { method: 'POST', body: file })
      : fetch(`${DECODER_LINK}/?link=${file}`))
      .then(response => response.json()).then(
        data => {
          let replay = JSON.parse(data);
          if (replay.frames) {
            this.replay = replay;
            this.cleanup && this.cleanup();
            this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: replay.info.difficulty }, null);
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
        fetch(`/cors/score-saber/api/player/${playerId}/full`).then(res => {
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
      }
    },
    processScores: function (replay) {
      var mapnotes = this.challenge.beatmaps[this.data.mode][this.data.difficulty]._notes;
      mapnotes = mapnotes.sort((a, b) => { return a._time - b._time; }).filter(a => a._type == 0 || a._type == 1);

      var noteStructs = new Array();
      var bombStructs = new Array();
      var wallStructs = new Array();
      for (var i = 0; i < replay.scores.length; i++) {
        if (replay.scores[i] == -4) {
          let bomb = {
            score: -4,
            time: replay.noteTime[i]
          }
          bombStructs.push(bomb);
        } else if (replay.scores[i] == -5) {
          let wall = {
            score: -5,
            time: replay.noteTime[i]
          }
          wallStructs.push(wall);
        } else {
          const info = replay.noteInfos[i];
          let note = {
            score: replay.scores[i],
            time: replay.noteTime[i],
            lineIndex: parseInt(info[0]),
            noteLineLayer: parseInt(info[1]),
            cutDirection: parseInt(info[2]),
            colorType: parseInt(info[3]),
            isBlock: true
          }
          noteStructs.push(note);
        }
      }

      var group, groupIndex, groupTime;
      const leftHanded = replay.info.leftHanded;

      const processGroup = () => {
        for (var j = 0; j < group.length; j++) {
          const mapnote = mapnotes[group[j]];
          for (var m = 0; m < group.length; m++) {
            const replaynote = noteStructs[groupIndex + m];

            const lineIndex = leftHanded ? 3 - replaynote.lineIndex : replaynote.lineIndex;
            const colorType = leftHanded ? 1 - replaynote.colorType : replaynote.colorType;
            const cutDirection = leftHanded ? mirrorDirection(replaynote.cutDirection) : replaynote.cutDirection;

            if (lineIndex == mapnote._lineIndex &&
              replaynote.noteLineLayer == mapnote._lineLayer &&
              cutDirection == mapnote._cutDirection &&
              colorType == mapnote._type) {
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
      if (!this.allStructs) {
        this.allStructs = allStructs;
        this.notes = noteStructs;
        this.bombs = bombStructs;
        this.walls = wallStructs;

        this.el.sceneEl.emit('replayloaded', { notes: allStructs}, null);
      }

      replay.noteStructs = allStructs;
    },
    challengeloadend: function(event) {
      this.challenge = event;
      if (!this.notes && this.replays.length) {
        this.replays.forEach(replay => {
          this.processScores(replay);
        });
        
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