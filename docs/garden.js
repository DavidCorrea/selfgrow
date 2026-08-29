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
  window.__gardenState.firstPlantGrown = false;
  /* Create the first (central) plant */
  createPlant({
    scene,
    position: { x: 0, z: 0 },
    stemHeight: 0.7,
    stemColor: 0x5d8a3c,
    leafColor: 0x4a8c2a,
    swayPhaseOffset: 0,
    growDuration: 30000,
    label: 'plant',
    leafShape: 'narrow' // pointy, narrow leaves
  });
}

/**
 * Create a growing seedling with configurable parameters.
 *
 * @param {object} opts
 * @param {THREE.Scene} opts.scene - The Three.js scene.
 * @param {object} opts.position - { x, z } position, y is always 0.
 * @param {number} opts.stemHeight - Height of the stem.
 * @param {number} opts.stemColor - Hex colour for the stem.
 * @param {number} opts.leafColor - Hex colour for the leaves.
 * @param {number} opts.swayPhaseOffset - Phase offset for sway animation.
 * @param {number} opts.growDuration - Growth duration in ms.
 * @param {string} opts.label - "plant" or "plant2" for window.__gardenState key.
 * @param {string} opts.leafShape - "narrow" (pointy) or "broad" (wider, rounder).
 */
function createPlant(opts) {
  const {
    scene,
    position,
    stemHeight,
    stemColor,
    leafColor,
    swayPhaseOffset,
    growDuration,
    label,
    leafShape
  } = opts;

  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);

  /* --- Stem --- */
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.028, stemHeight, 6);
  const stemMat = new THREE.MeshStandardMaterial({
    color: stemColor,
    roughness: 0.7,
    metalness: 0.0
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = stemHeight / 2;
  stem.castShadow = true;
  group.add(stem);

  /* --- Leaves --- */
  const leafMat = new THREE.MeshStandardMaterial({
    color: leafColor,
    roughness: 0.6,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  /**
   * Make a leaf shape. Two varieties:
   * - narrow: pointy, teardrop-like (original)
   * - broad: wider, rounder, more substantial
   */
  function makeLeaf(w, h, shapeType) {
    const shape = new THREE.Shape();
    if (shapeType === 'broad') {
      // Broader, rounder leaf — more of a rounded ellipse
      shape.moveTo(0, 0);
      shape.bezierCurveTo(w * 0.6, h * 0.2, w * 0.7, h * 0.5, 0, h);
      shape.bezierCurveTo(-w * 0.7, h * 0.5, -w * 0.6, h * 0.2, 0, 0);
    } else {
      // Narrow, pointy leaf (original)
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(w * 0.5, h * 0.4, 0, h);
      shape.quadraticCurveTo(-w * 0.5, h * 0.4, 0, 0);
    }
    const geo = new THREE.ShapeGeometry(shape);
    return new THREE.Mesh(geo, leafMat);
  }

  let leaves;
  if (leafShape === 'broad') {
    // Broad leaves: wider, slightly shorter, spreading out
    const leaf1 = makeLeaf(0.09, 0.10, 'broad');
    leaf1.position.set(0, stemHeight * 0.35, 0);
    leaf1.rotation.x = -0.6;
    leaf1.rotation.y = 0.5;
    leaf1.castShadow = true;
    group.add(leaf1);

    const leaf2 = makeLeaf(0.08, 0.09, 'broad');
    leaf2.position.set(0, stemHeight * 0.55, 0);
    leaf2.rotation.x = 0.5;
    leaf2.rotation.y = 2.5;
    leaf2.castShadow = true;
    group.add(leaf2);

    const leaf3 = makeLeaf(0.07, 0.08, 'broad');
    leaf3.position.set(0, stemHeight * 0.75, 0);
    leaf3.rotation.x = -0.5;
    leaf3.rotation.y = 4.0;
    leaf3.castShadow = true;
    group.add(leaf3);

    leaves = [leaf1, leaf2, leaf3];
  } else {
    // Narrow leaves (original)
    const leaf1 = makeLeaf(0.06, 0.12, 'narrow');
    leaf1.position.set(0, 0.28, 0);
    leaf1.rotation.x = -0.5;
    leaf1.rotation.y = 0.3;
    leaf1.castShadow = true;
    group.add(leaf1);

    const leaf2 = makeLeaf(0.05, 0.10, 'narrow');
    leaf2.position.set(0, 0.42, 0);
    leaf2.rotation.x = 0.4;
    leaf2.rotation.y = 2.8;
    leaf2.castShadow = true;
    group.add(leaf2);

    const leaf3 = makeLeaf(0.04, 0.08, 'narrow');
    leaf3.position.set(0, 0.55, 0);
    leaf3.rotation.x = -0.4;
    leaf3.rotation.y = 1.8;
    leaf3.castShadow = true;
    group.add(leaf3);

    leaves = [leaf1, leaf2, leaf3];
  }

  /* --- Growth state --- */
  const startTime = performance.now();
  let fullyGrown = false;

  // Start at barely visible
  group.scale.set(0.001, 0.001, 0.001);
  scene.add(group);

  /* Expose plant for selftest and seasonal colour updates */
  const plantState = {
    group,
    stem,
    stemMat,
    leafMat,
    leaves,
    isFullyGrown: () => fullyGrown
  };
  window.__gardenState[label] = plantState;

  /* DOM elements to update */
  const growingDesc = document.getElementById('growing-description');
  const plotDesc = document.getElementById('plot-description');

  /* --- Growth animation --- */
  function updateGrowth() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / growDuration);

    if (progress < 1) {
      // Ease-out cubic: starts fast, slows toward the end
      const eased = 1 - Math.pow(1 - progress, 3);
      const s = 0.001 + eased * 0.999;
      group.scale.set(s, s, s);

      // Update DOM descriptions by growth phase
      if (label === 'plant') {
        if (progress < 0.3) {
          growingDesc.textContent = 'A tiny sprout breaks the soil, reaching upward.';
          plotDesc.textContent = 'A small sprout has emerged at the center of the plot. A faint haze drifts in the air.';
        } else {
          growingDesc.textContent = 'The seedling grows taller, unfurling its leaves toward the light.';
          plotDesc.textContent = 'A young seedling rises from the rich soil, stretching toward the sun. Dust motes float lazily in the warm air.';
        }
      } else {
        // plant2: update description to mention the new arrival
        if (progress < 0.3) {
          growingDesc.textContent = 'A second sprout emerges nearby, its broad leaves catching the light.';
          plotDesc.textContent = 'A young seedling rises at the center, while a second sprout pushes up from the soil nearby.';
        } else {
          growingDesc.textContent = 'Two seedlings now grow side by side — the first standing tall, the second spreading its wider leaves.';
          plotDesc.textContent = 'A pair of seedlings grace the garden. The central plant stretches upward while its companion unfurls broader, rounded leaves.';
        }
      }

      requestAnimationFrame(updateGrowth);
    } else {
      /* Full height reached — begin gentle swaying */
      fullyGrown = true;
      group.scale.set(1, 1, 1);

      // Track whether first plant just matured (to trigger second)
      if (label === 'plant' && !window.__gardenState.firstPlantGrown) {
        window.__gardenState.firstPlantGrown = true;

        growingDesc.textContent = 'The first seedling stands tall. A second sprout begins to rise from the soil nearby.';
        plotDesc.textContent = 'A healthy seedling stands at the center of the plot. Nearby, the soil stirs as another plant emerges.';

        // Spawn second plant at random offset from center
        const angle = Math.random() * 2 * Math.PI;
        const distance = 0.3 + Math.random() * 0.3; // 0.3–0.6 units
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        createPlant({
          scene,
          position: { x, z },
          stemHeight: 0.5,                       // shorter stem
          stemColor: 0x6a9a4a,                    // slightly yellower green
          leafColor: 0x5a9a32,                    // yellower-green leaf tint
          swayPhaseOffset: 3.7,                    // independent sway phase
          growDuration: 25000,                     // ~25 seconds
          label: 'plant2',
          leafShape: 'broad'                       // wider, rounder leaves
        });
      } else if (label === 'plant') {
        growingDesc.textContent = 'A young seedling rises from the soil, its leaves reaching toward the light. A second plant grows nearby.';
        plotDesc.textContent = 'A healthy seedling stands at the center of the plot, its leaves open to the sky. A companion plant with broader leaves grows beside it.';
      } else {
        // plant2 finished growing
        growingDesc.textContent = 'Two seedlings now stand together — the central plant tall and slender, its companion shorter with broad, rounded leaves.';
        plotDesc.textContent = 'Two plants share the garden plot. The first stands tall at center; the second, with wider leaves and a softer green hue, grows beside it as if the garden chose to spread.';
      }

      let swayTime = 0;
      function sway() {
        swayTime += 0.016;
        // Two overlapping slow sine waves for organic motion
        // Each plant sways with its own phase offset
        group.rotation.x = Math.sin(swayTime * 0.4 + swayPhaseOffset) * 0.025;
        group.rotation.z = Math.sin(swayTime * 0.3 + 1.2 + swayPhaseOffset) * 0.018;
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

    /* Also update plant2 if it exists */
    const plant2 = gs.plant2;
    if (plant2) {
      if (plant2.stemMat) {
        plant2.stemMat.color.copy(current.stem).lerp(next.stem, t);
      }
      if (plant2.leafMat) {
        plant2.leafMat.color.copy(current.leaf).lerp(next.leaf, t);
      }
    }

    if (groundMat) {
      groundMat.color.copy(current.ground).lerp(next.ground, t);
    }

    requestAnimationFrame(tick);
  }

  tick();
}

