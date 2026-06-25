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
});
