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
    }

    return lines.join('\n');
  },
});