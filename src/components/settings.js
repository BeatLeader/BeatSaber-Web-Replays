AFRAME.registerComponent('settings', {
    schema: {
    },
  
    init: function () {
      this.settings = {
        showHeadset: false,
        reducedDebris: false,
        noEffects: false
      }

      try {
        let storedSettings = JSON.parse(localStorage.getItem('settings'));
        Object.keys(storedSettings).forEach(key => {
          this.settings[key] = storedSettings[key];
        })
      } catch (e) {}

      this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);

      Object.keys(this.settings).forEach(key => {
        let toggle = document.getElementById(key);
        toggle.addEventListener('input', (event) => {
          this.settings[key] = event.srcElement.checked;
          localStorage.setItem('settings', JSON.stringify(this.settings))
          this.el.sceneEl.emit('settingsChanged', {settings: this.settings}, false);
        });
        toggle.checked = this.settings[key];
      });
    },
  });