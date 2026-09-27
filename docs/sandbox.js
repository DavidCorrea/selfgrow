/**
 * sandbox.js — time rehearsal sandbox for selfgrow.
 *
 * Clones the current game state into an isolated copy, then fast-forwards
 * through simulated time. Nothing done in the sandbox ever reaches the real save.
 *
 * @module sandbox
 */

// ─── Internal constants (mirror engine.js values) ───
const STONE_BASE_RATE = 0.05;
const STONE_RATE_BOOST_FACTOR = 0.001;
const EXPEDITION_WOOD_RATE_MULTIPLIER = 0.05;

/**
 * Deep-clone a game state object for isolated sandbox use.
 *
 * @param {import("./engine.js").GameState} state
 * @returns {import("./engine.js").GameState}
 */
export function cloneState(state) {
  return {
    wood: state.wood,
    rate: state.rate,
    upgradeLevel: state.upgradeLevel,
    stone: state.stone,
    totalWoodEarned: state.totalWoodEarned,
    totalStoneEarned: state.totalStoneEarned,
    wallLevel: state.wallLevel,
    forgeLevel: state.forgeLevel,
    forgeWoodCost: state.forgeWoodCost,
    forgeStoneCost: state.forgeStoneCost,
    expeditionLevel: state.expeditionLevel,
    maps: state.maps,
    expeditionWoodCost: state.expeditionWoodCost,
    expeditionStoneCost: state.expeditionStoneCost,
    stoneUnlocked: state.stoneUnlocked,
    timestamp: state.timestamp,
    firstTimestamp: state.firstTimestamp,
  };
}

/**
 * Compute stone rate for a given clone state.
 * @param {import("./engine.js").GameState} clone
 * @returns {number}
 */
function computeStoneRate(clone) {
  if (!clone.stoneUnlocked) return 0;
  return STONE_BASE_RATE + clone.totalWoodEarned * STONE_RATE_BOOST_FACTOR;
}

/**
 * Compute effective wood rate including expedition map multiplier.
 * @param {import("./engine.js").GameState} clone
 * @returns {number}
 */
function getEffectiveRate(clone) {
  const expeditionMultiplier = 1 + clone.maps * EXPEDITION_WOOD_RATE_MULTIPLIER;
  return clone.rate * expeditionMultiplier;
}

/**
 * Fast-forward a sandbox clone by a given number of simulated seconds.
 *
 * Mutates the clone in place and returns the projected resource deltas.
 * Milestones are tracked by comparing before/after snapshots.
 *
 * @param {import("./engine.js").GameState} clone — mutated in place
 * @param {number} seconds — how many seconds to simulate
 * @returns {{
 *   woodDelta: number,
 *   stoneDelta: number,
 *   totalWood: number,
 *   totalStone: number,
 *   milestones: import("./engine.js").Milestones,
 * }}
 */
export function fastForward(clone, seconds) {
  const beforeWood = clone.totalWoodEarned;
  const beforeStone = clone.totalStoneEarned;
  const beforeUpgrade = clone.upgradeLevel;
  const beforeStoneUnlocked = clone.stoneUnlocked;
  const beforeWall = clone.wallLevel;
  const beforeForge = clone.forgeLevel;

  // Simulate passive accumulation at current rates
  const effectiveRate = getEffectiveRate(clone);
  const woodGained = effectiveRate * seconds;
  clone.wood += woodGained;
  clone.totalWoodEarned += woodGained;

  let stoneGained = 0;
  if (clone.stoneUnlocked) {
    stoneGained = computeStoneRate(clone) * seconds;
    clone.stone += stoneGained;
    clone.totalStoneEarned += stoneGained;
  }

  // Detect milestones crossed
  const sharpenAvailable = beforeUpgrade === 0 && clone.totalWoodEarned >= 10;
  const stoneNowUnlocked = beforeStoneUnlocked === false && clone.stoneUnlocked === true;
  const wallAvailable = clone.stoneUnlocked && beforeWall === 0 && clone.stone >= 5;
  const forgeNowUnlocked = beforeWall === 0 && clone.wallLevel >= 1;
  const expeditionNowUnlocked = beforeForge < 5 && clone.forgeLevel >= 5;

  return {
    woodDelta: woodGained,
    stoneDelta: stoneGained,
    totalWood: clone.wood,
    totalStone: clone.stone,
    milestones: {
      sharpenAvailable,
      stoneNowUnlocked,
      wallAvailable,
      forgeNowUnlocked,
      expeditionNowUnlocked,
    },
  };
}