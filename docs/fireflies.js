/**
 * fireflies.js — selfgrow subtle firefly glow near plants during Night phase
 *
 * Creates 4–6 tiny glowing dots near each plant, pulsing with a slow,
 * irregular rhythm (0.2–0.5 Hz) and drifting very slightly within a small
 * radius (~0.15 units) of each plant. They fade in smoothly as the sky
 * darkens (t ≥ 0.75) and fade out as Morning approaches (t ∈ [0.95, 1.0)).
 *
 * Each glow is a small additive-blended point sprite, barely perceptible —
 * peak opacity 0.15, rising gently (up to a 0.25 cap) for returning
 * visitors (issue #705). This gives the garden a sense of continued life at
 * night, fulfilling the Vision's 'something small is usually happening at
 * the edge of attention.'
 *
 * Also casts a subtle warm yellow-green emissive tint on nearby plant
 * surfaces (stem and leaf materials) that pulses in sync with the
 * firefly glow (issue #613). Effect ≤10% saturation shift, active only
 * during Night phase (t ≥ 0.75) when fireflies are visible.
 *
 * Respects prefers-reduced-motion: dots are stationary (no pulsing/drift)
 * but still fade in/out with the day/night cycle. The plant surface glow
 * is still present but does not pulse (steady tint at 50% pulse).
 *
 * Exports: createFireflies(scene) -> { update, state, destroy }
 */

import * as THREE from "three";
import { isReducedMotion, onMotionChange } from "./motion.js";
import { computeDisplacement } from "./groundRipple.js";
import { SEASON_DURATION_MS } from "./garden.js";

/* --- Configuration --- */
const DOTS_MIN = 4;
const DOTS_MAX = 6;               // 4–6 per plant
const DRIFT_RADIUS = 0.15;         // maximum drift offset from plant
const PEAK_OPACITY = 0.15;         // base peak opacity during Night (≤ 0.15); scaled by getCumulativePeakOpacity() for return visits (issue #705)

/**
 * Compute the number of extra firefly dots per plant based on cumulative visit count.
 * Returns +1 dot every 5 visits, capped at +3 per plant (max 9 dots).
 *
 * - visitCount < 5:    0 (baseline 4–6)
 * - visitCount >= 5:   1 (total 5–7)
 * - visitCount >= 10:  2 (total 6–8)
 * - visitCount >= 15:  3 (total 7–9, cap)
 *
 * Reads window.__gardenState.visitCount if no argument provided.
 */
function getExtraDotCount(visitCount) {
  var gs = window.__gardenState;
  var vc = typeof visitCount === 'number' ? visitCount : (gs && typeof gs.visitCount === 'number' ? gs.visitCount : 1);
  if (vc >= 15) return 3;
  if (vc >= 10) return 2;
  if (vc >= 5) return 1;
  return 0;
}

/**
 * Compute the effective peak opacity for the current cumulative visit count.
 * Returns a value that increases with return visits, never exceeding 0.25,
 * so the principle of calm is preserved.
 *
 * - visitCount < 3:    0.15 (default)
 * - visitCount >= 3:   0.18 (+20%)
 * - visitCount >= 10:  0.20 (+35%)
 * - visitCount >= 25:  0.22
 * - visitCount >= 50:  0.24
 * - visitCount >= 100: 0.25 (hard cap)
 *
 * Reads window.__gardenState.visitCount live so it reflects the persisted value.
 */
function getCumulativePeakOpacity() {
  var gs = window.__gardenState;
  var vc = gs && typeof gs.visitCount === 'number' ? gs.visitCount : 1;
  var peak = PEAK_OPACITY; // 0.15 baseline
  if (vc >= 100) {
    peak = 0.25;
  } else if (vc >= 50) {
    peak = 0.24;
  } else if (vc >= 25) {
    peak = 0.22;
  } else if (vc >= 10) {
    peak = 0.20;
  } else if (vc >= 3) {
    peak = 0.18;
  }
  return Math.min(peak, 0.25);
}
const GLOW_SIZE = 0.04;            // base sprite size in world units
const LIFT_HEIGHT = 0.35;           // how far fireflies rise above leaf height at night
const FADE_LERP_SPEED = 0.04;      // ~1.2 seconds to fade in/out
const PULSE_FREQ_MIN = 0.2;        // Hz — slow, irregular
const PULSE_FREQ_MAX = 0.5;        // Hz
const DRIFT_FREQ = 0.12;           // frequency of drift oscillation

/* --- Seasonal ramp configuration (issue #623) --- */
const RAMP_FRACTION = 0.20;                // first/last 20% of season for ramp
const RAMP_DURATION_MS = SEASON_DURATION_MS * RAMP_FRACTION;  // 36s ramp window
const DOT_STAGGER_INTERVAL_MS = 4000;      // ~4s between individual dots appearing

/**
 * Determine the ramp-limited visible dot count for the current season phase.
 *
 * During the first RAMP_FRACTION of Spring, dots emerge one at a time
 * from 0 up to the full season count. During the last RAMP_FRACTION of
 * Autumn, dots fade out in reverse. Outside these windows the full
 * seasonal count is returned (unless prefers-reduced-motion is active,
 * which bypasses the ramp entirely).
 *
 * @param {number} maxFullCount - Full seasonal dot count from DOTS_PER_SEASON
 * @param {number} seasonProgress - window.__gardenState.seasonProgress (0–1)
 * @param {number} time - Absolute animation time in seconds
 * @param {boolean} reducedMotion - Whether prefers-reduced-motion is active
 * @returns {{ rampCount: number, rampActive: boolean }} - Visible count and whether ramp is active
 */
function getRampVisibleCount(maxFullCount, seasonProgress, time, reducedMotion) {
  if (reducedMotion || maxFullCount === 0) {
    return { rampCount: maxFullCount, rampActive: false };
  }

  // Derive season index and within-season progress from the 0–1 cycle progress
  var seasonIndex = Math.floor(seasonProgress * 4) % 4;
  var withinSeasonProgress = (seasonProgress * 4) % 1;

  // 0=Spring, 1=Summer, 2=Autumn, 3=Winter
  if (seasonIndex === 0 && withinSeasonProgress < RAMP_FRACTION) {
    // Spring ramp-up: progress through ramp window
    var rampProgress = withinSeasonProgress / RAMP_FRACTION;  // 0→1

    // Stagger: compute the activation threshold for each dot index i
    // Dot i becomes visible when rampProgress >= (i+1) * DOT_STAGGER_INTERVAL_MS / RAMP_DURATION_MS
    // This gives a responsive feel: if rampProgress is small, only dot 0 may be visible
    var staggerStep = DOT_STAGGER_INTERVAL_MS / RAMP_DURATION_MS;  // ~0.111 per dot
    var dotsVisible = 0;
    for (var i = 0; i < maxFullCount; i++) {
      if (rampProgress >= i * staggerStep) {
        dotsVisible++;
      }
    }
    // Clamp: never exceed maxFullCount nor go below 0
    dotsVisible = Math.min(Math.max(dotsVisible, 0), maxFullCount);

    return { rampCount: dotsVisible, rampActive: true };

  } else if (seasonIndex === 2 && withinSeasonProgress > (1 - RAMP_FRACTION)) {
    // Autumn ramp-down: progress through ramp window from end
    var autumnRampProgress = (withinSeasonProgress - (1 - RAMP_FRACTION)) / RAMP_FRACTION;  // 0→1

    // Reverse stagger: dots disappear in reverse order (last index first)
    var revStaggerStep = DOT_STAGGER_INTERVAL_MS / RAMP_DURATION_MS;
    var dotsActive = maxFullCount;
    for (var j = 0; j < maxFullCount; j++) {
      // Dot (maxFullCount - 1 - j) disappears when autumnRampProgress >= j * revStaggerStep
      if (autumnRampProgress >= j * revStaggerStep) {
        dotsActive--;
      }
    }
    dotsActive = Math.min(Math.max(dotsActive, 0), maxFullCount);

    return { rampCount: dotsActive, rampActive: true };
  }

  // Outside ramp windows: full count
  return { rampCount: maxFullCount, rampActive: false };
}
/* --- Firefly pulse synchronization (issue #639) --- */
const SYNC_CONVERGE_RADIUS = 0.15;    // units — within this, phases converge
const SYNC_DIVERGE_RADIUS = 0.25;    // units — beyond this, phases diverge back
const SYNC_CONVERGE_ALPHA = 0.002;   // exponential smoothing factor per frame (~15s to converge at 60fps)
const SYNC_DIVERGE_ALPHA = 0.002;    // exponential smoothing factor per frame (~10s to diverge at 60fps)
const SYNC_RESIDUAL_VARIANCE = 0.15; // ±0.15 rad residual variance to avoid perfect sync

const WIND_DRIFT_SCALE = 0.02;      // scale of ground ripple wind perturbation on drift

/* --- Butterfly landing firefly scatter (issue #690) --- */
const SCATTER_RADIUS = 0.4;         // units — max distance from butterfly landing to trigger scatter
const SCATTER_AMOUNT_MAX = 0.1;     // max outward displacement units (scatter amount range: 0.05-0.1)
const SCATTER_BUILD_UP_TIME = 2.0;  // seconds to drift outward
const SCATTER_TOTAL_DURATION = 6.0; // total seconds: 2s outward + 4s return

/* --- Sprout proximity glow boost (issue #646) --- */
const SPROUT_GLOW_BOOST_RADIUS = 0.3;    // units — max distance for sprout proximity boost
const SPROUT_GLOW_BOOST_MAX = 0.15;       // max 15% brightness boost at zero distance

/* --- Bloom attraction drift (issue #680) --- */
const BLOOM_ATTRACT_RADIUS = 0.4;         // units — max distance for blooming flower attraction
const BLOOM_ATTRACT_MAX = DRIFT_RADIUS * 0.1;  // 0.015 — max perturbation toward bloom (10% of DRIFT_RADIUS)

/* --- Pollination drift bias (issue #692) --- */
const POLLINATION_BIAS_RADIUS = 0.6;      // units — max distance for pollination bias to affect a firefly
const POLLINATION_BIAS_MAX = 0.05;         // max drift-centre offset toward a pollinated flower
const POLLINATION_BIAS_BUILD_UP_MS = 60000; // 60s to reach peak bias
const POLLINATION_BIAS_DECAY_MS = 120000;  // 120s total duration (zero at 120s)

/* --- Firefly-to-plant surface glow (issue #613) --- */
const WARM_GLOW_COLOR = 0xccdd88;     // warm yellow-green tint for plant surface glow
const MAX_GLOW_SHIFT = 0.10;           // ≤10% saturation shift from base colour (barely perceptible)

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
  let reducedMotion = isReducedMotion();

  /* --- Return-visitor greeting pulse (issue #706) --- */
  // Session-scoped flag: true once the greeting pulse has been triggered
  // on the first Night of each session for a return visit (visitCount >= 2).
  let _greetedThisSession = false;
  // Timer counting down active greeting duration (~2 seconds). 0 = not active.
  let _greetingTimer = 0;
  const GREETING_DURATION = 2.0; // seconds

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
    const extraCount = Math.min(getExtraDotCount(), 9 - count); // capped at 9 total
    const totalCount = count + extraCount;
    const positions = new Float32Array(totalCount * 3);
    const sizes = new Float32Array(totalCount);
    const dotData = [];

    for (let i = 0; i < totalCount; i++) {
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
      var phaseInit = Math.random() * Math.PI * 2;
      dotData.push({
        phaseOffset: phaseInit,
        freq: PULSE_FREQ_MIN + Math.random() * (PULSE_FREQ_MAX - PULSE_FREQ_MIN),
        driftPhase: Math.random() * Math.PI * 2,
        driftAngle: Math.random() * Math.PI * 2,
        baseX: baseX,
        baseY: baseY,
        baseZ: baseZ,
        sizeBase: sizes[i],
        isBonusDot: i >= count,   // true for extra dots beyond baseline (issue #753)
        /* --- Scatter state (issue #690) --- */
        scatterOffsetX: 0,
        scatterOffsetY: 0,
        scatterOffsetZ: 0,
        scatterTimer: 0,            // seconds remaining in active scatter cycle (0 = not scattering)
        scatterDirX: 0,             // unit direction away from source (x)
        scatterDirY: 0,             // unit direction away from source (y)
        scatterDirZ: 0,             // unit direction away from source (z)
        scatterAmount: 0,           // the max scatter amplitude for this dot (0.05-0.1)
        scatterSourcePos: null,     // {x, y, z} — the triggering position
        /* --- Butterfly proximity glow boost (issue #599) --- */
        glowBoostTimer: 0,          // seconds remaining of boost
        glowBoostAmount: 0,         // boost fraction (0.20-0.30, 0 = none)
        glowBoostDuration: 0,        // total duration of the boost (1.5-2.0s)
        /* --- Pulse synchronization (issue #639) --- */
        originalPhaseOffset: phaseInit,  // the original independent phase for divergence
        syncPhaseResidual: 0,            // accumulated residual for organic feel (±0.15 rad)
        syncActive: false                // whether currently in sync mode
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
      count: totalCount
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

    const plantRefs = ['plant', 'plant2', 'plant3'];

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
    /** Butterfly proximity glow boost state: returns array of {boostTimer, boostAmount, boostDuration} per dot across all groups */
    getBoostState: function() {
      var boosts = [];
      for (var gi = 0; gi < plantGroups.length; gi++) {
        for (var di = 0; di < plantGroups[gi].dotData.length; di++) {
          var dd = plantGroups[gi].dotData[di];
          boosts.push({
            boostTimer: dd.glowBoostTimer,
            boostAmount: dd.glowBoostAmount,
            boostDuration: dd.glowBoostDuration
          });
        }
      }
      return boosts;
    },
    /** Total number of dots currently with active glow boost (boostTimer > 0) */
    activeBoostCount: function() {
      var count = 0;
      for (var gi = 0; gi < plantGroups.length; gi++) {
        for (var di = 0; di < plantGroups[gi].dotData.length; di++) {
          if (plantGroups[gi].dotData[di].glowBoostTimer > 0) {
            count++;
          }
        }
      }
      return count;
    },
    /** Returns the effective peak opacity scaled by cumulative return visit count (issue #705) */
    getCumulativePeakOpacity: getCumulativePeakOpacity,
    /** Returns the number of extra firefly dots per plant based on cumulative visit count (issue #753) */
    getExtraDotCount: getExtraDotCount,
    /** Returns the number of extra dots currently applied per plant (issue #753) */
    extraDotsPerPlant: function() { return getExtraDotCount(); },
    /** Current weather opacity multiplier (lerping toward target) */
    currentWeatherMul: function() { return currentWeatherMul; },
    /** Current seasonal opacity multiplier (lerping toward target) */
    currentSeasonMul: function() { return currentSeasonMul; },
    /** Ramp fraction constant exposed for testing */
    rampFraction: RAMP_FRACTION,
    /** Dot stagger interval in ms exposed for testing */
    dotStaggerIntervalMs: DOT_STAGGER_INTERVAL_MS,
    /** Returns the ramped visible count for the current season/time */
    getRampVisibleCount: function() {
      var gs = window.__gardenState;
      var sp = gs && typeof gs.seasonProgress === 'number' ? gs.seasonProgress : 0;
      var seasonEl = document.getElementById('season-display');
      var season = seasonEl ? seasonEl.textContent.trim() : '';
      var maxFullCount = DOTS_PER_SEASON[season] !== undefined ? DOTS_PER_SEASON[season] : DOTS_MAX;
      return getRampVisibleCount(maxFullCount, sp, 0, state.reducedMotion);
    },
    /** Total number of active dot sprites across all plants */
    totalDotCount: function() {
      return plantGroups.reduce(function(sum, g) { return sum + g.count; }, 0);
    },
    /** Minimum and maximum number of dots per plant (including extra bonus dots from visit count) */
    dotsPerPlantMin: function() { return DOTS_MIN + getExtraDotCount(); },
    dotsPerPlantMax: function() { return Math.min(DOTS_MAX + getExtraDotCount(), 9); },
    /** Returns array of {x, y, z} for all active dot positions (drift-inclusive) */
    getAllPositions: function() {
      var positions = [];
      for (var gi = 0; gi < plantGroups.length; gi++) {
        var group = plantGroups[gi];
        var posArr = group.geometry.attributes.position.array;
        for (var di = 0; di < group.count; di++) {
          var i3 = di * 3;
          positions.push({
            x: posArr[i3],
            y: posArr[i3 + 1],
            z: posArr[i3 + 2]
          });
        }
      }
      return positions;
    },
    /** Plant surface glow state for each plant ref (issue #613) */
    getPlantGlowInfo: function() {
      var info = {};
      var gs = window.__gardenState;
      for (var gi = 0; gi < plantGroups.length; gi++) {
        var group = plantGroups[gi];
        var plantObj = gs && gs[group.plantRef];
        if (!plantObj) {
          info[group.plantRef] = { stemEmissiveIntensity: 0, leafEmissiveIntensity: 0 };
          continue;
        }
        info[group.plantRef] = {
          stemEmissiveIntensity: plantObj.stemMat ? plantObj.stemMat.emissiveIntensity || 0 : 0,
          leafEmissiveIntensity: plantObj.leafMat ? plantObj.leafMat.emissiveIntensity || 0 : 0
        };
      }
      return info;
    },
    /** Whether the glow is currently active (any plant has emissiveIntensity > 0) */
    isGlowActive: function() {
      var info = this.getPlantGlowInfo();
      for (var ref in info) {
        if (info[ref].stemEmissiveIntensity > 0.001 || info[ref].leafEmissiveIntensity > 0.001) {
          return true;
        }
      }
      return false;
    },
    /** Maximum glow shift constant exposed for testing */
    maxGlowShift: MAX_GLOW_SHIFT,
    /** Warm glow colour constant exposed for testing */
    warmGlowColor: WARM_GLOW_COLOR,
    /** Sprout proximity glow boost constants (issue #646) */
    sproutGlowBoostRadius: SPROUT_GLOW_BOOST_RADIUS,
    sproutGlowBoostMax: SPROUT_GLOW_BOOST_MAX,
    /** Bloom attraction drift constants (issue #680) */
    bloomAttractRadius: BLOOM_ATTRACT_RADIUS,
    bloomAttractMax: BLOOM_ATTRACT_MAX,
    /** Pollination drift bias constants (issue #692) */
    pollinationBiasRadius: POLLINATION_BIAS_RADIUS,
    pollinationBiasMax: POLLINATION_BIAS_MAX,
    pollinationBiasBuildUpMs: POLLINATION_BIAS_BUILD_UP_MS,
    pollinationBiasDecayMs: POLLINATION_BIAS_DECAY_MS,
    /** Returns whether any firefly dot is currently influenced by a pollination bias event.
     * Checks for active pollination events within bias radius. */
    getPollinationBias: function() {
      const gs = window.__gardenState;
      const events = gs && gs.pollinationEvents;
      if (!events || events.length === 0) return { active: false, eventCount: 0 };
      const now = performance.now();
      let hasActive = false;
      for (var pei = 0; pei < events.length; pei++) {
        const elapsed = now - events[pei].timestamp;
        if (elapsed >= 0 && elapsed < POLLINATION_BIAS_DECAY_MS) {
          hasActive = true;
          break;
        }
      }
      return { active: hasActive, eventCount: events.length };
    },
    /** Butterfly landing scatter constants (issue #690) */
    scatterRadius: SCATTER_RADIUS,
    scatterAmountMax: SCATTER_AMOUNT_MAX,
    scatterBuildUpTime: SCATTER_BUILD_UP_TIME,
    scatterTotalDuration: SCATTER_TOTAL_DURATION,
    /** Pulse synchronization configuration constants (issue #639) */
    syncConstants: {
      convergeRadius: SYNC_CONVERGE_RADIUS,
      divergeRadius: SYNC_DIVERGE_RADIUS,
      convergeAlpha: SYNC_CONVERGE_ALPHA,
      divergeAlpha: SYNC_DIVERGE_ALPHA,
      residualVariance: SYNC_RESIDUAL_VARIANCE
    },
    /** Returns pulse synchronization state for every dot: phase offsets, sync flags, residuals (issue #639) */
    getSyncState: function() {
      var syncs = [];
      for (var gi = 0; gi < plantGroups.length; gi++) {
        for (var di = 0; di < plantGroups[gi].dotData.length; di++) {
          var dd = plantGroups[gi].dotData[di];
          syncs.push({
            phaseOffset: dd.phaseOffset,
            originalPhaseOffset: dd.originalPhaseOffset,
            syncActive: dd.syncActive,
            syncPhaseResidual: dd.syncPhaseResidual,
            groupIndex: gi,
            isBonusDot: dd.isBonusDot || false
          });
        }
      }
      return syncs;
    },
    /** Returns scatter state for every dot: which are currently scattering (issue #690) */
    getScatterCandidates: function() {
      var scatters = [];
      for (var gi = 0; gi < plantGroups.length; gi++) {
        for (var di = 0; di < plantGroups[gi].dotData.length; di++) {
          var dd = plantGroups[gi].dotData[di];
          scatters.push({
            dotIndex: di,
            groupIndex: gi,
            scatterTimer: dd.scatterTimer,
            scatterAmount: dd.scatterAmount,
            scatterDirX: dd.scatterDirX,
            scatterDirY: dd.scatterDirY,
            scatterDirZ: dd.scatterDirZ,
            scatterOffsetX: dd.scatterOffsetX,
            scatterOffsetY: dd.scatterOffsetY,
            scatterOffsetZ: dd.scatterOffsetZ
          });
        }
      }
      return scatters;
    },
    /** Whether the return-visitor greeting pulse has been triggered this session (issue #706) */
    hasSyncedGreetedThisSession: function() {
      return _greetedThisSession;
    }
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

    /* --- Apply seasonal ramp (issue #623) --- */
    var gs = window.__gardenState;
    var seasonProgress = gs && typeof gs.seasonProgress === 'number' ? gs.seasonProgress : 0;
    var rampResult = getRampVisibleCount(maxVisibleDots, seasonProgress, time, state.reducedMotion);
    var rampedDots = rampResult.rampCount;
    var rampActive = rampResult.rampActive;

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
        targetOpacity = getCumulativePeakOpacity() * currentWeatherMul * currentSeasonMul;
      } else {
        // Fading out toward Morning — t ∈ [0.95, 1.0)
        const fadeT = (1.0 - t) / 0.05; // 1 → 0
        targetOpacity = Math.max(0, fadeT) * getCumulativePeakOpacity() * currentWeatherMul * currentSeasonMul;
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
      // local reducedMotion is synced from state.reducedMotion via onMotionChange
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

    /* --- Return-visitor greeting pulse (issue #706) --- */
    // On the first Night (t >= 0.75) of a return visit (visitCount >= 2),
    // trigger a synchronous ~2s pulse where all firefly dots peak together.
    // Only once per session — resets on page load.
    {
      var gsGreeting = window.__gardenState;
      var vc = gsGreeting && typeof gsGreeting.visitCount === 'number' ? gsGreeting.visitCount : 1;
      var isNight = t >= 0.75 && t < 1.0;
      if (isNight && vc >= 2 && !_greetedThisSession && _greetingTimer === 0) {
        _greetedThisSession = true;
        _greetingTimer = GREETING_DURATION;
      }
      if (_greetingTimer > 0) {
        _greetingTimer -= dt;
        if (_greetingTimer < 0) _greetingTimer = 0;
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

        /* Limit visible dots per season: dots beyond the ramp count get zero size */
        var effectiveMax = rampActive ? rampedDots : maxVisibleDots;
        if (i >= effectiveMax) {
          sizes[i] = 0;
          // Reset to base position (no drift for hidden dots)
          pos[i3] = dd.baseX;
          pos[i3 + 1] = dd.baseY;
          pos[i3 + 2] = dd.baseZ;
          continue;
        }

        if (!state.reducedMotion) {
          /* --- Pulsing: vary dot size with slow, irregular sine --- */
          // During the return-visitor greeting pulse (issue #706), all dots
          // peak synchronously with pulse=1.0 for the ~2s greeting duration.
          var _greetingActive = _greetingTimer > 0;
          var pulse = _greetingActive ? 1.0 : (Math.sin(time * dd.freq * Math.PI * 2 + dd.phaseOffset) * 0.5 + 0.5);
          // pulse ranges 0–1. Map to size multiplier: 0.5–1.0
          const sizeMul = 0.5 + pulse * 0.5;
          sizes[i] = dd.sizeBase * sizeMul;

          /* --- Butterfly proximity glow boost (issue #599) --- */
          // Detect butterfly proximity only during Night phase (t >= 0.75)
          if (t >= 0.75 && t < 1.0) {
            const creature = window.__gardenState && window.__gardenState.creature;
            if (creature && creature.group) {
              const bx = creature.group.position.x;
              const by = creature.group.position.y;
              const bz = creature.group.position.z;
              const dx = pos[i3] - bx;
              const dy = pos[i3 + 1] - by;
              const dz = pos[i3 + 2] - bz;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist <= 0.5) {
                // Trigger boost when butterfly is within threshold
                if (dd.glowBoostTimer <= 0) {
                  // Start a new boost: random 20-30% for 1.5-2.0 seconds
                  dd.glowBoostAmount = 0.20 + Math.random() * 0.10;
                  dd.glowBoostDuration = 1.5 + Math.random() * 0.5;
                  dd.glowBoostTimer = dd.glowBoostDuration;
                }
              }
            }
          }

          /* --- Decay glow boost timer and apply boost to size --- */
          if (dd.glowBoostTimer > 0) {
            dd.glowBoostTimer -= dt;
            if (dd.glowBoostTimer <= 0) {
              dd.glowBoostTimer = 0;
              dd.glowBoostAmount = 0;
            } else {
              // Linear decay: boost factor = 1 + amount * (remaining / duration)
              const boostFactor = 1 + dd.glowBoostAmount * (dd.glowBoostTimer / dd.glowBoostDuration);
              sizes[i] *= boostFactor;
            }
          }

          /* --- Drifting: slow sine-based movement within DRIFT_RADIUS --- */
          const driftX = Math.sin(time * DRIFT_FREQ + dd.driftPhase) * DRIFT_RADIUS * 0.6;
          const driftZ = Math.cos(time * DRIFT_FREQ * 0.9 + dd.driftAngle) * DRIFT_RADIUS * 0.6;
          const driftY = Math.sin(time * DRIFT_FREQ * 0.7 + dd.driftPhase * 1.3) * DRIFT_RADIUS * 0.3;

          /* --- Ground ripple wind perturbation (issue #606) --- */
          const weatherSwayMul = (window.__gardenState && window.__gardenState.weather && typeof window.__gardenState.weather.getSwayAmplitudeMul === 'function')
            ? window.__gardenState.weather.getSwayAmplitudeMul()
            : 1.0;
          const windDisp = computeDisplacement(dd.baseX, dd.baseZ, time);
          const windOffsetX = windDisp * WIND_DRIFT_SCALE * weatherSwayMul;
          const windOffsetZ = -windDisp * WIND_DRIFT_SCALE * weatherSwayMul;

          /* --- Pollination drift bias (issue #692) --- */
          // Compute subtle drift-centre offset toward recently pollinated flowers.
          // Iterates pollination events within POLLINATION_BIAS_RADIUS, weights each
          // by a tent function peaking at 60s (zero at 0s and 120s), and applies up
          // to POLLINATION_BIAS_MAX units of offset as a weighted average. Multiple
          // events create competing biases (weighted average of positions).
          // Effect is active any time (not just Night), but most visible during Night
          // when fireflies are already visible.
          let pollBiasX = 0;
          let pollBiasZ = 0;
          let pollWeightTotal = 0;
          {
            const gs = window.__gardenState;
            const events = gs && gs.pollinationEvents;
            if (events && events.length > 0) {
              const now = performance.now();
              for (var pei = 0; pei < events.length; pei++) {
                const ev = events[pei];
                const dx = dd.baseX - ev.x;
                const dz = dd.baseZ - ev.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist <= POLLINATION_BIAS_RADIUS) {
                  // Tent weight: peak at POLLINATION_BIAS_BUILD_UP_MS, zero at 0 and POLLINATION_BIAS_DECAY_MS
                  const elapsed = now - ev.timestamp;
                  if (elapsed >= 0 && elapsed < POLLINATION_BIAS_DECAY_MS) {
                    var tentWeight;
                    if (elapsed < POLLINATION_BIAS_BUILD_UP_MS) {
                      tentWeight = elapsed / POLLINATION_BIAS_BUILD_UP_MS;
                    } else {
                      tentWeight = 1 - (elapsed - POLLINATION_BIAS_BUILD_UP_MS) / (POLLINATION_BIAS_DECAY_MS - POLLINATION_BIAS_BUILD_UP_MS);
                    }
                    if (tentWeight > 0) {
                      // Distance falloff: 1 at zero distance, 0 at POLLINATION_BIAS_RADIUS
                      const distFalloff = 1 - (dist / POLLINATION_BIAS_RADIUS);
                      const weight = tentWeight * distFalloff * distFalloff;
                      pollBiasX += (ev.x - dd.baseX) * weight;
                      pollBiasZ += (ev.z - dd.baseZ) * weight;
                      pollWeightTotal += weight;
                    }
                  }
                }
              }
              if (pollWeightTotal > 0.0001) {
                const invW = 1 / pollWeightTotal;
                pollBiasX *= invW;
                pollBiasZ *= invW;
                // Clamp the vector magnitude to POLLINATION_BIAS_MAX
                const mag = Math.sqrt(pollBiasX * pollBiasX + pollBiasZ * pollBiasZ);
                if (mag > POLLINATION_BIAS_MAX) {
                  const scale = POLLINATION_BIAS_MAX / mag;
                  pollBiasX *= scale;
                  pollBiasZ *= scale;
                }
              }
            }
          }

          pos[i3] = dd.baseX + driftX + windOffsetX + pollBiasX;
          // Apply vertical lift offset for dusk emergence / dawn settling
          pos[i3 + 1] = dd.baseY + driftY + liftOffset;
          pos[i3 + 2] = dd.baseZ + driftZ + windOffsetZ + pollBiasZ;

          /* --- Bloom attraction drift perturbation (issue #680) --- */
          // During Night phase, firefly dots within BLOOM_ATTRACT_RADIUS of a
          // blooming flower experience a subtle position perturbation toward the
          // flower center — up to BLOOM_ATTRACT_MAX (10% of DRIFT_RADIUS) with
          // smooth distance falloff. Barely perceptible in isolation; adds to the
          // ecosystem feel. Disabled under prefers-reduced-motion.
          if (t >= 0.75 && t < 1.0) {
            const gs = window.__gardenState;
            if (gs) {
              var plantRefs = ['plant', 'plant2', 'plant3'];
              for (var pri = 0; pri < plantRefs.length; pri++) {
                var plantObj = gs[plantRefs[pri]];
                if (!plantObj || !plantObj.flower || typeof plantObj.flower.getPhase !== 'function') continue;
                if (plantObj.flower.getPhase() !== 'bloom') continue;
                var flowerPos = plantObj.flower.group.position;
                if (!flowerPos) continue;

                var fx = flowerPos.x;
                var fy = flowerPos.y;
                var fz = flowerPos.z;
                var dx = pos[i3] - fx;
                var dy = pos[i3 + 1] - fy;
                var dz = pos[i3 + 2] - fz;
                var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist <= BLOOM_ATTRACT_RADIUS && dist > 0.0001) {
                  // Smooth distance falloff: 1 at center, 0 at edge
                  var falloff = 1 - (dist / BLOOM_ATTRACT_RADIUS);
                  // Smoothstep: 3t^2 - 2t^3 for even gentler falloff near edge
                  var smoothFalloff = falloff * falloff * (3 - 2 * falloff);
                  var amount = BLOOM_ATTRACT_MAX * smoothFalloff;

                  // Direction from dot toward flower center (normalized)
                  var invDist = 1 / dist;
                  pos[i3] += (fx - pos[i3]) * invDist * amount;
                  pos[i3 + 1] += (fy - pos[i3 + 1]) * invDist * amount;
                  pos[i3 + 2] += (fz - pos[i3 + 2]) * invDist * amount;
                }
              }
            }
          }

          /* --- Butterfly landing firefly scatter (issue #690) --- */
          // During Night phase, when the butterfly enters 'descending' or 'resting'
          // state on a blooming flower, the nearest 2-3 firefly dots within
          // SCATTER_RADIUS (0.4 units) drift outward by 0.05-0.1 units over 2s,
          // then smoothly return over the next 4s. The scatter is subtle enough
          // to be felt rather than noticed. Disabled under prefers-reduced-motion.
          if (t >= 0.75 && t < 1.0 && !state.reducedMotion) {
            const gs = window.__gardenState;
            if (gs) {
              var creature = gs.creature;
              if (creature && typeof creature.pauseState === 'function' && typeof creature.pauseTargetPos === 'function') {
                var pauseState = creature.pauseState();
                var isLandingOrResting = (pauseState === 'descending' || pauseState === 'resting');
                var targetPos = creature.pauseTargetPos();

                if (isLandingOrResting && targetPos) {
                  // Check if this landing is on a blooming flower
                  var isOnBloomingFlower = false;
                  var plantRefs = ['plant', 'plant2', 'plant3'];
                  for (var pri = 0; pri < plantRefs.length; pri++) {
                    var plantObj = gs[plantRefs[pri]];
                    if (plantObj && plantObj.flower && typeof plantObj.flower.getPhase === 'function') {
                      if (plantObj.flower.getPhase() === 'bloom') {
                        var flowerPos = plantObj.flower.group.position;
                        if (flowerPos) {
                          var tdx = targetPos.x - flowerPos.x;
                          var tdy = targetPos.y - flowerPos.y;
                          var tdz = targetPos.z - flowerPos.z;
                          var tdist = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz);
                          if (tdist < 0.2) {
                            isOnBloomingFlower = true;
                            break;
                          }
                        }
                      }
                    }
                  }

                  if (isOnBloomingFlower) {
                    // Collect eligible dots within SCATTER_RADIUS of the landing target
                    var eligible = [];
                    for (var ei = 0; ei < group.count; ei++) {
                      var ed = group.dotData[ei];
                      if (ei >= effectiveMax) continue;
                      var ep3 = ei * 3;
                      var ex = pos[ep3] - targetPos.x;
                      var ey = pos[ep3 + 1] - targetPos.y;
                      var ez = pos[ep3 + 2] - targetPos.z;
                      var edist = Math.sqrt(ex * ex + ey * ey + ez * ez);
                      if (edist <= SCATTER_RADIUS) {
                        eligible.push({ idx: ei, dist: edist });
                      }
                    }

                    // Sort by distance, select nearest 2-3
                    eligible.sort(function(a, b) { return a.dist - b.dist; });
                    var scatterCount = Math.min(eligible.length, 2 + Math.floor(Math.random() * 2)); // 2-3

                    for (var si = 0; si < scatterCount; si++) {
                      var candidate = eligible[si];
                      var tdd = group.dotData[candidate.idx];
                      // Only trigger if not already scattering
                      if (tdd.scatterTimer <= 0) {
                        // Compute direction away from source
                        var tx = pos[candidate.idx * 3] - targetPos.x;
                        var ty = pos[candidate.idx * 3 + 1] - targetPos.y;
                        var tz = pos[candidate.idx * 3 + 2] - targetPos.z;
                        var tlen = Math.sqrt(tx * tx + ty * ty + tz * tz);
                        if (tlen > 0.0001) {
                          tdd.scatterDirX = tx / tlen;
                          tdd.scatterDirY = ty / tlen;
                          tdd.scatterDirZ = tz / tlen;
                        } else {
                          // Dot is exactly at target — pick a random outward direction
                          var randAngle = Math.random() * Math.PI * 2;
                          tdd.scatterDirX = Math.cos(randAngle);
                          tdd.scatterDirY = 0.2;
                          tdd.scatterDirZ = Math.sin(randAngle);
                        }
                        tdd.scatterAmount = 0.05 + Math.random() * 0.05; // 0.05-0.1
                        tdd.scatterTimer = SCATTER_TOTAL_DURATION;
                        tdd.scatterSourcePos = { x: targetPos.x, y: targetPos.y, z: targetPos.z };
                      }
                    }
                  }
                }
              }
            }
          }

          /* --- Apply scatter offset and decay --- */
          if (dd.scatterTimer > 0) {
            // scatterTimer counts down from SCATTER_TOTAL_DURATION
            var elapsed = SCATTER_TOTAL_DURATION - dd.scatterTimer;
            var progress = elapsed / SCATTER_TOTAL_DURATION; // 0→1 over 6s
            var buildUpFraction = SCATTER_BUILD_UP_TIME / SCATTER_TOTAL_DURATION; // 2/6 = 0.333

            var offsetAmount = 0;
            if (progress < buildUpFraction) {
              // Outward phase: 0→peak over build-up time, eased
              var normT = progress / buildUpFraction;
              // Quadratic ease-out: slow start then accelerate toward peak
              var eased = 1 - ((1 - normT) * (1 - normT));
              offsetAmount = dd.scatterAmount * eased;
            } else {
              // Return phase: peak→0 over remaining time, eased
              var returnProgress = (progress - buildUpFraction) / (1 - buildUpFraction);
              // Inverse smoothstep: starts fast, slows toward 0
              var eased = 1 - (returnProgress * returnProgress * (3 - 2 * returnProgress));
              offsetAmount = dd.scatterAmount * eased;
            }

            dd.scatterOffsetX = dd.scatterDirX * offsetAmount;
            dd.scatterOffsetY = dd.scatterDirY * offsetAmount;
            dd.scatterOffsetZ = dd.scatterDirZ * offsetAmount;

            dd.scatterTimer -= dt;
            if (dd.scatterTimer <= 0) {
              dd.scatterTimer = 0;
              dd.scatterOffsetX = 0;
              dd.scatterOffsetY = 0;
              dd.scatterOffsetZ = 0;
            }
          } else {
            // No active scatter — lerp any residual offset smoothly to 0
            if (Math.abs(dd.scatterOffsetX) > 0.0001 || Math.abs(dd.scatterOffsetY) > 0.0001 || Math.abs(dd.scatterOffsetZ) > 0.0001) {
              dd.scatterOffsetX *= 0.95;
              dd.scatterOffsetY *= 0.95;
              dd.scatterOffsetZ *= 0.95;
              if (Math.abs(dd.scatterOffsetX) < 0.0001) dd.scatterOffsetX = 0;
              if (Math.abs(dd.scatterOffsetY) < 0.0001) dd.scatterOffsetY = 0;
              if (Math.abs(dd.scatterOffsetZ) < 0.0001) dd.scatterOffsetZ = 0;
            }
          }

          // Apply scatter offset to position
          pos[i3] += dd.scatterOffsetX;
          pos[i3 + 1] += dd.scatterOffsetY;
          pos[i3 + 2] += dd.scatterOffsetZ;

          /* --- Sprout proximity glow boost (issue #646) --- */
          // During Night phase in Spring, fireflies within 0.3 units of a
          // sprout cluster get a 10-15% boost in glow intensity, decaying
          // smoothly with distance. Disabled under prefers-reduced-motion.
          if (t >= 0.75 && t < 1.0) {
            const seasonEl = document.getElementById('season-display');
            const currentSeason = seasonEl ? seasonEl.textContent.trim() : '';
            if (currentSeason === 'Spring') {
              const gs = window.__gardenState;
              const sprouts = gs && gs.groundSeeds && gs.groundSeeds.sprouts;
              if (sprouts && sprouts.length > 0) {
                const fx = pos[i3];
                const fy = pos[i3 + 1];
                const fz = pos[i3 + 2];
                let minDist = Infinity;
                for (let si = 0; si < sprouts.length; si++) {
                  const sp = sprouts[si];
                  if (sp.group) {
                    const sx = sp.group.position.x;
                    const sy = sp.group.position.y;
                    const sz = sp.group.position.z;
                    const dx = fx - sx;
                    const dy = fy - sy;
                    const dz = fz - sz;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (dist < minDist) minDist = dist;
                  }
                }
                if (minDist <= SPROUT_GLOW_BOOST_RADIUS) {
                  const boostFactor = 1 + (SPROUT_GLOW_BOOST_MAX * (1 - minDist / SPROUT_GLOW_BOOST_RADIUS));
                  sizes[i] *= boostFactor;
                }
              }
            }
          }
        } else {
          // Reduced motion: no pulsing/drift/lift/scatter, but keep size at base
          // During the return-visitor greeting pulse (issue #706), boost dot size
          // by 1.5x instantly (no eased transitions) so the greeting is visible
          // even when animation is reduced.
          var _greetingActiveRM = _greetingTimer > 0;
          sizes[i] = _greetingActiveRM ? dd.sizeBase * 1.5 : dd.sizeBase;
          pos[i3] = dd.baseX;
          pos[i3 + 1] = dd.baseY;
          pos[i3 + 2] = dd.baseZ;

          // Ensure scatter offsets are reset under reduced motion
          dd.scatterOffsetX = 0;
          dd.scatterOffsetY = 0;
          dd.scatterOffsetZ = 0;
          dd.scatterTimer = 0;

          /* --- Butterfly proximity glow boost (issue #599) — also active in reduced motion --- */
          if (t >= 0.75 && t < 1.0) {
            const creature = window.__gardenState && window.__gardenState.creature;
            if (creature && creature.group) {
              const bx = creature.group.position.x;
              const by = creature.group.position.y;
              const bz = creature.group.position.z;
              const dx = pos[i3] - bx;
              const dy = pos[i3 + 1] - by;
              const dz = pos[i3 + 2] - bz;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist <= 0.5) {
                if (dd.glowBoostTimer <= 0) {
                  dd.glowBoostAmount = 0.20 + Math.random() * 0.10;
                  dd.glowBoostDuration = 1.5 + Math.random() * 0.5;
                  dd.glowBoostTimer = dd.glowBoostDuration;
                }
              }
            }
          }

          if (dd.glowBoostTimer > 0) {
            dd.glowBoostTimer -= dt;
            if (dd.glowBoostTimer <= 0) {
              dd.glowBoostTimer = 0;
              dd.glowBoostAmount = 0;
            } else {
              const boostFactor = 1 + dd.glowBoostAmount * (dd.glowBoostTimer / dd.glowBoostDuration);
              sizes[i] *= boostFactor;
            }
          }
        }
      }

      group.geometry.attributes.position.needsUpdate = true;
      group.geometry.attributes.size.needsUpdate = true;
    }

    /* --- Firefly pulse synchronization (issue #639) --- */
    // Nearby firefly dots (within 0.15 units) gradually converge their pulse
    // phase offsets toward a shared group average (exponential smoothing,
    // α=0.002/frame ≈ 15s at 60fps), with a ±0.15 rad per-dot residual bias so
    // they never sync perfectly — always slightly organic. Dots with no
    // neighbour within 0.25 units drift back toward their original independent
    // phase over ~10s. Only active during Night (t ≥ 0.75); disabled entirely
    // under prefers-reduced-motion.
    const syncNight = t >= 0.75 && t < 1.0;
    if (syncNight && !state.reducedMotion) {
      // Gather all currently visible dots (season/ramp limited) with world positions
      var syncDots = [];
      for (var sgi = 0; sgi < plantGroups.length; sgi++) {
        var sgroup = plantGroups[sgi];
        var spos = sgroup.geometry.attributes.position.array;
        var sVisibleMax = rampActive ? rampedDots : maxVisibleDots;
        for (var sdi = 0; sdi < sgroup.count; sdi++) {
          if (sdi >= sVisibleMax) continue;
          syncDots.push({
            dd: sgroup.dotData[sdi],
            x: spos[sdi * 3],
            y: spos[sdi * 3 + 1],
            z: spos[sdi * 3 + 2]
          });
        }
      }

      // Two-pass update: compute all deltas using current phase offsets first,
      // then apply them simultaneously. This avoids sequential update asymmetry
      // where the i-th dot sees a partially updated phase offset from dot i-1.
      var syncUpdates = [];
      for (var si = 0; si < syncDots.length; si++) {
        var dotA = syncDots[si];
        var ddA = dotA.dd;

        // Average phase of dots within CONVERGE_RADIUS (self excluded)
        var groupPhase = 0;
        var groupSize = 0;
        var hasNearby = false;
        var hasAdjacent = false; // in the [CONVERGE, DIVERGE) hysteresis band

        for (var sj = 0; sj < syncDots.length; sj++) {
          if (sj === si) continue;
          var dotB = syncDots[sj];
          var ddx = dotA.x - dotB.x;
          var ddy = dotA.y - dotB.y;
          var ddz = dotA.z - dotB.z;
          var dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

          if (dist <= SYNC_CONVERGE_RADIUS) {
            hasNearby = true;
            groupPhase += dotB.dd.phaseOffset;
            groupSize++;
          } else if (dist <= SYNC_DIVERGE_RADIUS) {
            hasAdjacent = true;
          }
        }

        if (hasNearby) {
          // Deterministic per-dot residual bias in [-RESIDUAL_VARIANCE, +RESIDUAL_VARIANCE]
          // so a converged dot sits slightly off the group average — organic, never perfect.
          var residualBias = (ddA.originalPhaseOffset / (Math.PI * 2) - 0.5) * 2 * SYNC_RESIDUAL_VARIANCE;
          var avgPhase = groupPhase / groupSize;
          var delta = (avgPhase + residualBias - ddA.phaseOffset) * SYNC_CONVERGE_ALPHA;
          syncUpdates.push({
            dd: ddA,
            delta: delta,
            syncPhaseResidual: residualBias,
            syncActive: true
          });
        } else if (!hasAdjacent) {
          // No neighbour within DIVERGE_RADIUS: drift back toward independence
          var delta = (ddA.originalPhaseOffset - ddA.phaseOffset) * SYNC_DIVERGE_ALPHA;
          syncUpdates.push({
            dd: ddA,
            delta: delta,
            syncPhaseResidual: 0,
            syncActive: false
          });
        }
      }

      // Apply all updates simultaneously
      for (var ui = 0; ui < syncUpdates.length; ui++) {
        var upd = syncUpdates[ui];
        upd.dd.phaseOffset += upd.delta;
        upd.dd.syncPhaseResidual = upd.syncPhaseResidual;
        upd.dd.syncActive = upd.syncActive;
      }
    } else {
      // Sync inactive (daytime or reduced motion): clear the flag so state
      // reflects that no synchronization is currently happening
      for (var sgi2 = 0; sgi2 < plantGroups.length; sgi2++) {
        for (var sdi2 = 0; sdi2 < plantGroups[sgi2].dotData.length; sdi2++) {
          plantGroups[sgi2].dotData[sdi2].syncActive = false;
        }
      }
    }

    /* --- Firefly-to-plant surface glow (issue #613) --- */
    // Apply a subtle warm emissive colour shift to stem/leaf materials,
    // pulsing in sync with the nearest firefly's glow. Only during Night.
    const isNightPhase = t >= 0.75 && t < 1.0;
    const firefliesVisible = currentOpacity > 0.001;

    if (isNightPhase && firefliesVisible) {
      for (let gi = 0; gi < plantGroups.length; gi++) {
        const group = plantGroups[gi];
        const plantObj = window.__gardenState && window.__gardenState[group.plantRef];
        if (!plantObj || (!plantObj.stemMat && !plantObj.leafMat)) continue;

        // Find max pulse across visible dots in this group
        let maxPulse = 0;
        const visibleCount = Math.min(group.count, rampActive ? rampedDots : maxVisibleDots);
        for (let i = 0; i < visibleCount; i++) {
          const dd = group.dotData[i];
          let pulse;
          if (!state.reducedMotion) {
            pulse = Math.sin(time * dd.freq * Math.PI * 2 + dd.phaseOffset) * 0.5 + 0.5;
          } else {
            // Reduced motion: steady tint at 50% pulse (no pulsing)
            pulse = 0.5;
          }
          if (pulse > maxPulse) maxPulse = pulse;
        }

        const glowIntensity = maxPulse * MAX_GLOW_SHIFT; // capped at 0.10
        if (plantObj.stemMat) {
          plantObj.stemMat.emissive.setHex(WARM_GLOW_COLOR);
          plantObj.stemMat.emissiveIntensity = glowIntensity;
        }
        if (plantObj.leafMat) {
          plantObj.leafMat.emissive.setHex(WARM_GLOW_COLOR);
          plantObj.leafMat.emissiveIntensity = glowIntensity;
        }
      }
    } else {
      // Reset glow — outside Night phase or fireflies invisible/zero opacity (winter, overcast)
      for (let gi = 0; gi < plantGroups.length; gi++) {
        const group = plantGroups[gi];
        const plantObj = window.__gardenState && window.__gardenState[group.plantRef];
        if (!plantObj) continue;
        if (plantObj.stemMat) {
          plantObj.stemMat.emissiveIntensity = 0;
          plantObj.stemMat.emissive.setHex(0x000000);
        }
        if (plantObj.leafMat) {
          plantObj.leafMat.emissiveIntensity = 0;
          plantObj.leafMat.emissive.setHex(0x000000);
        }
      }
    }
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  const unsubMotion = onMotionChange(function(matches) {
    reducedMotion = matches;
    state.reducedMotion = matches;
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