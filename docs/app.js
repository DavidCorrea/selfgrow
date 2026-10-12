/**
 * The page: a soil plot beside the garden's quantities in text and numbers, the
 * Tend the soil action that starts the garden growing, the Plant a seed action
 * that spends that growth to grow faster, the next seed always shown as progress
 * and time away, the growth the garden has produced over its whole life beside
 * what a replant right now would earn from it, the Replant action that resets
 * the run for a lasting bonus once the garden is flourishing, and a save the
 * player can copy out and load back.
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
  POLLINATOR_BLOOM_VISIT_SECONDS,
  POLLINATOR_BOOST,
  POLLINATOR_VISIT_MAX_SECONDS,
  MILESTONE_MULTIPLIER,
  SEED_KINDS,
  STORAGE_KEY,
  TEND_RATE_STEP,
  TEND_YIELD,
  advance,
  canReplant,
  decodeSave,
  elapsedSeconds,
  encodeSave,
  gardenKinds,
  getGarden,
  getGrowthState,
  kindIndex,
  kindSeasonMultiplier,
  milestoneBoost,
  nextBedCost,
  nextSeedCost,
  openBed,
  openBedInState,
  plantSeed,
  plantSeedInState,
  pollinatorAt,
  readLastSeen,
  replant,
  replantBonus,
  seasonAt,
  readStoredGarden,
  setGarden,
  setGrowth,
  simulateGarden,
  storageAvailable,
  subscribe,
  tend,
  tendInState,
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
// Exported so the return marks and the welcome-back note use the one threshold.
export const MIN_AWAY_SECONDS = 60;

const elements = {
  growth: document.getElementById("growth-total"),
  rate: document.getElementById("growth-rate"),
  lifetime: document.getElementById("lifetime-total"),
  replantBonus: document.getElementById("replant-bonus"),
  bonus: document.getElementById("bonus-total"),
  bonusRow: document.getElementById("bonus-row"),
  replant: document.getElementById("replant"),
  replantDialog: document.getElementById("replant-dialog"),
  replantDialogBonus: document.getElementById("replant-dialog-bonus"),
  replantConfirm: document.getElementById("replant-confirm"),
  replantCancel: document.getElementById("replant-cancel"),
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
  gardenStatus: document.getElementById("garden-status"),
  returnMarks: document.querySelector('[data-field="return-marks"]'),
  returnMarksRow: document.getElementById("return-marks-row"),
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
  sandboxTend: document.getElementById("sandbox-tend"),
  sandboxPlantHerb: document.getElementById("sandbox-plant-herb"),
  sandboxPlantBloom: document.getElementById("sandbox-plant-bloom"),
  sandboxOpenBed: document.getElementById("sandbox-open-bed"),
  sandboxStatus: document.getElementById("sandbox-status"),
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
  const { growth, rate, age, lifetime, bonus } = getGrowthState();
  return {
    ...describeGardenState(getGarden(), growth, rate, age, bonus),
    // The garden's whole history, what replanting right now would earn from it,
    // and the lasting bonus a replant has already earned. They live here rather
    // than in `describeGardenState` because a rehearsal has no lifetime or bonus
    // of its own: a sandbox describes one span of a garden, not a life.
    lifetimeGrowth: lifetime,
    replantBonus: replantBonus(lifetime),
    bonus,
    canReplant: canReplant(lifetime),
    save: exportSave(),
    away: lastReturn,
    // What the last return marked on the garden, so an agent sees the same
    // change the plot draws; null once the marks clear.
    returnMarks,
    sandbox: getSandboxState(),
    storageAvailable: isStorageAvailable,
  };
}

/**
 * Everything a garden state shows, read the same way the page reads the live
 * one. `garden` is `getGarden()`'s shape (or an equivalent), so a simulated
 * garden and the live one are described by one function and cannot disagree.
 */
function describeGardenState(garden, growth, rate, age, bonus = 0) {
  const form = gardenForm(growth);
  const planted = garden.seeds + garden.plants;
  const plotFull = planted >= garden.capacity;
  const bedCost = nextBedCost(garden.beds);
  // Each kind's price, counts and timers, read the same way the plot draws
  // them: one source, so the buttons, the readout and the goal cannot disagree.
  const season = seasonAt(age);
  const kinds = gardenKinds({ ...garden, capacity: garden.capacity }).map((kind) => ({
    index: kind.index,
    key: kind.key,
    name: kind.name,
    cost: kind.cost,
    production: kind.production,
    // What one grown plant of this kind actually earns now, lifted by the
    // milestones its plant count has already reached, and the next rung of its
    // ladder with how many more plants it needs. Both are read from the same
    // counts the simulation rewards, so the readout and the growth agree.
    output: kind.output,
    milestoneMultiplier: kind.milestoneMultiplier,
    nextMilestone: kind.nextMilestone,
    plantsToMilestone: kind.plantsToMilestone,
    growSeconds: kind.growSeconds,
    seeds: kind.seeds,
    plants: kind.plants,
    total: kind.total,
    // The season this kind thrives in, and its own growth boost right now —
    // its seasonBoost in its best season, 1 the rest of the year. Both are
    // reported so a person and an agent can see which kind the year favours.
    bestSeason: SEED_KINDS[kind.index].bestSeason,
    seasonMultiplier: kindSeasonMultiplier(kind.index, season.key),
    canPlant: !plotFull && growth >= kind.cost,
  }));
  const plantCounts = kinds.map((kind) => kind.plants);
  // The season the age falls in and the visiting pollinator multiply what is
  // displayed, but never the rate the garden keeps. The lasting bonus is part
  // of that kept rate, and so is the milestone boost the grown plants have
  // earned: both are added flat to the earned rate, so `baseRate` is the rate
  // the garden actually grows at before a boost, and `rate` is the boosted
  // number a visitor reads, applied once.
  const pollinator = pollinatorAt(age, garden.plants, kinds[1] ? kinds[1].plants : 0);
  const baseRate = rate + bonus + milestoneBoost(plantCounts);
  // The rate the page shows is the instantaneous slope of the simulation: the
  // shared season multiplier on the kept rate, each kind's own share — its
  // plants lifted by its milestone multiplier — raised to its kind's boost in
  // its best season, and the pollinator's flat extra while one visits. Every
  // kind's own boost and milestones are visible in its row above.
  const herbRate = kinds[0].plants * SEED_KINDS[0].production * kinds[0].milestoneMultiplier;
  const bloomRate = kinds[1].plants * SEED_KINDS[1].production * kinds[1].milestoneMultiplier;
  const perKindRate =
    baseRate + herbRate * (kinds[0].seasonMultiplier - 1) + bloomRate * (kinds[1].seasonMultiplier - 1);
  const displayRate =
    season.multiplier * perKindRate + (pollinator.visiting ? baseRate * (POLLINATOR_BOOST - 1) : 0);
  const goal = nextSeedGoal({ growth, plotFull, capacity: garden.capacity, kinds });
  const goalCost = goal ? goal.cost : kinds[0].cost;
  return {
    seeds: garden.seeds,
    plants: garden.plants,
    totalPlanted: planted,
    kinds,
    seedCounts: kinds.map((kind) => kind.seeds),
    plantCounts,
    growth,
    rate: displayRate,
    baseRate,
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

/**
 * What the last return marked on the garden, shown until the visitor acts or it
 * times out, so a returning player sees the change rather than reading about it.
 */
let returnMarks = null;
let returnMarkTimer = null;
// The marks clear on their own after a short while, so a returning player who
// does not act still finds the garden uncluttered.
const RETURN_MARK_MS = 30000;

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
  const sown = away.sown > 0
    ? ` The garden sowed ${countLabel(away.sown, "seed", "seeds")} into the free soil while you were away.`
    : "";
  const pollinator = away.pollinator?.visiting
    ? ` A pollinator is visiting — the garden is growing ${away.pollinator.multiplier} times as fast while it stays` +
      (away.pollinator.bloomsKeeping > 0
        ? `, and the ${countLabel(away.pollinator.bloomsKeeping, "bloom", "blooms")} are keeping it for ` +
          `${formatDuration(away.pollinator.visitSeconds)}.`
        : ".")
    : "";
  const season = away.crossedSeason
    ? ` The garden turned from ${away.fromSeason.name} into ${away.toSeason.name} — ` +
      (away.seasonChangedKinds?.length
        ? `${away.seasonChangedKinds.join(" and ")} growth changed, and its growth is now ` +
          `x${away.toSeason.multiplier}.`
        : `its growth is now x${away.toSeason.multiplier}.`)
    : "";
  const grown = `While you were away ${formatAway(away.seconds)}, the garden earned ` +
    `${formatGrowth(away.earned)} growth and is now ${away.form}.` + matured + sown + pollinator + season;

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
 * into (including how many seeds it sowed into free plots and how many
 * matured), the summary sentence, and what to reach for next. The sandbox
 * rehearses with it, so a rehearsal reads exactly as the real absence would.
 *
 * @returns {object} the `away` report, its `summary` included.
 */
export function buildAwayReport(start, seconds) {
  const before = simulateGarden(start, 0);
  // A real absence sows: the garden spends its earned growth on affordable
  // seeds in free plots, so a return finds a garden that has grown rather than
  // only a bigger number. The live tick does not sow; that planting is the
  // visitor's.
  const after = simulateGarden(start, seconds, { sow: true });
  const fromForm = gardenForm(before.growth);
  const toForm = gardenForm(after.growth);
  const nextIndex = toForm.index + 1;
  const report = {
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    // `earned` is what the garden produced, not what survived the sowing: the
    // seeds the absence sowed were paid for out of it, so the growth balance on
    // return is `start.growth + earned - sownCost`.
    earned: after.growth - before.growth + after.sownCost,
    sown: after.sown,
    sownCost: after.sownCost,
    matured: after.plants - before.plants,
    from: fromForm.index,
    fromName: fromForm.name,
    to: toForm.index,
    form: toForm.name,
    formsFound: FORMS.slice(fromForm.index + 1, toForm.index + 1).map((entry) => entry.name),
    growth: after.growth,
    nextFormName: nextIndex < FORMS.length ? FORMS[nextIndex].name : null,
    growthToNextForm: Math.max(0, toForm.nextAt - after.growth),
    nextSeedCost: nextSeedCost(after.sprouts.length + after.bloomSprouts.length + after.plants),
  };
  // Whether a pollinator is on the plot at the end of the span, so a return
  // that arrives during a visit can say so rather than only showing bigger
  // numbers.
  report.pollinator = pollinatorAt(after.age, after.plants, after.bloomPlants);
  // The season at each end, so a return that crossed a boundary can name it —
  // and which kind's own growth changed with it, so a return that carried the
  // garden into a kind's best season says which kind is thriving now.
  report.fromSeason = seasonAt(before.age);
  report.toSeason = seasonAt(after.age);
  report.crossedSeason = report.fromSeason.key !== report.toSeason.key;
  report.seasonChangedKinds = SEED_KINDS
    .filter(
      (_kind, index) =>
        kindSeasonMultiplier(index, report.fromSeason.key) !== kindSeasonMultiplier(index, report.toSeason.key)
    )
    .map((kind) => kind.name);
  report.summary = summarizeReturn(report);
  return report;
}

/**
 * What a return marked on the garden, or `null` when there is nothing to mark.
 *
 * Pure, and the one rule for whether an absence leaves a mark: a span shorter
 * than `minSeconds` is a reload rather than an absence, and an absence that
 * matured no seed and reached no new form has nothing to point at. Otherwise
 * `plants` is how many seeds matured and `form` says the garden reached a form
 * it did not have, both of which the return report already knows.
 */
export function returnMarkFor(away, minSeconds) {
  if (!away || !(away.seconds >= minSeconds)) return null;
  const plants = Number.isFinite(away.matured) && away.matured > 0 ? away.matured : 0;
  const form = Array.isArray(away.formsFound) && away.formsFound.length > 0;
  if (plants === 0 && !form) return null;
  return { plants, form };
}

/**
 * Drop the return marks and stop their timer, redrawing so the plot and the
 * readout stop showing them. A no-op when nothing is marked, so any action can
 * call it freely.
 */
export function clearReturnMarks() {
  if (returnMarkTimer !== null) {
    clearTimeout(returnMarkTimer);
    returnMarkTimer = null;
  }
  if (returnMarks === null) return;
  returnMarks = null;
  render();
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
  // The lasting bonus is part of the rate the absence grows at, so it travels
  // into the simulation and back out again rather than being assumed zero.
  const savedBonus = Number.isFinite(saved.bonus) && saved.bonus > 0 ? saved.bonus : 0;
  const start = {
    growth: saved.growth,
    rate: saved.rate,
    age: saved.age,
    bonus: savedBonus,
    sprouts: live.sprouts,
    bloomSprouts: live.bloomSprouts,
    plantCounts: live.plantCounts,
    beds: live.beds,
  };
  const away = buildAwayReport(start, seconds);
  const after = simulateGarden(start, seconds, { sow: true });

  // Everything the absence earned joins the lifetime, on top of the lifetime
  // the garden was left with, so time away is part of the garden's history
  // exactly as played time is. A caller that never knew about lifetime (a bare
  // `{growth, rate}`) starts it at nothing rather than at `NaN`.
  const savedLifetime = Number.isFinite(saved.lifetime) && saved.lifetime > 0 ? saved.lifetime : 0;
  // The absence lands all at once: record where it lands without announcing
  // every form and goal it crossed, then say the return once as one line.
  announcementsSuppressed = true;
  try {
    setGrowth(after.growth, after.rate, after.age, savedLifetime + away.earned, savedBonus);
    // `after.plants` is the total across both kinds, so the per-kind counts go
    // back in as `plantCounts` — passing the total as `plants` would double it.
    setGarden({
      beds: start.beds,
      plantCounts: after.plantCounts,
      sprouts: after.sprouts,
      bloomSprouts: after.bloomSprouts,
    });
  } finally {
    announcementsSuppressed = false;
  }

  lastReturn = away;
  // Mark what the absence changed until the visitor notices, then let it clear
  // on its own after a short while so the garden never stays cluttered.
  returnMarks = returnMarkFor(away, MIN_AWAY_SECONDS);
  if (returnMarkTimer !== null) clearTimeout(returnMarkTimer);
  returnMarkTimer = returnMarks ? setTimeout(clearReturnMarks, RETURN_MARK_MS) : null;
  showReturnSummary(away);
  lastAnnounced = null;
  render();
  announceEvent(returnAnnouncement(away));
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
// reads exactly as the real absence would. The garden's own actions — Tend the
// soil, both Plant buttons and Open the next bed — run against the rehearsal
// copy too, so time away can be tried with the decisions a visitor would
// actually make, and reset back to the moment the rehearsal opened.

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

/** The open sandbox: its opening snapshot, the rehearsal it has become, and its read. */
let sandbox = null;

/** A copy of the live garden's state — the point a rehearsal runs forward from. */
function gardenSnapshot() {
  const garden = getGarden();
  const { growth, rate, age, bonus } = getGrowthState();
  return {
    growth,
    rate,
    age,
    bonus,
    sprouts: garden.sprouts,
    bloomSprouts: garden.bloomSprouts,
    plantCounts: garden.plantCounts,
    beds: garden.beds,
  };
}

/** A garden state copied so a rehearsal can change it without touching the original. */
function copyGardenState(state) {
  return {
    ...state,
    sprouts: [...(state.sprouts ?? [])],
    bloomSprouts: [...(state.bloomSprouts ?? [])],
    plantCounts: [...(state.plantCounts ?? [0, 0])],
  };
}

/**
 * Start a fresh sandbox from the garden as it is now, wound back to zero. The
 * rehearsal begins as a copy of the opening snapshot, and `away` accumulates
 * the totals every settling produces so the summary can account for the whole
 * rehearsal across several windings and actions.
 */
function startSandbox() {
  const snapshot = gardenSnapshot();
  sandbox = {
    snapshot,
    state: copyGardenState(snapshot),
    seconds: 0,
    wound: 0,
    away: { earned: 0, sown: 0, sownCost: 0, matured: 0 },
    status: "",
    shown: null,
  };
}

/**
 * Materialise the time the sandbox has been wound forward into its rehearsal
 * state, and bank what it produced. Called before every action so an action
 * runs against a garden at the moment the rehearsal has reached, then the
 * pending window starts again from there.
 */
function settleSandbox() {
  if (!sandbox) return;
  const segment = buildAwayReport(sandbox.state, sandbox.seconds);
  sandbox.away.earned += segment.earned;
  sandbox.away.sown += segment.sown;
  sandbox.away.sownCost += segment.sownCost;
  sandbox.away.matured += segment.matured;
  sandbox.state = simulateGarden(sandbox.state, sandbox.seconds, { sow: true });
  sandbox.wound += sandbox.seconds;
  sandbox.seconds = 0;
}

/** Recompute what the open sandbox shows, from its rehearsal state and its span. */
function rehearseSandbox() {
  if (!sandbox) return;
  const end = simulateGarden(sandbox.state, sandbox.seconds, { sow: true });
  const segment = buildAwayReport(sandbox.state, sandbox.seconds);
  // The summary is written against the whole rehearsal, not only this last
  // winding: its own totals accumulate across the actions, and its start and
  // the forms it found are read from the opening snapshot the sandbox copied.
  const fromForm = gardenForm(sandbox.snapshot.growth);
  const away = {
    ...segment,
    seconds: sandbox.wound + sandbox.seconds,
    earned: sandbox.away.earned + segment.earned,
    sown: sandbox.away.sown + segment.sown,
    sownCost: sandbox.away.sownCost + segment.sownCost,
    matured: sandbox.away.matured + segment.matured,
    from: fromForm.index,
    fromName: fromForm.name,
    formsFound: FORMS.slice(fromForm.index + 1, segment.to + 1).map((entry) => entry.name),
  };
  away.summary = summarizeReturn(away);
  const display = describeGardenState(
    {
      seeds: end.sprouts.length + end.bloomSprouts.length,
      plants: end.plants,
      sprouts: end.sprouts,
      bloomSprouts: end.bloomSprouts,
      plantCounts: end.plantCounts,
      beds: end.beds,
      capacity: end.beds * PLOTS_PER_BED,
    },
    end.growth,
    end.rate,
    end.age,
    end.bonus
  );
  const goal = describeNextGoal(display);
  sandbox.shown = {
    open: true,
    seconds: sandbox.wound + sandbox.seconds,
    elapsed: formatAway(sandbox.wound + sandbox.seconds),
    growth: display.growth,
    rate: display.rate,
    season: display.season,
    kinds: display.kinds,
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
    plotFull: display.plotFull,
    canPlantHerb: display.kinds[0].canPlant,
    canPlantBloom: display.kinds[1].canPlant,
    canOpenBed: display.canOpenBed,
    nextBedCost: display.nextBedCost,
    matured: away.matured,
    summary: away.summary,
    status: sandbox.status,
    goalTitle: goal.title,
    goalFacts: goal.facts,
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
  sandbox.state = copyGardenState(sandbox.snapshot);
  sandbox.seconds = 0;
  sandbox.wound = 0;
  sandbox.away = { earned: 0, sown: 0, sownCost: 0, matured: 0 };
  sandbox.status = "Reset to the moment the rehearsal opened.";
  rehearseSandbox();
  render();
  return getSandboxState();
}

/** The kinds an action name plants, or null for any other action. */
const SANDBOX_PLANT_ACTIONS = Object.freeze({ "plant-herb": "herb", "plant-bloom": "bloom" });

/**
 * Take one of the garden's own actions inside the rehearsal, changing only the
 * sandbox copy. `action` is `"tend"`, `"plant-herb"`, `"plant-bloom"` or
 * `"open-bed"`; it opens the sandbox first if it is closed, settles whatever
 * time has been wound forward so the action runs at the moment the rehearsal
 * has reached, then runs the same rule the live action uses against the sandbox
 * state and rehearses the result. Nothing here writes the save, the real garden
 * or the last-seen moment.
 */
export function actInSandbox(action) {
  const name = String(action ?? "");
  if (!sandbox) startSandbox();
  settleSandbox();
  let result;
  if (name === "tend") result = tendInState(sandbox.state);
  else if (name === "open-bed") result = openBedInState(sandbox.state);
  else if (SANDBOX_PLANT_ACTIONS[name]) result = plantSeedInState(sandbox.state, SANDBOX_PLANT_ACTIONS[name]);
  else {
    sandbox.status = "That is not an action the rehearsal knows.";
    rehearseSandbox();
    render();
    return { ...getSandboxState(), ok: false, action: name, reason: "unknown sandbox action" };
  }
  if (result.ok) sandbox.state = result.state;
  sandbox.status = describeSandboxAction(name, result);
  rehearseSandbox();
  render();
  return { ...getSandboxState(), ok: result.ok, action: name, reason: result.reason, cost: result.cost };
}

/** What the rehearsal's own status line says after an action, or a refusal. */
function describeSandboxAction(action, result) {
  if (!result.ok) {
    if (result.reason === "the plot is full") return "The rehearsal's plot is full — open the next bed.";
    if (result.reason === "the plot still has room") return "The rehearsal's plot still has room — plant in it first.";
    return "The rehearsal has not saved enough growth yet.";
  }
  if (action === "tend") {
    return `Tended the rehearsal's soil — +${formatAmount(TEND_YIELD)} growth, +${formatGrowth(TEND_RATE_STEP)}/s.`;
  }
  if (action === "open-bed") {
    return `Opened bed #${formatAmount(result.beds)} in the rehearsal for ${formatAmount(result.cost)} growth.`;
  }
  const entry = SEED_KINDS[kindIndex(result.kind)];
  return `Planted a ${entry.name} seed in the rehearsal for ${formatAmount(result.cost)} growth.`;
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
  clearReturnMarks();
  setGarden(garden);
  setGrowth(garden.growth, garden.rate, garden.age, garden.lifetime, garden.bonus);
  const persisted = writeStoredGarden(getGarden());
  writeLastSeen(Date.now());
  return { ok: true, persisted, state: getDisplayedState() };
}

/**
 * An action's own confirmation — a seed planted, a bed opened, a replant, a
 * refusal — in the same words a sighted visitor reads. The visible line
 * (#save-status) lives inside the Save & rehearsal fold, which leaves the
 * accessibility tree while it is closed, so the confirmation goes to the
 * always-exposed status region (#garden-status) as well. Only that region is a
 * live region: the visible line mirrors it silently, or a screen reader would
 * hear the confirmation twice with the fold open.
 */
function announce(message) {
  setText(elements.status, message);
  setText(elements.gardenStatus, message);
}

/**
 * The one status region a screen reader always hears: a new form reached, a goal
 * now affordable, a pollinator arriving, a return, or an action's confirmation
 * (see `announce`). It is visually hidden and sits outside the fold, so it stays
 * in the accessibility tree whether or not Save & rehearsal is open, and apart
 * from the per-tick readout so a screen reader hears what happened once, never
 * the numbers climbing several times a second.
 */
function announceEvent(message) {
  if (!message) return;
  setText(elements.gardenStatus, message);
}

/** What the garden last said out loud, so a check can read the announcement. */
export function getAnnouncement() {
  return elements.gardenStatus ? elements.gardenStatus.textContent : "";
}

/**
 * How long until the next seed, in the shortest unit that still says something:
 * seconds under a minute, then minutes and seconds. A missing span says nothing.
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.ceil(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * The next goal's progress as three short labelled values — the growth saved
 * against the cost, how far the next seed is, and how far the next plant is.
 * `bed` switches the middle value to the next bed, once every plot is full.
 * Pure, so the real page and a sandbox rehearsal build the same facts from the
 * same state and their two readings can never disagree.
 *
 * @returns {Array<{label: string, value: string}>}
 */
function goalFacts(state, { bed = false } = {}) {
  const cost = bed ? state.nextBedCost : state.nextSeedCost;
  const ready = bed ? state.canOpenBed : state.canPlantSeed;
  const seconds = bed ? state.secondsToNextBed : state.secondsToNextSeed;
  return [
    { label: "Saved", value: `${formatGrowth(state.growth)} / ${formatAmount(cost)}` },
    {
      label: bed ? "Next bed" : "Next seed",
      value: ready ? "ready" : seconds == null ? "—" : formatDuration(seconds),
    },
    {
      label: "Next plant",
      value: state.secondsToNextPlant == null ? "none growing" : formatDuration(state.secondsToNextPlant),
    },
  ];
}

/** The facts as plain text, so a stored reading equals the DOM's textContent. */
function goalFactsText(facts) {
  return facts.map((fact) => `${fact.label}${fact.value}`).join("");
}

/** The next bed's price and progress, always on the page once shown. */
function describeNextBed(state) {
  const cost = formatAmount(state.nextBedCost);
  const percent = Math.round(state.bedCostProgress * 100);
  return `${cost} growth · ${percent}% saved`;
}

/** What the return marked on the garden, as the readout states it. */
function describeReturnMarks(marks) {
  if (!marks) return "";
  const parts = [];
  if (marks.plants > 0) parts.push(`${countLabel(marks.plants, "plant", "plants")} matured`);
  if (marks.form) parts.push("a new form reached");
  return parts.join(" · ");
}

/** The season the garden is in, which kind the year favours, and the year's pollinator rhythm. */
function describeSeason(state) {
  const season = state.season;
  const thriving = (state.kinds ?? []).find((kind) => (kind.seasonMultiplier ?? 1) > 1);
  const growth = thriving
    ? `${thriving.name} x${thriving.seasonMultiplier} growth`
    : `x${season.multiplier} growth`;
  const every = formatDuration(season.pollinatorCycleSeconds);
  const visit = formatDuration(season.pollinatorBaseVisitSeconds);
  return `${season.name} — ${growth} · pollinator every ${every}, ${visit} visits`;
}

/**
 * The pollinator as short labelled values: whether one is visiting and the
 * boost it brings, how long the visit lasts, how often the season brings it,
 * what each bloom adds and the cap that reaches. The visit length is always
 * stated, so a visitor sees what blooms are buying even when no visitor is
 * present; a visit in progress says how long it stays and how many blooms are
 * keeping it, each its own label rather than a rule to decode.
 */
function describePollinator(state) {
  const pollinator = state.pollinator;
  if (!pollinator) return "none visiting";
  const boost = `boost x${pollinator.boost ?? pollinator.multiplier} while visiting`;
  const every = `every ${formatDuration(pollinator.cycleSeconds)}`;
  const perBloom = `each bloom +${formatDuration(POLLINATOR_BLOOM_VISIT_SECONDS)}`;
  const cap = `max ${formatDuration(POLLINATOR_VISIT_MAX_SECONDS)}`;
  if (!pollinator.visiting) {
    const visit = formatDuration(pollinator.visitSeconds);
    return `none visiting · ${boost} · visit ${visit} ${every} · ${perBloom} · ${cap}`;
  }
  const stays = formatDuration(pollinator.visitSeconds);
  const kept = pollinator.bloomsKeeping > 0
    ? ` · kept by ${countLabel(pollinator.bloomsKeeping, "bloom", "blooms")}`
    : "";
  return `visiting · ${boost} · stays ${stays} ${every} · ${perBloom} · ${cap}${kept}`;
}

/** The next plant maturing, as words, for the readout beside the numbers. */
function describeNextPlant(state) {
  if (state.secondsToNextPlant == null) return "none growing";
  return `${formatDuration(state.secondsToNextPlant)} / ${formatDuration(state.growSeconds)}`;
}

/**
 * The next thing worth reaching for, as a title, three labelled facts and
 * 0-to-1 progress. The title names the kind the goal is worth planting — herb
 * or bloom — and its cost. While every plot is full the goal becomes the next
 * bed, so the garden always has something to reach for instead of ending at
 * "every plot holds a seed" — and a sandbox rehearsal asks for the same goal
 * afterwards. `detail` is the facts as plain text, so a stored reading equals
 * the DOM's own textContent.
 */
function describeNextGoal(state) {
  if (state.plotFull) {
    const facts = goalFacts(state, { bed: true });
    return {
      title: `Open bed #${formatAmount(state.beds + 1)}`,
      facts,
      detail: goalFactsText(facts),
      progress: state.bedCostProgress,
    };
  }
  // With nothing growing yet and the next seed still out of reach, the goal is
  // the action that works right now — tending the soil — rather than a price
  // the player cannot pay.
  if (!(state.rate > 0) && !state.canPlantSeed) {
    const facts = goalFacts(state);
    return {
      title: `Tend the soil — +${formatAmount(TEND_YIELD)} growth, +${formatGrowth(TEND_RATE_STEP)}/s`,
      facts,
      detail: goalFactsText(facts),
      progress: state.seedCostProgress,
    };
  }
  const goal = nextSeedGoal(state);
  const cost = formatAmount(goal ? goal.cost : state.nextSeedCost);
  const facts = goalFacts(state);
  return {
    title: `Plant ${goal ? goal.name : "herb"} seed — ${cost} growth`,
    facts,
    detail: goalFactsText(facts),
    progress: state.seedCostProgress,
  };
}

/**
 * Draw `facts` into `container` as real label/value elements — a short label a
 * screen reader reads and a value beside it, never a sentence. Rebuilt each
 * time so the page states exactly the facts the state holds.
 */
function renderGoalFacts(container, facts) {
  if (!container) return;
  container.replaceChildren(
    ...facts.map((fact) => {
      const row = document.createElement("span");
      row.className = "goal-fact";
      const label = document.createElement("span");
      label.className = "goal-fact-label";
      label.textContent = fact.label;
      const value = document.createElement("span");
      value.className = "goal-fact-value";
      value.textContent = fact.value;
      row.append(label, value);
      return row;
    })
  );
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
  renderGoalFacts(elements.goalDetail, goal.facts);

  renderOpenBed(state);
}

/**
 * The two kinds as the readout reads them: each kind's seeds and plants, the
 * price of its next seed, what one grown plant adds to the rate now that its
 * milestones are counted, and the nearer goal — its next plant milestone and
 * how many more plants of that kind it needs.
 */
function describeKind(kind) {
  const count = `${formatAmount(kind.seeds)} ${kind.seeds === 1 ? "seed" : "seeds"} · ` +
    `${formatAmount(kind.plants)} ${kind.plants === 1 ? "plant" : "plants"}`;
  const milestone = kind.nextMilestone == null
    ? "all milestones reached"
    : `x${MILESTONE_MULTIPLIER} at ${formatAmount(kind.nextMilestone)} plants · ` +
      `${formatAmount(kind.plantsToMilestone)} to go`;
  return `${count} — next ${formatAmount(kind.cost)} · +${formatGrowth(kind.output)}/s each · ${milestone}`;
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

/**
 * The Replant control and the lasting-bonus row: offered only once the garden
 * is far enough along to earn a bonus, and the bonus row only once one exists,
 * so a fresh garden is never shown a control that would trade work for nothing.
 */
function renderReplant(state) {
  const button = elements.replant;
  if (button) {
    button.hidden = !state.canReplant;
    setText(button, `Replant the garden — +${formatAmount(state.replantBonus)}/s bonus`);
  }
  if (elements.bonusRow) elements.bonusRow.hidden = !(state.bonus > 0);
  setText(elements.bonus, `+${formatGrowth(state.bonus)}/s`);
}

/** Open the replant confirmation, stating what resets, what is kept and the bonus. */
function openReplantDialog() {
  const state = getDisplayedState();
  if (!state.canReplant) return;
  setText(elements.replantDialogBonus, `+${formatAmount(state.replantBonus)}/s`);
  if (typeof elements.replantDialog?.showModal === "function") elements.replantDialog.showModal();
}

/** Replant the garden after the visitor confirms, and say what was kept. */
function replantFromButton() {
  const result = replant();
  if (typeof elements.replantDialog?.close === "function") elements.replantDialog.close();
  if (!result.ok) {
    announce("The garden is not far enough along to replant yet.");
    return;
  }
  persist();
  announce(
    `Replanted — the fresh garden grows at +${formatGrowth(result.bonus)}/s from its lasting bonus, and ` +
      `${formatAmount(result.lifetime)} lifetime growth is kept.`
  );
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

/** The announce snapshot as of the last render, and whether this render is part
 * of a bulk jump (a return) that must land without announcing every milestone
 * it crossed. The first render records its snapshot silently. */
let lastAnnounced = null;
let announcementsSuppressed = false;

/**
 * The part of the garden's state that can change what the garden says out loud:
 * the form it is in, the goals it can now afford, and whether a pollinator is
 * visiting. Everything else — the growth total, the rate, the meters — changes
 * every tick and is never announced, so a screen reader is told what happened
 * rather than the same climbing numbers over and over.
 *
 * Pure, and small on purpose: two snapshots of it are compared to find the
 * discrete events that happened between them.
 */
export function announceSnapshot(state) {
  const pollinator = state.pollinator;
  return {
    form: state.form,
    formName: state.formName,
    canPlantSeed: Boolean(state.canPlantSeed),
    canOpenBed: Boolean(state.canOpenBed),
    nextSeedKind: state.nextSeedKind,
    nextSeedCost: state.nextSeedCost,
    beds: state.beds,
    nextBedCost: state.nextBedCost,
    pollinatorVisiting: Boolean(pollinator && pollinator.visiting),
    pollinatorMultiplier: pollinator ? pollinator.multiplier : 1,
  };
}

/**
 * The discrete events that happened between two announce snapshots, one short
 * label-and-value line each, in the order they matter: a new form, a goal the
 * garden can now afford, then a pollinator arriving. `prev` null is a fresh
 * load with nothing to compare, and no change means nothing to say — which is
 * what keeps the per-tick numbers out of a screen reader's ear.
 *
 * Pure, so a check can hand it snapshots directly.
 *
 * @returns {Array<{key: string, text: string}>}
 */
export function describeAnnouncements(prev, next) {
  if (!prev || !next) return [];
  const events = [];
  if (next.form !== prev.form) {
    events.push({ key: "form", text: `New garden form · ${next.formName}` });
  }
  if (!prev.canPlantSeed && next.canPlantSeed) {
    events.push({
      key: "seed-goal",
      text: `Goal reached · Plant ${next.nextSeedKind} seed — ${formatAmount(next.nextSeedCost)} growth`,
    });
  }
  if (!prev.canOpenBed && next.canOpenBed) {
    events.push({
      key: "bed-goal",
      text: `Open bed #${formatAmount(next.beds + 1)} — ${formatAmount(next.nextBedCost)} growth`,
    });
  }
  if (!prev.pollinatorVisiting && next.pollinatorVisiting) {
    events.push({ key: "pollinator", text: `Pollinator visiting · x${next.pollinatorMultiplier} growth` });
  }
  return events;
}

/**
 * A return as one short line: what the absence earned and the form the garden
 * is in now. Empty for a gap too short to be an absence, so a reload says
 * nothing rather than reading a stale welcome-back.
 */
export function returnAnnouncement(away) {
  if (!away || !(away.seconds >= MIN_AWAY_SECONDS)) return "";
  return `Return · ${formatGrowth(away.earned)} growth · now ${away.form}`;
}

function render() {
  // A hidden tab still keeps the garden growing (the timer derives growth from
  // elapsed time), but there is nobody to see it redraw.
  if (document.hidden) return;

  const state = getDisplayedState();
  setText(elements.growth, formatGrowth(state.growth));
  setText(elements.rate, `+${formatGrowth(state.rate)}/s`);
  setText(elements.lifetime, formatGrowth(state.lifetimeGrowth));
  setText(elements.replantBonus, `replant now +${formatAmount(state.replantBonus)}`);
  setText(elements.form, state.formName);
  setText(elements.nextForm, describeNextForm(state));
  setMeter(state.formProgress, elements.formMeter, elements.formMeterFill);
  setText(elements.seeds, formatAmount(state.seeds));
  setText(elements.plants, formatAmount(state.plants));
  setText(elements.beds, formatAmount(state.beds));
  setText(elements.capacity, formatAmount(state.capacity));
  setText(elements.pollinator, describePollinator(state));
  setText(elements.returnMarks, describeReturnMarks(state.returnMarks));
  if (elements.returnMarksRow) elements.returnMarksRow.hidden = !state.returnMarks;
  setText(elements.season, describeSeason(state));
  setText(elements.kindHerb, describeKind(state.kinds[0]));
  setText(elements.kindBloom, describeKind(state.kinds[1]));
  setText(elements.nextPlant, describeNextPlant(state));
  setText(elements.nextBed, describeNextBed(state));
  setText(elements.storage, state.storageAvailable ? "Yes" : "No");
  setText(elements.description, describePlot(state));
  renderPlanting(state);
  renderReplant(state);
  renderSandbox(state);
  // Leave the field alone while the visitor is editing it; a re-render should
  // not erase a save they are about to paste.
  if (elements.save && document.activeElement !== elements.save) {
    elements.save.value = state.save;
  }

  // Speak only the discrete events since the last render; the numbers above
  // change every tick and are for a sighted player to watch, not to hear.
  const snapshot = announceSnapshot(state);
  if (!announcementsSuppressed) {
    const events = describeAnnouncements(lastAnnounced, snapshot);
    if (events.length) announceEvent(events.map((event) => event.text).join(" · "));
  }
  lastAnnounced = snapshot;

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
    `${state.beds}:${state.pollinator.visiting}:${state.season.key}:${phase}:` +
    `${JSON.stringify(state.returnMarks ?? null)}`;
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
  renderGoalFacts(elements.sandboxGoalDetail, rehearsal.goalFacts ?? []);
  setMeter(rehearsal.goalProgress, elements.sandboxMeter, elements.sandboxMeterFill);

  // The rehearsal's own four actions, labelled and enabled exactly as the real
  // panel's are, so a visitor tries the same decisions on the sandbox copy.
  setText(
    elements.sandboxTend,
    `Tend the soil — +${formatAmount(TEND_YIELD)} growth, +${formatGrowth(TEND_RATE_STEP)}/s`
  );
  for (const [button, kind] of [
    [elements.sandboxPlantHerb, rehearsal.kinds[0]],
    [elements.sandboxPlantBloom, rehearsal.kinds[1]],
  ]) {
    if (!button || !kind) continue;
    setText(
      button,
      rehearsal.plotFull
        ? `Plant a ${kind.name} seed — the plot is full`
        : `Plant a ${kind.name} seed — ${formatAmount(kind.cost)} growth`
    );
    button.disabled = !kind.canPlant;
  }
  if (elements.sandboxOpenBed) {
    elements.sandboxOpenBed.hidden = !rehearsal.plotFull;
    setText(elements.sandboxOpenBed, `Open the next bed — ${formatAmount(rehearsal.nextBedCost)} growth`);
    elements.sandboxOpenBed.disabled = !rehearsal.canOpenBed;
  }
  setText(elements.sandboxStatus, rehearsal.status);
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
    setGrowth(next.garden.growth, next.garden.rate, next.garden.age, next.garden.lifetime, next.garden.bonus);
  });

  // Acting on the garden is noticing it: any of these clears the return marks.
  elements.tend?.addEventListener("click", () => {
    clearReturnMarks();
    tend();
    persist();
  });
  elements.plant?.addEventListener("click", () => {
    clearReturnMarks();
    plantSeedFromButton("herb");
    persist();
  });
  elements.plantBloom?.addEventListener("click", () => {
    clearReturnMarks();
    plantSeedFromButton("bloom");
    persist();
  });
  elements.openBed?.addEventListener("click", () => {
    clearReturnMarks();
    openBedFromButton();
    persist();
  });
  elements.replant?.addEventListener("click", () => {
    // Opening the confirmation changes nothing by itself; only Replant now does.
    openReplantDialog();
  });
  elements.replantConfirm?.addEventListener("click", () => {
    clearReturnMarks();
    replantFromButton();
  });
  // Keep growing (or Esc) is a pure no-op: it closes the dialog and nothing else.
  elements.replantCancel?.addEventListener("click", () => elements.replantDialog?.close());
  elements.copy?.addEventListener("click", copySave);
  elements.load?.addEventListener("click", loadSave);
  elements.save?.addEventListener("input", () => announce(""));

  elements.openSandbox?.addEventListener("click", () => openSandbox());
  elements.sandboxHour?.addEventListener("click", () => fastForwardSandbox(sandboxSpanSeconds("hour")));
  elements.sandboxDay?.addEventListener("click", () => fastForwardSandbox(sandboxSpanSeconds("day")));
  elements.sandboxMonth?.addEventListener("click", () => fastForwardSandbox(sandboxSpanSeconds("month")));
  elements.sandboxReset?.addEventListener("click", () => resetSandbox());
  elements.sandboxTend?.addEventListener("click", () => actInSandbox("tend"));
  elements.sandboxPlantHerb?.addEventListener("click", () => actInSandbox("plant-herb"));
  elements.sandboxPlantBloom?.addEventListener("click", () => actInSandbox("plant-bloom"));
  elements.sandboxOpenBed?.addEventListener("click", () => actInSandbox("open-bed"));

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
