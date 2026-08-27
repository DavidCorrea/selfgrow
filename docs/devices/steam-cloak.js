import { registerDevice } from '../engine/registry.js';

registerDevice('steam-cloak', {
  id: 'steam-cloak',
  name: 'Steam Cloak',
  foundIn: 'boiler-room',
  cost: 8,

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
    return `Steam Cloak (cost: ${effectiveCost}${wearText}, cloaks you in steam, Sentinel skips next advance, pressure: ${state.pressure}, ${usable})`;
  },

  /** Whether the device can be used given current state. */
  canUse(state) {
    return state.pressure >= this.effectiveCost(state);
  },

  /**
   * Use the device: spend pressure to cloak in steam, causing the Sentinel
   * to skip its next advance. Returns true if the device was used, false otherwise.
   */
  /**
   * Return a single-sentence description of what the device did.
   * Called after use() to build the turn announcement.
   */
  announceEffect(state) {
    return 'You cloak yourself in steam — the Sentinel will skip its next advance.';
  },

  use(state) {
    if (!this.canUse(state)) return false;
    state.pressure -= this.effectiveCost(state);
    state.automatonState.skipNextAct = true;
    return true;
  },
});