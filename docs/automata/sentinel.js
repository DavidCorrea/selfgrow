import { registerAutomaton } from '../engine/registry.js';

registerAutomaton('sentinel', {
  name: 'The Sentinel',

  /** Describe the Sentinel's current status relative to the player. */
  describe(state) {
    const dist = state.automatonState.position;
    const patternStep = state.automatonState.patternStep;
    const isBurst = patternStep === 0;

    const advancement = isBurst
      ? 'It is advancing rapidly — 2 steps this turn.'
      : 'It is winding its gears, pausing for a turn.';

    if (dist <= 0) return 'The Sentinel is upon you.';
    if (dist === 1) return `The Sentinel is right next to you — one more step and it will reach you. ${advancement}`;
    if (dist <= 3) return `The Sentinel is ${dist} turn${dist === 1 ? '' : 's'} away, advancing steadily. ${advancement}`;
    return `The Sentinel is ${dist} turns away, approaching from the darkness ahead. ${advancement}`;
  },

  /**
   * The Sentinel acts on its turn. It follows a repeating pattern:
   * burst turn (2 steps forward) then pause turn (0 steps, winding its gears).
   * This is deterministic — given the same state it always does the same thing.
   */
  act(state) {
    const patternStep = state.automatonState.patternStep;

    if (patternStep === 0) {
      // Burst turn: advance 2 positions
      state.automatonState.position -= 2;
    }
    // patternStep === 1: Pause turn — advance 0 positions

    // Advance the pattern: 0 -> 1 -> 0 -> 1 -> ...
    state.automatonState.patternStep = patternStep === 0 ? 1 : 0;
  },

  /** Initialise the Sentinel's state for a new descent. */
  initialize(state) {
    // The machine's memory of the last descent influences the starting position.
    // If the Sentinel cornered the player, it starts further away (position 6),
    // as if it is being patient. If the player ruptured, it starts closer
    // (position 4), as if agitated by the machine's strain.
    const lastOutcome = state.memory ? state.memory.lastOutcome : 'none';
    const descents = state.memory ? state.memory.descents : 0;

    let position = 5; // default
    if (descents > 0) {
      if (lastOutcome === 'cornered') {
        position = 6;
      } else if (lastOutcome === 'rupture') {
        position = 4;
      }
    }

    state.automatonState = {
      position,
      patternStep: 0,  // 0 = burst (advance 2), 1 = pause (advance 0)
    };
  },
});