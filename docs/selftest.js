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
  LAST_SEEN_KEY,
  PLANT_PRODUCTION,
  PLOTS_PER_BED,
  POLLINATOR_BOOST,
  POLLINATOR_CYCLE_SECONDS,
  POLLINATOR_VISIT_SECONDS,
  PLOT_CAPACITY,
  SAVE_PREFIX,
  SAVE_VERSION,
  SEASONS,
  SEASON_CYCLE_SECONDS,
  SEASON_SECONDS,
  SEED_COST_BASE,
  SEED_COST_RATE,
  SEED_KINDS,
  STORAGE_KEY,
  TEND_RATE_STEP,
  TEND_YIELD,
  advance,
  decodeSave,
  elapsedSeconds,
  encodeSave,
  gardenKinds,
  getGarden,
  getGrowthState,
  kindIndex,
  newGarden,
  nextBedCost,
  nextSeedCost,
  pollinatorAt,
  pollinatorSecondsWithin,
  readLastSeen,
  replantBonus,
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
  applyReturn,
  buildAwayReport,
  exportSave,
  fastForwardSandbox,
  formatAmount,
  formatGrowth,
  getDisplayedState,
  getSandboxState,
  loadGardenSave,
  openSandbox,
  readPalette,
  resetSandbox,
  summarizeReturn,
} from "./app.js";
import { FORMS, drawGarden, gardenForm, groundCover, motionPhase, plotBounds, seasonLook } from "./plotview.js";

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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
    restoreRawStorage(beforeRaw);
  }
}

// --- Two kinds of seed ------------------------------------------------------

/**
 * The two kinds are a real choice: they differ in price, in what a grown plant
 * produces and in how long the seed takes to mature, each kind is priced
 * against its own count, and both read off a mixed garden correctly.
 */
function checkSeedKindsDiffer(problems) {
  if (SAVE_VERSION !== 7) {
    problems.push(`SAVE_VERSION should be 7 (the lifetime total), but it is ${SAVE_VERSION}.`);
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
    if (!button.disabled) {
      problems.push(`the Plant a bloom control is enabled at ${cost - 1} growth, one short of its ${cost}-growth cost.`);
    }

    setGrowth(cost, 0.2);
    if (button.disabled) {
      problems.push(`the Plant a bloom control is disabled at ${cost} growth, exactly its ${cost}-growth cost.`);
    }
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
  }
}

/**
 * The two kinds are named on the page: a readout row each, with counts, price
 * and production, a Plant control each naming its kind and price, and a goal
 * that names the kind worth planting next and what it costs.
 */
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

    setGarden({ seeds: 2, plants: 1 });
    setGrowth(0, 0.5);
    const herbRow = rows.get("herb");
    const bloomRow = rows.get("bloom");
    const herbCost = nextSeedCost(3, "herb");
    const bloomCost = nextSeedCost(0, "bloom");
    if (herbRow && !String(herbRow.textContent).includes(formatAmount(2))) {
      problems.push(`the herb readout says ${JSON.stringify(herbRow.textContent)}, expected it to count 2 seeds.`);
    }
    if (herbRow && !String(herbRow.textContent).includes(formatAmount(1))) {
      problems.push(`the herb readout says ${JSON.stringify(herbRow.textContent)}, expected it to count 1 plant.`);
    }
    if (herbRow && !String(herbRow.textContent).includes(formatAmount(herbCost))) {
      problems.push(`the herb readout says ${JSON.stringify(herbRow.textContent)}, expected its ${herbCost}-growth price.`);
    }
    if (herbRow && !String(herbRow.textContent).includes("0.5")) {
      problems.push(`the herb readout says ${JSON.stringify(herbRow.textContent)}, expected its 0.5/s production.`);
    }
    if (bloomRow && !String(bloomRow.textContent).includes(formatAmount(bloomCost))) {
      problems.push(
        `the bloom readout says ${JSON.stringify(bloomRow.textContent)}, expected its ${bloomCost}-growth price.`
      );
    }
    if (bloomRow && !String(bloomRow.textContent).includes("5")) {
      problems.push(`the bloom readout says ${JSON.stringify(bloomRow.textContent)}, expected its 5/s production.`);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
  }
}

/**
 * Draw a state on a fresh offscreen canvas at a pinned phase, as a data URL.
 *
 * The live canvas is animated, so two snapshots of it would differ between
 * ticks for reasons that have nothing to do with the state; a pinned phase on
 * an offscreen canvas makes each picture a pure function of state and phase, so
 * a difference proves a difference in what is drawn.
 */
function plotImage(state, phase = 0) {
  const canvas = document.createElement("canvas");
  drawGarden(canvas, state, readPalette(), phase);
  return canvas.toDataURL();
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
  if (canvas.width !== bounds.width || canvas.height !== bounds.height) {
    problems.push(
      `a huge garden drew ${canvas.width}x${canvas.height}px, outside the plot's own bounds ${bounds.width}x${bounds.height}px.`
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(before.growth, before.rate, before.age, before.lifetime);
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
  } finally {
    setGrowth(before.growth, before.rate, before.age, before.lifetime);
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
    setGrowth(before.growth, before.rate, before.age, before.lifetime);
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
    setGrowth(before.growth, before.rate, before.age, before.lifetime);
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
    if (!button.disabled) {
      problems.push(`the Plant a seed control is enabled at ${cost - 1} growth, one short of its ${cost}-growth cost.`);
    }

    setGrowth(cost, 0.2);
    if (button.disabled) {
      problems.push(`the Plant a seed control is disabled at ${cost} growth, exactly its ${cost}-growth cost.`);
    }
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
    restoreRawStorage(storageBefore);
  }
}

/**
 * The next goal is always on the page as progress and as time, never only as a
 * number, and it is honest when the plot is full.
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

    // Halfway there, at 1 growth per second: the detail must carry both the
    // cost and how long it will take, and the meter must track the fraction.
    setGrowth(cost / 2, 1);
    const halfDetail = String(detailEl.textContent);
    if (!halfDetail.includes(formatAmount(cost))) {
      problems.push(`the next-seed goal does not state its ${cost}-growth cost: ${JSON.stringify(halfDetail)}`);
    }
    if (!halfDetail.includes(`${Math.ceil((cost - cost / 2) / 1)}s`)) {
      problems.push(
        `the next-seed goal does not state how many seconds away the seed is: ${JSON.stringify(halfDetail)}`
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

    // Affordable: the goal says it is ready, not how far away it is.
    setGrowth(cost, 1);
    if (!String(detailEl.textContent).toLowerCase().includes("ready")) {
      problems.push(`with enough growth the goal does not say the seed is ready: ${JSON.stringify(detailEl.textContent)}`);
    }

    // Not growing at all: the goal points at what to do about it.
    setGrowth(0, 0);
    if (!String(detailEl.textContent).toLowerCase().includes("tend")) {
      problems.push(
        `with no growth and no rate the goal does not say to tend the soil: ${JSON.stringify(detailEl.textContent)}`
      );
    }

    // Full: the goal becomes the next bed, naming it and its cost, while the
    // Plant a seed control stays disabled and says the plot is full.
    setGarden({ beds: 1, seeds: PLOT_CAPACITY, plants: 0 });
    setGrowth(0, 1);
    const bedCost = nextBedCost(1);
    const fullDetail = String(detailEl.textContent);
    if (!fullDetail.includes(formatAmount(bedCost))) {
      problems.push(
        `with every plot full the goal does not state the next bed's ${bedCost}-growth cost: ${JSON.stringify(fullDetail)}`
      );
    }
    const goalTitle = String(document.getElementById("goal-title")?.textContent ?? "");
    if (!/bed\s*#2/i.test(goalTitle)) {
      problems.push(`with every plot full the goal title does not name the next bed: ${JSON.stringify(goalTitle)}`);
    }
    const button = document.getElementById("plant-seed");
    if (button && !button.disabled) {
      problems.push("with every plot full the Plant a seed control is still enabled.");
    }
    if (button && !String(button.textContent).toLowerCase().includes("full")) {
      problems.push(`with every plot full the Plant a seed label does not say so: ${JSON.stringify(button.textContent)}`);
    }
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
      if (button.disabled) problems.push(`with ${cost} growth saved the Open the next bed control is disabled.`);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(before.growth, before.rate, before.age, before.lifetime);
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

    // The readout and get-state name the visit and the boosted rate.
    const row = document.querySelector('[data-field="pollinator"]');
    if (!row) {
      problems.push('the page has no pollinator readout (expected [data-field="pollinator"]).');
    }
    setGarden({ seeds: 0, plants: 3 });
    setGrowth(0, 1, 0);
    const quiet = getDisplayedState();
    if (quiet.pollinator.visiting || quiet.rate !== 1) {
      problems.push(
        `a garden out of a visit window reported pollinator ${JSON.stringify(quiet.pollinator)} at ${quiet.rate}/s, ` +
          `expected none visiting at the base 1/s.`
      );
    }
    if (row && !/none/i.test(String(row.textContent))) {
      problems.push(
        `outside a visit the pollinator readout says ${JSON.stringify(row.textContent)}, expected "none visiting".`
      );
    }

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
    if (row && !/visiting/i.test(String(row.textContent))) {
      problems.push(
        `during a visit the pollinator readout says ${JSON.stringify(row.textContent)}, expected it to name the visit.`
      );
    }

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
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    if (row && !/spring/i.test(String(row.textContent))) {
      problems.push(`the season readout says ${JSON.stringify(row.textContent)}, expected it to name spring.`);
    }

    // A return that crosses a season boundary reports both seasons.
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
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    const saved = { version: SAVE_VERSION, seeds: 2, plants: 1, growth: 0, rate: 0.5 };
    setGarden({ seeds: 2, plants: 1 });
    setGrowth(saved.growth, saved.rate);
    const beforeImage = canvas ? canvas.toDataURL() : null;

    const nowMs = 1_700_000_000_000;
    const away = applyReturn(saved, nowMs - 30 * DAY * 1000, nowMs);

    // The 2 seeds mature after GROW_SECONDS, so the garden earns the old rate for
    // that short while and the higher rate (each plant adding 0.5/s) for the rest.
    // A pollinator visits once there is a grown plant, and its visit is worth an
    // extra rate for every second it is on the plot (see pollinatorSecondsWithin),
    // so the expected total adds those verified seconds at each rate.
    const visitSecondsEarly = pollinatorSecondsWithin(0, GROW_SECONDS);
    const visitSecondsRest = pollinatorSecondsWithin(GROW_SECONDS, 30 * DAY - GROW_SECONDS);
    // Each stretch weighs its seconds by the season they fall in, the same way
    // the simulation does, on top of the pollinator's extra seconds.
    const seasonEarly = seasonWeightSecondsByBruteForce(0, GROW_SECONDS);
    const seasonRest = seasonWeightSecondsByBruteForce(GROW_SECONDS, 30 * DAY - GROW_SECONDS);
    const expectedEarned =
      0.5 * (seasonEarly + (POLLINATOR_BOOST - 1) * visitSecondsEarly) +
      1.5 * (seasonRest + (POLLINATOR_BOOST - 1) * visitSecondsRest);
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
      if (strip.hidden || !strip.textContent.trim()) {
        problems.push("returning after 30 days did not show the return summary.");
      } else {
        const text = strip.textContent;
        const expected = [
          ["the earned growth", formatGrowth(away.earned)],
          ["the form reached", expectedForm.name],
        ];
        const nextIndex = expectedForm.index + 1;
        if (nextIndex < FORMS.length) expected.push(["the next form", FORMS[nextIndex].name]);
        for (const [what, value] of expected) {
          if (!text.includes(value)) problems.push(`the return summary does not state ${what} (${value}): "${text}"`);
        }
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
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
    const realSummary = document.getElementById("return-summary")?.textContent;
    const expected = summarizeReturn(buildAwayReport(
      { growth: 0, rate: 0.5, sprouts: [GROW_SECONDS, GROW_SECONDS], plants: 1, beds: 1 },
      30 * DAY
    ));
    if (rehearsal.summary !== realSummary || rehearsal.summary !== away.summary || rehearsal.summary !== expected) {
      problems.push(
        `the sandbox summary ${JSON.stringify(rehearsal.summary)} does not match the real garden's ` +
          `${JSON.stringify(realSummary)}.`
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
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
    restoreRawStorage(storageBefore);
    restoreRawLastSeen(seenBefore);
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
  if (!readTool || !exportTool || !importTool) {
    problems.push("agenttools.js must expose get-state, export-save and import-save.");
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
  if (state.save !== shown.save) {
    problems.push("get-state's save does not match the save the page shows.");
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

  const tendTool = find("tend");
  if (!tendTool) {
    problems.push("agenttools.js has no tend tool, so an agent cannot do what the Tend button does.");
  } else {
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
    } finally {
      setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
      setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
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
      setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
      restoreRawStorage(storageBefore);
    }
  }

  const openSandboxTool = find("open-sandbox");
  const fastForwardTool = find("fast-forward-sandbox");
  const resetSandboxTool = find("reset-sandbox");
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
    } finally {
      setGarden(gardenBefore);
      setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
      restoreRawStorage(storageBefore);
      restoreRawLastSeen(seenBefore);
    }
  }

  const exported = await exportTool.execute({}, {});
  if (exported.save !== shown.save) {
    problems.push("export-save returned a different save than the page shows.");
  }

  const started = getGarden();
  const loaded = await importTool.execute({ save: exportSave() }, {});
  if (!loaded.ok) {
    problems.push(`import-save refused a valid save: ${loaded.error ?? "no reason given"}`);
  }

  const refused = await importTool.execute({ save: "not a save" }, {});
  if (refused.ok) {
    problems.push("import-save accepted an invalid save instead of reporting failure.");
  }
  const after = getGarden();
  if (after.seeds !== started.seeds || after.plants !== started.plants) {
    problems.push("import-save changed the garden even though the save was refused.");
  }
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
    checkSaveCodec(problems);
    checkSaveCarriesGrowth(problems);
    checkOfflineTime(problems);
    checkDurableSave(problems);
    checkPageReadout(problems);
    checkKindReadout(problems);
    checkPlotDrawing(problems);
    checkPlotDrawsKinds(problems);
    checkPlotCoverage(problems);
    checkPlotAnimation(problems);
    checkGardenFormMapping(problems);
    checkNextFormMeter(problems);
    checkPlotMotion(problems);
    checkSeedCostCurve(problems);
    checkSeedKindsDiffer(problems);
    checkSaveMigratesKinds(problems);
    checkLifetimeGrowth(problems);
    checkPlantControl(problems);
    checkPlantingSpendsAndRaisesProduction(problems);
    checkBloomPlanting(problems);
    checkSeedGoalReadout(problems);
    checkNextPlantReadout(problems);
    checkBedProgression(problems);
    checkLargeCounts(problems);
    checkCompactAmounts(problems);
    checkPortableSave(problems);
    checkNoOverflow(problems);
    checkCompactReadout(problems);
    checkSimulateGarden(problems);
    checkReturnSummary(problems);
    checkPollinator(problems);
    checkSeason(problems);
    checkSeasonDrawing(problems);
    checkSandbox(problems);
    await checkAgentTools(problems);
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate, growthBefore.age, growthBefore.lifetime);
    restoreRawStorage(storageBefore);
  }

  return problems;
}
