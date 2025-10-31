/**
 * Hotkey notification component
 * Shows a temporary popup when hotkeys are pressed
 */
AFRAME.registerComponent('hotkey-notification', {
  init: function () {
    this.notificationQueue = [];
    this.isShowing = false;
    this.timeout = null;
    
    // Create notification container
    this.container = document.createElement('div');
    this.container.id = 'hotkeyNotification';
    this.container.className = 'hotkey-notification hidden';
    
    // Create icon element
    this.icon = document.createElement('i');
    this.icon.className = 'hotkey-icon';
    
    // Create text element
    this.text = document.createElement('div');
    this.text.className = 'hotkey-text';
    
    // Create info note element
    this.note = document.createElement('div');
    this.note.className = 'hotkey-note';
    this.note.innerHTML = '<kbd>F2</kbd> for info';
    
    this.container.appendChild(this.icon);
    this.container.appendChild(this.text);
    this.container.appendChild(this.note);
    document.body.appendChild(this.container);
    
    // Listen for notification events
    this.el.sceneEl.addEventListener('showHotkeyNotification', (evt) => {
      this.showNotification(evt.detail.text, evt.detail.icon);
    });
  },
  
  showNotification: function (text, iconClass) {
    // Clear the queue - we only want to show the latest notification
    this.notificationQueue = [];
    
    // If currently showing, hide immediately and show new one quickly
    if (this.isShowing) {
      // Clear existing timeout
      if (this.timeout) {
        clearTimeout(this.timeout);
      }
      
      // Immediately hide current notification
      this.container.classList.remove('visible');
      this.container.classList.add('hidden');
      
      // Show new notification after a short delay
      setTimeout(() => {
        this.displayNotification(text, iconClass);
      }, 150);
    } else {
      // Show immediately if nothing is showing
      this.displayNotification(text, iconClass);
    }
  },
  
  displayNotification: function (text, iconClass) {
    this.isShowing = true;
    
    // Update content
    this.icon.className = 'hotkey-icon ' + iconClass;
    this.text.textContent = text;
    
    // Clear any existing timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    
    // Show notification
    this.container.classList.remove('hidden');
    this.container.classList.add('visible');
    
    // Hide after delay
    this.timeout = setTimeout(() => {
      this.container.classList.remove('visible');
      this.container.classList.add('hidden');
      this.isShowing = false;
    }, 1500);
  },
  
  processQueue: function () {
    // No longer needed but kept for compatibility
    if (this.notificationQueue.length === 0) {
      this.isShowing = false;
      return;
    }
    
    this.isShowing = true;
    const notification = this.notificationQueue.shift();
    
    // Update content
    this.icon.className = 'hotkey-icon ' + notification.iconClass;
    this.text.textContent = notification.text;
    
    // Clear any existing timeout
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    
    // Show notification
    this.container.classList.remove('hidden');
    this.container.classList.add('visible');
    
    // Hide after delay
    this.timeout = setTimeout(() => {
      this.container.classList.remove('visible');
      this.container.classList.add('hidden');
      
      // Process next notification after animation
      setTimeout(() => {
        this.processQueue();
      }, 300);
    }, 1500);
  },
  
  remove: function () {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
  }
});

