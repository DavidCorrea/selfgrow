import { registerAutomaton } from '../engine/registry.js';

/**
 * The Archivist — a non-pursuit automaton that lives in the Gear Gallery.
 *
 * Unlike the Sentinel, the Archivist never moves and never attacks. Instead
 * it observes: each turn the player spends in the Gear Gallery, it watches
 * the pressure dial. If pressure is above 60 at the end of the turn, it
 * records a report to the machine. When the player descends, every recorded
 * report brings the Sentinel one position closer in the next gallery — so
 * high pressure here makes the next gallery harder.
 *
 * The player can outmanoeuvre it by keeping pressure controlled: at or below
 * 60 the Archivist stays still and the Sentinel arrives at its normal
 * distance. The rules are deterministic and communicated through describe().
 */
registerAutomaton('archivist', {
  name: 'The Archivist',

  /**
   * Describe the Archivist's current state. Returns an empty string when the
   * Archivist is not active (player not in the Gear Gallery).
   *
   * The description communicates the player's standing with the machine: a
   * high pressure dial means the Archivist is watching and will remember;
   * otherwise it remains still, its lenses dark.
   */
  describe(state) {
    const archivist = state.archivistState;
    if (!archivist || !archivist.active) return '';

    if (state.pressure > 60) {
      return 'The Archivist watches you through brass lenses. Your pressure is high — it will remember.';
    }
    return 'The Archivist is still, its lenses dark.';
  },

  /**
   * Observe the turn's pressure. Only applies while active (player in the
   * Gear Gallery). When pressure exceeds 60, the Archivist records a report.
   * Reports accumulate across turns and are applied to the Sentinel's
   * position when the player descends to the next gallery.
   */
  act(state) {
    const archivist = state.archivistState;
    if (!archivist || !archivist.active) return;

    if (state.pressure > 60) {
      archivist.reports += 1;
    }
  },

  /**
   * Initialise the Archivist's state for a new descent.
   * Starts inactive — the Archivist only activates in the Gear Gallery.
   */
  initialize(state) {
    state.archivistState = {
      active: false,
      reports: 0,
    };
  },
});