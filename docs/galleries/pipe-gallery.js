import { registerGallery } from '../engine/registry.js';

registerGallery('pipe-gallery', {
  name: 'Pipe Gallery',
  describe(/* state */) {
    return [
      'The Pipe Gallery. Great iron pipes converge from all directions,',
      'their riveted flanges weeping condensation onto slick catwalks that',
      'cross a narrow condenser chamber. Steam vents hiss underfoot,',
      'blasting hot mist across the walkway in unpredictable jets, and',
      'brass pressure gauges tick nervously along the walls. The Sentinel\'s',
      'footsteps ring against the pipes, each one amplified into a',
      'metallic echo that makes it sound like many things are approaching.',
    ].join('\n');
  },
});