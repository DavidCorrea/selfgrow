/**
 * sandbox.js — time rehearsal sandbox for selfgrow.
 *
 * Clones the current game state into an isolated copy, then fast-forwards
 * through simulated time. Nothing done in the sandbox ever reaches the real save.
 *
 * @module sandbox
 */

import { discoverForElapsed, awayEventForElapsed, computeStoneRateFor, effectiveWoodRate, milestoneSnapshot, milestonesBetween, applyAwayOptionToState } from "./engine.js";

/**
 * Deep-copy a value so a rehearsal holds its own copy of everything the save
 * tracks — nested objects and arrays included — and can never write through to
 * the real save. Only the JSON-shaped values a save carries are expected.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === "object") {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = deepClone(value[key]);
    return copy;
  }
  return value;
}

/**
 * Deep-clone a game state object for isolated sandbox use.
 *
 * The clone is built from the engine's own full state snapshot rather than a
 * hand-retyped field list, so every field the game tracks — the Finds list,
 * the pending decision and the last return's account included — is present in
 * a rehearsal, and a field the engine later adds appears here for free (see
 * engine.getState).
 *
 * @param {import("./engine.js").GameState} state
 * @returns {import("./engine.js").GameState}
 */
export function cloneState(state) {
  return deepClone(state);
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
 *   event: import("./engine.js").AwayEvent|null,
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
  // bonus is credited only when it beats what the clone already owns. The
  // snapshot carries the owned find as a nested `discovery`, the same shape the
  // page and the tools read, so the clone never keeps a second copy of it.
  const found = discoverForElapsed(seconds);
  const ownedBonus = clone.discovery ? clone.discovery.bonus : 0;
  const credited = Boolean(found && found.bonus > ownedBonus);
  if (credited) {
    clone.rate += found.bonus - ownedBonus;
    clone.discovery = { id: found.id, name: found.name, bonus: found.bonus };
  }
  const discovery = found
    ? { id: found.id, name: found.name, bonus: found.bonus, credited }
    : null;

  // A real return of a minute or more also offers a decision, so a rehearsal
  // that stopped at the find would no longer stand in for the return it
  // projects. A decision already waiting is never replaced — the engine's own
  // catch-up derives a new happening only when none is pending — so the
  // rehearsal shows the choice the player is actually looking at, and derives
  // one only when nothing is waiting. A derived event reads the state the
  // player returns to, after the earnings and the find have been credited,
  // exactly the order a real catch-up uses, so the amounts match.
  const event = clone.pendingEvent ?? awayEventForElapsed(seconds, clone);

  return {
    seconds,
    discovery,
    event,
    woodDelta: woodGained,
    stoneDelta: stoneGained,
    totalWood: clone.wood,
    totalStone: clone.stone,
    milestones: milestonesBetween(before, clone),
  };
}

/**
 * Rehearse one option of an away event against an isolated clone: apply the
 * option's effect with the engine's own rule, clear the clone's pending event
 * so a second rehearsal starts from a clean choice, and report where the option
 * leads. Mutates only the clone passed in — the real save is never reachable
 * from here — so a player can compare the two outcomes before spending the real
 * choice. Returns null when the id names no option of the event.
 *
 * @param {import("./engine.js").GameState} clone — mutated in place
 * @param {import("./engine.js").AwayEvent} event
 * @param {string} optionId
 * @returns {{
 *   optionId: string,
 *   label: string,
 *   effect: {kind: string, amount: number},
 *   wood: number,
 *   stone: number,
 *   woodRate: number,
 *   stoneRate: number,
 *   rehearsal: boolean,
 * }|null}
 */
export function rehearseAwayChoice(clone, event, optionId) {
  const option = event.options.find((candidate) => candidate.id === optionId);
  if (!option) return null;
  const effect = applyAwayOptionToState(clone, option);
  // The clone no longer owes the choice it just rehearsed, so a second
  // rehearsal against the same clone is a fresh decision rather than a repeat.
  clone.pendingEvent = null;
  return {
    optionId: option.id,
    label: option.label,
    effect,
    wood: clone.wood,
    stone: clone.stone,
    // The rates the engine's own rules pay for the clone as it now stands, so a
    // projection can never promise a rate the game would not grant.
    woodRate: effectiveWoodRate(clone),
    stoneRate: clone.stoneUnlocked ? computeStoneRateFor(clone.totalWoodEarned) : 0,
    rehearsal: true,
  };
}
