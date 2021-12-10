AFRAME.registerComponent('replay-player', {
    schema: {
    },

    init: function () {
        this.saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');
        this.replayDecoder = this.el.sceneEl.components['replay-loader'];
        this.song = this.el.sceneEl.components.song;  
    },

    tock: function (time, delta) {
        if (this.song.isPlaying && this.replayDecoder.replay) {
          let currentTime = this.song.getCurrentTime() - 0.06;
          let frames = this.replayDecoder.replay.frames;
          var frameIndex = 0;
          for (var i = 1; i < frames.length; i++) {
            if (frames[i].a >= currentTime) {
              frameIndex = i - 1;
              break;
            }
          }
    
          let frame = frames[frameIndex];
          let nextFrame = frames[frameIndex + 1];
    
          let height = this.replayDecoder.replay.info.z08dg8eppyghu;
          
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
    
          // console.log(frame.a + " - " + currentTime);
        }
      }
});