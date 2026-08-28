/**
 * daynight.js — selfgrow day/night cycle
 *
 * A slow, continuous day/night cycle (~3 minutes real-time) that:
 * - Orbits the sun light position around the scene
 * - Blends sky colour through four phases (Morning, Midday, Evening, Night)
 * - Updates the #time-display DOM element
 *
 * Exports: initDayNight(config) -> { update(deltaSeconds), getCurrentPhase() }
 */

import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Phase definitions                                                   */
/*  Each keyframe defines the full lighting state at a point in the     */
/*  cycle where t ∈ [0, 1). The cycle wraps: t=1 is t=0 (morning).     */
/* ------------------------------------------------------------------ */

const PHASES = [
  {
    t: 0,
    name: 'Morning',
    skyColor: [0x87, 0xce, 0xeb],        // soft blue
    sunColor: [0xff, 0xee, 0xdd],        // warm white
    sunIntensity: 1.0,
    ambientColor: [0x40, 0x40, 0x60],
    ambientIntensity: 0.4,
    hemiSkyColor: [0x87, 0xce, 0xeb],
    hemiGroundColor: [0x4a, 0x37, 0x28],
    hemiIntensity: 0.5
  },
  {
    t: 0.25,
    name: 'Midday',
    skyColor: [0x4a, 0x90, 0xd9],        // deeper blue
    sunColor: [0xff, 0xf4, 0xe0],        // bright white-yellow
    sunIntensity: 1.5,
    ambientColor: [0x50, 0x50, 0x70],
    ambientIntensity: 0.5,
    hemiSkyColor: [0x4a, 0x90, 0xd9],
    hemiGroundColor: [0x5a, 0x48, 0x38],
    hemiIntensity: 0.6
  },
  {
    t: 0.5,
    name: 'Evening',
    skyColor: [0xd4, 0x84, 0x5a],        // sunset orange
    sunColor: [0xff, 0xaa, 0x66],        // warm orange
    sunIntensity: 0.8,
    ambientColor: [0x60, 0x50, 0x50],
    ambientIntensity: 0.35,
    hemiSkyColor: [0xd4, 0x84, 0x5a],
    hemiGroundColor: [0x5a, 0x40, 0x30],
    hemiIntensity: 0.4
  },
  {
    t: 0.75,
    name: 'Night',
    skyColor: [0x1a, 0x1a, 0x3a],        // deep indigo
    sunColor: [0x44, 0x66, 0xaa],        // cool, dim blue
    sunIntensity: 0.05,
    ambientColor: [0x20, 0x20, 0x50],
    ambientIntensity: 0.2,
    hemiSkyColor: [0x1a, 0x1a, 0x3a],
    hemiGroundColor: [0x2a, 0x20, 0x20],
    hemiIntensity: 0.2
  }
];

/* Wrapped — t=1.0 is the same as t=0.0 (Morning) */
const PHASES_WRAPPED = [...PHASES, { ...PHASES[0], t: 1.0 }];

/* ------------------------------------------------------------------ */
/*  Colour / numeric lerp helpers                                       */
/* ------------------------------------------------------------------ */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(rgbA, rgbB, t) {
  return [
    lerp(rgbA[0], rgbB[0], t),
    lerp(rgbA[1], rgbB[1], t),
    lerp(rgbA[2], rgbB[2], t)
  ];
}

/** Smoothstep: 3t² - 2t³ */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/*  Compute blended value between two adjacent phases                   */
/* ------------------------------------------------------------------ */

function blendBetween(phaseA, phaseB, localT, easedT) {
  return {
    skyColor: lerpColor(phaseA.skyColor, phaseB.skyColor, easedT),
    sunColor: lerpColor(phaseA.sunColor, phaseB.sunColor, easedT),
    sunIntensity: lerp(phaseA.sunIntensity, phaseB.sunIntensity, easedT),
    ambientColor: lerpColor(phaseA.ambientColor, phaseB.ambientColor, easedT),
    ambientIntensity: lerp(phaseA.ambientIntensity, phaseB.ambientIntensity, easedT),
    hemiSkyColor: lerpColor(phaseA.hemiSkyColor, phaseB.hemiSkyColor, easedT),
    hemiGroundColor: lerpColor(phaseA.hemiGroundColor, phaseB.hemiGroundColor, easedT),
    hemiIntensity: lerp(phaseA.hemiIntensity, phaseB.hemiIntensity, easedT),
    // The "closest" phase name — whichever keyframe we're nearer to
    phaseName: localT < 0.5 ? phaseA.name : phaseB.name
  };
}

/**
 * Evaluate the full cycle at a normalised time t ∈ [0, 1).
 * Returns { skyColor, sunColor, sunIntensity, ambientColor, ambientIntensity,
 *           hemiSkyColor, hemiGroundColor, hemiIntensity, phaseName, sunAngle }.
 */
function evaluateCycle(t) {
  // Wrap negative or ≥1 values
  t = ((t % 1) + 1) % 1;

  // Find which segment we're in
  let phaseA = PHASES_WRAPPED[0];
  let phaseB = PHASES_WRAPPED[1];
  for (let i = 0; i < PHASES_WRAPPED.length - 1; i++) {
    if (t >= PHASES_WRAPPED[i].t && t < PHASES_WRAPPED[i + 1].t) {
      phaseA = PHASES_WRAPPED[i];
      phaseB = PHASES_WRAPPED[i + 1];
      break;
    }
  }

  const segLen = phaseB.t - phaseA.t;
  const localT = segLen > 0 ? (t - phaseA.t) / segLen : 0;
  const easedT = smoothstep(localT);

  const blended = blendBetween(phaseA, phaseB, localT, easedT);

  /* Sun orbital angle — one full revolution per cycle */
  const sunAngle = t * Math.PI * 2;
  const radius = 8;

  return {
    ...blended,
    sunAngle,
    sunX: radius * Math.sin(sunAngle),
    sunZ: radius * Math.cos(sunAngle),
    sunY: 1 + 9 * (0.5 + 0.5 * Math.sin(sunAngle))
  };
}

/* ------------------------------------------------------------------ */
/*  Init: wires the cycle to scene objects and DOM                      */
/* ------------------------------------------------------------------ */

export function initDayNight({ scene, sunLight, ambientLight, hemiLight, cycleDuration = 180 }) {
  const timeDisplayEl = document.getElementById('time-display');
  let elapsed = 0;         // total elapsed seconds
  let currentPhaseName = '';

  const tempColor = new THREE.Color();

  function update(deltaSeconds) {
    if (deltaSeconds <= 0) return;
    elapsed += deltaSeconds;
    const t = (elapsed % cycleDuration) / cycleDuration;

    const state = evaluateCycle(t);

    /* --- Update scene background --- */
    const [sr, sg, sb] = state.skyColor;
    scene.background = tempColor.setRGB(sr / 255, sg / 255, sb / 255);

    /* --- Update sun light --- */
    sunLight.position.set(state.sunX, state.sunY, state.sunZ);
    const [sR, sG, sB] = state.sunColor;
    sunLight.color.setRGB(sR / 255, sG / 255, sB / 255);
    sunLight.intensity = state.sunIntensity;

    /* --- Update ambient light --- */
    const [aR, aG, aB] = state.ambientColor;
    ambientLight.color.setRGB(aR / 255, aG / 255, aB / 255);
    ambientLight.intensity = state.ambientIntensity;

    /* --- Update hemisphere light --- */
    const [hR, hG, hB] = state.hemiSkyColor;
    hemiLight.color.setRGB(hR / 255, hG / 255, hB / 255);
    const [hgR, hgG, hgB] = state.hemiGroundColor;
    hemiLight.groundColor.setRGB(hgR / 255, hgG / 255, hgB / 255);
    hemiLight.intensity = state.hemiIntensity;

    /* --- Update DOM time display --- */
    if (state.phaseName !== currentPhaseName) {
      currentPhaseName = state.phaseName;
      if (timeDisplayEl) {
        timeDisplayEl.textContent = currentPhaseName;
      }
    }
  }

  function getCurrentPhase() {
    const t = (elapsed % cycleDuration) / cycleDuration;
    return evaluateCycle(t).phaseName;
  }

  function getElapsed() {
    return elapsed;
  }

  return { update, getCurrentPhase, getElapsed };
}