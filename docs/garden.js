/**
 * garden.js — selfgrow garden logic
 *
 * Exports initGarden(scene) which is called once the Three.js scene
 * is set up.
 */

import * as THREE from "three";

export function initGarden(scene) {
  console.log('selfgrow garden initialised. The soil awaits…');
  createPlant(scene);
}

/**
 * Create a growing seedling at the center of the plot.
 * The plant starts tiny and grows to full height over ~30 seconds
 * with eased motion, then sways gently.
 */
function createPlant(scene) {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);

  /* --- Stem --- */
  const stemHeight = 0.7;
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.028, stemHeight, 6);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x5d8a3c,
    roughness: 0.7,
    metalness: 0.0
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = stemHeight / 2;
  stem.castShadow = true;
  group.add(stem);

  /* --- Leaves --- */
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x4a8c2a,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  function makeLeaf(w, h) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(w * 0.5, h * 0.4, 0, h);
    shape.quadraticCurveTo(-w * 0.5, h * 0.4, 0, 0);
    const geo = new THREE.ShapeGeometry(shape);
    return new THREE.Mesh(geo, leafMat);
  }

  // Leaf 1 — lower, pointing slightly forward and to the right
  const leaf1 = makeLeaf(0.06, 0.12);
  leaf1.position.set(0, 0.28, 0);
  leaf1.rotation.x = -0.5;
  leaf1.rotation.y = 0.3;
  leaf1.castShadow = true;
  group.add(leaf1);

  // Leaf 2 — middle, pointing slightly backward and to the left
  const leaf2 = makeLeaf(0.05, 0.10);
  leaf2.position.set(0, 0.42, 0);
  leaf2.rotation.x = 0.4;
  leaf2.rotation.y = 2.8;
  leaf2.castShadow = true;
  group.add(leaf2);

  // Leaf 3 — top, pointing to the right
  const leaf3 = makeLeaf(0.04, 0.08);
  leaf3.position.set(0, 0.55, 0);
  leaf3.rotation.x = -0.4;
  leaf3.rotation.y = 1.8;
  leaf3.castShadow = true;
  group.add(leaf3);

  /* --- Growth state --- */
  const startTime = performance.now();
  const GROW_DURATION = 30000; // 30 seconds
  let fullyGrown = false;

  // Start at barely visible
  group.scale.set(0.001, 0.001, 0.001);
  scene.add(group);

  /* Expose plant for selftest */
  window.__gardenState.plant = {
    group,
    stem,
    leaves: [leaf1, leaf2, leaf3],
    isFullyGrown: () => fullyGrown
  };

  /* DOM elements to update */
  const growingDesc = document.getElementById('growing-description');
  const plotDesc = document.getElementById('plot-description');

  /* --- Growth animation --- */
  function updateGrowth() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / GROW_DURATION);

    if (progress < 1) {
      // Ease-out cubic: starts fast, slows toward the end
      const eased = 1 - Math.pow(1 - progress, 3);
      const s = 0.001 + eased * 0.999;
      group.scale.set(s, s, s);

      // Update DOM descriptions by growth phase
      if (progress < 0.3) {
        growingDesc.textContent = 'A tiny sprout breaks the soil, reaching upward.';
        plotDesc.textContent = 'A small sprout has emerged at the center of the plot.';
      } else {
        growingDesc.textContent = 'The seedling grows taller, unfurling its leaves toward the light.';
        plotDesc.textContent = 'A young seedling rises from the rich soil, stretching toward the sun.';
      }

      requestAnimationFrame(updateGrowth);
    } else {
      /* Full height reached — begin gentle swaying */
      fullyGrown = true;
      group.scale.set(1, 1, 1);

      growingDesc.textContent = 'A young seedling rises from the soil, its leaves reaching toward the light.';
      plotDesc.textContent = 'A healthy seedling stands at the center of the plot, its leaves open to the sky.';

      let swayTime = 0;
      function sway() {
        swayTime += 0.016;
        // Two overlapping slow sine waves for organic motion
        group.rotation.x = Math.sin(swayTime * 0.4) * 0.025;
        group.rotation.z = Math.sin(swayTime * 0.3 + 1.2) * 0.018;
        requestAnimationFrame(sway);
      }
      sway();
    }
  }

  updateGrowth();
}
