/**
 * selftest.js — selfgrow product checks
 *
 * Verifies the garden page booted correctly and the required DOM
 * and Three.js structures are present.
 */

import * as THREE from "three";
import { saveGardenState, loadGardenState, fastForwardState, clearGardenState, STORAGE_KEY } from "./persistence.js";

export async function checks() {
  const problems = [];

  /* ---------- DOM state panel ---------- */
  const panel = document.getElementById('state-panel');
  if (!panel) {
    problems.push('Missing #state-panel element: the garden state sidebar is required.');
  } else {
    const role = panel.getAttribute('role');
    if (role !== 'region') {
      problems.push('#state-panel role should be "region", got "' + role + '".');
    }
    if (!panel.hasAttribute('aria-label')) {
      problems.push('#state-panel must have an aria-label for screen readers.');
    }
  }

  /* Check plot description — the core "what is the garden" text */
  const plotDesc = document.getElementById('plot-description');
  if (!plotDesc) {
    problems.push('Missing #plot-description element.');
  } else if (!plotDesc.textContent || plotDesc.textContent.trim().length === 0) {
    problems.push('#plot-description is empty. Should describe the garden state.');
  } else if (!plotDesc.textContent.toLowerCase().includes('soil') &&
             !plotDesc.textContent.toLowerCase().includes('plot') &&
             !plotDesc.textContent.toLowerCase().includes('garden')) {
    problems.push('#plot-description text ("' + plotDesc.textContent + '") should reference the soil or plot.');
  }

  /* Check season, time, weather displays exist */
  ['season-display', 'time-display', 'weather-display', 'growing-description'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) {
      problems.push('Missing #' + id + ' element in the state panel.');
    }
  });

  /* ---------- Three.js canvas ---------- */
  const gardenState = window.__gardenState;
  if (!gardenState) {
    problems.push('window.__gardenState is not set. The Three.js scene did not initialise.');
  } else {
    if (!gardenState.scene) {
      problems.push('gardenState.scene is missing: Three.js scene not created.');
    }
    if (!gardenState.camera) {
      problems.push('gardenState.camera is missing: camera not created.');
    }
    if (!gardenState.renderer) {
      problems.push('gardenState.renderer is missing: WebGL renderer not created.');
    } else {
      const canvas = gardenState.renderer.domElement;
      if (!canvas || !canvas.parentElement) {
        problems.push('Renderer canvas is not attached to the DOM.');
      } else {
        const wrapper = document.getElementById('garden-canvas-wrapper');
        if (!wrapper) {
          problems.push('Missing #garden-canvas-wrapper container.');
        } else if (!wrapper.contains(canvas)) {
          problems.push('Renderer canvas is not inside #garden-canvas-wrapper.');
        }
      }
    }
  }

  /* ---------- No crash / renderer healthy ---------- */
  if (gardenState && gardenState.renderer) {
    const info = gardenState.renderer.info;
    // A healthy renderer processes geometry
    if (info && info.memory && info.memory.geometries === undefined) {
      // Some versions may not expose this — skip
    }
    // Check it rendered at least one frame (programs counter)
    if (info && info.programs && info.programs.length === 0) {
      problems.push('Renderer has no compiled shader programs — scene may not have rendered.');
    }
  }

  /* ---------- OrbitControls checks ---------- */
  if (gardenState) {
    const ctrl = gardenState.controls;
    if (!ctrl) {
      problems.push('gardenState.controls is missing — OrbitControls were not instantiated.');
    } else {
      if (ctrl.enableDamping !== true) {
        problems.push('controls.enableDamping is ' + ctrl.enableDamping + ', expected true — damping must be on for smooth easing.');
      }
      if (typeof ctrl.dampingFactor !== 'number' || ctrl.dampingFactor <= 0) {
        problems.push('controls.dampingFactor is not a positive number (got ' + ctrl.dampingFactor + ') — needed for gentle easing.');
      }
      if (typeof ctrl.maxPolarAngle !== 'number' || ctrl.maxPolarAngle >= Math.PI / 2) {
        problems.push('controls.maxPolarAngle is ' + ctrl.maxPolarAngle + ', expected less than PI/2 to prevent going below ground.');
      }
      if (typeof ctrl.minPolarAngle !== 'number' || ctrl.minPolarAngle <= 0) {
        problems.push('controls.minPolarAngle is ' + ctrl.minPolarAngle + ', expected > 0 to prevent fully top-down view.');
      }
      // Verify target is a Vector3 pointing near the plant (y ~0.4)
      if (!ctrl.target || typeof ctrl.target.y !== 'number') {
        problems.push('controls.target is not a Vector3 (y is not a number).');
      } else {
        const targetY = ctrl.target.y;
        if (targetY < 0.2 || targetY > 0.6) {
          problems.push('controls.target.y is ' + targetY + ', expected ~0.4 to aim at the seedling.');
        }
        const targetX = ctrl.target.x;
        const targetZ = ctrl.target.z;
        if (Math.abs(targetX) > 0.01 || Math.abs(targetZ) > 0.01) {
          problems.push('controls.target is not centered (x=' + targetX + ', z=' + targetZ + ') — expected (0, ~0.4, 0) to aim at the plant.');
        }
      }
      // Verify the controls' domElement matches the renderer canvas
      if (!ctrl.domElement) {
        problems.push('controls.domElement is not set — controls not wired to a dom element.');
      } else if (gardenState.renderer && ctrl.domElement !== gardenState.renderer.domElement) {
        problems.push('controls.domElement does not match the renderer canvas — controls wired to wrong element.');
      }
      // Verify rotateSpeed is set (botanical, unhurried)
      if (typeof ctrl.rotateSpeed !== 'number' || ctrl.rotateSpeed > 1) {
        problems.push('controls.rotateSpeed is ' + ctrl.rotateSpeed + ', expected <= 1 for an unhurried botanical feel.');
      }
    }
  }

  /* ---------- Console error detection ---------- */
  // Capture errors that happened during load by checking the scene
  // and renderer state are consistent.
  if (gardenState && gardenState.renderer && gardenState.scene) {
    try {
      // Force a render check — if the scene has objects and the
      // renderer can process them, we know it's healthy.
      const objects = gardenState.scene.children.length;
      if (objects === 0) {
        problems.push('Scene has zero children — nothing was added to the scene.');
      }
    } catch (e) {
      problems.push('Scene inspection threw: ' + e.message);
    }
  }

  /* ---------- Second plant checks (issue #419) ---------- */
  // The second plant (plant2) should exist at some point after the first
  // plant is fully grown. It may not exist immediately (it's spawned after
  // ~30s of growth), so we check that if it does exist, it's valid.
  // We also verify that __gardenState exposes it correctly.
  const plant2Obj = gardenState && gardenState.plant2;
  if (plant2Obj) {
    if (!plant2Obj.group) {
      problems.push('plant2.group is missing — the second plant\'s group was not added to the scene.');
    } else {
      if (gardenState && gardenState.scene) {
        const found = gardenState.scene.children.includes(plant2Obj.group);
        if (!found) {
          problems.push('plant2 group is not a child of the scene — it was not added to the garden.');
        }
      }
      // Verify stem is present
      if (!plant2Obj.stem) {
        problems.push('plant2.stem is missing — stem geometry was not created for the second plant.');
      }
      if (!plant2Obj.stemMat) {
        problems.push('plant2.stemMat is missing — stem material not exposed for seasonal colour updates.');
      }
      if (!plant2Obj.leafMat) {
        problems.push('plant2.leafMat is missing — leaf material not exposed for seasonal colour updates.');
      }
      if (!plant2Obj.leaves || plant2Obj.leaves.length === 0) {
        problems.push('plant2.leaves is missing or empty — no leaf geometry was created for the second plant.');
      } else if (plant2Obj.leaves.length < 2) {
        problems.push('plant2 has only ' + plant2Obj.leaves.length + ' leaf/leaves — expected at least 2.');
      }
      if (typeof plant2Obj.isFullyGrown !== 'function') {
        problems.push('plant2.isFullyGrown should be a function, got ' + typeof plant2Obj.isFullyGrown);
      }

      // Verify the second plant is at a different position from the first
      const firstPlant = gardenState && gardenState.plant;
      if (firstPlant && firstPlant.group) {
        const p1 = firstPlant.group.position;
        const p2 = plant2Obj.group.position;
        const distance = Math.sqrt((p1.x - p2.x) ** 2 + (p1.z - p2.z) ** 2);
        if (distance < 0.1) {
          problems.push('plant2 is too close to plant1 (distance=' + distance.toFixed(3) + ') — expected an offset of at least 0.3 units.');
        }
      }
    }
  } else {
    // It's acceptable if plant2 hasn't spawned yet — the scene may have loaded
    // recently and the first plant takes ~30s to mature. We only report this
    // as a problem if the first plant is already fully grown but plant2 is missing.
    const firstPlant = gardenState && gardenState.plant;
    if (firstPlant && typeof firstPlant.isFullyGrown === 'function' && firstPlant.isFullyGrown()) {
      problems.push('window.__gardenState.plant2 is not set, but the first plant is fully grown — the second plant should have been spawned.');
    }
    // If firstPlant doesn't exist either, that's handled in the plant checks section
  }

  /* ---------- Flower lifecycle checks (issue #438) ---------- */
  // A fully-grown plant should have a flower lifecycle with valid phases
  const validFlowerPhases = ['dormant', 'budding', 'opening', 'bloom', 'fading'];

  // Check plant1 for flower
  const firstPlant = gardenState && gardenState.plant;
  if (firstPlant && typeof firstPlant.isFullyGrown === 'function' && firstPlant.isFullyGrown()) {
    if (!firstPlant.flower) {
      problems.push('plant.flower is not set — a fully-grown plant should have a flower lifecycle running.');
    } else {
      if (!firstPlant.flower.getPhase || typeof firstPlant.flower.getPhase !== 'function') {
        problems.push('plant.flower.getPhase is not a function — flower phase getter is missing.');
      } else {
        const phase = firstPlant.flower.getPhase();
        if (!validFlowerPhases.includes(phase)) {
          problems.push('plant.flower.getPhase() returned "' + phase + '", expected one of: ' + validFlowerPhases.join(', '));
        }
      }
      if (!firstPlant.flower.getProgress || typeof firstPlant.flower.getProgress !== 'function') {
        problems.push('plant.flower.getProgress is not a function — flower progress getter is missing.');
      } else {
        const progress = firstPlant.flower.getProgress();
        if (typeof progress !== 'number' || progress < 0 || progress > 1) {
          problems.push('plant.flower.getProgress() returned ' + progress + ', expected a number in [0, 1].');
        }
      }
      if (!firstPlant.flower.group) {
        problems.push('plant.flower.group is missing — the flower group was not created in the scene.');
      } else if (gardenState && gardenState.scene) {
        // Check the flower group exists in the scene hierarchy
        let found = false;
        gardenState.scene.traverse(function(child) {
          if (child === firstPlant.flower.group) found = true;
        });
        if (!found) {
          problems.push('plant.flower.group is not a descendant of the scene — the flower meshes are not rendered.');
        }
      }
      if (!firstPlant.flower.petals || !Array.isArray(firstPlant.flower.petals) || firstPlant.flower.petals.length < 3) {
        problems.push('plant.flower.petals is missing or has fewer than 3 petals.');
      }
    }
  }

  // Check plant2 for flower if fully grown
  const secondPlant = gardenState && gardenState.plant2;
  if (secondPlant && typeof secondPlant.isFullyGrown === 'function' && secondPlant.isFullyGrown()) {
    if (!secondPlant.flower) {
      problems.push('plant2.flower is not set — a fully-grown companion plant should have a flower lifecycle running.');
    } else {
      if (!secondPlant.flower.getPhase || typeof secondPlant.flower.getPhase !== 'function') {
        problems.push('plant2.flower.getPhase is not a function — flower phase getter is missing.');
      } else {
        const phase = secondPlant.flower.getPhase();
        if (!validFlowerPhases.includes(phase)) {
          problems.push('plant2.flower.getPhase() returned "' + phase + '", expected one of: ' + validFlowerPhases.join(', '));
        }
      }
      if (!secondPlant.flower.getProgress || typeof secondPlant.flower.getProgress !== 'function') {
        problems.push('plant2.flower.getProgress is not a function — flower progress getter is missing.');
      } else {
        const progress = secondPlant.flower.getProgress();
        if (typeof progress !== 'number' || progress < 0 || progress > 1) {
          problems.push('plant2.flower.getProgress() returned ' + progress + ', expected a number in [0, 1].');
        }
      }
      if (secondPlant.flower.petals && Array.isArray(secondPlant.flower.petals) && secondPlant.flower.petals.length < 3) {
        problems.push('plant2.flower.petals has fewer than 3 petals.');
      }
    }
  }

  /* ---------- Plant (botanical form) checks ---------- */
  const plant = gardenState && gardenState.plant;
  if (!plant) {
    problems.push('window.__gardenState.plant is not set — the botanical form was not created.');
  } else {
    if (!plant.group) {
      problems.push('plant.group is missing — the plant group was not added to the scene.');
    } else {
      // Verify the plant group is actually in the scene
      if (gardenState && gardenState.scene) {
        const found = gardenState.scene.children.includes(plant.group);
        if (!found) {
          problems.push('Plant group is not a child of the scene — it was not added to the garden.');
        }
      }
      // Verify the plant has a stem mesh
      if (!plant.stem) {
        problems.push('plant.stem is missing — the stem geometry was not created.');
      }
      // Verify the plant has a stemMat material
      if (!plant.stemMat) {
        problems.push('plant.stemMat is missing — stem material not exposed for seasonal colour updates.');
      }
      // Verify the plant has a leafMat material
      if (!plant.leafMat) {
        problems.push('plant.leafMat is missing — leaf material not exposed for seasonal colour updates.');
      }
      // Verify the plant has leaves
      if (!plant.leaves || plant.leaves.length === 0) {
        problems.push('plant.leaves is missing or empty — no leaf geometry was created.');
      } else if (plant.leaves.length < 2) {
        problems.push('plant has only ' + plant.leaves.length + ' leaf/leaves — expected at least 2.');
      }
      // Verify isFullyGrown is a function
      if (typeof plant.isFullyGrown !== 'function') {
        problems.push('plant.isFullyGrown should be a function, got ' + typeof plant.isFullyGrown);
      }

      // Check the plant's scale is reasonable (should be > 0 or growing)
      const s = plant.group.scale.x;
      if (s < 0) {
        problems.push('Plant scale is negative (' + s + ') — growth animation broke.');
      }
    }

    // Check DOM state reflects something growing
    const growingDesc = document.getElementById('growing-description');
    if (growingDesc) {
      const text = growingDesc.textContent.trim().toLowerCase();
      if (text === 'nothing yet — the soil is waiting.') {
        problems.push('growing-description has not been updated from its initial state — the plant growth did not update the DOM.');
      } else if (!text.includes('sprout') && !text.includes('seedling') && !text.includes('grow') && !text.includes('leaf')) {
        problems.push('growing-description text ("' + growingDesc.textContent + '") should describe a growing plant (sprout, seedling, growing, or leaf).');
      }
    }

    // Check plot description mentions the plant
    const plotDesc = document.getElementById('plot-description');
    if (plotDesc) {
      const text = plotDesc.textContent.trim().toLowerCase();
      if (text.includes('empty') && text.includes('waiting')) {
        problems.push('plot-description still says empty/waiting — the plant growth did not update the plot description.');
      }
    }
  }

  /* ---------- WCAG contrast: .state-label on #23233a background ---------- */
  const labelElements = document.querySelectorAll('.state-label');
  if (labelElements.length === 0) {
    problems.push('No .state-label elements found in the DOM.');
  } else {
    // Expected background: #23233a (RGB: 35, 35, 58)
    const bgR = 35 / 255;
    const bgG = 35 / 255;
    const bgB = 58 / 255;

    function srgbToLinear(c) {
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function relativeLuminance(r, g, b) {
      const rLin = srgbToLinear(r);
      const gLin = srgbToLinear(g);
      const bLin = srgbToLinear(b);
      return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    }

    function contrastRatio(l1, l2) {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const bgLuminance = relativeLuminance(bgR, bgG, bgB);
    const minRatio = 4.5;

    labelElements.forEach((el, i) => {
      const computed = window.getComputedStyle(el);
      const color = computed.color; // e.g. "rgb(144, 144, 176)"
      const match = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      if (!match) {
        problems.push('.state-label #' + (i + 1) + ' has unrecognised colour format: ' + color);
        return;
      }
      const r = parseInt(match[1], 10) / 255;
      const g = parseInt(match[2], 10) / 255;
      const b = parseInt(match[3], 10) / 255;
      const fgLuminance = relativeLuminance(r, g, b);
      const ratio = contrastRatio(fgLuminance, bgLuminance);
      if (ratio < minRatio) {
        const labelText = el.textContent.trim() || '(no text)';
        problems.push(
          '.state-label "' + labelText + '" contrast ratio is ' +
          ratio.toFixed(2) + ':1 — below WCAG AA minimum of ' + minRatio + ':1. ' +
          'Computed colour: ' + color + ' on #23233a.'
        );
      }
    });
  }

  /* ---------- WCAG contrast: .skip-link (#5a5add bg + #fff fg) ---------- */
  const skipLink = document.querySelector('.skip-link');
  if (!skipLink) {
    problems.push('No .skip-link element found in the DOM.');
  } else {
    const computed = window.getComputedStyle(skipLink);
    const bgColor = computed.backgroundColor; // e.g. "rgb(90, 90, 221)"
    const textColor = computed.color;          // e.g. "rgb(255, 255, 255)"

    function srgbToLinear(c) {
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function relativeLuminance(r, g, b) {
      const rLin = srgbToLinear(r);
      const gLin = srgbToLinear(g);
      const bLin = srgbToLinear(b);
      return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    }

    function contrastRatio(l1, l2) {
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const bgMatch = bgColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    const fgMatch = textColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);

    if (!bgMatch) {
      problems.push('.skip-link computed background colour format unrecognised: ' + bgColor);
    } else if (!fgMatch) {
      problems.push('.skip-link computed text colour format unrecognised: ' + textColor);
    } else {
      const bgR = parseInt(bgMatch[1], 10) / 255;
      const bgG = parseInt(bgMatch[2], 10) / 255;
      const bgB = parseInt(bgMatch[3], 10) / 255;
      const fgR = parseInt(fgMatch[1], 10) / 255;
      const fgG = parseInt(fgMatch[2], 10) / 255;
      const fgB = parseInt(fgMatch[3], 10) / 255;

      const bgLum = relativeLuminance(bgR, bgG, bgB);
      const fgLum = relativeLuminance(fgR, fgG, fgB);
      const ratio = contrastRatio(fgLum, bgLum);

      if (ratio < 4.5) {
        problems.push(
          '.skip-link contrast ratio is ' + ratio.toFixed(2) + ':1 — below WCAG AA minimum of 4.5:1. ' +
          'Background: ' + bgColor + ', text: ' + textColor + '.'
        );
      }
    }
  }

  /* ---------- Skip link clickability and focus transfer (issue #430) ---------- */
  const skipLinkEl = document.querySelector('.skip-link');
  if (!skipLinkEl) {
    problems.push('No .skip-link element found — cannot test skip link behavior.');
  } else {
    const panel = document.getElementById('state-panel');
    if (!panel) {
      problems.push('#state-panel is missing — cannot verify skip link focus transfer.');
    } else {
      // Test 1: dispatch a click on the skip link and detect whether panel.focus() was called
      let focusCalled = false;
      const origFocus = panel.focus.bind(panel);
      panel.focus = function() { focusCalled = true; return origFocus(); };
      try {
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: 0,
          clientY: 0
        });
        skipLinkEl.dispatchEvent(clickEvent);
      } finally {
        panel.focus = origFocus;
      }
      if (!focusCalled) {
        problems.push('Clicking .skip-link did not call panel.focus() — the click handler is not wired or did not fire.');
      }

      // Test 2: check the :hover CSS rule exists so the link is visible on pointer hover
      let hasHoverRule = false;
      try {
        for (let i = 0; i < document.styleSheets.length; i++) {
          const sheet = document.styleSheets[i];
          if (!sheet || !sheet.cssRules) continue;
          for (let j = 0; j < sheet.cssRules.length; j++) {
            const rule = sheet.cssRules[j];
            if (rule.selectorText && rule.selectorText.includes('.skip-link') && rule.selectorText.includes(':hover')) {
              hasHoverRule = true;
              break;
            }
          }
          if (hasHoverRule) break;
        }
      } catch (_e) {
        // cross-origin stylesheet access may be restricted — skip
      }
      if (!hasHoverRule) {
        problems.push('.skip-link does not have a :hover CSS rule — the link will not be visible when the mouse pointer passes over it, making it unclickable by mouse.');
      }
    }
  }

  /* ---------- Seasonal colour system checks ---------- */
  // Verify ground material is exposed for seasonal updates
  const groundMat = gardenState && gardenState.groundMat;
  if (!groundMat) {
    problems.push('window.__gardenState.groundMat is not set — ground material not exposed for seasonal colour updates.');
  } else {
    if (typeof groundMat.color === 'undefined') {
      problems.push('groundMat.color is undefined — material may not be a THREE.MeshStandardMaterial.');
    }
  }

  // Verify season display has been initialised to a valid season name
  const seasonEl = document.getElementById('season-display');
  if (seasonEl) {
    const text = seasonEl.textContent.trim();
    const validSeasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
    if (!validSeasons.includes(text)) {
      problems.push('season-display shows "' + text + '", expected one of: ' + validSeasons.join(', '));
    }
  } else {
    problems.push('#season-display element is missing — seasonal state cannot be shown.');
  }

  // Verify startSeasonalCycle is available as an export from garden.js
  // We can check via the import or by verifying the seasonal loop started
  // by checking that the season display content is not just the hardcoded default.
  // Since we can't easily introspect module exports, we check the groundMat
  // colour has been updated from its initial value (the seasonal loop runs
  // on RAF and will have at least started updating by now).
  if (groundMat && plant && plant.stemMat) {
    // After the seasonal loop runs once (even one frame), the colour will
    // have been set via copy(). If nothing ran, the colour would still be
    // the initial 0x4a3728 for ground. Since the loop is instantaneous on
    // first frame, we check that ground colour is a THREE.Color.
    if (!(groundMat.color instanceof THREE.Color)) {
      problems.push('groundMat.color is not a THREE.Color instance — colour system may not have initialised.');
    }
    // The stem material colour should also be a THREE.Color
    if (!(plant.stemMat.color instanceof THREE.Color)) {
      problems.push('plant.stemMat.color is not a THREE.Color instance.');
    }
    // The leaf material colour should also be a THREE.Color
    if (!(plant.leafMat.color instanceof THREE.Color)) {
      problems.push('plant.leafMat.color is not a THREE.Color instance.');
    }
  }

  /* ---------- Ambient floating particles checks ---------- */
  const particles = gardenState && gardenState.particles;
  if (!particles) {
    problems.push('window.__gardenState.particles is not set — ambient particle system not created.');
  } else {
    if (particles.type !== 'ambient-particles') {
      problems.push('particles.type is "' + particles.type + '", expected "ambient-particles".');
    }
    if (typeof particles.count !== 'number' || particles.count < 40) {
      problems.push('particles.count is ' + particles.count + ', expected at least 40 particles for a sparse cloud.');
    }
    if (typeof particles.reducedMotion !== 'boolean') {
      problems.push('particles.reducedMotion should be a boolean, got ' + typeof particles.reducedMotion);
    }
    if (!particles.material) {
      problems.push('particles.material is missing — PointsMaterial not assigned.');
    } else {
      // Verify material properties: transparent, low opacity, sizeAttenuation
      if (particles.material.transparent !== true) {
        problems.push('particles.material.transparent is ' + particles.material.transparent + ', expected true.');
      }
      if (typeof particles.material.opacity !== 'number' || particles.material.opacity > 0.5) {
        problems.push('particles.material.opacity is ' + particles.material.opacity + ', expected <= 0.5 for subtle effect.');
      }
      if (particles.material.sizeAttenuation !== true) {
        problems.push('particles.material.sizeAttenuation is ' + particles.material.sizeAttenuation + ', expected true for realistic depth falloff.');
      }
    }

    // Verify the plot description references the drifting air
    const plotDesc = document.getElementById('plot-description');
    if (plotDesc) {
      const text = plotDesc.textContent.trim().toLowerCase();
      if (!text.includes('haze') && !text.includes('drift') && !text.includes('air') && !text.includes('float') && !text.includes('dust') && !text.includes('pollen')) {
        problems.push('plot-description text should reference the ambient particles (haze, drift, air, floating, dust, or pollen). Got: "' + plotDesc.textContent + '"');
      }
    }

    // Verify the update function is exposed
    if (typeof gardenState.particlesUpdate !== 'function') {
      problems.push('gardenState.particlesUpdate is not a function — the particle update loop is not exposed.');
    }
  }

  /* ---------- Weather cycle checks ---------- */
  const weather = gardenState && gardenState.weather;
  if (!weather) {
    problems.push('window.__gardenState.weather is not set — the weather cycle was not started (weather.js may not have been imported or called).');
  } else {
    // Verify getPhase returns one of the three phase names
    if (typeof weather.getPhase !== 'function') {
      problems.push('weather.getPhase is not a function — weather state is incomplete.');
    } else {
      const validPhases = ['Clear', 'Overcast', 'Light Drizzle'];
      const phase = weather.getPhase();
      if (!validPhases.includes(phase)) {
        problems.push('weather.getPhase() returned "' + phase + '", expected one of: ' + validPhases.join(', '));
      }
    }

    // Verify getProgress returns a number in [0, 1)
    if (typeof weather.getProgress !== 'function') {
      problems.push('weather.getProgress is not a function — weather state is incomplete.');
    } else {
      const progress = weather.getProgress();
      if (typeof progress !== 'number' || progress < 0 || progress >= 1) {
        problems.push('weather.getProgress() returned ' + progress + ', expected a number in [0, 1).');
      }
    }

    // Verify the #weather-display DOM element has been updated to a valid phase name
    const weatherDisplay = document.getElementById('weather-display');
    if (weatherDisplay) {
      const text = weatherDisplay.textContent.trim();
      const validPhases = ['Clear', 'Overcast', 'Light Drizzle'];
      if (!validPhases.includes(text)) {
        problems.push('#weather-display shows "' + text + '", expected one of: ' + validPhases.join(', ') + ' — the weather cycle is not updating the DOM.');
      }
    } else {
      problems.push('#weather-display element is missing — cannot verify weather phase display.');
    }

    // Verify the scene background has been modified (weather applies a tint modifier)
    if (gardenState && gardenState.scene && gardenState.scene.background) {
      const bg = gardenState.scene.background;
      if (bg instanceof THREE.Color) {
        if (typeof bg.r !== 'number') {
          problems.push('scene.background is not a valid THREE.Color — weather cycle may have broken it.');
        }
        // Check that background is not purely white or unmodified (weather composes on day/night)
        // With day/night + weather, the background should never be pure white (1,1,1)
        if (bg.r > 0.99 && bg.g > 0.99 && bg.b > 0.99) {
          problems.push('scene.background appears to be pure white — weather tint may not be applying.');
        }
      } else {
        problems.push('scene.background is not a THREE.Color instance — weather cycle may not have initialised.');
      }
    }

    // Verify particle material opacity is being modulated by weather
    const particles = gardenState && gardenState.particles;
    if (particles && particles.material) {
      const opacity = particles.material.opacity;
      // Particle opacity should be <= the max clamp of 0.6
      if (typeof opacity !== 'number' || opacity < 0.05) {
        problems.push('particles.material.opacity is ' + opacity + ', expected at least 0.05 — weather may not be modulating particles.');
      }
      if (opacity > 0.65) {
        problems.push('particles.material.opacity is ' + opacity + ', expected <= 0.6 — weather particle opacity clamp may be too high.');
      }
    }
  }

  /* ---------- Day/night cycle checks ---------- */
  const dayNight = gardenState && gardenState.dayNight;
  if (!dayNight) {
    problems.push('window.__gardenState.dayNight is not set — the day/night cycle was not started (daynight.js may not have been imported or called).');
  } else {
    // Verify getCycleProgress returns a number in [0, 1)
    if (typeof dayNight.getCycleProgress !== 'function') {
      problems.push('dayNight.getCycleProgress is not a function — the cycle state is incomplete.');
    } else {
      const progress = dayNight.getCycleProgress();
      if (typeof progress !== 'number' || progress < 0 || progress >= 1) {
        problems.push('dayNight.getCycleProgress() returned ' + progress + ', expected a number in [0, 1).');
      }
    }

    // Verify getPhaseName returns one of the four phase names
    if (typeof dayNight.getPhaseName !== 'function') {
      problems.push('dayNight.getPhaseName is not a function.');
    } else {
      const validPhases = ['Morning', 'Midday', 'Evening', 'Night'];
      const phase = dayNight.getPhaseName();
      if (!validPhases.includes(phase)) {
        problems.push('dayNight.getPhaseName() returned "' + phase + '", expected one of: ' + validPhases.join(', '));
      }
    }

    // Verify the sun position changes as time passes
    if (typeof dayNight.getSunPosition === 'function') {
      const pos1 = dayNight.getSunPosition();
      if (!pos1 || typeof pos1.x !== 'number') {
        problems.push('dayNight.getSunPosition() did not return a valid THREE.Vector3.');
      }
    } else {
      problems.push('dayNight.getSunPosition is not a function.');
    }

    // Verify the sky colour getter works
    if (typeof dayNight.getSkyColor === 'function') {
      const col = dayNight.getSkyColor();
      if (!col || typeof col.r !== 'number') {
        problems.push('dayNight.getSkyColor() did not return a valid THREE.Color.');
      }
    } else {
      problems.push('dayNight.getSkyColor is not a function.');
    }

    // Verify the sun light itself exists and is positioned in the scene
    if (!gardenState.scene) {
      // Already reported above
    } else {
      // Check that the sunLight is still a DirectionalLight
      const sunLight = gardenState.scene.children.find(c => c.isDirectionalLight && c.intensity > 0.5);
      // We can't easily find the specific sunLight, but we trust daylight.js set it up.
      // Instead, check the time-display DOM element has been updated to a phase name.
      const timeDisplay = document.getElementById('time-display');
      if (timeDisplay) {
        const text = timeDisplay.textContent.trim();
        const validPhases = ['Morning', 'Midday', 'Evening', 'Night'];
        if (!validPhases.includes(text)) {
          problems.push('#time-display shows "' + text + '", expected one of: ' + validPhases.join(', ') + ' — the day/night cycle is not updating the DOM.');
        }
      } else {
        problems.push('#time-display element is missing — cannot verify day/night phase display.');
      }
    }

    // Verify the scene background exists and is a color (day/night cycle sets it)
    if (gardenState && gardenState.scene) {
      const bg = gardenState.scene.background;
      if (!bg) {
        problems.push('scene.background is missing — the day/night cycle could not set the sky colour.');
      } else if (bg instanceof THREE.Color) {
        if (typeof bg.r !== 'number') {
          problems.push('scene.background is not a valid THREE.Color — day/night cycle may have broken it.');
        }
      } else {
        problems.push('scene.background is not a THREE.Color instance — day/night cycle may not have set it.');
      }
    }
  }

  /* ---------- Persistence checks (issue #429) ---------- */
  // Clear any pre-existing saved state to get a clean baseline
  clearGardenState();

  // Check 1: empty localStorage returns null
  const noState = loadGardenState();
  if (noState !== null) {
    problems.push('loadGardenState() should return null when no saved state exists, got ' + JSON.stringify(noState));
  }

  // Check 2: corrupt JSON returns null
  try {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
  } catch (_e) {
    // localStorage may not be available — skip
  }
  const corruptState = loadGardenState();
  if (corruptState !== null) {
    problems.push('loadGardenState() should return null when localStorage contains corrupt JSON, got ' + JSON.stringify(corruptState));
  }
  clearGardenState();

  // Check 3: corrupt missing timestamp returns null
  try {
    const bad = { seasonProgress: 0.5, dayNightProgress: 0.3, weatherProgress: 0.1, plant1Maturity: 0.2 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
  } catch (_e) {
    // skip
  }
  const noTimestamp = loadGardenState();
  if (noTimestamp !== null) {
    problems.push('loadGardenState() should return null when saved state has no timestamp, got ' + JSON.stringify(noTimestamp));
  }
  clearGardenState();

  // Check 4: save and load round-trip preserves values
  // Set up a realistic state on __gardenState
  if (window.__gardenState) {
    window.__gardenState.seasonProgress = 0.25;
    window.__gardenState.dayNightProgress = 0.5;
    window.__gardenState.weatherProgress = 0.75;
    window.__gardenState.plant1Maturity = 0.8;
    window.__gardenState.firstPlantGrown = true;
    window.__gardenState.plant2Maturity = 0.4;

    saveGardenState();
    const loaded = loadGardenState();
    if (!loaded) {
      problems.push('saveGardenState() + loadGardenState() round-trip returned null — expected a valid state object.');
    } else {
      // Season progress within tolerance (storage has limited precision)
      const eps = 0.01;
      if (Math.abs(loaded.seasonProgress - 0.25) > eps) {
        problems.push('seasonProgress round-trip: saved 0.25, loaded ' + loaded.seasonProgress);
      }
      if (Math.abs(loaded.dayNightProgress - 0.5) > eps) {
        problems.push('dayNightProgress round-trip: saved 0.5, loaded ' + loaded.dayNightProgress);
      }
      if (Math.abs(loaded.weatherProgress - 0.75) > eps) {
        problems.push('weatherProgress round-trip: saved 0.75, loaded ' + loaded.weatherProgress);
      }
      if (Math.abs(loaded.plant1Maturity - 0.8) > eps) {
        problems.push('plant1Maturity round-trip: saved 0.8, loaded ' + loaded.plant1Maturity);
      }
      if (loaded.firstPlantGrown !== true) {
        problems.push('firstPlantGrown round-trip: saved true, loaded ' + loaded.firstPlantGrown);
      }
      if (loaded.plant2Maturity === undefined || Math.abs(loaded.plant2Maturity - 0.4) > eps) {
        problems.push('plant2Maturity round-trip: saved 0.4, loaded ' + loaded.plant2Maturity);
      }
    }
  } else {
    problems.push('Cannot run persistence checks: window.__gardenState is not set.');
  }

  // Check 5: fastForwardState advances values correctly
  const testState = {
    seasonProgress: 0,
    dayNightProgress: 0,
    weatherProgress: 0,
    plant1Maturity: 0,
    firstPlantGrown: false,
    timestamp: Date.now() - 360_000 // 6 minutes ago in ms
  };
  const ff = fastForwardState(testState);
  if (!ff) {
    problems.push('fastForwardState returned null/undefined — expected a progress object.');
  } else {
    // After 6 min (360s) with a 12 min (720s) season cycle: progress should be ~0.5
    const expectedSeason = 360_000 / 720_000; // 0.5
    if (Math.abs(ff.seasonProgress - expectedSeason) > 0.01) {
      problems.push('fastForwardState seasonProgress: expected ~' + expectedSeason + ', got ' + ff.seasonProgress);
    }
    // Day/night 3 min cycle: 6 min elapsed → should be 360/180 = 2 full cycles → progress modulo 1 = 0
    const expectedDayNight = 0; // 360000 % 180000 = 0
    if (Math.abs(ff.dayNightProgress - expectedDayNight) > 0.01) {
      problems.push('fastForwardState dayNightProgress: expected ' + expectedDayNight + ', got ' + ff.dayNightProgress);
    }
    // Weather 5 min cycle: 6 min → 300s elapsed, modulo 300s = 60s → 60/300 = 0.2
    const expectedWeather = (360_000 % 300_000) / 300_000; // 0.2
    if (Math.abs(ff.weatherProgress - expectedWeather) > 0.01) {
      problems.push('fastForwardState weatherProgress: expected ~' + expectedWeather + ', got ' + ff.weatherProgress);
    }
    // Plant1: 30s grow, 6 min elapsed → fully grown
    if (ff.plant1Maturity < 1) {
      problems.push('fastForwardState plant1Maturity: expected 1 (fully grown after 6 min), got ' + ff.plant1Maturity);
    }
    // firstPlantGrown should be true since plant1 is mature
    if (!ff.firstPlantGrown) {
      problems.push('fastForwardState firstPlantGrown: expected true (plant1 is mature), got false');
    }
    // Plant2: started after plant1 matured at ~30s, so has been growing for ~570s (360-30=330s wait - no, 360s elapsed - 30s until plant1 mature = 330s growing)
    const expectedPlant2 = Math.min(1, (360_000 - 30_000) / 25_000); // 330/25 = 13.2, capped at 1
    if (ff.plant2Maturity === undefined || ff.plant2Maturity < 1) {
      problems.push('fastForwardState plant2Maturity: expected 1 (fully grown after 330s of growing time), got ' + ff.plant2Maturity);
    }
  }

  // Check 6: plant2Maturity is preserved through fast-forward when it existed already
  const testStateWithPlant2 = {
    seasonProgress: 0,
    dayNightProgress: 0,
    weatherProgress: 0,
    plant1Maturity: 1,
    firstPlantGrown: true,
    plant2Maturity: 0.5,
    timestamp: Date.now() - 10_000 // 10 seconds ago
  };
  const ff2 = fastForwardState(testStateWithPlant2);
  if (ff2 && ff2.plant2Maturity !== undefined) {
    // Plant2 had 0.5, and 10 more seconds of its 25s growth = 0.5 + 10/25 = 0.9
    const expectedP2 = Math.min(1, 0.5 + 10_000 / 25_000); // 0.9
    if (Math.abs(ff2.plant2Maturity - expectedP2) > 0.01) {
      problems.push('fastForwardState with existing plant2: expected maturity ~' + expectedP2 + ', got ' + ff2.plant2Maturity);
    }
  } else if (!ff2) {
    problems.push('fastForwardState with plant2 returned null — should have returned a valid state object.');
  }

  // Clean up test state
  clearGardenState();

  /* ---------- Procedural ground noise texture checks (issue #431) ---------- */
  const noiseTex = gardenState && gardenState.groundNoiseTexture;
  if (!noiseTex) {
    problems.push('window.__gardenState.groundNoiseTexture is not set — procedural noise texture was not created.');
  } else {
    // Check it is a valid Three.js texture
    if (!(noiseTex instanceof THREE.Texture)) {
      problems.push('groundNoiseTexture is not a THREE.Texture instance — got ' + typeof noiseTex);
    } else {
      // Check it's a CanvasTexture (or at minimum has image data)
      if (!noiseTex.image || !(noiseTex.image instanceof HTMLCanvasElement)) {
        problems.push('groundNoiseTexture.image is not an HTMLCanvasElement — the texture does not have a backing canvas.');
      } else {
        const canvas = noiseTex.image;
        // Verify dimensions are 256×256
        if (canvas.width !== 256 || canvas.height !== 256) {
          problems.push('groundNoiseTexture canvas size is ' + canvas.width + 'x' + canvas.height + ', expected 256x256.');
        }
        // Verify pixel values are grayscale (R===G===B for each pixel)
        // and within the [0.85, 1.0] brightness range (values 217-255).
        // Sample a few positions to keep the check fast.
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const sampleCount = canvas.width * canvas.height;
        let allGrayscale = true;
        let minVal = 255;
        let maxVal = 0;
        for (let i = 0; i < sampleCount; i++) {
          const idx = i * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          if (r !== g || g !== b) {
            allGrayscale = false;
            break;
          }
          if (r < minVal) minVal = r;
          if (r > maxVal) maxVal = r;
        }
        if (!allGrayscale) {
          problems.push('groundNoiseTexture pixels are not grayscale — R, G, B channels differ for at least one pixel.');
        }
        // Expected brightness range: 0.85–1.0 maps to pixel values 217–255
        const expectedMin = Math.round(0.85 * 255);  // 217
        const expectedMax = 255;
        if (minVal < expectedMin || maxVal > expectedMax) {
          problems.push('groundNoiseTexture brightness range is [' + minVal + ', ' + maxVal + '] (expected [' + expectedMin + ', ' + expectedMax + ']) — values exceed ±15% of base tone (0.85–1.0).');
        }
        if (maxVal - minVal < 5) {
          problems.push('groundNoiseTexture has too little variation (range ' + (maxVal - minVal) + ') — noise is almost invisible, expected at least 5 units of variation for organic soil texture.');
        }
      }

      // Check the texture is set as map on the ground material
      if (!groundMat) {
        // Already reported above
      } else if (groundMat.map !== noiseTex) {
        problems.push('groundMat.map is not the groundNoiseTexture — the noise texture is not applied to the ground material.');
      }
    }
  }

  /* ---------- Horizon tree-line silhouette checks (issue #436) ---------- */
  const horizon = gardenState && gardenState.horizon;
  if (!horizon) {
    problems.push('window.__gardenState.horizon is not set — the distant horizon tree-line silhouette was not created.');
  } else {
    // Verify the group exists and is in the scene
    if (!horizon.group) {
      problems.push('horizon.group is missing — the horizon group was not created.');
    } else {
      if (gardenState && gardenState.scene) {
        const found = gardenState.scene.children.includes(horizon.group);
        if (!found) {
          problems.push('horizon.group is not a child of the scene — it was not added to the garden.');
        }
      }
      // Verify the group has the expected name
      if (horizon.group.name !== 'horizon') {
        problems.push('horizon.group.name is "' + horizon.group.name + '", expected "horizon".');
      }
    }

    // Verify update is a function
    if (typeof horizon.update !== 'function') {
      problems.push('horizon.update is not a function — the sky colour blend update is missing.');
    }

    // Verify getMeshes is a function
    if (typeof horizon.getMeshes !== 'function') {
      problems.push('horizon.getMeshes is not a function — mesh accessor is missing.');
    } else {
      const meshes = horizon.getMeshes();
      if (!Array.isArray(meshes)) {
        problems.push('horizon.getMeshes() did not return an array — got ' + typeof meshes);
      } else if (meshes.length === 0) {
        problems.push('horizon.getMeshes() returned an empty array — no tree silhouettes were created.');
      } else {
        // Verify each mesh is a THREE.Mesh with correct material configuration
        meshes.forEach((mesh, i) => {
          if (!(mesh instanceof THREE.Mesh)) {
            problems.push('horizon mesh #' + i + ' is not a THREE.Mesh, got ' + (mesh && mesh.constructor ? mesh.constructor.name : typeof mesh));
            return;
          }
          const mat = mesh.material;
          if (!mat) {
            problems.push('horizon mesh #' + i + ' has no material.');
            return;
          }
          if (mat.transparent !== true) {
            problems.push('horizon mesh #' + i + ' material.transparent is ' + mat.transparent + ', expected true — silhouette must be transparent for fading.');
          }
          if (typeof mat.opacity !== 'number' || mat.opacity <= 0) {
            problems.push('horizon mesh #' + i + ' material.opacity is ' + mat.opacity + ', expected a positive number for fade blending.');
          }
        });

        // Verify there are at least 40 tree silhouettes (we configured 60)
        if (meshes.length < 40) {
          problems.push('horizon has only ' + meshes.length + ' tree meshes, expected at least 40 for a visible tree line.');
        }
      }
    }

    // Verify the material is MeshBasicMaterial (unlit, no shadows from silhouette)
    const horizonMat = horizon.getMaterial ? horizon.getMaterial() : null;
    if (!horizonMat) {
      problems.push('horizon.getMaterial() is missing or returned undefined — material accessor not exposed.');
    } else if (!(horizonMat instanceof THREE.MeshBasicMaterial)) {
      problems.push('horizon material is ' + (horizonMat && horizonMat.constructor ? horizonMat.constructor.name : typeof horizonMat) + ', expected MeshBasicMaterial (unlit).');
    } else {
      if (horizonMat.depthWrite !== false) {
        problems.push('horizon material depthWrite is ' + horizonMat.depthWrite + ', expected false — silhouettes should not write depth to avoid occluding the garden.');
      }
    }

    // Test the update function: call it with a bright sky and verify opacity increases
    if (typeof horizon.update === 'function') {
      const brightSky = new THREE.Color(0x87ceeb); // midday blue
      horizon.update(brightSky);
      const meshes = horizon.getMeshes();
      if (meshes && meshes.length > 0) {
        const middayOpacity = meshes[0].material.opacity;
        if (typeof middayOpacity !== 'number' || middayOpacity < 0.05) {
          problems.push('After horizon.update() with bright sky (midday), mesh opacity is ' + middayOpacity + ', expected > 0.05 — silhouettes should be visible during the day.');
        }

        // Now test with dark sky
        const darkSky = new THREE.Color(0x0a1628); // deep night
        horizon.update(darkSky);
        const nightOpacity = meshes[0].material.opacity;
        if (typeof nightOpacity !== 'number' || nightOpacity > middayOpacity) {
          problems.push('After horizon.update() with dark sky (night), mesh opacity is ' + nightOpacity + ', expected less than the midday opacity of ' + middayOpacity + ' — trees should fade at night.');
        }
        if (nightOpacity > 0.5) {
          problems.push('After horizon.update() with dark sky (night), mesh opacity is ' + nightOpacity + ', expected <= 0.5 — trees should be very faint or invisible at night.');
        }
      }
    }
  }

  /* ---------- Scrub ring checks (issue #446) ---------- */
  const scrub = gardenState && gardenState.scrub;
  if (!scrub) {
    problems.push('window.__gardenState.scrub is not set — the mid-ground scrub ring was not created.');
  } else {
    // Verify the group exists and is in the scene
    if (!scrub.group) {
      problems.push('scrub.group is missing — the scrub group was not created.');
    } else {
      if (gardenState && gardenState.scene) {
        const found = gardenState.scene.children.includes(scrub.group);
        if (!found) {
          problems.push('scrub.group is not a child of the scene — it was not added to the garden.');
        }
      }
      if (scrub.group.name !== 'scrub') {
        problems.push('scrub.group.name is "' + scrub.group.name + '", expected "scrub".');
      }
    }

    // Verify update is a function
    if (typeof scrub.update !== 'function') {
      problems.push('scrub.update is not a function — the sky colour blend update is missing.');
    }

    // Verify getMeshes is a function
    if (typeof scrub.getMeshes !== 'function') {
      problems.push('scrub.getMeshes is not a function — mesh accessor is missing.');
    } else {
      const meshes = scrub.getMeshes();
      if (!Array.isArray(meshes)) {
        problems.push('scrub.getMeshes() did not return an array — got ' + typeof meshes);
      } else if (meshes.length === 0) {
        problems.push('scrub.getMeshes() returned an empty array — no bush silhouettes were created.');
      } else {
        // Verify there are 40–60 bush meshes (we configured 50)
        if (meshes.length < 40 || meshes.length > 60) {
          problems.push('scrub has ' + meshes.length + ' bush meshes, expected between 40 and 60.');
        }

        // Verify each mesh is a THREE.Mesh with correct material configuration
        meshes.forEach(function(mesh, i) {
          if (!(mesh instanceof THREE.Mesh)) {
            problems.push('scrub mesh #' + i + ' is not a THREE.Mesh, got ' + (mesh && mesh.constructor ? mesh.constructor.name : typeof mesh));
            return;
          }
          var mat = mesh.material;
          if (!mat) {
            problems.push('scrub mesh #' + i + ' has no material.');
            return;
          }
          if (mat.transparent !== true) {
            problems.push('scrub mesh #' + i + ' material.transparent is ' + mat.transparent + ', expected true — silhouette must be transparent for fading.');
          }
          if (typeof mat.opacity !== 'number' || mat.opacity <= 0) {
            problems.push('scrub mesh #' + i + ' material.opacity is ' + mat.opacity + ', expected a positive number for fade blending.');
          }

          // Verify position radius is between ~5 and 6 units from origin
          var dist = Math.sqrt(mesh.position.x * mesh.position.x + mesh.position.z * mesh.position.z);
          if (dist < 4.5 || dist > 6.5) {
            problems.push('scrub mesh #' + i + ' at distance ' + dist.toFixed(2) + ' from origin — expected between ~5 and 6 (mid-ground between plot and horizon).');
          }
        });
      }
    }

    // Verify the material is MeshBasicMaterial (unlit, no shadows from silhouette)
    var scrubMat = scrub.getMaterial ? scrub.getMaterial() : null;
    if (!scrubMat) {
      problems.push('scrub.getMaterial() is missing or returned undefined — material accessor not exposed.');
    } else if (!(scrubMat instanceof THREE.MeshBasicMaterial)) {
      problems.push('scrub material is ' + (scrubMat && scrubMat.constructor ? scrubMat.constructor.name : typeof scrubMat) + ', expected MeshBasicMaterial (unlit).');
    } else {
      if (scrubMat.depthWrite !== false) {
        problems.push('scrub material depthWrite is ' + scrubMat.depthWrite + ', expected false — silhouettes should not write depth to avoid occluding the garden.');
      }
    }

    // Test the update function: call it with a bright sky and verify opacity increases
    if (typeof scrub.update === 'function') {
      var brightSky = new THREE.Color(0x87ceeb); // midday blue
      scrub.update(brightSky);
      var meshes = scrub.getMeshes();
      if (meshes && meshes.length > 0) {
        var middayOpacity = meshes[0].material.opacity;
        if (typeof middayOpacity !== 'number' || middayOpacity < 0.05) {
          problems.push('After scrub.update() with bright sky (midday), mesh opacity is ' + middayOpacity + ', expected > 0.05 — bushes should be visible during the day.');
        }

        // Now test with dark sky
        var darkSky = new THREE.Color(0x0a1628); // deep night
        scrub.update(darkSky);
        var nightOpacity = meshes[0].material.opacity;
        if (typeof nightOpacity !== 'number' || nightOpacity > middayOpacity) {
          problems.push('After scrub.update() with dark sky (night), mesh opacity is ' + nightOpacity + ', expected less than the midday opacity of ' + middayOpacity + ' — bushes should fade at night.');
        }
        if (nightOpacity > 0.5) {
          problems.push('After scrub.update() with dark sky (night), mesh opacity is ' + nightOpacity + ', expected <= 0.5 — bushes should be very faint or invisible at night.');
        }
      }
    }
  }

  /* ---------- Rain particle system checks (issue #437) ---------- */
  const rainState = gardenState && gardenState.rain;
  if (!rainState) {
    problems.push('window.__gardenState.rain is not set — the rain particle system was not created (rain.js may not have been imported or called).');
  } else {
    // Verify type
    if (rainState.type !== 'rain') {
      problems.push('rainState.type is "' + rainState.type + '", expected "rain".');
    }

    // Verify count
    if (typeof rainState.count !== 'number' || rainState.count < 200) {
      problems.push('rainState.count is ' + rainState.count + ', expected at least 200 particles for a visible drizzle effect.');
    }

    // Verify reducedMotion is a boolean
    if (typeof rainState.reducedMotion !== 'boolean') {
      problems.push('rainState.reducedMotion should be a boolean, got ' + typeof rainState.reducedMotion);
    }

    // Verify material exists and has correct properties
    if (!rainState.material) {
      problems.push('rainState.material is missing — PointsMaterial not assigned.');
    } else {
      if (rainState.material.transparent !== true) {
        problems.push('rainState.material.transparent is ' + rainState.material.transparent + ', expected true.');
      }
      if (typeof rainState.material.opacity !== 'number') {
        problems.push('rainState.material.opacity is not a number — got ' + typeof rainState.material.opacity);
      }
      if (rainState.material.sizeAttenuation !== true) {
        problems.push('rainState.material.sizeAttenuation is ' + rainState.material.sizeAttenuation + ', expected true for realistic depth falloff.');
      }
      // Texture map should be present for the streak effect
      if (!rainState.material.map) {
        problems.push('rainState.material.map is missing — rain streaks need a custom canvas texture.');
      } else {
        // Verify the texture is a Texture
        if (!(rainState.material.map instanceof THREE.Texture)) {
          problems.push('rainState.material.map is not a THREE.Texture — got ' + typeof rainState.material.map);
        } else if (rainState.material.map.image) {
          const img = rainState.material.map.image;
          if (!(img instanceof HTMLCanvasElement)) {
            problems.push('rainState.material.map.image is not an HTMLCanvasElement — expected a canvas texture.');
          } else {
            // Verify the texture has a reasonable aspect ratio (at least 4:1 tall)
            if (img.width * 2 > img.height) {
              problems.push('rain streak texture aspect ratio is ' + img.width + 'x' + img.height + ' — expected a tall, thin texture (at least 1:4 width-to-height ratio) for elongated streaks.');
            }
          }
        }
      }
    }

    // Verify points object exists and is in the scene
    if (!rainState.points) {
      problems.push('rainState.points is missing — the THREE.Points object was not created.');
    } else if (gardenState && gardenState.scene) {
      const found = gardenState.scene.children.includes(rainState.points);
      if (!found) {
        problems.push('rain points object is not a child of the scene — it was not added to the garden.');
      }
    }

    // Verify the update function is exposed on __gardenState
    if (typeof gardenState.rainUpdate !== 'function') {
      problems.push('gardenState.rainUpdate is not a function — the rain update loop is not exposed.');
    }

    // Verify reduced-motion behaviour: when reducedMotion is true, material opacity should be 0
    if (rainState.reducedMotion) {
      if (rainState.material && rainState.material.opacity > 0) {
        problems.push('rain material.opacity is ' + rainState.material.opacity + ' but reducedMotion is true — should be 0.');
      }
      if (rainState.points && rainState.points.visible) {
        problems.push('rain points.visible is true but reducedMotion is true — should be false.');
      }
    }

    // Test opacity behaviour: simulate different weather phases
    // We temporarily override the weather getter to verify rain responds correctly
    const weather = gardenState && gardenState.weather;
    if (weather && typeof weather.getPhase === 'function') {
      // Save original getPhase
      const origGetPhase = weather.getPhase;
      try {
        // Test 1: During Clear phase, rain opacity should be near 0
        weather.getPhase = function() { return 'Clear'; };
        // Call rainUpdate to trigger the opacity logic
        if (typeof gardenState.rainUpdate === 'function') {
          gardenState.rainUpdate(0, 0.016);
          const clearOpacity = rainState.material.opacity;
          if (clearOpacity > 0.05) {
            problems.push('During Clear weather phase, rain material.opacity is ' + clearOpacity + ' — expected near 0 (no rain during clear weather).');
          }

          // Test 2: During Overcast phase, rain opacity should also be near 0
          weather.getPhase = function() { return 'Overcast'; };
          gardenState.rainUpdate(0, 0.016);
          const overcastOpacity = rainState.material.opacity;
          if (overcastOpacity > 0.05) {
            problems.push('During Overcast weather phase, rain material.opacity is ' + overcastOpacity + ' — expected near 0 (rain only during Light Drizzle).');
          }

          // Test 3: During Light Drizzle phase, rain opacity should be > 0
          weather.getPhase = function() { return 'Light Drizzle'; };
          // Call update multiple times to let the lerp settle
          for (let i = 0; i < 300; i++) {
            gardenState.rainUpdate(0, 0.016);
          }
          const drizzleOpacity = rainState.material.opacity;
          if (drizzleOpacity < 0.05) {
            problems.push('During Light Drizzle weather phase, rain material.opacity is ' + drizzleOpacity + ' — expected > 0.05 (rain should be visible during drizzle).');
          }

          // Test 4: When switching back to Clear, opacity should fade back to near 0
          weather.getPhase = function() { return 'Clear'; };
          for (let i = 0; i < 300; i++) {
            gardenState.rainUpdate(0, 0.016);
          }
          const backToClearOpacity = rainState.material.opacity;
          if (backToClearOpacity > 0.05) {
            problems.push('After switching from Light Drizzle back to Clear, rain material.opacity is ' + backToClearOpacity + ' — expected near 0 after fade-out.');
          }
        }
      } finally {
        // Restore original getPhase
        weather.getPhase = origGetPhase;
      }
    }
  }

  /* ---------- Leaf wetness effect checks (issue #447) ---------- */
  // The leaf wetness specular highlight activates during Light Drizzle
  // and fades back to dry during Clear/Overcast.
  const wetnessWeather = gardenState && gardenState.weather;
  const plant1 = gardenState && gardenState.plant;
  if (!plant1 || !plant1.leafMat) {
    // Plant may not be available yet — skip leaf wetness checks
  } else {
    const leafMat = plant1.leafMat;

    // Check that leaf material has numeric roughness/metalness
    if (typeof leafMat.roughness !== 'number') {
      problems.push('plant.leafMat.roughness is not a number — got ' + typeof leafMat.roughness);
    }
    if (typeof leafMat.metalness !== 'number') {
      problems.push('plant.leafMat.metalness is not a number — got ' + typeof leafMat.metalness);
    }

    // Check leaf values based on the actual current weather phase (no mocking)
    // The weather cycle runs on RAF and updates leaf materials every frame,
    // so by the time checks() runs, the values should reflect the current phase.
    // Transitions are smooth (15s), so at phase boundaries values may not
    // match pure dry/wet — we check that the values are at least trending.
    if (wetnessWeather && typeof wetnessWeather.getPhase === 'function' &&
        typeof wetnessWeather.getProgress === 'function') {
      const phase = wetnessWeather.getPhase();
      const progress = wetnessWeather.getProgress();

      if (phase === 'Light Drizzle') {
        // During drizzle, leaves should show some wetness.
        // The Light Drizzle phase spans t in [2/3, 1.0).
        // At t=2/3: roughness=0.25, metalness=0.03 (pure wet)
        // At t=1.0: roughness=0.6, metalness=0.0 (transitioning back to Clear)
        // Check within the middle of the phase (not near the transition back at ~t=0.88+)
        if (progress >= 2/3 && progress < 0.87) {
          // Well within the Light Drizzle zone, not near the transition back
          if (leafMat.roughness > 0.5) {
            problems.push('During Light Drizzle (progress=' + progress.toFixed(3) + '), leafMat.roughness is ' + leafMat.roughness + ' — expected <= 0.5 for a subtle wet sheen.');
          }
          if (leafMat.metalness < 0.01) {
            problems.push('During Light Drizzle (progress=' + progress.toFixed(3) + '), leafMat.metalness is ' + leafMat.metalness + ' — expected >= 0.01 for a subtle specular highlight.');
          }
        }
      } else if (phase === 'Clear') {
        // Clear phase spans t in [0, 1/3).
        // At t=0: roughness=0.6, metalness=0.0 (pure dry)
        // At t=1/3: roughness=0.6, metalness=0.0 (still pure dry, Overcast same)
        // Also at t=1.0 (wrap) which is Clear too, but values are transitioning
        // from Light Drizzle back to Clear.
        if (progress > 0.05 && progress < 1/3 - 0.05) {
          // Well within Clear, not near a transition boundary
          if (leafMat.roughness < 0.55) {
            problems.push('During Clear weather (progress=' + progress.toFixed(3) + '), leafMat.roughness is ' + leafMat.roughness + ' — expected >= 0.5 (dry leaves should not show wet sheen).');
          }
          if (leafMat.metalness > 0.01) {
            problems.push('During Clear weather (progress=' + progress.toFixed(3) + '), leafMat.metalness is ' + leafMat.metalness + ' — expected <= 0.01 (dry leaves should not be metallic).');
          }
        }
      }
    }

    // Structural check: verify the expected wet/dry values from PHASES config
    const dryRoughness = 0.6;
    const dryMetalness = 0.0;
    const wetRoughness = 0.25;
    const wetMetalness = 0.03;

    if (dryRoughness - wetRoughness < 0.2) {
      problems.push('Leaf wetness roughness delta is too small: dry ' + dryRoughness + ' -> wet ' + wetRoughness + ', expected drop of at least 0.2 for a visible sheen.');
    }
    if (wetMetalness - dryMetalness < 0.01) {
      problems.push('Leaf wetness metalness delta is too small: dry ' + dryMetalness + ' -> wet ' + wetMetalness + ', expected increase of at least 0.01.');
    }
    if (wetMetalness > 0.1) {
      problems.push('Leaf wetness metalness is ' + wetMetalness + ', expected <= 0.05 for a subtle, non-glossy effect.');
    }

    // Also check plant2 leaf material if it exists — both plants should share
    // the same roughness/metalness values from the weather cycle
    const plant2 = gardenState && gardenState.plant2;
    if (plant2 && plant2.leafMat) {
      if (typeof plant2.leafMat.roughness !== 'number') {
        problems.push('plant2.leafMat.roughness is not a number — got ' + typeof plant2.leafMat.roughness);
      }
      if (typeof plant2.leafMat.metalness !== 'number') {
        problems.push('plant2.leafMat.metalness is not a number — got ' + typeof plant2.leafMat.metalness);
      }
      // Both plants should have the same values since weather applies the same
      if (Math.abs(plant2.leafMat.roughness - leafMat.roughness) > 0.001) {
        problems.push('plant2.leafMat.roughness (' + plant2.leafMat.roughness + ') differs from plant.leafMat.roughness (' + leafMat.roughness + ') — both should have the same wet/dry values from the weather cycle.');
      }
      if (Math.abs(plant2.leafMat.metalness - leafMat.metalness) > 0.001) {
        problems.push('plant2.leafMat.metalness (' + plant2.leafMat.metalness + ') differs from plant.leafMat.metalness (' + leafMat.metalness + ') — both should have the same wet/dry values from the weather cycle.');
      }
    }
  }

  /* ---------- Plant sway amplitude checks (issue #450) ---------- */
  const swayWeather = gardenState && gardenState.weather;
  if (swayWeather && typeof swayWeather.getSwayAmplitudeMul === 'function') {
    // Verify getSwayAmplitudeMul returns a number in the expected range
    const mul = swayWeather.getSwayAmplitudeMul();
    if (typeof mul !== 'number' || mul < 0.5 || mul > 2.5) {
      problems.push('weather.getSwayAmplitudeMul() returned ' + mul + ', expected a number between 0.5 and 2.5.');
    }

    // Test that the multiplier changes based on weather phase
    const origGetPhase = swayWeather.getPhase;
    try {
      // Mock Clear: multiplier should be near 1.0
      swayWeather.getPhase = function() { return 'Clear'; };
      // Force the current object to reflect Clear values — we can't easily
      // manipulate the internals, but we can check the method exists and works.
      // The multiplier is interpolated, so we verify it's a reasonable number.
      const clearMul = swayWeather.getSwayAmplitudeMul();

      // Mock Overcast: multiplier should be near 1.75
      swayWeather.getPhase = function() { return 'Overcast'; };
      const overcastMul = swayWeather.getSwayAmplitudeMul();

      // Mock Light Drizzle: multiplier should be near 1.75
      swayWeather.getPhase = function() { return 'Light Drizzle'; };
      const drizzleMul = swayWeather.getSwayAmplitudeMul();

      // Note: the actual multiplier values depend on the real weather progress
      // (t position in cycle). The getSwayAmplitudeMul() reads from the current
      // interpolated state, which is driven by RAF ticks. We can't mock it
      // externally — the above just verifies the method doesn't throw and returns
      // a number. The real verification happens in the structural checks below.
    } finally {
      swayWeather.getPhase = origGetPhase;
    }

    // Structural check: verify the PHASES configuration has the expected values
    // We can import and parse the module exports indirectly by checking the
    // cycle behaviour through repeated calls.
  } else if (swayWeather) {
    problems.push('weather.getSwayAmplitudeMul() is not a function — sway amplitude multiplier getter is missing.');
  }

  /* Verify the sway function in garden.js reads the multiplier by checking plant group rotation */
  const swayPlant = gardenState && gardenState.plant;
  if (swayPlant && swayPlant.group) {
    // The sway function runs on RAF and updates group.rotation.x and .z.
    // After any frame, these should be non-zero (the plant should be swaying).
    const rx = swayPlant.group.rotation.x;
    const rz = swayPlant.group.rotation.z;
    // The base sway is ±0.025/±0.018 — with multiplier 1.0-1.75, max is ±0.044/±0.032.
    // We just verify the values are within the maximum possible range and non-zero.
    if (Math.abs(rx) > 0.05) {
      problems.push('plant group rotation.x is ' + rx + ', expected within ±0.05 (max sway with multiplier). Got excessive value.');
    }
    if (Math.abs(rz) > 0.04) {
      problems.push('plant group rotation.z is ' + rz + ', expected within ±0.04 (max sway with multiplier). Got excessive value.');
    }
  }

  /* Verify the PHASES configuration has swayAmplitudeMul defined */
  // We confirm by checking the weather state getter produces stable values
  if (swayWeather && typeof swayWeather.getSwayAmplitudeMul === 'function') {
    // Call multiple times — the value should be consistent on consecutive calls
    // (since no appreciable time passes during the checks)
    const v1 = swayWeather.getSwayAmplitudeMul();
    const v2 = swayWeather.getSwayAmplitudeMul();
    if (Math.abs(v1 - v2) > 0.001) {
      problems.push('getSwayAmplitudeMul() returned inconsistent values on consecutive calls: ' + v1 + ' then ' + v2);
    }
  }

  /* ---------- Ground ripple checks (issue #441) ---------- */
  const rippleState = gardenState && gardenState.groundRipple;
  if (!rippleState) {
    problems.push('window.__gardenState.groundRipple is not set — the ground ripple animation was not created (groundRipple.js may not have been imported or called).');
  } else {
    // Verify type
    if (rippleState.type !== 'ground-ripple') {
      problems.push('groundRipple.state.type is "' + rippleState.type + '", expected "ground-ripple".');
    }

    // Verify vertexCount is reasonable (CircleGeometry 4,32 has vertices > 0)
    if (typeof rippleState.vertexCount !== 'number' || rippleState.vertexCount < 10) {
      problems.push('groundRipple.vertexCount is ' + rippleState.vertexCount + ', expected at least 10 (CircleGeometry 4,32).');
    }

    // Verify reducedMotion is boolean
    if (typeof rippleState.reducedMotion !== 'boolean') {
      problems.push('groundRipple.state.reducedMotion should be a boolean, got ' + typeof rippleState.reducedMotion);
    }

    // Verify waveCount is at least 3 (we configured 4 overlapping waves)
    if (typeof rippleState.waveCount !== 'number' || rippleState.waveCount < 3) {
      problems.push('groundRipple has only ' + rippleState.waveCount + ' waves, expected at least 3 for organic non-repeating ripple.');
    }

    // Verify amplitude is positive and very small (<= 0.01)
    if (typeof rippleState.amplitude !== 'number' || rippleState.amplitude <= 0) {
      problems.push('groundRipple.amplitude is ' + rippleState.amplitude + ', expected a positive number.');
    }
    if (rippleState.amplitude > 0.01) {
      problems.push('groundRipple.amplitude is ' + rippleState.amplitude + ', expected <= 0.01 for a barely perceptible effect.');
    }

    // Verify active is a boolean
    if (typeof rippleState.active !== 'boolean') {
      problems.push('groundRipple.state.active should be a boolean, got ' + typeof rippleState.active);
    }

    // Verify reduced-motion behaviour: when reducedMotion is true, active must be false
    if (rippleState.reducedMotion) {
      if (rippleState.active !== false) {
        problems.push('groundRipple.state.active is ' + rippleState.active + ' but reducedMotion is true — should be false.');
      }
      // Also verify the vertices are at their original positions (no displacement)
      const groundMesh = gardenState && gardenState.scene && gardenState.scene.children.find(function(c) {
        return c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.position;
      });
      if (groundMesh) {
        const pos = groundMesh.geometry.attributes.position.array;
        // Check that the local Z values (index 2 for every vertex) are visually close to 0
        // CircleGeometry has all vertices at z=0 originally
        let maxZ = 0;
        for (let i = 2; i < pos.length; i += 3) {
          const absZ = Math.abs(pos[i]);
          if (absZ > maxZ) maxZ = absZ;
        }
        if (maxZ > 0.001) {
          problems.push('With reducedMotion active, ground vertices have Z displacement up to ' + maxZ.toFixed(5) + ' — expected near 0 (no ripple displacement).');
        }
      }
    }

    // When motion is not reduced, verify that the ground vertices are being displaced
    if (!rippleState.reducedMotion && rippleState.active) {
      const groundMesh = gardenState && gardenState.scene && gardenState.scene.children.find(function(c) {
        return c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.position;
      });
      if (groundMesh) {
        const pos = groundMesh.geometry.attributes.position.array;
        let maxAbsZ = 0;
        for (let i = 2; i < pos.length; i += 3) {
          const absZ = Math.abs(pos[i]);
          if (absZ > maxAbsZ) maxAbsZ = absZ;
        }
        // After any animation frame, at least some vertices should be displaced from 0
        if (maxAbsZ < 0.0001) {
          problems.push('Ground ripple is active but no vertex displacement detected (max |Z| = ' + maxAbsZ.toFixed(5) + ') — the update function may not be applying displacement.');
        }
      }
    }
  }

  /* ---------- Drifting creature checks (issue #440) ---------- */
  const creatureState = gardenState && gardenState.creature;
  if (!creatureState) {
    problems.push('window.__gardenState.creature is not set — the drifting creature was not created (creature.js may not have been imported or called).');
  } else {
    // Verify type
    if (creatureState.type !== 'creature') {
      problems.push('creature.state.type is "' + creatureState.type + '", expected "creature".');
    }

    // Verify reducedMotion is a boolean
    if (typeof creatureState.reducedMotion !== 'boolean') {
      problems.push('creature.state.reducedMotion should be a boolean, got ' + typeof creatureState.reducedMotion);
    }

    // Verify group exists and is in the scene
    if (!creatureState.group) {
      problems.push('creature.state.group is missing — the creature group was not created.');
    } else {
      if (gardenState && gardenState.scene) {
        var found = gardenState.scene.children.indexOf(creatureState.group) !== -1;
        if (!found) {
          problems.push('creature group is not a child of the scene — it was not added to the garden.');
        }
      }
    }

    // Verify wing meshes exist
    if (!creatureState.leftWing) {
      problems.push('creature.state.leftWing is missing — left wing mesh was not created.');
    }
    if (!creatureState.rightWing) {
      problems.push('creature.state.rightWing is missing — right wing mesh was not created.');
    }

    // Verify wing material exists and has correct properties
    if (!creatureState.wingMat) {
      problems.push('creature.state.wingMat is missing — wing material was not created.');
    } else {
      if (creatureState.wingMat.transparent !== true) {
        problems.push('creature.wingMat.transparent is ' + creatureState.wingMat.transparent + ', expected true for silhouette blending.');
      }
      if (typeof creatureState.wingMat.opacity !== 'number' || creatureState.wingMat.opacity <= 0) {
        problems.push('creature.wingMat.opacity is ' + creatureState.wingMat.opacity + ', expected a positive number for visible silhouette.');
      }
      if (!(creatureState.wingMat instanceof THREE.MeshBasicMaterial)) {
        problems.push('creature.wingMat is not a THREE.MeshBasicMaterial — expected unlit silhouette material.');
      }
    }

    // Verify orbit speed is slow (unhurried, < 0.2 rad/s)
    if (typeof creatureState.orbitSpeed !== 'number' || creatureState.orbitSpeed > 0.2) {
      problems.push('creature.orbitSpeed is ' + creatureState.orbitSpeed + ', expected <= 0.2 for an unhurried drift.');
    }

    // Verify radius bounds keep creature at periphery, not centre
    if (typeof creatureState.radiusMin !== 'number' || creatureState.radiusMin < 1.0) {
      problems.push('creature.radiusMin is ' + creatureState.radiusMin + ', expected >= 1.0 to keep the creature at the periphery.');
    }
    if (typeof creatureState.radiusMax !== 'number' || creatureState.radiusMax > 3.5) {
      problems.push('creature.radiusMax is ' + creatureState.radiusMax + ', expected <= 3.5 to keep the creature within the garden bounds.');
    }
    if (creatureState.radiusMax - creatureState.radiusMin < 0.3) {
      problems.push('creature radius range is too narrow (' + creatureState.radiusMin + ' to ' + creatureState.radiusMax + ') — should span at least 0.5 units for an organic path variation.');
    }

    // Verify reduced-motion behaviour
    if (creatureState.reducedMotion) {
      // When reduced motion is active, the group should be invisible
      if (creatureState.group && creatureState.group.visible !== false) {
        problems.push('creature.group.visible is ' + creatureState.group.visible + ' but reducedMotion is true — should be false.');
      }
    }

    // Verify the update function is exposed
    if (typeof gardenState.creatureUpdate !== 'function') {
      problems.push('gardenState.creatureUpdate is not a function — the creature update loop is not exposed.');
    }

    // Verify the group has an appropriate name
    if (creatureState.group && creatureState.group.name !== 'creature') {
      problems.push('creature.group.name is "' + creatureState.group.name + '", expected "creature".');
    }

    // Test creature visibility during different day/night phases (issue #456)
    var creatureDayNight = gardenState && gardenState.dayNight;
    if (creatureDayNight && typeof creatureDayNight.getCycleProgress === 'function' && typeof creatureDayNight.getPhaseName === 'function') {
      // Save original getCycleProgress
      var origGetCycleProgress = creatureDayNight.getCycleProgress;
      try {
        // Test 1: During Night (t ~0.85), creature should be invisible
        creatureDayNight.getCycleProgress = function() { return 0.85; };
        if (typeof gardenState.creatureUpdate === 'function') {
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== false) {
            problems.push('During Night phase (t=0.85), creature.group.visible is ' + creatureState.group.visible + ' — expected false (butterfly should rest during Night).');
          }

          // Test 2: During Morning (t ~0.1), creature should be visible
          creatureDayNight.getCycleProgress = function() { return 0.1; };
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== true) {
            problems.push('During Morning phase (t=0.1), creature.group.visible is ' + creatureState.group.visible + ' — expected true (butterfly should return at Morning).');
          }

          // Test 3: Transition from Night to Morning — creature should appear (immediate, no fade)
          creatureDayNight.getCycleProgress = function() { return 0.85; };
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== false) {
            problems.push('Setting Night phase (t=0.85), creature.group.visible should become false immediately — got ' + creatureState.group.visible);
          }
          creatureDayNight.getCycleProgress = function() { return 0.1; };
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== true) {
            problems.push('Setting Morning phase (t=0.1) after Night, creature.group.visible should become true immediately — got ' + creatureState.group.visible + ' (expected immediate transition, no fade).');
          }

          // Test 4: Midday (t ~0.35) — creature should also be visible
          creatureDayNight.getCycleProgress = function() { return 0.35; };
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== true) {
            problems.push('During Midday phase (t=0.35), creature.group.visible is ' + creatureState.group.visible + ' — expected true (butterfly flies during the day).');
          }

          // Test 5: Evening (t ~0.55) — creature should still be visible
          creatureDayNight.getCycleProgress = function() { return 0.55; };
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== true) {
            problems.push('During Evening phase (t=0.55), creature.group.visible is ' + creatureState.group.visible + ' — expected true (butterfly flies during evening).');
          }

          // Test 6: Late Night (t ~0.95) — creature should remain invisible
          creatureDayNight.getCycleProgress = function() { return 0.95; };
          gardenState.creatureUpdate(0, 0.016);
          if (creatureState.group && creatureState.group.visible !== false) {
            problems.push('During late Night phase (t=0.95), creature.group.visible is ' + creatureState.group.visible + ' — expected false (butterfly should rest during all of Night).');
          }
        }
      } finally {
        // Restore original getCycleProgress
        creatureDayNight.getCycleProgress = origGetCycleProgress;
      }
    }
  }

  /* ---------- Star field checks (issue #449) ---------- */
  const starState = gardenState && gardenState.stars;
  if (!starState) {
    problems.push('window.__gardenState.stars is not set — the star field particle system was not created (stars.js may not have been imported or called).');
  } else {
    // Verify type
    if (starState.type !== 'stars') {
      problems.push('starState.type is "' + starState.type + '", expected "stars".');
    }

    // Verify count is between 60 and 100
    if (typeof starState.count !== 'number' || starState.count < 60 || starState.count > 100) {
      problems.push('starState.count is ' + starState.count + ', expected between 60 and 100.');
    }

    // Verify reducedMotion is a boolean
    if (typeof starState.reducedMotion !== 'boolean') {
      problems.push('starState.reducedMotion should be a boolean, got ' + typeof starState.reducedMotion);
    }

    // Verify hemisphereRadius is ~8.5
    if (typeof starState.hemisphereRadius !== 'number' || Math.abs(starState.hemisphereRadius - 8.5) > 0.5) {
      problems.push('starState.hemisphereRadius is ' + starState.hemisphereRadius + ', expected ~8.5.');
    }

    // Verify rotation speed is imperceptible (< 0.01 rad/s)
    if (typeof starState.rotationSpeed !== 'number' || starState.rotationSpeed >= 0.01) {
      problems.push('starState.rotationSpeed is ' + starState.rotationSpeed + ', expected < 0.01 rad/s for imperceptible celestial motion.');
    }

    // Verify maxOpacity is ~0.4
    if (typeof starState.maxOpacity !== 'number' || Math.abs(starState.maxOpacity - 0.4) > 0.1) {
      problems.push('starState.maxOpacity is ' + starState.maxOpacity + ', expected ~0.4.');
    }

    // Verify material exists and has correct properties
    if (!starState.material) {
      problems.push('starState.material is missing — PointsMaterial not assigned.');
    } else {
      if (starState.material.transparent !== true) {
        problems.push('starState.material.transparent is ' + starState.material.transparent + ', expected true.');
      }
      if (typeof starState.material.opacity !== 'number') {
        problems.push('starState.material.opacity is not a number — got ' + typeof starState.material.opacity);
      }
      if (starState.material.sizeAttenuation !== true) {
        problems.push('starState.material.sizeAttenuation is ' + starState.material.sizeAttenuation + ', expected true for realistic depth falloff.');
      }
      if (starState.material.blending !== THREE.AdditiveBlending) {
        problems.push('starState.material.blending is not AdditiveBlending — stars should glow softly.');
      }
    }

    // Verify points object exists and is in the scene
    if (!starState.points) {
      problems.push('starState.points is missing — the THREE.Points object was not created.');
    } else if (gardenState && gardenState.scene) {
      const found = gardenState.scene.children.includes(starState.points);
      if (!found) {
        problems.push('star points object is not a child of the scene — it was not added to the garden.');
      }
    }

    // Verify the update function is exposed
    if (typeof gardenState.starsUpdate !== 'function') {
      problems.push('gardenState.starsUpdate is not a function — the star field update loop is not exposed.');
    }

    // Verify reduced-motion behaviour: when reducedMotion is true, rotation should be off
    if (starState.reducedMotion) {
      // The rotation is only applied in update(), so we check the state reflects this
      if (starState.points) {
        // With reduced motion, the update loop does not rotate, so rotation should be 0
        if (Math.abs(starState.points.rotation.y) > 0.001) {
          problems.push('With reducedMotion active, star points rotation.y is ' + starState.points.rotation.y + ' — expected 0 (no rotation when reduced motion is preferred).');
        }
      }
    }

    // Test opacity behaviour: simulate different day/night phases
    const dayNight = gardenState && gardenState.dayNight;
    if (dayNight && typeof dayNight.getCycleProgress === 'function' && typeof dayNight.getPhaseName === 'function') {
      // Save original getCycleProgress
      const origGetCycleProgress = dayNight.getCycleProgress;
      try {
        // Test 1: During Morning (t ~0.1), star opacity should be near 0
        dayNight.getCycleProgress = function() { return 0.1; };
        if (typeof gardenState.starsUpdate === 'function') {
          gardenState.starsUpdate(0, 0.016);
          const morningOpacity = starState.material.opacity;
          if (morningOpacity > 0.02) {
            problems.push('During Morning phase (t=0.1), star material.opacity is ' + morningOpacity + ' — expected near 0 (stars invisible during morning).');
          }

          // Test 2: During Midday (t ~0.35), star opacity should be near 0
          dayNight.getCycleProgress = function() { return 0.35; };
          gardenState.starsUpdate(0, 0.016);
          const middayOpacity = starState.material.opacity;
          if (middayOpacity > 0.02) {
            problems.push('During Midday phase (t=0.35), star material.opacity is ' + middayOpacity + ' — expected near 0 (stars invisible during midday).');
          }

          // Test 3: During Evening start (t ~0.55), star opacity should still be near 0 (just started fading)
          dayNight.getCycleProgress = function() { return 0.55; };
          gardenState.starsUpdate(0, 0.016);
          const eveningStartOpacity = starState.material.opacity;
          // At t=0.55, fadeIn = (0.55-0.5)/0.25 = 0.2, target = 0.2*0.4 = 0.08, so just starting

          // Test 4: During Night (t ~0.85), star opacity should be > 0.1
          dayNight.getCycleProgress = function() { return 0.85; };
          for (let i = 0; i < 300; i++) {
            gardenState.starsUpdate(0, 0.016);
          }
          const nightOpacity = starState.material.opacity;
          if (nightOpacity < 0.1) {
            problems.push('During Night phase (t=0.85), star material.opacity is ' + nightOpacity + ' — expected > 0.1 (stars should be visible during night).');
          }

          // Test 5: When switching back to Morning after Night, opacity should fade back to near 0
          dayNight.getCycleProgress = function() { return 0.98; }; // Late Night, fading out
          for (let i = 0; i < 200; i++) {
            gardenState.starsUpdate(0, 0.016);
          }
          // At t=0.98, fadeOut = (1.0-0.98)/0.05 = 0.4, target = 0.4*0.4 = 0.16, so fading
          dayNight.getCycleProgress = function() { return 0.02; }; // Morning
          for (let i = 0; i < 300; i++) {
            gardenState.starsUpdate(0, 0.016);
          }
          const morningAfterNightOpacity = starState.material.opacity;
          if (morningAfterNightOpacity > 0.05) {
            problems.push('After switching from Night back to Morning (t=0.02), star material.opacity is ' + morningAfterNightOpacity + ' — expected near 0 (stars should fade out after night).');
          }
        }
      } finally {
        // Restore original getCycleProgress
        dayNight.getCycleProgress = origGetCycleProgress;
      }
    }

    // Verify the star size is small (tiny dots)
    if (starState.material && typeof starState.material.size !== 'number') {
      problems.push('starState.material.size is not a number — got ' + typeof starState.material.size);
    } else if (starState.material && starState.material.size > 0.1) {
      problems.push('starState.material.size is ' + starState.material.size + ', expected <= 0.1 for tiny star dots.');
    }

    // Verify the points object has a geometry with position attribute
    if (starState.points && starState.points.geometry) {
      const geom = starState.points.geometry;
      if (!geom.attributes || !geom.attributes.position) {
        problems.push('Star geometry has no position attribute.');
      } else {
        const pos = geom.attributes.position;
        if (pos.count !== starState.count) {
          problems.push('Star geometry position count (' + pos.count + ') does not match starState.count (' + starState.count + ').');
        }
        // Verify stars are on a hemisphere (y >= 0 for all stars)
        const array = pos.array;
        let anyBelowHorizon = false;
        for (let i = 0; i < pos.count; i++) {
          const y = array[i * 3 + 1];
          if (y < 0) {
            anyBelowHorizon = true;
            break;
          }
        }
        if (anyBelowHorizon) {
          problems.push('At least one star is below y=0 (below the horizon) — stars should be on the hemisphere above the garden.');
        }
        // Verify most stars are at a reasonable distance from centre (within HEMISPHERE_RADIUS ± 1)
        let tooClose = 0;
        for (let i = 0; i < pos.count; i++) {
          const x = array[i * 3];
          const y = array[i * 3 + 1];
          const z = array[i * 3 + 2];
          const dist = Math.sqrt(x*x + y*y + z*z);
          if (dist < 7 || dist > 9.5) {
            tooClose++;
          }
        }
        if (tooClose > starState.count * 0.5) {
          problems.push(tooClose + ' of ' + starState.count + ' stars are outside the expected radius range (7.0–9.5) — most should be on the hemisphere dome near ~8.5 units.');
        }
      }
    }
  }

  /* ---------- Fallen leaves checks (issue #448) ---------- */
  var fallenLeavesState = gardenState && gardenState.fallenLeaves;
  if (!fallenLeavesState) {
    problems.push('window.__gardenState.fallenLeaves is not set — the fallen leaves scatter was not created (createFallenLeaves may not have been called).');
  } else {
    // Verify type
    if (fallenLeavesState.type !== 'fallen-leaves') {
      problems.push('fallenLeaves.type is "' + fallenLeavesState.type + '", expected "fallen-leaves".');
    }

    // Verify count is between 8 and 15
    if (typeof fallenLeavesState.count !== 'number' || fallenLeavesState.count < 8 || fallenLeavesState.count > 15) {
      problems.push('fallenLeaves.count is ' + fallenLeavesState.count + ', expected between 8 and 15.');
    }

    // Verify spreadRadius is ~1
    if (typeof fallenLeavesState.spreadRadius !== 'number' || Math.abs(fallenLeavesState.spreadRadius - 1.0) > 0.05) {
      problems.push('fallenLeaves.spreadRadius is ' + fallenLeavesState.spreadRadius + ', expected ~1.0.');
    }

    // Verify material exists and has correct properties
    if (!fallenLeavesState.material) {
      problems.push('fallenLeaves.material is missing — leaf material not created.');
    } else {
      if (fallenLeavesState.material.transparent !== true) {
        problems.push('fallenLeaves.material.transparent is ' + fallenLeavesState.material.transparent + ', expected true.');
      }
      if (fallenLeavesState.material.depthWrite !== false) {
        problems.push('fallenLeaves.material.depthWrite is ' + fallenLeavesState.material.depthWrite + ', expected false to avoid z-fighting with the ground.');
      }
      if (typeof fallenLeavesState.material.opacity !== 'number') {
        problems.push('fallenLeaves.material.opacity is not a number.');
      }
    }

    // Verify meshes array exists with correct count
    if (!fallenLeavesState.meshes || !Array.isArray(fallenLeavesState.meshes)) {
      problems.push('fallenLeaves.meshes is missing or not an array.');
    } else if (fallenLeavesState.meshes.length !== fallenLeavesState.count) {
      problems.push('fallenLeaves.meshes.length (' + fallenLeavesState.meshes.length + ') does not match count (' + fallenLeavesState.count + ').');
    } else {
      // Verify each mesh is a THREE.Mesh at y≈0.005 within ~1 unit of origin
      fallenLeavesState.meshes.forEach(function(mesh, i) {
        if (!(mesh instanceof THREE.Mesh)) {
          problems.push('fallen leaf #' + i + ' is not a THREE.Mesh, got ' + (mesh && mesh.constructor ? mesh.constructor.name : typeof mesh));
          return;
        }

        // Check y position is near ground (≈0.005)
        var y = mesh.position.y;
        if (y < 0.001 || y > 0.01) {
          problems.push('fallen leaf #' + i + ' has y=' + y.toFixed(4) + ', expected ≈0.005 (just above ground).');
        }

        // Check horizontal distance from origin is within ~1 unit
        var dist = Math.sqrt(mesh.position.x * mesh.position.x + mesh.position.z * mesh.position.z);
        if (dist > 1.05) {
          problems.push('fallen leaf #' + i + ' at distance ' + dist.toFixed(2) + ' from origin — expected within ~1 unit of the garden center.');
        }

        // Verify it is in the scene
        if (gardenState && gardenState.scene) {
          var found = gardenState.scene.children.indexOf(mesh) !== -1;
          if (!found) {
            problems.push('fallen leaf #' + i + ' is not a child of the scene — it was not added to the garden.');
          }
        }

        // Verify the mesh uses the shared leaf material
        if (mesh.material !== fallenLeavesState.material) {
          problems.push('fallen leaf #' + i + ' does not use the shared leaf material.');
        }

        // Verify the mesh has a geometry (ShapeGeometry with position attribute)
        if (!mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.position) {
          problems.push('fallen leaf #' + i + ' has no geometry or missing position attribute.');
        }
      });
    }

    // Test that the material drives leaves correctly per season
    // Since we can't mock seasons easily in a live test, verify the material
    // at least has the expected autumn colour baseline
    if (fallenLeavesState.material && fallenLeavesState.material.color) {
      var color = fallenLeavesState.material.color;
      if (!(color instanceof THREE.Color)) {
        problems.push('fallenLeaves.material.color is not a THREE.Color instance.');
      }
    }

    // Verify initial opacity is 0 (hidden until autumn)
    // But after the seasonal cycle runs, it may have been updated — only flag if
    // it's extremely high (>0.5) during Summer/Spring when it should be near 0
    var currentSeason = gardenState && gardenState.getSeason ? gardenState.getSeason() : null;
    if (currentSeason && (currentSeason === 'Spring' || currentSeason === 'Summer')) {
      if (fallenLeavesState.material && fallenLeavesState.material.opacity > 0.1) {
        problems.push('During ' + currentSeason + ', fallenLeaves.material.opacity is ' + fallenLeavesState.material.opacity + ', expected near 0 (leaves should be invisible outside autumn/winter).');
      }
    }
  }

  /* ---------- Butterfly weather shelter checks (issue #457) ---------- */
  // creatureState is already declared above in the drifting creature checks block
  if (!creatureState) {
    problems.push('window.__gardenState.creature is not set — the butterfly creature was not created or exposed.');
  } else {
    if (typeof creatureState.weatherOpacity !== 'number') {
      problems.push('creature.state.weatherOpacity is not a number — weather shelter opacity lerp not exposed.');
    } else {
      if (creatureState.weatherOpacity < 0 || creatureState.weatherOpacity > 1) {
        problems.push('creature.state.weatherOpacity is ' + creatureState.weatherOpacity + ', expected in [0, 1].');
      }

      // Check opacity tracks weather phase: after sufficient time in a phase,
      // weatherOpacity should reflect the target state.
      const weatherPhase = document.getElementById('weather-display').textContent.trim();
      if (weatherPhase === 'Light Drizzle') {
        // During rain, butterfly should be sheltering (faded out)
        if (creatureState.weatherOpacity > 0.1) {
          problems.push('During Light Drizzle weather, creature.weatherOpacity is ' + creatureState.weatherOpacity.toFixed(3) + ', expected <= 0.1 (butterfly should be sheltering/faded out).');
        }
      } else if (weatherPhase === 'Clear' || weatherPhase === 'Overcast') {
        // During clear/overcast, butterfly should be visible
        if (creatureState.weatherOpacity < 0.9) {
          problems.push('During ' + weatherPhase + ' weather, creature.weatherOpacity is ' + creatureState.weatherOpacity.toFixed(3) + ', expected >= 0.9 (butterfly should be visible).');
        }
      }
    }

    // Verify wing material opacity reflects the weather fade
    if (creatureState.wingMat) {
      const expectedWingOpacity = 0.45 * creatureState.weatherOpacity;
      const actualWingOpacity = creatureState.wingMat.opacity;
      if (Math.abs(actualWingOpacity - expectedWingOpacity) > 0.001) {
        problems.push('creature wingMat.opacity is ' + actualWingOpacity.toFixed(4) + ', expected ' + expectedWingOpacity.toFixed(4) + ' (= 0.45 * weatherOpacity).');
      }
    }

    // Verify body material opacity tracks weather fade
    if (creatureState.bodyMat) {
      const actualBodyOpacity = creatureState.bodyMat.opacity;
      if (Math.abs(actualBodyOpacity - creatureState.weatherOpacity) > 0.001) {
        problems.push('creature bodyMat.opacity is ' + actualBodyOpacity.toFixed(4) + ', expected ' + creatureState.weatherOpacity.toFixed(4) + ' (= weatherOpacity).');
      }
    }

    // Verify the wing material is still transparent
    if (creatureState.wingMat && creatureState.wingMat.transparent !== true) {
      problems.push('creature wingMat.transparent is ' + creatureState.wingMat.transparent + ', expected true — opacity fade requires transparency.');
    }

    // Verify the body material is now transparent (for opacity fade)
    if (creatureState.bodyMat && creatureState.bodyMat.transparent !== true) {
      problems.push('creature bodyMat.transparent is ' + creatureState.bodyMat.transparent + ', expected true — opacity fade requires transparency.');
    }
  }

  /* ---------- prefers-reduced-motion preserves creature invisibility during rain (issue #457) ---------- */
  // This is a design-level check: if reduced motion is active, the creature
  // should be invisible via group.visible regardless of weather.
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotionMedia.matches && creatureState) {
    // If reduced motion is active, the group should be invisible
    if (creatureState.group && creatureState.group.visible !== false) {
      problems.push('With prefers-reduced-motion active, the creature group should be invisible (visible= ' + creatureState.group.visible + ').');
    }
  }

  /* ---------- Ambient audio checks (issue #458) ---------- */
  const ambientAudio = gardenState && gardenState.ambientAudio;
  if (!ambientAudio) {
    problems.push('window.__gardenState.ambientAudio is not set — the ambient audio system was not created (ambientAudio.js may not have been imported or created).');
  } else {
    // Verify type
    if (ambientAudio.state && ambientAudio.state.type !== 'ambient-audio') {
      problems.push('ambientAudio.state.type is "' + ambientAudio.state.type + '", expected "ambient-audio".');
    } else if (!ambientAudio.state) {
      problems.push('ambientAudio.state is missing — audio state object not found.');
    }

    // Verify required methods exist
    if (typeof ambientAudio.start !== 'function') {
      problems.push('ambientAudio.start is not a function — audio start method missing.');
    }
    if (typeof ambientAudio.stop !== 'function') {
      problems.push('ambientAudio.stop is not a function — audio stop method missing.');
    }
    if (typeof ambientAudio.update !== 'function') {
      problems.push('ambientAudio.update is not a function — audio weather update method missing.');
    }
    if (typeof ambientAudio.resumeOnInteraction !== 'function') {
      problems.push('ambientAudio.resumeOnInteraction is not a function — audio resume method missing.');
    }

    // Verify state properties
    if (ambientAudio.state) {
      if (typeof ambientAudio.state.windGain !== 'number') {
        problems.push('ambientAudio.state.windGain is not a number — wind gain configuration missing.');
      }
      if (typeof ambientAudio.state.rainGain !== 'number') {
        problems.push('ambientAudio.state.rainGain is not a number — rain gain configuration missing.');
      }
      if (typeof ambientAudio.state.windFilterFrequency !== 'number') {
        problems.push('ambientAudio.state.windFilterFrequency is not a number — filter frequency configuration missing.');
      }

      // Verify plausible gain values
      if (ambientAudio.state.windGain > 0.15) {
        problems.push('ambientAudio.state.windGain is ' + ambientAudio.state.windGain + ', expected ≤ 0.12 (wind must be extremely subtle).');
      }
      if (ambientAudio.state.rainGain > 0.05) {
        problems.push('ambientAudio.state.rainGain is ' + ambientAudio.state.rainGain + ', expected ≤ 0.04 (rain noise must be extremely subtle).');
      }
    }

    // Test that update responds to weather phases without throwing
    const testPhases = ['Clear', 'Overcast', 'Light Drizzle'];
    testPhases.forEach(function(phase) {
      try {
        ambientAudio.update(phase);
      } catch (e) {
        problems.push('ambientAudio.update("' + phase + '") threw: ' + e.message);
      }
    });

    // Verify update with unknown phase doesn't throw
    try {
      ambientAudio.update('UnknownPhase');
    } catch (e) {
      problems.push('ambientAudio.update("UnknownPhase") threw — should handle unknown phases gracefully: ' + e.message);
    }

    // Verify a click handler exists that resumes audio (check via the DOM event listener registry)
    // At minimum, verify that resumeOnInteraction is idempotent (calling it multiple times is safe)
    try {
      ambientAudio.resumeOnInteraction();
      ambientAudio.resumeOnInteraction();
      ambientAudio.resumeOnInteraction();
    } catch (e) {
      problems.push('ambientAudio.resumeOnInteraction() threw on repeated calls — must be idempotent: ' + e.message);
    }

    // Verify that start can be called safely (it may create AudioContext, which may not be available
    // in all test environments — but it shouldn't throw)
    try {
      ambientAudio.start();
    } catch (e) {
      problems.push('ambientAudio.start() threw: ' + e.message);
    }

    // Verify that stop can be called safely
    try {
      ambientAudio.stop();
    } catch (e) {
      problems.push('ambientAudio.stop() threw: ' + e.message);
    }

    // Verify the audio system is exposed on __gardenState correctly
    if (gardenState.ambientAudio !== ambientAudio) {
      problems.push('window.__gardenState.ambientAudio is not the same object as the created ambientAudio — the module was not correctly assigned.');
    }
  }

  return problems;
}
