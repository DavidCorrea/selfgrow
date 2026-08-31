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

/* --- Configuration --- */
const WING_SPAN = 0.07;           // tiny — a few pixels on screen
const WING_ASPECT = 0.6;          // width / height ratio of each wing half
const WING_COLOR = 0x3a3a5a;      // dark silhouette tone

/* Orbit path parameters */
const ORBIT_RADIUS_MIN = 0.5;     // can dip close to centre for flower visits
const ORBIT_RADIUS_MAX = 2.5;     // stays at periphery
const ORBIT_HEIGHT_MIN = 0.5;     // low above ground
const ORBIT_HEIGHT_MAX = 2.0;     // up to eye level
const ORBIT_SPEED = 0.08;         // unhurried (rad/s) — completes cycle in ~78s

/* Pause (butterfly visits blooming flower) parameters */
const PAUSE_PROXIMITY = 0.4;      // units — trigger distance to a blooming flower
const PAUSE_SPEED_MUL = 0.5;      // slow to ~50% during pause
const PAUSE_ENTER_DURATION = 1.0; // seconds to ease into the pause
const PAUSE_HOLD_MIN = 3.0;       // minimum hold seconds
const PAUSE_HOLD_MAX = 5.0;       // maximum hold seconds
const PAUSE_EXIT_DURATION = 1.0;  // seconds to ease back to normal flight
const PAUSE_DIP_AMOUNT = 0.15;    // how much closer the butterfly dips to the flower

/* Wing flap animation */
const FLAP_SPEED = 0.4;           // <0.5 Hz slow flap
const FLAP_ANGLE_MAX = 0.6;       // radians, how far wings open/close

/* Weather shelter fade time constant (~5s for near-complete fade) */
const WEATHER_FADE_TIME_CONSTANT = 2.5; // seconds — ~86% complete after 5s

/* --- Seasonal activity multipliers ---
 * The butterfly becomes more active in Spring/Summer and nearly still in Winter.
 * Smooth exponential lerp (~5s time constant) prevents sudden jumps even when
 * seasonProgress is restored from persistence at an unfamiliar point.
 */
const SEASON_LERP_CONSTANT = 5.0;  // seconds — ~86% complete after 5s

const SEASON_MULTIPLIERS = {
  spring:  { orbit: 1.2, radius: 1.0, flap: 1.3 },
  summer:  { orbit: 1.2, radius: 1.0, flap: 1.3 },
  autumn:  { orbit: 0.7, radius: 0.85, flap: 1.0 },
  winter:  { orbit: 0.2, radius: 0.5, flap: 0.3 }
};

const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/* Per-axis phase offsets for organic Lissajous-like looping */
const PHASE_X = 0.0;
const PHASE_Z = Math.PI * 0.37;   // offsets so path doesn't repeat quickly
const PHASE_Y = Math.PI * 0.73;
const FREQ_X = 1.0;               // base frequency multiplier
const FREQ_Z = 0.83;              // slightly different for non-repeating loop
const FREQ_Y = 0.64;

/**
 * Create a small butterfly creature and add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function, destroy: Function, state: object }}
 */
export function createCreature(scene) {
  /* --- Detect reduced motion --- */
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionMedia.matches;

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
  let pauseState = 'idle';
  let pauseTimer = 0;
  let pauseHoldDuration = 0;
  let pauseTargetPos = null;      // { x, y, z } — the flower position we're pausing at
  let pauseEaseT = 0;             // 0→1 for entering/exiting ease
  let pauseSpeedMul = 1.0;        // 1.0 normally, 0.5 during pause
  let pauseOriginPos = null;      // { x, y, z } — where we were when pause triggered
  let pauseDipTarget = null;      // { x, y, z } — the dipped position near the flower
  let pauseCooldown = 0;          // seconds after exiting before next pause can trigger

  /* --- Seasonal activity state (exposed for selftest) --- */
  let seasonOrbitMul = 1.0;   // starts neutral, lerps to target
  let seasonRadiusMul = 1.0;
  let seasonFlapMul = 1.0;

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
    /* Seasonal activity multipliers exposed for testing */
    seasonOrbitMul: () => seasonOrbitMul,
    seasonRadiusMul: () => seasonRadiusMul,
    seasonFlapMul: () => seasonFlapMul,
    /* Pause state exposed for testing */
    pauseState: () => pauseState,
    pauseTargetPos: () => pauseTargetPos ? { ...pauseTargetPos } : null,
    pauseSpeedMul: () => pauseSpeedMul,
    pauseEaseT: () => pauseEaseT
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

    /* --- Night phase: butterfly rests --- */
    if (window.__gardenState && window.__gardenState.dayNight) {
      const t = window.__gardenState.dayNight.getCycleProgress();
      // Night is t in [0.75, 1.0)
      if (t >= 0.75) {
        group.visible = false;
        return;
      }
    }

    if (!group.visible) {
      group.visible = true;
    }

    /* --- Compute seasonal activity multipliers --- */
    if (window.__gardenState && typeof window.__gardenState.seasonProgress === 'number') {
      const sp = window.__gardenState.seasonProgress;
      const seasonIndex = Math.floor(sp * 4) % 4;

      // Each season has a fixed target (no lerp between seasons).
      // The exponential lerp below provides smooth transitions across
      // season boundaries as seasonProgress changes each frame.
      const target = SEASON_MULTIPLIERS[SEASON_NAMES[seasonIndex]];

      const targetOrbitMul = target.orbit;
      const targetRadiusMul = target.radius;
      const targetFlapMul = target.flap;

      // Exponential lerp toward target for smooth (non-snapping) transitions
      const smoothFactor = 1 - Math.exp(-dt / SEASON_LERP_CONSTANT);
      seasonOrbitMul = seasonOrbitMul + (targetOrbitMul - seasonOrbitMul) * smoothFactor;
      seasonRadiusMul = seasonRadiusMul + (targetRadiusMul - seasonRadiusMul) * smoothFactor;
      seasonFlapMul = seasonFlapMul + (targetFlapMul - seasonFlapMul) * smoothFactor;
    } else {
      // No season state available — fall back to neutral multipliers
      seasonOrbitMul = 1.0;
      seasonRadiusMul = 1.0;
      seasonFlapMul = 1.0;
    }

    /* --- Compute orbit position with pause speed modulation --- */
    const effectiveOrbitSpeed = ORBIT_SPEED * seasonOrbitMul;
    const t = time * effectiveOrbitSpeed * pauseSpeedMul;

    // Angular position: slowly rotates around the garden
    const angle = t + Math.sin(t * 0.23) * 0.4;

    // Radial distance: varies between min and max using a slow sine
    const radiusFactor = 0.5 + 0.5 * Math.sin(t * FREQ_X + PHASE_X);
    const effectiveRadiusMin = ORBIT_RADIUS_MIN * seasonRadiusMul;
    const effectiveRadiusMax = ORBIT_RADIUS_MAX * seasonRadiusMul;
    const radius = effectiveRadiusMin + radiusFactor * (effectiveRadiusMax - effectiveRadiusMin);

    // Vertical position: gentle bobbing
    const heightFactor = 0.5 + 0.5 * Math.sin(t * FREQ_Y + PHASE_Y);
    const y = ORBIT_HEIGHT_MIN + heightFactor * (ORBIT_HEIGHT_MAX - ORBIT_HEIGHT_MIN);

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
        pauseState = 'exiting';
        pauseTimer = 0;
        pauseEaseT = 0;
        // Recompute the normal orbit position at the current time for exit target
        // (we'll use the computed orbitX/Y/Z as the target to resume to)
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

    group.position.set(finalX, finalY, finalZ);

    /* --- Orient the butterfly along its flight direction --- */
    // Use a small look-at offset to face the direction of travel
    const lookAhead = 0.5;
    const nextT = (time + lookAhead) * effectiveOrbitSpeed * pauseSpeedMul;
    const nextAngle = nextT + Math.sin(nextT * 0.23) * 0.4;
    const nextRadiusFactor = 0.5 + 0.5 * Math.sin(nextT * FREQ_X + PHASE_X);
    const nextRadius = effectiveRadiusMin + nextRadiusFactor * (effectiveRadiusMax - effectiveRadiusMin);
    const nx = Math.cos(nextAngle) * nextRadius + Math.sin(nextT * FREQ_X * 1.7 + PHASE_X + 1.2) * 0.3;
    const nz = Math.sin(nextAngle) * nextRadius + Math.cos(nextT * FREQ_Z * 1.7 + PHASE_Z + 0.8) * 0.3;
    const ny = ORBIT_HEIGHT_MIN + (0.5 + 0.5 * Math.sin(nextT * FREQ_Y + PHASE_Y)) * (ORBIT_HEIGHT_MAX - ORBIT_HEIGHT_MIN);

    /* --- Wing flap animation with seasonal speed multiplier --- */
    const effectiveFlapSpeed = FLAP_SPEED * seasonFlapMul;

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

    /* --- Slow wing flap during pause, modulated by seasonal speed --- */
    const flapSpeedMul = pauseState === 'idle' ? 1.0 : 0.6;
    const flapAngle = Math.sin(time * effectiveFlapSpeed * Math.PI * 2 * flapSpeedMul) * FLAP_ANGLE_MAX;
    leftWing.rotation.z = flapAngle;
    rightWing.rotation.z = -flapAngle;
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  function onMotionPreferenceChange(e) {
    state.reducedMotion = e.matches;
    if (e.matches) {
      group.visible = false;
      // Reset any active pause immediately
      pauseState = 'idle';
      pauseSpeedMul = 1.0;
      pauseTargetPos = null;
      pauseOriginPos = null;
      pauseDipTarget = null;
    } else {
      group.visible = true;
    }
  }

  reducedMotionMedia.addEventListener('change', onMotionPreferenceChange);

  /* --- Destroy: clean up event listener and remove from scene --- */
  function destroy() {
    reducedMotionMedia.removeEventListener('change', onMotionPreferenceChange);
    scene.remove(group);
    leftWingGeo.dispose();
    rightWingGeo.dispose();
    bodyGeo.dispose();
    wingMat.dispose();
    bodyMat.dispose();
  }

  return { group, update, destroy, state };
}