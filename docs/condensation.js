/**
 * condensation.js — transient dawn-mist moisture beads (issue #773)
 *
 * During the dawn window (day cycle t ∈ [0.95, 0.12]) the dawn mist
 * (#747) leaves a transient trace on garden surfaces: tiny specular
 * beads on existing leaves and stems, plus a wet-look specular highlight
 * on the ground beetle's carapace. Both fade on the exact curve the mist
 * uses — fade in 0.95→1.0, hold at peak through t ∈ [0, 0.08), fade out
 * to 0.12 — and are fully invisible outside the window.
 *
 * The beads are small high-metalness / low-roughness spheres parented to
 * existing plant meshes, completely separate from the Light Drizzle
 * droplet system (droplets.js), so the two effects never interfere.
 *
 * Opacity and roughness changes are material changes, not motion, so the
 * effect still applies under prefers-reduced-motion.
 *
 * Exports: createCondensation() → { update, state }
 */

import * as THREE from "three";

/* --- Dawn window timing (identical to dawnMist.js) --- */
const DAWN_FADE_IN_START = 0.95;
const DAWN_FADE_IN_END = 1.00;
const DAWN_HOLD_END = 0.08;
const DAWN_FADE_OUT_END = 0.12;

/* --- Bead material --- */
const BEAD_RADIUS = 0.0045;                  // tiny — same order as drizzle droplets
const BEAD_SEGMENTS = 6;                     // low-poly, stays subtle
const BEAD_METALNESS = 0.7;                  // specular catch
const BEAD_ROUGHNESS = 0.2;
const PEAK_BEAD_OPACITY = 0.25;              // max bead opacity inside the window
const BEAD_LEAF_OFFSET = { x: 0, y: 0.06, z: 0.0015 }; // leaf-local, just off the plane
const BEAD_STEM_X = 0.04;                    // stem surface radius is ~0.0375 at mid-height

/* --- Beetle carapace --- */
const CARAPACE_BASE_ROUGHNESS = 0.85;        // dry body material (beetle.js)
const CARAPACE_WET_ROUGHNESS = 0.5;          // wet sheen at peak

/* --- Fade smoothing (mirrors dawnMist.js FADE_LERP_SPEED) --- */
const FADE_LERP_SPEED = 0.04;

const PLANT_LABELS = ['plant', 'plant2', 'plant3'];

/**
 * Dawn window factor for a day-cycle progress t — the exact opacity curve
 * the dawn mist uses, normalised to [0, 1]: zero outside [0.95, 0.12],
 * linear fade-in 0.95→1.0, peak 1 in [0, 0.08), linear fade-out 0.08→0.12.
 *
 * @param {number} t - day cycle progress in [0, 1)
 * @returns {number} window factor in [0, 1]
 */
function getWindowFactor(t) {
  if (t >= DAWN_FADE_IN_START && t < DAWN_FADE_IN_END) {
    return (t - DAWN_FADE_IN_START) / (DAWN_FADE_IN_END - DAWN_FADE_IN_START);
  }
  if (t >= 0 && t < DAWN_HOLD_END) {
    return 1;
  }
  if (t >= DAWN_HOLD_END && t < DAWN_FADE_OUT_END) {
    return 1 - (t - DAWN_HOLD_END) / (DAWN_FADE_OUT_END - DAWN_HOLD_END);
  }
  return 0;
}

/**
 * Create the condensation effect.
 *
 * Plants may not exist yet when this runs (module creation happens before
 * initGarden populates window.__gardenState and plant3 grows much later),
 * so beads are bound lazily on the first update frames — the same pattern
 * beetle.js uses for its anchor.
 *
 * @returns {{ update: Function, state: object }}
 */
export function createCondensation() {
  const beads = [];
  const plantBeads = {};
  const boundPlants = {};

  const state = {
    type: 'condensation',
    beads,
    plantBeads,
    peakBeadOpacity: PEAK_BEAD_OPACITY,
    beadMetalness: BEAD_METALNESS,
    beadRoughness: BEAD_ROUGHNESS,
    carapaceBaseRoughness: CARAPACE_BASE_ROUGHNESS,
    carapaceWetRoughness: CARAPACE_WET_ROUGHNESS,
    dawnFadeInStart: DAWN_FADE_IN_START,
    dawnFadeInEnd: DAWN_FADE_IN_END,
    dawnHoldEnd: DAWN_HOLD_END,
    dawnFadeOutEnd: DAWN_FADE_OUT_END,
    /** Dawn window factor for a given day-cycle progress t (0 outside the window, 1 at peak). */
    getWindowFactor: getWindowFactor,
    /** Target bead opacity (0–0.25) for a given day-cycle progress t. */
    getBeadOpacity: function(t) {
      return getWindowFactor(t) * PEAK_BEAD_OPACITY;
    },
    /** Target carapace roughness (0.85 dry → 0.5 wet) for a given day-cycle progress t. */
    getCarapaceRoughness: function(t) {
      return CARAPACE_BASE_ROUGHNESS +
        (CARAPACE_WET_ROUGHNESS - CARAPACE_BASE_ROUGHNESS) * getWindowFactor(t);
    },
    /* Smoothly-run values, updated every frame (mirrors dawnMist's currentOpacity). */
    currentWindowFactor: 0,
    currentBeadOpacity: 0,
    currentCarapaceRoughness: CARAPACE_BASE_ROUGHNESS
  };

  /** A shared bead material — specular, transparent, starting fully hidden. */
  function makeBeadMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: BEAD_METALNESS,
      roughness: BEAD_ROUGHNESS,
      transparent: true,
      opacity: 0
    });
  }

  /** Attach one bead per leaf (just off the leaf surface) and one on the stem. */
  function bindPlant(label, plant) {
    const plantBeadList = [];
    const baseGeo = new THREE.SphereGeometry(BEAD_RADIUS, BEAD_SEGMENTS, BEAD_SEGMENTS);

    for (let li = 0; li < plant.leaves.length; li++) {
      const bead = new THREE.Mesh(baseGeo, makeBeadMaterial());
      bead.name = 'condensation-bead';
      bead.position.set(BEAD_LEAF_OFFSET.x, BEAD_LEAF_OFFSET.y, BEAD_LEAF_OFFSET.z);
      plant.leaves[li].add(bead);
      plantBeadList.push(bead);
    }

    const stemHeight = plant.stem.geometry && plant.stem.geometry.parameters ?
      plant.stem.geometry.parameters.height : 0.5;
    const stemBead = new THREE.Mesh(baseGeo, makeBeadMaterial());
    stemBead.name = 'condensation-bead';
    stemBead.position.set(BEAD_STEM_X, stemHeight * 0.5, 0);
    plant.stem.add(stemBead);
    plantBeadList.push(stemBead);

    plantBeads[label] = plantBeadList;
    beads.push(...plantBeadList);
    boundPlants[label] = true;
  }

  let currentFactor = 0;

  /**
   * Update the condensation effect each frame: lazily bind beads to any
   * plants that have appeared, then drive bead opacity and the beetle's
   * carapace roughness from the dawn window factor.
   */
  function update() {
    const gs = window.__gardenState;
    if (!gs) return;

    /* Lazily attach beads to plants as they appear (plant3 grows later). */
    for (let i = 0; i < PLANT_LABELS.length; i++) {
      const label = PLANT_LABELS[i];
      if (boundPlants[label]) continue;
      const plant = gs[label];
      if (!plant || !plant.leaves || !plant.stem) continue;
      bindPlant(label, plant);
    }

    const dayNight = gs.dayNight;
    if (!dayNight || typeof dayNight.getCycleProgress !== 'function') return;

    const t = dayNight.getCycleProgress();
    const targetFactor = getWindowFactor(t);

    /* Smooth toward the target exactly like the dawn mist fades. */
    currentFactor += (targetFactor - currentFactor) * FADE_LERP_SPEED;
    if (Math.abs(currentFactor - targetFactor) < 0.0005) {
      currentFactor = targetFactor;
    }
    state.currentWindowFactor = currentFactor;

    /* Drive bead opacity on every bound bead. */
    const opacity = currentFactor * PEAK_BEAD_OPACITY;
    state.currentBeadOpacity = opacity;
    for (let i = 0; i < beads.length; i++) {
      beads[i].material.opacity = opacity;
    }

    /* Wet-look sheen on the beetle carapace. The body is group.children[0]
     * — the same path the #766 selftest uses for the beetle material. */
    const carapaceRoughness = CARAPACE_BASE_ROUGHNESS +
      (CARAPACE_WET_ROUGHNESS - CARAPACE_BASE_ROUGHNESS) * currentFactor;
    state.currentCarapaceRoughness = carapaceRoughness;
    if (gs.beetle && gs.beetle.group && gs.beetle.group.children.length > 0) {
      const bodyMat = gs.beetle.group.children[0].material;
      if (bodyMat && typeof bodyMat.roughness === 'number') {
        bodyMat.roughness = carapaceRoughness;
      }
    }
  }

  return { update, state };
}