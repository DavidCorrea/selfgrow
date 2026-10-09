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
  PLOT_CAPACITY,
  SAVE_PREFIX,
  SAVE_VERSION,
  SEED_COST_BASE,
  SEED_COST_RATE,
  STORAGE_KEY,
  TEND_RATE_STEP,
  TEND_YIELD,
  advance,
  decodeSave,
  elapsedSeconds,
  encodeSave,
  getGarden,
  getGrowthState,
  newGarden,
  nextBedCost,
  nextSeedCost,
  readLastSeen,
  readStoredGarden,
  setGarden,
  setGrowth,
  storageAvailable,
  writeLastSeen,
  writeStoredGarden,
} from "./garden.js";
import { applyReturn, exportSave, getDisplayedState, loadGardenSave, summarizeReturn } from "./app.js";
import { FORMS, gardenForm } from "./plotview.js";

const numberFormat = new Intl.NumberFormat("en");
const growthFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// The design system is itself a promise: one palette, one embedded pixel font,
// square pixel edges. These are the checks for it.
const PIXEL_FONT = "Press Start 2P";

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

function checkPixelFont(problems) {
  const family = getComputedStyle(document.body).fontFamily.toLowerCase();
  if (!family.includes(PIXEL_FONT.toLowerCase())) {
    problems.push(
      `the page is not set in the pixel font: body font-family is "${family}", expected it to include "${PIXEL_FONT}".`
    );
  }

  const sources = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.style && rule.style.getPropertyValue("src")) {
        sources.push(rule.style.getPropertyValue("src"));
      }
    }
  }
  if (!sources.length) {
    problems.push("no @font-face is declared, so no pixel font ships with the page.");
  }
  for (const src of sources) {
    const urls = [...src.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1].replace(/["']/g, "").trim());
    if (!urls.length || urls.some((url) => !url.startsWith("data:"))) {
      problems.push(
        `the pixel font is loaded from a network location (${src}) — it must ship as an embedded data: URI.`
      );
    }
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
    const shown = Number(String(el.textContent).replace(/,/g, ""));
    if (shown !== state[field]) {
      problems.push(
        `the page shows ${JSON.stringify(el.textContent)} for ${field}, but the garden holds ${state[field]}.`
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
      ["growth", growthFormat.format(state.growth)],
      ["the garden form", state.formName],
      ["seeds", numberFormat.format(state.seeds)],
      ["plants", numberFormat.format(state.plants)],
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
    if (seedsEl && Number(String(seedsEl.textContent).replace(/,/g, "")) !== 4) {
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
    setGrowth(growthBefore.growth, growthBefore.rate);
    restoreRawStorage(beforeRaw);
  }
}

function checkPlotDrawing(problems) {
  const canvas = document.getElementById("garden-plot");
  if (!canvas || !canvas.getContext) {
    problems.push("the page has no plot canvas (#garden-plot) to draw the garden into.");
    return;
  }
  const before = getGrowthState();
  const gardenBefore = getGarden();
  try {
    const snapshot = (growth, seeds, plants) => {
      setGarden({ seeds, plants });
      setGrowth(growth, 0);
      return canvas.toDataURL();
    };
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
  } finally {
    setGarden(gardenBefore);
    setGrowth(before.growth, before.rate);
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
 * The plot is redrawn discretely, never animated, so a visitor who asks for no
 * motion still sees the change — and the description states the same form in
 * words when the garden advances.
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
    setGrowth(before.growth, before.rate);
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
    setGrowth(before.growth, before.rate);
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
    if (!/^\+[\d,]+(\.\d+)?\/s$/.test(rateText)) {
      problems.push(`the page shows the growth rate as ${JSON.stringify(rateText)}, expected a "+x/s" form like "+0.5/s".`);
    }
  } finally {
    setGrowth(before.growth, before.rate);
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
    setGrowth(before.growth, before.rate);
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
    if (!label.includes(numberFormat.format(cost))) {
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
    setGrowth(growthBefore.growth, growthBefore.rate);
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
    if (!halfDetail.includes(numberFormat.format(cost))) {
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
    if (!fullDetail.includes(numberFormat.format(bedCost))) {
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
    setGrowth(growthBefore.growth, growthBefore.rate);
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
    setGrowth(growthBefore.growth, growthBefore.rate);
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
      if (!String(button.textContent).includes(numberFormat.format(cost))) {
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
      if (!text.includes(numberFormat.format(state.nextBedCost))) {
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
    setGrowth(growthBefore.growth, growthBefore.rate);
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
    if (Number(String(seedsEl?.textContent).replace(/,/g, "")) !== 3) {
      problems.push(`with 3 seeds, the page shows ${JSON.stringify(seedsEl?.textContent)} instead of 3.`);
    }
    if (!plantedEl || !String(plantedEl.textContent).includes("123")) {
      problems.push(`with 123456789 plants, the page shows ${JSON.stringify(plantedEl?.textContent)}.`);
    }
    checkNoOverflow(problems);
  } finally {
    setGarden(before);
    setGrowth(growthBefore.growth, growthBefore.rate);
    restoreRawStorage(beforeRaw);
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

// --- Time away ---------------------------------------------------------------

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
    const expected = 0.5 * 30 * DAY;
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
    setGrowth(before.growth, before.rate);
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
    const expectedEarned = 0.5 * GROW_SECONDS + 1.5 * (30 * DAY - GROW_SECONDS);
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
          ["the earned growth", growthFormat.format(away.earned)],
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
    setGrowth(growthBefore.growth, growthBefore.rate);
    restoreRawStorage(storageBefore);
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
      setGrowth(growthBefore.growth, growthBefore.rate);
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
    } finally {
      setGarden(gardenBefore);
      setGrowth(growthBefore.growth, growthBefore.rate);
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
      setGrowth(growthBefore.growth, growthBefore.rate);
      restoreRawStorage(storageBefore);
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
    if (!document.fonts.check(`16px "${PIXEL_FONT}"`)) {
      problems.push(`the "${PIXEL_FONT}" pixel font did not load, so text cannot render in it.`);
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
    checkPlotDrawing(problems);
    checkGardenFormMapping(problems);
    checkPlotMotion(problems);
    checkSeedCostCurve(problems);
    checkPlantControl(problems);
    checkPlantingSpendsAndRaisesProduction(problems);
    checkSeedGoalReadout(problems);
    checkNextPlantReadout(problems);
    checkBedProgression(problems);
    checkLargeCounts(problems);
    checkPortableSave(problems);
    checkNoOverflow(problems);
    checkReturnSummary(problems);
    await checkAgentTools(problems);
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate);
    restoreRawStorage(storageBefore);
  }

  return problems;
}
