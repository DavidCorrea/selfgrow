import { registerGallery } from '../engine/registry.js';

// The device hosted in this gallery — used to dynamically adapt the description
// when the player has recovered it.
const HOSTED_DEVICE = 'tension-wheel';
const RECOVERY_LINE = 'The bracket where the brass tension wheel once sat is empty now, its socket still warm from the friction of use.';
const HINT_LINE = 'A brass tension wheel is mounted on a central gear shaft, its\nsurface gleaming with the polish of constant motion. It could be\nremoved if carefully handled.';

registerGallery('gear-room', {
  name: 'Gear Gallery',
  describe(state) {
    const deviceFound = state && Array.isArray(state.foundDevices) && state.foundDevices.includes(HOSTED_DEVICE);
    const hintLine = deviceFound ? RECOVERY_LINE : HINT_LINE;

    const lines = [
      'The Gear Gallery. Interlocking brass gears fill the chamber from',
      'floor to ceiling, their teeth meshing in a slow, rhythmic grind that',
      'vibrates through the catwalk beneath your feet. The air smells of hot',
      'oil and worn metal, and the walls tremble with the machine\'s labour.',
      'The Sentinel\'s approach is audible here as a grinding of stripped',
      'teeth — a sound that sets your own nerves on edge long before it',
      'arrives.',
      '',
      hintLine,
    ];

    // Pressure-level reactivity — the gears respond to the machine's pressure
    if (state && state.pressure > 60) {
      lines.push('The gears shudder and scream as the pressure climbs, their rhythm faltering against the strain.');
    } else if (state && state.pressure < 20) {
      lines.push('The great gears turn slowly, reluctantly, as if the machine itself is labouring to breathe.');
    }

    return lines.join('\n');
  },
});