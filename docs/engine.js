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
 * After the first wall is built, the forge system unlocks: the player
 * can consume wood AND stone to forge tools, permanently boosting
 * wood rate and wall click power with escalating costs.
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
const FORGE_WOOD_COST_BASE = 10;
const FORGE_STONE_COST_BASE = 5;
const FORGE_WOOD_COST_INC = 5;
const FORGE_STONE_COST_INC = 3;
const FORGE_WOOD_RATE_BONUS = 0.05; // extra wood/s per forge level
const FORGE_CLICK_POWER_BONUS = 0.5; // extra wood per click per forge level
const TICK_MS = 1000;  // save interval (ms)

// Exported for external use (tools, UI)
export { UPGRADE_COST, RATE_INCREASE_PER_UPGRADE, STONE_BASE_RATE, WALL_COST, WALL_CLICK_POWER_BONUS, STONE_GATHER_AMOUNT,
  FORGE_WOOD_COST_BASE, FORGE_STONE_COST_BASE, FORGE_WOOD_COST_INC, FORGE_STONE_COST_INC,
  FORGE_WOOD_RATE_BONUS, FORGE_CLICK_POWER_BONUS };

/**
 * @typedef {Object} GameState
 * @property {number}  wood            — accumulated wood
 * @property {number}  rate            — wood per second
 * @property {number}  upgradeLevel    — number of sharpen upgrades crafted
 * @property {number}  stone           — accumulated stone
 * @property {number}  stoneRate       — stone per second (only >0 when unlocked)
 * @property {number}  totalWoodEarned — cumulative wood ever earned (drives stone rate)
 * @property {number}  totalStoneEarned — cumulative stone ever earned
 * @property {number}  wallLevel       — number of wall upgrades built
 * @property {number}  forgeLevel      — number of forge upgrades crafted
 * @property {number}  forgeWoodCost   — wood cost for the next forge
 * @property {number}  forgeStoneCost  — stone cost for the next forge
 * @property {boolean} stoneUnlocked   — whether stone system has been revealed
 * @property {string}  timestamp       — ISO date of last tick/save
 * @property {string}  firstTimestamp  — ISO date of first ever save (never updated after init)
 */

let state = {
  wood: 0,
  rate: WOOD_RATE,
  upgradeLevel: 0,
  stone: 0,
  totalWoodEarned: 0,
  totalStoneEarned: 0,
  wallLevel: 0,
  forgeLevel: 0,
  stoneUnlocked: false,
  timestamp: new Date().toISOString(),
  firstTimestamp: null,
};

/** Offline resources gained on last catch-up. */
/** @type {{ wood: number, stone: number, elapsedSec: number }} */
let offlineGained = { wood: 0, stone: 0, elapsedSec: 0 };

let tickTimer = null;

// ─── Internal helpers ─────────────────────────────────────────────

let snapshotBeforeCatchUp = null;

/**
 * @typedef {Object} MilestoneSnapshot
 * @property {number}  wood
 * @property {number}  upgradeLevel
 * @property {number}  stone
 * @property {number}  wallLevel
 * @property {boolean} stoneUnlocked
 */

function takeMilestoneSnapshot() {
  return {
    wood: state.wood,
    upgradeLevel: state.upgradeLevel,
    stone: state.stone,
    wallLevel: state.wallLevel,
    stoneUnlocked: state.stoneUnlocked,
  };
}

/**
 * @typedef {Object} Milestones
 * @property {boolean} sharpenAvailable  — wood >= 10 and sharpen not yet crafted
 * @property {boolean} stoneNowUnlocked  — stone was just unlocked this catch-up
 * @property {boolean} wallAvailable    — stone >= 5 and wall not yet built
 * @property {boolean} forgeNowUnlocked  — forge was just unlocked this catch-up
 */

/**
 * Compare current state against snapshot to determine which milestones
 * were newly crossed during the catch-up.  Returns object and resets.
 * After reading, the snapshot is cleared so each catch-up fires once.
 *
 * @returns {Milestones}
 */
export function consumeOfflineMilestones() {
  const before = snapshotBeforeCatchUp;
  if (!before) {
    return { sharpenAvailable: false, stoneNowUnlocked: false, wallAvailable: false, forgeNowUnlocked: false };
  }

  const sharpenAvailable = before.upgradeLevel === 0 && state.wood >= 10;
  const stoneNowUnlocked = before.stoneUnlocked === false && state.stoneUnlocked === true;
  const wallAvailable = state.stoneUnlocked && before.wallLevel === 0 && state.stone >= 5;
  const forgeNowUnlocked = before.wallLevel === 0 && state.wallLevel >= 1;

  snapshotBeforeCatchUp = null;

  return {
    sharpenAvailable,
    stoneNowUnlocked,
    wallAvailable,
    forgeNowUnlocked,
  };
}

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

function computeForgeWoodCost(forgeLevel) {
  return FORGE_WOOD_COST_BASE + forgeLevel * FORGE_WOOD_COST_INC;
}

function computeForgeStoneCost(forgeLevel) {
  return FORGE_STONE_COST_BASE + forgeLevel * FORGE_STONE_COST_INC;
}

/**
 * Apply offline catch-up: any elapsed time since last save is
 * converted into accumulated resources at current rates.
 */
function catchUp() {
  const lastSaved = new Date(state.timestamp).getTime();
  const elapsedSec = (Date.now() - lastSaved) / 1000;
  if (elapsedSec > 0) {
    // Capture snapshot before resources are added
    snapshotBeforeCatchUp = takeMilestoneSnapshot();

    const woodGained = state.rate * elapsedSec;
    state.wood += woodGained;
    state.totalWoodEarned += woodGained;
    let stoneGained = 0;
    if (state.stoneUnlocked) {
      stoneGained = computeStoneRate() * elapsedSec;
      state.stone += stoneGained;
      state.totalStoneEarned += stoneGained;
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
        state.totalStoneEarned = typeof saved.totalStoneEarned === "number" ? saved.totalStoneEarned : 0;
        state.wallLevel = typeof saved.wallLevel === "number" ? saved.wallLevel : 0;
        state.forgeLevel = typeof saved.forgeLevel === "number" ? saved.forgeLevel : 0;
        state.stoneUnlocked = typeof saved.stoneUnlocked === "boolean" ? saved.stoneUnlocked : false;
        state.timestamp = saved.timestamp;
        state.firstTimestamp = typeof saved.firstTimestamp === "string" ? saved.firstTimestamp : saved.timestamp;
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
    state.totalStoneEarned += computeStoneRate() * elapsed;
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
 * Format a duration in milliseconds as a human-readable string.
 * Outputs e.g. '2d 7h 34m', '5h 0m', '3m 12s', '5s', or '—' for falsy / zero.
 *
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
  if (!ms || ms <= 0) return '\u2014';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return totalSeconds + 's';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return minutes + 'm ' + (seconds > 0 ? seconds + 's' : '').trim();
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return hours + 'h ' + remainingMinutes + 'm';
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return days + 'd ' + remainingHours + 'h ' + remainingMinutes + 'm';
}

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
    state.firstTimestamp = now();
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
 * Click power increases with wall level and forge level.
 *
 * @returns {GameState} current state after gathering
 */
export function gatherWood() {
  const wallBonus = state.wallLevel * WALL_CLICK_POWER_BONUS;
  const forgeBonus = state.forgeLevel * FORGE_CLICK_POWER_BONUS;
  const clickPower = 1 + wallBonus + forgeBonus;
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
  state.totalStoneEarned += STONE_GATHER_AMOUNT;
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
 * Forge a tool: consumes wood and stone to permanently boost wood rate
 * and wall click power. Only available after the first wall is built.
 *
 * Costs escalate with each forge level.
 *
 * @returns {{ forged: boolean, reason?: string, state: GameState }}
 */
export function forgeTool() {
  if (state.wallLevel < 1) {
    return { forged: false, reason: "Build a wall first before you can forge tools.", state: getState() };
  }
  const woodCost = computeForgeWoodCost(state.forgeLevel);
  const stoneCost = computeForgeStoneCost(state.forgeLevel);
  if (state.wood < woodCost) {
    return { forged: false, reason: "Not enough wood — need " + woodCost, state: getState() };
  }
  if (state.stone < stoneCost) {
    return { forged: false, reason: "Not enough stone — need " + stoneCost, state: getState() };
  }
  state.wood -= woodCost;
  state.stone -= stoneCost;
  state.forgeLevel++;
  state.rate += FORGE_WOOD_RATE_BONUS;
  return { forged: true, state: getState() };
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
    totalStoneEarned: state.totalStoneEarned,
    wallLevel: state.wallLevel,
    forgeLevel: state.forgeLevel,
    forgeWoodCost: computeForgeWoodCost(state.forgeLevel),
    forgeStoneCost: computeForgeStoneCost(state.forgeLevel),
    stoneUnlocked: state.stoneUnlocked,
    timestamp: state.timestamp,
    firstTimestamp: state.firstTimestamp,
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
    totalStoneEarned: 0,
    wallLevel: 0,
    forgeLevel: 0,
    stoneUnlocked: false,
    timestamp: now(),
    firstTimestamp: null,
  };
  offlineGained = { wood: 0, stone: 0, elapsedSec: 0 };
  snapshotBeforeCatchUp = null;
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