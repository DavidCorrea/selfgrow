/**
 * droplets.js — residual water droplets on leaf tips and stem tops
 *
 * After Light Drizzle ends, tiny specular spheres persist on leaf tips
 * and the top of the stem, fading gradually over ~35 seconds as the
 * garden dries. During a subsequent drizzle event before drying completes,
 * the drying timer resets and droplets remain visible.
 *
 * Exports: createPlantDroplets(plantState, leafHeights, stemHeight)
 *
 * Each droplet is a sphere with high metalness / low roughness so it
 * catches the scene's light as a tiny specular highlight.
 */

import * as THREE from "three";

const DROPLET_RADIUS = 0.004;           // tiny, near-invisible sphere
const DROPLET_SEGMENTS = 6;             // low-poly to stay subtle
const INITIAL_OPACITY = 0.3;            // visible but faint
const DRY_DURATION_MS = 35000;          // 35 seconds for full fade

/**
 * Create tiny specular droplet meshes as children of each leaf (at tip
 * position in the leaf's local space) and the stem (at top).
 *
 * Droplets start fully transparent and are driven externally via the
 * returned updateDroplets() method.
 *
 * @param {object} plantState - The plant state object from garden.js
 * @param {number[]} leafHeights - Heights of each leaf shape for tip positioning
 * @param {number} stemHeight - Height of the stem
 * @returns {object} { updateDroplets, setOpacity, getOpacity, droplets, dropletMat }
 */
export function createPlantDroplets(plantState, leafHeights, stemHeight) {
  /* Shared droplet material — high specular to catch light */
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0
  });

  const droplets = [];

  /* --- Droplet on each leaf tip --- */
  leafHeights.forEach((h, index) => {
    if (index < plantState.leaves.length) {
      const leaf = plantState.leaves[index];
      const mat = baseMat.clone();
      const droplet = new THREE.Mesh(
        new THREE.SphereGeometry(DROPLET_RADIUS, DROPLET_SEGMENTS, DROPLET_SEGMENTS),
        mat
      );
      // Place at (0, h, 0) in leaf's local space — the leaf tip
      droplet.position.set(0, h, 0);
      leaf.add(droplet);
      droplets.push(droplet);
    }
  });

  /* --- Droplet on stem top --- */
  const stemMat = baseMat.clone();
  const stemDroplet = new THREE.Mesh(
    new THREE.SphereGeometry(DROPLET_RADIUS, DROPLET_SEGMENTS, DROPLET_SEGMENTS),
    stemMat
  );
  stemDroplet.position.set(0, stemHeight, 0);
  plantState.stem.add(stemDroplet);
  droplets.push(stemDroplet);

  /* --- Internal state --- */
  let dryingStartTime = null;
  let isDrying = false;
  let currentOpacity = 0;

  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * Set opacity on all droplets to the same value.
   * @param {number} opacity - Value in [0, 1]
   */
  function setOpacity(opacity) {
    currentOpacity = opacity;
    droplets.forEach(d => {
      d.material.opacity = opacity;
    });
  }

  /** @returns {number} Current droplet opacity in [0, 1] */
  function getOpacity() {
    return currentOpacity;
  }

  /** Show droplets at initial opacity and start the drying timer. */
  function startDrying() {
    setOpacity(INITIAL_OPACITY);
    dryingStartTime = performance.now();
    isDrying = true;
  }

  /** Hide droplets immediately (drying complete). */
  function stopDrying() {
    setOpacity(0);
    dryingStartTime = null;
    isDrying = false;
  }

  /**
   * Called from weather.js each tick.
   *
   * Manages droplet opacity based on weather phase transitions:
   *   - During Light Drizzle: droplets stay visible, timer is reset
   *   - On exiting Light Drizzle: show droplets and start drying
   *   - During drying: fade opacity over DRY_DURATION_MS
   *   - During a subsequent drizzle: reset timer, keep droplets visible
   *
   * When prefers-reduced-motion is active, the fade is still applied
   * (it is a transparency change, not motion).
   *
   * @param {boolean} drizzleJustExited - True if the phase just transitioned
   *   from Light Drizzle to something else on this tick
   */
  function updateDroplets(drizzleJustExited) {
    const weather = window.__gardenState && window.__gardenState.weather;
    if (!weather || typeof weather.getPhase !== 'function') return;

    const phase = weather.getPhase();
    const reducedMotion = reducedMotionMedia.matches;

    if (phase === 'Light Drizzle') {
      // During drizzle: droplets are visible (or become visible)
      if (isDrying || currentOpacity < INITIAL_OPACITY) {
        // Reset — show droplets fully and stop drying timer
        setOpacity(INITIAL_OPACITY);
        dryingStartTime = null;
        isDrying = false;
      }
      return;
    }

    // Not in Light Drizzle
    if (drizzleJustExited) {
      // Transition out of drizzle: show droplets and start drying
      if (!isDrying) {
        startDrying();
      } else {
        // Already drying but we just re-exited — reset the timer anyway
        startDrying();
      }
      return;
    }

    // Normal drying update
    if (isDrying && dryingStartTime !== null) {
      const elapsed = performance.now() - dryingStartTime;
      const progress = Math.min(1, elapsed / DRY_DURATION_MS);
      const newOpacity = INITIAL_OPACITY * (1 - progress);
      setOpacity(Math.max(0, newOpacity));

      if (progress >= 1) {
        stopDrying();
      }
    }
  }

  return {
    updateDroplets,
    setOpacity,
    getOpacity,
    droplets,
    dropletMat: baseMat
  };
}