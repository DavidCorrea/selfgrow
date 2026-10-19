/**
 * Check that the garden still does what it promises.
 *
 * Return an array of plain-language failure messages — empty when everything
 * holds. Each message names what broke and what was expected, so an agent
 * deciding what to fix knows where to look.
 *
 * The checks cover the things a person and an agent rely on: the save codec
 * refuses everything it should, the browser copy survives a reload, the page's
 * readout equals the state behind it, a save can leave and come back, the
 * growth always maps to the same drawn form and the same words at both ends of
 * the scale, and a seed costs rising growth and buys rising production with the
 * next goal always on the page as progress and time. They snapshot the garden
 * and the browser's storage and restore both, so they leave no residue and run
 * fast.
 */

import {
  GROW_SECONDS,
  KIND_MILESTONES,
  LAST_SEEN_KEY,
  MILESTONE_MULTIPLIER,
  PLANT_PRODUCTION,
  PLOTS_PER_BED,
  POLLINATOR_BLOOM_VISIT_SECONDS,
  POLLINATOR_BOOST,
  POLLINATOR_CYCLE_SECONDS,
  POLLINATOR_VISIT_MAX_SECONDS,
  POLLINATOR_VISIT_SECONDS,
  PLOT_CAPACITY,
  REPLANT_MIN_BONUS,
  SAVE_PREFIX,
  SAVE_VERSION,
  SEASONS,
  SEASON_CYCLE_SECONDS,
  SEASON_SECONDS,
  SEED_COST_BASE,
  SEED_COST_RATE,
  SEED_KINDS,
  STARTING_GROW_SECONDS,
  STORAGE_KEY,
  TEND_RATE_STEP,
  TEND_YIELD,
  addVisitTime,
  advance,
  decodeSave,
  elapsedSeconds,
  encodeSave,
  gardenKinds,
  getGarden,
  getGrowthState,
  kindIndex,
  kindMilestoneMultiplier,
  kindSeasonMultiplier,
  milestoneBoost,
  newGarden,
  nextBedCost,
  nextKindMilestone,
  nextSeedCost,
  pollinatorAt,
  pollinatorBaseVisitSeconds,
  pollinatorCycleSeconds,
  pollinatorSecondsWithin,
  pollinatorVisitSeconds,
  plantSeed,
  readLastSeen,
  replant,
  replantBonus,
  canReplant,
  seasonAt,
  seasonMultiplierSecondsWithin,
  readStoredGarden,
  setGarden,
  setGrowth,
  simulateGarden,
  storageAvailable,
  tend,
  writeLastSeen,
  writeStoredGarden,
} from "./garden.js";
import {
  MIN_AWAY_SECONDS,
  actInSandbox,
  announceSnapshot,
  applyReturn,
  arrivalAnnouncement,
  buildAwayReport,
  clearReturnMarks,
  closeSandbox,
  describeAnnouncements,
  describeKind,
  describePlot,
  describePollinator,
  exportSave,
  fastForwardSandbox,
  formatAmount,
  formatDuration,
  formatGrowth,
  getAnnouncement,
  getDisplayedState,
  getSandboxState,
  loadGardenSave,
  openSandbox,
  previewGardenSave,
  readPalette,
  resetSandbox,
  restoreGardenSave,
  returnAnnouncement,
  returnFacts,
  returnMarkFor,
  sandboxPlotState,
  summarizeReturn,
  visitAnnouncement,
} from "./app.js";
import {
  ESTABLISHMENTS,
  FORMS,
  drawGarden,
  drawKindSwatch,
  establishment,
  gardenForm,
  groundCover,
  groundEdge,
  motionPhase,
  plotBounds,
  plotCells,
  plotMarks,
  plotMilestoneTiers,
  pollinatorPlot,
  returnMarkCells,
  seasonLook,
  soilFace,
  tendedMarkCells,
  tendedWorkCells,
} from "./plotview.js";

// The design system is itself a promise: one palette, two embedded pixel fonts
// split by role, square pixel edges. These are the checks for it.
const TITLE_FONT = "Silkscreen";
const BODY_FONT = "Pixelify Sans";
const RETIRED_FONT = "Press Start 2P";

/** A colour as {r,g,b,a}, or null for anything that is not one. */
function parseColor(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (text === "transparent" || text === "none") return null;

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) {
      digits = digits.split("").map((c) => c + c).join("");
    }
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }

  const rgb = text.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/
  );
  if (!rgb) return null;
  let alpha = 1;
  if (rgb[4] !== undefined) {
    alpha = rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
  }
  return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alpha };
}

const colorKey = (color) => `${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)}`;

/** Every colour token declared in a `:root` block, by resolved rgb. */
function paletteTokens() {
  const tokens = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet we cannot read; none of ours are.
    }
    for (const rule of rules) {
      if (!rule.selectorText || !rule.selectorText.includes(":root")) continue;
      const declarations = /--([a-z0-9-]+)\s*:\s*([^;}]+)/gi;
      let match;
      while ((match = declarations.exec(rule.cssText || ""))) {
        const color = parseColor(match[2].trim());
        if (color && color.a > 0) tokens.set(match[1], colorKey(color));
      }
    }
  }
  return tokens;
}

function describe(el, what) {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList && el.classList.length ? `.${el.classList[0]}` : "";
  return `${what} on ${el.tagName.toLowerCase()}${id}${cls}`;
}

/**
 * A growing control's availability, as the page must present it: a control the
 * garden cannot use right now stays reachable — focusable and pressable, never
 * the `disabled` attribute, which would swallow the press — and says it is
 * unavailable through `aria-disabled` so assistive technology knows. Returns a
 * failure message, or "" when the control presents exactly `canAct`.
 */
function availabilityProblem(button, canAct, context) {
  if (button.disabled) {
    return (
      `${context} is switched off with the disabled attribute, so pressing it does nothing and the visitor ` +
      "is never told why it cannot act."
    );
  }
  const markedUnavailable = button.getAttribute("aria-disabled") === "true";
  if (canAct && markedUnavailable) {
    return `${context} can act but is marked aria-disabled="true".`;
  }
  if (!canAct && !markedUnavailable) {
    return (
      `${context} cannot act but is not marked aria-disabled="true", so assistive technology is not told ` +
      "it is unavailable."
    );
  }
  return "";
}

function fontFaces() {
  const faces = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet we cannot read; none of ours are.
    }
    for (const rule of rules) {
      const src = rule.style && rule.style.getPropertyValue("src");
      if (!src) continue;
      faces.push({
        family: rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim(),
        src,
      });
    }
  }
  return faces;
}

// The type is split by role: Silkscreen sets the titles, Pixelify Sans sets
// everything else, and Press Start 2P is gone. Each half is checked on its own,
// so a page that keeps the old face or drops one of the new ones fails here.
function checkPixelFont(problems) {
  const faces = fontFaces();
  if (!faces.length) {
    problems.push("no @font-face is declared, so no pixel font ships with the page.");
  }

  const shipped = new Set();
  for (const face of faces) {
    const family = face.family.toLowerCase();
    shipped.add(family);
    if (family.includes(RETIRED_FONT.toLowerCase())) {
      problems.push(`the page still declares a "${face.family}" @font-face; Press Start 2P must not be used anywhere.`);
    } else if (family !== TITLE_FONT.toLowerCase() && family !== BODY_FONT.toLowerCase()) {
      problems.push(
        `the page declares an unexpected font family "${face.family}"; only "${TITLE_FONT}" and "${BODY_FONT}" may be embedded.`
      );
    }
    const urls = [...face.src.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1].replace(/["']/g, "").trim());
    if (!urls.length || urls.some((url) => !url.startsWith("data:"))) {
      problems.push(
        `"${face.family}" is loaded from a network location (${face.src}) — it must ship as an embedded data: URI.`
      );
    }
  }
  for (const family of [TITLE_FONT, BODY_FONT]) {
    if (!shipped.has(family.toLowerCase())) {
      problems.push(`no @font-face embeds "${family}", so text cannot render in it.`);
    }
  }

  // Every role computes to the face the design assigns it, so a rule that is
  // declared but never applied is caught too.
  const roles = [
    ["body", document.body, BODY_FONT],
    [".brand", document.querySelector(".brand"), TITLE_FONT],
    [".panel-title", document.querySelector(".panel-title"), TITLE_FONT],
    [".goal-title", document.querySelector(".goal-title"), TITLE_FONT],
    [".readout-term", document.querySelector(".readout-term"), BODY_FONT],
    [".btn", document.querySelector(".btn"), BODY_FONT],
    [".readout-value", document.querySelector(".readout-value"), BODY_FONT],
  ];
  for (const [label, el, expected] of roles) {
    if (!el) {
      problems.push(`the page has no ${label} to check the type against.`);
      continue;
    }
    const family = getComputedStyle(el).fontFamily;
    if (!family.toLowerCase().includes(expected.toLowerCase())) {
      problems.push(`${label} is set in "${family}", expected "${expected}".`);
    }
  }

  // Nothing anywhere on the page may still compute to the retired face.
  const stillRetired = [];
  for (const el of document.querySelectorAll("body *")) {
    if (getComputedStyle(el).fontFamily.toLowerCase().includes(RETIRED_FONT.toLowerCase())) {
      stillRetired.push(describe(el, "text"));
    }
  }
  if (stillRetired.length) {
    problems.push(
      `${stillRetired.length} element(s) still render in "${RETIRED_FONT}": ${stillRetired.slice(0, 4).join("; ")}.`
    );
  }
}

function checkPalette(problems) {
  const palette = paletteTokens();
  if (palette.size < 5) {
    problems.push(
      `could not read a palette from :root in garden.css (found ${palette.size} colour tokens) — expected the whole fixed palette declared in one place.`
    );
    return;
  }
  const allowed = new Set(palette.values());
  const offenders = [];

  const checkValue = (value, where) => {
    const color = parseColor(value);
    if (!color || color.a === 0) return;
    if (!allowed.has(colorKey(color))) offenders.push(`${where} is ${value}`);
  };

  const elements = [document.documentElement, document.body, ...document.querySelectorAll("body *")];
  for (const el of elements) {
    const style = getComputedStyle(el);
    checkValue(style.color, describe(el, "text"));
    checkValue(style.backgroundColor, describe(el, "background"));
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (style[`border${side}Style`] && style[`border${side}Style`] !== "none" &&
          parseFloat(style[`border${side}Width`]) > 0) {
        checkValue(style[`border${side}Color`], describe(el, "border"));
      }
    }
    if (style.outlineStyle && style.outlineStyle !== "none") {
      checkValue(style.outlineColor, describe(el, "outline"));
    }
  }

  if (offenders.length) {
    problems.push(
      `${offenders.length} colour(s) on the page are not in the :root palette: ${offenders
        .slice(0, 6)
        .join("; ")}.`
    );
  }
}

function checkPixelEdges(problems) {
  const look = [
    ["panel", document.querySelector(".panel")],
    ["button", document.querySelector(".btn")],
  ];
  for (const [label, el] of look) {
    if (!el) {
      problems.push(`the page has no sample ${label} to show the shared pixel style.`);
      continue;
    }
    const style = getComputedStyle(el);
    if (style.borderRadius !== "0px") {
      problems.push(`the ${label} has rounded corners (${style.borderRadius}); pixel edges must be square.`);
    }
    if (parseFloat(style.borderTopWidth) < 2) {
      problems.push(`the ${label} has no visible border (top width ${style.borderTopWidth}); it must share the pixel edge.`);
    }
  }
}

// --- The garden's own behavior ----------------------------------------------

function checkStartState(problems) {
  const start = newGarden();
  if (start.seeds !== 1 || start.plants !== 0 || start.beds !== 1) {
    problems.push(
      `a new garden should be bare soil with one bed and one ungrown seed (1 bed, 1 seed, 0 plants), but it is ` +
      `${start.beds} bed(s), ${start.seeds} seed(s) and ${start.plants} plant(s).`
    );
  }

  const empty = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { garden } = readStoredGarden(empty);
  if (garden.seeds !== 1 || garden.plants !== 0 || garden.beds !== 1) {
    problems.push(
      `a first visit with nothing saved should open the starting garden (1 bed, 1 seed, 0 plants), ` +
      `but it opened ${garden.beds} bed(s), ${garden.seeds} seed(s) and ${garden.plants} plant(s).`
    );
  }
}

/**
 * A fresh garden has to be alive from the first frame: its starter seed matures
 * within seconds, so growth and the rate both move without the visitor waiting
 * on anything, and the garden leaves bare soil well inside the first half
 * minute. Pure: it only reads `newGarden` and the simulation, so it cannot
 * disturb the live garden.
 */
function checkFreshGardenStartsGrowing(problems) {
  const start = newGarden();
  const starterTimers = Array.isArray(start.sprouts) ? start.sprouts : [];
  if (starterTimers.length !== 1 || !(starterTimers[0] > 0 && starterTimers[0] <= 5)) {
    problems.push(
      `a fresh garden should start with one seed maturing within 5s, but its sprout timers are ` +
        `${JSON.stringify(start.sprouts)}.`
    );
  }

  // The starter is shorter than the herb kind on purpose; the kind's own pace
  // must not change, so every planted herb seed and every existing save keeps it.
  const herb = SEED_KINDS[0];
  if (herb.growSeconds !== GROW_SECONDS || !(STARTING_GROW_SECONDS < herb.growSeconds)) {
    problems.push(
      `the starter seed should mature faster than the herb kind while the kind keeps its ` +
        `${GROW_SECONDS}s, but the starter is ${STARTING_GROW_SECONDS}s and the herb kind is ${herb.growSeconds}s.`
    );
  }

  const afterFive = simulateGarden(newGarden(), 5);
  if (!(afterFive.rate > 0)) {
    problems.push(
      `five seconds into a fresh garden the rate is still ${afterFive.rate}/s; the starter seed should have ` +
        `matured and started it rising.`
    );
  }
  if (!(afterFive.growth > 0)) {
    problems.push(
      `five seconds into a fresh garden growth is still ${afterFive.growth}; the garden should have earned ` +
        `something on its own.`
    );
  }

  const afterThirty = simulateGarden(newGarden(), 30);
  const form = gardenForm(afterThirty.growth);
  if (!(form.index >= 1)) {
    problems.push(
      `half a minute into a fresh garden it is still "${form.name}" (form ${form.index}); it should have ` +
        `moved off bare soil into its first named form.`
    );
  }
}

function checkSaveCodec(problems) {
  const samples = [
    newGarden(),
    { seeds: 0, plants: 0 },
    { seeds: 5, plants: 3 },
    { seeds: PLOT_CAPACITY, plants: 0 },
    { seeds: 5, plants: 3, beds: 3 },
  ];
  for (const sample of samples) {
    const beds = sample.beds ?? 1;
    let roundTripped;
    try {
      roundTripped = decodeSave(encodeSave(sample));
    } catch (e) {
      problems.push(`a save could not round-trip (${sample.seeds} seeds, ${sample.plants} plants): ${e.message}`);
      continue;
    }
    if (roundTripped.seeds !== sample.seeds || roundTripped.plants !== sample.plants || roundTripped.beds !== beds) {
      problems.push(
        `a save did not round-trip: put in ${beds} beds / ${sample.seeds} seeds / ${sample.plants} plants, ` +
        `got back ${roundTripped.beds} / ${roundTripped.seeds} / ${roundTripped.plants}.`
      );
    }
  }

  // A seed part-way through growing must come back with its timer intact, not
  // reset, or time away would restart every sprout.
  const ripening = { plants: 1, sprouts: [4.5, GROW_SECONDS, 0.25] };
  try {
    const back = decodeSave(encodeSave(ripening));
    if (JSON.stringify(back.sprouts) !== JSON.stringify(ripening.sprouts)) {
      problems.push(
        `a save put in sprout timers ${JSON.stringify(ripening.sprouts)} and gave back ` +
          `${JSON.stringify(back.sprouts)}.`
      );
    }
  } catch (e) {
    problems.push(`a save carrying sprout timers could not round-trip: ${e.message}`);
  }

  // A version-3 save predates beds: it opens onto exactly one bed, and its rate
  // is kept as it was, because its grown plants already carried the production.
  const version3 = `${SAVE_PREFIX}${btoa(
    JSON.stringify({ version: 3, seeds: 2, plants: 1, growth: 5, rate: 0.5, sprouts: [10, 5] })
  )}`;
  try {
    const migrated = decodeSave(version3);
    if (migrated.beds !== 1) {
      problems.push(`a version-3 save should migrate to 1 bed, but it migrated to ${migrated.beds} beds.`);
    }
    if (migrated.rate !== 0.5) {
      problems.push(
        `a version-3 save's rate should be kept as 0.5 (its plants already produced), but it became ${migrated.rate}.`
      );
    }
  } catch (e) {
    problems.push(`a version-3 save should still load, but it was refused: ${e.message}`);
  }

  // The version before age carried real beds. Widening the save format must not
  // fold a garden's several beds back into one, and a save from before age must
  // open at age zero rather than in the middle of a pollinator's cycle.
  const version4 = `${SAVE_PREFIX}${btoa(
    JSON.stringify({ version: 4, seeds: 2, plants: 1, growth: 5, rate: 0.5, sprouts: [10, 5], beds: 3 })
  )}`;
  try {
    const migrated = decodeSave(version4);
    if (migrated.beds !== 3) {
      problems.push(`a version-4 save should keep its 3 beds, but it migrated to ${migrated.beds} bed(s).`);
    }
    if (migrated.age !== 0) {
      problems.push(`a version-4 save should migrate to age 0, but it migrated to age ${migrated.age}.`);
    }
  } catch (e) {
    problems.push(`a version-4 save should still load, but it was refused: ${e.message}`);
  }

  const payload = (value) => `SELFGROW1.${btoa(JSON.stringify(value))}`;
  const rejects = [
    ["an empty string", ""],
    ["plain text", "hello there"],
    ["the prefix with no body", "SELFGROW1."],
    ["the prefix with broken base64", "SELFGROW1.!!!not-base64!!!"],
    ["a save with no version", payload({ seeds: 1, plants: 0 })],
    ["an impossible version", payload({ version: SAVE_VERSION + 1, seeds: 1, plants: 0 })],
    ["negative seeds", payload({ version: SAVE_VERSION, seeds: -1, plants: 0 })],
    ["a fractional seed count", payload({ version: SAVE_VERSION, seeds: 1.5, plants: 0 })],
    ["seeds given as text", payload({ version: SAVE_VERSION, seeds: "1", plants: 0 })],
    ["seeds beyond a finite number", payload({ version: SAVE_VERSION, seeds: 1e999, plants: 0 })],
    ["plants missing", payload({ version: SAVE_VERSION, seeds: 1 })],
    ["beds below one", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, beds: 0 })],
    ["a fractional bed count", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, beds: 1.5 })],
    ["a negative age", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0, rate: 0, age: -1 })],
    ["an age that is not a number", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0, rate: 0, age: "1" })],
  ];
  for (const [label, value] of rejects) {
    try {
      decodeSave(value);
      problems.push(`the save reader accepted ${label} (${JSON.stringify(value)}); it should refuse it.`);
    } catch {
      // refused, as it must be.
    }
  }
}

function checkDurableSave(problems) {
  // A real Map-backed store, so writing and reading exercise the same code path
  // the browser uses without touching the visitor's actual storage.
  const backing = new Map();
  const storage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
  };

  const garden = { seeds: 7, plants: 3 };
  const written = writeStoredGarden(garden, storage);
  if (!written) {
    problems.push("writing the garden to a working store reported failure.");
    return;
  }
  const { garden: restored, damaged } = readStoredGarden(storage);
  if (damaged || restored.seeds !== 7 || restored.plants !== 3) {
    problems.push(
      `a garden written to the store did not come back: expected 7 seeds / 3 plants, ` +
      `got ${restored.seeds} / ${restored.plants}${damaged ? " (reported damaged)" : ""}.`
    );
  }

  const broken = {
    getItem: () => "SELFGROW1.not-a-real-save",
    setItem: () => {},
    removeItem: () => {},
  };
  const fromBroken = readStoredGarden(broken);
  if (!fromBroken.damaged || fromBroken.garden.seeds !== 1 || fromBroken.garden.plants !== 0) {
    problems.push("a corrupt stored save should be reported damaged and replaced with a fresh garden.");
  }

  const dead = {
    getItem: () => {
      throw new Error("storage blocked");
    },
    setItem: () => {
      throw new Error("storage blocked");
    },
    removeItem: () => {},
  };
  if (storageAvailable(dead)) {
    problems.push("a store that throws on every write was reported as available.");
  }
  if (writeStoredGarden(garden, dead)) {
    problems.push("writing to a store that throws reported success.");
  }
  if (readStoredGarden(dead).garden.seeds !== 1) {
    problems.push("reading a store that throws should fall back to a fresh garden.");
  }
}

function checkPageReadout(problems) {
  const state = getDisplayedState();

  for (const field of ["seeds", "plants", "beds", "capacity"]) {
    const el = document.querySelector(`[data-field="${field}"]`);
    if (!el) {
      problems.push(`the page has no readout for the garden's ${field} (expected [data-field="${field}"]).`);
      continue;
    }
    const shown = String(el.textContent).trim();
    const expected = formatAmount(state[field]);
    if (shown !== expected) {
      problems.push(
        `the page shows ${JSON.stringify(shown)} for ${field}, but the garden holds ${state[field]} (${expected}).`
      );
    }
  }

  const storageEl = document.querySelector('[data-field="storage"]');
  if (!storageEl) {
    problems.push("the page does not say whether this browser is keeping the garden.");
  } else {
    const shown = String(storageEl.textContent).trim();
    const expected = state.storageAvailable ? "Yes" : "No";
    if (shown !== expected) {
      problems.push(`the page says storage is "${shown}", but the store is ${state.storageAvailable ? "available" : "unavailable"}.`);
    }
  }

  const textarea = document.getElementById("save-value");
  if (!textarea) {
    problems.push("the page has no save field (#save-value) to copy out of.");
  } else if (textarea.value !== exportSave() || textarea.value !== state.save) {
    problems.push(
      `the save field shows ${JSON.stringify(textarea.value)}, but the garden's save is ${JSON.stringify(exportSave())}.`
    );
  }

  const formEl = document.querySelector('[data-field="form"]');
  if (!formEl) {
    problems.push(
      'the page has no garden-form readout (expected [data-field="form"]), so the form the plot draws is not stated in words.'
    );
  } else if (String(formEl.textContent).trim() !== state.formName) {
    problems.push(
      `the page names the garden form ${JSON.stringify(String(formEl.textContent).trim())}, ` +
      `but the plot draws ${JSON.stringify(state.formName)}.`
    );
  }

  const description = document.getElementById("plot-description");
  if (!description || !description.textContent.trim()) {
    problems.push("the plot has no text description, so the picture is the only account of the garden.");
  } else {
    const text = description.textContent;
    const expected = [
      ["growth", formatGrowth(state.growth)],
      ["the garden form", state.formName],
      ["seeds", formatAmount(state.seeds)],
      ["plants", formatAmount(state.plants)],
    ];
    for (const [what, value] of expected) {
      if (!text.includes(value)) {
        problems.push(`the plot description does not state ${what} (${value}): "${text}"`);
      }
    }
  }

  if (state.capacity !== PLOT_CAPACITY) {
    problems.push(`the displayed capacity is ${state.capacity}, expected the garden's ${PLOT_CAPACITY} plots.`);
  }
}

function checkPortableSave(problems) {
  const before = getGarden();
  const growthBefore = getGrowthState();
  const beforeRaw = rawStorage();
  try {
    const portable = encodeSave({ seeds: 4, plants: 2 });
    const result = loadGardenSave(portable);
    if (!result.ok) {
      problems.push("loading a valid save did not report success.");
    }
    const now = getGarden();
    if (now.seeds !== 4 || now.plants !== 2) {
      problems.push(`loading a save for 4 seeds / 2 plants left the garden at ${now.seeds} / ${now.plants}.`);
    }
    const seedsEl = document.querySelector('[data-field="seeds"]');
    if (seedsEl && String(seedsEl.textContent).trim() !== formatAmount(4)) {
      problems.push(`after loading a save, the page shows ${JSON.stringify(seedsEl.textContent)} seeds instead of 4.`);
    }
    if (exportSave() !== portable) {
      problems.push("exporting the garden after loading a save did not give the same portable string back.");
    }

    const guarded = getGarden();
    try {
      loadGardenSave("definitely not a save");
      problems.push("loading an invalid save did not refuse it.");
    } catch {
      // refused, as it must be.
    }
    const after = getGarden();
    if (after.seeds !== guarded.seeds || after.plants !== guarded.plants) {
      problems.push("a refused save changed the garden anyway.");
    }
  } finally {
    setGarden(before);
    restoreGrowth(growthBefore);
    restoreRawStorage(beforeRaw);
  }
}

/**
 * Loading a save is confirm-first on the page too: pressing Load save shows
 * what the pasted save holds beside the garden now and changes nothing, only
 * Load now applies it, and Keep this garden closes the dialog as a pure no-op.
 * `previewGardenSave` itself must only read — it never writes the garden or the
 * stored save.
 */
function checkLoadConfirm(problems) {
  const dialog = document.getElementById("load-dialog");
  const confirm = document.getElementById("load-confirm");
  const cancel = document.getElementById("load-cancel");
  const load = document.getElementById("load-save");
  if (!dialog || !confirm || !cancel || !load) {
    problems.push(
      "the page has no Load-this-save confirmation (expected #load-dialog, #load-confirm, #load-cancel and #load-save)."
    );
    return;
  }
  if (
    typeof dialog.showModal !== "function" ||
    confirm.tagName !== "BUTTON" ||
    cancel.tagName !== "BUTTON" ||
    confirm.disabled ||
    cancel.disabled ||
    !confirm.textContent.trim() ||
    !cancel.textContent.trim()
  ) {
    problems.push("the Load dialog's Load now and Keep this garden controls are not named, focusable buttons.");
  }

  const fold = document.querySelector("details.fold");
  const foldWasOpen = fold ? fold.open : null;
  const saveField = document.getElementById("save-value");
  const saveFieldValue = saveField ? saveField.value : null;
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  try {
    setGarden({ beds: 2, seeds: 3, plants: 2 });
    setGrowth(70, 1.5, 120, 700, 6);
    writeStoredGarden(getGarden());

    const portable = encodeSave({ beds: 1, seeds: 5, plants: 4, growth: 45, lifetime: 2500 });
    const incoming = decodeSave(portable);
    if (saveField) saveField.value = portable;
    const storedLive = rawStorage().value;
    const liveGarden = getGarden();
    const liveGrowth = getGrowthState();

    // The preview only reads: the garden, the growth and the stored save are all
    // left exactly where they were.
    const preview = previewGardenSave(portable);
    if (
      preview.current.growth !== liveGrowth.growth ||
      preview.current.seeds !== liveGarden.seeds ||
      preview.current.beds !== liveGarden.beds ||
      preview.incoming.growth !== incoming.growth ||
      preview.incoming.lifetime !== incoming.lifetime ||
      !Array.isArray(preview.changes)
    ) {
      problems.push("previewGardenSave did not report the garden now beside what the save holds.");
    }
    if (
      JSON.stringify(getGarden()) !== JSON.stringify(liveGarden) ||
      JSON.stringify(getGrowthState()) !== JSON.stringify(liveGrowth) ||
      rawStorage().value !== storedLive
    ) {
      problems.push("previewGardenSave changed the garden or the stored save — it must only read.");
    }

    // Pressing Load save shows the dialog and writes nothing.
    if (fold) fold.open = true;
    load.click();
    if (!dialog.open) {
      problems.push("pressing Load save did not open the Load-this-save dialog.");
    }
    const growthRow = document.getElementById("load-dialog-growth");
    if (growthRow && !String(growthRow.textContent).includes(formatGrowth(incoming.growth))) {
      problems.push(
        `the Load dialog's Growth row is ${JSON.stringify(growthRow.textContent)}, expected it to name the save's ` +
          `${formatGrowth(incoming.growth)}.`
      );
    }
    const afterOpen = getGarden();
    const afterOpenGrowth = getGrowthState();
    if (
      afterOpen.seeds !== liveGarden.seeds ||
      afterOpen.beds !== liveGarden.beds ||
      afterOpenGrowth.growth !== liveGrowth.growth ||
      rawStorage().value !== storedLive
    ) {
      problems.push("pressing Load save changed the garden before it was confirmed.");
    }

    // Keep this garden (or Esc) closes the dialog and changes nothing.
    cancel.click();
    if (dialog.open) problems.push("Keep this garden did not close the Load dialog.");
    if (getGarden().seeds !== liveGarden.seeds || getGrowthState().growth !== liveGrowth.growth) {
      problems.push("Keep this garden changed the garden even though it was declined.");
    }

    // Load now applies the previewed save.
    load.click();
    confirm.click();
    if (dialog.open) problems.push("Load now did not close the Load dialog.");
    const loaded = getGarden();
    const loadedGrowth = getGrowthState();
    if (
      loaded.seeds !== incoming.seeds ||
      loaded.plants !== incoming.plants ||
      loaded.beds !== incoming.beds ||
      loadedGrowth.growth !== incoming.growth
    ) {
      problems.push(
        `Load now left ${loaded.seeds} seeds / ${loaded.plants} plants / ${loaded.beds} beds / ${loadedGrowth.growth} ` +
          `growth, expected the save's ${incoming.seeds} / ${incoming.plants} / ${incoming.beds} / ${incoming.growth}.`
      );
    }
  } finally {
    if (dialog.open) dialog.close();
    if (fold && foldWasOpen !== null) fold.open = foldWasOpen;
    if (saveField && saveFieldValue !== null) saveField.value = saveFieldValue;
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * A load is reversible once. Loading a save keeps the garden it replaced as a
 * one-deep restore point; the Restore previous garden button puts that garden
 * back with the same growth, seeds, plants, beds, lifetime and lasting bonus;
 * the point is spent by the restore and replaced by the next load; and it never
 * enters the save string, so a load still round-trips byte for byte.
 */
function checkRestorePoint(problems) {
  const restore = document.getElementById("restore-save");
  if (!restore) {
    problems.push("the page has no Restore previous garden control (expected #restore-save).");
    return;
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  try {
    // A known garden, which the load below replaces.
    setGarden({ beds: 2, seeds: 3, plants: 2 });
    setGrowth(70, 1.5, 120, 700, 6);
    const kept = getGarden();
    const keptGrowth = getGrowthState();

    // A refused save replaces nothing, so it leaves the restore point as it was.
    const offeredBefore = getDisplayedState().restoreAvailable;
    try {
      loadGardenSave("definitely not a save");
      problems.push("loading an invalid save did not refuse it.");
    } catch {
      // refused, as it must be.
    }
    if (getDisplayedState().restoreAvailable !== offeredBefore) {
      problems.push("a refused load kept a restore point even though it replaced nothing.");
    }

    loadGardenSave(encodeSave({ beds: 3, seeds: 5, plants: 4, growth: 45, lifetime: 2500 }));
    if (getDisplayedState().restoreAvailable !== true) {
      problems.push("after a load replaced the garden, the page offered no way to put it back.");
    }
    if (restore.tagName !== "BUTTON" || restore.disabled || restore.hidden || !restore.textContent.trim()) {
      problems.push("the Restore previous garden control is not a named, focusable button once there is one to restore.");
    }

    const restored = restoreGardenSave();
    const back = getGarden();
    const backGrowth = getGrowthState();
    if (!restored.ok || !restored.restored) {
      problems.push(
        `restoring the garden the last load replaced reported ok=${restored.ok} / restored=${restored.restored} ` +
          `(reason: ${restored.reason ?? "none"}), expected the kept garden back.`
      );
    }
    if (
      back.seeds !== kept.seeds ||
      back.plants !== kept.plants ||
      back.beds !== kept.beds ||
      backGrowth.growth !== keptGrowth.growth ||
      backGrowth.rate !== keptGrowth.rate ||
      backGrowth.lifetime !== keptGrowth.lifetime ||
      backGrowth.bonus !== keptGrowth.bonus
    ) {
      problems.push(
        `restoring left ${back.seeds} seeds / ${back.plants} plants / ${back.beds} beds / ${backGrowth.growth} ` +
          `growth / ${backGrowth.lifetime} lifetime / ${backGrowth.bonus} bonus, expected the kept ` +
          `${kept.seeds} / ${kept.plants} / ${kept.beds} / ${keptGrowth.growth} / ${keptGrowth.lifetime} / ` +
          `${keptGrowth.bonus}.`
      );
    }
    if (
      !restored.restoredContents ||
      restored.restoredContents.growth !== keptGrowth.growth ||
      restored.restoredContents.seeds !== kept.seeds ||
      restored.restoredContents.plants !== kept.plants ||
      restored.restoredContents.beds !== kept.beds ||
      restored.restoredContents.lifetime !== keptGrowth.lifetime
    ) {
      problems.push(
        `restoring reported ${JSON.stringify(restored.restoredContents)}, expected the kept garden's growth, ` +
          "seeds, plants, beds and lifetime."
      );
    }
    if (rawStorage().value !== exportSave()) {
      problems.push("restoring the kept garden did not write it to this browser.");
    }
    if (getDisplayedState().restoreAvailable !== false || !restore.hidden) {
      problems.push("after a restore, the page still offers a garden to put back.");
    }

    // The kept garden is spent: a second restore is a safe no-op.
    const second = restoreGardenSave();
    const afterSecond = getGarden();
    const afterSecondGrowth = getGrowthState();
    if (second.ok || second.restored) {
      problems.push(
        `a second restore reported ok=${second.ok} / restored=${second.restored}, expected a no-op with a reason.`
      );
    }
    if (
      afterSecond.seeds !== back.seeds ||
      afterSecond.plants !== back.plants ||
      afterSecond.beds !== back.beds ||
      afterSecondGrowth.growth !== backGrowth.growth ||
      afterSecondGrowth.lifetime !== backGrowth.lifetime
    ) {
      problems.push("a second restore changed the garden even though there was nothing kept.");
    }

    // Another load replaces the point with the garden that load replaces.
    const firstOfTwo = encodeSave({ beds: 2, seeds: 1, plants: 1, growth: 5, lifetime: 40 });
    const secondOfTwo = encodeSave({ beds: 1, seeds: 2, plants: 0, growth: 3, lifetime: 10 });
    const middle = decodeSave(firstOfTwo);
    loadGardenSave(firstOfTwo);
    loadGardenSave(secondOfTwo);
    const replaced = restoreGardenSave();
    const backAgain = getGarden();
    const backAgainGrowth = getGrowthState();
    if (
      !replaced.ok ||
      backAgain.seeds !== middle.seeds ||
      backAgain.plants !== middle.plants ||
      backAgain.beds !== middle.beds ||
      backAgainGrowth.growth !== middle.growth ||
      backAgainGrowth.lifetime !== middle.lifetime
    ) {
      problems.push(
        `after two loads, restoring put back ${backAgain.seeds} seeds / ${backAgain.plants} plants / ` +
          `${backAgain.beds} beds / ${backAgainGrowth.growth} growth / ${backAgainGrowth.lifetime} lifetime, ` +
          `expected the garden the second load replaced (${middle.seeds} / ${middle.plants} / ${middle.beds} / ` +
          `${middle.growth} / ${middle.lifetime}).`
      );
    }

    // The point lives only in memory: a save loaded and exported straight back
    // is the same string, byte for byte.
    loadGardenSave(secondOfTwo);
    if (exportSave() !== secondOfTwo) {
      problems.push("exporting the garden right after a load did not give the same save string back.");
    }
    // Spend what is left so no later check inherits a restore point.
    restoreGardenSave();
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

// --- Two kinds of seed ------------------------------------------------------

/**
 * The two kinds are a real choice: they differ in price, in what a grown plant
 * produces and in how long the seed takes to mature, each kind is priced
 * against its own count, and both read off a mixed garden correctly.
 */
function checkSeedKindsDiffer(problems) {
  if (SAVE_VERSION !== 9) {
    problems.push(`SAVE_VERSION should be 9 (the visit record), but it is ${SAVE_VERSION}.`);
  }
  const [herb, bloom] = SEED_KINDS;
  if (bloom.costBase <= herb.costBase) {
    problems.push(
      `bloom should cost more to start than herb (${bloom.costBase} vs ${herb.costBase}), so planting is a choice.`
    );
  }
  if (bloom.production <= herb.production) {
    problems.push(
      `a grown bloom should produce more than a herb (${bloom.production} vs ${herb.production}/s), so planting is a choice.`
    );
  }
  if (bloom.growSeconds <= herb.growSeconds) {
    problems.push(
      `a bloom seed should take longer to mature than a herb (${bloom.growSeconds}s vs ${herb.growSeconds}s), ` +
        "so planting is a choice."
    );
  }

  // Each kind is priced against how many of that kind already grow.
  if (nextSeedCost(0, "herb") !== SEED_COST_BASE) {
    problems.push(
      `the first herb seed should cost ${SEED_COST_BASE}, but nextSeedCost(0, "herb") is ${nextSeedCost(0, "herb")}.`
    );
  }
  const bloomFirst = nextSeedCost(0, "bloom");
  if (bloomFirst !== bloom.costBase) {
    problems.push(`the first bloom seed should cost ${bloom.costBase}, but nextSeedCost(0, "bloom") is ${bloomFirst}.`);
  }
  if (!(bloomFirst > nextSeedCost(0, "herb"))) {
    problems.push("a bloom seed should cost more than a herb seed at the same count of each.");
  }
  if (!(nextSeedCost(1, "bloom") > bloomFirst)) {
    problems.push("each bloom seed must cost more than the last, as a herb's does.");
  }

  // A kind named by key or number resolves; a misspelled one falls back to herb.
  if (kindIndex("bloom") !== 1 || kindIndex("herb") !== 0 || kindIndex(1) !== 1 || kindIndex("fern") !== 0) {
    problems.push(
      `kindIndex resolved ("bloom", "herb", 1, "fern") to ` +
        `(${kindIndex("bloom")}, ${kindIndex("herb")}, ${kindIndex(1)}, ${kindIndex("fern")}), ` +
        "expected (1, 0, 1, 0)."
    );
  }

  // A mixed garden reads per kind: counts, prices and production.
  const kinds = gardenKinds({ seeds: 1, plants: 2, bloomSeeds: 3, bloomPlants: 4, capacity: 24 });
  if (kinds.length !== 2) {
    problems.push(`gardenKinds should answer for both kinds, but it returned ${kinds.length}.`);
  }
  const herbEntry = kinds[0];
  const bloomEntry = kinds[1];
  if (!herbEntry || !bloomEntry || herbEntry.key !== "herb" || bloomEntry.key !== "bloom") {
    problems.push(
      `gardenKinds returned keys ${JSON.stringify((kinds ?? []).map((kind) => kind.key))}, expected ["herb", "bloom"].`
    );
    return;
  }
  const plantedCost = (base, rate, planted) => Math.ceil(base * rate ** planted);
  if (herbEntry.seeds !== 1 || herbEntry.plants !== 2 || herbEntry.cost !== plantedCost(5, 1.15, 3)) {
    problems.push(
      `the herb kind read back as ${herbEntry.seeds} seeds / ${herbEntry.plants} plants at ` +
        `${herbEntry.cost} growth, expected 1 / 2 / ${plantedCost(5, 1.15, 3)}.`
    );
  }
  if (bloomEntry.seeds !== 3 || bloomEntry.plants !== 4 || bloomEntry.cost !== plantedCost(40, 1.15, 7)) {
    problems.push(
      `the bloom kind read back as ${bloomEntry.seeds} seeds / ${bloomEntry.plants} plants at ` +
        `${bloomEntry.cost} growth, expected 3 / 4 / ${plantedCost(40, 1.15, 7)}.`
    );
  }
  if (herbEntry.production !== herb.production || bloomEntry.production !== bloom.production) {
    problems.push(
      `gardenKinds reported production ${herbEntry.production} / ${bloomEntry.production}/s, ` +
        `expected ${herb.production} / ${bloom.production}/s.`
    );
  }
}

/**
 * Planting a bloom spends its own price, matures after its own longer wait,
 * and adds its own production while the herb counts stay put.
 */
function checkBloomPlanting(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  try {
    const button = document.getElementById("plant-bloom");
    if (!button) {
      problems.push("the page has no Plant a bloom control (#plant-bloom), so the second kind cannot be planted.");
      return;
    }
    if (button.tagName.toLowerCase() !== "button") {
      problems.push(
        `the Plant a bloom control is a <${button.tagName.toLowerCase()}>, not a real <button>, ` +
          "so keyboard Enter and Space will not activate it."
      );
    }

    setGarden({ seeds: 0, plants: 0 });
    const cost = nextSeedCost(0, "bloom");
    setGrowth(cost - 1, 0.2);
    if (!String(button.textContent).includes(formatAmount(cost))) {
      problems.push(
        `the Plant a bloom label is ${JSON.stringify(button.textContent)}, which does not state its ${cost}-growth cost.`
      );
    }
    const tooShort = availabilityProblem(
      button,
      false,
      `the Plant a bloom control at ${cost - 1} growth, one short of its ${cost}-growth cost`
    );
    if (tooShort) problems.push(tooShort);

    setGrowth(cost, 0.2);
    const affordable = availabilityProblem(
      button,
      true,
      `the Plant a bloom control at ${cost} growth, exactly its ${cost}-growth cost`
    );
    if (affordable) problems.push(affordable);
    button.click();

    const after = getGrowthState();
    const gardenAfter = getGarden();
    if (after.growth !== 0) {
      problems.push(`planting a ${cost}-growth bloom from ${cost} growth left ${after.growth} growth, expected 0.`);
    }
    if (Math.abs(after.rate - 0.2) > 1e-9) {
      problems.push(`planting a bloom set the rate to ${after.rate}/s, expected the unchanged 0.2/s.`);
    }
    if (
      gardenAfter.bloomSprouts.length !== 1 ||
      gardenAfter.seeds !== 1 ||
      gardenAfter.plants !== 0 ||
      gardenAfter.plantCounts[0] !== 0 ||
      gardenAfter.plantCounts[1] !== 0
    ) {
      problems.push(
        `planting a bloom left the garden at ${gardenAfter.seeds} seeds / ` +
          `${JSON.stringify(gardenAfter.plantCounts)} plant counts, expected one bloom sprout and no plants of either kind.`
      );
    }

    // After the bloom's own longer wait it is a grown plant, producing at its
    // own higher rate, and the herb side of the garden has not moved.
    advance(SEED_KINDS[1].growSeconds);
    const grownGarden = getGarden();
    const grownState = getGrowthState();
    if (grownGarden.plantCounts[1] !== 1 || grownGarden.bloomSprouts.length !== 0) {
      problems.push(
        `after ${SEED_KINDS[1].growSeconds}s the bloom holds ${JSON.stringify(grownGarden.plantCounts[1])} plants ` +
          `and ${grownGarden.bloomSprouts.length} sprouts, expected 1 matured plant.`
      );
    }
    if (Math.abs(grownState.rate - (0.2 + SEED_KINDS[1].production)) > 1e-9) {
      problems.push(
        `after the bloom matured the rate is ${grownState.rate}/s, expected ${0.2 + SEED_KINDS[1].production}/s.`
      );
    }
    if (grownGarden.plantCounts[0] !== 0 || grownGarden.seeds !== 0) {
      problems.push(
        `planting a bloom moved the herb side to ${grownGarden.seeds} seeds / ` +
          `${grownGarden.plantCounts[0]} plants; the other kind must stay put.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The save carried the second kind from version 6: a version-5 save is all
 * first kind and loses nothing, and a mixed garden round-trips by kind.
 */
function checkSaveMigratesKinds(problems) {
  const payload = (value) => `${SAVE_PREFIX}${btoa(JSON.stringify(value))}`;

  // A version-5 save knew one kind: every seed and plant it carries becomes
  // the first kind, and the second kind opens empty.
  const version5 = payload({
    version: 5,
    seeds: 2,
    plants: 1,
    sprouts: [10, 5],
    growth: 12.5,
    rate: 0.7,
    age: 40,
    beds: 2,
  });
  try {
    const migrated = decodeSave(version5);
    if (
      migrated.version !== SAVE_VERSION ||
      migrated.seeds !== 2 ||
      migrated.plants !== 1 ||
      JSON.stringify(migrated.sprouts) !== JSON.stringify([10, 5]) ||
      JSON.stringify(migrated.bloomSprouts) !== JSON.stringify([]) ||
      JSON.stringify(migrated.plantCounts) !== JSON.stringify([1, 0]) ||
      migrated.growth !== 12.5 ||
      migrated.rate !== 0.7 ||
      migrated.age !== 40 ||
      migrated.beds !== 2
    ) {
      problems.push(
        `a version-5 save migrated to ${JSON.stringify(migrated)}; expected its seeds and plants to become ` +
          "the first kind (2 sprouts / 1 plant / no bloom) with growth, rate, age and beds kept."
      );
    }
  } catch (e) {
    problems.push(`a version-5 save should still load, but it was refused: ${e.message}`);
  }

  // A garden holding both kinds round-trips with each kind's share intact.
  const mixed = encodeSave({
    sprouts: [5],
    plants: 1,
    bloomSprouts: [7],
    bloomPlants: 2,
    beds: 1,
    growth: 3,
    rate: 1,
  });
  try {
    const back = decodeSave(mixed);
    if (
      back.seeds !== 2 ||
      back.plants !== 3 ||
      JSON.stringify(back.sprouts) !== JSON.stringify([5]) ||
      JSON.stringify(back.bloomSprouts) !== JSON.stringify([7]) ||
      JSON.stringify(back.plantCounts) !== JSON.stringify([1, 2])
    ) {
      problems.push(
        `a mixed-kind save round-tripped to ${JSON.stringify(back)}; expected 1 herb seed / 1 herb plant / ` +
          "1 bloom seed / 2 bloom plants."
      );
    }
  } catch (e) {
    problems.push(`a mixed-kind save could not round-trip: ${e.message}`);
  }
}

/**
 * The garden's whole life: a lifetime total that outlives a replant and keeps
 * climbing, and the lasting bonus a replant right now would earn from it.
 *
 * The lifetime is the ground the replant action stands on, so it is checked at
 * both ends — the pure curve, the save that carries it, the migration that
 * starts an older garden at what it already holds, and the readout a visitor
 * and an agent both read.
 */
function checkLifetimeGrowth(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const payload = (value) => `${SAVE_PREFIX}${btoa(JSON.stringify(value))}`;
  try {
    // The lifetime is part of the save and comes back exactly as it went in.
    try {
      const back = decodeSave(
        encodeSave({ version: SAVE_VERSION, seeds: 1, plants: 1, growth: 7, rate: 0.5, lifetime: 123.5 })
      );
      if (back.lifetime !== 123.5) {
        problems.push(`a save put in a lifetime of 123.5 and gave back ${back.lifetime}.`);
      }
    } catch (e) {
      problems.push(`a save carrying a lifetime could not round-trip: ${e.message}`);
    }

    // A save from before the lifetime was kept has still produced everything it
    // holds, so it starts at its current growth rather than at nothing.
    try {
      const migrated = decodeSave(
        payload({ version: 6, seeds: 2, plants: 1, growth: 42.5, rate: 1.2, age: 30, beds: 1 })
      );
      if (migrated.lifetime !== 42.5) {
        problems.push(
          `a version-6 save holding 42.5 growth should start its lifetime at 42.5, but it started at ` +
            `${migrated.lifetime}.`
        );
      }
    } catch (e) {
      problems.push(`a version-6 save should still load, but it was refused: ${e.message}`);
    }

    // A lifetime that is negative or not a number is refused, not rendered.
    for (const [label, value] of [
      ["a negative lifetime", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0, rate: 0, lifetime: -1 })],
      [
        "a lifetime that is not a number",
        payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0, rate: 0, lifetime: "5" }),
      ],
    ]) {
      try {
        decodeSave(value);
        problems.push(`the save reader accepted ${label}; it should refuse it.`);
      } catch {
        // refused, as it must be.
      }
    }

    // The bonus curve is a square root: going further is always worth more, but
    // each further step is worth less, so several runs beat one long one.
    for (const [lifetime, expected] of [[0, 0], [99, 9], [100, 10], [400, 20]]) {
      if (replantBonus(lifetime) !== expected) {
        problems.push(`replantBonus(${lifetime}) is ${replantBonus(lifetime)}, expected ${expected}.`);
      }
    }
    if (!(replantBonus(99) < replantBonus(100))) {
      problems.push(
        `the replant bonus must rise with lifetime, but 99 is worth ${replantBonus(99)} and 100 is worth ` +
          `${replantBonus(100)}.`
      );
    }
    if (!(replantBonus(400) < 4 * replantBonus(100))) {
      problems.push(
        `the replant bonus must be sublinear, but four times the lifetime (400) is worth ${replantBonus(400)} ` +
          `against ${replantBonus(100)} at 100.`
      );
    }
    if (replantBonus(-5) !== 0 || replantBonus(Number.NaN) !== 0) {
      problems.push("a negative or missing lifetime must be worth no bonus, not a negative or NaN one.");
    }

    // Tending the soil and letting time pass both count towards the lifetime,
    // so the total the garden can never spend tracks what it has produced.
    setGarden({ seeds: 0, plants: 0 });
    setGrowth(0, 0, 0, 50);
    tend();
    if (getGrowthState().lifetime !== 50 + TEND_YIELD) {
      problems.push(
        `tending should add ${TEND_YIELD} to the lifetime (50 to ${50 + TEND_YIELD}), but it became ` +
          `${getGrowthState().lifetime}.`
      );
    }
    setGrowth(0, 1, 0, 50);
    advance(10);
    if (Math.abs(getGrowthState().lifetime - 60) > 1e-9) {
      problems.push(
        `10 seconds at +1/s should add 10 to the lifetime (50 to 60), but it became ${getGrowthState().lifetime}.`
      );
    }

    // A replant resets the growth balance but never the lifetime: the second
    // run adds to the first instead of starting the garden's history over.
    setGrowth(0, 1, 0, 100);
    advance(100);
    const firstRun = getGrowthState();
    if (Math.abs(firstRun.lifetime - 200) > 1e-9) {
      problems.push(`after a 100-growth first run the lifetime is ${firstRun.lifetime}, expected 200.`);
    }
    const bonusAfterOneRun = replantBonus(firstRun.lifetime);
    setGrowth(0, 1, 0, firstRun.lifetime); // a replant: the balance goes, the history stays
    if (getGrowthState().lifetime !== firstRun.lifetime) {
      problems.push("a replant reset the lifetime, so the garden forgot what it had already produced.");
    }
    advance(100);
    const secondRun = getGrowthState();
    if (!(replantBonus(secondRun.lifetime) > bonusAfterOneRun)) {
      problems.push(
        `a second run must be worth more than the first: the bonus went from ${bonusAfterOneRun} to ` +
          `${replantBonus(secondRun.lifetime)} across the replant.`
      );
    }

    // The lifetime and the bonus are the state a visitor and an agent read, and
    // the page shows the same two numbers.
    setGrowth(123.5, 0.5, 0, 250);
    const state = getDisplayedState();
    if (state.lifetimeGrowth !== 250) {
      problems.push(`the displayed lifetime is ${state.lifetimeGrowth}, expected the garden's 250.`);
    }
    if (state.replantBonus !== replantBonus(250)) {
      problems.push(
        `the displayed replant bonus is ${state.replantBonus}, but replantBonus(250) is ${replantBonus(250)}.`
      );
    }
    const lifetimeEl = document.querySelector('[data-field="lifetime"]');
    const bonusEl = document.querySelector('[data-field="replant-bonus"]');
    if (!lifetimeEl || !bonusEl) {
      problems.push(
        'the page has no lifetime readout (expected [data-field="lifetime"] and [data-field="replant-bonus"]), ' +
          "so a visitor cannot see what the garden has grown or what a replant is worth."
      );
    } else {
      const shownLifetime = String(lifetimeEl.textContent).trim();
      const shownBonus = String(bonusEl.textContent).trim();
      if (shownLifetime !== formatGrowth(state.lifetimeGrowth)) {
        problems.push(
          `the page shows ${JSON.stringify(shownLifetime)} for the lifetime, but the garden holds ` +
            `${state.lifetimeGrowth} (${formatGrowth(state.lifetimeGrowth)}).`
        );
      }
      if (!shownBonus.includes(formatAmount(state.replantBonus))) {
        problems.push(
          `the page shows ${JSON.stringify(shownBonus)} for the replant bonus, but a replant right now is worth ` +
            `${state.replantBonus}.`
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * Replanting: offered only once the garden is flourishing, it starts a fresh
 * garden that keeps the lifetime and carries a lasting bonus into its rate.
 *
 * The action is the deeper layer that keeps the garden from ending at a wall,
 * so it is checked at both ends: the wall that gates it, the reset it performs,
 * the bonus it sets and saves, the faster fresh run it buys, and the readout
 * and control a visitor and an agent both read. Declining is checked to be a
 * pure no-op.
 */
function checkReplant(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const payload = (value) => `${SAVE_PREFIX}${btoa(JSON.stringify(value))}`;
  const belowWall = REPLANT_MIN_BONUS * REPLANT_MIN_BONUS - 1;
  try {
    // Below the wall the replant is refused and changes nothing at all.
    setGarden({ seeds: 1, plants: 0, beds: 1 });
    setGrowth(5, 0.5, 12, belowWall);
    if (canReplant()) {
      problems.push("a garden below the wall reports it can be replanted.");
    }
    const refused = replant();
    const untouchedGarden = getGarden();
    const untouchedGrowth = getGrowthState();
    if (refused.ok) {
      problems.push("a replant below the wall was performed instead of refused.");
    }
    if (
      untouchedGarden.seeds !== 1 ||
      untouchedGarden.plants !== 0 ||
      untouchedGrowth.growth !== 5 ||
      Math.abs(untouchedGrowth.rate - 0.5) > 1e-9 ||
      untouchedGrowth.lifetime !== belowWall
    ) {
      problems.push("a refused replant changed the garden even though it refused.");
    }

    // At the wall the replant resets the run and keeps its history.
    setGarden({ beds: 3, seeds: 4, plants: 5 });
    setGrowth(999, 2.5, 300, REPLANT_MIN_BONUS * REPLANT_MIN_BONUS);
    const earnedBonus = replantBonus(getGrowthState().lifetime);
    if (!canReplant()) {
      problems.push(`a garden worth a ${earnedBonus} bonus reports it cannot be replanted.`);
    }

    // Declining is a pure no-op: opening the confirmation and choosing Keep
    // growing leaves every number exactly where it was.
    document.getElementById("replant")?.click();
    document.getElementById("replant-cancel")?.click();
    if (getGarden().seeds !== 4 || getGarden().plants !== 5 || getGrowthState().growth !== 999) {
      problems.push("declining a replant (Keep growing) changed the garden.");
    }

    const done = replant();
    const freshGarden = getGarden();
    const freshGrowth = getGrowthState();
    if (!done.ok) {
      problems.push(`an eligible replant was refused: ${done.reason}.`);
    }
    if (freshGarden.beds !== 1 || freshGarden.seeds !== 1 || freshGarden.plants !== 0) {
      problems.push(
        `a replant left ${freshGarden.beds} beds / ${freshGarden.seeds} seeds / ${freshGarden.plants} plants, ` +
          "expected a fresh 1 / 1 / 0."
      );
    }
    if (freshGrowth.growth !== 0 || freshGrowth.rate !== 0 || freshGrowth.age !== 0) {
      problems.push(
        `a replant left ${freshGrowth.growth} growth at ${freshGrowth.rate}/s, age ${freshGrowth.age}, ` +
          "expected the fresh run to start at 0 / 0 / 0."
      );
    }
    if (freshGrowth.lifetime !== REPLANT_MIN_BONUS * REPLANT_MIN_BONUS) {
      problems.push(
        `a replant reset the lifetime to ${freshGrowth.lifetime}, expected the ` +
          `${REPLANT_MIN_BONUS * REPLANT_MIN_BONUS} kept.`
      );
    }
    if (freshGrowth.bonus !== earnedBonus || freshGrowth.bonus < REPLANT_MIN_BONUS) {
      problems.push(
        `a replant set the lasting bonus to ${freshGrowth.bonus}, expected the ${earnedBonus} the lifetime earned.`
      );
    }
    if (done.bonus !== freshGrowth.bonus || done.lifetime !== freshGrowth.lifetime) {
      problems.push("the replant result does not report the bonus and lifetime the garden now holds.");
    }

    // The bonus is in the save and comes straight back; an older save was never
    // replanted, so it opens with none, and a bad bonus is refused rather than
    // slowing the garden.
    const back = decodeSave(encodeSave({ ...newGarden(), bonus: 12.5, lifetime: 156.25 }));
    if (back.bonus !== 12.5) {
      problems.push(`a save put in a bonus of 12.5 and gave back ${back.bonus}.`);
    }
    const migrated = decodeSave(payload({ version: 7, seeds: 1, plants: 1, growth: 200, rate: 1, lifetime: 200 }));
    if (migrated.bonus !== 0) {
      problems.push(`a version-7 save should open with no bonus, but it carried ${migrated.bonus}.`);
    }
    for (const [label, value] of [
      ["a negative bonus", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, bonus: -1 })],
      ["a bonus that is not a number", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, bonus: "5" })],
    ]) {
      try {
        decodeSave(value);
        problems.push(`the save reader accepted ${label}; it should refuse it.`);
      } catch {
        // refused, as it must be.
      }
    }

    // The fresh garden grows faster than the same one without the bonus over the
    // same span: the lasting bonus is the whole point of replanting.
    const withBonus = simulateGarden(
      { growth: 0, rate: 0, age: 0, bonus: freshGrowth.bonus, sprouts: [STARTING_GROW_SECONDS], beds: 1 },
      60
    );
    const withoutBonus = simulateGarden(
      { growth: 0, rate: 0, age: 0, bonus: 0, sprouts: [STARTING_GROW_SECONDS], beds: 1 },
      60
    );
    if (!(withBonus.growth > withoutBonus.growth)) {
      problems.push(
        `a fresh garden carrying a ${freshGrowth.bonus}/s bonus grew ${withBonus.growth} in a minute, no more ` +
          `than the ${withoutBonus.growth} a bonusless one grew.`
      );
    }

    // The readout and the control a visitor and an agent both read, shown only
    // once the garden is eligible.
    setGrowth(0, 0, 0, 400, 20);
    const state = getDisplayedState();
    if (state.bonus !== 20 || !state.canReplant) {
      problems.push(
        `the displayed state reports bonus ${state.bonus} / canReplant ${state.canReplant}, expected 20 / true.`
      );
    }
    if (state.baseRate !== 20) {
      problems.push(`the displayed base rate is ${state.baseRate}, expected the bonus's 20.`);
    }
    const button = document.getElementById("replant");
    const bonusEl = document.querySelector('[data-field="bonus"]');
    if (!button || !bonusEl) {
      problems.push(
        'the page has no replant control or lasting-bonus readout (expected #replant and [data-field="bonus"]).'
      );
    } else {
      if (button.hidden) problems.push("the page hides the Replant control while the garden is eligible.");
      const shownBonus = String(bonusEl.textContent).trim();
      if (!shownBonus.includes(formatGrowth(state.bonus))) {
        problems.push(
          `the page shows ${JSON.stringify(shownBonus)} for the lasting bonus, but the garden holds ${state.bonus}.`
        );
      }
    }
    setGrowth(0, 0, 0, belowWall, 0);
    if (getDisplayedState().canReplant) {
      problems.push("a garden below the wall reports canReplant true.");
    }
    if (button && !button.hidden) {
      problems.push("the page offers the Replant control before the garden is eligible.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The garden numbers a Replant confirmation is forbidden to move: what the
 * dialog names beside what a replant would cost. One flat object, so the same
 * six numbers are compared before and after every press.
 */
function replantNumbers() {
  const garden = getGarden();
  const growth = getGrowthState();
  return {
    beds: garden.beds,
    seeds: garden.seeds,
    plants: garden.plants,
    growth: growth.growth,
    lifetime: growth.lifetime,
    bonus: growth.bonus,
  };
}

/**
 * Report a failure for every number a press moved, naming the control and both
 * values. A confirmation the visitor only sees or declines must leave the
 * garden exactly as it was, and a silent change is the bug this catches.
 */
function reportMovedNumbers(problems, control, before, after) {
  for (const [field, was] of Object.entries(before)) {
    if (after[field] !== was) {
      problems.push(
        `pressing ${control} changed ${field} from ${was} to ${after[field]}; it must leave the garden as it was.`
      );
    }
  }
}

/**
 * The confirming half of the Replant confirmation.
 *
 * The Replant dialog is the one moment the page shows a visitor what a replant
 * would cost and what it would earn before it happens, and only Replant now
 * performs it. This drives those real controls on the live page: it opens the
 * dialog on an eligible garden and reads the bonus it promises, declines it,
 * confirms it and reads the fresh garden back, then checks a garden below the
 * wall is never asked at all. Every failure names the control and both numbers,
 * so an unwired #replant-confirm, a dialog that never opens, or a dialog
 * stating the wrong lasting bonus cannot ship green.
 */
function checkReplantConfirm(problems) {
  const dialog = document.getElementById("replant-dialog");
  const replantButton = document.getElementById("replant");
  const confirm = document.getElementById("replant-confirm");
  const cancel = document.getElementById("replant-cancel");
  const bonusRow = document.getElementById("replant-dialog-bonus");
  if (!dialog || !replantButton || !confirm || !cancel || !bonusRow) {
    problems.push(
      "the page has no Replant confirmation (expected #replant-dialog, #replant, #replant-confirm, " +
        "#replant-cancel and #replant-dialog-bonus)."
    );
    return;
  }
  if (
    typeof dialog.showModal !== "function" ||
    confirm.tagName !== "BUTTON" ||
    cancel.tagName !== "BUTTON" ||
    confirm.disabled ||
    cancel.disabled ||
    !confirm.textContent.trim() ||
    !cancel.textContent.trim()
  ) {
    problems.push("the Replant dialog's Replant now and Keep growing controls are not named, focusable buttons.");
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const wallLifetime = REPLANT_MIN_BONUS * REPLANT_MIN_BONUS - 1;
  try {
    // An eligible garden whose 2,500 lifetime earns a 50/s bonus — deliberately
    // not the +10/s the dialog's markup ships with, so a bonus row never
    // written from the garden being shown reads wrong here.
    setGarden({ beds: 3, seeds: 4, plants: 5 });
    setGrowth(999, 2.5, 300, 2500);
    const promised = replantNumbers();
    const earnedBonus = replantBonus(promised.lifetime);
    if (!canReplant()) {
      problems.push(`a ${promised.lifetime} lifetime garden reports it cannot be replanted.`);
    }

    // Opening the confirmation shows it and changes nothing at all.
    replantButton.click();
    if (!dialog.open) {
      problems.push("pressing #replant on an eligible garden did not open #replant-dialog.");
    }
    const shownBonus = String(bonusRow.textContent).trim();
    const statedBonus = `+${formatAmount(earnedBonus)}/s`;
    if (!shownBonus.includes(statedBonus)) {
      problems.push(
        `#replant-dialog-bonus reads ${JSON.stringify(shownBonus)}, expected it to state ` +
          `${JSON.stringify(statedBonus)} — the replantBonus of the ${promised.lifetime} lifetime the dialog was ` +
          "opened for."
      );
    }
    reportMovedNumbers(problems, "#replant", promised, replantNumbers());

    // Keep growing closes the dialog and still changes nothing.
    cancel.click();
    if (dialog.open) {
      problems.push("pressing #replant-cancel did not close #replant-dialog.");
    }
    reportMovedNumbers(problems, "#replant-cancel", promised, replantNumbers());

    // Replant now closes the dialog and performs the replant: a fresh garden
    // that keeps its lifetime and starts with the lasting bonus it earned. A
    // cancel that failed to close the dialog is already reported; close
    // whatever it left open so this half is still checked rather than a second
    // showModal throwing.
    if (dialog.open) dialog.close();
    replantButton.click();
    confirm.click();
    if (dialog.open) {
      problems.push("pressing #replant-confirm did not close #replant-dialog.");
    }
    const freshGarden = getGarden();
    const freshGrowth = getGrowthState();
    if (freshGarden.beds !== 1 || freshGarden.seeds !== 1 || freshGarden.plants !== 0) {
      problems.push(
        `#replant-confirm left ${freshGarden.beds} beds / ${freshGarden.seeds} seeds / ${freshGarden.plants} plants, ` +
          "expected the fresh 1 / 1 / 0."
      );
    }
    if (freshGrowth.growth !== 0 || freshGrowth.rate !== 0 || freshGrowth.age !== 0) {
      problems.push(
        `#replant-confirm left ${freshGrowth.growth} growth at ${freshGrowth.rate}/s, age ${freshGrowth.age}, ` +
          "expected the fresh run at 0 / 0 / 0."
      );
    }
    if (freshGrowth.lifetime !== promised.lifetime) {
      problems.push(
        `#replant-confirm reset the lifetime to ${freshGrowth.lifetime}, expected the ${promised.lifetime} kept.`
      );
    }
    if (freshGrowth.bonus !== earnedBonus) {
      problems.push(
        `#replant-confirm set the lasting bonus to ${freshGrowth.bonus}, expected the ${earnedBonus} the ` +
          `${promised.lifetime} lifetime earned.`
      );
    }
    const displayed = getDisplayedState();
    if (
      displayed.beds !== freshGarden.beds ||
      displayed.seeds !== freshGarden.seeds ||
      displayed.plants !== freshGarden.plants ||
      displayed.growth !== freshGrowth.growth ||
      displayed.lifetimeGrowth !== freshGrowth.lifetime ||
      displayed.bonus !== freshGrowth.bonus ||
      !displayed.canReplant
    ) {
      problems.push(
        `after #replant-confirm the page reports ${displayed.beds} beds / ${displayed.seeds} seeds / ` +
          `${displayed.plants} plants / ${displayed.growth} growth / ${displayed.lifetimeGrowth} lifetime / ` +
          `${displayed.bonus} bonus / canReplant ${displayed.canReplant}, but the garden holds ` +
          `${freshGarden.beds} / ${freshGarden.seeds} / ${freshGarden.plants} / ${freshGrowth.growth} / ` +
          `${freshGrowth.lifetime} / ${freshGrowth.bonus}, expected the fresh garden at canReplant true.`
      );
    }

    // Below the wall there is nothing to confirm: pressing Replant opens no
    // dialog and leaves the garden alone. A confirm that failed to close the
    // dialog is already reported; close it here so this press is judged on its
    // own, not on a leftover from the step above.
    if (dialog.open) dialog.close();
    setGrowth(5, 0.5, 12, wallLifetime, 0);
    const belowWall = replantNumbers();
    replantButton.click();
    if (dialog.open) {
      problems.push(
        `pressing #replant below the wall opened #replant-dialog; a ${wallLifetime} lifetime earns ` +
          `${replantBonus(wallLifetime)}/s, less than the ${REPLANT_MIN_BONUS} the wall needs.`
      );
    }
    reportMovedNumbers(problems, "#replant", belowWall, replantNumbers());
  } finally {
    if (dialog.open) dialog.close();
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

function checkKindReadout(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    const rows = new Map([
      ["herb", document.querySelector('[data-field="kind-herb"]')],
      ["bloom", document.querySelector('[data-field="kind-bloom"]')],
    ]);
    for (const [key, row] of rows) {
      if (!row) {
        problems.push(
          `the page has no ${key} readout (expected [data-field="kind-${key}"]), so the kind is not named.`
        );
      }
    }
    for (const id of ["plant-seed", "plant-bloom"]) {
      const button = document.getElementById(id);
      if (button) {
        const rect = button.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          problems.push(`the #${id} control has no size on screen, so its kind cannot be planted from the garden.`);
        }
      }
    }

    // A known garden: two herb seeds and one herb plant, so the herb's next
    // seed costs its third-seed price and the bloom's costs its first.
    setGarden({ seeds: 2, plants: 1 });
    setGrowth(0, 0.5);
    const planted = getDisplayedState();
    const herbCost = nextSeedCost(3, "herb");
    const bloomCost = nextSeedCost(0, "bloom");
    if (planted.kinds[0].cost !== herbCost || planted.kinds[1].cost !== bloomCost) {
      problems.push(
        `a garden of 2 herb seeds and 1 herb plant prices its kinds at ${planted.kinds[0].cost} and ` +
          `${planted.kinds[1].cost} growth, expected ${herbCost} and ${bloomCost}.`
      );
    }
    // Below a kind's first milestone a plant earns its raw production, so the
    // rate the row shows is anchored to the seeds themselves.
    if (
      planted.kinds[0].output !== SEED_KINDS[0].production ||
      planted.kinds[1].output !== SEED_KINDS[1].production
    ) {
      problems.push(
        `a kind below its first milestone earns its raw ${SEED_KINDS[0].production}/s or ` +
          `${SEED_KINDS[1].production}/s, but the state reports ${planted.kinds[0].output}/s and ` +
          `${planted.kinds[1].output}/s.`
      );
    }

    // Every fact in a kind's row is its own element under its own word, and
    // reads back exactly what get-state says about that kind — the same six
    // numbers, not a parallel copy of them that can drift.
    for (const kind of planted.kinds) {
      const row = rows.get(kind.key);
      if (!row) continue;
      const expected = {
        seeds: formatAmount(kind.seeds),
        plants: formatAmount(kind.plants),
        cost: formatAmount(kind.cost),
        output: `+${formatGrowth(kind.output)} a second`,
        milestone: kind.nextMilestone == null ? "all reached" : `${formatAmount(kind.nextMilestone)} plants`,
        "to-go": formatAmount(kind.plantsToMilestone ?? 0),
      };
      for (const [field, want] of Object.entries(expected)) {
        const value = row.querySelector(`[data-field="kind-${kind.key}-${field}"]`);
        if (!value) {
          problems.push(
            `the ${kind.key} readout has no ${field} value (expected [data-field="kind-${kind.key}-${field}"]), ` +
              "so that fact is missing from the row."
          );
          continue;
        }
        const label = String(value.closest(".kind-fact")?.querySelector(".kind-fact-label")?.textContent ?? "").trim();
        if (!label) {
          problems.push(`the ${kind.key} ${field} value sits under no label, so it reads as a bare number.`);
        }
        const got = String(value.textContent).trim();
        if (got !== want) {
          problems.push(
            `the ${kind.key} readout says ${JSON.stringify(got)} for ${field}, but get-state reports ` +
              `${JSON.stringify(want)}; the row must show the garden's own number.`
          );
        }
      }
      const facts = [...row.querySelectorAll(".kind-fact")];
      if (facts.length !== Object.keys(expected).length || facts.some((fact) => !fact.textContent.trim())) {
        problems.push(
          `the ${kind.key} readout holds ${facts.length} labelled values, expected ` +
            `${Object.keys(expected).length}, one per fact.`
        );
      }
      // Short labelled values, not one packed string: the middot, the em dash
      // and the slash are what made the old row need decoding.
      const rowText = String(row.textContent).replace(/\s+/g, " ").trim();
      for (const separator of ["·", "—", "/"]) {
        if (rowText.includes(separator)) {
          problems.push(
            `the ${kind.key} readout reads ${JSON.stringify(rowText)}; the ${JSON.stringify(separator)} ` +
              "separator was replaced by short labelled values and must not come back."
          );
        }
      }
    }

    const bloomButton = document.getElementById("plant-bloom");
    if (bloomButton && !String(bloomButton.textContent).includes(formatAmount(bloomCost))) {
      problems.push(
        `the Plant a bloom label is ${JSON.stringify(bloomButton.textContent)}, ` +
          `expected it to state the ${bloomCost}-growth cost.`
      );
    }
    if (bloomButton && !/bloom/i.test(String(bloomButton.textContent))) {
      problems.push(
        `the Plant a bloom label is ${JSON.stringify(bloomButton.textContent)}, expected it to name the bloom kind.`
      );
    }

    // The goal names the kind worth planting next: with the herb line grown
    // long and only some growth saved, bloom is the affordable reach.
    setGarden({ beds: 3, seeds: 0, plants: 30 });
    setGrowth(200, 1);
    const state = getDisplayedState();
    const goalTitle = String(document.getElementById("goal-title")?.textContent ?? "");
    if (!/bloom/i.test(goalTitle)) {
      problems.push(
        `with herb at ${state.kinds[0].cost} growth and bloom affordable, the goal title is ` +
          `${JSON.stringify(goalTitle)}, expected it to name bloom.`
      );
    }
    if (!goalTitle.includes(formatAmount(state.nextSeedCost))) {
      problems.push(`the goal title ${JSON.stringify(goalTitle)} does not state its ${state.nextSeedCost}-growth cost.`);
    }
    if (state.nextSeedKind !== "bloom" || state.nextSeedCost !== nextSeedCost(0, "bloom")) {
      problems.push(
        `the state names the next seed ${state.nextSeedKind} at ${state.nextSeedCost} growth, ` +
          `expected bloom at ${nextSeedCost(0, "bloom")}.`
      );
    }

    // And when nothing is affordable yet, the goal is the soonest seed: the
    // cheapest kind, which here is the herb (6 growth) beside the bloom (40).
    setGarden({ seeds: 1, plants: 0 });
    setGrowth(3, 1);
    const poorState = getDisplayedState();
    if (poorState.nextSeedKind !== "herb") {
      problems.push(
        `with ${poorState.growth} growth saved the next seed worth planting is ` +
          `${poorState.nextSeedKind}, expected the soonest kind (herb).`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * Each kind's row shows the same two sprites the plot draws for it — its
 * ungrown seed and its grown plant — so a visitor can point at a plant or seed
 * on the plot and find the row that counts it.
 *
 * The swatch is drawn from the plot's own sprite code, so the two can never
 * differ in shape or colour, and it is a picture rather than a fact: it holds
 * no text and is hidden from assistive technology. A missing swatch, one that
 * reads as a fact of the row, one that no longer tells the kinds apart, one
 * left stale against the current garden, or one that stopped following the
 * garden's form trips this.
 */
function checkKindSwatches(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    const palette = readPalette();
    const leafKeys = new Set(
      [palette.leaf, palette.leafLight, palette.leafDeep].map((color) => colorKey(parseColor(color)))
    );
    const bloomKeys = new Set([colorKey(parseColor(palette.bloom))]);

    // Each kind's row holds its own swatch, beside the label that names the
    // kind, and the swatch is a picture: no text, hidden from assistive
    // technology, and no part of a labelled value.
    const kinds = [
      ["herb", "kind-herb", "kind-herb-swatch"],
      ["bloom", "kind-bloom", "kind-bloom-swatch"],
    ];
    for (const [key, field, id] of kinds) {
      const facts = document.querySelector(`[data-field="${field}"]`);
      const swatch = document.getElementById(id);
      const row = (swatch ?? facts)?.closest(".readout-row") ?? null;
      if (!swatch || !facts || !row || !row.contains(facts)) {
        problems.push(
          `the ${key} row has no sprite swatch beside it (expected a canvas #${id} in the same readout row as ` +
            `[data-field="${field}"]), so the sprite the plot draws for a ${key} cannot be matched to the label that ` +
            "counts it."
        );
        continue;
      }
      if (swatch.tagName.toLowerCase() !== "canvas") {
        problems.push(
          `the ${key} swatch #${id} is a <${swatch.tagName.toLowerCase()}>, expected a canvas the plot's own sprite ` +
            "code can draw into."
        );
      }
      if (swatch.getAttribute("aria-hidden") !== "true") {
        problems.push(
          `the ${key} swatch #${id} is not aria-hidden, so a screen reader reaches a drawn picture instead of the ` +
            "row's label and values."
        );
      }
      if (String(swatch.textContent).trim() !== "" || swatch.closest(".kind-fact")) {
        problems.push(
          `the ${key} swatch #${id} reads as one of the row's facts (it carries text or sits inside a labelled ` +
            "value), but it must only illustrate the row beside its label."
        );
      }
      const named = String(row.querySelector(".readout-term")?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!named.toLowerCase().includes(key)) {
        problems.push(
          `the ${key} swatch sits beside the label ${JSON.stringify(named)}, so it does not name the kind it draws.`
        );
      }
    }

    // One known garden, so the swatches are read from a fixed growth rather
    // than from the live garden, whose season and form are whatever the
    // visitor's clock has made of them.
    const known = { growth: 100, beds: 1, capacity: PLOT_CAPACITY, pollinator: { visiting: false } };
    const swatchOf = (kind) => {
      const canvas = document.createElement("canvas");
      drawKindSwatch(canvas, kind, known, palette);
      return canvas;
    };
    const herb = swatchOf("herb");
    const bloom = swatchOf("bloom");

    // The swatch shows the kind: a herb carries leaf and no flower, a bloom
    // carries both, so the two rows are told apart by the picture beside them.
    if (!colorPixels(herb, leafKeys, 0, 0, herb.width, herb.height).length) {
      problems.push(
        "the herb swatch drew no leaf-coloured pixel, so the sprite the plot draws for a herb is not shown beside " +
          "its label."
      );
    }
    if (!colorPixels(bloom, bloomKeys, 0, 0, bloom.width, bloom.height).length) {
      problems.push(
        "the bloom swatch drew no bloom-coloured pixel, so the sprite the plot draws for a bloom is not shown beside " +
          "its label."
      );
    }
    if (colorPixels(herb, bloomKeys, 0, 0, herb.width, herb.height).length) {
      problems.push(
        "the herb swatch drew a bloom-coloured pixel, so a herb's swatch and a bloom's cannot be told apart by " +
          "their flower."
      );
    }
    if (herb.toDataURL() === bloom.toDataURL()) {
      problems.push("the herb and bloom swatches draw the same picture, so the kind is not visible beside its label.");
    }

    // The swatch is the plot's own sprite, pixel for pixel: a garden holding
    // both kinds' plants and seeds draws them at the same places inside a cell
    // as the swatches beside the labels do. Only the sprite's own colours are
    // compared — the plot's soil, its bed edges and the garden's ground growth
    // all draw in the soil's tones — and every cell compared stands still at
    // phase 0, so what differs is the sprite and never the sway.
    const planted = { ...known, plantCounts: [3, 1], seedCounts: [5, 1] };
    const plot = plotCanvas(planted, 0);
    const bounds = plotBounds(planted);
    const cell = bounds.cell;
    const cellAt = (mark) => ({ left: (mark % bounds.columns) * cell, top: Math.floor(mark / bounds.columns) * cell });
    // In `plotMarks` order: three herb plants, one bloom plant, five herb seeds
    // and one bloom seed. Each of the cells named sways by nothing at phase 0.
    for (const [label, swatch, mark, swatchLeft] of [
      ["a grown herb", herb, 0, cell],
      ["a grown bloom", bloom, 3, cell],
      ["an ungrown herb seed", herb, 6, 0],
      ["an ungrown bloom seed", bloom, 9, 0],
    ]) {
      const at = cellAt(mark);
      const onPlot = colorPixels(plot, leafKeys, at.left, at.top, cell, cell);
      const onSwatch = colorPixels(swatch, leafKeys, swatchLeft, 0, cell, cell);
      if (onPlot.join("|") !== onSwatch.join("|")) {
        problems.push(
          `the swatch and the plot draw ${label} differently — ${onSwatch.length} sprite pixels against ` +
            `${onPlot.length} on the plot — so the swatch is not drawn from the plot's own sprite.`
        );
      }
    }

    // The swatch on the page is the swatch the current garden draws: one left
    // over from an earlier form, or never drawn at all, fails here.
    setGarden({ beds: 1, seeds: 1, plants: 0 });
    setGrowth(100, 0.5);
    const shown = getDisplayedState();
    for (const [key, id] of [
      ["herb", "kind-herb-swatch"],
      ["bloom", "kind-bloom-swatch"],
    ]) {
      const live = document.getElementById(id);
      if (!live) continue;
      const expected = document.createElement("canvas");
      drawKindSwatch(expected, key, shown, palette);
      if (live.toDataURL() !== expected.toDataURL()) {
        problems.push(
          `the ${key} swatch beside the label does not show the sprite the plot draws for the current garden ` +
            `(${shown.formName}), so the swatch is stale or was never drawn.`
        );
      }
    }

    // The swatch follows the garden's form: a garden that has grown into a wood
    // draws a different herb from one just sprouting.
    const sprouting = document.createElement("canvas");
    drawKindSwatch(sprouting, "herb", { growth: 1, beds: 1, capacity: PLOT_CAPACITY }, palette);
    const wooded = document.createElement("canvas");
    drawKindSwatch(wooded, "herb", { growth: 1e6, beds: 1, capacity: PLOT_CAPACITY }, palette);
    if (sprouting.toDataURL() === wooded.toDataURL()) {
      problems.push(
        "a sprouting garden and a wood draw the same herb swatch, so the swatch does not follow the garden's form."
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * Each kind's plant milestones: a small ladder at different counts per kind
 * that steps that kind's output up when reached. The two ladders differ, so the
 * best seed to plant keeps changing; the readout names the next step and how
 * many plants remain; the boost is real growth rather than a display figure;
 * and it is derived from the planted counts, so it survives a save round-trip
 * with no migration.
 */
function checkKindMilestones(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    // The ladders sit at different counts on purpose: as the garden grows, one
    // kind reaches its step before the other, so the choice moves.
    if (JSON.stringify(KIND_MILESTONES[0]) === JSON.stringify(KIND_MILESTONES[1])) {
      problems.push(
        `both kinds share the milestone counts ${JSON.stringify(KIND_MILESTONES[0])}, so reaching a milestone never ` +
          "moves which seed is worth planting."
      );
    }
    if (!(MILESTONE_MULTIPLIER > 1)) {
      problems.push(`MILESTONE_MULTIPLIER is ${MILESTONE_MULTIPLIER}; a milestone must step a kind's output up.`);
    }

    // A kind's output is the step raised to the milestones reached: untouched
    // below the first, doubled at it, and doubled again at each step after.
    const multiplierCases = [
      [0, 9, 1],
      [0, 10, 2],
      [0, 25, 4],
      [0, 50, 8],
      [0, 500, 8],
      [1, 14, 1],
      [1, 15, 2],
      [1, 30, 4],
      [1, 60, 8],
    ];
    for (const [index, plants, expected] of multiplierCases) {
      const got = kindMilestoneMultiplier(index, plants);
      if (got !== expected) {
        problems.push(
          `kindMilestoneMultiplier(${index}, ${plants}) is ${got}, expected ${expected}; a kind's output doubles at ` +
            "each milestone it reaches and never before it."
        );
      }
    }

    // The next rung of the ladder, and null once it is climbed.
    const nextCases = [
      [0, 0, 10],
      [0, 9, 10],
      [0, 10, 25],
      [0, 50, null],
      [0, 60, null],
      [1, 0, 15],
      [1, 14, 15],
      [1, 15, 30],
      [1, 60, null],
    ];
    for (const [index, plants, expected] of nextCases) {
      const got = nextKindMilestone(index, plants);
      if (got !== expected) {
        problems.push(
          `nextKindMilestone(${index}, ${plants}) is ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}.`
        );
      }
    }

    // The boost is real growth, not only a display figure. At winter, where no
    // kind's season correction applies, ten herb plants at their raw 5/s must
    // earn exactly twice what those plants alone would, while nine plants just
    // below the step earn the plain rate.
    const span = 100;
    const herbProduction = SEED_KINDS[0].production;
    const expectedBoost = 10 * herbProduction * (MILESTONE_MULTIPLIER - 1);
    const below = simulateGarden({ growth: 0, rate: 9 * herbProduction, plantCounts: [9, 0], beds: 1, age: 0 }, span);
    const at = simulateGarden({ growth: 0, rate: 10 * herbProduction, plantCounts: [10, 0], beds: 1, age: 0 }, span);
    if (Math.abs(milestoneBoost([9, 0])) > 1e-9 || Math.abs(milestoneBoost([10, 0]) - expectedBoost) > 1e-9) {
      problems.push(
        `milestoneBoost gave ${milestoneBoost([9, 0])}/s at 9 herb plants and ${milestoneBoost([10, 0])}/s at 10, ` +
          `expected 0 before the first milestone and ${expectedBoost} at it.`
      );
    }
    if (Math.abs(at.growth - 2 * (10 * herbProduction) * span) > 1e-6) {
      problems.push(
        `10 herb plants at their milestone earned ${at.growth} growth over ${span}s, expected twice the ` +
          `${10 * herbProduction * span} their raw ${10 * herbProduction}/s would earn (${2 * (10 * herbProduction) * span}) — ` +
          "the boost must reach the simulation, not only the readout."
      );
    }
    if (Math.abs(below.growth - 9 * herbProduction * span) > 1e-6) {
      problems.push(
        `9 herb plants one short of the milestone earned ${below.growth} growth over ${span}s, expected the plain ` +
          `${9 * herbProduction * span} with no boost.`
      );
    }
    if (!(at.growth > below.growth)) {
      problems.push(
        `crossing the first herb milestone did not raise the earned growth: ${below.growth} at 9 plants, ` +
          `${at.growth} at 10.`
      );
    }

    // The readout names the same step the simulation rewards: the next milestone
    // and how many more plants that kind needs, and the kind's output rate.
    setGarden({ seeds: 0, plants: 0 });
    setGrowth(0, 0);
    const fresh = getDisplayedState();
    const rows = {
      herb: document.querySelector('[data-field="kind-herb"]'),
      bloom: document.querySelector('[data-field="kind-bloom"]'),
    };
    if (fresh.kinds[0].nextMilestone === fresh.kinds[1].nextMilestone) {
      problems.push(
        `both kinds name the same next milestone (${fresh.kinds[0].nextMilestone}), so the readout never moves ` +
          "which seed is worth planting."
      );
    }
    for (const kind of fresh.kinds) {
      const row = rows[kind.key];
      const shown = (field) =>
        String(row?.querySelector(`[data-field="kind-${kind.key}-${field}"]`)?.textContent ?? "").trim();
      const expectedMilestone = `${formatAmount(kind.nextMilestone)} plants`;
      const expectedRemaining = formatAmount(kind.plantsToMilestone);
      if (shown("milestone") !== expectedMilestone || shown("to-go") !== expectedRemaining) {
        problems.push(
          `the ${kind.key} readout says ${JSON.stringify(shown("milestone"))} at ` +
            `${JSON.stringify(shown("to-go"))} to go, expected it to name its next milestone ` +
            `(${JSON.stringify(expectedMilestone)}) and how many plants remain ` +
            `(${JSON.stringify(expectedRemaining)}).`
        );
      }
    }

    // Once a kind's ladder is climbed it says so, with no count left to reach.
    setGarden({ seeds: 0, plantCounts: [50, 0], beds: 1 });
    setGrowth(0, 0);
    const climbed = getDisplayedState();
    if (climbed.kinds[0].nextMilestone !== null || climbed.kinds[0].plantsToMilestone !== null) {
      problems.push(
        `a herb garden past its last milestone still names ${JSON.stringify(climbed.kinds[0].nextMilestone)} plants ` +
          `with ${JSON.stringify(climbed.kinds[0].plantsToMilestone)} to go, expected neither.`
      );
    }
    const climbedMilestone = String(
      rows.herb?.querySelector('[data-field="kind-herb-milestone"]')?.textContent ?? ""
    ).trim();
    const climbedToGo = String(rows.herb?.querySelector('[data-field="kind-herb-to-go"]')?.textContent ?? "").trim();
    if (climbedMilestone !== "all reached" || climbedToGo !== formatAmount(0)) {
      problems.push(
        `a herb garden past its last milestone reads ${JSON.stringify(climbedMilestone)} at ` +
          `${JSON.stringify(climbedToGo)} to go, expected it to say all milestones are reached with none to go.`
      );
    }

    // Reaching the milestone lifts the kind's output rate as well as the garden's
    // base rate, so the step lands in the number the visitor watches.
    setGarden({ seeds: 0, plantCounts: [10, 0], beds: 1 });
    setGrowth(0, 10 * herbProduction, 0);
    const lifted = getDisplayedState();
    if (
      lifted.kinds[0].milestoneMultiplier !== MILESTONE_MULTIPLIER ||
      Math.abs(lifted.kinds[0].output - herbProduction * MILESTONE_MULTIPLIER) > 1e-9 ||
      !(Math.abs(lifted.baseRate - (10 * herbProduction + expectedBoost)) < 1e-9)
    ) {
      problems.push(
        `10 herb plants reported multiplier ${lifted.kinds[0].milestoneMultiplier}, output ${lifted.kinds[0].output}/s ` +
          `and base rate ${lifted.baseRate}/s, expected x${MILESTONE_MULTIPLIER}, ` +
          `${herbProduction * MILESTONE_MULTIPLIER}/s and ${10 * herbProduction + expectedBoost}/s.`
      );
    }

    // The boost is derived from the planted counts, so a garden keeps it across
    // a save round-trip with no version bump or migration.
    const saved = encodeSave({ seeds: 0, plantCounts: [10, 16], beds: 1 });
    const decoded = decodeSave(saved);
    const boostBefore = milestoneBoost([10, 16]);
    const boostAfter = milestoneBoost(decoded.plantCounts);
    if (!(boostBefore > 0) || Math.abs(boostAfter - boostBefore) > 1e-9) {
      problems.push(
        `a garden of 10 herb and 16 bloom plants is worth ${boostBefore}/s of milestone boost, but after a save ` +
          `round-trip (${JSON.stringify(decoded.plantCounts)}) it is ${boostAfter}/s; the boost must survive a reload ` +
          "with no migration."
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * Draw a state on a fresh offscreen canvas at a pinned phase.
 *
 * The live canvas is animated, so two snapshots of it would differ between
 * ticks for reasons that have nothing to do with the state; a pinned phase on
 * an offscreen canvas makes each picture a pure function of state and phase, so
 * a difference proves a difference in what is drawn.
 */
function plotCanvas(state, phase = 0) {
  const canvas = document.createElement("canvas");
  drawGarden(canvas, state, readPalette(), phase);
  return canvas;
}

/** The same picture as a data URL, so two states can be compared at a glance. */
function plotImage(state, phase = 0) {
  return plotCanvas(state, phase).toDataURL();
}

/**
 * The bounding box, in canvas pixels, of the pixels that differ between two
 * plot renders inside one cell's column — the sprite drawn on that cell, told
 * apart from everything else on the plot.
 */
function changedBoxInCell(before, after, cell, column = 0) {
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const a = before.getContext("2d").getImageData(0, 0, width, height).data;
  const b = after.getContext("2d").getImageData(0, 0, width, height).data;
  const left = column * cell;
  const right = left + cell;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * width + x) * 4;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { width: 0, height: 0 };
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The share of pixels, 0 to 1, that differ between two same-sized plot renders.
 *
 * Comparing two pictures whole, rather than one cell, is how a scene change
 * that belongs to the ground itself — a season's own soil tone — is measured: a
 * whole-field colour cannot hide in the marks of a handful of cells.
 */
function differingPixelShare(a, b) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const before = a.getContext("2d").getImageData(0, 0, width, height).data;
  const after = b.getContext("2d").getImageData(0, 0, width, height).data;
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) changed += 1;
  }
  return changed / (width * height);
}

/**
 * The pixels that differ between two plot renders, as sorted "x,y" keys. Two
 * marks that read the same state the same way add the same pixels, so comparing
 * this list across phases proves a mark holds still even when the sprite under
 * it sways.
 */
function differingPixels(a, b) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const before = a.getContext("2d").getImageData(0, 0, width, height).data;
  const after = b.getContext("2d").getImageData(0, 0, width, height).data;
  const pixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]) continue;
      pixels.push(`${x},${y}`);
    }
  }
  return pixels;
}

/**
 * The cells of a plot whose pixels differ between two renders, as a Set of cell
 * indices. Used to prove that only the sprite standing on a cell moves, and the
 * ground everywhere else holds still.
 */
function changedPixelCells(a, b, cell, columns) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const before = a.getContext("2d").getImageData(0, 0, width, height).data;
  const after = b.getContext("2d").getImageData(0, 0, width, height).data;
  const cells = new Set();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]) continue;
      cells.add(Math.floor(y / cell) * columns + Math.floor(x / cell));
    }
  }
  return cells;
}

/** Whether one cell of a plot render carries a pixel of the given palette colour. */
function cellHasColor(canvas, color, cell, column = 0) {
  const key = colorKey(parseColor(color));
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  const left = column * cell;
  const right = left + cell;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (`${data[i]},${data[i + 1]},${data[i + 2]}` === key) return true;
    }
  }
  return false;
}

/**
 * The pixels of one region of a render that carry any of `colorKeys`, as "x,y"
 * keys relative to the region's top-left corner, in row-major order.
 *
 * Only a sprite's own colours are ever compared, never the ground: the plot's
 * soil, its bed edges and the garden's ground growth all draw in the soil's
 * tones, so a sprite's leaf and flower pixels are the sprite and nothing else.
 * That is how the swatch beside a kind's label is held to the very sprite the
 * plot draws for that kind.
 */
function colorPixels(canvas, colorKeys, left, top, width, height) {
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels = [];
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      if (colorKeys.has(`${data[i]},${data[i + 1]},${data[i + 2]}`)) pixels.push(`${x - left},${y - top}`);
    }
  }
  return pixels;
}

/**
 * The first pixel of any of `colorKeys` in a plot render, as its rgb key, or
 * null when the whole picture carries none of them. Used to prove a colour is
 * absent — a growing thing's leaf green must not appear where nothing grows.
 */
function firstPixelOfColors(canvas, colorKeys) {
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    if (colorKeys.has(key)) return key;
  }
  return null;
}

/**
 * The soil is one field of ground, not a grid of identical tiles.
 *
 * Each cell carries its own small marks — a furrow, a damp patch, a pebble, a
 * stray weed — chosen by hashing the cell and the season together, so the plot
 * reads as one patch of earth that changes with the garden's year. The marks
 * are a pure function of the cell and the season, so the ground is a still
 * frame whatever the motion preference, and the whole plot is filled once with
 * one colour, so the ground itself outlines no cell as its own tile. The bed
 * edge each plot carries is drawn in the soil's own tones — over the ground, so
 * the soil's own marks cannot bury it — and reads no phase, which the pixels
 * this check probes between two phases prove.
 */
function checkSoilField(problems) {
  const bounds = plotBounds({ growth: 0, beds: 1 });
  const cells = bounds.cells;
  const seasons = ["winter", "spring", "summer", "autumn"];

  // Neighbouring cells carry different marks, so the plot is not one stamp
  // repeated across the grid.
  const faces = Array.from({ length: cells }, (_, cell) => JSON.stringify(soilFace(cell, "summer")));
  const distinctFaces = new Set(faces).size;
  if (distinctFaces < Math.min(cells, 4)) {
    problems.push(
      `the plot's ${cells} soil cells share only ${distinctFaces} distinct faces, so they still read as copies of one square.`
    );
  }

  // The same cell and season always draw the same face, and the seasons differ.
  for (let cell = 0; cell < cells; cell += 1) {
    if (JSON.stringify(soilFace(cell, "spring")) !== JSON.stringify(soilFace(cell, "spring"))) {
      problems.push(`soilFace(${cell}, "spring") is not stable, so the soil is not a pure view of the cell and season.`);
      break;
    }
  }
  const seasonFaces = new Set(
    seasons.map((key) => Array.from({ length: cells }, (_, cell) => JSON.stringify(soilFace(cell, key))).join("|"))
  );
  if (seasonFaces.size < 2) {
    problems.push(
      `the ${seasons.length} seasons draw the same soil faces, so the ground does not change with the garden's year.`
    );
  }

  // The ground is a still frame: the soil stays put between phases even while a
  // planted plot as a whole changes, so only the foliage sways.
  const planted = { growth: 100, beds: 1, plants: 2, seeds: 0, pollinator: { visiting: false } };
  const plantedStill = plotImage(planted, 0);
  const plantedMoved = plotImage(planted, 1);
  if (plantedStill === plantedMoved) {
    problems.push("a planted plot drew the same picture on two phases, so nothing in it visibly moves.");
  }
  const soilPixel = (x, y, phase) => {
    const data = plotCanvas(planted, phase).getContext("2d").getImageData(x, y, 1, 1).data;
    return `${data[0]},${data[1]},${data[2]}`;
  };
  const soilProbes = [
    [0, 0],
    [bounds.cell, bounds.cell / 2],
    [(bounds.columns - 1) * bounds.cell, bounds.height - 2],
  ];
  for (const [x, y] of soilProbes) {
    if (soilPixel(x, y, 0) !== soilPixel(x, y, 1)) {
      problems.push(
        `the soil at (${x}, ${y}) changed between phase 0 and phase 1 ` +
          `(${soilPixel(x, y, 0)} → ${soilPixel(x, y, 1)}), so the ground moves as well as the foliage.`
      );
    }
  }
}

/** The plot draws the two kinds differently, plants and sprouts alike. */
function checkPlotDrawsKinds(problems) {
  const live = document.getElementById("garden-plot");
  if (!live || !live.getContext) {
    problems.push("the page has no plot canvas (#garden-plot) to draw the kinds into.");
    return;
  }
  const herbPlant = plotImage({ plants: 1 });
  const bloomPlant = plotImage({ plantCounts: [0, 1] });
  const herbSprout = plotImage({ seeds: 1 });
  const bloomSprout = plotImage({ bloomSprouts: [SEED_KINDS[1].growSeconds] });
  if (herbPlant === bloomPlant) {
    problems.push("a grown herb and a grown bloom draw the same picture, so the two kinds are not visible on the plot.");
  }
  if (herbSprout === bloomSprout) {
    problems.push("a herb sprout and a bloom sprout draw the same picture, so the two kinds are not visible on the plot.");
  }
}

/**
 * Every kind of growing thing is a mark a visitor can point at: each sprite
 * spans a real share of the cell at the plot's own size, and a bloom is in
 * flower where a herb is not.
 *
 * Each picture is taken at phase 0 — the still frame reduced motion pins to —
 * and only the mark's own cell is measured, so a sprite shrunk back into a
 * speck, or a bloom recoloured to a herb's green, trips this.
 */
function checkPlotSpritesLegible(problems) {
  const bounds = plotBounds({ growth: 0, beds: 1, capacity: PLOT_CAPACITY });
  const cell = bounds.cell;
  const planted = (extra) => ({ growth: 0, beds: 1, capacity: PLOT_CAPACITY, pollinator: { visiting: false }, ...extra });
  const bare = plotCanvas(planted({ seeds: 0, plants: 0 }));

  // A sprite has to fill enough of its cell to be told apart at the plot's
  // on-screen size: the seed is the smallest, the grown plants the tallest.
  const sprites = [
    ["an ungrown herb seed", planted({ seeds: 1 }), 10, 8],
    ["a grown herb", planted({ plants: 1 }), 12, 16],
    ["a grown bloom", planted({ plantCounts: [0, 1] }), 13, 16],
  ];
  for (const [label, state, leastWide, leastTall] of sprites) {
    const box = changedBoxInCell(plotCanvas(state), bare, cell);
    if (box.width < leastWide || box.height < leastTall) {
      problems.push(
        `${label} draws a ${box.width}x${box.height}px mark, smaller than the ${leastWide}x${leastTall}px a ` +
          "visitor needs to tell it apart on the plot."
      );
    }
  }

  // The bee is measured against the same garden at rest, so only the bee out
  // visiting is in the difference. It hovers on the home's own strip beside its
  // hive, not over a plot, so it is sought in the strip's second cell — the
  // column past the last plot column — where nothing a visitor counts stands.
  const flying = planted({ plants: 1, pollinator: { visiting: true } });
  const resting = planted({ plants: 1, pollinator: { visiting: false } });
  const homeColumn = Math.round(bounds.home.x / cell) + 1;
  const bee = changedBoxInCell(plotCanvas(flying), plotCanvas(resting), cell, homeColumn);
  if (bee.width < 10 || bee.height < 6) {
    problems.push(
      `the visiting pollinator draws a ${bee.width}x${bee.height}px mark on its home's strip, smaller than the ` +
        "10x6px a visitor needs to find it on the plot."
    );
  }

  // The two grown kinds are told apart by flower, not only by silhouette.
  const palette = readPalette();
  if (cellHasColor(plotCanvas(planted({ plants: 1 })), palette.bloom, cell)) {
    problems.push("a grown herb carries the bloom colour, so a herb and a bloom cannot be told apart by their flower.");
  }
  if (!cellHasColor(plotCanvas(planted({ plantCounts: [0, 1] })), palette.bloom, cell)) {
    problems.push("a grown bloom carries no bloom-coloured pixel, so it does not read as a bloom.");
  }

  // While the pollinator is out, no plot cell a herb-only garden counts carries
  // the bloom colour: the bee is drawn beside its hive, off the plots, so the
  // picture agrees with the 'Bloom PLANTS 0' the readout states. This is the
  // regression the visiting bee used to trip by painting bloom-coloured wings
  // over the top-left plots.
  const visitingHerbs = plotCanvas(planted({ plantCounts: [PLOT_CAPACITY, 0], pollinator: { visiting: true } }));
  for (let column = 0; column < bounds.columns; column += 1) {
    if (cellHasColor(visitingHerbs, palette.bloom, cell, column)) {
      problems.push(
        `a herb-only garden draws the bloom colour on plot column ${column} while the pollinator is out visiting, ` +
          "so the picture shows a bloom the 'Bloom PLANTS 0' beside it does not count."
      );
      break;
    }
  }
}

/**
 * A kind that has reached a plant milestone draws its plants in a form a kind
 * that has not reached it does not: a still crown the readout's milestone
 * multiplier accounts for.
 *
 * The tiers are read from the same `kindMilestoneMultiplier` the readout and
 * `get-state` are built from, so the crown cannot drift from the number beside
 * it, and the crown reads no animation phase, so it holds in the still frame
 * reduced motion pins to and a visitor sees the reward the moment it is earned.
 */
function checkPlotMilestoneCrowns(problems) {
  // The ladder itself: one tier per rung earned, and no crown below the first.
  const ladder = [
    ["9 herb plants", { plantCounts: [9, 0] }, [0, 0]],
    ["10 herb plants", { plantCounts: [10, 0] }, [1, 0]],
    ["25 herb plants", { plantCounts: [25, 0] }, [2, 0]],
    ["14 bloom plants", { plantCounts: [0, 14] }, [0, 0]],
    ["15 bloom plants", { plantCounts: [0, 15] }, [0, 1]],
  ];
  for (const [label, state, expected] of ladder) {
    const tiers = plotMilestoneTiers(state);
    if (tiers[0] !== expected[0] || tiers[1] !== expected[1]) {
      problems.push(
        `a garden of ${label} reports milestone tiers [${tiers}], expected [${expected}]; a crown must appear exactly ` +
          "when a rung is reached."
      );
    }
  }
  // A caller that only knew the one kind's total still earns the first kind's
  // crown, exactly as `kindsOnPlot` draws its plants.
  const legacy = plotMilestoneTiers({ plants: 10 })[0];
  if (legacy !== 1) {
    problems.push(
      `a state with a bare 10-plant total reports milestone tier ${legacy}, expected 1, so the crown is lost on a ` +
        "caller that counts plants the old way."
    );
  }

  // The tiers are the readout's own milestone multiplier: the plot and the
  // number beside it are derived from one function and cannot disagree.
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    setGarden({ seeds: 0, plantCounts: [25, 15], beds: 1 });
    setGrowth(1e2, 0);
    const live = getDisplayedState();
    const tiers = plotMilestoneTiers(live);
    const expected = live.kinds.map((kind) =>
      Math.round(Math.log(kind.milestoneMultiplier) / Math.log(MILESTONE_MULTIPLIER))
    );
    for (const index of [0, 1]) {
      if (tiers[index] !== expected[index]) {
        problems.push(
          `get-state reports the ${live.kinds[index].name}'s milestone multiplier ` +
            `${live.kinds[index].milestoneMultiplier} (tier ${expected[index]}) but the plot draws tier ${tiers[index]}, ` +
            "so the crown and the readout disagree."
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }

  // The picture itself: two gardens differing only in crossing the herb
  // threshold draw differently at the still frame reduced motion pins to, and
  // the crowned one carries the crown's own colour on its plant's cell.
  const palette = readPalette();
  const before = { growth: 0, beds: 1, seeds: 0, plantCounts: [9, 0], pollinator: { visiting: false } };
  const earned = { ...before, plantCounts: [10, 0] };
  const cell = plotBounds(earned).cell;
  if (!cellHasColor(plotCanvas(earned, 0), palette.sun, cell, 0)) {
    problems.push(
      "a kind at its first plant milestone drew no crown-coloured pixel on its plant, so the reward the readout " +
        "states is not visible on the plot."
    );
  }
  if (cellHasColor(plotCanvas(before, 0), palette.sun, cell, 0)) {
    problems.push(
      "a kind below its first plant milestone already drew a crown-coloured pixel, so the crown does not mark a " +
        "milestone."
    );
  }
  const crown = changedBoxInCell(plotCanvas(before, 0), plotCanvas(earned, 0), cell, 0);
  if (crown.width === 0 || crown.height === 0) {
    problems.push(
      "crossing the first plant milestone changed nothing inside the plant's cell, so a kind that earned a " +
        "milestone looks exactly like one that has not."
    );
  }
  // The crown is drawn from the milestone alone, not the animation: it is on
  // the plant at another phase too, so reduced motion and a still frame keep it.
  if (!cellHasColor(plotCanvas(earned, 3), palette.sun, cell, 0)) {
    problems.push(
      "the milestone crown vanished at another animation phase, so it relies on the breathing frame instead of " +
        "standing on its own."
    );
  }
}

/**
 * The picture cannot disagree with the numbers: the plot draws one mark for
 * every seed and plant the readout counts, up to the cells it has.
 *
 * A garden always has a cell for each plot of a full bed, a save far larger
 * than the grid stays bounded with one mark per cell, and the kinds the marks
 * carry are the kinds `get-state` reports.
 */
function checkPlotMarksMatchCounts(problems) {
  for (let beds = 1; beds <= 4; beds += 1) {
    const capacity = beds * PLOTS_PER_BED;
    const state = { growth: 1e3, beds, capacity, seeds: capacity, plants: 0 };
    const bounds = plotBounds(state);
    if (bounds.cells < capacity) {
      problems.push(
        `a ${beds}-bed garden of ${capacity} plots draws only ${bounds.cells} cells, so it cannot show every ` +
          "seed the readout counts."
      );
    }
    const marks = plotMarks(state);
    if (marks.length < capacity) {
      problems.push(
        `a full ${beds}-bed garden counts ${capacity} seeds but the plot draws ${marks.length} marks, so the ` +
          "picture and the numbers disagree."
      );
    }
  }

  // A garden far larger than the grid is drawn bounded, one mark per cell.
  const huge = {
    growth: 1e12,
    beds: 5000,
    capacity: 60000,
    plantCounts: [1e12, 1e12],
    seedCounts: [1e12, 1e12],
  };
  const hugeBounds = plotBounds(huge);
  const hugeMarks = plotMarks(huge);
  if (hugeMarks.length !== hugeBounds.cells) {
    problems.push(
      `a huge garden drew ${hugeMarks.length} marks over ${hugeBounds.cells} cells, so the marks are not bounded ` +
        "by the plot."
    );
  }
  if (hugeBounds.cells > hugeBounds.maxRows * hugeBounds.columns) {
    problems.push(
      `a huge garden drew ${hugeBounds.cells} cells over a ${hugeBounds.maxRows}-row cap, so the picture is not bounded.`
    );
  }
  const drawnCells = new Set(hugeMarks.map((mark) => mark.cell));
  if (drawnCells.size !== hugeMarks.length) {
    problems.push("two marks landed on the same plot cell, so the picture draws some seeds on top of others.");
  }

  // Each kind the picture draws is the kind the readout counts, in order.
  const mixed = { growth: 100, beds: 1, capacity: PLOT_CAPACITY, plantCounts: [3, 1], seedCounts: [2, 1] };
  const mixedMarks = plotMarks(mixed);
  const counted = (kind) => mixedMarks.filter((mark) => mark.kind === kind).length;
  if (counted("herb-plant") !== 3 || counted("bloom-plant") !== 1 || counted("herb-seed") !== 2 || counted("bloom-seed") !== 1) {
    problems.push(
      "a garden of 3 herb plants / 1 bloom plant / 2 herb seeds / 1 bloom seed drew " +
        `${JSON.stringify(mixedMarks.map((mark) => mark.kind))}, which does not match the readout.`
    );
  }

  // The live readout and the plot's marks are the same garden, so an agent
  // reading get-state and a visitor looking at the plot cannot disagree.
  const live = getDisplayedState();
  const liveMarks = plotMarks(live);
  const liveBounds = plotBounds(live);
  if (live.seeds + live.plants <= liveBounds.cells) {
    const kindCount = (kind) => liveMarks.filter((mark) => mark.kind === kind).length;
    const reported = [
      ["herb plant", "herb-plant", live.plantCounts[0]],
      ["bloom plant", "bloom-plant", live.plantCounts[1]],
      ["herb seed", "herb-seed", live.seedCounts[0]],
      ["bloom seed", "bloom-seed", live.seedCounts[1]],
    ];
    for (const [label, kind, count] of reported) {
      if (kindCount(kind) !== count) {
        problems.push(
          `get-state reports ${count} ${label}(s) but the plot draws ${kindCount(kind)}, so the picture and the ` +
            "numbers disagree."
        );
      }
    }
  }
}

/**
 * Every plot of soil is drawn as its own plot, so the picture can be counted
 * against the panel beside it.
 *
 * `plotCells` is the picture's own reading of what it owns: one plot per plot of
 * the garden's capacity, grouped into beds of `PLOTS_PER_BED`, each marked with
 * whether a seed or plant holds it. The drawn plot gives each plot a low bed
 * edge in the soil's own tones — a lit ridge along its top with a dark line
 * beneath, and a lit seam down its left boundary — so the plots can be counted
 * across a row as well as down a column, and closes every bed the grid holds
 * with a lit rim along its first row, its last row's foot and both its sides, so
 * an empty bed reads as a bed of soil and two beds can be told apart. The edges
 * read no animation phase, so reduced motion draws them too.
 */
/**
 * The lit ridge and left seam every plot of `state` must carry, as problem
 * messages: each plot's own edge is drawn in the soil's own tones, so the picture
 * can be counted across a row as well as down a column. `label` names the garden
 * in the message, so a failure says which picture could not be counted.
 */
function plotEdgeProblems(state, label) {
  const lightKey = colorKey(parseColor(readPalette().soilLight));
  const bounds = plotBounds(state);
  const data = plotCanvas(state).getContext("2d").getImageData(0, 0, bounds.width, bounds.height).data;
  const pixelAt = (x, y) => {
    const i = (y * bounds.width + x) * 4;
    return `${data[i]},${data[i + 1]},${data[i + 2]}`;
  };
  const problems = [];
  for (const plot of plotCells(state).plots) {
    const left = plot.column * bounds.cell;
    const top = plot.row * bounds.cell;
    let lit = 0;
    for (let x = left; x < left + bounds.cell; x += 1) if (pixelAt(x, top) === lightKey) lit += 1;
    if (lit < 8) {
      problems.push(
        `${label}: the plot at column ${plot.column}, row ${plot.row} carries ${lit} lit pixels along its top edge, ` +
          "so it cannot be counted in the picture."
      );
      break;
    }
    if (plot.column === 0) continue;
    const seamY = top + Math.floor(bounds.cell / 2);
    if (pixelAt(left, seamY) !== lightKey) {
      problems.push(
        `${label}: the seam at (${left}, ${seamY}) beside the plot at column ${plot.column}, row ${plot.row} is ` +
          `rgb(${pixelAt(left, seamY)}) rather than the palette soil-light rgb(${lightKey}), so the plots cannot be ` +
          "counted across the row."
      );
      break;
    }
  }
  return problems;
}

function checkPlotBedEdges(problems) {
  const palette = readPalette();
  const lightKey = colorKey(parseColor(palette.soilLight));
  const leafKey = colorKey(parseColor(palette.leafDeep));

  // One plot per plot of the capacity, one bed of plots per bed, and opening a
  // bed widens the picture by exactly one bed of plots — up to the row cap the
  // grid has always had.
  for (let beds = 1; beds <= 4; beds += 1) {
    const capacity = beds * PLOTS_PER_BED;
    const grid = plotCells({ growth: 0, beds, capacity, seeds: capacity, plants: 0 });
    if (grid.plots.length !== capacity) {
      problems.push(
        `a ${beds}-bed garden of ${capacity} plots draws ${grid.plots.length} plots, so the picture cannot be ` +
          "counted against the panel's 'Plots of soil'."
      );
    }
    const perBed = new Map();
    for (const plot of grid.plots) perBed.set(plot.bed, (perBed.get(plot.bed) ?? 0) + 1);
    if (perBed.size !== beds || [...perBed.values()].some((count) => count !== PLOTS_PER_BED)) {
      problems.push(
        `a ${beds}-bed garden of ${capacity} plots draws bed groups ${JSON.stringify([...perBed.values()])}, ` +
          `expected ${beds} beds of ${PLOTS_PER_BED} plots.`
      );
    }
    if (grid.fullBeds.length !== beds) {
      problems.push(
        `a ${beds}-bed garden with a seed on every one of its ${capacity} plots reports ${grid.fullBeds.length} ` +
          `full beds, expected all ${beds}.`
      );
    }
    if (beds < 4) {
      const opened = plotCells({ growth: 0, beds: beds + 1, capacity: (beds + 1) * PLOTS_PER_BED, seeds: 0, plants: 0 });
      const added = opened.plots.length - grid.plots.length;
      if (added !== PLOTS_PER_BED) {
        problems.push(
          `opening a bed onto a ${beds}-bed garden of ${grid.plots.length} drawn plots added ${added} plots, ` +
            `expected exactly one bed's ${PLOTS_PER_BED}.`
        );
      }
    }
  }

  // The live picture owns the plots the panel counts: get-state's capacity is
  // the 'Plots of soil' beside the plot, and the drawn grid holds that many.
  const live = getDisplayedState();
  const liveGrid = plotCells(live);
  if (live.capacity <= liveGrid.cells && liveGrid.plots.length !== live.capacity) {
    problems.push(
      `the panel reports ${live.capacity} plots of soil but the plot draws ${liveGrid.plots.length}, so the ` +
        "picture cannot be counted against the number beside it."
    );
  }

  // A plot's occupancy is what the picture draws on it, so an empty plot can be
  // told from one holding a seed or plant.
  const mixed = { growth: 0, beds: 2, capacity: 2 * PLOTS_PER_BED, plantCounts: [3, 1], seedCounts: [2, 1] };
  const marked = new Set(plotMarks(mixed).map((mark) => mark.cell));
  for (const plot of plotCells(mixed).plots) {
    if (plot.occupied !== marked.has(plot.cell)) {
      problems.push(
        `the plot at cell ${plot.cell} is reported ${plot.occupied ? "held" : "empty"} while the picture draws ` +
          `${marked.has(plot.cell) ? "a mark" : "nothing"} on it, so an empty plot cannot be told from a held one.`
      );
      break;
    }
  }

  // Every leaf-green pixel of a garden holding one seed lands on the plot the
  // picture says holds it, so the seed is seen on its own plot and an empty plot
  // carries no growing thing.
  const oneSeed = { growth: 0, beds: 1, capacity: PLOT_CAPACITY, seeds: 1, plants: 0, pollinator: { visiting: false } };
  const bounds = plotBounds(oneSeed);
  const cell = bounds.cell;
  const imageOf = (state, phase = 0) =>
    plotCanvas(state, phase).getContext("2d").getImageData(0, 0, bounds.width, bounds.height).data;
  const pixelOf = (data, x, y) => {
    const i = (y * bounds.width + x) * 4;
    return `${data[i]},${data[i + 1]},${data[i + 2]}`;
  };
  const seedData = imageOf(oneSeed);
  const seeded = new Set();
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      if (pixelOf(seedData, x, y) !== leafKey) continue;
      seeded.add(Math.floor(y / cell) * bounds.columns + Math.floor(x / cell));
    }
  }
  for (const plot of plotCells(oneSeed).plots) {
    if (plot.occupied !== seeded.has(plot.cell)) {
      problems.push(
        `the plot at column ${plot.column}, row ${plot.row} is reported ${plot.occupied ? "held" : "empty"} but the ` +
          `picture ${seeded.has(plot.cell) ? "draws a growing thing" : "draws none"} on it, so a plot holding a ` +
          "seed cannot be told from an empty one."
      );
      break;
    }
  }

  // Every plot carries a lit ridge along its top and, wherever a plot sits to
  // its left, a lit seam down its left boundary, so the picture can be counted
  // across a row as well as down a column.
  const bare = { growth: 0, beds: 1, capacity: PLOT_CAPACITY, seeds: 0, plants: 0, pollinator: { visiting: false } };
  problems.push(...plotEdgeProblems(bare, "a bed of bare soil"));

  // The ticket's own scene: two beds open and the first bed's plots planted, so
  // the readout says 24 plots of soil while only half the picture holds anything.
  // All 24 plots carry their ridge and their left seam — the emptied bed under a
  // full ground cover too — and each bed is closed by its own rim, so a visitor
  // who reads no number can still count the room there is to plant in and tell
  // the two beds apart.
  const twoBeds = {
    growth: 1e6,
    beds: 2,
    capacity: 2 * PLOTS_PER_BED,
    plantCounts: [PLOTS_PER_BED, 0],
    pollinator: { visiting: false },
  };
  const twoBounds = plotBounds(twoBeds);
  const twoGrid = plotCells(twoBeds);
  if (twoBounds.rows !== 6 || twoGrid.plots.length !== 2 * PLOTS_PER_BED || twoGrid.beds !== 2) {
    problems.push(
      `two open beds of ${2 * PLOTS_PER_BED} plots draw ${twoGrid.plots.length} plots in ${twoGrid.beds} beds over ` +
        `${twoBounds.rows} rows, expected ${2 * PLOTS_PER_BED} plots in 2 beds over 6 rows.`
    );
  }
  problems.push(...plotEdgeProblems(twoBeds, "two open beds with one of them emptied"));
  const twoData = plotCanvas(twoBeds).getContext("2d").getImageData(0, 0, twoBounds.width, twoBounds.height).data;
  const twoPixel = (x, y) => {
    const i = (y * twoBounds.width + x) * 4;
    return `${twoData[i]},${twoData[i + 1]},${twoData[i + 2]}`;
  };
  for (let bed = 0; bed < twoGrid.beds; bed += 1) {
    const inBed = twoGrid.plots.filter((plot) => plot.bed === bed);
    const top = Math.min(...inBed.map((plot) => plot.row)) * cell;
    const foot = (Math.max(...inBed.map((plot) => plot.row)) + 1) * cell - 1;
    for (const [x, y] of [[0, top], [twoBounds.width - 1, top], [0, foot], [twoBounds.width - 1, foot]]) {
      if (twoPixel(x, y) !== lightKey) {
        problems.push(
          `of two open beds, bed ${bed}'s rim pixel (${x}, ${y}) is rgb(${twoPixel(x, y)}) rather than the palette ` +
            `soil-light rgb(${lightKey}), so the boundary between the beds is not visible on the plot.`
        );
      }
    }
  }

  // A bed is closed by a lit rim along its first row, its last row's foot and
  // both sides — whether its plots are held or empty — so a bed of soil reads as
  // a bed whatever is planted in it.
  const holding = (plants) => ({
    growth: 0,
    beds: 1,
    capacity: PLOT_CAPACITY,
    plantCounts: [plants, 0],
    pollinator: { visiting: false },
  });
  const fullBed = holding(PLOTS_PER_BED);
  const partBed = holding(PLOTS_PER_BED - 1);
  const fullBeds = plotCells(fullBed).fullBeds.length;
  const partBeds = plotCells(partBed).fullBeds.length;
  if (fullBeds !== 1 || partBeds !== 0) {
    problems.push(
      `a bed of ${PLOTS_PER_BED} plants and one of ${PLOTS_PER_BED - 1} report ${fullBeds} / ${partBeds} full ` +
        "beds, expected 1 / 0."
    );
  }
  const fullData = imageOf(fullBed);
  const partData = imageOf(partBed);
  const lastRowFoot = bounds.rows * cell - 1;
  for (const [name, data] of [["a full", fullData], ["a partly filled", partData]]) {
    for (const [x, y] of [[0, 0], [bounds.width - 1, 0], [0, lastRowFoot], [bounds.width - 1, lastRowFoot]]) {
      if (pixelOf(data, x, y) !== lightKey) {
        problems.push(
          `${name} bed's edge pixel (${x}, ${y}) is rgb(${pixelOf(data, x, y)}) rather than the palette soil-light ` +
            `rgb(${lightKey}), so the bed is not closed by its rim.`
        );
      }
    }
  }

  // The edge reads no animation phase, so a bed's rim is the same lit pixel in
  // the still frame reduced motion pins to as at any moving one.
  const movedData = imageOf(fullBed, 3);
  for (const x of [0, bounds.width - 1]) {
    if (pixelOf(movedData, x, 0) !== lightKey) {
      problems.push(
        `a full bed's rim pixel (${x}, 0) is rgb(${pixelOf(movedData, x, 0)}) at another phase rather than the ` +
          `palette soil-light rgb(${lightKey}), so the bed edge does not hold still under reduced motion.`
      );
    }
  }
}

/**
 * The plot fills with the garden's own growth, not only the plants it owns.
 *
 * A low-plant, high-growth garden — a single plant named "a stand of plants" —
 * must still draw most of the plot under growth, so the picture carries the
 * growth rather than leaving a field of bare squares. The cover must rise from
 * one form to the next, be a pure function of the state, and be drawn from the
 * growth itself rather than only from how tall one sprite stands.
 */
function checkPlotCoverage(problems) {
  const stand = { growth: 1e3, beds: 1, seeds: 0, plants: 1 };
  const cover = groundCover(stand);
  if (!(cover.ratio > 0.5) || !(cover.covered > cover.cells / 2)) {
    problems.push(
      `a stand of plants at 1000 growth covers ${cover.covered}/${cover.cells} cells (ratio ${cover.ratio}), ` +
        "so a garden with one plant and a thousand growth still draws an empty plot."
    );
  }

  const bed = groundCover({ growth: 1e2, beds: 1, seeds: 0, plants: 1 });
  const fuller = groundCover({ growth: 2e3, beds: 1, seeds: 0, plants: 1 });
  const hedge = groundCover({ growth: 1e4, beds: 1, seeds: 0, plants: 1 });
  if (!(fuller.covered > cover.covered) || !(fuller.ratio > cover.ratio)) {
    problems.push(
      `within "a stand of plants" the plot covers ${cover.covered} cells at 1000 growth and ${fuller.covered} at 2000, ` +
        "so the plot does not fill as growth rises within a form."
    );
  }
  if (!(hedge.covered > bed.covered) || !(hedge.ratio > bed.ratio)) {
    problems.push(
      `the plot covers ${bed.covered} cells at 100 growth and ${hedge.covered} at 10000, ` +
        "so advancing a form does not visibly fill it."
    );
  }

  // The same state must draw the same cover, so the still frame and reduced
  // motion show a stable picture.
  if (JSON.stringify(groundCover(stand)) !== JSON.stringify(groundCover(stand))) {
    problems.push("groundCover drew two different covers for the same state, so the plot is not a pure view of it.");
  }

  // The filling is drawn from growth alone: two states in one form with no
  // plant at all, and so the very same bare soil, differ by the ground growth.
  const groundLow = plotImage({ growth: 1e3, beds: 1, seeds: 0, plants: 0 });
  const groundFull = plotImage({ growth: 2e3, beds: 1, seeds: 0, plants: 0 });
  if (groundLow === groundFull) {
    problems.push(
      "the plot drew the same bare soil at 1000 and 2000 growth, so the garden's growth is not drawn on the plot."
    );
  }

  // Under a single sprite the fill still shows, so a fuller plot is not just a
  // taller plant.
  const low = plotImage({ growth: 1e3, beds: 1, seeds: 0, plants: 1 });
  const higher = plotImage({ growth: 2e3, beds: 1, seeds: 0, plants: 1 });
  if (low === higher) {
    problems.push(
      "the plot drew the same picture at 1000 and 2000 growth under one plant, so it fills only by growing that sprite."
    );
  }
  const bareWithPlant = plotImage({ growth: 0, beds: 1, seeds: 0, plants: 1 });
  if (low === bareWithPlant) {
    problems.push(
      "a stand of plants drew the same picture as bare soil with one plant, so the growth does not fill the plot."
    );
  }
}

/**
 * Ground is never drawn as growth: no mark of bare soil or of the garden's own
 * ground cover wears the leaf green a seed or a plant carries, in any season,
 * and the cover stays far shorter than the smallest growing thing, so a covered
 * plot cannot read as a field of plants.
 *
 * The cover blades are the one ground layer a visitor could otherwise mistake
 * for a sprout, so this pins both its colour — soil tones only — and its height,
 * measured against an ungrown seed's sprite from the very same
 * `changedBoxInCell` the seed's own legibility check uses.
 */
function checkGroundIsNotGrowth(problems) {
  const palette = readPalette();
  const leafKeys = new Set(
    [
      palette.leaf,
      palette.leafLight,
      palette.leafDeep,
      ...Object.values(palette.leafSeasons).flatMap((trio) => [trio.leaf, trio.leafLight, trio.leafDeep]),
    ].map((color) => colorKey(parseColor(color)))
  );

  const bare = { growth: 0, beds: 1, seeds: 0, plants: 0, pollinator: { visiting: false } };
  // One form-row up from bare soil (a seedling), so the canvas is the same size
  // and a covered plot differs from a bare one in the ground cover alone.
  const covered = { ...bare, growth: 99 };

  // A covered, plantless plot carries no leaf green in any season: its soil
  // marks and its ground cover are drawn in the soil's tones only.
  for (const season of [null, ...SEASONS.map((entry) => entry.key)]) {
    const state = season ? { ...covered, season: { key: season } } : covered;
    const leafPixel = firstPixelOfColors(plotCanvas(state), leafKeys);
    if (leafPixel) {
      problems.push(
        `a covered plot with no ungrown seed or grown plant draws a leaf-green pixel rgb(${leafPixel}) ` +
          (season ? `in ${season}` : "with no season") +
          ", so a mark of bare soil or ground cover reads as a growing thing."
      );
    }
  }

  // The same plot with one plant does carry leaf green, so the sprite stands out
  // of plainly-read ground rather than the ground masking it.
  if (!firstPixelOfColors(plotCanvas({ ...covered, plants: 1 }), leafKeys)) {
    problems.push(
      "a covered plot with one grown plant draws no leaf-green pixel, so a plant cannot be told from the ground it stands on."
    );
  }

  // The ground cover rises only a few pixels off each cell's foot, and strictly
  // less than the sprite of an ungrown seed — the smallest growing thing the
  // panel counts — so a covered plot does not read as a field of plants.
  const bareCanvas = plotCanvas(bare);
  const coveredCanvas = plotCanvas(covered);
  const width = Math.min(bareCanvas.width, coveredCanvas.width);
  const height = Math.min(bareCanvas.height, coveredCanvas.height);
  const before = bareCanvas.getContext("2d").getImageData(0, 0, width, height).data;
  const after = coveredCanvas.getContext("2d").getImageData(0, 0, width, height).data;
  const cell = plotBounds(bare).cell;
  let tallestCover = 0;
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2] && before[i + 3] === after[i + 3]) {
        continue;
      }
      changed += 1;
      const rise = (Math.floor(y / cell) + 1) * cell - y;
      if (rise > tallestCover) tallestCover = rise;
    }
  }
  if (changed === 0) {
    problems.push("a covered plot drew the same soil as a bare one, so the garden's growth is not drawn on the plot at all.");
    return;
  }
  const seedHeight = changedBoxInCell(plotCanvas({ ...bare, seeds: 1 }), bareCanvas, cell, 0).height;
  if (seedHeight === 0) {
    problems.push("an ungrown seed drew nothing on the plot, so its height cannot be compared with the ground cover.");
  } else if (tallestCover >= seedHeight) {
    problems.push(
      `the ground cover rises ${tallestCover}px above a cell's foot, no shorter than the ${seedHeight}px an ungrown ` +
        "seed stands, so a covered plot reads as a field of plants."
    );
  }
}

/**
 * The garden's lifetime is drawn as a lasting layer of its own: an old,
 * well-kept garden reads as established, a replanted plot is never drawn as
 * bare soil, and the current growth still decides how full the plot is.
 *
 * The layer is one pure mapping from the lifetime the readout and `get-state`
 * report, hash-derived and phase-free, so it holds in the still frame reduced
 * motion pins to and cannot drift from the numbers beside it.
 */
function checkPlotEstablishment(problems) {
  // The mapping: no history is fresh ground with no fill at all, and the ground
  // is turning over by the time a replant is first earned.
  const fresh = establishment(0);
  if (fresh.index !== 0 || fresh.name !== ESTABLISHMENTS[0].name || fresh.fill !== 0) {
    problems.push(
      `zero lifetime is establishment ${fresh.index} "${fresh.name}" at ${fresh.fill} fill; it must be tier 0 ` +
        `"${ESTABLISHMENTS[0].name}" with no fill, which is what the plot drew before this layer existed.`
    );
  }
  for (const missing of [undefined, null, Number.NaN, -5, "100"]) {
    const mapped = establishment(missing);
    if (mapped.index !== 0 || mapped.fill !== 0) {
      problems.push(
        `lifetime ${JSON.stringify(missing)} maps to establishment tier ${mapped.index} at ${mapped.fill} fill; ` +
          "a garden with no readable history must draw fresh ground."
      );
    }
  }
  const atWall = establishment(1e2);
  const ancient = establishment(1e9);
  if (atWall.index < 1) {
    problems.push(
      `a lifetime of 100 — the replant wall — is still establishment tier ${atWall.index} "${atWall.name}", so the ` +
        "ground has not aged by the time a replant is first earned."
    );
  }
  if (!(ancient.index > atWall.index)) {
    problems.push(
      `lifetimes of 100 and 1e9 are the same establishment tier (${atWall.index}), so the ground stops aging however ` +
        "much the garden produces."
    );
  }
  for (const [index, tier] of ESTABLISHMENTS.entries()) {
    const mapped = establishment(tier.at);
    if (mapped.index !== index || mapped.name !== tier.name) {
      problems.push(
        `lifetime ${tier.at} should be tier ${index} "${tier.name}", but it maps to tier ${mapped.index} "${mapped.name}".`
      );
    }
  }
  for (const amount of [1e2, 1e3, 1e4, 1e6, 1e12, 1e15]) {
    const { fill } = establishment(amount);
    if (!(fill >= 0 && fill <= 1)) {
      problems.push(`lifetime ${amount} has fill ${fill}; it must stay between 0 and 1.`);
    }
  }
  if (JSON.stringify(establishment(1e9)) !== JSON.stringify(establishment(1e9))) {
    problems.push("the same lifetime mapped to two different establishments, so the lasting layer is not pure.");
  }

  // Two gardens holding the same growth and the same plants, one young and one
  // with a long life, draw differently: the older one reads as established.
  const young = { growth: 1e3, beds: 1, seeds: 0, plants: 1, lifetimeGrowth: 1e2 };
  const old = { ...young, lifetimeGrowth: 1e9 };
  if (plotImage(young, 0) === plotImage(old, 0)) {
    problems.push(
      "two gardens with the same growth but lifetimes of 100 and 1e9 drew the same plot, so an old garden does not " +
        "read as more established than a young one."
    );
  }

  // The current crop is still the current growth's: the lasting layer changes
  // neither the ground grid nor the marks standing on it, so a small garden
  // with a long life is not drawn as a large current crop.
  if (JSON.stringify(plotBounds(young)) !== JSON.stringify(plotBounds(old))) {
    problems.push("the lifetime changed the plot's bounds, so a small garden with a long life draws a larger grid.");
  }
  if (JSON.stringify(plotMarks(young)) !== JSON.stringify(plotMarks(old))) {
    problems.push("the lifetime changed the marks on the plot, so the current crop is drawn from the garden's history.");
  }

  // A replant resets the growth but keeps the history: fresh growth on worked
  // ground is not the picture of ground nothing has ever grown on.
  const replanted = { growth: 0, beds: 1, seeds: 1, plants: 0, lifetimeGrowth: 1e9 };
  const untouched = { growth: 0, beds: 1, seeds: 1, plants: 0 };
  if (gardenForm(replanted.growth).name !== "bare soil") {
    problems.push(
      `a replanted garden's current growth (${replanted.growth}) draws form ` +
        `"${gardenForm(replanted.growth).name}" rather than the bare soil this check compares against.`
    );
  }
  if (plotImage(replanted, 0) === plotImage(untouched, 0)) {
    problems.push(
      "a replanted plot drew the same picture as ground that has never grown anything, so a replant erased the " +
        "garden's history from the plot."
    );
  }
  // The layer is hash-derived and reads no phase, so one state is one still
  // frame — the frame reduced motion pins to.
  if (plotImage(replanted, 0) !== plotImage(replanted, 0)) {
    problems.push("the same replanted state drew two different plots, so the lasting layer is not a still frame.");
  }

  // The picture draws from the lifetime the readout and get-state report. The
  // garden is put at a lifetime inside a tier so the check reads the layer the
  // page is actually drawing from, not an empty one.
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    setGrowth(250, 0.5, 0, 1e9, 40);
    const state = getDisplayedState();
    const drawnFrom = establishment(state.lifetimeGrowth);
    if (state.lifetimeGrowth !== 1e9) {
      problems.push(`get-state reports lifetime growth ${state.lifetimeGrowth} for a garden holding 1e9.`);
    }
    if (JSON.stringify(state.established) !== JSON.stringify(drawnFrom)) {
      problems.push(
        `get-state reports establishment ${JSON.stringify(state.established)} for lifetime ${state.lifetimeGrowth}, ` +
          `but the plot draws from ${JSON.stringify(drawnFrom)}.`
      );
    }
    const groundEl = document.querySelector('[data-field="established"]');
    if (!groundEl) {
      problems.push(
        'the page has no ground readout (expected [data-field="established"]), so the lasting layer is not stated ' +
          "in words."
      );
    } else if (String(groundEl.textContent).trim() !== state.established.name) {
      problems.push(
        `the page names the ground ${JSON.stringify(String(groundEl.textContent).trim())}, but the plot draws ` +
          `${JSON.stringify(state.established.name)}.`
      );
    }
    const lifetimeEl = document.querySelector('[data-field="lifetime"]');
    if (lifetimeEl && String(lifetimeEl.textContent).trim() !== formatGrowth(state.lifetimeGrowth)) {
      problems.push(
        `the page shows ${JSON.stringify(String(lifetimeEl.textContent).trim())} for the lifetime the plot draws, ` +
          `but the garden holds ${formatGrowth(state.lifetimeGrowth)}.`
      );
    }
    const bonusEl = document.querySelector('[data-field="replant-bonus"]');
    if (state.replantBonus !== replantBonus(state.lifetimeGrowth)) {
      problems.push(
        `the readout's replant bonus ${state.replantBonus} is not the replantBonus of the lifetime ` +
          `${state.lifetimeGrowth} (${replantBonus(state.lifetimeGrowth)}) the plot draws its ground from.`
      );
    } else if (bonusEl && !String(bonusEl.textContent).includes(formatAmount(state.replantBonus))) {
      problems.push(
        `the page shows ${JSON.stringify(String(bonusEl.textContent).trim())} for the replant bonus, but the lifetime ` +
          `the plot draws from (${state.lifetimeGrowth}) is worth ${state.replantBonus}.`
      );
    }
    // The number the picture draws from is the number the readout holds: the
    // same plot drawn with no history at all is a different picture.
    const drawn = { growth: 0, beds: 1, seeds: 1, plants: 0, lifetimeGrowth: state.lifetimeGrowth };
    if (plotImage(drawn, 0) === plotImage({ ...drawn, lifetimeGrowth: 0 }, 0)) {
      problems.push(
        `the plot drew the same ground for the reported lifetime ${state.lifetimeGrowth} as for a garden with no ` +
          "history, so the lifetime the readout shows is not what the picture draws from."
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The garden's worked ground reads as ground, not as a fence.
 *
 * A garden with a lifetime behind it draws a low retaining lip at the foot of
 * the plot over a band of aged earth in the soil's own tones, deepening with its
 * history, and a marker per tier — never an evenly spaced band of tiles a
 * visitor reads as an unrelated structure at the foot of the picture. The whole
 * edge is drawn from the lifetime the readout and `get-state` report and reads
 * no animation phase, so a still frame and reduced motion draw it identically.
 */
function checkPlotGroundEdge(problems) {
  const palette = readPalette();
  const leafKeys = new Set(
    [
      palette.leaf,
      palette.leafLight,
      palette.leafDeep,
      ...Object.values(palette.leafSeasons).flatMap((trio) => [trio.leaf, trio.leafLight, trio.leafDeep]),
    ].map((color) => colorKey(parseColor(color)))
  );
  const deepKey = colorKey(parseColor(palette.soilDeep));
  const lightKey = colorKey(parseColor(palette.soilLight));

  // The mapping: no history builds no edge at all, and the band and its markers
  // only ever deepen or hold as the lifetime grows.
  const fresh = groundEdge(establishment(0));
  if (fresh.lipHeight !== 0 || fresh.bandHeight !== 0 || fresh.markers !== 0) {
    problems.push(
      `a garden with no history draws worked ground ${JSON.stringify(fresh)}; fresh ground must draw no edge at all.`
    );
  }
  const tiers = [0, 1e2, 1e4, 1e6, 1e9, 1e12, 1e15];
  let lastBand = -1;
  let lastMarkers = -1;
  for (const lifetime of tiers) {
    const edge = groundEdge(establishment(lifetime));
    if (edge.bandHeight < lastBand || edge.markers < lastMarkers) {
      problems.push(
        `lifetime ${lifetime} draws worked ground ${JSON.stringify(edge)}, less than the tier below it, so the ` +
          "edge shrinks as the garden's history grows."
      );
    }
    lastBand = edge.bandHeight;
    lastMarkers = edge.markers;
    if (edge.markers > 4) {
      problems.push(`lifetime ${lifetime} raises ${edge.markers} edge markers; they must be capped so the band stays readable.`);
    }
  }

  // The edge is bounded on both the narrow and the wide plot: it never swallows
  // a row of soil however large the garden's capacity.
  for (const state of [
    { growth: 0, beds: 1, seeds: 0, plants: 0 },
    { growth: 0, beds: 2, seeds: 0, plants: 0 },
  ]) {
    const { cell, height } = plotBounds(state);
    for (const lifetime of tiers) {
      const edge = groundEdge(establishment(lifetime));
      if (edge.lipHeight + edge.bandHeight >= cell || edge.lipHeight + edge.bandHeight >= height / 4) {
        problems.push(
          `the worked ground is ${edge.lipHeight + edge.bandHeight}px tall on a ${height}px plot of ${cell}px cells; ` +
            "it must stay a low edge and never swallow a plot of soil."
        );
      }
    }
  }

  if (JSON.stringify(groundEdge(establishment(1e9))) !== JSON.stringify(groundEdge(establishment(1e9)))) {
    problems.push("the same lifetime mapped to two different worked edges, so the edge is not pure.");
  }

  // A pixel render helper and a count of the soil tones in the foot rows, so
  // the drawn edge can be measured rather than trusted.
  const countFootTones = (state, rows) => {
    if (rows <= 0) return 0;
    const bounds = plotBounds(state);
    const top = Math.max(0, bounds.height - rows);
    const height = bounds.height - top;
    const canvas = plotCanvas(state);
    const data = canvas.getContext("2d").getImageData(0, top, bounds.width, height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (key === deepKey || key === lightKey) count += 1;
    }
    return count;
  };

  // The foot of an established plot is one unbroken run of one soil tone across
  // the full width, in the narrow and the wide frame alike — not the evenly
  // spaced 6px tiles a visitor reads as a fence.
  for (const beds of [1, 2]) {
    const state = { growth: 0, beds, seeds: 0, plants: 0, lifetimeGrowth: 1e9 };
    const bounds = plotBounds(state);
    const canvas = plotCanvas(state);
    const row = canvas.getContext("2d").getImageData(0, bounds.height - 1, bounds.width, 1).data;
    const tones = new Set();
    for (let x = 0; x < bounds.width; x += 1) {
      const i = x * 4;
      tones.add(`${row[i]},${row[i + 1]},${row[i + 2]}`);
    }
    if (tones.size !== 1) {
      problems.push(
        `the foot of a ${beds}-bed established plot is drawn in ${tones.size} tones (${[...tones].join(" / ")}), so ` +
          "the bottom edge reads as a band of tiles rather than one piece of ground."
      );
    } else if (!tones.has(deepKey)) {
      problems.push(
        `the foot of a ${beds}-bed established plot is one tone, but not the soil's own deep seam ` +
          `(${[...tones][0]}); the retaining lip must be drawn in the soil's tones.`
      );
    }
  }

  // The aged band carries no leaf green in any season: the built ground stays
  // ground, and never wears the colour of a growing thing.
  const plantless = { growth: 0, beds: 1, seeds: 0, plants: 0, lifetimeGrowth: 1e9 };
  const edgeRows = (() => {
    const edge = groundEdge(establishment(plantless.lifetimeGrowth));
    return edge.lipHeight + edge.bandHeight;
  })();
  for (const season of [null, ...SEASONS.map((entry) => entry.key)]) {
    const state = season ? { ...plantless, season: { key: season } } : plantless;
    const bounds = plotBounds(state);
    const top = bounds.height - edgeRows;
    const data = plotCanvas(state).getContext("2d").getImageData(0, top, bounds.width, edgeRows).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (leafKeys.has(key)) {
        problems.push(
          `the worked ground at the foot of an established plot draws a leaf-green pixel rgb(${key})` +
            (season ? ` in ${season}` : " with no season") +
            ", so the built ground reads as a growing thing."
        );
        break;
      }
    }
  }

  // The drawn edge matches the ground the garden has: a fresh lifetime draws no
  // band at all, and a longer history lays down more of it.
  const probeRows = edgeRows;
  const freshState = { growth: 0, beds: 1, seeds: 0, plants: 0 };
  const freshTones = countFootTones(freshState, probeRows);
  const oldTones = countFootTones(plantless, probeRows);
  if (!(oldTones > freshTones)) {
    problems.push(
      `an established plot draws ${oldTones} soil-tone pixels in its foot ${probeRows} rows and a fresh one draws ` +
        `${freshTones}; the built ground must add ground the garden has worked.`
    );
  }
  const tier2 = { growth: 0, beds: 1, seeds: 0, plants: 0, lifetimeGrowth: 1e4 };
  const tier5 = { growth: 0, beds: 1, seeds: 0, plants: 0, lifetimeGrowth: 1e12 };
  const tier2Rows = groundEdge(establishment(tier2.lifetimeGrowth));
  const tier5Rows = groundEdge(establishment(tier5.lifetimeGrowth));
  const tier2Tones = countFootTones(tier2, tier2Rows.lipHeight + tier2Rows.bandHeight);
  const tier5Tones = countFootTones(tier5, tier5Rows.lipHeight + tier5Rows.bandHeight);
  if (!(tier5Tones > tier2Tones)) {
    problems.push(
      `an ancient garden (tier 5) draws ${tier5Tones} soil-tone pixels of foot band and a worked one (tier 2) ` +
        `${tier2Tones}; the band must deepen with the garden's history.`
    );
  }

  // The edge reads no phase: the same established state draws the same foot at
  // two phases, so it holds still under reduced motion.
  const grown = { growth: 1e3, beds: 1, seeds: 0, plants: 0, lifetimeGrowth: 1e9 };
  const first = plotCanvas(grown, 0).getContext("2d");
  const later = plotCanvas(grown, 7).getContext("2d");
  const bounds = plotBounds(grown);
  const top = bounds.height - edgeRows;
  const a = first.getImageData(0, top, bounds.width, edgeRows).data;
  const b = later.getImageData(0, top, bounds.width, edgeRows).data;
  if (a.length !== b.length) {
    problems.push("two phases of an established plot drew different-sized foot bands, so the edge is not a still frame.");
  } else {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        problems.push(
          "the foot of an established plot moved between two animation phases, so the worked ground does not hold still " +
            "under reduced motion."
        );
        break;
      }
    }
  }
}

function checkPlotDrawing(problems) {
  const live = document.getElementById("garden-plot");
  if (!live || !live.getContext) {
    problems.push("the page has no plot canvas (#garden-plot) to draw the garden into.");
    return;
  }
  const snapshot = (growth, seeds, plants) => plotImage({ growth, seeds, plants, beds: 1 });
  const bare = snapshot(0, 0, 0);
  const oneSprout = snapshot(0, 1, 0);
  const onePlant = snapshot(0, 0, 1);
  const seedling = snapshot(10, 0, 3);
  const far = snapshot(1e12, 0, 12);
  if (bare === oneSprout) {
    problems.push("a sprouting seed in the soil draws the same picture as bare soil, so planting is invisible on the plot.");
  }
  if (oneSprout === onePlant) {
    problems.push(
      "a sprouting seed and a grown plant draw the same picture, so the plot does not show a seed growing up."
    );
  }
  if (onePlant === seedling) {
    problems.push("the plot draws the same picture at a low and a higher form, so it does not change form at the threshold.");
  }
  if (seedling === far) {
    problems.push("the plot draws the same picture at 10 and 1e12 growth, so the far end is frozen.");
  }
  if (snapshot(1e12, 0, 12) !== far) {
    problems.push("the same amount of growth drew two different pictures, so the plot is not a pure view of the state.");
  }
  if (snapshot(1e12, 0, 1e9) !== snapshot(1e12, 0, 1000)) {
    problems.push("a garden carrying more plants than plots drew a different picture, so the sprites are not bounded by the plot.");
  }
}

/**
 * The garden breathes without ever depending on motion to show its state.
 *
 * The phase is pinned to a still frame under reduced motion and on bare soil,
 * advances otherwise so something moves, stays a pure function of state and
 * phase, still shows the planted garden in that one frame, and draws a huge
 * garden inside the plot's own bounded grid.
 */
function checkPlotAnimation(problems) {
  if (motionPhase({ reduced: true, frame: 7, living: true }) !== 0) {
    problems.push(
      "with reduced motion preferred the plot still advances a phase; it must pin to the single still frame (phase 0)."
    );
  }
  if (motionPhase({ reduced: false, frame: 7, living: false }) !== 0) {
    problems.push("a plot with nothing growing still advances a phase; bare soil must stay a still frame (phase 0).");
  }
  if (motionPhase({ reduced: false, frame: 7, living: true }) === 0) {
    problems.push("a living plot under normal motion never advances a phase, so the garden would never visibly breathe.");
  }

  const grown = { growth: 100, beds: 1, plants: 3, seeds: 0, pollinator: { visiting: false } };
  const stillFrame = plotImage(grown, 0);
  if (plotImage(grown, 0) !== stillFrame) {
    problems.push("the plot drew two different pictures at the same state and phase, so it is not a pure view of them.");
  }
  if (plotImage(grown, 1) === stillFrame) {
    problems.push("a grown garden drew the same picture on two different phases, so nothing in it visibly moves.");
  }

  const bare = { growth: 0, beds: 1, plants: 0, seeds: 0, pollinator: { visiting: false } };
  if (plotImage(bare, 0) === stillFrame) {
    problems.push("the still frame of a planted garden equals bare soil, so reduced motion would hide the garden's state.");
  }

  const huge = {
    growth: 1e12,
    beds: 5000,
    plants: 1e12,
    seeds: 1e12,
    plantCounts: [1e12, 1e12],
    seedCounts: [1e12, 1e12],
    pollinator: { visiting: true },
  };
  const canvas = document.createElement("canvas");
  drawGarden(canvas, huge, readPalette(), 5);
  const bounds = plotBounds(huge);
  if (canvas.width !== bounds.canvasWidth || canvas.height !== bounds.height) {
    problems.push(
      `a huge garden drew ${canvas.width}x${canvas.height}px, outside the plot's own bounds ` +
        `${bounds.canvasWidth}x${bounds.height}px.`
    );
  }
  if (canvas.height > bounds.maxRows * bounds.cell) {
    problems.push(
      `a huge garden drew ${canvas.height}px tall over ${bounds.maxRows} capped rows of soil, so the sprite count is not bounded.`
    );
  }
}

// --- The picture beside the numbers -----------------------------------------

/**
 * The mapping from growth to a drawn form, at both ends of the scale. The
 * picture has to keep changing however large the number grows, and the same
 * amount must always draw the same way.
 */
function checkGardenFormMapping(problems) {
  // Every threshold lands on its own form, named as the page states it.
  for (const [index, form] of FORMS.entries()) {
    const mapped = gardenForm(form.at);
    if (mapped.index !== index || mapped.name !== form.name) {
      problems.push(
        `growth ${form.at} should be form ${index} "${form.name}", but it maps to form ${mapped.index} "${mapped.name}".`
      );
    }
  }

  // The same amount always maps the same way.
  for (const amount of [0, 1, 10, 100, 1e12, 1e15]) {
    const first = JSON.stringify(gardenForm(amount));
    const second = JSON.stringify(gardenForm(amount));
    if (first !== second) {
      problems.push(`growth ${amount} mapped two different ways (${first} then ${second}).`);
    }
  }

  // It moves forward with the amount and never jumps back.
  const ladder = [0, 1, 10, 100, 1e3, 1e6, 1e9, 1e12];
  const indices = ladder.map((amount) => gardenForm(amount).index);
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i] < indices[i - 1]) {
      problems.push(
        `the garden form went backwards as growth rose (${ladder[i - 1]} → form ${indices[i - 1]}, ${ladder[i]} → form ${indices[i]}).`
      );
    }
  }

  // Zero growth is bare soil, and the far end draws a different form.
  const bare = gardenForm(0);
  const far = gardenForm(1e12);
  if (bare.index !== 0 || bare.name !== FORMS[0].name) {
    problems.push(`zero growth should be bare soil, but it is form ${bare.index} "${bare.name}".`);
  }
  if (bare.name === far.name || bare.index === far.index) {
    problems.push(`growth 0 and growth 1e12 draw the same form "${bare.name}", so the picture stops changing.`);
  }
  if (!(far.index > gardenForm(1e6).index)) {
    problems.push(`growth 1e6 and 1e12 do not change form (both form ${gardenForm(1e6).index}), so the far end is frozen.`);
  }

  // Fill stays between 0 and 1, and keeps moving past the last threshold.
  for (const amount of [2, 20, 5e3, 5e11, 1e15]) {
    const { fill } = gardenForm(amount);
    if (!(fill >= 0 && fill <= 1)) {
      problems.push(`growth ${amount} has fill ${fill}; it must stay between 0 and 1.`);
    }
  }
  const past = gardenForm(1e15);
  if (far.index === past.index && far.fill === past.fill) {
    problems.push("growth past the last threshold (1e12 → 1e15) does not change the picture at all.");
  }

  // Nothing grown — a missing, negative or impossible amount — is bare soil.
  for (const bad of [Number.NaN, Infinity, -Infinity, -1, undefined, null, "5"]) {
    const mapped = gardenForm(bad);
    if (mapped.index !== 0 || mapped.name !== FORMS[0].name || mapped.fill !== 0) {
      problems.push(
        `growth ${JSON.stringify(bad)} should be bare soil, but it maps to form ${mapped.index} "${mapped.name}" at ${mapped.fill} fill.`
      );
    }
  }
}

/**
 * The form line is also the goal line: it names the next form the garden is
 * becoming and a meter that fills as growth approaches its threshold, and the
 * state reports the same goal an agent reads.
 */
function checkNextFormMeter(problems) {
  const span = document.querySelector('[data-field="next-form"]');
  const meter = document.getElementById("form-meter");
  const fill = document.getElementById("form-meter-fill");
  if (!span || !meter || !fill) {
    problems.push(
      'the garden-form line has no next-form reading (expected [data-field="next-form"], ' +
        "#form-meter and #form-meter-fill)."
    );
    return;
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const expectedMeter = (state) => ({
    now: state.formProgress,
    width: `${(state.formProgress * 100).toFixed(1)}%`,
  });
  const shownMeter = () => ({
    now: Number(meter.getAttribute("aria-valuenow")),
    width: fill.style.width,
  });
  try {
    // Just below a threshold: the next form is named and the meter is nearly full.
    setGrowth(99, 1);
    const near = getDisplayedState();
    const nearForm = gardenForm(99);
    const nearName = FORMS[nearForm.index + 1].name;
    if (near.nextFormName !== nearName || near.growthToNextForm !== nearForm.nextAt - 99) {
      problems.push(
        `at growth 99 the state names the next form ${JSON.stringify(near.nextFormName)} ` +
          `${near.growthToNextForm} growth away, expected ${JSON.stringify(nearName)} at ` +
          `${nearForm.nextAt - 99} growth.`
      );
    }
    if (near.formProgress !== nearForm.fill) {
      problems.push(
        `the form progress at growth 99 is ${near.formProgress}, expected gardenForm().fill ${nearForm.fill}.`
      );
    }
    if (!String(span.textContent).includes(nearName)) {
      problems.push(
        `the form line reads ${JSON.stringify(String(span.textContent))}, expected it to name the next form ` +
          `${JSON.stringify(nearName)}.`
      );
    }
    const nearShown = shownMeter();
    const nearExpected = expectedMeter(near);
    if (nearShown.now !== nearExpected.now || nearShown.width !== nearExpected.width) {
      problems.push(
        `the form meter at growth 99 reads ${nearShown.now} at ${nearShown.width}, expected ` +
          `${nearExpected.now} at ${nearExpected.width}.`
      );
    }

    // Just past the threshold: the form advances, the name changes and the meter
    // resets toward the next one.
    setGrowth(101, 1);
    const past = getDisplayedState();
    const pastForm = gardenForm(101);
    if (!(past.form > near.form) || past.formName !== pastForm.name) {
      problems.push(
        `growth 99→101 did not advance the form (${JSON.stringify(near.formName)} → ` +
          `${JSON.stringify(past.formName)}), expected ${JSON.stringify(pastForm.name)}.`
      );
    }
    if (past.nextFormName === near.nextFormName) {
      problems.push(
        `the next form stayed ${JSON.stringify(past.nextFormName)} past the threshold, expected a new one.`
      );
    }
    if (!(past.formProgress < near.formProgress)) {
      problems.push(
        `the form meter did not reset past the threshold (${near.formProgress} → ${past.formProgress}).`
      );
    }
    const pastShown = shownMeter();
    const pastExpected = expectedMeter(past);
    if (pastShown.now !== pastExpected.now || pastShown.width !== pastExpected.width) {
      problems.push(
        `the form meter at growth 101 reads ${pastShown.now} at ${pastShown.width}, expected ` +
          `${pastExpected.now} at ${pastExpected.width}.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The plot breathes by being redrawn, never by CSS motion on the canvas, so a
 * visitor who asks for no motion still gets a still frame — and the description
 * states the same form in words when the garden advances.
 */
function checkPlotMotion(problems) {
  const canvas = document.getElementById("garden-plot");
  if (!canvas) return; // checkPlotDrawing reports the missing canvas.

  const style = getComputedStyle(canvas);
  if (style.animationName && style.animationName !== "none") {
    problems.push(
      `the plot canvas carries a CSS animation (${style.animationName}); it must be redrawn discretely so a reduced-motion visitor sees the same picture.`
    );
  }
  if (style.transitionDuration && style.transitionDuration !== "0s") {
    problems.push(
      `the plot canvas carries a CSS transition (${style.transitionDuration}); it must be redrawn discretely so a reduced-motion visitor sees the same picture.`
    );
  }

  const before = getGrowthState();
  try {
    setGrowth(1e3, 0);
    const { name } = gardenForm(1e3);
    const text = String(document.getElementById("plot-description")?.textContent ?? "");
    if (!text.includes(name)) {
      problems.push(
        `after the garden advanced to growth 1000 the description does not state its form "${name}": "${text}"`
      );
    }
  } finally {
    restoreGrowth(before);
  }
}

// --- The first action and its live rate -------------------------------------

function checkTendControl(problems) {
  const button = document.getElementById("tend");
  if (!button) {
    problems.push("the page has no Tend control (#tend), so there is nothing to press to start the garden.");
    return;
  }
  if (button.tagName.toLowerCase() !== "button") {
    problems.push(
      `the Tend control is a <${button.tagName.toLowerCase()}>, not a real <button>, so keyboard Enter and Space will not activate it.`
    );
  }
  if (!String(button.textContent).trim()) {
    problems.push("the Tend control has no label, so neither a sighted nor a screen-reader visitor can tell what it does.");
  }
  if (button.disabled) {
    problems.push("the Tend control is disabled on arrival, so the garden's first action cannot be taken.");
  }
  const style = getComputedStyle(button);
  if (style.display === "none" || style.visibility === "hidden") {
    problems.push("the Tend control is hidden on the page.");
  }
}

function checkTendAnswersImmediately(problems) {
  const button = document.getElementById("tend");
  const total = document.getElementById("growth-total");
  if (!button || !total) return; // checkTendControl reports the control's absence.

  const before = getGrowthState();
  try {
    setGrowth(0, 0);
    button.click();
    const after = getGrowthState();
    if (after.growth !== TEND_YIELD) {
      problems.push(`pressing Tend took the garden to ${after.growth} growth, expected ${TEND_YIELD}.`);
    }
    if (Math.abs(after.rate - TEND_RATE_STEP) > 1e-9) {
      problems.push(`pressing Tend set the rate to ${after.rate}/s, expected ${TEND_RATE_STEP}/s.`);
    }
    const shown = Number(String(total.textContent).replace(/,/g, ""));
    if (shown !== after.growth) {
      problems.push(
        `after pressing Tend the page shows ${JSON.stringify(total.textContent)} growth, but the garden holds ${after.growth}.`
      );
    }
    // The rate the tap earned is on the same screen at once, not one tick later.
    const rateText = String(document.getElementById("growth-rate")?.textContent ?? "").trim();
    if (rateText !== `+${formatGrowth(after.rate)}/s`) {
      problems.push(
        `right after pressing Tend the page shows the growth rate as ${JSON.stringify(rateText)}, ` +
          `but the garden holds +${formatGrowth(after.rate)}/s.`
      );
    }
  } finally {
    restoreGrowth(before);
  }
}

function checkGrowthRateShowsAndRuns(problems) {
  const before = getGrowthState();
  try {
    setGrowth(0, 0.5);
    advance(1);
    const after = getGrowthState();
    if (Math.abs(after.growth - 0.5) > 1e-9) {
      problems.push(`after one second at +0.5/s the garden held ${after.growth} growth, expected 0.5.`);
    }
    const rateText = String(document.getElementById("growth-rate")?.textContent ?? "").trim();
    if (!/^\+[\d,.]+([KMBT]|e[+-]?\d+)?\/s$/.test(rateText)) {
      problems.push(`the page shows the growth rate as ${JSON.stringify(rateText)}, expected a "+x/s" form like "+0.5/s".`);
    }
  } finally {
    restoreGrowth(before);
  }
}

function checkGrowthIsBoundedAndFinite(problems) {
  const before = getGrowthState();
  try {
    // A session's growth runs far past the plot; the form must stay on scale.
    setGrowth(PLOT_CAPACITY + 1000, 1);
    const form = gardenForm(getGrowthState().growth);
    if (
      !Number.isInteger(form.index) ||
      form.index < 0 ||
      form.index >= FORMS.length ||
      !(form.fill >= 0 && form.fill <= 1)
    ) {
      problems.push(
        `with growth far past the plot, the garden is form ${form.index} at ${form.fill} fill — ` +
        `expected a form from 0 to ${FORMS.length - 1} with fill from 0 to 1.`
      );
    }

    // A clock can hand the garden a negative, missing or enormous span.
    setGrowth(1, 0.1);
    if (advance(-3600).growth !== 1) {
      problems.push("advancing by a negative span (-3600s) grew the garden; elapsed time must not run backwards.");
    }
    if (advance(Number.NaN).growth !== 1) {
      problems.push("advancing by NaN grew the garden; a missing span must grow nothing.");
    }
    advance(1e300);
    const total = String(document.getElementById("growth-total")?.textContent ?? "");
    if (/NaN|Infinity/.test(total)) {
      problems.push(`the growth total shows ${JSON.stringify(total)} after a huge elapsed span.`);
    }
  } finally {
    restoreGrowth(before);
  }
}

// --- Planting a second seed --------------------------------------------------

/**
 * The price of the next seed: higher than the last one, rising by the fixed
 * rate, and still a finite number at seed counts nothing has reached yet.
 */
function checkSeedCostCurve(problems) {
  const first = nextSeedCost(0);
  if (first !== SEED_COST_BASE) {
    problems.push(`the very first seed should cost ${SEED_COST_BASE} growth, but nextSeedCost(0) is ${first}.`);
  }

  for (let seeds = 0; seeds < 40; seeds += 1) {
    const cost = nextSeedCost(seeds);
    const next = nextSeedCost(seeds + 1);
    if (!(next > cost)) {
      problems.push(
        `each seed must cost more than the last: with ${seeds} seeds the next costs ${cost}, ` +
          `but with ${seeds + 1} it costs ${next}.`
      );
      break;
    }
  }

  // Past a few seeds the rounding stops mattering, so each price is the last
  // one times the rate.
  for (const seeds of [10, 20, 30]) {
    const ratio = nextSeedCost(seeds + 1) / nextSeedCost(seeds);
    if (Math.abs(ratio - SEED_COST_RATE) > 0.02) {
      problems.push(
        `at ${seeds} seeds the next price multiplies by ${ratio.toFixed(4)}, expected about ${SEED_COST_RATE}.`
      );
    }
  }

  const huge = nextSeedCost(1e9);
  if (!Number.isFinite(huge) || huge < 0) {
    problems.push(`a billion seeds should still have a finite price, but nextSeedCost(1e9) is ${huge}.`);
  }
}

function checkPlantControl(problems) {
  const button = document.getElementById("plant-seed");
  if (!button) {
    problems.push("the page has no Plant a seed control (#plant-seed), so a second seed cannot be planted.");
    return;
  }
  if (button.tagName.toLowerCase() !== "button") {
    problems.push(
      `the Plant a seed control is a <${button.tagName.toLowerCase()}>, not a real <button>, ` +
        `so keyboard Enter and Space will not activate it.`
    );
  }
  const style = getComputedStyle(button);
  if (style.display === "none" || style.visibility === "hidden") {
    problems.push("the Plant a seed control is hidden on the page.");
  }
}

/**
 * The button states its price, is disabled exactly until the garden can afford
 * it, and on a press spends that price and raises production by one seed's
 * worth.
 */
function checkPlantingSpendsAndRaisesProduction(problems) {
  const button = document.getElementById("plant-seed");
  if (!button) return; // checkPlantControl reports its absence.

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  try {
    setGarden({ seeds: 1, plants: 0 });
    const cost = nextSeedCost(1);

    setGrowth(cost - 1, 0.2);
    const label = String(button.textContent);
    if (!label.includes(formatAmount(cost))) {
      problems.push(`the Plant a seed label is ${JSON.stringify(label)}, which does not state its ${cost}-growth cost.`);
    }
    const tooShort = availabilityProblem(
      button,
      false,
      `the Plant a seed control at ${cost - 1} growth, one short of its ${cost}-growth cost`
    );
    if (tooShort) problems.push(tooShort);

    setGrowth(cost, 0.2);
    const affordable = availabilityProblem(
      button,
      true,
      `the Plant a seed control at ${cost} growth, exactly its ${cost}-growth cost`
    );
    if (affordable) problems.push(affordable);
    button.click();

    const after = getGrowthState();
    const gardenAfter = getGarden();
    if (after.growth !== 0) {
      problems.push(`planting a ${cost}-growth seed from ${cost} growth left ${after.growth} growth, expected 0.`);
    }
    if (Math.abs(after.rate - 0.2) > 1e-9) {
      problems.push(
        `planting a seed set the rate to ${after.rate}/s, expected the old 0.2/s — a sprouting seed must not ` +
          `speed the garden up until it matures.`
      );
    }
    if (gardenAfter.seeds !== 2 || gardenAfter.plants !== 0) {
      problems.push(
        `planting a seed left the garden with ${gardenAfter.seeds} seeds / ${gardenAfter.plants} plants, ` +
          `expected 2 sprouts and 0 grown plants.`
      );
    }

    // Once the seeds have had their growing time they become plants, and only
    // then does the garden grow faster.
    advance(GROW_SECONDS);
    const grownState = getGrowthState();
    const grownGarden = getGarden();
    if (grownGarden.seeds !== 0 || grownGarden.plants !== 2) {
      problems.push(
        `after ${GROW_SECONDS}s the garden holds ${grownGarden.seeds} seeds / ${grownGarden.plants} plants, ` +
          `expected both sprouts to have matured into 2 plants.`
      );
    }
    if (Math.abs(grownState.rate - (0.2 + 2 * PLANT_PRODUCTION)) > 1e-9) {
      problems.push(
        `after the seeds matured the rate is ${grownState.rate}/s, expected ${0.2 + 2 * PLANT_PRODUCTION}/s ` +
          `(the old rate plus two plants' production).`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/** The goal block's short labelled facts, in the order the page shows them. */
function readGoalFacts(container) {
  if (!container) return [];
  return [...container.querySelectorAll(":scope > .goal-fact")].map((fact) => ({
    label: fact.querySelector(".goal-fact-label")?.textContent ?? "",
    value: fact.querySelector(".goal-fact-value")?.textContent ?? "",
  }));
}

/** One labelled fact's value, or undefined when the goal does not show it. */
function goalFactValue(container, label) {
  return readGoalFacts(container).find((fact) => fact.label === label)?.value;
}

/** The short labelled facts a season or pollinator readout shows, in order. */
function readReadoutFacts(row) {
  if (!row) return [];
  return [...row.querySelectorAll(":scope > .kind-facts > .kind-fact")].map((fact) => ({
    label: fact.querySelector(".kind-fact-label")?.textContent ?? "",
    value: fact.querySelector(".kind-fact-value")?.textContent ?? "",
  }));
}

/** One readout fact's value, or undefined when the row does not show it. */
function readoutFactValue(row, label) {
  return readReadoutFacts(row).find((fact) => fact.label === label)?.value;
}

/** True when the goal block is only labelled facts — no prose between them. */
function goalFactsAreOnlyContent(container) {
  if (!container) return false;
  return [...container.childNodes].every(
    (node) => node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()
  );
}

/**
 * The next goal is always on the page as short labelled facts — the growth
 * saved against the cost, the time to the next seed and the time to the next
 * plant — never as a sentence, and it is honest when the plot is full.
 */
function checkSeedGoalReadout(problems) {
  const meter = document.getElementById("seed-meter");
  const detailEl = document.getElementById("goal-detail");
  if (!meter || !detailEl) {
    problems.push("the page has no next-seed goal block (expected #seed-meter and #goal-detail).");
    return;
  }
  if (meter.getAttribute("role") !== "progressbar") {
    problems.push(`the next-seed meter is not a progressbar (role=${JSON.stringify(meter.getAttribute("role"))}).`);
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    setGarden({ seeds: 1, plants: 0 });
    const cost = nextSeedCost(1);

    // Halfway there, at 1 growth per second: the goal states the growth saved
    // against the cost and how far the seed is, each under its own short label,
    // and the meter must track the fraction.
    setGrowth(cost / 2, 1);
    const halfway = readGoalFacts(detailEl);
    const expectedSaved = `${formatGrowth(cost / 2)} / ${formatAmount(cost)}`;
    if (goalFactValue(detailEl, "Saved") !== expectedSaved) {
      problems.push(
        `at half the cost the goal's Saved fact is ${JSON.stringify(goalFactValue(detailEl, "Saved"))}, ` +
          `expected ${JSON.stringify(expectedSaved)} (growth saved / cost).`
      );
    }
    const expectedSeconds = `${Math.ceil((cost - cost / 2) / 1)}s`;
    if (goalFactValue(detailEl, "Next seed") !== expectedSeconds) {
      problems.push(
        `at half the cost the goal's Next seed fact is ${JSON.stringify(goalFactValue(detailEl, "Next seed"))}, ` +
          `expected ${JSON.stringify(expectedSeconds)}.`
      );
    }
    if (halfway.length !== 3 || halfway.some((fact) => !fact.label || !fact.value)) {
      problems.push(`the goal under the title is not three labelled facts: ${JSON.stringify(halfway)}.`);
    }
    if (!goalFactsAreOnlyContent(detailEl)) {
      problems.push(
        `the goal block shows text outside its labelled facts: ${JSON.stringify(String(detailEl.textContent))}.`
      );
    }
    const now = Number(meter.getAttribute("aria-valuenow"));
    if (Math.abs(now - 0.5) > 0.01) {
      problems.push(`at half the cost the goal meter reads ${now}, expected 0.5.`);
    }
    if (!String(document.getElementById("seed-meter-fill")?.style.width ?? "").startsWith("50")) {
      problems.push(
        `at half the cost the goal meter fill is ${JSON.stringify(
          document.getElementById("seed-meter-fill")?.style.width
        )}, expected about 50%.`
      );
    }

    // Affordable: the goal's next seed reads ready, not how far away it is.
    setGrowth(cost, 1);
    if (goalFactValue(detailEl, "Next seed") !== "ready") {
      problems.push(
        `with enough growth the goal's Next seed fact is ${JSON.stringify(goalFactValue(detailEl, "Next seed"))}, ` +
          `expected "ready".`
      );
    }

    // Not growing at all: the saved amount is stated, and no time is invented
    // for a seed the garden has no rate to reach.
    setGrowth(0, 0);
    if (goalFactValue(detailEl, "Next seed") !== "—") {
      problems.push(
        `with no growth and no rate the goal's Next seed fact is ` +
          `${JSON.stringify(goalFactValue(detailEl, "Next seed"))}, expected "—".`
      );
    }
    if (goalFactValue(detailEl, "Saved") !== `0.0 / ${formatAmount(cost)}`) {
      problems.push(
        `with no growth the goal's Saved fact is ${JSON.stringify(goalFactValue(detailEl, "Saved"))}, ` +
          `expected ${JSON.stringify(`0.0 / ${formatAmount(cost)}`)}.`
      );
    }

    // Full: the goal becomes the next bed, stating its cost and time under the
    // bed's own labels, while the Plant a seed control stays marked unavailable
    // and says the plot is full.
    setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
    setGrowth(0, 1);
    const bedCost = nextBedCost(1);
    if (goalFactValue(detailEl, "Saved") !== `0.0 / ${formatAmount(bedCost)}`) {
      problems.push(
        `with every plot full the goal's Saved fact is ${JSON.stringify(goalFactValue(detailEl, "Saved"))}, ` +
          `expected ${JSON.stringify(`0.0 / ${formatAmount(bedCost)}`)} (the next bed's cost).`
      );
    }
    const bedSeconds = getDisplayedState().secondsToNextBed;
    const expectedBed = bedSeconds == null ? "—" : formatDuration(bedSeconds);
    if (goalFactValue(detailEl, "Next bed") !== expectedBed) {
      problems.push(
        `with every plot full the goal's Next bed fact is ${JSON.stringify(goalFactValue(detailEl, "Next bed"))}, ` +
          `expected ${JSON.stringify(expectedBed)}.`
      );
    }
    const goalTitle = String(document.getElementById("goal-title")?.textContent ?? "");
    if (!/bed\s*#2/i.test(goalTitle)) {
      problems.push(`with every plot full the goal title does not name the next bed: ${JSON.stringify(goalTitle)}`);
    }
    const button = document.getElementById("plant-seed");
    if (button) {
      const problem = availabilityProblem(button, false, "with every plot full the Plant a seed control");
      if (problem) problems.push(problem);
    }
    if (button && !String(button.textContent).toLowerCase().includes("full")) {
      problems.push(`with every plot full the Plant a seed label does not say so: ${JSON.stringify(button.textContent)}`);
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The first goal points at the action that works right now: before the garden
 * has a rate it names tending the soil and what one tend earns, and once growth
 * is arriving it names the next seed, its cost and how long that will take.
 */
function checkFirstGoalNamesTending(problems) {
  const titleEl = document.getElementById("goal-title");
  const detailEl = document.getElementById("goal-detail");
  if (!titleEl || !detailEl) {
    problems.push("the page has no goal block (expected #goal-title and #goal-detail).");
    return;
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    // A fresh visit: a seed in the soil, nothing grown, no rate yet.
    setGarden(newGarden());
    setGrowth(0, 0);
    const freshTitle = String(titleEl.textContent);
    if (!/tend/i.test(freshTitle)) {
      problems.push(
        `at zero growth and no rate the goal title is ${JSON.stringify(freshTitle)}, ` +
          `expected it to name tending the soil.`
      );
    }
    if (/plant/i.test(freshTitle)) {
      problems.push(
        `at zero growth and no rate the goal title is ${JSON.stringify(freshTitle)}, ` +
          `expected the unreachable seed not to be named yet.`
      );
    }
    const earned = `+${formatAmount(TEND_YIELD)} growth`;
    const earnedRate = `+${formatGrowth(TEND_RATE_STEP)}/s`;
    if (!freshTitle.includes(earned) || !freshTitle.includes(earnedRate)) {
      problems.push(
        `at zero growth and no rate the goal title does not state what one tend earns (${earned}, ${earnedRate}): ` +
          `${JSON.stringify(freshTitle)}`
      );
    }
    // The detail under the title is short labelled facts, not a sentence: what
    // is saved against the cost, that no seed has a time yet, and when the
    // starting sprout matures. A returning sentence is the shape this forbids.
    const freshState = getDisplayedState();
    if (goalFactValue(detailEl, "Saved") !== `0.0 / ${formatAmount(freshState.nextSeedCost)}`) {
      problems.push(
        `at zero growth the goal's Saved fact is ${JSON.stringify(goalFactValue(detailEl, "Saved"))}, ` +
          `expected ${JSON.stringify(`0.0 / ${formatAmount(freshState.nextSeedCost)}`)}.`
      );
    }
    if (goalFactValue(detailEl, "Next seed") !== "—") {
      problems.push(
        `at zero growth and no rate the goal's Next seed fact is ` +
          `${JSON.stringify(goalFactValue(detailEl, "Next seed"))}, expected "—".`
      );
    }
    const freshPlantSeconds = freshState.secondsToNextPlant;
    const expectedFreshPlant = freshPlantSeconds == null ? "none growing" : formatDuration(freshPlantSeconds);
    if (goalFactValue(detailEl, "Next plant") !== expectedFreshPlant) {
      problems.push(
        `at zero growth the goal's Next plant fact is ${JSON.stringify(goalFactValue(detailEl, "Next plant"))}, ` +
          `expected ${JSON.stringify(expectedFreshPlant)}.`
      );
    }
    const freshDetail = String(detailEl.textContent);
    if (/ about |matures in|growth to the/.test(freshDetail) || !goalFactsAreOnlyContent(detailEl)) {
      problems.push(
        `at zero growth the goal detail reads as a sentence, not labelled facts: ${JSON.stringify(freshDetail)}`
      );
    }

    // Growth arriving: the goal is the next seed, its cost and the time to it.
    setGarden(newGarden());
    setGrowth(0, 1);
    const state = getDisplayedState();
    const growingTitle = String(titleEl.textContent);
    if (state.nextSeedKind && !growingTitle.toLowerCase().includes(state.nextSeedKind)) {
      problems.push(
        `with a rate of 1/s the goal title is ${JSON.stringify(growingTitle)}, ` +
          `expected it to name the ${state.nextSeedKind} seed.`
      );
    }
    if (!growingTitle.includes(formatAmount(state.nextSeedCost))) {
      problems.push(
        `with a rate of 1/s the goal title ${JSON.stringify(growingTitle)} does not state its ` +
          `${state.nextSeedCost}-growth cost.`
      );
    }
    const growingDetail = String(detailEl.textContent);
    if (!growingDetail.includes(formatAmount(state.nextSeedCost))) {
      problems.push(
        `with a rate of 1/s the goal does not state the ${state.nextSeedCost}-growth cost: ` +
          `${JSON.stringify(growingDetail)}`
      );
    }
    if (!/\d+s\b/.test(growingDetail)) {
      problems.push(
        `with a rate of 1/s the goal does not say how long the seed is away: ${JSON.stringify(growingDetail)}`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The page says how long until the next plant matures, and it matches the
 * soonest sprout in the soil — an agent and a visitor read the same number.
 */
function checkNextPlantReadout(problems) {
  const readoutEl = document.querySelector('[data-field="next-plant"]');
  const detailEl = document.getElementById("goal-detail");
  if (!readoutEl) {
    problems.push('the page has no next-plant readout (expected [data-field="next-plant"]).');
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    setGarden({ sprouts: [8, 41], plants: 1 });
    setGrowth(0, 0.5);
    const state = getDisplayedState();
    if (state.secondsToNextPlant !== 8) {
      problems.push(
        `the soonest of two sprouts at 8s and 41s should be 8s to the next plant, but the garden reports ` +
          `${state.secondsToNextPlant}.`
      );
    }
    if (readoutEl && !String(readoutEl.textContent).includes("8s")) {
      problems.push(`the next-plant readout says ${JSON.stringify(readoutEl.textContent)}, expected it to mention 8s.`);
    }
    if (detailEl && !String(detailEl.textContent).includes("8s")) {
      problems.push(
        `the goal block says ${JSON.stringify(detailEl.textContent)}, expected it to say the next plant matures in 8s.`
      );
    }

    // With nothing growing, the garden says so rather than naming a time.
    setGarden({ seeds: 0, plants: 2 });
    if (getDisplayedState().secondsToNextPlant !== null) {
      problems.push("with no ungrown seeds the garden still reported a time to the next plant.");
    }
    if (readoutEl && !String(readoutEl.textContent).toLowerCase().includes("none")) {
      problems.push(`with nothing growing the next-plant readout says ${JSON.stringify(readoutEl.textContent)}.`);
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The plot is endless: once every plot holds a seed the goal becomes the next
 * bed, and spending its price opens more soil and lets more seeds be planted.
 */
function checkBedProgression(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const canvas = document.getElementById("garden-plot");
  try {
    // One full bed of soil, and nothing more to plant in it.
    setGarden({ beds: 1, seeds: PLOTS_PER_BED, plants: 0 });

    const cost = nextBedCost(1);
    // The promised price of the first extra bed — 200 base times 1.15 — stated
    // here as a literal so a change to the cost curve turns this red.
    const firstCost = 230;
    if (cost !== firstCost) {
      problems.push(`the first extra bed should cost ${firstCost} growth, but nextBedCost(1) is ${cost}.`);
    }
    if (!(nextBedCost(2) > nextBedCost(1))) {
      problems.push(
        `the next bed must cost more than the last, but 1 bed costs ${nextBedCost(1)} and 2 cost ${nextBedCost(2)}.`
      );
    }

    // Offered but short of the price: not yet openable.
    setGrowth(cost - 1, 1);
    let state = getDisplayedState();
    if (!state.plotFull) {
      problems.push(`a bed with ${PLOTS_PER_BED} seeds should be full, but the state says plotFull is ${state.plotFull}.`);
    }
    if (state.canOpenBed) {
      problems.push(`the garden can open a ${cost}-growth bed at ${cost - 1} growth; it must not.`);
    }
    if (state.secondsToNextBed == null) {
      problems.push("with a full plot and growth climbing, secondsToNextBed should be reported, but it is null.");
    }
    const shortBed = document.getElementById("open-bed");
    if (shortBed) {
      const problem = availabilityProblem(
        shortBed,
        false,
        `the Open the next bed control at ${cost - 1} growth, one short of its ${cost}-growth cost`
      );
      if (problem) problems.push(problem);
    }

    // Exactly the price: the next bed is ready.
    setGrowth(cost, 1);
    state = getDisplayedState();
    if (!state.canOpenBed) {
      problems.push(`the garden cannot open a ${cost}-growth bed at exactly ${cost} growth.`);
    }
    const button = document.getElementById("open-bed");
    if (!button) {
      problems.push("the page has no Open the next bed control (#open-bed), so a full plot cannot widen.");
    } else {
      if (button.hidden || getComputedStyle(button).display === "none") {
        problems.push("with every plot full the Open the next bed control is not shown.");
      }
      const readyProblem = availabilityProblem(
        button,
        true,
        `the Open the next bed control with ${cost} growth saved`
      );
      if (readyProblem) problems.push(readyProblem);
      if (!String(button.textContent).includes(formatAmount(cost))) {
        problems.push(
          `the Open the next bed label is ${JSON.stringify(button.textContent)}, which does not state its ${cost}-growth cost.`
        );
      }
      button.click();
    }

    const opened = getGarden();
    const afterGrowth = getGrowthState();
    if (opened.beds !== 2 || opened.capacity !== PLOTS_PER_BED * 2) {
      problems.push(
        `opening a bed left the garden with ${opened.beds} beds / ${opened.capacity} plots, ` +
          `expected 2 beds / ${PLOTS_PER_BED * 2} plots.`
      );
    }
    if (afterGrowth.growth !== 0) {
      problems.push(`opening a ${cost}-growth bed from ${cost} growth left ${afterGrowth.growth} growth, expected 0.`);
    }

    // The goal carries on: the next bed's cost and progress are shown, and the
    // control steps back out of the way now that there is soil to plant again.
    state = getDisplayedState();
    if (state.plotFull) {
      problems.push("after opening a second bed the enlarged plot is still reported full.");
    }
    const openButton = document.getElementById("open-bed");
    if (openButton && (!openButton.hidden || getComputedStyle(openButton).display !== "none")) {
      problems.push(
        "after opening a bed the Open the next bed control is still shown, though the plot is no longer full."
      );
    }
    if (!(state.nextBedCost > cost)) {
      problems.push(`after opening a bed the next bed should cost more than ${cost}, but it is ${state.nextBedCost}.`);
    }
    const nextBedEl = document.querySelector('[data-field="next-bed"]');
    if (!nextBedEl) {
      problems.push('the page has no next-bed readout (expected [data-field="next-bed"]).');
    } else {
      const text = String(nextBedEl.textContent);
      if (!text.includes(formatAmount(state.nextBedCost))) {
        problems.push(`the next-bed readout ${JSON.stringify(text)} does not state the ${state.nextBedCost}-growth cost.`);
      }
      if (!text.includes("%")) {
        problems.push(`the next-bed readout ${JSON.stringify(text)} does not show progress.`);
      }
    }

    // The extra soil is real: seed 13, impossible on one bed, can now be planted.
    const seedCost = nextSeedCost(PLOTS_PER_BED);
    setGrowth(seedCost, 1);
    document.getElementById("plant-seed")?.click();
    if (getGarden().seeds !== PLOTS_PER_BED + 1) {
      problems.push(
        `after opening a second bed the garden could not plant seed ${PLOTS_PER_BED + 1} ` +
          `(it holds ${getGarden().seeds} seeds), so the new soil is not usable.`
      );
    }

    // The extra bed widens the drawn ground, with everything else held still.
    setGrowth(0, 0);
    setGarden({ beds: 1, seeds: 6, plants: 0 });
    const oneBed = canvas ? canvas.toDataURL() : null;
    setGarden({ beds: 2, seeds: 6, plants: 0 });
    const twoBeds = canvas ? canvas.toDataURL() : null;
    if (canvas && oneBed && oneBed === twoBeds) {
      problems.push("the plot drew the same picture with one bed and with two, so a new bed is invisible on it.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

function checkLargeCounts(problems) {
  const before = getGarden();
  const growthBefore = getGrowthState();
  const beforeRaw = rawStorage();
  try {
    const huge = encodeSave({ seeds: 3, plants: 123456789 });
    loadGardenSave(huge);
    const seedsEl = document.querySelector('[data-field="seeds"]');
    const plantedEl = document.querySelector('[data-field="plants"]');
    if (!seedsEl || String(seedsEl.textContent).trim() !== formatAmount(3)) {
      problems.push(`with 3 seeds, the page shows ${JSON.stringify(seedsEl?.textContent)} instead of 3.`);
    }
    if (!plantedEl || String(plantedEl.textContent).trim() !== formatAmount(123456789)) {
      problems.push(
        `with 123456789 plants, the page shows ${JSON.stringify(plantedEl?.textContent)}, ` +
          `expected the compact ${JSON.stringify(formatAmount(123456789))}.`
      );
    }
    checkNoOverflow(problems);
  } finally {
    setGarden(before);
    restoreGrowth(growthBefore);
    restoreRawStorage(beforeRaw);
  }
}

/**
 * A garden grown huge stays readable: every amount at or above ten thousand
 * reads compact (12.3K, 4.5M, 1.1B) on the readout, the goal labels and the
 * action buttons, amounts below ten thousand read exactly as they always have,
 * and the same amount never reads two ways. The raw figures, not the strings,
 * are what the state reaches an agent with.
 */
function checkCompactAmounts(problems) {
  for (const [amount, expected] of [[6, "6"], [230, "230"], [9999, "9,999"]]) {
    if (formatAmount(amount) !== expected) {
      problems.push(
        `formatAmount(${amount}) reads ${JSON.stringify(formatAmount(amount))}, expected the exact ${JSON.stringify(expected)}.`
      );
    }
  }
  if (formatGrowth(6) !== "6.0") {
    problems.push(`formatGrowth(6) reads ${JSON.stringify(formatGrowth(6))}, expected the exact "6.0".`);
  }

  const compact = [
    [10000, "10.0K"],
    [12345, "12.3K"],
    [999999, "1.0M"], // rounds up rather than reading 1000.0K
    [4500000, "4.5M"],
    [1.1e9, "1.1B"],
    [1e12, "1.0T"],
    [1e15, "1.0e+15"], // past trillions an exponent keeps an absurd amount short
  ];
  for (const [amount, expected] of compact) {
    if (formatAmount(amount) !== expected) {
      problems.push(
        `formatAmount(${amount}) reads ${JSON.stringify(formatAmount(amount))}, expected the compact ${JSON.stringify(expected)}.`
      );
    }
    if (formatGrowth(amount) !== formatAmount(amount)) {
      problems.push(
        `growth ${amount} reads as ${JSON.stringify(formatGrowth(amount))} but the same amount as a count reads ` +
          `${JSON.stringify(formatAmount(amount))}; one amount must read one way.`
      );
    }
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const textOf = (selector) => String(document.querySelector(selector)?.textContent ?? "").trim();
  try {
    // A garden big enough that the next seed costs five figures, so the readout,
    // the seed goal and both action labels have to say a compact amount.
    const planted = 55;
    setGarden({ seeds: 0, plants: planted, beds: 30 });
    setGrowth(123456789, 4500000);
    const state = getDisplayedState();

    if (state.nextSeedCost < 1e4) {
      problems.push(
        `the compact-amount check's next seed costs ${state.nextSeedCost}; it must exceed 10,000 to exercise the compact form.`
      );
    }
    if (typeof state.growth !== "number" || typeof state.nextSeedCost !== "number") {
      problems.push(
        `the state a visitor's page reads carries ${JSON.stringify(state.growth)} growth / ` +
          `${JSON.stringify(state.nextSeedCost)} next seed; an agent must get the raw figures, not the compact strings.`
      );
    }
    if (textOf("#growth-total") !== formatGrowth(state.growth)) {
      problems.push(
        `with a huge garden the growth total reads ${JSON.stringify(textOf("#growth-total"))}, ` +
          `expected the compact ${JSON.stringify(formatGrowth(state.growth))}.`
      );
    }
    if (textOf("#growth-rate") !== `+${formatGrowth(state.rate)}/s`) {
      problems.push(
        `with a huge garden the growth rate reads ${JSON.stringify(textOf("#growth-rate"))}, ` +
          `expected the compact ${JSON.stringify(`+${formatGrowth(state.rate)}/s`)}.`
      );
    }
    if (!String(document.getElementById("plot-description")?.textContent ?? "").includes(formatGrowth(state.growth))) {
      problems.push(
        `the plot description does not state the compact growth ${JSON.stringify(formatGrowth(state.growth))}.`
      );
    }
    const plantLabel = String(document.getElementById("plant-seed")?.textContent ?? "");
    if (!plantLabel.includes(formatAmount(state.nextSeedCost))) {
      problems.push(
        `the Plant a seed label ${JSON.stringify(plantLabel)} does not state its compact ` +
          `${JSON.stringify(formatAmount(state.nextSeedCost))}-growth cost.`
      );
    }
    const seedGoal = String(document.getElementById("goal-detail")?.textContent ?? "");
    if (!seedGoal.includes(formatAmount(state.nextSeedCost))) {
      problems.push(
        `the next-seed goal ${JSON.stringify(seedGoal)} does not state its compact ` +
          `${JSON.stringify(formatAmount(state.nextSeedCost))}-growth cost.`
      );
    }
    const nextBed = textOf('[data-field="next-bed"]');
    if (!nextBed.includes(formatAmount(state.nextBedCost))) {
      problems.push(
        `the next-bed readout ${JSON.stringify(nextBed)} does not state its compact ` +
          `${JSON.stringify(formatAmount(state.nextBedCost))}-growth cost.`
      );
    }

    // A full plot of 29 beds: the next bed costs five figures, and its button
    // and goal both have to say it compactly.
    const beds = 29;
    setGarden({ beds, seeds: beds * PLOTS_PER_BED, plants: 0 });
    const full = getDisplayedState();
    if (!full.plotFull || full.nextBedCost < 1e4) {
      problems.push(
        `the compact-amount check's full garden is plotFull ${full.plotFull} with a ` +
          `${full.nextBedCost}-growth bed; it must be full with a bed over 10,000.`
      );
    }
    setGrowth(full.nextBedCost + 1, 1);
    const openLabel = String(document.getElementById("open-bed")?.textContent ?? "");
    if (!openLabel.includes(formatAmount(full.nextBedCost))) {
      problems.push(
        `the Open the next bed label ${JSON.stringify(openLabel)} does not state its compact ` +
          `${JSON.stringify(formatAmount(full.nextBedCost))}-growth cost.`
      );
    }
    if (!String(document.getElementById("goal-title")?.textContent ?? "").includes(formatAmount(beds + 1))) {
      problems.push(
        `the next-goal title does not name the compact bed #${formatAmount(beds + 1)}: ` +
          `${JSON.stringify(String(document.getElementById("goal-title")?.textContent ?? ""))}`
      );
    }
    const bedGoal = String(document.getElementById("goal-detail")?.textContent ?? "");
    if (!bedGoal.includes(formatAmount(full.nextBedCost))) {
      problems.push(
        `the next-bed goal ${JSON.stringify(bedGoal)} does not state its compact ` +
          `${JSON.stringify(formatAmount(full.nextBedCost))}-growth cost.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

function checkNoOverflow(problems) {
  const doc = document.documentElement;
  const widest = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
  if (widest > doc.clientWidth + 1) {
    problems.push(
      `the page is wider than its viewport (${widest}px of content in ${doc.clientWidth}px); something runs off the screen.`
    );
  }
}

/**
 * The page says things with the garden, labels and numbers rather than
 * paragraphs, and the state it folds out of sight still reaches a screen
 * reader. The picture's words and the readout are the same values from the same
 * source, so hiding one form must not lose the number.
 */
function checkCompactReadout(problems) {
  // Anything a person reads is a label, a value or a live status line — no
  // paragraph explaining how the game works or describing the page itself.
  const prose = [...document.querySelectorAll("p.panel-note:not([role])")];
  if (prose.length) {
    const sample = prose[0].textContent.trim().slice(0, 60);
    problems.push(
      `the page shows ${prose.length} explanatory paragraph(s), e.g. "${sample}…"; state must be labels and values, ` +
        "not prose."
    );
  }

  // The plot is still said in words, just not shown.
  const description = document.getElementById("plot-description");
  const spoken = description ? description.textContent.trim() : "";
  if (!description || !spoken) {
    problems.push("the plot has no text description, so a screen reader hears nothing about the picture.");
  } else {
    const rect = description.getBoundingClientRect();
    if (rect.width > 1 || rect.height > 1) {
      problems.push(
        "the plot description takes visible space; it must reach a screen reader only so the garden fits one screen."
      );
    }
  }

  // Every number the page tracks keeps a readout in the DOM, even the ones
  // folded to a screen reader so the garden, numbers and buttons share a screen.
  const fields = [
    "growth", "lifetime", "replant-bonus", "form", "seeds", "plants", "kind-herb", "kind-bloom", "beds",
    "capacity", "season", "pollinator", "next-plant", "next-bed", "storage",
    "visit-seconds", "visit-sown", "visit-tended", "visit-present",
  ];
  for (const field of fields) {
    if (!document.querySelector(`[data-field="${field}"]`)) {
      problems.push(
        `the readout for ${field} is gone (expected [data-field="${field}"]), so a screen reader loses a number.`
      );
    }
  }

  // The two actions that grow the garden are on the page and take up space.
  for (const id of ["tend", "plant-seed"]) {
    const button = document.getElementById(id);
    if (!button) continue; // checkTendControl / checkPlantControl report its absence.
    const rect = button.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      problems.push(`the #${id} control has no size on screen, so its action cannot be taken from the garden.`);
    }
  }
}

/**
 * The garden fits a phone's first screen: the plot, the growing actions and the
 * next goal all end within 390x844, with the long readout below them. The order
 * is asserted in the DOM as well as measured, because a CSS reorder would show
 * the buttons first while leaving a keyboard or a screen reader stuck inside
 * the numbers — shown order and reading order have to be the same.
 */
function checkFirstScreenGarden(problems) {
  // A 390x844 phone's first screen, in document coordinates so the window the
  // suite happens to run in cannot hide something that fell off the page.
  const FIRST_SCREEN_PX = 844;
  // The one-screen promise is a phone promise. On a wide window the garden card
  // is a tall column the plot is meant to fill, so it is legitimately taller
  // than a phone screen; there the plot, actions and the goal sit side by side
  // within the window instead.
  const onOneColumn = window.innerWidth < 760;

  const plot = document.getElementById("garden-plot");
  const actions = document.querySelector(".garden-side > .actions");
  const goal = document.querySelector(".garden-side > .goal");
  const readout = document.querySelector(".garden-side > .readout");
  if (!plot || !actions || !goal || !readout) {
    problems.push(
      "the garden's first screen cannot be checked: it needs #garden-plot and a .garden-side " +
        "holding .actions, .goal and .readout."
    );
    return;
  }

  const precedes = (first, second) =>
    Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (!precedes(plot, actions)) {
    problems.push("the plot must precede the growing actions in the DOM, so reading order matches the page.");
  }
  for (const [label, el] of [["actions", actions], ["goal", goal]]) {
    if (!precedes(el, readout)) {
      problems.push(`the ${label} must precede the readout in the DOM, but the readout stands before it.`);
    }
  }

  const bounds = (el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
  };
  const plotBox = bounds(plot);
  const actionsBox = bounds(actions);
  const goalBox = bounds(goal);
  const readoutBox = bounds(readout);

  // The actions matter most: their box holds every growing control, so it ends
  // within the first screen only when at least one is reachable without a
  // scroll.
  for (const [label, box] of [["plot", plotBox], ["growing actions", actionsBox], ["next goal", goalBox]]) {
    if (onOneColumn && box.bottom > FIRST_SCREEN_PX) {
      problems.push(
        `the ${label} ends at ${Math.round(box.bottom)}px, past the ${FIRST_SCREEN_PX}px first screen, so a fresh ` +
          "visitor cannot reach it without scrolling."
      );
    }
  }

  // The readout is moved, never dropped: it must start below both the actions
  // and the goal, or it fills the first screen with numbers again.
  if (readoutBox.top < actionsBox.bottom || readoutBox.top < goalBox.bottom) {
    problems.push(
      `the readout starts at ${Math.round(readoutBox.top)}px, above the actions (${Math.round(actionsBox.bottom)}px) ` +
        `or the goal (${Math.round(goalBox.bottom)}px); it must sit below both.`
    );
  }
}

/**
 * The drawn garden, not the numbers, is the largest thing in the garden card.
 *
 * The picture is the state drawn, so a visitor who reads no number must still
 * be able to size up the garden at a glance: the plot is the tallest thing a
 * visitor meets above the numbers, and on a wide window it fills its column top
 * to bottom — no blank cream left under a short band — and covers more of the
 * card than the whole readout column does.
 */
function checkPlotDominatesGarden(problems) {
  const plot = document.getElementById("garden-plot");
  const view = document.querySelector(".garden-view");
  const side = document.querySelector(".garden-side");
  const actions = document.querySelector(".garden-side > .actions");
  const goal = document.querySelector(".garden-side > .goal");
  if (!plot || !view || !side || !actions || !goal) {
    problems.push(
      "the plot's prominence cannot be checked: the page needs #garden-plot inside .garden-view " +
        "beside a .garden-side holding .actions and .goal."
    );
    return;
  }

  // The promise is a phone's, and a phone is at least this wide. Below it the
  // three growing buttons wrap taller than any undistorted plot that still
  // leaves the next goal on the same screen, so the layout makes no promise
  // there — the phone this garden is built around is 390x844.
  const PHONE_MIN_WIDTH_PX = 360;
  if (window.innerWidth < PHONE_MIN_WIDTH_PX) return;

  const box = (el) => el.getBoundingClientRect();
  const plotBox = box(plot);

  // The plot is the tallest thing a visitor meets above the numbers: taller
  // than the growing actions and taller than the next goal, at every width.
  for (const [label, el] of [["growing actions", actions], ["next goal", goal]]) {
    const other = box(el);
    if (plotBox.height <= other.height) {
      problems.push(
        `the plot is ${Math.round(plotBox.height)}px tall and the ${label} ${Math.round(other.height)}px, ` +
          "so the numbers still outrank the garden they describe."
      );
    }
  }

  // A wide window gives the plot a column of its own to fill. A plot shorter
  // than that column leaves the panel's cream bare beneath it, which is what
  // makes the picture read as decoration in the corner beside the numbers.
  if (window.innerWidth < 760) return;
  const slack = box(view).bottom - plotBox.bottom;
  if (slack > 1) {
    problems.push(
      `the plot ends ${Math.round(slack)}px above the bottom of its column, so the garden card is left with ` +
        "blank space below the picture."
    );
  }
  const plotArea = plotBox.width * plotBox.height;
  const sideArea = box(side).width * box(side).height;
  if (plotArea <= sideArea) {
    problems.push(
      `the plot covers ${Math.round(plotArea)}px² of the card against the readout column's ${Math.round(sideArea)}px², ` +
        "so the numbers are still the largest thing in the garden."
    );
  }
}

/** The width past which the two-column layout takes over and the phone promise ends. */
const PHONE_WIDTH_MAX_PX = 759;
/** The loosest the phone plot's cap may be, in dvh, and still leave the actions on the first screen. */
const PHONE_PLOT_CAP_MAX_DVH = 40;

/**
 * A long-grown garden still fits a phone's first screen: Tend the soil, both
 * Plant buttons and Replant, plus the growth total and the garden form, all end
 * within 390x844, and the drawn plot still stands taller than the numbers it
 * sits above.
 *
 * The whole promise is about phone pixels, so the measured half only means
 * something when the suite itself runs at a phone width. The cap the layout
 * rests on is read from the CSSOM, which is width-independent, so the build's
 * own desktop-width run still catches the cap being deleted or loosened.
 */
function checkPhoneFirstScreen(problems) {
  if (window.innerWidth <= PHONE_WIDTH_MAX_PX) checkPhoneFirstScreenLayout(problems);
  checkPhonePlotCap(problems);
}

/** The measured half of `checkPhoneFirstScreen`, run only at a phone width. */
function checkPhoneFirstScreenLayout(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const summary = document.getElementById("return-summary");
  const summaryHiddenBefore = summary ? summary.hidden : null;
  const summaryHtmlBefore = summary ? summary.innerHTML : null;
  // A 390x844 phone's first screen, in document coordinates so the window the
  // suite happens to run in cannot hide something that fell off the page.
  const FIRST_SCREEN_PX = 844;
  const DAY = 86400;

  try {
    // The garden the ticket measures: long grown, with every control on offer,
    // and a return just reported, so nothing the fit is judged on is missing.
    setGarden({ beds: 3, seeds: 6, plants: 6, plantCounts: [4, 2], bloomSeeds: 2 });
    setGrowth(999, 2.5, 300, 100000);
    const nowMs = Date.now();
    applyReturn(
      { version: SAVE_VERSION, seeds: 6, plants: 6, growth: 999, rate: 2.5 },
      nowMs - 30 * DAY * 1000,
      nowMs
    );

    const bottom = (el) => el.getBoundingClientRect().bottom + window.scrollY;

    for (const [label, id] of [
      ["Tend the soil", "tend"],
      ["Plant a herb seed", "plant-seed"],
      ["Plant a bloom seed", "plant-bloom"],
      ["Replant the garden", "replant"],
    ]) {
      const control = document.getElementById(id);
      if (!control) {
        problems.push(`the phone's first screen cannot be checked: the page has no #${id} control.`);
      } else if (bottom(control) > FIRST_SCREEN_PX) {
        problems.push(
          `the ${label} control ends at ${Math.round(bottom(control))}px, past the ${FIRST_SCREEN_PX}px first phone screen, ` +
            "so a long-grown garden cannot be acted on without scrolling."
        );
      }
    }

    for (const [label, field] of [
      ["growth total", "growth"],
      ["garden form", "form"],
    ]) {
      const value = document.querySelector(`[data-field="${field}"]`);
      if (!value) {
        problems.push(`the phone's first screen cannot be checked: the page has no ${label} value.`);
      } else if (bottom(value) > FIRST_SCREEN_PX) {
        problems.push(
          `the ${label} ends at ${Math.round(bottom(value))}px, past the ${FIRST_SCREEN_PX}px first phone screen, ` +
            "so a returning visitor cannot read how the garden is doing without scrolling."
        );
      }
    }

    // The drawn garden still leads the first screen: taller than the growing
    // actions and the next goal it sits above.
    const plot = document.getElementById("garden-plot");
    for (const [label, selector] of [
      ["growing actions", ".garden-side > .actions"],
      ["next goal", ".garden-side > .goal"],
    ]) {
      const other = document.querySelector(selector);
      if (!plot || !other) continue;
      const plotHeight = plot.getBoundingClientRect().height;
      const otherHeight = other.getBoundingClientRect().height;
      if (plotHeight <= otherHeight) {
        problems.push(
          `the phone plot is ${Math.round(plotHeight)}px tall and the ${label} ${Math.round(otherHeight)}px, ` +
            "so the numbers outrank the garden on the first phone screen."
        );
      }
    }
  } finally {
    clearReturnMarks();
    if (summary) {
      summary.innerHTML = summaryHtmlBefore ?? "";
      summary.hidden = summaryHiddenBefore ?? true;
    }
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The phone plot's cap, read from the stylesheets rather than the rendered page
 * so it holds whatever width the suite runs at: the `max-height` a `.plot` rule
 * inside a phone `max-width` media query declares, or null when there is none.
 */
function phonePlotMaxHeight() {
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet we cannot read; none of ours are.
    }
    const cap = findPhonePlotCap(rules);
    if (cap) return cap;
  }
  return null;
}

/** The first `.plot` max-height declared inside a phone `max-width` media query, or null. */
function findPhonePlotCap(rules) {
  for (const rule of rules) {
    const media = rule.media && rule.media.mediaText;
    const maxWidth = media && media.match(/max-width\s*:\s*(\d+(?:\.\d+)?)px/i);
    if (maxWidth && Number(maxWidth[1]) <= PHONE_WIDTH_MAX_PX && rule.cssRules) {
      for (const inner of rule.cssRules) {
        if (!inner.selectorText || !inner.style) continue;
        const isPlot = inner.selectorText.split(",").some((selector) => selector.trim() === ".plot");
        if (!isPlot) continue;
        const value = inner.style.getPropertyValue("max-height").trim();
        if (value) return value;
      }
    }
    if (rule.cssRules) {
      const nested = findPhonePlotCap(rule.cssRules);
      if (nested) return nested;
    }
  }
  return null;
}

/** The cap itself: a phone's first screen needs the plot held back in screen units. */
function checkPhonePlotCap(problems) {
  const cap = phonePlotMaxHeight();
  if (!cap) {
    problems.push(
      "the phone plot has no max-height inside a max-width media query, so a long-grown garden fills the " +
        "phone's first screen and pushes the growing actions below the fold."
    );
    return;
  }
  const length = cap.match(/^([\d.]+)(dvh|vh|px|%)$/i);
  if (!length || !/^(dvh|vh)$/i.test(length[2])) {
    problems.push(
      `the phone plot's max-height is "${cap}"; it must be in dvh so it scales with the phone's screen rather ` +
        "than overflowing a shorter one."
    );
    return;
  }
  if (Number(length[1]) > PHONE_PLOT_CAP_MAX_DVH) {
    problems.push(
      `the phone plot's max-height is ${length[1]}${length[2]}, looser than the ${PHONE_PLOT_CAP_MAX_DVH}dvh the ` +
        "phone's first screen allows, so the actions will not all fit above the fold."
    );
  }
}

// --- Time away ---------------------------------------------------------------

/**
 * The season multipliers seen over a span, summed second by second — an
 * independent count of the schedule `seasonMultiplierSecondsWithin` closes into
 * one calculation. It reads the season directly, so it is a real second opinion
 * rather than a second copy of the closed form.
 */
function seasonWeightSecondsByBruteForce(ageSeconds, spanSeconds) {
  let total = 0;
  for (let offset = 0; offset < spanSeconds; offset += 1) {
    total += seasonAt(ageSeconds + offset + 0.5).multiplier;
  }
  return total;
}

/**
 * One kind's own season multipliers seen over a span, summed second by second —
 * an independent count of the per-kind schedule `simulateGarden` closes into one
 * calculation, so a kind's boost is checked against the season it actually
 * falls in rather than against the closed form's arithmetic.
 */
function kindSeasonWeightSecondsByBruteForce(kindIndex, ageSeconds, spanSeconds) {
  let total = 0;
  for (let offset = 0; offset < spanSeconds; offset += 1) {
    const season = seasonAt(ageSeconds + offset + 0.5);
    total += season.multiplier * kindSeasonMultiplier(kindIndex, season.key);
  }
  return total;
}

/**
 * Elapsed time is counted, not invented: a missing or backdated span grows
 * nothing, a month in one step equals thirty daily steps, and no cap eats a long
 * absence.
 */
function checkOfflineTime(problems) {
  const before = getGrowthState();
  const gardenBefore = getGarden();
  const nowMs = 1_700_000_000_000;
  const spans = [
    ["a missing timestamp", elapsedSeconds(null, nowMs), 0],
    ["a non-finite timestamp", elapsedSeconds(Number.NaN, nowMs), 0],
    ["a future timestamp", elapsedSeconds(nowMs + 60_000, nowMs), 0],
    ["a missing now", elapsedSeconds(nowMs, undefined), 0],
    ["five minutes", elapsedSeconds(nowMs - 300_000, nowMs), 300],
  ];
  for (const [label, got, expected] of spans) {
    if (got !== expected) problems.push(`elapsedSeconds for ${label} returned ${got}, expected ${expected}.`);
  }

  const DAY = 86400;
  try {
    // No sprouts in the ground: this isolates the plain elapsed-time rule.
    setGarden({ seeds: 0, plants: 0 });
    // A month of growth at +0.5/s, with each second weighted by the season it
    // falls in (the garden starts at age 0, in winter).
    const expected = 0.5 * seasonWeightSecondsByBruteForce(0, 30 * DAY);
    const tolerance = Math.max(1e-6, expected * 1e-9);

    setGrowth(0, 0.5);
    advance(30 * DAY);
    const oneStep = getGrowthState().growth;

    setGrowth(0, 0.5);
    for (let day = 0; day < 30; day += 1) advance(DAY);
    const stepped = getGrowthState().growth;

    if (Math.abs(oneStep - stepped) > tolerance) {
      problems.push(
        `a month in one step gave ${oneStep} growth but thirty daily steps gave ${stepped}; ` +
          "offline time must match played time."
      );
    }
    if (Math.abs(oneStep - expected) > tolerance) {
      problems.push(`a month at +0.5/s gave ${oneStep} growth, expected ${expected} with no cap on the absence.`);
    }

    // Seeds maturing mid-absence must land in the same place one step or many:
    // the rate rises as each plant matures, and a single jump must still see it.
    setGarden({ seeds: 3, plants: 0 });
    setGrowth(0, 1);
    advance(30 * DAY);
    const maturesAtOnce = { growth: getGrowthState().growth, garden: getGarden() };

    setGarden({ seeds: 3, plants: 0 });
    setGrowth(0, 1);
    for (let day = 0; day < 30; day += 1) advance(DAY);
    const maturesStepped = { growth: getGrowthState().growth, garden: getGarden() };

    if (maturesAtOnce.garden.plants !== 3 || maturesAtOnce.garden.seeds !== 0) {
      problems.push(
        `a month away left ${maturesAtOnce.garden.seeds} seeds / ${maturesAtOnce.garden.plants} plants; ` +
          "all three seeds should have matured with no cap on the absence."
      );
    }
    if (Math.abs(maturesAtOnce.growth - maturesStepped.growth) > Math.max(1e-6, maturesAtOnce.growth * 1e-9)) {
      problems.push(
        `seeds maturing over a month gave ${maturesAtOnce.growth} growth in one step but ` +
          `${maturesStepped.growth} across thirty days; maturation must resolve the same either way.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(before);
  }
}

/**
 * The save carries what is needed to count time away: growth and its rate, a
 * version-1 save still loads, bad amounts are refused, and the last-seen moment
 * lives in its own key and round-trips.
 */
function checkSaveCarriesGrowth(problems) {
  const sample = { version: SAVE_VERSION, seeds: 3, plants: 2, growth: 12.5, rate: 0.7 };
  let back = null;
  try {
    back = decodeSave(encodeSave(sample));
  } catch (e) {
    problems.push(`a save carrying growth and rate could not round-trip: ${e.message}`);
  }
  if (back && (back.growth !== 12.5 || back.rate !== 0.7)) {
    problems.push(`a save put in 12.5 growth / 0.7 rate and gave back ${back.growth} / ${back.rate}.`);
  }

  // A version-1 save had no growth of its own: its seeds become ungrown sprouts
  // with their full growing time left, kept rather than lost.
  const legacy = `${SAVE_PREFIX}${btoa(JSON.stringify({ version: 1, seeds: 4, plants: 2 }))}`;
  try {
    const migrated = decodeSave(legacy);
    if (migrated.seeds !== 4 || migrated.plants !== 2 || migrated.growth !== 0 || migrated.rate !== 1) {
      problems.push(
        `a version-1 save migrated to ${migrated.seeds} seeds / ${migrated.plants} plants / ` +
          `${migrated.growth} growth / ${migrated.rate} rate, expected 4 sprouts / 2 plants / 0 / 1.`
      );
    }
    if (JSON.stringify(migrated.sprouts) !== JSON.stringify(Array(4).fill(GROW_SECONDS))) {
      problems.push(
        `a version-1 save's 4 seeds should wake as 4 fresh ${GROW_SECONDS}s sprouts, but they are ` +
          `${JSON.stringify(migrated.sprouts)}.`
      );
    }
  } catch (e) {
    problems.push(`a version-1 save should still load, but it was refused: ${e.message}`);
  }

  // A version-2 save sped the garden up for every planted seed at once. Its rate
  // is rewritten so the seeds that were never growing stop, and the already-grown
  // plants keep producing.
  const version2 = `${SAVE_PREFIX}${btoa(JSON.stringify({ version: 2, seeds: 4, plants: 2, growth: 12.5, rate: 3 }))}`;
  try {
    const migrated = decodeSave(version2);
    if (migrated.seeds !== 4 || migrated.plants !== 2 || migrated.growth !== 12.5 || migrated.rate !== 2) {
      problems.push(
        `a version-2 save migrated to ${migrated.seeds} seeds / ${migrated.plants} plants / ` +
          `${migrated.growth} growth / ${migrated.rate} rate, expected 4 sprouts / 2 plants / 12.5 / 2 ` +
          `(its seeds' old 4*0.5/s production removed, its plants' 2*0.5/s kept).`
      );
    }
  } catch (e) {
    problems.push(`a version-2 save should still load, but it was refused: ${e.message}`);
  }

  const payload = (value) => `${SAVE_PREFIX}${btoa(JSON.stringify(value))}`;
  const rejects = [
    ["a negative growth", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: -1, rate: 0 })],
    ["a growth that is not a number", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: "1", rate: 0 })],
    ["a negative rate", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0, rate: -1 })],
    ["a missing rate", payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0 })],
  ];
  for (const [label, value] of rejects) {
    try {
      decodeSave(value);
      problems.push(`the save reader accepted ${label}; it should refuse it.`);
    } catch {
      // refused, as it must be.
    }
  }

  const backing = new Map();
  const storage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
  };
  if (readLastSeen(storage) !== null) problems.push("a store with no last-seen timestamp reported one anyway.");
  if (!writeLastSeen(123456789, storage)) {
    problems.push("writing the last-seen timestamp to a working store reported failure.");
  }
  if (readLastSeen(storage) !== 123456789) {
    problems.push(`the last-seen timestamp came back as ${readLastSeen(storage)}, expected 123456789.`);
  }
  if (writeLastSeen(Number.NaN, storage)) problems.push("a non-finite last-seen timestamp was written instead of refused.");
  storage.setItem(LAST_SEEN_KEY, "not-a-number");
  if (readLastSeen(storage) !== null) {
    problems.push("a corrupt last-seen value was read as a time instead of ignored.");
  }
}

/**
 * The visiting pollinator: a schedule read from the garden's age, a boost the
 * simulation and the readout agree on, and a return that can find one already
 * on the plot.
 */
function checkPollinator(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    // Nothing grown means no visit, and a freshly started garden waits for the
    // first window rather than being boosted from its first second.
    for (const [label, pollinator] of [
      ["a garden with no grown plants", pollinatorAt(POLLINATOR_CYCLE_SECONDS - 1, 0)],
      ["a garden at the very start of its first cycle", pollinatorAt(0, 3)],
    ]) {
      if (pollinator.visiting) {
        problems.push(`${label} reported a pollinator visiting (${JSON.stringify(pollinator)}); it must not.`);
      }
    }
    const visiting = pollinatorAt(POLLINATOR_CYCLE_SECONDS - 1, 3);
    if (!visiting.visiting || visiting.multiplier !== POLLINATOR_BOOST || visiting.boost !== POLLINATOR_BOOST) {
      problems.push(
        `at age ${POLLINATOR_CYCLE_SECONDS - 1} with 3 plants the pollinator should visit at x${POLLINATOR_BOOST}, ` +
          `but it reported ${JSON.stringify(visiting)}.`
      );
    }

    // A garden with no blooms keeps exactly the base visit, and each grown bloom
    // lengthens it by a fixed step up to a stated cap that more blooms cannot
    // pass. This is the whole reason to plant a bloom over a herb.
    const noBloomVisit = pollinatorAt(POLLINATOR_CYCLE_SECONDS - 1, 3, 0);
    if (noBloomVisit.visitSeconds !== POLLINATOR_VISIT_SECONDS || noBloomVisit.bloomsKeeping !== 0) {
      problems.push(
        `a garden with no blooms reported visit ${JSON.stringify(noBloomVisit)}, expected the base ` +
          `${POLLINATOR_VISIT_SECONDS}s visit kept by no blooms.`
      );
    }
    for (const blooms of [0, 1, 3, 9, 100]) {
      const expected = Math.min(
        POLLINATOR_VISIT_MAX_SECONDS,
        POLLINATOR_VISIT_SECONDS + blooms * POLLINATOR_BLOOM_VISIT_SECONDS
      );
      const got = pollinatorVisitSeconds(blooms);
      if (got !== expected) {
        problems.push(`pollinatorVisitSeconds(${blooms}) gave ${got}s, expected ${expected}s.`);
      }
    }
    if (pollinatorVisitSeconds(9) !== POLLINATOR_VISIT_MAX_SECONDS) {
      problems.push(
        `9 blooms gave a ${pollinatorVisitSeconds(9)}s visit, expected it to reach the cap ` +
          `${POLLINATOR_VISIT_MAX_SECONDS}s.`
      );
    }

    // At a phase 100s before the cycle turns, no blooms are not yet visited
    // while 6 blooms already are — so a bed of blooms is visibly worth more.
    const latePhase = POLLINATOR_CYCLE_SECONDS - 100;
    const noBloomLate = pollinatorAt(latePhase, 1, 0);
    const sixBloomLate = pollinatorAt(latePhase, 1, 6);
    if (noBloomLate.visiting) {
      problems.push(`at age ${latePhase} a garden with no blooms should not be visited, but it was.`);
    }
    if (!sixBloomLate.visiting) {
      problems.push(`at age ${latePhase} with 6 blooms the pollinator should already be visiting, but it was not.`);
    }
    if (sixBloomLate.bloomsKeeping !== 6) {
      problems.push(
        `a visit stretched by 6 blooms reported bloomsKeeping ${sixBloomLate.bloomsKeeping}, expected 6.`
      );
    }

    // The closed form must count exactly the seconds the schedule is on the
    // plot, checked against an independent second-by-second sum.
    const bruteSeconds = (ageValue, span) => {
      let total = 0;
      for (let offset = 0; offset < span; offset += 1) {
        if (pollinatorAt(ageValue + offset + 0.5, 1).visiting) total += 1;
      }
      return total;
    };
    for (const [ageValue, span] of [
      [0, 600],
      [30, POLLINATOR_VISIT_SECONDS + 30],
      [POLLINATOR_CYCLE_SECONDS - 1, 2],
      [POLLINATOR_CYCLE_SECONDS - 5, POLLINATOR_VISIT_SECONDS],
      [POLLINATOR_CYCLE_SECONDS, POLLINATOR_CYCLE_SECONDS],
      [1000, 540],
    ]) {
      const closed = pollinatorSecondsWithin(ageValue, span);
      const counted = bruteSeconds(ageValue, span);
      if (Math.abs(closed - counted) > 1e-6) {
        problems.push(
          `pollinatorSecondsWithin(${ageValue}, ${span}) gave ${closed} seconds, but counting the schedule gave ${counted}.`
        );
      }
    }

    // The closed form counts a bloom-lengthened visit exactly too, against an
    // independent second-by-second sum that reads the same visit length.
    const bruteBloomSeconds = (ageValue, span, blooms) => {
      let total = 0;
      for (let offset = 0; offset < span; offset += 1) {
        if (pollinatorAt(ageValue + offset + 0.5, 1, blooms).visiting) total += 1;
      }
      return total;
    };
    for (const blooms of [0, 3, 6, 9, 20]) {
      const closed = pollinatorSecondsWithin(0, 600, blooms);
      const counted = bruteBloomSeconds(0, 600, blooms);
      if (Math.abs(closed - counted) > 1e-6) {
        problems.push(
          `pollinatorSecondsWithin(0, 600, ${blooms}) gave ${closed} seconds, but counting the schedule gave ${counted}.`
        );
      }
    }

    // A visit earns more than the base rate; bare soil earns exactly the base.
    const base = { growth: 0, rate: 1, sprouts: [], plants: 1, beds: 1, age: 0 };
    const boosted = simulateGarden(base, 600);
    const visitSeconds = pollinatorSecondsWithin(0, 600);
    const expectedBoosted = 600 + (POLLINATOR_BOOST - 1) * visitSeconds;
    if (Math.abs(boosted.growth - expectedBoosted) > 1e-6) {
      problems.push(
        `a 600s span with a growing plant earned ${boosted.growth} growth, expected ${expectedBoosted} ` +
          `(${visitSeconds}s of it under the x${POLLINATOR_BOOST} boost).`
      );
    }
    if (boosted.age !== 600) {
      problems.push(`simulating 600s advanced the garden's age to ${boosted.age}, expected 600.`);
    }
    const unboosted = simulateGarden({ ...base, plants: 0 }, 600);
    if (unboosted.growth !== 600) {
      problems.push(
        `a 600s span with no grown plants earned ${unboosted.growth} growth, expected the plain 600 ` +
          `(a pollinator must never visit bare soil).`
      );
    }

    // Six grown blooms keep the visitor longer, so the simulated garden earns
    // the boost for those extra seconds — and more than a single herb earns.
    const bloomGarden = {
      growth: 0,
      rate: 1,
      sprouts: [],
      bloomSprouts: [],
      plantCounts: [0, 6],
      beds: 1,
      age: 0,
    };
    const bloomed = simulateGarden(bloomGarden, 600);
    const bloomVisitSeconds = pollinatorSecondsWithin(0, 600, 6);
    const expectedBloomed = 600 + (POLLINATOR_BOOST - 1) * bloomVisitSeconds;
    if (Math.abs(bloomed.growth - expectedBloomed) > 1e-6) {
      problems.push(
        `a 600s span with 6 blooms earned ${bloomed.growth} growth, expected ${expectedBloomed} ` +
          `(${bloomVisitSeconds}s of it under the x${POLLINATOR_BOOST} boost).`
      );
    }
    const herbOnly = simulateGarden({ ...bloomGarden, plantCounts: [1, 0] }, 600);
    if (!(bloomed.growth > herbOnly.growth)) {
      problems.push(
        `6 blooms earned ${bloomed.growth} growth over 600s, no more than the ${herbOnly.growth} a single herb ` +
          "earned, so blooms are not keeping the pollinator any longer."
      );
    }

    // The readout and get-state name the visit and the boosted rate. The
    // readout states the pollinator as short labelled facts — whether one is
    // visiting and the boost it brings, how long the visit lasts, how often it
    // comes, what each bloom adds and the cap it can reach — never a joined
    // sentence or a bracketed rule to decode, and every fact it states is the
    // one the same describe function reads off get-state.
    const row = document.querySelector('[data-field="pollinator"]');
    if (!row) {
      problems.push('the page has no pollinator readout (expected [data-field="pollinator"]).');
    }
    // The six labels every pollinator readout carries, whatever the state.
    const pollinatorLabels = ["State", "Boost", "Stays", "Every", "Each bloom", "Max"];
    const expectPollinatorRow = (label, state) => {
      if (!row) return;
      const text = String(row.textContent);
      if (text.includes(" · ")) {
        problems.push(
          `the pollinator readout ${label} reads ${JSON.stringify(text)}, expected short labelled facts rather than ` +
            "a dot-joined sentence."
        );
      }
      if (/[()\[\]]/.test(text)) {
        problems.push(
          `the pollinator readout ${label} reads ${JSON.stringify(text)}, expected short labelled facts with no ` +
            "bracketed rule to decode."
        );
      }
      const facts = readReadoutFacts(row);
      const labels = facts.map((fact) => fact.label);
      for (const required of pollinatorLabels) {
        if (!labels.includes(required)) {
          problems.push(
            `the pollinator readout ${label} is missing the ${required} fact; it reads ${JSON.stringify(text)}.`
          );
        }
      }
      const expected = describePollinator(state);
      if (JSON.stringify(facts) !== JSON.stringify(expected)) {
        problems.push(
          `the pollinator readout ${label} reads ${JSON.stringify(facts)}, expected ${JSON.stringify(expected)}.`
        );
      }
    };

    setGarden({ seeds: 0, plants: 3 });
    setGrowth(0, 1, 0);
    const quiet = getDisplayedState();
    if (quiet.pollinator.visiting || quiet.rate !== 1) {
      problems.push(
        `a garden out of a visit window reported pollinator ${JSON.stringify(quiet.pollinator)} at ${quiet.rate}/s, ` +
          `expected none visiting at the base 1/s.`
      );
    }
    expectPollinatorRow("outside a visit", quiet);

    setGrowth(0, 1, POLLINATOR_CYCLE_SECONDS - 1);
    const boostedState = getDisplayedState();
    if (!boostedState.pollinator.visiting) {
      problems.push("inside a visit window get-state does not report a visiting pollinator.");
    }
    if (boostedState.rate !== POLLINATOR_BOOST || boostedState.baseRate !== 1) {
      problems.push(
        `while a pollinator visits the state reports rate ${boostedState.rate}/s on a base of ` +
          `${boostedState.baseRate}/s, expected ${POLLINATOR_BOOST}/s on 1/s.`
      );
    }
    expectPollinatorRow("during a visit", boostedState);

    // A garden kept by 6 blooms states the longer visit, the blooms keeping it
    // and the boosted rate beside the garden.
    setGarden({ seeds: 0, plants: 0, bloomPlants: 6 });
    setGrowth(0, 1, latePhase);
    const bloomState = getDisplayedState();
    const bloomVisitLength = POLLINATOR_VISIT_SECONDS + 6 * POLLINATOR_BLOOM_VISIT_SECONDS;
    if (!bloomState.pollinator.visiting || bloomState.pollinator.visitSeconds !== bloomVisitLength) {
      problems.push(
        `a garden kept by 6 blooms reported pollinator ${JSON.stringify(bloomState.pollinator)}, expected a ` +
          `${bloomVisitLength}s visit in progress.`
      );
    }
    if (bloomState.rate !== POLLINATOR_BOOST || bloomState.baseRate !== 1) {
      problems.push(
        `a garden kept by 6 blooms reported rate ${bloomState.rate}/s on a base of ${bloomState.baseRate}/s, ` +
          `expected ${POLLINATOR_BOOST}/s on 1/s.`
      );
    }
    expectPollinatorRow("during a bloom-lengthened visit", bloomState);

    // A return that lands during a visit shows one already there, in the summary
    // and in the state.
    const away = buildAwayReport(
      { growth: 0, rate: 1, sprouts: [], plants: 3, beds: 1, age: 0 },
      POLLINATOR_CYCLE_SECONDS - 1
    );
    if (!away.pollinator?.visiting) {
      problems.push("a return ending inside a visit window did not report a visiting pollinator.");
    }
    if (!/pollinator/i.test(away.summary)) {
      problems.push(`the return summary does not mention the visiting pollinator: "${away.summary}"`);
    }

    // A return that lands inside a bloom-lengthened visit names the blooms that
    // kept it, in the state and in the sentence.
    const bloomAway = buildAwayReport(
      { growth: 0, rate: 1, sprouts: [], bloomSprouts: [], plantCounts: [0, 6], beds: 1, age: 0 },
      latePhase
    );
    if (!bloomAway.pollinator?.visiting) {
      problems.push("a return ending inside a bloom-lengthened visit did not report a visiting pollinator.");
    }
    if (!(bloomAway.pollinator?.bloomsKeeping > 0)) {
      problems.push("a return inside a bloom-lengthened visit did not report the blooms keeping it.");
    }
    if (!/bloom/i.test(bloomAway.summary)) {
      problems.push(`the return summary does not name the blooms keeping the visit: "${bloomAway.summary}"`);
    }

    // A garden holding only grown blooms reads its visit from the same grown
    // total a herb garden of the same size does, so a bloom-only garden reports
    // the visit it used to miss while it was being pollinated.
    const bloomOnlyAway = buildAwayReport(
      { growth: 0, rate: 1, sprouts: [], bloomSprouts: [], plantCounts: [0, 6], beds: 1, age: 0 },
      POLLINATOR_CYCLE_SECONDS - 1
    );
    const herbOnlyAway = buildAwayReport(
      { growth: 0, rate: 1, sprouts: [], bloomSprouts: [], plantCounts: [6, 0], beds: 1, age: 0 },
      POLLINATOR_CYCLE_SECONDS - 1
    );
    if (!bloomOnlyAway.pollinator?.visiting) {
      problems.push(
        "a return for a garden of 6 grown blooms and no herbs reported no pollinator; a bloom-only garden must " +
          "report its visit exactly as a herb garden of the same size does."
      );
    }
    if (
      bloomOnlyAway.pollinator?.visiting !== herbOnlyAway.pollinator?.visiting ||
      bloomOnlyAway.pollinator?.multiplier !== herbOnlyAway.pollinator?.multiplier
    ) {
      problems.push(
        `a garden of 6 blooms reported pollinator ${JSON.stringify(bloomOnlyAway.pollinator)}, but 6 herbs ` +
          `reported ${JSON.stringify(herbOnlyAway.pollinator)}; the two must agree on whether a pollinator visits.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The pollinator's home on the plot answers who lives here and whether it is
 * working, and answers it the same way `get-state` does.
 *
 * A garden with grown plants draws a home — the hive with a resting bee between
 * visits, and a visibly busier visit during one — while a garden with no grown
 * plants draws nothing. The state the picture draws is exactly the
 * `pollinator.visiting` an agent reads, so the two cannot disagree.
 */
function checkPollinatorHome(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    // Nowhere grown means no home at all, whatever the pollinator schedule says.
    const none = pollinatorPlot({ plantCounts: [0, 0], pollinator: { visiting: true } });
    if (none.home || none.visiting || none.resting) {
      problems.push(
        `a garden with no grown plants reported pollinator ${JSON.stringify(none)}; it must show no home.`
      );
    }
    // A bare plot must draw the same with the pollinator visiting as without:
    // with nowhere to live, a visit leaves no mark on the picture.
    const bare = { growth: 0, beds: 1, seeds: 0, plants: 0 };
    if (
      plotImage({ ...bare, pollinator: { visiting: true } }) !== plotImage({ ...bare, pollinator: { visiting: false } })
    ) {
      problems.push("a bare plot drew differently with the pollinator visiting, so it shows a home where no plant grows.");
    }

    // Grown plants: a home that rests between visits and is out during one.
    const resting = pollinatorPlot({ plantCounts: [1, 0], pollinator: { visiting: false } });
    if (!resting.home || !resting.resting || resting.visiting) {
      problems.push(`a garden with one grown plant reported pollinator ${JSON.stringify(resting)}; it should rest.`);
    }
    const out = pollinatorPlot({ plantCounts: [1, 0], pollinator: { visiting: true } });
    if (!out.home || !out.visiting || out.resting) {
      problems.push(`a garden with one grown plant, visiting, reported pollinator ${JSON.stringify(out)}; it should be out.`);
    }

    // The home appears on the plot when the first plant does, and the visit is
    // visibly busier than the rest — at a pinned still frame, so reduced motion
    // shows the difference too.
    const grown = { growth: 0, beds: 1, seeds: 0, plants: 1 };
    const noHome = plotImage({ ...grown, plants: 0 });
    const restingPlot = plotImage({ ...grown, pollinator: { visiting: false } });
    const visitingPlot = plotImage({ ...grown, pollinator: { visiting: true } });
    if (noHome === restingPlot) {
      problems.push("a garden with a grown plant drew the same as bare soil, so its pollinator home is invisible.");
    }
    if (restingPlot === visitingPlot) {
      problems.push("the plot drew the same picture resting and visiting, so a visit is not visible on the garden.");
    }

    // The hive stands on the home's own strip of ground beside the plots, and a
    // pixel its roof covers is the home's own anchor: bare soil must not carry
    // it, and it must stay put while the bee is out visiting.
    const bounds = plotBounds(grown);
    const anchorX = bounds.home.x + 12;
    const anchorY = bounds.home.y + 12;
    const anchorPixel = (state) => {
      const data = plotCanvas(state).getContext("2d").getImageData(anchorX, anchorY, 1, 1).data;
      return `${data[0]},${data[1]},${data[2]}`;
    };
    if (anchorPixel({ ...grown, plants: 0 }) === anchorPixel({ ...grown, pollinator: { visiting: false } })) {
      problems.push(
        `the pollinator home's anchor pixel (${anchorX}, ${anchorY}) is the same with and without a grown plant, ` +
          "so the home is not drawn on the plot."
      );
    }
    if (anchorPixel({ ...grown, pollinator: { visiting: false } }) !== anchorPixel({ ...grown, pollinator: { visiting: true } })) {
      problems.push("the hive left the plot while the pollinator was visiting; its home must stay put between visits.");
    }

    // The state the picture draws is the one the agent tools report: with the
    // live readout, the plot's visit flag is exactly `pollinator.visiting` the
    // tools return, both at rest and during a visit.
    setGarden({ seeds: 0, plants: 3 });
    setGrowth(0, 1, 0);
    const quietState = getDisplayedState();
    const quietPlot = pollinatorPlot(quietState);
    if (!quietPlot.home) {
      problems.push("a garden of grown plants reported no pollinator home on the plot.");
    }
    if (
      quietPlot.visiting !== Boolean(quietState.pollinator.visiting) ||
      quietPlot.resting !== !quietState.pollinator.visiting
    ) {
      problems.push(
        `the plot shows pollinator ${JSON.stringify(quietPlot)} while get-state reports visiting ` +
          `${quietState.pollinator.visiting}, so the picture and the tools disagree.`
      );
    }

    setGrowth(0, 1, POLLINATOR_CYCLE_SECONDS - 1);
    const visitState = getDisplayedState();
    if (!visitState.pollinator.visiting) {
      problems.push("the live garden is not visiting at the end of the pollinator's cycle, so the visit cannot be checked.");
    }
    const visitPlot = pollinatorPlot(visitState);
    if (
      visitPlot.visiting !== Boolean(visitState.pollinator.visiting) ||
      visitPlot.resting !== !visitState.pollinator.visiting
    ) {
      problems.push(
        `the plot shows pollinator ${JSON.stringify(visitPlot)} while get-state reports visiting ` +
          `${visitState.pollinator.visiting}, so the picture and the tools disagree during a visit.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The pollinator's home stands on ground of its own, beside the plots rather
 * than on one of them, so every plot a seed or plant holds stays visible and the
 * drawn garden can be counted against the 'Grown plants' beside it.
 *
 * `plotBounds` lays the home's strip past the last plot column and `drawGarden`
 * draws the hive there, so the home's ground meets no plot cell and no mark
 * stands on it. The picture says the same thing: every plot of a full bed shows
 * as much of its plant as any other, and the plot cells a bed of plants changes
 * from bare soil are exactly the cells its plants hold, at every size up to a
 * full bed.
 */
function checkPollinatorHomeOffPlots(problems) {
  // The home's ground is past the last plot column, it fits the canvas, and no
  // plot a seed or plant holds ever meets it.
  for (let beds = 1; beds <= 3; beds += 1) {
    const capacity = beds * PLOTS_PER_BED;
    const bounds = plotBounds({ growth: 0, beds, capacity });
    const home = bounds.home;
    if (!home) {
      problems.push(
        `a ${beds}-bed garden reports no ground for the pollinator's home, so the hive can only stand on a plot.`
      );
      continue;
    }
    if (home.x < bounds.width) {
      problems.push(
        `the pollinator's home starts at x=${home.x} while the plot's own ground runs to x=${bounds.width}, so the ` +
          "hive is drawn over a plot."
      );
    }
    if (home.x + home.width > bounds.canvasWidth) {
      problems.push(
        `the pollinator's home runs to x=${home.x + home.width} past the canvas' ${bounds.canvasWidth}px, so the ` +
          "hive is cut off."
      );
    }
    const full = { growth: 0, beds, capacity, plantCounts: [capacity, 0], pollinator: { visiting: false } };
    const covered = plotMarks(full).find((mark) => {
      const left = (mark.cell % bounds.columns) * bounds.cell;
      const top = Math.floor(mark.cell / bounds.columns) * bounds.cell;
      return (
        left < home.x + home.width &&
        home.x < left + bounds.cell &&
        top < home.y + home.height &&
        home.y < top + bounds.cell
      );
    });
    if (covered) {
      problems.push(
        `the pollinator's home covers the plot at cell ${covered.cell} of a full ${beds}-bed garden, so the ` +
          `${covered.kind} standing there cannot be counted against the 'Grown plants' beside it.`
      );
    }
  }

  // Every plot of a full bed shows its own plant: a bed of one kind holds the
  // same sprite on every plot, so each planted plot carries the same count of
  // leaf-green pixels, which only a growing thing draws. A hive painted over a
  // plot would leave that plot's plant partly buried and short of the others.
  const palette = readPalette();
  const leafKeys = new Set(
    [palette.leaf, palette.leafLight, palette.leafDeep].map((color) => colorKey(parseColor(color)))
  );
  const bed = { growth: 0, beds: 1, capacity: PLOT_CAPACITY, plantCounts: [PLOT_CAPACITY, 0], pollinator: { visiting: false } };
  const bedBounds = plotBounds(bed);
  const bedData = plotCanvas(bed).getContext("2d").getImageData(0, 0, bedBounds.width, bedBounds.height).data;
  const leavesPerCell = new Map();
  for (let y = 0; y < bedBounds.height; y += 1) {
    for (let x = 0; x < bedBounds.width; x += 1) {
      const i = (y * bedBounds.width + x) * 4;
      if (!leafKeys.has(`${bedData[i]},${bedData[i + 1]},${bedData[i + 2]}`)) continue;
      const cell = Math.floor(y / bedBounds.cell) * bedBounds.columns + Math.floor(x / bedBounds.cell);
      leavesPerCell.set(cell, (leavesPerCell.get(cell) ?? 0) + 1);
    }
  }
  const wholePlant = leavesPerCell.get(0) ?? 0;
  for (let cell = 0; cell < PLOT_CAPACITY; cell += 1) {
    const leaves = leavesPerCell.get(cell) ?? 0;
    if (leaves !== wholePlant) {
      problems.push(
        `of a full bed of ${PLOT_CAPACITY} plants, the plot at cell ${cell} shows ${leaves} leaf pixels against the ` +
          `${wholePlant} of the first plot, so its plant is not drawn whole and cannot be counted against the ` +
          "'Grown plants' beside it."
      );
      break;
    }
  }

  // Every plot the bed plants is drawn, and only those plots: a bed of n plants
  // differs from bare soil on exactly the cells 0..n-1, at every size up to a
  // full bed, so a visitor counting the planted marks counts the 'Grown plants'
  // value beside them.
  const bare = plotCanvas({ ...bed, plantCounts: [0, 0] });
  const bareData = bare.getContext("2d").getImageData(0, 0, bedBounds.width, bedBounds.height).data;
  for (let plants = 1; plants <= PLOT_CAPACITY; plants += 1) {
    const planted = plotCanvas({ ...bed, plantCounts: [plants, 0] });
    const plantedData = planted.getContext("2d").getImageData(0, 0, bedBounds.width, bedBounds.height).data;
    const drawn = new Set();
    for (let y = 0; y < bedBounds.height; y += 1) {
      for (let x = 0; x < bedBounds.width; x += 1) {
        const i = (y * bedBounds.width + x) * 4;
        if (
          plantedData[i] === bareData[i] &&
          plantedData[i + 1] === bareData[i + 1] &&
          plantedData[i + 2] === bareData[i + 2]
        ) {
          continue;
        }
        drawn.add(Math.floor(y / bedBounds.cell) * bedBounds.columns + Math.floor(x / bedBounds.cell));
      }
    }
    const expected = Array.from({ length: plants }, (_, cell) => cell);
    if (drawn.size !== plants || expected.some((cell) => !drawn.has(cell))) {
      problems.push(
        `a bed of ${plants} grown ${plants === 1 ? "plant" : "plants"} draws marks on plot cells ` +
          `${JSON.stringify([...drawn].sort((a, b) => a - b))}, expected exactly ${JSON.stringify(expected)}, so the ` +
          "planted marks cannot be counted against the 'Grown plants' value beside them."
      );
    }
  }
}

/**
 * The season's effect on the pollinator: each season sets its own visit cycle
 * and visit length, the closed form matches played time across season
 * boundaries, no season drops the garden below its base rate, and the season
 * and pollinator readouts and get-state state the effect in numbers.
 */
function checkPollinatorSeasons(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    // Every season carries its own rhythm, and every base visit fits inside its
    // cycle, so a visit is always a slice of the wait rather than the whole of
    // it. Winter is the garden's unchanged base.
    const rhythms = new Set();
    for (const season of SEASONS) {
      const cycle = pollinatorCycleSeconds(season.key);
      const baseVisit = pollinatorBaseVisitSeconds(season.key);
      if (!(cycle > 0) || !(baseVisit > 0) || !(baseVisit < cycle)) {
        problems.push(
          `the ${season.key} pollinator schedule is a ${baseVisit}s visit every ${cycle}s; a visit must be a ` +
            "positive slice shorter than its cycle."
        );
      }
      if (
        season.key === "winter" &&
        (cycle !== POLLINATOR_CYCLE_SECONDS || baseVisit !== POLLINATOR_VISIT_SECONDS)
      ) {
        problems.push(
          `winter's pollinator schedule is a ${baseVisit}s visit every ${cycle}s, expected the garden's base ` +
            `${POLLINATOR_VISIT_SECONDS}s every ${POLLINATOR_CYCLE_SECONDS}s.`
        );
      }
      rhythms.add(`${cycle}:${baseVisit}`);
    }
    if (rhythms.size < 2) {
      problems.push(
        "every season gives the pollinator the same cycle and visit, so the year is not felt at the plot."
      );
    }

    // pollinatorAt reads its cycle and base visit from the season the age falls
    // in, so an agent asking during spring cannot be told winter's rhythm.
    const atSeason = [
      ["winter", 0],
      ["spring", SEASON_SECONDS],
      ["summer", SEASON_SECONDS * 2],
      ["autumn", SEASON_SECONDS * 3],
    ];
    for (const [key, ageValue] of atSeason) {
      const pollinator = pollinatorAt(ageValue, 3, 0);
      if (pollinator.seasonKey !== key) {
        problems.push(`at age ${ageValue}s the pollinator reports season ${pollinator.seasonKey}, expected ${key}.`);
      }
      if (
        pollinator.cycleSeconds !== pollinatorCycleSeconds(key) ||
        pollinator.baseVisitSeconds !== pollinatorBaseVisitSeconds(key)
      ) {
        problems.push(
          `the ${key} pollinator reports a ${pollinator.baseVisitSeconds}s visit every ${pollinator.cycleSeconds}s, ` +
            `expected ${pollinatorBaseVisitSeconds(key)}s every ${pollinatorCycleSeconds(key)}s.`
        );
      }
    }

    // The visit length reads each season's base and still caps.
    for (const season of SEASONS) {
      const baseVisit = pollinatorBaseVisitSeconds(season.key);
      for (const blooms of [0, 1, 4, 40]) {
        const expected = Math.min(POLLINATOR_VISIT_MAX_SECONDS, baseVisit + blooms * POLLINATOR_BLOOM_VISIT_SECONDS);
        const got = pollinatorVisitSeconds(blooms, season.key);
        if (got !== expected) {
          problems.push(`pollinatorVisitSeconds(${blooms}, ${season.key}) gave ${got}s, expected ${expected}s.`);
        }
      }
    }

    // The closed form counts exactly what the schedule shows, across season
    // boundaries included, checked against an independent second-by-second
    // count of pollinatorAt.
    const bruteSeasonSeconds = (ageValue, span, blooms) => {
      let total = 0;
      for (let offset = 0; offset < span; offset += 1) {
        if (pollinatorAt(ageValue + offset + 0.5, 1, blooms).visiting) total += 1;
      }
      return total;
    };
    for (const [ageValue, span] of [
      [SEASON_SECONDS - 30, SEASON_SECONDS + 90],
      [SEASON_SECONDS * 2 - 5, SEASON_SECONDS * 2 + 50],
      [SEASON_SECONDS * 3 - 200, SEASON_SECONDS * 2],
      [0, SEASON_CYCLE_SECONDS],
    ]) {
      for (const blooms of [0, 4]) {
        const closed = pollinatorSecondsWithin(ageValue, span, blooms);
        const counted = bruteSeasonSeconds(ageValue, span, blooms);
        if (Math.abs(closed - counted) > 1e-6) {
          problems.push(
            `pollinatorSecondsWithin(${ageValue}, ${span}, ${blooms}) gave ${closed}s, but counting the schedule ` +
              `gave ${counted}s across the season boundary.`
          );
        }
      }
    }

    // No season drops the garden below its base rate, and a month in any season
    // lands where played time would: one step equals thirty daily steps.
    const DAY = 86400;
    for (const [key, ageValue] of atSeason) {
      const monthStart = { growth: 0, rate: 1, sprouts: [], bloomSprouts: [], plants: 3, beds: 1, age: ageValue };
      const oneStep = simulateGarden(monthStart, 30 * DAY);
      let stepped = { ...monthStart };
      for (let day = 0; day < 30; day += 1) stepped = simulateGarden(stepped, DAY);
      const tolerance = Math.max(1e-6, oneStep.growth * 1e-9);
      if (Math.abs(oneStep.growth - stepped.growth) > tolerance) {
        problems.push(
          `a month in ${key} in one step gave ${oneStep.growth} growth but thirty daily steps gave ` +
            `${stepped.growth}; a rehearsal must land where played time does.`
        );
      }
      if (oneStep.growth < 30 * DAY - tolerance) {
        problems.push(
          `a month in ${key} earned ${oneStep.growth} growth, below the plain ${30 * DAY} a first-season base ` +
            "rate of 1/s earns; no season may slow the garden below its base rate."
        );
      }
    }

    // The season and pollinator readouts and get-state state the year's effect
    // in numbers, season by season. The season row names the season and the
    // growth it gives the garden and leaves the pollinator's rhythm to the
    // pollinator row, which is the one place that schedule is stated.
    const seasonRow = document.querySelector('[data-field="season"]');
    const pollinatorRow = document.querySelector('[data-field="pollinator"]');
    if (!seasonRow) problems.push('the page has no season readout (expected [data-field="season"]).');
    if (!pollinatorRow) problems.push('the page has no pollinator readout (expected [data-field="pollinator"]).');
    setGarden({ seeds: 0, plants: 3 });
    for (const [key, ageValue] of atSeason) {
      setGrowth(0, 1, ageValue);
      const state = getDisplayedState();
      const cycle = pollinatorCycleSeconds(key);
      const baseVisit = pollinatorBaseVisitSeconds(key);
      if (state.season.key !== key || state.season.pollinatorCycleSeconds !== cycle) {
        problems.push(
          `at age ${ageValue}s get-state reports season ${JSON.stringify(state.season)}, expected ${key} with a ` +
            `${cycle}s pollinator cycle.`
        );
      }
      if (state.pollinator.seasonKey !== key || state.pollinator.cycleSeconds !== cycle) {
        problems.push(
          `at age ${ageValue}s get-state reports pollinator ${JSON.stringify(state.pollinator)}, expected the ` +
            `${key} cycle of ${cycle}s.`
        );
      }
      if (seasonRow) {
        const text = String(seasonRow.textContent);
        if (
          readoutFactValue(seasonRow, "Season") !== state.season.name ||
          readoutFactValue(seasonRow, "Growth") !== `x${state.season.multiplier}`
        ) {
          problems.push(
            `the season readout says ${JSON.stringify(text)}, expected a Season fact naming ${key} and a Growth ` +
              `fact of x${state.season.multiplier}.`
          );
        }
        const repeatsSchedule = readReadoutFacts(seasonRow).some((fact) =>
          fact.value.includes(formatDuration(cycle))
        );
        if (text.toLowerCase().includes("pollinator") || repeatsSchedule) {
          problems.push(
            `the season readout says ${JSON.stringify(text)}, expected it to leave the pollinator's schedule to ` +
              `the pollinator row rather than repeat ${formatDuration(cycle)}.`
          );
        }
      }
      if (pollinatorRow) {
        if (
          readoutFactValue(pollinatorRow, "Every") !== formatDuration(cycle) ||
          readoutFactValue(pollinatorRow, "Stays") !== formatDuration(baseVisit)
        ) {
          problems.push(
            `the pollinator readout says ${JSON.stringify(String(pollinatorRow.textContent))}, expected its Every ` +
              `fact to state the ${key} cycle ${formatDuration(cycle)} and its Stays fact the base visit ` +
              `${formatDuration(baseVisit)}.`
          );
        }
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The season cycle: a repeating four-season turn read from the garden's age,
 * each season growing the garden at least at its base rate and at least one
 * faster, and a return that crosses a boundary says so.
 */
function checkSeason(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    // The four seasons, in the order the cycle visits them.
    if (!Array.isArray(SEASONS) || SEASONS.length !== 4) {
      problems.push(`SEASONS should hold the four seasons, but it is ${JSON.stringify(SEASONS)}.`);
      return;
    }
    const keys = SEASONS.map((season) => season.key);
    if (keys.join(",") !== "winter,spring,summer,autumn") {
      problems.push(`the season cycle should run winter, spring, summer, autumn, but it is ${keys.join(", ")}.`);
    }
    let faster = 0;
    for (const season of SEASONS) {
      if (!(season.multiplier >= 1)) {
        problems.push(
          `the ${season.key} season grows at x${season.multiplier}; no season may grow slower than the base rate.`
        );
      }
      if (season.multiplier > 1) faster += 1;
    }
    if (faster < 1) {
      problems.push("every season grows at the base rate; at least one season must be more generous than the garden's normal rate.");
    }

    // The cycle turns on its own: each SEASON_SECONDS is the next season, and a
    // whole turn comes back to where it started.
    const atBoundary = [
      [0, "winter"],
      [SEASON_SECONDS - 1, "winter"],
      [SEASON_SECONDS, "spring"],
      [SEASON_SECONDS * 3, "autumn"],
      [SEASON_CYCLE_SECONDS, "winter"],
      [SEASON_CYCLE_SECONDS + SEASON_SECONDS, "spring"],
    ];
    for (const [ageValue, key] of atBoundary) {
      const season = seasonAt(ageValue);
      if (season.key !== key) {
        problems.push(`at age ${ageValue}s the garden should be in ${key}, but seasonAt reports ${season.key}.`);
      }
    }

    // The closed form must match an independent second-by-second count, a month
    // included, and never weigh a span below the plain span itself.
    const spans = [
      [0, 600],
      [SEASON_SECONDS - 1, 2],
      [SEASON_SECONDS, SEASON_SECONDS],
      [500, 200],
      [1234, 5000],
      [0, 30 * 86400],
    ];
    for (const [ageValue, span] of spans) {
      const closed = seasonMultiplierSecondsWithin(ageValue, span);
      const counted = seasonWeightSecondsByBruteForce(ageValue, span);
      const tolerance = Math.max(1e-6, span * 1e-9);
      if (Math.abs(closed - counted) > tolerance) {
        problems.push(
          `seasonMultiplierSecondsWithin(${ageValue}, ${span}) gave ${closed} weighted seconds, ` +
            `but counting the schedule gave ${counted}.`
        );
      }
      if (closed < span - tolerance) {
        problems.push(
          `seasonMultiplierSecondsWithin(${ageValue}, ${span}) gave ${closed}, less than the plain ${span}s; ` +
            "the multiplier must never drop below 1."
        );
      }
    }

    // The readout and get-state name the season and its multiplier.
    const row = document.querySelector('[data-field="season"]');
    if (!row) {
      problems.push('the page has no season readout (expected [data-field="season"]), so the season is not stated.');
    }
    setGarden({ seeds: 0, plants: 0 });
    setGrowth(0, 1, SEASON_SECONDS); // the first second of spring
    const springState = getDisplayedState();
    if (springState.season.key !== "spring" || springState.season.multiplier !== 1.5) {
      problems.push(
        `at age ${SEASON_SECONDS}s get-state reports season ${JSON.stringify(springState.season)}, ` +
          "expected spring at x1.5."
      );
    }
    if (springState.rate !== 1.5) {
      problems.push(`in spring the displayed rate is ${springState.rate}/s on a base of 1/s, expected 1.5/s.`);
    }
    if (row) {
      const text = String(row.textContent);
      if (text.includes(" · ")) {
        problems.push(
          `the season readout reads ${JSON.stringify(text)}, expected short labelled facts rather than a joined sentence.`
        );
      }
      if (readoutFactValue(row, "Season") !== "spring" || readoutFactValue(row, "Growth") !== "x1.5") {
        problems.push(
          `the spring season readout says ${JSON.stringify(text)}, expected a Season fact of spring and a Growth ` +
            "fact of x1.5."
        );
      }
    }

    // Each kind thrives in its own season: its own multiplier is its boost in
    // that season and the neutral 1 the rest of the year. The two kinds thrive
    // in different seasons, so the year moves which seed is worth planting.
    const bestSeasons = SEED_KINDS.map((kind) => kind.bestSeason);
    if (bestSeasons.filter(Boolean).length !== SEED_KINDS.length) {
      problems.push(`every seed kind needs a bestSeason, but they are ${JSON.stringify(bestSeasons)}.`);
    }
    if (new Set(bestSeasons).size < 2) {
      problems.push(
        `the kinds share a best season (${JSON.stringify(bestSeasons)}), so the year never changes which seed is ` +
          "worth planting."
      );
    }
    const kindSeasonCases = [
      [0, "spring", 2],
      [0, "summer", 1],
      [0, "winter", 1],
      [1, "summer", 2],
      [1, "spring", 1],
      [1, "autumn", 1],
    ];
    for (const [index, key, expected] of kindSeasonCases) {
      const got = kindSeasonMultiplier(index, key);
      if (got !== expected) {
        problems.push(
          `kindSeasonMultiplier(${index}, ${key}) is ${got}, expected ${expected}; a kind is only boosted in its ` +
            "best season and never below its base outside it."
        );
      }
    }

    const seasonAges = {
      winter: 0,
      spring: SEASON_SECONDS,
      summer: SEASON_SECONDS * 2,
      autumn: SEASON_SECONDS * 3,
    };
    const seasonMultiplierOf = (key) => SEASONS.find((season) => season.key === key).multiplier;

    // Measured with the kept rate at zero, so only a kind's own season term
    // shows and the pollinator (which multiplies that zero) contributes nothing.
    const kindSeasonEarn = (kindIndex, ageSeconds, spanSeconds) =>
      simulateGarden(
        {
          growth: 0,
          rate: 0,
          bonus: 0,
          plantCounts: kindIndex === 0 ? [1, 0] : [0, 1],
          beds: 1,
          age: ageSeconds,
        },
        spanSeconds
      ).growth;
    for (const [kindIndex, key] of [[0, "spring"], [1, "summer"]]) {
      const inBest = kindSeasonEarn(kindIndex, seasonAges[key], SEASON_SECONDS);
      const inWinter = kindSeasonEarn(kindIndex, seasonAges.winter, SEASON_SECONDS);
      if (!(inBest > inWinter)) {
        problems.push(
          `the ${SEED_KINDS[kindIndex].name} earns ${inBest} in ${key} but ${inWinter} in winter; its best season ` +
            "must earn it more."
        );
      }
    }
    const herbOutside = kindSeasonEarn(0, seasonAges.summer, SEASON_SECONDS);
    const bloomOutside = kindSeasonEarn(1, seasonAges.spring, SEASON_SECONDS);
    if (herbOutside !== 0 || bloomOutside !== 0) {
      problems.push(
        `a kind outside its best season added ${herbOutside} (herb, summer) / ${bloomOutside} (bloom, spring) on ` +
          "top of the shared rate, expected the neutral 0 — no season may slow a kind below its base."
      );
    }

    // The per-kind closed form matches an independent second-by-second count of
    // the kind's own schedule above the shared one, over a span crossing a
    // season boundary.
    const crossAge = SEASON_SECONDS - 100;
    const crossSpan = SEASON_SECONDS * 2;
    const herbClosed = kindSeasonEarn(0, crossAge, crossSpan);
    const herbCounted =
      SEED_KINDS[0].production *
      (kindSeasonWeightSecondsByBruteForce(0, crossAge, crossSpan) -
        seasonWeightSecondsByBruteForce(crossAge, crossSpan));
    const herbTolerance = Math.max(1e-6, herbCounted * 1e-9);
    if (Math.abs(herbClosed - herbCounted) > herbTolerance) {
      problems.push(
        `the herb's season term over ${crossSpan}s gave ${herbClosed} growth, but counting its schedule second by ` +
          `second gave ${herbCounted}.`
      );
    }

    // The displayed rate and each kind's seasonMultiplier follow the kind's own
    // season: boosted in its best season, the plain base outside it.
    setGarden({ seeds: 0, plantCounts: [1, 0], beds: 1 });
    setGrowth(0, SEED_KINDS[0].production, seasonAges.spring);
    const herbSpringState = getDisplayedState();
    const herbSpringMultipliers = herbSpringState.kinds.map((kind) => kind.seasonMultiplier);
    if (herbSpringMultipliers[0] !== 2 || herbSpringMultipliers[1] !== 1) {
      problems.push(
        `in spring the kinds report seasonMultiplier ${JSON.stringify(herbSpringMultipliers)}, expected herb 2 and bloom 1.`
      );
    }
    const herbSpringRate = SEED_KINDS[0].production * seasonMultiplierOf("spring") * 2;
    if (Math.abs(herbSpringState.rate - herbSpringRate) > 1e-9) {
      problems.push(
        `one herb in spring shows ${herbSpringState.rate}/s, expected its x2 boost on the season's ${herbSpringRate}/s.`
      );
    }
    if (row && readoutFactValue(row, "Favours") !== "herb x2") {
      problems.push(
        `the spring season readout says ${JSON.stringify(row.textContent)}, expected a Favours fact of herb x2.`
      );
    }

    setGarden({ seeds: 0, plantCounts: [0, 1], beds: 1 });
    setGrowth(0, SEED_KINDS[1].production, seasonAges.summer + 90); // outside the visit window
    const bloomSummerState = getDisplayedState();
    if (bloomSummerState.kinds[1].seasonMultiplier !== 2 || bloomSummerState.kinds[0].seasonMultiplier !== 1) {
      problems.push(
        `in summer the kinds report seasonMultiplier ${JSON.stringify(bloomSummerState.kinds.map((k) => k.seasonMultiplier))}, ` +
          "expected bloom 2 and herb 1."
      );
    }
    const bloomSummerRate = SEED_KINDS[1].production * seasonMultiplierOf("summer") * 2;
    if (Math.abs(bloomSummerState.rate - bloomSummerRate) > 1e-9) {
      problems.push(
        `one bloom in summer shows ${bloomSummerState.rate}/s, expected its x2 boost on the season's ${bloomSummerRate}/s.`
      );
    }
    if (row && readoutFactValue(row, "Favours") !== "bloom x2") {
      problems.push(
        `the summer season readout says ${JSON.stringify(row.textContent)}, expected a Favours fact of bloom x2.`
      );
    }

    // Outside its best season a kind is back to the plain base rate.
    setGarden({ seeds: 0, plantCounts: [1, 0], beds: 1 });
    setGrowth(0, SEED_KINDS[0].production, seasonAges.winter);
    const herbWinterState = getDisplayedState();
    if (herbWinterState.kinds[0].seasonMultiplier !== 1 || herbWinterState.rate !== SEED_KINDS[0].production) {
      problems.push(
        `a herb in winter reports multiplier ${herbWinterState.kinds[0].seasonMultiplier} and ${herbWinterState.rate}/s, ` +
          `expected the plain 1 and ${SEED_KINDS[0].production}/s.`
      );
    }

    // A return that crosses a season boundary reports both seasons, and names
    // the kind whose own growth changed with it.
    const away = buildAwayReport(
      { growth: 0, rate: 1, sprouts: [], plants: 0, beds: 1, age: SEASON_SECONDS - 100 },
      SEASON_SECONDS
    );
    if (!away.crossedSeason || away.fromSeason?.key !== "winter" || away.toSeason?.key !== "spring") {
      problems.push(
        `a return from winter across the boundary reported from ${away.fromSeason?.key} to ${away.toSeason?.key} ` +
          `(crossedSeason ${away.crossedSeason}); expected winter into spring.`
      );
    }
    if (!/winter/i.test(away.summary) || !/spring/i.test(away.summary)) {
      problems.push(`the return summary does not name the season it crossed: "${away.summary}"`);
    }
    if (!Array.isArray(away.seasonChangedKinds) || away.seasonChangedKinds.join(",") !== "herb") {
      problems.push(
        `a return from winter into spring reported seasonChangedKinds ${JSON.stringify(away.seasonChangedKinds)}, ` +
          "expected herb alone."
      );
    }
    if (!/herb/i.test(away.summary)) {
      problems.push(`the return summary does not name the kind whose growth changed: "${away.summary}"`);
    }

    // Spring into summer hands the boost from herb to bloom; the return names
    // bloom as the kind whose growth changed.
    const handover = buildAwayReport(
      { growth: 0, rate: 1, sprouts: [], plants: 0, beds: 1, age: SEASON_SECONDS * 2 - 100 },
      SEASON_SECONDS
    );
    if (handover.fromSeason?.key !== "spring" || handover.toSeason?.key !== "summer") {
      problems.push(
        `a return from spring across the boundary reported from ${handover.fromSeason?.key} to ${handover.toSeason?.key}, ` +
          "expected spring into summer."
      );
    }
    if (!(handover.seasonChangedKinds ?? []).includes("bloom")) {
      problems.push(
        `a return from spring into summer reported seasonChangedKinds ${JSON.stringify(handover.seasonChangedKinds)}, ` +
          "expected it to name bloom."
      );
    }
    if (!/bloom/i.test(handover.summary)) {
      problems.push(`the spring-into-summer return summary does not name bloom: "${handover.summary}"`);
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The rate the page shows is the slope the garden actually grows at.
 *
 * The displayed rate and `simulateGarden` work the same formula out in two
 * different words — the readout adds the season, each kind's own boost and the
 * pollinator's extra by hand, while the simulation integrates them — so a term
 * added to or dropped from the display side would ship silently and a visitor
 * would watch a rate their garden is not growing at. This measures the slope
 * the live garden earns over a short span and compares it with the rate the
 * page shows, across the states that exercise each layer: a kind in its best
 * season, a kind at a plant milestone, a garden carrying a lasting bonus, one
 * during a pollinator visit, and a combination of them.
 *
 * The span is asserted to sit inside one season and to keep the same visiting
 * status at both ends before anything is compared, so a boundary cannot make it
 * flaky, and it holds no ungrown seeds, so the plant counts — and the rate —
 * stay constant across it.
 */
function checkShownRateMatchesEarned(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    const spanSeconds = 5;
    // Each state names the layer it exercises, the plants it holds, the age it
    // sits at, the lasting bonus it carries and whether a pollinator must be
    // visiting across the whole span.
    const states = [
      { label: "a herb in its best season", plantCounts: [3, 0], age: 700, bonus: 0, visiting: false },
      { label: "a bloom in its best season", plantCounts: [0, 3], age: 1250, bonus: 0, visiting: false },
      { label: "a herb at its first milestone", plantCounts: [10, 0], age: 0, bonus: 0, visiting: false },
      { label: "a garden carrying a lasting bonus", plantCounts: [3, 2], age: 0, bonus: 4, visiting: false },
      { label: "a garden during a pollinator visit", plantCounts: [3, 0], age: 130, bonus: 0, visiting: true },
      {
        label: "a milestone kind in its best season, with a lasting bonus, during a pollinator visit",
        plantCounts: [10, 2],
        age: 750,
        bonus: 4,
        visiting: true,
      },
    ];
    for (const state of states) {
      const { label, plantCounts, age, bonus, visiting } = state;
      // No ungrown seeds: the plant counts, and so the rate, are constant
      // across the span, and the only thing that changes is the growth.
      setGarden({ seeds: 0, plantCounts, beds: 1 });
      setGrowth(0, 1, age, 0, bonus);
      const live = getGarden();
      const plants = live.plants;
      const blooms = live.plantCounts[1];
      const shown = getDisplayedState().rate;
      const startSeason = seasonAt(age);
      const endSeason = seasonAt(age + spanSeconds);
      if (startSeason.key !== endSeason.key) {
        problems.push(
          `the rate check for ${label} spans ${spanSeconds}s from age ${age} in ${startSeason.key} into ` +
            `${endSeason.key}; its span must sit inside one season.`
        );
        continue;
      }
      const startsVisiting = pollinatorAt(age, plants, blooms).visiting;
      const endsVisiting = pollinatorAt(age + spanSeconds, plants, blooms).visiting;
      if (startsVisiting !== visiting || endsVisiting !== visiting) {
        problems.push(
          `the rate check for ${label} expects a pollinator ${visiting ? "visiting" : "away"} across its ` +
            `${spanSeconds}s span, but it is ${startsVisiting ? "visiting" : "away"} at age ${age} and ` +
            `${endsVisiting ? "visiting" : "away"} at age ${age + spanSeconds}.`
        );
        continue;
      }
      const earned =
        simulateGarden(
          {
            growth: 0,
            // The simulation reads the kept rate — never the displayed one,
            // which already carries the season, each kind's boost and the
            // pollinator, and would count them twice.
            rate: getGrowthState().rate,
            bonus,
            plantCounts: live.plantCounts,
            beds: live.beds,
            age,
            sprouts: live.sprouts,
            bloomSprouts: live.bloomSprouts,
          },
          spanSeconds
        ).growth / spanSeconds;
      const tolerance = Math.max(1e-9, Math.abs(shown) * 1e-9);
      if (Math.abs(shown - earned) > tolerance) {
        problems.push(
          `the rate the page shows for ${label} is ${shown}/s, but the garden earned ${earned}/s over ` +
            `${spanSeconds}s (a difference of ${shown - earned}).`
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The plot is drawn in the season the state names, and every season looks
 * different from the others.
 *
 * The same planted garden is snapshotted at each season's own age, so the only
 * thing that varies between the four pictures is the season. Each snapshot is
 * taken at phase 0 — the still frame reduced motion pins to — so this also
 * proves a season change shows without the animation. The look the picture uses
 * is the state's own season, and the four seasons carry four distinct leaf
 * colours, so a visitor can tell the season from the garden itself.
 */
function checkSeasonDrawing(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    const palette = readPalette();
    // The first second of each season, in the order the cycle visits them.
    const seasons = SEASONS.map((season, index) => ({ key: season.key, age: index * SEASON_SECONDS + 1 }));
    const pictures = new Map();
    const leafColors = new Set();
    for (const { key, age } of seasons) {
      setGarden({ seeds: 0, plants: 6, beds: 1 });
      setGrowth(1e6, 1, age); // a grove, so the foliage is a whole canopy
      const state = getDisplayedState();
      if (state.season.key !== key) {
        problems.push(`at age ${age}s get-state reports season ${state.season.key}, expected ${key}.`);
      }
      pictures.set(key, plotImage(state));
      const look = seasonLook(palette, state.season.key);
      if (look.key !== state.season.key) {
        problems.push(
          `seasonLook() resolved ${state.season.key} to key ${look.key}, so the picture's season does not match the state's.`
        );
      }
      leafColors.add(look.palette.leaf);
      // The readout the visitor reads must name the season the picture draws.
      const row = document.querySelector('[data-field="season"]');
      if (row && !String(row.textContent).toLowerCase().includes(state.season.name)) {
        problems.push(
          `the plot draws ${state.season.name} but the season readout says ${JSON.stringify(row.textContent)}.`
        );
      }
    }

    for (let i = 0; i < seasons.length; i += 1) {
      for (let j = i + 1; j < seasons.length; j += 1) {
        const a = seasons[i].key;
        const b = seasons[j].key;
        if (pictures.get(a) === pictures.get(b)) {
          problems.push(
            `the plot draws the same picture in ${a} and ${b}, so the season is not visible on the garden itself.`
          );
        }
      }
    }
    if (leafColors.size !== SEASONS.length) {
      problems.push(
        `the ${SEASONS.length} seasons draw ${leafColors.size} distinct leaf colours, expected ${SEASONS.length}; ` +
          "each season must have its own foliage."
      );
    }
    // An unknown season must fall back to the base garden rather than to a
    // season it did not find, so a state that never knew about seasons is drawn.
    const unknown = seasonLook(palette, "nonexistent");
    if (unknown.key !== null || unknown.palette.leaf !== palette.leaf) {
      problems.push("seasonLook() invented a look for an unknown season instead of falling back to the base colours.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The ground itself wears the season: with nothing grown — bare soil or a single
 * ungrown seed — every season draws a plot a visitor can tell apart without
 * reading a number, from the soil's own tone and a small still seasonal mark.
 *
 * The tone and the mark come from the palette and are keyed on the season the
 * readout, the sr-only plot description and `get-state` all name, and they read
 * no animation phase, so the ground is a still frame under reduced motion. The
 * pixel comparison is deliberately far above the few per cent a hash-shuffled
 * soil mark moved before this: a revert that fills the plot with one base soil
 * colour in every season fails it.
 */
function checkSeasonalGround(problems) {
  const palette = readPalette();
  const seasons = SEASONS.map((season) => season.key);
  const looks = new Map(seasons.map((key) => [key, seasonLook(palette, key)]));

  // Each season has its own ground trio. The whole plot is filled with the
  // season's soil tone, so four identical trios would draw four identical
  // grounds; and every tone must be a colour declared in the page palette.
  const tokens = new Set(paletteTokens().values());
  for (const field of ["soil", "soilDeep", "soilLight"]) {
    const tones = new Set(seasons.map((key) => String(looks.get(key).palette[field])));
    if (tones.size !== seasons.length) {
      problems.push(
        `the ${seasons.length} seasons resolve to ${tones.size} distinct ground ${field} tones, expected ` +
          `${seasons.length}; the ground must change with the garden's year.`
      );
    }
    for (const key of seasons) {
      const value = looks.get(key).palette[field];
      const color = parseColor(value);
      if (!color || !tokens.has(colorKey(color))) {
        problems.push(
          `the ${key} ground's ${field} (${value}) is not a colour declared in the page palette, so the ground ` +
            "does not belong to the same garden as the panels around it."
        );
      }
    }
  }
  // An unknown season must not invent ground: it stays the base soil.
  const unknown = seasonLook(palette, "nonexistent");
  if (unknown.palette.soil !== palette.soil) {
    problems.push("seasonLook() invented a ground tone for an unknown season instead of the base soil.");
  }

  const state = (key, extra) => ({
    growth: 0,
    beds: 1,
    pollinator: { visiting: false },
    season: { key },
    ...extra,
  });
  // Bare soil and a single ungrown seed: the moment a visitor most needs the
  // picture to say the season, because no plant carries it yet. The third entry
  // of each scene is the cell a growing thing stands on, which is allowed to
  // sway; every other cell is ground and must hold still.
  const scenes = [
    ["bare soil", { seeds: 0, plants: 0 }, new Set()],
    ["one ungrown seed", { seeds: 1, plants: 0 }, new Set([0])],
  ];
  for (const [label, extra, moving] of scenes) {
    const canvases = new Map(seasons.map((key) => [key, plotCanvas(state(key, extra))]));
    for (let i = 0; i < seasons.length; i += 1) {
      for (let j = i + 1; j < seasons.length; j += 1) {
        const share = differingPixelShare(canvases.get(seasons[i]), canvases.get(seasons[j]));
        if (share < 0.3) {
          problems.push(
            `a ${label} plot differs by only ${Math.round(share * 100)}% of its pixels between ${seasons[i]} and ` +
              `${seasons[j]}; the ground must read its season at a glance (at least 30%).`
          );
        }
      }
    }
    // The ground is a still frame: nothing about the seasonal mark moves.
    const bounds = plotBounds(state(seasons[0], extra));
    for (const key of seasons) {
      const moved = changedPixelCells(
        canvases.get(key),
        plotCanvas(state(key, extra), 1),
        bounds.cell,
        bounds.columns
      );
      const stray = [...moved].filter((cell) => !moving.has(cell));
      if (stray.length > 0) {
        problems.push(
          `a ${label} plot in ${key} moved on ground cell(s) ${stray.join(", ")} between phase 0 and phase 1, so ` +
            "the seasonal ground does not hold still under reduced motion."
        );
      }
    }
  }

  // The words beside the picture name the same season the ground draws.
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  try {
    for (const [index, season] of SEASONS.entries()) {
      setGarden({ seeds: 1, plants: 0, beds: 1 });
      setGrowth(0, 1, index * SEASON_SECONDS + 1);
      const shown = getDisplayedState();
      const look = seasonLook(palette, shown.season.key);
      if (look.key !== season.key) {
        problems.push(
          `seasonLook() resolved ${shown.season.key} to ${look.key}, so the season the ground draws is not the ` +
            "season the state names."
        );
      }
      const description = document.getElementById("plot-description");
      if (!description) {
        problems.push("the page has no sr-only plot description (#plot-description) to name the drawn season.");
      } else if (!String(description.textContent).toLowerCase().includes(season.name)) {
        problems.push(
          `the plot draws ${season.name} on the ground but its description says ` +
            `${JSON.stringify(description.textContent)}.`
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * A long absence lands the garden where played time would, and its return is
 * stated in words and shown on the plot.
 */
function checkReturnSummary(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const DAY = 86400;
  const canvas = document.getElementById("garden-plot");
  const strip = document.getElementById("return-summary");
  if (!strip) {
    problems.push("the page has no return-summary element (#return-summary) to say what happened while away.");
  }
  try {
    // A full bed of 12 plots (2 ungrown seeds and 10 grown plants): time away
    // has nowhere to sow, so this isolates the growth the absence earns from
    // what it would plant if there were room.
    const saved = { version: SAVE_VERSION, seeds: 2, plants: 10, growth: 0, rate: 0.5 };
    setGarden({ seeds: 2, plants: 10 });
    setGrowth(saved.growth, saved.rate);
    const beforeImage = canvas ? canvas.toDataURL() : null;

    const nowMs = 1_700_000_000_000;
    const away = applyReturn(saved, nowMs - 30 * DAY * 1000, nowMs);

    // The 2 seeds mature after GROW_SECONDS, so the garden earns the old rate for
    // that short while and the higher rate (each plant adding 0.5/s) for the rest.
    // A pollinator visits once there is a grown plant, and its visit is worth an
    // extra rate for every second it is on the plot (see pollinatorSecondsWithin),
    // so the expected total adds those verified seconds at each rate. A bed of 10
    // grown plants has already reached the herb kind's first milestone, so its
    // output is doubled — the boost is part of the rate each stretch earns at, and
    // it is lifted again when the two seeds mature into a twelfth plant.
    const visitSecondsEarly = pollinatorSecondsWithin(0, GROW_SECONDS);
    const visitSecondsRest = pollinatorSecondsWithin(GROW_SECONDS, 30 * DAY - GROW_SECONDS);
    // Each stretch weighs its seconds by the season they fall in, the same way
    // the simulation does, on top of the pollinator's extra seconds.
    const seasonEarly = seasonWeightSecondsByBruteForce(0, GROW_SECONDS);
    const seasonRest = seasonWeightSecondsByBruteForce(GROW_SECONDS, 30 * DAY - GROW_SECONDS);
    // Every plant is herb, and the year lifts herb above the shared rate in
    // spring, so the rest stretch is counted on the herb's own schedule as well
    // as the shared one. The early stretch is winter, where herb keeps the
    // shared rate, so its own correction adds nothing there.
    const herbWeightedEarly = kindSeasonWeightSecondsByBruteForce(0, 0, GROW_SECONDS);
    const herbWeightedRest = kindSeasonWeightSecondsByBruteForce(0, GROW_SECONDS, 30 * DAY - GROW_SECONDS);
    const earlyPlants = 10; // the full bed's grown plants before its 2 seeds mature
    const latePlants = earlyPlants + 2;
    const earlyRate = 0.5;
    const lateRate = earlyRate + 2 * PLANT_PRODUCTION;
    const earlyMultiplier = kindMilestoneMultiplier(0, earlyPlants);
    const lateMultiplier = kindMilestoneMultiplier(0, latePlants);
    const earlyBoost = earlyPlants * PLANT_PRODUCTION * (earlyMultiplier - 1);
    const lateBoost = latePlants * PLANT_PRODUCTION * (lateMultiplier - 1);
    const expectedEarned =
      (earlyRate + earlyBoost) * (seasonEarly + (POLLINATOR_BOOST - 1) * visitSecondsEarly) +
      earlyPlants * PLANT_PRODUCTION * earlyMultiplier * (herbWeightedEarly - seasonEarly) +
      (lateRate + lateBoost) * (seasonRest + (POLLINATOR_BOOST - 1) * visitSecondsRest) +
      latePlants * PLANT_PRODUCTION * lateMultiplier * (herbWeightedRest - seasonRest);
    const tolerance = Math.max(1e-6, expectedEarned * 1e-9);
    if (Math.abs(away.earned - expectedEarned) > tolerance) {
      problems.push(`after 30 days away the garden earned ${away.earned} growth, expected ${expectedEarned}.`);
    }
    if (away.matured !== 2) {
      problems.push(`after 30 days away ${away.matured} seeds had matured, expected the garden's 2.`);
    }
    const after = getGrowthState();
    if (Math.abs(after.growth - expectedEarned) > tolerance) {
      problems.push(`after 30 days away the garden holds ${after.growth} growth, expected ${expectedEarned}.`);
    }
    const expectedForm = gardenForm(expectedEarned);
    if (away.to !== expectedForm.index) {
      problems.push(
        `after 30 days away the garden is form ${away.to}, expected ${expectedForm.index} ("${expectedForm.name}").`
      );
    }
    if (!(away.to > away.from)) {
      problems.push(`30 days away did not advance the garden's form (still ${away.from}).`);
    }
    if (away.summary !== summarizeReturn(away)) {
      problems.push("the return summary is not the sentence summarizeReturn builds from the same report.");
    }

    if (strip) {
      if (strip.hidden) {
        problems.push("returning after 30 days did not show the return summary.");
      }
      const facts = readGoalFacts(strip);
      const expectedFacts = returnFacts(away);
      if (JSON.stringify(facts) !== JSON.stringify(expectedFacts)) {
        problems.push(
          `the return block shows ${JSON.stringify(facts)}, expected the report's short labelled facts ` +
            `${JSON.stringify(expectedFacts)}.`
        );
      }
      if (!goalFactsAreOnlyContent(strip)) {
        problems.push("the return block carries prose beside its labelled facts instead of only the facts.");
      }
      for (const fact of facts) {
        if (!fact.label.trim() || !fact.value.trim()) {
          problems.push(`the return block has a fact with an empty label or value: ${JSON.stringify(fact)}.`);
        }
      }
      const earned = facts.find((fact) => fact.label === "Earned");
      if (!earned || !earned.value.includes(formatGrowth(away.earned))) {
        problems.push(`the return block does not state the growth earned while away (${formatGrowth(away.earned)}).`);
      }
      const now = facts.find((fact) => fact.label === "Now");
      if (!now || now.value !== expectedForm.name) {
        problems.push(`the return block does not state the form reached (${expectedForm.name}).`);
      }
      const next = facts.find((fact) => fact.label === "Next");
      const nextIndex = expectedForm.index + 1;
      if (nextIndex < FORMS.length && (!next || !next.value.includes(FORMS[nextIndex].name))) {
        problems.push(`the return block does not state the next form (${FORMS[nextIndex].name}).`);
      }
    }

    if (canvas && beforeImage && canvas.toDataURL() === beforeImage) {
      problems.push("the plot drew the same picture after 30 days away, so the return did not show on the garden.");
    }

    const shown = getDisplayedState();
    if (JSON.stringify(shown.away) !== JSON.stringify(away)) {
      problems.push("get-state's away does not match the return the page just reported.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The return's facts sit beside the numbers, never over the garden: the drawn
 * plot, the season the absence turned to and the next goal it names all share a
 * phone's first screen, and every fact the return reported is still on the page
 * as a labelled value and still exposed by `get-state`.
 */
function checkReturnSummaryPlacement(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const strip = document.getElementById("return-summary");
  const plot = document.getElementById("garden-plot");
  const side = document.querySelector(".garden-side");
  const stripHiddenBefore = strip ? strip.hidden : null;
  const stripHtmlBefore = strip ? strip.innerHTML : null;
  // A 390x844 phone's first screen, in document coordinates so the window the
  // suite happens to run in cannot hide something that fell off the page.
  const FIRST_SCREEN_PX = 844;
  const DAY = 86400;

  try {
    if (!strip || !plot || !side) {
      problems.push(
        "the return's placement cannot be checked: the page needs #return-summary, #garden-plot and a .garden-side."
      );
      return;
    }

    // The garden comes first: the return's facts belong to the numbers column
    // and follow the plot in the document, never as a block over the picture.
    if (!side.contains(strip)) {
      problems.push(
        "the return's facts are not in the numbers column (.garden-side), so they still stand over the garden."
      );
    }
    const precedes = (first, second) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (precedes(strip, plot)) {
      problems.push(
        "the return's facts precede the drawn garden in the document, so a visitor reads them before the picture."
      );
    }

    // A real return fills the panel with the report's own labelled facts.
    const saved = { version: SAVE_VERSION, seeds: 2, plants: 1, growth: 0, rate: 0.5 };
    setGarden({ seeds: 2, plants: 1 });
    setGrowth(saved.growth, saved.rate);
    const nowMs = 1_700_000_000_000;
    const away = applyReturn(saved, nowMs - 30 * DAY * 1000, nowMs);

    const expected = returnFacts(away);
    const shown = readGoalFacts(strip);
    if (JSON.stringify(shown) !== JSON.stringify(expected)) {
      problems.push(
        `the return's panel shows ${JSON.stringify(shown)}, expected the report's short labelled facts ` +
          `${JSON.stringify(expected)}.`
      );
    }
    // Every fact the return reported is still present: what it earned and the
    // next goal it names always, and the season whenever the absence crossed one.
    for (const label of ["Earned", "Next"]) {
      if (!shown.some((fact) => fact.label === label)) {
        problems.push(
          `the return's panel does not state its "${label}" fact, so the page drops something the return reported.`
        );
      }
    }
    if (away.crossedSeason !== shown.some((fact) => fact.label === "Season")) {
      problems.push(
        away.crossedSeason
          ? "the return crossed a season but its panel does not say which."
          : "the return's panel states a season change the report did not make."
      );
    }

    // The plot and the return's own season and next goal share the first
    // screen: the facts start below the picture and, on a phone, end within it.
    const bounds = (el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
    };
    const stripBox = bounds(strip);
    const plotBox = bounds(plot);
    if (strip.hidden) {
      problems.push("returning after 30 days did not show the return's facts beside the numbers.");
    } else {
      if (stripBox.top < plotBox.top - 1) {
        problems.push(
          `the return's facts start at ${Math.round(stripBox.top)}px, above the drawn garden at ` +
            `${Math.round(plotBox.top)}px, so the garden is no longer the first thing on the page.`
        );
      }
      if (window.innerWidth < 760 && stripBox.bottom > FIRST_SCREEN_PX) {
        problems.push(
          `the return's facts end at ${Math.round(stripBox.bottom)}px, past the ${FIRST_SCREEN_PX}px first screen, so a ` +
            "returning visitor cannot see the season and next goal without scrolling."
        );
      }
    }

    // `get-state` still exposes every fact the panel shows.
    const facts = getDisplayedState().away?.facts ?? [];
    if (JSON.stringify(facts) !== JSON.stringify(expected)) {
      problems.push(
        `get-state's away.facts ${JSON.stringify(facts)} do not match the return's panel ${JSON.stringify(expected)}.`
      );
    }
  } finally {
    clearReturnMarks();
    if (strip) {
      strip.innerHTML = stripHtmlBefore ?? "";
      strip.hidden = stripHiddenBefore ?? true;
    }
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * Time away sows: an absence spends its earned growth on the cheapest seed in
 * every free plot and lets those seeds grow, so a return finds a taller garden
 * rather than an enormous number beside one plant — while a garden whose plots
 * are already full just keeps banking and still reaches for the next bed.
 *
 * The balance identity is the promise: `growth on return` is `growth left`
 * plus the gross earned less exactly what the sown seeds cost.
 */
function checkAwaySowing(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const DAY = 86400;
  try {
    // A long absence with free plots sows and matures: more grown plants than
    // it left, with the sown seeds paid for out of the growth.
    const start = { growth: 0, rate: 0.5, sprouts: [GROW_SECONDS], plants: 1, beds: 1 };
    const away = buildAwayReport(start, 30 * DAY);
    const after = simulateGarden(start, 30 * DAY, { sow: true });
    if (!(away.sown > 0)) {
      problems.push(
        `30 days away with 10 free plots sowed ${away.sown} seeds; an absence should sow the seeds it can afford.`
      );
    }
    if (!(away.matured > 0)) {
      problems.push(`30 days away sowed seeds but matured ${away.matured}; the sown seeds should grow.`);
    }
    if (!(after.plants > start.plants)) {
      problems.push(
        `30 days away left ${after.plants} grown plants where ${start.plants} stood; the absence should grow more.`
      );
    }
    if (!(after.sprouts.length + after.plants > start.sprouts.length + start.plants)) {
      problems.push(
        `30 days away kept the garden at ${after.sprouts.length} seeds / ${after.plants} plants; the absence ` +
          "should sow into its free plots."
      );
    }
    // Only the cheapest kind is sown, so choosing a bloom stays the player's.
    if (after.plantCounts[1] !== 0 || after.bloomSprouts.length !== 0) {
      problems.push(
        `time away sowed blooms (${after.plantCounts[1]} grown / ${after.bloomSprouts.length} growing); ` +
          "only herb should be sown."
      );
    }
    // The sown seeds are paid for out of the growth: the balance on return is
    // the start plus the gross earned less exactly their cost.
    const identity = start.growth + away.earned - away.sownCost;
    const tolerance = Math.max(1e-6, Math.abs(identity) * 1e-9);
    if (Math.abs(away.growth - identity) > tolerance) {
      problems.push(
        `after sowing, the garden holds ${away.growth} growth but ${start.growth} start + ${away.earned} earned - ` +
          `${away.sownCost} sown = ${identity}; the sown seeds must be paid out of the balance.`
      );
    }
    if (!(away.growth < away.earned)) {
      problems.push(
        `after sowing, the balance ${away.growth} is not below the ${away.earned} the absence earned, so nothing was spent.`
      );
    }
    // The return account names both what was sown and what matured.
    if (!/sow/i.test(away.summary) || !away.summary.includes(formatAmount(away.sown))) {
      problems.push(`the return summary does not name the ${away.sown} seeds sown while away: "${away.summary}"`);
    }
    if (!away.summary.includes(formatAmount(away.matured))) {
      problems.push(`the return summary does not name the ${away.matured} seeds that matured: "${away.summary}"`);
    }

    // The reported symptom: an hour away from a bed of grown plants and no
    // ungrown seeds must find several plants where one stood, not the same one
    // plant beside an enormous number.
    const grownStart = { growth: 0, rate: 0.5, sprouts: [], plants: 1, beds: 1 };
    const grownAfter = simulateGarden(grownStart, 3600, { sow: true });
    if (!(grownAfter.plants > grownStart.plants + 1)) {
      problems.push(
        `an hour away from ${grownStart.plants} grown plant and no ungrown seeds left ${grownAfter.plants} ` +
          "plants; the absence should sow seeds that grow into several plants."
      );
    }

    // A short absence still leaves more ungrown seeds than it started with: the
    // balance it earned at the very end buys the seeds it can.
    const shortStart = { growth: 0, rate: 1, sprouts: [], plants: 4, beds: 1 };
    const shortAway = buildAwayReport(shortStart, 30);
    const shortAfter = simulateGarden(shortStart, 30, { sow: true });
    if (!(shortAfter.sprouts.length > shortStart.sprouts.length)) {
      problems.push(
        `a 30-second absence left ${shortAfter.sprouts.length} ungrown seeds where ${shortStart.sprouts.length} ` +
          "stood; it should sow the seeds it can afford."
      );
    }
    if (!(shortAway.sown > 0)) {
      problems.push(`a 30-second absence sowed ${shortAway.sown} seeds; it had free plots and growth to sow with.`);
    }

    // A garden whose plots are already full is unchanged: nothing is sown,
    // nothing is spent, and the next bed is still the goal.
    setGarden({ seeds: 0, plants: PLOTS_PER_BED, beds: 1 });
    setGrowth(0, 0.5);
    const fullStart = { growth: 0, rate: 0.5, sprouts: [], plantCounts: [PLOTS_PER_BED, 0], beds: 1 };
    const fullAway = buildAwayReport(fullStart, 30 * DAY);
    if (fullAway.sown !== 0 || fullAway.sownCost !== 0) {
      problems.push(
        `a full garden sowed ${fullAway.sown} seeds for ${fullAway.sownCost} growth; a full plot must sow nothing.`
      );
    }
    if (fullAway.matured !== 0) {
      problems.push(`a full garden matured ${fullAway.matured} seeds; it had none to grow.`);
    }
    const fullAfter = simulateGarden(fullStart, 30 * DAY, { sow: true });
    if (fullAfter.plants !== PLOTS_PER_BED || fullAfter.sprouts.length !== 0) {
      problems.push(
        `a full garden became ${fullAfter.sprouts.length} seeds / ${fullAfter.plants} plants over time away; ` +
          `it should stay full with ${PLOTS_PER_BED} plants.`
      );
    }
    openSandbox();
    fastForwardSandbox(30 * DAY);
    const fullGoal = getSandboxState().goalTitle;
    resetSandbox();
    if (!/bed/i.test(fullGoal)) {
      problems.push(`after a full-bed absence the goal is ${JSON.stringify(fullGoal)}, expected the next bed.`);
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * What a return marks on the garden: only a real absence marks anything, the
 * marks say what grew, they show on the plot and in the readout and in
 * `get-state`, and acting on the garden clears them.
 */
function checkReturnMarks(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const DAY = 86400;
  const row = document.getElementById("return-marks-row");
  const field = document.querySelector('[data-field="return-marks"]');
  const dismiss = document.getElementById("dismiss-return");
  if (!row || !field) {
    problems.push(
      'the page has no return-marks readout row (#return-marks-row / [data-field="return-marks"]).'
    );
  }
  // A return is acknowledged by a visible, keyboard-reachable press, not only by
  // acting on the garden — the button is the visitor's way out when they have
  // seen what the absence grew and do not want to act yet.
  if (!dismiss || dismiss.tagName.toLowerCase() !== "button") {
    problems.push(
      "the page has no dismiss-return button, so a visitor cannot acknowledge the return notice without acting on the garden."
    );
  } else {
    if (dismiss.disabled) {
      problems.push("the dismiss-return control is disabled, so a visitor cannot press it.");
    }
    if (!dismiss.textContent.trim()) {
      problems.push("the dismiss-return button has no visible label saying what it dismisses.");
    }
    if (row && !row.contains(dismiss)) {
      problems.push(
        "the dismiss-return button is outside the New since you left row, so it is not shown beside the marks it clears."
      );
    }
  }
  try {
    // A first visit or a quick reload marks nothing, even if a seed matured in
    // the few seconds: only an absence past the threshold is worth a mark.
    const start = { growth: 0, rate: 0.5, sprouts: [GROW_SECONDS], plants: 0, beds: 1 };
    const none = [
      ["a first visit", buildAwayReport(start, 0)],
      ["a 30-second reload", buildAwayReport(start, 30)],
    ];
    for (const [label, away] of none) {
      if (returnMarkFor(away, MIN_AWAY_SECONDS) !== null) {
        problems.push(`${label} left return marks on the garden; only a real absence should.`);
      }
    }

    // A month away matures the garden's seeds and reaches a new form.
    const saved = { version: SAVE_VERSION, seeds: 2, plants: 1, growth: 0, rate: 0.5 };
    setGarden({ seeds: 2, plants: 1 });
    setGrowth(saved.growth, saved.rate);
    const nowMs = 1_700_000_000_000;
    // A return must never schedule its own clearing: the marks stay until the
    // visitor acknowledges them. Watch every timer the return arms and fail if
    // any of them would clear the marks.
    const originalSetTimeout = window.setTimeout;
    const armed = [];
    window.setTimeout = function captureTimeout(handler, ...rest) {
      armed.push(handler);
      return originalSetTimeout.call(window, handler, ...rest);
    };
    let away;
    try {
      away = applyReturn(saved, nowMs - 30 * DAY * 1000, nowMs);
    } finally {
      window.setTimeout = originalSetTimeout;
    }
    if (armed.some((handler) => handler === clearReturnMarks || String(handler).includes("clearReturnMarks"))) {
      problems.push(
        "a 30-day return armed a timer to clear its marks, so they vanish on their own instead of waiting for the visitor to acknowledge them."
      );
    }
    const marks = returnMarkFor(away, MIN_AWAY_SECONDS);
    if (!marks) {
      problems.push("a 30-day return marked nothing; the matured seeds and the new form should be marked.");
    } else {
      if (marks.plants !== away.matured || marks.plants < 1) {
        problems.push(`a 30-day return marked ${marks.plants} plants, expected the ${away.matured} it matured.`);
      }
      if (!marks.form || away.formsFound.length === 0) {
        problems.push("a 30-day return reached new forms but did not mark one.");
      }
    }

    // The page says what it marked, and `get-state` returns the same thing.
    const shown = getDisplayedState();
    if (JSON.stringify(shown.returnMarks) !== JSON.stringify(marks)) {
      problems.push(
        `get-state's returnMarks ${JSON.stringify(shown.returnMarks)} does not match the return's ` +
          `${JSON.stringify(marks)}.`
      );
    }
    if (row && field) {
      if (row.hidden || !field.textContent.trim()) {
        problems.push("the return did not show the New since you left readout row.");
      } else if (marks && !field.textContent.includes(formatAmount(marks.plants))) {
        problems.push(
          `the return readout does not state the ${marks.plants} matured plants: "${field.textContent}".`
        );
      }
    }

    // The marks land on the plot, on the newest plants it draws, and they make
    // the picture differ from the same garden unmarked.
    const bounds = plotBounds(shown);
    const cells = returnMarkCells(shown, bounds);
    if (marks && (!cells.form || cells.cells.length !== marks.plants)) {
      problems.push(
        `returnMarkCells gave ${cells.cells.length} cells / form ${cells.form}, expected ` +
          `${marks.plants} / true for a 30-day return.`
      );
    }
    const unmarked = { ...shown, returnMarks: null };
    if (marks && plotImage(shown, 0) === plotImage(unmarked, 0)) {
      problems.push("the plot drew the same picture with and without the return marks, so the growth did not show on it.");
    }

    // The dismiss control acknowledges the return without touching the garden,
    // clearing the marks, the readout and the plot together.
    dismiss?.click();
    const dismissed = getDisplayedState();
    if (dismissed.returnMarks !== null) {
      problems.push(
        `the dismiss-return control left returnMarks ${JSON.stringify(dismissed.returnMarks)}; dismissing must clear them.`
      );
    }
    if (row && !row.hidden) {
      problems.push("the dismiss-return control left the New since you left row showing.");
    }

    // Acting on the garden acknowledges the return too, so dismissing is not
    // the only way out. Put a return back and tend the soil.
    applyReturn(saved, nowMs - 30 * DAY * 1000, nowMs);
    if (getDisplayedState().returnMarks === null) {
      problems.push("a second 30-day return marked nothing, so the action-clears-the-marks check could not run.");
    }
    document.getElementById("tend")?.click();
    const cleared = getDisplayedState();
    if (cleared.returnMarks !== null) {
      problems.push(`Tending the soil left returnMarks ${JSON.stringify(cleared.returnMarks)}; an action must clear them.`);
    }
    if (row && !row.hidden) {
      problems.push("Tending the soil left the New since you left row showing.");
    }

    // An absence that only crossed a season boundary — a ten-minute season
    // lands in almost any real gap — matured no seed and reached no new form,
    // and the garden's growth changed with the turn all the same. It must
    // leave a mark of its own: drawn on the plot, named in the readout and
    // reported by get-state.
    setGarden({ seeds: 0, plants: 0 });
    setGrowth(0, 0, SEASON_SECONDS - 1);
    const seasonAway = applyReturn(
      {
        growth: 0,
        rate: 0,
        age: SEASON_SECONDS - 1,
        sprouts: [],
        bloomSprouts: [],
        plants: 0,
        plantCounts: [0, 0],
        beds: 1,
      },
      nowMs - MIN_AWAY_SECONDS * 1000,
      nowMs
    );
    const seasonMarks = returnMarkFor(seasonAway, MIN_AWAY_SECONDS);
    if (seasonAway.matured !== 0 || seasonAway.formsFound.length !== 0 || !seasonAway.crossedSeason) {
      problems.push(
        `the season-only absence matured ${seasonAway.matured} seeds, reached ` +
          `${seasonAway.formsFound.length} new forms and crossed a season ${seasonAway.crossedSeason}, ` +
          "so it does not exercise a return whose only change was the year turning."
      );
    }
    if (!seasonMarks) {
      problems.push(
        "an absence that only crossed a season boundary marked nothing; the year turning is a change of its own."
      );
    } else {
      if (seasonMarks.plants !== 0) {
        problems.push(`the season-only return marked ${seasonMarks.plants} plants, expected none.`);
      }
      if (seasonMarks.form) {
        problems.push("the season-only return marked a new form, but the garden reached none.");
      }
      if (!seasonMarks.season || seasonMarks.season.to !== seasonAway.toSeason.name) {
        problems.push(
          `a season-crossing absence marked ${JSON.stringify(seasonMarks.season)}, expected the season it ` +
            `turned into (${seasonAway.toSeason.name}).`
        );
      }
    }

    // get-state says exactly what the plot draws, and the readout row stays up
    // naming the season until the visitor acknowledges it.
    const seasonShown = getDisplayedState();
    if (JSON.stringify(seasonShown.returnMarks) !== JSON.stringify(seasonMarks)) {
      problems.push(
        `get-state's returnMarks ${JSON.stringify(seasonShown.returnMarks)} does not name the season turn ` +
          `${JSON.stringify(seasonMarks)}.`
      );
    }
    if (seasonShown.returnMarks?.season?.to !== seasonAway.toSeason.name) {
      problems.push(
        `get-state's returnMarks season is ${JSON.stringify(seasonShown.returnMarks?.season)}, expected ` +
          `${seasonAway.toSeason.name}.`
      );
    }
    if (row && field) {
      if (row.hidden) {
        problems.push("a season-crossing absence left the New since you left row hidden.");
      } else if (!field.textContent.includes(seasonAway.toSeason.name)) {
        problems.push(
          `the return readout does not name the season the garden turned into ` +
            `(${seasonAway.toSeason.name}): "${field.textContent}".`
        );
      }
    }
    const seasonCells = returnMarkCells(seasonShown, plotBounds(seasonShown));
    if (!seasonCells.season || seasonCells.cells.length > 0 || seasonCells.form) {
      problems.push(
        `returnMarkCells gave ${JSON.stringify(seasonCells)} for a season-only return, expected the season mark alone.`
      );
    }

    // The mark reaches the picture, and it is a mark of its own: the season
    // alone draws something the unmarked garden does not, and something
    // different from a matured-plant tick or a new-form frame.
    const seasonPlot = plotImage(seasonShown, 0);
    if (seasonPlot === plotImage({ ...seasonShown, returnMarks: null }, 0)) {
      problems.push("the plot drew the same picture with and without a season mark, so the year turning did not show on it.");
    }
    // A plant standing on the plot, so the per-plant tick has a cell to land on
    // and the two marks can be compared rather than both being absent.
    const planted = { ...seasonShown, plants: 1, plantCounts: [1, 0] };
    const plantedSeason = { ...planted, returnMarks: { plants: 0, form: false, season: { from: "winter", to: "spring" } } };
    const plantedTick = { ...planted, returnMarks: { plants: 1, form: false, season: null } };
    const plantedForm = { ...planted, returnMarks: { plants: 0, form: true, season: null } };
    if (plotImage(plantedSeason, 0) === plotImage(plantedTick, 0)) {
      problems.push("the plot drew a season turn exactly as it draws a matured plant, so the two marks cannot be told apart.");
    }
    if (plotImage(plantedSeason, 0) === plotImage(plantedForm, 0)) {
      problems.push("the plot drew a season turn exactly as it draws a new form, so the two marks cannot be told apart.");
    }
    if (seasonPlot !== plotImage(seasonShown, 1)) {
      problems.push("the season mark moved between animation phases, so it does not hold under reduced motion.");
    }

    // The same acknowledgement clears it: the dismiss control, like a garden
    // action, takes the season mark with the rest.
    dismiss?.click();
    const seasonDismissed = getDisplayedState();
    if (seasonDismissed.returnMarks !== null) {
      problems.push(
        `the dismiss-return control left a season mark ${JSON.stringify(seasonDismissed.returnMarks)}; ` +
          "dismissing must clear it."
      );
    }
    if (row && !row.hidden) {
      problems.push("the dismiss-return control left the New since you left row showing after a season-only return.");
    }

    // An absence whose only change is seeds the garden sowed into free soil: it
    // matured nothing, reached no form and crossed no season, so a plot that
    // only counted them in the summary would read the same as a garden the
    // visitor planted by hand. It must leave a mark of its own pointing at the
    // seed cells the absence added.
    const sownOnly = {
      seconds: MIN_AWAY_SECONDS,
      matured: 0,
      sown: 3,
      formsFound: [],
      crossedSeason: false,
      fromSeason: null,
      toSeason: null,
    };
    const sownMarks = returnMarkFor(sownOnly, MIN_AWAY_SECONDS);
    if (!sownMarks) {
      problems.push(
        "an absence that only sowed 3 seeds into free soil marked nothing; the seeds the garden sowed while away are a change of its own."
      );
    } else {
      if (sownMarks.sown !== 3) {
        problems.push(`the sown-only return marked ${sownMarks.sown} seeds, expected the 3 it sowed.`);
      }
      if (sownMarks.plants !== 0) {
        problems.push(`the sown-only return marked ${sownMarks.plants} plants, but no seed matured.`);
      }
      if (sownMarks.form || sownMarks.season) {
        problems.push(
          `the sown-only return marked form ${sownMarks.form} / season ${JSON.stringify(sownMarks.season)}, ` +
            "but it reached no form and crossed no season."
        );
      }
    }
    // A short gap is a reload, not an absence, even when it sowed.
    if (returnMarkFor({ ...sownOnly, seconds: MIN_AWAY_SECONDS - 1 }, MIN_AWAY_SECONDS) !== null) {
      problems.push("a gap shorter than the away threshold left return marks; only a real absence should.");
    }

    // The same through the real return path: a ~60-second absence at rate 0.09
    // sows one herb seed whose 30-second timer keeps it ungrown at return, and
    // whose leftover balance stays under the first form's threshold.
    setGarden({ seeds: 0, plants: 0, visit: { seconds: 0, sown: 0, tended: 0 } });
    setGrowth(0, 0.09, 0);
    const sownAway = applyReturn(
      { growth: 0, rate: 0.09, age: 0, sprouts: [], bloomSprouts: [], plants: 0, plantCounts: [0, 0], beds: 1 },
      nowMs - 62_000,
      nowMs
    );
    if (
      sownAway.sown !== 1 ||
      sownAway.matured !== 0 ||
      sownAway.formsFound.length !== 0 ||
      sownAway.crossedSeason
    ) {
      problems.push(
        `a 62-second absence at rate 0.09 reported ${sownAway.sown} sown / ${sownAway.matured} matured / ` +
          `${sownAway.formsFound.length} new forms / season turned ${sownAway.crossedSeason}, so it does not ` +
          "exercise a return whose only change was the seeds the garden sowed."
      );
    }
    const sownShown = getDisplayedState();
    if (sownShown.returnMarks?.sown !== 1) {
      problems.push(
        `get-state's returnMarks ${JSON.stringify(sownShown.returnMarks)} did not report the 1 seed the garden sowed while away.`
      );
    }
    if (row && field) {
      if (row.hidden) {
        problems.push("an absence that only sowed seeds left the New since you left row hidden.");
      } else if (!/sow/i.test(field.textContent) || !field.textContent.includes("1 seed sown")) {
        problems.push(
          `the New since you left readout does not name the seed the garden sowed while away: "${field.textContent}".`
        );
      }
    }

    // The mark lands on the seed cell the absence added, and the picture differs
    // from the same garden unmarked.
    const sownCells = returnMarkCells(sownShown, plotBounds(sownShown));
    if (sownCells.seeds.length !== 1) {
      problems.push(
        `returnMarkCells gave ${JSON.stringify(sownCells.seeds)} seed cells for a one-seed sown return, expected one.`
      );
    }
    if (sownCells.cells.length !== 0 || sownCells.form || sownCells.season) {
      problems.push(
        `returnMarkCells gave ${JSON.stringify(sownCells)} for a sown-only return, expected the seed mark alone.`
      );
    }
    const sownPlot = plotImage(sownShown, 0);
    if (sownPlot === plotImage({ ...sownShown, returnMarks: null }, 0)) {
      problems.push(
        "the plot drew the same picture with and without a sown-seed mark, so the seeds the garden sowed did not show on it."
      );
    }

    // A state holding three ungrown seeds and nothing grown marks three cells,
    // and one claiming far more seeds than the plot draws stays bounded at the
    // seeds actually on screen.
    const seedsOnly = {
      ...sownShown,
      plants: 0,
      plantCounts: [0, 0],
      seeds: 3,
      seedCounts: [3, 0],
      sprouts: [GROW_SECONDS, GROW_SECONDS, GROW_SECONDS],
      returnMarks: { plants: 0, sown: 3, form: false, season: null },
    };
    const threeSeeds = returnMarkCells(seedsOnly, plotBounds(seedsOnly));
    if (threeSeeds.cells.length !== 0 || threeSeeds.seeds.length !== 3 || threeSeeds.form || threeSeeds.season) {
      problems.push(
        `returnMarkCells gave ${JSON.stringify(threeSeeds)} for a three-seed, no-plant sown return, expected the 3 seed cells alone.`
      );
    }
    const flooded = returnMarkCells(
      { ...seedsOnly, returnMarks: { ...seedsOnly.returnMarks, sown: 9999 } },
      plotBounds(seedsOnly)
    );
    if (flooded.seeds.length !== 3) {
      problems.push(
        `returnMarkCells marked ${flooded.seeds.length} seed cells for a garden drawing 3 seeds, expected it bounded at 3.`
      );
    }

    // The sown ring is a mark of its own: on the one-seed return it differs from
    // the hand-sown sign on the very same cell and from a season mark, and it
    // holds still across animation phases.
    const handSown = { ...sownShown, visit: { ...sownShown.visit, sown: 1 } };
    const seasonOnly = {
      ...sownShown,
      returnMarks: { plants: 0, sown: 0, form: false, season: { from: "winter", to: "spring" } },
    };
    if (sownPlot === plotImage(handSown, 0)) {
      problems.push(
        "the plot drew a seed the garden sowed while away exactly as it draws a plot the visitor sowed by hand, so the two marks cannot be told apart."
      );
    }
    if (sownPlot === plotImage(seasonOnly, 0)) {
      problems.push("the plot drew a sown seed exactly as it draws a season turn, so the two marks cannot be told apart.");
    }
    // The seed sprite sways with the phase, so the whole picture naturally
    // differs between phases. The mark itself must not: the pixels it adds over
    // the unmarked garden — the sprite cancels out — read the same at any phase.
    const unmarkedSown = { ...sownShown, returnMarks: null };
    const markPixels = (phase) =>
      differingPixels(plotCanvas(sownShown, phase), plotCanvas(unmarkedSown, phase)).join(";");
    if (markPixels(0) !== markPixels(1)) {
      problems.push(
        "the pixels the sown-seed mark adds changed between animation phases, so it does not hold under reduced motion."
      );
    }

    // The same acknowledgement clears it: the dismiss control takes the sown
    // mark with the rest.
    dismiss?.click();
    const sownDismissed = getDisplayedState();
    if (sownDismissed.returnMarks !== null) {
      problems.push(
        `the dismiss-return control left a sown-seed mark ${JSON.stringify(sownDismissed.returnMarks)}; ` +
          "dismissing must clear it."
      );
    }
    if (row && !row.hidden) {
      problems.push("the dismiss-return control left the New since you left row showing after a sown-only return.");
    }
  } finally {
    clearReturnMarks();
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The visitor's own hand-work, kept apart from what the garden does alone.
 *
 * A garden the visitor tended must read differently from one they only watched:
 * the visit record states how long the visit has lasted and how many plots they
 * sowed and tended by hand, rises only when they act, survives a reload and a
 * return, is cleared by a replant, and is read the same by an agent through
 * get-state and a person off the page.
 */
function checkVisitRecord(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const payload = (value) => `${SAVE_PREFIX}${btoa(JSON.stringify(value))}`;
  const EMPTY = { seconds: 0, sown: 0, tended: 0 };
  try {
    // A fresh garden has done nothing by hand yet.
    if (JSON.stringify(newGarden().visit) !== JSON.stringify(EMPTY)) {
      problems.push(`newGarden() should open with an empty visit, but it is ${JSON.stringify(newGarden().visit)}.`);
    }
    setGarden(newGarden());
    setGrowth(0, 0);
    if (JSON.stringify(getGarden().visit) !== JSON.stringify(EMPTY)) {
      problems.push(`a fresh garden's visit should start at zero, but it is ${JSON.stringify(getGarden().visit)}.`);
    }

    // Only a successful hand-action raises the counts: planting raises sown,
    // tending raises tended, and neither touches the other.
    setGarden(newGarden());
    setGrowth(100000, 0);
    const before = getGarden().visit;
    if (!plantSeed("herb").ok) {
      problems.push("checkVisitRecord could not plant a seed to test the visit record.");
    }
    const afterPlant = getGarden().visit;
    if (afterPlant.sown !== before.sown + 1) {
      problems.push(
        `planting a seed by hand should raise visit.sown from ${before.sown} to ${before.sown + 1}, but it is ` +
          `${afterPlant.sown} (whole visit ${JSON.stringify(afterPlant)}).`
      );
    }
    if (afterPlant.tended !== before.tended) {
      problems.push(`planting a seed changed visit.tended from ${before.tended} to ${afterPlant.tended}; only tending should.`);
    }
    tend();
    const afterTend = getGarden().visit;
    if (afterTend.tended !== afterPlant.tended + 1) {
      problems.push(
        `tending the soil by hand should raise visit.tended from ${afterPlant.tended} to ${afterPlant.tended + 1}, ` +
          `but it is ${afterTend.tended} (whole visit ${JSON.stringify(afterTend)}).`
      );
    }
    if (afterTend.sown !== afterPlant.sown) {
      problems.push(`tending the soil changed visit.sown from ${afterPlant.sown} to ${afterTend.sown}; only planting should.`);
    }

    // The garden climbing on its own never touches the hand-work counts.
    const beforePassive = getGarden().visit;
    advance(120);
    const afterPassive = getGarden().visit;
    if (afterPassive.sown !== beforePassive.sown || afterPassive.tended !== beforePassive.tended) {
      problems.push(
        `passive growth changed the hand-work counts from ${JSON.stringify(beforePassive)} to ` +
          `${JSON.stringify(afterPassive)}; only the visitor's own actions may.`
      );
    }
    if (!(afterPassive.seconds >= beforePassive.seconds)) {
      problems.push(`passive growth lowered visit.seconds from ${beforePassive.seconds} to ${afterPassive.seconds}.`);
    }

    // A return grows the garden on its own — sowing into the free plots — but
    // the visitor's own counts stay exactly where they were.
    setGarden(newGarden());
    setGrowth(0, 0.5, 0, 100);
    const beforeReturn = getGarden().visit;
    const nowMs = 1_700_000_000_000;
    applyReturn({ growth: 0, rate: 0.5, age: 0, lifetime: 100, bonus: 0 }, nowMs - 3600 * 1000, nowMs);
    const afterReturn = getGarden().visit;
    if (afterReturn.sown !== beforeReturn.sown || afterReturn.tended !== beforeReturn.tended) {
      problems.push(
        `a return's away-sown seeds changed the hand-work counts from ${JSON.stringify(beforeReturn)} to ` +
          `${JSON.stringify(afterReturn)}; the garden's own work must not count as the visitor's.`
      );
    }

    // The visit only ever lengthens: a real span adds, a zero or negative one
    // adds nothing.
    const beforeTime = getGarden().visit.seconds;
    addVisitTime(5);
    const afterTime = getGarden().visit.seconds;
    if (afterTime < beforeTime + 5) {
      problems.push(
        `addVisitTime(5) should raise visit.seconds from ${beforeTime} to at least ${beforeTime + 5}, but it is ${afterTime}.`
      );
    }
    addVisitTime(0);
    addVisitTime(-3);
    if (getGarden().visit.seconds !== afterTime) {
      problems.push(
        `addVisitTime ignores a zero or negative span, but it changed visit.seconds from ${afterTime} to ` +
          `${getGarden().visit.seconds}.`
      );
    }

    // A save round-trips all three values exactly.
    const crafted = { ...newGarden(), growth: 0, rate: 0, visit: { seconds: 125.5, sown: 3, tended: 4 } };
    const back = decodeSave(encodeSave(crafted));
    if (JSON.stringify(back.visit) !== JSON.stringify(crafted.visit)) {
      problems.push(
        `a visit did not round-trip: put in ${JSON.stringify(crafted.visit)}, got back ${JSON.stringify(back.visit)}.`
      );
    }

    // The browser keeps it, so it survives a reload.
    setGarden({ ...newGarden(), visit: { seconds: 60, sown: 2, tended: 1 } });
    writeStoredGarden(getGarden());
    const stored = readStoredGarden().garden.visit;
    if (stored.seconds !== 60 || stored.sown !== 2 || stored.tended !== 1) {
      problems.push(`a stored visit did not come back: expected {60,2,1}, got ${JSON.stringify(stored)}.`);
    }

    // A save from before the visit record opens with an empty one.
    const migrated = decodeSave(payload({ version: 8, seeds: 1, plants: 0, growth: 0, rate: 0 }));
    if (JSON.stringify(migrated.visit) !== JSON.stringify(EMPTY)) {
      problems.push(`a version-8 save should migrate to an empty visit, but it migrated to ${JSON.stringify(migrated.visit)}.`);
    }

    // A visit field that is negative, fractional or not a number is refused.
    const badVisits = [
      ["a negative duration", { seconds: -1, sown: 0, tended: 0 }],
      ["a fractional sown count", { seconds: 0, sown: 1.5, tended: 0 }],
      ["a tended count given as text", { seconds: 0, sown: 0, tended: "2" }],
    ];
    for (const [label, visit] of badVisits) {
      try {
        decodeSave(payload({ version: SAVE_VERSION, seeds: 1, plants: 0, growth: 0, rate: 0, visit }));
        problems.push(`the save reader accepted ${label} in the visit record; it should refuse it.`);
      } catch {
        // refused, as it must be.
      }
    }

    // A replant clears the visit with the rest of the plot.
    setGarden(newGarden());
    setGrowth(0, 0, 0, 100);
    plantSeed("herb");
    tend();
    addVisitTime(30);
    const beforeReplant = getGarden().visit;
    if (!replant().ok) {
      problems.push("checkVisitRecord could not replant an eligible garden to test that it clears the visit.");
    }
    const afterReplant = getGarden().visit;
    if (JSON.stringify(afterReplant) !== JSON.stringify(EMPTY)) {
      problems.push(
        `a replant should clear the visit with the plot, but it left ${JSON.stringify(afterReplant)} ` +
          `(was ${JSON.stringify(beforeReplant)}).`
      );
    }

    // A person and an agent read the same visit: the state and the page's
    // labelled fields all equal the garden's record.
    setGarden({ ...newGarden(), visit: { seconds: 125, sown: 2, tended: 3 } });
    const state = getDisplayedState();
    const live = getGarden().visit;
    if (JSON.stringify(state.visit) !== JSON.stringify(live)) {
      problems.push(`get-state's visit ${JSON.stringify(state.visit)} does not match the garden's ${JSON.stringify(live)}.`);
    }
    for (const [field, expected] of [
      ["visit-seconds", formatDuration(live.seconds)],
      ["visit-sown", formatAmount(live.sown)],
      ["visit-tended", formatAmount(live.tended)],
    ]) {
      const el = document.querySelector(`[data-field="${field}"]`);
      if (!el) {
        problems.push(`the page has no [data-field="${field}"] readout for the visitor's own work this visit.`);
      } else if (String(el.textContent).trim() !== expected) {
        problems.push(
          `the page shows ${JSON.stringify(String(el.textContent).trim())} for ${field}, but the visit holds ${expected}.`
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The plots the visitor sowed by hand carry a mark ground the garden sowed on
 * its own never does, so a garden the visitor worked reads differently from one
 * they only watched.
 *
 * `tendedMarkCells` is the picture's own reading of the visitor's hand-work:
 * the visit record counts how many plots they sowed, so the first that many
 * occupied cells carry a standing sign — a subset of the marks `plotMarks`
 * draws, bounded by the cells on screen. The sign reads no animation phase, so
 * it shows in the still frame reduced motion pins to and changes only with the
 * hand-work; a replant clears the visit with the rest of the plot, and so clears
 * the signs; the plot's description and `get-state` name the same count.
 */
function checkTendedMarks(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();

  try {
    // A garden nothing has been sowed by hand carries no sign, and the marks
    // land on occupied cells only, never twice on one, and never past the cells
    // the plot has.
    const sownNothing = { growth: 0, beds: 1, capacity: PLOT_CAPACITY, seeds: 3, plants: 0 };
    if (tendedMarkCells(sownNothing).length !== 0) {
      problems.push(
        `a garden with no hand-sown plots drew ${tendedMarkCells(sownNothing).length} tended signs; it must draw none.`
      );
    }
    const sownFive = {
      ...sownNothing,
      seeds: 8,
      visit: { seconds: 0, sown: 5, tended: 0 },
    };
    const marked = new Set(plotMarks(sownFive).map((mark) => mark.cell));
    const cells = tendedMarkCells(sownFive);
    if (cells.length !== 5) {
      problems.push(`a garden whose visit sowed 5 plots drew ${cells.length} tended signs; it must draw 5.`);
    }
    if (new Set(cells).size !== cells.length) {
      problems.push(`two tended signs landed on one plot cell (${JSON.stringify(cells)}); each plot carries at most one.`);
    }
    for (const cell of cells) {
      if (!marked.has(cell)) {
        problems.push(`a tended sign landed on empty plot cell ${cell}, which carries no seed or plant.`);
      }
    }

    // The count is bounded by the cells on screen, so a save that sowed more
    // plots than the picture holds signs a bounded number of them.
    const huge = {
      growth: 1e12,
      beds: 5000,
      capacity: 60000,
      plantCounts: [1e12, 0],
      seedCounts: [1e12, 0],
      visit: { seconds: 0, sown: 1e12, tended: 0 },
    };
    const hugeCells = tendedMarkCells(huge);
    const hugeBounds = plotBounds(huge);
    if (hugeCells.length !== hugeBounds.cells) {
      problems.push(
        `a garden that sowed 1e12 plots drew ${hugeCells.length} tended signs over ${hugeBounds.cells} cells; the signs ` +
          "must be bounded by the plot."
      );
    }

    // The sign shows in the picture: the same garden with one hand-sown plot
    // differs from the same garden with none, and only on the plot the sign
    // landed on — nothing else about the state changed.
    const oneSown = { ...sownFive, seeds: 3, visit: { seconds: 0, sown: 1, tended: 0 } };
    const noneSown = { ...oneSown, visit: { seconds: 0, sown: 0, tended: 0 } };
    const bounds = plotBounds(oneSown);
    const before = plotCanvas(noneSown, 0);
    const after = plotCanvas(oneSown, 0);
    const differing = new Set();
    {
      const a = before.getContext("2d").getImageData(0, 0, bounds.width, bounds.height).data;
      const b = after.getContext("2d").getImageData(0, 0, bounds.width, bounds.height).data;
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) {
          const i = (y * bounds.width + x) * 4;
          if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
          differing.add(Math.floor(y / bounds.cell) * bounds.columns + Math.floor(x / bounds.cell));
        }
      }
    }
    if (differing.size === 0) {
      problems.push("the plot drew the same picture for a garden with a hand-sown plot and one without, so the sign is not drawn.");
    } else if (differing.size !== 1 || !differing.has(0)) {
      problems.push(
        `the hand-work changed plot cells ${JSON.stringify([...differing].sort())}; it must change only the cell of the ` +
          "hand-sown plot (cell 0)."
      );
    }
    // The sign reads no phase, so a still frame draws it whatever the motion
    // preference — the fixed frame reduced motion pins to.
    if (plotImage(oneSown, 0) !== plotImage(oneSown, 0)) {
      problems.push("the same hand-sown garden drew two different plots, so the tended sign is not a still frame.");
    }

    // The picture's description and `get-state` name the same count as the
    // signs drawn: for a garden under the grid cap, all three are visit.sown.
    setGarden(newGarden());
    setGrowth(0, 0);
    setGarden({ beds: 1, seeds: 3, visit: { seconds: 10, sown: 2, tended: 0 } });
    const shown = getDisplayedState();
    const worked = tendedMarkCells(shown).length;
    if (shown.visit.sown !== 2 || worked !== 2) {
      problems.push(
        `a garden whose visit sowed 2 plots reports visit.sown ${shown.visit.sown} and draws ${worked} signs; both must be 2.`
      );
    }
    const description = describePlot(shown);
    const expected = `${formatAmount(worked)} ${worked === 1 ? "plot" : "plots"} sowed by hand`;
    if (!description.includes(expected)) {
      problems.push(
        `the plot description ${JSON.stringify(description)} does not name the ${expected} the picture draws.`
      );
    }

    // A replant clears the signs with the rest of the plot: the visit goes to
    // zero and no cell carries a tended mark.
    setGarden(newGarden());
    setGrowth(1e5, 0, 0, 100);
    plantSeed("herb");
    if (tendedMarkCells(getDisplayedState()).length !== 1) {
      problems.push("a hand-planted plot did not raise a tended sign, so the replant check could not run.");
    }
    if (!replant().ok) {
      problems.push("checkTendedMarks could not replant an eligible garden to test that a replant clears the signs.");
    }
    const afterReplant = getDisplayedState();
    if (afterReplant.visit.sown !== 0 || tendedMarkCells(afterReplant).length !== 0) {
      problems.push(
        `a replant left visit.sown ${afterReplant.visit.sown} and ${tendedMarkCells(afterReplant).length} tended signs; ` +
          "a replant must clear the signs with the plot."
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The picture draws the visitor's own hand-tended soil, and the words beside it
 * name the same count.
 *
 * Tending the soil is the first and most repeated thing a visitor does, and the
 * 'Tended' readout states it while the picture used to stay exactly as it was.
 * `tendedWorkCells` is that hand-work drawn: one still mark per tended plot, on
 * the first that many cells of the ground, bounded by the plot and changing only
 * with `visit.tended`. The mark reads no animation phase, stays in its cell's
 * upper band beneath every sprite so it cannot cover a seed or a plant, and the
 * plot's description names the same bounded count.
 */
function checkHandWorkMarks(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();

  try {
    // No visit, or a visitor who tended nothing, draws no mark.
    if (tendedWorkCells({ growth: 0, beds: 1, capacity: PLOT_CAPACITY, seeds: 3 }).length !== 0) {
      problems.push("a garden with no visit drew a hand-tended mark; it must draw none.");
    }
    const tendedZero = {
      growth: 0,
      beds: 1,
      capacity: PLOT_CAPACITY,
      seeds: 3,
      visit: { seconds: 0, sown: 0, tended: 0 },
    };
    if (tendedWorkCells(tendedZero).length !== 0) {
      problems.push("a garden whose visitor tended nothing drew a hand-tended mark; it must draw none.");
    }

    // Exactly N marks for tended N, each on its own cell inside the grid.
    const tendedThree = { ...tendedZero, visit: { seconds: 0, sown: 0, tended: 3 } };
    const three = tendedWorkCells(tendedThree);
    const bounds = plotBounds(tendedThree);
    if (three.length !== 3) {
      problems.push(`a garden tended 3 times drew ${three.length} hand-tended marks; it must draw 3.`);
    }
    if (new Set(three).size !== three.length) {
      problems.push(`two hand-tended marks landed on one cell (${JSON.stringify(three)}).`);
    }
    for (const cell of three) {
      if (!(cell >= 0 && cell < bounds.cells)) {
        problems.push(`a hand-tended mark landed off the plot at cell ${cell}.`);
      }
    }

    // The count is bounded by the cells on screen, however far it climbs.
    const huge = {
      growth: 1e12,
      beds: 5000,
      capacity: 60000,
      plantCounts: [1e12, 0],
      seedCounts: [1e12, 0],
      visit: { seconds: 0, sown: 0, tended: 1e12 },
    };
    const hugeBounds = plotBounds(huge);
    if (tendedWorkCells(huge).length !== hugeBounds.cells) {
      problems.push(
        `a garden tended 1e12 times drew ${tendedWorkCells(huge).length} hand-tended marks over ${hugeBounds.cells} cells; ` +
          "the marks must be bounded by the plot."
      );
    }

    // The cell numbers whose pixels change between two states, at the still
    // phase, so a difference proves a difference in what is drawn.
    const differingCells = (a, b) => {
      const size = plotBounds(a);
      const before = plotCanvas(a, 0).getContext("2d").getImageData(0, 0, size.width, size.height).data;
      const after = plotCanvas(b, 0).getContext("2d").getImageData(0, 0, size.width, size.height).data;
      const cells = new Set();
      for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
          const i = (y * size.width + x) * 4;
          if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2] && before[i + 3] === after[i + 3]) continue;
          cells.add(Math.floor(y / size.cell) * size.columns + Math.floor(x / size.cell));
        }
      }
      return cells;
    };

    // Tending once changes the picture, and only on the cell the mark lands on.
    const oneTended = { ...tendedZero, visit: { seconds: 0, sown: 0, tended: 1 } };
    const markedCells = differingCells(oneTended, tendedZero);
    if (markedCells.size === 0) {
      problems.push("the plot drew the same picture for a garden tended once and one tended not at all, so the mark is not drawn.");
    } else if (markedCells.size !== 1 || !markedCells.has(0)) {
      problems.push(
        `tending once changed plot cells ${JSON.stringify([...markedCells].sort())}; it must change only the cell of the ` +
          "first tended plot (cell 0)."
      );
    }

    // A garden merely watched, one watched and sown by hand, and one tended by
    // hand are three different pictures, so the three hand-work marks can be
    // told apart.
    const watched = { ...tendedZero, visitPresent: true, visit: { seconds: 0, sown: 0, tended: 0 } };
    const sownByHand = { ...watched, visit: { seconds: 0, sown: 1, tended: 0 } };
    const tendedByHand = { ...watched, visit: { seconds: 0, sown: 0, tended: 1 } };
    if (plotImage(watched, 0) === plotImage(sownByHand, 0)) {
      problems.push("a garden only watched drew the same as one sown by hand, so the sown sign is not told apart.");
    }
    if (plotImage(watched, 0) === plotImage(tendedByHand, 0)) {
      problems.push("a garden only watched drew the same as one tended by hand, so the tend mark is not told apart.");
    }
    if (plotImage(sownByHand, 0) === plotImage(tendedByHand, 0)) {
      problems.push("a garden sown by hand drew the same as one tended by hand, so the two hand-work marks are not distinguishable.");
    }

    // The mark reads no animation phase: its own band of the cell is identical
    // across phases, while the seeding sprite below it may still sway.
    const bandOf = (canvas) => Array.from(canvas.getContext("2d").getImageData(0, 3, canvas.width, 6).data).join(",");
    if (bandOf(plotCanvas(oneTended, 0)) !== bandOf(plotCanvas(oneTended, 5))) {
      problems.push("the hand-tended mark changed between animation phases, so it does not hold in the still frame.");
    }

    // The mark stays out of a seed's way: the cell's foot rows are unchanged
    // when the tend mark appears, so a seed's mound is never covered.
    const seedOnly = { growth: 0, beds: 1, capacity: PLOT_CAPACITY, seeds: 1, visit: { seconds: 0, sown: 0, tended: 0 } };
    const seedTended = { ...seedOnly, visit: { seconds: 0, sown: 0, tended: 1 } };
    const seedBounds = plotBounds(seedOnly);
    const footRows = (canvas) =>
      Array.from(canvas.getContext("2d").getImageData(0, seedBounds.height - 5, seedBounds.width, 5).data).join(",");
    if (footRows(plotCanvas(seedOnly, 0)) !== footRows(plotCanvas(seedTended, 0))) {
      problems.push("a seed's plot foot changed when the hand-tended mark appeared, so the mark can cover a seed.");
    }

    // The plot's description names the same bounded count as the draw.
    setGarden(newGarden());
    setGrowth(0, 0);
    setGarden({ beds: 1, seeds: 3, visit: { seconds: 10, sown: 0, tended: 2 } });
    const shown = getDisplayedState();
    const drawn = tendedWorkCells(shown).length;
    if (shown.visit.tended !== 2 || drawn !== 2) {
      problems.push(
        `a garden tended twice reports visit.tended ${shown.visit.tended} and draws ${drawn} marks; both must be 2.`
      );
    }
    const description = describePlot(shown);
    const expected = `${formatAmount(drawn)} ${drawn === 1 ? "plot" : "plots"} tended by hand`;
    if (!description.includes(expected)) {
      problems.push(`the plot description ${JSON.stringify(description)} does not name the ${expected} the picture draws.`);
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * A visit in progress is its own drawn state: while someone is at the page the
 * garden is drawn as tended — every plot's ground worked and its standing plants
 * a pixel taller — and it returns to the untended look for a garden growing
 * alone. Presence is read off the page (`visitPresent`), carried in `get-state`
 * and the readout, and announced once when the page opens.
 *
 * It is not the hand-work count: presence alone changes the picture, so the plot
 * says someone is here before they have done anything, and a garden with no
 * visit in progress draws exactly the plot it always did.
 */
function checkVisitPresence(problems) {
  // The one line the page opens with: a real absence still gets its return
  // line, and anything shorter names the visit itself, so opening the page
  // always announces exactly one garden event.
  if (arrivalAnnouncement(null) !== visitAnnouncement() || !visitAnnouncement()) {
    problems.push(
      `arrivalAnnouncement(null) was ${JSON.stringify(arrivalAnnouncement(null))}, expected the visit line ` +
        `${JSON.stringify(visitAnnouncement())}.`
    );
  }
  const away = { seconds: 30 * 86400, earned: 1234.5, form: "a bed of seedlings" };
  if (arrivalAnnouncement(away) !== returnAnnouncement(away)) {
    problems.push(
      `arrivalAnnouncement of a real absence was ${JSON.stringify(arrivalAnnouncement(away))}, expected the return ` +
        `line ${JSON.stringify(returnAnnouncement(away))}.`
    );
  }

  // The page's own presence, in the state and in the readout, is a boolean a
  // person and an agent read the same way.
  const shown = getDisplayedState();
  const field = document.querySelector('[data-field="visit-present"]');
  if (typeof shown.visitPresent !== "boolean") {
    problems.push(`get-state's visitPresent is ${JSON.stringify(shown.visitPresent)}, expected a boolean.`);
  }
  if (!field) {
    problems.push('the page has no [data-field="visit-present"] readout for whether a visit is in progress.');
  } else {
    const expected = shown.visitPresent ? "Yes" : "No";
    if (String(field.textContent).trim() !== expected) {
      problems.push(
        `the page shows ${JSON.stringify(String(field.textContent).trim())} for visit-present, but the state holds ` +
          `${expected}.`
      );
    }
  }

  // The picture reads the presence: the cell numbers whose pixels change when
  // only `visitPresent` does, at the still phase reduced motion pins to.
  const differingCells = (a, b) => {
    const bounds = plotBounds(a);
    const before = plotCanvas(a, 0).getContext("2d").getImageData(0, 0, bounds.width, bounds.height).data;
    const after = plotCanvas(b, 0).getContext("2d").getImageData(0, 0, bounds.width, bounds.height).data;
    const cells = new Set();
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) {
        const i = (y * bounds.width + x) * 4;
        if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2] && before[i + 3] === after[i + 3]) continue;
        cells.add(Math.floor(y / bounds.cell) * bounds.columns + Math.floor(x / bounds.cell));
      }
    }
    return cells;
  };
  const countsTheSame = (a, b) =>
    JSON.stringify(plotMarks(a)) === JSON.stringify(plotMarks(b)) &&
    JSON.stringify(plotMilestoneTiers(a)) === JSON.stringify(plotMilestoneTiers(b)) &&
    JSON.stringify(groundCover(a)) === JSON.stringify(groundCover(b));

  // A garden with a visitor at it draws worked ground on every bare plot, and
  // everything the plot counts — its marks, its crowns and its cover — is
  // unchanged, so presence alone is what differs.
  const bare = { growth: 0, beds: 1, capacity: PLOT_CAPACITY, seeds: 0, plants: 0 };
  const bareTended = { ...bare, visitPresent: true };
  const bareAlone = { ...bare, visitPresent: false };
  if (!countsTheSame(bareTended, bareAlone)) {
    problems.push("a state that only changed visitPresent changed what the plot counts; only the drawn ground may differ.");
  }
  if (differingCells(bareTended, bareAlone).size === 0) {
    problems.push("a garden with a visit in progress drew the same bare ground as one growing alone, so presence is not drawn.");
  }
  // A garden with no presence field at all — a sandbox rehearsal — is drawn
  // exactly as one that says the visit is over.
  if (plotImage(bare, 0) !== plotImage(bareAlone, 0)) {
    problems.push("a garden with no visitPresent drew differently from one whose visit has ended; the untended look must match.");
  }

  // A standing plant is drawn a pixel taller for the visit, so a planted cell
  // changes as well as the ground under it.
  const grown = { growth: 1, beds: 1, capacity: PLOT_CAPACITY, seeds: 0, plants: 1 };
  const grownTended = { ...grown, visitPresent: true };
  const grownAlone = { ...grown, visitPresent: false };
  const grownCells = differingCells(grownTended, grownAlone);
  if (!grownCells.has(0)) {
    problems.push("the plot did not change on the cell a grown plant stands on when a visit began, so a standing plant is not lifted for the visit.");
  }
  // The visit's look reads no animation phase, so the same state draws the same
  // picture twice — the still frame reduced motion shows.
  if (plotImage(bareTended, 0) !== plotImage(bareTended, 0)) {
    problems.push("the same tended garden drew two different plots, so the visit's look is not a still frame.");
  }

  // Opening the page on a garden says the visit once into the status region.
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  try {
    const nowMs = 1_700_000_000_000;
    applyReturn({ growth: 0, rate: 0 }, nowMs - 1000, nowMs);
    const spoken = getAnnouncement();
    if (!spoken || spoken !== visitAnnouncement()) {
      problems.push(
        `opening the page on a garden announced ${JSON.stringify(spoken)}, expected the visit line ` +
          `${JSON.stringify(visitAnnouncement())}.`
      );
    }
  } finally {
    clearReturnMarks();
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * A screen reader is told what happened, not the same numbers over and over.
 * The per-tick readouts (the growth total, the garden form) are out of every
 * live region, and the one polite status region speaks only the discrete
 * events: a new form, a goal now affordable, a pollinator arriving, a return.
 * The transitions are pure and tested directly, so the anti-flood promise holds
 * without watching a clock.
 */
function checkLiveAnnouncements(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const DAY = 86400;

  // No per-tick readout may live in a live region, directly or through an
  // ancestor, or a screen reader is read it every TICK_MS.
  for (const [label, selector] of [
    ["the growth total", "#growth-total"],
    ["the garden form", '[data-field="form"]'],
  ]) {
    const el = document.querySelector(selector);
    if (!el) {
      problems.push(`${label} (${selector}) is gone, so its announcement behavior cannot be checked.`);
      continue;
    }
    if (el.hasAttribute("aria-live")) {
      problems.push(
        `${label} (${selector}) still carries aria-live=${JSON.stringify(el.getAttribute("aria-live"))}, ` +
          "so a screen reader is read its every tick."
      );
    }
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const role = ancestor.getAttribute("role");
      if (ancestor.hasAttribute("aria-live") || role === "status" || role === "alert" || role === "log") {
        problems.push(
          `${label} (${selector}) sits inside a live region (${describe(ancestor, "element")}), ` +
            "so its every tick is spoken."
        );
        break;
      }
    }
  }

  // The single event region: a polite status that a sighted visitor never sees
  // and never takes a line of the screen.
  const status = document.getElementById("garden-status");
  if (!status) {
    problems.push("the page has no garden-status region (#garden-status) to announce discrete events once each.");
  } else {
    const role = status.getAttribute("role");
    const live = status.getAttribute("aria-live");
    if (role !== "status" || live !== "polite") {
      problems.push(
        `#garden-status is role=${JSON.stringify(role)} aria-live=${JSON.stringify(live)}, expected a polite status region.`
      );
    }
    const rect = status.getBoundingClientRect();
    if (rect.width > 1 || rect.height > 1) {
      problems.push("#garden-status takes visible space; the event region must reach a screen reader only.");
    }
  }

  // The visible return summary must not be a live region, or the same return is
  // read twice — once as its long sentence and once as the short announcement.
  const strip = document.getElementById("return-summary");
  if (strip) {
    const role = strip.getAttribute("role");
    if (strip.hasAttribute("aria-live") || role === "status" || role === "alert" || role === "log") {
      problems.push(
        "#return-summary is still a live region, so its long sentence is read out on top of the events."
      );
    }
  }

  try {
    // The pure transition rules, on real snapshots of the page's state.
    const base = announceSnapshot(getDisplayedState());

    if (describeAnnouncements(null, base).length) {
      problems.push("a fresh load (no previous snapshot) announced an event instead of starting silently.");
    }
    if (describeAnnouncements(base, { ...base }).length) {
      problems.push("an unchanged snapshot announced an event, so the per-tick numbers would still flood a screen reader.");
    }

    const formBefore = { ...base, form: 1, formName: "a sprout" };
    const formEvents = describeAnnouncements(formBefore, { ...formBefore, form: 2, formName: "a seedling" });
    if (formEvents.length !== 1 || !formEvents[0].text.includes("a seedling")) {
      problems.push(
        `reaching a new form gave ${formEvents.length} announcements ` +
          `(${JSON.stringify(formEvents.map((e) => e.text))}), expected one naming "a seedling".`
      );
    }

    const goalBefore = { ...base, canPlantSeed: false, nextSeedKind: "herb", nextSeedCost: 6 };
    const goalEvents = describeAnnouncements(goalBefore, { ...goalBefore, canPlantSeed: true });
    if (goalEvents.length !== 1 || !/goal reached/i.test(goalEvents[0].text) || !goalEvents[0].text.includes("herb")) {
      problems.push(
        `becoming able to plant gave ${goalEvents.length} announcements ` +
          `(${JSON.stringify(goalEvents.map((e) => e.text))}), expected one naming the affordable goal.`
      );
    }

    const bedBefore = { ...base, canOpenBed: false, beds: 1, nextBedCost: 230 };
    const bedEvents = describeAnnouncements(bedBefore, { ...bedBefore, canOpenBed: true });
    if (bedEvents.length !== 1 || !bedEvents[0].text.includes("bed #2")) {
      problems.push(
        `becoming able to open a bed gave ${bedEvents.length} announcements ` +
          `(${JSON.stringify(bedEvents.map((e) => e.text))}), expected one naming "bed #2".`
      );
    }

    const pollinationBefore = { ...base, pollinatorVisiting: false, pollinatorMultiplier: 1 };
    const pollinationEvents = describeAnnouncements(pollinationBefore, {
      ...pollinationBefore,
      pollinatorVisiting: true,
      pollinatorMultiplier: 2,
    });
    if (pollinationEvents.length !== 1 || !pollinationEvents[0].text.includes("x2")) {
      problems.push(
        `a pollinator arriving gave ${pollinationEvents.length} announcements ` +
          `(${JSON.stringify(pollinationEvents.map((e) => e.text))}), expected one naming the x2 boost.`
      );
    }

    // A goal whose price rises while it is still unaffordable is not an event:
    // only a discrete change may be spoken.
    const costTick = describeAnnouncements(
      { ...base, canPlantSeed: false, nextSeedCost: 6 },
      { ...base, canPlantSeed: false, nextSeedCost: 36 }
    );
    if (costTick.length) {
      problems.push("a rising seed price with no change in what is affordable announced an event.");
    }

    // A return, as one short line; a reload says nothing.
    if (returnAnnouncement(null) !== "" || returnAnnouncement({ seconds: MIN_AWAY_SECONDS - 1 }) !== "") {
      problems.push("a gap shorter than MIN_AWAY_SECONDS produced a return announcement; only a real absence should.");
    }
    const away = {
      seconds: 30 * DAY,
      earned: 1234.5,
      form: "a bed of seedlings",
    };
    const line = returnAnnouncement(away);
    if (!line) {
      problems.push("a 30-day return produced no announcement at all.");
    } else {
      if (line.length > 80) {
        problems.push(`the return announcement is ${line.length} characters long; it must stay a short label and value.`);
      }
      if (!line.includes(formatGrowth(away.earned)) || !line.includes(away.form)) {
        problems.push(`the return announcement "${line}" does not state the earned growth and the form reached.`);
      }
    }

    // On the real page, returning after an absence leaves one short line in
    // #garden-status — not the long visible summary, and not every milestone
    // the jump crossed.
    const saved = { version: SAVE_VERSION, seeds: 2, plants: 10, growth: 0, rate: 0.5 };
    setGarden({ seeds: 2, plants: 10 });
    setGrowth(saved.growth, saved.rate);
    const nowMs = 1_700_000_000_000;
    const returned = applyReturn(saved, nowMs - 30 * DAY * 1000, nowMs);
    const spoken = getAnnouncement();
    if (!spoken) {
      problems.push("returning after 30 days announced nothing into #garden-status.");
    } else {
      if (spoken.length > 80) {
        problems.push(`#garden-status holds ${spoken.length} characters after a return; it must stay short.`);
      }
      const summary = strip ? strip.textContent : "";
      if (summary && spoken === summary) {
        problems.push("the return announcement is the whole visible summary rather than a short line.");
      }
      if (!spoken.includes(formatGrowth(returned.earned))) {
        problems.push(`the return announcement "${spoken}" does not state the earned growth.`);
      }
    }
  } finally {
    clearReturnMarks();
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * Why `element` is out of the accessibility tree — the element itself or the
 * nearest ancestor that is display:none, visibility:hidden or aria-hidden — or
 * "" when a screen reader can reach it.
 */
function hiddenFromAssistiveTech(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true") return `aria-hidden on ${describe(node, "element")}`;
    const style = getComputedStyle(node);
    if (style.display === "none") return `display:none on ${describe(node, "element")}`;
    if (style.visibility === "hidden") return `visibility:hidden on ${describe(node, "element")}`;
  }
  return "";
}

/**
 * Every live region that would speak `text` right now — the elements carrying it
 * that are themselves a polite status, alert or log and are in the accessibility
 * tree. One is what a visitor should hear; two is the same words read twice.
 */
function liveRegionsSaying(text) {
  const regions = document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]');
  return [...regions].filter((el) => el.textContent === text && !hiddenFromAssistiveTech(el));
}

/**
 * An action's confirmation reaches a screen reader whether or not the Save &
 * rehearsal fold is open. The words a sighted visitor reads live inside that
 * fold, which leaves the accessibility tree while it is closed, so every
 * confirmation — a planting, or a garden action's refusal — is written to the
 * always-exposed #garden-status as well. This drives the real controls with the
 * fold shut, so a confirmation that lands only in the folded line fails here.
 */
function checkActionConfirmationsAreSpoken(problems) {
  const fold = document.querySelector("details.fold");
  const spoken = document.getElementById("garden-status");
  const visible = document.getElementById("save-status");
  if (!fold || !spoken || !visible) {
    problems.push(
      "the action confirmations cannot be checked: the page needs a <details class=\"fold\"> holding " +
        "#save-status, and a #garden-status region outside it."
    );
    return;
  }

  const foldWasOpen = fold.open;
  const saveField = document.getElementById("save-value");
  const saveFieldValue = saveField ? saveField.value : "";
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();

  try {
    fold.open = false;

    // With the fold shut the confirmation region must still be in the
    // accessibility tree — that is the whole promise.
    if (fold.contains(spoken)) {
      problems.push(
        "#garden-status sits inside the Save & rehearsal fold, so closing the fold takes an action's " +
          "confirmation out of the accessibility tree."
      );
    }
    const hiddenBy = hiddenFromAssistiveTech(spoken);
    if (hiddenBy) {
      problems.push(
        `#garden-status is out of the accessibility tree while the fold is closed (${hiddenBy}), so an action's ` +
          "confirmation is never spoken."
      );
    }

    // A real action: plant a herb seed from the button a visitor presses, with
    // the fold closed.
    const plant = document.getElementById("plant-seed");
    if (!plant) {
      problems.push("the page has no #plant-seed control, so a planting confirmation cannot be checked.");
    } else {
      setGarden({ seeds: 1, plants: 0 });
      setGrowth(nextSeedCost(1), 0.2);
      plant.click();
      const said = spoken.textContent;
      if (!said.trim()) {
        problems.push("planting a seed with the fold closed announced nothing into #garden-status.");
      } else {
        if (!/planted a .+ seed/i.test(said)) {
          problems.push(
            `planting a seed announced ${JSON.stringify(said)} into #garden-status, which does not say what was planted.`
          );
        }
        if (said !== visible.textContent) {
          problems.push(
            `planting a seed announced ${JSON.stringify(said)} into #garden-status but ` +
              `${JSON.stringify(visible.textContent)} into #save-status; a screen reader and a sighted visitor must be ` +
              "told the same words."
          );
        }

        // Spoken exactly once, with the fold shut and again with it open: a
        // second live region carrying the same words is read out on top of the
        // first.
        const speaking = liveRegionsSaying(said).length;
        if (speaking !== 1) {
          problems.push(
            `planting a seed with the fold closed left ${speaking} live regions saying ${JSON.stringify(said)}, ` +
              "expected exactly one."
          );
        }
        fold.open = true;
        const speakingOpen = liveRegionsSaying(said).length;
        fold.open = false;
        if (speakingOpen !== 1) {
          problems.push(
            `planting a seed with the fold open left ${speakingOpen} live regions saying ${JSON.stringify(said)}, ` +
              "so a screen reader would hear the confirmation more than once."
          );
        }
      }
    }

    // A refused garden action: with every plot full a press on Plant a seed is
    // refused, and the reason must reach the exposed region with the fold shut
    // — no save field is involved, so the whole exchange happens outside it.
    if (plant) {
      setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
      setGrowth(0, 1);
      plant.click();
      const gardenRefusal = spoken.textContent;
      if (gardenRefusal !== "Every plot already holds a seed.") {
        problems.push(
          `a refused planting announced ${JSON.stringify(gardenRefusal)} into #garden-status, ` +
            'expected "Every plot already holds a seed."'
        );
      } else if (gardenRefusal !== visible.textContent) {
        problems.push(
          `a refused planting announced ${JSON.stringify(gardenRefusal)} into #garden-status but ` +
            `${JSON.stringify(visible.textContent)} into #save-status; the words must match.`
        );
      }
      const refusalHiddenBy = hiddenFromAssistiveTech(spoken);
      if (refusalHiddenBy) {
        problems.push(
          `a refused planting's reason is out of the accessibility tree with the fold closed (${refusalHiddenBy}).`
        );
      }
    }

    // A refused save action: an unreadable save is refused with the same words a
    // sighted visitor reads. The fold is opened only to reach the field and the
    // button that live inside it; the refusal must still be there, in the
    // exposed region, once the fold is shut again.
    fold.open = true;
    const load = document.getElementById("load-save");
    if (!saveField || !load) {
      problems.push("the page has no #save-value field or #load-save control, so a refused action cannot be checked.");
    } else {
      saveField.value = "not a selfgrow save";
      load.click();
      const refusal = spoken.textContent;
      if (!refusal.trim()) {
        problems.push("a refused action announced nothing into #garden-status.");
      } else if (refusal !== visible.textContent) {
        problems.push(
          `a refused action announced ${JSON.stringify(refusal)} into #garden-status but ` +
            `${JSON.stringify(visible.textContent)} into #save-status; the words must match.`
        );
      }
      fold.open = false;
      const stillHiddenBy = hiddenFromAssistiveTech(spoken);
      if (stillHiddenBy) {
        problems.push(
          `a refused action's confirmation is out of the accessibility tree once the fold is closed (${stillHiddenBy}).`
        );
      }
      if (spoken.textContent !== refusal) {
        problems.push(
          `closing the fold changed the refused action's confirmation from ${JSON.stringify(refusal)} to ` +
            `${JSON.stringify(spoken.textContent)}.`
        );
      }
    }
  } finally {
    fold.open = foldWasOpen;
    if (saveField) saveField.value = saveFieldValue;
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * A growing control the garden is not ready for stays reachable and says why.
 * The Plant and Open-the-next-bed controls are never switched off, so a press
 * reaches the refusal that explains it — the same reason the goal already
 * shows — and lands in the always-exposed #garden-status, while the garden
 * itself is left exactly as it was.
 */
function checkGardenActionRefusals(problems) {
  const plant = document.getElementById("plant-seed");
  const openBed = document.getElementById("open-bed");
  const spoken = document.getElementById("garden-status");
  if (!plant || !openBed || !spoken) {
    problems.push(
      "the garden-action refusals cannot be checked: the page needs #plant-seed, #open-bed and #garden-status."
    );
    return;
  }

  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  try {
    // Every plot full: planting is refused for the full plot, not for a price.
    setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
    setGrowth(0, 1);
    const fullPlot = availabilityProblem(plant, false, "the Plant a seed control on a full plot");
    if (fullPlot) problems.push(fullPlot);
    plant.focus();
    if (document.activeElement !== plant) {
      problems.push(
        "the Plant a seed control cannot take focus while the garden cannot plant, so a keyboard visitor " +
          "cannot reach the refusal."
      );
    }
    plant.click();
    if (spoken.textContent !== "Every plot already holds a seed.") {
      problems.push(
        `pressing Plant a seed on a full plot announced ${JSON.stringify(spoken.textContent)} into ` +
          '#garden-status, expected "Every plot already holds a seed."'
      );
    }
    if (getGarden().seeds !== PLOT_CAPACITY) {
      problems.push(
        `pressing Plant a seed on a full plot planted anyway: the garden holds ${getGarden().seeds} seeds, ` +
          `expected the unchanged ${PLOT_CAPACITY}.`
      );
    }

    // Room to plant but nothing saved: the refusal names the missing growth.
    setGarden({ beds: 1, seeds: 1, plants: 0 });
    const cost = nextSeedCost(1);
    setGrowth(0, 1);
    const shortGrowth = availabilityProblem(
      plant,
      false,
      `the Plant a seed control at 0 growth, short of its ${cost}-growth cost`
    );
    if (shortGrowth) problems.push(shortGrowth);
    plant.click();
    if (spoken.textContent !== "Not enough growth for another seed yet.") {
      problems.push(
        `pressing Plant a seed with too little growth announced ${JSON.stringify(spoken.textContent)} into ` +
          '#garden-status, expected "Not enough growth for another seed yet."'
      );
    }
    if (getGarden().seeds !== 1 || getGrowthState().growth !== 0) {
      problems.push(
        `pressing Plant a seed with too little growth planted anyway: the garden holds ${getGarden().seeds} ` +
          `seeds at ${getGrowthState().growth} growth, expected 1 seed at 0 growth.`
      );
    }

    // Every plot full and too little saved: the bed's own refusal, and no bed.
    setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
    setGrowth(0, 1);
    const shortBed = availabilityProblem(openBed, false, "the Open the next bed control on a full plot with no growth");
    if (shortBed) problems.push(shortBed);
    openBed.click();
    if (spoken.textContent !== "Not enough growth for the next bed yet.") {
      problems.push(
        `pressing Open the next bed with too little growth announced ${JSON.stringify(spoken.textContent)} into ` +
          '#garden-status, expected "Not enough growth for the next bed yet."'
      );
    }
    if (getGarden().beds !== 1) {
      problems.push(
        `pressing Open the next bed with too little growth opened one anyway: the garden has ` +
          `${getGarden().beds} beds, expected 1.`
      );
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The pure simulation behind both a return and a sandbox rehearsal: one span in
 * one step lands where played time would, and a span that cannot be trusted
 * grows nothing.
 */
function checkSimulateGarden(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const DAY = 86400;
  try {
    setGarden({ seeds: 3, plants: 0 });
    setGrowth(0, 1);
    advance(30 * DAY);
    const lived = { growth: getGrowthState().growth, garden: getGarden() };

    const played = simulateGarden(
      { growth: 0, rate: 1, sprouts: [GROW_SECONDS, GROW_SECONDS, GROW_SECONDS], plants: 0, beds: 1 },
      30 * DAY
    );
    const tolerance = Math.max(1e-6, Math.abs(lived.growth) * 1e-9);
    if (Math.abs(played.growth - lived.growth) > tolerance) {
      problems.push(
        `simulateGarden over a month gave ${played.growth} growth, but advance gave ${lived.growth}; ` +
          "a rehearsal must land where played time does."
      );
    }
    if (played.plants !== lived.garden.plants || played.sprouts.length !== lived.garden.seeds) {
      problems.push(
        `simulateGarden ended with ${played.sprouts.length} seeds / ${played.plants} plants, but advance ` +
          `ended with ${lived.garden.seeds} / ${lived.garden.plants}.`
      );
    }

    // A span that cannot be trusted must grow nothing at all, and a state that
    // never knew about growth must read as nothing grown rather than as NaN.
    const start = { growth: 4, rate: 0.5, sprouts: [GROW_SECONDS], plants: 0, beds: 1 };
    const spans = [
      ["a negative span", -3600],
      ["a NaN span", Number.NaN],
      ["a missing span", undefined],
    ];
    for (const [label, span] of spans) {
      const held = simulateGarden(start, span);
      if (held.growth !== 4 || held.plants !== 0 || held.sprouts.length !== 1) {
        problems.push(
          `simulateGarden grew on ${label}: it returned ${held.growth} growth / ${held.plants} plants / ` +
            `${held.sprouts.length} seeds, expected the untouched 4 / 0 / 1.`
        );
      }
    }
    const empty = simulateGarden(undefined, 3600);
    if (empty.growth !== 0 || empty.rate !== 0 || empty.plants !== 0 || empty.sprouts.length !== 0) {
      problems.push(
        `simulateGarden on a missing state returned ${JSON.stringify(empty)}, expected an empty garden of zeros.`
      );
    }

    // `plants` has one meaning everywhere a garden is described: the total grown
    // plants of every kind, with the per-kind counts beside it. A herb-only, a
    // bloom-only and a mixed garden must all report the same total the live
    // garden does, whichever shape the state came in.
    for (const [label, state, counts] of [
      ["a herb-only garden", { seeds: 0, plants: 3 }, [3, 0]],
      ["a bloom-only garden", { seeds: 0, plants: 0, bloomPlants: 3 }, [0, 3]],
      ["a mixed garden", { seeds: 0, plants: 2, bloomPlants: 3 }, [2, 3]],
    ]) {
      setGarden(state);
      const live = getGarden();
      const simulated = simulateGarden(state, 0);
      if (
        simulated.plants !== simulated.plantCounts[0] + simulated.plantCounts[1] ||
        simulated.plants !== live.plants ||
        JSON.stringify(simulated.plantCounts) !== JSON.stringify(counts)
      ) {
        problems.push(
          `simulateGarden on ${label} reported ${simulated.plants} plants ` +
            `(${JSON.stringify(simulated.plantCounts)} by kind), but the live garden holds ${live.plants} ` +
            `(${JSON.stringify(live.plantCounts)}); the total must be the sum of the kinds everywhere.`
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
  }
}

/**
 * The sandbox rehearsal: it copies the real garden, winds forward without ever
 * touching the real one, reads exactly as the real absence would, and resets to
 * its start.
 */
function checkSandbox(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const seenBefore = rawLastSeen();
  const DAY = 86400;
  try {
    const panel = document.getElementById("sandbox");
    const openButton = document.getElementById("open-sandbox");
    const summary = document.getElementById("sandbox-summary");
    const goalTitle = document.getElementById("sandbox-goal-title");
    if (!panel) problems.push("the page has no sandbox panel (#sandbox) to rehearse time in.");
    if (!openButton) problems.push("the page has no way to open the sandbox (#open-sandbox).");
    if (!summary) problems.push("the sandbox has no summary element (#sandbox-summary) to say what the time away did.");
    if (!goalTitle) problems.push("the sandbox has no next-goal title (#sandbox-goal-title).");
    for (const id of ["sandbox-hour", "sandbox-day", "sandbox-month", "sandbox-reset"]) {
      if (!document.getElementById(id)) problems.push(`the sandbox has no ${id} control.`);
    }

    // The rehearsal's own garden is drawn in the panel, with the live plot's
    // renderer: a canvas beside the values, inside #sandbox so it shows only
    // while a rehearsal is open.
    const plot = document.getElementById("sandbox-plot");
    if (!plot) {
      problems.push("the rehearsal panel has no plot (#sandbox-plot) to draw the rehearsal garden in.");
    } else {
      if (plot.tagName !== "CANVAS") {
        problems.push(`#sandbox-plot is a ${plot.tagName}, not a CANVAS the rehearsal garden can be drawn on.`);
      }
      if (panel && !panel.contains(plot)) {
        problems.push("#sandbox-plot is outside #sandbox, so the rehearsal plot would show while no rehearsal is open.");
      }
    }

    setGarden({ seeds: 2, plants: 1 });
    setGrowth(0, 0.5);
    const realGarden = getGarden();
    const realGrowth = getGrowthState();
    const realStorage = rawStorage();

    const opened = openSandbox();
    if (!opened.open || opened.seconds !== 0) {
      problems.push(`opening the sandbox should start at 0 seconds, but it is ${JSON.stringify(opened)}.`);
    }
    if (opened.growth !== 0 || opened.seeds !== 2 || opened.plants !== 1) {
      problems.push(
        `the opened sandbox holds ${opened.growth} growth / ${opened.seeds} seeds / ${opened.plants} plants, ` +
          "expected a copy of the real 0 / 2 / 1."
      );
    }
    if (panel && panel.hidden) problems.push("opening the sandbox left its panel hidden.");

    const hour = fastForwardSandbox(3600);
    const day = fastForwardSandbox(DAY);
    const month = fastForwardSandbox(30 * DAY);
    if (!(hour.growth > opened.growth && day.growth > hour.growth && month.growth > day.growth)) {
      problems.push(
        `fast-forwarding does not grow the sandbox more each time: hour ${hour.growth}, day ${day.growth}, ` +
          `month ${month.growth}.`
      );
    }
    if (!(hour.seeds <= day.seeds && day.seeds <= month.seeds)) {
      problems.push("fast-forwarding the sandbox turned grown plants back into ungrown seeds.");
    }
    if (month.seconds !== 3600 + DAY + 30 * DAY) {
      problems.push(`the sandbox reports ${month.seconds} seconds wound forward, expected ${3600 + DAY + 30 * DAY}.`);
    }

    // The drawn rehearsal follows its own state: its growth, seeds, plants and
    // season are the rehearsal's reported ones, and after a month it is not the
    // live garden's picture — the open sandbox copied a bare 0-growth garden and
    // wound it forward, while the live garden never moved.
    const liveSeason = getDisplayedState().season.key;
    const drawnMonth = sandboxPlotState(month);
    if (drawnMonth.growth !== month.growth || drawnMonth.seeds !== month.seeds || drawnMonth.plants !== month.plants) {
      problems.push(
        `the drawn rehearsal garden carries ${drawnMonth.growth} growth / ${drawnMonth.seeds} seeds / ` +
          `${drawnMonth.plants} plants, but the rehearsal holds ${month.growth} / ${month.seeds} / ${month.plants}.`
      );
    }
    if (drawnMonth.season?.key !== month.season.key) {
      problems.push(
        `the drawn rehearsal garden is in ${JSON.stringify(drawnMonth.season?.key)}, but the rehearsal reports ` +
          `${JSON.stringify(month.season.key)}.`
      );
    }
    if (getDisplayedState().season.key !== liveSeason) {
      problems.push(
        `winding the rehearsal forward turned the live garden from ${liveSeason} to ` +
          `${getDisplayedState().season.key}; the live garden must not move.`
      );
    }
    if (plotImage(drawnMonth, 0) === plotImage(getDisplayedState(), 0)) {
      problems.push(
        "the drawn rehearsal garden is identical to the live garden's picture after a month, so it is not drawing " +
          "the rehearsal's own garden."
      );
    }
    if (plotImage(sandboxPlotState(hour), 0) === plotImage(drawnMonth, 0)) {
      problems.push(
        "winding the rehearsal from an hour to a month left the drawn rehearsal garden unchanged, so a " +
          "fast-forward cannot be seen."
      );
    }
    if (plot) {
      const bounds = plotBounds(drawnMonth);
      if (plot.width !== bounds.canvasWidth || plot.height !== bounds.height) {
        problems.push(
          `the rehearsal plot on the page is ${plot.width}x${plot.height} pixels, but the drawn rehearsal ` +
            `(@ form ${drawnMonth.form}) is ${bounds.canvasWidth}x${bounds.height}.`
        );
      }
    }

    const back = resetSandbox();
    if (back.seconds !== 0 || back.growth !== 0 || back.seeds !== 2 || back.plants !== 1) {
      problems.push(
        `resetting the sandbox left ${back.seconds} seconds / ${back.growth} growth / ${back.seeds} seeds / ` +
          `${back.plants} plants, expected its start of 0 / 0 / 2 / 1.`
      );
    }

    // Nothing in the sandbox may reach the real garden, its save or its clock.
    const afterGarden = getGarden();
    const afterGrowth = getGrowthState();
    if (
      afterGarden.seeds !== realGarden.seeds ||
      afterGarden.plants !== realGarden.plants ||
      afterGrowth.growth !== realGrowth.growth ||
      afterGrowth.rate !== realGrowth.rate
    ) {
      problems.push(
        `rehearsing time changed the real garden to ${afterGrowth.growth} growth / ${afterGarden.seeds} seeds / ` +
          `${afterGarden.plants} plants; it must stay ${realGrowth.growth} / ${realGarden.seeds} / ` +
          `${realGarden.plants}.`
      );
    }
    if (rawStorage().value !== realStorage.value) {
      problems.push("rehearsing time wrote to the garden's save; the sandbox must never touch it.");
    }
    if (rawLastSeen() !== seenBefore) {
      problems.push("rehearsing time changed when the visitor was last seen; the sandbox must never touch it.");
    }

    // A month of rehearsal must read exactly as a month really away would.
    fastForwardSandbox(30 * DAY);
    const rehearsal = getSandboxState();
    const nowMs = 1_700_000_000_000;
    const away = applyReturn({ growth: 0, rate: 0.5 }, nowMs - 30 * DAY * 1000, nowMs);
    const realGoalTitle = document.getElementById("goal-title")?.textContent;
    const realGoalDetail = document.getElementById("goal-detail")?.textContent;
    const realFacts = readGoalFacts(document.getElementById("return-summary"));
    const expected = returnFacts(buildAwayReport(
      { growth: 0, rate: 0.5, sprouts: [GROW_SECONDS, GROW_SECONDS], plants: 1, beds: 1 },
      30 * DAY
    ));
    if (
      JSON.stringify(rehearsal.facts) !== JSON.stringify(realFacts) ||
      JSON.stringify(rehearsal.facts) !== JSON.stringify(returnFacts(away)) ||
      JSON.stringify(rehearsal.facts) !== JSON.stringify(expected)
    ) {
      problems.push(
        `the sandbox return facts ${JSON.stringify(rehearsal.facts)} do not match the real garden's ` +
          `${JSON.stringify(realFacts)}.`
      );
    }
    if (rehearsal.summary !== away.summary) {
      problems.push(
        `the sandbox summary ${JSON.stringify(rehearsal.summary)} does not match the real garden's ` +
          `${JSON.stringify(away.summary)}.`
      );
    }
    if (rehearsal.goalTitle !== realGoalTitle || rehearsal.goalDetail !== realGoalDetail) {
      problems.push(
        `the sandbox next goal ${JSON.stringify(rehearsal.goalTitle)} / ${JSON.stringify(rehearsal.goalDetail)} ` +
          `does not match the real garden's ${JSON.stringify(realGoalTitle)} / ${JSON.stringify(realGoalDetail)}.`
      );
    }
    if (rehearsal.growth !== away.growth || rehearsal.matured !== away.matured) {
      problems.push(
        `after a month the sandbox holds ${rehearsal.growth} growth and matured ${rehearsal.matured} seeds, ` +
          `but the real return reports ${away.growth} / ${away.matured}.`
      );
    }

    // Tending a fresh rehearsal is drawn, not only counted: the first pick of
    // growth turns bare soil into a sprout, so the drawn garden must change.
    setGarden({ seeds: 1, plants: 0 });
    setGrowth(0, 0.5);
    const fresh = openSandbox();
    const bareRehearsal = plotImage(sandboxPlotState(fresh), 0);
    const firstTend = actInSandbox("tend");
    if (!firstTend.ok || firstTend.growth !== 1) {
      problems.push(`tending a fresh rehearsal left ${firstTend.growth} growth, expected 1.`);
    }
    if (plotImage(sandboxPlotState(firstTend), 0) === bareRehearsal) {
      problems.push(
        "tending a fresh rehearsal left its drawn garden unchanged; +1 growth turns bare soil into a sprout, " +
          "which the plot must show."
      );
    }

    // The garden's own actions run inside the rehearsal, changing only the
    // sandbox copy. A known garden and span let the checks state exact values.
    for (const id of ["sandbox-tend", "sandbox-plant-herb", "sandbox-plant-bloom", "sandbox-open-bed", "sandbox-status"]) {
      if (!document.getElementById(id)) problems.push(`the sandbox has no ${id} control for its own actions.`);
    }

    setGarden({ seeds: 2, plants: 1 });
    setGrowth(1000, 0.5);
    const realGardenBeforeActs = getGarden();
    const realGrowthBeforeActs = getGrowthState();
    const realStorageBeforeActs = rawStorage();
    const seenBeforeActs = rawLastSeen();

    const opening = openSandbox();
    const tended = actInSandbox("tend");
    if (!tended.ok || tended.growth !== opening.growth + TEND_YIELD || Math.abs(tended.rate - (opening.rate + TEND_RATE_STEP)) > 1e-6) {
      problems.push(
        `tending the rehearsal left ${tended.growth} growth / ${tended.rate} rate, expected ` +
          `${opening.growth + TEND_YIELD} / ${opening.rate + TEND_RATE_STEP}.`
      );
    }

    const herbCost = nextSeedCost(3, 0);
    const herbPlanted = actInSandbox("plant-herb");
    if (!herbPlanted.ok || herbPlanted.cost !== herbCost) {
      problems.push(`planting a herb seed in the rehearsal cost ${herbPlanted.cost}, expected ${herbCost}.`);
    }
    if (herbPlanted.growth !== tended.growth - herbCost || herbPlanted.seeds !== tended.seeds + 1) {
      problems.push(
        `planting a herb seed in the rehearsal left ${herbPlanted.growth} growth / ${herbPlanted.seeds} seeds, ` +
          `expected ${tended.growth - herbCost} / ${tended.seeds + 1}.`
      );
    }
    if (plotImage(sandboxPlotState(herbPlanted), 0) === plotImage(sandboxPlotState(tended), 0)) {
      problems.push(
        "planting a herb seed in the rehearsal left its drawn garden unchanged, so the new seed cannot be seen."
      );
    }

    const bloomCost = nextSeedCost(0, "bloom");
    const bloomPlanted = actInSandbox("plant-bloom");
    if (!bloomPlanted.ok || bloomPlanted.cost !== bloomCost || bloomPlanted.seeds !== herbPlanted.seeds + 1) {
      problems.push(
        `planting a bloom seed in the rehearsal left ${bloomPlanted.growth} growth / ${bloomPlanted.seeds} seeds, ` +
          `expected ${herbPlanted.growth - bloomCost} / ${herbPlanted.seeds + 1}.`
      );
    }

    // The readout, goal and status on the page follow the acted rehearsal.
    const acted = getSandboxState();
    if (document.getElementById("sandbox-growth")?.textContent !== formatGrowth(acted.growth)) {
      problems.push(
        `the rehearsal readout shows ${JSON.stringify(document.getElementById("sandbox-growth")?.textContent)} ` +
          `growth, expected ${formatGrowth(acted.growth)}.`
      );
    }
    if (document.querySelector('[data-field="sandbox-seeds"]')?.textContent !== formatAmount(acted.seeds)) {
      problems.push(
        `the rehearsal readout shows ${JSON.stringify(document.querySelector('[data-field="sandbox-seeds"]')?.textContent)} ` +
          `seeds, expected ${formatAmount(acted.seeds)}.`
      );
    }
    if (JSON.stringify(readGoalFacts(document.getElementById("sandbox-summary"))) !== JSON.stringify(acted.facts)) {
      problems.push("the rehearsal's labelled facts do not match the acted rehearsal state.");
    }
    if (document.getElementById("sandbox-goal-title")?.textContent !== acted.goalTitle) {
      problems.push("the rehearsal goal does not match the acted rehearsal state.");
    }
    if (!acted.status) problems.push("acting in the rehearsal said nothing in its status line.");

    // The pollinator and one row per kind, in the same short labelled values
    // the real garden's own rows carry — read from the same describe
    // functions, so the two readings cannot drift. Each row lives inside
    // #sandbox, so it shows only while a rehearsal is open.
    const sandboxPanel = document.getElementById("sandbox");
    const pollinatorRow = document.querySelector('[data-field="sandbox-pollinator"]');
    const seasonRow = document.querySelector('[data-field="sandbox-season"]');
    if (!pollinatorRow) {
      problems.push('the rehearsal readout has no pollinator row ([data-field="sandbox-pollinator"]).');
    } else {
      if (sandboxPanel && !sandboxPanel.contains(pollinatorRow)) {
        problems.push("the rehearsal's pollinator row is outside #sandbox, so it would show while no rehearsal is open.");
      }
      const pollinatorFacts = readReadoutFacts(pollinatorRow);
      if (JSON.stringify(pollinatorFacts) !== JSON.stringify(describePollinator(acted))) {
        problems.push(
          `the rehearsal pollinator row reads ${JSON.stringify(pollinatorFacts)}, expected ` +
            `${JSON.stringify(describePollinator(acted))}.`
        );
      }
    }
    if (!seasonRow) {
      problems.push('the rehearsal readout has no season row ([data-field="sandbox-season"]).');
    } else {
      if (sandboxPanel && !sandboxPanel.contains(seasonRow)) {
        problems.push("the rehearsal's season row is outside #sandbox, so it would show while no rehearsal is open.");
      }
      const text = String(seasonRow.textContent);
      if (
        readoutFactValue(seasonRow, "Season") !== acted.season?.name ||
        readoutFactValue(seasonRow, "Growth") !== `x${acted.season?.multiplier}`
      ) {
        problems.push(
          `the rehearsal season row reads ${JSON.stringify(text)}, expected a Season fact naming ${acted.season?.name} ` +
            `and a Growth fact of x${acted.season?.multiplier}.`
        );
      }
      if (text.includes(" · ")) {
        problems.push(
          `the rehearsal season row reads ${JSON.stringify(text)}, expected short labelled facts rather than a ` +
            "joined sentence."
        );
      }
    }
    for (const [key, kind] of [["herb", acted.kinds[0]], ["bloom", acted.kinds[1]]]) {
      const row = document.querySelector(`[data-field="sandbox-kind-${key}"]`);
      if (!row) {
        problems.push(`the rehearsal readout has no ${key} row ([data-field="sandbox-kind-${key}"]).`);
        continue;
      }
      if (sandboxPanel && !sandboxPanel.contains(row)) {
        problems.push(`the rehearsal's ${key} row is outside #sandbox, so it would show while no rehearsal is open.`);
      }
      for (const { field, value } of describeKind(kind)) {
        // The rehearsal shows three facts per kind; the markup decides which,
        // but any span it carries must hold the garden's own value.
        const span = row.querySelector(`[data-field="sandbox-kind-${key}-${field}"]`);
        if (!span) continue;
        if (span.textContent !== value) {
          problems.push(
            `the rehearsal ${key} ${field} reads ${JSON.stringify(span.textContent)}, expected ${JSON.stringify(value)}.`
          );
        }
      }
      for (const field of ["seeds", "plants", "cost"]) {
        if (!row.querySelector(`[data-field="sandbox-kind-${key}-${field}"]`)) {
          problems.push(`the rehearsal's ${key} row has no ${field} value, which the readout promises to show.`);
        }
      }
    }

    // None of it may reach the real garden, its save or its clock.
    const realGardenAfterActs = getGarden();
    const realGrowthAfterActs = getGrowthState();
    if (
      realGardenAfterActs.seeds !== realGardenBeforeActs.seeds ||
      realGardenAfterActs.plants !== realGardenBeforeActs.plants ||
      realGardenAfterActs.beds !== realGardenBeforeActs.beds ||
      realGrowthAfterActs.growth !== realGrowthBeforeActs.growth
    ) {
      problems.push(
        `acting in the rehearsal changed the real garden to ${realGrowthAfterActs.growth} growth / ` +
          `${realGardenAfterActs.seeds} seeds / ${realGardenAfterActs.plants} plants / ${realGardenAfterActs.beds} beds; ` +
          `it must stay ${realGrowthBeforeActs.growth} / ${realGardenBeforeActs.seeds} / ${realGardenBeforeActs.plants} / ` +
          `${realGardenBeforeActs.beds}.`
      );
    }
    if (rawStorage().value !== realStorageBeforeActs.value) {
      problems.push("acting in the rehearsal wrote to the garden's save; the sandbox must never touch it.");
    }
    if (rawLastSeen() !== seenBeforeActs) {
      problems.push("acting in the rehearsal changed when the visitor was last seen; the sandbox must never touch it.");
    }

    // Reset puts the acted rehearsal back to the moment it opened.
    const resetBack = resetSandbox();
    if (resetBack.growth !== 1000 || resetBack.seeds !== 2 || resetBack.plants !== 1 || resetBack.beds !== 1) {
      problems.push(
        `resetting the acted rehearsal left ${resetBack.growth} growth / ${resetBack.seeds} seeds / ` +
          `${resetBack.plants} plants / ${resetBack.beds} beds, expected its start of 1000 / 2 / 1 / 1.`
      );
    }

    // Opening a bed inside the rehearsal widens the rehearsal alone, and is
    // only offered once the plot is full.
    const bedCost = nextBedCost(1);
    setGarden({ seeds: PLOT_CAPACITY });
    setGrowth(bedCost, 0);
    openSandbox();
    const openedBed = actInSandbox("open-bed");
    if (!openedBed.ok || openedBed.beds !== 2 || openedBed.capacity !== 2 * PLOT_CAPACITY) {
      problems.push(
        `opening a bed in the rehearsal left ${openedBed.beds} beds / ${openedBed.capacity} plots, ` +
          `expected 2 / ${2 * PLOT_CAPACITY}.`
      );
    }
    if (getGarden().beds !== 1) {
      problems.push(`opening a bed in the rehearsal changed the real garden to ${getGarden().beds} beds; it must stay 1.`);
    }

    // A rehearsal action the copy cannot take stays reachable and says why in
    // the rehearsal's own status line, exactly as the real panel's does.
    setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
    setGrowth(0, 0);
    openSandbox();
    const rehearsalPlant = document.getElementById("sandbox-plant-herb");
    const rehearsalOpenBed = document.getElementById("sandbox-open-bed");
    const rehearsalStatus = document.getElementById("sandbox-status");
    if (!rehearsalPlant || !rehearsalOpenBed || !rehearsalStatus) {
      problems.push("the sandbox has no plant control, open-bed control or status line, so its refusals cannot be checked.");
    } else {
      const plantProblem = availabilityProblem(
        rehearsalPlant,
        false,
        "the rehearsal's Plant a herb seed control on a full plot"
      );
      if (plantProblem) problems.push(plantProblem);
      const bedProblem = availabilityProblem(
        rehearsalOpenBed,
        false,
        "the rehearsal's Open the next bed control with no growth"
      );
      if (bedProblem) problems.push(bedProblem);
      rehearsalPlant.click();
      if (rehearsalStatus.textContent !== "The rehearsal's plot is full — open the next bed.") {
        problems.push(
          `pressing the rehearsal's Plant a herb seed control announced ${JSON.stringify(rehearsalStatus.textContent)} ` +
            'in #sandbox-status, expected "The rehearsal\'s plot is full — open the next bed."'
        );
      }
      if (getSandboxState().seeds !== PLOT_CAPACITY) {
        problems.push(
          `pressing the rehearsal's Plant a herb seed control on a full plot planted anyway: the rehearsal holds ` +
            `${getSandboxState().seeds} seeds, expected the unchanged ${PLOT_CAPACITY}.`
        );
      }
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
    restoreRawLastSeen(seenBefore);
  }
}

/**
 * The rehearsal has a way out. The panel carries a Close the rehearsal control
 * that puts the page back to the real garden: pressing it hides the panel,
 * offers Rehearse time again and reports no open sandbox, while the real garden,
 * its save and its last-seen moment are exactly as they were — the same promise
 * resetting makes, for the exit rather than the start.
 */
function checkSandboxClose(problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const seenBefore = rawLastSeen();
  try {
    const panel = document.getElementById("sandbox");
    const openButton = document.getElementById("open-sandbox");
    const closeButton = document.getElementById("sandbox-close");
    if (!closeButton) {
      problems.push(
        "the rehearsal panel has no Close the rehearsal control (#sandbox-close), so a rehearsal can be opened " +
          "but never closed."
      );
      return;
    }
    if (panel && !panel.contains(closeButton)) {
      problems.push("#sandbox-close is outside #sandbox, so it is not part of the rehearsal panel it closes.");
    }
    if (closeButton.tagName !== "BUTTON") {
      problems.push(
        `#sandbox-close is a ${closeButton.tagName}, not a BUTTON a keyboard can reach and a press can fire.`
      );
    }
    const label = String(closeButton.textContent ?? "").trim();
    if (!label) {
      problems.push("#sandbox-close has no visible label, so a visitor cannot tell what it does.");
    } else if (!/close/i.test(label) || !/rehearsal/i.test(label)) {
      problems.push(
        `the rehearsal's close control reads ${JSON.stringify(label)}, which does not name closing the rehearsal.`
      );
    }

    // Open a rehearsal on a known garden, then use the control to close it.
    setGarden({ seeds: 2, plants: 1 });
    setGrowth(0, 0.5, 0, 0, 3);
    const realGarden = getGarden();
    const realGrowth = getGrowthState();
    const realStorage = rawStorage();

    openSandbox();
    if (!getDisplayedState().sandbox.open) {
      problems.push("opening the rehearsal reported it closed, so its close control cannot be checked.");
      return;
    }
    if (closeButton.hidden || closeButton.tabIndex < 0) {
      problems.push(
        "the rehearsal's close control is hidden or out of the tab order, so it cannot be reached by keyboard."
      );
    }
    closeButton.click();

    if (panel && !panel.hidden) {
      problems.push("pressing Close the rehearsal left the rehearsal panel (#sandbox) showing.");
    }
    if (openButton && openButton.hidden) {
      problems.push(
        "pressing Close the rehearsal left #open-sandbox hidden, so there is no way back into a rehearsal."
      );
    }
    if (getDisplayedState().sandbox.open) {
      problems.push("pressing Close the rehearsal still reports an open sandbox.");
    }

    // Closing is not a change to the real garden: the same promise resetting
    // makes, so a visitor's garden, save and last-seen survive their rehearsal.
    const afterGarden = getGarden();
    const afterGrowth = getGrowthState();
    if (
      afterGarden.seeds !== realGarden.seeds ||
      afterGarden.plants !== realGarden.plants ||
      afterGrowth.growth !== realGrowth.growth ||
      afterGrowth.rate !== realGrowth.rate ||
      afterGrowth.bonus !== realGrowth.bonus
    ) {
      problems.push(
        `closing the rehearsal changed the real garden to ${afterGrowth.growth} growth / ${afterGrowth.rate}/s / ` +
          `${afterGrowth.bonus} bonus / ${afterGarden.seeds} seeds / ${afterGarden.plants} plants; it must stay ` +
          `${realGrowth.growth} / ${realGrowth.rate} / ${realGrowth.bonus} / ${realGarden.seeds} / ${realGarden.plants}.`
      );
    }
    if (rawStorage().value !== realStorage.value) {
      problems.push("closing the rehearsal wrote to the garden's save; the sandbox must never touch it.");
    }
    if (rawLastSeen() !== seenBefore) {
      problems.push("closing the rehearsal changed when the visitor was last seen; the sandbox must never touch it.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
    restoreRawLastSeen(seenBefore);
    closeSandbox();
  }
}

async function checkAgentTools(problems) {
  let tools;
  try {
    ({ tools } = await import("./agenttools.js"));
  } catch (e) {
    problems.push(`docs/agenttools.js could not be imported — ${e.message}`);
    return;
  }

  const list = tools();
  const find = (name) => list.find((tool) => tool.name === name);
  const readTool = find("get-state");
  const exportTool = find("export-save");
  const importTool = find("import-save");
  const restoreTool = find("restore-save");
  if (!readTool || !exportTool || !importTool || !restoreTool) {
    problems.push("agenttools.js must expose get-state, export-save, import-save and restore-save.");
    return;
  }

  const state = await readTool.execute({}, {});
  const shown = getDisplayedState();
  // Both kinds are reported: an agent can read each kind's cost, count and
  // production without seeing the screen.
  if (!Array.isArray(state.kinds) || state.kinds.length !== 2) {
    problems.push(
      `get-state reported ${JSON.stringify(state.kinds?.length ?? state.kinds)} seed kinds, expected the garden's two.`
    );
  } else {
    const keys = state.kinds.map((kind) => kind.key);
    if (keys[0] !== "herb" || keys[1] !== "bloom") {
      problems.push(`get-state's kinds are ${JSON.stringify(keys)}, expected ["herb", "bloom"].`);
    }
    for (const kind of state.kinds) {
      const live = SEED_KINDS[kind.index];
      if (
        kind.cost !== nextSeedCost(kind.total, kind.index) ||
        kind.production !== live.production ||
        kind.growSeconds !== live.growSeconds ||
        typeof kind.seeds !== "number" ||
        typeof kind.plants !== "number" ||
        typeof kind.canPlant !== "boolean"
      ) {
        problems.push(
          `get-state's ${kind.key} kind reported ${JSON.stringify(kind)}, which does not carry its own ` +
            "cost, production, growing time, seed and plant counts and canPlant."
        );
      }
    }
    const herbKind = state.kinds[0];
    const bloomKind = state.kinds[1];
    if (herbKind.seeds !== shown.seedCounts[0] || bloomKind.seeds !== shown.seedCounts[1]) {
      problems.push(
        `get-state reported ${herbKind.seeds} herb seeds / ${bloomKind.seeds} bloom seeds, but the page holds ` +
          `${shown.seedCounts[0]} / ${shown.seedCounts[1]}.`
      );
    }
    if (herbKind.cost !== nextSeedCost(herbKind.total, 0) || bloomKind.cost !== nextSeedCost(bloomKind.total, 1)) {
      problems.push("get-state's kind costs do not match nextSeedCost against each kind's own count.");
    }
  }
  if (state.seeds !== shown.seeds || state.plants !== shown.plants || state.capacity !== shown.capacity) {
    problems.push(
      `get-state reported ${state.seeds} seeds / ${state.plants} plants, but the page holds ` +
      `${shown.seeds} / ${shown.plants}.`
    );
  }
  if (
    state.growth !== shown.growth ||
    state.rate !== shown.rate ||
    state.form !== shown.form ||
    state.formName !== shown.formName
  ) {
    problems.push(
      `get-state reported growth ${state.growth} at ${state.rate}/s as form ${state.form} ` +
      `"${state.formName}", but the page shows ${shown.growth} at ${shown.rate}/s as form ` +
      `${shown.form} "${shown.formName}".`
    );
  }
  if (state.lifetimeGrowth !== shown.lifetimeGrowth || state.replantBonus !== shown.replantBonus) {
    problems.push(
      `get-state reported a lifetime of ${state.lifetimeGrowth} worth a replant bonus of ${state.replantBonus}, ` +
        `but the page holds ${shown.lifetimeGrowth} worth ${shown.replantBonus}.`
    );
  }
  if (state.replantBonus !== replantBonus(state.lifetimeGrowth)) {
    problems.push(
      `get-state's replant bonus is ${state.replantBonus}, but a replant of ${state.lifetimeGrowth} lifetime is ` +
        `worth ${replantBonus(state.lifetimeGrowth)}.`
    );
  }
  if (state.bonus !== shown.bonus || state.canReplant !== shown.canReplant) {
    problems.push(
      `get-state reported bonus ${state.bonus} / canReplant ${state.canReplant}, but the page holds ` +
        `${shown.bonus} / ${shown.canReplant}.`
    );
  }
  if (state.canReplant !== canReplant(state.lifetimeGrowth)) {
    problems.push(
      `get-state's canReplant is ${state.canReplant}, but a lifetime of ${state.lifetimeGrowth} is ` +
        `worth ${canReplant(state.lifetimeGrowth)}.`
    );
  }
  if (state.save !== shown.save) {
    problems.push("get-state's save does not match the save the page shows.");
  }
  if (typeof state.restoreAvailable !== "boolean" || state.restoreAvailable !== shown.restoreAvailable) {
    problems.push(
      `get-state reported restoreAvailable=${JSON.stringify(state.restoreAvailable)}, expected the boolean the page ` +
        `holds (${JSON.stringify(shown.restoreAvailable)}).`
    );
  }
  // A garden with a visitor at it is told apart from one growing alone: the
  // presence is a boolean an agent reads, the same one the page holds.
  if (typeof state.visitPresent !== "boolean" || state.visitPresent !== shown.visitPresent) {
    problems.push(
      `get-state reported visitPresent=${JSON.stringify(state.visitPresent)}, expected the boolean the page holds ` +
        `(${JSON.stringify(shown.visitPresent)}).`
    );
  }
  if (
    state.secondsToNextPlant !== shown.secondsToNextPlant ||
    state.growSeconds !== shown.growSeconds ||
    state.totalPlanted !== shown.totalPlanted
  ) {
    problems.push(
      `get-state reported ${state.secondsToNextPlant}s to the next plant / ${state.growSeconds}s growing time / ` +
        `${state.totalPlanted} planted, but the page holds ${shown.secondsToNextPlant} / ${shown.growSeconds} / ` +
        `${shown.totalPlanted}.`
    );
  }
  for (const field of ["beds", "capacity", "nextBedCost", "canOpenBed", "bedCostProgress", "secondsToNextBed"]) {
    if (state[field] !== shown[field]) {
      problems.push(
        `get-state reported ${field}=${JSON.stringify(state[field])}, but the page holds ${JSON.stringify(shown[field])}.`
      );
    }
  }

  if (JSON.stringify(state.pollinator) !== JSON.stringify(shown.pollinator)) {
    problems.push(
      `get-state reported the pollinator as ${JSON.stringify(state.pollinator)}, but the page holds ` +
        `${JSON.stringify(shown.pollinator)}.`
    );
  }
  if (JSON.stringify(state.season) !== JSON.stringify(shown.season)) {
    problems.push(
      `get-state reported the season as ${JSON.stringify(state.season)}, but the page holds ` +
        `${JSON.stringify(shown.season)}.`
    );
  }

  if (JSON.stringify(state.away) !== JSON.stringify(shown.away)) {
    problems.push("get-state's away does not match the page's return report.");
  }

  if (JSON.stringify(state.visit) !== JSON.stringify(shown.visit)) {
    problems.push(
      `get-state's visit ${JSON.stringify(state.visit)} does not match the page's visit record ` +
        `${JSON.stringify(shown.visit)}.`
    );
  }

  const tendTool = find("tend");
  if (!tendTool) {
    problems.push("agenttools.js has no tend tool, so an agent cannot do what the Tend button does.");
  } else {
    const gardenBefore = getGarden();
    const growthBefore = getGrowthState();
    try {
      const result = await tendTool.execute({}, {});
      const after = getGrowthState();
      if (
        after.growth !== growthBefore.growth + TEND_YIELD ||
        Math.abs(after.rate - (growthBefore.rate + TEND_RATE_STEP)) > 1e-9
      ) {
        problems.push(
          `the tend tool left the garden at ${after.growth} growth / ${after.rate}/s, but the Tend button would ` +
          `give ${growthBefore.growth + TEND_YIELD} / ${growthBefore.rate + TEND_RATE_STEP}.`
        );
      }
      if (result.growth !== after.growth || result.rate !== after.rate) {
        problems.push(
          `the tend tool returned growth ${result.growth} at ${result.rate}/s, but the garden now holds ` +
          `${after.growth} at ${after.rate}/s.`
        );
      }
      // The tend tool records the visitor's own tending, exactly as the button
      // does: the visit's tended count rises by one.
      if (getGarden().visit.tended !== gardenBefore.visit.tended + 1) {
        problems.push(
          `the tend tool left the visit at ${getGarden().visit.tended} tended, expected ` +
            `${gardenBefore.visit.tended + 1} — the same count the Tend button records.`
        );
      }
    } finally {
      setGarden(gardenBefore);
      restoreGrowth(growthBefore);
    }
  }

  const plantTool = find("plant-seed");
  if (!plantTool) {
    problems.push(
      "agenttools.js has no plant-seed tool, so an agent cannot do what the page's Plant a seed button does."
    );
  } else {
    const gardenBefore = getGarden();
    const growthBefore = getGrowthState();
    const storageBefore = rawStorage();
    try {
      setGarden({ seeds: 1, plants: 0 });
      const cost = nextSeedCost(1);
      setGrowth(cost, 0.2);
      const result = await plantTool.execute({}, {});
      const after = getGrowthState();
      const gardenAfter = getGarden();
      if (!result.ok || result.cost !== cost) {
        problems.push(
          `the plant-seed tool reported ok=${result.ok} cost=${result.cost}, expected ok=true cost=${cost}.`
        );
      }
      if (after.growth !== 0 || Math.abs(after.rate - 0.2) > 1e-9 || gardenAfter.seeds !== 2) {
        problems.push(
          `the plant-seed tool left the garden at ${after.growth} growth / ${after.rate}/s / ` +
            `${gardenAfter.seeds} seeds, expected 0 / the unchanged 0.2 / 2 sprouts.`
        );
      }
      if (!result.state || result.state.seeds !== 2 || result.state.rate !== after.rate) {
        problems.push("the plant-seed tool did not return the state after planting.");
      }
      if (gardenAfter.seeds !== 2 || gardenAfter.plants !== 0) {
        problems.push(
          `the plant-seed tool left ${gardenAfter.seeds} sprouts / ${gardenAfter.plants} plants, expected 2 / 0.`
        );
      }

      // The seed only speeds the garden up once it has grown up.
      advance(GROW_SECONDS);
      if (getGarden().plants !== 2 || Math.abs(getGrowthState().rate - (0.2 + 2 * PLANT_PRODUCTION)) > 1e-9) {
        problems.push(
          `after the planted seeds matured the tool side of the garden holds ${getGarden().plants} plants at ` +
            `${getGrowthState().rate}/s, expected 2 plants at ${0.2 + 2 * PLANT_PRODUCTION}/s.`
        );
      }

      // Refusing when unaffordable must change nothing at all.
      setGarden({ seeds: 1, plants: 0 });
      setGrowth(0, 0);
      const refused = await plantTool.execute({}, {});
      const untouched = getGarden();
      const untouchedGrowth = getGrowthState();
      if (refused.ok) {
        problems.push("the plant-seed tool planted a seed with no growth to pay for it.");
      }
      if (untouched.seeds !== 1 || untouchedGrowth.growth !== 0 || untouchedGrowth.rate !== 0) {
        problems.push("the plant-seed tool changed the garden even though it refused.");
      }

      // A full plot refuses too, even with growth to spare.
      setGarden({ seeds: PLOT_CAPACITY, plants: 0 });
      setGrowth(nextSeedCost(PLOT_CAPACITY) * 2, 0);
      const fullRefused = await plantTool.execute({}, {});
      if (fullRefused.ok || getGarden().seeds !== PLOT_CAPACITY) {
        problems.push(
          `the plant-seed tool planted seed ${getGarden().seeds} on a full plot of ${PLOT_CAPACITY}; it must refuse.`
        );
      }

      // The second kind: naming "bloom" plants a bloom, priced and matured as
      // a bloom, and the state afterwards reports both kinds.
      setGarden({ seeds: 0, plants: 0 });
      const bloomCost = nextSeedCost(0, "bloom");
      setGrowth(bloomCost, 0);
      const bloomPlanted = await plantTool.execute({ kind: "bloom" }, {});
      const afterBloom = getGarden();
      const afterBloomGrowth = getGrowthState();
      if (!bloomPlanted.ok || bloomPlanted.cost !== bloomCost || bloomPlanted.kind !== "bloom") {
        problems.push(
          `the plant-seed tool reported ${JSON.stringify(bloomPlanted)} for a bloom, expected ok=true, ` +
            `cost ${bloomCost}, kind "bloom".`
        );
      }
      if (afterBloomGrowth.growth !== 0 || afterBloom.bloomSprouts.length !== 1 || afterBloom.plantCounts[0] !== 0) {
        problems.push(
          `the plant-seed tool left a bloom as ${afterBloomGrowth.growth} growth / ` +
            `${afterBloom.bloomSprouts.length} bloom sprouts / ${JSON.stringify(afterBloom.plantCounts)}, ` +
            "expected 0 / 1 bloom sprout / no herb plants."
        );
      }
      const bloomState = await readTool.execute({}, {});
      const bloomEntry = (bloomState.kinds ?? []).find((kind) => kind.key === "bloom");
      if (!bloomEntry || bloomEntry.seeds !== 1 || bloomEntry.production !== SEED_KINDS[1].production) {
        problems.push(
          `get-state after planting a bloom reports the bloom kind as ${JSON.stringify(bloomEntry)}, ` +
            "expected one ungrown bloom seed at the bloom production."
        );
      }

      // An unrecognised kind falls back to herb rather than failing or
      // planting nothing.
      setGarden({ seeds: 0, plants: 0 });
      setGrowth(nextSeedCost(0, "herb"), 0);
      const fallback = await plantTool.execute({ kind: "fern" }, {});
      if (!fallback.ok || fallback.kind !== "herb" || getGarden().bloomSprouts.length !== 0) {
        problems.push(
          `the plant-seed tool answered an unknown kind with ${JSON.stringify(fallback)}, ` +
            "expected a herb seed as the fallback."
        );
      }
    } finally {
      setGarden(gardenBefore);
      restoreGrowth(growthBefore);
      restoreRawStorage(storageBefore);
    }
  }

  const openTool = find("open-bed");
  if (!openTool) {
    problems.push("agenttools.js has no open-bed tool, so an agent cannot do what the Open the next bed button does.");
  } else {
    const gardenBefore = getGarden();
    const growthBefore = getGrowthState();
    const storageBefore = rawStorage();
    try {
      // Refused while the plot still has room to plant.
      setGarden({ beds: 1, seeds: 1, plants: 0 });
      setGrowth(nextBedCost(1) * 2, 0);
      const early = await openTool.execute({}, {});
      if (early.ok || getGarden().beds !== 1) {
        problems.push("the open-bed tool opened a bed while the plot still had room to plant.");
      }

      // Refused without the growth to pay for it.
      setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
      setGrowth(nextBedCost(1) - 1, 0);
      const poor = await openTool.execute({}, {});
      if (poor.ok || getGarden().beds !== 1) {
        problems.push("the open-bed tool opened a bed with less growth than it costs.");
      }

      // Opened on a full plot with the price saved.
      setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
      const bedCost = nextBedCost(1);
      setGrowth(bedCost, 0);
      const openedResult = await openTool.execute({}, {});
      const afterGarden = getGarden();
      const afterGrowth = getGrowthState();
      if (!openedResult.ok || openedResult.cost !== bedCost || openedResult.beds !== 2) {
        problems.push(
          `the open-bed tool reported ok=${openedResult.ok} cost=${openedResult.cost} beds=${openedResult.beds}, ` +
            `expected ok=true cost=${bedCost} beds=2.`
        );
      }
      if (afterGarden.beds !== 2 || afterGarden.capacity !== PLOTS_PER_BED * 2 || afterGrowth.growth !== 0) {
        problems.push(
          `the open-bed tool left the garden at ${afterGarden.beds} beds / ${afterGarden.capacity} plots / ` +
            `${afterGrowth.growth} growth, expected 2 / ${PLOTS_PER_BED * 2} / 0.`
        );
      }
      if (!openedResult.state || openedResult.state.beds !== 2 || openedResult.state.capacity !== PLOTS_PER_BED * 2) {
        problems.push("the open-bed tool did not return the state after opening.");
      }
    } finally {
      setGarden(gardenBefore);
      restoreGrowth(growthBefore);
      restoreRawStorage(storageBefore);
    }
  }

  const replantTool = find("replant");
  if (!replantTool) {
    problems.push("agenttools.js has no replant tool, so an agent cannot do what the Replant button does.");
  } else {
    const gardenBefore = getGarden();
    const growthBefore = getGrowthState();
    const storageBefore = rawStorage();
    try {
      // The requirement must be discoverable from the tool's own words.
      if (!/confirm/i.test(replantTool.description ?? "")) {
        problems.push("the replant tool's description does not tell an agent that a replant must be confirmed.");
      }

      // Below the wall, a call without confirmation previews and changes nothing.
      setGarden({ seeds: 1, plants: 0, beds: 1 });
      setGrowth(999, 2.5, 300, REPLANT_MIN_BONUS * REPLANT_MIN_BONUS - 1);
      const belowPreview = await replantTool.execute({}, {});
      if (belowPreview.applied !== false || belowPreview.needsConfirmation !== true || belowPreview.preview?.canReplant !== false) {
        problems.push(
          `the replant tool below the wall returned ${JSON.stringify({
            applied: belowPreview.applied,
            needsConfirmation: belowPreview.needsConfirmation,
            canReplant: belowPreview.preview?.canReplant,
          })}, expected an unconfirmed preview that reports the garden cannot be replanted.`
        );
      }
      const stillBelow = getGarden();
      if (stillBelow.seeds !== 1 || stillBelow.plants !== 0 || getGrowthState().growth !== 999) {
        problems.push("the replant tool changed a garden below the wall without confirmation.");
      }

      // Eligible: a call without confirmation reports what a replant would
      // reset, what it would keep and the bonus it would earn, and touches
      // nothing.
      const wallLifetime = REPLANT_MIN_BONUS * REPLANT_MIN_BONUS;
      setGarden({ beds: 2, seeds: 3, plants: 4 });
      setGrowth(500, 3, 120, wallLifetime);
      const preview = await replantTool.execute({}, {});
      if (preview.ok !== true || preview.applied !== false || preview.needsConfirmation !== true) {
        problems.push(
          `the replant tool without confirmation returned ok=${preview.ok} / applied=${preview.applied} / ` +
            `needsConfirmation=${preview.needsConfirmation}, expected a preview that applied nothing.`
        );
      }
      if (preview.preview?.canReplant !== true || preview.preview?.bonus !== replantBonus(wallLifetime)) {
        problems.push(
          `the replant preview reported canReplant=${preview.preview?.canReplant} / bonus=${preview.preview?.bonus}, ` +
            `expected true / ${replantBonus(wallLifetime)}.`
        );
      }
      const resets = preview.preview?.resets;
      if (!resets || resets.growth !== 500 || resets.seeds !== 3 || resets.plants !== 4 || resets.beds !== 2) {
        problems.push(
          `the replant preview said it would reset ${JSON.stringify(resets)}, expected growth 500 / seeds 3 / ` +
            "plants 4 / beds 2."
        );
      }
      const keeps = preview.preview?.keeps;
      if (!keeps || keeps.lifetime !== wallLifetime || keeps.bonus !== 0) {
        problems.push(
          `the replant preview said it would keep ${JSON.stringify(keeps)}, expected lifetime ${wallLifetime} / bonus 0.`
        );
      }
      const beforeConfirm = getGarden();
      const beforeConfirmGrowth = getGrowthState();
      if (
        beforeConfirm.seeds !== 3 ||
        beforeConfirm.plants !== 4 ||
        beforeConfirm.beds !== 2 ||
        beforeConfirmGrowth.growth !== 500 ||
        beforeConfirmGrowth.lifetime !== wallLifetime ||
        beforeConfirmGrowth.bonus !== 0
      ) {
        problems.push("the replant tool changed an eligible garden without confirmation.");
      }

      // Only confirm: true actually replants, carrying the lifetime into the bonus.
      const done = await replantTool.execute({ confirm: true }, {});
      const afterGarden = getGarden();
      const afterGrowth = getGrowthState();
      if (done.applied !== true || !done.ok || done.bonus !== replantBonus(wallLifetime) || done.lifetime !== wallLifetime) {
        problems.push(
          `the confirmed replant tool reported ${JSON.stringify({
            ok: done.ok,
            applied: done.applied,
            bonus: done.bonus,
            lifetime: done.lifetime,
          })}, expected ok=true, applied=true, bonus ${replantBonus(wallLifetime)}, lifetime ${wallLifetime}.`
        );
      }
      if (
        afterGarden.beds !== 1 ||
        afterGarden.seeds !== 1 ||
        afterGarden.plants !== 0 ||
        afterGrowth.growth !== 0 ||
        afterGrowth.lifetime !== wallLifetime ||
        afterGrowth.bonus !== replantBonus(wallLifetime)
      ) {
        problems.push(
          `the confirmed replant tool left ${afterGarden.beds} beds / ${afterGarden.seeds} seeds / ` +
            `${afterGarden.plants} plants / ${afterGrowth.growth} growth / ${afterGrowth.lifetime} lifetime / ` +
            `${afterGrowth.bonus} bonus, expected 1 / 1 / 0 / 0 / ${wallLifetime} / ${replantBonus(wallLifetime)}.`
        );
      }
      if (!done.state || done.state.bonus !== afterGrowth.bonus || done.state.canReplant !== canReplant(afterGrowth.lifetime)) {
        problems.push("the replant tool did not return the state after replanting.");
      }
    } finally {
      setGarden(gardenBefore);
      restoreGrowth(growthBefore);
      restoreRawStorage(storageBefore);
    }
  }

  const dismissTool = find("dismiss-return");
  if (!dismissTool) {
    problems.push(
      "agenttools.js has no dismiss-return tool, so an agent cannot do what the page's Dismiss control does."
    );
  } else {
    if (dismissTool.annotations?.readOnlyHint !== false) {
      problems.push("dismiss-return must be annotated readOnlyHint: false — it clears the return marks.");
    }
    const gardenBefore = getGarden();
    const growthBefore = getGrowthState();
    const storageBefore = rawStorage();
    try {
      // A return leaves marks; the tool acknowledges them and reports the clear,
      // matching what the plot and the readout now show.
      const saved = { version: SAVE_VERSION, seeds: 2, plants: 1, growth: 0, rate: 0.5 };
      setGarden({ seeds: 2, plants: 1 });
      setGrowth(saved.growth, saved.rate);
      const nowMs = 1_700_000_000_000;
      applyReturn(saved, nowMs - 30 * 86400 * 1000, nowMs);
      if (getDisplayedState().returnMarks === null) {
        problems.push("a 30-day return before the dismiss-return tool marked nothing, so the tool could not be checked.");
      } else {
        const result = await dismissTool.execute({}, {});
        if (result.returnMarks !== null || getDisplayedState().returnMarks !== null) {
          problems.push(
            `the dismiss-return tool returned returnMarks ${JSON.stringify(result.returnMarks)}; dismissing must clear them.`
          );
        }
      }
    } finally {
      clearReturnMarks();
      setGarden(gardenBefore);
      restoreGrowth(growthBefore);
      restoreRawStorage(storageBefore);
    }
  }

  const openSandboxTool = find("open-sandbox");
  const fastForwardTool = find("fast-forward-sandbox");
  const resetSandboxTool = find("reset-sandbox");
  const closeSandboxTool = find("close-sandbox");
  if (!openSandboxTool || !fastForwardTool || !resetSandboxTool) {
    problems.push(
      "agenttools.js must expose open-sandbox, fast-forward-sandbox and reset-sandbox, " +
        "so an agent can rehearse time the way the page's sandbox can."
    );
  } else {
    const gardenBefore = getGarden();
    const growthBefore = getGrowthState();
    const storageBefore = rawStorage();
    const seenBefore = rawLastSeen();
    try {
      setGarden({ seeds: 2, plants: 1 });
      setGrowth(0, 0.5);

      const opened = await openSandboxTool.execute({}, {});
      if (!opened.sandbox?.open || opened.sandbox.seconds !== 0) {
        problems.push("the open-sandbox tool did not report an open sandbox at its start.");
      }
      const copied = getSandboxState();
      if (copied.growth !== 0 || copied.seeds !== 2 || copied.plants !== 1) {
        problems.push(
          `the open sandbox holds ${copied.growth} growth / ${copied.seeds} seeds / ${copied.plants} plants, ` +
            "expected a copy of the real 0 / 2 / 1."
        );
      }
      if (!getDisplayedState().sandbox?.open) {
        problems.push("get-state does not report the sandbox the open-sandbox tool opened.");
      }

      const forwarded = await fastForwardTool.execute({ span: "day" }, {});
      if (!forwarded.sandbox?.open || forwarded.sandbox.seconds !== 86400) {
        problems.push(
          `the fast-forward-sandbox tool left the sandbox at ` +
            `${forwarded.sandbox?.seconds ?? "no"} seconds, expected 86400.`
        );
      }
      if (!(forwarded.sandbox.growth > copied.growth)) {
        problems.push("fast-forwarding the sandbox a day grew nothing.");
      }

      // The real garden, its save and its clock must be exactly where they were.
      const realGarden = getGarden();
      const realGrowth = getGrowthState();
      if (
        realGarden.seeds !== 2 ||
        realGarden.plants !== 1 ||
        realGrowth.growth !== 0 ||
        Math.abs(realGrowth.rate - 0.5) > 1e-9
      ) {
        problems.push(
          `a sandbox fast-forward changed the real garden to ${realGrowth.growth} growth / ` +
            `${realGarden.seeds} seeds / ${realGarden.plants} plants; it must stay 0 / 2 / 1.`
        );
      }
      if (rawStorage().value !== storageBefore.value) {
        problems.push("a sandbox tool wrote to the garden's save; the sandbox must never touch it.");
      }

      const reset = await resetSandboxTool.execute({}, {});
      if (!reset.sandbox?.open || reset.sandbox.seconds !== 0 || reset.sandbox.growth !== 0) {
        problems.push("the reset-sandbox tool did not put the sandbox back to its start.");
      }

      // Closing is the one undo for opening: an agent that opened a rehearsal
      // can always put the page back, and the sandbox reports it closed without
      // touching anything real.
      if (!closeSandboxTool) {
        problems.push("agenttools.js must expose close-sandbox, so an agent can put away a rehearsal it opened.");
      } else {
        const description = closeSandboxTool.description ?? "";
        if (!/undo/i.test(description) || !/open-sandbox/i.test(description)) {
          problems.push(
            "the close-sandbox tool's description does not say it undoes open-sandbox, so a caller cannot know it " +
              "is the way out of the rehearsal."
          );
        }
        const closed = await closeSandboxTool.execute({}, {});
        if (closed.sandbox?.open || getDisplayedState().sandbox?.open) {
          problems.push("the close-sandbox tool left the sandbox open; it must put the rehearsal away.");
        }
        const realAfterClose = getGarden();
        if (realAfterClose.seeds !== 2 || realAfterClose.plants !== 1 || getGrowthState().growth !== 0) {
          problems.push("the close-sandbox tool changed the real garden.");
        }
        if (rawStorage().value !== storageBefore.value) {
          problems.push("a close-sandbox call wrote to the garden's save; the sandbox must never touch it.");
        }
      }

      const actTool = find("act-in-sandbox");
      if (!actTool) {
        problems.push(
          "agenttools.js must expose act-in-sandbox so an agent can tend, plant and open a bed inside the rehearsal."
        );
      } else {
        for (let i = 0; i < 8; i += 1) await actTool.execute({ action: "tend" }, {});
        const planted = await actTool.execute({ action: "plant-herb" }, {});
        if (!planted.ok || !planted.state?.sandbox?.open) {
          problems.push("the act-in-sandbox tool did not plant a herb seed in the rehearsal.");
        } else if (planted.state.sandbox.seeds !== 3) {
          problems.push(
            `the act-in-sandbox tool left the rehearsal with ${planted.state.sandbox.seeds} seeds, expected 3.`
          );
        }
        if (!planted.state?.sandbox?.status) {
          problems.push("the act-in-sandbox tool returned no status for the action it took.");
        }
        const readBack = await readTool.execute({}, {});
        if (!readBack.sandbox?.open || readBack.sandbox.seeds !== 3) {
          problems.push("get-state does not report the rehearsal the act-in-sandbox tool acted on.");
        }
        const realAfterActs = getGarden();
        if (realAfterActs.seeds !== 2 || realAfterActs.plants !== 1 || getGrowthState().growth !== 0) {
          problems.push("acting in the sandbox tool changed the real garden.");
        }
        if (rawStorage().value !== storageBefore.value) {
          problems.push("an act-in-sandbox call wrote to the garden's save; the sandbox must never touch it.");
        }

        // Opening a bed inside the rehearsal widens only the rehearsal's soil.
        setGarden({ seeds: PLOT_CAPACITY });
        setGrowth(nextBedCost(1), 0);
        await openSandboxTool.execute({}, {});
        const bedAct = await actTool.execute({ action: "open-bed" }, {});
        if (!bedAct.ok || bedAct.beds !== 2) {
          problems.push(`the act-in-sandbox open-bed left ${bedAct.beds} beds, expected 2.`);
        }
        if (getGarden().beds !== 1) {
          problems.push("the act-in-sandbox open-bed changed the real garden's beds.");
        }
      }
    } finally {
      setGarden(gardenBefore);
      restoreGrowth(growthBefore);
      restoreRawStorage(storageBefore);
      restoreRawLastSeen(seenBefore);
    }
  }

  const exported = await exportTool.execute({}, {});
  if (exported.save !== shown.save) {
    problems.push("export-save returned a different save than the page shows.");
  }

  await checkImportSaveGate(importTool, problems);
  await checkRestoreSaveTool(restoreTool, readTool, importTool, problems);
}

/**
 * The restore-save tool is the agent's half of the page's Restore previous
 * garden button: after a load has replaced a garden it puts that garden back
 * with the same values, reports what came back, and spends the kept garden so a
 * second call is a safe no-op and get-state stops offering it.
 */
async function checkRestoreSaveTool(restoreTool, readTool, importTool, problems) {
  if (restoreTool.annotations?.readOnlyHint !== false || restoreTool.annotations?.consequentialHint !== true) {
    problems.push(
      "restore-save must be annotated readOnlyHint: false and consequentialHint: true — it replaces the garden."
    );
  }
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const seenBefore = rawLastSeen();
  try {
    // A known garden, then an agent's own confirmed load replaces it.
    setGarden({ beds: 2, seeds: 3, plants: 2 });
    setGrowth(70, 0, 120, 700, 6);
    const kept = getGarden();
    const keptGrowth = getGrowthState();
    const loaded = await importTool.execute(
      { save: encodeSave({ beds: 3, seeds: 5, plants: 4, growth: 45, lifetime: 2500 }), confirm: true },
      {}
    );
    if (loaded.applied !== true) {
      problems.push("a confirmed import-save did not load, so restore-save could not be checked against it.");
    }

    const readBefore = await readTool.execute({}, {});
    if (readBefore.restoreAvailable !== true) {
      problems.push("get-state reported nothing to restore right after a load had replaced the garden.");
    }

    const restored = await restoreTool.execute({}, {});
    const back = getGarden();
    const backGrowth = getGrowthState();
    if (
      restored.restored !== true ||
      back.seeds !== kept.seeds ||
      back.plants !== kept.plants ||
      back.beds !== kept.beds ||
      backGrowth.growth !== keptGrowth.growth ||
      backGrowth.lifetime !== keptGrowth.lifetime ||
      backGrowth.bonus !== keptGrowth.bonus
    ) {
      problems.push(
        `restore-save left ${back.seeds} seeds / ${back.plants} plants / ${back.beds} beds / ${backGrowth.growth} ` +
          `growth / ${backGrowth.lifetime} lifetime / ${backGrowth.bonus} bonus, expected the kept ` +
          `${kept.seeds} / ${kept.plants} / ${kept.beds} / ${keptGrowth.growth} / ${keptGrowth.lifetime} / ` +
          `${keptGrowth.bonus}.`
      );
    }
    if (
      !restored.restoredContents ||
      restored.restoredContents.growth !== keptGrowth.growth ||
      restored.restoredContents.seeds !== kept.seeds ||
      restored.restoredContents.beds !== kept.beds
    ) {
      problems.push(
        `restore-save reported ${JSON.stringify(restored.restoredContents)}, expected the kept garden's growth, ` +
          "seeds and beds."
      );
    }

    const readAfter = await readTool.execute({}, {});
    if (readAfter.restoreAvailable !== false) {
      problems.push("get-state still offers a garden to restore after restore-save spent it.");
    }

    const second = await restoreTool.execute({}, {});
    const afterSecond = getGarden();
    if (second.ok !== false || second.restored !== false) {
      problems.push(
        `a second restore-save reported ok=${second.ok} / restored=${second.restored}, expected a no-op with a reason.`
      );
    }
    if (afterSecond.seeds !== back.seeds || afterSecond.plants !== back.plants || afterSecond.beds !== back.beds) {
      problems.push("a second restore-save changed the garden even though there was nothing kept.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
    restoreRawLastSeen(seenBefore);
  }
}

/**
 * import-save must be confirm-first: a call with a save but no confirmation
 * changes nothing — not the garden, not the stored save — and reports what the
 * load would replace; only `confirm: true` applies it. An unreadable save is
 * refused either way and leaves the garden exactly as it was.
 */
async function checkImportSaveGate(importTool, problems) {
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const seenBefore = rawLastSeen();
  try {
    setGarden({ beds: 2, seeds: 3, plants: 2 });
    setGrowth(70, 1.5, 120, 700, 6);
    writeStoredGarden(getGarden());

    // A different but valid garden to load.
    const portable = encodeSave({ beds: 1, seeds: 5, plants: 4, growth: 45, lifetime: 2500 });
    const incoming = decodeSave(portable);
    const liveGarden = getGarden();
    const liveGrowth = getGrowthState();
    const storedLive = rawStorage().value;

    const preview = await importTool.execute({ save: portable }, {});
    if (preview.ok !== true || preview.applied !== false || preview.needsConfirmation !== true) {
      problems.push(
        `import-save without confirmation returned ok=${preview.ok} / applied=${preview.applied} / ` +
          `needsConfirmation=${preview.needsConfirmation}, expected a preview that applied nothing.`
      );
    }
    if (!preview.preview || !preview.preview.current || !preview.preview.incoming) {
      problems.push("import-save without confirmation did not report what a load would replace.");
    } else {
      const { current, incoming: next } = preview.preview;
      if (
        current.growth !== liveGrowth.growth ||
        current.seeds !== liveGarden.seeds ||
        current.plants !== liveGarden.plants ||
        current.beds !== liveGarden.beds ||
        current.lifetime !== liveGrowth.lifetime
      ) {
        problems.push(
          `the import-save preview reported the garden now as ${JSON.stringify(current)}, but it holds ` +
            `${JSON.stringify({
              growth: liveGrowth.growth,
              seeds: liveGarden.seeds,
              plants: liveGarden.plants,
              beds: liveGarden.beds,
              lifetime: liveGrowth.lifetime,
            })}.`
        );
      }
      if (
        next.growth !== incoming.growth ||
        next.seeds !== incoming.seeds ||
        next.plants !== incoming.plants ||
        next.beds !== incoming.beds ||
        next.lifetime !== incoming.lifetime
      ) {
        problems.push(
          `the import-save preview said the save holds ${JSON.stringify(next)}, but it decodes to ` +
            `${JSON.stringify({
              growth: incoming.growth,
              seeds: incoming.seeds,
              plants: incoming.plants,
              beds: incoming.beds,
              lifetime: incoming.lifetime,
            })}.`
        );
      }
      if (!Array.isArray(preview.preview.changes) || preview.preview.changes.length === 0) {
        problems.push("the import-save preview reported no changes for a save that differs from the garden.");
      }
    }

    const afterPreview = getGarden();
    const afterPreviewGrowth = getGrowthState();
    if (
      afterPreview.seeds !== liveGarden.seeds ||
      afterPreview.plants !== liveGarden.plants ||
      afterPreview.beds !== liveGarden.beds ||
      afterPreviewGrowth.growth !== liveGrowth.growth ||
      afterPreviewGrowth.lifetime !== liveGrowth.lifetime
    ) {
      problems.push("import-save without confirmation changed the garden even though nothing was applied.");
    }
    if (rawStorage().value !== storedLive) {
      problems.push("import-save without confirmation wrote the stored save even though nothing was applied.");
    }

    const applied = await importTool.execute({ save: portable, confirm: true }, {});
    if (applied.ok !== true || applied.applied !== true) {
      problems.push(
        `import-save with confirm: true returned ok=${applied.ok} / applied=${applied.applied}, expected it to load the save.`
      );
    }
    const loaded = getGarden();
    const loadedGrowth = getGrowthState();
    if (
      loaded.seeds !== incoming.seeds ||
      loaded.plants !== incoming.plants ||
      loaded.beds !== incoming.beds ||
      loadedGrowth.growth !== incoming.growth ||
      loadedGrowth.lifetime !== incoming.lifetime
    ) {
      problems.push(
        `import-save with confirm: true left ${loaded.seeds} seeds / ${loaded.plants} plants / ${loaded.beds} beds / ` +
          `${loadedGrowth.growth} growth / ${loadedGrowth.lifetime} lifetime, expected the save's ` +
          `${incoming.seeds} / ${incoming.plants} / ${incoming.beds} / ${incoming.growth} / ${incoming.lifetime}.`
      );
    }
    if (exportSave() !== portable) {
      problems.push("loading a save through import-save did not round-trip back to the same save string.");
    }

    const storedLoaded = rawStorage().value;
    const refused = await importTool.execute({ save: "not a save" }, {});
    if (refused.ok || refused.applied) {
      problems.push("import-save accepted an invalid save instead of reporting failure.");
    }
    const refusedConfirmed = await importTool.execute({ save: "not a save", confirm: true }, {});
    if (refusedConfirmed.ok || refusedConfirmed.applied) {
      problems.push("import-save with confirm: true applied an invalid save instead of refusing it.");
    }
    const afterRefused = getGarden();
    if (afterRefused.seeds !== loaded.seeds || afterRefused.plants !== loaded.plants) {
      problems.push("import-save changed the garden even though the save was refused.");
    }
    if (rawStorage().value !== storedLoaded) {
      problems.push("a refused import-save wrote the stored save anyway.");
    }
  } finally {
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
    restoreRawLastSeen(seenBefore);
  }
}

/**
 * Put the whole growth state back, lasting bonus included.
 *
 * Every check that changes the growth restores through this, so no `finally`
 * has to remember that `setGrowth`'s fifth argument is the bonus: a garden that
 * carried one comes out of the suite with it still, instead of silently losing
 * it to the default of 0.
 */
function restoreGrowth(snapshot) {
  setGrowth(snapshot.growth, snapshot.rate, snapshot.age, snapshot.lifetime, snapshot.bonus);
}

function rawStorage() {
  try {
    return { readable: true, value: localStorage.getItem(STORAGE_KEY) };
  } catch {
    return { readable: false };
  }
}

function restoreRawStorage(snapshot) {
  if (!snapshot || !snapshot.readable) return;
  try {
    if (snapshot.value == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, snapshot.value);
  } catch {
    // Storage is unusable; there is nothing to put back.
  }
}

function rawLastSeen() {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function restoreRawLastSeen(snapshot) {
  try {
    if (snapshot == null) localStorage.removeItem(LAST_SEEN_KEY);
    else localStorage.setItem(LAST_SEEN_KEY, snapshot);
  } catch {
    // Storage is unusable; there is nothing to put back.
  }
}

/**
 * Check that the product still does what it claims.
 *
 * @returns {Promise<string[]>} plain-language failures; empty when all holds.
 */
export async function checks() {
  const problems = [];
  const gardenBefore = getGarden();
  const growthBefore = getGrowthState();
  const storageBefore = rawStorage();
  const seenBefore = rawLastSeen();

  try {
    await document.fonts.ready;
    for (const family of [TITLE_FONT, BODY_FONT]) {
      if (!document.fonts.check(`16px "${family}"`)) {
        problems.push(`the "${family}" pixel font did not load, so text cannot render in it.`);
      }
    }

    checkPixelFont(problems);
    checkPalette(problems);
    checkPixelEdges(problems);

    checkTendControl(problems);
    checkTendAnswersImmediately(problems);
    checkGrowthRateShowsAndRuns(problems);
    checkGrowthIsBoundedAndFinite(problems);

    checkStartState(problems);
    checkFreshGardenStartsGrowing(problems);
    checkSaveCodec(problems);
    checkSaveCarriesGrowth(problems);
    checkOfflineTime(problems);
    checkDurableSave(problems);
    checkPageReadout(problems);
    checkKindReadout(problems);
    checkKindSwatches(problems);
    checkKindMilestones(problems);
    checkPlotDrawing(problems);
    checkPlotDrawsKinds(problems);
    checkPlotSpritesLegible(problems);
    checkPlotMilestoneCrowns(problems);
    checkPlotMarksMatchCounts(problems);
    checkPlotBedEdges(problems);
    checkPlotCoverage(problems);
    checkGroundIsNotGrowth(problems);
    checkPlotEstablishment(problems);
    checkPlotGroundEdge(problems);
    checkSoilField(problems);
    checkPlotAnimation(problems);
    checkGardenFormMapping(problems);
    checkNextFormMeter(problems);
    checkPlotMotion(problems);
    checkSeedCostCurve(problems);
    checkSeedKindsDiffer(problems);
    checkSaveMigratesKinds(problems);
    checkLifetimeGrowth(problems);
    checkReplant(problems);
    checkReplantConfirm(problems);
    checkPlantControl(problems);
    checkPlantingSpendsAndRaisesProduction(problems);
    checkBloomPlanting(problems);
    checkSeedGoalReadout(problems);
    checkFirstGoalNamesTending(problems);
    checkNextPlantReadout(problems);
    checkBedProgression(problems);
    checkLargeCounts(problems);
    checkCompactAmounts(problems);
    checkPortableSave(problems);
    checkLoadConfirm(problems);
    checkRestorePoint(problems);
    checkNoOverflow(problems);
    checkCompactReadout(problems);
    checkFirstScreenGarden(problems);
    checkPlotDominatesGarden(problems);
    checkPhoneFirstScreen(problems);
    checkSimulateGarden(problems);
    checkReturnSummary(problems);
    checkReturnSummaryPlacement(problems);
    checkAwaySowing(problems);
    checkReturnMarks(problems);
    checkVisitRecord(problems);
    checkTendedMarks(problems);
    checkHandWorkMarks(problems);
    checkVisitPresence(problems);
    checkLiveAnnouncements(problems);
    checkActionConfirmationsAreSpoken(problems);
    checkGardenActionRefusals(problems);
    checkPollinator(problems);
    checkPollinatorHome(problems);
    checkPollinatorHomeOffPlots(problems);
    checkPollinatorSeasons(problems);
    checkSeason(problems);
    checkShownRateMatchesEarned(problems);
    checkSeasonDrawing(problems);
    checkSeasonalGround(problems);
    checkSandbox(problems);
    checkSandboxClose(problems);
    await checkAgentTools(problems);
  } finally {
    // Leave the page exactly as a visitor found it: the garden, the whole growth
    // state and the browser's storage back, the last-seen moment restored, no
    // rehearsal left open, and #garden-status cleared of whatever the last
    // check announced. Everything that measures the page afterwards measures
    // the product, not the suite's leftovers.
    setGarden(gardenBefore);
    restoreGrowth(growthBefore);
    restoreRawStorage(storageBefore);
    restoreRawLastSeen(seenBefore);
    closeSandbox();
    const status = document.getElementById("garden-status");
    if (status) status.textContent = "";
  }

  return problems;
}
