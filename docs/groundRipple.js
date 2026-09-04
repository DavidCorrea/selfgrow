/**
 * groundRipple.js — Subtle wave animation across the ground surface.
 *
 * Uses CPU-based vertex displacement on an already-instantiated ground mesh.
 * Stored original vertex positions (local Z, which maps to world Y after the
 * mesh's -PI/2 X rotation) are perturbed by a multi-frequency sine wave sum
 * with a tiny amplitude (~0.003 units). The result is a barely perceptible,
 * slow-moving ripple suggesting moving air across the soil.
 *
 * Respects prefers-reduced-motion: when active, no displacement is applied
 * and vertices stay at their original heights.
 *
 * Exports: createGroundRipple(groundMesh), computeDisplacement(x, z, time)
 *   createGroundRipple returns { update, destroy, state }
 *   computeDisplacement is a pure function usable by other modules
 */

import { isReducedMotion, onMotionChange } from "./motion.js";

/* --- Wave configuration (shared between ground ripple and fallen leaves) ---
 *
 * Since the mesh is rotated -PI/2 around X, the CircleGeometry's local
 * XY plane becomes world XZ, and local Z becomes world Y (up). We displace
 * the local Z coordinate (index 2 in the buffer) to create a world-space
 * vertical ripple.
 *
 * Each wave: { angle (radians from X axis), speed (rad/s), frequency
 *   (rad/unit), amplitude (units), phase offset (rad) }
 */
const waves = [
  { angle: 0.0,       speed: 0.20, freq: 0.8,  amp: 0.003, phase: 0.0 },
  { angle: 1.2,       speed: 0.35, freq: 1.2,  amp: 0.002, phase: 2.1 },
  { angle: 2.8,       speed: 0.15, freq: 0.6,  amp: 0.002, phase: 4.3 },
  { angle: 4.0,       speed: 0.25, freq: 1.0,  amp: 0.001, phase: 0.9 },
];

/**
 * Compute the wave displacement at a given (x, z) position at a given time.
 * Uses the same multi-frequency sine wave parameters as the ground ripple
 * animation, so fallen leaves move in sync with the ground.
 *
 * @param {number} x — world X coordinate
 * @param {number} z — world Z coordinate
 * @param {number} time — current animation time in seconds
 * @returns {number} — displacement value (same units as ground vertex displacement)
 */
export function computeDisplacement(x, z, time) {
  let displacement = 0;
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    const dist = x * Math.cos(wave.angle) + z * Math.sin(wave.angle);
    displacement += wave.amp * Math.sin(dist * wave.freq + time * wave.speed + wave.phase);
  }
  return displacement;
}

/**
 * Create a ground ripple controller for the given ground mesh.
 *
 * @param {THREE.Mesh} groundMesh — the ground plane (expected to have a
 *   BufferGeometry with position attribute, rotated to be horizontal).
 * @returns {{ update: function, destroy: function, state: object }}
 */
export function createGroundRipple(groundMesh) {
  /* --- Detect reduced motion preference --- */
  let reducedMotion = isReducedMotion();

  const geometry = groundMesh.geometry;
  const posAttr = geometry.attributes.position;
  const vertexCount = posAttr.count;
  const origPos = new Float32Array(vertexCount * 3);

  // Store original positions
  for (let i = 0; i < vertexCount * 3; i++) {
    origPos[i] = posAttr.array[i];
  }

  /* --- State exposed for selftest --- */
  const state = {
    type: 'ground-ripple',
    vertexCount,
    reducedMotion,
    waveCount: waves.length,
    amplitude: 0.003, // maximum single-wave amplitude
    active: !reducedMotion
  };

  /* --- Update function — called each frame with current time --- */
  function update(time) {
    if (state.reducedMotion) {
      // Reset vertices to original positions if they've been displaced
      const arr = posAttr.array;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] !== origPos[i]) {
          arr[i] = origPos[i];
        }
      }
      if (arr !== origPos) {
        posAttr.needsUpdate = true;
      }
      return;
    }

    const arr = posAttr.array;

    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3;
      const lx = origPos[i3];      // local X (world X)
      const ly = origPos[i3 + 1];  // local Y (world Z, after rotation)

      // Sum multiple waves at this vertex position
      let displacement = 0;
      for (let w = 0; w < waves.length; w++) {
        const wave = waves[w];
        // Project position onto wave direction
        const dist = lx * Math.cos(wave.angle) + ly * Math.sin(wave.angle);
        displacement += wave.amp * Math.sin(dist * wave.freq + time * wave.speed + wave.phase);
      }

      // Apply displacement to local Z (index 2), which maps to world Y (up)
      arr[i3 + 2] = origPos[i3 + 2] + displacement;
    }

    posAttr.needsUpdate = true;
  }

  /* --- Handle changes to reduced-motion preference at runtime --- */
  const unsubMotion = onMotionChange(function(matches) {
    state.reducedMotion = matches;
    state.active = !matches;

    // If switching to reduced motion, reset positions to original
    if (matches) {
      const arr = posAttr.array;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = origPos[i];
      }
      posAttr.needsUpdate = true;
    }
  });

  /* --- Destroy: clean up event listener --- */
  function destroy() {
    unsubMotion();
    // Reset vertices to original
    const arr = posAttr.array;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = origPos[i];
    }
    posAttr.needsUpdate = true;
  }

  return { update, destroy, state };
}