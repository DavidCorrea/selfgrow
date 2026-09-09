/**
 * gaze.js — gaze-driven visitation bloom
 *
 * Each frame, the camera's centre ray is cast to the ground plane. When it
 * dwells within ~0.12 units of a blooming plant's base for ~15s, that plant's
 * petals ease up to ~25% wider (capped at 30% of baseline), then ease back to
 * baseline over ~60s once the gaze has left for ~10s.
 *
 * Exports:
 *   registerPlant(label, x, z)       — record a plant's base position
 *   updateGaze(camera, dt)           — called every frame in the animate loop
 *   advanceGazeEntry(entry, isLooking, dtMs, reducedMotion, now) — pure helper
 *   opennessFactor(visitationBloom)  — clamp to [0, MAX_OPENNESS]
 *   computeBloomScale(shelter, visitationBloom) — combined scale factor
 *   getVisitationBloom(label)        — read the current factor for a plant
 *
 * Constants:
 *   DWELL_REQUIRED_MS, LEAVE_LATENCY_MS, EASE_BACK_DURATION_MS,
 *   MAX_VISITATION_BLOOM, VISIT_RADIUS, MAX_OPENNESS
 */

import * as THREE from "three";

/* --- Constants --- */
export const DWELL_REQUIRED_MS = 15000;
export const LEAVE_LATENCY_MS = 10000;
export const EASE_BACK_DURATION_MS = 60000;
export const MAX_VISITATION_BLOOM = 0.25;
export const VISIT_RADIUS = 0.12;
export const MAX_OPENNESS = 0.30;

/* --- Internal state helpers --- */

/**
 * Ensure window.__gardenState._gaze exists and return it.
 * Defensively creates the structure if missing (shouldn't happen in normal flow).
 */
function ensureGazeState() {
  const gs = window.__gardenState || (window.__gardenState = {});
  if (!gs._gaze) {
    gs._gaze = { plants: {} };
  }
  return gs._gaze;
}

/**
 * Raycast the camera's centre ray onto the ground plane (y=0).
 *
 * @param {THREE.Camera} camera
 * @returns {{x: number, z: number}|null} hit point, or null when the ray
 *   misses the plane (looking at sky or horizon)
 */
function groundHitPoint(camera) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const camPos = camera.position;
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (0 - camPos.y) / dir.y;
  if (t < 0) return null;
  return { x: camPos.x + dir.x * t, z: camPos.z + dir.z * t };
}

/* --- Exported API --- */

/**
 * Register a plant's base position for gaze tracking.
 * Called once per plant during createPlant().
 *
 * @param {string} label — 'plant' or 'plant2'
 * @param {number} x
 * @param {number} z
 */
export function registerPlant(label, x, z) {
  const gaze = ensureGazeState();
  gaze.plants[label] = {
    label,
    x,
    z,
    visitationBloom: 0,
    dwellAccumMs: 0,
    awayAccumMs: 0,
    easingBack: false,
    easeElapsedMs: 0,
    bloomAtEaseStart: 0,
    lastUpdate: 0
  };
}

/**
 * Get the current visitationBloom factor for a plant label.
 * Returns 0 if the plant is not registered or gaze state is uninitialised.
 *
 * @param {string} label
 * @returns {number}
 */
export function getVisitationBloom(label) {
  const gs = window.__gardenState;
  const entry = gs && gs._gaze && gs._gaze.plants && gs._gaze.plants[label];
  return entry ? entry.visitationBloom : 0;
}

/**
 * Pure advance function: given a gaze entry's current state and a time step,
 * update the entry's visitationBloom.
 *
 * Intended to be deterministic for testing — accepts dtMs for accumulation
 * and now for observability/debugging.
 *
 * @param {object} entry — a gaze entry { visitationBloom, dwellAccumMs, ... }
 * @param {boolean} isLooking — whether the camera centre ray is within VISIT_RADIUS of the plant
 * @param {number} dtMs — elapsed time since last frame in milliseconds
 * @param {boolean} reducedMotion — whether prefers-reduced-motion is active
 * @param {number} now — current timestamp in ms (stored for observability, not used in logic)
 */
export function advanceGazeEntry(entry, isLooking, dtMs, reducedMotion, now) {
  const dt = Math.max(0, dtMs);
  entry.lastUpdate = now;

  if (isLooking) {
    /* Gaze is on the plant — any grace/away window is interrupted. */
    entry.awayAccumMs = 0;
    entry.easingBack = false;

    if (entry.visitationBloom >= MAX_VISITATION_BLOOM) {
      /* Already fully open — hold the dwell marker. */
      entry.dwellAccumMs = Math.max(entry.dwellAccumMs, DWELL_REQUIRED_MS);
      entry.visitationBloom = MAX_VISITATION_BLOOM;
      return;
    }

    /* Accumulate dwell time while looking. */
    entry.dwellAccumMs += dt;

    if (reducedMotion) {
      /* Single instant step once the dwell is met — no easing. */
      if (entry.dwellAccumMs >= DWELL_REQUIRED_MS) {
        entry.visitationBloom = MAX_VISITATION_BLOOM;
      }
      /* else stays at 0 — no visible change */
    } else {
      /* Linear ramp 0 → MAX over the full dwell window. */
      const ramp = Math.min(1, entry.dwellAccumMs / DWELL_REQUIRED_MS);
      entry.visitationBloom = ramp * MAX_VISITATION_BLOOM;
    }
    return;
  }

  /* --- Gaze has left the plant --- */
  entry.awayAccumMs += dt;

  if (entry.awayAccumMs < LEAVE_LATENCY_MS) {
    /* Grace period: hold the current factor. The dwell timer is preserved
     * so interruptions shorter than the latency do not reset it. */
    entry.easingBack = false;
    return;
  }

  /* Grace expired — ease (or step, under reduced motion) back to 0. */
  if (reducedMotion) {
    if (entry.visitationBloom !== 0) {
      entry.visitationBloom = 0;
      entry.dwellAccumMs = 0;
    }
    return;
  }

  if (!entry.easingBack) {
    entry.easingBack = true;
    entry.easeElapsedMs = 0;
    entry.bloomAtEaseStart = entry.visitationBloom;
  }
  entry.easeElapsedMs += dt;
  const t = Math.min(1, entry.easeElapsedMs / EASE_BACK_DURATION_MS);
  entry.visitationBloom = entry.bloomAtEaseStart * (1 - t);
  if (t >= 1) {
    entry.visitationBloom = 0;
    entry.dwellAccumMs = 0;
    entry.easingBack = false;
  }
}

/**
 * Clamp visitationBloom to [0, MAX_OPENNESS], capping the extra openness
 * at 30% above baseline.
 *
 * @param {number} visitationBloom
 * @returns {number} clamped openness factor
 */
export function opennessFactor(visitationBloom) {
  const v = typeof visitationBloom === 'number' && isFinite(visitationBloom) ? visitationBloom : 0;
  return Math.min(MAX_OPENNESS, Math.max(0, v));
}

/**
 * Combined bloom scale factor: weather shelter × visitation openness.
 *
 * @param {number} weatherShelter — 0 (open) to 1 (fully sheltered)
 * @param {number} visitationBloom — 0 to MAX_VISITATION_BLOOM
 * @returns {number} scale factor to apply to petal scale
 */
export function computeBloomScale(weatherShelter, visitationBloom) {
  const shelter = Math.max(0, Math.min(1, weatherShelter));
  return (1 - 0.4 * shelter) * (1 + opennessFactor(visitationBloom));
}

/**
 * Called every frame from the animate loop. Raycasts the camera centre ray
 * to the ground plane and updates all registered gaze entries.
 *
 * @param {THREE.Camera} camera
 * @param {number} dt — elapsed time since last frame in seconds
 */
export function updateGaze(camera, dt) {
  const gaze = ensureGazeState();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hit = groundHitPoint(camera);
  const dtMs = Math.max(0, dt) * 1000;
  const now = performance.now();

  for (const label in gaze.plants) {
    if (!Object.prototype.hasOwnProperty.call(gaze.plants, label)) continue;
    const entry = gaze.plants[label];
    let isLooking = false;
    if (hit) {
      const dx = hit.x - entry.x;
      const dz = hit.z - entry.z;
      isLooking = Math.sqrt(dx * dx + dz * dz) <= VISIT_RADIUS;
    }
    advanceGazeEntry(entry, isLooking, dtMs, reducedMotion, now);
  }
}