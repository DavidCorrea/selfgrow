import { registerAffliction } from '../engine/registry.js';

/**
 * Strain — a pressure-related affliction.
 *
 * When the player spends more than 20 pressure on devices in a single gallery
 * without descending, the machine's local pipes strain under the load and the
 * pressure accumulation rate rises by +2 for the remainder of that gallery.
 * Descending relieves the strain: the affliction and the per-gallery spend
 * counter both reset.
 *
 * Self-contained module: registers itself with the registry, exactly like the
 * device, gallery, and automaton modules.
 */
registerAffliction('strain', {
  id: 'strain',
  name: 'Strain',

  /** Describe what the strain is doing to the machine right now. */
  describe(state) {
    const rate = state ? state.pressureAccumulationRate : null;
    const rateText = typeof rate === 'number' ? ` (rate now +${rate})` : '';
    return `The machine's local pipes are strained from your heavy device use — pressure accumulates +2 faster each turn${rateText}.`;
  },

  /**
   * Apply the affliction's effect: raise the pressure accumulation rate.
   * The engine recomputes the rate from its base value each turn and then
   * calls apply() for every active affliction, so this adds +2 onto the
   * current turn's rate while the affliction remains active.
   */
  apply(state) {
    state.pressureAccumulationRate += 2;
  },

  /**
   * Reset the affliction: relieve the strain by removing it from the active
   * afflictions list. The engine calls this when the player descends, since
   * Strain is per-gallery.
   */
  reset(state) {
    if (Array.isArray(state.afflictions)) {
      state.afflictions = state.afflictions.filter((id) => id !== this.id);
    }
  },
});