import { registerDevice } from '../engine/registry.js';

registerDevice('steam-cloak', {
  name: 'Steam Cloak',
  cost: 8,

  /** Describe the device and its current state. */
  describe(state) {
    const canUse = this.canUse(state);
    const usable = canUse ? 'ready' : 'insufficient pressure';
    return `Steam Cloak (cost: ${this.cost}, cloaks you in steam, Sentinel skips next advance, pressure: ${state.pressure}, ${usable})`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.cost;
  },

  /**
   * Use the device: spend pressure to cloak in steam, causing the Sentinel
   * to skip its next advance. Returns true if the device was used, false otherwise.
   */
  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.cost;
    state.automatonState.skipNextAct = true;
    return true;
  },
});