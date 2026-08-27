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
  deviceWear: {},
};

/**
 * Load the machine's memory from localStorage.
 *
 * Returns a memory object with safe defaults if nothing is stored or the
 * stored data is corrupted. Never throws.
 *
 * @returns {{ descents: number, lastOutcome: string, lastSeed: string|null, deviceUsage: object, deviceWear: object }}
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
        deviceWear: (data.deviceWear && typeof data.deviceWear === 'object' && !Array.isArray(data.deviceWear))
          ? { ...data.deviceWear }
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
 * @param {object} [deviceUsage] - Per-device usage counts for this descent
 * @param {object} [deviceWear] - Accumulated device wear after this descent
 * @returns {{ descents: number, lastOutcome: string, lastSeed: string|null, deviceUsage: object, deviceWear: object }}
 */
export function saveMemory(outcome, seed, deviceUsage, deviceWear) {
  const memory = loadMemory();
  memory.descents += 1;
  memory.lastOutcome = outcome || 'none';
  memory.lastSeed = seed || null;
  memory.deviceUsage = (deviceUsage && typeof deviceUsage === 'object' && !Array.isArray(deviceUsage))
    ? { ...deviceUsage }
    : {};
  memory.deviceWear = (deviceWear && typeof deviceWear === 'object' && !Array.isArray(deviceWear))
    ? { ...deviceWear }
    : {};
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (e) {
    // localStorage full or unavailable — silently fail
  }
  return memory;
}

/**
 * Compute new device wear from per-descent usage counts and previous wear.
 *
 * Devices used 3+ times in a descent gain +1 wear (capped at 5).
 * Devices not used at all (present in previous wear but absent from usage counts)
 * lose 1 wear (floor 0). Devices used 1-2 times keep their current wear.
 *
 * Pure function — no side-effects.
 *
 * @param {object} deviceUsageCounts - Per-descent usage counts (deviceId → count)
 * @param {object} previousWear - Previous accumulated wear (deviceId → wear level)
 * @returns {object} New wear object (deviceId → wear level), with zero-wear entries removed
 */
export function computeDeviceWear(deviceUsageCounts, previousWear) {
  const wear = { ...(previousWear || {}) };

  // Apply wear gain for devices used 3+ times
  for (const [deviceId, count] of Object.entries(deviceUsageCounts || {})) {
    if (count >= 3) {
      wear[deviceId] = Math.min((wear[deviceId] || 0) + 1, 5);
    }
  }

  // Apply wear decay for devices that had wear but were not used at all this descent
  for (const deviceId of Object.keys(previousWear || {})) {
    const count = (deviceUsageCounts || {})[deviceId] || 0;
    if (count === 0) {
      wear[deviceId] = Math.max((wear[deviceId] || 0) - 1, 0);
    }
  }

  // Remove zero-wear entries
  for (const [deviceId, level] of Object.entries(wear)) {
    if (level <= 0) {
      delete wear[deviceId];
    }
  }

  return wear;
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