const dragDrop = require('drag-drop');
import {checkBSOR, NoteEventType, ssReplayToBSOR} from '../open-replay-decoder';
import {MultiplierCounter} from '../utils/MultiplierCounter'
import { mirrorDirection } from '../utils'
const DECODER_LINK = 'https://ssdecode.azurewebsites.net'

import {NoteCutDirection, difficultyFromName, clamp, ScoringType, getRandomColor} from '../utils';

AFRAME.registerComponent('replay-loader', {
    schema: {
      playerID: {default: (AFRAME.utils.getUrlParameter('playerID'))},
      players: {default: (AFRAME.utils.getUrlParameter('players'))},
      link: {default: (AFRAME.utils.getUrlParameter('link'))},
      hash: {default: (AFRAME.utils.getUrlParameter('hash'))},
      isSafari: {default: false},
      difficulty: {default: (AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus' )},
      mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'}
    },
  
    init: function () {

      this.replays = [];
      this.users = [];
      this.processedScores = 0;
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
          captureThis.downloadReplay(this.data.hash ? this.data.hash : e.detail.hash);
        });
      }

      this.el.addEventListener('challengeloadend', (e) => {
        captureThis.challengeloadend(e.detail);
      });
    },

    downloadReplay: function (hash) {
      this.el.sceneEl.emit('replayloadstart', null);
      this.userIds.forEach((playerID, index) => {
        fetch(`https://api.beatleader.xyz/score/${playerID}/${hash}/${this.data.difficulty}/${this.data.mode}`)
        .then(async response => {
          let data = response.status == 200 ? await response.json() : null;
          if (data && data.playerId) {
            checkBSOR(data.replay, true, (replay) => {
              if (replay && replay.frames) {
                if (replay.frames.length == 0) {
                  this.el.sceneEl.emit('replayloadfailed', { error: "Replay broken, redownload and reinstall mod, please" }, null);
                } else {
                  replay.index = index;
                  replay.color = getRandomColor();
                  replay.info.playerID = playerID;
                  this.replays[index] = replay;
                  const jd = replay.info.jumpDistance > 5 ? replay.info.jumpDistance : undefined;
                  this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: difficultyFromName(replay.info.difficulty), index, color: replay.color, playerID, mode: replay.info.mode, jd }, null);
                  this.el.sceneEl.emit('colorChanged', {  index, color: replay.color, playerID }, null);
                  if (this.challenge) {
                    this.processScores(replay);
                  }
                }
              } else {
                this.el.sceneEl.emit('replayloadfailed', { error: replay.errorMessage }, null);
              }
            });
            const user = {
              name: data.player.name, 
              avatar: data.player.avatar,
              country: data.player.country,
              countryIcon: `https://cdn.beatleader.xyz/flags/${data.player.country.toLowerCase()}.png`,
              profileLink: `https://beatleader.xyz/u/${data.player.id}`, 
              id: data.player.id
            };
            this.users.push(user);
            this.el.sceneEl.emit('userloaded', user, null);
          } else {
            this.downloadSSReplay(hash, playerID, index);
          }
        })
      });
    },

    downloadSSReplay: function (hash, playerID, index) {
      fetch(`/cors/score-saber/api/leaderboard/by-hash/${hash}/info?difficulty=${difficultyFromName(this.data.difficulty)}`, {referrer: "https://www.beatlooser.com"}).then(res => {
        res.json().then(leaderbord => {
          // this.userIds.forEach((playerID, i) => {
          //   const index = i;
            fetch(`${DECODER_LINK}/?playerID=${playerID}&songID=${leaderbord.id}`).then(res => {
              res.json().then(replay => {
                if (replay.frames) {
                  replay = ssReplayToBSOR(replay);
                  replay.index = index;
                  replay.color = getRandomColor();
                  replay.info.playerID = playerID;
                  this.replays[index] = replay;
                  this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: replay.info.difficulty, index, color: replay.color, playerID, mode: replay.info.mode }, null);
                  this.el.sceneEl.emit('colorChanged', {  index, color: replay.color, playerID }, null);
                  if (this.challenge) {
                    this.processScores(replay);
                  }
                } else {
                  this.el.sceneEl.emit('replayloadfailed', { error: replay.errorMessage }, null);
                }
              });
            });
          //});
        });
      });
      fetch(`/cors/score-saber/api/player/${playerID}/full`, {referrer: "https://www.beatlooser.com"}).then(res => {
          res.json().then(data => {
              const user = {
                name: data.name, 
                avatar: data.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/'),
                country: data.country,
                countryIcon: `https://cdn.beatleader.xyz/flags/${data.country.toLowerCase()}.png`,
                id: data.id
              };
              this.users.push(user);
              this.el.sceneEl.emit('userloaded', user, null);
          });
        });
    },

    fetchByFile: function (file, itsLink) {
      this.el.sceneEl.emit('replayloadstart', null);
      checkBSOR(file, itsLink, (replay) => {
        if (replay && replay.frames) {
          this.replay = replay;
          this.fetchPlayer(replay.info.playerID);
          this.el.sceneEl.emit('replayfetched', { hash: replay.info.hash, difficulty: difficultyFromName(replay.info.difficulty), mode: replay.info.mode, jd: replay.info.jumpDistance }, null);
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
          let replay = ssReplayToBSOR(data);
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

    fetchPlayer: function (playerID) {
      fetch(`/cors/score-saber/api/player/${playerID}/full`, {referrer: "https://www.beatlooser.com"}).then(res => {
        res.json().then(data => {
            this.user = data;
            this.el.sceneEl.emit('userloaded', {
              name: this.user.name, 
              avatar: this.user.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/'),
              country: this.user.country,
              countryIcon: `https://cdn.beatleader.xyz/flags/${this.user.country.toLowerCase()}.png`,
              profileLink: `https://scoresaber.com/u/${this.user.id}`, 
              id: this.user.id
            }, null);
        });
      });
    },

    processScores: function (replay) {
      const map = this.challenge.beatmaps[this.challenge.mode][this.challenge.difficulty];
      var mapnotes = [].concat(map._notes, map._chains)

      mapnotes = mapnotes.sort((a, b) => { return a._time - b._time; }).filter(a => a._type == 0 || a._type == 1);
      this.applyModifiers(map, replay);

      var noteStructs = new Array();
      var bombStructs = new Array();
      for (var i = 0; i < replay.notes.length; i++) {
        const info = replay.notes[i];
        let note = {
          eventType: info.eventType,
          cutInfo: info.noteCutInfo,
          spawnTime: info.spawnTime,
          time: info.eventTime,
          id: info.noteID,
          score: info.score,
          cutPoint: info.noteCutInfo ? info.noteCutInfo.cutPoint : null
        }
        
        if (note.id == -1 || (note.id > 0 && note.id < 100000 && note.id % 10 == 9)) {
          note.eventType = NoteEventType.bomb;
          note.id += 4;
          note.score = -4;
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
            const scoringType = mapnote._scoringType ? mapnote._scoringType + 2 : 3;
            const id = lineIndex * 1000 + lineLayer * 100 + colorType * 10 + cutDirection;

            if (replaynote.index == undefined && (replaynote.id == id || replaynote.id == (id + scoringType * 10000))) {
                replaynote.index = group[j];
                replaynote.colorType = colorType;
                replaynote.lineIndex = lineIndex;
                replaynote.cutDirection = cutDirection;
                replaynote.lineLayer = lineLayer;
                replaynote.mapnote = mapnote;
                replaynote.scoringType = scoringType - 2;
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
        var note = allStructs[i];
        note.i = i;
        if (!note.score) {
          note.score = ScoreForNote(note.eventType, note.cutInfo, note.scoringType);
        }
      }

      var energy = 0.5;
      var score = 0, maxScore = 0, combo = 0, misses = 0;

      const maxCounter = new MultiplierCounter();
      const normalCounter = new MultiplierCounter();

      for (var i = 0; i < allStructs.length; i++) {
        let note = allStructs[i];

        var scoreForMaxScore = 115;
        if (note.scoringType == ScoringType.BurstSliderHead) {
            scoreForMaxScore = 85;
        } else if (note.scoringType == ScoringType.BurstSliderElement) {
            scoreForMaxScore = 20;
        }

        maxCounter.Increase();
        maxScore += maxCounter.Multiplier * scoreForMaxScore;

        if (note.score < 0) {
          normalCounter.Decrease();
          combo = 0;
          misses++;
          switch (note.score) {
            case -2:
              energy -= 0.1;
              break;
            case -4:
            case -3:
              energy -= 0.15;
              break;
          
            default:
              break;
          }
        } else {
          normalCounter.Increase();
          score += normalCounter.Multiplier * note.score;
          energy += 0.01;
          if (energy > 1) {
            energy = 1;
          }
          combo++;
        }

        note.multiplier = normalCounter.Multiplier;
        note.totalScore = score;
        note.combo = combo;
        note.misses = misses;
        note.energy = energy;
        note.maxScore = scoreForMaxScore;

        if (note.isBlock) {
          note.accuracy = ((note.totalScore / maxScore) * 100).toFixed(2);
        } else {
          note.accuracy = i == 0 ? 0 : allStructs[i - 1].accuracy;
        }
      }
      if (!this.allStructs) {
        this.allStructs = allStructs;
        this.notes = noteStructs;
        this.bombs = bombStructs;
        this.walls = wallStructs;
      }

      replay.noteStructs = allStructs;
      this.processedScores++;

      this.el.sceneEl.emit('replayloaded', { notes: allStructs, allProcessed: this.processedScores == this.userIds.length}, null);
      if (this.processedScores == this.userIds.length) {
        this.noteCountForBattle = Math.round(this.allStructs.length / (this.replays.length - 1));
      }
    },
    challengeloadend: function(event) {
      this.challenge = event;
      if (!this.notes && this.replays.length) {
        this.replays.forEach(replay => {
          this.processScores(replay);
        });
      }
    },

    applyModifiers: function (map, replay) {
      if (replay.info.modifiers.includes("NA")) {
        map._notes.forEach(note => {
          note._cutDirection = NoteCutDirection.Any;
        });
      }
      if (replay.info.modifiers.includes("NB")) {
        map._notes = map._notes.filter(a => a._type == 0 || a._type == 1);
      }
      if (replay.info.modifiers.includes("NO")) {
        map._obstacles = [];
      }
    },
});

function CutScoresForNote(cut, scoringType) {
    var beforeCutRawScore = 0;
    if (scoringType != ScoringType.BurstSliderElement) {
      if (scoringType == ScoringType.SliderTail) {
        beforeCutRawScore = 70;
      } else {
        beforeCutRawScore = clamp(Math.round(70 * cut.beforeCutRating), 0, 70);
      }
    }
    var afterCutRawScore = 0;
    if (scoringType != ScoringType.BurstSliderElement) {
      if (scoringType == ScoringType.BurstSliderHead) {
        afterCutRawScore = 0;
      } else if (scoringType == ScoringType.SliderHead) {
        afterCutRawScore = 30;
      } else {
        afterCutRawScore = clamp(Math.round(30 * cut.afterCutRating), 0, 30);
      }
    }
    var cutDistanceRawScore = 0;
    if (scoringType == ScoringType.BurstSliderElement) {
      cutDistanceRawScore = 20;
    } else {
      var num = 1 - clamp(cut.cutDistanceToCenter / 0.3, 0, 1);
      cutDistanceRawScore = Math.round(15 * num);
    }

    return [beforeCutRawScore, afterCutRawScore, cutDistanceRawScore];
}

function ScoreForNote(eventType, cutInfo, scoringType) {
  if (eventType == NoteEventType.good) {
    const scores = CutScoresForNote(cutInfo, scoringType);
    const result = scores[0] + scores[1] + scores[2];
  
    return result > 115 ? -2 : result;
  } else {
    switch (eventType) {
      case NoteEventType.bad:
        return -2;
      case NoteEventType.miss:
        return -3;
      case NoteEventType.bomb:
        return -4;
    }
  } 
}