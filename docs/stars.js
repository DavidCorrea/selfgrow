/**
 * stars.js — selfgrow faint star field visible during the Night phase
 *
 * Creates a sparse particle system of tiny faint white dots on a large
 * hemisphere above the garden (radius ~8.5). Stars fade in as the sky
 * transitions from Evening to Night and fade out toward Morning. They
 * rotate imperceptibly slowly (< 0.01 rad/s) to suggest celestial motion.
 *
 * Respects prefers-reduced-motion: stars remain static (no rotation)
 * but still fade in/out with the day/night cycle.
 *
 * Exports: createStars(scene) -> { update, points, destroy, state }
 */

import * as THREE from "three";

/* --- Configuration --- */
const STAR_COUNT = 80;                // between 60–100
const HEMISPHERE_RADIUS = 8.5;        // dome radius above the garden
const MAX_OPACITY = 0.4;              // peak opacity during Night phase
const ROTATION_SPEED = 0.005;         // rad/s — imperceptible (< 0.01)
const STAR_SIZE = 0.04;               // tiny dots in world units

/**
 * Create the star field particle system and add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ update: Function, points: THREE.Points, destroy: Function, state: object }}
 */
export function createStars(scene) {
  /* --- Detect reduced motion --- */
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = reducedMotionMedia.matches;

  /* --- Geometry: positions on a hemisphere above the garden --- */
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT); // slight size variation

  for (let i = 0; i < STAR_COUNT; i++) {
    // Spherical coordinates on the hemisphere
    // phi: 0 (zenith/straight up) → π/2 (horizon)
    const phi = Math.acos(Math.random()); // uniform on sphere → more dense at zenith
    // theta: full rotation around Y
    const theta = Math.random() * Math.PI * 2;

    // Slight radius jitter for natural irregularity (±0.5 units)
    const radius = HEMISPHERE_RADIUS + (Math.random() - 0.5) * 0.8;

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Slight size variation (0.7x to 1.3x of base)
    sizes[i] = STAR_SIZE * (0.7 + Math.random() * 0.6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  /* --- Material: tiny, faint, white dots --- */
  const material = new THREE.PointsMaterial({
    color: 0xfff8f0,          // warm pale white
    size: STAR_SIZE,
    transparent: true,
    opacity: 0,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  /* --- State exposed for selftest --- */
  const state = {
    type: 'stars',
    count: STAR_COUNT,
    reducedMotion,
    material,
    points,
    hemisphereRadius: HEMISPHERE_RADIUS,
    rotationSpeed: ROTATION_SPEED,
    maxOpacity: MAX_OPACITY
  };

  let currentOpacity = 0; // actual opacity for smooth lerp

  /**
   * Compute the target star opacity based on the day/night cycle progress.
   *
   * @param {number} t - Cycle progress in [0, 1).
   *   t ∈ [0.00, 0.25): Morning
   *   t ∈ [0.25, 0.50): Midday
   *   t ∈ [0.50, 0.75): Evening
   *   t ∈ [0.75, 1.00): Night
   * @returns {number} target opacity in [0, MAX_OPACITY]
   */
  function computeStarOpacity(t) {
    // Fully invisible during Morning, Midday, and first part of Evening
    if (t < 0.5) return 0;

    // Evening: fade in from 0 to MAX_OPACITY
    if (t >= 0.5 && t < 0.75) {
      const fadeIn = (t - 0.5) / 0.25; // 0 → 1
      return Math.min(fadeIn, 1) * MAX_OPACITY;
    }

    // Night: full opacity for most of the phase, then fade out toward Morning
    if (t >= 0.75 && t < 1.0) {
      // Stay at full for ~80% of Night (t ∈ [0.75, 0.95])
      if (t < 0.95) {
        return MAX_OPACITY;
      }
      // Fade out over the last 5% of Night (t ∈ [0.95, 1.0))
      const fadeOut = (1.0 - t) / 0.05;
      return Math.max(0, Math.min(1, fadeOut)) * MAX_OPACITY;
    }

    return 0;
  }

  /**
   * Update the star field each frame.
   *
   * @param {number} time - Absolute animation time (seconds)
   * @param {number} dt - Delta time since last frame (seconds)
   */
  function update(time, dt) {
    // Day/night may not be ready on first frames
    const dayNight = window.__gardenState && window.__gardenState.dayNight;
    if (!dayNight || typeof dayNight.getCycleProgress !== 'function') {
      material.opacity = 0;
      return;
    }

    /* --- Compute target opacity from day/night cycle --- */
    const t = dayNight.getCycleProgress();
    const targetOpacity = computeStarOpacity(t);

    /* --- Smoothly lerp toward target opacity --- */
    const lerpSpeed = 0.04; // ~1.2 seconds to fade in/out
    currentOpacity += (targetOpacity - currentOpacity) * lerpSpeed;
    if (Math.abs(currentOpacity - targetOpacity) < 0.0005) {
      currentOpacity = targetOpacity;
    }
    material.opacity = currentOpacity;

    /* --- Imperceptible rotation (unless reduced motion) --- */
    if (!state.reducedMotion) {
      points.rotation.y += ROTATION_SPEED * dt;
    }
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  function onMotionPreferenceChange(e) {
    state.reducedMotion = e.matches;
    // Rotation is handled in the update loop
  }

  reducedMotionMedia.addEventListener('change', onMotionPreferenceChange);

  /* --- Destroy: clean up event listener and remove from scene --- */
  function destroy() {
    reducedMotionMedia.removeEventListener('change', onMotionPreferenceChange);
    scene.remove(points);
    geometry.dispose();
    material.dispose();
  }

  return { update, points, destroy, state };
}