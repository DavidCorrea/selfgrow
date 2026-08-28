/**
 * garden.js — selfgrow garden logic
 *
 * Exports initGarden(scene) and startSeasonalCycle()
 * which are called once the Three.js scene is set up.
 */

import * as THREE from "three";

/* --- Seasonal colour palettes ---
 * Each season defines stem, leaf, and ground colours.
 * The continuous transition lerps between adjacent seasons
 * over the full season duration, so colour drifts slowly
 * and there are never any sudden jumps.
 */
const SEASON_PALETTES = {
  spring: {
    stem: new THREE.Color(0x5d8a3c),
    leaf: new THREE.Color(0x4a8c2a),
    ground: new THREE.Color(0x4a3728)
  },
  summer: {
    stem: new THREE.Color(0x7a9a4a),
    leaf: new THREE.Color(0x6a9a3a),
    ground: new THREE.Color(0x5a4a30)
  },
  autumn: {
    stem: new THREE.Color(0x9a7a3a),
    leaf: new THREE.Color(0xaa6a2a),
    ground: new THREE.Color(0x6a5a3a)
  },
  winter: {
    stem: new THREE.Color(0x6a5a3a),
    leaf: new THREE.Color(0x5a4a2a),
    ground: new THREE.Color(0x3a2a1a)
  }
};

const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_DURATION_MS = 180_000; // 3 minutes per season
const CYCLE_DURATION_MS = SEASON_DURATION_MS * 4; // ~12 minute full cycle

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

  /* Expose plant for selftest and seasonal colour updates */
  window.__gardenState.plant = {
    group,
    stem,
    stemMat,
    leafMat,
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

/**
 * startSeasonalCycle — drives the slow seasonal colour evolution.
 *
 * Reads materials from window.__gardenState (plant.stemMat, plant.leafMat,
 * and .groundMat) and lerps them through the four seasonal palettes
 * in a continuous ~12-minute cycle. Updates #season-display on each
 * season boundary.
 *
 * Must be called after initGarden and after window.__gardenState.groundMat
 * is set (both happen in index.html's module script).
 */
export function startSeasonalCycle() {
  const startTime = performance.now();
  const seasonDisplay = document.getElementById('season-display');
  if (!seasonDisplay) {
    console.warn('startSeasonalCycle: #season-display not found');
    return;
  }

  let lastSeasonIndex = -1;

  function tick() {
    const elapsed = performance.now() - startTime;
    const cycleTime = elapsed % CYCLE_DURATION_MS;
    const seasonIndex = Math.floor(cycleTime / SEASON_DURATION_MS) % 4;
    const seasonProgress = (cycleTime % SEASON_DURATION_MS) / SEASON_DURATION_MS;

    /* Update season display on boundary crossings */
    if (seasonIndex !== lastSeasonIndex) {
      lastSeasonIndex = seasonIndex;
      const name = SEASON_NAMES[seasonIndex];
      seasonDisplay.textContent = name;
    }

    /* Determine current and next season palettes */
    const current = SEASON_PALETTES[SEASON_NAMES[seasonIndex].toLowerCase()];
    const next = SEASON_PALETTES[SEASON_NAMES[(seasonIndex + 1) % 4].toLowerCase()];

    /* Lerp factor: 0 at start of season, 1 at end — smooth continuous drift */
    const t = seasonProgress;

    /* Retrieve materials to update */
    const gs = window.__gardenState;
    if (!gs) { requestAnimationFrame(tick); return; }

    const plant = gs.plant;
    const groundMat = gs.groundMat;

    if (plant) {
      if (plant.stemMat) {
        plant.stemMat.color.copy(current.stem).lerp(next.stem, t);
      }
      if (plant.leafMat) {
        plant.leafMat.color.copy(current.leaf).lerp(next.leaf, t);
      }
    }

    if (groundMat) {
      groundMat.color.copy(current.ground).lerp(next.ground, t);
    }

    requestAnimationFrame(tick);
  }

  tick();
}

