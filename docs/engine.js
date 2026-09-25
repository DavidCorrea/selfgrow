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
const UPGRADE_COST = 5; // wood per upgrade
const RATE_INCREASE_PER_UPGRADE = 0.05; // additional wood per second per upgrade
const STONE_UPGRADE_COST = 5; // stone per wall upgrade
const TICK_MS = 1000;  // save interval (ms)

// Exported for external use (tools, UI)
export { UPGRADE_COST, RATE_INCREASE_PER_UPGRADE, STONE_UPGRADE_COST };

/**
 * @typedef {Object} GameState
 * @property {number}  wood          — accumulated resource
 * @property {number}  rate          — wood per second
 * @property {number}  upgradeLevel  — number of upgrades crafted
 * @property {string}  timestamp     — ISO date of last tick/save
 * @property {number}  stone         — accumulated stone
 * @property {number}  stoneRate     — stone per second (0 before first upgrade)
 * @property {number}  totalWoodEarned — cumulative wood earned (for stone scaling)
 * @property {number}  clickPower    — wood per gather click
 * @property {number}  wallLevel     — number of wall upgrades built
 */

let state = {
  wood: 0,
  rate: WOOD_RATE,
  upgradeLevel: 0,
  timestamp: new Date().toISOString(),
  stone: 0,
  stoneRate: 0,
  totalWoodEarned: 0,
  clickPower: 1,
  wallLevel: 0,
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
    // Catch up stone if unlocked
    if (state.upgradeLevel >= 1) {
      const computedStoneRate = 0.05 + state.totalWoodEarned * 0.001;
      state.stoneRate = computedStoneRate;
      state.stone += computedStoneRate * elapsedSec;
    }
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
        state.upgradeLevel = typeof saved.upgradeLevel === "number" ? saved.upgradeLevel : 0;
        state.timestamp = saved.timestamp;
        state.stone = typeof saved.stone === "number" ? saved.stone : 0;
        state.stoneRate = typeof saved.stoneRate === "number" ? saved.stoneRate : 0;
        state.totalWoodEarned = typeof saved.totalWoodEarned === "number" ? saved.totalWoodEarned : 0;
        state.clickPower = typeof saved.clickPower === "number" ? saved.clickPower : 1;
        state.wallLevel = typeof saved.wallLevel === "number" ? saved.wallLevel : 0;
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
  // Accumulate stone if unlocked (after first upgrade)
  if (state.upgradeLevel >= 1) {
    const computedStoneRate = 0.05 + state.totalWoodEarned * 0.001;
    state.stoneRate = computedStoneRate;
    state.stone += computedStoneRate * (TICK_MS / 1000);
  }
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

  const loaded = loadPersisted();
  if (!loaded) {
    // No saved state — start fresh with zero offline gain
    state.timestamp = now();
  }
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
 * Gather wood instantly — adds clickPower wood.
 *
 * @returns {GameState} current state after gathering
 */
export function gatherWood() {
  state.wood += state.clickPower;
  state.totalWoodEarned += state.clickPower;
  return getState();
}

/**
 * Craft an upgrade: consumes UPGRADE_COST wood to permanently increase
 * the wood accumulation rate by RATE_INCREASE_PER_UPGRADE.
 *
 * @returns {{ upgraded: boolean, reason?: string, state: GameState }} whether
 *   the upgrade succeeded, and if not, a human-readable reason.
 */
export function craftUpgrade() {
  if (state.wood < UPGRADE_COST) {
    return { upgraded: false, reason: "Not enough wood — need " + UPGRADE_COST, state: getState() };
  }
  state.wood -= UPGRADE_COST;
  state.rate += RATE_INCREASE_PER_UPGRADE;
  state.upgradeLevel++;
  return { upgraded: true, state: getState() };
}

/**
 * Gather +1 stone instantly (active play action, only available after
 * first sharpen upgrade).
 *
 * @returns {GameState} current state after gathering
 */
export function gatherStone() {
  state.stone += 1;
  return getState();
}

/**
 * Build a wall: consumes STONE_UPGRADE_COST stone to permanently increase
 * click power from +1 to +2 wood per gather.
 *
 * @returns {{ built: boolean, reason?: string, state: GameState }} whether
 *   the wall was built, and if not, a human-readable reason.
 */
export function buildWall() {
  if (state.stone < STONE_UPGRADE_COST) {
    return { built: false, reason: "Not enough stone — need " + STONE_UPGRADE_COST, state: getState() };
  }
  state.stone -= STONE_UPGRADE_COST;
  state.clickPower = 2;
  state.wallLevel++;
  return { built: true, state: getState() };
}

/** the amount of wood gained during the last offline catch-up.
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
  const computedStoneRate = state.upgradeLevel >= 1 ? 0.05 + state.totalWoodEarned * 0.001 : 0;
  return {
    wood: state.wood,
    rate: state.rate,
    upgradeLevel: state.upgradeLevel,
    timestamp: state.timestamp,
    stone: state.stone,
    stoneRate: computedStoneRate,
    totalWoodEarned: state.totalWoodEarned,
    clickPower: state.clickPower,
    wallLevel: state.wallLevel,
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
    upgradeLevel: 0,
    timestamp: now(),
    stone: 0,
    stoneRate: 0,
    totalWoodEarned: 0,
    clickPower: 1,
    wallLevel: 0,
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