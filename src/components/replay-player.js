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

        this.saberEls[0].object3D.position.y = 1.4;
        this.saberEls[0].object3D.position.x = -0.4;
        
        this.saberEls[1].object3D.position.y = 1.4;
        this.saberEls[1].object3D.position.x = 0.4;

        
    },

    play: function () {
      this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
      this.headset.object3D.position.y = 1.75;
    },

    tock: function (time, delta) {
      let replay = this.replayDecoder.replay;
        if (this.song.isPlaying && replay) {
          let currentTime = this.song.getCurrentTime();// - replay.info.midDeviation;
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
    
          let room = replay.info.room;
          let height = clamp((replay.info.height - 1.8) * 0.5, -0.2, 0.6);
          
          
          if (replay.info.leftHanded) {
            this.leftHandedTock(room, frame, nextFrame, height);
          } else {
            this.rightHandedTock(room, frame, nextFrame, height);
          }
        }
      },
    rightHandedTock: function(room, frame, nextFrame, height) {
          this.saberEls[0].object3D.position.x = frame.l.p.x - room.x;
          this.saberEls[0].object3D.position.y = frame.l.p.y - room.y + height;
          this.saberEls[0].object3D.position.z = -frame.l.p.z + room.z;
    
          this.saberEls[1].object3D.position.x = frame.r.p.x - room.x;
          this.saberEls[1].object3D.position.y = frame.r.p.y - room.y + height;
          this.saberEls[1].object3D.position.z = -frame.r.p.z + room.z;

          this.headset.object3D.position.x = frame.h.p.x - room.x;
          this.headset.object3D.position.y = frame.h.p.y - room.y + height;
          this.headset.object3D.position.z = -frame.h.p.z + room.z;
    
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

          var hquat = new THREE.Quaternion(frame.h.r.w, frame.h.r.z, frame.h.r.y, frame.h.r.x).slerp(new THREE.Quaternion(nextFrame.h.r.w, nextFrame.h.r.z, nextFrame.h.r.y, nextFrame.h.r.x), 0.2);
          var hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          this.headset.object3D.rotation.x = hrotation.x
          this.headset.object3D.rotation.y = hrotation.y + Math.PI;
          this.headset.object3D.rotation.z = hrotation.z + Math.PI;;
    },
    leftHandedTock: function(room, frame, nextFrame, height) {
          this.saberEls[0].object3D.position.x = -frame.r.p.x + room.x;
          this.saberEls[0].object3D.position.y = frame.r.p.y - room.y + height;
          this.saberEls[0].object3D.position.z = -frame.r.p.z + room.z;
    
          this.saberEls[1].object3D.position.x = -frame.l.p.x + room.x;
          this.saberEls[1].object3D.position.y = frame.l.p.y - room.y + height;
          this.saberEls[1].object3D.position.z = -frame.l.p.z + room.z;

          this.headset.object3D.position.x = -frame.h.p.x + room.x;
          this.headset.object3D.position.y = frame.h.p.y - room.y + height;
          this.headset.object3D.position.z = -frame.h.p.z + room.z;
    
          var rquat = new THREE.Quaternion(frame.r.r.w, -frame.r.r.z, -frame.r.r.y, frame.r.r.x).slerp(new THREE.Quaternion(nextFrame.r.r.w, -nextFrame.r.r.z, -nextFrame.r.r.y, nextFrame.r.r.x), 0.2);
          var rrotation = new THREE.Euler().setFromQuaternion(rquat);
    
          this.saberEls[0].object3D.rotation.x = rrotation.x;
          this.saberEls[0].object3D.rotation.y = rrotation.y + Math.PI;
          this.saberEls[0].object3D.rotation.z = rrotation.z;
          
          var lquat = new THREE.Quaternion(frame.l.r.w, -frame.l.r.z, -frame.l.r.y, frame.l.r.x).slerp(new THREE.Quaternion(nextFrame.l.r.w, -nextFrame.l.r.z, -nextFrame.l.r.y, nextFrame.l.r.x), 0.2);
          var lrotation = new THREE.Euler().setFromQuaternion(lquat);
    
          this.saberEls[1].object3D.rotation.x = lrotation.x;
          this.saberEls[1].object3D.rotation.y = lrotation.y + Math.PI;
          this.saberEls[1].object3D.rotation.z = lrotation.z;

          var hquat = new THREE.Quaternion(frame.h.r.w, -frame.h.r.z, -frame.h.r.y, frame.h.r.x).slerp(new THREE.Quaternion(nextFrame.h.r.w, -nextFrame.h.r.z, -nextFrame.h.r.y, nextFrame.h.r.x), 0.2);
          var hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          this.headset.object3D.rotation.x = hrotation.x
          this.headset.object3D.rotation.y = hrotation.y + Math.PI;
          this.headset.object3D.rotation.z = hrotation.z + Math.PI;;
    },
});

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);