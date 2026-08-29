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
const ORBIT_RADIUS_MIN = 1.5;     // never too close to centre
const ORBIT_RADIUS_MAX = 2.5;     // stays at periphery
const ORBIT_HEIGHT_MIN = 0.5;     // low above ground
const ORBIT_HEIGHT_MAX = 2.0;     // up to eye level
const ORBIT_SPEED = 0.08;         // unhurried (rad/s) — completes cycle in ~78s

/* Wing flap animation */
const FLAP_SPEED = 0.4;           // <0.5 Hz slow flap
const FLAP_ANGLE_MAX = 0.6;       // radians, how far wings open/close

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

  /* --- State exposed for selftest --- */
  const state = {
    type: 'creature',
    reducedMotion,
    wingMat,
    leftWing,
    rightWing,
    group,
    orbitSpeed: ORBIT_SPEED,
    radiusMin: ORBIT_RADIUS_MIN,
    radiusMax: ORBIT_RADIUS_MAX
  };

  /* Start invisible if reduced motion is active */
  if (reducedMotion) {
    group.visible = false;
  }

  /* --- Update function (called every frame from the animation loop) --- */
  function update(time) {
    if (state.reducedMotion) {
      group.visible = false;
      return;
    }

    if (!group.visible) {
      group.visible = true;
    }

    /* --- Organic looping path using Lissajous-like parameters --- */
    // The butterfly drifts along a path that never goes through centre
    // by using modulating radius + angular position.

    const t = time * ORBIT_SPEED;

    // Angular position: slowly rotates around the garden
    const angle = t + Math.sin(t * 0.23) * 0.4;

    // Radial distance: varies between min and max using a slow sine
    const radiusFactor = 0.5 + 0.5 * Math.sin(t * FREQ_X + PHASE_X);
    const radius = ORBIT_RADIUS_MIN + radiusFactor * (ORBIT_RADIUS_MAX - ORBIT_RADIUS_MIN);

    // Vertical position: gentle bobbing
    const heightFactor = 0.5 + 0.5 * Math.sin(t * FREQ_Y + PHASE_Y);
    const y = ORBIT_HEIGHT_MIN + heightFactor * (ORBIT_HEIGHT_MAX - ORBIT_HEIGHT_MIN);

    // Additional x/z perturbation for organic feel
    const xOffset = Math.sin(t * FREQ_X * 1.7 + PHASE_X + 1.2) * 0.3;
    const zOffset = Math.cos(t * FREQ_Z * 1.7 + PHASE_Z + 0.8) * 0.3;

    const x = Math.cos(angle) * radius + xOffset;
    const z = Math.sin(angle) * radius + zOffset;

    group.position.set(x, y, z);

    /* --- Orient the butterfly along its flight direction --- */
    // Use a small look-at offset to face the direction of travel
    const lookAhead = 0.5;
    const nextT = (time + lookAhead) * ORBIT_SPEED;
    const nextAngle = nextT + Math.sin(nextT * 0.23) * 0.4;
    const nextRadiusFactor = 0.5 + 0.5 * Math.sin(nextT * FREQ_X + PHASE_X);
    const nextRadius = ORBIT_RADIUS_MIN + nextRadiusFactor * (ORBIT_RADIUS_MAX - ORBIT_RADIUS_MIN);
    const nx = Math.cos(nextAngle) * nextRadius + Math.sin(nextT * FREQ_X * 1.7 + PHASE_X + 1.2) * 0.3;
    const nz = Math.sin(nextAngle) * nextRadius + Math.cos(nextT * FREQ_Z * 1.7 + PHASE_Z + 0.8) * 0.3;

    const dir = new THREE.Vector3(nx - x, 0, nz - z).normalize();
    if (dir.length() > 0.001) {
      const lookTarget = new THREE.Vector3(
        group.position.x + dir.x,
        group.position.y,
        group.position.z + dir.z
      );
      group.lookAt(lookTarget);
      // Tilt slightly upward for a more natural flight posture
      group.rotateX(0.15);
    }

    /* --- Wing flap animation --- */
    const flapAngle = Math.sin(time * FLAP_SPEED * Math.PI * 2) * FLAP_ANGLE_MAX;
    leftWing.rotation.z = flapAngle;
    rightWing.rotation.z = -flapAngle;
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  function onMotionPreferenceChange(e) {
    state.reducedMotion = e.matches;
    if (e.matches) {
      group.visible = false;
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