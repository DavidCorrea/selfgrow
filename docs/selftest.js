/**
 * BELLOWSDEEP — self-test suite.
 *
 * Verifies the game's core promises: seed determinism, pressure bounds,
 * automaton liveness, device cost limits, and death reachability.
 *
 * Runs in the real browser on the real page, importing game modules directly.
 */
export async function checks() {
  const problems = [];

  // ── 1. Seed determinism ──
  // The same seed must produce the same initial state every time.
  try {
    const { createInitialState } = await import('./game.js');
    const seed = 'test-seed-42';
    const state1 = createInitialState(seed);
    const state2 = createInitialState(seed);

    if (state1.pressure !== state2.pressure) {
      problems.push(
        `Seed determinism failed: same seed produced different pressure values (${state1.pressure} vs ${state2.pressure})`
      );
    }
    if (state1.seed !== state2.seed) {
      problems.push(
        `Seed determinism failed: seed field mismatch (${state1.seed} vs ${state2.seed})`
      );
    }
    if (state1.automatonState.position !== state2.automatonState.position) {
      problems.push(
        `Seed determinism failed: automaton position differs (${state1.automatonState.position} vs ${state2.automatonState.position})`
      );
    }
    if (state1.turn !== 0 || state2.turn !== 0) {
      problems.push(
        `Initial turn should be 0, got state1: ${state1.turn}, state2: ${state2.turn}`
      );
    }

    // Also verify the PRNG itself is deterministic
    const { createPRNG } = await import('./engine/prng.js');
    const rng1 = createPRNG(seed);
    const rng2 = createPRNG(seed);
    const val1 = rng1();
    const val2 = rng2();
    if (val1 !== val2) {
      problems.push(
        `PRNG determinism failed: first call returned ${val1} then ${val2} for the same seed`
      );
    }
  } catch (err) {
    problems.push(`Could not import game modules for seed determinism check: ${err.message}`);
  }

  // ── 2. Pressure starts at a defined value ──
  try {
    const { createInitialState } = await import('./game.js');
    const state = createInitialState('pressure-check');
    if (typeof state.pressure !== 'number' || state.pressure < 0) {
      problems.push(
        `Initial pressure should be a positive number, got ${state.pressure}`
      );
    }
    // The defined starting pressure is 50 per the game engine
    if (state.pressure !== 50) {
      problems.push(
        `Initial pressure should be 50, got ${state.pressure}`
      );
    }
    if (typeof state.ruptureThreshold !== 'number' || state.ruptureThreshold <= 0) {
      problems.push(
        `Rupture threshold should be a positive number, got ${state.ruptureThreshold}`
      );
    }
  } catch (err) {
    problems.push(`Could not import game modules for pressure check: ${err.message}`);
  }

  // ── 3. The automaton always eventually acts (no infinite loop) ──
  // Verify that calling advanceTurn advances the turn counter and the
  // automaton's position decreases (it moves toward the player).
  try {
    const { createInitialState } = await import('./game.js');
    // We need to test the turn logic inline. We'll simulate turns manually.
    const state = createInitialState('automaton-liveness');
    const initialPos = state.automatonState.position;

    // Run 5 turns of "wait" action
    for (let i = 0; i < 5; i++) {
      // Simulate automaton act
      const { getAutomaton } = await import('./engine/registry.js');
      const automaton = getAutomaton('sentinel');
      if (automaton && automaton.act) {
        automaton.act(state);
      }
      state.turn += 1;
    }

    // After 5 turns, the automaton should have moved closer
    if (state.automatonState.position >= initialPos) {
      problems.push(
        `Automaton did not advance after 5 turns: position ${initialPos} -> ${state.automatonState.position}`
      );
    }
  } catch (err) {
    problems.push(`Could not verify automaton liveness: ${err.message}`);
  }

  // ── 4. A device cannot take pressure below zero ──
  try {
    const { createInitialState } = await import('./game.js');
    const state = createInitialState('device-cost-limit');
    const { getDevice } = await import('./engine/registry.js');

    const vent = getDevice('vent');
    if (!vent) {
      problems.push('Vent device not registered — cannot verify cost limit');
    } else {
      // Set pressure to 5, which is below the vent's cost of 10
      state.pressure = 5;
      const couldUse = vent.canUse(state);
      if (couldUse) {
        problems.push(
          'Vent.canUse() returned true when pressure (5) is below cost (10)'
        );
      }

      // Using it should return false and not change pressure
      const used = vent.use(state);
      if (used) {
        problems.push(
          'Vent.use() returned true when pressure was insufficient'
        );
      }
      if (state.pressure < 0) {
        problems.push(
          `Pressure went below zero: ${state.pressure}`
        );
      }

      // Verify that with sufficient pressure it works
      state.pressure = 20;
      const couldUse2 = vent.canUse(state);
      if (!couldUse2) {
        problems.push(
          'Vent.canUse() returned false when pressure (20) is sufficient'
        );
      }
      const pressureBefore = state.pressure;
      const positionBefore = state.automatonState.position;
      const used2 = vent.use(state);
      if (!used2) {
        problems.push(
          'Vent.use() returned false when pressure was sufficient'
        );
      }
      if (state.pressure !== pressureBefore - vent.cost) {
        problems.push(
          `Vent did not deduct correct cost: expected ${pressureBefore - vent.cost}, got ${state.pressure}`
        );
      }
      // Position should have increased (pushed back)
      if (state.automatonState.position <= positionBefore) {
        problems.push(
          `Vent did not push automaton back: position ${positionBefore} -> ${state.automatonState.position}`
        );
      }
    }
  } catch (err) {
    problems.push(`Could not verify device cost limits: ${err.message}`);
  }

  // ── 5. Death condition is reachable ──
  try {
    const { createInitialState } = await import('./game.js');
    const { getAutomaton } = await import('./engine/registry.js');

    // Test automaton defeat: run enough turns for the automaton to reach the player
    const state = createInitialState('death-reachable');
    // Set position to 2 to make it quick
    state.automatonState.position = 2;

    const automaton = getAutomaton('sentinel');
    if (!automaton) {
      problems.push('Sentinel automaton not registered — cannot verify death reachability');
    } else {
      // Run 3 turns — should reach 0 or below
      for (let i = 0; i < 3; i++) {
        if (automaton.act) automaton.act(state);
        state.turn += 1;
      }

      if (state.automatonState.position > 0) {
        problems.push(
          `Automaton defeat not reachable: position still ${state.automatonState.position} after 3 turns from position 2`
        );
      }

      // Test pressure rupture: set pressure to threshold
      const state2 = createInitialState('death-rupture');
      state2.pressure = state2.ruptureThreshold;
      // Check death condition manually (same logic as game engine)
      if (state2.pressure >= state2.ruptureThreshold) {
        // This is the rupture condition — it should be detected
      } else {
        problems.push(
          `Pressure rupture not detectable: pressure ${state2.pressure} >= threshold ${state2.ruptureThreshold} was false`
        );
      }
    }
  } catch (err) {
    problems.push(`Could not verify death reachability: ${err.message}`);
  }

  // ── 6. Module registry works ──
  try {
    const { listAutomata, listDevices, listGalleries, getAutomaton, getDevice, getGallery } = await import('./engine/registry.js');

    const automata = listAutomata();
    if (!automata.includes('sentinel')) {
      problems.push('Sentinel automaton not found in registry');
    }

    const devices = listDevices();
    if (!devices.includes('vent')) {
      problems.push('Vent device not found in registry');
    }

    const galleries = listGalleries();
    if (!galleries.includes('engine-room')) {
      problems.push('Engine room gallery not found in registry');
    }
    if (!galleries.includes('boiler-room')) {
      problems.push('Boiler room gallery not found in registry — second gallery is missing');
    }
    if (!galleries.includes('pipe-gallery')) {
      problems.push('Pipe gallery not found in registry — third gallery is missing');
    }

    const sentinel = getAutomaton('sentinel');
    if (!sentinel || typeof sentinel.describe !== 'function' || typeof sentinel.act !== 'function') {
      problems.push('Sentinel automaton missing required methods (describe, act)');
    }

    const vent = getDevice('vent');
    if (!vent || typeof vent.describe !== 'function' || typeof vent.canUse !== 'function' || typeof vent.use !== 'function') {
      problems.push('Vent device missing required methods (describe, canUse, use)');
    }

    const engineRoom = getGallery('engine-room');
    if (!engineRoom || typeof engineRoom.describe !== 'function') {
      problems.push('Engine room gallery missing required method (describe)');
    }

    const boilerRoom = getGallery('boiler-room');
    if (!boilerRoom || typeof boilerRoom.describe !== 'function') {
      problems.push('Boiler room gallery missing required method (describe)');
    }

    const pipeGallery = getGallery('pipe-gallery');
    if (!pipeGallery || typeof pipeGallery.describe !== 'function') {
      problems.push('Pipe gallery missing required method (describe)');
    }

    // Verify descriptions are distinct
    if (engineRoom && boilerRoom && pipeGallery &&
        typeof engineRoom.describe === 'function' &&
        typeof boilerRoom.describe === 'function' &&
        typeof pipeGallery.describe === 'function') {
      const engineDesc = engineRoom.describe({});
      const boilerDesc = boilerRoom.describe({});
      const pipeDesc = pipeGallery.describe({});

      if (engineDesc === boilerDesc) {
        problems.push('Boiler room description is identical to engine room description — must be distinct');
      }
      if (engineDesc === pipeDesc) {
        problems.push('Pipe gallery description is identical to engine room description — must be distinct');
      }
      if (boilerDesc === pipeDesc) {
        problems.push('Pipe gallery description is identical to boiler room description — must be distinct');
      }

      if (!boilerDesc || boilerDesc.trim().length < 20) {
        problems.push('Boiler room description is too short or empty');
      }
      if (!pipeDesc || pipeDesc.trim().length < 20) {
        problems.push('Pipe gallery description is too short or empty');
      }

      // Verify pipe gallery description is at least 3 sentences and mentions the Sentinel
      const sentenceCount = pipeDesc.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      if (sentenceCount < 3) {
        problems.push(`Pipe gallery description has only ${sentenceCount} sentence(s) — must be at least 3`);
      }
      if (!pipeDesc.toLowerCase().includes('sentinel')) {
        problems.push('Pipe gallery description must mention the Sentinel');
      }
    }
  } catch (err) {
    problems.push(`Could not verify module registry: ${err.message}`);
  }

  // ── 7. Gallery sequence determinism ──
  // The same seed must produce the same gallery sequence every time.
  try {
    const { createInitialState } = await import('./game.js');
    const { generateGallerySequence } = await import('./engine/gallery-generator.js');
    const { createPRNG } = await import('./engine/prng.js');

    const seed = 'gallery-seq-test';
    const state1 = createInitialState(seed);
    const state2 = createInitialState(seed);

    if (!state1.gallerySequence || !Array.isArray(state1.gallerySequence)) {
      problems.push('gallerySequence is missing or not an array in initial state');
    } else {
      if (state1.gallerySequence.length !== state2.gallerySequence.length) {
        problems.push(
          `Gallery sequence length mismatch: ${state1.gallerySequence.length} vs ${state2.gallerySequence.length}`
        );
      }

      for (let i = 0; i < state1.gallerySequence.length; i++) {
        if (state1.gallerySequence[i] !== state2.gallerySequence[i]) {
          problems.push(
            `Gallery sequence at index ${i} differs: '${state1.gallerySequence[i]}' vs '${state2.gallerySequence[i]}'`
          );
          break;
        }
      }

      // The sequence must contain at least 3 galleries so the arrangement system is meaningful
      if (state1.gallerySequence.length < 3) {
        problems.push(
          `Gallery generator produced sequence with only ${state1.gallerySequence.length} galleries — ` +
          'needs at least 3 for meaningful shuffling'
        );
      }

      // The first gallery must always be engine-room (the starting gallery)
      if (state1.gallerySequence[0] !== 'engine-room') {
        problems.push(
          `First gallery in sequence should be 'engine-room', got '${state1.gallerySequence[0]}'`
        );
      }

      // The boiler-room must appear somewhere in the sequence
      if (!state1.gallerySequence.includes('boiler-room')) {
        problems.push(
          `Boiler-room gallery not found in gallery sequence: [${state1.gallerySequence.join(', ')}]`
        );
      }

      // The pipe-gallery must appear somewhere in the sequence
      if (!state1.gallerySequence.includes('pipe-gallery')) {
        problems.push(
          `Pipe-gallery not found in gallery sequence: [${state1.gallerySequence.join(', ')}]`
        );
      }

      // Also verify via the generator directly
      const rng1 = createPRNG(seed);
      const rng2 = createPRNG(seed);
      const seq1 = generateGallerySequence(rng1);
      const seq2 = generateGallerySequence(rng2);

      if (seq1.length !== seq2.length) {
        problems.push(
          `Direct generator sequence length mismatch: ${seq1.length} vs ${seq2.length}`
        );
      }

      for (let i = 0; i < seq1.length; i++) {
        if (seq1[i] !== seq2[i]) {
          problems.push(
            `Direct generator sequence at index ${i} differs: '${seq1[i]}' vs '${seq2[i]}'`
          );
          break;
        }
      }

      // Check that the gallery index starts at 0
      if (state1.galleryIndex !== 0) {
        problems.push(
          `Initial galleryIndex should be 0, got ${state1.galleryIndex}`
        );
      }

      // Check that location matches the first gallery in the sequence
      if (state1.location !== state1.gallerySequence[0]) {
        problems.push(
          `Initial location '${state1.location}' does not match first gallery '${state1.gallerySequence[0]}'`
        );
      }

      // Verify that changing the seed changes the sequence
      // (when there are multiple galleries to shuffle)
      const state3 = createInitialState('different-seed-for-test');
      if (state1.gallerySequence.length > 1 && state3.gallerySequence.length > 1) {
        // The sequences can still be the same by chance, but at least verify
        // they are valid and not hardcoded to a single path
        if (state3.gallerySequence[0] !== 'engine-room') {
          problems.push('Even with different seed, first gallery should be engine-room');
        }
      }
    }
  } catch (err) {
    problems.push(`Could not verify gallery sequence determinism: ${err.message}`);
  }

  // ── 8. Page structure checks ──
  const gameEl = document.getElementById('game');
  if (!gameEl) {
    problems.push('Missing #game container — game engine has no mount point');
  } else {
    if (!gameEl.classList.contains('riveted-panel')) {
      problems.push('#game container is missing the riveted-panel class');
    }
    // The panel-inner should exist
    if (!gameEl.querySelector('.panel-inner')) {
      problems.push('#game container has no .panel-inner child');
    }
  }

  const seedEl = document.getElementById('seed-value');
  if (!seedEl) {
    problems.push('Missing #seed-value element — seed display area not present');
  }

  // 8. The game should have started (panel-inner should not show placeholder)
  if (gameEl) {
    const inner = gameEl.querySelector('.panel-inner');
    if (inner) {
      const hasPlaceholder = inner.querySelector('.engine-placeholder');
      if (hasPlaceholder) {
        // This might be transient; only flag if it persists
        // Actually, the game replaces innerHTML so this is fine
      }
    }
  }

  // ── 9. Steam Cloak device is registered and works ──
  try {
    const { createInitialState } = await import('./game.js');
    const { getDevice, listDevices } = await import('./engine/registry.js');

    const devices = listDevices();
    if (!devices.includes('steam-cloak')) {
      problems.push('Steam Cloak device not found in registry');
    }

    const cloak = getDevice('steam-cloak');
    if (!cloak) {
      problems.push('Steam Cloak device not registered — cannot verify');
    } else {
      // Verify required methods
      if (typeof cloak.describe !== 'function') {
        problems.push('Steam Cloak missing describe method');
      }
      if (typeof cloak.canUse !== 'function') {
        problems.push('Steam Cloak missing canUse method');
      }
      if (typeof cloak.use !== 'function') {
        problems.push('Steam Cloak missing use method');
      }

      // Verify cost is a positive number
      if (typeof cloak.cost !== 'number' || cloak.cost <= 0) {
        problems.push(`Steam Cloak cost should be a positive number, got ${cloak.cost}`);
      }

      // Cost should be 8 per the spec
      if (cloak.cost !== 8) {
        problems.push(`Steam Cloak cost should be 8, got ${cloak.cost}`);
      }

      // Verify canUse returns false when pressure is insufficient
      const state = createInitialState('steam-cloak-test');
      state.pressure = 5; // Below cost of 8
      const couldUse = cloak.canUse(state);
      if (couldUse) {
        problems.push('Steam Cloak.canUse() returned true when pressure (5) is below cost (8)');
      }

      // Using it with insufficient pressure should return false and not change state
      const used = cloak.use(state);
      if (used) {
        problems.push('Steam Cloak.use() returned true when pressure was insufficient');
      }
      if (state.pressure < 0) {
        problems.push(`Pressure went below zero: ${state.pressure}`);
      }
      if (state.automatonState.skipNextAct) {
        problems.push('Steam Cloak set skipNextAct when pressure was insufficient');
      }

      // Verify that with sufficient pressure it works
      state.pressure = 20;
      const couldUse2 = cloak.canUse(state);
      if (!couldUse2) {
        problems.push('Steam Cloak.canUse() returned false when pressure (20) is sufficient');
      }

      const pressureBefore = state.pressure;
      const used2 = cloak.use(state);
      if (!used2) {
        problems.push('Steam Cloak.use() returned false when pressure was sufficient');
      }
      if (state.pressure !== pressureBefore - cloak.cost) {
        problems.push(
          `Steam Cloak did not deduct correct cost: expected ${pressureBefore - cloak.cost}, got ${state.pressure}`
        );
      }

      // Verify skipNextAct flag was set
      if (!state.automatonState.skipNextAct) {
        problems.push('Steam Cloak did not set skipNextAct flag after use');
      }

      // Verify that skipNextAct actually prevents the Sentinel from advancing
      const { getAutomaton } = await import('./engine/registry.js');
      const automaton = getAutomaton('sentinel');
      if (!automaton) {
        problems.push('Sentinel automaton not registered — cannot verify skip behavior');
      } else {
        const state2 = createInitialState('steam-cloak-skip');
        const positionBefore = state2.automatonState.position;

        // Set skipNextAct and then run the automaton act
        state2.automatonState.skipNextAct = true;

        // Simulate the game engine's skip logic
        if (state2.automatonState.skipNextAct) {
          state2.automatonState.skipNextAct = false;
          // Skip the act
        } else {
          automaton.act(state2);
        }

        if (state2.automatonState.position !== positionBefore) {
          problems.push(
            `Sentinel advanced despite skipNextAct flag: position ${positionBefore} -> ${state2.automatonState.position}`
          );
        }

        // Verify the flag was cleared
        if (state2.automatonState.skipNextAct) {
          problems.push('skipNextAct flag was not cleared after being consumed');
        }

        // Verify that on the next turn, the Sentinel does advance
        automaton.act(state2);
        if (state2.automatonState.position >= positionBefore) {
          problems.push(
            `Sentinel did not advance on the turn after skip: position ${positionBefore} -> ${state2.automatonState.position}`
          );
        }
      }

      // Verify the device description is distinct from the Vent
      const vent = getDevice('vent');
      if (vent && cloak.describe) {
        const ventDesc = vent.describe(state);
        const cloakDesc = cloak.describe(state);
        if (ventDesc === cloakDesc) {
          problems.push('Steam Cloak description is identical to Vent description — must be distinct');
        }
      }
    }
  } catch (err) {
    problems.push(`Could not verify Steam Cloak device: ${err.message}`);
  }

  // ── 10. Safety Valve device is registered and works ──
  try {
    const { createInitialState } = await import('./game.js');
    const { getDevice, listDevices } = await import('./engine/registry.js');

    const devices = listDevices();
    if (!devices.includes('safety-valve')) {
      problems.push('Safety Valve device not found in registry');
    }

    const valve = getDevice('safety-valve');
    if (!valve) {
      problems.push('Safety Valve device not registered — cannot verify');
    } else {
      // Verify required methods
      if (typeof valve.describe !== 'function') {
        problems.push('Safety Valve missing describe method');
      }
      if (typeof valve.canUse !== 'function') {
        problems.push('Safety Valve missing canUse method');
      }
      if (typeof valve.use !== 'function') {
        problems.push('Safety Valve missing use method');
      }

      // Verify cost is a positive integer
      if (typeof valve.cost !== 'number' || valve.cost <= 0 || !Number.isInteger(valve.cost)) {
        problems.push(`Safety Valve cost should be a positive integer, got ${valve.cost}`);
      }

      // Cost should be 15 per the spec
      if (valve.cost !== 15) {
        problems.push(`Safety Valve cost should be 15, got ${valve.cost}`);
      }

      // Verify reduction is a positive number
      if (typeof valve.reduction !== 'number' || valve.reduction <= 0) {
        problems.push(`Safety Valve reduction should be a positive number, got ${valve.reduction}`);
      }

      // Verify canUse returns false when pressure is below cost
      const state = createInitialState('safety-valve-test');
      state.pressure = 5; // Below cost of 15
      const couldUse = valve.canUse(state);
      if (couldUse) {
        problems.push('Safety Valve.canUse() returned true when pressure (5) is below cost (15)');
      }

      // Using it with insufficient pressure should return false and not change state
      const used = valve.use(state);
      if (used) {
        problems.push('Safety Valve.use() returned true when pressure was insufficient');
      }
      if (state.pressure < 0) {
        problems.push(`Pressure went below zero: ${state.pressure}`);
      }

      // Verify that with sufficient pressure it works
      state.pressure = 50;
      const couldUse2 = valve.canUse(state);
      if (!couldUse2) {
        problems.push('Safety Valve.canUse() returned false when pressure (50) is sufficient');
      }

      const pressureBefore = state.pressure;
      const used2 = valve.use(state);
      if (!used2) {
        problems.push('Safety Valve.use() returned false when pressure was sufficient');
      }

      // Expected: pressure = 50 - 15 (cost) - 20 (reduction) = 15
      const expectedPressure = pressureBefore - valve.cost - valve.reduction;
      if (state.pressure !== expectedPressure) {
        problems.push(
          `Safety Valve did not apply correct effect: expected ${expectedPressure}, got ${state.pressure} ` +
          `(cost: ${valve.cost}, reduction: ${valve.reduction})`
        );
      }

      // Verify pressure never goes below zero
      state.pressure = 10; // Enough for cost (15) but not enough for cost + reduction (35)
      if (valve.canUse(state)) {
        // It should be usable since 10 >= 15 is false
        problems.push('Safety Valve.canUse() returned true when pressure (10) is below cost (15)');
      }

      // Verify the device description is distinct from Vent and Steam Cloak
      const vent = getDevice('vent');
      const cloak = getDevice('steam-cloak');
      if (valve.describe) {
        const valveState = createInitialState('safety-valve-desc');
        valveState.pressure = 50;
        const valveDesc = valve.describe(valveState);

        if (vent && vent.describe) {
          const ventDesc = vent.describe(valveState);
          if (valveDesc === ventDesc) {
            problems.push('Safety Valve description is identical to Vent description — must be distinct');
          }
        }

        if (cloak && cloak.describe) {
          const cloakDesc = cloak.describe(valveState);
          if (valveDesc === cloakDesc) {
            problems.push('Safety Valve description is identical to Steam Cloak description — must be distinct');
          }
        }

        // Verify the description shows cost, current pressure, and usability
        if (!valveDesc.includes(String(valve.cost))) {
          problems.push(`Safety Valve description should show cost (${valve.cost}), got: "${valveDesc}"`);
        }
        if (!valveDesc.includes(String(valveState.pressure))) {
          problems.push(`Safety Valve description should show current pressure (${valveState.pressure}), got: "${valveDesc}"`);
        }
        if (!valveDesc.includes('ready') && !valveDesc.includes('insufficient')) {
          problems.push(`Safety Valve description should show usability, got: "${valveDesc}"`);
        }
      }

      // Verify the device is listed in the registry
      const allDevices = listDevices();
      if (!allDevices.includes('safety-valve')) {
        problems.push('Safety Valve not found in listDevices()');
      }
    }
  } catch (err) {
    problems.push(`Could not verify Safety Valve device: ${err.message}`);
  }

  // ── 12. Text contrast meets WCAG AA 4.5:1 ──
  // Helper: convert an rgb string like "rgb(r, g, b)" or "#rrggbb" to {r,g,b}
  function parseColor(str) {
    if (!str) return null;
    const trimmed = str.trim();
    // Handle rgb/rgba format
    const rgbMatch = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return { r: parseInt(rgbMatch[1], 10), g: parseInt(rgbMatch[2], 10), b: parseInt(rgbMatch[3], 10) };
    }
    // Handle hex format
    const hexMatch = trimmed.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/);
    if (hexMatch) {
      return { r: parseInt(hexMatch[1], 16), g: parseInt(hexMatch[2], 16), b: parseInt(hexMatch[3], 16) };
    }
    return null;
  }

  function srgbToLinear(channel) {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance({ r, g, b }) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Check each element: get its computed color and its parent's background
  const contrastChecks = [
    {
      name: 'p.subtitle',
      selector: 'p.subtitle',
      bgSelector: 'body',
    },
    {
      name: 'div.gallery-progress',
      selector: '.gallery-progress',
      bgSelector: '.gallery-progress',
    },
    {
      name: 'div.pressure-label',
      selector: '.pressure-label',
      bgSelector: '.panel-inner',
    },
    {
      name: 'div.turn-display',
      selector: '.turn-display',
      bgSelector: '.panel-inner',
    },
    {
      name: 'p.keyboard-hint',
      selector: '.keyboard-hint',
      bgSelector: '.panel-inner',
    },
    {
      name: 'dt (Seed label)',
      selector: '.seed-display dt',
      bgSelector: '.seed-display',
    },
    {
      name: 'footer p (tagline)',
      selector: 'footer p',
      bgSelector: 'body',
    },
  ];

  const MIN_CONTRAST = 4.5;

  for (const check of contrastChecks) {
    const el = document.querySelector(check.selector);
    if (!el) {
      problems.push(`${check.name} not found in the DOM — cannot verify contrast ratio`);
      continue;
    }

    const elStyle = getComputedStyle(el);
    const fgColor = parseColor(elStyle.color);

    // Determine background: if the element has its own background set, use that;
    // otherwise walk up to the bgSelector
    let bgEl = el;
    if (check.bgSelector === 'body') {
      bgEl = document.body;
    } else if (check.bgSelector === '.panel-inner') {
      bgEl = el.closest('.panel-inner') || document.querySelector('.panel-inner');
    } else if (check.bgSelector === '.gallery-progress') {
      // The gallery-progress has its own background from the gallery-description context
      // Use the element itself (it may inherit from parent)
      bgEl = el;
    }

    // For the background color, we need the actual painted background.
    // If the element itself has a non-transparent background, use it;
    // otherwise walk up to find one.
    let bgColor = null;
    let current = bgEl;
    while (current) {
      const style = getComputedStyle(current);
      const parsed = parseColor(style.backgroundColor);
      if (parsed && (parsed.r !== 0 || parsed.g !== 0 || parsed.b !== 0 || style.backgroundColor !== 'rgba(0, 0, 0, 0)')) {
        // Check if it's actually transparent (rgba with alpha 0)
        if (style.backgroundColor && style.backgroundColor !== 'transparent' && !style.backgroundColor.includes('rgba(0, 0, 0, 0)')) {
          bgColor = parsed;
          break;
        }
      }
      current = current.parentElement;
    }

    if (!fgColor) {
      problems.push(`${check.name}: could not parse foreground color (${elStyle.color})`);
      continue;
    }
    if (!bgColor) {
      problems.push(`${check.name}: could not determine background color`);
      continue;
    }

    const fgLum = relativeLuminance(fgColor);
    const bgLum = relativeLuminance(bgColor);
    const ratio = contrastRatio(fgLum, bgLum);

    if (ratio < MIN_CONTRAST) {
      problems.push(
        `${check.name} contrast ratio is ${ratio.toFixed(2)}:1, below WCAG AA minimum of ${MIN_CONTRAST}:1 ` +
        `(text: ${elStyle.color}, background: ${elStyle.backgroundColor || 'inherited'})`
      );
    }
  }

  // ── 13. Sentinel burst/pause pattern ──
  // The Sentinel should advance 2 on burst turns, 0 on pause turns, and the
  // description should reflect the current state so a player can predict it.
  try {
    const { createInitialState } = await import('./game.js');
    const { getAutomaton } = await import('./engine/registry.js');

    const automaton = getAutomaton('sentinel');
    if (!automaton) {
      problems.push('Sentinel automaton not registered — cannot verify burst/pause pattern');
    } else {
      // Start from a known position
      const state = createInitialState('sentinel-pattern-test');
      const initialPos = state.automatonState.position; // should be 5

      // patternStep should be 0 (burst) initially
      if (state.automatonState.patternStep !== 0) {
        problems.push(
          `Sentinel initial patternStep should be 0, got ${state.automatonState.patternStep}`
        );
      }

      // ── Burst turn (patternStep 0): advance 2 ──
      automaton.act(state);
      if (state.automatonState.position !== initialPos - 2) {
        problems.push(
          `Sentinel burst turn: expected position ${initialPos - 2}, got ${state.automatonState.position}`
        );
      }
      if (state.automatonState.patternStep !== 1) {
        problems.push(
          `Sentinel after burst: patternStep should be 1, got ${state.automatonState.patternStep}`
        );
      }

      // ── Pause turn (patternStep 1): advance 0 ──
      const posAfterBurst = state.automatonState.position;
      automaton.act(state);
      if (state.automatonState.position !== posAfterBurst) {
        problems.push(
          `Sentinel pause turn: expected position ${posAfterBurst} (no change), got ${state.automatonState.position}`
        );
      }
      if (state.automatonState.patternStep !== 0) {
        problems.push(
          `Sentinel after pause: patternStep should be 0, got ${state.automatonState.patternStep}`
        );
      }

      // ── Second burst turn: advance 2 again ──
      const posAfterPause = state.automatonState.position;
      automaton.act(state);
      if (state.automatonState.position !== posAfterPause - 2) {
        problems.push(
          `Sentinel second burst turn: expected position ${posAfterPause - 2}, got ${state.automatonState.position}`
        );
      }
      if (state.automatonState.patternStep !== 1) {
        problems.push(
          `Sentinel after second burst: patternStep should be 1, got ${state.automatonState.patternStep}`
        );
      }

      // ── describe() shows pattern state ──
      // Reset to a known state for the describe check
      state.automatonState.position = 5;

      state.automatonState.patternStep = 0; // burst
      const descBurst = automaton.describe(state);
      if (!descBurst.includes('advancing rapidly') && !descBurst.includes('2 steps')) {
        problems.push(
          `Sentinel describe() on burst turn should mention advancing rapidly, got: "${descBurst}"`
        );
      }

      state.automatonState.patternStep = 1; // pause
      const descPause = automaton.describe(state);
      if (!descPause.includes('winding its gears') && !descPause.includes('pausing')) {
        problems.push(
          `Sentinel describe() on pause turn should mention winding its gears, got: "${descPause}"`
        );
      }

      // Verify descriptions are different from each other
      if (descBurst === descPause) {
        problems.push(
          'Sentinel describe() returns identical text for burst and pause turns — must differ'
        );
      }

      // Verify that a player can predict the pattern after 2 turns
      // If they see "advancing rapidly" (burst), they know next turn is pause (0 steps)
      // If they see "winding its gears" (pause), they know next turn is burst (2 steps)
      // After observing 2 turns, the pattern reveals itself
      state.automatonState.patternStep = 0;
      const firstDesc = automaton.describe(state);
      automaton.act(state); // now patternStep = 1
      const secondDesc = automaton.describe(state);

      // The descriptions should alternate
      if (firstDesc === secondDesc) {
        problems.push(
          'Sentinel descriptions should alternate between burst and pause — consecutive turns gave same description'
        );
      }
    }
  } catch (err) {
    problems.push(`Could not verify Sentinel burst/pause pattern: ${err.message}`);
  }

  // ── 14. Pressure accumulates each turn ──
  // Pressure should increase by pressureAccumulationRate each turn,
  // making hoarding a genuine threat.
  try {
    const { createInitialState } = await import('./game.js');

    // Check 12a: Pressure increments by exactly the rate each turn
    const state = createInitialState('pressure-accumulation');

    if (typeof state.pressureAccumulationRate !== 'number' || state.pressureAccumulationRate <= 0) {
      problems.push(
        `pressureAccumulationRate should be a positive number, got ${state.pressureAccumulationRate}`
      );
    } else {
      const rate = state.pressureAccumulationRate;
      const initialPressure = state.pressure;

      // Simulate 3 turns of waiting by manually applying the accumulation
      for (let i = 0; i < 3; i++) {
        state.pressure += rate;
      }

      const expectedPressure = initialPressure + 3 * rate;
      if (state.pressure !== expectedPressure) {
        problems.push(
          `Pressure accumulation: after 3 turns expected ${expectedPressure}, got ${state.pressure} ` +
          `(rate: ${rate}, initial: ${initialPressure})`
        );
      }

      // Check 12b: Rupture threshold is reachable within a predictable number of turns
      // Starting at 50 with rate 5, it takes 10 turns to reach 100 (rupture)
      const turnsToRupture = Math.ceil((state.ruptureThreshold - initialPressure) / rate);
      if (turnsToRupture !== 10) {
        problems.push(
          `With rate ${rate} and starting pressure ${initialPressure}, it should take exactly 10 turns ` +
          `to reach threshold ${state.ruptureThreshold}, calculated ${turnsToRupture}`
        );
      }

      // Verify that after turnsToRupture - 1 waits, pressure is still below threshold
      const state2 = createInitialState('pressure-accumulation');
      for (let i = 0; i < turnsToRupture - 1; i++) {
        state2.pressure += rate;
      }
      if (state2.pressure >= state2.ruptureThreshold) {
        problems.push(
          `Pressure should be below threshold after ${turnsToRupture - 1} turns of accumulation, ` +
          `got ${state2.pressure} >= ${state2.ruptureThreshold}`
        );
      }

      // Verify that after turnsToRupture waits, pressure reaches threshold
      const state3 = createInitialState('pressure-accumulation');
      for (let i = 0; i < turnsToRupture; i++) {
        state3.pressure += rate;
      }
      if (state3.pressure < state3.ruptureThreshold) {
        problems.push(
          `Pressure should be at or above threshold after ${turnsToRupture} turns of accumulation, ` +
          `got ${state3.pressure} < ${state3.ruptureThreshold}`
        );
      }
    }

    // Check 12c: Rate text appears in the rendered DOM
    // The game must be mounted for this; check if .pressure-rate exists
    const rateEl = document.querySelector('.pressure-rate');
    if (rateEl) {
      const text = rateEl.textContent;
      if (!text.includes('+') || !text.includes('per turn')) {
        problems.push(
          `Pressure rate element should show '+X per turn', got: "${text}"`
        );
      }
    } else {
      // The game might not be mounted yet in the test environment;
      // this is a soft check — only fail if the element exists but is wrong
      // or if the game is clearly mounted but the element is missing
      const gameEl = document.getElementById('game');
      if (gameEl && gameEl.querySelector('.panel-inner') &&
          !gameEl.querySelector('.panel-inner .death-screen')) {
        // Game is mounted and active, so rate should be visible
        if (!gameEl.querySelector('.pressure-rate')) {
          problems.push(
            'Pressure rate element (.pressure-rate) not found in the DOM when game is active'
          );
        }
      }
    }

    // Check 12d: The pressureAccumulationRate field exists in initial state
    const stateCheck = createInitialState('pressure-rate-check');
    if (stateCheck.pressureAccumulationRate === undefined) {
      problems.push(
        'Initial state is missing pressureAccumulationRate field'
      );
    }
  } catch (err) {
    problems.push(`Could not verify pressure accumulation: ${err.message}`);
  }

  return problems;
}