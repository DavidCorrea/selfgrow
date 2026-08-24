import { registerGallery } from '../engine/registry.js';

registerGallery('engine-room', {
  name: 'Engine Room',
  describe(/* state */) {
    return [
      'The Engine Room. Iron catwalks cross a vast chamber where a brass heart',
      'pulses slowly, filling the space with a deep, rhythmic thrum. Steam rises',
      'from grates in the floor, and the walls are lined with pressure pipes that',
      'tick and hiss. A single doorway leads north into darkness. The Sentinel\'s',
      'footsteps echo from somewhere ahead.',
    ].join('\n');
  },
});