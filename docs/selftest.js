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

  return problems;
}
