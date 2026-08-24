/**
 * Gallery generator — produces a deterministic, seed-based sequence of
 * galleries for a descent. Queries the module registry for all registered
 * gallery modules, places the starting gallery first, then shuffles the
 * remaining galleries using the seeded PRNG.
 *
 * The same seed always produces the same sequence. Changing the seed
 * produces a different sequence.
 */

import { listGalleries } from './registry.js';

/**
 * Generate a deterministic sequence of gallery IDs for a descent.
 *
 * The first gallery is always the starting gallery ('engine-room').
 * The remaining galleries are shuffled using the seeded PRNG so that
 * every new gallery added to the registry is automatically arranged.
 *
 * @param {Function} prng - A seeded PRNG function (from createPRNG)
 * @returns {string[]} Ordered list of gallery IDs for the descent
 */
export function generateGallerySequence(prng) {
  const allGalleries = listGalleries();

  // If nothing is registered, fall back to a minimal safe sequence
  if (allGalleries.length === 0) {
    return ['engine-room'];
  }

  // The starting gallery is always first
  const sequence = ['engine-room'];

  // Gather all other registered galleries
  const others = allGalleries.filter((id) => id !== 'engine-room');

  // Fisher-Yates shuffle using the seeded PRNG
  const shuffled = [...others];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return [...sequence, ...shuffled];
}