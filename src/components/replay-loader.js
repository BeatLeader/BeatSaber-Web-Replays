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
                    this.el.sceneEl.emit('replayloaded', { maxScore: leaderbord.maxScore }, null);
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
    }
});