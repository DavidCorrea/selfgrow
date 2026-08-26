import { registerAutomaton } from '../engine/registry.js';

/**
 * Read the machine's current mood from the player's pressure.
 * Pressure is the whole game: when it runs high the Sentinel is agitated and
 * relentless; when it runs low the Sentinel is calm and lingers.
 */
function pressureMode(pressure) {
  if (pressure >= 70) return 'agitated';
  if (pressure <= 30) return 'calm';
  return 'normal';
}

registerAutomaton('sentinel', {
  name: 'The Sentinel',

  /** Describe the Sentinel's current status relative to the player. */
  describe(state) {
    const dist = state.automatonState.position;
    const patternStep = state.automatonState.patternStep;
    const isBurst = patternStep === 0;
    const mode = pressureMode(state.pressure);

    // The behaviour text tells the player what the Sentinel will do next so
    // the machine's mind can be read and reasoned about.
    let behavior;
    if (mode === 'agitated') {
      behavior = 'The machine is agitated — the Sentinel advances relentlessly, ' +
        'taking 2 steps every turn with no pause.';
    } else if (mode === 'calm') {
      behavior = isBurst
        ? 'The machine is calm — the Sentinel takes 2 steps, then winds its ' +
          'gears and pauses for two full turns.'
        : 'The machine is calm — the Sentinel winds its gears and lingers, ' +
          'pausing for an extra turn.';
    } else {
      behavior = isBurst
        ? 'It is advancing rapidly — 2 steps this turn.'
        : 'It is winding its gears, pausing for a turn.';
    }

    if (dist <= 0) return `The Sentinel is upon you. ${behavior}`;
    if (dist === 1) return `The Sentinel is right next to you — one more step and it will reach you. ${behavior}`;
    if (dist <= 3) return `The Sentinel is ${dist} turn${dist === 1 ? '' : 's'} away, advancing steadily. ${behavior}`;
    return `The Sentinel is ${dist} turns away, approaching from the darkness ahead. ${behavior}`;
  },

  /**
   * The Sentinel acts on its turn. Its pattern follows the machine's mood,
   * which derives from the player's current pressure:
   *
   *  - agitated  (pressure ≥ 70): advances 2 on EVERY turn, no pause;
   *  - calm      (pressure ≤ 30): advances 2 on a burst, then pauses for two
   *              consecutive turns instead of one;
   *  - normal    (pressure 31–69): the classic burst (2) then pause (0) loop.
   *
   * patternStep counts how many winding turns remain: 0 means the next act is
   * a burst, 1 means a single pause, 2 means two pauses. This keeps the whole
   * machine deterministic — given the same state it always does the same thing.
   */
  act(state) {
    const patternStep = state.automatonState.patternStep;
    const mode = pressureMode(state.pressure);

    if (mode === 'agitated') {
      // Relentless: advance 2 on every turn, never winding its gears.
      state.automatonState.position -= 2;
      state.automatonState.patternStep = 0;
      return;
    }

    if (patternStep === 0) {
      // Burst turn: advance 2 positions, then wind for 1 (normal) or 2 (calm) turns.
      state.automatonState.position -= 2;
      state.automatonState.patternStep = mode === 'calm' ? 2 : 1;
      return;
    }

    // Winding/pause turn: advance 0 positions.
    state.automatonState.patternStep -= 1;
  },

  /** Initialise the Sentinel's state for a new descent. */
  initialize(state) {
    // The machine's memory of the last descent influences the starting position.
    // Device usage counts refine this: if the vent was used 3+ times, the
    // Sentinel starts farther (position 6), cautious of that device. If the
    // steam-cloak was used at all, it starts closer (position 4), as it was
    // evaded last time. These take precedence over outcome-based defaults.
    const lastOutcome = state.memory ? state.memory.lastOutcome : 'none';
    const descents = state.memory ? state.memory.descents : 0;
    const deviceUsage = state.memory ? (state.memory.deviceUsage || {}) : {};

    let position = 5; // default

    // Device usage adaptation takes precedence over outcome-based defaults
    if ((deviceUsage.vent || 0) >= 3) {
      // Vent used 3+ times last descent — Sentinel is cautious, starts farther
      position = 6;
    } else if ((deviceUsage['steam-cloak'] || 0) > 0) {
      // Steam Cloak was used — Sentinel starts closer, as it was evaded
      position = 4;
    } else if (descents > 0) {
      // Fall back to outcome-based defaults when no usage data applies
      if (lastOutcome === 'cornered') {
        position = 6;
      } else if (lastOutcome === 'rupture') {
        position = 4;
      } else if (lastOutcome === 'escaped') {
        position = 5; // Unperturbed by a successful exit
      }
    }

    state.automatonState = {
      position,
      patternStep: 0,  // 0 = next turn is a burst; >0 = remaining winding turns
    };
  },
});