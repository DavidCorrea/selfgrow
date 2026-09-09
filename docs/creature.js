/**
 * creature.js — a small drifting butterfly at the garden periphery
 *
 * A single tiny butterfly silhouette that drifts at the scene edge on a slow,
 * organic looping path. Made from two crossed flat wing meshes. Wing flap is
 * a slow sine animation (<0.5 Hz). Fully invisible when prefers-reduced-motion
 * is active.
 *
 * Exports: createCreature(scene) → { group, update, destroy, state }
 */

import * as THREE from "three";
import { computeDisplacement } from "./groundRipple.js";

/* --- Sprout attraction (issue #629) --- */
const SPROUT_ATTRACT_CYCLE_DURATION = 60; // seconds for a full approach+return cycle
const SPROUT_ATTRACT_MAX_OFFSET = 0.25;    // max offset units toward sprout cluster
import { isReducedMotion, onMotionChange } from "./motion.js";

/* --- Configuration --- */
const WING_SPAN = 0.07;           // tiny — a few pixels on screen
const WING_ASPECT = 0.6;          // width / height ratio of each wing half
const WING_COLOR = 0x3a3a5a;      // dark silhouette tone

/* Orbit path parameters */
const ORBIT_RADIUS_MIN = 0.5;     // can dip close to centre for flower visits
const ORBIT_RADIUS_MAX = 2.5;     // stays at periphery
const ORBIT_HEIGHT_MIN = 0.5;     // low above ground
const ORBIT_HEIGHT_MAX = 2.0;     // up to eye level

/* Overcast shelter: butterfly flies lower during Overcast weather (issue #633) */
const OVERCAST_HEIGHT_MIN = 0.3;     // lower flight during overcast
const OVERCAST_HEIGHT_MAX = 1.2;     // reduced max height during overcast
const SHELTER_LERP_TIME_CONSTANT = 1.0; // seconds — ~95% complete in 3s
const ORBIT_SPEED = 0.08;         // unhurried (rad/s) — completes cycle in ~78s

/* --- Seasonal activity multipliers (lerped smoothly) --- */
let _currentSeasonOrbitMul = 1.0;   // lerps toward target
let _currentSeasonFlapMul = 1.0;
let _currentSeasonRadiusMul = 1.0;

/* Season target multipliers: Spring/Summer → active, Autumn → slow, Winter → dormant */
const SEASON_TARGETS = {
  'Spring': { orbit: 1.2, flap: 1.3, radius: 1.15 },
  'Summer': { orbit: 1.2, flap: 1.3, radius: 1.15 },
  'Autumn': { orbit: 0.7, flap: 0.7, radius: 0.9 },
  'Winter': { orbit: 0.2, flap: 0.3, radius: 0.6 }
};

/* Pause (butterfly visits blooming flower) parameters */
const PAUSE_PROXIMITY = 0.4;      // units — trigger distance to a blooming flower
const PAUSE_SPEED_MUL = 0.5;      // slow to ~50% during pause
const PAUSE_ENTER_DURATION = 1.0; // seconds to ease into the pause
const PAUSE_HOLD_MIN = 3.0;       // minimum hold seconds
const PAUSE_HOLD_MAX = 5.0;       // maximum hold seconds
const PAUSE_EXIT_DURATION = 1.0;  // seconds to ease back to normal flight
const PAUSE_DIP_AMOUNT = 0.15;    // how much closer the butterfly dips to the flower

/* Landing (butterfly rests on a leaf) parameters */
const LANDING_PROBABILITY = 0.4;      // ~40% chance to land after pausing
const LANDING_DESCEND_DURATION = 2.0; // seconds to spiral down to leaf
const LANDING_REST_MIN = 5.0;         // minimum rest seconds on leaf
const LANDING_REST_MAX = 10.0;        // maximum rest seconds on leaf
const LANDING_ASCEND_DURATION = 2.0;  // seconds to rise back to orbit
const LANDING_SWAY_AMPLITUDE = 0.003; // barely-perceptible sway while resting

/* Wing flap animation */
const FLAP_SPEED = 0.4;           // <0.5 Hz slow flap
const FLAP_ANGLE_MAX = 0.6;       // radians, how far wings open/close

/* Weather shelter fade time constant (~5s for near-complete fade) */
const WEATHER_FADE_TIME_CONSTANT = 2.5; // seconds — ~86% complete after 5s

/* Wind perturbation — subtle drift from ground ripple wind */
const WIND_NUDGE_SCALE = 6.25;  // maps ~±0.008 max ripple amplitude to ±0.05 max drift

/* Per-axis phase offsets for organic Lissajous-like looping */
const PHASE_X = 0.0;
const PHASE_Z = Math.PI * 0.37;   // offsets so path doesn't repeat quickly
const PHASE_Y = Math.PI * 0.73;
const FREQ_X = 1.0;               // base frequency multiplier
const FREQ_Z = 0.83;              // slightly different for non-repeating loop
const FREQ_Y = 0.64;

/* Camera reaction timers (issue #559) */
let _lastCameraMoveTime = 0;
let _lastReactionTime = 0;
const CAMERA_BOOST = 1.2;
const CAMERA_BOOST_DURATION = 2.0; // seconds boost lasts
const CAMERA_COOLDOWN = 10.0;       // seconds before next reaction

/**
 * Create a small butterfly creature and add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function, destroy: Function, state: object }}
 */
export function createCreature(scene) {
  /* --- Detect reduced motion --- */
  let reducedMotion = isReducedMotion();

  /* Track last update time for dt calculation (frame-rate-independent lerp) */
  let _prevUpdateTime = -1;

  /* --- Build the butterfly group --- */
  const group = new THREE.Group();
  group.name = 'creature';

  /* Shared wing material */
  const wingMat = new THREE.MeshBasicMaterial({
    color: WING_COLOR,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true
  });

  /* Left wing mesh — a simple rounded triangle / oval shape */
  const leftWingShape = new THREE.Shape();
  const w = WING_SPAN / 2;
  const h = w * WING_ASPECT;
  leftWingShape.moveTo(0, 0);
  leftWingShape.quadraticCurveTo(w * 0.7, h * 0.6, w * 0.9, 0);
  leftWingShape.quadraticCurveTo(w * 0.7, -h * 0.3, 0, 0);

  const leftWingGeo = new THREE.ShapeGeometry(leftWingShape);
  const leftWing = new THREE.Mesh(leftWingGeo, wingMat);
  leftWing.name = 'left-wing';
  group.add(leftWing);

  /* Right wing mesh — mirrored */
  const rightWingShape = new THREE.Shape();
  rightWingShape.moveTo(0, 0);
  rightWingShape.quadraticCurveTo(-w * 0.7, h * 0.6, -w * 0.9, 0);
  rightWingShape.quadraticCurveTo(-w * 0.7, -h * 0.3, 0, 0);

  const rightWingGeo = new THREE.ShapeGeometry(rightWingShape);
  const rightWing = new THREE.Mesh(rightWingGeo, wingMat);
  rightWing.name = 'right-wing';
  group.add(rightWing);

  /* Tiny body — a small line segment between the wings */
  const bodyGeo = new THREE.PlaneGeometry(0.008, 0.03);
  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0x2a2a3a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1.0,
    depthWrite: false
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'body';
  group.add(body);

  /* Set initial rotation so the butterfly is seen from above/side */
  group.rotation.x = 0.3;
  group.rotation.y = 0;
  group.rotation.z = 0;

  scene.add(group);

  /* Base wing opacity stored for weather fade */
  const WING_BASE_OPACITY = 0.45;

  /* --- Pause state machine --- */
  // States: 'idle' | 'entering' | 'holding' | 'exiting'
  //         | 'descending' | 'resting' | 'ascending'
  let pauseState = 'idle';
  let pauseTimer = 0;
  let pauseHoldDuration = 0;
  let pauseTargetPos = null;      // { x, y, z } — the flower position we're pausing at
  let pauseEaseT = 0;             // 0→1 for entering/exiting ease
  let pauseSpeedMul = 1.0;        // 1.0 normally, 0.5 during pause
  let pauseOriginPos = null;      // { x, y, z } — where we were when pause triggered
  let pauseDipTarget = null;      // { x, y, z } — the dipped position near the flower
  let pauseCooldown = 0;          // seconds after exiting before next pause can trigger

  /* Landing on a leaf state */
  let landingLeafPos = null;      // { x, y, z } — the leaf surface position
  let landingStartPos = null;     // { x, y, z } — where we started descending/ascending
  let landingRestTimer = 0;       // seconds into the rest
  let landingRestDuration = 0;    // total rest seconds (random 5-10)
  let landingSpiralAngle = 0;     // accumulated angle for spiral descent

  /* Leaf displacement under butterfly weight (issue #604) */
  let landingLeafMesh = null;       // reference to the leaf mesh being rested on
  let leafOriginalRotX = 0;         // original rotation.x of the leaf
  let leafOriginalPosY = 0;         // original position.y of the leaf
  let leafDisplacementT = 0;        // 0→1 displacement ease timer
  let leafIsDisplaced = false;      // whether leaf is currently displaced
  const LEAF_DISPLACE_DURATION = 0.5; // seconds for ease-in/out
  const LEAF_DISPLACE_ROT = 0.05;    // radians — additional rotation.x (downward tilt)
  const LEAF_DISPLACE_POS_Y = -0.02; // units — downward y-displacement

  /* Pollination tracking (issue #614): which plant the butterfly landed on */
  let landingPlantLabel = null;      // 'plant' or 'plant2' — set when landing decision is made

  /* --- Tracks the current wind nudge for selftest --- */
  let _windNudge = 0;

  /* --- Firefly attraction tracking for selftest (issue #598) --- */
  let _fireflySlowMul = 1.0;
  let _fireflyBiasX = 0;
  let _fireflyBiasZ = 0;
  let _isNightPhase = false;

  /* --- Firefly sync-zone slowdown tracking (issue #647) --- */
  let _syncSlowMul = 1.0;          // multiplier: 1.0 normal, ~0.85 when slowed
  let _syncSlowTimer = 0;           // seconds remaining in the slowdown
  const SYNC_SLOW_MUL_TARGET = 0.85;  // ~15% reduction
  const SYNC_SLOW_DURATION = 3.0;     // seconds — 2-3s, use 3s as the max hold
  const SYNC_SLOW_LERP_TIME_CONSTANT = 0.3; // seconds for exponential fade in/out (~95% complete in ~0.9s)
  const SYNC_ZONE_RADIUS = 0.4;       // units — proximity to sync clus

  /* --- Overcast shelter level for selftest (issue #633) --- */
  let _shelterLevel = 0;          // 0 = no shelter (Clear), 1 = full shelter (Overcast)

  /* --- Sprout attraction offset for selftest (issue #629) --- */
  let _sproutOffsetX = 0;
  let _sproutOffsetZ = 0;

  /* --- Leaf brush tremble tracking (issue #640) --- */
  // Each entry: { leaf, originalRotX, startTime }
  let _leafTrembles = [];

  /* --- State exposed for selftest --- */
  const state = {
    type: 'creature',
    reducedMotion,
    wingMat,
    leftWing,
    rightWing,
    bodyMat,
    group,
    orbitSpeed: ORBIT_SPEED,
    radiusMin: ORBIT_RADIUS_MIN,
    radiusMax: ORBIT_RADIUS_MAX,
    weatherOpacity: 1.0,
    /* Seasonal multiplier access for selftest */
    getSeasonOrbitMul: () => _currentSeasonOrbitMul,
    getSeasonFlapMul: () => _currentSeasonFlapMul,
    getSeasonRadiusMul: () => _currentSeasonRadiusMul,
    /* Pause state exposed for testing */
    pauseState: () => pauseState,
    pauseTargetPos: () => pauseTargetPos ? { ...pauseTargetPos } : null,
    pauseSpeedMul: () => pauseSpeedMul,
    pauseEaseT: () => pauseEaseT,
    /* Wind perturbation exposed for selftest */
    windNudge: () => _windNudge,
    /* Landing state exposed for testing */
    landingLeafPos: () => landingLeafPos ? { ...landingLeafPos } : null,
    landingRestTimer: () => landingRestTimer,
    landingRestDuration: () => landingRestDuration,
    /* Leaf displacement accessors (issue #604) */
    leafDisplacementT: () => leafDisplacementT,
    leafIsDisplaced: () => leafIsDisplaced,
    leafOriginalRotX: () => leafOriginalRotX,
    leafOriginalPosY: () => leafOriginalPosY,
    /* Camera boost getter for selftest (issue #559) */
    getCameraBoost: () => {
      if (!state.reducedMotion && _lastReactionTime > 0) {
        const elapsed = performance.now() - _lastReactionTime;
        if (elapsed < CAMERA_BOOST_DURATION * 1000) return CAMERA_BOOST;
      }
      return 1.0;
    },
    /* Firefly attraction accessors for selftest (issue #598) */
    getFireflySlowMul: () => _fireflySlowMul,
    getFireflyBias: () => ({ x: _fireflyBiasX, z: _fireflyBiasZ }),
    isNightPhase: () => _isNightPhase,
    /* Firefly sync-zone slowdown accessor for selftest (issue #647) */
    getSyncSlowMul: () => _syncSlowMul,
    /* Sprout attraction accessors for selftest (issue #629) */
    getSproutOffset: () => ({ x: _sproutOffsetX, z: _sproutOffsetZ }),
    /* Leaf brush tremble accessors for selftest (issue #640) */
    getLeafTrembles: () => _leafTrembles.map(t => ({
      leaf: t.leaf,
      originalRotX: t.originalRotX,
      startTime: t.startTime,
      elapsed: performance.now() - t.startTime
    })),
    /* Overcast shelter accessors for selftest (issue #633) */
    getShelterLevel: () => _shelterLevel,
    ORBIT_HEIGHT_MIN,
    ORBIT_HEIGHT_MAX,
    OVERCAST_HEIGHT_MIN,
    OVERCAST_HEIGHT_MAX
  };

  /* Start invisible if reduced motion is active */
  if (reducedMotion) {
    group.visible = false;
  }

  /* --- Update function (called every frame from the animation loop) --- */
  function update(time) {
    /* --- Frame-rate-independent dt for smooth opacity lerp --- */
    let dt = 0.016; // default ~60fps
    if (_prevUpdateTime >= 0) {
      dt = Math.max(0, Math.min(time - _prevUpdateTime, 0.05)); // clamp to [0, 0.05] so time going backwards never rewinds animations
    }
    _prevUpdateTime = time;

    /* --- Weather shelter: fade butterfly when Light Drizzle --- */
    if (window.__gardenState && window.__gardenState.weather) {
      const phase = window.__gardenState.weather.getPhase();
      const target = (phase === 'Light Drizzle') ? 0.0 : 1.0;
      // Exponential lerp toward target (~5s to near-complete fade)
      state.weatherOpacity = state.weatherOpacity + (target - state.weatherOpacity) * (1 - Math.exp(-dt / WEATHER_FADE_TIME_CONSTANT));
    }

    /* Apply weather opacity to materials */
    wingMat.opacity = WING_BASE_OPACITY * state.weatherOpacity;
    bodyMat.opacity = state.weatherOpacity;

    if (state.reducedMotion) {
      group.visible = false;
      return;
    }

    /* --- Overcast shelter: butterfly flies lower in stronger wind (issue #633) --- */
    if (window.__gardenState && window.__gardenState.weather) {
      const phase = window.__gardenState.weather.getPhase();
      const target = (phase === 'Overcast') ? 1.0 : 0.0;
      // Exponential lerp toward target — ~95% complete in 3s
      _shelterLevel = _shelterLevel + (target - _shelterLevel) * (1 - Math.exp(-dt / SHELTER_LERP_TIME_CONSTANT));
    }

    /* --- Night phase: firefly-attracted flight (issue #598) --- */
    _isNightPhase = false;
    _fireflySlowMul = 1.0;
    _fireflyBiasX = 0;
    _fireflyBiasZ = 0;
    if (window.__gardenState && window.__gardenState.dayNight) {
      const t = window.__gardenState.dayNight.getCycleProgress();
      if (t >= 0.75 && t < 1.0) {
        _isNightPhase = true;
        // Butterfly stays active at night, orbit biased toward firefly glow
      }
    }

    /* --- Firefly speed reduction: compute before orbit to affect same frame --- */
    if (_isNightPhase && !state.reducedMotion) {
      const fireflies = window.__gardenState && window.__gardenState.fireflies;
      if (fireflies && typeof fireflies.getAllPositions === 'function') {
        const positions = fireflies.getAllPositions();
        if (positions.length > 0) {
          // Use the creature's current position as reference for proximity
          let cx = group.position.x;
          let cz = group.position.z;
          let minDist = Infinity;
          for (let fi = 0; fi < positions.length; fi++) {
            let dx = positions[fi].x - cx;
            let dz = positions[fi].z - cz;
            let dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < minDist) { minDist = dist; }
          }
          // Speed reduction ~20% when within glow zone (≤0.5 units)
          if (minDist <= 0.5) {
            let proximityFactor = Math.min(1, minDist / 0.5);
            _fireflySlowMul = 0.8 + (1.0 - 0.8) * proximityFactor;
          }
        }
      }
    }

    /* --- Firefly sync-zone slowdown: butterfly briefly slows when passing near
     * synchronized firefly clusters during Night (issue #647) --- */
    // Only active during Night phase and when prefers-reduced-motion is NOT active
    _syncSlowMul = 1.0;
    if (_isNightPhase && !state.reducedMotion) {
      const fireflies = window.__gardenState && window.__gardenState.fireflies;
      if (fireflies && typeof fireflies.getAllPositions === 'function' && typeof fireflies.getSyncState === 'function') {
        const positions = fireflies.getAllPositions();
        const syncStates = fireflies.getSyncState();
        if (positions.length > 0 && syncStates.length === positions.length) {
          // Use the creature's current position to check proximity to sync-active dots
          let cx = group.position.x;
          let cz = group.position.z;
          let inSyncZone = false;
          for (let fi = 0; fi < positions.length; fi++) {
            if (!syncStates[fi].syncActive) continue; // only synchronized dots matter
            let dx = positions[fi].x - cx;
            let dz = positions[fi].z - cz;
            let dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= SYNC_ZONE_RADIUS) {
              inSyncZone = true;
              break;
            }
          }

          if (inSyncZone) {
            // Refreshes the slowdown timer while the butterfly remains in the sync zone
            _syncSlowTimer = SYNC_SLOW_DURATION;
          }
        }
      }

      // Tick down the timer and compute the multiplier via exponential lerp
      if (_syncSlowTimer > 0) {
        _syncSlowTimer -= dt;
        if (_syncSlowTimer <= 0) {
          _syncSlowTimer = 0;
        }
        // Exponential lerp toward target (~0.3s time constant for smooth fade-in)
        _syncSlowMul = _syncSlowMul + (SYNC_SLOW_MUL_TARGET - _syncSlowMul) * (1 - Math.exp(-dt / SYNC_SLOW_LERP_TIME_CONSTANT));
      } else {
        // Exponential lerp back to 1.0 (smooth fade-out)
        _syncSlowMul = _syncSlowMul + (1.0 - _syncSlowMul) * (1 - Math.exp(-dt / SYNC_SLOW_LERP_TIME_CONSTANT));
      }
    }

    if (!group.visible) {
      group.visible = true;
    }

    /* --- Seasonal activity level: smooth lerp toward season targets --- */
    let seasonName = 'Spring';
    if (window.__gardenState && typeof window.__gardenState.getSeason === 'function') {
      seasonName = window.__gardenState.getSeason();
    }
    const seasonTarget = SEASON_TARGETS[seasonName] || SEASON_TARGETS['Spring'];
    /* Exponential lerp — ~3s to near-complete (5 * 0.6 = 3.0 time constant gives ~86% after 5s) */
    const SEASON_LERP_TIME_CONSTANT = 1.5;
    const lerpFactor = 1 - Math.exp(-dt / SEASON_LERP_TIME_CONSTANT);
    _currentSeasonOrbitMul = _currentSeasonOrbitMul + (seasonTarget.orbit - _currentSeasonOrbitMul) * lerpFactor;
    _currentSeasonFlapMul = _currentSeasonFlapMul + (seasonTarget.flap - _currentSeasonFlapMul) * lerpFactor;
    _currentSeasonRadiusMul = _currentSeasonRadiusMul + (seasonTarget.radius - _currentSeasonRadiusMul) * lerpFactor;

    /* Camera reaction boost (issue #559) */
    let cameraBoost = 1.0;
    if (!state.reducedMotion && _lastCameraMoveTime > 0) {
      const now = performance.now();
      const elapsedSinceReaction = now - _lastReactionTime;
      const elapsedSinceMove = now - _lastCameraMoveTime;

      // Start a new reaction if camera moved recently and cooldown has passed
      // (or no previous reaction has been recorded — _lastReactionTime === 0)
      if ((_lastReactionTime === 0 || elapsedSinceReaction >= CAMERA_COOLDOWN * 1000) && elapsedSinceMove < CAMERA_BOOST_DURATION * 1000) {
        _lastReactionTime = now;
      }

      // Apply boost during the reaction window
      const reactionElapsed = now - _lastReactionTime;
      if (reactionElapsed < CAMERA_BOOST_DURATION * 1000) {
        cameraBoost = CAMERA_BOOST;
      }
    }

    /* Apply season multiplier to ORBIT_SPEED for angular position computation */
    // Apply firefly slow multiplier during Night (issue #598)
    const effectiveOrbitSpeed = ORBIT_SPEED * _currentSeasonOrbitMul * cameraBoost * _fireflySlowMul * _syncSlowMul;
    /* Apply season multiplier to ORBIT_RADIUS_MAX for radius range */
    const effectiveOrbitRadiusMax = ORBIT_RADIUS_MAX * _currentSeasonRadiusMul;

    /* --- Compute orbit position with pause speed modulation --- */
    const t = time * effectiveOrbitSpeed * pauseSpeedMul;

    // Angular position: slowly rotates around the garden
    const angle = t + Math.sin(t * 0.23) * 0.4;

    // Radial distance: varies between min and max using a slow sine
    const radiusFactor = 0.5 + 0.5 * Math.sin(t * FREQ_X + PHASE_X);
    const radius = ORBIT_RADIUS_MIN + radiusFactor * (effectiveOrbitRadiusMax - ORBIT_RADIUS_MIN);

    // Vertical position: gentle bobbing (with Overcast shelter adjustment, issue #633)
    const heightFactor = 0.5 + 0.5 * Math.sin(t * FREQ_Y + PHASE_Y);
    // Shelter level eases the height min/max toward overcast values during active flight only
    const effectiveHeightMin = ORBIT_HEIGHT_MIN + (OVERCAST_HEIGHT_MIN - ORBIT_HEIGHT_MIN) * _shelterLevel;
    const effectiveHeightMax = ORBIT_HEIGHT_MAX + (OVERCAST_HEIGHT_MAX - ORBIT_HEIGHT_MAX) * _shelterLevel;
    const y = effectiveHeightMin + heightFactor * (effectiveHeightMax - effectiveHeightMin);

    // Additional x/z perturbation for organic feel
    const xOffset = Math.sin(t * FREQ_X * 1.7 + PHASE_X + 1.2) * 0.3;
    const zOffset = Math.cos(t * FREQ_Z * 1.7 + PHASE_Z + 0.8) * 0.3;

    const orbitX = Math.cos(angle) * radius + xOffset;
    const orbitZ = Math.sin(angle) * radius + zOffset;
    const orbitY = y;

    /* --- Pause state machine: butterfly visits blooming flowers --- */
    // Determine final position based on pause state
    let finalX = orbitX;
    let finalY = orbitY;
    let finalZ = orbitZ;

    if (pauseState === 'idle') {
      // Decrement cooldown if active
      if (pauseCooldown > 0) {
        pauseCooldown -= dt;
      } else {
        // Check proximity to plants with blooming flowers
        const gs = window.__gardenState;
        if (gs) {
          const plantRefs = ['plant', 'plant2'];
          for (let i = 0; i < plantRefs.length; i++) {
            const plant = gs[plantRefs[i]];
            if (plant && plant.flower && typeof plant.flower.getPhase === 'function') {
              const phase = plant.flower.getPhase();
              if (phase === 'bloom') {
                // Get flower position: plant group position + flower height
                const plantPos = plant.group.position;
                // Flower is at stem height (central: 0.7, plant2: 0.5) above the plant
                const flowerHeight = plantRefs[i] === 'plant' ? 0.7 : 0.5;
                const fx = plantPos.x;
                const fy = plantPos.y + flowerHeight + 0.02;
                const fz = plantPos.z;

                // Calculate 3D distance from butterfly to flower
                const dx = orbitX - fx;
                const dy = orbitY - fy;
                const dz = orbitZ - fz;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist <= PAUSE_PROXIMITY) {
                  // Trigger pause!
                  pauseState = 'entering';
                  pauseTimer = 0;
                  pauseHoldDuration = PAUSE_HOLD_MIN + Math.random() * (PAUSE_HOLD_MAX - PAUSE_HOLD_MIN);
                  pauseTargetPos = { x: fx, y: fy, z: fz };
                  pauseEaseT = 0;
                  pauseOriginPos = { x: orbitX, y: orbitY, z: orbitZ };
                  // Dip target: hover at PAUSE_DIP_AMOUNT units from the flower,
                  // in the direction the butterfly came from
                  const dirX = orbitX - fx;
                  const dirY = orbitY - fy;
                  const dirZ = orbitZ - fz;
                  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
                  pauseDipTarget = {
                    x: fx + (dirX / dirLen) * PAUSE_DIP_AMOUNT,
                    y: fy + (dirY / dirLen) * PAUSE_DIP_AMOUNT,
                    z: fz + (dirZ / dirLen) * PAUSE_DIP_AMOUNT
                  };
                  break;
                }
              }
            }
          }
        }
      }
    }

    if (pauseState === 'entering') {
      pauseTimer += dt;
      pauseEaseT = Math.min(1, pauseTimer / PAUSE_ENTER_DURATION);
      // Smooth ease-in-out for the dip
      const eased = pauseEaseT * pauseEaseT * (3 - 2 * pauseEaseT);
      // Lerp speed multiplier from 1.0 to PAUSE_SPEED_MUL
      pauseSpeedMul = 1.0 + (PAUSE_SPEED_MUL - 1.0) * eased;
      // Lerp position from origin to dip target
      finalX = pauseOriginPos.x + (pauseDipTarget.x - pauseOriginPos.x) * eased;
      finalY = pauseOriginPos.y + (pauseDipTarget.y - pauseOriginPos.y) * eased;
      finalZ = pauseOriginPos.z + (pauseDipTarget.z - pauseOriginPos.z) * eased;

      if (pauseEaseT >= 1) {
        pauseState = 'holding';
        pauseTimer = 0;
      }
    }

    if (pauseState === 'holding') {
      pauseTimer += dt;
      // Stay at the dip target
      finalX = pauseDipTarget.x;
      finalY = pauseDipTarget.y;
      finalZ = pauseDipTarget.z;
      pauseSpeedMul = PAUSE_SPEED_MUL;

      if (pauseTimer >= pauseHoldDuration) {
        // Roll for landing on a leaf (~40% chance)
        const shouldLand = Math.random() < LANDING_PROBABILITY;
        if (shouldLand) {
          // Find the highest leaf of the nearest plant (the one we were visiting)
          const gs = window.__gardenState;
          let leafFound = false;
          if (gs) {
            const plantRefs = ['plant', 'plant2'];
            for (let li = 0; li < plantRefs.length; li++) {
              const plant = gs[plantRefs[li]];
              if (plant && plant.leaves && plant.leaves.length > 0 && pauseTargetPos) {
                // Find the closest plant with leaves — the one we were visiting
                const plantPos = plant.group.position;
                const dx = pauseTargetPos.x - plantPos.x;
                const dz = pauseTargetPos.z - plantPos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < 0.5) {
                  // Find the highest leaf
                  let highestLeaf = null;
                  let highestY = -Infinity;
                  for (let lv = 0; lv < plant.leaves.length; lv++) {
                    const leaf = plant.leaves[lv];
                    const leafWorldY = plantPos.y + leaf.position.y;
                    if (leafWorldY > highestY) {
                      highestY = leafWorldY;
                      highestLeaf = leaf;
                    }
                  }
                  if (highestLeaf) {
                    // Leaf surface position: on top of the highest leaf
                    landingLeafPos = {
                      x: plantPos.x + highestLeaf.position.x,
                      y: highestY + 0.02, // slightly above leaf surface
                      z: plantPos.z + highestLeaf.position.z
                    };
                    landingStartPos = { x: pauseDipTarget.x, y: pauseDipTarget.y, z: pauseDipTarget.z };
                    // Store leaf mesh reference for displacement (issue #604)
                    landingLeafMesh = highestLeaf;
                    leafOriginalRotX = highestLeaf.rotation.x;
                    leafOriginalPosY = highestLeaf.position.y;
                    leafDisplacementT = 0;
                    leafIsDisplaced = false;
                    /* Track which plant we landed on for pollination (issue #614) */
                    landingPlantLabel = plantRefs[li];
                    pauseState = 'descending';
                    pauseTimer = 0;
                    pauseEaseT = 0;
                    landingSpiralAngle = 0;
                    leafFound = true;
                    break;
                  }
                }
              }
            }
          }
          if (!leafFound) {
            // Fall back to normal exit if no leaf found
            pauseState = 'exiting';
            pauseTimer = 0;
            pauseEaseT = 0;
          }
        } else {
          pauseState = 'exiting';
          pauseTimer = 0;
          pauseEaseT = 0;
        }
      }
    }

    if (pauseState === 'descending') {
      pauseTimer += dt;
      pauseEaseT = Math.min(1, pauseTimer / LANDING_DESCEND_DURATION);
      const eased = pauseEaseT * pauseEaseT * (3 - 2 * pauseEaseT);
      pauseSpeedMul = PAUSE_SPEED_MUL; // keep slow during descent

      // Spiral descent: reduce altitude while orbiting around the leaf
      landingSpiralAngle += dt * 2.0; // ~1 full spiral over 2s
      const spiralRadius = (1 - eased) * 0.08; // shrink radius as we descend

      finalX = landingStartPos.x + (landingLeafPos.x - landingStartPos.x) * eased + Math.cos(landingSpiralAngle) * spiralRadius;
      finalY = landingStartPos.y + (landingLeafPos.y - landingStartPos.y) * eased;
      finalZ = landingStartPos.z + (landingLeafPos.z - landingStartPos.z) * eased + Math.sin(landingSpiralAngle) * spiralRadius;

      // Wings angle up during descent (handled by the wing flap section below)

      if (pauseEaseT >= 1) {
        pauseState = 'resting';
        pauseTimer = 0;
        landingRestDuration = LANDING_REST_MIN + Math.random() * (LANDING_REST_MAX - LANDING_REST_MIN);
        landingRestTimer = 0;
        // Set final position exactly at leaf
        finalX = landingLeafPos.x;
        finalY = landingLeafPos.y;
        finalZ = landingLeafPos.z;
      }
    }

    if (pauseState === 'resting') {
      pauseTimer += dt;
      landingRestTimer += dt;
      // Stay on the leaf
      finalX = landingLeafPos.x;
      finalY = landingLeafPos.y;
      finalZ = landingLeafPos.z;
      pauseSpeedMul = PAUSE_SPEED_MUL;

      if (landingRestTimer >= landingRestDuration) {
        pauseState = 'ascending';
        pauseTimer = 0;
        pauseEaseT = 0;
        landingStartPos = { x: landingLeafPos.x, y: landingLeafPos.y, z: landingLeafPos.z };
      }
    }

    if (pauseState === 'ascending') {
      pauseTimer += dt;
      pauseEaseT = Math.min(1, pauseTimer / LANDING_ASCEND_DURATION);
      const eased = pauseEaseT * pauseEaseT * (3 - 2 * pauseEaseT);
      // Speed multiplier lerps back to 1.0
      pauseSpeedMul = PAUSE_SPEED_MUL + (1.0 - PAUSE_SPEED_MUL) * eased;

      // Ascend from leaf back to normal orbit position
      finalX = landingStartPos.x + (orbitX - landingStartPos.x) * eased;
      finalY = landingStartPos.y + (orbitY - landingStartPos.y) * eased;
      finalZ = landingStartPos.z + (orbitZ - landingStartPos.z) * eased;

      if (pauseEaseT >= 1) {
        // Signal pollination to the flower we just visited (issue #614)
        if (landingPlantLabel && window.__gardenState && window.__gardenState[landingPlantLabel]) {
          const visitedPlant = window.__gardenState[landingPlantLabel];
          if (visitedPlant.flower) {
            visitedPlant.flower._needsPollination = true;
          }
        }
        landingPlantLabel = null;

        // Resume normal flight
        pauseState = 'idle';
        pauseSpeedMul = 1.0;
        pauseEaseT = 0;
        pauseTargetPos = null;
        pauseOriginPos = null;
        pauseDipTarget = null;
        landingLeafPos = null;
        landingStartPos = null;
        // Clean up leaf displacement (issue #604)
        if (landingLeafMesh) {
          landingLeafMesh.rotation.x = leafOriginalRotX;
          landingLeafMesh.position.y = leafOriginalPosY;
        }
        landingLeafMesh = null;
        leafIsDisplaced = false;
        leafDisplacementT = 0;
        // Cooldown to prevent immediate re-trigger
        pauseCooldown = 8.0;
      }
    }

    /* --- Leaf displacement under butterfly weight (issue #604) --- */
    // When the butterfly rests on the highest leaf, the leaf visibly bends downward
    // with smooth ease-in/out over 0.5s. Recovers when the butterfly ascends.
    if (landingLeafMesh && !state.reducedMotion) {
      if (pauseState === 'resting') {
        leafDisplacementT = Math.min(1, leafDisplacementT + dt / LEAF_DISPLACE_DURATION);
        leafIsDisplaced = leafDisplacementT >= 1;
      } else if (pauseState === 'ascending') {
        leafDisplacementT = Math.max(0, leafDisplacementT - dt / LEAF_DISPLACE_DURATION);
        leafIsDisplaced = false;
      } else if (pauseState === 'idle') {
        // If somehow still displaced during idle, snap back
        leafDisplacementT = 0;
        leafIsDisplaced = false;
        landingLeafMesh.rotation.x = leafOriginalRotX;
        landingLeafMesh.position.y = leafOriginalPosY;
        landingLeafMesh = null;
      }

      if (landingLeafMesh) {
        const t = leafDisplacementT;
        const eased = t * t * (3 - 2 * t); // smoothstep ease-in-out
        landingLeafMesh.rotation.x = leafOriginalRotX + LEAF_DISPLACE_ROT * eased;
        landingLeafMesh.position.y = leafOriginalPosY + LEAF_DISPLACE_POS_Y * eased;
      }
    }

    if (pauseState === 'exiting') {
      pauseTimer += dt;
      pauseEaseT = Math.min(1, pauseTimer / PAUSE_EXIT_DURATION);
      // Smooth ease-in-out back to normal
      const eased = pauseEaseT * pauseEaseT * (3 - 2 * pauseEaseT);
      // Lerp speed multiplier back to 1.0
      pauseSpeedMul = PAUSE_SPEED_MUL + (1.0 - PAUSE_SPEED_MUL) * eased;
      // Lerp position from dip target back to the normal orbit
      finalX = pauseDipTarget.x + (orbitX - pauseDipTarget.x) * eased;
      finalY = pauseDipTarget.y + (orbitY - pauseDipTarget.y) * eased;
      finalZ = pauseDipTarget.z + (orbitZ - pauseDipTarget.z) * eased;

      if (pauseEaseT >= 1) {
        // Resume normal flight
        pauseState = 'idle';
        pauseSpeedMul = 1.0;
        pauseEaseT = 0;
        pauseTargetPos = null;
        pauseOriginPos = null;
        pauseDipTarget = null;
        // Cooldown to prevent immediate re-trigger
        pauseCooldown = 8.0;
      }
    }

    /* --- Firefly attractor bias: subtle drift toward firefly glow (Night, issue #598) --- */
    // Position bias computed after final position is known from the pause state machine
    if (_isNightPhase && !state.reducedMotion) {
      const fireflies = window.__gardenState && window.__gardenState.fireflies;
      if (fireflies && typeof fireflies.getAllPositions === 'function') {
        const positions = fireflies.getAllPositions();
        if (positions.length > 0) {
          // Find nearest firefly
          let minDist = Infinity;
          let nearestX = 0, nearestZ = 0;
          for (let fi = 0; fi < positions.length; fi++) {
            let dx = positions[fi].x - finalX;
            let dz = positions[fi].z - finalZ;
            let dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < minDist) {
              minDist = dist;
              nearestX = positions[fi].x;
              nearestZ = positions[fi].z;
            }
          }

          // Compute attractor bias with slow sine modulation (0.3-0.5 units)
          let sineMod = 0.5 + 0.5 * Math.sin(time * 0.15 + 1.7);
          let biasAmount = 0.3 + sineMod * 0.2; // oscillates 0.3-0.5

          let toFireflyX = nearestX - finalX;
          let toFireflyZ = nearestZ - finalZ;
          let toFireflyLen = Math.sqrt(toFireflyX * toFireflyX + toFireflyZ * toFireflyZ) || 1;

          // Only 30% of full bias toward firefly — subtle drift, not direct attraction
          _fireflyBiasX = (toFireflyX / toFireflyLen) * biasAmount * 0.3;
          _fireflyBiasZ = (toFireflyZ / toFireflyLen) * biasAmount * 0.3;
        }
      }
    }

    // Apply firefly bias to position
    if (_isNightPhase) {
      finalX += _fireflyBiasX;
      finalZ += _fireflyBiasZ;
    }

    /* --- Sprout attraction: butterfly drifts toward germinated sprouts in spring (issue #629) --- */
    _sproutOffsetX = 0;
    _sproutOffsetZ = 0;
    if (seasonName === 'Spring' && pauseState === 'idle') {
      const gs = window.__gardenState;
      if (gs && gs.groundSeeds && gs.groundSeeds.sprouts && gs.groundSeeds.sprouts.length > 0) {
        const sprouts = gs.groundSeeds.sprouts;
        // Compute centroid of sprout positions
        let cx = 0, cz = 0;
        for (let si = 0; si < sprouts.length; si++) {
          const sp = sprouts[si];
          if (sp.group) {
            cx += sp.group.position.x;
            cz += sp.group.position.z;
          }
        }
        cx /= sprouts.length;
        cz /= sprouts.length;

        // Slow 60s cycle: 30s approach, 30s return
        const cyclePhase = (time % SPROUT_ATTRACT_CYCLE_DURATION) / SPROUT_ATTRACT_CYCLE_DURATION;
        // cyclePhase: 0→0.5 = approach (sine from 0 to peak at 0.25), 0.5→1.0 = return (sine back to 0)
        const sinePhase = Math.sin(cyclePhase * Math.PI * 2); // 0→1→0→-1→0 over duration
        // Map to 0→1 approach: use positive lobe (0→1→0) by taking abs + shaping
        // Simpler: just use a smooth triangle: 0→0.5 peak→0
        const t = cyclePhase;
        const approachFactor = t < 0.5
          ? 2 * t          // 0→1 during first half
          : 2 * (1 - t);   // 1→0 during second half
        // Smooth the triangle with ease-in-out
        const eased = approachFactor * approachFactor * (3 - 2 * approachFactor);

        // Direction from origin toward centroid
        const distToCentroid = Math.sqrt(cx * cx + cz * cz) || 1;
        const dirX = cx / distToCentroid;
        const dirZ = cz / distToCentroid;

        const offset = eased * SPROUT_ATTRACT_MAX_OFFSET;
        _sproutOffsetX = dirX * offset;
        _sproutOffsetZ = dirZ * offset;

        // Apply the offset to final position (only during idle flight, not during pause/landing)
        finalX += _sproutOffsetX;
        finalZ += _sproutOffsetZ;
      }
    }

    /* --- Leaf brush proximity detection during idle flight (issue #640) --- */
    if (pauseState === 'idle' && !state.reducedMotion) {
      const gs = window.__gardenState;
      if (gs) {
        const plantRefs = ['plant', 'plant2'];
        const nowMS = performance.now();
        for (let pi = 0; pi < plantRefs.length; pi++) {
          const plant = gs[plantRefs[pi]];
          if (!plant || !plant.leaves || !plant.group) continue;
          const plantPos = plant.group.position;
          for (let li = 0; li < plant.leaves.length; li++) {
            const leaf = plant.leaves[li];
            if (!leaf.userData) continue;

            // Leaf world position = plant group position + leaf local position
            const lx = plantPos.x + leaf.position.x;
            const ly = plantPos.y + leaf.position.y;
            const lz = plantPos.z + leaf.position.z;

            const dx = finalX - lx;
            const dy = finalY - ly;
            const dz = finalZ - lz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 0.08) {
              const lastBrush = leaf.userData.lastBrushTime || 0;
              if (nowMS - lastBrush >= 1000) {
                leaf.userData.lastBrushTime = nowMS;
                leaf.userData.trembleActive = true;
                leaf.userData.trembleStartTime = nowMS;
                leaf.userData.trembleOriginalRotX = leaf.rotation.x;

                _leafTrembles.push({
                  leaf: leaf,
                  originalRotX: leaf.rotation.x,
                  startTime: nowMS
                });
              }
            }
          }
        }
      }
    }

    /* --- Apply leaf trembles each frame (damped oscillation) --- */
    if (!state.reducedMotion) {
      const nowMS = performance.now();
      for (let ti = _leafTrembles.length - 1; ti >= 0; ti--) {
        const t = _leafTrembles[ti];
        const elapsed = (nowMS - t.startTime) / 1000;

        if (elapsed >= 1.0) {
          t.leaf.rotation.x = t.originalRotX;
          t.leaf.userData.trembleActive = false;
          t.leaf.userData.trembleStartTime = 0;
          _leafTrembles.splice(ti, 1);
        } else {
          // Damped oscillation: ±0.02 rad, frequency ~20 rad/s, exp decay
          const offset = 0.02 * Math.sin(elapsed * 20) * Math.exp(-4 * elapsed);
          t.leaf.rotation.x = t.originalRotX + offset;
        }
      }
    } else {
      // Reduced motion: restore all leaf rotations
      for (let ti = 0; ti < _leafTrembles.length; ti++) {
        const t = _leafTrembles[ti];
        t.leaf.rotation.x = t.originalRotX;
        t.leaf.userData.trembleActive = false;
        t.leaf.userData.trembleStartTime = 0;
      }
      _leafTrembles = [];
    }

    /* --- Wind perturbation: nudge the butterfly by ground ripple displacement --- */
    let windNudge = 0;
    if (pauseState === 'idle') {
      const disp = computeDisplacement(finalX, finalZ, time);
      windNudge = disp * WIND_NUDGE_SCALE;
    }
    _windNudge = windNudge;

    /* --- Resting sway: barely-perceptible sinusoidal movement on the leaf --- */
    if (pauseState === 'resting') {
      const sway = Math.sin(time * 1.5) * LANDING_SWAY_AMPLITUDE;
      finalY += sway;
    }
    group.position.set(finalX, finalY + windNudge, finalZ);

    /* --- Orient the butterfly along its flight direction --- */
    // Use a small look-at offset to face the direction of travel
    const lookAhead = 0.5;
    const nextT = (time + lookAhead) * effectiveOrbitSpeed * pauseSpeedMul;
    const nextAngle = nextT + Math.sin(nextT * 0.23) * 0.4;
    const nextRadiusFactor = 0.5 + 0.5 * Math.sin(nextT * FREQ_X + PHASE_X);
    const nextRadius = ORBIT_RADIUS_MIN + nextRadiusFactor * (effectiveOrbitRadiusMax - ORBIT_RADIUS_MIN);
    const nx = Math.cos(nextAngle) * nextRadius + Math.sin(nextT * FREQ_X * 1.7 + PHASE_X + 1.2) * 0.3;
    const nz = Math.sin(nextAngle) * nextRadius + Math.cos(nextT * FREQ_Z * 1.7 + PHASE_Z + 0.8) * 0.3;
    const ny = ORBIT_HEIGHT_MIN + (0.5 + 0.5 * Math.sin(nextT * FREQ_Y + PHASE_Y)) * (ORBIT_HEIGHT_MAX - ORBIT_HEIGHT_MIN);

    const dir = new THREE.Vector3(nx - finalX, 0, nz - finalZ).normalize();
    if (dir.length() > 0.001) {
      const lookTarget = new THREE.Vector3(
        finalX + dir.x,
        finalY,
        finalZ + dir.z
      );
      group.lookAt(lookTarget);
      // Tilt slightly upward for a more natural flight posture
      group.rotateX(0.15);
    }

    /* --- Slow wing flap during pause/rest, with seasonal speed modulation --- */
    let flapAngle;
    if (pauseState === 'descending') {
      // Wings angle up during descent — gradually closing
      const t = Math.min(1, pauseTimer / LANDING_DESCEND_DURATION);
      const eased = t * t * (3 - 2 * t);
      flapAngle = FLAP_ANGLE_MAX * (1 - eased * 0.6); // partially close
    } else if (pauseState === 'resting') {
      // Wings folded upright — nearly closed
      flapAngle = 0;
    } else if (pauseState === 'ascending') {
      // Wings unfolding during ascent
      const t = Math.min(1, pauseTimer / LANDING_ASCEND_DURATION);
      const eased = t * t * (3 - 2 * t);
      flapAngle = FLAP_ANGLE_MAX * eased * 0.6; // gradually open
    } else {
      const flapMul = pauseState === 'idle' ? 1.0 : 0.6;
      flapAngle = Math.sin(time * FLAP_SPEED * _currentSeasonFlapMul * Math.PI * 2 * flapMul) * FLAP_ANGLE_MAX;
    }
    leftWing.rotation.z = flapAngle;
    rightWing.rotation.z = -flapAngle;
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  const unsubMotion = onMotionChange(function(matches) {
    state.reducedMotion = matches;
    if (matches) {
      group.visible = false;
      // Reset any active pause or landing immediately
      pauseState = 'idle';
      pauseSpeedMul = 1.0;
      pauseTargetPos = null;
      pauseOriginPos = null;
      pauseDipTarget = null;
      landingLeafPos = null;
      landingStartPos = null;
      landingRestTimer = 0;
      landingRestDuration = 0;
      landingSpiralAngle = 0;
      landingPlantLabel = null;
      // Reset leaf displacement (issue #604)
      if (landingLeafMesh) {
        landingLeafMesh.rotation.x = leafOriginalRotX;
        landingLeafMesh.position.y = leafOriginalPosY;
      }
      landingLeafMesh = null;
      leafIsDisplaced = false;
      leafDisplacementT = 0;
      // Clear leaf trembles on reduced-motion toggle (issue #640)
      for (let ti = 0; ti < _leafTrembles.length; ti++) {
        const t = _leafTrembles[ti];
        t.leaf.rotation.x = t.originalRotX;
        t.leaf.userData.trembleActive = false;
        t.leaf.userData.trembleStartTime = 0;
      }
      _leafTrembles = [];
    } else {
      group.visible = true;
    }
  });

  /* --- Destroy: clean up and remove from scene --- */
  function destroy() {
    unsubMotion();
    scene.remove(group);
    leftWingGeo.dispose();
    rightWingGeo.dispose();
    bodyGeo.dispose();
    wingMat.dispose();
    bodyMat.dispose();
  }

  return { group, update, destroy, state, notifyCameraMoved };
}

/**
 * Notifies the butterfly that the camera has moved.
 * Triggers a brief speed boost on the next update cycle, gated by cooldown.
 */
export function notifyCameraMoved() {
  _lastCameraMoveTime = performance.now();
}