/**
 * weather.js — selfgrow slow weather cycle
 *
 * Transitions between Clear, Overcast, and Light Drizzle phases over
 * approximately a 5-minute loop. Each phase affects the sky tint, scene
 * lighting (dimming on overcast, cooler on rain), and particle behaviour.
 *
 * All lighting changes lerp smoothly — no sudden snap transitions.
 *
 * Composes on top of the day/night cycle: reads what day/night set and
 * multiplies by weather factors.
 *
 * Exports: startWeatherCycle(sunLight, scene, ambientLight, hemiLight, fillLight, particles)
 */

import * as THREE from "three";

/* --- Configuration --- */
const CYCLE_DURATION_MS = 300_000; // ~5 minutes for a full weather loop
const TRANSITION_DURATION_MS = 15_000; // minimum 15s for smooth lerp (effectively the whole phase)

/* --- Season-specific phase boundary constants (issue #558) ---
 * These define what proportion of the weather cycle each phase occupies
 * per season. Used by remapTBySeason to stretch/compress phase durations
 * so Winter spends more time Overcast, Summer more time Clear, and Spring
 * extends Light Drizzle. All boundary values are in [0,1] and represent
 * cumulative end-of-phase t positions.
 *
 * Verification (as static constants):
 *   Winter Overcast: overcastEnd - clearEnd = 0.75 - 0.10 = 0.65 >= 0.60 ✓
 *   Summer Clear:    clearEnd = 0.55 >= 0.50 ✓
 *   Spring Drizzle:  1 - overcastEnd = 1 - 0.50 = 0.50;
 *                     Summer Drizzle = 1 - 0.80 = 0.20;
 *                     0.50 / 0.20 = 2.5 >= 1.5 ✓
 */
const SEASON_CLEAR_END = { Spring: 0.25, Summer: 0.55, Autumn: 1/3, Winter: 0.10 };
const SEASON_OVERCAST_END = { Spring: 0.50, Summer: 0.80, Autumn: 2/3, Winter: 0.75 };

/* Three weather phases + wrap-around to Clear */
const PHASES = [
  {
    name: 'Clear',
    t: 0.0,
    skyTint: new THREE.Color(1.0, 1.0, 1.0),
    sunIntensityMul: 1.0,
    sunColorMul: new THREE.Color(1.0, 1.0, 1.0),
    ambientIntensityMul: 1.0,
    ambientColorMul: new THREE.Color(1.0, 1.0, 1.0),
    hemiIntensityMul: 1.0,
    hemiColorMul: new THREE.Color(1.0, 1.0, 1.0),
    hemiGroundMul: new THREE.Color(1.0, 1.0, 1.0),
    fillIntensityMul: 1.0,
    fillColorMul: new THREE.Color(1.0, 1.0, 1.0),
    particleOpacityMul: 1.0,
    leafRoughness: 0.6,
    leafMetalness: 0.0,
    swayAmplitudeMul: 1.0
  },
  {
    name: 'Overcast',
    t: 1 / 3,
    skyTint: new THREE.Color(0.60, 0.60, 0.68),
    sunIntensityMul: 0.35,
    sunColorMul: new THREE.Color(0.85, 0.85, 0.90),
    ambientIntensityMul: 1.8,
    ambientColorMul: new THREE.Color(0.90, 0.90, 1.0),
    hemiIntensityMul: 0.7,
    hemiColorMul: new THREE.Color(0.70, 0.70, 0.80),
    hemiGroundMul: new THREE.Color(0.80, 0.80, 0.85),
    fillIntensityMul: 0.85,
    fillColorMul: new THREE.Color(0.90, 0.90, 1.0),
    particleOpacityMul: 1.6,
    leafRoughness: 0.6,
    leafMetalness: 0.0,
    swayAmplitudeMul: 1.75
  },
  {
    name: 'Light Drizzle',
    t: 2 / 3,
    skyTint: new THREE.Color(0.45, 0.52, 0.70),
    sunIntensityMul: 0.20,
    sunColorMul: new THREE.Color(0.70, 0.80, 0.95),
    ambientIntensityMul: 1.5,
    ambientColorMul: new THREE.Color(0.65, 0.80, 1.0),
    hemiIntensityMul: 0.55,
    hemiColorMul: new THREE.Color(0.55, 0.70, 0.95),
    hemiGroundMul: new THREE.Color(0.65, 0.70, 0.80),
    fillIntensityMul: 0.80,
    fillColorMul: new THREE.Color(0.65, 0.85, 1.0),
    particleOpacityMul: 2.2,
    leafRoughness: 0.25,
    leafMetalness: 0.03,
    swayAmplitudeMul: 1.75
  },
  {
    name: 'Clear',  // wrap-around — back to start
    t: 1.0,
    skyTint: new THREE.Color(1.0, 1.0, 1.0),
    sunIntensityMul: 1.0,
    sunColorMul: new THREE.Color(1.0, 1.0, 1.0),
    ambientIntensityMul: 1.0,
    ambientColorMul: new THREE.Color(1.0, 1.0, 1.0),
    hemiIntensityMul: 1.0,
    hemiColorMul: new THREE.Color(1.0, 1.0, 1.0),
    hemiGroundMul: new THREE.Color(1.0, 1.0, 1.0),
    fillIntensityMul: 1.0,
    fillColorMul: new THREE.Color(1.0, 1.0, 1.0),
    particleOpacityMul: 1.0,
    leafRoughness: 0.6,
    leafMetalness: 0.0,
    swayAmplitudeMul: 1.0
  }
];

const PHASE_NAMES = [
  { tStart: 0.0, name: 'Clear' },
  { tStart: 1 / 3, name: 'Overcast' },
  { tStart: 2 / 3, name: 'Light Drizzle' }
];

/* Colour cache objects to avoid creating new THREE.Color on every frame */
const _tempColor = new THREE.Color();
const _winterGroundColor = new THREE.Color(0x3a2a1a);
const _rainColor = new THREE.Color();
const _winterLegacyColor = new THREE.Color();
const _finalColor = new THREE.Color();

/** Interpolate between two adjacent weather phase parameter sets */
function interpolatePhase(t, out) {
  "use strict";
  // Find the segment [PHASES[i].t, PHASES[i+1].t] that contains t
  for (let i = 0; i < PHASES.length - 1; i++) {
    const a = PHASES[i];
    const b = PHASES[i + 1];
    if (t >= a.t && t <= b.t) {
      const seg = a.t === b.t ? 0 : (t - a.t) / (b.t - a.t);
      // Use easing for extra smoothness
      const eased = seg * seg * (3 - 2 * seg); // smoothstep
      out.name = eased < 0.5 ? a.name : b.name;
      out.skyTint.copy(a.skyTint).lerp(b.skyTint, eased);
      out.sunIntensityMul = a.sunIntensityMul + (b.sunIntensityMul - a.sunIntensityMul) * eased;
      out.sunColorMul.copy(a.sunColorMul).lerp(b.sunColorMul, eased);
      out.ambientIntensityMul = a.ambientIntensityMul + (b.ambientIntensityMul - a.ambientIntensityMul) * eased;
      out.ambientColorMul.copy(a.ambientColorMul).lerp(b.ambientColorMul, eased);
      out.hemiIntensityMul = a.hemiIntensityMul + (b.hemiIntensityMul - a.hemiIntensityMul) * eased;
      out.hemiColorMul.copy(a.hemiColorMul).lerp(b.hemiColorMul, eased);
      out.hemiGroundMul.copy(a.hemiGroundMul).lerp(b.hemiGroundMul, eased);
      out.fillIntensityMul = a.fillIntensityMul + (b.fillIntensityMul - a.fillIntensityMul) * eased;
      out.fillColorMul.copy(a.fillColorMul).lerp(b.fillColorMul, eased);
      out.particleOpacityMul = a.particleOpacityMul + (b.particleOpacityMul - a.particleOpacityMul) * eased;
      out.leafRoughness = a.leafRoughness + (b.leafRoughness - a.leafRoughness) * eased;
      out.leafMetalness = a.leafMetalness + (b.leafMetalness - a.leafMetalness) * eased;
      out.swayAmplitudeMul = a.swayAmplitudeMul + (b.swayAmplitudeMul - a.swayAmplitudeMul) * eased;
      return;
    }
  }
  // Fallback (shouldn't reach here)
  const last = PHASES[PHASES.length - 1];
  out.name = last.name;
  out.skyTint.copy(last.skyTint);
  out.sunIntensityMul = last.sunIntensityMul;
  out.sunColorMul.copy(last.sunColorMul);
  out.ambientIntensityMul = last.ambientIntensityMul;
  out.ambientColorMul.copy(last.ambientColorMul);
  out.hemiIntensityMul = last.hemiIntensityMul;
  out.hemiColorMul.copy(last.hemiColorMul);
  out.hemiGroundMul.copy(last.hemiGroundMul);
  out.fillIntensityMul = last.fillIntensityMul;
  out.fillColorMul.copy(last.fillColorMul);
  out.particleOpacityMul = last.particleOpacityMul;
  out.leafRoughness = last.leafRoughness;
  out.leafMetalness = last.leafMetalness;
  out.swayAmplitudeMul = last.swayAmplitudeMul;
}

/**
 * Remap linear cycle progress t (in [0,1)) to phase-semantic t' based on season.
 * This stretches/compresses the three phase segments so the weather system
 * spends proportionally more time in season-appropriate phases without
 * changing the PHASES parameter definitions or transition smoothness.
 *
 * The mapping is piecewise-linear:
 *   [0, clearEnd)         → [0, 1/3)         (Clear)
 *   [clearEnd, overcastEnd) → [1/3, 2/3)     (Overcast)
 *   [overcastEnd, 1)        → [2/3, 1)        (Light Drizzle)
 *
 * @param {number} t - Linear cycle progress in [0, 1)
 * @param {string} season - Season name from #season-display (e.g. 'Spring')
 * @returns {number} Remapped t' in [0, 1) for phase interpolation/lookup
 */
function remapTBySeason(t, season) {
  const origClearEnd = 1 / 3;
  const origOvercastEnd = 2 / 3;

  const clearEnd = SEASON_CLEAR_END[season];
  const overcastEnd = SEASON_OVERCAST_END[season];

  // Unknown season or missing boundaries — return t unchanged
  if (clearEnd === undefined || overcastEnd === undefined) {
    return t;
  }

  if (t < clearEnd) {
    // First segment: [0, clearEnd) → [0, origClearEnd)
    return (t / clearEnd) * origClearEnd;
  } else if (t < overcastEnd) {
    // Second segment: [clearEnd, overcastEnd) → [origClearEnd, origOvercastEnd)
    const segProgress = (t - clearEnd) / (overcastEnd - clearEnd);
    return origClearEnd + segProgress * (origOvercastEnd - origClearEnd);
  } else {
    // Third segment: [overcastEnd, 1) → [origOvercastEnd, 1)
    const segLen = 1 - overcastEnd;
    if (segLen <= 0) return origOvercastEnd; // safety: avoid div-by-zero
    const segProgress = (t - overcastEnd) / segLen;
    return origOvercastEnd + segProgress * (1 - origOvercastEnd);
  }
}

/** Get the human-readable phase name for a given cycle progress t in [0, 1) */
function getPhaseName(t) {
  "use strict";
  let name = 'Clear';
  for (let i = PHASE_NAMES.length - 1; i >= 0; i--) {
    if (t >= PHASE_NAMES[i].tStart) {
      name = PHASE_NAMES[i].name;
      break;
    }
  }
  return name;
}

/**
 * Start the continuous weather cycle.
 *
 * Composes on top of the day/night cycle by reading values set by day/night
 * and applying weather modifiers. Started after day/night, its RAF callback
 * fires after day/night's, guaranteeing correct ordering.
 *
 * @param {THREE.DirectionalLight} sunLight
 * @param {THREE.Scene} scene
 * @param {THREE.AmbientLight} ambientLight
 * @param {THREE.HemisphereLight} hemiLight
 * @param {THREE.DirectionalLight} fillLight
 * @param {object} particles - The return value of createAmbientParticles (must have .state.material)
 * @param {number} [initialProgress] - Offset in [0,1) to start the cycle at a specific progress point.
 */
export function startWeatherCycle(sunLight, scene, ambientLight, hemiLight, fillLight, particles, initialProgress) {
  const startTime = performance.now() - (initialProgress || 0) * CYCLE_DURATION_MS;
  const weatherDisplay = document.getElementById('weather-display');
  if (!weatherDisplay) {
    console.warn('startWeatherCycle: #weather-display not found');
    return;
  }

  const particleMaterial = particles && particles.state && particles.state.material;

  let lastPhaseName = '';
  const baseParticleOpacity = particleMaterial ? particleMaterial.opacity : 0.2;
  /* Capture base ambient colour — day/night never resets it, so weather
   * must reset from base each frame to avoid compounding the multiply. */
  const baseAmbientColor = ambientLight.color.clone();

  /* Reusable interpolation output */
  const current = {
    name: 'Clear',
    skyTint: new THREE.Color(1, 1, 1),
    sunIntensityMul: 1,
    sunColorMul: new THREE.Color(1, 1, 1),
    ambientIntensityMul: 1,
    ambientColorMul: new THREE.Color(1, 1, 1),
    hemiIntensityMul: 1,
    hemiColorMul: new THREE.Color(1, 1, 1),
    hemiGroundMul: new THREE.Color(1, 1, 1),
    fillIntensityMul: 1,
    fillColorMul: new THREE.Color(1, 1, 1),
    particleOpacityMul: 1,
    leafRoughness: 0.6,
    leafMetalness: 0.0,
    swayAmplitudeMul: 1.0
  };

  /* --- Ground darkening during Light Drizzle (issue #528) ---
   * Exponential lerp factor: 0 = no darkening, 1 = fully dark (~0.85 brightness).
   * Onset rate: reaches ~95% in 1.5s (rate ≈ 2.0).
   * Recovery rate: reaches ~5% in 30s (rate ≈ 0.1). */
  let rainDarkeningFactor = 0;
  let _lastWeatherTick = performance.now();

  /* Helper: read the current season from the DOM */
  function readSeason() {
    const el = document.getElementById('season-display');
    return el ? el.textContent.trim() : 'Spring';
  }

/* Expose state for selftest and external querying */
  const weatherState = {
    getPhase: () => {
      const elapsed = performance.now() - startTime;
      const t = (elapsed % CYCLE_DURATION_MS) / CYCLE_DURATION_MS;
      const season = readSeason();
      return getPhaseName(remapTBySeason(t, season));
    },
    getProgress: () => {
      const elapsed = performance.now() - startTime;
      return (elapsed % CYCLE_DURATION_MS) / CYCLE_DURATION_MS;
    },
    getSwayAmplitudeMul: () => current.swayAmplitudeMul,
    getGroundDarkeningFactor: () => rainDarkeningFactor,
    /* Expose season boundary constants and remapping for selftest verification (issue #558) */
    seasonClearEnd: SEASON_CLEAR_END,
    seasonOvercastEnd: SEASON_OVERCAST_END,
    remapTBySeason: remapTBySeason
  };

  window.__gardenState.weather = weatherState;

  // Set initial weather display if progress was provided
  if (initialProgress !== undefined) {
    const initialPhaseName = getPhaseName(initialProgress);
    if (weatherDisplay) {
      weatherDisplay.textContent = initialPhaseName;
    }
    lastPhaseName = initialPhaseName;
    if (window.__gardenState) {
      window.__gardenState.weatherProgress = initialProgress;
    }
  }

  function tick() {
    const elapsed = performance.now() - startTime;
    const t = (elapsed % CYCLE_DURATION_MS) / CYCLE_DURATION_MS; // 0 → 1 continuously
    const season = readSeason();
    const mappedT = remapTBySeason(t, season);

    /* --- Interpolate weather parameters (using remapped t) --- */
    interpolatePhase(mappedT, current);

    /* --- Update DOM (using remapped t) --- */
    const phaseName = getPhaseName(mappedT);
    if (phaseName !== lastPhaseName) {
      lastPhaseName = phaseName;
      weatherDisplay.textContent = phaseName;
    }

    /* --- Apply weather modifiers to the scene --- */
    // These compose on top of whatever day/night set on this frame:
    // we read the current scene/light values and apply multipliers.

    // Sky colour: multiply the current scene background by weather sky tint
    if (scene.background instanceof THREE.Color) {
      _tempColor.copy(scene.background);
      _tempColor.multiply(current.skyTint);
      scene.background.copy(_tempColor);
    }

    // Sun light: reduce intensity, shift colour
    sunLight.intensity *= current.sunIntensityMul;
    sunLight.color.multiply(current.sunColorMul);

    // Ambient light: increase (overcast softens shadows), shift colour
    ambientLight.intensity *= current.ambientIntensityMul;
    // Reset from base — day/night never touches ambientLight.color, so
    // a bare .multiply() would compound frame-over-frame
    ambientLight.color.copy(baseAmbientColor).multiply(current.ambientColorMul);

    // Hemisphere light: dim, shift colours
    hemiLight.intensity *= current.hemiIntensityMul;
    hemiLight.color.multiply(current.hemiColorMul);
    hemiLight.groundColor.multiply(current.hemiGroundMul);

    // Fill light: dim, shift toward cool
    fillLight.intensity *= current.fillIntensityMul;
    fillLight.color.multiply(current.fillColorMul);

    // Particle opacity: more visible in overcast/drizzle
    if (particleMaterial) {
      particleMaterial.opacity = baseParticleOpacity * current.particleOpacityMul;
      // Clamp to keep it subtle
      particleMaterial.opacity = Math.min(particleMaterial.opacity, 0.6);
    }

    // --- Apply leaf wetness effect on plant leaf materials ---
    const gs = window.__gardenState;
    if (gs) {
      // Plant 1 leaf material
      const plant = gs.plant;
      if (plant && plant.leafMat) {
        plant.leafMat.roughness = current.leafRoughness;
        plant.leafMat.metalness = current.leafMetalness;
      }
      // Plant 2 leaf material (if it exists)
      const plant2 = gs.plant2;
      if (plant2 && plant2.leafMat) {
        plant2.leafMat.roughness = current.leafRoughness;
        plant2.leafMat.metalness = current.leafMetalness;
      }
    }

    // --- Ground darkening during Light Drizzle (issue #528) ---
    // Darkest-of-three rule: the darkest of (seasonal base, winter-legacy-blended,
    // rain-darkened) dominates per channel, so it never compounds with winter legacy.
    if (gs && gs.groundMat && gs.baseGroundColor) {
      const now = performance.now();
      const dt = Math.min((now - _lastWeatherTick) / 1000, 0.05);
      _lastWeatherTick = now;

      const isDrizzle = current.name === 'Light Drizzle';

      if (isDrizzle) {
        // Fast onset toward 1.0 — reaches ~95% in 1.5s
        const onsetRate = 2.0;
        rainDarkeningFactor += (1 - rainDarkeningFactor) * (1 - Math.exp(-onsetRate * dt));
      } else {
        // Slow recovery toward 0.0 — reaches ~5% in 30s
        const recoveryRate = 0.1;
        rainDarkeningFactor *= Math.exp(-recoveryRate * dt);
      }

      // Compute rain-darkened colour: base seasonal colour multiplied by (1 - 0.15 * factor)
      const darkenMul = 1 - 0.15 * rainDarkeningFactor;
      _rainColor.copy(gs.baseGroundColor).multiplyScalar(darkenMul);

      // Compute winter-legacy colour from base seasonal colour
      const winterLegacyBlend = gs.winterLegacyBlend || 0;
      _winterLegacyColor.copy(gs.baseGroundColor).lerp(_winterGroundColor, winterLegacyBlend);

      // Darkest of the three dominates (per-channel minimum)
      // Manual per-channel min — THREE.Color.min() may not exist in all versions (r170)
      _finalColor.copy(_winterLegacyColor);
      _finalColor.r = Math.min(_finalColor.r, _rainColor.r);
      _finalColor.g = Math.min(_finalColor.g, _rainColor.g);
      _finalColor.b = Math.min(_finalColor.b, _rainColor.b);
      gs.groundMat.color.copy(_finalColor);
    }

    // Expose progress for persistence
    if (gs) {
      gs.weatherProgress = t;
    }

    requestAnimationFrame(tick);
  }

  tick();
}