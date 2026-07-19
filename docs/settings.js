// settings.js – handles UI for seasonal mode toggle

// Ensure seasonManager is loaded before this script runs (script order in index.html).

function updateToggle() {
  const checkbox = document.getElementById('seasonToggle');
  if (!checkbox) return;
  checkbox.checked = !!(window.seasonManager && window.seasonManager.isEnabled);
}

function applySeasonDisabled() {
  // Remove any season-specific classes from existing plants
  document.querySelectorAll('.plant-spring, .plant-summer, .plant-fall, .plant-winter').forEach(el => {
    el.classList.remove('plant-spring', 'plant-summer', 'plant-fall', 'plant-winter');
  });
  // Remove data-season attribute
  document.documentElement.removeAttribute('data-season');
}

function applySeasonEnabled() {
  // No immediate action; seasonManager will update data attribute and future plants will get classes.
}

window.addEventListener('DOMContentLoaded', () => {
  // Helper to show a brief toast notification
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // Save current settings to localStorage and show confirmation
  function saveSettings() {
    try {
      const rmToggle = document.getElementById('reducedMotionToggle');
      const ambientToggle = document.getElementById('ambientSoundToggle');
      if (rmToggle) {
        localStorage.setItem('reducedMotion', String(rmToggle.checked));
        window.reducedMotionEnabled = rmToggle.checked;
        if (rmToggle.checked) {
          document.documentElement.classList.add('reduced-motion');
        } else {
          document.documentElement.classList.remove('reduced-motion');
        }
      }
      if (ambientToggle) {
        localStorage.setItem('ambientSound', String(ambientToggle.checked));
      }
      if (window.seasonalFilter) {
        const enabled = Boolean(window.seasonalFilter.enabled);
        localStorage.setItem('seasonalFilterEnabled', String(enabled));
      }
    } catch (e) {
      console.error('Failed to save settings', e);
    }
    showToast('Settings saved');
  }

  const saveBtn = document.getElementById('saveSettingsBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveSettings);
  }
  // Initialise seasonal toggle UI
  updateToggle();
  const seasonCheckbox = document.getElementById('seasonToggle');
  if (seasonCheckbox) {
    seasonCheckbox.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      if (window.seasonManager) {
        window.seasonManager.setEnabled(enabled);
      }
      if (enabled) {
        applySeasonEnabled();
      } else {
        applySeasonDisabled();
      }
    });
  }

  // Initialise Journal button accessibility and click handling
  const journalBtn = document.getElementById('journalToggle');
  const journalPanel = document.getElementById('journalPanel');
  if (journalBtn && journalPanel) {
    // ARIA attributes
    journalBtn.setAttribute('role', 'button');
    journalBtn.setAttribute('aria-controls', 'journalPanel');
    journalBtn.setAttribute('aria-expanded', 'false');
    // Click toggles panel visibility
    journalBtn.addEventListener('click', () => {
      const isOpen = journalPanel.classList.toggle('open');
      journalBtn.setAttribute('aria-expanded', String(isOpen));
      // Move focus to panel when opened for better accessibility
      if (isOpen) {
        journalPanel.setAttribute('tabindex', '-1');
        journalPanel.focus();
      }
    });
    // Keyboard activation (Enter / Space)
    journalBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        journalBtn.click();
      }
    });
  }

  // Initialise Ambient Sound toggle accessibility (checkbox already has native ARIA)
  const ambientToggle = document.getElementById('ambientSoundToggle');
  if (ambientToggle) {
    // Ensure its state is reflected via aria-checked for screen readers
    const syncAria = () => ambientToggle.setAttribute('aria-checked', ambientToggle.checked);
    ambientToggle.addEventListener('change', syncAria);
    // Initialise attribute
    syncAria();
  }

  // Settings panel toggle
  const settingsToggleBtn = document.getElementById('settingsToggleBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsToggleBtn && settingsPanel) {
    const togglePanel = () => {
      const isOpen = settingsPanel.classList.toggle('open');
      settingsToggleBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        // Move focus to first focusable element inside panel
        const firstFocusable = settingsPanel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (firstFocusable) firstFocusable.focus();
      }
    };
    settingsToggleBtn.addEventListener('click', togglePanel);
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (settingsPanel.classList.contains('open') && e.key === 'Escape') {
        e.preventDefault();
        settingsPanel.classList.remove('open');
        settingsToggleBtn.setAttribute('aria-expanded', 'false');
        settingsToggleBtn.focus();
      }
    });
  }
});