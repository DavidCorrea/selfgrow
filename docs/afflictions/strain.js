import { registerAffliction } from '../engine/registry.js';

registerAffliction('strain', {
  name: 'Strain',

  /** Describe the affliction's current effect on the machine. */
  describe(state) {
    return 'The local pipes are strained from excessive pressure use. Pressure accumulates +2 faster in this gallery.';
  },

  /**
   * Apply the affliction's effect to the game state.
   * Strain increases the pressure accumulation rate by +2.
   */
  apply(state) {
    state.pressureAccumulationRate += 2;
  },
});