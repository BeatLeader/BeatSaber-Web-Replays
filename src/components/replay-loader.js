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
        captureThis.songFetched(e.detail);
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
                    this.processScores();
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
            this.el.sceneEl.emit('userloaded', {name: this.user.name, avatar: this.user.profilePicture.replace('https://cdn.scoresaber.com/', '/cors/score-saber-cdn/')}, null);
        });
      });
    },
    processScores: function () {
      const replay = this.replay;
      var noteStructs = new Array();
      var bombStructs = new Array();
      var index = 0;
      for (var i = 0; i < replay.scores.length; i++) {

        if (replay.scores[i] == -4) {
          let bomb = {
            time: replay.noteTime[i]
          }
          bombStructs.push(bomb);
        } else {
          let note = {
            score: replay.scores[i],
            time: replay.noteTime[i],
            combo: replay.combos[i],
            index: index
          }
          index++;
          noteStructs.push(note);
          // console.log(i + " -- " + note.score + " -- " + note.combo);
        }
      }

      noteStructs.sort(function(a, b) {
        if (a.time < b.time) return -1;
        if (a.time > b.time) return 1;
        return 0;
      });

      var multiplier = 1, lastmultiplier = 1;
      var score = 0;

      for (var i = 0; i < noteStructs.length; i++) {
        let note = noteStructs[i];

        if (note.score < 0) {
          multiplier = multiplier > 1 ? Math.ceil(multiplier / 2) : 1;
          lastmultiplier = multiplier;
        } else {
          score += multiplier * note.score;
          multiplier = this.multiplierForCombo(this.comboForMultiplier(lastmultiplier) + note.combo);
        }

        note.multiplier = multiplier;
        note.totalScore = i == noteStructs.length - 1 ? replay.info.totalScore : score;
        note.accuracy = (note.totalScore / this.maxScoreForNote(i) * 100).toFixed(2);

        // console.log(note.score + " - " + noteIndex);
      }
      this.notes = noteStructs;
      if (this.challenge) {
        this.calculateOffset();
      }

      console.log(replay.info.room);

      this.el.sceneEl.emit('replayloaded', { notes: noteStructs, bombs: bombStructs}, null);
    },
    challengeloadend: function(event) {
      this.challenge = event;
      if (this.notes) {
        this.calculateOffset();
      }
    },
    calculateOffset() {
      let beatmaps = this.challenge.beatmaps[this.data.mode][this.data.difficulty]._notes;
      let bpm = this.challenge.info._beatsPerMinute;
      const sPerBeat = 60 / bpm;
      let count = Math.min(this.notes.length, 100);
      var result = 0;

      var noteIndex = 0;
      var replayNoteIndex = 0;
      
      while (replayNoteIndex < count) {
        let replayNote = this.notes[replayNoteIndex];
        let songNote = beatmaps[noteIndex];

        if (songNote._type < 2) {
          result += songNote._time * sPerBeat - replayNote.time;
          replayNoteIndex++;
        }

        noteIndex++;
      }
      this.replay.info.midDeviation = result / count;
      console.log("Mid deviation: " + this.replay.info.midDeviation);
    },
    maxScoreForNote(index) {
      if (index < 2) {
        return (index + 1) * 115;
      } if (index < 6) {
        return index * 2 * 115;
      } if (index < 14) {
        return 5 * 2 * 115 + (index - 5) * 4 * 115;
      } else {
        return 5 * 2 * 115 + 8 * 4 * 115 + (index - 13) * 8 * 115;
      }
    }, 
    multiplierForCombo(combo) {
      if (combo < 2) {
        return 1;
      } if (combo < 6) {
        return 2;
      } if (combo < 14) {
        return 4;
      } else {
        return 8;
      }
    },
    comboForMultiplier(multiplier) {
      if (multiplier == 1) {
        return 0;
      } if (multiplier == 2) {
        return 2;
      } if (multiplier == 4) {
        return 6;
      } else {
        return 14;
      }
    },
});