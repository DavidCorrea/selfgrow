/**
 * Check that the selfgrow game engine works as claimed.
 *
 * Runs in the real browser on the real page, so it can reach the DOM
 * and import modules.
 *
 * @returns {Promise<string[]>} empty when everything holds
 */
export async function checks() {
  const problems = [];

  // ─── DOM structure ──────────────────────────────────────────────

  const woodEl = document.getElementById("wood-value");
  if (!woodEl) {
    problems.push("Expected #wood-value to exist in the DOM — it was not found.");
  }

  const rateEl = document.getElementById("rate-value");
  if (!rateEl) {
    problems.push("Expected #rate-value to exist in the DOM — it was not found.");
  }

  const tickEl = document.getElementById("tick-value");
  if (!tickEl) {
    problems.push("Expected #tick-value to exist in the DOM — it was not found.");
  }

  const actionArea = document.getElementById("action-area");
  if (!actionArea) {
    problems.push("Expected #action-area to exist in the DOM — it was not found.");
  } else {
    const growBtn = document.getElementById("btn-grow");
    if (!growBtn) {
      problems.push("Expected #btn-grow to exist inside #action-area — it was not found.");
    } else if (growBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-grow type="button", got "${growBtn.getAttribute("type")}".`);
    }
  }

  // ─── DOM shows a numeric wood value (page engine is running) ────

  if (woodEl) {
    const text = woodEl.textContent.trim();
    const num = parseFloat(text);
    if (isNaN(num)) {
      problems.push(`#wood-value should show a numeric value, got "${text}".`);
    } else if (num < 0) {
      problems.push(`#wood-value should not be negative, got ${num}.`);
    }
  }

  // ─── Engine module ──────────────────────────────────────────────

  try {
    const engine = await import("./engine.js");

    // --- Test 1: initial state shape ---
    engine.reset();
    const fresh = engine.getState();
    if (typeof fresh.wood !== "number" || fresh.wood !== 0) {
      problems.push(`Engine initial wood should be 0, got ${JSON.stringify(fresh.wood)}.`);
    }
    if (typeof fresh.rate !== "number" || fresh.rate !== 0.1) {
      problems.push(`Engine initial rate should be 0.1, got ${JSON.stringify(fresh.rate)}.`);
    }
    if (typeof fresh.timestamp !== "string" || fresh.timestamp.length === 0) {
      problems.push(`Engine initial timestamp should be a non-empty ISO string, got ${JSON.stringify(fresh.timestamp)}.`);
    }

    // --- Test 2: persistence round-trip ---
    engine.reset();
    localStorage.removeItem("selfgrow-state");
    engine.save();

    const raw = localStorage.getItem("selfgrow-state");
    if (!raw) {
      problems.push("Engine save() should write to localStorage, but the key was not found.");
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.wood !== "number" || parsed.wood !== 0) {
          problems.push(`localStorage state after save() should have wood=0, got ${JSON.stringify(parsed.wood)}.`);
        }
        if (typeof parsed.rate !== "number" || parsed.rate !== 0.1) {
          problems.push(`localStorage state after save() should have rate=0.1, got ${JSON.stringify(parsed.rate)}.`);
        }
        if (typeof parsed.timestamp !== "string" || parsed.timestamp.length === 0) {
          problems.push(`localStorage state after save() should have a non-empty timestamp.`);
        }
      } catch {
        problems.push("localStorage value from engine.save() is not valid JSON.");
      }
    }

    // --- Test 3: getState returns a snapshot (not a reference) ---
    engine.reset();
    const snap1 = engine.getState();
    snap1.wood = 999; // mutate the returned object
    const snap2 = engine.getState();
    if (snap2.wood !== 0) {
      problems.push("getState() must return a copy — mutating the returned object should not affect engine state.");
    }

    // --- Test 4: agent tool returns real state ---
    const { tools } = await import("./agenttools.js");
    const toolList = tools();
    const readState = toolList.find((t) => t.name === "read-state");
    if (!readState) {
      problems.push("Expected a tool named 'read-state' in tools() — it was not found.");
    } else {
      const result = await readState.execute({});
      if (typeof result !== "object" || result === null) {
        problems.push("read-state execute() should return an object.");
      } else {
        if (typeof result.wood !== "number") {
          problems.push(`read-state should return wood as a number, got ${JSON.stringify(result.wood)}.`);
        }
        if (typeof result.rate !== "number" || result.rate !== 0.1) {
          problems.push(`read-state should return rate=0.1, got ${JSON.stringify(result.rate)}.`);
        }
        if (typeof result.timestamp !== "string" || result.timestamp.length === 0) {
          problems.push(`read-state should return a non-empty timestamp string, got ${JSON.stringify(result.timestamp)}.`);
        }
        // Verify the result matches the engine's current state
        const s = engine.getState();
        if (result.wood !== s.wood) {
          problems.push(`read-state wood (${result.wood}) does not match engine.getState() wood (${s.wood}).`);
        }
      }
    }

    // --- Test 5: offline catch-up accumulates correctly ---
    engine.reset();
    // Set a state that is 5 seconds in the past
    const fiveSecAgo = new Date(Date.now() - 5000).toISOString();
    const oldState = JSON.stringify({ wood: 0, rate: 0.1, timestamp: fiveSecAgo });
    localStorage.setItem("selfgrow-state", oldState);

    engine.init(); // catches up ~0.5 wood

    const caughtUp = engine.getState();
    // Allow a small tolerance for timer granularity
    if (caughtUp.wood < 0.4 || caughtUp.wood > 0.6) {
      problems.push(
        `Offline catch-up from 5 seconds ago should add ~0.5 wood (0.1/s * 5s). Got ${caughtUp.wood.toFixed(4)}.`
      );
    }

    // Clean up test artifacts and re-init the page engine
    localStorage.removeItem("selfgrow-state");
    engine.reset();
    engine.init();

  } catch (err) {
    problems.push(`Engine module test threw: ${err.message}`);
  }

  return problems;
}