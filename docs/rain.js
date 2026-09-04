/**
 * rain.js — rain particle system for Light Drizzle weather
 *
 * Creates a sparse, gentle rain effect visible only during the
 * Light Drizzle phase. Thin translucent streaks fall at an unhurried
 * pace, fading in/out smoothly during weather transitions.
 *
 * Exports: createRain(scene) which returns { update, points, destroy, state }
 *
 * Must respect prefers-reduced-motion: no rain when reduced motion is active.
 */

import * as THREE from "three";
import { isReducedMotion, onMotionChange } from "./motion.js";

/* --- Configuration --- */
const RAIN_COUNT = 250;
const RAIN_VOLUME_WIDTH = 6;
const RAIN_VOLUME_HEIGHT = 3.5;
const RAIN_VOLUME_DEPTH = 6;

const FALL_SPEED_BASE = 0.25;        // gentle, unhurried (units/sec)
const FALL_SPEED_VARIANCE = 0.3;     // variation per particle

const PARTICLE_SIZE = 0.35;          // size in world units for the streak sprite

/* Opacity target when in Light Drizzle vs other phases */
const OPACITY_TARGET_DRIZZLE = 0.12; // barely-there, translucent
const OPACITY_TARGET_OTHER = 0.0;

/* Per-frame lerp factor for smooth fade transitions (~2 seconds to fade) */
const FADE_LERP_SPEED = 0.025;

/**
 * Create the rain particle system and add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ update: function, points: THREE.Points, destroy: function, state: object }}
 */
export function createRain(scene) {
  /* --- Detect reduced motion --- */
  let reducedMotion = isReducedMotion();

  /* --- Create streak texture (thin translucent vertical line) --- */
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');

  // Clear — fully transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw a thin translucent vertical streak with a soft glow
  // Outer glow (subtle, wide)
  const outerGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  outerGradient.addColorStop(0, 'rgba(200, 210, 240, 0)');
  outerGradient.addColorStop(0.25, 'rgba(200, 210, 240, 0.08)');
  outerGradient.addColorStop(0.5, 'rgba(200, 210, 240, 0.12)');
  outerGradient.addColorStop(0.75, 'rgba(200, 210, 240, 0.08)');
  outerGradient.addColorStop(1, 'rgba(200, 210, 240, 0)');
  ctx.fillStyle = outerGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Bright core (thin, brighter)
  const coreGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  coreGradient.addColorStop(0, 'rgba(220, 230, 255, 0)');
  coreGradient.addColorStop(0.3, 'rgba(220, 230, 255, 0.25)');
  coreGradient.addColorStop(0.5, 'rgba(220, 230, 255, 0.45)');
  coreGradient.addColorStop(0.7, 'rgba(220, 230, 255, 0.25)');
  coreGradient.addColorStop(1, 'rgba(220, 230, 255, 0)');
  ctx.fillStyle = coreGradient;
  ctx.fillRect(2, 0, 4, canvas.height);

  // Vertical fade: slightly stronger at top, fading toward bottom
  // to simulate the streak catching light
  const vertGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertGradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  vertGradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.8)');
  vertGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.5)');
  vertGradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

  // Apply vertical fade by compositing — we'll just use the cumulative effect
  // by drawing a semi-transparent white gradient on top
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = vertGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  /* --- Geometry: positions in a box volume above the garden --- */
  const positions = new Float32Array(RAIN_COUNT * 3);
  const fallSpeeds = new Float32Array(RAIN_COUNT);

  for (let i = 0; i < RAIN_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * RAIN_VOLUME_WIDTH;
    positions[i * 3 + 1] = Math.random() * RAIN_VOLUME_HEIGHT;
    positions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_VOLUME_DEPTH;

    fallSpeeds[i] = FALL_SPEED_BASE + Math.random() * FALL_SPEED_VARIANCE;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  /* --- Material: pale cool-blue translucent streaks --- */
  const material = new THREE.PointsMaterial({
    color: 0xb0c8ff,
    map: texture,
    transparent: true,
    opacity: 0,
    size: PARTICLE_SIZE,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false
  });

  const points = new THREE.Points(geometry, material);
  points.visible = !reducedMotion;

  // Position the volume slightly above ground level
  points.position.y = 0.3;

  scene.add(points);

  /* --- State exposed for selftest --- */
  const state = {
    type: 'rain',
    count: RAIN_COUNT,
    reducedMotion,
    material,
    points,
    texture
  };

  let currentOpacity = 0; // actual opacity for smooth fading

  /* --- Update function (called every frame from the animation loop) --- */
  function update(time, dt) {
    // Handle reduced motion: stay invisible
    if (state.reducedMotion) {
      points.visible = false;
      if (material.opacity > 0) {
        material.opacity = 0;
      }
      return;
    }
    points.visible = true;

    // Weather may not be ready on first frames
    const weather = window.__gardenState && window.__gardenState.weather;
    if (!weather || typeof weather.getPhase !== 'function') {
      material.opacity = 0;
      return;
    }

    /* --- Determine target opacity based on current weather phase --- */
    const phase = weather.getPhase();
    const targetOpacity = (phase === 'Light Drizzle')
      ? OPACITY_TARGET_DRIZZLE
      : OPACITY_TARGET_OTHER;

    /* --- Smoothly lerp toward target opacity --- */
    currentOpacity += (targetOpacity - currentOpacity) * FADE_LERP_SPEED;
    if (Math.abs(currentOpacity - targetOpacity) < 0.0005) {
      currentOpacity = targetOpacity;
    }
    material.opacity = currentOpacity;

    /* --- Move particles downward --- */
    const pos = geometry.attributes.position.array;
    const fallStep = dt * FALL_SPEED_BASE; // base step for this frame

    for (let i = 0; i < RAIN_COUNT; i++) {
      const i3 = i * 3;
      pos[i3 + 1] -= fallStep * fallSpeeds[i];

      // Recycle when below the volume floor
      if (pos[i3 + 1] < 0) {
        pos[i3] = (Math.random() - 0.5) * RAIN_VOLUME_WIDTH;
        pos[i3 + 1] = RAIN_VOLUME_HEIGHT + Math.random() * 0.5;
        pos[i3 + 2] = (Math.random() - 0.5) * RAIN_VOLUME_DEPTH;
      }
    }

    geometry.attributes.position.needsUpdate = true;
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  const unsubMotion = onMotionChange(function(matches) {
    state.reducedMotion = matches;
    if (matches) {
      points.visible = false;
      material.opacity = 0;
      currentOpacity = 0;
    }
  });

  /* --- Destroy: clean up and remove from scene --- */
  function destroy() {
    unsubMotion();
    scene.remove(points);
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { update, points, destroy, state };
}