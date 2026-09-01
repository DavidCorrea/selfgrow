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

export function initGarden(scene, initialProgress) {
  console.log('selfgrow garden initialised. The soil awaits…');

  const p1Progress = (initialProgress && initialProgress.plant1Maturity) || 0;
  const firstPlantGrown = (initialProgress && initialProgress.firstPlantGrown) || false;

  // Set flags and progress BEFORE creating plant1 so becomeFullyGrown
  // won't duplicate plant2 spawning
  window.__gardenState.firstPlantGrown = firstPlantGrown;
  window.__gardenState.seasonProgress = 0;
  window.__gardenState.dayNightProgress = 0;
  window.__gardenState.weatherProgress = 0;
  window.__gardenState.plant1Maturity = 0;
  delete window.__gardenState.plant2Maturity;

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
    leafShape: 'narrow', // pointy, narrow leaves
    initialProgress: p1Progress
  });

  /* If plant2 was already growing, create it too */
  if (firstPlantGrown && initialProgress && initialProgress.plant2Maturity !== undefined) {
    const p2Progress = initialProgress.plant2Maturity;
    const angle = Math.random() * 2 * Math.PI;
    const distance = 0.3 + Math.random() * 0.3;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;

    createPlant({
      scene,
      position: { x, z },
      stemHeight: 0.5,
      stemColor: 0x6a9a4a,
      leafColor: 0x5a9a32,
      swayPhaseOffset: 3.7,
      growDuration: 25000,
      label: 'plant2',
      leafShape: 'broad',
      initialProgress: p2Progress
    });

    // Update descriptions to reflect restored two-plant state
    const growingDesc = document.getElementById('growing-description');
    const plotDesc = document.getElementById('plot-description');
    if (growingDesc) {
      if (p2Progress >= 1) {
        growingDesc.textContent = 'Two seedlings now stand together — the central plant tall and slender, its companion shorter with broad, rounded leaves.';
      } else if (p2Progress > 0.3) {
        growingDesc.textContent = 'Two seedlings now grow side by side — the first standing tall, the second spreading its wider leaves.';
      } else {
        growingDesc.textContent = 'A second sprout emerges nearby, its broad leaves catching the light.';
      }
    }
    if (plotDesc) {
      if (p2Progress >= 1) {
        plotDesc.textContent = 'Two plants share the garden plot. The first stands tall at center; the second, with wider leaves and a softer green hue, grows beside it as if the garden chose to spread.';
      } else {
        plotDesc.textContent = 'A pair of seedlings grace the garden. The central plant stretches upward while its companion unfurls broader, rounded leaves.';
      }
    }
  } else if (firstPlantGrown && p1Progress >= 1) {
    // Plant1 is fully grown but plant2 data was not in saved state
    // becomeFullyGrown will not trigger because firstPlantGrown is already true,
    // so plant2 will not be auto-spawned. This is fine — plant2 didn't exist yet.
  }
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
    leafShape,
    initialProgress = 0
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
  // Adjust start time by initialProgress so the plant appears at the correct stage
  const startTime = performance.now() - initialProgress * growDuration;
  let fullyGrown = false;

  // Start at appropriate scale based on initial progress
  if (initialProgress < 1) {
    const startScale = 0.001 + initialProgress * 0.999;
    group.scale.set(startScale, startScale, startScale);
  } else {
    group.scale.set(1, 1, 1);
    fullyGrown = true;
  }
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

  /* Store current maturity for persistence */
  function updateMaturity(progress) {
    if (label === 'plant') {
      window.__gardenState.plant1Maturity = progress;
    } else if (label === 'plant2') {
      window.__gardenState.plant2Maturity = progress;
    }
  }

  /* --- Helper: start sway animation --- */
  function startSway() {
    let swayTime = 0;
    const BASE_AMP_X = 0.025;
    const BASE_AMP_Z = 0.018;
    function sway() {
      swayTime += 0.016;
      let mul = 1.0;
      const ws = window.__gardenState && window.__gardenState.weather;
      if (ws && typeof ws.getSwayAmplitudeMul === 'function') {
        mul = ws.getSwayAmplitudeMul();
      }
      group.rotation.x = Math.sin(swayTime * 0.4 + swayPhaseOffset) * BASE_AMP_X * mul;
      group.rotation.z = Math.sin(swayTime * 0.3 + 1.2 + swayPhaseOffset) * BASE_AMP_Z * mul;
      requestAnimationFrame(sway);
    }
    sway();
  }

  /* --- Flower lifecycle ---
   *
   * After a plant reaches full maturity, a slow, continuous flower cycle
   * begins. Phases:
   *   dormant (30-60s)  →  budding (15s)  →  opening (~60s)
   *   →  bloom (90-120s)  →  fading/dropping (~30s)  →  back to dormant
   *
   * The flower is small and soft-coloured — not a centrepiece, but a
   * detail that rewards patient watching.
   */
  function createFlowerMeshes(stemH, color) {
    const flowerGroup = new THREE.Group();

    const petalMat = new THREE.MeshStandardMaterial({
      color: color || 0xdda0dd,
      roughness: 0.4,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1
    });

    // Teardrop petal shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.025, 0.01, 0.04, 0.03, 0.005, 0.055);
    shape.bezierCurveTo(-0.04, 0.03, -0.025, 0.01, 0, 0);

    const geo = new THREE.ShapeGeometry(shape);

    const petalCount = 5;
    const petals = [];
    for (let i = 0; i < petalCount; i++) {
      const angle = (i / petalCount) * Math.PI * 2;
      const m = new THREE.Mesh(geo, petalMat.clone());
      m.position.set(0, stemH, 0);
      m.rotation.y = angle;
      m.rotation.x = 0.3; // slight outward tilt (bud state)
      m.scale.set(0.01, 0.01, 0.01); // hidden initially
      m.castShadow = false;
      flowerGroup.add(m);
      petals.push(m);
    }

    // Tiny centre bud
    const budGeo = new THREE.SphereGeometry(0.004, 6, 6);
    const budMat = new THREE.MeshStandardMaterial({
      color: 0x8a7a4a,
      roughness: 0.8,
      metalness: 0.0,
      transparent: true,
      opacity: 1
    });
    const bud = new THREE.Mesh(budGeo, budMat);
    bud.position.set(0, stemH + 0.008, 0);
    flowerGroup.add(bud);

    return { group: flowerGroup, petals, bud, petalMat };
  }

  /* Flower lifecycle — called once the plant is fully grown */
  function startFlowerCycle() {
    const isPlant2 = label === 'plant2';

    // Soft pale colours: lavender for central plant, pale pink for companion
    const flowerColor = isPlant2 ? 0xddb0b0 : 0xdda0dd;
    const fm = createFlowerMeshes(stemHeight, flowerColor);
    group.add(fm.group);

    // Expose flower on plant state for selftest and persistence
    plantState.flower = {
      group: fm.group,
      petals: fm.petals,
      bud: fm.bud,
      petalMat: fm.petalMat,
      getPhase: () => phase,
      getProgress: () => progress
    };

    let phase = 'dormant';
    let phaseStart = performance.now();
    let phaseDuration = 30000 + Math.random() * 30000; // first dormant: 30-60s
    let progress = 0;

    // Phase durations (re-rolled each cycle except fixed ones)
    function rollDurations() {
      return {
        dormant: 30000 + Math.random() * 30000,
        budding: 15000,
        opening: 60000,
        bloom: 90000 + Math.random() * 30000,
        fading: 30000
      };
    }

    let durations = rollDurations();

    /* Update DOM when the flower enters a new visible phase */
    function updateDOMDescriptions() {
      const growingDesc = document.getElementById('growing-description');
      const plotDesc = document.getElementById('plot-description');

      if (!growingDesc || !plotDesc) return;

      if (isPlant2) {
        // plant2 companion descriptions
        switch (phase) {
          case 'budding':
            growingDesc.textContent = 'A tiny bud appears at the tip of the second plant. Something delicate is forming.';
            plotDesc.textContent = 'Two plants share the garden. The central plant stands tall while its companion shows a small bud forming near its crown.';
            break;
          case 'opening':
            growingDesc.textContent = 'A soft blossom slowly unfurls on the companion plant, its petals catching the light.';
            plotDesc.textContent = 'Two plants grow side by side. A delicate, pale blossom opens on the shorter plant, adding a gentle note to the scene.';
            break;
          case 'bloom':
            growingDesc.textContent = 'A small flower blooms softly near the top of the companion plant.';
            plotDesc.textContent = 'Two plants share the plot, one crowned with a small, soft-hued blossom. The garden feels complete.';
            break;
          case 'fading':
            growingDesc.textContent = 'The blossom on the companion plant fades gently, its petals beginning to fall.';
            plotDesc.textContent = 'The companion plant\'s flower gently fades, its moment passing as quietly as it came.';
            break;
          default:
            // dormant — keep existing descriptions from becomeFullyGrown
            growingDesc.textContent = 'Two seedlings now stand together — the central plant tall and slender, its companion shorter with broad, rounded leaves.';
            plotDesc.textContent = 'Two plants share the garden plot. The first stands tall at center; the second, with wider leaves and a softer green hue, grows beside it as if the garden chose to spread.';
            break;
        }
      } else {
        // plant1 (central) descriptions
        const plant2Exists = window.__gardenState && window.__gardenState.plant2;

        switch (phase) {
          case 'budding':
            if (plant2Exists) {
              growingDesc.textContent = 'A tiny bud forms at the tip of the central stem. The companion plant sways beside it.';
              plotDesc.textContent = 'The garden stirs quietly — a bud appears at the tip of the central plant, a delicate promise forming above the leaves.';
            } else {
              growingDesc.textContent = 'A tiny bud forms at the tip of the stem, a delicate point of emergence.';
              plotDesc.textContent = 'A single seedling stands in the plot, crowned by a tiny bud that grows at its tip. The air is still and patient.';
            }
            break;
          case 'opening':
            if (plant2Exists) {
              growingDesc.textContent = 'A gentle blossom slowly opens near the top of the central plant, unfurling its petals.';
              plotDesc.textContent = 'The central plant\'s bud opens gradually, revealing a small, soft-coloured blossom. The companion looks on, its leaves catching the fading light.';
            } else {
              growingDesc.textContent = 'A gentle blossom slowly opens near the top of the stem, its petals unfurling one by one.';
              plotDesc.textContent = 'The seedling\'s bud opens into a small, soft-coloured blossom. The garden feels a little more alive.';
            }
            break;
          case 'bloom':
            if (plant2Exists) {
              growingDesc.textContent = 'A small flower blooms softly near the crown of the central plant, a quiet spectacle.';
              plotDesc.textContent = 'The central plant wears a small, delicate flower at its crown. Beside it, the companion watches in silence.';
            } else {
              growingDesc.textContent = 'A small flower blooms softly near the top of the stem.';
              plotDesc.textContent = 'A small, soft-coloured flower blooms at the tip of the seedling, a quiet reward for patient watching.';
            }
            break;
          case 'fading':
            if (plant2Exists) {
              growingDesc.textContent = 'The flower on the central plant fades gently, its petals beginning to drop.';
              plotDesc.textContent = 'The central plant\'s blossom fades, its petals falling slowly toward the soil. The cycle turns.';
            } else {
              growingDesc.textContent = 'The flower fades gently, its petals beginning to fall.';
              plotDesc.textContent = 'The blossom fades and drops, its petals returning to the soil. The garden waits.';
            }
            break;
          default:
            // dormant — existing descriptions maintained by becomeFullyGrown
            break;
        }
      }
        }

    function tick() {
      const elapsed = performance.now() - phaseStart;
      progress = Math.min(1, elapsed / phaseDuration);

      switch (phase) {
        case 'dormant':
          if (elapsed >= phaseDuration) {
            phase = 'budding';
            phaseStart = performance.now();
            phaseDuration = durations.budding;
            progress = 0;
            updateDOMDescriptions();
          }
          break;

        case 'budding': {
          // Petals grow from tiny to small bud size
          const t = Math.min(1, elapsed / phaseDuration);
          const eased = 1 - Math.pow(1 - t, 3);
          const s = eased * 0.35;
          fm.petals.forEach(p => {
            p.scale.set(s, s, s);
          });
          if (elapsed >= phaseDuration) {
            phase = 'opening';
            phaseStart = performance.now();
            phaseDuration = durations.opening;
            progress = 0;
            updateDOMDescriptions();
          }
          break;
        }

        case 'opening': {
          // Petals spread outward and scale up to full size
          const t = Math.min(1, elapsed / phaseDuration);
          const eased = 1 - Math.pow(1 - t, 2);
          fm.petals.forEach((p, i) => {
            const tilt = 0.3 + eased * 1.2; // from slight tilt to nearly flat
            p.scale.set(eased, eased, eased);
            p.rotation.x = tilt;
          });
          if (elapsed >= phaseDuration) {
            phase = 'bloom';
            phaseStart = performance.now();
            phaseDuration = durations.bloom;
            progress = 0;
            updateDOMDescriptions();
          }
          break;
        }

        case 'bloom':
          // Gentle sway: a barely-perceptible animation
          if (fm.petals.length > 0) {
            const sway = Math.sin(elapsed * 0.001 * 0.5) * 0.05;
            fm.petals.forEach((p, i) => {
              p.rotation.z = sway + (i % 2 === 0 ? 0.02 : -0.02);
            });
          }
          if (elapsed >= phaseDuration) {
            phase = 'fading';
            phaseStart = performance.now();
            phaseDuration = durations.fading;
            progress = 0;
            updateDOMDescriptions();
          }
          break;

        case 'fading': {
          // Fade opacity and shrink petals
          const t = Math.min(1, elapsed / phaseDuration);
          const opacity = 1 - t;
          const shrink = 1 - t * 0.6;
          fm.petals.forEach(p => {
            p.material.opacity = opacity;
            p.scale.set(shrink, shrink, shrink);
          });
          fm.bud.material.opacity = opacity;
          // Also tilt petals down as they drop
          fm.petals.forEach((p, i) => {
            p.rotation.x += 0.0003; // slow droop
          });
          if (elapsed >= phaseDuration) {
            // Reset for next cycle
            phase = 'dormant';
            phaseStart = performance.now();
            durations = rollDurations();
            phaseDuration = durations.dormant;
            progress = 0;
            // Reset visual state
            fm.petals.forEach(p => {
              p.material.opacity = 1;
              p.scale.set(0.01, 0.01, 0.01);
              p.rotation.x = 0.3;
              p.rotation.z = 0;
            });
            fm.bud.material.opacity = 1;
            updateDOMDescriptions();
            // Restore normal dormant descriptions
            const growingDesc = document.getElementById('growing-description');
            const plotDesc = document.getElementById('plot-description');
            if (isPlant2) {
              growingDesc.textContent = 'Two seedlings now stand together — the central plant tall and slender, its companion shorter with broad, rounded leaves.';
              plotDesc.textContent = 'Two plants share the garden plot. The first stands tall at center; the second, with wider leaves and a softer green hue, grows beside it as if the garden chose to spread.';
            } else {
              const plant2Exists = window.__gardenState && window.__gardenState.plant2;
              if (plant2Exists) {
                growingDesc.textContent = 'A young seedling rises from the soil, its leaves reaching toward the light. A second plant grows nearby.';
                plotDesc.textContent = 'A healthy seedling stands at the center of the plot, its leaves open to the sky. A companion plant with broader leaves grows beside it.';
              } else {
                growingDesc.textContent = 'The first seedling stands tall.';
                plotDesc.textContent = 'A healthy seedling stands at the center of the plot.';
              }
            }
          }
          break;
        }
      }

      requestAnimationFrame(tick);
    }

    tick();
  }
  /* --- Helper: trigger fully-grown behaviour --- */
  function becomeFullyGrown() {
    fullyGrown = true;
    group.scale.set(1, 1, 1);
    updateMaturity(1);

    if (label === 'plant' && !window.__gardenState.firstPlantGrown) {
      window.__gardenState.firstPlantGrown = true;

      growingDesc.textContent = 'The first seedling stands tall. A second sprout begins to rise from the soil nearby.';
      plotDesc.textContent = 'A healthy seedling stands at the center of the plot. Nearby, the soil stirs as another plant emerges.';

      // Spawn second plant at random offset from center
      const angle = Math.random() * 2 * Math.PI;
      const distance = 0.3 + Math.random() * 0.3;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;

      createPlant({
        scene,
        position: { x, z },
        stemHeight: 0.5,
        stemColor: 0x6a9a4a,
        leafColor: 0x5a9a32,
        swayPhaseOffset: 3.7,
        growDuration: 25000,
        label: 'plant2',
        leafShape: 'broad'
      });
    } else if (label === 'plant') {
      growingDesc.textContent = 'A young seedling rises from the soil, its leaves reaching toward the light. A second plant grows nearby.';
      plotDesc.textContent = 'A healthy seedling stands at the center of the plot, its leaves open to the sky. A companion plant with broader leaves grows beside it.';
    } else {
      growingDesc.textContent = 'Two seedlings now stand together — the central plant tall and slender, its companion shorter with broad, rounded leaves.';
      plotDesc.textContent = 'Two plants share the garden plot. The first stands tall at center; the second, with wider leaves and a softer green hue, grows beside it as if the garden chose to spread.';
    }

    startSway();
    startFlowerCycle();
  }

  /* If already fully grown from the start, go straight to end state */
  if (initialProgress >= 1) {
    becomeFullyGrown();
    return;
  }

  /* --- Growth animation --- */
  function updateGrowth() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(1, elapsed / growDuration);

    updateMaturity(progress);

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
        // plant2
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
      becomeFullyGrown();
    }
  }

  updateGrowth();
}

/**
 * createFallenLeaves — scatters 8–15 small flat leaf-shaped meshes on the
 * ground within ~1 unit radius of the garden center, at y ≈ 0.005.
 *
 * Leaves start fully transparent and are driven by the seasonal cycle:
 *   autumn quarter — appear with warm brown/orange tones
 *   winter quarter  — desaturate toward pale winter brown
 *   spring quarter  — fade out (opacity → 0)
 *
 * The leaves are stationary (already fallen), sparse, and subtle.
 *
 * Exposes state on window.__gardenState.fallenLeaves for DOM updates
 * and self-testing.
 */
export function createFallenLeaves(scene) {
  const LEAF_COUNT = 10 + Math.floor(Math.random() * 6); // 10–15
  const SPREAD_RADIUS = 1.0;

  /* Build a leaf shape — small, broad, slightly rounded teardrop */
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.bezierCurveTo(0.025, 0.015, 0.03, 0.03, 0, 0.05);
  leafShape.bezierCurveTo(-0.03, 0.03, -0.025, 0.015, 0, 0);

  const leafGeo = new THREE.ShapeGeometry(leafShape);

  /* Shared material — starts fully transparent, opacity/colour driven by seasons */
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xaa6a2a,       // autumn brown/orange baseline
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,            // hidden until autumn
    depthWrite: false       // avoid z-fighting with ground
  });

  const meshes = [];
  const basePositions = [];
  const baseRotations = [];

  for (let i = 0; i < LEAF_COUNT; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);

    /* Random position within SPREAD_RADIUS of origin */
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPREAD_RADIUS * 0.9 + 0.1; // 0.1–0.9
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    leaf.position.set(x, 0.005, z);

    /* Random rotation so leaves lie at different angles on the ground */
    leaf.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.3; // slight tilt
    leaf.rotation.z = Math.random() * Math.PI * 2;

    /* Slight random scale variation (0.6–1.5) */
    const s = 0.6 + Math.random() * 0.9;
    leaf.scale.set(s, s, s);

    leaf.castShadow = false;
    leaf.receiveShadow = true;

    scene.add(leaf);
    meshes.push(leaf);

    /* Store base positions and rotations for ripple response */
    basePositions.push({ x, y: 0.005, z });
    baseRotations.push({ x: leaf.rotation.x, z: leaf.rotation.z });
  }

  /* --- Update function: called each frame to make leaves respond to ground ripple ---
   *
   * Each leaf subtly rotates (±0.05 rad) and shifts position (±0.01 units)
   * in sync with the ground ripple wave animation, suggesting wind moving
   * across the soil surface. The effect is barely perceptible.
   *
   * Respects prefers-reduced-motion: when active, leaves remain at their
   * base positions with no rotation offset.
   *
   * Leaves that are transparent (opacity 0, e.g. spring/summer) do not
   * visibly move.
   *
   * @param {number} time — current animation time in seconds
   * @param {function} computeDisplacement — (x, z, time) => number, from groundRipple.js
   */
  function update(time, computeDisplacement) {
    if (!computeDisplacement) return;

    const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reducedMotion = reducedMotionMedia.matches;

    if (reducedMotion) {
      // Reset leaves to base positions
      for (let i = 0; i < LEAF_COUNT; i++) {
        const leaf = meshes[i];
        const base = basePositions[i];
        const baseRot = baseRotations[i];
        leaf.position.set(base.x, base.y, base.z);
        leaf.rotation.x = baseRot.x;
        leaf.rotation.z = baseRot.z;
      }
      return;
    }

    for (let i = 0; i < LEAF_COUNT; i++) {
      const leaf = meshes[i];
      const base = basePositions[i];
      const baseRot = baseRotations[i];

      // Skip transparent leaves (opacity 0, e.g. spring/summer)
      if (leaf.material.opacity === 0) {
        leaf.position.set(base.x, base.y, base.z);
        leaf.rotation.x = baseRot.x;
        leaf.rotation.z = baseRot.z;
        continue;
      }

      // Compute displacement at base position
      const d = computeDisplacement(base.x, base.z, time);

      // Compute slope at base position for position drift
      const eps = 0.01;
      const dx = computeDisplacement(base.x + eps, base.z, time);
      const dz = computeDisplacement(base.x, base.z + eps, time);
      const slopeX = (dx - d) / eps;
      const slopeZ = (dz - d) / eps;

      // Apply y displacement (follow ground displacement)
      leaf.position.y = base.y + d;

      // Apply position drift (±0.01 units) — proportional to wave slope
      // Clamp the vector magnitude so the Euclidean distance never exceeds 0.01
      const driftScale = 5.0;
      let driftX = slopeX * driftScale;
      let driftZ = slopeZ * driftScale;
      const driftMag = Math.sqrt(driftX * driftX + driftZ * driftZ);
      if (driftMag > 0.01) {
        const clamp = 0.01 / driftMag;
        driftX *= clamp;
        driftZ *= clamp;
      }
      leaf.position.x = base.x + driftX;
      leaf.position.z = base.z + driftZ;

      // Apply rotation (±0.05 rad) — proportional to displacement
      // The rotation tilts the leaf around the X axis (like a wave passing under it)
      const rotScale = 6.0;
      const rotAmount = Math.max(-0.05, Math.min(0.05, d * rotScale));
      leaf.rotation.x = baseRot.x + rotAmount;
    }
  }

  /* Exposed state for seasonal cycle updates and self-test */
  const state = {
    type: 'fallen-leaves',
    meshes,
    material: leafMat,
    count: LEAF_COUNT,
    spreadRadius: SPREAD_RADIUS,
    basePositions,
    baseRotations,
    update
  };

  window.__gardenState.fallenLeaves = state;

  return state;
}

/**
 * startSeasonalCycle — drives the slow seasonal colour evolution.
 *
 * Reads materials from window.__gardenState (plant.stemMat, plant.leafMat,
 * and .groundMat) and lerps them through the four seasonal palettes
 * in a continuous ~12-minute cycle. Updates #season-display on each
 * season boundary.
 *
 * Also drives fallen-leaves lifecycle:
 *   spring → summer: leaves remain transparent (vanished)
 *   autumn quarter:  leaves gradually appear with warm brown/orange tones
 *   winter quarter:  leaves desaturate toward pale winter brown
 *   spring quarter:  leaves fade out (opacity → 0)
 *
 * Must be called after initGarden and after window.__gardenState.groundMat
 * is set (both happen in index.html's module script).
 */
export function startSeasonalCycle(initialProgress) {
  const startTime = performance.now() - (initialProgress || 0) * CYCLE_DURATION_MS;
  const seasonDisplay = document.getElementById('season-display');
  if (!seasonDisplay) {
    console.warn('startSeasonalCycle: #season-display not found');
    return;
  }

  let lastSeasonIndex = -1;

  /* Fallen leaf colours: autumn warm → winter desaturated */
  const autumnLeafColour = new THREE.Color(0xcc7730); // warm brown/orange
  const winterLeafColour = new THREE.Color(0x6a5a3a); // desaturated brown

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

    /* Store cycle progress for persistence */
    const gs = window.__gardenState;
    if (!gs) { requestAnimationFrame(tick); return; }
    gs.seasonProgress = (elapsed / CYCLE_DURATION_MS) % 1.0;

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
      // Compute the base seasonal ground colour (before winter legacy) into
      // baseGroundColor, which the weather cycle reads for rain darkening (issue #528).
      gs.baseGroundColor.copy(current.ground).lerp(next.ground, t);
      groundMat.color.copy(gs.baseGroundColor);

      /* --- Winter legacy effect (issue #471) ---
       * In early spring, the ground colour retains a slight desaturation
       * from winter, gradually warming to full spring colour over the
       * first ~30% of the spring quarter. The winter ground colour
       * (0x3a2a1a) is blended in at 10% weight at the start of spring,
       * linearly tapering to 0% by the time spring is 30% complete.
       * Only the ground colour is affected — stem/leaf colours are unchanged.
       *
       * The weather cycle (weather.js) reads baseGroundColor and applies
       * rain darkening via the darkest-of-three rule (issue #528). */
      if (seasonIndex === 0 && seasonProgress < 0.30) {
        const winterLegacyBlend = 0.10 * (1 - seasonProgress / 0.30);
        const winterGround = new THREE.Color(0x3a2a1a);
        groundMat.color.lerp(winterGround, winterLegacyBlend);
        gs.winterLegacyBlend = winterLegacyBlend;
      } else {
        gs.winterLegacyBlend = 0;
      }
    }

    /* --- Fallen leaves lifecycle (issue #448) --- */
    const fallenLeaves = gs.fallenLeaves;
    if (fallenLeaves && fallenLeaves.meshes && fallenLeaves.meshes.length > 0) {
      const leafMat = fallenLeaves.material;
      const seasonName = SEASON_NAMES[seasonIndex];

      if (seasonName === 'Autumn') {
        /* Autumn: leaves gradually appear, colour from transparent → warm brown/orange */
        // t goes 0→1 through autumn
        // opacity: 0 at start of autumn, 1 at end
        const opacity = t;
        leafMat.opacity = opacity;

        // Colour: lerp from a pale hint to full autumn orange
        const startColour = new THREE.Color(0x4a3a2a); // faint brown (barely visible)
        leafMat.color.copy(startColour).lerp(autumnLeafColour, t);

        /* Update DOM when leaves first appear */
        if (t > 0.1 && !fallenLeaves._domUpdated) {
          fallenLeaves._domUpdated = true;
          const plotDesc = document.getElementById('plot-description');
          if (plotDesc && !plotDesc.textContent.includes('fallen leaves')) {
            plotDesc.textContent += ' A few fallen leaves rest on the soil nearby.';
          }
        }
      } else if (seasonName === 'Winter') {
        /* Winter: leaves desaturate from autumn warm → desaturated brown,
         * and fade out during the latter part of winter (transition to spring) */
        // t goes 0→1 through winter

        // Colour lerps across the whole winter
        leafMat.color.copy(autumnLeafColour).lerp(winterLeafColour, t);

        // Opacity: stays 1 for the first ~60% of winter, then fades to 0
        // by the end of winter — so by spring the leaves are already invisible.
        if (t < 0.6) {
          leafMat.opacity = 1;
        } else {
          // Remap t from [0.6, 1] to [0, 1] for the fade-out
          const fadeT = (t - 0.6) / 0.4;
          leafMat.opacity = Math.max(0, 1 - fadeT);
        }

        /* Update DOM as winter progresses */
        if (t > 0.3 && !fallenLeaves._winterDomUpdated) {
          fallenLeaves._winterDomUpdated = true;
          const plotDesc = document.getElementById('plot-description');
          if (plotDesc && !plotDesc.textContent.includes('faded')) {
            plotDesc.textContent += ' The fallen leaves have faded in the cold.';
          }
        }
      } else if (seasonName === 'Spring') {
        /* Spring: leaves should already be invisible (fade-out finished in late winter) */
        leafMat.opacity = 0;

        // Colour stays at winter desaturated brown
        leafMat.color.copy(winterLeafColour);

        /* Once fully into spring, reset DOM flags for next cycle */
        if (t > 0.2) {
          fallenLeaves._domUpdated = false;
          fallenLeaves._winterDomUpdated = false;
          const plotDesc = document.getElementById('plot-description');
          // Remove leaf references from plot description
          if (plotDesc) {
            let text = plotDesc.textContent;
            text = text.replace(' A few fallen leaves rest on the soil nearby.', '');
            text = text.replace(' The fallen leaves have faded in the cold.', '');
            plotDesc.textContent = text;
          }
        }
      } else {
        /* Summer: leaves fully transparent */
        leafMat.opacity = 0;
      }
    }

    requestAnimationFrame(tick);
  }

  // If initialProgress was provided, also set the display to the correct season name
  if (initialProgress !== undefined) {
    const offsetCycleTime = (initialProgress * CYCLE_DURATION_MS) % CYCLE_DURATION_MS;
    const initialSeasonIndex = Math.floor(offsetCycleTime / SEASON_DURATION_MS) % 4;
    lastSeasonIndex = initialSeasonIndex;
    const name = SEASON_NAMES[initialSeasonIndex];
    if (seasonDisplay) {
      seasonDisplay.textContent = name;
    }
  }

  tick();
}

