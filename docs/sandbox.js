/**
 * sandbox.js — time rehearsal sandbox for selfgrow.
 *
 * Clones the current game state into an isolated copy, then fast-forwards
 * through simulated time. Nothing done in the sandbox ever reaches the real save.
 *
 * @module sandbox
 */

import { discoverForElapsed, computeStoneRateFor, effectiveWoodRate, milestoneSnapshot, milestonesBetween } from "./engine.js";

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
    discovery: state.discovery ? { ...state.discovery } : null,
    discoveryBonus: state.discovery?.bonus ?? 0,
    discoveryId: state.discovery?.id ?? null,
    discoveryName: state.discovery?.name ?? null,
    timestamp: state.timestamp,
    firstTimestamp: state.firstTimestamp,
  };
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
 *   seconds: number,
 *   discovery: { id: string, name: string, bonus: number, credited: boolean }|null,
 *   woodDelta: number,
 *   stoneDelta: number,
 *   totalWood: number,
 *   totalStone: number,
 *   milestones: import("./engine.js").Milestones,
 * }}
 */
export function fastForward(clone, seconds) {
  // The engine's own comparison input, captured before any resource is added,
  // so a rehearsal announces the same milestones a real return would.
  const before = milestoneSnapshot(clone);

  // Simulate passive accumulation at current rates, using the engine's own
  // effective-rate rule so a rehearsal can never promise a rate the game would
  // not pay. Wood and stone are credited before any find, so the earnings are
  // exactly rate * seconds and a stronger find only ever raises the rate for
  // time yet to come — the same order the real catch-up uses.
  const effectiveRate = effectiveWoodRate(clone);
  const woodGained = effectiveRate * seconds;
  clone.wood += woodGained;
  clone.totalWoodEarned += woodGained;

  // The projected stone rate is the engine's own rule, applied to the clone, so
  // a rehearsal can never promise a rate the game would not pay.
  let stoneGained = 0;
  if (clone.stoneUnlocked) {
    stoneGained = computeStoneRateFor(clone.totalWoodEarned) * seconds;
    clone.stone += stoneGained;
    clone.totalStoneEarned += stoneGained;
  }

  // A rehearsal must turn up what a real absence of the same length would, so
  // this calls the engine's own rule rather than keeping a second ladder. The
  // bonus is credited only when it beats what the clone already owns.
  const found = discoverForElapsed(seconds);
  const credited = Boolean(found && found.bonus > clone.discoveryBonus);
  if (credited) {
    clone.rate += found.bonus - clone.discoveryBonus;
    clone.discoveryBonus = found.bonus;
    clone.discoveryId = found.id;
    clone.discoveryName = found.name;
  }
  const discovery = found
    ? { id: found.id, name: found.name, bonus: found.bonus, credited }
    : null;

  return {
    seconds,
    discovery,
    woodDelta: woodGained,
    stoneDelta: stoneGained,
    totalWood: clone.wood,
    totalStone: clone.stone,
    milestones: milestonesBetween(before, clone),
  };
}