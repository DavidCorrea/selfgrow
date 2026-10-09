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
export const SAVE_VERSION = 2;

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

/** How many plots of soil the garden has to plant in. */
export const PLOT_CAPACITY = 12;

/** Bare soil and one ungrown seed. */
export function newGarden() {
  return { version: SAVE_VERSION, seeds: 1, plants: 0 };
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
 * A growth amount or rate written to a save. A finite number of zero or more is
 * kept as it is; anything missing, negative or not a number is written as zero,
 * so a caller that never knew about growth still produces a valid save.
 */
function savedAmount(value) {
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
 * Turn a garden into the one string a player can copy out and paste back.
 *
 * @returns {string} e.g. `SELFGROW1.eyJ2ZXJzaW9uIjoy...`
 */
export function encodeSave(garden) {
  assertCount(garden.seeds, "seeds");
  assertCount(garden.plants, "plants");
  const body = JSON.stringify({
    version: SAVE_VERSION,
    seeds: garden.seeds,
    plants: garden.plants,
    growth: savedAmount(garden.growth),
    rate: savedAmount(garden.rate),
  });
  return SAVE_PREFIX + btoa(body);
}

/**
 * Read a garden back out of a save string, or refuse it with a reason.
 *
 * Every failure carries why it failed, because the message is shown to the
 * visitor and read by an agent deciding what to fix.
 *
 * A version-1 save — written before the garden kept its growth — is read as a
 * migration: its seeds and plants are kept and it starts with nothing grown.
 *
 * @returns {{version: number, seeds: number, plants: number, growth: number, rate: number}}
 * @throws {Error} when the text is empty, not a selfgrow save, damaged,
 *   the wrong version, or carries a bad plot count, growth or rate.
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
  if (parsed.version !== 1 && parsed.version !== SAVE_VERSION) {
    throw new Error(
      `that save is version ${JSON.stringify(parsed.version)}, but this garden reads version ${SAVE_VERSION}.`
    );
  }
  assertCount(parsed.seeds, "seeds");
  assertCount(parsed.plants, "plants");
  // Version 1 had no growth of its own; migrating it starts with nothing grown.
  const growth = parsed.version === 1 ? 0 : parsed.growth;
  const rate = parsed.version === 1 ? 0 : parsed.rate;
  assertAmount(growth, "growth");
  assertAmount(rate, "rate");
  return { version: SAVE_VERSION, seeds: parsed.seeds, plants: parsed.plants, growth, rate };
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

let garden = newGarden();
const listeners = new Set();

/** Tell everyone watching that the garden moved. */
function notify() {
  const snapshot = getGarden();
  for (const listener of listeners) listener(snapshot);
}

/** A copy of the current garden. */
export function getGarden() {
  return { ...garden };
}

/** Replace the garden and tell everyone who is watching. */
export function setGarden(next) {
  garden = { version: SAVE_VERSION, seeds: next.seeds, plants: next.plants };
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
// after the click. The live amount and rate are written with the garden's save
// (see `writeStoredGarden`) so a visit can resume where the last one stopped,
// and time away can be counted from the rate it was left at.

/** What one tend of the soil earns, and how much faster it makes the garden. */
export const TEND_YIELD = 1;
export const TEND_RATE_STEP = 0.1;

let growth = 0;
let rate = 0;

/** The live growth total since this visit began, and its rate in growth/second. */
export function getGrowthState() {
  return { growth, rate };
}

/**
 * Put the live growth back to a known point — the snapshot a caller took. Out
 * of range or missing values fall back to nothing grown rather than to `NaN`.
 */
export function setGrowth(growthValue, rateValue = 0) {
  growth = Number.isFinite(growthValue) && growthValue > 0 ? growthValue : 0;
  rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 0;
  notify();
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
 * Let the garden grow for `seconds` at the current rate, in one step. Elapsed
 * time is the only input, so a timer that a hidden tab slowed or skipped still
 * catches up exactly when it next runs. A zero, negative or non-finite span
 * grows nothing.
 */
export function advance(seconds) {
  if (Number.isFinite(seconds) && seconds > 0) growth += rate * seconds;
  notify();
  return getGrowthState();
}

// --- Planting a seed ---------------------------------------------------------
//
// The first place one system touches another: a seed costs the growth the soil
// loop earns, and the seed it plants raises the rate the garden keeps growing
// at. The price rises with every seed already in the soil, so each next one is
// a little further away, while production rises by a fixed step, so the wait
// stays a goal rather than a wall.

/** What the first seed costs, and how fast the price climbs after that. */
export const SEED_COST_BASE = 5;
export const SEED_COST_RATE = 1.15;

/** How much faster the garden grows for each seed in the soil. */
export const SEED_PRODUCTION = 0.5;

/**
 * What the next seed costs when `seeds` are already in the soil.
 *
 * Strictly increasing in the seed count. The exponential passes what a number
 * can hold at a seed count nothing will reach, but a save that somehow carries
 * one still has to render a finite price, so the result is capped at
 * `Number.MAX_SAFE_INTEGER` rather than left as `Infinity`.
 */
export function nextSeedCost(seeds) {
  const count = Number.isFinite(seeds) && seeds > 0 ? Math.floor(seeds) : 0;
  const cost = Math.ceil(SEED_COST_BASE * SEED_COST_RATE ** count);
  return Number.isFinite(cost) ? Math.min(cost, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

/**
 * Plant a seed: spend growth for it, and shorten the wait for the next one by
 * raising the rate the garden grows at. Refuses with a reason when the plot is
 * full or the garden has not saved enough growth, and changes nothing when it
 * refuses.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number}}
 */
export function plantSeed() {
  const cost = nextSeedCost(garden.seeds);
  if (garden.seeds >= PLOT_CAPACITY) {
    return { ok: false, reason: "the plot is full", cost };
  }
  if (growth < cost) {
    return { ok: false, reason: "not enough growth", cost };
  }

  growth -= cost;
  rate += SEED_PRODUCTION;
  garden = { ...garden, seeds: garden.seeds + 1 };
  writeStoredGarden(garden);
  notify();
  return { ok: true, reason: null, cost };
}
