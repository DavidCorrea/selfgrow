import { registerGallery } from '../engine/registry.js';

// The device hosted in this gallery — used to dynamically adapt the description
// when the player has recovered it.
const HOSTED_DEVICE = 'condenser-valve';
const RECOVERY_LINE = 'The frosted bracket where the condensate valve was recovered now drips freely, ice already creeping back over the brass.';
const HINT_LINE = 'Frost has begun to form on a frozen condensate valve, its brass surface\ncaked with a layer of brittle ice. It might be valuable if it could be\nrecovered intact.';

registerGallery('condenser-room', {
  name: 'Condenser Gallery',
  describe(state) {
    const deviceFound = state && Array.isArray(state.foundDevices) && state.foundDevices.includes(HOSTED_DEVICE);
    const hintLine = deviceFound ? RECOVERY_LINE : HINT_LINE;

    const lines = [
      'The Condenser Gallery. The air is cold and damp, a sharp contrast to the',
      'steam-choked passage above. Rows of massive brass condensers line the walls,',
      'their cold surfaces weeping moisture in steady, rhythmic drips. The floor',
      'is slick with condensed steam, and your footsteps echo against the wet',
      'metal. The Sentinel\'s footsteps are muffled here, swallowed by the damp',
      'air, making it difficult to tell how close it really is.',
      '',
      hintLine,
    ];

    // Pressure-level reactivity — the cold condensers react to the machine's pressure
    if (state && state.pressure > 60) {
      lines.push('The condensers groan under the strain, warm steam forcing its way past frosted seals, and the drip becomes a steady pour.');
    } else if (state && state.pressure < 20) {
      lines.push('The condensers are deathly still, the drip slowing to a crawl as the cold deepens. Ice creeps across the floor.');
    }

    return lines.join('\n');
  },
});