import { registerDevice } from '../engine/registry.js';

registerDevice('condenser-valve', {
  id: 'condenser-valve',
  name: 'Condenser Valve',
  foundIn: 'condenser-room',
  cost: 14,
  cooling: 3,
  duration: 2,

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
    const cooling = state.deviceStates && state.deviceStates.condenserValveCooling
      ? ` (cooling active: ${state.deviceStates.condenserValveCooling} turn${state.deviceStates.condenserValveCooling === 1 ? '' : 's'} remaining)`
      : '';
    return `Condenser Valve (cost: ${effectiveCost}${wearText}, reduces pressure rate by ${this.cooling} for ${this.duration} turns, current: ${state.pressure}, ${usable})${cooling}`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.effectiveCost(state);
  },

  /**
   * Use the device: spend pressure to release frozen condensate through the
   * valve, cooling the machine's pipes and temporarily slowing the pressure
   * accumulation rate. The effect lasts for 2 turns.
   * Returns true if the device was used, false otherwise.
   */
  /**
   * Return a single-sentence description of what the device did.
   * Called after use() to build the turn announcement.
   */
  announceEffect(state) {
    return `You release frozen condensate through the valve, cooling the machine for ${this.duration} turns.`;
  },

  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.effectiveCost(state);
    state.deviceStates.condenserValveCooling = this.duration;
    return true;
  },
});