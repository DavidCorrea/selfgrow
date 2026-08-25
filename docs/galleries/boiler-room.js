import { registerGallery } from '../engine/registry.js';

registerGallery('boiler-room', {
  name: 'Boiler Room',
  describe(state) {
    const lines = [
      'The Boiler Room. The air is thick and hot, pressing against the lungs',
      'with every breath. Pressure pipes crowd the walls, their iron skin',
      'blistered with rust and weeping steam. Somewhere a valve knocks — once,',
      'then again — a slow, mechanical heartbeat. The Sentinel\'s footsteps',
      'echo differently here, sharper, as if the walls are closer than they',
      'look. A single doorway leads north into darkness.',
      '',
      'Amid the clutter, a tarnished steam cloak hangs from a pipe, still',
      'warm to the touch.',
    ];

    // Pressure-level reactivity — the environment strains with the pressure dial
    if (state && state.pressure > 60) {
      lines.push('The pipes groan overhead, straining against the pressure.');
    } else if (state && state.pressure < 20) {
      lines.push('The chamber is eerily quiet, the steam dying to a whisper.');
    }

    return lines.join('\n');
  },
});