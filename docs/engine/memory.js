/**
 * MACHINE MEMORY — persists between descents via localStorage.
 *
 * The machine remembers your visits. What carries between runs is the
 * machine's memory of you — not a shop, not an upgrade tree. This module
 * stores a small record: the number of descents, how the last one ended,
 * and the last seed used.
 *
 * Exports:
 *   loadMemory()  — returns { descents, lastOutcome, lastSeed }
 *   saveMemory(outcome, seed) — saves outcome and increments descent count
 */

const STORAGE_KEY = 'bellowdeep_memory';

/**
 * Default memory when no prior record exists.
 */
const DEFAULT_MEMORY = {
  descents: 0,
  lastOutcome: 'none',
  lastSeed: null,
  deviceUsage: {},
};

/**
 * Load the machine's memory from localStorage.
 *
 * Returns a memory object with safe defaults if nothing is stored or the
 * stored data is corrupted. Never throws.
 *
 * @returns {{ descents: number, lastOutcome: string, lastSeed: string|null }}
 */
export function loadMemory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        descents: typeof data.descents === 'number' ? data.descents : 0,
        lastOutcome: typeof data.lastOutcome === 'string' ? data.lastOutcome : 'none',
        lastSeed: typeof data.lastSeed === 'string' ? data.lastSeed : null,
        deviceUsage: (data.deviceUsage && typeof data.deviceUsage === 'object' && !Array.isArray(data.deviceUsage))
          ? { ...data.deviceUsage }
          : {},
      };
    }
  } catch (e) {
    // Corrupted data — start fresh
  }
  return { ...DEFAULT_MEMORY };
}

/**
 * Save the outcome of a descent to the machine's memory.
 *
 * Increments the descent count, stores the outcome and seed, and persists
 * to localStorage. Returns the updated memory object.
 *
 * @param {string} outcome - How the descent ended: 'rupture', 'cornered', or 'none'
 * @param {string} [seed] - The seed of the descent that just ended
 * @returns {{ descents: number, lastOutcome: string, lastSeed: string|null, deviceUsage: object }}
 */
export function saveMemory(outcome, seed, deviceUsage) {
  const memory = loadMemory();
  memory.descents += 1;
  memory.lastOutcome = outcome || 'none';
  memory.lastSeed = seed || null;
  memory.deviceUsage = (deviceUsage && typeof deviceUsage === 'object' && !Array.isArray(deviceUsage))
    ? { ...deviceUsage }
    : {};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (e) {
    // localStorage full or unavailable — silently fail
  }
  return memory;
}

/**
 * Clear the machine's memory — for testing or reset.
 */
export function clearMemory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Silently fail
  }
}