/**
 * The garden's state, its portable save, and where that save is kept.
 *
 * The garden is the numbers. Everything the page draws is a view of the one
 * `garden` object held here, and every visitor — a person at the page, an agent
 * through a tool, or a save string pasted from another machine — changes it
 * through this module. That is why the save is a codec over the same object
 * rather than a screenshot of the page: whatever round-trips here is exactly
 * what the garden is.
 *
 * The starting garden is bare soil with one ungrown seed: one seed in the
 * ground, nothing grown yet.
 */

/** The save format. Bump it only if the shape below actually changes. */
export const SAVE_VERSION = 5;

/** A readable marker, so a save is recognisable and the version is obvious. */
export const SAVE_PREFIX = "SELFGROW1.";

/** The one key the garden is stored under in the browser. */
export const STORAGE_KEY = "selfgrow.garden";

/**
 * When the visitor was last seen, in device-local milliseconds.
 *
 * This is kept beside the garden rather than inside its portable save string,
 * because a timestamp is about this browser, not about the garden itself: the
 * string a player copies out must not depend on when it happened to be copied.
 */
export const LAST_SEEN_KEY = "selfgrow.garden.seen";

/** How many plots of soil each bed of soil offers. */
export const PLOTS_PER_BED = 12;

/**
 * How many plots the smallest garden has to plant in.
 *
 * The garden's actual capacity is its bed count times this; a garden that fills
 * every plot is offered the next bed rather than a wall, so this is the size of
 * one bed, not the limit of the garden.
 */
export const PLOT_CAPACITY = PLOTS_PER_BED;

/** What the first bed beyond the starting one costs, and how fast it climbs. */
export const BED_COST_BASE = 200;
export const BED_COST_RATE = 1.15;

/**
 * How long a planted seed stays an ungrown sprout before it becomes a grown
 * plant. Growth comes from plants, not seeds, so this is the wait between
 * planting and the garden speeding up — the same wall-clock rule the growth
 * loop uses, so a return resolves several of these in one calculation.
 */
export const GROW_SECONDS = 30;

/**
 * How often a pollinator can visit, how long each visit lasts, and how much
 * faster the garden grows while one stays. A visit is the last slice of each
 * cycle, so a garden that has just been planted waits before its first visitor
 * and the arrival is a small event rather than a permanent upgrade.
 */
export const POLLINATOR_CYCLE_SECONDS = 180;
export const POLLINATOR_VISIT_SECONDS = 60;
export const POLLINATOR_BOOST = 2;

/** Bare soil, one bed of it, and one ungrown seed. */
export function newGarden() {
  return { version: SAVE_VERSION, seeds: 1, plants: 0, beds: 1 };
}

/**
 * A plot count must be a whole, finite number of zero or more. Anything else is
 * rejected at the door rather than rendered as "NaN" or a negative sprite.
 */
function assertCount(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`the save's ${field} must be a whole number of 0 or more, but it is ${JSON.stringify(value)}.`);
  }
}

/**
 * A bed count must be a whole number of one or more. A live garden or a caller
 * that never knew about beds falls back to one bed rather than to none, because
 * a garden with no soil could never grow again.
 */
function bedCount(value) {
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/** Refuse a bed count written into a save that is not whole beds. */
function assertBeds(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`the save's beds must be a whole number of 1 or more, but it is ${JSON.stringify(value)}.`);
  }
}

/**
 * A growth total or rate, kept to a finite number of zero or more. Anything
 * missing, negative or not a number becomes zero, so a save or a garden state
 * that never knew about growth reads as "nothing grown" rather than as `NaN`.
 */
function amountOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * A growth amount or rate read back out of a save: full zero or more, finite.
 * A negative, missing or non-finite value is refused with a reason.
 */
function assertAmount(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`the save's ${field} must be a number of 0 or more, but it is ${JSON.stringify(value)}.`);
  }
}

/**
 * The sprouting seeds a save should carry, as their remaining seconds.
 *
 * A live garden already holds a `sprouts` array; a caller that only knows a
 * count of ungrown seeds (the shape the page and older code pass around) gets
 * fresh `GROW_SECONDS` timers for each. Either way the number of plots is the
 * bound, so a value nothing could have reached is refused rather than written.
 */
function sproutTimersForSave(garden, beds) {
  const capacity = beds * PLOTS_PER_BED;
  if (Array.isArray(garden.sprouts)) {
    if (garden.sprouts.length > capacity) {
      throw new Error(
        `a garden of ${beds} bed(s) can hold at most ${capacity} ungrown seeds, but this one holds ${garden.sprouts.length}.`
      );
    }
    return garden.sprouts.map((timer) => (Number.isFinite(timer) && timer > 0 ? timer : 0));
  }
  assertCount(garden.seeds, "seeds");
  if (garden.seeds > capacity) {
    throw new Error(
      `a garden of ${beds} bed(s) can hold at most ${capacity} ungrown seeds, but this one holds ${garden.seeds}.`
    );
  }
  return Array.from({ length: garden.seeds }, () => GROW_SECONDS);
}

/**
 * Turn a garden into the one string a player can copy out and paste back.
 *
 * @returns {string} e.g. `SELFGROW1.eyJ2ZXJzaW9uIjoz...`
 */
export function encodeSave(garden) {
  const beds = bedCount(garden.beds);
  const sprouts = sproutTimersForSave(garden, beds);
  assertCount(garden.plants ?? 0, "plants");
  const body = JSON.stringify({
    version: SAVE_VERSION,
    seeds: sprouts.length,
    plants: garden.plants ?? 0,
    sprouts,
    growth: amountOrZero(garden.growth),
    rate: amountOrZero(garden.rate),
    age: amountOrZero(garden.age),
    beds,
  });
  return SAVE_PREFIX + btoa(body);
}

/**
 * Read a garden back out of a save string, or refuse it with a reason.
 *
 * Every failure carries why it failed, because the message is shown to the
 * visitor and read by an agent deciding what to fix.
 *
 * Older saves are read as migrations: version 1 (before growth was kept) starts
 * with nothing grown, and in both versions before 3 the seeds that used to speed
 * the garden up instantly become ungrown sprouts with their full growing time
 * left, so nothing already planted is lost. Their rate is rewritten to match:
 * the old per-seed production is taken back out and the grown plants' production
 * put in its place. Before version 4 the garden had exactly one bed, so older
 * saves open onto one bed of soil whatever they may say. Version 5 added the
 * garden's age, so earlier saves open at age zero with no visit already past.
 *
 * @returns {{version: number, seeds: number, plants: number, sprouts: number[], growth: number, rate: number, age: number, beds: number}}
 * @throws {Error} when the text is empty, not a selfgrow save, damaged,
 *   the wrong version, or carries a bad plot count, growth, rate or age.
 */
export function decodeSave(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("there is nothing to load — paste a garden save first.");
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith(SAVE_PREFIX)) {
    throw new Error(`that is not a selfgrow save — it should start with ${SAVE_PREFIX}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(atob(trimmed.slice(SAVE_PREFIX.length)));
  } catch {
    throw new Error("that save is damaged — its text could not be decoded.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("that save is empty or the wrong shape.");
  }
  if (!(Number.isInteger(parsed.version) && parsed.version >= 1 && parsed.version <= SAVE_VERSION)) {
    throw new Error(
      `that save is version ${JSON.stringify(parsed.version)}, but this garden reads version ${SAVE_VERSION}.`
    );
  }
  assertCount(parsed.plants, "plants");
  // Before version 4 there was one bed of soil and no field for it; a save that
  // carries one anyway is still read as the single bed it must have been. The
  // bound is the literal 4 on purpose: a version-4 save really did carry beds,
  // and widening the save format to 5 must not fold them back into one.
  const beds = parsed.version < 4 ? 1 : readBeds(parsed);
  // Before version 5 there was no age to count a pollinator against; an older
  // garden opens as freshly planted rather than as if a pollinator had just
  // left, so nothing already past is invented for it.
  const age = parsed.version < 5 ? 0 : readAge(parsed);
  const sprouts = readSproutsFromSave(parsed, beds * PLOTS_PER_BED);
  // Version 1 had no growth of its own; migrating it starts with nothing grown.
  const growth = parsed.version === 1 ? 0 : parsed.growth;
  let rate = parsed.version === 1 ? 0 : parsed.rate;
  assertAmount(growth, "growth");
  assertAmount(rate, "rate");
  // Before version 3 every planted seed sped the garden up at once. Take that
  // production back out and let the grown plants carry it instead, so migrating
  // neither grants growth for free nor takes away what the visitor earned.
  if (parsed.version <= 2) {
    rate = Math.max(0, rate - PLANT_PRODUCTION * parsed.seeds) + PLANT_PRODUCTION * parsed.plants;
  }
  return { version: SAVE_VERSION, seeds: sprouts.length, plants: parsed.plants, sprouts, growth, rate, age, beds };
}

/**
 * The age a save carries, in seconds of elapsed garden time. A save that never
 * knew about age opens at zero; a negative or non-finite one is refused with a
 * reason, because it would put a pollinator somewhere the clock never was.
 */
function readAge(parsed) {
  if (parsed.age === undefined || parsed.age === null) return 0;
  assertAge(parsed.age);
  return parsed.age;
}

/** Refuse an age written into a save that is not a finite number of seconds. */
function assertAge(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`the save's age must be a number of seconds of 0 or more, but it is ${JSON.stringify(value)}.`);
  }
}

/** The bed count a save carries, defaulting to one when it does not say. */
function readBeds(parsed) {
  if (parsed.beds === undefined || parsed.beds === null) return 1;
  assertBeds(parsed.beds);
  return parsed.beds;
}

/**
 * The ungrown seeds a save carries, as an array of seconds left to grow.
 *
 * Version 3 writes the timers it has; older saves only carry a count, and each
 * of those seeds wakes as a fresh sprout with its whole growing time left.
 */
function readSproutsFromSave(parsed, capacity) {
  if (Array.isArray(parsed.sprouts)) {
    if (parsed.sprouts.length > capacity) {
      throw new Error(
        `the save has ${parsed.sprouts.length} ungrown seeds, but the garden has only ${capacity} plots.`
      );
    }
    return parsed.sprouts.map((timer, index) => {
      if (typeof timer !== "number" || !Number.isFinite(timer) || timer < 0) {
        throw new Error(
          `the save's ungrown seed ${index} must be a number of seconds of 0 or more, but it is ${JSON.stringify(timer)}.`
        );
      }
      return timer;
    });
  }
  assertCount(parsed.seeds, "seeds");
  if (parsed.seeds > capacity) {
    throw new Error(
      `the save has ${parsed.seeds} ungrown seeds, but the garden has only ${capacity} plots.`
    );
  }
  return Array.from({ length: parsed.seeds }, () => GROW_SECONDS);
}

/** The browser's store, or null when it cannot even be reached. */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Whether the given store accepts writes, so the page can say so plainly. */
export function storageAvailable(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(`${STORAGE_KEY}.probe`, "1");
    storage.removeItem(`${STORAGE_KEY}.probe`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The garden kept in the browser, or a fresh one when there is none.
 *
 * A stored save that cannot be read is reported as `damaged` and a fresh garden
 * is offered instead — the visitor is never left with a blank page over a
 * corrupt value.
 */
export function readStoredGarden(storage = defaultStorage()) {
  if (!storage) return { garden: newGarden(), damaged: false };

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { garden: newGarden(), damaged: false };
  }
  if (raw == null) return { garden: newGarden(), damaged: false };

  try {
    return { garden: decodeSave(raw), damaged: false };
  } catch {
    return { garden: newGarden(), damaged: true };
  }
}

/**
 * Write the garden to the browser. The live growth and rate are carried in the
 * same save, so time away can be counted from exactly what the visitor left.
 *
 * @returns {boolean} whether the garden was actually written.
 */
export function writeStoredGarden(garden, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, encodeSave({ ...garden, ...getGrowthState() }));
    return true;
  } catch {
    return false;
  }
}

/** When the visitor was last here, in device-local milliseconds, or null. */
export function readLastSeen(storage = defaultStorage()) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** @returns {boolean} whether the timestamp was actually written. */
export function writeLastSeen(nowMs, storage = defaultStorage()) {
  if (!storage || !Number.isFinite(nowMs)) return false;
  try {
    storage.setItem(LAST_SEEN_KEY, String(nowMs));
    return true;
  } catch {
    return false;
  }
}

/**
 * How many seconds passed between `lastSeenMs` and `nowMs`.
 *
 * A missing or non-finite input, or a clock that ran backwards, counts as no
 * time at all — the garden must never grow on a span it cannot trust.
 */
export function elapsedSeconds(lastSeenMs, nowMs) {
  if (!Number.isFinite(lastSeenMs) || !Number.isFinite(nowMs)) return 0;
  const span = (nowMs - lastSeenMs) / 1000;
  return span > 0 ? span : 0;
}

// --- The live garden ---------------------------------------------------------

// The live garden: the ungrown seeds as their remaining seconds, and the grown
// plants. `seeds` is the length of `sprouts` and is never stored separately, so
// a seed becoming a plant is one move between the two.
let garden = { version: SAVE_VERSION, sprouts: [GROW_SECONDS], plants: 0, beds: 1 };
const listeners = new Set();

/** Tell everyone watching that the garden moved. */
function notify() {
  const snapshot = getGarden();
  for (const listener of listeners) listener(snapshot);
}

/**
 * A copy of the current garden: how many beds of soil it has (and how many
 * plots that is), the ungrown seed count (and their timers), and the grown
 * plants. Growth and rate live beside this (see `getGrowthState`).
 */
export function getGarden() {
  const beds = bedCount(garden.beds);
  return {
    version: garden.version,
    seeds: garden.sprouts.length,
    plants: garden.plants,
    sprouts: [...garden.sprouts],
    beds,
    capacity: beds * PLOTS_PER_BED,
  };
}

/** A whole count of 0 or more, capped at `limit`. Anything else counts as zero. */
function wholeCount(value, limit) {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, limit);
}

/**
 * Replace the garden and tell everyone who is watching.
 *
 * `next` may carry the ungrown seeds either as a `sprouts` array of seconds or
 * as a `seeds` count; a bare count becomes that many fresh `GROW_SECONDS`
 * sprouts. Either way the plot's capacity is the bound.
 */
export function setGarden(next) {
  const beds = bedCount(next.beds);
  const capacity = beds * PLOTS_PER_BED;
  const hasTimers = Array.isArray(next.sprouts);
  const maturedEarly = hasTimers ? next.sprouts.filter((t) => Number.isFinite(t) && t <= 0).length : 0;
  const sprouts = hasTimers
    ? next.sprouts.filter((t) => Number.isFinite(t) && t > 0).slice(0, capacity)
    : Array.from({ length: wholeCount(next.seeds, capacity) }, () => GROW_SECONDS);
  garden = {
    version: SAVE_VERSION,
    sprouts,
    plants: wholeCount(next.plants, Number.MAX_SAFE_INTEGER) + maturedEarly,
    beds,
  };
  notify();
}

/** Listen for changes; returns a function that stops listening. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- The live growth loop ----------------------------------------------------
//
// Growth is the garden's first resource: one tap of the soil earns a little of
// it and raises the rate it keeps arriving at, so the number climbs on its own
// after the click. The live amount, rate and age are written with the garden's
// save (see `writeStoredGarden`) so a visit can resume where the last one
// stopped, and time away can be counted from the rate it was left at.

/** What one tend of the soil earns, and how much faster it makes the garden. */
export const TEND_YIELD = 1;
export const TEND_RATE_STEP = 0.1;

let growth = 0;
let rate = 0;
let age = 0;

/**
 * The live growth since this visit began, its rate in growth/second, and the
 * garden's age in seconds of elapsed time. Age is what a pollinator's schedule
 * is read from, so it is kept beside the growth rather than derived from a
 * foreground timer: a hidden tab still ages the garden.
 */
export function getGrowthState() {
  return { growth, rate, age };
}

/**
 * Put the live growth back to a known point — the snapshot a caller took. Out
 * of range or missing values fall back to nothing grown rather than to `NaN`,
 * and a missing age restarts at zero rather than leaving the clock somewhere
 * unknown.
 */
export function setGrowth(growthValue, rateValue = 0, ageValue = 0) {
  growth = Number.isFinite(growthValue) && growthValue > 0 ? growthValue : 0;
  rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 0;
  age = Number.isFinite(ageValue) && ageValue > 0 ? ageValue : 0;
  notify();
}

// --- The visiting pollinator -------------------------------------------------
//
// A pollinator is not a resource the visitor spends or loses: it is derived
// from the garden's age, the same way growth is derived from elapsed time, so
// a tab that was hidden or a device that slept sees exactly the visit a watched
// garden would. It only visits a garden with something grown in it, and it is
// the last slice of each cycle, so a fresh garden waits for its first visitor.

/**
 * Whether a pollinator is visiting a garden `ageSeconds` old that holds
 * `plants` grown plants, and how much faster the garden grows while it stays.
 *
 * Pure and deterministic: the same age and plants always answer the same, so
 * the readout, the picture and the simulated growth cannot disagree about it.
 *
 * @returns {{visiting: boolean, multiplier: number, boost: number}}
 */
export function pollinatorAt(ageSeconds, plants) {
  const grown = Number.isFinite(plants) && plants > 0;
  const gardenAge = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0;
  const phase = gardenAge % POLLINATOR_CYCLE_SECONDS;
  const visiting = grown && phase >= POLLINATOR_CYCLE_SECONDS - POLLINATOR_VISIT_SECONDS;
  return {
    visiting,
    multiplier: visiting ? POLLINATOR_BOOST : 1,
    boost: POLLINATOR_BOOST,
  };
}

/** The visit seconds seen from the garden's start up to `seconds` of age. */
function visitingSecondsUpTo(seconds) {
  if (!(seconds > 0)) return 0;
  const cycles = Math.floor(seconds / POLLINATOR_CYCLE_SECONDS);
  const phase = seconds - cycles * POLLINATOR_CYCLE_SECONDS;
  const visitStart = POLLINATOR_CYCLE_SECONDS - POLLINATOR_VISIT_SECONDS;
  const partial = Math.min(POLLINATOR_VISIT_SECONDS, Math.max(0, phase - visitStart));
  return cycles * POLLINATOR_VISIT_SECONDS + partial;
}

/**
 * How many of the `spanSeconds` starting at `ageSeconds` of garden age fall
 * inside a pollinator visit, for a garden with grown plants.
 *
 * Closed form, so a month resolves in one calculation rather than one step per
 * three-minute cycle. A missing, negative or non-finite span is no visit time.
 */
export function pollinatorSecondsWithin(ageSeconds, spanSeconds) {
  if (!Number.isFinite(ageSeconds) || !Number.isFinite(spanSeconds) || spanSeconds <= 0) return 0;
  const start = ageSeconds > 0 ? ageSeconds : 0;
  return visitingSecondsUpTo(start + spanSeconds) - visitingSecondsUpTo(start);
}

/**
 * Tend the soil: earn growth now, and raise the rate the garden grows at so the
 * number keeps climbing afterwards. Returns the state after the action.
 */
export function tend() {
  growth += TEND_YIELD;
  rate += TEND_RATE_STEP;
  notify();
  return getGrowthState();
}

/**
 * Wind a garden state forward by `seconds`, and return the garden it becomes.
 *
 * This is the one place the growth rule lives. A state is `{growth, rate,
 * sprouts, plants, beds}` and the result is the same shape, so any caller can
 * run a span against a copy without touching the live garden — that is how the
 * sandbox rehearses time. The span is walked by jumping to the next seed that
 * matures, so a month resolves in at most one step per plot rather than one per
 * tick, and a rehearsal lands exactly where played time would, with no cap on
 * how long the span was. A zero, negative or non-finite span grows nothing, and
 * a state missing a field reads as a garden that never grew.
 *
 * Pure: it never notifies, never writes, and never touches the live garden.
 */
export function simulateGarden(state, seconds) {
  const source = state ?? {};
  const beds = bedCount(source.beds);
  const capacity = beds * PLOTS_PER_BED;
  let growth = amountOrZero(source.growth);
  let rate = amountOrZero(source.rate);
  let age = Number.isFinite(source.age) && source.age > 0 ? source.age : 0;
  let sprouts = Array.isArray(source.sprouts)
    ? source.sprouts.filter((timer) => Number.isFinite(timer) && timer > 0).slice(0, capacity)
    : [];
  let plants = Number.isInteger(source.plants) && source.plants > 0 ? source.plants : 0;

  if (!(Number.isFinite(seconds) && seconds > 0)) {
    return { growth, rate, sprouts, plants, beds, age };
  }

  let remaining = seconds;
  // Each pass matures at least one seed, so the passes are bounded by the plots.
  for (let pass = 0; remaining > 0 && pass <= capacity; pass += 1) {
    const nextSprout = sprouts.length ? Math.min(...sprouts) : Infinity;
    const gap = Math.min(remaining, nextSprout);
    // The plant count is fixed inside a pass, so whether a pollinator is around
    // is read once for the whole gap: a visit multiplies the rate without ever
    // compounding it, and the age carries into the next pass.
    const visitSeconds = plants > 0 ? pollinatorSecondsWithin(age, gap) : 0;
    growth += rate * (gap + (POLLINATOR_BOOST - 1) * visitSeconds);
    remaining -= gap;
    age += gap;
    if (sprouts.length) {
      sprouts = sprouts.map((timer) => Math.max(0, timer - gap));
      const matured = sprouts.filter((timer) => timer <= 0).length;
      if (matured > 0) {
        sprouts = sprouts.filter((timer) => timer > 0);
        plants += matured;
        rate += matured * PLANT_PRODUCTION;
      }
    }
    if (!(gap > 0)) break;
  }
  return { growth, rate, sprouts, plants, beds, age };
}

/**
 * Let the live garden grow for `seconds`, and let every seed that is due mature.
 *
 * A thin wrapper over `simulateGarden`: the live garden is wound forward with
 * the same rule a rehearsal or a return uses, so nothing can disagree about how
 * time changes the garden.
 */
export function advance(seconds) {
  const next = simulateGarden(
    { growth, rate, age, sprouts: garden.sprouts, plants: garden.plants, beds: garden.beds },
    seconds
  );
  growth = next.growth;
  rate = next.rate;
  age = next.age;
  garden = { ...garden, sprouts: next.sprouts, plants: next.plants };
  notify();
  return getGrowthState();
}

// --- Planting a seed ---------------------------------------------------------
//
// The first place one system touches another: a seed costs the growth the soil
// loop earns, and lands in the soil as a sprout. The sprout does not speed the
// garden up — only a grown plant produces — so the rate rises when a plant
// matures, a little after the seed is paid for. The price rises with every seed
// or plant already in the plot, so each next one is a little further away, while
// production rises by a fixed step per plant, so the wait stays a goal rather
// than a wall.

/** What the first seed costs, and how fast the price climbs after that. */
export const SEED_COST_BASE = 5;
export const SEED_COST_RATE = 1.15;

/** How much faster the garden grows for each grown plant. */
export const PLANT_PRODUCTION = 0.5;

/**
 * What the next seed costs when `planted` seeds and plants already fill the plot.
 *
 * Strictly increasing in the planted count, so a sprouting seed never makes the
 * next one cheaper. The exponential passes what a number can hold at a count
 * nothing will reach, but a save that somehow carries one still has to render a
 * finite price, so the result is capped at `Number.MAX_SAFE_INTEGER` rather than
 * left as `Infinity`.
 */
export function nextSeedCost(planted) {
  const count = Number.isFinite(planted) && planted > 0 ? Math.floor(planted) : 0;
  const cost = Math.ceil(SEED_COST_BASE * SEED_COST_RATE ** count);
  return Number.isFinite(cost) ? Math.min(cost, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

/**
 * Plant a seed: spend growth for it, and put a sprouting seed in the soil that
 * will become a grown plant after `GROW_SECONDS`. The rate does not change yet —
 * it rises when the seed matures. Refuses with a reason when the plot is full or
 * the garden has not saved enough growth, and changes nothing when it refuses.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number}}
 */
export function plantSeed() {
  const capacity = bedCount(garden.beds) * PLOTS_PER_BED;
  const planted = garden.sprouts.length + garden.plants;
  const cost = nextSeedCost(planted);
  if (planted >= capacity) {
    return { ok: false, reason: "the plot is full", cost };
  }
  if (growth < cost) {
    return { ok: false, reason: "not enough growth", cost };
  }

  growth -= cost;
  garden = { ...garden, sprouts: [...garden.sprouts, GROW_SECONDS] };
  writeStoredGarden(garden);
  notify();
  return { ok: true, reason: null, cost };
}

// --- Opening a new bed -------------------------------------------------------
//
// The plot is endless: once every plot holds a seed or a plant, the goal becomes
// the next bed rather than a dead end. Opening it spends the growth the garden
// has earned and widens the soil by another `PLOTS_PER_BED` plots, so there is
// always a next goal. The price rises exponentially with every bed already
// opened, while production rises with every plant, so the wait stays a goal
// rather than a wall.

/**
 * What the next bed costs when the garden already owns `beds` of them.
 *
 * Strictly increasing in the bed count, so opening one never makes the next
 * cheaper. Capped at `Number.MAX_SAFE_INTEGER` so a save that somehow reached an
 * unreachable bed count still renders a finite price rather than `Infinity`.
 */
export function nextBedCost(beds) {
  const count = Number.isFinite(beds) && beds > 0 ? Math.floor(beds) : 1;
  const cost = Math.ceil(BED_COST_BASE * BED_COST_RATE ** count);
  return Number.isFinite(cost) ? Math.min(cost, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

/**
 * Open the next bed of soil: spend the growth it asks for and add
 * `PLOTS_PER_BED` more plots to plant in. Refuses with a reason, changing
 * nothing, when the plot still has room to plant — a bed is only worth opening
 * when it is needed — or when the garden has not saved the price.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number, beds: number}}
 */
export function openBed() {
  const beds = bedCount(garden.beds);
  const capacity = beds * PLOTS_PER_BED;
  const planted = garden.sprouts.length + garden.plants;
  const cost = nextBedCost(beds);
  if (planted < capacity) {
    return { ok: false, reason: "the plot still has room", cost, beds };
  }
  if (growth < cost) {
    return { ok: false, reason: "not enough growth", cost, beds };
  }

  growth -= cost;
  garden = { ...garden, beds: beds + 1 };
  writeStoredGarden(garden);
  notify();
  return { ok: true, reason: null, cost, beds: beds + 1 };
}
