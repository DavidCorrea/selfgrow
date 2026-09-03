/**
 * particles.js — ambient floating particles (dust motes / pollen)
 *
 * A sparse cloud of small semi-transparent particles drifting slowly
 * through the garden air, creating a sense that the space is alive
 * and breathing.
 *
 * Exports: createAmbientParticles(scene) which returns an update function.
 */

import * as THREE from "three";
import { isReducedMotion, onMotionChange } from './motion.js';

/**
 * Create a particle cloud around the garden volume.
 *
 * @param {THREE.Scene} scene
 * @returns {{ update: function, points: THREE.Points, destroy: function }}
 */
export function createAmbientParticles(scene) {
  const count = 80;

  /* --- Detect reduced motion preference --- */
  const reducedMotion = isReducedMotion();

  /* --- Geometry: positions for a sparse spherical volume --- */
  const positions = new Float32Array(count * 3);
  const origPositions = new Float32Array(count * 3); // copy for drift calculation

  /* Per-particle drift parameters: each axis gets its own phase & frequency */
  const phases = new Float32Array(count * 3);
  const frequencies = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Uniform distribution inside a sphere (radius ~3), centered at y=0.5
    const u = Math.random();
    const v = Math.random();
    const w = Math.random();

    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = Math.cbrt(w) * 3.0; // cube root for uniform volume

    const x = Math.sin(phi) * Math.cos(theta) * r;
    const y = Math.sin(phi) * Math.sin(theta) * r + 0.5; // raise above ground
    const z = Math.cos(phi) * r;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    origPositions[i * 3] = x;
    origPositions[i * 3 + 1] = y;
    origPositions[i * 3 + 2] = z;

    // Random phases: each axis independent
    phases[i * 3] = Math.random() * Math.PI * 2;
    phases[i * 3 + 1] = Math.random() * Math.PI * 2;
    phases[i * 3 + 2] = Math.random() * Math.PI * 2;

    // Slow, varied frequencies (0.1–0.5 rad/s) — organic, unhurried
    frequencies[i * 3] = 0.1 + Math.random() * 0.4;
    frequencies[i * 3 + 1] = 0.1 + Math.random() * 0.35;
    frequencies[i * 3 + 2] = 0.1 + Math.random() * 0.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  /* --- Material: tiny, pale, barely there --- */
  const material = new THREE.PointsMaterial({
    color: 0xfff8e8,          // warm pale white
    size: 0.03,
    transparent: true,
    opacity: 0.2,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  /* --- State exposed for selftest --- */
  const state = {
    type: 'ambient-particles',
    count,
    reducedMotion,
    material
  };

  /* --- Drift update function --- */
  function update(time) {
    if (state.reducedMotion) {
      // On reduced motion, keep particles at their original positions
      // (or first frame: copy orig positions to main array to ensure stationary)
      return;
    }

    const pos = geometry.attributes.position.array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Each axis drifts with its own sine wave — overlapping, non-repeating
      const dx = Math.sin(time * frequencies[i3] + phases[i3]) * 0.12;
      const dy = Math.sin(time * frequencies[i3 + 1] + phases[i3 + 1]) * 0.08;
      const dz = Math.sin(time * frequencies[i3 + 2] + phases[i3 + 2]) * 0.12;

      pos[i3] = origPositions[i3] + dx;
      pos[i3 + 1] = origPositions[i3 + 1] + dy;
      pos[i3 + 2] = origPositions[i3 + 2] + dz;
    }

    geometry.attributes.position.needsUpdate = true;
  }

  /* --- Handle changes to reduced-motion preference at runtime --- */
  const unsubMotion = onMotionChange(function(matches) {
    state.reducedMotion = matches;
    // If switching to reduced motion, reset positions to original
    if (matches) {
      const pos = geometry.attributes.position.array;
      for (let i = 0; i < count * 3; i++) {
        pos[i] = origPositions[i];
      }
      geometry.attributes.position.needsUpdate = true;
    }
  });

  /* --- Destroy: clean up event listener and remove from scene --- */
  function destroy() {
    unsubMotion();
    scene.remove(points);
    geometry.dispose();
    material.dispose();
  }

  return { update, points, destroy, state };
}