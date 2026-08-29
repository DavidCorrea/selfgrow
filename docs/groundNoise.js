/**
 * groundNoise.js — Subtle procedural noise texture for the ground plane.
 *
 * Generates a 256×256 canvas texture with value noise mapped to grayscale
 * values 0.85–1.0 (within ±15% of the base soil tone). Created once on load
 * and intended to be used as a `map` on the ground MeshStandardMaterial so
 * that the existing seasonal colour lerp multiplies through the noise.
 */

import * as THREE from "three";

/**
 * Generate a subtle procedural noise texture for the ground plane.
 *
 * Uses value noise on an 8×8 grid with bilinear interpolation (smoothstep)
 * to create organic, non-repeating variation. The output is a grayscale
 * canvas texture with brightness in [0.85, 1.0], so the variation stays
 * within −15% to 0% of the base tone (fully within the ±15% bound), and
 * the average is close to the original since values cluster near 0.925.
 *
 * @returns {THREE.CanvasTexture} A 256×256 canvas texture ready to set as
 *   the material's map property.
 */
export function createGroundNoiseTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  /* --- Grid-based value noise --- */
  const gridSize = 8;          // 8×8 grid of random values
  const cellSize = size / gridSize;

  // Generate random grid values in [0, 1]
  const grid = [];
  for (let gy = 0; gy <= gridSize; gy++) {
    grid[gy] = [];
    for (let gx = 0; gx <= gridSize; gx++) {
      grid[gy][gx] = Math.random();
    }
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map pixel to grid coordinates
      const gxFloat = (x / size) * gridSize;
      const gyFloat = (y / size) * gridSize;

      const gx0 = Math.floor(gxFloat);
      const gy0 = Math.floor(gyFloat);
      const gx1 = Math.min(gx0 + 1, gridSize);
      const gy1 = Math.min(gy0 + 1, gridSize);

      const fx = gxFloat - gx0;
      const fy = gyFloat - gy0;

      // Smoothstep the fractional parts for organic interpolation
      const sx = smoothstep(fx);
      const sy = smoothstep(fy);

      // Bilinear interpolation of grid values
      const v00 = grid[gy0][gx0];
      const v10 = grid[gy0][gx1];
      const v01 = grid[gy1][gx0];
      const v11 = grid[gy1][gx1];

      const v0 = lerp(v00, v10, sx);
      const v1 = lerp(v01, v11, sx);
      const v = lerp(v0, v1, sy);

      // Map v from [0,1] to [0.85, 1.0] — subtle variation, max ±15%
      const brightness = 0.85 + v * 0.15;
      const pixelValue = Math.round(brightness * 255);

      const idx = (y * size + x) * 4;
      data[idx]     = pixelValue;  // R
      data[idx + 1] = pixelValue;  // G
      data[idx + 2] = pixelValue;  // B
      data[idx + 3] = 255;         // A
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.needsUpdate = true;

  return texture;
}