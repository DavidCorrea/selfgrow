/**
 * Check that the selfgrow game page shell works as claimed.
 *
 * Runs in the real browser on the real page, so it can reach the DOM and
 * import agent tools.
 *
 * @returns {Promise<string[]>} empty when everything holds
 */
export async function checks() {
  const problems = [];

  // ─── DOM structure ──────────────────────────────────────────────

  const statusBar = document.getElementById("status-bar");
  if (!statusBar) {
    problems.push("Expected #status-bar to exist in the DOM — it was not found.");
  } else {
    const gpValue = document.getElementById("gp-value");
    if (!gpValue) {
      problems.push("Expected #gp-value to exist inside #status-bar — it was not found.");
    } else if (gpValue.textContent.trim() !== "0") {
      problems.push(`Expected #gp-value to show "0", got "${gpValue.textContent.trim()}".`);
    }
  }

  const actionArea = document.getElementById("action-area");
  if (!actionArea) {
    problems.push("Expected #action-area to exist in the DOM — it was not found.");
  } else {
    const growBtn = document.getElementById("btn-grow");
    if (!growBtn) {
      problems.push("Expected #btn-grow to exist inside #action-area — it was not found.");
    } else if (growBtn.getAttribute("type") !== "button") {
      problems.push(`Expected #btn-grow to be type="button", got "${growBtn.getAttribute("type")}".`);
    }
  }

  // ─── Panels use pixel styling (font-family) ─────────────────────

  const bodyFont = document.body
    ? getComputedStyle(document.body).fontFamily
    : "";
  if (!bodyFont) {
    problems.push("Expected body to have a computed font-family — got empty string.");
  }

  // ─── Agent tools layer ──────────────────────────────────────────

  try {
    const { tools } = await import("./agenttools.js");
    if (typeof tools !== "function") {
      problems.push("agenttools.js must export a function named 'tools'.");
    } else {
      const toolList = tools();
      if (!Array.isArray(toolList) || toolList.length === 0) {
        problems.push("tools() must return a non-empty array.");
      } else {
        const readState = toolList.find((t) => t.name === "read-state");
        if (!readState) {
          problems.push(
            "Expected a tool named 'read-state' in tools() — it was not found."
          );
        } else {
          // Verify schema
          if (
            !readState.inputSchema ||
            readState.inputSchema.type !== "object"
          ) {
            problems.push(
              "read-state tool must have inputSchema with type 'object'."
            );
          }
          // Verify example validates against schema
          if (readState.example !== undefined) {
            const schema = readState.inputSchema;
            if (schema && schema.type === "object") {
              // For an empty schema {}, any object is fine; just check type
              if (typeof readState.example !== "object" || readState.example === null) {
                problems.push("read-state tool example must be an object.");
              }
            }
          }
          // Verify execute returns correct shape
          try {
            const result = await readState.execute({});
            if (
              typeof result !== "object" ||
              result === null ||
              typeof result.resource !== "number" ||
              result.resource !== 0
            ) {
              problems.push(
                `read-state execute() should return { resource: 0 }, got ${JSON.stringify(result)}.`
              );
            }
          } catch (execErr) {
            problems.push(
              `read-state execute() threw: ${execErr.message}`
            );
          }
        }
      }
    }
  } catch (importErr) {
    problems.push(
      `Failed to import agenttools.js: ${importErr.message}`
    );
  }

  return problems;
}