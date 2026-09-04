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
 *  - plant1FlowerPhase (string, one of dormant/budding/opening/bloom/fading)
 *  - plant1FlowerProgress (0–1)
 *  - plant2FlowerPhase (string, only if plant2 has a flower)
 *  - plant2FlowerProgress (0–1)
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
const PLANT1_GROW_DURATION_MS = 18_000;     // 18s (issue #542)
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

    // Capture flower state for each plant
    const plant1 = gs.plant;
    if (plant1 && plant1.flower && typeof plant1.flower.getPhase === 'function') {
      state.plant1FlowerPhase = plant1.flower.getPhase();
      state.plant1FlowerProgress = plant1.flower.getProgress();
    }
    const plant2 = gs.plant2;
    if (plant2 && plant2.flower && typeof plant2.flower.getPhase === 'function') {
      state.plant2FlowerPhase = plant2.flower.getPhase();
      state.plant2FlowerProgress = plant2.flower.getProgress();
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

    // Coerce flower state if present
    if (state.plant1FlowerPhase !== undefined) {
      state.plant1FlowerPhase = String(state.plant1FlowerPhase);
    }
    if (state.plant1FlowerProgress !== undefined) {
      state.plant1FlowerProgress = Math.min(1, Math.max(0, state.plant1FlowerProgress));
    }
    if (state.plant2FlowerPhase !== undefined) {
      state.plant2FlowerPhase = String(state.plant2FlowerPhase);
    }
    if (state.plant2FlowerProgress !== undefined) {
      state.plant2FlowerProgress = Math.min(1, Math.max(0, state.plant2FlowerProgress));
    }

    return state;
  } catch (e) {
    return null;
  }
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

/**
 * Advance a flower's phase through its lifecycle by a given elapsed time.
 *
 * The flower cycles through: dormant → budding → opening → bloom → fading → dormant.
 * Phase durations (in ms) match the averages from garden.js:
 *   dormant: 45s, budding: 15s, opening: 60s, bloom: 105s, fading: 30s
 *
 * @param {string} savedPhase - The phase when the state was saved.
 * @param {number} savedProgress - Progress [0, 1) within the saved phase.
 * @param {number} elapsedMs - Wall-clock time elapsed since the state was saved.
 * @returns {{ phase: string, progress: number }} The advanced phase and progress.
 */
function advanceFlowerPhase(savedPhase, savedProgress, elapsedMs) {
  const PHASE_DURATIONS = {
    dormant: 45000,
    budding: 15000,
    opening: 60000,
    bloom: 105000,
    fading: 30000
  };
  const PHASE_ORDER = ['dormant', 'budding', 'opening', 'bloom', 'fading'];

  let phase = savedPhase || 'dormant';
  let progress = typeof savedProgress === 'number' ? Math.min(1, Math.max(0, savedProgress)) : 0;
  let remaining = elapsedMs;
  let safety = 200; // prevent infinite loop from malformed data

  while (remaining > 0 && safety-- > 0) {
    const duration = PHASE_DURATIONS[phase] || 45000;
    const timeLeft = duration * (1 - Math.min(1, progress));

    if (remaining >= timeLeft) {
      remaining -= timeLeft;
      // Move to the next phase (wrap around)
      const idx = PHASE_ORDER.indexOf(phase);
      phase = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];
      progress = 0;
    } else {
      progress = Math.min(1, progress + remaining / duration);
      remaining = 0;
    }
  }

  return { phase, progress: Math.min(1, progress) };
}

/**
 * Given a saved state and the elapsed wall-clock time since it was saved,
 * compute new progress values for all garden cycles and plant growth.
 *
 * The garden "lives on" during absence: cycles wrap around modulo their
 * durations, plants continue growing toward full maturity, and flower
 * lifecycles advance through their phases.
 *
 * @param {object} savedState - The state returned by loadGardenState().
 * @returns {object} Fast-forwarded progress values:
 *   { seasonProgress, dayNightProgress, weatherProgress,
 *     plant1Maturity, firstPlantGrown, plant2Maturity,
 *     plant1FlowerPhase, plant1FlowerProgress,
 *     plant2FlowerPhase, plant2FlowerProgress }
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

  /* ---- Flower lifecycles advance through phases ---- */
  // Flower only starts cycling after the plant has reached full maturity
  let plant1FlowerPhase = savedState.plant1FlowerPhase;
  let plant1FlowerProgress = savedState.plant1FlowerProgress;
  if (firstPlantGrown && savedState.plant1FlowerPhase !== undefined) {
    const advanced = advanceFlowerPhase(savedState.plant1FlowerPhase, savedState.plant1FlowerProgress, elapsedSec);
    plant1FlowerPhase = advanced.phase;
    plant1FlowerProgress = advanced.progress;
  }

  let plant2FlowerPhase = savedState.plant2FlowerPhase;
  let plant2FlowerProgress = savedState.plant2FlowerProgress;
  if (firstPlantGrown && plant2Maturity !== undefined && plant2Maturity >= 1 && savedState.plant2FlowerPhase !== undefined) {
    const advanced = advanceFlowerPhase(savedState.plant2FlowerPhase, savedState.plant2FlowerProgress, elapsedSec);
    plant2FlowerPhase = advanced.phase;
    plant2FlowerProgress = advanced.progress;
  }

  return {
    seasonProgress,
    dayNightProgress,
    weatherProgress,
    plant1Maturity,
    firstPlantGrown,
    plant2Maturity,
    plant1FlowerPhase,
    plant1FlowerProgress,
    plant2FlowerPhase,
    plant2FlowerProgress
  };
}

/* Expose constants for selftest */
export { STORAGE_KEY, SEASON_CYCLE_DURATION_MS, DAYNIGHT_CYCLE_DURATION_MS, WEATHER_CYCLE_DURATION_MS, PLANT1_GROW_DURATION_MS, PLANT2_GROW_DURATION_MS };