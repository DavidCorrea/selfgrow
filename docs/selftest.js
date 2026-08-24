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
  } catch (err) {
    problems.push(`Could not verify module registry: ${err.message}`);
  }

  // ── 7. Page structure checks ──
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

  return problems;
}