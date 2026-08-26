import { registerDevice } from '../engine/registry.js';

registerDevice('condenser-valve', {
  name: 'Condenser Valve',
  foundIn: 'condenser-room',
  cost: 14,
  cooling: 3,
  duration: 2,

  /** Describe the device and its current state. */
  describe(state) {
    const canUse = this.canUse(state);
    const usable = canUse ? 'ready' : 'insufficient pressure';
    const cooling = state.deviceStates && state.deviceStates.condenserValveCooling
      ? ` (cooling active: ${state.deviceStates.condenserValveCooling} turn${state.deviceStates.condenserValveCooling === 1 ? '' : 's'} remaining)`
      : '';
    return `Condenser Valve (cost: ${this.cost}, reduces pressure rate by ${this.cooling} for ${this.duration} turns, current: ${state.pressure}, ${usable})${cooling}`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.cost;
  },

  /**
   * Use the device: spend pressure to release frozen condensate through the
   * valve, cooling the machine's pipes and temporarily slowing the pressure
   * accumulation rate. The effect lasts for 2 turns.
   * Returns true if the device was used, false otherwise.
   */
  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.cost;
    state.deviceStates.condenserValveCooling = this.duration;
    return true;
  },
});