// seasonal-toggle.js – implements the "Show seasonal only" toggle

const toggleBtn = document.getElementById('toggle-seasonal');
let seasonalFilterEnabled = false; // tracks whether filter is active

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

// Initialize: set initial state based on button's current aria-pressed attribute
(function init() {
  const initialPressed = toggleBtn.getAttribute('aria-pressed') === 'true';
  seasonalFilterEnabled = initialPressed;
  updateButtonState();
  // Apply filter immediately to match initial state
  applySeasonalFilter();
})();