AFRAME.registerComponent('camera-mover', {
    schema: {
    },

    init: function () {
        this.pov = false
        this.defaultCameraRig = this.el.sceneEl.querySelectorAll('.floatingCamera')[0];
        this.povCameraRig = this.el.sceneEl.querySelectorAll('.headCamera')[0];

        this.defaultCamera = this.el.sceneEl.querySelectorAll('.mainCamera')[0];
        this.povCamera = this.el.sceneEl.querySelectorAll('.povCamera')[0];
    },

    play: function () {
        document.querySelectorAll('.a-enter-vr')[0].style.display = 'none';

        document.getElementById('povswitch').addEventListener('click', (e) => {
            e.preventDefault();
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
        this.defaultCameraRig.object3D.position.z = 2.0;
    },
});