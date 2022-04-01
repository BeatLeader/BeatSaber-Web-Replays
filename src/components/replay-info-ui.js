AFRAME.registerComponent('replay-info-ui', {
    schema: {
    },
    init: function () {
        this.replayLoader = this.el.sceneEl.components['replay-loader'];
        
        this.el.addEventListener('replayfetched', evt => {
            this.updateUI();
        });
    },

    updateUI: function () {
        const modifiers = this.replayLoader.replay.info.modifiers;
        let modifiersLabel = document.getElementById('modifiers');
        modifiersLabel.innerHTML = modifiers;

        fetch("https://api.beatleader.xyz/modifiers").then(response => response.json()).then(
            data => {
                modifiersLabel.title = this.describeModifiersAndMultipliers(modifiers.split(","), data);
            });
    },

    userDescriptionForModifier: function (modifier) {
        switch (modifier) {
          case "DA": return "Dissapearing arrows";
          case "FS": return "Faster song";
          case "SS": return "Slower song";
          case "SF": return "Super fast song";
          case "GN": return "Ghost notes";
          case "NA": return "No arrows";
          case "NB": return "No bombs";
          case "NF": return "No fail";
          case "NO": return "No obstacles";
        }
        return "Undefined modifier";
      },
      
      describeModifiersAndMultipliers: function (modifiers, multipliers) {
        if (modifiers && multipliers) {
          let result = "Mods:";
          let total = 0;
          modifiers.forEach(key => {
            const value = multipliers[key];
            total += value;
            result += "\n" + this.userDescriptionForModifier(key) + (value > 0 ? " +" : " ") + Math.round(value * 100) + "%";
          });
          if (modifiers.length > 1) {
            result += "\nTotal:" + (total > 0 ? " +" : " ") + Math.round(total * 100) + "%";
          }
          return result;
        } else {
          return "";
        }
      }
});