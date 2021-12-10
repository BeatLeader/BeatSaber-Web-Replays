AFRAME.registerComponent('camera-mover', {
    schema: {
    },

    play: function () {

        this.el.sceneEl.camera.parent.position.z = 2.0;
    },
});