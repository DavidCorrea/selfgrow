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
export const SAVE_VERSION = 7;

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
 * The kinds of seed a visitor can plant, lowest first, as the one source of
 * every kind's numbers. `key` is the word an agent names it by, `name` is the
 * word the readout uses, `costBase`/`costRate` price it, `production` is how
 * much faster the garden grows per grown plant, and `growSeconds` is how long
 * its sprouts take to mature. Herb is the first kind and keeps the numbers the
 * garden always had, so an existing save, test or habit still reads the same;
 * bloom costs more and earns more but matures slower, so neither kind dominates.
 */
export const SEED_KINDS = Object.freeze([
  Object.freeze({ key: "herb", name: "herb", costBase: 5, costRate: 1.15, production: 0.5, growSeconds: 30 }),
  Object.freeze({ key: "bloom", name: "bloom", costBase: 40, costRate: 1.15, production: 5, growSeconds: 45 }),
]);

/**
 * How long the first kind's planted seed stays an ungrown sprout before it
 * becomes a grown plant. Growth comes from plants, not seeds, so this is the
 * wait between planting and the garden speeding up — the same wall-clock rule
 * the growth loop uses, so a return resolves several of these in one
 * calculation.
 */
export const GROW_SECONDS = SEED_KINDS[0].growSeconds;

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
 * One kind's ungrown seeds as the seconds each has left to grow.
 *
 * A live garden holds them as a `sprouts` (herb) or `bloomSprouts` (bloom)
 * array; a caller that only knows a count of ungrown seeds (the shape the page
 * and older code pass around) gets fresh full timers for each. Either way the
 * plots are the bound, so a value nothing could have reached is refused rather
 * than written.
 */
function sproutTimersForKind(garden, index, capacity) {
  const field = index === 0 ? "sprouts" : "bloomSprouts";
  const countField = index === 0 ? "seeds" : "bloomSeeds";
  const list = garden[field];
  if (Array.isArray(list)) {
    if (list.length > capacity) {
      throw new Error(
        `a garden of ${capacity} plots can hold at most ${capacity} ungrown ${SEED_KINDS[index].name} seeds, ` +
          `but this one holds ${list.length}.`
      );
    }
    return list.map((timer) => (Number.isFinite(timer) && timer > 0 ? timer : 0));
  }
  const count = garden[countField] ?? 0;
  assertCount(count, countField);
  if (count > capacity) {
    throw new Error(
      `a garden of ${capacity} plots can hold at most ${capacity} ungrown ${SEED_KINDS[index].name} seeds, ` +
        `but this one holds ${count}.`
    );
  }
  return Array.from({ length: count }, () => SEED_KINDS[index].growSeconds);
}

/**
 * The plants of one kind a save-shaped garden holds, herb-first.
 *
 * A garden read back by `getGarden` or `decodeSave` carries its per-kind
 * counts in `plantCounts`; a plain `{seeds, plants}` (what the page and older
 * code pass around) is all the first kind. `bloomPlants` carries the second
 * kind alone when a save-shaped body writes it out.
 */
function plantsForKind(garden, index) {
  if (Array.isArray(garden.plantCounts)) return garden.plantCounts[index] ?? 0;
  if (index === 0) return garden.plants ?? 0;
  return garden.bloomPlants ?? 0;
}

/**
 * Turn a garden into the one string a player can copy out and paste back.
 *
 * @returns {string} e.g. `SELFGROW1.eyJ2ZXJzaW9uIjoz...`
 */
export function encodeSave(garden) {
  const source = garden ?? {};
  const beds = bedCount(source.beds);
  const capacity = beds * PLOTS_PER_BED;
  const sprouts = sproutTimersForKind(source, 0, capacity);
  const bloomSprouts = sproutTimersForKind(source, 1, capacity);
  const plants = plantsForKind(source, 0);
  const bloomPlants = plantsForKind(source, 1);
  assertCount(plants, "plants");
  assertCount(bloomPlants, "bloomPlants");
  const body = JSON.stringify({
    version: SAVE_VERSION,
    seeds: sprouts.length,
    plants,
    sprouts,
    bloomSeeds: bloomSprouts.length,
    bloomPlants,
    bloomSprouts,
    growth: amountOrZero(source.growth),
    rate: amountOrZero(source.rate),
    age: amountOrZero(source.age),
    lifetime: amountOrZero(source.lifetime),
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
 * Version 6 added the second kind of seed: every seed and plant a version-1
 * to 5 save carries is the first kind, and the second kind opens empty, so no
 * existing save loses a plant it had. Version 7 added the lifetime growth a
 * garden has produced over its whole life; an older save starts it at the
 * growth it currently holds, so nothing already earned is forgotten.
 *
 * @returns {{version: number, seeds: number, plants: number, sprouts: number[], bloomSprouts: number[], plantCounts: number[], growth: number, rate: number, age: number, lifetime: number, beds: number}}
 * @throws {Error} when the text is empty, not a selfgrow save, damaged,
 *   the wrong version, or carries a bad plot count, growth, rate, age or
 *   lifetime.
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
  // and widening the save format must not fold them back into one.
  const beds = parsed.version < 4 ? 1 : readBeds(parsed);
  // Before version 5 there was no age to count a pollinator against; an older
  // garden opens as freshly planted rather than as if a pollinator had just
  // left, so nothing already past is invented for it.
  const age = parsed.version < 5 ? 0 : readAge(parsed);
  const capacity = beds * PLOTS_PER_BED;
  const sprouts = readSproutsForKind(parsed, 0, capacity);
  // Before version 6 there was only the first kind of seed, so every seed and
  // plant an older save carries is that kind and the second kind opens empty.
  const bloomSprouts = parsed.version < 6 ? [] : readSproutsForKind(parsed, 1, capacity);
  const bloomPlants = parsed.version < 6 ? 0 : readBloomPlants(parsed);
  // Version 1 had no growth of its own; migrating it starts with nothing grown.
  const growth = parsed.version === 1 ? 0 : parsed.growth;
  let rate = parsed.version === 1 ? 0 : parsed.rate;
  assertAmount(growth, "growth");
  assertAmount(rate, "rate");
  // Before version 3 every planted seed sped the garden up at once. Take that
  // production back out and let the grown plants carry it instead, so migrating
  // neither grants growth for free nor takes away what the visitor earned.
  if (parsed.version <= 2) {
    const seedCount = Array.isArray(parsed.sprouts) ? parsed.sprouts.length : parsed.seeds;
    rate = Math.max(0, rate - PLANT_PRODUCTION * seedCount) + PLANT_PRODUCTION * parsed.plants;
  }
  // Before version 7 there was no lifetime total. A garden that never kept one
  // has still produced everything it holds, so its lifetime starts at exactly
  // the growth it carries rather than at nothing.
  const lifetime = parsed.version < 7 ? growth : readLifetime(parsed);
  return {
    version: SAVE_VERSION,
    seeds: sprouts.length + bloomSprouts.length,
    plants: parsed.plants + bloomPlants,
    sprouts,
    bloomSprouts,
    plantCounts: [parsed.plants, bloomPlants],
    growth,
    rate,
    age,
    lifetime,
    beds,
  };
}

/**
 * The lifetime growth a save carries, whole and zero or more. A save that does
 * not say opens at nothing grown over its life; a negative or non-finite one is
 * refused with a reason, because it would put the garden's whole history below
 * the growth it currently holds.
 */
function readLifetime(parsed) {
  if (parsed.lifetime === undefined || parsed.lifetime === null) return 0;
  assertAmount(parsed.lifetime, "lifetime");
  return parsed.lifetime;
}

/** The second kind's grown plants a save carries, whole and zero or more. */
function readBloomPlants(parsed) {
  const value = parsed.bloomPlants ?? 0;
  assertCount(value, "bloomPlants");
  return value;
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
 * One kind's ungrown seeds a save carries, as seconds left to grow.
 *
 * Version 3 writes the timers it has; older saves only carry a count, and each
 * of those seeds wakes as a fresh sprout with its whole growing time left. The
 * second kind's saves write `bloomSprouts`; a version before it has none.
 */
function readSproutsForKind(parsed, index, capacity) {
  const field = index === 0 ? "sprouts" : "bloomSprouts";
  const countField = index === 0 ? "seeds" : "bloomSeeds";
  const list = parsed[field];
  if (Array.isArray(list)) {
    if (list.length > capacity) {
      throw new Error(
        `the save has ${list.length} ungrown ${SEED_KINDS[index].name} seeds, but the garden has only ${capacity} plots.`
      );
    }
    return list.map((timer, position) => {
      if (typeof timer !== "number" || !Number.isFinite(timer) || timer < 0) {
        throw new Error(
          `the save's ungrown ${SEED_KINDS[index].name} seed ${position} must be a number of seconds of 0 or more, ` +
            `but it is ${JSON.stringify(timer)}.`
        );
      }
      return timer;
    });
  }
  const count = parsed[countField] ?? 0;
  assertCount(count, countField);
  if (count > capacity) {
    throw new Error(
      `the save has ${count} ungrown ${SEED_KINDS[index].name} seeds, but the garden has only ${capacity} plots.`
    );
  }
  return Array.from({ length: count }, () => SEED_KINDS[index].growSeconds);
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
//
// The live garden carries each kind's ungrown seeds as their remaining seconds
// and each kind's grown plants as a count. The first kind's fields are the
// plain `sprouts`/`plants`, so code and tests that only knew the one kind still
// read the same; the second kind adds `bloomSprouts`/`bloomPlants`.
let garden = {
  version: SAVE_VERSION,
  sprouts: [GROW_SECONDS],
  plants: 0,
  bloomSprouts: [],
  bloomPlants: 0,
  beds: 1,
};
const listeners = new Set();

/** Tell everyone watching that the garden moved. */
function notify() {
  const snapshot = getGarden();
  for (const listener of listeners) listener(snapshot);
}

/**
 * A copy of the current garden: how many beds of soil it has (and how many
 * plots that is), the ungrown seeds (and their timers), and the grown plants.
 * `seeds`/`plants` are the totals across both kinds; the per-kind counts and
 * timers are beside them. Growth and rate live beside this (see
 * `getGrowthState`).
 */
export function getGarden() {
  const beds = bedCount(garden.beds);
  const bloomSprouts = garden.bloomSprouts ?? [];
  return {
    version: garden.version,
    seeds: garden.sprouts.length + bloomSprouts.length,
    plants: garden.plants + (garden.bloomPlants ?? 0),
    sprouts: [...garden.sprouts],
    bloomSprouts: [...bloomSprouts],
    plantCounts: [garden.plants, garden.bloomPlants ?? 0],
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
 * One kind's ungrown seeds read from a garden-shaped object, as the timers that
 * are still growing and how many had already matured. A bare `seeds` count
 * (what older code passes) becomes that many fresh sprouts of the kind.
 */
function kindSproutsForState(state, index, capacity) {
  const field = index === 0 ? "sprouts" : "bloomSprouts";
  const countField = index === 0 ? "seeds" : "bloomSeeds";
  const list = state[field];
  if (Array.isArray(list)) {
    return {
      growing: list.filter((timer) => Number.isFinite(timer) && timer > 0).slice(0, capacity),
      matured: list.filter((timer) => Number.isFinite(timer) && timer <= 0).length,
    };
  }
  return {
    growing: Array.from(
      { length: wholeCount(state[countField], capacity) },
      () => SEED_KINDS[index].growSeconds
    ),
    matured: 0,
  };
}

/**
 * Replace the garden and tell everyone who is watching.
 *
 * `next` may carry each kind's ungrown seeds either as a `sprouts` array of
 * seconds or as a count; a bare count becomes that many fresh sprouts of the
 * kind. A `plantCounts` array (the shape `getGarden` and `decodeSave` return)
 * splits the grown plants by kind; otherwise `plants` is the first kind. Either
 * way the plot's capacity is the bound.
 */
export function setGarden(next) {
  const beds = bedCount(next.beds);
  const capacity = beds * PLOTS_PER_BED;
  const herb = kindSproutsForState(next, 0, capacity);
  const bloom = kindSproutsForState(next, 1, Math.max(0, capacity - herb.growing.length));
  const herbPlants = wholeCount(plantsForKind(next, 0), Number.MAX_SAFE_INTEGER) + herb.matured;
  const bloomPlants = wholeCount(plantsForKind(next, 1), Number.MAX_SAFE_INTEGER) + bloom.matured;
  garden = {
    version: SAVE_VERSION,
    sprouts: herb.growing,
    plants: herbPlants,
    bloomSprouts: bloom.growing,
    bloomPlants,
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
// after the click. The live amount, rate, age and lifetime are written with the
// garden's save (see `writeStoredGarden`) so a visit can resume where the last
// one stopped, and time away can be counted from the rate it was left at.
//
// `lifetime` is everything the garden has ever produced, and unlike the growth
// balance it is never spent: planting a seed or opening a bed takes from the
// balance and leaves the lifetime where it is, so the garden's whole history
// survives a replant and is what a replant's lasting bonus is earned from.

/** What one tend of the soil earns, and how much faster it makes the garden. */
export const TEND_YIELD = 1;
export const TEND_RATE_STEP = 0.1;

let growth = 0;
let rate = 0;
let age = 0;
let lifetime = 0;

/**
 * The live growth since this visit began, its rate in growth/second, the
 * garden's age in seconds of elapsed time, and the growth it has produced over
 * its whole life. Age is what a pollinator's schedule is read from, so it is
 * kept beside the growth rather than derived from a foreground timer: a hidden
 * tab still ages the garden. Lifetime is kept the same way, so the garden's
 * whole history is not something a visitor could lose by not watching.
 */
export function getGrowthState() {
  return { growth, rate, age, lifetime };
}

/**
 * Put the live growth back to a known point — the snapshot a caller took. Out
 * of range or missing values fall back to nothing grown rather than to `NaN`,
 * a missing age restarts at zero rather than leaving the clock somewhere
 * unknown, and a missing lifetime starts the garden's history at nothing.
 */
export function setGrowth(growthValue, rateValue = 0, ageValue = 0, lifetimeValue = 0) {
  growth = Number.isFinite(growthValue) && growthValue > 0 ? growthValue : 0;
  rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 0;
  age = Number.isFinite(ageValue) && ageValue > 0 ? ageValue : 0;
  lifetime = Number.isFinite(lifetimeValue) && lifetimeValue > 0 ? lifetimeValue : 0;
  notify();
}

/**
 * What replanting the garden right now would earn as a lasting bonus: the
 * square root of the growth it has produced over its whole life, floored to a
 * whole number.
 *
 * Sublinear on purpose. Twice the lifetime growth is worth less than twice the
 * bonus, so several runs add up to more than one long one and a visitor is
 * never punished for replanting. Pure and deterministic, so the readout, the
 * page and an agent's state cannot disagree about what a replant is worth.
 */
export function replantBonus(lifetimeGrowth) {
  return Math.floor(Math.sqrt(amountOrZero(lifetimeGrowth)));
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

// --- The seasons -------------------------------------------------------------
//
// The garden passes through a repeating four-season cycle read from its own
// age, the same way a pollinator's visit is: whether anyone is watching, the
// season turns as the garden's clock advances. Each season multiplies the rate
// the garden grows at, and none of them makes it slower than its base rate, so
// a season is a change of mood rather than a punishment. The cycle starts at
// winter, where the multiplier is the base 1, so a fresh garden reads exactly as
// it always has and only grows more generous as time passes.

/** How long each season lasts, in seconds of garden age. */
export const SEASON_SECONDS = 600;

/**
 * The four seasons in the order the cycle visits them, as the one source of
 * each season's name and growth multiplier. Winter is the base rate, and the
 * three that follow are each more generous, so no season grows slower.
 */
export const SEASONS = Object.freeze([
  Object.freeze({ key: "winter", name: "winter", multiplier: 1 }),
  Object.freeze({ key: "spring", name: "spring", multiplier: 1.5 }),
  Object.freeze({ key: "summer", name: "summer", multiplier: 2 }),
  Object.freeze({ key: "autumn", name: "autumn", multiplier: 1.25 }),
]);

/** How long one full turn of the four seasons lasts, in seconds of age. */
export const SEASON_CYCLE_SECONDS = SEASON_SECONDS * SEASONS.length;

/**
 * The season a garden `ageSeconds` old is in, and how much faster it grows.
 *
 * Pure and deterministic — the same age always answers the same season — so the
 * readout, the state and the simulated growth cannot disagree about it. A
 * missing or negative age is the start of the cycle, winter.
 *
 * @returns {{index: number, key: string, name: string, multiplier: number}}
 */
export function seasonAt(ageSeconds) {
  const gardenAge = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0;
  const index = Math.floor(gardenAge / SEASON_SECONDS) % SEASONS.length;
  const season = SEASONS[index];
  return { index, key: season.key, name: season.name, multiplier: season.multiplier };
}

/** One full turn of the cycle's weighted seconds — the multipliers, summed. */
const SEASON_CYCLE_MULTIPLIER_SECONDS = SEASON_SECONDS * SEASONS.reduce(
  (sum, season) => sum + season.multiplier,
  0
);

/** The season multipliers seen from the garden's start up to `seconds` of age. */
function seasonMultiplierSecondsUpTo(seconds) {
  if (!(seconds > 0)) return 0;
  const cycles = Math.floor(seconds / SEASON_CYCLE_SECONDS);
  const phase = seconds - cycles * SEASON_CYCLE_SECONDS;
  let total = cycles * SEASON_CYCLE_MULTIPLIER_SECONDS;
  const wholeSeasons = Math.floor(phase / SEASON_SECONDS);
  for (let index = 0; index < wholeSeasons; index += 1) total += SEASONS[index].multiplier * SEASON_SECONDS;
  return total + (phase - wholeSeasons * SEASON_SECONDS) * SEASONS[wholeSeasons].multiplier;
}

/**
 * The season multipliers integrated over the `spanSeconds` starting at
 * `ageSeconds` of garden age — the weighted seconds growth is earned at.
 *
 * Closed form, so a month resolves in one calculation rather than one step per
 * season, and a rehearsal lands exactly where played time would. A missing,
 * negative or non-finite span is no growth time.
 */
export function seasonMultiplierSecondsWithin(ageSeconds, spanSeconds) {
  if (!Number.isFinite(ageSeconds) || !Number.isFinite(spanSeconds) || spanSeconds <= 0) return 0;
  const start = ageSeconds > 0 ? ageSeconds : 0;
  return seasonMultiplierSecondsUpTo(start + spanSeconds) - seasonMultiplierSecondsUpTo(start);
}

/**
 * Tend the soil: earn growth now, and raise the rate the garden grows at so the
 * number keeps climbing afterwards. Returns the state after the action.
 */
export function tend() {
  growth += TEND_YIELD;
  rate += TEND_RATE_STEP;
  lifetime += TEND_YIELD;
  notify();
  return getGrowthState();
}

function matureKind(timers, gap, onMatured) {
  if (!timers.length) return timers;
  const ticked = timers.map((timer) => Math.max(0, timer - gap));
  const matured = ticked.filter((timer) => timer <= 0).length;
  if (matured > 0) onMatured(matured);
  return ticked.filter((timer) => timer > 0);
}

/**
 * One kind's ungrown seed count and timers from any garden-shaped object, for
 * reading a kind without building a full array of timers. A bare count of
 * `seeds` (the first kind) or `bloomSeeds` (the second) answers with it.
 */
function kindSeedCount(source, index, capacity) {
  const list = source[index === 0 ? "sprouts" : "bloomSprouts"];
  if (Array.isArray(list)) {
    return list.filter((timer) => Number.isFinite(timer) && timer > 0).slice(0, capacity).length;
  }
  return wholeCount(source[index === 0 ? "seeds" : "bloomSeeds"], capacity);
}

/** One kind's ungrown timers from a garden-shaped object, soonest first intact. */
function kindSproutTimers(source, index, capacity) {
  const list = source[index === 0 ? "sprouts" : "bloomSprouts"];
  if (!Array.isArray(list)) return [];
  return list.filter((timer) => Number.isFinite(timer) && timer > 0).slice(0, capacity);
}

/**
 * Wind a garden state forward by `seconds`, and return the garden it becomes.
 *
 * This is the one place the growth rule lives. A state carries each kind's
 * ungrown seeds (`sprouts` and `bloomSprouts`) and grown plants (`plantCounts`
 * or `plants`/`bloomPlants`), and the result is the same shape, so any caller
 * can run a span against a copy without touching the live garden — that is how
 * the sandbox rehearses time. The span is walked by jumping to the next seed
 * that matures, so a month resolves in at most one step per plot rather than
 * one per tick, and a rehearsal lands exactly where played time would, with no
 * cap on how long the span was. A zero, negative or non-finite span grows
 * nothing, and a state missing a field reads as a garden that never grew.
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
  let sprouts = kindSproutTimers(source, 0, capacity);
  let bloomSprouts = kindSproutTimers(source, 1, capacity);
  let herbPlants = wholeCount(plantsForKind(source, 0), Number.MAX_SAFE_INTEGER);
  let bloomPlants = wholeCount(plantsForKind(source, 1), Number.MAX_SAFE_INTEGER);

  const result = () => ({
    growth,
    rate,
    sprouts,
    bloomSprouts,
    plants: herbPlants,
    bloomPlants,
    plantCounts: [herbPlants, bloomPlants],
    beds,
    age,
  });

  if (!(Number.isFinite(seconds) && seconds > 0)) return result();

  let remaining = seconds;
  // Each pass matures at least one seed, so the passes are bounded by the plots.
  for (let pass = 0; remaining > 0 && pass <= capacity; pass += 1) {
    const nextHerb = sprouts.length ? Math.min(...sprouts) : Infinity;
    const nextBloom = bloomSprouts.length ? Math.min(...bloomSprouts) : Infinity;
    const gap = Math.min(remaining, nextHerb, nextBloom);
    // The plant count is fixed inside a pass, so the rate does not change across
    // it and the whole gap is earned at once: the season's multipliers are
    // integrated over the gap and the pollinator's extra seconds are added, not
    // multiplied, so both stay closed form and the age carries into the next
    // pass.
    const visited = herbPlants + bloomPlants > 0 ? pollinatorSecondsWithin(age, gap) : 0;
    growth += rate * (seasonMultiplierSecondsWithin(age, gap) + (POLLINATOR_BOOST - 1) * visited);
    remaining -= gap;
    age += gap;
    sprouts = matureKind(sprouts, gap, (matured) => {
      herbPlants += matured;
      rate += matured * SEED_KINDS[0].production;
    });
    bloomSprouts = matureKind(bloomSprouts, gap, (matured) => {
      bloomPlants += matured;
      rate += matured * SEED_KINDS[1].production;
    });
    if (!(gap > 0)) break;
  }
  return result();
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
    {
      growth,
      rate,
      age,
      sprouts: garden.sprouts,
      bloomSprouts: garden.bloomSprouts,
      plantCounts: [garden.plants, garden.bloomPlants],
      beds: garden.beds,
    },
    seconds
  );
  // Everything the garden earned over the span is added to its lifetime, so
  // the total it can never spend counts exactly the growth that arrived.
  lifetime += Math.max(0, next.growth - growth);
  growth = next.growth;
  rate = next.rate;
  age = next.age;
  garden = {
    ...garden,
    sprouts: next.sprouts,
    plants: next.plants,
    bloomSprouts: next.bloomSprouts,
    bloomPlants: next.bloomPlants,
  };
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

/** What the first herb seed costs, and how fast its price climbs after that. */
export const SEED_COST_BASE = SEED_KINDS[0].costBase;
export const SEED_COST_RATE = SEED_KINDS[0].costRate;

/** How much faster the garden grows for each grown herb plant. */
export const PLANT_PRODUCTION = SEED_KINDS[0].production;

/**
 * The index of a seed kind named by number or key. Anything the garden does not
 * know is the first kind, so a missing or misspelled kind plants herb rather
 * than failing.
 */
export function kindIndex(kind) {
  if (typeof kind === "number" && Number.isInteger(kind) && kind >= 0 && kind < SEED_KINDS.length) return kind;
  const found = SEED_KINDS.findIndex((entry) => entry.key === kind);
  return found >= 0 ? found : 0;
}

/**
 * What the next seed of `kind` costs when `planted` seeds and plants of that
 * kind already fill the plot. Defaults to the first kind, so older callers read
 * the same price they always did.
 *
 * Strictly increasing in the planted count, so a sprouting seed never makes the
 * next one cheaper. The exponential passes what a number can hold at a count
 * nothing will reach, but a save that somehow carries one still has to render a
 * finite price, so the result is capped at `Number.MAX_SAFE_INTEGER` rather than
 * left as `Infinity`.
 */
export function nextSeedCost(planted, kind = 0) {
  const entry = SEED_KINDS[kindIndex(kind)];
  const count = Number.isFinite(planted) && planted > 0 ? Math.floor(planted) : 0;
  const cost = Math.ceil(entry.costBase * entry.costRate ** count);
  return Number.isFinite(cost) ? Math.min(cost, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

/**
 * Every seed kind as the page and an agent read it: the price of its next seed
 * (against how many of that kind already grow), how many of its seeds are
 * ungrown and how many plants are grown, and how long its sprouts take and how
 * much they produce. Pure, so the readout, the goal and an agent's state cannot
 * disagree about a kind.
 */
export function gardenKinds(garden) {
  const source = garden ?? {};
  const capacity = Number.isInteger(source.capacity) ? source.capacity : Number.MAX_SAFE_INTEGER;
  return SEED_KINDS.map((entry, index) => {
    const seeds = kindSeedCount(source, index, capacity);
    const plants = wholeCount(plantsForKind(source, index), Number.MAX_SAFE_INTEGER);
    const planted = seeds + plants;
    return {
      index,
      key: entry.key,
      name: entry.name,
      seeds,
      plants,
      total: planted,
      growSeconds: entry.growSeconds,
      production: entry.production,
      cost: nextSeedCost(planted, index),
      sproutTimers: kindSproutTimers(source, index, capacity),
    };
  });
}

/**
 * Plant a seed of `kind` (herb by default): spend growth for it, and put a
 * sprouting seed in the soil that will become a grown plant after that kind's
 * growing time. The rate does not change yet — it rises when the seed matures.
 * Refuses with a reason when the plot is full or the garden has not saved enough
 * growth, and changes nothing when it refuses.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number, kind: string}}
 */
export function plantSeed(kind = 0) {
  const index = kindIndex(kind);
  const entry = SEED_KINDS[index];
  const capacity = bedCount(garden.beds) * PLOTS_PER_BED;
  const plantsOfKind = wholeCount(plantsForKind(garden, index), Number.MAX_SAFE_INTEGER);
  const plantedOfKind = kindSeedCount(garden, index, capacity) + plantsOfKind;
  const totalPlanted = SEED_KINDS.reduce(
    (sum, _entry, i) =>
      sum + kindSeedCount(garden, i, capacity) + wholeCount(plantsForKind(garden, i), Number.MAX_SAFE_INTEGER),
    0
  );
  const cost = nextSeedCost(plantedOfKind, index);
  if (totalPlanted >= capacity) {
    return { ok: false, reason: "the plot is full", cost, kind: entry.key };
  }
  if (growth < cost) {
    return { ok: false, reason: "not enough growth", cost, kind: entry.key };
  }

  growth -= cost;
  garden = index === 0
    ? { ...garden, sprouts: [...garden.sprouts, entry.growSeconds] }
    : { ...garden, bloomSprouts: [...(garden.bloomSprouts ?? []), entry.growSeconds] };
  writeStoredGarden(garden);
  notify();
  return { ok: true, reason: null, cost, kind: entry.key };
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
  // Every plot taken by either kind counts: soil is soil, whatever grows in it.
  const planted = SEED_KINDS.reduce(
    (sum, _entry, i) =>
      sum + kindSeedCount(garden, i, capacity) + wholeCount(plantsForKind(garden, i), Number.MAX_SAFE_INTEGER),
    0
  );
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
