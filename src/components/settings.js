AFRAME.registerComponent('settings', {
    schema: {
    },
  
    init: function () {

      document.getElementById('headsetToggle').addEventListener('input', (event) => {
        this.el.sceneEl.emit('settingsChanged', {showHeadset: event.srcElement.checked}, false);
      });
    },
  });