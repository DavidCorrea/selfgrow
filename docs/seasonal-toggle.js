// seasonal-toggle.js – implements the "Show seasonal only" toggle

const toggleBtn = document.getElementById('toggle-seasonal');
let seasonalFilterEnabled = false; // tracks whether filter is active

// Expose control for external modules (e.g., settings)
window.seasonalFilter = {
  get enabled() { return seasonalFilterEnabled; },
  set enabled(val) {
    seasonalFilterEnabled = Boolean(val);
    updateButtonState();
    applySeasonalFilter();
    try { localStorage.setItem('seasonalFilterEnabled', String(seasonalFilterEnabled)); } catch (_) {}
  }
};

// Determine current season
function getCurrentSeason() {
  return window.seasonManager.getSeason() || 'unknown';
}

// Apply filtering based on current season and toggle state
function applySeasonalFilter() {
  const currentSeason = getCurrentSeason();
  const plants = document.querySelectorAll('.plant');
  plants.forEach(plant => {
    const plantSeason = plant.getAttribute('data-season');
    const shouldShow = !seasonalFilterEnabled || plantSeason === currentSeason;
    plant.style.display = shouldShow ? '' : 'none';
  });
}

// Update button state (ARIA pressed attribute) and optionally text
function updateButtonState() {
  toggleBtn.setAttribute('aria-pressed', seasonalFilterEnabled);
}

// Event listener for button click
toggleBtn.addEventListener('click', () => {
  seasonalFilterEnabled = !seasonalFilterEnabled;
  updateButtonState();
  applySeasonalFilter();
});

// Observe changes to <html data-season> attribute and re-filter when it changes
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.attributeName === 'data-season') {
      // Season changed; if filter is enabled, reapply
      if (seasonalFilterEnabled) {
        applySeasonalFilter();
      }
      break;
    }
  }
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-season'] });

// Initialize: restore saved preference or default to button's aria-pressed attribute
(function init() {
  // Try to load from localStorage
  try {
    const stored = localStorage.getItem('seasonalFilterEnabled');
    if (stored !== null) {
      seasonalFilterEnabled = stored === 'true';
    } else {
      const initialPressed = toggleBtn.getAttribute('aria-pressed') === 'true';
      seasonalFilterEnabled = initialPressed;
    }
  } catch (_) {
    const initialPressed = toggleBtn.getAttribute('aria-pressed') === 'true';
    seasonalFilterEnabled = initialPressed;
  }
  updateButtonState();
  applySeasonalFilter();
})();