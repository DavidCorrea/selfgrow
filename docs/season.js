// season.js – manages four‑season cycle and provides API for other modules
// A full year spans 30 real days (30 * 24 * 60 * 60 * 1000 ms). Each season is 7.5 days.
// The manager updates a data attribute on the document element for CSS styling
// and exposes getSeason() / getProgress() methods. The current mode (enabled/disabled)
// is persisted in localStorage under "seasonalMode". The start timestamp is stored
// under "seasonStart" to allow continuity across visits.

const SEASON_NAMES = ['spring', 'summer', 'fall', 'winter'];
const FULL_YEAR_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SEASON_MS = FULL_YEAR_MS / SEASON_NAMES.length;

function loadStart() {
  const stored = localStorage.getItem('seasonStart');
  if (stored) {
    const ts = parseInt(stored, 10);
    if (!isNaN(ts)) return ts;
  }
  const now = Date.now();
  localStorage.setItem('seasonStart', now.toString());
  return now;
}

function loadEnabled() {
  const stored = localStorage.getItem('seasonalMode');
  return stored === null ? true : stored === 'true';
}

function setEnabled(val) {
  window.seasonManager.isEnabled = val;
  localStorage.setItem('seasonalMode', val.toString());
  // When disabled, clear data attribute
  if (!val) {
    document.documentElement.removeAttribute('data-season');
  } else {
    // Force update immediately
    updateSeason();
  }
}

function getSeason() {
  if (!window.seasonManager.isEnabled) return null;
  const now = Date.now();
  const elapsed = (now - window.seasonManager.start) % FULL_YEAR_MS;
  const index = Math.floor(elapsed / SEASON_MS);
  return SEASON_NAMES[index];
}

function getProgress() {
  if (!window.seasonManager.isEnabled) return 0;
  const now = Date.now();
  const elapsed = (now - window.seasonManager.start) % FULL_YEAR_MS;
  return (elapsed % SEASON_MS) / SEASON_MS; // 0‑1 within current season
}

function updateSeason() {
  if (!window.seasonManager.isEnabled) return;
  const season = getSeason();
  if (season) {
    document.documentElement.setAttribute('data-season', season);
    // Also expose as CSS custom property for possible use in animations
    document.documentElement.style.setProperty('--season-progress', getProgress());
  }
  requestAnimationFrame(updateSeason);
}

// Initialize manager object on window for other modules to access
window.seasonManager = {
  isEnabled: loadEnabled(),
  start: loadStart(),
  getSeason,
  getProgress,
  setEnabled,
};

if (window.seasonManager.isEnabled) {
  // Start the animation loop that keeps the data attribute up‑to‑date
  requestAnimationFrame(updateSeason);
}
