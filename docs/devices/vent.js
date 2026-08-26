import { registerDevice } from '../engine/registry.js';

registerDevice('vent', {
  name: 'Pressure Vent',
  cost: 10,

  /** Describe the device and its current state. */
  describe(state) {
    const canUse = this.canUse(state);
    const usable = canUse ? 'ready' : 'insufficient pressure';
    return `Pressure Vent (cost: ${this.cost}, pushes Sentinel back 2, pressure: ${state.pressure}, ${usable})`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.cost;
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
    return `You vent ${this.cost} pressure, pushing the Sentinel back 2 steps.`;
  },

  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.cost;
    // Push the Sentinel back, but not beyond the maximum starting distance
    state.automatonState.position = Math.min(
      state.automatonState.position + 2,
      10
    );
    return true;
  },
});