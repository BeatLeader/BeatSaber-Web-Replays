AFRAME.registerComponent('camera-mover', {
    schema: {
    },

    play: function () {
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