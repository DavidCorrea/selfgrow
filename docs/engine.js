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
const EXPEDITION_FORGE_LEVEL = 5; // forge level that unlocks expeditions
const GOAL_STONE = 5; // stone the gather-stone goal asks for
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
const AWAY_EVENT_MIN_SEC = DISCOVERY_MIN_SEC; // shortest absence that offers a decision
const AWAY_EVENT_LUMP_SEC = 30; // seconds of production a wood or stone option grants
// The permanent wood/s a rate option adds, as a share of the effective wood/s
// in force when the return is collected. A fixed share keeps the rate choice
// worth the same as the lump however far the player has grown: the lump is
// AWAY_EVENT_LUMP_SEC (30s) of production, so the bonus pays for itself in
// AWAY_EVENT_LUMP_SEC / AWAY_EVENT_RATE_BONUS_FRACTION = 600s of production,
// whether the rate is 0.1/s or 100/s. A fixed amount would instead be worth
// minutes of production early and nothing at all later, leaving one real
// option wearing two labels.
const AWAY_EVENT_RATE_BONUS_FRACTION = 0.05;

/**
 * The away-discovery ladder's fixed rungs. Each tier is reached at a minimum
 * absence length; the strongest tier the absence qualifies for is the one
 * credited. Ordered by minSec ascending; ties are impossible. Past the last
 * of these the ladder continues with deterministic generated rungs (see
 * getGeneratedDiscovery), so it never runs out of something to find.
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

/**
 * The fixed pool of away events. Each is a happening drawn from the time
 * away that offers exactly two choices, and each choice's kind names the one
 * thing it grants: a lump of wood, a lump of stone, or a permanent wood/s
 * increase. The absence and the save's own count of happenings already offered
 * together pick an entry (see awayEventForElapsed), so checking in on the same
 * cadence still advances through the pool rather than repeating one decision.
 * The pool holds happenings of each kind pair more than once, so a regular
 * visitor meets several different decisions — not three in a loop — before the
 * sequence returns to the one it started on. The two kinds within an entry are
 * always distinct — the choice's own id is its kind — so a pair never shows two
 * identical buttons.
 *
 * @type {Array<{ id: string, title: string, kinds: [string, string] }>}
 */
const AWAY_EVENTS = [
  { id: "wandering-trader", title: "A wandering trader stops at your fire", kinds: ["wood", "stone"] },
  { id: "fallen-log-cache", title: "Something is cached beneath a fallen log", kinds: ["wood", "rate"] },
  { id: "old-quarry-face", title: "An old quarry face has crumbled open", kinds: ["stone", "rate"] },
  { id: "flooded-creek", title: "A flooded creek has cut a fresh channel", kinds: ["wood", "stone"] },
  { id: "wild-hive", title: "A wild hive hangs heavy in a dead tree", kinds: ["wood", "rate"] },
  { id: "clay-seam", title: "A clay seam has opened along the riverbank", kinds: ["stone", "rate"] },
];

// Everything past the fixed rungs is derived from the top rung and the rung
// number, so the ladder is endless without a list that can be exhausted.
const DEEP_FIND_BASE_MIN_SEC = DISCOVERIES[DISCOVERIES.length - 1].minSec;
const DEEP_FIND_BASE_BONUS = DISCOVERIES[DISCOVERIES.length - 1].bonus;
const SECONDS_PER_DAY = 86400;
const DEEP_FIND_BONUS_STEP = 0.05;
// How far past the top rung an absence may reach. Quadratic growth means even
// a value this large names a rung millions of years out, so it bounds the walk
// without ever being the answer a real absence gets.
const MAX_GENERATED_RUNGS = 100000;

// Two fixed vocabularies indexed by rung number name each generated find
// reproducibly. Their different lengths stop the pairs repeating together
// before many rungs have passed.
const DEEP_FIND_ADJECTIVES = [
  "Buried", "Whispering", "Gilded", "Hollow", "Starlit", "Forgotten",
  "Radiant", "Tidal", "Amber", "Iron", "Mossy", "Obsidian",
];
const DEEP_FIND_NOUNS = [
  "Archive", "Monolith", "Reliquary", "Spire", "Cache", "Sanctum",
  "Obelisk", "Foundry", "Observatory", "Labyrinth", "Garden", "Beacon", "Menagerie",
];

/**
 * The k-th rung past the fixed ladder (k starts at 1, one day beyond the top
 * tier). Pure and deterministic — the same k is always the same find — and
 * strictly stronger and further than the rung before it, so reaching one can
 * only ever leave a stronger one beyond.
 *
 * @param {number} k
 * @returns {{ id: string, name: string, minSec: number, bonus: number }}
 */
function getGeneratedDiscovery(k) {
  const index = Math.floor(k);
  return {
    id: `deep-find-${index}`,
    name: `${DEEP_FIND_ADJECTIVES[(index - 1) % DEEP_FIND_ADJECTIVES.length]} ${DEEP_FIND_NOUNS[(index - 1) % DEEP_FIND_NOUNS.length]}`,
    minSec: DEEP_FIND_BASE_MIN_SEC + SECONDS_PER_DAY * (index * (index + 1)) / 2,
    bonus: Math.round((DEEP_FIND_BASE_BONUS + DEEP_FIND_BONUS_STEP * index) * 100) / 100,
  };
}

/**
 * The rung number behind a generated id, or null when the id names no rung.
 *
 * @param {string} id
 * @returns {number|null}
 */
function generatedIndex(id) {
  const match = /^deep-find-(\d+)$/.exec(id);
  if (!match) return null;
  const index = Number(match[1]);
  return index >= 1 ? index : null;
}

// Exported for external use (tools, UI)
export { FIRST_GOAL_WOOD, UPGRADE_COST, RATE_INCREASE_PER_UPGRADE, STONE_BASE_RATE, STONE_RATE_BOOST_FACTOR, WALL_COST, EXPEDITION_FORGE_LEVEL, GOAL_STONE, WALL_CLICK_POWER_BONUS, STONE_GATHER_AMOUNT,
  FORGE_WOOD_COST_BASE, FORGE_STONE_COST_BASE, FORGE_WOOD_COST_INC, FORGE_STONE_COST_INC,
  FORGE_WOOD_RATE_BONUS, FORGE_CLICK_POWER_BONUS,
  EXPEDITION_WOOD_COST_BASE, EXPEDITION_STONE_COST_BASE, EXPEDITION_WOOD_COST_INC, EXPEDITION_STONE_COST_INC,
  EXPEDITION_WOOD_RATE_MULTIPLIER, RETURN_MIN_SEC, computeStoneRateFor, computeStoneRate,
  expeditionMultiplierFor, effectiveWoodRate, clickPowerFor,
  DISCOVERY_MIN_SEC, AWAY_EVENT_MIN_SEC, AWAY_EVENT_LUMP_SEC, AWAY_EVENT_RATE_BONUS_FRACTION,
  awayRateBonusFor, AWAY_EVENTS };

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
 * @property {{collected: Array<{id: string, name: string, minSec: number, bonus: number}>, hiddenCount: number, total: number, next: {id: string, name: string, minSec: number, bonus: number}|null}} finds
 *   — every away find kept so far (the stored rung and every weaker rung
 *   below it, in ladder order) and the next rung still locked
 * @property {string}  timestamp       — ISO date of last tick/save
 * @property {string}  firstTimestamp  — ISO date of first ever save (never updated after init)
 * @property {ReturnRecord|null} lastReturn — account of the last return; carried in
 *   the save so a reload before the player dismisses it still tells the real story
 * @property {AwayEvent|null} pendingEvent — the two-choice happening a real
 *   return is offering, carried in the save until the player picks one, so a
 *   reload before choosing offers the same event rather than losing it
 * @property {number} eventsOffered — how many happenings this save has actually
 *   been offered (see catchUp). The away event is picked from the absence and
 *   this count together, so two returns of the same length cycle through the
 *   pool instead of repeating one decision forever
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
  lastReturn: null,
  pendingEvent: null,
  eventsOffered: 0,
};

/** Offline resources gained on last catch-up. */
/** @type {{ wood: number, stone: number, elapsedSec: number, discovery: {id: string, name: string, bonus: number, credited: boolean, alreadyOwned: boolean}|null }} */
let offlineGained = { wood: 0, stone: 0, elapsedSec: 0, discovery: null };

/**
 * The account of the last return, written once inside catchUp and read — never
 * consumed — by the welcome-back panel and the agent tools. It lives on the
 * state so the save carries it: a tab discarded and restored before the player
 * reads the panel reloads to the same real absence, not the seconds since the
 * last tick. `seen` flips only in markReturnSeen, so the page and the read
 * tools can never disagree about whether the account has been read.
 *
 * @typedef {Object} ReturnRecord
 * @property {boolean} firstVisit
 * @property {boolean} seen
 * @property {number}  elapsedSec
 * @property {number}  wood
 * @property {number}  stone
 * @property {{id: string, name: string, bonus: number, credited: boolean, alreadyOwned: boolean}|null} discovery
 * @property {string|null} eventId — the id of the away event this return itself
 *   offered, or null when it offered none. It is what ties a later choice back
 *   to the return that actually posed the decision, so a return that never
 *   offered one can never inherit another return's chosen option.
 * @property {{id: string, label: string, effect: {kind: string, amount: number}, effectText: string}|null} chosenOption
 *   — the option the player took from this return's decision, or null when the
 *   return offered none or the player has not chosen yet. Written once in
 *   chooseAwayEventOption so a reload still tells what was chosen.
 * @property {Milestones} milestones
 */

/**
 * A happening drawn from an absence that offers exactly two choices. It is
 * derived from the absence and the save's happening count (see
 * awayEventForElapsed), stored on the state until one option is chosen, and
 * then cleared — so a reload before choosing offers the same event, and an
 * event can only ever grant one of its two effects.
 *
 * @typedef {Object} AwayEvent
 * @property {string} id
 * @property {string} title
 * @property {Array<{id: string, label: string, effect: {kind: string, amount: number}, effectText: string}>} options
 *   exactly two distinct choices, each with the one effect it grants
 */

let tickTimer = null;

/**
 * Whether the game is paused because the tab is hidden. While true the tick is
 * stopped and the save's timestamp is the moment the tab went away, so the
 * whole absence is still ahead to be credited. See pauseForHidden.
 */
let pausedForHidden = false;

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

/**
 * The subset of a game state the milestone rules compare. Pure, so the real
 * catch-up, the sandbox and the agent tools all read one comparison instead of
 * keeping a copy that can drift.
 *
 * @param {GameState} s
 * @returns {MilestoneSnapshot}
 */
export function milestoneSnapshot(s) {
  return {
    wood: s.wood,
    upgradeLevel: s.upgradeLevel,
    stone: s.stone,
    wallLevel: s.wallLevel,
    stoneUnlocked: s.stoneUnlocked,
    forgeLevel: s.forgeLevel,
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
 * Which milestones were newly crossed between two states. A milestone counts
 * only when it was not already satisfied before, so a report names what
 * actually opened up rather than what is merely true now.
 *
 * @param {MilestoneSnapshot} before
 * @param {GameState} after
 * @returns {Milestones}
 */
export function milestonesBetween(before, after) {
  return {
    sharpenAvailable: before.upgradeLevel === 0 && before.wood < FIRST_GOAL_WOOD && after.wood >= FIRST_GOAL_WOOD,
    stoneNowUnlocked: before.stoneUnlocked === false && after.stoneUnlocked === true,
    wallAvailable: after.stoneUnlocked && before.wallLevel === 0 && before.stone < WALL_COST && after.stone >= WALL_COST,
    forgeNowUnlocked: before.wallLevel === 0 && after.wallLevel >= 1,
    expeditionNowUnlocked: before.forgeLevel < EXPEDITION_FORGE_LEVEL && after.forgeLevel >= EXPEDITION_FORGE_LEVEL,
  };
}

/**
 * Which milestones the catch-up just crossed, comparing the live state against
 * the snapshot taken before any resource was added.
 *
 * @param {MilestoneSnapshot} before
 * @returns {Milestones}
 */
function computeMilestones(before) {
  return milestonesBetween(before, state);
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
 * The stone-rate rule itself: stone per second for a given lifetime wood total.
 * Unlock is deliberately not part of it, so renderers, the sandbox and the
 * agent tools can project a rate for any state without a second copy of the
 * formula drifting away from the engine's constants.
 */
function computeStoneRateFor(totalWoodEarned) {
  return STONE_BASE_RATE + totalWoodEarned * STONE_RATE_BOOST_FACTOR;
}

/**
 * Compute the current stone accumulation rate based on total wood earned.
 * Only meaningful when stone is unlocked.
 */
function computeStoneRate() {
  if (!state.stoneUnlocked) return 0;
  return computeStoneRateFor(state.totalWoodEarned);
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
 * The expedition-rate rule itself: how much a number of earned maps scales the
 * wood accumulation rate. The per-map step lives only in this constant, so the
 * status panel, the sandbox and the agent tools can all show the multiplier the
 * game would pay instead of hardcoding their own copy of it.
 */
function expeditionMultiplierFor(maps) {
  return 1 + (maps || 0) * EXPEDITION_WOOD_RATE_MULTIPLIER;
}

/**
 * The effective wood rate for any state: its base rate scaled by the maps it has
 * earned. This is the one rule every display reads, so a change to the engine's
 * per-map multiplier moves the page and the tools together.
 */
function effectiveWoodRate(state) {
  return state.rate * expeditionMultiplierFor(state.maps);
}

/**
 * Compute the effective wood accumulation rate including the expedition map multiplier.
 */
function getEffectiveRate() {
  return effectiveWoodRate(state);
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
 * @param {boolean} [record] — whether this catch-up may write the account of
 *   the last return. False still credits the absence and advances the
 *   timestamp, but leaves the account alone, so a return that arrives while an
 *   overlay is already open cannot contradict the panel that overlay is
 *   showing. Even when true the account is only replaced by a genuinely new
 *   trip or a real absence, so a reload before the player has read and
 *   dismissed the panel keeps telling the absence they actually had.
 */
function catchUp(firstVisit, record = true) {
  const kept = state.lastReturn;
  const lastSaved = new Date(state.timestamp).getTime();
  const elapsedSec = (Date.now() - lastSaved) / 1000;

  // Whether this catch-up may write a new account of the last return. A kept,
  // unseen account outlives a reload that credits only the seconds since the
  // last tick: replacing it there would tell the player 'away 3s' instead of
  // the absence they had, and can hide the panel entirely. It is replaced by a
  // genuinely new trip (`firstVisit`), by an account the player already
  // dismissed (`seen`), or by a real absence of at least DISCOVERY_MIN_SEC —
  // the same bar a return must clear to turn up anything, so the account the
  // panel shows and the state this catch-up credited describe one trip.
  const replaceAccount = record
    && (!kept || kept.seen || (!firstVisit && elapsedSec >= DISCOVERY_MIN_SEC));
  // Retire a replaceable account even when no time is credited at all: an
  // immediate tab switch must not leave a dismissed account standing as the
  // last return, waiting to be announced on the next reload.
  if (replaceAccount) state.lastReturn = null;

  if (elapsedSec > 0) {
    // Capture snapshot before resources are added
    const before = milestoneSnapshot(state);
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
    const ownedBefore = state.discoveryId;
    // A find is only credited when it beats everything owned so far; a weaker
    // repeat names itself but must not claim a bonus it did not add.
    const credited = Boolean(discovery && discovery.bonus > state.discoveryBonus);
    // A repeated rung and a weaker rung both added nothing, but they are not the
    // same news: one is already in the collection, the other is outshone by a
    // find the player already owns. The panel words the two differently.
    const alreadyOwned = Boolean(discovery && !credited && discovery.id === ownedBefore);
    if (credited) {
      state.rate += discovery.bonus - state.discoveryBonus;
      state.discoveryBonus = discovery.bonus;
      state.discoveryId = discovery.id;
      state.discoveryName = discovery.name;
    }

    const discoveryRecord = discovery
      ? { id: discovery.id, name: discovery.name, bonus: discovery.bonus, credited, alreadyOwned }
      : null;

    // The decision a real return offers, drawn from the departure alone. An
    // event already waiting is never replaced — a second absence before the
    // first is chosen must not swap out the choice the player is looking at;
    // only choosing clears it. Gated on `record` like the account itself, so a
    // resume that must not contradict an open panel cannot invent a new event.
    const offeredEvent = (record && !firstVisit && elapsedSec >= AWAY_EVENT_MIN_SEC && !state.pendingEvent)
      ? awayEventForElapsed(elapsedSec, state)
      : null;
    // Counted only when a happening is actually set, so the count is the number
    // of decisions a player has really been shown — an absence that finds one
    // already waiting never skips the next entry in the pool.
    if (offeredEvent) {
      state.pendingEvent = offeredEvent;
      state.eventsOffered += 1;
    }

    offlineGained = {
      wood: woodGained,
      stone: stoneGained,
      elapsedSec: elapsedSec,
      discovery: discoveryRecord,
    };

    // The account of this return, recorded once. The wood and stone amounts
    // are the rises the resource counters themselves show, so the panel cannot
    // claim a number the counters disagree with.
    if (replaceAccount) {
      state.lastReturn = {
        firstVisit,
        seen: false,
        elapsedSec,
        wood: displayAmount(displayAmount(state.wood) - displayAmount(beforeWood)),
        stone: displayAmount(displayAmount(state.stone) - displayAmount(beforeStone)),
        discovery: discoveryRecord,
        eventId: offeredEvent ? offeredEvent.id : null,
        chosenOption: null,
        milestones: computeMilestones(before),
      };
    }
    state.timestamp = now();
  }
}

/**
 * The discovery an absence of the given length turns up, or null when the
 * absence is too short or invalid. Pure and deterministic: the same length
 * always yields the same discovery, so it can never be lost or gambled. Past
 * the last fixed rung the generated ladder keeps going, so a longer absence
 * always has a stronger find waiting.
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
  if (elapsedSec > DEEP_FIND_BASE_MIN_SEC) {
    // Thresholds rise with every rung, so the first rung that is out of reach
    // ends the walk; the cap only stops an absurd absence from spinning here.
    for (let k = 1; k <= MAX_GENERATED_RUNGS; k++) {
      const rung = getGeneratedDiscovery(k);
      if (elapsedSec < rung.minSec) break;
      found = rung;
    }
  }
  return found ? { ...found } : null;
}

/**
 * The kind each of an entry's two options will actually offer in this save.
 * Stone is swapped for wood while the stone system is still locked, so an early
 * return never offers a resource the player cannot yet hold; should that swap
 * collide with the entry's other option, the later one becomes a rate bonus
 * instead, keeping the two choices distinct. Pure.
 *
 * @param {[string, string]} kinds
 * @param {{ stoneUnlocked: boolean }} s
 * @returns {[string, string]}
 */
function resolveAwayOptionKinds(kinds, s) {
  const resolved = kinds.map((kind) => (kind === "stone" && !s.stoneUnlocked ? "wood" : kind));
  if (resolved[0] === resolved[1]) resolved[1] = "rate";
  return resolved;
}

/**
 * The permanent wood/s a rate option adds for the state a return is collected
 * in: the fixed share of the effective wood/s, quantised by the page's own
 * amount rule so the figure printed on the button is the figure granted — the
 * property the wood and stone lumps already have. The floor keeps a degenerate
 * (zero or tiny) rate from offering a bonus that adds nothing, so the option
 * stays a real choice even before any growth. Pure.
 *
 * @param {object} s  the state the amount is drawn from
 * @returns {number}
 */
function awayRateBonusFor(s) {
  return Math.max(displayAmount(effectiveWoodRate(s) * AWAY_EVENT_RATE_BONUS_FRACTION), 0.01);
}

/**
 * One choice of an away event: the exact effect choosing it grants and the
 * words that state it. The label and the effect sentence both read the one
 * effect amount, so a choice's promise can never disagree with what choosing
 * it adds. Pure.
 *
 * @param {string} kind  "wood", "stone" or "rate"
 * @param {object} s  the state the amounts are drawn from
 * @returns {{ id: string, label: string, effect: { kind: string, amount: number }, effectText: string }}
 */
function awayOption(kind, s) {
  if (kind === "wood") {
    const amount = displayAmount(effectiveWoodRate(s) * AWAY_EVENT_LUMP_SEC);
    return {
      id: "wood",
      label: `Take +${formatAmount(amount)} wood`,
      effect: { kind: "wood", amount },
      effectText: `Grants +${formatAmount(amount)} wood.`,
    };
  }
  if (kind === "stone") {
    const amount = displayAmount(computeStoneRateFor(s.totalWoodEarned) * AWAY_EVENT_LUMP_SEC);
    return {
      id: "stone",
      label: `Take +${formatAmount(amount)} stone`,
      effect: { kind: "stone", amount },
      effectText: `Grants +${formatAmount(amount)} stone.`,
    };
  }
  const amount = awayRateBonusFor(s);
  return {
    id: "rate",
    label: `Permanent +${formatRate(amount)} wood/s`,
    effect: { kind: "rate", amount },
    effectText: `Permanently adds +${formatRate(amount)} wood/s.`,
  };
}

/**
 * The away event an absence of the given length offers, or null when the
 * absence is shorter than a minute or invalid. Pure and deterministic: the
 * absence and the state's own `eventsOffered` count together pick the pool
 * entry, so consecutive returns of the same length offer different happenings
 * until the pool has cycled, while the same save's sequence is the same
 * sequence every time — nothing is randomised and nothing can be lost. The
 * amounts read the state the player returns to, which a reload reproduces, so a
 * persisted event can be regenerated identically.
 *
 * @param {number} elapsedSec
 * @param {object} s  the state the option amounts are drawn from
 * @returns {AwayEvent|null}
 */
export function awayEventForElapsed(elapsedSec, s) {
  if (!(elapsedSec >= AWAY_EVENT_MIN_SEC)) return null;
  const offset = Number.isFinite(s.eventsOffered) && s.eventsOffered >= 0 ? Math.floor(s.eventsOffered) : 0;
  const entry = AWAY_EVENTS[(Math.floor(elapsedSec) + offset) % AWAY_EVENTS.length];
  return {
    id: entry.id,
    title: entry.title,
    options: resolveAwayOptionKinds(entry.kinds, s).map((kind) => awayOption(kind, s)),
  };
}

/**
 * The away discovery that comes next after the one owned, and the absence
 * length needed to earn it. An account owning nothing is reaching for the
 * first rung; owning a fixed tier reaches for the next fixed tier, and owning
 * the last fixed tier reaches for the first generated rung. The ladder never
 * ends, so a valid save always has something further to find. Only an unknown
 * id — a corrupt save — yields null rather than guessing a rung.
 *
 * @param {string|null|undefined} ownedId
 * @returns {{ id: string, name: string, bonus: number, minSec: number }|null}
 */
export function nextDiscoveryAfter(ownedId) {
  if (!ownedId) return { ...DISCOVERIES[0] };
  const ownedRung = generatedIndex(ownedId);
  if (ownedRung !== null) return getGeneratedDiscovery(ownedRung + 1);
  const ownedIndex = DISCOVERIES.findIndex((tier) => tier.id === ownedId);
  if (ownedIndex === -1) return null;
  const next = DISCOVERIES[ownedIndex + 1];
  return next ? { ...next } : getGeneratedDiscovery(1);
}

/**
 * How many collected rungs the Finds list renders at once. The ladder is
 * endless, so anything older than this is counted into one summary line
 * rather than rendered.
 */
export const FINDS_LIST_LIMIT = 12;

/**
 * The rung at a position in the full ladder, weak to strong. Pure.
 *
 * @param {number} index zero-based position along the ladder
 * @returns {{ id: string, name: string, minSec: number, bonus: number }}
 */
function ladderRungAt(index) {
  return index < DISCOVERIES.length
    ? { ...DISCOVERIES[index] }
    : getGeneratedDiscovery(index - DISCOVERIES.length + 1);
}

/**
 * How many rungs the collection holds when `ownedId` is the strongest find
 * reached. A longer absence reaches every weaker rung below the one it earns,
 * so the collection is exactly the ladder prefix up to that rung. An id that
 * names no rung — a corrupt save — holds nothing.
 *
 * @param {string|null|undefined} ownedId
 * @returns {number}
 */
function collectedRungCount(ownedId) {
  if (!ownedId) return 0;
  const ownedRung = generatedIndex(ownedId);
  if (ownedRung !== null) return DISCOVERIES.length + Math.min(ownedRung, MAX_GENERATED_RUNGS);
  const ownedIndex = DISCOVERIES.findIndex((tier) => tier.id === ownedId);
  return ownedIndex === -1 ? 0 : ownedIndex + 1;
}

/**
 * Every away find kept so far — the strongest rung already stored in the save
 * and every weaker rung below it, in ladder order — plus the next rung still
 * locked. Nothing extra is persisted: the strongest id alone derives the whole
 * prefix, so the collection survives a reload and a portable code for free.
 *
 * The ladder never ends, so `collected` holds at most `limit` rungs (the
 * strongest ones) and `hiddenCount` says how many weaker ones were left off;
 * `total` is the true count. `next` is the rung above the strongest, and null
 * only when the stored id names no rung at all.
 *
 * @param {string|null|undefined} ownedId
 * @param {number} [limit]
 * @returns {{
 *   collected: Array<{id: string, name: string, minSec: number, bonus: number}>,
 *   hiddenCount: number,
 *   total: number,
 *   next: {id: string, name: string, minSec: number, bonus: number}|null,
 * }}
 */
export function discoveryCollection(ownedId, limit = FINDS_LIST_LIMIT) {
  const cap = Math.max(0, Math.floor(limit));
  const total = collectedRungCount(ownedId);
  const shown = Math.min(total, cap);
  const collected = [];
  for (let index = total - shown; index < total; index++) {
    collected.push(ladderRungAt(index));
  }
  return {
    collected,
    hiddenCount: total - shown,
    total,
    next: nextDiscoveryAfter(ownedId),
  };
}

/**
 * The one sentence that names the next away find and the absence it takes, so
 * the status panel and the welcome-back panel word the same rung identically.
 * It reads whatever rung nextDiscoveryAfter produced — the ladder lookup has
 * one home, so no surface can invent a different find. Pure, and null in,
 * null out: a save with no known next rung yields no sentence rather than a
 * dead end.
 *
 * @param {{ id: string, name: string, bonus: number, minSec: number }|null|undefined} next
 * @returns {string|null} the sentence for a valid rung, or null
 */
export function nextAwayFindText(next) {
  if (!next) return null;
  return `Next away find: ${next.name} \u2014 away ${formatElapsed(next.minSec * 1000)}.`;
}

/**
 * The one rule that words a return's find, split into the three parts the
 * welcome-back panel renders: the words before the name (lead), the find's own
 * name, and the words after it (tail). A credited find reads as news and names
 * the wood/s it added; a repeat or an out-classed find has an empty lead, so
 * the sentence can never open by claiming a find the state did not make. Pure,
 * so the panel and the agent tools word the same return identically.
 *
 * @param {{name: string, bonus: number, credited: boolean, alreadyOwned?: boolean}|null} discovery
 * @returns {{lead: string, name: string, tail: string}} the sentence parts
 */
export function returnDiscoveryLine(discovery) {
  if (!discovery) return { lead: "", name: "", tail: "" };
  if (discovery.credited) {
    return {
      lead: "You found the ",
      name: discovery.name,
      tail: `! +${formatRate(discovery.bonus)} wood/s, yours for good.`,
    };
  }
  return {
    lead: "",
    name: discovery.name,
    tail: discovery.alreadyOwned
      ? " is already in your collection \u2014 nothing new added to your rate."
      : " \u2014 you already own a stronger find, so nothing new was added to your rate.",
  };
}

/**
 * The whole sentence that words a return's find — the lead, name and tail of
 * returnDiscoveryLine joined. Pure, and "" when the return turned up no find.
 *
 * @param {{name: string, bonus: number, credited: boolean, alreadyOwned?: boolean}|null} discovery
 * @returns {string} the sentence, or "" when the return turned up no find
 */
export function returnDiscoveryText(discovery) {
  const line = returnDiscoveryLine(discovery);
  return line.lead + line.name + line.tail;
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
 * A persisted return account, or null when what was stored cannot be trusted.
 * A save from before returns were persisted, a hand-edited code, or a
 * truncated record all fall back to null rather than putting an unreadable
 * panel on screen. Milestone flags are coerced to booleans so a partial
 * record renders as 'nothing new' instead of `undefined`.
 *
 * @param {unknown} raw
 * @returns {ReturnRecord|null}
 */
function sanitizeReturnRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Number.isFinite(raw.elapsedSec) || !Number.isFinite(raw.wood) || !Number.isFinite(raw.stone)) return null;
  if (typeof raw.firstVisit !== "boolean" || typeof raw.seen !== "boolean") return null;
  if (raw.discovery != null && typeof raw.discovery !== "object") return null;
  if (!raw.milestones || typeof raw.milestones !== "object") return null;
  const m = raw.milestones;
  return {
    firstVisit: raw.firstVisit,
    seen: raw.seen,
    elapsedSec: raw.elapsedSec,
    wood: raw.wood,
    stone: raw.stone,
    discovery: raw.discovery ?? null,
    eventId: typeof raw.eventId === "string" && raw.eventId !== "" ? raw.eventId : null,
    chosenOption: sanitizeChosenOption(raw.chosenOption),
    milestones: {
      sharpenAvailable: Boolean(m.sharpenAvailable),
      stoneNowUnlocked: Boolean(m.stoneNowUnlocked),
      wallAvailable: Boolean(m.wallAvailable),
      forgeNowUnlocked: Boolean(m.forgeNowUnlocked),
      expeditionNowUnlocked: Boolean(m.expeditionNowUnlocked),
    },
  };
}

/**
 * A persisted record of the option taken from a return's decision, or null when
 * what was stored cannot be trusted. It keeps the option id, the label and the
 * effect sentence the panel showed, plus the effect that was actually granted,
 * so re-opening the account cannot state a different choice from the one whose
 * effect the state already carries.
 *
 * @param {unknown} raw
 * @returns {{id: string, label: string, effect: {kind: string, amount: number}, effectText: string}|null}
 */
function sanitizeChosenOption(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.label !== "string" || typeof raw.effectText !== "string") return null;
  const effect = raw.effect;
  if (!effect || typeof effect !== "object") return null;
  if (effect.kind !== "wood" && effect.kind !== "stone" && effect.kind !== "rate") return null;
  if (!Number.isFinite(effect.amount)) return null;
  return {
    id: raw.id,
    label: raw.label,
    effect: { kind: effect.kind, amount: effect.amount },
    effectText: raw.effectText,
  };
}

/**
 * A deep copy of a pending away event, so a reader — the page, a tool or the
 * sandbox rehearsal — can hold and inspect it without touching the save. The
 * sandbox carries a copy of the event through cloneState, and reusing this one
 * copy of the shape keeps a clone from silently dropping a choice field.
 *
 * @param {AwayEvent|null} event
 * @returns {AwayEvent|null}
 */
export function clonePendingEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    options: event.options.map((option) => ({
      id: option.id,
      label: option.label,
      effect: { ...option.effect },
      effectText: option.effectText,
    })),
  };
}

/**
 * A deep copy of a return account, so a reader — the page, a tool or the
 * sandbox rehearsal — can hold and inspect it without touching the save. The
 * snapshot carries it so a rehearsal projects the same return the page shows
 * (see getState and sandbox.cloneState).
 *
 * @param {ReturnRecord|null} record
 * @returns {ReturnRecord|null}
 */
function cloneReturnRecord(record) {
  if (!record) return null;
  return {
    firstVisit: record.firstVisit,
    seen: record.seen,
    elapsedSec: record.elapsedSec,
    wood: record.wood,
    stone: record.stone,
    discovery: record.discovery ? { ...record.discovery } : null,
    eventId: record.eventId ?? null,
    chosenOption: record.chosenOption
      ? { ...record.chosenOption, effect: { ...record.chosenOption.effect } }
      : null,
    milestones: { ...record.milestones },
  };
}

/**
 * A persisted away event, or null when what was stored cannot be trusted: no
 * title, not exactly two distinct choices, or a choice whose effect is not one
 * finite positive amount of a kind the engine knows how to apply. A corrupt
 * save loses the decision rather than offering a choice that grants nothing —
 * or worse, something the engine cannot grant.
 *
 * @param {unknown} raw
 * @returns {AwayEvent|null}
 */
function sanitizePendingEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.title !== "string" || raw.title === "") return null;
  if (!Array.isArray(raw.options) || raw.options.length !== 2) return null;
  const options = [];
  for (const option of raw.options) {
    if (!option || typeof option !== "object") return null;
    const effect = option.effect;
    if (option.id !== "wood" && option.id !== "stone" && option.id !== "rate") return null;
    if (!effect || effect.kind !== option.id) return null;
    if (!Number.isFinite(effect.amount) || effect.amount <= 0) return null;
    if (typeof option.label !== "string" || typeof option.effectText !== "string") return null;
    options.push({
      id: option.id,
      label: option.label,
      effect: { kind: effect.kind, amount: effect.amount },
      effectText: option.effectText,
    });
  }
  if (options[0].id === options[1].id) return null;
  return { id: raw.id, title: raw.title, options };
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
  state.lastReturn = sanitizeReturnRecord(saved.lastReturn);
  state.pendingEvent = sanitizePendingEvent(saved.pendingEvent);
  state.eventsOffered = Number.isFinite(saved.eventsOffered) && saved.eventsOffered >= 0
    ? Math.floor(saved.eventsOffered)
    : 0;
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
 * Write a resource quantity as text with the amount rule above. This is the one
 * rule every amount on the page is written with — the counters, the welcome-back
 * panel's "you gathered" lines and the goal labels — so the same save reads
 * identically everywhere and changing displayAmount moves them all together.
 *
 * @param {number} v
 * @returns {string}
 */
export function formatAmount(v) {
  return String(displayAmount(v));
}

/**
 * Write a rate (per-second figure) as text: always exactly two decimals, the
 * page's existing convention for a wood/s or stone/s figure. Every rate on the
 * page reads through this one rule, so the status panel, the sandbox and the
 * chips can never write the same rate two different ways.
 *
 * @param {number} rate
 * @returns {string}
 */
export function formatRate(rate) {
  return rate.toFixed(2);
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
 * Stop the game while the tab is hidden. Browsers throttle timers in a hidden
 * tab, so a running tick would credit one simulated second for a call that may
 * be a minute late — and stamp the save as current, dropping the rest of the
 * real gap. Stopping the tick outright means nothing advances the timestamp
 * while the tab is away, so the whole absence is still there for
 * resumeFromHidden to credit in one piece. Idempotent.
 */
export function pauseForHidden() {
  if (pausedForHidden) return;
  pausedForHidden = true;
  stopTick();
  state.timestamp = now();
  persist();
}

/**
 * Resume the game after a hidden spell, crediting the whole real absence
 * through the same catch-up a reload runs — so the counters, the rates and the
 * account a returning player sees are the ones a reload of the same save would
 * have produced.
 *
 * Returns the account of the return for the caller to greet the player with,
 * or null when the tab was never paused, so a stray focus credits nothing and
 * announces nothing.
 *
 * @param {{ record?: boolean }} [options] — record false credits the absence
 *   without replacing the account of the last return.
 * @returns {ReturnType<typeof getReturnSummary>|null}
 */
export function resumeFromHidden({ record = true } = {}) {
  if (!pausedForHidden) return null;
  pausedForHidden = false;
  catchUp(false, record);
  persist();
  startTick();
  return getReturnSummary();
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
 * The wood one chop adds, for a given state: the base chop plus the wall and
 * forge bonuses. This is the one rule the engine's own gather, the page's
 * "+N / chop" card, the Gather Wood button label and the agent's read-state
 * all report, so the number a player is promised is the number they get.
 *
 * @param {{ wallLevel: number, forgeLevel: number }} s
 * @returns {number}
 */
function clickPowerFor(s) {
  return 1 + s.wallLevel * WALL_CLICK_POWER_BONUS + s.forgeLevel * FORGE_CLICK_POWER_BONUS;
}

/**
 * Gather the current chop power in wood instantly (active play action).
 *
 * @returns {GameState} current state after gathering
 */
export function gatherWood() {
  const clickPower = clickPowerFor(state);
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
 * Whether the wall can be built right now: stone is revealed, no wall stands
 * yet, and there is enough stone for one. The one rule the goal panel, the
 * engine's own milestone reports and the read-state tool all compare, so an
 * agent can never be told a wall is buildable while the page disagrees.
 *
 * @param {{ stone: number, stoneUnlocked: boolean, wallLevel: number }} s
 * @returns {boolean}
 */
export function wallAvailable(s) {
  return s.stoneUnlocked && s.wallLevel === 0 && s.stone >= WALL_COST;
}

/**
 * Whether expeditions are unlocked: the forge has been taken far enough. The
 * one rule the engine's refusal, the goal panel and the read-state tool share,
 * so changing the forge gate changes every reader at once.
 *
 * @param {{ forgeLevel: number }} s
 * @returns {boolean}
 */
export function expeditionUnlocked(s) {
  return s.forgeLevel >= EXPEDITION_FORGE_LEVEL;
}

/**
 * The one-resource list for a goal whose bar measures a single amount.
 * `current` is capped at `target`, so a met goal always fills its bar.
 *
 * @param {string} name
 * @param {number} amount
 * @param {number} target
 * @returns {Array<{ name: string, current: number, target: number }>}
 */
function singleGoalResources(name, amount, target) {
  return [{ name, current: displayAmount(Math.min(amount, target)), target }];
}

/**
 * Describe the goal the player is working toward right now — its wording, the
 * numbers that fill its progress bar(s), and whether the action it asks for is
 * available.
 *
 * This is the one rule the goal panel, the welcome-back panel's "next goal"
 * line and the read-state tool all read, so a goal's text, its bar and the
 * button beside it can never tell different stories. The ordering is the
 * game's progression: first goal, sharpen, gather stone, build wall, forge,
 * expedition. Each `resources` entry's `current` is capped at its `target`, so a
 * goal whose action is available never shows a short bar.
 *
 * The legacy fields the tools suite already reads (`progress`, `target`,
 * `cost`, `progressToNext`, `upgradeAvailable`, `wallAvailable`, `canForge`,
 * `canSendExpedition`, `forgeLevel`, `expeditionLevel`) are kept alongside the
 * shared `resources`/`available` shape so the read-state tool's contract does
 * not change.
 *
 * @param {GameState} s
 * @returns {{
 *   type: string,
 *   description: string,
 *   available: boolean,
 *   resources: Array<{ name: string, current: number, target: number }>,
 * }}
 */
export function describeGoal(s) {
  if (s.wood < FIRST_GOAL_WOOD) {
    const resources = singleGoalResources("Wood", s.wood, FIRST_GOAL_WOOD);
    return {
      type: "first-goal",
      description: "Gather " + FIRST_GOAL_WOOD + " wood",
      available: false,
      resources,
      target: FIRST_GOAL_WOOD,
      progress: resources[0].current,
      reached: false,
    };
  }

  if (s.upgradeLevel < 1) {
    const resources = singleGoalResources("Wood", s.wood, UPGRADE_COST);
    return {
      type: "upgrade",
      description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
      available: sharpenAvailable(s),
      resources,
      cost: UPGRADE_COST,
      progressToNext: resources[0].current,
      upgradeAvailable: sharpenAvailable(s),
    };
  }

  if (s.wallLevel < 1 && s.stone < GOAL_STONE) {
    const resources = singleGoalResources("Stone", s.stone, GOAL_STONE);
    return {
      type: "stone-goal",
      description: "Gather " + GOAL_STONE + " stone",
      available: false,
      resources,
      target: GOAL_STONE,
      progress: resources[0].current,
      reached: false,
    };
  }

  if (s.wallLevel < 1) {
    const resources = singleGoalResources("Stone", s.stone, WALL_COST);
    const available = wallAvailable(s);
    return {
      type: "build-wall-goal",
      description: "Build a Wall (" + WALL_COST + " stone)",
      available,
      resources,
      cost: WALL_COST,
      progressToNext: resources[0].current,
      wallAvailable: available,
    };
  }

  if (expeditionUnlocked(s)) {
    const woodTarget = s.expeditionWoodCost;
    const stoneTarget = s.expeditionStoneCost;
    const available = s.wood >= woodTarget && s.stone >= stoneTarget;
    return {
      type: "expedition-goal",
      description: "Send scouts on expedition \u2014 need " + woodTarget + " wood and " + stoneTarget + " stone",
      available,
      resources: [
        { name: "Wood", current: displayAmount(Math.min(s.wood, woodTarget)), target: woodTarget },
        { name: "Stone", current: displayAmount(Math.min(s.stone, stoneTarget)), target: stoneTarget },
      ],
      expeditionLevel: s.expeditionLevel,
      canSendExpedition: available,
    };
  }

  const woodTarget = s.forgeWoodCost;
  const stoneTarget = s.forgeStoneCost;
  const available = s.wood >= woodTarget && s.stone >= stoneTarget;
  return {
    type: "forge-goal",
    description: "Forge a tool \u2014 need " + woodTarget + " wood and " + stoneTarget + " stone",
    available,
    resources: [
      { name: "Wood", current: displayAmount(Math.min(s.wood, woodTarget)), target: woodTarget },
      { name: "Stone", current: displayAmount(Math.min(s.stone, stoneTarget)), target: stoneTarget },
    ],
    forgeLevel: s.forgeLevel,
    canForge: available,
  };
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
 * Each map permanently multiplies the wood accumulation rate additively by
 * EXPEDITION_WOOD_RATE_MULTIPLIER; expeditionMultiplierFor() is the one rule
 * that turns a map count into the factor.
 * Only available after forge level 5.
 *
 * Costs escalate with each expedition level.
 *
 * @returns {{ sent: boolean, reason?: string, state: GameState }}
 */
export function sendExpedition() {
  if (!expeditionUnlocked(state)) {
    return { sent: false, reason: "Reach forge level " + EXPEDITION_FORGE_LEVEL + " before expeditions are available.", state: getState() };
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
 * Choose one option of the pending away event: apply exactly the effect that
 * option states — once — and clear the event, so the other option can never be
 * taken and a second choice is refused. Refuses when no event is pending or the
 * id names no option of it. This is the one place an event's effect is granted,
 * so the page and the agent tools cannot disagree about what choosing grants.
 *
 * @param {string} optionId
 * @returns {{ chosen: boolean, reason?: string, chosenOptionId?: string, effect?: {kind: string, amount: number}, state: GameState }}
 */
export function chooseAwayEventOption(optionId) {
  const event = state.pendingEvent;
  if (!event) {
    return { chosen: false, reason: "There is no away event to choose from.", state: getState() };
  }
  const option = event.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    return { chosen: false, reason: `"${optionId}" is not one of this event's options.`, state: getState() };
  }
  const { kind, amount } = option.effect;
  if (kind === "wood") {
    state.wood += amount;
    state.totalWoodEarned += amount;
  } else if (kind === "stone") {
    state.stone += amount;
    state.totalStoneEarned += amount;
  } else {
    state.rate += amount;
  }
  // Record the choice in the return's own account — but only when this very
  // return offered the event, and only once. A return that never posed a
  // decision must never inherit one, and re-choosing is already refused above.
  if (state.lastReturn && state.lastReturn.eventId === event.id && !state.lastReturn.chosenOption) {
    state.lastReturn.chosenOption = {
      id: option.id,
      label: option.label,
      effect: { kind, amount },
      effectText: option.effectText,
    };
  }
  state.pendingEvent = null;
  persist();
  return { chosen: true, chosenOptionId: option.id, effect: { kind, amount }, state: getState() };
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
 * and a sub-second reload show no panel. `seen` is false until the player
 * dismisses the panel, which is what lets a reload before that re-show the
 * same real absence instead of the seconds since the last tick.
 *
 * @returns {{
 *   visible: boolean,
 *   seen: boolean,
 *   firstVisit: boolean,
 *   elapsedSec: number,
 *   elapsed: string,
 *   wood: number,
 *   stone: number,
 *   discovery: {id: string, name: string, bonus: number, credited: boolean, alreadyOwned: boolean}|null,
 *   chosenOption: {id: string, label: string, effect: {kind: string, amount: number}, effectText: string}|null,
 *   pendingEvent: AwayEvent|null,
 *   nextDiscovery: {id: string, name: string, bonus: number, minSec: number}|null,
 *   milestones: Milestones,
 * }}
 */
export function getReturnSummary() {
  const ret = state.lastReturn;
  if (!ret) {
    return {
      visible: false,
      seen: true,
      firstVisit: true,
      elapsedSec: 0,
      elapsed: formatElapsed(0),
      wood: 0,
      stone: 0,
      discovery: null,
      chosenOption: null,
      pendingEvent: clonePendingEvent(state.pendingEvent),
      nextDiscovery: nextDiscoveryAfter(state.discoveryId),
      milestones: { sharpenAvailable: false, stoneNowUnlocked: false, wallAvailable: false, forgeNowUnlocked: false, expeditionNowUnlocked: false },
    };
  }
  return {
    visible: !ret.firstVisit && ret.elapsedSec >= RETURN_MIN_SEC,
    seen: ret.seen,
    firstVisit: ret.firstVisit,
    elapsedSec: ret.elapsedSec,
    elapsed: formatElapsed(ret.elapsedSec * 1000),
    wood: ret.wood,
    stone: ret.stone,
    discovery: ret.discovery,
    chosenOption: ret.chosenOption ?? null,
    pendingEvent: clonePendingEvent(state.pendingEvent),
    nextDiscovery: nextDiscoveryAfter(state.discoveryId),
    milestones: ret.milestones,
  };
}

/**
 * Mark the last return's account as seen and persist it. This is the one place
 * the flag flips, so the page and the read tools cannot disagree about whether
 * the player has been shown the account.
 */
export function markReturnSeen() {
  if (!state.lastReturn || state.lastReturn.seen) return;
  state.lastReturn.seen = true;
  persist();
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
    finds: discoveryCollection(state.discoveryId),
    pendingEvent: clonePendingEvent(state.pendingEvent),
    lastReturn: cloneReturnRecord(state.lastReturn),
    eventsOffered: state.eventsOffered,
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
    lastReturn: null,
    pendingEvent: null,
    eventsOffered: 0,
  };
  offlineGained = { wood: 0, stone: 0, elapsedSec: 0, discovery: null };
  snapshotBeforeCatchUp = null;
  pausedForHidden = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Teardown ─────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    // A tab closed while hidden keeps the timestamp pauseForHidden saved at
    // hide time: stamping it as "now" here would throw away the whole absence
    // the player is about to be credited for when they come back.
    if (pausedForHidden) return;
    state.timestamp = now();
    persist();
  });
}