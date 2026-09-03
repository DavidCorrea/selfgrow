/**
 * fireflies.js — selfgrow subtle firefly glow near plants during Night phase
 *
 * Creates 4–6 tiny glowing dots near each plant, pulsing with a slow,
 * irregular rhythm (0.2–0.5 Hz) and drifting very slightly within a small
 * radius (~0.15 units) of each plant. They fade in smoothly as the sky
 * darkens (t ≥ 0.75) and fade out as Morning approaches (t ∈ [0.95, 1.0)).
 *
 * Each glow is a small additive-blended point sprite, barely perceptible —
 * peak opacity ≤ 0.15. This gives the garden a sense of continued life at
 * night, fulfilling the Vision's 'something small is usually happening at
 * the edge of attention.'
 *
 * Respects prefers-reduced-motion: dots are stationary (no pulsing/drift)
 * but still fade in/out with the day/night cycle.
 *
 * Exports: createFireflies(scene) -> { update, state, destroy }
 */

import * as THREE from "three";
import { isReducedMotion, onMotionChange } from './motion.js';

/* --- Configuration --- */
const DOTS_MIN = 4;
const DOTS_MAX = 6;               // 4–6 per plant
const DRIFT_RADIUS = 0.15;         // maximum drift offset from plant
const PEAK_OPACITY = 0.15;         // peak opacity during Night (≤ 0.15)
const GLOW_SIZE = 0.04;            // base sprite size in world units
const LIFT_HEIGHT = 0.35;           // how far fireflies rise above leaf height at night
const FADE_LERP_SPEED = 0.04;      // ~1.2 seconds to fade in/out
const PULSE_FREQ_MIN = 0.2;        // Hz — slow, irregular
const PULSE_FREQ_MAX = 0.5;        // Hz
const DRIFT_FREQ = 0.12;           // frequency of drift oscillation

/* --- Weather modulation --- */
const WEATHER_MULTIPLIERS = {
  'Clear': 1.0,
  'Overcast': 0.6,
  'Light Drizzle': 0.4
};
const WEATHER_MUL_LERP_SPEED = 0.04; // same as FADE_LERP_SPEED for smooth transitions

/* --- Seasonal modulation --- */
const SEASON_MULTIPLIERS = {
  'Spring': 0.53,
  'Summer': 1.0,
  'Autumn': 0.53,
  'Winter': 0.0
};

const DOTS_PER_SEASON = {
  'Spring': 3,
  'Summer': 6,
  'Autumn': 3,
  'Winter': 0
};

/**
 * Create a soft circular glow texture on a canvas.
 * Warm pale yellow-white, fading to transparent at the edges.
 */
function createGlowTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(255, 255, 230, 1.0)');
  gradient.addColorStop(0.15, 'rgba(255, 240, 180, 0.8)');
  gradient.addColorStop(0.4, 'rgba(220, 210, 120, 0.4)');
  gradient.addColorStop(0.65, 'rgba(180, 180, 80, 0.1)');
  gradient.addColorStop(1, 'rgba(180, 180, 80, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create the firefly glow system.
 *
 * @param {THREE.Scene} scene
 * @returns {{ update: Function, state: object, destroy: Function }}
 */
export function createFireflies(scene) {
  /* --- Detect reduced motion --- */
  const reducedMotion = isReducedMotion();

  /* --- Shared glow texture --- */
  const glowTexture = createGlowTexture();

  /* --- Each plant gets a group of dots --- */
  // plantGroups: array of { plantRef, points, geometry, material, dotData, count }
  const plantGroups = [];

  /**
   * Create a dot group anchored near a plant.
   *
   * @param {THREE.Vector3} plantPos - World position of the plant
   * @param {string} plantRef - 'plant' or 'plant2' or 'plantN'
   */
  function createDotGroup(plantPos, plantRef) {
    const count = DOTS_MIN + Math.floor(Math.random() * (DOTS_MAX - DOTS_MIN + 1)); // 4–6
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const dotData = [];

    for (let i = 0; i < count; i++) {
      // Random offset within DRIFT_RADIUS from plant position
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.02 + Math.random() * DRIFT_RADIUS * 0.8; // not all at boundary
      const baseX = plantPos.x + Math.cos(angle) * radius;
      const baseZ = plantPos.z + Math.sin(angle) * radius;
      const baseY = plantPos.y + 0.05 + Math.random() * 0.25; // varied height above ground

      positions[i * 3] = baseX;
      positions[i * 3 + 1] = baseY;
      positions[i * 3 + 2] = baseZ;

      // Slight size variation
      sizes[i] = GLOW_SIZE * (0.6 + Math.random() * 0.8);

      // Per-dot animation parameters
      dotData.push({
        phaseOffset: Math.random() * Math.PI * 2,
        freq: PULSE_FREQ_MIN + Math.random() * (PULSE_FREQ_MAX - PULSE_FREQ_MIN),
        driftPhase: Math.random() * Math.PI * 2,
        driftAngle: Math.random() * Math.PI * 2,
        baseX: baseX,
        baseY: baseY,
        baseZ: baseZ,
        sizeBase: sizes[i]
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      map: glowTexture,
      color: 0xfff8e0,           // warm pale yellow-white
      transparent: true,
      opacity: 0,
      size: GLOW_SIZE,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const group = {
      plantRef: plantRef,
      points: points,
      geometry: geometry,
      material: material,
      dotData: dotData,
      count: count
    };

    plantGroups.push(group);
    return group;
  }

  /**
   * Find any plants that exist in the scene but don't have dot groups yet.
   * Plants may appear over time (e.g. plant2 spawns ~30s after plant1 matures).
   */
  function scanForPlants() {
    const gs = window.__gardenState;
    if (!gs) return;

    const plantRefs = ['plant', 'plant2'];

    for (const ref of plantRefs) {
      const plantObj = gs[ref];
      if (!plantObj || !plantObj.group) continue;

      // Check if we already have a dot group for this plant
      const exists = plantGroups.some(g => g.plantRef === ref);
      if (exists) continue;

      const pos = plantObj.group.position;
      createDotGroup(pos, ref);
    }
  }

  /* --- Initial scan for existing plants --- */
  scanForPlants();

  /* --- State exposed for selftest --- */
  const state = {
    type: 'fireflies',
    reducedMotion: reducedMotion,
    plantGroups: plantGroups,
    glowTexture: glowTexture,
    driftRadius: DRIFT_RADIUS,
    peakOpacity: PEAK_OPACITY,
    fadeLerpSpeed: FADE_LERP_SPEED,
    weatherMultipliers: WEATHER_MULTIPLIERS,
    seasonMultipliers: SEASON_MULTIPLIERS,
    dotsPerSeason: DOTS_PER_SEASON,
    /** How far fireflies rise above leaf height during full night */
    liftHeight: LIFT_HEIGHT,
    /** Current weather opacity multiplier (lerping toward target) */
    currentWeatherMul: function() { return currentWeatherMul; },
    /** Current seasonal opacity multiplier (lerping toward target) */
    currentSeasonMul: function() { return currentSeasonMul; },
    /** Total number of active dot sprites across all plants */
    totalDotCount: function() {
      return plantGroups.reduce(function(sum, g) { return sum + g.count; }, 0);
    },
    /** Number of visible dots per plant for the current season */
    dotsPerPlantMin: DOTS_MIN,
    dotsPerPlantMax: DOTS_MAX
  };

  /* --- Runtime opacity tracking for smooth fades --- */
  let currentOpacity = 0;
  let currentWeatherMul = 1.0;
  let currentSeasonMul = 1.0;

  /**
   * Update the firefly system each frame.
   *
   * @param {number} time - Absolute animation time (seconds)
   * @param {number} dt - Delta time since last frame (seconds)
   */
  function update(time, dt) {
    /* Check for newly appeared plants (e.g. plant2 spawned later) */
    scanForPlants();

    /* Day/night cycle may not be ready on first frames */
    const dayNight = window.__gardenState && window.__gardenState.dayNight;
    if (!dayNight || typeof dayNight.getCycleProgress !== 'function') {
      plantGroups.forEach(function(g) { g.material.opacity = 0; });
      currentOpacity = 0;
      return;
    }

    const t = dayNight.getCycleProgress();

    /* --- Determine weather multiplier for glow intensity --- */
    let targetWeatherMul = 1.0;
    const weather = window.__gardenState && window.__gardenState.weather;
    if (weather && typeof weather.getPhase === 'function') {
      const phase = weather.getPhase();
      const mul = WEATHER_MULTIPLIERS[phase];
      if (mul !== undefined) {
        targetWeatherMul = mul;
      }
    }

    /* Smoothly lerp weather multiplier to avoid snapping */
    currentWeatherMul += (targetWeatherMul - currentWeatherMul) * WEATHER_MUL_LERP_SPEED;
    if (Math.abs(currentWeatherMul - targetWeatherMul) < 0.0005) {
      currentWeatherMul = targetWeatherMul;
    }

    /* --- Determine seasonal opacity multiplier --- */
    let targetSeasonMul = 1.0;
    let maxVisibleDots = DOTS_MAX;
    const seasonEl = document.getElementById('season-display');
    if (seasonEl) {
      const season = seasonEl.textContent.trim();
      const mul = SEASON_MULTIPLIERS[season];
      if (mul !== undefined) {
        targetSeasonMul = mul;
      }
      const maxDots = DOTS_PER_SEASON[season];
      if (maxDots !== undefined) {
        maxVisibleDots = maxDots;
      }
    }

    /* Smoothly lerp seasonal multiplier to avoid snapping on transitions */
    currentSeasonMul += (targetSeasonMul - currentSeasonMul) * FADE_LERP_SPEED;
    if (Math.abs(currentSeasonMul - targetSeasonMul) < 0.0005) {
      currentSeasonMul = targetSeasonMul;
    }

    /* --- Compute target opacity from day/night cycle --- */
    let targetOpacity = 0;

    if (t >= 0.75) {
      if (t < 0.95) {
        // Full Night — target peak opacity, modulated by weather and season
        targetOpacity = PEAK_OPACITY * currentWeatherMul * currentSeasonMul;
      } else {
        // Fading out toward Morning — t ∈ [0.95, 1.0)
        const fadeT = (1.0 - t) / 0.05; // 1 → 0
        targetOpacity = Math.max(0, fadeT) * PEAK_OPACITY * currentWeatherMul * currentSeasonMul;
      }
    }
    // t < 0.75: target stays 0 — invisible during Morning, Midday, Evening

    /* --- Smoothly lerp toward target opacity --- */
    currentOpacity += (targetOpacity - currentOpacity) * FADE_LERP_SPEED;
    if (Math.abs(currentOpacity - targetOpacity) < 0.0005) {
      currentOpacity = targetOpacity;
    }

    /* --- Compute vertical lift offset for dusk emergence / dawn settling --- */
    let liftOffset = 0;
    if (!reducedMotion) {
      if (t >= 0.75 && t < 0.80) {
        // Dusk emergence: smoothstep from 0 to LIFT_HEIGHT
        const progress = (t - 0.75) / 0.05;
        // Smoothstep: 3t^2 - 2t^3
        const eased = progress * progress * (3 - 2 * progress);
        liftOffset = eased * LIFT_HEIGHT;
      } else if (t >= 0.80 && t <= 0.95) {
        // Full night: hold at LIFT_HEIGHT
        liftOffset = LIFT_HEIGHT;
      } else if (t > 0.95 && t < 1.0) {
        // Dawn settling: smoothstep from LIFT_HEIGHT back to 0
        const progress = (t - 0.95) / 0.05;
        // Smoothstep inverted: 1 - (3t^2 - 2t^3)
        const eased = 1 - (progress * progress * (3 - 2 * progress));
        liftOffset = eased * LIFT_HEIGHT;
      }
    }

    /* --- Update each dot group --- */
    for (let gi = 0; gi < plantGroups.length; gi++) {
      const group = plantGroups[gi];
      group.material.opacity = currentOpacity;

      const pos = group.geometry.attributes.position.array;
      const sizes = group.geometry.attributes.size.array;

      for (let i = 0; i < group.count; i++) {
        const dd = group.dotData[i];
        const i3 = i * 3;

        /* Limit visible dots per season: dots beyond maxVisibleDots get zero size */
        if (i >= maxVisibleDots) {
          sizes[i] = 0;
          // Reset to base position (no drift for hidden dots)
          pos[i3] = dd.baseX;
          pos[i3 + 1] = dd.baseY;
          pos[i3 + 2] = dd.baseZ;
          continue;
        }

        if (!reducedMotion) {
          /* --- Pulsing: vary dot size with slow, irregular sine --- */
          const pulse = Math.sin(time * dd.freq * Math.PI * 2 + dd.phaseOffset) * 0.5 + 0.5;
          // pulse ranges 0–1. Map to size multiplier: 0.5–1.0
          const sizeMul = 0.5 + pulse * 0.5;
          sizes[i] = dd.sizeBase * sizeMul;

          /* --- Drifting: slow sine-based movement within DRIFT_RADIUS --- */
          const driftX = Math.sin(time * DRIFT_FREQ + dd.driftPhase) * DRIFT_RADIUS * 0.6;
          const driftZ = Math.cos(time * DRIFT_FREQ * 0.9 + dd.driftAngle) * DRIFT_RADIUS * 0.6;
          const driftY = Math.sin(time * DRIFT_FREQ * 0.7 + dd.driftPhase * 1.3) * DRIFT_RADIUS * 0.3;

          pos[i3] = dd.baseX + driftX;
          // Apply vertical lift offset for dusk emergence / dawn settling
          pos[i3 + 1] = dd.baseY + driftY + liftOffset;
          pos[i3 + 2] = dd.baseZ + driftZ;
        } else {
          // Reduced motion: no pulsing/drift/lift, but keep size at base
          sizes[i] = dd.sizeBase;
          pos[i3] = dd.baseX;
          pos[i3 + 1] = dd.baseY;
          pos[i3 + 2] = dd.baseZ;
        }
      }

      group.geometry.attributes.position.needsUpdate = true;
      group.geometry.attributes.size.needsUpdate = true;
    }
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  const unsubMotion = onMotionChange(function(matches) {
    state.reducedMotion = matches;
    // Update is called every frame and handles the motion state
  });

  /* --- Destroy: clean up and remove from scene --- */
  function destroy() {
    unsubMotion();
    for (let gi = 0; gi < plantGroups.length; gi++) {
      const group = plantGroups[gi];
      scene.remove(group.points);
      group.geometry.dispose();
      group.material.dispose();
    }
    plantGroups.length = 0;
    glowTexture.dispose();
  }

  return { update: update, state: state, destroy: destroy };
}