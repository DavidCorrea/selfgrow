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

  return problems;
}
