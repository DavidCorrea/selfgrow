import { registerAutomaton } from '../engine/registry.js';

/**
 * The Archivist — a non-pursuit automaton that lives in the Gear Gallery.
 *
 * Unlike the Sentinel (which chases) and the Winder (which modifies pressure
 * rate), the Archivist does not move or attack. Instead it observes the
 * player's pressure each turn and records it. If the player's pressure
 * exceeds 60 while in the Gear Gallery, the Archivist increments its
 * recordedHigh counter. When the player descends from the Gear Gallery,
 * the recordedHigh is applied as a penalty: the Sentinel starts 1 position
 * closer for each turn pressure was above 60 (cumulative, min Sentinel
 * position 1).
 *
 * This creates meaningful risk-reward tension: use devices to spend pressure
 * and stay below 60, or let pressure build and face a harder next gallery.
 * The player can outmanoeuvre the Archivist by keeping pressure controlled.
 *
 * Implements the Vision principle that 'an automaton is a mind, not a
 * difficulty number' — the Archivist wants to observe and report, by rules
 * the player can learn and anticipate.
 */
registerAutomaton('archivist', {
  name: 'The Archivist',

  /**
   * Describe the Archivist's current state.
   * Returns text only when active (player is in the Gear Gallery).
   * The description communicates whether the Archivist is observing high
   * pressure or sitting idle — telegraphing to the player what it will
   * report back to the machine.
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
   * Act on the Archivist's turn. Only active when the player is in the
   * Gear Gallery. Observes the player's current pressure — if it exceeds
   * 60, increments recordedHigh so the Sentinel starts closer in the next
   * gallery.
   */
  act(state) {
    const archivist = state.archivistState;
    if (!archivist || !archivist.active) return;

    if (state.pressure > 60) {
      archivist.recordedHigh += 1;
    }
  },

  /**
   * Initialise the Archivist's state for a new descent.
   * Starts inactive — becomes active only when the player enters the
   * Gear Gallery.
   */
  initialize(state) {
    state.archivistState = {
      active: false,
      recordedHigh: 0,
    };
  },
});