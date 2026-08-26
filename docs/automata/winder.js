import { registerAutomaton } from '../engine/registry.js';

/**
 * The Winder — a non-pursuit automaton that lives in the Boiler Room.
 *
 * Unlike the Sentinel, the Winder does not chase the player. Instead it
 * tightens pressure valves in the gallery it occupies, increasing the
 * pressure accumulation rate while the player is present.
 *
 * Behaviour: follows a predictable 3-wind, 1-rest pattern.
 *   - tick 0, 1, 2: winding (adds +3 to the base accumulation rate)
 *   - tick 3:       resting (rate stays at the base 5)
 *
 * The player can observe the cycle and choose to wait it out, descend
 * quickly, or use a device to distract it.
 */
registerAutomaton('winder', {
  name: 'The Winder',

  /**
   * Describe the Winder's current status and what it will do next.
   * The machine explains itself so the player can reason about the pattern.
   * Returns an empty string when the Winder is not active.
   */
  describe(state) {
    const winder = state.winderState;
    if (!winder || !winder.active) return '';

    const isWinding = winder.tick < 3;

    if (isWinding) {
      const turnsRemaining = 3 - winder.tick; // 3, 2, or 1
      const plural = turnsRemaining === 1 ? '' : 's';
      const verb = turnsRemaining === 1 ? 's' : '';
      return `The Winder is winding the pressure valves (${turnsRemaining} winding turn${plural} remain${verb} before it rests). Pressure is building faster.`;
    }

    // tick === 3: rest phase
    return 'The Winder rests, its valves still. Pressure will accumulate at the base rate this turn, but it will resume winding next turn.';
  },

  /**
   * Act on the Winder's turn. Only applies when the Winder is active
   * (player is in the Boiler Room).
   *
   * The base rate is always reset to 5 by the game engine before this
   * is called. This method adds +3 during winding phases.
   */
  act(state) {
    const winder = state.winderState;
    if (!winder || !winder.active) return;

    // Apply current phase effect
    if (winder.tick < 3) {
      // Winding phase: increase pressure accumulation rate
      state.pressureAccumulationRate += 3;
    }
    // tick === 3: rest phase, rate stays at the base 5

    // Advance to the next phase in the 4-step cycle
    winder.tick = (winder.tick + 1) % 4;
  },

  /**
   * Initialise the Winder's state for a new descent.
   * Starts inactive — the Winder only activates when the player enters
   * the Boiler Room.
   */
  initialize(state) {
    // Machine memory affects starting tick: if the last descent ended in
    // rupture (player died to pressure), the machine was overworked and the
    // Winder starts mid-cycle (tick 2) so pressure builds faster from the start.
    const lastOutcome = state.memory && state.memory.lastOutcome;
    const startTick = lastOutcome === 'rupture' ? 2 : 0;

    state.winderState = {
      active: false,
      tick: startTick, // 0-2 = winding, 3 = resting
    };
  },
});