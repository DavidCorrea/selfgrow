/**
 * The product's capabilities, as tools an agent can invoke.
 *
 * Derived from what the page shows a visitor and what it lets them do — nothing
 * more. `get-state` returns every value on the page; `tend` is the Tend the soil
 * button; `plant-seed` is the Plant a seed button; `open-bed` is the Open the
 * next bed button; `open-sandbox`, `fast-forward-sandbox` and `reset-sandbox`
 * are the Rehearse time panel; `export-save` is the Copy save button;
 * `import-save` is the Load save button, and returns the same fields afterwards
 * so the caller can see what it changed.
 */

import {
  SANDBOX_SPANS,
  exportSave,
  fastForwardSandbox,
  getDisplayedState,
  loadGardenSave,
  openSandbox,
  resetSandbox,
  sandboxSpanSeconds,
} from "./app.js";
import { openBed, plantSeed, tend } from "./garden.js";

// The save for the starting garden, so `import-save`'s example always validates
// and runs. Importing it leaves the garden exactly as it starts.
const EXAMPLE_SAVE = "SELFGROW1.eyJ2ZXJzaW9uIjoxLCJzZWVkcyI6MSwicGxhbnRzIjowfQ==";

export function tools() {
  return [
    {
      name: "get-state",
      title: "Read the garden",
      description:
        "Returns everything the page shows a visitor right now: the growth " +
        "total and the rate it is climbing at (in growth per second), the " +
        "garden form the plot is drawing (its name and its index among the " +
        "forms, lowest first), the ungrown seeds sprouting in the soil, the " +
        "grown plants, the total planted (totalPlanted), how many beds of " +
        "soil the garden owns (beds), how many plots those beds make " +
        "(capacity = beds times the plots per bed), the growing time a seed " +
        "takes (growSeconds), the seconds until the next seed matures into a " +
        "plant (secondsToNextPlant, null when no seed is growing), the " +
        "portable save string, and whether this browser is keeping the " +
        "garden. It also returns the next seed: what it costs (nextSeedCost), " +
        "whether the garden can afford it now (canPlantSeed), whether the " +
        "plot is full (plotFull), how far along the cost the garden is as a " +
        "0-to-1 fraction (seedCostProgress), and the seconds until it can " +
        "afford it (secondsToNextSeed, null when full or not growing). Once " +
        "every plot is full it also returns the next bed: what opening it " +
        "costs (nextBedCost), whether the garden can afford it now " +
        "(canOpenBed — only ever true on a full plot), how far along that " +
        "cost it is as a 0-to-1 fraction (bedCostProgress), and the seconds " +
        "until it can afford it (secondsToNextBed, null unless the plot is " +
        "full and the garden is growing). It also reports away: the time " +
        "since the visitor was last here and what it grew — seconds (0 on a " +
        "first visit or a quick reload), earned growth, how many seeds " +
        "matured (matured), the form it started at (from) and reached (to), " +
        "the formsFound on the way, and a plain summary sentence. It also " +
        "reports sandbox: the time rehearsal when one is open — how many " +
        "seconds it has been wound forward and a readable elapsed label, the " +
        "growth, form, ungrown seeds and grown plants it reached, how many " +
        "seeds matured (matured), the return summary the real garden would " +
        "show, and the next goal it would offer (goalTitle, goalDetail) — or " +
        "{open: false} when no sandbox is open. Rehearsing never touches the " +
        "real garden. Ask it before acting so you know what the visitor sees.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return getDisplayedState();
      },
    },
    {
      name: "tend",
      title: "Tend the soil",
      description:
        "Does what the page's Tend the soil button does: earns the garden's " +
        "growth now and raises the rate it keeps growing at, so the total " +
        "climbs on its own afterwards. Safe to repeat, each tend adds more. " +
        "Returns the state afterwards so the caller can see the new total and " +
        "rate.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        tend();
        return getDisplayedState();
      },
    },
    {
      name: "plant-seed",
      title: "Plant a seed",
      description:
        "Does what the page's Plant a seed button does: spends the garden's " +
        "growth on another seed and puts a sprouting seed in the soil. The " +
        "sprout speeds nothing up yet — after growSeconds it matures into a " +
        "grown plant, and it is the grown plant that raises the rate the " +
        "garden keeps growing at. The price rises with every seed or plant " +
        "already in the plot, so get-state's nextSeedCost is what this will " +
        "charge. It refuses, changing nothing, when the garden has not saved " +
        "enough growth or every plot is full — capacity comes from the number " +
        "of beds the garden owns, so open-bed is how a full plot grows. " +
        "Returns whether it planted, the cost, the reason when it refused, " +
        "and the state afterwards.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        const result = plantSeed();
        return { ok: result.ok, reason: result.reason, cost: result.cost, state: getDisplayedState() };
      },
    },
    {
      name: "open-bed",
      title: "Open the next bed of soil",
      description:
        "Does what the page's Open the next bed button does: spends the " +
        "garden's growth on another bed of soil and adds more plots to plant " +
        "in. It is how a plot that is full keeps growing — get-state's " +
        "nextBedCost is what this will charge, and its preconditions are a " +
        "full plot (plotFull) and enough growth (canOpenBed). Opening widens " +
        "the drawn plot and raises the garden's plots of soil (capacity) by " +
        "a whole bed. The next bed costs more than the last, so the price " +
        "climbs. It refuses, changing nothing, when the plot still has room " +
        "to plant or the garden has not saved enough growth. Returns whether " +
        "it opened, the cost, how many beds the garden now owns, the reason " +
        "when it refused, and the state afterwards.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        const result = openBed();
        return {
          ok: result.ok,
          reason: result.reason,
          cost: result.cost,
          beds: result.beds,
          state: getDisplayedState(),
        };
      },
    },
    {
      name: "open-sandbox",
      title: "Open a sandbox garden to rehearse time",
      description:
        "Opens the page's time rehearsal: a copy of the garden kept only in " +
        "memory and wound forward on demand, so a caller can see what an hour, " +
        "a day or a month away would grow without risking the real garden. " +
        "Opening copies the garden as it is now, wound back to its start; " +
        "opening again re-copies it. Nothing the sandbox does is ever saved, " +
        "and the real garden, its save and its last-seen moment are left " +
        "untouched. Use fast-forward-sandbox to wind it forward and " +
        "reset-sandbox to put it back. Returns the state afterwards, whose " +
        "sandbox field is the rehearsal and whose other fields are the " +
        "untouched real garden.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        openSandbox();
        return getDisplayedState();
      },
    },
    {
      name: "fast-forward-sandbox",
      title: "Wind a sandbox garden forward",
      description:
        "Winds the sandbox garden forward by one span — an hour, a day or a " +
        "month — from the snapshot it was opened at, so the result never " +
        "drifts however many times it is called. It opens the sandbox first " +
        "if it is closed, copying the real garden as it is now. Rehearsing " +
        "changes nothing real: the real garden's growth, seeds, plants and " +
        "save stay exactly as they were. Returns the state afterwards; its " +
        "sandbox field carries the wound-forward growth, form, ungrown seeds " +
        "and grown plants, the return summary the real garden would show, and " +
        "the next goal it would offer.",
      inputSchema: {
        type: "object",
        properties: {
          span: {
            type: "string",
            enum: SANDBOX_SPANS.map((entry) => entry.key),
            description: "How far to wind the sandbox: \"hour\", \"day\" or \"month\".",
          },
        },
        required: ["span"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      example: { span: "day" },
      async execute({ span }) {
        fastForwardSandbox(sandboxSpanSeconds(String(span)));
        return getDisplayedState();
      },
    },
    {
      name: "reset-sandbox",
      title: "Reset a sandbox garden to its start",
      description:
        "Puts the sandbox garden back to the moment it was opened, undoing " +
        "every fast-forward. Safe to call when the sandbox is closed: it does " +
        "nothing then, and the state reports sandbox.open false. Changes " +
        "nothing real. Returns the state afterwards.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        resetSandbox();
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
