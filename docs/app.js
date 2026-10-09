/**
 * The page: a soil plot beside the garden's quantities in text and numbers, and
 * a save the player can copy out and load back.
 *
 * The plot is drawn from the same garden object the readout prints, through one
 * function — `drawGarden` — so the picture and the numbers can never disagree.
 * The canvas is decoration beside the real DOM readout, not the product: a
 * screen reader and the app review read the readout, and the plot is described
 * in words as well as drawn.
 */

import {
  PLOT_CAPACITY,
  STORAGE_KEY,
  decodeSave,
  encodeSave,
  getGarden,
  readStoredGarden,
  setGarden,
  storageAvailable,
  subscribe,
  writeStoredGarden,
} from "./garden.js";

// One pixel-art cell of soil, in canvas pixels. The canvas is scaled up by CSS
// with `image-rendering: pixelated`, so these stay whole numbers.
const CELL = 24;
const COLUMNS = 6;

const numberFormat = new Intl.NumberFormat("en");

const elements = {
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
    leafDeep: read("--leaf-deep"),
    bloom: read("--bloom"),
    ink: read("--ink"),
  };
  return palette;
}

function drawSoil(ctx, x, y, color) {
  ctx.fillStyle = color.soilDeep;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = color.soil;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = color.soilLight;
  ctx.fillRect(x + 2, y + 2, CELL - 4, 2);
}

function drawSeed(ctx, x, y, color) {
  ctx.fillStyle = color.ink;
  ctx.fillRect(x + CELL / 2 - 2, y + CELL - 9, 4, 5);
}

function drawPlant(ctx, x, y, color) {
  ctx.fillStyle = color.leafDeep;
  ctx.fillRect(x + 11, y + 9, 2, 11); // stem
  ctx.fillStyle = color.leaf;
  ctx.fillRect(x + 6, y + 13, 5, 3); // left leaf
  ctx.fillRect(x + 13, y + 11, 5, 3); // right leaf
  ctx.fillStyle = color.bloom;
  ctx.fillRect(x + 10, y + 4, 4, 5); // bloom
}

/**
 * Draw the garden's plot from its state. The same amount always draws the same
 * way, so the picture reads exactly the state the readout prints.
 */
function drawGarden(canvas, state) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rows = Math.ceil(state.capacity / COLUMNS);
  const width = COLUMNS * CELL;
  const height = rows * CELL;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  const color = readPalette();

  for (let index = 0; index < state.capacity; index += 1) {
    const x = (index % COLUMNS) * CELL;
    const y = Math.floor(index / COLUMNS) * CELL;
    drawSoil(ctx, x, y, color);
    if (index < state.plants) drawPlant(ctx, x, y, color);
    else if (index < state.plants + state.seeds) drawSeed(ctx, x, y, color);
  }
}

function plotClause(count, singular, plural) {
  return `${numberFormat.format(count)} ${count === 1 ? "holds" : "hold"} ${count === 1 ? singular : plural}`;
}

function describePlot(state) {
  return (
    `A plot of ${numberFormat.format(state.capacity)} squares of soil: ` +
    `${plotClause(state.seeds, "an ungrown seed", "ungrown seeds")}, ` +
    `${plotClause(state.plants, "a grown plant", "grown plants")}.`
  );
}

function setText(element, text) {
  if (element) element.textContent = text;
}

/**
 * Everything the page shows a visitor, in one object.
 *
 * A person reads this off the page and an agent asks for it through `get-state`;
 * they are the same values from the same place, never two sources to drift.
 */
export function getDisplayedState() {
  const garden = getGarden();
  return {
    seeds: garden.seeds,
    plants: garden.plants,
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

function render() {
  const state = getDisplayedState();
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
  drawGarden(elements.plot, state);
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

  elements.copy?.addEventListener("click", copySave);
  elements.load?.addEventListener("click", loadSave);
  elements.save?.addEventListener("input", () => announce(""));

  render();
}

start();
