AFRAME.registerComponent('replay-player', {
    schema: {
    },

    init: function () {
        this.saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');
        this.replayDecoder = this.el.sceneEl.components['replay-loader'];
        this.song = this.el.sceneEl.components.song;
        this.score = {
          totalScore: 0,
          combo: 0,
          acc: 0,
          lastNoteScore: 0,
          multiplier: 1
        }
    },

    tock: function (time, delta) {
        if (this.song.isPlaying && this.replayDecoder.replay) {
          let currentTime = this.song.getCurrentTime() - 0.06;
          let frames = this.replayDecoder.replay.frames;
          var frameIndex = 0;
          for (var i = 0; i < frames.length; i++) {
            if (Math.abs(frames[i].a - currentTime) < 0.01) {
              frameIndex = i;
              break;
            }
          }
    
          let frame = frames[frameIndex];
          let nextFrame = frames[frameIndex != frames.length - 1 ? frameIndex + 1 : frameIndex];
    
          let height = this.replayDecoder.replay.info.height;
          
          this.saberEls[0].object3D.position.x = frame.l.p.x;
          this.saberEls[0].object3D.position.y = frame.l.p.y;// + (height - 2.0);
          this.saberEls[0].object3D.position.z = frame.l.p.z;
    
          this.saberEls[1].object3D.position.x = frame.r.p.x;
          this.saberEls[1].object3D.position.y = frame.r.p.y;// + (height - 2.0);
          this.saberEls[1].object3D.position.z = frame.r.p.z;
    
          var lquat = new THREE.Quaternion(frame.l.r.w, frame.l.r.z, frame.l.r.y, frame.l.r.x).slerp(new THREE.Quaternion(nextFrame.l.r.w, nextFrame.l.r.z, nextFrame.l.r.y, nextFrame.l.r.x), 0.2);
          var lrotation = new THREE.Euler().setFromQuaternion(lquat);
    
          this.saberEls[0].object3D.rotation.x = lrotation.x;
          this.saberEls[0].object3D.rotation.y = lrotation.y + Math.PI;
          this.saberEls[0].object3D.rotation.z = -lrotation.z;
    
          var rquat = new THREE.Quaternion(frame.r.r.w, frame.r.r.z, frame.r.r.y, frame.r.r.x).slerp(new THREE.Quaternion(nextFrame.r.r.w, nextFrame.r.r.z, nextFrame.r.r.y, nextFrame.r.r.x), 0.2);
          var rrotation = new THREE.Euler().setFromQuaternion(rquat);
    
          this.saberEls[1].object3D.rotation.x = rrotation.x;
          this.saberEls[1].object3D.rotation.y = rrotation.y + Math.PI;
          this.saberEls[1].object3D.rotation.z = -rrotation.z;

          let combos = this.replayDecoder.replay.combos;
          var comboIndex = combos.length - 1;
          
          for (var i = 0; i < combos.length; i++) {
            if (combos[i].a >= currentTime) {
              comboIndex = i;
              comboTime = combos[i].a;
              break;
            }
          }

          let scores = this.replayDecoder.replay.scores;
          var comboTime = combos[comboIndex].a, lastComboTime = comboIndex == 0 ? 0 : combos[comboIndex - 1].a;

          var currentScore, scoreIndex, lastScoreIndex;
          for (var i = 0; i < scores.length; i++) {
            if (!lastScoreIndex && scores[i].a >= lastComboTime) {
              lastScoreIndex = i;
            }

            if (!scoreIndex && scores[i].a >= comboTime) {
              scoreIndex = i;
            }

            if (!currentScore && scores[i].a >= currentTime) {
              currentScore = i;
            }

            if (lastScoreIndex && scoreIndex && currentScore) break;
          }

          lastScoreIndex = lastScoreIndex ? lastScoreIndex : scores.length - 2;
          scoreIndex = scoreIndex ? scoreIndex : scores.length - 1;
          currentScore = currentScore ? currentScore : scores.length - 1;

          let multiplier = this.multiplier(combos[comboIndex].i);

          if (comboIndex == 0) {
            this.score = {
              totalScore: scores[currentScore].i,
              combo: combos[comboIndex].i,
              acc: 0,
              lastNoteScore: scores[scoreIndex].i / multiplier,
              multiplier: multiplier
            }
          } else {
            this.score = {
              totalScore: scores[currentScore].i,
              combo: combos[comboIndex].i,
              acc: 0,
              lastNoteScore: (scores[scoreIndex].i - scores[lastScoreIndex].i) / multiplier,
              multiplier: multiplier
            }
          }

          // console.log(frame.a + " - " + scores[scoreIndex].i + " - " + currentScore + " - " + currentTime);
          // console.log((scores[scoreIndex].i - scores[lastScoreIndex].i) / this.multiplier(combos[comboIndex].i));
        }
      },
    multiplier: function (combo) {
      if (combo < 2) {
        return 1;
      } if (combo < 6) {
        return 2;
      } if (combo < 14) {
        return 4;
      } else {
        return 8;
      }
    }
});