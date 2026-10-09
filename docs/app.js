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
  PLOTS_PER_BED,
  POLLINATOR_BOOST,
  SEED_KINDS,
  STORAGE_KEY,
  advance,
  decodeSave,
  elapsedSeconds,
  encodeSave,
  gardenKinds,
  getGarden,
  getGrowthState,
  kindIndex,
  nextBedCost,
  nextSeedCost,
  openBed,
  plantSeed,
  pollinatorAt,
  readLastSeen,
  seasonAt,
  readStoredGarden,
  setGarden,
  setGrowth,
  simulateGarden,
  storageAvailable,
  subscribe,
  tend,
  writeLastSeen,
  writeStoredGarden,
} from "./garden.js";
import { FORMS, drawGarden, gardenForm, motionPhase } from "./plotview.js";

const numberFormat = new Intl.NumberFormat("en");
const decimalFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// An amount this large or larger reads compact (12.3K); below it every amount
// stays exact, so the first minutes of play read as they always have.
const COMPACT_FROM = 1e4;
// Thousand, million, billion, trillion. Past the last one an amount is written
// as an exponent, so even an absurd one stays short on the page.
const COMPACT_SUFFIXES = ["K", "M", "B", "T"];

/**
 * A large amount written short — 12.3K, 4.5M, 1.1B — or `null` below 10,000,
 * so a caller falls back to its own exact format. One function, so the same
 * amount reads the same everywhere the page states it.
 */
function compactAmount(value) {
  if (!Number.isFinite(value) || value < COMPACT_FROM) return null;
  let scaled = value;
  let suffixIndex = -1;
  // Promote at 999.95, not 1000, so 999,999 rounds up to 1.0M rather than
  // 1000.0K — a suffix only ever carries a value that reads as less than 1000.
  while (scaled >= 999.95 && suffixIndex < COMPACT_SUFFIXES.length - 1) {
    scaled /= 1000;
    suffixIndex += 1;
  }
  if (scaled >= 999.95) return value.toExponential(1);
  return `${decimalFormat.format(scaled)}${COMPACT_SUFFIXES[suffixIndex]}`;
}

/** A growth total or rate: compact once large, one decimal below that. */
export function formatGrowth(value) {
  return compactAmount(value) ?? decimalFormat.format(value);
}

/** A counted amount — a cost, a seed, a bed: compact once large, exact below. */
export function formatAmount(value) {
  return compactAmount(value) ?? numberFormat.format(value);
}

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
  nextForm: document.querySelector('[data-field="next-form"]'),
  formMeter: document.getElementById("form-meter"),
  formMeterFill: document.getElementById("form-meter-fill"),
  tend: document.getElementById("tend"),
  plant: document.getElementById("plant-seed"),
  plantBloom: document.getElementById("plant-bloom"),
  kindHerb: document.querySelector('[data-field="kind-herb"]'),
  kindBloom: document.querySelector('[data-field="kind-bloom"]'),
  goalTitle: document.getElementById("goal-title"),
  goalDetail: document.getElementById("goal-detail"),
  meter: document.getElementById("seed-meter"),
  meterFill: document.getElementById("seed-meter-fill"),
  seeds: document.querySelector('[data-field="seeds"]'),
  plants: document.querySelector('[data-field="plants"]'),
  beds: document.querySelector('[data-field="beds"]'),
  capacity: document.querySelector('[data-field="capacity"]'),
  pollinator: document.querySelector('[data-field="pollinator"]'),
  season: document.querySelector('[data-field="season"]'),
  nextPlant: document.querySelector('[data-field="next-plant"]'),
  nextBed: document.querySelector('[data-field="next-bed"]'),
  openBed: document.getElementById("open-bed"),
  storage: document.querySelector('[data-field="storage"]'),
  plot: document.getElementById("garden-plot"),
  description: document.getElementById("plot-description"),
  returnSummary: document.getElementById("return-summary"),
  save: document.getElementById("save-value"),
  copy: document.getElementById("copy-save"),
  load: document.getElementById("load-save"),
  status: document.getElementById("save-status"),
  openSandbox: document.getElementById("open-sandbox"),
  sandbox: document.getElementById("sandbox"),
  sandboxElapsed: document.getElementById("sandbox-elapsed"),
  sandboxGrowth: document.getElementById("sandbox-growth"),
  sandboxRate: document.getElementById("sandbox-rate"),
  sandboxForm: document.querySelector('[data-field="sandbox-form"]'),
  sandboxMatured: document.querySelector('[data-field="sandbox-matured"]'),
  sandboxSeeds: document.querySelector('[data-field="sandbox-seeds"]'),
  sandboxPlants: document.querySelector('[data-field="sandbox-plants"]'),
  sandboxSeason: document.querySelector('[data-field="sandbox-season"]'),
  sandboxSummary: document.getElementById("sandbox-summary"),
  sandboxGoalTitle: document.getElementById("sandbox-goal-title"),
  sandboxGoalDetail: document.getElementById("sandbox-goal-detail"),
  sandboxMeter: document.getElementById("sandbox-meter"),
  sandboxMeterFill: document.getElementById("sandbox-meter-fill"),
  sandboxHour: document.getElementById("sandbox-hour"),
  sandboxDay: document.getElementById("sandbox-day"),
  sandboxMonth: document.getElementById("sandbox-month"),
  sandboxReset: document.getElementById("sandbox-reset"),
};

const isStorageAvailable = storageAvailable();

let palette = null;

/** The seasons the plot has its own foliage colours for, in the cycle's order. */
const LEAF_SEASONS = ["winter", "spring", "summer", "autumn"];

/**
 * The palette, read once from the `:root` CSS variables rather than repeated.
 *
 * `leafSeasons` holds each season's own leaf trio beside the base one, so the
 * plot can swap the foliage for the season it is drawing without a second
 * source of colour anywhere.
 */
export function readPalette() {
  if (palette) return palette;
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  const readLeaves = (season) => ({
    leaf: read(`--leaf-${season}`),
    leafLight: read(`--leaf-${season}-light`),
    leafDeep: read(`--leaf-${season}-deep`),
  });
  palette = {
    soil: read("--soil"),
    soilDeep: read("--soil-deep"),
    soilLight: read("--soil-light"),
    leaf: read("--leaf"),
    leafLight: read("--leaf-light"),
    leafDeep: read("--leaf-deep"),
    bloom: read("--bloom"),
    sun: read("--sun"),
    leafSeasons: Object.fromEntries(LEAF_SEASONS.map((season) => [season, readLeaves(season)])),
  };
  return palette;
}

const countLabel = (count, singular, plural) =>
  `${formatAmount(count)} ${count === 1 ? singular : plural}`;

/** The picture, said in words: the same growth, beds, form and season the plot draws. */
function describePlot(state) {
  return (
    `${formatGrowth(state.growth)} growth — ${state.formName}, in ${state.season.name}. ` +
    `${countLabel(state.beds, "bed of soil", "beds of soil")}, ` +
    `${countLabel(state.seeds, "ungrown seed", "ungrown seeds")}, ` +
    `${countLabel(state.plants, "grown plant", "grown plants")}.`
  );
}

/** The next form the garden is reaching for, in the return summary's words. */
function describeNextForm(state) {
  if (!state.nextFormName) {
    return `the last form — still filling, ${formatGrowth(state.growthToNextForm)} growth to the far end`;
  }
  return `next: ${state.nextFormName} — ${formatGrowth(state.growthToNextForm)} growth away`;
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
  const { growth, rate, age } = getGrowthState();
  return {
    ...describeGardenState(getGarden(), growth, rate, age),
    save: exportSave(),
    away: lastReturn,
    sandbox: getSandboxState(),
    storageAvailable: isStorageAvailable,
  };
}

/**
 * Everything a garden state shows, read the same way the page reads the live
 * one. `garden` is `getGarden()`'s shape (or an equivalent), so a simulated
 * garden and the live one are described by one function and cannot disagree.
 */
function describeGardenState(garden, growth, rate, age) {
  const form = gardenForm(growth);
  const planted = garden.seeds + garden.plants;
  const plotFull = planted >= garden.capacity;
  const bedCost = nextBedCost(garden.beds);
  // Each kind's price, counts and timers, read the same way the plot draws
  // them: one source, so the buttons, the readout and the goal cannot disagree.
  const kinds = gardenKinds({ ...garden, capacity: garden.capacity }).map((kind) => ({
    index: kind.index,
    key: kind.key,
    name: kind.name,
    cost: kind.cost,
    production: kind.production,
    growSeconds: kind.growSeconds,
    seeds: kind.seeds,
    plants: kind.plants,
    total: kind.total,
    canPlant: !plotFull && growth >= kind.cost,
  }));
  // The season the age falls in and the visiting pollinator multiply what is
  // displayed, but never the rate the garden keeps: `rate` is the boosted
  // number a visitor reads, `baseRate` is the one that is saved and compounded,
  // so each boost is applied once. Season and pollinator are added here just as
  // the simulation adds their seconds, so the readout matches what it earns.
  const pollinator = pollinatorAt(age, garden.plants);
  const season = seasonAt(age);
  const displayRate = rate * (season.multiplier + (pollinator.visiting ? POLLINATOR_BOOST - 1 : 0));
  const goal = nextSeedGoal({ growth, plotFull, capacity: garden.capacity, kinds });
  const goalCost = goal ? goal.cost : kinds[0].cost;
  return {
    seeds: garden.seeds,
    plants: garden.plants,
    totalPlanted: planted,
    kinds,
    seedCounts: kinds.map((kind) => kind.seeds),
    plantCounts: kinds.map((kind) => kind.plants),
    growth,
    rate: displayRate,
    baseRate: rate,
    age,
    season,
    pollinator,
    form: form.index,
    formName: form.name,
    // The goal the form line is reaching for: the next named form, how far it
    // still is, and how full the meter between the two thresholds is now.
    formProgress: form.fill,
    nextFormName: form.index + 1 < FORMS.length ? FORMS[form.index + 1].name : null,
    growthToNextForm: Math.max(0, form.nextAt - growth),
    beds: garden.beds,
    capacity: garden.capacity,
    growSeconds: GROW_SECONDS,
    secondsToNextPlant: secondsToNextPlant(garden.sprouts, garden.bloomSprouts),
    // The next seed the goal names: its kind, its price, and how far off it is.
    nextSeedKind: goal ? goal.key : null,
    nextSeedCost: goalCost,
    canPlantSeed: Boolean(goal) && growth >= goalCost,
    plotFull,
    seedCostProgress: goalCost > 0 ? Math.min(1, Math.max(0, growth / goalCost)) : 1,
    secondsToNextSeed: !goal || !(displayRate > 0) ? null : Math.max(0, (goalCost - growth) / displayRate),
    nextBedCost: bedCost,
    canOpenBed: plotFull && growth >= bedCost,
    bedCostProgress: bedCost > 0 ? Math.min(1, Math.max(0, growth / bedCost)) : 1,
    secondsToNextBed: !plotFull || !(displayRate > 0) ? null : Math.max(0, (bedCost - growth) / displayRate),
  };
}

/**
 * The next seed worth planting, named by kind: the seed a visitor reads off the
 * goal panel and an agent reads off `get-state`.
 *
 * Pure. It picks, among the kinds the free soil can still take, the most
 * expensive one the garden can already afford — an ambitious but reachable
 * plant — and when nothing is affordable yet, the cheapest kind, the one the
 * garden will reach first. No free soil for any kind means no seed goal: the
 * plot is full and the next goal is a bed.
 *
 * @returns {{key: string, name: string, cost: number, production: number, growSeconds: number}|null}
 */
export function nextSeedGoal(state) {
  const candidates = (state?.kinds ?? []).filter((kind) => !state.plotFull && kind.total < state.capacity);
  if (!candidates.length) return null;
  const affordable = candidates.filter((kind) => state.growth >= kind.cost);
  return affordable.length
    ? affordable.reduce((best, kind) => (kind.cost > best.cost ? kind : best))
    : candidates.reduce((best, kind) => (kind.cost < best.cost ? kind : best));
}

/**
 * How long until the soonest ungrown seed of either kind becomes a plant, or
 * null when nothing is growing.
 */
function secondsToNextPlant(sprouts, bloomSprouts = []) {
  const timers = [...(Array.isArray(sprouts) ? sprouts : []), ...(Array.isArray(bloomSprouts) ? bloomSprouts : [])]
    .filter((timer) => Number.isFinite(timer) && timer > 0);
  if (!timers.length) return null;
  return Math.max(0, Math.min(...timers));
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
  const pollinator = away.pollinator?.visiting
    ? ` A pollinator is visiting — the garden is growing ${away.pollinator.multiplier} times as fast while it stays.`
    : "";
  const season = away.crossedSeason
    ? ` The garden turned from ${away.fromSeason.name} into ${away.toSeason.name} — its growth is now ` +
      `x${away.toSeason.multiplier}.`
    : "";
  const grown = `While you were away ${formatAway(away.seconds)}, the garden earned ` +
    `${formatGrowth(away.earned)} growth and is now ${away.form}.` + matured + pollinator + season;

  // "What was found": the forms the absence grew it into, named at the top.
  let found = "";
  if (away.formsFound.length === 1) found = ` It grew into ${away.formsFound[0]}.`;
  else if (away.formsFound.length > 1) {
    found = ` It grew through ${away.formsFound.length} new forms, up to ${away.formsFound[away.formsFound.length - 1]}.`;
  }

  // "What is now possible": the next form, or the next seed once past them all.
  const next = away.nextFormName
    ? ` ${away.nextFormName} is ${formatGrowth(away.growthToNextForm)} growth away — keep tending.`
    : ` A seed costs ${formatAmount(away.nextSeedCost)} growth — plant one when you can.`;

  return grown + found + next;
}

/**
 * Describe a span of time against a garden state, with no cap on the span.
 *
 * Pure, and the one place a return report is built: `start` is a garden state
 * (`{growth, rate, sprouts, plants, beds}`) and the result is the same `away`
 * report the page shows after an absence — the span, what it earned and grew
 * into (including how many seeds matured), the summary sentence, and what to
 * reach for next. The sandbox rehearses with it, so a rehearsal reads exactly
 * as the real absence would.
 *
 * @returns {object} the `away` report, its `summary` included.
 */
export function buildAwayReport(start, seconds) {
  const before = simulateGarden(start, 0);
  const after = simulateGarden(start, seconds);
  const fromForm = gardenForm(before.growth);
  const toForm = gardenForm(after.growth);
  const nextIndex = toForm.index + 1;
  const report = {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    earned: after.growth - before.growth,
    matured: after.plants + after.bloomPlants - (before.plants + before.bloomPlants),
    from: fromForm.index,
    fromName: fromForm.name,
    to: toForm.index,
    form: toForm.name,
    formsFound: FORMS.slice(fromForm.index + 1, toForm.index + 1).map((entry) => entry.name),
    growth: after.growth,
    nextFormName: nextIndex < FORMS.length ? FORMS[nextIndex].name : null,
    growthToNextForm: Math.max(0, toForm.nextAt - after.growth),
    nextSeedCost: nextSeedCost(after.sprouts.length + after.bloomSprouts.length + after.plants + after.bloomPlants),
  };
  // Whether a pollinator is on the plot at the end of the span, so a return
  // that arrives during a visit can say so rather than only showing bigger
  // numbers.
  report.pollinator = pollinatorAt(after.age, after.plants);
  // The season at each end, so a return that crossed a boundary can name it.
  report.fromSeason = seasonAt(before.age);
  report.toSeason = seasonAt(after.age);
  report.crossedSeason = report.fromSeason.key !== report.toSeason.key;
  report.summary = summarizeReturn(report);
  return report;
}

/**
 * Count the time since `lastSeenMs` against the garden's growth and rate, with
 * no cap, and put the garden where that much played time would have left it.
 *
 * The report comes from `buildAwayReport` and the live garden is set to the end
 * of that same simulation, so what the page shows and what the summary says can
 * never disagree.
 *
 * @param {{growth: number, rate: number}} saved the growth and rate left behind
 * @param {number|null} lastSeenMs
 * @param {number} nowMs
 * @returns {object} the `away` report.
 */
export function applyReturn(saved, lastSeenMs, nowMs) {
  const seconds = elapsedSeconds(lastSeenMs, nowMs);
  const live = getGarden();
  const start = {
    growth: saved.growth,
    rate: saved.rate,
    age: saved.age,
    sprouts: live.sprouts,
    bloomSprouts: live.bloomSprouts,
    plantCounts: live.plantCounts,
    beds: live.beds,
  };
  const away = buildAwayReport(start, seconds);
  const after = simulateGarden(start, seconds);

  setGrowth(after.growth, after.rate, after.age);
  setGarden({
    beds: start.beds,
    plants: after.plants,
    bloomPlants: after.bloomPlants,
    sprouts: after.sprouts,
    bloomSprouts: after.bloomSprouts,
  });

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

// --- Rehearsing time in a sandbox -------------------------------------------
//
// A copy of the garden held only in memory, wound forward on demand, so a
// visitor can see what an hour, a day or a month away does without risking the
// real one. Nothing here is ever saved or written: the sandbox keeps its own
// snapshot and span, and the real garden, its save and its last-seen moment are
// exactly as they were. The summary and the next goal come from the same
// `summarizeReturn` and `describeNextGoal` the real return uses, so a rehearsal
// reads exactly as the real absence would.

/** The three fast-forward jumps the page offers, in the order it offers them. */
export const SANDBOX_SPANS = Object.freeze([
  { key: "hour", label: "1 hour", seconds: 3600 },
  { key: "day", label: "1 day", seconds: 86400 },
  { key: "month", label: "1 month", seconds: 2592000 },
]);

/** The seconds a span name stands for, or 0 for a name that is not a span. */
export function sandboxSpanSeconds(key) {
  const span = SANDBOX_SPANS.find((entry) => entry.key === key);
  return span ? span.seconds : 0;
}

/** The open sandbox: its opening snapshot, how far it has wound, and its read. */
let sandbox = null;

/** A copy of the live garden's state — the point a rehearsal runs forward from. */
function gardenSnapshot() {
  const garden = getGarden();
  const { growth, rate, age } = getGrowthState();
  return {
    growth,
    rate,
    age,
    sprouts: garden.sprouts,
    bloomSprouts: garden.bloomSprouts,
    plantCounts: garden.plantCounts,
    beds: garden.beds,
  };
}

/** Start a fresh sandbox from the garden as it is now, wound back to zero. */
function startSandbox() {
  sandbox = { snapshot: gardenSnapshot(), seconds: 0, shown: null };
}

/** Recompute what the open sandbox shows, from its snapshot and its span. */
function rehearseSandbox() {
  if (!sandbox) return;
  const end = simulateGarden(sandbox.snapshot, sandbox.seconds);
  const away = buildAwayReport(sandbox.snapshot, sandbox.seconds);
  const display = describeGardenState(
    {
      seeds: end.sprouts.length + end.bloomSprouts.length,
      plants: end.plants + end.bloomPlants,
      sprouts: end.sprouts,
      bloomSprouts: end.bloomSprouts,
      plantCounts: end.plantCounts,
      beds: end.beds,
      capacity: end.beds * PLOTS_PER_BED,
    },
    end.growth,
    end.rate,
    end.age
  );
  const goal = describeNextGoal(display);
  sandbox.shown = {
    open: true,
    seconds: sandbox.seconds,
    elapsed: formatAway(sandbox.seconds),
    growth: display.growth,
    rate: display.rate,
    season: display.season,
    pollinator: display.pollinator,
    form: display.form,
    formName: display.formName,
    formProgress: display.formProgress,
    nextFormName: display.nextFormName,
    growthToNextForm: display.growthToNextForm,
    seeds: display.seeds,
    plants: display.plants,
    beds: display.beds,
    capacity: display.capacity,
    matured: away.matured,
    summary: away.summary,
    goalTitle: goal.title,
    goalDetail: goal.detail,
    goalProgress: goal.progress,
  };
}

/**
 * Open a sandbox on a copy of the real garden, wound back to its start.
 *
 * Reads the live garden and keeps nothing of the real one: no save, no
 * last-seen, no growth. Opening again re-copies the garden as it is now.
 */
export function openSandbox() {
  startSandbox();
  rehearseSandbox();
  render();
  return getSandboxState();
}

/**
 * Wind the sandbox forward by `seconds`, opening it first if it is closed. A
 * span that is not a positive number adds no time.
 */
export function fastForwardSandbox(seconds) {
  if (!sandbox) startSandbox();
  if (Number.isFinite(seconds) && seconds > 0) sandbox.seconds += seconds;
  rehearseSandbox();
  render();
  return getSandboxState();
}

/** Put the sandbox back to the moment it was opened. Safe while it is closed. */
export function resetSandbox() {
  if (!sandbox) return getSandboxState();
  sandbox.seconds = 0;
  rehearseSandbox();
  render();
  return getSandboxState();
}

/** What the sandbox shows, or `{open: false}` while it is closed. */
export function getSandboxState() {
  return sandbox ? sandbox.shown : { open: false };
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
  setGrowth(garden.growth, garden.rate, garden.age);
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
  const cost = formatAmount(state.nextSeedCost);
  const ripening =
    state.secondsToNextPlant == null ? "" : ` Next plant matures in ${formatDuration(state.secondsToNextPlant)}.`;
  if (state.canPlantSeed) return `Ready to plant — ${cost} growth saved.${ripening}`;
  if (!(state.rate > 0)) return `Tend the soil to grow faster — ${cost} growth needed.${ripening}`;
  return (
    `${formatGrowth(state.growth)} / ${cost} growth — about ` +
    `${formatDuration(state.secondsToNextSeed)} at +${formatGrowth(state.rate)}/s.${ripening}`
  );
}

/**
 * The next bed as words, once every plot is full: what it costs, how far along
 * that the garden is, and when it can be opened.
 */
function describeBedGoal(state) {
  const cost = formatAmount(state.nextBedCost);
  const ripening =
    state.secondsToNextPlant == null ? "" : ` Next plant matures in ${formatDuration(state.secondsToNextPlant)}.`;
  if (state.canOpenBed) return `Ready to open — ${cost} growth saved.${ripening}`;
  if (!(state.rate > 0)) return `Tend the soil to grow faster — ${cost} growth needed.${ripening}`;
  return (
    `${formatGrowth(state.growth)} / ${cost} growth — about ` +
    `${formatDuration(state.secondsToNextBed)} at +${formatGrowth(state.rate)}/s.${ripening}`
  );
}

/** The next bed's price and progress, always on the page once shown. */
function describeNextBed(state) {
  const cost = formatAmount(state.nextBedCost);
  const percent = Math.round(state.bedCostProgress * 100);
  return `${cost} growth · ${percent}% saved`;
}

/** The season the garden is in, and how much faster it grows for it. */
function describeSeason(state) {
  return `${state.season.name} — x${state.season.multiplier} growth`;
}

/** Whether a pollinator is visiting, and how much faster the garden grows. */
function describePollinator(state) {
  const pollinator = state.pollinator;
  if (!pollinator || !pollinator.visiting) return "none visiting";
  return `visiting — x${pollinator.multiplier} growth`;
}

/** The next plant maturing, as words, for the readout beside the numbers. */
function describeNextPlant(state) {
  if (state.secondsToNextPlant == null) return "none growing";
  return `${formatDuration(state.secondsToNextPlant)} / ${formatDuration(state.growSeconds)}`;
}

/**
 * The next thing worth reaching for, as a title, a sentence and 0-to-1
 * progress. The title names the kind the goal is worth planting — herb or
 * bloom — and its cost. While every plot is full the goal becomes the next
 * bed, so the garden always has something to reach for instead of ending at
 * "every plot holds a seed" — and a sandbox rehearsal asks for the same goal
 * afterwards.
 */
function describeNextGoal(state) {
  if (state.plotFull) {
    return {
      title: `Open bed #${formatAmount(state.beds + 1)}`,
      detail: describeBedGoal(state),
      progress: state.bedCostProgress,
    };
  }
  const goal = nextSeedGoal(state);
  const cost = formatAmount(goal ? goal.cost : state.nextSeedCost);
  return {
    title: `Plant ${goal ? goal.name : "herb"} seed — ${cost} growth`,
    detail: describeGoal(state),
    progress: state.seedCostProgress,
  };
}

/**
 * The two Plant buttons — one per kind, each naming the seed it plants and
 * what it costs — with the goal and the meter between them.
 */
function renderPlanting(state) {
  for (const [button, kind] of [
    [elements.plant, state.kinds[0]],
    [elements.plantBloom, state.kinds[1]],
  ]) {
    if (!button || !kind) continue;
    const cost = formatAmount(kind.cost);
    setText(button, state.plotFull ? `Plant a ${kind.name} seed — the plot is full` : `Plant a ${kind.name} seed — ${cost} growth`);
    button.disabled = !kind.canPlant;
  }

  const goal = describeNextGoal(state);
  setText(elements.goalTitle, goal.title);
  setMeter(goal.progress);
  setText(elements.goalDetail, goal.detail);

  renderOpenBed(state);
}

/**
 * The two kinds as the readout reads them: each kind's seeds and plants, the
 * price of its next seed, and what one grown plant adds to the rate.
 */
function describeKind(kind) {
  const count = `${formatAmount(kind.seeds)} ${kind.seeds === 1 ? "seed" : "seeds"} · ` +
    `${formatAmount(kind.plants)} ${kind.plants === 1 ? "plant" : "plants"}`;
  return `${count} — next ${formatAmount(kind.cost)} · +${formatGrowth(kind.production)}/s each`;
}

/** Point a goal meter at `progress`, from 0 to 1. */
function setMeter(progress, meter = elements.meter, fill = elements.meterFill) {
  if (meter) meter.setAttribute("aria-valuenow", String(progress));
  if (fill) fill.style.width = `${(progress * 100).toFixed(1)}%`;
}

/** The Open the next bed button: offered only when every plot is full. */
function renderOpenBed(state) {
  const button = elements.openBed;
  if (!button) return;
  button.hidden = !state.plotFull;
  setText(button, `Open the next bed — ${formatAmount(state.nextBedCost)} growth`);
  button.disabled = !state.canOpenBed;
}

/** Plant one kind's seed from its button, and say what was planted. */
function plantSeedFromButton(kind = "herb") {
  const result = plantSeed(kind);
  if (!result.ok) {
    announce(
      result.reason === "the plot is full"
        ? "Every plot already holds a seed."
        : "Not enough growth for another seed yet."
    );
    return;
  }
  const entry = SEED_KINDS[kindIndex(result.kind)];
  announce(
    `Planted a ${entry.name} seed for ${formatAmount(result.cost)} growth — it will grow into a plant in ` +
      `${formatDuration(entry.growSeconds)}.`
  );
}

function openBedFromButton() {
  const result = openBed();
  if (!result.ok) {
    announce(
      result.reason === "not enough growth"
        ? "Not enough growth for the next bed yet."
        : "Every plot still has room — plant in it first."
    );
    return;
  }
  announce(
    `Opened bed #${formatAmount(result.beds)} for ${formatAmount(result.cost)} growth — ` +
      `${formatAmount(result.beds * PLOTS_PER_BED)} plots of soil now.`
  );
}

let lastPlotKey = null;
// The plot's animation phase: it advances one step per tick so the garden
// breathes between milestones, and is pinned to a still frame by reduced motion.
let plotFrame = 0;
let plotReducedMotion = false;

/** Whether anything on the plot can move — a growing seed, a plant, a visitor. */
function plotIsLiving(state) {
  return state.seeds + state.plants > 0 || Boolean(state.pollinator && state.pollinator.visiting);
}

function render() {
  // A hidden tab still keeps the garden growing (the timer derives growth from
  // elapsed time), but there is nobody to see it redraw.
  if (document.hidden) return;

  const state = getDisplayedState();
  setText(elements.growth, formatGrowth(state.growth));
  setText(elements.rate, `+${formatGrowth(state.rate)}/s`);
  setText(elements.form, state.formName);
  setText(elements.nextForm, describeNextForm(state));
  setMeter(state.formProgress, elements.formMeter, elements.formMeterFill);
  setText(elements.seeds, formatAmount(state.seeds));
  setText(elements.plants, formatAmount(state.plants));
  setText(elements.beds, formatAmount(state.beds));
  setText(elements.capacity, formatAmount(state.capacity));
  setText(elements.pollinator, describePollinator(state));
  setText(elements.season, describeSeason(state));
  setText(elements.kindHerb, describeKind(state.kinds[0]));
  setText(elements.kindBloom, describeKind(state.kinds[1]));
  setText(elements.nextPlant, describeNextPlant(state));
  setText(elements.nextBed, describeNextBed(state));
  setText(elements.storage, state.storageAvailable ? "Yes" : "No");
  setText(elements.description, describePlot(state));
  renderPlanting(state);
  renderSandbox(state);
  // Leave the field alone while the visitor is editing it; a re-render should
  // not erase a save they are about to paste.
  if (elements.save && document.activeElement !== elements.save) {
    elements.save.value = state.save;
  }

  // The picture follows the growth, not the stored garden, so it redraws when
  // the amount, the form it falls in, the kinds on the plot or the season
  // change — and stays put when nothing does. Its breathing phase is part of
  // the key, so a still plot (bare soil, or reduced motion) is redrawn only
  // when the state changes, while a living one advances a frame each tick.
  const phase = motionPhase({
    reduced: plotReducedMotion,
    frame: plotFrame,
    living: plotIsLiving(state),
  });
  const plotKey =
    `${state.form}:${state.growth}:${state.seedCounts.join(",")}:${state.plantCounts.join(",")}:` +
    `${state.beds}:${state.pollinator.visiting}:${state.season.key}:${phase}`;
  if (plotKey !== lastPlotKey) {
    drawGarden(elements.plot, state, readPalette(), phase);
    lastPlotKey = plotKey;
  }
}

/** The rehearsal panel: the garden it wound forward, or hidden while it is shut. */
function renderSandbox(state) {
  const rehearsal = state.sandbox;
  if (elements.sandbox) elements.sandbox.hidden = !rehearsal.open;
  if (elements.openSandbox) elements.openSandbox.hidden = rehearsal.open;
  if (!rehearsal.open) return;

  setText(elements.sandboxElapsed, rehearsal.elapsed);
  setText(elements.sandboxGrowth, formatGrowth(rehearsal.growth));
  setText(elements.sandboxRate, `+${formatGrowth(rehearsal.rate)}/s`);
  setText(elements.sandboxForm, rehearsal.formName);
  setText(elements.sandboxMatured, formatAmount(rehearsal.matured));
  setText(elements.sandboxSeeds, formatAmount(rehearsal.seeds));
  setText(elements.sandboxPlants, formatAmount(rehearsal.plants));
  setText(elements.sandboxSeason, describeSeason(rehearsal));
  setText(elements.sandboxSummary, rehearsal.summary);
  setText(elements.sandboxGoalTitle, rehearsal.goalTitle);
  setText(elements.sandboxGoalDetail, rehearsal.goalDetail);
  setMeter(rehearsal.goalProgress, elements.sandboxMeter, elements.sandboxMeterFill);
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
    setGrowth(next.garden.growth, next.garden.rate, next.garden.age);
  });

  elements.tend?.addEventListener("click", () => {
    tend();
    persist();
  });
  elements.plant?.addEventListener("click", () => {
    plantSeedFromButton("herb");
    persist();
  });
  elements.plantBloom?.addEventListener("click", () => {
    plantSeedFromButton("bloom");
    persist();
  });
  elements.openBed?.addEventListener("click", () => {
    openBedFromButton();
    persist();
  });
  elements.copy?.addEventListener("click", copySave);
  elements.load?.addEventListener("click", loadSave);
  elements.save?.addEventListener("input", () => announce(""));

  elements.openSandbox?.addEventListener("click", () => openSandbox());
  elements.sandboxHour?.addEventListener("click", () => fastForwardSandbox(sandboxSpanSeconds("hour")));
  elements.sandboxDay?.addEventListener("click", () => fastForwardSandbox(sandboxSpanSeconds("day")));
  elements.sandboxMonth?.addEventListener("click", () => fastForwardSandbox(sandboxSpanSeconds("month")));
  elements.sandboxReset?.addEventListener("click", () => resetSandbox());

  // The live clock is wall time, not ticks, because ticks stop while a tab sleeps
  // and the visitor still expects that time to count. A backwards or missing
  // clock is clamped to no time rather than run in reverse.
  let lastTick = Date.now();
  let lastPersist = lastTick;
  const tick = () => {
    const now = Date.now();
    const elapsed = Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    plotFrame += 1;
    if (elapsed > 0) advance(elapsed);
    if (now - lastPersist >= PERSIST_MS) {
      lastPersist = now;
      persist(now);
    }
  };
  setInterval(tick, TICK_MS);

  // Read the visitor's motion preference once and keep it current; a change
  // pins the plot to a still frame (or releases it) and redraws at once.
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (reducedMotion) {
    plotReducedMotion = reducedMotion.matches;
    reducedMotion.addEventListener("change", (event) => {
      plotReducedMotion = event.matches;
      lastPlotKey = null;
      render();
    });
  }

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
