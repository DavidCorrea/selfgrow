import { registerGallery } from '../engine/registry.js';

registerGallery('pipe-gallery', {
  name: 'Pipe Gallery',
  describe(state) {
    const lines = [
      'The Pipe Gallery. Great iron pipes converge from all directions,',
      'their riveted flanges weeping condensation onto slick catwalks that',
      'cross a narrow condenser chamber. Steam vents hiss underfoot,',
      'blasting hot mist across the walkway in unpredictable jets, and',
      'brass pressure gauges tick nervously along the walls. The Sentinel\'s',
      'footsteps ring against the pipes, each one amplified into a',
      'metallic echo that makes it sound like many things are approaching.',
      '',
      'A safety valve glints on a nearby pipe, still intact and waiting.',
    ];

    // Pressure-level reactivity — the environment strains with the pressure dial
    if (state && state.pressure > 60) {
      lines.push('The catwalks rattle underfoot as the pipes shudder with strain.');
    } else if (state && state.pressure < 20) {
      lines.push('The pipes are cold and still, the steam vents barely breathing.');
    }

    return lines.join('\n');
  },
});