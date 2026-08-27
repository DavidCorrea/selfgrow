import { registerDevice } from '../engine/registry.js';

registerDevice('tension-wheel', {
  name: 'Tension Wheel',
  foundIn: 'gear-room',
  cost: 12,
  reduction: 16,

  /** Describe the device and its current state. */
  describe(state) {
    const canUse = this.canUse(state);
    const usable = canUse ? 'ready' : 'insufficient pressure';
    return `Tension Wheel (cost: ${this.cost}, winds down ${this.reduction} pressure, current: ${state.pressure}, ${usable})`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.cost;
  },

  /**
   * Return a single-sentence description of what the device did.
   * Called after use() to build the turn announcement.
   */
  announceEffect(state) {
    return `You engage the tension wheel, winding down ${this.reduction} pressure.`;
  },

  /**
   * Use the device: spend pressure to engage the tension wheel, which
   * winds down the machine's accumulated pressure by the reduction amount
   * (in addition to the cost). Returns true if the device was used, false otherwise.
   */
  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.cost;
    state.pressure = Math.max(0, state.pressure - this.reduction);
    return true;
  },
});