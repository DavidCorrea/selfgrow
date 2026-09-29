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
const FIRST_GOAL_WOOD = 10; // wood needed to reach the first goal and unlock the first sharpen
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
const EXPEDITION_WOOD_COST_BASE = 10;
const EXPEDITION_STONE_COST_BASE = 5;
const EXPEDITION_WOOD_COST_INC = 5;
const EXPEDITION_STONE_COST_INC = 3;
const EXPEDITION_WOOD_RATE_MULTIPLIER = 0.05; // additive multiplier per map (n maps = 1 + n*0.05)
const TICK_MS = 1000;  // save interval (ms)
const DISCOVERY_MIN_SEC = 60; // shortest absence that can turn something up
const RETURN_MIN_SEC = 1; // shortest absence that counts as a real return

/**
 * The away-discovery ladder. Each tier is reached at a minimum absence
 * length; the strongest tier the absence qualifies for is the one credited.
 * Ordered by minSec ascending; ties are impossible.
 *
 * @type {Array<{ id: string, name: string, minSec: number, bonus: number }>}
 */
const DISCOVERIES = [
  { id: "flint-shard", name: "Flint Shard", minSec: 60, bonus: 0.05 },
  { id: "clay-deposit", name: "Clay Deposit", minSec: 600, bonus: 0.10 },
  { id: "wandering-sapling", name: "Wandering Sapling", minSec: 3600, bonus: 0.15 },
  { id: "glowing-seam", name: "Glowing Seam", minSec: 21600, bonus: 0.25 },
  { id: "ancient-grove", name: "Ancient Grove", minSec: 86400, bonus: 0.40 },
  { id: "sunken-vault", name: "Sunken Vault", minSec: 604800, bonus: 0.60 },
];

// Exported for external use (tools, UI)
export { FIRST_GOAL_WOOD, UPGRADE_COST, RATE_INCREASE_PER_UPGRADE, STONE_BASE_RATE, WALL_COST, WALL_CLICK_POWER_BONUS, STONE_GATHER_AMOUNT,
  FORGE_WOOD_COST_BASE, FORGE_STONE_COST_BASE, FORGE_WOOD_COST_INC, FORGE_STONE_COST_INC,
  FORGE_WOOD_RATE_BONUS, FORGE_CLICK_POWER_BONUS,
  EXPEDITION_WOOD_COST_BASE, EXPEDITION_STONE_COST_BASE, EXPEDITION_WOOD_COST_INC, EXPEDITION_STONE_COST_INC,
  EXPEDITION_WOOD_RATE_MULTIPLIER, RETURN_MIN_SEC, computeStoneRate };

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
 * @property {number}  discoveryBonus  — permanent wood/s bonus from the strongest away discovery
 * @property {string|null} discoveryId — id of the strongest away discovery found so far
 * @property {string|null} discoveryName — display name of that discovery
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
  expeditionLevel: 0,
  maps: 0,
  stoneUnlocked: false,
  discoveryBonus: 0,
  discoveryId: null,
  discoveryName: null,
  timestamp: new Date().toISOString(),
  firstTimestamp: null,
};

/** Offline resources gained on last catch-up. */
/** @type {{ wood: number, stone: number, elapsedSec: number, discovery: {id: string, name: string, bonus: number, credited: boolean}|null }} */
let offlineGained = { wood: 0, stone: 0, elapsedSec: 0, discovery: null };

/**
 * The account of the last return, written once inside catchUp and read — never
 * consumed — by the welcome-back panel and the agent tools. Keeping it in one
 * place means the page can never disagree with itself about a return.
 *
 * @type {{
 *   firstVisit: boolean,
 *   elapsedSec: number,
 *   wood: number,
 *   stone: number,
 *   discovery: {id: string, name: string, bonus: number, credited: boolean}|null,
 *   milestones: Milestones,
 * }|null}
 */
let lastReturn = null;

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
 * @property {number}  forgeLevel
 */

function takeMilestoneSnapshot() {
  return {
    wood: state.wood,
    upgradeLevel: state.upgradeLevel,
    stone: state.stone,
    wallLevel: state.wallLevel,
    stoneUnlocked: state.stoneUnlocked,
    forgeLevel: state.forgeLevel,
  };
}

/**
 * @typedef {Object} Milestones
 * @property {boolean} sharpenAvailable  — wood >= 10 and sharpen not yet crafted
 * @property {boolean} stoneNowUnlocked  — stone was just unlocked this catch-up
 * @property {boolean} wallAvailable    — stone >= 5 and wall not yet built
 * @property {boolean} forgeNowUnlocked  — forge was just unlocked this catch-up
 * @property {boolean} expeditionNowUnlocked  — expedition was just unlocked this catch-up
 */

/**
 * Which milestones the catch-up just crossed, comparing the live state against
 * the snapshot taken before any resource was added. A milestone counts only
 * when it was not already satisfied before, so the panel names what actually
 * opened up while the player was away.
 *
 * @param {MilestoneSnapshot} before
 * @returns {Milestones}
 */
function computeMilestones(before) {
  return {
    sharpenAvailable: before.upgradeLevel === 0 && before.wood < FIRST_GOAL_WOOD && state.wood >= FIRST_GOAL_WOOD,
    stoneNowUnlocked: before.stoneUnlocked === false && state.stoneUnlocked === true,
    wallAvailable: state.stoneUnlocked && before.wallLevel === 0 && before.stone < WALL_COST && state.stone >= WALL_COST,
    forgeNowUnlocked: before.wallLevel === 0 && state.wallLevel >= 1,
    expeditionNowUnlocked: before.forgeLevel < 5 && state.forgeLevel >= 5,
  };
}

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
    return { sharpenAvailable: false, stoneNowUnlocked: false, wallAvailable: false, forgeNowUnlocked: false, expeditionNowUnlocked: false };
  }
  snapshotBeforeCatchUp = null;
  return computeMilestones(before);
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

function computeExpeditionWoodCost(expeditionLevel) {
  return EXPEDITION_WOOD_COST_BASE + expeditionLevel * EXPEDITION_WOOD_COST_INC;
}

function computeExpeditionStoneCost(expeditionLevel) {
  return EXPEDITION_STONE_COST_BASE + expeditionLevel * EXPEDITION_STONE_COST_INC;
}

/**
 * Compute the effective wood accumulation rate including the expedition map multiplier.
 */
function getEffectiveRate() {
  const expeditionMultiplier = 1 + state.maps * EXPEDITION_WOOD_RATE_MULTIPLIER;
  return state.rate * expeditionMultiplier;
}

/**
 * Apply offline catch-up: any elapsed time since last save is
 * converted into accumulated resources at current rates.
 *
 * A real return (not the first-ever visit) of at least DISCOVERY_MIN_SEC
 * also turns up exactly one discovery, derived from the absence length
 * alone. If it is stronger than anything found before, its wood-rate bonus
 * becomes permanent; a weaker or repeated find names itself but changes no
 * stats, so short returns cannot re-farm a bonus already owned.
 *
 * @param {boolean} firstVisit — true when there was no saved state to return to
 */
function catchUp(firstVisit) {
  lastReturn = null;
  const lastSaved = new Date(state.timestamp).getTime();
  const elapsedSec = (Date.now() - lastSaved) / 1000;
  if (elapsedSec > 0) {
    // Capture snapshot before resources are added
    const before = takeMilestoneSnapshot();
    snapshotBeforeCatchUp = before;
    const beforeWood = before.wood;
    const beforeStone = before.stone;

    const effectiveRate = getEffectiveRate();
    const woodGained = effectiveRate * elapsedSec;
    state.wood += woodGained;
    state.totalWoodEarned += woodGained;
    let stoneGained = 0;
    if (state.stoneUnlocked) {
      stoneGained = computeStoneRate() * elapsedSec;
      state.stone += stoneGained;
      state.totalStoneEarned += stoneGained;
    }

    const discovery = firstVisit ? null : discoverForElapsed(elapsedSec);
    // A find is only credited when it beats everything owned so far; a weaker
    // repeat names itself but must not claim a bonus it did not add.
    const credited = Boolean(discovery && discovery.bonus > state.discoveryBonus);
    if (credited) {
      state.rate += discovery.bonus - state.discoveryBonus;
      state.discoveryBonus = discovery.bonus;
      state.discoveryId = discovery.id;
      state.discoveryName = discovery.name;
    }

    offlineGained = {
      wood: woodGained,
      stone: stoneGained,
      elapsedSec: elapsedSec,
      discovery: discovery ? { id: discovery.id, name: discovery.name, bonus: discovery.bonus, credited } : null,
    };

    // The account of this return, recorded once. The wood and stone amounts
    // are the rises the resource counters themselves show, so the panel cannot
    // claim a number the counters disagree with.
    lastReturn = {
      firstVisit,
      elapsedSec,
      wood: displayAmount(displayAmount(state.wood) - displayAmount(beforeWood)),
      stone: displayAmount(displayAmount(state.stone) - displayAmount(beforeStone)),
      discovery: discovery ? { id: discovery.id, name: discovery.name, bonus: discovery.bonus, credited } : null,
      milestones: computeMilestones(before),
    };
    state.timestamp = now();
  }
}

/**
 * The discovery an absence of the given length turns up, or null when the
 * absence is too short or invalid. Pure and deterministic: the same length
 * always yields the same discovery, so it can never be lost or gambled.
 *
 * @param {number} elapsedSec
 * @returns {{ id: string, name: string, bonus: number, minSec: number }|null}
 */
export function discoverForElapsed(elapsedSec) {
  if (!(elapsedSec >= DISCOVERY_MIN_SEC)) return null;
  let found = null;
  for (const tier of DISCOVERIES) {
    if (elapsedSec >= tier.minSec) found = tier;
  }
  return found ? { ...found } : null;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full or unavailable — silently degrade
  }
}

/**
 * Whether a decoded save carries the fields every save must have to be
 * trustworthy: a finite wood amount, a finite rate, and a timestamp string.
 * Anything failing this is rejected before it can touch the live state.
 *
 * @param {unknown} saved
 * @returns {boolean}
 */
function isValidSaved(saved) {
  return Boolean(saved)
    && typeof saved === "object"
    && Number.isFinite(saved.wood)
    && Number.isFinite(saved.rate)
    && typeof saved.timestamp === "string";
}

/**
 * Copy a validated save onto the live state. Every optional field falls back
 * to its fresh-game default, so an older save that predates a field still
 * loads. Shared by loadPersisted and importSave so a restored code and a
 * reloaded save can never disagree about what they set.
 *
 * @param {{ wood: number, rate: number, timestamp: string }} saved
 */
function applyPersisted(saved) {
  state.wood = saved.wood;
  state.rate = saved.rate;
  state.upgradeLevel = typeof saved.upgradeLevel === "number" ? saved.upgradeLevel : 0;
  state.stone = typeof saved.stone === "number" ? saved.stone : 0;
  state.totalWoodEarned = typeof saved.totalWoodEarned === "number" ? saved.totalWoodEarned : 0;
  state.totalStoneEarned = typeof saved.totalStoneEarned === "number" ? saved.totalStoneEarned : 0;
  state.wallLevel = typeof saved.wallLevel === "number" ? saved.wallLevel : 0;
  state.forgeLevel = typeof saved.forgeLevel === "number" ? saved.forgeLevel : 0;
  state.expeditionLevel = typeof saved.expeditionLevel === "number" ? saved.expeditionLevel : 0;
  state.maps = typeof saved.maps === "number" ? saved.maps : 0;
  state.stoneUnlocked = typeof saved.stoneUnlocked === "boolean" ? saved.stoneUnlocked : (state.upgradeLevel >= 1);
  state.discoveryBonus = typeof saved.discoveryBonus === "number" ? saved.discoveryBonus : 0;
  state.discoveryId = typeof saved.discoveryId === "string" ? saved.discoveryId : null;
  state.discoveryName = typeof saved.discoveryName === "string" ? saved.discoveryName : null;
  state.timestamp = saved.timestamp;
  state.firstTimestamp = typeof saved.firstTimestamp === "string" ? saved.firstTimestamp : saved.timestamp;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (isValidSaved(saved)) {
        applyPersisted(saved);
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
  const effectiveRate = getEffectiveRate();
  state.wood += effectiveRate * elapsed;
  state.totalWoodEarned += effectiveRate * elapsed;
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
 * Format a resource quantity the way the status bar and the goal labels show
 * it: integers and values at or above 10 are floored, everything else keeps
 * two decimals. The page and the agent tools share this one rule so the goal
 * panel and the read-state tool can never disagree about a goal's numbers.
 *
 * @param {number} v
 * @returns {number}
 */
export function displayAmount(v) {
  return Number.isInteger(v) || v >= 10 ? Math.floor(v) : parseFloat(v.toFixed(2));
}

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
  catchUp(!loaded);
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
 * Encode the current save as a portable base64 text code — the exact JSON
 * written to localStorage, so a code is a faithful copy of the save.
 *
 * @returns {string}
 */
export function exportSave() {
  return btoa(JSON.stringify(state));
}

/**
 * Restore a save from a code produced by exportSave. The code is decoded and
 * validated before anything is touched, so a corrupted or foreign code returns
 * a refusal and leaves the live and stored save exactly as they were. On
 * success the code's fields (including its timestamps) become the save and it
 * is persisted; the offline catch-up is deliberately not run, so restoring an
 * old code reproduces that code rather than granting the elapsed time as free
 * offline progress.
 *
 * @param {string} code
 * @returns {{ ok: boolean, reason?: string, state: GameState }}
 */
export function importSave(code) {
  if (typeof code !== "string" || code.trim() === "") {
    return { ok: false, reason: "Enter a save code to restore.", state: getState() };
  }

  let saved;
  try {
    saved = JSON.parse(atob(code.trim()));
  } catch {
    return { ok: false, reason: "That code is not a valid save — it looks corrupted or incomplete.", state: getState() };
  }

  if (!isValidSaved(saved)) {
    return { ok: false, reason: "That code is not a valid save — it is missing required fields.", state: getState() };
  }

  applyPersisted(saved);
  persist();
  return { ok: true, state: getState() };
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
 * The wood a player must have banked before the next sharpen is available.
 *
 * The first sharpen is the game's first goal, so it unlocks at FIRST_GOAL_WOOD;
 * every sharpen after that costs UPGRADE_COST. This is the one rule the
 * Sharpen button, the goal panel and the agent tools all read.
 *
 * @param {{ wood: number, upgradeLevel: number }} s
 * @returns {number}
 */
export function sharpenThreshold(s) {
  return s.upgradeLevel >= 1 ? UPGRADE_COST : FIRST_GOAL_WOOD;
}

/**
 * Whether sharpening is available to this player right now.
 *
 * @param {{ wood: number, upgradeLevel: number }} s
 * @returns {boolean}
 */
export function sharpenAvailable(s) {
  return s.wood >= sharpenThreshold(s);
}

/**
 * Craft a sharpen upgrade: consumes UPGRADE_COST wood to permanently
 * increase the wood accumulation rate by RATE_INCREASE_PER_UPGRADE.
 *
 * If this is the first upgrade, unlocks the stone system. Refuses at exactly
 * the same gate the Sharpen button uses, so an agent can never sharpen before
 * a person can.
 *
 * @returns {{ upgraded: boolean, reason?: string, state: GameState }} whether
 *   the upgrade succeeded, and if not, a human-readable reason.
 */
export function craftUpgrade() {
  if (!sharpenAvailable(state)) {
    const needed = Math.ceil(sharpenThreshold(state) - state.wood);
    const reason = state.upgradeLevel >= 1
      ? "Not enough wood — need " + UPGRADE_COST
      : "First goal not reached — gather " + needed + " more wood to unlock sharpening.";
    return { upgraded: false, reason, state: getState() };
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
 * Send a scout on an expedition: consumes wood and stone to earn 1 'map' resource.
 * Each map permanently multiplies the wood accumulation rate by 1.05x (additive).
 * Only available after forge level 5.
 *
 * Costs escalate with each expedition level.
 *
 * @returns {{ sent: boolean, reason?: string, state: GameState }}
 */
export function sendExpedition() {
  if (state.forgeLevel < 5) {
    return { sent: false, reason: "Reach forge level 5 before expeditions are available.", state: getState() };
  }
  const woodCost = computeExpeditionWoodCost(state.expeditionLevel);
  const stoneCost = computeExpeditionStoneCost(state.expeditionLevel);
  if (state.wood < woodCost) {
    return { sent: false, reason: "Not enough wood — need " + woodCost, state: getState() };
  }
  if (state.stone < stoneCost) {
    return { sent: false, reason: "Not enough stone — need " + stoneCost, state: getState() };
  }
  state.wood -= woodCost;
  state.stone -= stoneCost;
  state.expeditionLevel++;
  state.maps++;
  return { sent: true, state: getState() };
}

/**
 * Returns the amount of resources gained during the last offline catch-up.
 * Resets to { wood: 0, stone: 0 } after being read.
 *
 * @returns {{ wood: number, stone: number }}
 */
export function consumeOfflineGained() {
  const val = { ...offlineGained };
  offlineGained = { wood: 0, stone: 0, elapsedSec: 0, discovery: null };
  return val;
}

/**
 * The account of the last return, read — never consumed — so the welcome-back
 * panel and the agent tools always read the same numbers. `visible` is true
 * only for a real return away at least RETURN_MIN_SEC, so a first-ever visit
 * and a sub-second reload show no panel.
 *
 * @returns {{
 *   visible: boolean,
 *   firstVisit: boolean,
 *   elapsedSec: number,
 *   elapsed: string,
 *   wood: number,
 *   stone: number,
 *   discovery: {id: string, name: string, bonus: number, credited: boolean}|null,
 *   milestones: Milestones,
 * }}
 */
export function getReturnSummary() {
  const ret = lastReturn;
  if (!ret) {
    return {
      visible: false,
      firstVisit: true,
      elapsedSec: 0,
      elapsed: formatElapsed(0),
      wood: 0,
      stone: 0,
      discovery: null,
      milestones: { sharpenAvailable: false, stoneNowUnlocked: false, wallAvailable: false, forgeNowUnlocked: false, expeditionNowUnlocked: false },
    };
  }
  return {
    visible: !ret.firstVisit && ret.elapsedSec >= RETURN_MIN_SEC,
    firstVisit: ret.firstVisit,
    elapsedSec: ret.elapsedSec,
    elapsed: formatElapsed(ret.elapsedSec * 1000),
    wood: ret.wood,
    stone: ret.stone,
    discovery: ret.discovery,
    milestones: ret.milestones,
  };
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
    expeditionLevel: state.expeditionLevel,
    maps: state.maps,
    expeditionWoodCost: computeExpeditionWoodCost(state.expeditionLevel),
    expeditionStoneCost: computeExpeditionStoneCost(state.expeditionLevel),
    stoneUnlocked: state.stoneUnlocked,
    discovery: state.discoveryId ? {
      id: state.discoveryId,
      name: state.discoveryName,
      bonus: state.discoveryBonus,
    } : null,
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
    expeditionLevel: 0,
    maps: 0,
    stoneUnlocked: false,
    discoveryBonus: 0,
    discoveryId: null,
    discoveryName: null,
    timestamp: now(),
    firstTimestamp: null,
  };
  offlineGained = { wood: 0, stone: 0, elapsedSec: 0, discovery: null };
  snapshotBeforeCatchUp = null;
  lastReturn = null;
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