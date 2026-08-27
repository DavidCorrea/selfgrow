import { registerDevice } from '../engine/registry.js';

registerDevice('vent', {
  id: 'vent',
  name: 'Pressure Vent',
  cost: 10,

  /** Get the effective cost accounting for wear. */
  effectiveCost(state) {
    const wear = (state.deviceWear && state.deviceWear[this.id]) || 0;
    return this.cost + wear;
  },

  /** Describe the device and its current state. */
  describe(state) {
    const effectiveCost = this.effectiveCost(state);
    const wear = (state.deviceWear && state.deviceWear[this.id]) || 0;
    const canUse = this.canUse(state);
    const usable = canUse ? 'ready' : 'insufficient pressure';
    const wearText = wear > 0 ? ` [+${wear} from wear]` : '';
    return `Pressure Vent (cost: ${effectiveCost}${wearText}, pushes Sentinel back 2, pressure: ${state.pressure}, ${usable})`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.effectiveCost(state);
  },

  /**
   * Use the device: spend pressure to push the Sentinel back.
   * Returns true if the device was used, false otherwise.
   */
  /**
   * Return a single-sentence description of what the device did.
   * Called after use() to build the turn announcement.
   */
  announceEffect(state) {
    const effectiveCost = this.effectiveCost(state);
    return `You vent ${effectiveCost} pressure, pushing the Sentinel back 2 steps.`;
  },

  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.effectiveCost(state);
    // Push the Sentinel back, but not beyond the maximum starting distance
    state.automatonState.position = Math.min(
      state.automatonState.position + 2,
      10
    );
    return true;
  },
});