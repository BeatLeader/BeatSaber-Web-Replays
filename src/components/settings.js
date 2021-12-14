AFRAME.registerComponent('settings', {
    schema: {
    },
  
    init: function () {

      document.getElementById('headsetToggle').addEventListener('input', (el) => {
        el.checked = !el.checked;
        this.el.sceneEl.emit('settingsChanged', {showHeadset: el.checked}, false);
      });
    },
  });