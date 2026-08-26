import { registerGallery } from '../engine/registry.js';

registerGallery('gear-room', {
  name: 'Gear Gallery',
  describe(state) {
    const lines = [
      'The Gear Gallery. Interlocking brass cogs fill the space wall to wall,',
      'their teeth meshing in a synchronized rhythm that vibrates through the',
      'catwalk underfoot. The air is thick with the smell of hot oil, and',
      'every step sends a new shudder through the mechanism. The grinding of',
      'stripped teeth signals the Sentinel\'s approach, drowning out all other',
      'sound.',
      '',
      'A tension wheel sits half-cranked in the corner, its housing cracked',
      'but its mechanism still intact, as if awaiting a careful hand.',
    ];

    // Pressure-level reactivity — the gears strain with the pressure dial
    if (state && state.pressure > 60) {
      lines.push('The gears grind and strain, their rhythm growing frantic as pressure surges through the machine.');
    } else if (state && state.pressure < 20) {
      lines.push('The gears wind down, their motion sluggish and laboured, the chamber falling into near-silence.');
    }

    return lines.join('\n');
  },
});