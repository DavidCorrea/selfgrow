import { registerDevice } from '../engine/registry.js';

registerDevice('tension-wheel', {
  id: 'tension-wheel',
  name: 'Tension Wheel',
  foundIn: 'gear-room',
  cost: 12,
  ruptureBoost: 15,

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
    const boostActive = state.deviceStates && state.deviceStates.tensionWheelBoost
      ? ` (rupture threshold boosted by +${state.deviceStates.tensionWheelBoost})`
      : '';
    return `Tension Wheel (cost: ${effectiveCost}${wearText}, raises rupture threshold by ${this.ruptureBoost} for the gallery, pressure: ${state.pressure}, ${usable})${boostActive}`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.effectiveCost(state);
  },

  /**
   * Use the device: spend pressure to adjust the tension wheel, temporarily
   * raising the rupture threshold by the boost amount for the remainder of
   * the current gallery. Returns true if the device was used, false otherwise.
   */
  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.effectiveCost(state);
    state.deviceStates.tensionWheelBoost = (state.deviceStates.tensionWheelBoost || 0) + this.ruptureBoost;
    state.ruptureThreshold += this.ruptureBoost;
    return true;
  },

  /**
   * Return a single-sentence description of what the device did.
   * Called after use() to build the turn announcement.
   */
  announceEffect(state) {
    return `You adjust the tension wheel, raising the rupture threshold by ${this.ruptureBoost}.`;
  },
});