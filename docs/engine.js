/**
 * engine.js — selfgrow's game state engine.
 *
 * One resource ("wood") accumulates at a fixed rate (0.1/sec).
 * The player can also click/tap to gather +1 wood instantly.
 * State persists to localStorage every tick and catches up on page
 * reload for time spent away.
 *
 * @module engine
 */

const STORAGE_KEY = "selfgrow-state";
const WOOD_RATE = 0.1; // wood per second
const TICK_MS = 1000;  // save interval (ms)

/**
 * @typedef {Object} GameState
 * @property {number}  wood       — accumulated resource
 * @property {number}  rate       — wood per second
 * @property {string}  timestamp  — ISO date of last tick/save
 */

let state = {
  wood: 0,
  rate: WOOD_RATE,
  timestamp: new Date().toISOString(),
};

/** Offline wood accumulated on last catch-up (0 if none). */
let offlineWoodGained = 0;

let tickTimer = null;

// ─── Internal helpers ─────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

/**
 * Apply offline catch-up: any elapsed time since last save is
 * converted into accumulated wood at the current rate.
 */
function catchUp() {
  const lastSaved = new Date(state.timestamp).getTime();
  const elapsedSec = (Date.now() - lastSaved) / 1000;
  if (elapsedSec > 0) {
    const gained = state.rate * elapsedSec;
    state.wood += gained;
    offlineWoodGained = gained;
    state.timestamp = now();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable — silently degrade
  }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved.wood === "number" && typeof saved.rate === "number" && saved.timestamp) {
        state.wood = saved.wood;
        state.rate = saved.rate;
        state.timestamp = saved.timestamp;
        return true;
      }
    }
  } catch {
    // corrupted / unavailable — start fresh
  }
  return false;
}

// ─── Tick ─────────────────────────────────────────────────────────

function tick() {
  state.wood += state.rate * (TICK_MS / 1000);
  state.timestamp = now();
  persist();
}

function startTick() {
  if (tickTimer !== null) return;
  tickTimer = setInterval(tick, TICK_MS);
}

function stopTick() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Initialise the engine: load persisted state, catch up on offline
 * time, persist the catch-up, and start the tick loop.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function init() {
  if (tickTimer !== null) return; // already running

  loadPersisted();
  catchUp();
  persist(); // record the catch-up timestamp
  startTick();
}

/**
 * Save the current state immediately and return it.
 */
export function save() {
  state.timestamp = now();
  persist();
  return { ...state };
}

/**
 * Gather +1 wood instantly (active play action).
 *
 * @returns {GameState} current state after gathering
 */
export function gatherWood() {
  state.wood += 1;
  return getState();
}

/**
 * Returns the amount of wood gained during the last offline catch-up.
 * Resets to 0 after being read.
 *
 * @returns {number}
 */
export function consumeOfflineWoodGained() {
  const val = offlineWoodGained;
  offlineWoodGained = 0;
  return val;
}

/**
 * Return a snapshot of the current game state.
 *
 * @returns {GameState}
 */
export function getState() {
  return {
    wood: state.wood,
    rate: state.rate,
    timestamp: state.timestamp,
  };
}

/**
 * Reset the engine to a fresh state (for testing).
 */
export function reset() {
  stopTick();
  state = {
    wood: 0,
    rate: WOOD_RATE,
    timestamp: now(),
  };
  offlineWoodGained = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Teardown ─────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    state.timestamp = now();
    persist();
  });
}