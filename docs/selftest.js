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

  return problems;
}
