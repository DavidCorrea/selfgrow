/**
 * The page: a soil plot beside the garden's quantities in text and numbers, the
 * Tend the soil action that starts the garden growing, the Plant a seed action
 * that spends that growth to grow faster, the next seed always shown as progress
 * and time away, the growth the garden has produced over its whole life beside
 * what a replant right now would earn from it, the Replant action that resets
 * the run for a lasting bonus once the garden is flourishing, and a save the
 * player can copy out and, after seeing what it holds beside the live garden,
 * load back. A load is confirm-first: pasting and pressing Load save opens a
 * preview and changes nothing until Load now is pressed. A load is also
 * reversible once: the garden it replaced is kept, and Restore previous garden
 * puts it back.
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
  SEED_KINDS,
  STORAGE_KEY,
  TEND_RATE_STEP,
  TEND_YIELD,
  addVisitTime,
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
  presenceBonus,
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
import {
  FORMS,
  drawGarden,
  drawHandWorkGlyph,
  drawKindSwatch,
  establishment,
  gardenForm,
  motionPhase,
  tendedMarkCells,
  tendedWorkCells,
} from "./plotview.js";

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
  presenceRate: document.getElementById("presence-rate"),
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
  kindHerb: readKindRow("herb"),
  kindBloom: readKindRow("bloom"),
  kindHerbSwatch: document.getElementById("kind-herb-swatch"),
  kindBloomSwatch: document.getElementById("kind-bloom-swatch"),
  visitSownGlyph: document.getElementById("visit-sown-glyph"),
  visitTendedGlyph: document.getElementById("visit-tended-glyph"),
  goalTitle: document.getElementById("goal-title"),
  goalDetail: document.getElementById("goal-detail"),
  meter: document.getElementById("seed-meter"),
  meterFill: document.getElementById("seed-meter-fill"),
  seeds: document.querySelector('[data-field="seeds"]'),
  plants: document.querySelector('[data-field="plants"]'),
  beds: document.querySelector('[data-field="beds"]'),
  capacity: document.querySelector('[data-field="capacity"]'),
  pollinator: document.querySelector('[data-field="pollinator"]'),
  established: document.querySelector('[data-field="established"]'),
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
  visitSeconds: document.querySelector('[data-field="visit-seconds"]'),
  visitSown: document.querySelector('[data-field="visit-sown"]'),
  visitTended: document.querySelector('[data-field="visit-tended"]'),
  visitPresent: document.querySelector('[data-field="visit-present"]'),
  dismissReturn: document.getElementById("dismiss-return"),
  save: document.getElementById("save-value"),
  copy: document.getElementById("copy-save"),
  load: document.getElementById("load-save"),
  restore: document.getElementById("restore-save"),
  status: document.getElementById("save-status"),
  loadDialog: document.getElementById("load-dialog"),
  loadConfirm: document.getElementById("load-confirm"),
  loadCancel: document.getElementById("load-cancel"),
  loadGrowth: document.getElementById("load-dialog-growth"),
  loadSeeds: document.getElementById("load-dialog-seeds"),
  loadPlants: document.getElementById("load-dialog-plants"),
  loadBeds: document.getElementById("load-dialog-beds"),
  loadLifetime: document.getElementById("load-dialog-lifetime"),
  openSandbox: document.getElementById("open-sandbox"),
  sandbox: document.getElementById("sandbox"),
  sandboxPlot: document.getElementById("sandbox-plot"),
  sandboxElapsed: document.getElementById("sandbox-elapsed"),
  sandboxGrowth: document.getElementById("sandbox-growth"),
  sandboxRate: document.getElementById("sandbox-rate"),
  sandboxForm: document.querySelector('[data-field="sandbox-form"]'),
  sandboxMatured: document.querySelector('[data-field="sandbox-matured"]'),
  sandboxSeeds: document.querySelector('[data-field="sandbox-seeds"]'),
  sandboxPlants: document.querySelector('[data-field="sandbox-plants"]'),
  sandboxSeason: document.querySelector('[data-field="sandbox-season"]'),
  sandboxPollinator: document.querySelector('[data-field="sandbox-pollinator"]'),
  sandboxKindHerb: readKindRow("herb", "sandbox-kind"),
  sandboxKindBloom: readKindRow("bloom", "sandbox-kind"),
  sandboxSummary: document.getElementById("sandbox-summary"),
  sandboxGoalTitle: document.getElementById("sandbox-goal-title"),
  sandboxGoalDetail: document.getElementById("sandbox-goal-detail"),
  sandboxMeter: document.getElementById("sandbox-meter"),
  sandboxMeterFill: document.getElementById("sandbox-meter-fill"),
  sandboxHour: document.getElementById("sandbox-hour"),
  sandboxDay: document.getElementById("sandbox-day"),
  sandboxMonth: document.getElementById("sandbox-month"),
  sandboxReset: document.getElementById("sandbox-reset"),
  sandboxClose: document.getElementById("sandbox-close"),
  sandboxTend: document.getElementById("sandbox-tend"),
  sandboxPlantHerb: document.getElementById("sandbox-plant-herb"),
  sandboxPlantBloom: document.getElementById("sandbox-plant-bloom"),
  sandboxOpenBed: document.getElementById("sandbox-open-bed"),
  sandboxStatus: document.getElementById("sandbox-status"),
};

/**
 * The values a load compares, one Load-this-save dialog row each, in the order
 * the rows appear. `format` is the same formatter the readout uses, so the
 * dialog and the page state an amount the same way.
 */
const LOAD_FACTS = [
  { field: "growth", format: formatGrowth, element: elements.loadGrowth },
  { field: "seeds", format: formatAmount, element: elements.loadSeeds },
  { field: "plants", format: formatAmount, element: elements.loadPlants },
  { field: "beds", format: formatAmount, element: elements.loadBeds },
  { field: "lifetime", format: formatGrowth, element: elements.loadLifetime },
];

const isStorageAvailable = storageAvailable();

let palette = null;

/** The seasons the plot has its own foliage and ground colours for, in the cycle's order. */
const SEASON_KEYS = ["winter", "spring", "summer", "autumn"];

/**
 * The palette, read once from the `:root` CSS variables rather than repeated.
 *
 * `leafSeasons` and `soilSeasons` hold each season's own leaf and ground trios
 * beside the base ones, so the plot can swap the foliage and the ground for the
 * season it is drawing without a second source of colour anywhere. A season
 * whose ground variables are unset falls back to the base soil, which is how
 * summer stays the brown the plot has always been drawn in.
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
  const readSoil = (season) => ({
    soil: read(`--soil-${season}`) || read("--soil"),
    soilLight: read(`--soil-${season}-light`) || read("--soil-light"),
    soilDeep: read(`--soil-${season}-deep`) || read("--soil-deep"),
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
    // The palest panel tone, which the pollinator's wings are held clear in so
    // the bee reads as a bee rather than as a bloom-coloured blossom.
    panelLight: read("--panel-light"),
    leafSeasons: Object.fromEntries(SEASON_KEYS.map((season) => [season, readLeaves(season)])),
    soilSeasons: Object.fromEntries(SEASON_KEYS.map((season) => [season, readSoil(season)])),
  };
  return palette;
}

const countLabel = (count, singular, plural) =>
  `${formatAmount(count)} ${count === 1 ? singular : plural}`;

/**
 * The picture, said in words: the same growth, ground, beds, form, season and
 * plots the visitor sowed and tended by hand that the plot draws.
 *
 * The hand-worked counts are the plots the plot actually marks — `tendedMarkCells`
 * for the stands and `tendedWorkCells` for the hoe cuts, each cut off at the
 * cells on screen — so the words cannot name more worked plots than the picture
 * can show, exactly as the drawn marks are bounded.
 */
export function describePlot(state) {
  const worked = tendedMarkCells(state).length;
  const tended = tendedWorkCells(state).length;
  return (
    `${formatGrowth(state.growth)} growth — ${state.formName} on ${state.established.name}, ` +
    `in ${state.season.name}. ` +
    `${countLabel(state.beds, "bed of soil", "beds of soil")}, ` +
    `${countLabel(state.capacity, "plot of soil", "plots of soil")}, ` +
    `${countLabel(state.seeds, "ungrown seed", "ungrown seeds")}, ` +
    `${countLabel(state.plants, "grown plant", "grown plants")}, ` +
    `${countLabel(worked, "plot sowed by hand", "plots sowed by hand")}, ` +
    `${countLabel(tended, "plot tended by hand", "plots tended by hand")}.`
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
  const garden = getGarden();
  return {
    ...describeGardenState(garden, growth, rate, age, bonus),
    // The visitor's own hand-work this visit — how long it has lasted and how
    // many plots they sowed and tended — kept apart from the seeds the garden
    // sows itself and the plants that matured while they were away.
    visit: garden.visit,
    // Whether someone is at the page right now. It is the page's own presence,
    // not a saved field: a garden with a visitor at it is drawn as tended and
    // one growing alone is not, so the picture and the state agree that someone
    // is here. It sits beside `visit` rather than inside it, so the visit record
    // stays exactly the hand-work the garden stores.
    visitPresent: !document.hidden,
    // What presence itself earns the garden: a flat growth/second bonus added
    // while someone is at the page and nothing once the visit ends. The garden
    // grows at `rate + presenceRate` while it is watched and at `rate` alone
    // while it is not, so a visit is worth more than an absence and neither is
    // punished. Named beside the rate in the readout and read by an agent here.
    presenceRate: presenceBonus(!document.hidden),
    // The garden's whole history, what replanting right now would earn from it,
    // the lasting bonus a replant has already earned, and what that history has
    // made of the ground — the lasting layer the plot draws under the current
    // growth. They live here rather than in `describeGardenState` because a
    // rehearsal has no lifetime or bonus of its own: a sandbox describes one
    // span of a garden, not a life.
    lifetimeGrowth: lifetime,
    replantBonus: replantBonus(lifetime),
    bonus,
    established: establishment(lifetime),
    canReplant: canReplant(lifetime),
    save: exportSave(),
    // Whether a load can still be put back, so the Restore previous garden
    // button and an agent read the same one fact.
    restoreAvailable: restorePoint !== null,
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
 * What the last return marked on the garden, shown until the visitor
 * acknowledges it — by taking a garden action or pressing the dismiss control.
 * It never clears on its own, so a returning player can look at the change in
 * their own time rather than lose it to a timer.
 */
let returnMarks = null;

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
 * The return report as short labelled facts — what was earned, what matured,
 * whether a season turned or a pollinator arrived, and what to reach for next.
 * Each fact is a label and a value, never a sentence, so a return reads in two
 * or three short lines instead of pushing the garden down the page. A fact that
 * would say nothing — no seed matured, no season crossed — is left out.
 *
 * Pure, so the real return and a sandbox rehearsal build the same facts from
 * the same report and their two readings can never disagree.
 *
 * @returns {Array<{label: string, value: string}>}
 */
export function returnFacts(away) {
  if (!away || !(away.seconds > 0)) return [];
  const facts = [{ label: "Earned", value: `${formatGrowth(away.earned)} growth` }];
  if (away.matured > 0) {
    facts.push({ label: "Matured", value: countLabel(away.matured, "seed", "seeds") });
  }
  if (away.sown > 0) {
    facts.push({ label: "Sown", value: countLabel(away.sown, "seed", "seeds") });
  }
  facts.push({ label: "Now", value: away.form });
  if (away.crossedSeason) {
    facts.push({ label: "Season", value: `${away.fromSeason.name} → ${away.toSeason.name}` });
  }
  if (away.pollinator?.visiting) {
    facts.push({ label: "Pollinator", value: `x${away.pollinator.multiplier}` });
  }
  facts.push(
    away.nextFormName
      ? { label: "Next", value: `${away.nextFormName} in ${formatGrowth(away.growthToNextForm)}` }
      : { label: "Next seed", value: formatAmount(away.nextSeedCost) }
  );
  return facts;
}

/**
 * Describe a span of time against a garden state, with no cap on the span.
 *
 * Pure, and the one place a return report is built: `start` is a garden state
 * (`{growth, rate, sprouts, plants, beds}`) and the result is the same `away`
 * report the page shows after an absence — the span, what it earned and grew
 * into (including how many seeds it sowed into free plots and how many
 * matured), the summary sentence, the same facts as short labels, and what to
 * reach for next. The sandbox rehearses with it, so a rehearsal reads exactly
 * as the real absence would.
 *
 * @returns {object} the `away` report, its `summary` and `facts` included.
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
  // The same facts as short labels, so the return reads in a couple of short
  // lines rather than one long sentence.
  report.facts = returnFacts(report);
  return report;
}

/**
 * What a return marked on the garden, or `null` when there is nothing to mark.
 *
 * Pure, and the one rule for whether an absence leaves a mark: a span shorter
 * than `minSeconds` is a reload rather than an absence, and an absence that
 * matured no seed, sowed no seed, reached no new form and crossed no season has
 * nothing to point at. Otherwise `plants` is how many seeds matured, `sown` is
 * how many seeds the garden sowed into the free plots while away, `form` says
 * the garden reached a form it did not have, and `season` names the year's turn
 * — the season it left and the season it turned into — because a ten-minute
 * season lands in almost any real absence and the garden's growth changed with
 * it. All four are what the return report already knows.
 */
export function returnMarkFor(away, minSeconds) {
  if (!away || !(away.seconds >= minSeconds)) return null;
  const plants = Number.isFinite(away.matured) && away.matured > 0 ? away.matured : 0;
  const sown = Number.isFinite(away.sown) && away.sown > 0 ? Math.floor(away.sown) : 0;
  const form = Array.isArray(away.formsFound) && away.formsFound.length > 0;
  const season =
    away.crossedSeason === true && away.fromSeason && away.toSeason
      ? { from: away.fromSeason.name, to: away.toSeason.name }
      : null;
  if (plants === 0 && sown === 0 && !form && !season) return null;
  return { plants, sown, form, season };
}

/**
 * Drop the return marks, redrawing so the plot and the readout stop showing
 * them. This is the acknowledgement: a garden action, a load, or the dismiss
 * control calls it, and nothing else ever does. A no-op when nothing is marked,
 * so any action can call it freely.
 */
export function clearReturnMarks() {
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
  // Mark what the absence changed and keep it until the visitor acknowledges it
  // — by tending, planting, opening a bed, replanting, loading a save, or
  // pressing the dismiss control — so a return can be looked at in the
  // visitor's own time rather than vanishing on a timer.
  returnMarks = returnMarkFor(away, MIN_AWAY_SECONDS);
  showReturnSummary(away);
  lastAnnounced = null;
  render();
  announceEvent(arrivalAnnouncement(away));
  return away;
}

/** Show the welcome-back facts, or keep them out of the way for a short gap. */
function showReturnSummary(away) {
  const element = elements.returnSummary;
  if (!element) return;
  if (!away || !(away.seconds >= MIN_AWAY_SECONDS)) {
    element.hidden = true;
    renderGoalFacts(element, []);
    return;
  }
  renderGoalFacts(element, away.facts ?? []);
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
  away.facts = returnFacts(away);
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
    facts: away.facts,
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

/**
 * Close the rehearsal and put the page back to the real garden.
 *
 * The sandbox is dropped whole. Nothing of it was ever saved, so the real
 * garden, its save and its last-seen moment are exactly as they were, the
 * panel hides and Rehearse time is offered again — the exit, where resetting
 * goes back to the start of the same rehearsal. Safe while it is closed.
 */
export function closeSandbox() {
  sandbox = null;
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
 * The rehearsal's own garden in the shape the plot renderer draws.
 *
 * Reads only the sandbox's reported values — its growth, form, season,
 * pollinator and per-kind counts — so the drawn rehearsal can never carry the
 * live garden's. It deliberately passes no lifetime: a sandbox is one span of
 * a garden, not a life, so the rehearsal draws on fresh ground, exactly as the
 * plot does for a garden with no history.
 *
 * Pure, so a check can compare the state the page draws against the rehearsal
 * it came from without a canvas.
 */
export function sandboxPlotState(rehearsal) {
  return {
    growth: rehearsal.growth,
    form: rehearsal.form,
    formName: rehearsal.formName,
    seeds: rehearsal.seeds,
    plants: rehearsal.plants,
    beds: rehearsal.beds,
    capacity: rehearsal.capacity,
    season: rehearsal.season,
    pollinator: rehearsal.pollinator,
    seedCounts: rehearsal.kinds.map((kind) => kind.seeds),
    plantCounts: rehearsal.kinds.map((kind) => kind.plants),
  };
}

/**
 * The garden the most recent load replaced, kept so a wrong or regretted load
 * can be put back. One deep: another load overwrites it with the garden that
 * load replaces, and a restore spends it. It lives in memory only — nothing of
 * it enters `encodeSave`, so an exported save string is unchanged by it.
 */
let restorePoint = null;

/**
 * Replace the garden with the one in `text` and keep it, remembering the
 * garden it replaced so `restoreGardenSave` can put it back.
 *
 * The moment of the load is recorded, so a deliberate load is not later read as
 * a long absence. The garden being replaced is captured only once the save has
 * been read, so a refused save replaces nothing and leaves the kept garden as
 * it was.
 *
 * @throws {Error} when the save cannot be read; the garden is left untouched.
 */
export function loadGardenSave(text) {
  const garden = decodeSave(text);
  restorePoint = { garden: getGarden(), growth: getGrowthState() };
  clearReturnMarks();
  setGarden(garden);
  setGrowth(garden.growth, garden.rate, garden.age, garden.lifetime, garden.bonus);
  const persisted = writeStoredGarden(getGarden());
  writeLastSeen(Date.now());
  return { ok: true, persisted, state: getDisplayedState() };
}

/**
 * Put back the garden the last load replaced, with the same growth, seeds,
 * plants, beds, lifetime and lasting bonus it had, and keep it.
 *
 * The one undo for `loadGardenSave`. Safe to repeat: the kept garden is spent
 * by the restore that uses it, so a second call changes nothing and reports
 * `restored: false` with the reason, and a later load replaces it wholesale.
 *
 * @returns {{ok: boolean, restored: boolean, reason?: string, persisted?: boolean, restoredContents?: object, state: object}}
 */
export function restoreGardenSave() {
  const point = restorePoint;
  if (!point) {
    return {
      ok: false,
      restored: false,
      reason: "no earlier garden to restore — nothing has been loaded over one",
      state: getDisplayedState(),
    };
  }
  // Spend the kept garden before it is used, so a repeat has nothing to put
  // back and the garden can never be restored twice.
  restorePoint = null;
  clearReturnMarks();
  setGarden(point.garden);
  setGrowth(point.growth.growth, point.growth.rate, point.growth.age, point.growth.lifetime, point.growth.bonus);
  const persisted = writeStoredGarden(getGarden());
  writeLastSeen(Date.now());
  render();
  return {
    ok: true,
    restored: true,
    persisted,
    restoredContents: saveContents(getGarden(), point.growth.growth, point.growth.lifetime),
    state: getDisplayedState(),
  };
}

/** The five values a save settles, read off a garden and its live growth. */
function saveContents(garden, growth, lifetime) {
  return {
    growth,
    seeds: garden.seeds,
    plants: garden.plants,
    beds: garden.beds,
    lifetime,
  };
}

/**
 * Read a save and say what it holds beside what the garden holds now, without
 * changing or storing anything.
 *
 * The one path that writes the garden is `loadGardenSave`; this only reads, so
 * a paste and a click — or an agent's `import-save` — can show what a load
 * would replace before anything is committed. It reads the live garden and the
 * decoded save and keeps nothing of either: no `setGarden`, no persist, no
 * return-mark clearing.
 *
 * @returns {{ok: true, current: object, incoming: object, changes: Array<{field: string, from: number, to: number}>}}
 * @throws {Error} when the save cannot be read; the garden is left untouched.
 */
export function previewGardenSave(text) {
  const incoming = decodeSave(text);
  const live = getGarden();
  const { growth, lifetime } = getGrowthState();
  const current = saveContents(live, growth, lifetime);
  const next = saveContents(incoming, incoming.growth, incoming.lifetime);
  const changes = LOAD_FACTS.filter(({ field }) => current[field] !== next[field]).map(({ field }) => ({
    field,
    from: current[field],
    to: next[field],
  }));
  return { ok: true, current, incoming: next, changes };
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
  if (marks.sown > 0) parts.push(countLabel(marks.sown, "seed sown", "seeds sown"));
  if (marks.form) parts.push("a new form reached");
  if (marks.season) parts.push(`turned into ${marks.season.to}`);
  return parts.join(" · ");
}

/**
 * The season as short labelled facts: the season's name, the growth it gives
 * the garden, and the kind it favours — each its own label, so the year reads
 * at a glance. The pollinator's rhythm belongs to the Pollinator row alone, so
 * it is not repeated here.
 */
function describeSeason(state) {
  const season = state.season;
  const favoured = (state.kinds ?? []).find((kind) => (kind.seasonMultiplier ?? 1) > 1);
  const facts = [
    { label: "Season", value: season.name },
    { label: "Growth", value: `x${season.multiplier}` },
  ];
  if (favoured) facts.push({ label: "Favours", value: `${favoured.name} x${favoured.seasonMultiplier}` });
  return facts;
}

/**
 * The pollinator as short labelled facts: whether one is visiting and the
 * boost it brings, how long the visit lasts, how often the season brings it,
 * what each bloom adds and the cap that reaches. The visit length is always
 * stated, so a visitor sees what blooms are buying even when no visitor is
 * present; a visit in progress also says how many blooms are keeping it, each
 * its own label rather than a rule to decode.
 */
export function describePollinator(state) {
  const pollinator = state.pollinator;
  const facts = [
    { label: "State", value: pollinator.visiting ? "visiting" : "none visiting" },
    { label: "Boost", value: `x${pollinator.boost ?? pollinator.multiplier} while visiting` },
    { label: "Stays", value: formatDuration(pollinator.visitSeconds) },
    { label: "Every", value: formatDuration(pollinator.cycleSeconds) },
    { label: "Each bloom", value: `+${formatDuration(POLLINATOR_BLOOM_VISIT_SECONDS)}` },
    { label: "Max", value: formatDuration(POLLINATOR_VISIT_MAX_SECONDS) },
  ];
  if (pollinator.visiting && pollinator.bloomsKeeping > 0) {
    facts.push({ label: "Kept by", value: countLabel(pollinator.bloomsKeeping, "bloom", "blooms") });
  }
  return facts;
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
 * Draw `facts` into `container` as the same short label/value spans the Herb
 * and Bloom rows use — a short label a screen reader reads and a value beside
 * it, never a sentence. Rebuilt each time so the page states exactly the facts
 * the state holds.
 */
function renderReadoutFacts(container, facts) {
  if (!container) return;
  const list = document.createElement("span");
  list.className = "kind-facts";
  list.append(
    ...facts.map((fact) => {
      const row = document.createElement("span");
      row.className = "kind-fact";
      const label = document.createElement("span");
      label.className = "kind-fact-label";
      label.textContent = fact.label;
      const value = document.createElement("span");
      value.className = "kind-fact-value";
      value.textContent = fact.value;
      row.append(label, value);
      return row;
    })
  );
  container.replaceChildren(list);
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
    // Left enabled on purpose: a seed the garden cannot afford yet stays
    // focusable and pressable, so a press reaches the refusal that says why
    // (see plantSeedFromButton) instead of doing nothing. `aria-disabled` is
    // how assistive technology is told the control is unavailable right now.
    button.setAttribute("aria-disabled", String(!kind.canPlant));
  }

  const goal = describeNextGoal(state);
  setText(elements.goalTitle, goal.title);
  setMeter(goal.progress);
  renderGoalFacts(elements.goalDetail, goal.facts);

  renderOpenBed(state);
}

/**
 * One kind's readout: its row and the labelled value spans inside it, found
 * once so a re-render writes into the spans that are already there rather than
 * querying the row again on every tick. `prefix` names the row's own data-field
 * family — the garden's rows use `kind`, the rehearsal's use `sandbox-kind` —
 * so the same describe functions can write either readout.
 */
function readKindRow(key, prefix = "kind") {
  const row = document.querySelector(`[data-field="${prefix}-${key}"]`);
  const values = new Map(
    [...(row?.querySelectorAll("[data-field]") ?? [])].map((span) => [span.dataset.field, span])
  );
  return { row, values };
}

/**
 * The two kinds as the readout reads them: each kind's seeds and plants, the
 * price of its next seed, what one grown plant adds to the rate now that its
 * milestones are counted, and the nearer goal — its next plant milestone and
 * how many more plants of that kind it needs. Pure, so the row and get-state
 * cannot disagree about a kind; the label each value sits under is part of the
 * markup, because it never changes.
 */
export function describeKind(kind) {
  return [
    { field: "seeds", value: formatAmount(kind.seeds) },
    { field: "plants", value: formatAmount(kind.plants) },
    { field: "cost", value: formatAmount(kind.cost) },
    // Spelled out rather than the panel's `+0.5/s`: this row carries no slash,
    // so it reads as words rather than as a formula to decode.
    { field: "output", value: `+${formatGrowth(kind.output)} a second` },
    {
      field: "milestone",
      value: kind.nextMilestone == null ? "all reached" : `${formatAmount(kind.nextMilestone)} plants`,
    },
    // Past the last milestone nothing is left to reach, and that reads as the 0
    // it is: every other fact in the row is a number.
    { field: "to-go", value: formatAmount(kind.plantsToMilestone ?? 0) },
  ];
}

/** One kind's row: its facts, each written into its own labelled span. */
function renderKind(kindRow, kind, prefix = "kind") {
  if (!kindRow?.row || !kind) return;
  for (const { field, value } of describeKind(kind)) {
    setText(kindRow.values.get(`${prefix}-${kind.key}-${field}`), value);
  }
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
  // Kept enabled for the same reason as the Plant controls: a bed the garden
  // cannot pay for yet must still be pressable, so the press is answered with
  // the reason rather than silence.
  button.setAttribute("aria-disabled", String(!state.canOpenBed));
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

/**
 * Plant one kind's seed from its button, and say what was planted. Returns
 * whether the seed was planted, so a caller can tell a real action from a press
 * the garden refused and keep the two apart.
 */
function plantSeedFromButton(kind = "herb") {
  const result = plantSeed(kind);
  if (!result.ok) {
    announce(
      result.reason === "the plot is full"
        ? "Every plot already holds a seed."
        : "Not enough growth for another seed yet."
    );
    return false;
  }
  const entry = SEED_KINDS[kindIndex(result.kind)];
  announce(
    `Planted a ${entry.name} seed for ${formatAmount(result.cost)} growth — it will grow into a plant in ` +
      `${formatDuration(entry.growSeconds)}.`
  );
  return true;
}

/**
 * Open the next bed from its button, and say what it opened. Returns whether the
 * bed was opened, for the same reason as plantSeedFromButton.
 */
function openBedFromButton() {
  const result = openBed();
  if (!result.ok) {
    announce(
      result.reason === "not enough growth"
        ? "Not enough growth for the next bed yet."
        : "Every plot still has room — plant in it first."
    );
    return false;
  }
  announce(
    `Opened bed #${formatAmount(result.beds)} for ${formatAmount(result.cost)} growth — ` +
      `${formatAmount(result.beds * PLOTS_PER_BED)} plots of soil now.`
  );
  return true;
}

let lastPlotKey = null;
// The rehearsal plot is memoised on its own key, so winding the sandbox forward
// redraws the rehearsal without touching the live plot's memo.
let lastSandboxPlotKey = null;
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

/**
 * A visit beginning as one short line: the garden is drawn as tended while
 * someone is at the page.
 */
export function visitAnnouncement() {
  return "Visit · the garden is tended while you are here";
}

/**
 * The one line the page announces when it opens: the absence's return if there
 * was one, and the visit itself otherwise. Exactly one garden event, whether the
 * visitor arrived after a long gap or a quick reload, so the tended garden they
 * see is always named.
 */
export function arrivalAnnouncement(away) {
  return returnAnnouncement(away) || visitAnnouncement();
}

function render() {
  // A hidden tab still keeps the garden growing (the timer derives growth from
  // elapsed time), but there is nobody to see it redraw.
  if (document.hidden) return;

  const state = getDisplayedState();
  setText(elements.growth, formatGrowth(state.growth));
  setText(elements.rate, `+${formatGrowth(state.rate)}/s`);
  // The extra presence earns, named beside the rate it is added to and shown
  // only while someone is at the page: a garden left alone shows no bonus.
  setText(elements.presenceRate, `+${formatGrowth(state.presenceRate)}/s here`);
  if (elements.presenceRate) elements.presenceRate.hidden = !state.visitPresent;
  setText(elements.lifetime, formatGrowth(state.lifetimeGrowth));
  setText(elements.established, state.established.name);
  setText(elements.replantBonus, `replant now +${formatAmount(state.replantBonus)}`);
  setText(elements.form, state.formName);
  setText(elements.nextForm, describeNextForm(state));
  setMeter(state.formProgress, elements.formMeter, elements.formMeterFill);
  setText(elements.seeds, formatAmount(state.seeds));
  setText(elements.plants, formatAmount(state.plants));
  setText(elements.beds, formatAmount(state.beds));
  setText(elements.capacity, formatAmount(state.capacity));
  renderReadoutFacts(elements.pollinator, describePollinator(state));
  setText(elements.returnMarks, describeReturnMarks(state.returnMarks));
  if (elements.returnMarksRow) elements.returnMarksRow.hidden = !state.returnMarks;
  setText(elements.visitSeconds, formatDuration(state.visit.seconds));
  setText(elements.visitSown, formatAmount(state.visit.sown));
  setText(elements.visitTended, formatAmount(state.visit.tended));
  setText(elements.visitPresent, state.visitPresent ? "Yes" : "No");
  renderReadoutFacts(elements.season, describeSeason(state));
  renderKind(elements.kindHerb, state.kinds[0]);
  renderKind(elements.kindBloom, state.kinds[1]);
  setText(elements.nextPlant, describeNextPlant(state));
  setText(elements.nextBed, describeNextBed(state));
  setText(elements.storage, state.storageAvailable ? "Yes" : "No");
  if (elements.restore) elements.restore.hidden = !state.restoreAvailable;
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
  // the amount, the form it falls in, the kinds on the plot, the season or the
  // establishment the lasting layer is drawn from change — and stays put when
  // nothing does. Its breathing phase is part of the key, so a still plot (bare
  // soil, or reduced motion) is redrawn only when the state changes, while a
  // living one advances a frame each tick.
  const phase = motionPhase({
    reduced: plotReducedMotion,
    frame: plotFrame,
    living: plotIsLiving(state),
  });
  const plotKey =
    `${state.form}:${state.growth}:${state.seedCounts.join(",")}:${state.plantCounts.join(",")}:` +
    `${state.beds}:${state.pollinator.visiting}:${state.season.key}:${phase}:` +
    `${state.established.index}:${state.established.fill}:${state.visit.sown}:` +
    `${state.visit.tended}:${state.visitPresent}:${JSON.stringify(state.returnMarks ?? null)}`;
  if (plotKey !== lastPlotKey) {
    drawGarden(elements.plot, state, readPalette(), phase);
    // Each kind's own seed and grown plant drawn beside the label that counts
    // them, from the plot's own sprites, so a visitor can point at a plant or
    // seed on the plot and find the row that counts it.
    drawKindSwatch(elements.kindHerbSwatch, "herb", state, readPalette());
    drawKindSwatch(elements.kindBloomSwatch, "bloom", state, readPalette());
    // The plot's own hand-work marks drawn beside the facts that count them, so
    // a standing sign or a hoe cut on the soil can be traced to its label. Each
    // depends only on the season, so the state-change redraw above is enough.
    drawHandWorkGlyph(elements.visitSownGlyph, "sown", state, readPalette());
    drawHandWorkGlyph(elements.visitTendedGlyph, "tended", state, readPalette());
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
  renderReadoutFacts(elements.sandboxSeason, describeSeason(rehearsal));
  renderReadoutFacts(elements.sandboxPollinator, describePollinator(rehearsal));
  renderKind(elements.sandboxKindHerb, rehearsal.kinds[0], "sandbox-kind");
  renderKind(elements.sandboxKindBloom, rehearsal.kinds[1], "sandbox-kind");
  renderGoalFacts(elements.sandboxSummary, rehearsal.facts ?? []);
  setText(elements.sandboxGoalTitle, rehearsal.goalTitle);
  renderGoalFacts(elements.sandboxGoalDetail, rehearsal.goalFacts ?? []);
  setMeter(rehearsal.goalProgress, elements.sandboxMeter, elements.sandboxMeterFill);

  // The rehearsal's own four actions, labelled and made unavailable exactly as
  // the real panel's are — the same reachable control that answers a press with
  // its refusal — so a visitor tries the same decisions on the sandbox copy.
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
    button.setAttribute("aria-disabled", String(!kind.canPlant));
  }
  if (elements.sandboxOpenBed) {
    elements.sandboxOpenBed.hidden = !rehearsal.plotFull;
    setText(elements.sandboxOpenBed, `Open the next bed — ${formatAmount(rehearsal.nextBedCost)} growth`);
    elements.sandboxOpenBed.setAttribute("aria-disabled", String(!rehearsal.canOpenBed));
  }
  setText(elements.sandboxStatus, rehearsal.status);

  // The rehearsal's garden drawn beside its values, with the live plot's own
  // renderer and palette, so winding time, tending and planting are seen and
  // not only counted. The phase breathes for a rehearsal with anything growing
  // on it, exactly as the live plot does, and the memo redraws only when the
  // rehearsal's own form, growth, kinds, beds, pollinator, season, capacity or
  // phase change — so a fast-forward is visibly a different picture while a
  // still one stays put.
  if (elements.sandboxPlot) {
    const phase = motionPhase({
      reduced: plotReducedMotion,
      frame: plotFrame,
      living: plotIsLiving(rehearsal),
    });
    const rehearsalPlot = sandboxPlotState(rehearsal);
    const sandboxPlotKey =
      `${rehearsal.form}:${rehearsal.growth}:${rehearsalPlot.seedCounts.join(",")}:` +
      `${rehearsalPlot.plantCounts.join(",")}:${rehearsal.beds}:${rehearsal.pollinator?.visiting}:` +
      `${rehearsal.season?.key}:${phase}:${rehearsal.capacity}`;
    if (sandboxPlotKey !== lastSandboxPlotKey) {
      drawGarden(elements.sandboxPlot, rehearsalPlot, readPalette(), phase);
      lastSandboxPlotKey = sandboxPlotKey;
    }
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

/** The save text the open Load dialog is previewing, or null while it is closed. */
let pendingLoad = null;

/**
 * Show what the pasted save holds beside the garden now, and replace nothing.
 *
 * Nothing is loaded here: the dialog lists growth, seeds, plants, beds and
 * lifetime, each as the garden now beside the garden in this save, and holds
 * the pasted text until Load now is pressed. Keep this garden (or Esc) closes
 * the dialog and changes nothing. An unreadable save is announced and opens no
 * dialog.
 */
function openLoadDialog() {
  const text = elements.save ? elements.save.value : "";
  let preview;
  try {
    preview = previewGardenSave(text);
  } catch (e) {
    announce(e.message);
    return;
  }
  pendingLoad = text;
  for (const { field, format, element } of LOAD_FACTS) {
    setText(element, `now ${format(preview.current[field])} · in this save ${format(preview.incoming[field])}`);
  }
  if (typeof elements.loadDialog?.showModal === "function" && !elements.loadDialog.open) {
    elements.loadDialog.showModal();
  }
}

/**
 * Load the save the dialog previewed, once the visitor has confirmed it, and
 * say what was kept. The text is the one captured when the dialog opened, so an
 * edit made after the preview is never applied silently.
 */
function loadPreviewedSave() {
  const text = pendingLoad;
  pendingLoad = null;
  if (typeof elements.loadDialog?.close === "function") elements.loadDialog.close();
  if (text == null) return;
  const result = loadGardenSave(text);
  announce(
    result.persisted
      ? "Garden loaded and saved in this browser."
      : "Garden loaded, but this browser will not keep it — copy the save to be safe."
  );
}

/**
 * Put back the garden the last load replaced, from the Restore previous garden
 * button, and say what came back. A press with nothing kept is answered with
 * the reason rather than silence.
 */
function restoreFromButton() {
  const result = restoreGardenSave();
  if (!result.ok) {
    announce("There is no earlier garden to put back — loading a save replaces one, and this undoes that load.");
    return;
  }
  const { growth, seeds, plants, beds, lifetime } = result.restoredContents;
  announce(
    `Restored the garden the last load replaced — ${formatGrowth(growth)} growth, ${formatAmount(seeds)} seeds, ` +
      `${formatAmount(plants)} plants, ${formatAmount(beds)} beds, ${formatGrowth(lifetime)} lifetime.`
  );
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
  // A press the garden refuses is not an action, so it neither clears the marks
  // nor writes the save — it only says why in the status line.
  elements.tend?.addEventListener("click", () => {
    clearReturnMarks();
    tend();
    persist();
  });
  elements.plant?.addEventListener("click", () => {
    if (!plantSeedFromButton("herb")) return;
    clearReturnMarks();
    persist();
  });
  elements.plantBloom?.addEventListener("click", () => {
    if (!plantSeedFromButton("bloom")) return;
    clearReturnMarks();
    persist();
  });
  elements.openBed?.addEventListener("click", () => {
    if (!openBedFromButton()) return;
    clearReturnMarks();
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
  // The dismiss control acknowledges the return without touching the garden:
  // the same clear the actions do, and the only way to clear marks when the
  // visitor does not want to act yet.
  elements.dismissReturn?.addEventListener("click", () => {
    clearReturnMarks();
    announce("Return notice dismissed.");
  });
  elements.copy?.addEventListener("click", copySave);
  elements.load?.addEventListener("click", openLoadDialog);
  elements.loadConfirm?.addEventListener("click", loadPreviewedSave);
  elements.restore?.addEventListener("click", restoreFromButton);
  // Keep this garden (or Esc) is a pure no-op: it closes the dialog and nothing else.
  elements.loadCancel?.addEventListener("click", () => elements.loadDialog?.close());
  elements.save?.addEventListener("input", () => announce(""));

  elements.openSandbox?.addEventListener("click", () => openSandbox());
  elements.sandboxClose?.addEventListener("click", () => closeSandbox());
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
  // Whether the visitor was at the page during the span just counted. The tick
  // credits each span with the presence it was spent in, so the bonus stops the
  // instant the visit does and hidden time earns the garden's own rate alone.
  let lastPresent = !document.hidden;
  const tick = () => {
    const now = Date.now();
    const elapsed = Math.max(0, (now - lastTick) / 1000);
    lastTick = now;
    plotFrame += 1;
    // Count this visit before the advance, which notifies and redraws the
    // readout, so the two are stated together and cannot drift apart.
    addVisitTime(elapsed);
    if (elapsed > 0) advance(elapsed, { present: lastPresent });
    // The next span is spent in the presence the page has now, so a hide and a
    // return between two ticks are each credited without the other's bonus.
    lastPresent = !document.hidden;
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
    // Tick first, on both edges: the span just ended is credited with the
    // presence it was spent in — the watched span when the tab hides, the
    // hidden span when it returns — before `lastPresent` flips to the new one.
    tick();
    if (document.hidden) {
      persist();
      return;
    }
    render();
  });
  window.addEventListener("pagehide", () => persist());

  render();
}

start();
