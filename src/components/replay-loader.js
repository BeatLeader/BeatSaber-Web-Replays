AFRAME.registerComponent('replay-loader', {
    schema: {
      playerID: {default: (AFRAME.utils.getUrlParameter('playerID') || '76561198059961776')},
      isSafari: {default: false},
      difficulty: {default: (AFRAME.utils.getUrlParameter('difficulty') || 'ExpertPlus' )},
      mode: {default: AFRAME.utils.getUrlParameter('mode') || 'Standard'}
    },
  
    init: function () {
      this.replay = null;
      this.user = null;

      let captureThis = this;
      document.addEventListener('songFetched', (e) => {
        captureThis.songFetched(e.detail.hash);
      });
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
      this.el.sceneEl.emit('replayloadstart', null);
      fetch(`/cors/score-saber/api/leaderboard/by-hash/${hash}/info?difficulty=${this.difficultyNumber(this.data.difficulty)}`).then(res => {
        res.json().then(leaderbord => {
          fetch(`https://sspreviewdecode.azurewebsites.net/?playerID=${this.data.playerID}&songID=${leaderbord.id}`).then(res => {
            res.json().then(data => {
              let replay = JSON.parse(data);
              if (replay.frames) {
                this.replay = replay;
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
      fetch(`/cors/score-saber/api/player/${this.data.playerID}/full`).then(res => {
        res.json().then(data => {
            this.user = data;
            this.el.sceneEl.emit('userloaded', {
              name: this.user.name, 
              avatar: this.user.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/'),
              country: this.user.country,
              countryIcon: `https://scoresaber.com/imports/images/flags/${this.user.country.toLowerCase()}.png`,
              id: this.user.id
            }, null);
        });
      });
    },
    processScores: function () {
      const replay = this.replay;
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

      const processGroup = () => {
        for (var j = 0; j < group.length; j++) {
          const mapnote = mapnotes[group[j]];
          for (var m = 0; m < group.length; m++) {
            const replaynote = noteStructs[groupIndex + m];
            if (replaynote.lineIndex == mapnote._lineIndex &&
              replaynote.noteLineLayer == mapnote._lineLayer &&
              replaynote.cutDirection == mapnote._cutDirection &&
              replaynote.colorType == mapnote._type) {
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
        return 0;
      });
      for (var i = 0; i < allStructs.length; i++) {
        allStructs[i].i = i;
      }

      var multiplier = 1, lastmultiplier = 1;
      var score = 0, noteIndex = 0;
      var combo = 0;

      for (var i = 0; i < allStructs.length; i++) {
        let note = allStructs[i];

        if (note.score < 0) {
          multiplier = multiplier > 1 ? Math.ceil(multiplier / 2) : 1;
          lastmultiplier = multiplier;
          combo = 0;
        } else {
          score += multiplier * note.score;
          combo++;
          multiplier = this.multiplierForCombo(this.comboForMultiplier(lastmultiplier) + combo);
        }

        note.multiplier = multiplier;
        note.totalScore = score;
        note.combo = combo;

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