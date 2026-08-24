import { registerAutomaton } from '../engine/registry.js';

registerAutomaton('sentinel', {
  name: 'The Sentinel',

  /** Describe the Sentinel's current status relative to the player. */
  describe(state) {
    const dist = state.automatonState.position;
    if (dist <= 0) return 'The Sentinel is upon you.';
    if (dist === 1) return 'The Sentinel is right next to you — one more step and it will reach you.';
    if (dist <= 3) return `The Sentinel is ${dist} turn${dist === 1 ? '' : 's'} away, advancing steadily.`;
    return `The Sentinel is ${dist} turns away, approaching from the darkness ahead.`;
  },

  /**
   * The Sentinel acts on its turn. It advances one position toward the player.
   * This is deterministic — given the same state it always does the same thing.
   */
  act(state) {
    state.automatonState.position -= 1;
  },

  /** Initialise the Sentinel's state for a new descent. */
  initialize(state) {
    state.automatonState = { position: 5 };
  },
});