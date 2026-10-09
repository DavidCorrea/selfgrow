/**
 * The page: a soil plot beside the garden's quantities in text and numbers, the
 * Tend the soil action that starts the garden growing, the Plant a seed action
 * that spends that growth to grow faster, the next seed always shown as progress
 * and time away, and a save the player can copy out and load back.
 *
 * The plot is drawn from the live growth number through one function —
 * `gardenForm` — that also names the form in words, so the picture and the text
 * beside it can never disagree. The canvas is decoration beside the real DOM
 * readout, not the product: a screen reader and the app review read the readout,
 * and the plot is described in words as well as drawn.
 */

import {
  GROW_SECONDS,
  PLOT_CAPACITY,
  STORAGE_KEY,
  advance,
  decodeSave,
  elapsedSeconds,
  encodeSave,
  getGarden,
  getGrowthState,
  nextSeedCost,
  plantSeed,
  readLastSeen,
  readStoredGarden,
  setGarden,
  setGrowth,
  storageAvailable,
  subscribe,
  tend,
  writeLastSeen,
  writeStoredGarden,
} from "./garden.js";
import { FORMS, drawGarden, gardenForm } from "./plotview.js";

const numberFormat = new Intl.NumberFormat("en");
const growthFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// How often the garden's growth is carried forward on screen. Elapsed time, not
// the tick count, is what grows it, so a slow or skipped tick changes the
// smoothness and nothing else.
const TICK_MS = 250;
// How often the live growth is written to the browser, so a tab that is closed
// without warning still loses almost nothing.
const PERSIST_MS = 5000;
// A gap shorter than this is a reload, not an absence worth a welcome-back note.
const MIN_AWAY_SECONDS = 60;

const elements = {
  growth: document.getElementById("growth-total"),
  rate: document.getElementById("growth-rate"),
  form: document.querySelector('[data-field="form"]'),
  tend: document.getElementById("tend"),
  plant: document.getElementById("plant-seed"),
  goalTitle: document.getElementById("goal-title"),
  goalDetail: document.getElementById("goal-detail"),
  meter: document.getElementById("seed-meter"),
  meterFill: document.getElementById("seed-meter-fill"),
  seeds: document.querySelector('[data-field="seeds"]'),
  plants: document.querySelector('[data-field="plants"]'),
  capacity: document.querySelector('[data-field="capacity"]'),
  nextPlant: document.querySelector('[data-field="next-plant"]'),
  storage: document.querySelector('[data-field="storage"]'),
  plot: document.getElementById("garden-plot"),
  description: document.getElementById("plot-description"),
  returnSummary: document.getElementById("return-summary"),
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
  const planted = garden.seeds + garden.plants;
  const seedCost = nextSeedCost(planted);
  const plotFull = planted >= PLOT_CAPACITY;
  return {
    seeds: garden.seeds,
    plants: garden.plants,
    totalPlanted: planted,
    growth,
    rate,
    form: form.index,
    formName: form.name,
    capacity: PLOT_CAPACITY,
    growSeconds: GROW_SECONDS,
    secondsToNextPlant: secondsToNextPlant(garden.sprouts),
    nextSeedCost: seedCost,
    canPlantSeed: !plotFull && growth >= seedCost,
    plotFull,
    seedCostProgress: seedCost > 0 ? Math.min(1, Math.max(0, growth / seedCost)) : 1,
    secondsToNextSeed: plotFull || !(rate > 0) ? null : Math.max(0, (seedCost - growth) / rate),
    save: exportSave(),
    away: lastReturn,
    storageAvailable: isStorageAvailable,
  };
}

/** How long until the soonest ungrown seed becomes a plant, or null if none. */
function secondsToNextPlant(sprouts) {
  if (!Array.isArray(sprouts) || !sprouts.length) return null;
  return Math.max(0, Math.min(...sprouts));
}

/** The one portable string a player can copy out of the page. */
export function exportSave() {
  return encodeSave({ ...getGarden(), ...getGrowthState() });
}

// --- Time away ---------------------------------------------------------------
//
// The live growth, rate and sprout timers travel in the save, and the moment
// the visitor left travels beside it. Coming back, the whole gap is walked with
// the same rule a tick uses — jumping straight to each seed that matures — so a
// month away finishes at once and lands exactly where a month played would.

/** The last return this visit, for `get-state`, or null before the first one. */
let lastReturn = null;

/** Write the garden and the moment it was written, so time away can be counted. */
function persist(nowMs = Date.now()) {
  writeStoredGarden(getGarden());
  writeLastSeen(nowMs);
}

/** A span of time away, in the largest whole unit that still reads as a span. */
function formatAway(seconds) {
  const whole = Math.round(seconds);
  if (whole < 60) return countLabel(whole, "second", "seconds");
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return countLabel(minutes, "minute", "minutes");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return countLabel(hours, "hour", "hours");
  const days = Math.round(hours / 24);
  if (days < 60) return countLabel(days, "day", "days");
  const months = Math.round(days / 30);
  if (months < 12) return countLabel(months, "month", "months");
  return countLabel(Math.round(months / 12), "year", "years");
}

/**
 * The return summary in words: what was earned, what the garden became, and the
 * next thing worth reaching for. A missing or backdated span has no news.
 *
 * Pure, so the same `away` always reads the same — the sentence is checked on
 * its own, without a page around it.
 */
export function summarizeReturn(away) {
  if (!away || !(away.seconds > 0)) return "The garden is as you left it.";

  const matured = away.matured > 0
    ? ` ${countLabel(away.matured, "seed", "seeds")} matured into ` +
      `${countLabel(away.matured, "plant", "plants")}.`
    : "";
  const grown = `While you were away ${formatAway(away.seconds)}, the garden earned ` +
    `${growthFormat.format(away.earned)} growth and is now ${away.form}.` + matured;

  // "What was found": the forms the absence grew it into, named at the top.
  let found = "";
  if (away.formsFound.length === 1) found = ` It grew into ${away.formsFound[0]}.`;
  else if (away.formsFound.length > 1) {
    found = ` It grew through ${away.formsFound.length} new forms, up to ${away.formsFound[away.formsFound.length - 1]}.`;
  }

  // "What is now possible": the next form, or the next seed once past them all.
  const next = away.nextFormName
    ? ` ${away.nextFormName} is ${growthFormat.format(away.growthToNextForm)} growth away — keep tending.`
    : ` A seed costs ${numberFormat.format(away.nextSeedCost)} growth — plant one when you can.`;

  return grown + found + next;
}

/**
 * Count the time since `lastSeenMs` against `saved`'s growth and rate, with no
 * cap, and put the garden where that much played time would have left it.
 *
 * @param {{seeds: number, plants: number, sprouts: number[], growth: number, rate: number}} saved
 * @param {number|null} lastSeenMs
 * @param {number} nowMs
 * @returns {object} the `away` report: the span, what it earned and grew into
 *   (including how many seeds matured), the summary sentence, and what to
 *   reach for next.
 */
export function applyReturn(saved, lastSeenMs, nowMs) {
  const seconds = elapsedSeconds(lastSeenMs, nowMs);
  const startGrowth = Number.isFinite(saved.growth) && saved.growth > 0 ? saved.growth : 0;
  const startRate = Number.isFinite(saved.rate) && saved.rate > 0 ? saved.rate : 0;
  const fromForm = gardenForm(startGrowth);

  setGrowth(startGrowth, startRate);
  const plantsBefore = getGarden().plants;
  advance(seconds);
  const matured = getGarden().plants - plantsBefore;

  const growth = getGrowthState().growth;
  const endGarden = getGarden();
  const toForm = gardenForm(growth);
  const nextIndex = toForm.index + 1;
  const away = {
    seconds,
    earned: growth - startGrowth,
    matured,
    from: fromForm.index,
    fromName: fromForm.name,
    to: toForm.index,
    form: toForm.name,
    formsFound: FORMS.slice(fromForm.index + 1, toForm.index + 1).map((entry) => entry.name),
    growth,
    nextFormName: nextIndex < FORMS.length ? FORMS[nextIndex].name : null,
    growthToNextForm: Math.max(0, toForm.nextAt - growth),
    nextSeedCost: nextSeedCost(endGarden.seeds + endGarden.plants),
  };
  away.summary = summarizeReturn(away);

  lastReturn = away;
  showReturnSummary(away);
  render();
  return away;
}

/** Show the welcome-back sentence, or keep it out of the way for a short gap. */
function showReturnSummary(away) {
  const element = elements.returnSummary;
  if (!element) return;
  if (!away || !(away.seconds >= MIN_AWAY_SECONDS)) {
    element.hidden = true;
    element.textContent = "";
    return;
  }
  element.textContent = away.summary;
  element.hidden = false;
}

/**
 * Replace the garden with the one in `text` and keep it.
 *
 * The moment of the load is recorded, so a deliberate load is not later read as
 * a long absence.
 *
 * @throws {Error} when the save cannot be read; the garden is left untouched.
 */
export function loadGardenSave(text) {
  const garden = decodeSave(text);
  setGarden(garden);
  setGrowth(garden.growth, garden.rate);
  const persisted = writeStoredGarden(getGarden());
  writeLastSeen(Date.now());
  return { ok: true, persisted, state: getDisplayedState() };
}

function announce(message) {
  setText(elements.status, message);
}

/**
 * How long until the next seed, in the shortest unit that still says something:
 * seconds under a minute, then minutes and seconds. A missing span says nothing.
 */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.ceil(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** The next seed as words: always how far away it is, never only its price. */
function describeGoal(state) {
  const cost = numberFormat.format(state.nextSeedCost);
  const ripening =
    state.secondsToNextPlant == null ? "" : ` Next plant matures in ${formatDuration(state.secondsToNextPlant)}.`;
  if (state.plotFull) return `All ${numberFormat.format(state.capacity)} plots hold a seed or plant.${ripening}`;
  if (state.canPlantSeed) return `Ready to plant — ${cost} growth saved.${ripening}`;
  if (!(state.rate > 0)) return `Tend the soil to grow faster — ${cost} growth needed.${ripening}`;
  return (
    `${growthFormat.format(state.growth)} / ${cost} growth — about ` +
    `${formatDuration(state.secondsToNextSeed)} at +${growthFormat.format(state.rate)}/s.${ripening}`
  );
}

/** The next plant maturing, as words, for the readout beside the numbers. */
function describeNextPlant(state) {
  if (state.secondsToNextPlant == null) return "none growing";
  return `${formatDuration(state.secondsToNextPlant)} / ${formatDuration(state.growSeconds)}`;
}

/** The Plant a seed button, the goal it is reaching for, and the meter between. */
function renderPlanting(state) {
  const cost = numberFormat.format(state.nextSeedCost);
  setText(elements.plant, state.plotFull ? "Plant a seed — the plot is full" : `Plant a seed — ${cost} growth`);
  if (elements.plant) elements.plant.disabled = !state.canPlantSeed;

  setText(
    elements.goalTitle,
    state.plotFull ? "Every plot holds a seed or plant" : `Plant seed #${numberFormat.format(state.totalPlanted + 1)}`
  );
  if (elements.meter) elements.meter.setAttribute("aria-valuenow", String(state.seedCostProgress));
  if (elements.meterFill) elements.meterFill.style.width = `${(state.seedCostProgress * 100).toFixed(1)}%`;
  setText(elements.goalDetail, describeGoal(state));
}

function plantSeedFromButton() {
  const result = plantSeed();
  if (!result.ok) {
    announce(
      result.reason === "the plot is full"
        ? "Every plot already holds a seed."
        : "Not enough growth for another seed yet."
    );
    return;
  }
  announce(
    `Planted a seed for ${numberFormat.format(result.cost)} growth — it will grow into a plant in ` +
      `${formatDuration(GROW_SECONDS)}.`
  );
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
  setText(elements.nextPlant, describeNextPlant(state));
  setText(elements.storage, state.storageAvailable ? "Yes" : "No");
  setText(elements.description, describePlot(state));
  renderPlanting(state);
  // Leave the field alone while the visitor is editing it; a re-render should
  // not erase a save they are about to paste.
  if (elements.save && document.activeElement !== elements.save) {
    elements.save.value = state.save;
  }

  // The picture follows the growth, not the stored garden, so it redraws when
  // the amount or the form it falls in changes — and stays put when nothing does.
  const plotKey = `${state.form}:${state.growth}:${state.seeds}:${state.plants}`;
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

  // Count everything since the visitor was last here, then record this visit as
  // the new starting point for the next absence.
  applyReturn(stored.garden, readLastSeen(), Date.now());
  persist();

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
    if (next.damaged) return;
    setGarden(next.garden);
    setGrowth(next.garden.growth, next.garden.rate);
  });

  elements.tend?.addEventListener("click", () => {
    tend();
    persist();
  });
  elements.plant?.addEventListener("click", () => {
    plantSeedFromButton();
    persist();
  });
  elements.copy?.addEventListener("click", copySave);
  elements.load?.addEventListener("click", loadSave);
  elements.save?.addEventListener("input", () => announce(""));

  // The live clock is wall time, not ticks, because ticks stop while a tab sleeps
  // and the visitor still expects that time to count. A backwards or missing
  // clock is clamped to no time rather than run in reverse.
  let lastTick = Date.now();
  let lastPersist = lastTick;
  const tick = () => {
    const now = Date.now();
    const elapsed = Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    if (elapsed > 0) advance(elapsed);
    if (now - lastPersist >= PERSIST_MS) {
      lastPersist = now;
      persist(now);
    }
  };
  setInterval(tick, TICK_MS);

  // Counting the gap on the way back in covers a tab that was hidden or a
  // device that slept; the garden is never cheated of time nobody watched.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persist();
      return;
    }
    tick();
    render();
  });
  window.addEventListener("pagehide", () => persist());

  render();
}

start();
