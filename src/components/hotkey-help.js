/**
 * Hotkey help guide component
 * Shows a large help overlay with all available hotkeys when F2 is pressed
 */
AFRAME.registerComponent('hotkey-help', {
  init: function () {
    this.isVisible = false;
    
    // Create help overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'hotkeyHelpOverlay';
    this.overlay.className = 'hotkey-help-overlay hidden';
    
    // Create content container
    const content = document.createElement('div');
    content.className = 'hotkey-help-content';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'hotkey-help-header';
    header.innerHTML = `
      <h1><i class="fas fa-keyboard"></i> Keyboard Shortcuts</h1>
      <button class="hotkey-help-close" title="Close (F2 or ESC)">
        <i class="fas fa-times"></i>
      </button>
    `;
    
    // Create sections
    const sections = [
      {
        title: 'Playback Controls',
        icon: 'fas fa-play',
        hotkeys: [
          { keys: ['Space', 'K'], action: 'Play / Pause' },
          { keys: ['←', 'J'], action: 'Skip backward (hold Shift for fast)' },
          { keys: ['→', 'L'], action: 'Skip forward (hold Shift for fast)' },
          { keys: [','], action: 'Previous beat (hold Shift for 0.1 beat)' },
          { keys: ['.'], action: 'Next beat (hold Shift for 0.1 beat)' }
        ]
      },
      {
        title: 'Speed & Settings',
        icon: 'fas fa-gauge-simple',
        hotkeys: [
          { keys: ['+', '='], action: 'Increase playback speed' },
          { keys: ['-'], action: 'Decrease playback speed' },
          { keys: ['U'], action: 'Toggle auto speed controls' },
          { keys: ['O'], action: 'Toggle loop replays' }
        ]
      },
      {
        title: 'Audio Controls',
        icon: 'fas fa-volume-up',
        hotkeys: [
          { keys: ['↑'], action: 'Increase volume (hold Shift for fine adjust)' },
          { keys: ['↓'], action: 'Decrease volume (hold Shift for fine adjust)' },
          { keys: ['M'], action: 'Mute / Unmute' }
        ]
      },
      {
        title: 'Display Controls',
        icon: 'fas fa-display',
        hotkeys: [
          { keys: ['F'], action: 'Toggle fullscreen' },
          { keys: ['H'], action: 'Show / Hide controls' },
          { keys: ['F2'], action: 'Show this help guide' }
        ]
      }
    ];
    
    // Create sections HTML
    const sectionsContainer = document.createElement('div');
    sectionsContainer.className = 'hotkey-help-sections';
    
    sections.forEach(section => {
      const sectionDiv = document.createElement('div');
      sectionDiv.className = 'hotkey-help-section';
      
      const sectionTitle = document.createElement('h2');
      sectionTitle.innerHTML = `<i class="${section.icon}"></i> ${section.title}`;
      sectionDiv.appendChild(sectionTitle);
      
      const table = document.createElement('table');
      table.className = 'hotkey-help-table';
      
      section.hotkeys.forEach(hotkey => {
        const row = document.createElement('tr');
        
        const keysCell = document.createElement('td');
        keysCell.className = 'hotkey-keys';
        keysCell.innerHTML = hotkey.keys.map(key => `<kbd>${key}</kbd>`).join(' / ');
        
        const actionCell = document.createElement('td');
        actionCell.className = 'hotkey-action';
        actionCell.textContent = hotkey.action;
        
        row.appendChild(keysCell);
        row.appendChild(actionCell);
        table.appendChild(row);
      });
      
      sectionDiv.appendChild(table);
      sectionsContainer.appendChild(sectionDiv);
    });
    
    // Add footer
    const footer = document.createElement('div');
    footer.className = 'hotkey-help-footer';
    footer.innerHTML = `
      <p><i class="fas fa-info-circle"></i> Press <kbd>F2</kbd> or <kbd>ESC</kbd> to close</p>
    `;
    
    // Assemble content
    content.appendChild(header);
    content.appendChild(sectionsContainer);
    content.appendChild(footer);
    this.overlay.appendChild(content);
    
    document.body.appendChild(this.overlay);
    
    // Event listeners
    this.keydownHandler = this.handleKeydown.bind(this);
    document.addEventListener('keydown', this.keydownHandler);
    
    // Close button
    const closeBtn = header.querySelector('.hotkey-help-close');
    closeBtn.addEventListener('click', () => this.hide());
    
    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
  },
  
  handleKeydown: function (e) {
    // F2 key
    if (e.keyCode === 113) {
      e.preventDefault();
      this.toggle();
    }
    
    // ESC key to close
    if (e.keyCode === 27 && this.isVisible) {
      e.preventDefault();
      this.hide();
    }
  },
  
  toggle: function () {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  },
  
  show: function () {
    this.isVisible = true;
    this.overlay.classList.remove('hidden');
    this.overlay.classList.add('visible');
    
    // Emit notification
    this.el.sceneEl.emit('showHotkeyNotification', {
      text: 'Help Guide',
      icon: 'fas fa-keyboard'
    });
  },
  
  hide: function () {
    this.isVisible = false;
    this.overlay.classList.remove('visible');
    this.overlay.classList.add('hidden');
  },
  
  remove: function () {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    document.removeEventListener('keydown', this.keydownHandler);
  }
});

