import { registerGallery } from '../engine/registry.js';

registerGallery('gear-room', {
  name: 'Gear Gallery',
  describe(state) {
    const lines = [
      'The Gear Gallery. Interlocking brass gears of every size crowd the chamber,',
      'their teeth meshing in a slow, deliberate dance that transmits the machine\'s',
      'motive force deeper into the descent. The air hums with the vibration of',
      'countless rotations, and the floor trembles with each engaged gear-train.',
      'The Sentinel\'s approach is heralded by the grinding of stripped teeth,',
      'a sound that sets your own nerves on edge long before it arrives.',
      '',
      'Among the forest of rotating wheels, a tension wheel hangs motionless from',
      'a disengaged bracket. If it could be freed and adjusted, it might regulate',
      'the machine\'s temperament.',
    ];

    // Pressure-level reactivity — the gears respond to the machine's pressure
    if (state && state.pressure > 60) {
      lines.push('The gears shudder and scream, their rhythm frantic as the pressure drives them past their limits.');
    } else if (state && state.pressure < 20) {
      lines.push('The gears have slowed to a near-stop, the great wheels drifting in silence, their teeth barely kissing.');
    }

    return lines.join('\n');
  },
});