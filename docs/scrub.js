/**
 * scrub.js — selfgrow mid-ground bush/scrub silhouettes
 *
 * Creates a ring of low-poly domed bush silhouettes at radius ~5–6 from
 * centre, positioned between the garden plot (ground circle radius 4) and
 * the distant horizon tree line (radius ~10.5). Each bush is a simple
 * half-ellipse shape with varied height (0.2–0.5 units) and width (0.3–0.6
 * units). The material blends with the current sky colour via the same
 * luminance-based opacity modulation used by horizon.js, fading to near
 * transparent at night.
 *
 * Exports: createScrub(scene) → { group, update, getMeshes, getMaterial }
 */

import * as THREE from "three";

/* --- Configuration --- */
const SCRUB_RADIUS_INNER = 5.0;
const SCRUB_RADIUS_OUTER = 6.0;
const BUSH_COUNT = 50;
const BASE_COLOR = 0x1a2a1e;        // Deep green-black silhouette
const MIN_HEIGHT = 0.2;
const MAX_HEIGHT = 0.5;
const MIN_WIDTH = 0.3;
const MAX_WIDTH = 0.6;
const BASE_OPACITY = 0.50;

/**
 * Create the scrub ring and add it to the scene.
 *
 * @param {THREE.Scene} scene
 * @returns {{ group: THREE.Group, update: Function, getMeshes: Function, getMaterial: Function }}
 */
export function createScrub(scene) {
  const group = new THREE.Group();
  group.name = 'scrub';

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

  for (let i = 0; i < BUSH_COUNT; i++) {
    const angle = (i / BUSH_COUNT) * Math.PI * 2;

    /* Randomise radius between inner and outer bounds */
    const radius = SCRUB_RADIUS_INNER + Math.random() * (SCRUB_RADIUS_OUTER - SCRUB_RADIUS_INNER);
    /* Small angle jitter for natural irregularity */
    const angleJitter = (Math.random() - 0.5) * 0.12;
    const finalAngle = angle + angleJitter;

    const x = Math.cos(finalAngle) * radius;
    const z = Math.sin(finalAngle) * radius;

    /* Randomise height and width */
    const height = MIN_HEIGHT + Math.random() * (MAX_HEIGHT - MIN_HEIGHT);
    const width = MIN_WIDTH + Math.random() * (MAX_WIDTH - MIN_WIDTH);

    /* Domed half-ellipse shape for bush silhouette */
    const segments = 12;
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);

    // Build a half-ellipse dome using quadratic bezier for a soft rounded top
    // Control point at (0, height * 1.1) gives a gentle bulge above the centre
    shape.quadraticCurveTo(0, height * 1.1, width / 2, 0);

    // Close by returning to the start (the base is flat along y=0)
    shape.lineTo(-width / 2, 0);

    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, 0, z);

    /* Face inward toward the garden centre */
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-x, 0, -z).normalize()
    );

    /* Slight random rotation on the vertical axis for natural variation */
    mesh.rotateY((Math.random() - 0.5) * 0.2);

    group.add(mesh);
    meshes.push(mesh);
  }

  scene.add(group);

  /**
   * Update scrub silhouette opacity to blend with the sky colour.
   *
   * Called each frame with the current sky colour. At high luminance (day)
   * the bushes form a visible dark silhouette; at night they fade away.
   *
   * @param {THREE.Color} skyColor - Current scene background colour.
   */
  function update(skyColor) {
    /* Relative luminance of the sky (sRGB linear approximation) */
    const lum = 0.2126 * skyColor.r + 0.7152 * skyColor.g + 0.0722 * skyColor.b;

    /* Map luminance [0, ~1] to opacity [0.02, BASE_OPACITY] */
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