/**
 * creature.js — a tiny drifting moth at the garden's periphery
 *
 * A single small moth (or butterfly) that follows a slow, organic looping path
 * at the edge of the garden. It is never center-frame, never interactive,
 * and exists solely as a quiet detail that rewards patient noticing.
 *
 * Exports: createCreature(scene) which returns { update, destroy, state }
 *
 * Must respect prefers-reduced-motion: invisible and stationary when active.
 */

import * as THREE from "three";

/* --- Path parameters ---
 * The moth drifts at a radius of 2.5–3.5 from center, never over the main plants.
 * The path uses overlapping sine waves per axis for organic, non-repeating motion.
 * Speed is very slow — one full circuit takes ~40-60 seconds.
 */
const PATH_RADIUS_MIN = 2.5;
const PATH_RADIUS_MAX = 3.5;
const PATH_Y_MIN = 0.3;
const PATH_Y_MAX = 0.9;
const PATH_ANGULAR_SPEED = 0.12; // radians per second (full circle ~52s)
const RADIUS_WOBBLE_SPEED = 0.07; // slow radius pulse
const Y_WOBBLE_SPEED = 0.09;      // slow vertical drift
const WING_FLAP_SPEED = 2.0;      // wing flap oscillations per second
const WING_FLAP_AMP = 0.35;       // max wing angle (radians)

/**
 * Build a tiny moth silhouette from two crossed thin planes.
 *
 * @param {THREE.Scene} scene
 * @returns {{ update: function, destroy: function, state: object }}
 */
export function createCreature(scene) {
  /* --- Detect reduced motion --- */
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionMedia.matches;

  /* --- Create the moth group --- */
  const group = new THREE.Group();

  // Two crossed wing planes — like a paper airplane silhouette
  const wingMat = new THREE.MeshBasicMaterial({
    color: 0xc4b8a8,       // soft pale tan / moth-grey
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  // Wing shape: a simple teardrop/leaf shape
  function makeWingShape() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.04, 0.02, 0.06, 0.04, 0.02, 0.07);
    shape.bezierCurveTo(-0.06, 0.04, -0.04, 0.02, 0, 0);
    return shape;
  }

  const wingShape = makeWingShape();
  const wingGeo = new THREE.ShapeGeometry(wingShape);

  // Left wing plane
  const leftWing = new THREE.Mesh(wingGeo, wingMat.clone());
  // Rotate so the wing lies in the XY plane, then angle it
  leftWing.rotation.x = 0.3;      // slight upward tilt at rest
  leftWing.rotation.z = 0.0;
  group.add(leftWing);

  // Right wing — same shape but mirrored
  const rightWing = new THREE.Mesh(wingGeo, wingMat.clone());
  rightWing.rotation.x = 0.3;
  rightWing.rotation.z = Math.PI; // flip 180° around Z to mirror
  group.add(rightWing);

  // Body — tiny thin line
  const bodyGeo = new THREE.BoxGeometry(0.002, 0.006, 0.008);
  const bodyMat = new THREE.MeshBasicMaterial({
    color: 0x8a7a6a,
    transparent: true,
    opacity: 0.8
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0, 0);
  group.add(body);

  // Store references for animation
  const wings = [leftWing, rightWing];

  // Very small scale — reads as a few pixels at typical camera distance
  const scale = 0.07;
  group.scale.set(scale, scale, scale);

  // Starting position at periphery
  group.position.set(PATH_RADIUS_MIN, PATH_Y_MIN + 0.2, 0);

  // If reduced motion, make invisible
  group.visible = !reducedMotion;

  scene.add(group);

  /* --- State exposed for selftest and DOM --- */
  const state = {
    type: 'creature',
    reducedMotion,
    group
  };

  /* --- Update function (called every frame from the animation loop) --- */
  // Angular start offset ensures each page load has a different path position
  const angularOffset = Math.random() * Math.PI * 2;
  const phaseOffsetRadial = Math.random() * Math.PI * 2;
  const phaseOffsetY = Math.random() * Math.PI * 2;

  function update(time) {
    if (state.reducedMotion) {
      group.visible = false;
      return;
    }
    group.visible = true;

    // All motion is derived from absolute time — no frame-based accumulation,
    // so the path is always smooth regardless of frame rate.
    const angle = time * PATH_ANGULAR_SPEED + angularOffset;

    // Radius oscillates gently between min and max
    const r = PATH_RADIUS_MIN +
      (PATH_RADIUS_MAX - PATH_RADIUS_MIN) * (0.5 + 0.5 * Math.sin(time * RADIUS_WOBBLE_SPEED + phaseOffsetRadial));

    // Y oscillates vertically
    const y = PATH_Y_MIN +
      (PATH_Y_MAX - PATH_Y_MIN) * (0.5 + 0.5 * Math.sin(time * Y_WOBBLE_SPEED + phaseOffsetY));

    // Position on a circle at the periphery
    const x = r * Math.cos(angle);
    const z = r * Math.sin(angle);

    group.position.set(x, y, z);

    // Face inward toward center with a slight tilt — looks more natural
    group.lookAt(0, y * 0.8, 0);
    // Add a slight random-seeming roll offset
    group.rotation.z = 0.1;

    // Wing flap animation: slow oscillation of wing angle
    const flap = Math.sin(time * WING_FLAP_SPEED) * WING_FLAP_AMP;
    wings.forEach((wing, i) => {
      // Left wing flaps positive, right wing flaps negative (symmetric)
      const dir = i === 0 ? 1 : -1;
      wing.rotation.x = 0.3 + flap * dir;
    });
  }

  /* --- Handle runtime changes to reduced-motion preference --- */
  function onMotionPreferenceChange(e) {
    state.reducedMotion = e.matches;
    group.visible = !e.matches;
  }

  reducedMotionMedia.addEventListener('change', onMotionPreferenceChange);

  /* --- Destroy: clean up event listener and remove from scene --- */
  function destroy() {
    reducedMotionMedia.removeEventListener('change', onMotionPreferenceChange);
    scene.remove(group);
    wingGeo.dispose();
    bodyGeo.dispose();
    wings.forEach(w => w.material.dispose());
    bodyMat.dispose();
    wingMat.dispose();
  }

  /* --- Get current position (for selftest) --- */
  function getPosition() {
    return group.position.clone();
  }

  return { update, destroy, state, getPosition, group };
}