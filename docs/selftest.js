/**
 * Check that the garden still does what it promises.
 *
 * Return an array of plain-language failure messages — empty when everything
 * holds. Each message names what broke and what was expected, so an agent
 * deciding what to fix knows where to look.
 *
 * The checks cover the things a person and an agent rely on: the save codec
 * refuses everything it should, the browser copy survives a reload, the page's
 * readout equals the state behind it, and a save can leave and come back.
 * They snapshot the garden and the browser's storage and restore both, so they
 * leave no residue and run fast.
 */

import {
  PLOT_CAPACITY,
  SAVE_VERSION,
  STORAGE_KEY,
  TEND_RATE_STEP,
  TEND_YIELD,
  advance,
  decodeSave,
  encodeSave,
  getGarden,
  getGrowthState,
  newGarden,
  readStoredGarden,
  setGarden,
  setGrowth,
  storageAvailable,
  writeStoredGarden,
} from "./garden.js";
import { exportSave, getDisplayedState, loadGardenSave } from "./app.js";

const numberFormat = new Intl.NumberFormat("en");

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
  if (start.seeds !== 1 || start.plants !== 0) {
    problems.push(
      `a new garden should be bare soil with one ungrown seed (1 seed, 0 plants), but it is ` +
      `${start.seeds} seed(s) and ${start.plants} plant(s).`
    );
  }

  const empty = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const { garden } = readStoredGarden(empty);
  if (garden.seeds !== 1 || garden.plants !== 0) {
    problems.push(
      `a first visit with nothing saved should open the starting garden (1 seed, 0 plants), ` +
      `but it opened ${garden.seeds} seed(s) and ${garden.plants} plant(s).`
    );
  }
}

function checkSaveCodec(problems) {
  const samples = [
    newGarden(),
    { seeds: 0, plants: 0 },
    { seeds: 5, plants: 3 },
    { seeds: 1000000, plants: 123456 },
  ];
  for (const sample of samples) {
    let roundTripped;
    try {
      roundTripped = decodeSave(encodeSave(sample));
    } catch (e) {
      problems.push(`a save could not round-trip (${sample.seeds} seeds, ${sample.plants} plants): ${e.message}`);
      continue;
    }
    if (roundTripped.seeds !== sample.seeds || roundTripped.plants !== sample.plants) {
      problems.push(
        `a save did not round-trip: put in ${sample.seeds} seeds / ${sample.plants} plants, ` +
        `got back ${roundTripped.seeds} / ${roundTripped.plants}.`
      );
    }
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

  for (const field of ["seeds", "plants", "capacity"]) {
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

  const description = document.getElementById("plot-description");
  if (!description || !description.textContent.trim()) {
    problems.push("the plot has no text description, so the picture is the only account of the soil.");
  } else {
    const text = description.textContent;
    for (const field of ["seeds", "plants", "capacity"]) {
      const formatted = numberFormat.format(state[field]);
      if (!text.includes(formatted)) {
        problems.push(`the plot description does not state ${field} (${formatted}): "${text}"`);
      }
    }
  }

  if (state.capacity !== PLOT_CAPACITY) {
    problems.push(`the displayed capacity is ${state.capacity}, expected the garden's ${PLOT_CAPACITY} plots.`);
  }
}

function checkPortableSave(problems) {
  const before = getGarden();
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
    restoreRawStorage(beforeRaw);
  }
}

function checkPlotDrawing(problems) {
  const canvas = document.getElementById("garden-plot");
  if (!canvas || !canvas.getContext) {
    problems.push("the page has no plot canvas (#garden-plot) to draw the garden into.");
    return;
  }
  const before = getGarden();
  const growthBefore = getGrowthState();
  try {
    const snapshot = (seeds, plants) => {
      setGarden({ seeds, plants });
      return canvas.toDataURL();
    };
    const bare = snapshot(0, 0);
    const seeded = snapshot(1, 0);
    const planted = snapshot(0, 1);
    if (bare === seeded) {
      problems.push("the plot looks identical with and without a seed, so it is not drawing the garden's state.");
    }
    if (seeded === planted) {
      problems.push("a seed and a grown plant draw the same, so the plot does not show the garden's form.");
    }
    setGarden({ seeds: 0, plants: 0 });
    setGrowth(0, 0);
    const ungrowing = canvas.toDataURL();
    setGrowth(5, 1);
    const growing = canvas.toDataURL();
    if (ungrowing === growing) {
      problems.push("the plot looks the same whether or not the garden is growing, so it does not draw the live growth.");
    }
  } finally {
    setGarden(before);
    setGrowth(growthBefore.growth, growthBefore.rate);
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
    // A session's growth runs far past the plot; the plot must not overfill.
    setGrowth(PLOT_CAPACITY + 1000, 1);
    const state = getDisplayedState();
    if (!Number.isInteger(state.sprouts) || state.sprouts < 0 || state.sprouts > state.capacity) {
      problems.push(
        `with growth far past the plot, it draws ${state.sprouts} sprouts into ${state.capacity} plots — expected 0 to ${state.capacity}.`
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

function checkLargeCounts(problems) {
  const before = getGarden();
  const beforeRaw = rawStorage();
  try {
    const huge = encodeSave({ seeds: 1e9, plants: 123456789 });
    loadGardenSave(huge);
    const seedsEl = document.querySelector('[data-field="seeds"]');
    const plantedEl = document.querySelector('[data-field="plants"]');
    if (Number(String(seedsEl?.textContent).replace(/,/g, "")) !== 1e9) {
      problems.push(
        `with a billion seeds, the page shows ${JSON.stringify(seedsEl?.textContent)} instead of 1,000,000,000.`
      );
    }
    if (!plantedEl || !String(plantedEl.textContent).includes("123")) {
      problems.push(`with 123456789 plants, the page shows ${JSON.stringify(plantedEl?.textContent)}.`);
    }
    checkNoOverflow(problems);
  } finally {
    setGarden(before);
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
  if (state.growth !== shown.growth || state.rate !== shown.rate || state.sprouts !== shown.sprouts) {
    problems.push(
      `get-state reported growth ${state.growth} at ${state.rate}/s with ${state.sprouts} sprouts, ` +
      `but the page shows ${shown.growth} at ${shown.rate}/s with ${shown.sprouts} sprouts.`
    );
  }
  if (state.save !== shown.save) {
    problems.push("get-state's save does not match the save the page shows.");
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
    checkDurableSave(problems);
    checkPageReadout(problems);
    checkPlotDrawing(problems);
    checkLargeCounts(problems);
    checkPortableSave(problems);
    checkNoOverflow(problems);
    await checkAgentTools(problems);
  } finally {
    setGarden(gardenBefore);
    setGrowth(growthBefore.growth, growthBefore.rate);
    restoreRawStorage(storageBefore);
  }

  return problems;
}
