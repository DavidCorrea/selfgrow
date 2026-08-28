import { registerGallery } from '../engine/registry.js';

// The device hosted in this gallery — used to dynamically adapt the description
// when the player has recovered it.
const HOSTED_DEVICE = 'steam-cloak';
const RECOVERY_LINE = 'The tarnished steam cloak you recovered left an empty hook; the pipe it hung from is still warm.';
const HINT_LINE = 'Amid the clutter, a tarnished steam cloak hangs from a pipe, still\nwarm to the touch.';

registerGallery('boiler-room', {
  name: 'Boiler Room',
  describe(state) {
    const deviceFound = state && Array.isArray(state.foundDevices) && state.foundDevices.includes(HOSTED_DEVICE);
    const hintLine = deviceFound ? RECOVERY_LINE : HINT_LINE;

    const lines = [
      'The Boiler Room. The air is thick and hot, pressing against the lungs',
      'with every breath. Pressure pipes crowd the walls, their iron skin',
      'blistered with rust and weeping steam. Somewhere a valve knocks — once,',
      'then again — a slow, mechanical heartbeat. The Sentinel\'s footsteps',
      'echo differently here, sharper, as if the walls are closer than they',
      'look. A single doorway leads north into darkness.',
      '',
      hintLine,
    ];

    // Pressure-level reactivity — the environment strains with the pressure dial
    if (state && state.pressure > 60) {
      lines.push('The pipes groan overhead, straining against the pressure.');
    } else if (state && state.pressure < 20) {
      lines.push('The chamber is eerily quiet, the steam dying to a whisper.');
    }

    // Winder reactivity — the description changes based on whether the Winder
    // is currently winding (tick 0-2) or resting (tick 3)
    if (state && state.winderState && state.winderState.active) {
      if (state.winderState.tick < 3) {
        lines.push('The Winder looms over the valves, its brass arms tightening each fitting with a deliberate, rhythmic hiss of steam.');
      } else {
        lines.push('The Winder sits motionless, its arms slack against the valves — a brief stillness before the next cycle of winding.');
      }
    }

    return lines.join('\n');
  },
});