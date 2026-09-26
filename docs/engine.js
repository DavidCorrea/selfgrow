/**
 * engine.js — selfgrow's game state engine.
 *
 * One resource ("wood") accumulates at a fixed rate (0.1/sec).
 * The player can also click/tap to gather +1 wood instantly.
 * After the first sharpen upgrade, a second resource ("stone") is
 * unlocked: it accumulates passively (base 0.05/s, boosted by total
 * wood earned), can be gathered manually with a separate cooldown,
 * and can be spent on a "Build Wall" upgrade that increases click
 * power for wood gathering.
 *
 * State persists to localStorage every tick and catches up on page
 * reload for time spent away.
 *
 * @module engine
 */

const STORAGE_KEY = "selfgrow-state";
const WOOD_RATE = 0.1; // wood per second
const UPGRADE_COST = 5; // wood per upgrade
const RATE_INCREASE_PER_UPGRADE = 0.05; // additional wood per second per upgrade
const STONE_BASE_RATE = 0.05; // stone per second (after stone unlocked)
const STONE_RATE_BOOST_FACTOR = 0.001; // extra stone/s per total wood earned
const STONE_GATHER_AMOUNT = 1; // stone gained per gather action
const WALL_COST = 5; // stone per wall upgrade
const WALL_CLICK_POWER_BONUS = 1; // extra wood per click per wall level
const TICK_MS = 1000;  // save interval (ms)

// Exported for external use (tools, UI)
export { UPGRADE_COST, RATE_INCREASE_PER_UPGRADE, STONE_BASE_RATE, WALL_COST, WALL_CLICK_POWER_BONUS, STONE_GATHER_AMOUNT };

/**
 * @typedef {Object} GameState
 * @property {number}  wood          — accumulated wood
 * @property {number}  rate          — wood per second
 * @property {number}  upgradeLevel  — number of sharpen upgrades crafted
 * @property {number}  stone         — accumulated stone
 * @property {number}  stoneRate     — stone per second (only >0 when unlocked)
 * @property {number}  totalWoodEarned — cumulative wood ever earned (drives stone rate)
 * @property {number}  wallLevel     — number of wall upgrades built
 * @property {boolean} stoneUnlocked — whether stone system has been revealed
 * @property {string}  timestamp     — ISO date of last tick/save
 */

let state = {
  wood: 0,
  rate: WOOD_RATE,
  upgradeLevel: 0,
  stone: 0,
  totalWoodEarned: 0,
  wallLevel: 0,
  stoneUnlocked: false,
  timestamp: new Date().toISOString(),
};

/** Offline resources gained on last catch-up. */
/** @type {{ wood: number, stone: number, elapsedSec: number }} */
let offlineGained = { wood: 0, stone: 0, elapsedSec: 0 };

let tickTimer = null;

// ─── Internal helpers ─────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

/**
 * Compute the current stone accumulation rate based on total wood earned.
 * Only meaningful when stone is unlocked.
 */
function computeStoneRate() {
  if (!state.stoneUnlocked) return 0;
  return STONE_BASE_RATE + state.totalWoodEarned * STONE_RATE_BOOST_FACTOR;
}

/**
 * Apply offline catch-up: any elapsed time since last save is
 * converted into accumulated resources at current rates.
 */
function catchUp() {
  const lastSaved = new Date(state.timestamp).getTime();
  const elapsedSec = (Date.now() - lastSaved) / 1000;
  if (elapsedSec > 0) {
    const woodGained = state.rate * elapsedSec;
    state.wood += woodGained;
    state.totalWoodEarned += woodGained;
    let stoneGained = 0;
    if (state.stoneUnlocked) {
      stoneGained = computeStoneRate() * elapsedSec;
      state.stone += stoneGained;
    }
    offlineGained = { wood: woodGained, stone: stoneGained, elapsedSec: elapsedSec };
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
        state.stone = typeof saved.stone === "number" ? saved.stone : 0;
        state.totalWoodEarned = typeof saved.totalWoodEarned === "number" ? saved.totalWoodEarned : 0;
        state.wallLevel = typeof saved.wallLevel === "number" ? saved.wallLevel : 0;
        state.stoneUnlocked = typeof saved.stoneUnlocked === "boolean" ? saved.stoneUnlocked : false;
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
  const elapsed = TICK_MS / 1000;
  state.wood += state.rate * elapsed;
  state.totalWoodEarned += state.rate * elapsed;
  if (state.stoneUnlocked) {
    state.stone += computeStoneRate() * elapsed;
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
 * Gather +1 wood instantly (active play action).
 * Click power increases with wall level: each wall adds +WALL_CLICK_POWER_BONUS.
 *
 * @returns {GameState} current state after gathering
 */
export function gatherWood() {
  const clickPower = 1 + state.wallLevel * WALL_CLICK_POWER_BONUS;
  state.wood += clickPower;
  state.totalWoodEarned += clickPower;
  return getState();
}

/**
 * Craft a sharpen upgrade: consumes UPGRADE_COST wood to permanently
 * increase the wood accumulation rate by RATE_INCREASE_PER_UPGRADE.
 *
 * If this is the first upgrade, unlocks the stone system.
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

  // First upgrade unlocks stone!
  if (state.upgradeLevel === 1) {
    state.stoneUnlocked = true;
  }

  return { upgraded: true, state: getState() };
}

/**
 * Gather +1 stone instantly (active play action, only available when
 * stone is unlocked).
 *
 * @returns {{ gathered: boolean, reason?: string, state: GameState }}
 */
export function gatherStone() {
  if (!state.stoneUnlocked) {
    return { gathered: false, reason: "Stone is not yet unlocked.", state: getState() };
  }
  state.stone += STONE_GATHER_AMOUNT;
  return { gathered: true, state: getState() };
}

/**
 * Build a wall upgrade: consumes WALL_COST stone to permanently increase
 * click power for wood gathering.
 *
 * @returns {{ built: boolean, reason?: string, state: GameState }}
 */
export function buildWall() {
  if (!state.stoneUnlocked) {
    return { built: false, reason: "Stone is not yet unlocked.", state: getState() };
  }
  if (state.stone < WALL_COST) {
    return { built: false, reason: "Not enough stone — need " + WALL_COST, state: getState() };
  }
  state.stone -= WALL_COST;
  state.wallLevel++;
  return { built: true, state: getState() };
}

/**
 * Returns the amount of resources gained during the last offline catch-up.
 * Resets to { wood: 0, stone: 0 } after being read.
 *
 * @returns {{ wood: number, stone: number }}
 */
export function consumeOfflineGained() {
  const val = { ...offlineGained };
  offlineGained = { wood: 0, stone: 0, elapsedSec: 0 };
  return val;
}

/**
 * Legacy wrapper — returns only wood gained from offline catch-up.
 * @returns {number}
 */
export function consumeOfflineWoodGained() {
  const val = offlineGained.wood;
  offlineGained.wood = 0;
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
    upgradeLevel: state.upgradeLevel,
    stone: state.stone,
    totalWoodEarned: state.totalWoodEarned,
    wallLevel: state.wallLevel,
    stoneUnlocked: state.stoneUnlocked,
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
    upgradeLevel: 0,
    stone: 0,
    totalWoodEarned: 0,
    wallLevel: 0,
    stoneUnlocked: false,
    timestamp: now(),
  };
  offlineGained = { wood: 0, stone: 0, elapsedSec: 0 };
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