import { registerDevice } from '../engine/registry.js';

registerDevice('safety-valve', {
  id: 'safety-valve',
  name: 'Safety Valve',
  foundIn: 'pipe-gallery',
  cost: 15,
  reduction: 20,

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
    return `Safety Valve (cost: ${effectiveCost}${wearText}, vents ${this.reduction} pressure, current: ${state.pressure}, ${usable})`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.effectiveCost(state);
  },

  /**
   * Use the device: spend pressure to vent built-up pressure safely.
   * Deducts the cost and then reduces pressure by the reduction amount,
   * giving the player breathing room from the rupture threat.
   * Returns true if the device was used, false otherwise.
   */
  /**
   * Return a single-sentence description of what the device did.
   * Called after use() to build the turn announcement.
   */
  announceEffect(state) {
    return `You open the safety valve, venting ${this.reduction} pressure.`;
  },

  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.effectiveCost(state);
    state.pressure = Math.max(0, state.pressure - this.reduction);
    return true;
  },
});