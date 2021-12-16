AFRAME.registerComponent('camera-mover', {
    schema: {
    },

    init: function () {
        this.pov = false
        this.defaultCameraRig = this.el.sceneEl.querySelectorAll('.floatingCamera')[0];
        this.povCameraRig = this.el.sceneEl.querySelectorAll('.headset')[0];

        this.defaultCamera = this.el.sceneEl.querySelectorAll('.mainCamera')[0];
        this.povCamera = this.el.sceneEl.querySelectorAll('.povCamera')[0];
    },

    play: function () {
        document.querySelectorAll('.a-enter-vr')[0].style.display = 'none';

        document.getElementById('povswitch').addEventListener('click', () => {
            if (this.pov) {
                this.povCamera.setAttribute('camera', 'active', false);
                this.defaultCamera.setAttribute('camera', 'active', true);
            } else {
                this.defaultCamera.setAttribute('camera', 'active', false);
                this.povCamera.setAttribute('camera', 'active', true);
            }
            this.pov = !this.pov;
            this.el.sceneEl.emit('povchanged', {newPov: this.pov}, false);
        });
          
        document.addEventListener("keydown", (e) => {
            if (e.key == 'c') {
                this.defaultCameraRig.object3D.position.y -= 0.1;
            } else if (e.key == 'x') {
                this.defaultCameraRig.object3D.position.y += 0.1;
            }
        })
        this.defaultCameraRig.object3D.position.z = 2.0;
    },
});