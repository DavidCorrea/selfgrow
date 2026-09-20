/**
 * beetle.js — a tiny ground beetle near plant stems during warm conditions
 *
 * A single ellipsoid body (~0.01 units long) that crawls slowly near plant
 * bases during Spring/Summer Clear weather in daytime. Freezes when the
 * camera moves. Fades out during Light Drizzle, Overcast, Night, or Winter.
 * Reduced-motion: appears/disappears with weather/season cues but never
 * animates crawling.
 *
 * Exports: createBeetle(scene) → { group, update }
 *          selectPetalPauseTarget(petals, refPos, maxDist) → petal|null
 *          getSeasonalOpacity(seasonProgress, reducedMotion) → number
 */

import * as THREE from "three";
import { isReducedMotion } from "./motion.js";

/* --- Configuration --- */
const BODY_LENGTH = 0.01;         // units — elongate sphere for beetle body
const BODY_WIDTH_RATIO = 0.6;     // width relative to length
const BODY_HEIGHT_RATIO = 0.35;   // height relative to length (flattened)
const BODY_COLOR = 0x2a1a0a;      // dark brown/black

/* Crawl parameters */
const CRAWL_SPEED = 0.005;        // units/s — very slow
const CRAWL_ARC_RADIUS = 0.04;    // units — short path near plant base
const CRAWL_ARC_OFFSET = 0.02;    // units — offset from plant stem center

/* Fade transition */
const FADE_TIME_CONSTANT = 2.5;   // seconds — exponential lerp (~86% after 5s)

/* Camera stillness: must be still for this long before crawling resumes */
const SETTLE_STILLNESS_MIN = 20;  // seconds — matches creature.js convention

/* Petal pause (issue #772): after Light Drizzle ends, the beetle briefly
 * freezes at the nearest fallen petal from its anchor plant (2-4s), then
 * resumes crawling from the exact crawlPhase it held. */
const PETAL_PAUSE_MIN_MS = 2000;
const PETAL_PAUSE_MAX_MS = 4000;
const PETAL_PAUSE_COOLDOWN_MS = 20000; // seconds of quiet before the next pause
const PETAL_PAUSE_MAX_DIST = 0.15;      // units — petals land within ~0.08 of the stem

const PETAL_PAUSE_PHRASES = [
  'The beetle pauses to inspect a fallen petal.',
  'The ground beetle lingers beside a petal resting on the soil.',
  'A fallen petal draws the beetle\u2019s brief attention.',
  'The beetle halts at the fallen petal, still and intent.'
];

/**
 * Compute the seasonal opacity ramp multiplier for the beetle.
 *
 * During the first 20% of Spring, ramps from 0 to 1.
 * During the last 20% of Autumn, ramps from 1 to 0.
 * During Winter, returns 0 (beetle overwinters underground).
 * Otherwise (Summer, middle of Spring/Autumn), returns 1.
 * Under prefers-reduced-motion, returns 1 (no ramp — matches existing behavior
 * where the beetle appears/disappears at the threshold).
 *
 * This opacity multiplies the existing weather-fade opacity, so both layers
 * compose independently.
 *
 * @param {number} seasonProgress - 0-1 value from window.__gardenState.seasonProgress
 * @param {boolean} reducedMotion - prefers-reduced-motion is active
 * @returns {number} opacity multiplier in [0, 1]
 */
export function getSeasonalOpacity(seasonProgress, reducedMotion) {
  if (reducedMotion) return 1.0;

  // Derive season index (0=Spring, 1=Summer, 2=Autumn, 3=Winter)
  // and within-season progress (0-1) from the 0-1 cycle progress
  var seasonIndex = Math.floor(seasonProgress * 4) % 4;
  var withinSeasonProgress = (seasonProgress * 4) % 1;

  if (seasonIndex === 0 && withinSeasonProgress < 0.2) {
    // Spring ramp-up: first 20% of Spring, opacity 0→1
    return withinSeasonProgress / 0.2;
  }

  if (seasonIndex === 2 && withinSeasonProgress > 0.8) {
    // Autumn ramp-down: last 20% of Autumn, opacity 1→0
    return (1 - withinSeasonProgress) / 0.2;
  }

  if (seasonIndex === 3) {
    // Winter: beetle is overwintering underground
    return 0;
  }

  // Summer and middle portions of Spring/Autumn: full opacity
  return 1.0;
}

/* --- Helper: determine if beetle should be visible --- */
function shouldBeVisible(season, weather, timeOfDay) {
  // Visible during Spring OR Summer AND Clear weather AND daytime (not Night)
  const isWarmSeason = season === 'Spring' || season === 'Summer';
  const isClear = weather === 'Clear';
  const isDaytime = timeOfDay !== 'Night';

  return isWarmSeason && isClear && isDaytime;
}

/**
 * Pick the nearest fallen petal worth pausing at.
 *
 * Candidates are petals already resting on the ground ('resting') or fading
 * away once the drizzle ends ('fading') — 'falling' petals are still in the
 * air. Petals farther than maxDist from refPos are ignored. Returns null when
 * there is nothing nearby to pause at.
 *
 * @param {Array} petals - entries from a flower's getFallenPetals()
 * @param {{x: number, z: number}} refPos - position to measure distance from
 * @param {number} maxDist - maximum distance (units) to consider
 * @returns {object|null} nearest candidate petal entry, or null
 */
export function selectPetalPauseTarget(petals, refPos, maxDist) {
  if (!Array.isArray(petals) || !refPos ||
      typeof refPos.x !== 'number' || typeof refPos.z !== 'number') {
    return null;
  }
  const maxD = (typeof maxDist === 'number' && maxDist > 0) ? maxDist : Infinity;

  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < petals.length; i++) {
    const petal = petals[i];
    if (!petal) continue;
    if (petal.state !== 'resting' && petal.state !== 'fading') continue;
    const endPos = petal.endPos;
    if (!endPos || typeof endPos.x !== 'number' || typeof endPos.z !== 'number') continue;
    const dx = endPos.x - refPos.x;
    const dz = endPos.z - refPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > maxD) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = petal;
    }
  }
  return best;
}

/**
 * Create the ground beetle, add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function }}
 */
export function createBeetle(scene) {
  const group = new THREE.Group();
  group.name = 'ground-beetle';

  /* --- Body: a single ellipsoid (scaled sphere) --- */
  const bodyGeo = new THREE.SphereGeometry(BODY_LENGTH * 0.5, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    roughness: 0.85,
    metalness: 0.0,
    transparent: true,
    opacity: 0
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, BODY_HEIGHT_RATIO, BODY_WIDTH_RATIO);
  body.position.y = 0.005; // just above ground surface
  group.add(body);

  /* --- Burrow: a small dark ellipse visible on the ground during Winter --- */
  const burrowGeo = new THREE.CircleGeometry(0.003, 8);
  const burrowMat = new THREE.MeshBasicMaterial({
    color: 0x1a0a00,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const burrow = new THREE.Mesh(burrowGeo, burrowMat);
  burrow.rotation.x = -Math.PI / 2; // flat on ground
  burrow.position.y = 0.002; // just above ground surface
  burrow.visible = false;
  burrow.name = 'burrow';
  group.add(burrow);

  /* Start invisible */
  group.visible = false;

  scene.add(group);

  /* --- Internal state --- */
  let _opacity = 0;                // current fade opacity [0,1]
  let _targetOpacity = 0;          // target fade opacity
  let _prevUpdateTime = -1;        // for dt calculation
  let _crawlPhase = 0;             // current phase along crawl arc (radians)
  let _crawlActive = false;        // whether crawling animation is running
  let _anchorPos = null;           // { x, z } — plant stem anchor
  let _anchorFound = false;        // whether we've found a plant anchor
  let _anchorLabel = null;         // which plant ('plant'/'plant2'/'plant3') is anchored

  /* Petal pause state (issue #772) */
  let _prevWeather = '';               // last frame's weather — detects drizzle end
  let _petalPauseEligible = false;     // drizzle just ended — one pause may fire
  let _petalPauseActive = false;       // pause currently in progress
  let _petalPauseElapsed = 0;          // ms spent paused so far
  let _petalPauseDuration = 0;         // ms to stay paused (2-4s)
  let _prePauseCrawlPhase = 0;         // crawlPhase snapshot for a clean resume
  let _pauseTargetPetal = null;        // the petal being examined
  let _lastPetalPauseTime = -Infinity; // timestamp of the previous pause

  /* --- Determine anchor position: nearest plant stem --- */
  function findAnchor() {
    const gs = window.__gardenState;
    if (!gs) return null;

    // Try plant, plant2, plant3 in order — use first available
    const plantLabels = ['plant', 'plant2', 'plant3'];
    for (let i = 0; i < plantLabels.length; i++) {
      const plant = gs[plantLabels[i]];
      if (plant && plant.group) {
        const pos = plant.group.position;
        return { x: pos.x, z: pos.z, label: plantLabels[i] };
      }
    }
    return null;
  }

  /* Attempt initial anchor */
  const initialAnchor = findAnchor();
  if (initialAnchor) {
    _anchorPos = initialAnchor;
    _anchorFound = true;
    _anchorLabel = initialAnchor.label;
    // Place group at anchor + slight offset so beetle sits near the stem base
    group.position.set(
      _anchorPos.x + CRAWL_ARC_OFFSET,
      0.005,
      _anchorPos.z
    );
  }

  /* --- Petal pause helpers (issue #772) --- */

  /* Clear any in-progress pause. When restoreCrawlPhase is true the crawl
   * phase is restored from its pre-pause snapshot, so crawling resumes from
   * exactly where it stopped. */
  function clearPetalPause(restoreCrawlPhase) {
    if (restoreCrawlPhase && _petalPauseActive) {
      _crawlPhase = _prePauseCrawlPhase;
    }
    _petalPauseActive = false;
    _petalPauseElapsed = 0;
    _petalPauseDuration = 0;
    _prePauseCrawlPhase = 0;
    _pauseTargetPetal = null;
  }

  /* Face the paused beetle toward its petal target (matches the crawl's
   * atan2(dx, dz) facing convention). */
  function rotateTowardPauseTarget() {
    const targetPos = _pauseTargetPetal && _pauseTargetPetal.endPos;
    if (!targetPos) return;
    const dx = targetPos.x - group.position.x;
    const dz = targetPos.z - group.position.z;
    if (dx === 0 && dz === 0) return;
    group.rotation.y = Math.atan2(dx, dz);
  }

  /* Tell the DOM layer what is happening — the acknowledgment panel is the
   * text description of the garden's current state. */
  function postPetalPauseAcknowledgment() {
    const ackEl = document.getElementById('garden-state-acknowledgment');
    if (!ackEl) return;
    ackEl.textContent = PETAL_PAUSE_PHRASES[Math.floor(Math.random() * PETAL_PAUSE_PHRASES.length)];
  }

  /* Begin a one-shot pause at the nearest fallen petal from the anchor
   * plant's flower. Safe to call every frame — it either starts a pause,
   * stays quiet, or gives up eligibility once petals have faded away. */
  function tryStartPetalPause() {
    if (_petalPauseActive || !_petalPauseEligible || !_anchorFound) return;

    const now = performance.now();
    if (now - _lastPetalPauseTime < PETAL_PAUSE_COOLDOWN_MS) return;

    const gs = window.__gardenState;
    const plant = _anchorLabel && gs && gs[_anchorLabel];
    const flower = plant && plant.flower;
    if (!flower || typeof flower.getFallenPetals !== 'function') return;

    const petals = flower.getFallenPetals();
    if (!Array.isArray(petals) || petals.length === 0) {
      // Every petal has faded away — nothing left to pause at.
      _petalPauseEligible = false;
      return;
    }

    const target = selectPetalPauseTarget(
      petals,
      { x: group.position.x, z: group.position.z },
      PETAL_PAUSE_MAX_DIST
    );
    if (!target) {
      // Petals exist but none have settled within reach yet (they may still
      // be falling) — keep eligibility so one touching down can trigger.
      return;
    }

    // Freeze the crawl, snapshot the phase, reorient toward the petal.
    _petalPauseActive = true;
    _prePauseCrawlPhase = _crawlPhase;
    _pauseTargetPetal = target;
    _petalPauseDuration = PETAL_PAUSE_MIN_MS + Math.random() * (PETAL_PAUSE_MAX_MS - PETAL_PAUSE_MIN_MS);
    _petalPauseElapsed = 0;
    _lastPetalPauseTime = now;
    _petalPauseEligible = false; // one-shot — a single pause per rain event
    rotateTowardPauseTarget();
    postPetalPauseAcknowledgment();
  }

  /* --- Update function, called every animation frame --- */
  function update(time) {
    /* Frame-rate-independent dt */
    let dt = 0.016;
    if (_prevUpdateTime >= 0) {
      dt = Math.max(0, Math.min(time - _prevUpdateTime, 0.05));
    }
    _prevUpdateTime = time;

    /* Re-check anchor on first frame or if plant changes */
    if (!_anchorFound) {
      const anchor = findAnchor();
      if (anchor) {
        _anchorPos = anchor;
        _anchorFound = true;
        _anchorLabel = anchor.label;
        group.position.set(
          _anchorPos.x + CRAWL_ARC_OFFSET,
          0.005,
          _anchorPos.z
        );
      }
    }

    /* Read current season, weather, time from DOM */
    const season = (document.getElementById('season-display')?.textContent || '').trim();
    const weather = (document.getElementById('weather-display')?.textContent || '').trim();
    const timeOfDay = (document.getElementById('time-display')?.textContent || '').trim();

    /* Detect the end of a Light Drizzle: resting petals are now on the ground
     * (garden.js flips them to 'fading' the moment drizzle ends), so the
     * beetle becomes eligible for a single pause at the nearest petal. */
    if (_prevWeather === 'Light Drizzle' && weather !== 'Light Drizzle') {
      _petalPauseEligible = true;
    }
    _prevWeather = weather;

    /* Check reduced motion */
    const reducedMotion = isReducedMotion();

    /* --- Seasonal opacity ramp (issue #775) ---
     * Read seasonProgress from garden state to determine seasonal emergence/
     * retreat. The seasonal opacity multiplies the weather-fade target, so
     * the beetle fades in gradually during early Spring and fades out
     * during late Autumn, independently of weather transitions. */
    const seasonProgress = window.__gardenState && typeof window.__gardenState.seasonProgress === 'number'
      ? window.__gardenState.seasonProgress
      : 0;
    const seasonalOpacity = getSeasonalOpacity(seasonProgress, reducedMotion);

    /* Derive season index for burrow visibility — same derivation as in
     * getSeasonalOpacity so they stay in sync. */
    const _seasonIndex = Math.floor(seasonProgress * 4) % 4;

    /* Determine target visibility: weather/season/time conditions combined
     * with the seasonal opacity ramp. */
    const shouldShow = shouldBeVisible(season, weather, timeOfDay);
    _targetOpacity = shouldShow ? seasonalOpacity : 0.0;

    if (reducedMotion) {
      // No animation — just appear/disappear based on weather/season/time
      clearPetalPause(true); // the beetle never pauses under reduced motion
      if (shouldShow && seasonalOpacity > 0 && _anchorFound) {
        group.visible = true;
        bodyMat.opacity = 1.0;
        body.scale.set(1, BODY_HEIGHT_RATIO, BODY_WIDTH_RATIO);
        // Sit still at anchor — no crawl animation
        group.position.set(
          _anchorPos.x + CRAWL_ARC_OFFSET,
          0.005,
          _anchorPos.z
        );
      } else {
        group.visible = false;
        bodyMat.opacity = 0;
      }
      // Burrow: visible during Winter regardless of other conditions
      burrow.visible = _seasonIndex === 3;
      if (_anchorFound && _seasonIndex === 3) {
        // Position burrow near anchor
        burrow.position.set(
          _anchorPos.x + CRAWL_ARC_OFFSET,
          0.002,
          _anchorPos.z
        );
      }
      return;
    }

    /* If the environment is no longer active mid-pause (drizzle returns,
     * night falls, etc.), abort the pause so the fade-out stays neutral. */
    if (_petalPauseActive && _targetOpacity <= 0) {
      clearPetalPause(true);
    }

    /* --- Exponential fade toward target --- */
    if (_targetOpacity > _opacity) {
      _opacity = _opacity + (_targetOpacity - _opacity) * (1 - Math.exp(-dt / FADE_TIME_CONSTANT));
    } else {
      _opacity = _opacity + (_targetOpacity - _opacity) * (1 - Math.exp(-dt / FADE_TIME_CONSTANT));
    }

    // Clamp
    if (_opacity < 0.005) _opacity = 0;
    if (_opacity > 0.995) _opacity = 1;

    bodyMat.opacity = _opacity;

    /* Show/hide group based on opacity */
    if (_opacity > 0.005 && _anchorFound) {
      group.visible = true;
    } else {
      group.visible = false;
    }

    /* --- Burrow visibility (issue #775) ---
     * During Winter, show a small dark opening where the beetle overwinters.
     * Visible only during Winter (seasonIndex === 3), positioned near anchor. */
    burrow.visible = _seasonIndex === 3;
    if (_anchorFound && _seasonIndex === 3) {
      burrow.position.set(
        _anchorPos.x + CRAWL_ARC_OFFSET,
        0.002,
        _anchorPos.z
      );
    }

    if (!_anchorFound || _opacity <= 0) {
      clearPetalPause(true);
      return;
    }

    /* --- Camera stillness check --- */
    let isCameraStill = true;
    if (window.__gardenState && typeof window.__gardenState._stillnessDuration === 'number') {
      const stillnessSec = window.__gardenState._stillnessDuration / 1000;
      isCameraStill = stillnessSec >= SETTLE_STILLNESS_MIN;
    }

    if (!isCameraStill) {
      // Camera just moved — freeze in place, don't advance crawl phase
      _crawlActive = false;
      clearPetalPause(true); // abort any petal pause and resume from its snapshot
      return;
    }

    /* --- Petal pause (issue #772): hold at the fallen petal for 2-4s --- */
    if (_petalPauseActive) {
      _petalPauseElapsed += dt * 1000;
      rotateTowardPauseTarget();
      if (_petalPauseElapsed >= _petalPauseDuration) {
        // Pause complete — resume exactly where the crawl left off.
        _crawlPhase = _prePauseCrawlPhase;
        clearPetalPause(false);
      } else {
        // Position stays frozen at the pause spot.
        return;
      }
    }

    /* One-shot pause at a fallen petal after Light Drizzle ends (issue #772). */
    tryStartPetalPause();
    if (_petalPauseActive) {
      return; // pause began this frame — hold the current spot
    }

    /* --- Crawl animation (only when camera is still) --- */
    _crawlActive = true;

    // Advance crawl phase slowly (~0.005 units/s)
    _crawlPhase += CRAWL_SPEED / CRAWL_ARC_RADIUS * dt;

    // Short arc near plant base: figure-eight or small looping path
    // Using a lemniscate-like pattern for organic appearance
    const arcX = Math.sin(_crawlPhase * 1.0) * CRAWL_ARC_RADIUS;
    const arcZ = Math.sin(_crawlPhase * 2.0) * CRAWL_ARC_RADIUS * 0.6;

    // Small forward drift to keep it from being too perfectly periodic
    const driftX = Math.sin(_crawlPhase * 0.3) * CRAWL_ARC_OFFSET * 0.3;

    group.position.x = _anchorPos.x + arcX + driftX;
    group.position.z = _anchorPos.z + arcZ;
    group.position.y = 0.005;

    // Subtle rotation to face direction of travel
    group.rotation.y = Math.atan2(
      Math.cos(_crawlPhase * 1.0) * CRAWL_ARC_RADIUS * 1.0,
      Math.cos(_crawlPhase * 2.0) * CRAWL_ARC_RADIUS * 2.0 * 0.6
    );
  }

  return { group, update };
}