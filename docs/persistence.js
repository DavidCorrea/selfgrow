/**
 * persistence.js — selfgrow garden state localStorage persistence
 *
 * Saves and restores the garden's growth state across visits so the
 * garden lives on even when nobody is watching.
 *
 * State saved:
 *  - seasonProgress (0–1)
 *  - dayNightProgress (0–1)
 *  - weatherProgress (0–1)
 *  - plant1Maturity (0–1)
 *  - plant2Maturity (0–1, only if spawned)
 *  - firstPlantGrown (boolean)
 *  - timestamp (wall-clock ms of save)
 *
 * On restore, elapsed real time is computed and all cycles
 * fast-forward to where they would be if the garden had kept growing.
 */

const STORAGE_KEY = 'selfgrow_garden_state';

/* Cycle durations (ms) — must match values in garden.js, daynight.js, weather.js */
const SEASON_CYCLE_DURATION_MS = 720_000;   // 12 min
const DAYNIGHT_CYCLE_DURATION_MS = 180_000; // 3 min
const WEATHER_CYCLE_DURATION_MS = 300_000;  // 5 min
const PLANT1_GROW_DURATION_MS = 30_000;     // 30s
const PLANT2_GROW_DURATION_MS = 25_000;     // 25s

/**
 * Save the current garden state to localStorage.
 * Silently fails if localStorage is unavailable (private browsing, full, etc.).
 */
export function saveGardenState() {
  const gs = window.__gardenState;
  if (!gs) return;

  try {
    const state = {
      seasonProgress: typeof gs.seasonProgress === 'number' ? gs.seasonProgress : 0,
      dayNightProgress: typeof gs.dayNightProgress === 'number' ? gs.dayNightProgress : 0,
      weatherProgress: typeof gs.weatherProgress === 'number' ? gs.weatherProgress : 0,
      plant1Maturity: typeof gs.plant1Maturity === 'number' ? gs.plant1Maturity : 0,
      firstPlantGrown: !!gs.firstPlantGrown,
      timestamp: Date.now()
    };

    // Include plant2 maturity if it exists
    if (gs.plant2Maturity !== undefined && typeof gs.plant2Maturity === 'number') {
      state.plant2Maturity = gs.plant2Maturity;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Silently fail — localStorage may be full or unavailable
  }
}

/**
 * Load saved garden state from localStorage.
 *
 * @returns {object|null} The saved state object, or null if missing/corrupt.
 */
export function loadGardenState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const state = JSON.parse(raw);

    // Validate shape: must have timestamp and at least some progress fields
    if (!state || typeof state.timestamp !== 'number') {
      return null;
    }

    // Coerce and sanitise
    state.seasonProgress = typeof state.seasonProgress === 'number' ? Math.min(1, Math.max(0, state.seasonProgress)) : 0;
    state.dayNightProgress = typeof state.dayNightProgress === 'number' ? Math.min(1, Math.max(0, state.dayNightProgress)) : 0;
    state.weatherProgress = typeof state.weatherProgress === 'number' ? Math.min(1, Math.max(0, state.weatherProgress)) : 0;
    state.plant1Maturity = typeof state.plant1Maturity === 'number' ? Math.min(1, Math.max(0, state.plant1Maturity)) : 0;
    state.firstPlantGrown = !!state.firstPlantGrown;

    if (state.plant2Maturity !== undefined) {
      state.plant2Maturity = Math.min(1, Math.max(0, state.plant2Maturity));
    }

    return state;
  } catch (e) {
    return null;
  }
}

/**
 * Given a saved state and the elapsed wall-clock time since it was saved,
 * compute new progress values for all garden cycles and plant growth.
 *
 * The garden "lives on" during absence: cycles wrap around modulo their
 * durations, and plants continue growing toward full maturity.
 *
 * @param {object} savedState - The state returned by loadGardenState().
 * @returns {object} Fast-forwarded progress values:
 *   { seasonProgress, dayNightProgress, weatherProgress,
 *     plant1Maturity, firstPlantGrown, plant2Maturity }
 */
export function fastForwardState(savedState) {
  const elapsed = Date.now() - savedState.timestamp;
  const elapsedSec = elapsed; // ms

  /* ---- Cycles advance modulo duration ---- */
  const seasonProgress = (savedState.seasonProgress + elapsedSec / SEASON_CYCLE_DURATION_MS) % 1.0;
  const dayNightProgress = (savedState.dayNightProgress + elapsedSec / DAYNIGHT_CYCLE_DURATION_MS) % 1.0;
  const weatherProgress = (savedState.weatherProgress + elapsedSec / WEATHER_CYCLE_DURATION_MS) % 1.0;

  /* ---- Plant 1: continues growing toward full maturity ---- */
  let plant1Maturity = Math.min(1, savedState.plant1Maturity + elapsedSec / PLANT1_GROW_DURATION_MS);
  const firstPlantGrown = savedState.firstPlantGrown || plant1Maturity >= 1;

  /* ---- Plant 2: only starts growing after plant 1 is fully grown ---- */
  let plant2Maturity;
  if (firstPlantGrown) {
    // Time since plant 1 reached full maturity
    const timeSincePlant1Mature = Math.max(0, elapsedSec - PLANT1_GROW_DURATION_MS * (1 - savedState.plant1Maturity));

    if (savedState.plant2Maturity !== undefined) {
      // Plant 2 already existed — advance it further
      plant2Maturity = Math.min(1, savedState.plant2Maturity + timeSincePlant1Mature / PLANT2_GROW_DURATION_MS);
    } else {
      // Plant 2 was spawned during the elapsed time
      plant2Maturity = Math.min(1, timeSincePlant1Mature / PLANT2_GROW_DURATION_MS);
    }
  }

  return {
    seasonProgress,
    dayNightProgress,
    weatherProgress,
    plant1Maturity,
    firstPlantGrown,
    plant2Maturity
  };
}

/**
 * Clear saved state (useful for tests or resetting).
 */
export function clearGardenState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Silently fail
  }
}

/* Expose constants for selftest */
export { STORAGE_KEY, SEASON_CYCLE_DURATION_MS, DAYNIGHT_CYCLE_DURATION_MS, WEATHER_CYCLE_DURATION_MS, PLANT1_GROW_DURATION_MS, PLANT2_GROW_DURATION_MS };