/**
 * daynight.js — selfgrow day/night cycle
 *
 * Drives a continuous ~3-minute day/night cycle that:
 *  - Orbits the sun light around the scene (radius ~7) with varying elevation
 *  - Blends scene.background through four colour phases: sunrise, midday blue,
 *    sunset orange, deep night indigo
 *  - Dims lighting at night but keeps the garden calmly visible
 *  - Updates #time-display through Morning / Midday / Evening / Night phases
 *
 * Exports: startDayNightCycle(sunLight, scene, ambientLight, hemiLight, fillLight)
 */

import * as THREE from "three";

/* --- Configuration --- */
const CYCLE_DURATION_MS = 180_000; // ~3 minutes for a full day/night loop
const SUN_RADIUS = 7;
const SUN_MAX_Y = 8;
const SUN_OFFSET_Y = 0.5;

/* Four distinct phases, evenly spaced in the cycle.
 * t=0 → Morning (sunrise warm)
 * t=0.25 → Midday (clear blue)
 * t=0.50 → Evening (sunset orange)
 * t=0.75 → Night (deep indigo)
 * t=1.00 → back to Morning
 */
const SKY_STOPS = [
  { t: 0.00, color: new THREE.Color(0xf4a460) },  // sunrise warm
  { t: 0.25, color: new THREE.Color(0x87ceeb) },  // midday blue
  { t: 0.50, color: new THREE.Color(0xe8755a) },  // sunset orange
  { t: 0.75, color: new THREE.Color(0x0a1628) },  // deep night indigo
  { t: 1.00, color: new THREE.Color(0xf4a460) }   // back to sunrise
];

const PHASE_NAMES = [
  { tStart: 0.00, name: 'Morning' },
  { tStart: 0.25, name: 'Midday' },
  { tStart: 0.50, name: 'Evening' },
  { tStart: 0.75, name: 'Night' }
];

/* --- Helpers --- */

/** Interpolate between two adjacent sky colour stops */
function getSkyColor(t) {
  "use strict";
  // Find the segment [stops[i].t, stops[i+1].t] that contains t
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const a = SKY_STOPS[i];
    const b = SKY_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const seg = (t - a.t) / (b.t - a.t);
      return a.color.clone().lerp(b.color, seg);
    }
  }
  // Fallback (shouldn't reach here if t in [0,1])
  return SKY_STOPS[SKY_STOPS.length - 1].color.clone();
}

/** Get the phase name for a given cycle progress t in [0, 1) */
function getPhaseName(t) {
  "use strict";
  let name = 'Morning';
  for (let i = PHASE_NAMES.length - 1; i >= 0; i--) {
    if (t >= PHASE_NAMES[i].tStart) {
      name = PHASE_NAMES[i].name;
      break;
    }
  }
  return name;
}

/**
 * Start the continuous day/night cycle.
 *
 * @param {THREE.DirectionalLight} sunLight
 * @param {THREE.Scene} scene
 * @param {THREE.AmbientLight} ambientLight
 * @param {THREE.HemisphereLight} hemiLight
 * @param {THREE.DirectionalLight} fillLight
 */
export function startDayNightCycle(sunLight, scene, ambientLight, hemiLight, fillLight, initialProgress) {
  const startTime = performance.now();
  const timeDisplay = document.getElementById('time-display');
  if (!timeDisplay) {
    console.warn('startDayNightCycle: #time-display not found');
    return;
  }

  let lastPhaseName = '';

  /* Store initial light colours for reference */
  const sunBaseColor = sunLight.color.clone();
  const fillBaseColor = fillLight.color.clone();

  /** Compute sun intensity based on elevation */
  function sunIntensityFromElevation(y) {
    // y ranges from ~-6.5 (deep night) to ~8.5 (high noon)
    // Map y in [-1, 8] to intensity in [0.05, 1.2]
    const clamped = THREE.MathUtils.clamp((y + 1) / 9, 0, 1);
    return 0.05 + clamped * 1.15;
  }

  const dayNightState = {
    getCycleProgress: () => {
      const elapsed = performance.now() - startTime;
      return (elapsed % CYCLE_DURATION_MS) / CYCLE_DURATION_MS;
    },
    getPhaseName: () => getPhaseName((performance.now() - startTime) % CYCLE_DURATION_MS / CYCLE_DURATION_MS),
    getSunPosition: () => sunLight.position.clone(),
    getSkyColor: () => scene.background.clone()
  };

  /* Expose state for selftest */
  window.__gardenState.dayNight = dayNightState;

  function tick() {
    const elapsed = performance.now() - startTime;
    const cycleTime = elapsed % CYCLE_DURATION_MS;
    const t = cycleTime / CYCLE_DURATION_MS; // 0 → 1 continuously

    /* --- Compute sun angle θ --- */
    const theta = t * 2 * Math.PI;

    /* --- Sun position: orbit with varying elevation --- */
    const x = SUN_RADIUS * Math.cos(theta);
    const z = SUN_RADIUS * Math.sin(theta);
    const y = SUN_MAX_Y * Math.sin(theta) + SUN_OFFSET_Y;

    sunLight.position.set(x, y, z);

    /* --- Sky colour --- */
    const skyColor = getSkyColor(t);
    scene.background = skyColor;

    /* --- Sun intensity --- */
    const intensity = sunIntensityFromElevation(y);
    sunLight.intensity = intensity;

    /* --- Sun colour shifts cool at midday, warm at sunrise/sunset --- */
    // At midday, sun colour is slightly whiter; at sunset, warmer
    const coolShift = new THREE.Color(0xfff4e0);
    const warmShift = new THREE.Color(0xffbb77);
    if (t >= 0.2 && t <= 0.35) {
      // Transition to cooler midday
      const p = (t - 0.2) / 0.15;
      sunLight.color.copy(sunBaseColor).lerp(coolShift, p * 0.4);
    } else if (t >= 0.45 && t <= 0.6) {
      // Transition to warmer sunset
      const p = (t - 0.45) / 0.15;
      sunLight.color.copy(sunBaseColor).lerp(warmShift, p * 0.6);
    } else if (t >= 0.6 && t <= 0.75) {
      // Fade back to base over evening
      const p = (t - 0.6) / 0.15;
      sunLight.color.copy(sunBaseColor).lerp(new THREE.Color(0xff8855), p * 0.3);
    } else if (t >= 0.75) {
      // Night — sun colour dims to a deep cool
      const p = (t - 0.75) / 0.25;
      sunLight.color.copy(sunBaseColor).lerp(new THREE.Color(0x223366), p);
    } else {
      sunLight.color.copy(sunBaseColor);
    }

    /* --- Ambient light: dim at night --- */
    const ambientIntensity = 0.05 + THREE.MathUtils.clamp((y + 1) / 9, 0, 1) * 0.35;
    ambientLight.intensity = ambientIntensity;

    /* --- Hemisphere light: sky/ground blend follows sky colour --- */
    // Use the sky colour for the hemisphere sky
    hemiLight.color.copy(skyColor).multiplyScalar(0.6);
    hemiLight.groundColor.set(0x3a2a1a).lerp(new THREE.Color(0x1a1a0a), THREE.MathUtils.clamp(1 - (y + 1) / 9, 0, 1));
    const hemiIntensity = 0.05 + THREE.MathUtils.clamp((y + 1) / 9, 0, 1) * 0.45;
    hemiLight.intensity = hemiIntensity;

    /* --- Fill light: subtle, even dimmer at night --- */
    const fillIntensity = 0.02 + THREE.MathUtils.clamp((y + 1) / 9, 0, 1) * 0.28;
    fillLight.intensity = fillIntensity;
    // Shift fill colour toward cool blue at night
    fillLight.color.copy(fillBaseColor).lerp(new THREE.Color(0x445588), THREE.MathUtils.clamp(1 - (y + 1) / 9, 0, 0.6));

    /* --- Update time display --- */
    const phaseName = getPhaseName(t);
    if (phaseName !== lastPhaseName) {
      lastPhaseName = phaseName;
      timeDisplay.textContent = phaseName;
    }

    /* Expose progress for persistence */
    if (window.__gardenState) {
      window.__gardenState.dayNightProgress = t;
    }

    requestAnimationFrame(tick);
  }

  // If initialProgress provided, update initial display and progress
  if (initialProgress !== undefined) {
    const initialPhaseName = getPhaseName(initialProgress);
    if (timeDisplay) {
      timeDisplay.textContent = initialPhaseName;
    }
    lastPhaseName = initialPhaseName;
    if (window.__gardenState) {
      window.__gardenState.dayNightProgress = initialProgress;
    }
  }

  tick();
}