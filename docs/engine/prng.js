/**
 * Seeded PRNG — Mulberry32.
 *
 * Given a seed string, produces a deterministic sequence of pseudo-random
 * numbers in [0, 1). The same seed always produces the same first value.
 */
export function createPRNG(seed) {
  // Hash the seed string to a 32-bit integer via a simple FNV-1a-like hash
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h) + seed.charCodeAt(i);
    h = h & h; // Convert to 32-bit integer
  }
  let state = h >>> 0; // Ensure unsigned 32-bit
  if (state === 0) state = 1;

  // Mulberry32
  return function mulberry32() {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}