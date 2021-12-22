AFRAME.registerComponent('replay-player', {
    schema: {
    },

    init: function () {
        this.saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');
        
        this.replayDecoder = this.el.sceneEl.components['replay-loader'];
        this.fpsCounter = this.el.sceneEl.components['fps-counter'];
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
          this.fpsCounter.replayFps = frame.i;
          if (frame.a == 0 && nextFrame.a == 0) return;
    
          let height = clamp((replay.info.height - 1.8) * 0.5, -0.2, 0.6);
          let slerpValue = (currentTime - frame.a) / Math.max(1E-06, nextFrame.a - frame.a);

          if (replay.info.leftHanded) {
            this.leftHandedTock(frame, nextFrame, height, slerpValue);
          } else {
            this.rightHandedTock(frame, nextFrame, height, slerpValue);
          }
        }
      },
    rightHandedTock: function(frame, nextFrame, height, slerpValue) {
          this.saberEls[0].object3D.position.x = frame.l.p.x;
          this.saberEls[0].object3D.position.y = frame.l.p.y - height;
          this.saberEls[0].object3D.position.z = -frame.l.p.z;
    
          this.saberEls[1].object3D.position.x = frame.r.p.x;
          this.saberEls[1].object3D.position.y = frame.r.p.y - height;
          this.saberEls[1].object3D.position.z = -frame.r.p.z;

          var lquat = new THREE.Quaternion(frame.l.r.w, frame.l.r.z, frame.l.r.y, frame.l.r.x).slerp(new THREE.Quaternion(nextFrame.l.r.w, nextFrame.l.r.z, nextFrame.l.r.y, nextFrame.l.r.x), slerpValue);
          var lrotation = new THREE.Euler().setFromQuaternion(lquat);
    
          this.saberEls[0].object3D.rotation.x = lrotation.x;
          this.saberEls[0].object3D.rotation.y = lrotation.y + Math.PI;
          this.saberEls[0].object3D.rotation.z = -lrotation.z;
    
          var rquat = new THREE.Quaternion(frame.r.r.w, frame.r.r.z, frame.r.r.y, frame.r.r.x).slerp(new THREE.Quaternion(nextFrame.r.r.w, nextFrame.r.r.z, nextFrame.r.r.y, nextFrame.r.r.x), slerpValue);
          var rrotation = new THREE.Euler().setFromQuaternion(rquat);
    
          this.saberEls[1].object3D.rotation.x = rrotation.x;
          this.saberEls[1].object3D.rotation.y = rrotation.y + Math.PI;
          this.saberEls[1].object3D.rotation.z = -rrotation.z;

          this.headset.object3D.position = this.headset.object3D.position.lerp(new THREE.Vector3(frame.h.p.x, frame.h.p.y - height, -frame.h.p.z), 0.4);

          var hquat = new THREE.Quaternion(frame.h.r.w, frame.h.r.z, frame.h.r.y, frame.h.r.x).slerp(new THREE.Quaternion(nextFrame.h.r.w, nextFrame.h.r.z, nextFrame.h.r.y, nextFrame.h.r.x), slerpValue);

          if (this.headset.object3D.hquat) {
            hquat = this.headset.object3D.hquat.slerp(hquat, 0.4);
          }
          var hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          this.headset.object3D.rotation.x = hrotation.x
          this.headset.object3D.rotation.y = hrotation.y + Math.PI;
          this.headset.object3D.rotation.z = hrotation.z + Math.PI;
          this.headset.object3D.hquat = hquat;
    },
    leftHandedTock: function(frame, nextFrame, height, slerpValue) {
          this.saberEls[0].object3D.position.x = -frame.r.p.x;
          this.saberEls[0].object3D.position.y = frame.r.p.y - height;
          this.saberEls[0].object3D.position.z = -frame.r.p.z;
    
          this.saberEls[1].object3D.position.x = -frame.l.p.x;
          this.saberEls[1].object3D.position.y = frame.l.p.y - height;
          this.saberEls[1].object3D.position.z = -frame.l.p.z;

          var rquat = new THREE.Quaternion(frame.r.r.w, -frame.r.r.z, -frame.r.r.y, frame.r.r.x).slerp(new THREE.Quaternion(nextFrame.r.r.w, -nextFrame.r.r.z, -nextFrame.r.r.y, nextFrame.r.r.x), slerpValue);
          var rrotation = new THREE.Euler().setFromQuaternion(rquat);
    
          this.saberEls[0].object3D.rotation.x = rrotation.x;
          this.saberEls[0].object3D.rotation.y = rrotation.y + Math.PI;
          this.saberEls[0].object3D.rotation.z = rrotation.z;
          
          var lquat = new THREE.Quaternion(frame.l.r.w, -frame.l.r.z, -frame.l.r.y, frame.l.r.x).slerp(new THREE.Quaternion(nextFrame.l.r.w, -nextFrame.l.r.z, -nextFrame.l.r.y, nextFrame.l.r.x), slerpValue);
          var lrotation = new THREE.Euler().setFromQuaternion(lquat);
    
          this.saberEls[1].object3D.rotation.x = lrotation.x;
          this.saberEls[1].object3D.rotation.y = lrotation.y + Math.PI;
          this.saberEls[1].object3D.rotation.z = lrotation.z;

          this.headset.object3D.position = this.headset.object3D.position.lerp(new THREE.Vector3(-frame.h.p.x, frame.h.p.y - height, -frame.h.p.z), 0.4);

          var hquat = new THREE.Quaternion(frame.h.r.w, -frame.h.r.z, -frame.h.r.y, frame.h.r.x).slerp(new THREE.Quaternion(nextFrame.h.r.w, -nextFrame.h.r.z, -nextFrame.h.r.y, nextFrame.h.r.x), slerpValue);

          if (this.headset.object3D.hquat) {
            hquat = this.headset.object3D.hquat.slerp(hquat, 0.4);
          }
          var hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          this.headset.object3D.rotation.x = hrotation.x
          this.headset.object3D.rotation.y = hrotation.y + Math.PI;
          this.headset.object3D.rotation.z = hrotation.z + Math.PI;
          this.headset.object3D.hquat = hquat;
    },
});

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);