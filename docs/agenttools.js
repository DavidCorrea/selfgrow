/**
 * The product's capabilities, as tools an agent can invoke.
 *
 * Derived from what the page shows a visitor and what it lets them do — nothing
 * more. `get-state` returns every value on the page; `tend` is the Tend the soil
 * button; `plant-seed` is the Plant a seed button; `open-bed` is the Open the
 * next bed button; `replant` is the Replant the garden button; `open-sandbox`,
 * `fast-forward-sandbox`, `act-in-sandbox` and `reset-sandbox` are the Rehearse
 * time panel — the last but one tending, planting and opening a bed inside the
 * rehearsal rather than the real garden; `export-save` is the Copy save button; `import-save` is the Load save button —
 * a two-step, so a call without a confirmation previews what a load would
 * replace and writes nothing, and only a call with `confirm: true` loads it;
 * `restore-save` is the Restore previous garden button — the one undo for a
 * load.
 */

import {
  SANDBOX_SPANS,
  actInSandbox,
  clearReturnMarks,
  exportSave,
  fastForwardSandbox,
  getDisplayedState,
  loadGardenSave,
  openSandbox,
  previewGardenSave,
  resetSandbox,
  restoreGardenSave,
  sandboxSpanSeconds,
} from "./app.js";
import { SEED_KINDS, openBed, plantSeed, replant, tend } from "./garden.js";

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
        "growth the garden has produced over its whole life " +
        "(lifetimeGrowth — it is never spent, so it survives planting a seed " +
        "or opening a bed and keeps climbing across a replant), and what " +
        "replanting right now would earn from that lifetime as a lasting " +
        "bonus (replantBonus — sublinear in the lifetime, so going further in " +
        "one run is worth more than replanting early), whether the garden is " +
        "far enough along to be replanted at all (canReplant — false below the " +
        "bed-of-seedlings wall, so a replant is only ever offered once the " +
        "garden is flourishing), and the lasting bonus a replant has already " +
        "earned (bonus — in growth per second, added flat to the rate the " +
        "garden grows at, 0 before the first replant), and what the garden's " +
        "lifetime has made of the ground, the lasting layer the plot draws " +
        "under its current growth and a replant never resets (established: " +
        "the ground's name and its index among the tiers, the lifetime it " +
        "began at (at) and the next tier's threshold (nextAt), and how far " +
        "through the tier the lifetime is as a 0-to-1 fraction (fill) — " +
        "fresh ground at 0 is a garden that has never produced), the " +
        "season the garden's age falls in (season: its key, name, growth " +
        "multiplier and the pollinator rhythm the season gives — " +
        "pollinatorCycleSeconds and pollinatorBaseVisitSeconds — the cycle " +
        "repeats on its own, no season grows slower than the base rate, and " +
        "the season readout names the kind the year is favouring now, if " +
        "any), the " +
        "pollinator's visit (pollinator: visiting, its multiplier, how long the " +
        "visit lasts in seconds (visitSeconds), the season it is following " +
        "(seasonKey), how often that season brings it (cycleSeconds), the " +
        "visit a garden with no blooms keeps in its season (baseVisitSeconds), " +
        "the longest a visit can stretch (maxVisitSeconds), and how many grown " +
        "blooms are lengthening it (bloomsKeeping) — each bloom adds seconds to " +
        "the visit up to a cap and the season sets the cycle and the base " +
        "visit, so a bed of blooms keeps the x2 boost on the plot for most of " +
        "the season's cycle), " +
        "the " +
        "garden form the plot is drawing (its name and its index among the " +
        "forms, lowest first), the next named form it is growing toward " +
        "(nextFormName, null past the last form), how much growth still " +
        "separates the garden from it (growthToNextForm), and how full that " +
        "stretch is as a 0-to-1 fraction (formProgress), the ungrown seeds " +
        "sprouting in the soil, the " +
        "grown plants, the total planted (totalPlanted), how many beds of " +
        "soil the garden owns (beds), how many plots those beds make " +
        "(capacity = beds times the plots per bed), the growing time a seed " +
        "takes (growSeconds), the seconds until the next seed matures into a " +
        "plant (secondsToNextPlant, null when no seed is growing), the " +
        "portable save string, whether this browser is keeping the garden, " +
        "and whether a load can still be put back (restoreAvailable — true " +
        "only while a garden a load replaced is kept, which restore-save " +
        "spends and another load replaces). It reports the two kinds of seed " +
        "a visitor can plant as " +
        "`kinds`, herb first: each entry carries the kind's name (key), the " +
        "price of its next seed (cost), how much one grown plant adds to the " +
        "growth rate before milestones (production) and what it actually " +
        "earns now (output — production lifted by the milestones that kind " +
        "has reached), how long its sprouts take (growSeconds), " +
        "the season it thrives in (bestSeason) and its own growth boost right " +
        "now (seasonMultiplier — its seasonBoost in its best season and 1 the " +
        "rest of the year), how many of its seeds are ungrown and how many " +
        "plants are grown, and whether the garden can afford it now " +
        "(canPlant). Each kind also has a small ladder of plant-count " +
        "milestones, shown at different counts for each kind: reaching one " +
        "immediately multiplies that kind's output, so the boost is derived " +
        "from the grown-plant counts alone and survives a reload or a return " +
        "with no save change. The entry carries the multiplier its plant " +
        "count has earned (milestoneMultiplier), the next milestone it is " +
        "reaching for (nextMilestone, null once its ladder is climbed) and " +
        "how many more plants of that kind it needs (plantsToMilestone, null " +
        "beside a null nextMilestone), so the caller can say which seed is " +
        "worth planting next. It also returns the " +
        "next seed the goal panel names (nextSeedKind) and what it costs " +
        "(nextSeedCost), whether the garden can afford it now (canPlantSeed), " +
        "whether the plot is full (plotFull), how far along the cost the " +
        "garden is as a 0-to-1 fraction (seedCostProgress), and the seconds " +
        "until it can afford it (secondsToNextSeed, null when full or not " +
        "growing). Once " +
        "every plot is full it also returns the next bed: what opening it " +
        "costs (nextBedCost), whether the garden can afford it now " +
        "(canOpenBed — only ever true on a full plot), how far along that " +
        "cost it is as a 0-to-1 fraction (bedCostProgress), and the seconds " +
        "until it can afford it (secondsToNextBed, null unless the plot is " +
        "full and the garden is growing). It also reports away: the time " +
        "since the visitor was last here and what it grew — seconds (0 on a " +
        "first visit or a quick reload), earned growth, how many seeds it " +
        "sowed into the free plots while away (sown) and what those seeds cost " +
        "out of the growth (sownCost), how many seeds " +
        "matured (matured), the form it started at (from) and reached (to), " +
        "the formsFound on the way, a plain summary sentence, and the same " +
        "facts the page shows as short labelled values (facts, each " +
        "{label, value}). It also " +
        "reports returnMarks: what the last return marked on the plot and the " +
        "readout — how many plants matured (plants) and whether a new form was " +
        "reached (form), or null once the marks clear (a first visit or a quick " +
        "reload marks nothing, and any of tend, plant-seed, open-bed or " +
        "import-save clears the marks). It also " +
        "reports sandbox: the time rehearsal when one is open — how many " +
        "seconds it has been wound forward and a readable elapsed label, the " +
        "growth, form, ungrown seeds and grown plants it reached, how many " +
        "seeds matured (matured), the return summary the real garden would " +
        "show and the same facts as short labelled values (facts), and the " +
        "next goal it would offer (goalTitle, goalDetail) — or " +
        "{open: false} when no sandbox is open. The sandbox carries the " +
        "garden's own controls too: act-in-sandbox can tend, plant-herb, " +
        "plant-bloom and open-bed inside the rehearsal copy, and the sandbox's " +
        "status string says what the last one did. Rehearsing never touches the " +
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
        clearReturnMarks();
        tend();
        return getDisplayedState();
      },
    },
    {
      name: "plant-seed",
      title: "Plant a seed",
      description:
        "Does what the page's Plant a seed buttons do: spends the garden's " +
        "growth on another seed and puts a sprouting seed in the soil. Give " +
        "`kind` as " +
        SEED_KINDS.map((entry) => `"${entry.key}"`).join(" or ") +
        " — herb is the cheap, quick seed and bloom costs more, earns more " +
        "and matures slower; get-state's kinds array reports each kind's " +
        "cost, production and growing time, and its nextSeedKind names the " +
        "seed the goal panel is worth reaching for. The " +
        "sprout speeds nothing up yet — after its growSeconds it matures into " +
        "a grown plant, and it is the grown plant that raises the rate the " +
        "garden keeps growing at. The price rises with every seed or plant " +
        "already in the plot, so get-state's kinds costs are what this will " +
        "charge. It refuses, changing nothing, when the garden has not saved " +
        "enough growth or every plot is full — capacity comes from the number " +
        "of beds the garden owns, so open-bed is how a full plot grows. " +
        "Returns whether it planted, the kind and cost, the reason when it " +
        "refused, and the state afterwards.",
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: SEED_KINDS.map((entry) => entry.key),
            description: "Which seed to plant: \"herb\" (default) or \"bloom\".",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      example: {},
      async execute(input) {
        clearReturnMarks();
        const result = plantSeed(input?.kind ?? "herb");
        return { ok: result.ok, reason: result.reason, cost: result.cost, kind: result.kind, state: getDisplayedState() };
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
        clearReturnMarks();
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
      name: "replant",
      title: "Replant the garden for a lasting bonus",
      description:
        "Does what the page's Replant the garden button does, after the same " +
        "confirmation: it starts a fresh garden — the same soil, one ungrown " +
        "seed and one bed a first visit has — keeping the lifetime growth and " +
        "the save, and sets a lasting bonus earned from that lifetime " +
        "(replantBonus, added flat to the growth rate for every run after). " +
        "get-state's canReplant says whether the garden is far enough along " +
        "(false below the bed-of-seedlings wall) and what a replant would earn " +
        "(replantBonus); a replant is only worth it once the fresh garden will " +
        "pass the old wall faster than the first run did. It refuses, changing " +
        "nothing at all, when the garden is not yet eligible — declining is " +
        "exactly a no-op. Returns whether it replanted, the bonus it set, the " +
        "lifetime growth kept, the reason when it refused, and the state " +
        "afterwards.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: {},
      async execute() {
        clearReturnMarks();
        const result = replant();
        return {
          ok: result.ok,
          reason: result.reason,
          bonus: result.bonus,
          lifetime: result.lifetime,
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
        "and grown plants, the return summary the real garden would show plus " +
        "the same facts as short labelled values (facts), and " +
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
      name: "act-in-sandbox",
      title: "Take a garden action inside the rehearsal",
      description:
        "Does what the page's rehearsal buttons do: runs one of the garden's " +
        "own actions against the sandbox copy instead of the real garden, so a " +
        "visitor can try the decisions they would make over an hour or a month " +
        "away. Give `action` as \"tend\" (earn growth and raise the rate), " +
        "\"plant-herb\" or \"plant-bloom\" (spend the rehearsal's growth on a " +
        "seed), or \"open-bed\" (spend it on another bed once the plot is " +
        "full). It opens the sandbox first if it is closed, settling any time " +
        "already wound forward so the action runs at the moment the rehearsal " +
        "has reached. The rules — cost, capacity and refusals — are the same " +
        "ones the real tend, plant-seed and open-bed apply, but only the " +
        "rehearsal changes: the real garden, its save and its last-seen moment " +
        "stay exactly as they were. Use fast-forward-sandbox to wind the " +
        "rehearsal forward around the actions, and reset-sandbox to put it back " +
        "to the moment it opened. Returns whether it took, the action, the " +
        "reason when it refused, the cost it spent, how many beds the rehearsal " +
        "now owns, and the whole state afterwards — whose sandbox field is the " +
        "acted rehearsal beside the untouched real garden.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["tend", "plant-herb", "plant-bloom", "open-bed"],
            description:
              "Which garden action to take inside the rehearsal: tend, " +
              "plant-herb, plant-bloom or open-bed.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      example: { action: "tend" },
      async execute({ action }) {
        const result = actInSandbox(String(action));
        const state = getDisplayedState();
        return {
          ok: result.ok,
          action: result.action,
          reason: result.reason ?? null,
          cost: result.cost ?? 0,
          beds: state.sandbox?.open ? state.sandbox.beds : null,
          state,
        };
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
        "Loads a save string from export-save into the whole garden and writes " +
        "it to this browser. A load replaces everything the visitor is watching, " +
        "so it is deliberately two steps and does not change the garden until " +
        "confirmed: a call without confirm: true applies nothing and returns what " +
        "the save holds beside what the garden holds now — current and incoming, " +
        "each with growth, seeds, plants, beds and lifetime, and changes listing " +
        "the fields that differ (from, to) — plus needsConfirmation: true and " +
        "applied: false. Call again with confirm: true to load it; the return then " +
        "carries applied: true, whether the browser kept it (persisted), and the " +
        "state afterwards. An unreadable save is refused with its reason and the " +
        "garden is left exactly as it was, confirmed or not.",
      inputSchema: {
        type: "object",
        properties: {
          save: {
            type: "string",
            description: "A save string produced by export-save (starts with SELFGROW1.).",
          },
          confirm: {
            type: "boolean",
            description:
              "Set true to actually load the save. Omitted or false returns the " +
              "preview and changes nothing.",
          },
        },
        required: ["save"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: { save: EXAMPLE_SAVE },
      async execute({ save, confirm }) {
        const text = String(save);
        let preview;
        try {
          preview = previewGardenSave(text);
        } catch (e) {
          return { ok: false, applied: false, error: e.message, state: getDisplayedState() };
        }
        if (confirm !== true) {
          return { ok: true, applied: false, needsConfirmation: true, preview, state: getDisplayedState() };
        }
        return { ...loadGardenSave(text), applied: true, preview };
      },
    },
    {
      name: "restore-save",
      title: "Restore the garden the last load replaced",
      description:
        "Does what the page's Restore previous garden button does, and is the " +
        "one undo for import-save: it puts back the garden the most recent " +
        "load replaced — the same growth, seeds, plants, beds, lifetime and " +
        "lasting bonus it had — and writes it to this browser, so a wrong or " +
        "regretted load costs the visitor nothing. get-state's restoreAvailable " +
        "says whether there is such a garden: it is true only after a load has " +
        "replaced one this session, and false once this tool has spent it or " +
        "another load has replaced it. Safe to repeat: the first call spends " +
        "the kept garden, so a second call changes nothing and reports " +
        "restored: false with the reason. Returns whether it restored, what " +
        "came back (restoredContents: growth, seeds, plants, beds and " +
        "lifetime), whether the browser kept it (persisted), and the state " +
        "afterwards.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: {},
      async execute() {
        return restoreGardenSave();
      },
    },
  ];
}
