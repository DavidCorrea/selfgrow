import { registerGallery } from '../engine/registry.js';

registerGallery('engine-room', {
  name: 'Engine Room',
  describe(state) {
    const lines = [
      'The Engine Room. Iron catwalks cross a vast chamber where a brass heart',
      'pulses slowly, filling the space with a deep, rhythmic thrum. Steam rises',
      'from grates in the floor, and the walls are lined with pressure pipes that',
      'tick and hiss. A single doorway leads north into darkness. The Sentinel\'s',
      'footsteps echo from somewhere ahead.',
    ];

    // If the machine remembers previous descents, acknowledge the return
    if (state && state.memory && state.memory.descents > 0) {
      const count = state.memory.descents;
      const ordinal = count === 1 ? '1st' : count === 2 ? '2nd' : count === 3 ? '3rd' : count + 'th';
      lines.push(
        `The machine registers your return. This is your ${ordinal} descent.`
      );

      // Acknowledge the pressure shift from the last outcome
      const outcome = state.memory.lastOutcome;
      if (outcome === 'rupture') {
        lines.push(
          'The machine is still trembling from your last visit, its pressure running high.'
        );
      } else if (outcome === 'escaped') {
        lines.push(
          'The machine has settled since you escaped, its pressure running low.'
        );
      }
    }

    // Pressure-level reactivity — the chamber strains with the pressure dial
    if (state && state.pressure > 60) {
      lines.push('The brass heart strains, its rhythm quickening as the pipes groan overhead.');
    } else if (state && state.pressure < 20) {
      lines.push('The chamber falls deathly quiet, the great thrum slowing to a crawl.');
    }

    return lines.join('\n');
  },
});