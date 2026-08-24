import { registerGallery } from '../engine/registry.js';

registerGallery('boiler-room', {
  name: 'Boiler Room',
  describe(/* state */) {
    return [
      'The Boiler Room. The air is thick and hot, pressing against the lungs',
      'with every breath. Pressure pipes crowd the walls, their iron skin',
      'blistered with rust and weeping steam. Somewhere a valve knocks — once,',
      'then again — a slow, mechanical heartbeat. The Sentinel\'s footsteps',
      'echo differently here, sharper, as if the walls are closer than they',
      'look. A single doorway leads north into darkness.',
      '',
      'Amid the clutter, a tarnished steam cloak hangs from a pipe, still',
      'warm to the touch.',
    ].join('\n');
  },
});