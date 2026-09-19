/**
 * dawnMist.js — selfgrow subtle ground-level dawn mist
 *
 * A semi-transparent layer of warm-grey sprites that drifts across the
 * garden floor during the early Morning transition. Appears only during
 * the dawn window (t=0.95 to t=0.12 of the day cycle), with a very low
 * peak opacity (~0.08) and slow, organic drift.
 *
 * This is deliberately separate from the scene's weather fog — it is a
 * ground-level particle layer that adds a distinct calm morning atmosphere
 * without conflicting with existing weather-based scene fog.
 *
 * Fully invisible under prefers-reduced-motion.
 *
 * Exports: createDawnMist(scene) -> { group, update, state }
 */

import * as THREE from "three";
import { isReducedMotion, onMotionChange } from "./motion.js";

/* --- Configuration --- */
const PARTICLE_COUNT = 45;          // ~40–50 sprites
const SPREAD_RADIUS = 3.5;          // spread across the plot radius
const MAX_HEIGHT = 0.15;            // y ≤ 0.15 — at ground level
const PEAK_OPACITY = 0.08;          // very subtle peak
const MIST_COLOR = 0xd0c4b0;        // warm grey tint
const DRIFT_SPEED = 0.015;          // unhurried drift rate
const DRIFT_AMPLITUDE = 0.4;        // max drift offset in world units
const FADE_LERP_SPEED = 0.04;       // smooth fade in/out (~1.2s to reach target)

/* Dawn window timing (t = day cycle progress, 0–1):
 *   [0.95, 1.00]: fade in   (end of Night)
 *   [0.00, 0.08]: hold at peak (early Morning)
 *   [0.08, 0.12]: fade out  (still Morning)
 *   all other:    opacity = 0
 */
const DAWN_FADE_IN_START  = 0.95;
const DAWN_FADE_IN_END    = 1.00;
const DAWN_HOLD_END       = 0.08;
const DAWN_FADE_OUT_END   = 0.12;

/**
 * Create a soft circular sprite texture on a canvas.
 * Warm grey-white centre, fading to transparent at the edges.
 */
function createMistTexture() {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(220, 210, 190, 1.0)');
  gradient.addColorStop(0.2, 'rgba(210, 200, 180, 0.7)');
  gradient.addColorStop(0.5, 'rgba(200, 190, 170, 0.3)');
  gradient.addColorStop(0.8, 'rgba(190, 180, 160, 0.08)');
  gradient.addColorStop(1, 'rgba(180, 170, 150, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create the dawn mist system.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function, state: object }}
 */
export function createDawnMist(scene) {
  /* --- Detect reduced motion --- */
  let reducedMotion = isReducedMotion();

  /* Listen for preference changes */
  onMotionChange(function(matches) {
    reducedMotion = matches;
    state.reducedMotion = matches;
    if (reducedMotion) {
      // Immediately hide all sprites when reduced motion is enabled
      group.visible = false;
    } else {
      group.visible = true;
    }
  });

  /* --- Create the mist texture --- */
  const mistTexture = createMistTexture();

  /* --- Build a shared sprite material --- */
  const spriteMat = new THREE.SpriteMaterial({
    map: mistTexture,
    color: MIST_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    fog: false
  });

  /* --- Create particle group --- */
  const group = new THREE.Group();
  group.name = 'dawn-mist';
  scene.add(group);

  /* --- Create individual sprite particles --- */
  const particles = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Random position within spread radius
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPREAD_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = Math.random() * MAX_HEIGHT;

    // Sprite size varies for organic feel (0.3–0.8 units)
    const size = 0.3 + Math.random() * 0.5;

    const sprite = new THREE.Sprite(spriteMat.clone());
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = 0;

    // Per-particle animation parameters for organic drift
    // Using a seeded-ish approach with random phases
    const particleData = {
      baseX: x,
      baseY: y,
      baseZ: z,
      size: size,
      driftPhaseX: Math.random() * Math.PI * 2,
      driftPhaseZ: Math.random() * Math.PI * 2,
      driftPhaseY: Math.random() * Math.PI * 2,
      driftAngle: Math.random() * Math.PI * 2,
      driftSpeed: DRIFT_SPEED * (0.6 + Math.random() * 0.8), // varied speed per particle
      driftAmp: DRIFT_AMPLITUDE * (0.5 + Math.random() * 0.5) // varied amplitude
    };

    group.add(sprite);
    particles.push({
      sprite: sprite,
      data: particleData
    });
  }

  /* --- State exposed for selftest --- */
  const state = {
    type: 'dawn-mist',
    group: group,
    particles: particles,
    particleCount: PARTICLE_COUNT,
    reducedMotion: reducedMotion,
    peakOpacity: PEAK_OPACITY,
    mistColor: MIST_COLOR,
    spreadRadius: SPREAD_RADIUS,
    maxHeight: MAX_HEIGHT,
    dawnFadeInStart: DAWN_FADE_IN_START,
    dawnFadeInEnd: DAWN_FADE_IN_END,
    dawnHoldEnd: DAWN_HOLD_END,
    dawnFadeOutEnd: DAWN_FADE_OUT_END,
    /** Returns the current target opacity based on day cycle progress t */
    getTargetOpacity: function(t) {
      if (this.reducedMotion) return 0;

      if (t >= DAWN_FADE_IN_START && t < DAWN_FADE_IN_END) {
        // Fade in: t ∈ [0.95, 1.0) — progress from 0 to 1
        const progress = (t - DAWN_FADE_IN_START) / (DAWN_FADE_IN_END - DAWN_FADE_IN_START);
        return progress * PEAK_OPACITY;
      }

      if (t >= 0 && t < DAWN_HOLD_END) {
        // Hold at peak: t ∈ [0, 0.08)
        return PEAK_OPACITY;
      }

      if (t >= DAWN_HOLD_END && t < DAWN_FADE_OUT_END) {
        // Fade out: t ∈ [0.08, 0.12) — progress from 1 to 0
        const progress = (t - DAWN_HOLD_END) / (DAWN_FADE_OUT_END - DAWN_HOLD_END);
        return (1 - progress) * PEAK_OPACITY;
      }

      return 0;
    },
    /** Current running opacity (smoothly lerped) */
    currentOpacity: 0
  };

  /* --- Runtime opacity tracking --- */
  let currentOpacity = 0;

  /**
   * Update the dawn mist each frame.
   *
   * @param {number} time - Absolute animation time (seconds), used for drift
   */
  function update(time) {
    /* Day/night cycle may not be ready on first frames */
    const dayNight = window.__gardenState && window.__gardenState.dayNight;
    if (!dayNight || typeof dayNight.getCycleProgress !== 'function') {
      group.visible = false;
      return;
    }

    const t = dayNight.getCycleProgress();

    /* Compute target opacity from day cycle */
    const targetOpacity = state.getTargetOpacity(t);

    /* Smoothly lerp toward target */
    currentOpacity += (targetOpacity - currentOpacity) * FADE_LERP_SPEED;
    if (Math.abs(currentOpacity - targetOpacity) < 0.0005) {
      currentOpacity = targetOpacity;
    }
    state.currentOpacity = currentOpacity;

    /* Update visibility */
    if (reducedMotion) {
      group.visible = false;
      return;
    }

    /* Hide if opacity is negligible */
    if (currentOpacity < 0.001) {
      group.visible = false;
      // Still update drift positions so they're ready when mist reappears
    } else {
      group.visible = true;
    }

    /* Update each particle's opacity and drift position */
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const dd = p.data;

      p.sprite.material.opacity = currentOpacity;

      if (!reducedMotion) {
        /* Slow organic drift using sine/cosine with phase offset */
        const driftX = Math.sin(time * dd.driftSpeed + dd.driftPhaseX) * dd.driftAmp;
        const driftZ = Math.cos(time * dd.driftSpeed * 0.9 + dd.driftPhaseZ) * dd.driftAmp;
        const driftY = Math.sin(time * dd.driftSpeed * 0.7 + dd.driftPhaseY) * dd.driftAmp * 0.3;

        p.sprite.position.x = dd.baseX + driftX;
        p.sprite.position.z = dd.baseZ + driftZ;
        p.sprite.position.y = dd.baseY + driftY;
      } else {
        /* Reduced motion: reset to base position, no drift */
        p.sprite.position.x = dd.baseX;
        p.sprite.position.y = dd.baseY;
        p.sprite.position.z = dd.baseZ;
      }
    }
  }

  return {
    group: group,
    update: update,
    state: state
  };
}