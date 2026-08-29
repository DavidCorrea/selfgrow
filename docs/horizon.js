/**
 * horizon.js — selfgrow distant tree-line silhouette
 *
 * Creates a faint, low-poly ring of triangular tree silhouettes at the
 * far edge of the garden (radius ~10.5) to provide depth and a sense
 * of horizon. The silhouettes fade into the sky colour during evening
 * and night phases by modulating opacity based on sky luminance.
 *
 * Exports: createHorizon(scene) → { group, update, getMeshes }
 */

import * as THREE from "three";

/* --- Configuration --- */
const HORIZON_RADIUS = 10.5;
const TREE_COUNT = 60;
const BASE_COLOR = 0x1a1a2e;       // Very dark silhouette
const MAX_TREE_HEIGHT = 0.9;
const MIN_TREE_HEIGHT = 0.25;
const TREE_WIDTH = 0.35;
const BASE_OPACITY = 0.55;

/**
 * Create the horizon tree-line silhouette and add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function, getMeshes: Function }}
 */
export function createHorizon(scene) {
  const group = new THREE.Group();
  group.name = 'horizon';

  /* Shared material — updated per-frame by update() */
  const material = new THREE.MeshBasicMaterial({
    color: BASE_COLOR,
    transparent: true,
    opacity: BASE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });

  const meshes = [];

  for (let i = 0; i < TREE_COUNT; i++) {
    const angle = (i / TREE_COUNT) * Math.PI * 2;

    /* Small random variation for natural irregularity */
    const angleJitter = (Math.random() - 0.5) * 0.1;
    const radiusJitter = (Math.random() - 0.5) * 0.4;
    const finalAngle = angle + angleJitter;

    const x = Math.cos(finalAngle) * (HORIZON_RADIUS + radiusJitter);
    const z = Math.sin(finalAngle) * (HORIZON_RADIUS + radiusJitter);

    /* Randomise height and width slightly */
    const height = MIN_TREE_HEIGHT + Math.random() * (MAX_TREE_HEIGHT - MIN_TREE_HEIGHT);
    const width = TREE_WIDTH * (0.7 + Math.random() * 0.6);

    /* Simple triangular tree silhouette */
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(0, height);
    shape.lineTo(width / 2, 0);
    shape.lineTo(-width / 2, 0);

    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, 0, z);

    /* Face toward the center of the garden */
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-x, 0, -z).normalize()
    );

    /* Slight random rotation on the vertical axis so not all face perfectly */
    mesh.rotateY((Math.random() - 0.5) * 0.15);

    group.add(mesh);
    meshes.push(mesh);
  }

  scene.add(group);

  /**
   * Update the horizon silhouette to blend with the sky colour.
   *
   * Called each frame (from the animate loop) with the current sky colour.
   * At high luminance (day), the trees form a visible dark silhouette.
   * At low luminance (night/evening), they fade into the sky.
   *
   * @param {THREE.Color} skyColor - Current scene background colour.
   */
  function update(skyColor) {
    /* Relative luminance of the sky (sRGB linear approximation) */
    const lum = 0.2126 * skyColor.r + 0.7152 * skyColor.g + 0.0722 * skyColor.b;

    /* Map luminance [0, ~1] to opacity [0.02, BASE_OPACITY]
     * Day:  lum ~0.5-0.7 → opacity ~0.31-0.43
     * Night: lum ~0.02-0.1 → opacity ~0.02-0.07
     * Sunset/sunrise: lum ~0.2-0.4 → opacity ~0.13-0.25
     */
    const opacityFactor = Math.min(1, lum * 1.4);
    const targetOpacity = 0.02 + opacityFactor * (BASE_OPACITY - 0.02);

    material.opacity = targetOpacity;
  }

  return {
    group,
    update,
    getMeshes: () => meshes,
    /** Expose the shared material for selftest inspection */
    getMaterial: () => material
  };
}