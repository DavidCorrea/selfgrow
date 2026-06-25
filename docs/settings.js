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
  updateToggle();
  const checkbox = document.getElementById('seasonToggle');
  if (!checkbox) return;
  checkbox.addEventListener('change', (e) => {
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
});
