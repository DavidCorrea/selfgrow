/**
 * selftest.js — selfgrow product checks
 *
 * Verifies the garden page booted correctly and the required DOM
 * and Three.js structures are present.
 */

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

  /* ---------- Day/night cycle checks ---------- */
  if (!gardenState) {
    problems.push('window.__gardenState missing — cannot check day/night cycle.');
  } else {
    const dayNight = gardenState.dayNight;
    if (!dayNight) {
      problems.push('gardenState.dayNight is missing — the day/night cycle was not initialised.');
    } else {
      const VALID_PHASES = ['Morning', 'Midday', 'Evening', 'Night'];

      // Check getCurrentPhase returns a valid name
      const phase = dayNight.getCurrentPhase();
      if (!phase) {
        problems.push('dayNight.getCurrentPhase() returned nothing — expected one of: ' + VALID_PHASES.join(', '));
      } else if (!VALID_PHASES.includes(phase)) {
        problems.push('dayNight.getCurrentPhase() returned "' + phase + '", expected one of: ' + VALID_PHASES.join(', '));
      }

      // Check the DOM #time-display matches the cycle phase
      const timeDisplay = document.getElementById('time-display');
      if (!timeDisplay) {
        problems.push('#time-display element missing — needed for day/night phase display.');
      } else {
        const displayText = timeDisplay.textContent.trim();
        if (!VALID_PHASES.includes(displayText)) {
          problems.push('#time-display shows "' + displayText + '" but should be one of: ' + VALID_PHASES.join(', '));
        }
        // The DOM and getCurrentPhase should agree (not necessarily at exact same instant, but close)
        if (phase && phase !== displayText) {
          // Allow a small tolerance: they may differ briefly during phase transitions
          // Only flag if they are different phase names (not transitional)
          if (VALID_PHASES.includes(displayText) && VALID_PHASES.includes(phase) && phase !== displayText) {
            problems.push('dayNight.getCurrentPhase() reports "' + phase + '" but #time-display shows "' + displayText + '". They should agree.');
          }
        }
      }

      // Check the scene background colour has changed from the initial hardcoded value (0x87ceeb)
      // since the cycle should have shifted it slightly even from t=0
      if (gardenState.scene) {
        const bg = gardenState.scene.background;
        if (bg && bg.isColor) {
          const hex = bg.getHex();
          if (hex === 0x87ceeb) {
            problems.push('Scene background is still the initial sky blue (0x87ceeb) — the day/night cycle did not update it.');
          }
        } else {
          problems.push('Scene background is not a Color — day/night cycle may not have set it.');
        }
      }
    }
  }

  return problems;
}
