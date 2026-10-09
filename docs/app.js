/**
 * The page: a soil plot beside the garden's quantities in text and numbers, the
 * Tend the soil action that starts the garden growing, and a save the player can
 * copy out and load back.
 *
 * The plot is drawn from the live growth number through one function —
 * `gardenForm` — that also names the form in words, so the picture and the text
 * beside it can never disagree. The canvas is decoration beside the real DOM
 * readout, not the product: a screen reader and the app review read the readout,
 * and the plot is described in words as well as drawn.
 */

import {
  PLOT_CAPACITY,
  STORAGE_KEY,
  advance,
  decodeSave,
  encodeSave,
  getGarden,
  getGrowthState,
  readStoredGarden,
  setGarden,
  storageAvailable,
  subscribe,
  tend,
  writeStoredGarden,
} from "./garden.js";
import { drawGarden, gardenForm } from "./plotview.js";

const numberFormat = new Intl.NumberFormat("en");
const growthFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// How often the garden's growth is carried forward on screen. Elapsed time, not
// the tick count, is what grows it, so a slow or skipped tick changes the
// smoothness and nothing else.
const TICK_MS = 250;
// A single step never counts more than this, so a device that slept for hours
// cannot hand the garden hours of growth it never watched.
const MAX_STEP_SECONDS = 60;

const elements = {
  growth: document.getElementById("growth-total"),
  rate: document.getElementById("growth-rate"),
  form: document.querySelector('[data-field="form"]'),
  tend: document.getElementById("tend"),
  seeds: document.querySelector('[data-field="seeds"]'),
  plants: document.querySelector('[data-field="plants"]'),
  capacity: document.querySelector('[data-field="capacity"]'),
  storage: document.querySelector('[data-field="storage"]'),
  plot: document.getElementById("garden-plot"),
  description: document.getElementById("plot-description"),
  save: document.getElementById("save-value"),
  copy: document.getElementById("copy-save"),
  load: document.getElementById("load-save"),
  status: document.getElementById("save-status"),
};

const isStorageAvailable = storageAvailable();

let palette = null;

/** The palette, read once from the `:root` CSS variables rather than repeated. */
function readPalette() {
  if (palette) return palette;
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  palette = {
    soil: read("--soil"),
    soilDeep: read("--soil-deep"),
    soilLight: read("--soil-light"),
    leaf: read("--leaf"),
    leafLight: read("--leaf-light"),
    leafDeep: read("--leaf-deep"),
    bloom: read("--bloom"),
    sun: read("--sun"),
  };
  return palette;
}

const countLabel = (count, singular, plural) =>
  `${numberFormat.format(count)} ${count === 1 ? singular : plural}`;

/** The picture, said in words: the same growth and form the plot draws. */
function describePlot(state) {
  return (
    `${growthFormat.format(state.growth)} growth — ${state.formName}. ` +
    `${countLabel(state.seeds, "ungrown seed", "ungrown seeds")}, ` +
    `${countLabel(state.plants, "grown plant", "grown plants")}.`
  );
}

function setText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

/**
 * Everything the page shows a visitor, in one object.
 *
 * A person reads this off the page and an agent asks for it through `get-state`;
 * they are the same values from the same place, never two sources to drift.
 */
export function getDisplayedState() {
  const garden = getGarden();
  const { growth, rate } = getGrowthState();
  const form = gardenForm(growth);
  return {
    seeds: garden.seeds,
    plants: garden.plants,
    growth,
    rate,
    form: form.index,
    formName: form.name,
    capacity: PLOT_CAPACITY,
    save: encodeSave(garden),
    storageAvailable: isStorageAvailable,
  };
}

/** The one portable string a player can copy out of the page. */
export function exportSave() {
  return encodeSave(getGarden());
}

/**
 * Replace the garden with the one in `text` and keep it.
 *
 * @throws {Error} when the save cannot be read; the garden is left untouched.
 */
export function loadGardenSave(text) {
  const garden = decodeSave(text);
  setGarden(garden);
  const persisted = writeStoredGarden(garden);
  return { ok: true, persisted, state: getDisplayedState() };
}

function announce(message) {
  setText(elements.status, message);
}

let lastPlotKey = null;

function render() {
  // A hidden tab still keeps the garden growing (the timer derives growth from
  // elapsed time), but there is nobody to see it redraw.
  if (document.hidden) return;

  const state = getDisplayedState();
  setText(elements.growth, growthFormat.format(state.growth));
  setText(elements.rate, `+${growthFormat.format(state.rate)}/s`);
  setText(elements.form, state.formName);
  setText(elements.seeds, numberFormat.format(state.seeds));
  setText(elements.plants, numberFormat.format(state.plants));
  setText(elements.capacity, numberFormat.format(state.capacity));
  setText(elements.storage, state.storageAvailable ? "Yes" : "No");
  setText(elements.description, describePlot(state));
  // Leave the field alone while the visitor is editing it; a re-render should
  // not erase a save they are about to paste.
  if (elements.save && document.activeElement !== elements.save) {
    elements.save.value = state.save;
  }

  // The picture follows the growth, not the stored garden, so it redraws when
  // the amount or the form it falls in changes — and stays put when nothing does.
  const plotKey = `${state.form}:${state.growth}`;
  if (plotKey !== lastPlotKey) {
    drawGarden(elements.plot, state, readPalette());
    lastPlotKey = plotKey;
  }
}

async function copySave() {
  const text = exportSave();
  if (elements.save) elements.save.value = text;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    announce("Save copied. Paste it back any time to restore this garden.");
  } catch {
    elements.save?.focus();
    elements.save?.select();
    announce("Save selected — press Ctrl/Cmd+C to copy it.");
  }
}

function loadSave() {
  const text = elements.save ? elements.save.value : "";
  try {
    const result = loadGardenSave(text);
    announce(
      result.persisted
        ? "Garden loaded and saved in this browser."
        : "Garden loaded, but this browser will not keep it — copy the save to be safe."
    );
  } catch (e) {
    announce(e.message);
  }
}

function start() {
  subscribe(render);

  const stored = readStoredGarden();
  setGarden(stored.garden);

  // A save that cannot be read is repaired, not left to reset the garden again
  // on every visit.
  if (stored.damaged) {
    writeStoredGarden(getGarden());
    announce("The garden saved here could not be read, so it started fresh.");
  }
  if (!isStorageAvailable) {
    announce("This browser will not keep the garden — copy the save to take it with you.");
  }

  // Another tab writing the same garden should show up here rather than leave
  // the two disagreeing.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const next = readStoredGarden();
    if (!next.damaged) setGarden(next.garden);
  });

  elements.tend?.addEventListener("click", tend);
  elements.copy?.addEventListener("click", copySave);
  elements.load?.addEventListener("click", loadSave);
  elements.save?.addEventListener("input", () => announce(""));

  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min(Math.max(now - lastTick, 0) / 1000, MAX_STEP_SECONDS);
    lastTick = now;
    advance(elapsed);
  }, TICK_MS);

  // Showing the tab again draws the growth the hidden ticks already earned,
  // and restarts the clock so the gap is not counted twice.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    lastTick = performance.now();
    render();
  });

  render();
}

start();
