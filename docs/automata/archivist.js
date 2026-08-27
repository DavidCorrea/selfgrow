/**
 * The Archivist — a non-pursuit automaton that records the player's choices.
 *
 * Unlike the Sentinel (which pursues) and the Winder (which modifies pressure
 * rates), the Archivist does not chase the player and does not directly affect
 * pressure. Instead, it tallies every device use and every wait action:
 *
 *   - Each device use increments the counter.
 *   - Each wait resets the counter to 0.
 *
 * When the counter reaches 3 (three consecutive device uses without a wait),
 * the Archivist 'reports' to the machine, causing the Sentinel to advance
 * by 1 extra step on its next act (the same turn). The counter then resets.
 *
 * The Archivist's behaviour is fully legible — its describe() tells the
 * player the current count and what will happen at the threshold, so the
 * player can strategise around it.
 */
import { registerAutomaton } from '../engine/registry.js';

registerAutomaton('archivist', {
  name: 'The Archivist',

  /**
   * Describe the Archivist's current tally and what it will do next.
   * The machine explains itself so the player can reason about when to wait.
   * Returns an informative string when the Archivist is active and has been
   * tracking, otherwise a brief presence statement.
   */
  describe(state) {
    const arch = state.archivistState;
    if (!arch) return 'The Archivist watches from the shadows.';

    const count = arch.counter;
    const threshold = 3;
    const remaining = threshold - count;

    if (count === 0) {
      return `The Archivist notes your stillness — device count at 0. It watches ${remaining} more use${remaining === 1 ? '' : 's'} before reporting to the Sentinel.`;
    }

    if (remaining === 0) {
      return 'The Archivist has reported your activity to the machine. The Sentinel will advance faster.';
    }

    return `The Archivist tallies ${count} device use${count === 1 ? '' : 's'} since you last waited. ${remaining} more use${remaining === 1 ? '' : 's'} and it will report to the Sentinel.`;
  },

  /**
   * Act on the Archivist's turn. This is called after the player action but
   * before the Sentinel acts. If a report is pending (the counter reached the
   * threshold), the Archivist applies an extra +1 advance to the Sentinel by
   * decrementing its position, then clears the pending flag.
   *
   * The counter management (increment on device use, reset on wait, trigger
   * at threshold) is handled by the game engine before this is called.
   */
  act(state) {
    const arch = state.archivistState;
    if (!arch || !arch.reportPending) return;

    // Apply the extra advance — +1 step for the Sentinel
    state.automatonState.position -= 1;

    // Clear the pending flag so it only applies once
    arch.reportPending = false;
  },

  /**
   * Initialise the Archivist's state for a new descent.
   * The counter starts at 0 with no pending report.
   */
  initialize(state) {
    state.archivistState = {
      counter: 0,
      reportPending: false,
    };
  },
});
