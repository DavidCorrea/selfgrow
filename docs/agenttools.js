/**
 * The product's capabilities, as tools an agent can invoke.
 *
 * Derived from what the page shows a visitor and what it lets them do — nothing
 * more. `get-state` returns every value on the page; `export-save` is the Copy
 * save button; `import-save` is the Load save button, and returns the same
 * fields afterwards so the caller can see what it changed.
 */

import { getDisplayedState, exportSave, loadGardenSave } from "./app.js";

// The save for the starting garden, so `import-save`'s example always validates
// and runs. Importing it leaves the garden exactly as it starts.
const EXAMPLE_SAVE = "SELFGROW1.eyJ2ZXJzaW9uIjoxLCJzZWVkcyI6MSwicGxhbnRzIjowfQ==";

export function tools() {
  return [
    {
      name: "get-state",
      title: "Read the garden",
      description:
        "Returns everything the page shows a visitor right now: the ungrown " +
        "seeds in the soil, the grown plants, how many plots of soil there are, " +
        "the portable save string, and whether this browser is keeping the " +
        "garden. Ask it before acting so you know what the visitor sees.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return getDisplayedState();
      },
    },
    {
      name: "export-save",
      title: "Copy out the garden save",
      description:
        "Returns the garden's one portable save string — the same value the " +
        "page's Copy save button puts on the clipboard. Use it to carry a " +
        "visitor's garden to another browser, or to keep it somewhere durable.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return { save: exportSave() };
      },
    },
    {
      name: "import-save",
      title: "Load a garden save",
      description:
        "Replaces the whole garden with the one encoded in a save string from " +
        "export-save, writes it to this browser, and returns the state " +
        "afterwards. It overwrites the current garden, so prefer it when the " +
        "visitor is deliberately restoring one. An unreadable save is refused " +
        "and the garden is left as it was.",
      inputSchema: {
        type: "object",
        properties: {
          save: {
            type: "string",
            description: "A save string produced by export-save (starts with SELFGROW1.).",
          },
        },
        required: ["save"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: { save: EXAMPLE_SAVE },
      async execute({ save }) {
        try {
          return loadGardenSave(String(save));
        } catch (e) {
          return { ok: false, error: e.message, state: getDisplayedState() };
        }
      },
    },
  ];
}
