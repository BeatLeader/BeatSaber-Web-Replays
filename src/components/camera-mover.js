AFRAME.registerComponent('camera-mover', {
    schema: {
    },

    init: function () {
        this.pov = false
        this.defaultCamera = this.el.sceneEl.camera;
        this.povCamera = this.el.sceneEl.querySelectorAll('.headset')[0];
    },

    play: function () {
        document.querySelectorAll('.a-enter-vr')[0].style.display = 'none';

        document.getElementById('povswitch').addEventListener('click', () => {
            if (this.pov) {
                this.povCamera.setAttribute('camera', 'active', false);
                this.defaultCamera.el.setAttribute('camera', 'active', true);
            } else {
                this.defaultCamera.el.setAttribute('camera', 'active', false);
                this.povCamera.setAttribute('camera', 'active', true);
            }
            this.pov = !this.pov;
            this.el.sceneEl.emit('povchanged', {newPov: this.pov}, false);
        });
          
        document.addEventListener("keydown", (e) => {
            if (e.key == 'c') {
                this.el.sceneEl.camera.parent.position.y -= 0.1;
            } else if (e.key == 'x') {
                this.el.sceneEl.camera.parent.position.y += 0.1;
            }
        })
        this.el.sceneEl.camera.parent.position.z = 2.0;
    },
});