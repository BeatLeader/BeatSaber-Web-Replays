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

      this.povCameraRig = this.el.sceneEl.querySelectorAll('.headCamera')[0];
    },

    tock: function (time, delta) {
      let replay = this.replayDecoder.replay;
        if (this.song.isPlaying && replay) {
          let currentTime = this.song.getCurrentTime();// - replay.info.midDeviation;
          let frames = this.replayDecoder.replay.frames;
          var frameIndex = 0;
          while (frameIndex < frames.length - 2 && frames[frameIndex + 1].a < currentTime) {
            frameIndex++;
          }
          let frame = frames[frameIndex];
          let nextFrame = frames[frameIndex + 1];
          this.fpsCounter.replayFps = frame.i;
          if (frame.a == 0 && nextFrame.a == 0) return;

          var replayHeight;
          if (replay.dynamicHeight.length) {
            var heightFrameIndex = 0;
            while (heightFrameIndex < replay.dynamicHeight.length - 2 && replay.dynamicHeight[heightFrameIndex + 1].a < currentTime) {
              heightFrameIndex++;
            }
            replayHeight = replay.dynamicHeight[heightFrameIndex].h;
          } else {
            replayHeight = replay.info.height;
          }
    
          let height = clamp((replayHeight - 1.8) * 0.5, -0.2, 0.6);
          let slerpValue = (currentTime - frame.a) / Math.max(1E-06, nextFrame.a - frame.a);

          if (replay.info.leftHanded) {
            this.leftHandedTock(frame, nextFrame, height, slerpValue, delta / 1000);
          } else {
            this.rightHandedTock(frame, nextFrame, height, slerpValue, delta / 1000);
          }
        }
      },
    rightHandedTock: function(frame, nextFrame, height, slerpValue, delta) {
          const leftSaber = this.saberEls[0].object3D;
          const rightSaber = this.saberEls[1].object3D;
          const headset = this.headset.object3D;
          const povCamera = this.povCameraRig.object3D;

          const lposition = new THREE.Vector3(frame.l.p.x, frame.l.p.y, frame.l.p.z).lerp(new THREE.Vector3(nextFrame.l.p.x, nextFrame.l.p.y, nextFrame.l.p.z), slerpValue);
          leftSaber.position.x = lposition.x;
          leftSaber.position.y = lposition.y - height;
          leftSaber.position.z = -lposition.z;

          const rposition = new THREE.Vector3(frame.r.p.x, frame.r.p.y, frame.r.p.z).lerp(new THREE.Vector3(nextFrame.r.p.x, nextFrame.r.p.y, nextFrame.r.p.z), slerpValue);
          rightSaber.position.x = rposition.x;
          rightSaber.position.y = rposition.y - height;
          rightSaber.position.z = -rposition.z;

          const lquat = new THREE.Quaternion(frame.l.r.w, frame.l.r.z, frame.l.r.y, frame.l.r.x).slerp(new THREE.Quaternion(nextFrame.l.r.w, nextFrame.l.r.z, nextFrame.l.r.y, nextFrame.l.r.x), slerpValue);
          const lrotation = new THREE.Euler().setFromQuaternion(lquat);
    
          leftSaber.rotation.x = lrotation.x;
          leftSaber.rotation.y = lrotation.y + Math.PI;
          leftSaber.rotation.z = -lrotation.z;
    
          const rquat = new THREE.Quaternion(frame.r.r.w, frame.r.r.z, frame.r.r.y, frame.r.r.x).slerp(new THREE.Quaternion(nextFrame.r.r.w, nextFrame.r.r.z, nextFrame.r.r.y, nextFrame.r.r.x), slerpValue);
          const rrotation = new THREE.Euler().setFromQuaternion(rquat);
    
          rightSaber.rotation.x = rrotation.x;
          rightSaber.rotation.y = rrotation.y + Math.PI;
          rightSaber.rotation.z = -rrotation.z;

          const hpostion = new THREE.Vector3(frame.h.p.x, frame.h.p.y, frame.h.p.z).lerp(new THREE.Vector3(nextFrame.h.p.x, nextFrame.h.p.y, nextFrame.h.p.z), slerpValue);

          headset.position.x = hpostion.x;
          headset.position.y = hpostion.y - height;
          headset.position.z = -hpostion.z;

          var hquat = new THREE.Quaternion(frame.h.r.w, frame.h.r.z, frame.h.r.y, frame.h.r.x).slerp(new THREE.Quaternion(nextFrame.h.r.w, nextFrame.h.r.z, nextFrame.h.r.y, nextFrame.h.r.x), slerpValue);
          var hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          headset.rotation.x = hrotation.x
          headset.rotation.y = hrotation.y + Math.PI;
          headset.rotation.z = -hrotation.z + Math.PI;

          povCamera.position = povCamera.position.lerp(headset.position, 5 * delta);

          if (povCamera.hquat) {
            hquat = povCamera.hquat.slerp(hquat, 5 * delta);
          }
          hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          povCamera.rotation.x = hrotation.x
          povCamera.rotation.y = hrotation.y + Math.PI;
          povCamera.rotation.z = -hrotation.z + Math.PI;
          povCamera.hquat = hquat;
    },
    leftHandedTock: function(frame, nextFrame, height, slerpValue, delta) {
          const leftSaber = this.saberEls[0].object3D;
          const rightSaber = this.saberEls[1].object3D;
          const headset = this.headset.object3D;
          const povCamera = this.povCameraRig.object3D;

          const lposition = new THREE.Vector3(frame.l.p.x, frame.l.p.y, frame.l.p.z).lerp(new THREE.Vector3(nextFrame.l.p.x, nextFrame.l.p.y, nextFrame.l.p.z), slerpValue);
          rightSaber.position.x = -lposition.x;
          rightSaber.position.y = lposition.y - height;
          rightSaber.position.z = -lposition.z;

          const rposition = new THREE.Vector3(frame.r.p.x, frame.r.p.y, frame.r.p.z).lerp(new THREE.Vector3(nextFrame.r.p.x, nextFrame.r.p.y, nextFrame.r.p.z), slerpValue);
          leftSaber.position.x = -rposition.x;
          leftSaber.position.y = rposition.y - height;
          leftSaber.position.z = -rposition.z;

          const lquat = new THREE.Quaternion(frame.l.r.w, -frame.l.r.z, -frame.l.r.y, frame.l.r.x).slerp(new THREE.Quaternion(nextFrame.l.r.w, -nextFrame.l.r.z, -nextFrame.l.r.y, nextFrame.l.r.x), slerpValue);
          const lrotation = new THREE.Euler().setFromQuaternion(lquat);
    
          rightSaber.rotation.x = lrotation.x;
          rightSaber.rotation.y = lrotation.y + Math.PI;
          rightSaber.rotation.z = lrotation.z;
    
          const rquat = new THREE.Quaternion(frame.r.r.w, -frame.r.r.z, -frame.r.r.y, frame.r.r.x).slerp(new THREE.Quaternion(nextFrame.r.r.w, -nextFrame.r.r.z, -nextFrame.r.r.y, nextFrame.r.r.x), slerpValue);
          const rrotation = new THREE.Euler().setFromQuaternion(rquat);
    
          leftSaber.rotation.x = rrotation.x;
          leftSaber.rotation.y = rrotation.y + Math.PI;
          leftSaber.rotation.z = -rrotation.z;

          const hpostion = new THREE.Vector3(frame.h.p.x, frame.h.p.y, frame.h.p.z).lerp(new THREE.Vector3(nextFrame.h.p.x, nextFrame.h.p.y, nextFrame.h.p.z), slerpValue);

          headset.position.x = -hpostion.x;
          headset.position.y = hpostion.y - height;
          headset.position.z = -hpostion.z;

          var hquat = new THREE.Quaternion(frame.h.r.w, -frame.h.r.z, -frame.h.r.y, frame.h.r.x).slerp(new THREE.Quaternion(nextFrame.h.r.w, -nextFrame.h.r.z, -nextFrame.h.r.y, nextFrame.h.r.x), slerpValue);
          var hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          headset.rotation.x = -hrotation.x
          headset.rotation.y = hrotation.y + Math.PI;
          headset.rotation.z = -hrotation.z + Math.PI;

          povCamera.position = povCamera.position.lerp(headset.position, 5 * delta);

          if (povCamera.hquat) {
            hquat = povCamera.hquat.slerp(hquat, 5 * delta);
          }
          hrotation = new THREE.Euler().setFromQuaternion(hquat);
    
          povCamera.rotation.x = -hrotation.x
          povCamera.rotation.y = hrotation.y + Math.PI;
          povCamera.rotation.z = -hrotation.z + Math.PI;
          povCamera.hquat = hquat;
    },
});

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);