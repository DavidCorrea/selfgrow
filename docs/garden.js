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
export const SAVE_VERSION = 9;

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
 * much faster the garden grows per grown plant before milestones, and
 * `growSeconds` is how long its sprouts take to mature. `bestSeason` is the
 * season that kind thrives in and `seasonBoost` how much faster it grows there,
 * so the year keeps moving which seed is worth planting. Herb is the first kind
 * and keeps the numbers the garden always had, so an existing save, test or
 * habit still reads the same;
 * bloom costs more and earns more but matures slower, so neither kind dominates.
 */
export const SEED_KINDS = Object.freeze([
  Object.freeze({
    key: "herb",
    name: "herb",
    costBase: 5,
    costRate: 1.15,
    production: 0.5,
    growSeconds: 30,
    bestSeason: "spring",
    seasonBoost: 2,
  }),
  Object.freeze({
    key: "bloom",
    name: "bloom",
    costBase: 40,
    costRate: 1.15,
    production: 5,
    growSeconds: 45,
    bestSeason: "summer",
    seasonBoost: 2,
  }),
]);

/**
 * The grown-plant counts at which each kind's output doubles, one ladder per
 * kind in `SEED_KINDS` order. This is the nearer goal the garden always has: a
 * kind's next step is a handful of plants away rather than "one more",
 * whatever the garden has already grown. The two ladders sit at different
 * counts on purpose, so which seed is worth planting keeps changing as the
 * garden grows.
 */
export const KIND_MILESTONES = Object.freeze([
  Object.freeze([10, 25, 50]),
  Object.freeze([15, 30, 60]),
]);

/** How much a kind's output is multiplied by at each milestone it reaches. */
export const MILESTONE_MULTIPLIER = 2;

/** A whole plant count of 0 or more; anything else counts as none. */
function plantedCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * How much faster a kind produces once `plants` of it have grown: the milestone
 * multiplier raised to the number of that kind's milestones reached. Pure, so
 * the readout, the simulation and an agent's state cannot disagree about it. A
 * kind the garden does not know never earns a milestone.
 */
export function kindMilestoneMultiplier(index, plants) {
  const milestones = KIND_MILESTONES[index];
  if (!milestones) return 1;
  const count = plantedCount(plants);
  return MILESTONE_MULTIPLIER ** milestones.filter((step) => count >= step).length;
}

/**
 * The grown-plant count of `index`'s next milestone, or null once its ladder is
 * climbed. Pure: the readout names the same next step the simulation rewards.
 */
export function nextKindMilestone(index, plants) {
  const milestones = KIND_MILESTONES[index];
  if (!milestones) return null;
  const count = plantedCount(plants);
  return milestones.find((step) => count < step) ?? null;
}

/**
 * The extra growth per second the garden earns from the milestones its kinds
 * have already reached: each kind's grown plants times its production times the
 * multiplier it has earned above the base one.
 *
 * Derived from the plant counts alone, so a garden keeps its boost across a
 * reload or a return without any change to the save format — there is no
 * migration to write and no version to bump.
 */
export function milestoneBoost(plantCounts) {
  const counts = Array.isArray(plantCounts) ? plantCounts : [];
  return SEED_KINDS.reduce((total, kind, index) => {
    const plants = plantedCount(counts[index]);
    return total + plants * kind.production * (kindMilestoneMultiplier(index, plants) - 1);
  }, 0);
}

/**
 * How long the first kind's planted seed stays an ungrown sprout before it
 * becomes a grown plant. Growth comes from plants, not seeds, so this is the
 * wait between planting and the garden speeding up — the same wall-clock rule
 * the growth loop uses, so a return resolves several of these in one
 * calculation.
 */
export const GROW_SECONDS = SEED_KINDS[0].growSeconds;

/**
 * How long the one seed a fresh garden starts with takes to mature.
 *
 * Shorter than the herb kind's growing time on purpose: a first visit should
 * see the garden begin on its own within seconds rather than wait out a full
 * kind. It is the starter's own timer, so the herb kind's pace — and every save
 * that planted one — is unchanged.
 */
export const STARTING_GROW_SECONDS = 3;

/**
 * How often a pollinator can visit, how long each visit lasts, and how much
 * faster the garden grows while one stays. A visit is the last slice of each
 * cycle, so a garden that has just been planted waits before its first visitor
 * and the arrival is a small event rather than a permanent upgrade.
 *
 * A visit is longer when the plot holds grown blooms: each one keeps the
 * pollinator `POLLINATOR_BLOOM_VISIT_SECONDS` more, up to
 * `POLLINATOR_VISIT_MAX_SECONDS`. A garden with no blooms keeps exactly the
 * base visit, so blooms only ever add. The boost stays the same, so the reason
 * to plant a bloom is its longer visit rather than a bigger multiplier.
 *
 * The season sets both the cycle and the base visit — each entry in `SEASONS`
 * carries them — so the year is felt at the plot as well as in the growth
 * rate. Winter carries the constants below, the garden's unchanged base; the
 * other seasons set their own rhythm, and a visit only ever adds to the garden's
 * base growth, so no season's schedule can slow it below that base.
 */
export const POLLINATOR_CYCLE_SECONDS = 180;
export const POLLINATOR_VISIT_SECONDS = 60;
export const POLLINATOR_BOOST = 2;
/** How much longer each grown bloom keeps the pollinator on the plot. */
export const POLLINATOR_BLOOM_VISIT_SECONDS = 10;
/** The longest a visit can stretch, however many blooms a garden holds. */
export const POLLINATOR_VISIT_MAX_SECONDS = 150;

/** Bare soil, one bed of it, and one ungrown starter seed. */
export function newGarden() {
  return {
    version: SAVE_VERSION,
    seeds: 1,
    plants: 0,
    beds: 1,
    sprouts: [STARTING_GROW_SECONDS],
    visit: emptyVisit(),
  };
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
 * A fresh visit record: the visitor has just arrived, so nothing has lasted
 * and nothing has been done by hand yet.
 */
function emptyVisit() {
  return { seconds: 0, sown: 0, tended: 0 };
}

/**
 * The visit record a garden carries, kept to a finite duration and whole
 * counts of zero or more. Anything missing, negative or not a number reads as
 * the zero it never was, so a garden that never knew about the visit opens
 * with an empty one rather than as `NaN`.
 */
function visitOrZero(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    seconds: amountOrZero(source.seconds),
    sown: plantedCount(source.sown),
    tended: plantedCount(source.tended),
  };
}

/**
 * The visit record a save carries, or an empty one when it does not say.
 *
 * A field that is present must be a finite number: the seconds lasted are of
 * zero or more, and the two counts are whole numbers of zero or more. A
 * negative, fractional or non-numeric field is refused with a reason, the same
 * way the age and the bonus are, because it would state a visit that never
 * happened.
 */
function readVisit(parsed) {
  if (parsed.visit === undefined || parsed.visit === null) return emptyVisit();
  const visit = parsed.visit;
  if (typeof visit !== "object" || Array.isArray(visit)) {
    throw new Error(
      `the save's visit must be an object of seconds, sown and tended, but it is ${JSON.stringify(visit)}.`
    );
  }
  const seconds = visit.seconds === undefined || visit.seconds === null ? 0 : visit.seconds;
  const sown = visit.sown === undefined || visit.sown === null ? 0 : visit.sown;
  const tended = visit.tended === undefined || visit.tended === null ? 0 : visit.tended;
  assertAmount(seconds, "visit seconds");
  assertCount(sown, "visit sown");
  assertCount(tended, "visit tended");
  return { seconds, sown, tended };
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
    bonus: amountOrZero(source.bonus),
    beds,
    visit: visitOrZero(source.visit),
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
 * growth it currently holds, so nothing already earned is forgotten. Version 8
 * added the lasting bonus a replant earns; an older save was never replanted,
 * so it opens with no bonus. Version 9 added the record of the visitor's own
 * visit; an older save opens with an empty one, nothing lasted and nothing
 * done by hand.
 *
 * @returns {{version: number, seeds: number, plants: number, sprouts: number[], bloomSprouts: number[], plantCounts: number[], growth: number, rate: number, age: number, lifetime: number, bonus: number, beds: number, visit: {seconds: number, sown: number, tended: number}}}
 * @throws {Error} when the text is empty, not a selfgrow save, damaged,
 *   the wrong version, or carries a bad plot count, growth, rate, age,
 *   lifetime or bonus.
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
  // Before version 8 there was no lasting bonus. An older save was never
  // replanted, so it opens with the bonus it never earned.
  const bonus = parsed.version < 8 ? 0 : readBonus(parsed);
  // Before version 9 there was no record of the visitor's own visit. An older
  // save opens with an empty one — nothing lasted, nothing done by hand — so
  // nothing the visitor did not do is invented for it.
  const visit = parsed.version < 9 ? emptyVisit() : readVisit(parsed);
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
    bonus,
    beds,
    visit,
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

/**
 * The lasting bonus a save carries, zero or more growth per second. A save that
 * does not say opens with no bonus; a negative or non-finite one is refused
 * with a reason, because it would slow the garden below its earned rate.
 */
function readBonus(parsed) {
  if (parsed.bonus === undefined || parsed.bonus === null) return 0;
  assertAmount(parsed.bonus, "bonus");
  return parsed.bonus;
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
  sprouts: [STARTING_GROW_SECONDS],
  plants: 0,
  bloomSprouts: [],
  bloomPlants: 0,
  beds: 1,
  visit: emptyVisit(),
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
 * `getGrowthState`), and `visit` is the record of the visitor's own hand-work
 * this visit: how long it has lasted and how many plots they sowed and tended.
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
    visit: visitOrZero(garden.visit),
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
  // The visit record is preserved when the caller does not speak of it — a
  // return's partial state, for one — so a return never wipes what the visitor
  // did. A caller that passes its own record (a fresh garden's zeros, or a
  // loaded save's) states it outright.
  const visit = next.visit === undefined ? visitOrZero(garden.visit) : visitOrZero(next.visit);
  garden = {
    version: SAVE_VERSION,
    sprouts: herb.growing,
    plants: herbPlants,
    bloomSprouts: bloom.growing,
    bloomPlants,
    beds,
    visit,
  };
  notify();
}

/**
 * Add `seconds` to how long this visit has lasted. The visit is only ever
 * lengthened: a missing, zero or negative span adds nothing. It does not
 * notify, because the tick that calls it advances the garden just afterwards
 * and that advance redraws the readout.
 *
 * @returns {{seconds: number, sown: number, tended: number}} the visit record.
 */
export function addVisitTime(seconds) {
  const span = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const visit = visitOrZero(garden.visit);
  if (span === 0) return visit;
  garden = { ...garden, visit: { ...visit, seconds: visit.seconds + span } };
  return { ...garden.visit };
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

/**
 * How much faster the garden grows for each second someone is at the page.
 *
 * A flat, always-on bonus: presence itself tends the garden, so two minutes
 * watched end larger than two minutes left alone. It is added to the earned
 * rate after the season and pollinator integration, so it is the same in every
 * season, and it stops the instant the visit does — the garden's own rate and
 * its away growth are untouched, so an absence is never punished.
 */
export const PRESENCE_BONUS = 0.5;

/**
 * The growth per second the garden earns for someone being at the page: the
 * fixed bonus while present and nothing while the visit is over.
 *
 * Pure, so the readout, the live tick and an agent's state all read the one
 * rule and cannot disagree about what presence is worth.
 */
export function presenceBonus(present) {
  return present === true ? PRESENCE_BONUS : 0;
}

let growth = 0;
let rate = 0;
let age = 0;
let lifetime = 0;
// The lasting bonus a replant has earned, in growth/second. It is added flat to
// the rate the garden grows at, and unlike the spent balance it is kept across
// a replant: it is the one thing a fresh run starts with that the first run did
// not have.
let bonus = 0;

/**
 * The live growth since this visit began, its rate in growth/second, the
 * garden's age in seconds of elapsed time, the growth it has produced over its
 * whole life, and the lasting bonus a replant has earned. Age is what a
 * pollinator's schedule is read from, so it is kept beside the growth rather
 * than derived from a foreground timer: a hidden tab still ages the garden.
 * Lifetime is kept the same way, so the garden's whole history is not something
 * a visitor could lose by not watching. The bonus is kept here so offline time,
 * the sandbox and the live tick all add it the same way.
 */
export function getGrowthState() {
  return { growth, rate, age, lifetime, bonus };
}

/**
 * Put the live growth back to a known point — the snapshot a caller took. Out
 * of range or missing values fall back to nothing grown rather than to `NaN`,
 * a missing age restarts at zero rather than leaving the clock somewhere
 * unknown, a missing lifetime starts the garden's history at nothing, and a
 * missing bonus starts the fresh run with no lasting head start.
 */
export function setGrowth(growthValue, rateValue = 0, ageValue = 0, lifetimeValue = 0, bonusValue = 0) {
  growth = Number.isFinite(growthValue) && growthValue > 0 ? growthValue : 0;
  rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 0;
  age = Number.isFinite(ageValue) && ageValue > 0 ? ageValue : 0;
  lifetime = Number.isFinite(lifetimeValue) && lifetimeValue > 0 ? lifetimeValue : 0;
  bonus = Number.isFinite(bonusValue) && bonusValue > 0 ? bonusValue : 0;
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

/**
 * The bonus a garden must already be worth for a replant to be offered.
 *
 * A wall, not a gate: the garden reaches it when its lifetime hits 100 — the
 * `a bed of seedlings` form — so a replant is offered once the garden is
 * flourishing and never before. A garden below it has nothing worth carrying.
 */
export const REPLANT_MIN_BONUS = 10;

/**
 * Whether the garden has grown far enough to be replanted. Pure: the page, the
 * button and an agent's state all read the same wall from here.
 */
export function canReplant(lifetimeGrowth = lifetime) {
  return replantBonus(lifetimeGrowth) >= REPLANT_MIN_BONUS;
}

/**
 * Replant the garden: start a fresh one whose growth rate carries the lasting
 * bonus it has earned from its whole life.
 *
 * The soil, seeds, plants, beds, current growth, rate and age all start over,
 * while the lifetime growth and the save are kept and the bonus becomes the
 * part of the rate the new run keeps. Refuses with a reason, changing nothing,
 * while the garden is below `REPLANT_MIN_BONUS` — a replant before the wall
 * would trade a run's work for nothing, so it is never offered or performed.
 *
 * @returns {{ok: boolean, reason: string|null, bonus: number, lifetime: number}}
 */
export function replant() {
  const earned = replantBonus(lifetime);
  if (earned < REPLANT_MIN_BONUS) {
    return { ok: false, reason: "not enough lifetime growth", bonus: earned, lifetime };
  }
  const keptLifetime = lifetime;
  // A fresh garden object, wound back to its first sprout, with the growth
  // loop reset and the lifetime carried over — the same shape `newGarden`
  // gives, so a replant and a first visit start identically.
  setGarden(newGarden());
  setGrowth(0, 0, 0, keptLifetime, earned);
  writeStoredGarden(garden);
  return { ok: true, reason: null, bonus: earned, lifetime: keptLifetime };
}

// --- The visiting pollinator -------------------------------------------------
//
// A pollinator is not a resource the visitor spends or loses: it is derived
// from the garden's age, the same way growth is derived from elapsed time, so
// a tab that was hidden or a device that slept sees exactly the visit a watched
// garden would. It only visits a garden with something grown in it, and it is
// the last slice of each cycle, so a fresh garden waits for its first visitor.
//
// The season sets how often it comes and how long it stays, so the same garden
// behaves differently in spring and in autumn. Winter carries the base schedule,
// and a visit only ever adds to the garden's own growth, so no season's rhythm
// can make the garden grow slower than its base rate.

/** The season a key names, or winter — the base schedule — for anything else. */
function seasonDescriptor(seasonKey) {
  return SEASONS.find((season) => season.key === seasonKey) || SEASONS[0];
}

/** How many seconds apart the season's pollinator visits come. */
export function pollinatorCycleSeconds(seasonKey) {
  return seasonDescriptor(seasonKey).pollinatorCycleSeconds;
}

/** The visit a garden with no blooms keeps in the season. */
export function pollinatorBaseVisitSeconds(seasonKey) {
  return seasonDescriptor(seasonKey).pollinatorBaseVisitSeconds;
}

/** How many blooms it takes to stretch the season's visit to the cap. */
function bloomsToMaxVisit(seasonKey) {
  const baseVisit = pollinatorBaseVisitSeconds(seasonKey);
  return Math.max(0, Math.floor((POLLINATOR_VISIT_MAX_SECONDS - baseVisit) / POLLINATOR_BLOOM_VISIT_SECONDS));
}

/**
 * How long a visit lasts in `seasonKey` when `bloomPlants` grown blooms are
 * keeping the pollinator. The season's base visit plus each bloom's extension,
 * never past the cap, so a bed of blooms keeps the visitor for most of the
 * season's cycle and no garden grows a visit without bound.
 *
 * Pure: the readout, the picture, the simulation and an agent's state all read
 * the visit length from here. A missing season is winter, the garden's base.
 */
export function pollinatorVisitSeconds(bloomPlants, seasonKey) {
  const blooms = Number.isFinite(bloomPlants) && bloomPlants > 0 ? Math.floor(bloomPlants) : 0;
  return Math.min(
    POLLINATOR_VISIT_MAX_SECONDS,
    pollinatorBaseVisitSeconds(seasonKey) + blooms * POLLINATOR_BLOOM_VISIT_SECONDS
  );
}

/**
 * Whether a pollinator is visiting a garden `ageSeconds` old that holds
 * `plants` grown plants — `bloomPlants` of them blooms that lengthen the
 * visit — and how much faster the garden grows while it stays.
 *
 * Pure and deterministic: the same age, plants and blooms always answer the
 * same, so the readout, the picture and the simulated growth cannot disagree
 * about it. The season the age falls in sets how often the visitor comes
 * (`cycleSeconds`) and the visit a garden with no blooms keeps
 * (`baseVisitSeconds`); `visitSeconds` is how long this visit lasts and
 * `bloomsKeeping` how many blooms are stretching it, capped at the number that
 * reaches the cap.
 *
 * @returns {{visiting: boolean, multiplier: number, boost: number, visitSeconds: number, cycleSeconds: number, baseVisitSeconds: number, maxVisitSeconds: number, seasonKey: string, bloomsKeeping: number}}
 */
export function pollinatorAt(ageSeconds, plants, bloomPlants = 0) {
  const grown = Number.isFinite(plants) && plants > 0;
  const gardenAge = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0;
  const season = seasonAt(gardenAge);
  const cycleSeconds = season.pollinatorCycleSeconds;
  const baseVisitSeconds = season.pollinatorBaseVisitSeconds;
  const visitSeconds = pollinatorVisitSeconds(bloomPlants, season.key);
  const phase = gardenAge % cycleSeconds;
  const visiting = grown && phase >= cycleSeconds - visitSeconds;
  const blooms = Number.isFinite(bloomPlants) && bloomPlants > 0 ? Math.floor(bloomPlants) : 0;
  return {
    visiting,
    multiplier: visiting ? POLLINATOR_BOOST : 1,
    boost: POLLINATOR_BOOST,
    visitSeconds,
    cycleSeconds,
    baseVisitSeconds,
    maxVisitSeconds: POLLINATOR_VISIT_MAX_SECONDS,
    seasonKey: season.key,
    bloomsKeeping: Math.min(blooms, bloomsToMaxVisit(season.key)),
  };
}

/**
 * The visit seconds seen from the garden's start up to `seconds` of age, for a
 * fixed cycle and visit.
 */
function visitingSecondsUpTo(seconds, cycleSeconds, visitSeconds) {
  if (!(seconds > 0)) return 0;
  const cycles = Math.floor(seconds / cycleSeconds);
  const phase = seconds - cycles * cycleSeconds;
  const visitStart = cycleSeconds - visitSeconds;
  const partial = Math.min(visitSeconds, Math.max(0, phase - visitStart));
  return cycles * visitSeconds + partial;
}

/**
 * The visit seconds between `start` and `end` of garden age, walked one season
 * at a time. Inside each season the cycle and visit are constant, so the visit
 * seconds are the difference of the cumulative count at the two ends. A span
 * of one year's pattern or less holds only a handful of seasons, so the walk is
 * cheap and never runs for as long as the span.
 */
function pollinatorSecondsBetween(start, end, bloomPlants) {
  let cursor = start;
  let total = 0;
  while (cursor < end) {
    const season = seasonAt(cursor);
    const nextBoundary = (Math.floor(cursor / SEASON_SECONDS) + 1) * SEASON_SECONDS;
    // A span shorter than the rest of its season, or an age so large the next
    // boundary rounds back onto the cursor, ends the segment here rather than
    // stalling the walk.
    const segmentEnd = nextBoundary > cursor && nextBoundary < end ? nextBoundary : end;
    const cycleSeconds = season.pollinatorCycleSeconds;
    const visitSeconds = pollinatorVisitSeconds(bloomPlants, season.key);
    total +=
      visitingSecondsUpTo(segmentEnd, cycleSeconds, visitSeconds) -
      visitingSecondsUpTo(cursor, cycleSeconds, visitSeconds);
    cursor = segmentEnd;
  }
  return total;
}

/** The largest whole number that divides both of two whole numbers (Euclid). */
function greatestCommonDivisor(a, b) {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * The span after which the pollinator's whole schedule repeats: the common
 * multiple of every season's cycle and of one turn of the seasons, so the
 * visitor is in the same season, the same way through its cycle, at both ends
 * of it. Cached, since the seasons are fixed.
 */
let pollinatorPeriodCache = null;
function pollinatorPeriodSeconds() {
  if (pollinatorPeriodCache === null) {
    let period = SEASON_SECONDS * SEASONS.length;
    for (const season of SEASONS) {
      period =
        (period / greatestCommonDivisor(period, season.pollinatorCycleSeconds)) * season.pollinatorCycleSeconds;
    }
    pollinatorPeriodCache = period;
  }
  return pollinatorPeriodCache;
}

/**
 * How many of the `spanSeconds` starting at `ageSeconds` of garden age fall
 * inside a pollinator visit, for a garden with grown plants that holds
 * `bloomPlants` blooms lengthening each visit.
 *
 * Exact across season boundaries, and bounded: the schedule repeats after one
 * whole-year pattern, so whole patterns are counted in one multiplication and
 * only the tail is walked season by season. That matches a played-by-play
 * simulation second for second, so a rehearsal, a return and played time all
 * land in the same place, and even an enormous span costs only a few seasons of
 * work. The visit length is constant across the span because the bloom count
 * does not change inside it: the simulation winds forward one maturation gap at
 * a time, so each call sees one bloom count. A missing, negative or non-finite
 * span is no visit time.
 */
export function pollinatorSecondsWithin(ageSeconds, spanSeconds, bloomPlants = 0) {
  if (!Number.isFinite(ageSeconds) || !Number.isFinite(spanSeconds) || spanSeconds <= 0) return 0;
  const start = ageSeconds > 0 ? ageSeconds : 0;
  const end = start + spanSeconds;
  const period = pollinatorPeriodSeconds();
  const patterns = Math.floor(spanSeconds / period);
  let total = patterns * pollinatorSecondsBetween(0, period, bloomPlants);
  const tailStart = start + patterns * period;
  if (tailStart < end) total += pollinatorSecondsBetween(tailStart, end, bloomPlants);
  return total;
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
 * each season's name, growth multiplier and pollinator schedule. Winter is the
 * base rate and the base pollinator cycle and visit, and every entry carries the
 * rhythm the year gives the pollinator.
 */
export const SEASONS = Object.freeze([
  Object.freeze({
    key: "winter",
    name: "winter",
    multiplier: 1,
    pollinatorCycleSeconds: POLLINATOR_CYCLE_SECONDS,
    pollinatorBaseVisitSeconds: POLLINATOR_VISIT_SECONDS,
  }),
  Object.freeze({
    key: "spring",
    name: "spring",
    multiplier: 1.5,
    pollinatorCycleSeconds: 200,
    pollinatorBaseVisitSeconds: 90,
  }),
  Object.freeze({
    key: "summer",
    name: "summer",
    multiplier: 2,
    pollinatorCycleSeconds: 240,
    pollinatorBaseVisitSeconds: 120,
  }),
  Object.freeze({
    key: "autumn",
    name: "autumn",
    multiplier: 1.25,
    pollinatorCycleSeconds: 300,
    pollinatorBaseVisitSeconds: 75,
  }),
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
 * @returns {{index: number, key: string, name: string, multiplier: number, pollinatorCycleSeconds: number, pollinatorBaseVisitSeconds: number}}
 */
export function seasonAt(ageSeconds) {
  const gardenAge = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0;
  const index = Math.floor(gardenAge / SEASON_SECONDS) % SEASONS.length;
  const season = SEASONS[index];
  return {
    index,
    key: season.key,
    name: season.name,
    multiplier: season.multiplier,
    pollinatorCycleSeconds: season.pollinatorCycleSeconds,
    pollinatorBaseVisitSeconds: season.pollinatorBaseVisitSeconds,
  };
}

/**
 * A kind's own growth boost in one season: its `seasonBoost` while that season
 * is its best and the neutral 1 the rest of the year. Pure, so the readout, the
 * simulation and an agent's state cannot disagree about whether a kind is
 * thriving. An unknown kind or season is never a boost.
 */
export function kindSeasonMultiplier(kindIndex, seasonKey) {
  const kind = SEED_KINDS[kindIndex];
  return kind && seasonKey === kind.bestSeason ? kind.seasonBoost : 1;
}

/** The four seasons' shared multipliers in cycle order, as a plain array. */
const SEASON_MULTIPLIERS = SEASONS.map((season) => season.multiplier);

/**
 * Each kind's own season multipliers in cycle order: the season's shared
 * multiplier, times the kind's `seasonBoost` in the one season it thrives in.
 * A kind outside its best season keeps the shared multiplier exactly, so the
 * year adds a preference and never a punishment: no entry is below the shared
 * schedule it is compared against.
 */
const KIND_SEASON_MULTIPLIERS = SEED_KINDS.map((_kind, index) =>
  SEASONS.map((season) => season.multiplier * kindSeasonMultiplier(index, season.key))
);

/** One full turn of a per-season multiplier array's weighted seconds. */
function cycleWeightedSeconds(multipliers) {
  return SEASON_SECONDS * multipliers.reduce((sum, multiplier) => sum + multiplier, 0);
}

/** The weighted seconds a per-season multiplier array has up to `seconds`. */
function weightedSecondsUpTo(seconds, multipliers) {
  if (!(seconds > 0)) return 0;
  const cycleSeconds = SEASON_SECONDS * multipliers.length;
  const cycles = Math.floor(seconds / cycleSeconds);
  const phase = seconds - cycles * cycleSeconds;
  let total = cycles * cycleWeightedSeconds(multipliers);
  const wholeSeasons = Math.floor(phase / SEASON_SECONDS);
  for (let index = 0; index < wholeSeasons; index += 1) total += multipliers[index] * SEASON_SECONDS;
  return total + (phase - wholeSeasons * SEASON_SECONDS) * multipliers[wholeSeasons];
}

/** The weighted seconds a per-season multiplier array sees within an age span. */
function weightedSecondsWithin(ageSeconds, spanSeconds, multipliers) {
  if (!Number.isFinite(ageSeconds) || !Number.isFinite(spanSeconds) || spanSeconds <= 0) return 0;
  const start = ageSeconds > 0 ? ageSeconds : 0;
  return weightedSecondsUpTo(start + spanSeconds, multipliers) - weightedSecondsUpTo(start, multipliers);
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
  return weightedSecondsWithin(ageSeconds, spanSeconds, SEASON_MULTIPLIERS);
}

/**
 * Tend the soil: earn growth now, and raise the rate the garden grows at so the
 * number keeps climbing afterwards. Returns the state after the action.
 */
export function tend() {
  growth += TEND_YIELD;
  rate += TEND_RATE_STEP;
  lifetime += TEND_YIELD;
  // The visitor tended the soil by hand, so the visit records it. This is the
  // live action only: `tendInState` is the pure rehearsal and never reaches here.
  const visit = visitOrZero(garden.visit);
  garden = { ...garden, visit: { ...visit, tended: visit.tended + 1 } };
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
 * or `plants`/`bloomPlants`), and the result reports each kind in `plantCounts`
 * with `plants` as the total across both — the same meaning `getGarden` gives
 * it — so any caller can run a span against a copy without touching the live
 * garden, and no caller can read one kind's count as the whole garden's. That
 * is how the sandbox rehearses time. The span is walked by jumping to the next seed
 * that matures, so a month resolves in at most one step per plot rather than
 * one per tick, and a rehearsal lands exactly where played time would, with no
 * cap on how long the span was. A zero, negative or non-finite span grows
 * nothing, and a state missing a field reads as a garden that never grew.
 *
 * A third `options` argument may carry `sow: true`, which makes the garden
 * spend the growth it earns on the cheapest kind's seed: at the top of every
 * pass, and once more after the last earning, it sows a herb seed into each
 * free plot it can afford and lets it mature on the same clock as any other.
 * That is what turns an absence into a garden that has visibly grown rather
 * than only a bigger number. Sowing is off by default — the live tick leaves
 * the planting to the visitor — and only ever sows the cheapest kind, so a
 * bloom stays the visitor's choice. Every sown seed is paid for out of the
 * growth balance and reported back as `sown` and `sownCost`, so a caller can
 * account for exactly what was produced and what was spent.
 *
 * The same `options` argument may carry `present: true`, which adds the
 * presence bonus to the growth the garden earns over the span. Only the live
 * tick passes it — a rehearsal, an absence and a return all leave it out, so
 * what the garden grows while nobody is at the page is unchanged. It is added
 * flat, after the season and pollinator integration, so a watched second is
 * worth the same bonus in every season.
 *
 * Pure: it never notifies, never writes, and never touches the live garden.
 */
export function simulateGarden(state, seconds, options = {}) {
  const sow = options.sow === true;
  const present = options.present === true;
  const source = state ?? {};
  const beds = bedCount(source.beds);
  const capacity = beds * PLOTS_PER_BED;
  let growth = amountOrZero(source.growth);
  let rate = amountOrZero(source.rate);
  let age = Number.isFinite(source.age) && source.age > 0 ? source.age : 0;
  const bonus = amountOrZero(source.bonus);
  let sprouts = kindSproutTimers(source, 0, capacity);
  let bloomSprouts = kindSproutTimers(source, 1, capacity);
  let herbPlants = wholeCount(plantsForKind(source, 0), Number.MAX_SAFE_INTEGER);
  let bloomPlants = wholeCount(plantsForKind(source, 1), Number.MAX_SAFE_INTEGER);
  // What an absence sowed into the free plots, and what those seeds cost out of
  // the growth, so a return can account for both.
  let sown = 0;
  let sownCost = 0;

  // `plants` is the grown-plant total across both kinds, the same meaning
  // `getGarden` and `decodeSave` give it; the per-kind counts live only in
  // `plantCounts` (and `bloomPlants` for the second kind), so no consumer can
  // read one kind's count as the whole garden's.
  const result = () => ({
    growth,
    rate,
    bonus,
    sprouts,
    bloomSprouts,
    plants: herbPlants + bloomPlants,
    bloomPlants,
    plantCounts: [herbPlants, bloomPlants],
    beds,
    age,
    sown,
    sownCost,
  });

  if (!(Number.isFinite(seconds) && seconds > 0)) return result();

  /**
   * Spend the growth balance on the cheapest kind wherever a plot is free.
   * Only the first kind is ever sown, so choosing a bloom stays the visitor's
   * decision, and a full plot sows nothing and keeps banking its growth.
   */
  const sowHerbs = () => {
    while (
      sprouts.length + bloomSprouts.length + herbPlants + bloomPlants < capacity &&
      growth >= nextSeedCost(sprouts.length + herbPlants, 0)
    ) {
      const cost = nextSeedCost(sprouts.length + herbPlants, 0);
      growth -= cost;
      sown += 1;
      sownCost += cost;
      sprouts = [...sprouts, SEED_KINDS[0].growSeconds];
    }
  };

  // Each pass matures at least one seed or reaches the moment the next seed can
  // be paid for, and sowing adds at most one seed per plot, so the passes stay
  // bounded by the plots.
  const maxPasses = 2 * capacity + sprouts.length + bloomSprouts.length + 2;
  const hasFreePlot = () => sprouts.length + bloomSprouts.length + herbPlants + bloomPlants < capacity;
  let remaining = seconds;
  for (let pass = 0; remaining > 0 && pass <= maxPasses; pass += 1) {
    // Sow before this pass's earning so a seed planted early has time to
    // mature, and a balance that was already affordable is spent at once.
    if (sow) sowHerbs();
    // Each kind's grown plants carry a milestone multiplier, and the boost it
    // earns is real growth rather than a display figure: it is added to this
    // pass's base rate. The counts are constant across the pass, so both the
    // boost and the corrections below integrate in closed form, and a
    // maturation that crosses a milestone steps the rate up on the next pass.
    const herbMultiplier = kindMilestoneMultiplier(0, herbPlants);
    const bloomMultiplier = kindMilestoneMultiplier(1, bloomPlants);
    const boost =
      herbPlants * SEED_KINDS[0].production * (herbMultiplier - 1) +
      bloomPlants * SEED_KINDS[1].production * (bloomMultiplier - 1);
    const nextHerb = sprouts.length ? Math.min(...sprouts) : Infinity;
    const nextBloom = bloomSprouts.length ? Math.min(...bloomSprouts) : Infinity;
    let gap = Math.min(remaining, nextHerb, nextBloom);
    // While there is a plot to sow and the balance is short, wind only as far
    // as the next seed becomes affordable so it still has time to grow. The
    // base rate is a safe lower bound on what the garden earns — every season,
    // kind correction and milestone only adds — so this never spends before
    // the balance can pay, and the final sow below catches a balance that only
    // arrives at the very end.
    if (sow && hasFreePlot() && growth < nextSeedCost(sprouts.length + herbPlants, 0)) {
      const deficit = nextSeedCost(sprouts.length + herbPlants, 0) - growth;
      const baseRate = rate + bonus + boost;
      if (baseRate > 0) gap = Math.min(gap, (deficit / baseRate) * 1.001 + 1e-9);
    }
    const visited = herbPlants + bloomPlants > 0 ? pollinatorSecondsWithin(age, gap, bloomPlants) : 0;
    // The shared season's multipliers are integrated over the gap and the
    // pollinator's extra seconds are added, not multiplied, so both stay closed
    // form and the age carries into the next pass. The lasting bonus and the
    // milestone boost are added flat to the earned rate, so they earn the same
    // way played time does.
    const sharedWeighted = weightedSecondsWithin(age, gap, SEASON_MULTIPLIERS);
    growth += (rate + bonus + boost) * (sharedWeighted + (POLLINATOR_BOOST - 1) * visited);
    // Each kind's own season schedule then corrects its share of the rate up to
    // its boost in its best season — and never down, since a kind's schedule is
    // never below the shared one. The share is itself lifted by the kind's
    // milestone multiplier, so its best season rewards the milestones too.
    growth +=
      herbPlants * SEED_KINDS[0].production * herbMultiplier *
        (weightedSecondsWithin(age, gap, KIND_SEASON_MULTIPLIERS[0]) - sharedWeighted) +
      bloomPlants * SEED_KINDS[1].production * bloomMultiplier *
        (weightedSecondsWithin(age, gap, KIND_SEASON_MULTIPLIERS[1]) - sharedWeighted);
    // The presence bonus is a flat term over the whole gap, so a watched second
    // is worth the same in every season. An absent span earns nothing from it.
    growth += presenceBonus(present) * gap;
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
  // One last sow once the earning stops, so a balance that only became
  // affordable at the very end still buys the seeds it can.
  if (sow) sowHerbs();
  return result();
}

/**
 * Let the live garden grow for `seconds`, and let every seed that is due mature.
 *
 * A thin wrapper over `simulateGarden`: the live garden is wound forward with
 * the same rule a rehearsal or a return uses, so nothing can disagree about how
 * time changes the garden. `options.present` is forwarded unchanged, so only a
 * caller that watched the span earns the presence bonus.
 */
export function advance(seconds, options) {
  const next = simulateGarden(
    {
      growth,
      rate,
      age,
      bonus,
      sprouts: garden.sprouts,
      bloomSprouts: garden.bloomSprouts,
      plantCounts: [garden.plants, garden.bloomPlants],
      beds: garden.beds,
    },
    seconds,
    options
  );
  // Everything the garden earned over the span is added to its lifetime, so
  // the total it can never spend counts exactly the growth that arrived.
  lifetime += Math.max(0, next.growth - growth);
  growth = next.growth;
  rate = next.rate;
  age = next.age;
  bonus = next.bonus;
  // The live garden keeps each kind's grown plants apart (`plants` is the
  // first kind), while the simulation's result carries the total in `plants`,
  // so read the per-kind counts back out of `plantCounts`.
  garden = {
    ...garden,
    sprouts: next.sprouts,
    plants: next.plantCounts[0],
    bloomSprouts: next.bloomSprouts,
    bloomPlants: next.plantCounts[1],
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
 * ungrown and how many plants are grown, how long its sprouts take and how
 * much they produce, and the milestone ladder that lifts that production. Pure,
 * so the readout, the goal and an agent's state cannot disagree about a kind.
 */
export function gardenKinds(garden) {
  const source = garden ?? {};
  const capacity = Number.isInteger(source.capacity) ? source.capacity : Number.MAX_SAFE_INTEGER;
  return SEED_KINDS.map((entry, index) => {
    const seeds = kindSeedCount(source, index, capacity);
    const plants = wholeCount(plantsForKind(source, index), Number.MAX_SAFE_INTEGER);
    const planted = seeds + plants;
    const milestoneMultiplier = kindMilestoneMultiplier(index, plants);
    const nextMilestone = nextKindMilestone(index, plants);
    return {
      index,
      key: entry.key,
      name: entry.name,
      seeds,
      plants,
      total: planted,
      growSeconds: entry.growSeconds,
      production: entry.production,
      // What one grown plant actually earns right now: the kind's production
      // lifted by the milestones its plant count has already reached. The next
      // step of the ladder and how many more plants it needs are beside it, so
      // a kind always has a goal nearer than "one more".
      output: entry.production * milestoneMultiplier,
      milestoneMultiplier,
      nextMilestone,
      plantsToMilestone: nextMilestone === null ? null : nextMilestone - plants,
      cost: nextSeedCost(planted, index),
      sproutTimers: kindSproutTimers(source, index, capacity),
    };
  });
}

/**
 * The live garden as the plain state `simulateGarden` reads and returns.
 *
 * The live actions and a rehearsal then run the same rules against the same
 * shape, so planting in the sandbox cannot drift from planting for real. Pure
 * in the sense that it reads the live numbers and copies nothing the caller
 * could mutate back.
 */
function liveGardenState() {
  return {
    growth,
    rate,
    age,
    bonus,
    sprouts: garden.sprouts,
    bloomSprouts: garden.bloomSprouts ?? [],
    plantCounts: [garden.plants, garden.bloomPlants ?? 0],
    beds: garden.beds,
  };
}

/** How many seeds and plants of both kinds fill a state's `beds` of soil. */
function plantedInState(state, capacity) {
  return SEED_KINDS.reduce(
    (sum, _entry, i) =>
      sum + kindSeedCount(state, i, capacity) + wholeCount(plantsForKind(state, i), Number.MAX_SAFE_INTEGER),
    0
  );
}

/**
 * Tend a garden state's soil: add `TEND_YIELD` growth and `TEND_RATE_STEP` to
 * its rate. Pure — a rehearsal tends its own copy, while the live `tend` keeps
 * raising the garden's lifetime beside it.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number, state: object}}
 */
export function tendInState(state) {
  const source = state ?? {};
  return {
    ok: true,
    reason: null,
    cost: 0,
    state: {
      ...source,
      growth: amountOrZero(source.growth) + TEND_YIELD,
      rate: amountOrZero(source.rate) + TEND_RATE_STEP,
    },
  };
}

/**
 * Plant a seed of `kind` into a garden state, spending its growth under the
 * same rules the live `plantSeed` applies: the same cost, capacity and refusal
 * order. Pure — a refusal returns the state unchanged with the reason, and a
 * rehearsal's planting never reaches the real garden or its save.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number, kind: string, state: object}}
 */
export function plantSeedInState(state, kind = 0) {
  const source = state ?? {};
  const index = kindIndex(kind);
  const entry = SEED_KINDS[index];
  const capacity = bedCount(source.beds) * PLOTS_PER_BED;
  const plantsOfKind = wholeCount(plantsForKind(source, index), Number.MAX_SAFE_INTEGER);
  const plantedOfKind = kindSeedCount(source, index, capacity) + plantsOfKind;
  const totalPlanted = plantedInState(source, capacity);
  const growthOf = amountOrZero(source.growth);
  const cost = nextSeedCost(plantedOfKind, index);
  if (totalPlanted >= capacity) {
    return { ok: false, reason: "the plot is full", cost, kind: entry.key, state: source };
  }
  if (growthOf < cost) {
    return { ok: false, reason: "not enough growth", cost, kind: entry.key, state: source };
  }
  const field = index === 0 ? "sprouts" : "bloomSprouts";
  const timers = Array.isArray(source[field]) ? source[field] : [];
  return {
    ok: true,
    reason: null,
    cost,
    kind: entry.key,
    state: { ...source, growth: growthOf - cost, [field]: [...timers, entry.growSeconds] },
  };
}

/**
 * Open the next bed in a garden state, spending its growth under the same rules
 * the live `openBed` applies: refused while any plot still has room, then only
 * when the growth can pay. Pure; a refusal returns the state unchanged.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number, beds: number, state: object}}
 */
export function openBedInState(state) {
  const source = state ?? {};
  const beds = bedCount(source.beds);
  const capacity = beds * PLOTS_PER_BED;
  const planted = plantedInState(source, capacity);
  const growthOf = amountOrZero(source.growth);
  const cost = nextBedCost(beds);
  if (planted < capacity) {
    return { ok: false, reason: "the plot still has room", cost, beds, state: source };
  }
  if (growthOf < cost) {
    return { ok: false, reason: "not enough growth", cost, beds, state: source };
  }
  return {
    ok: true,
    reason: null,
    cost,
    beds: beds + 1,
    state: { ...source, growth: growthOf - cost, beds: beds + 1 },
  };
}

/**
 * Plant a seed of `kind` (herb by default): spend growth for it, and put a
 * sprouting seed in the soil that will become a grown plant after that kind's
 * growing time. The rate does not change yet — it rises when the seed matures.
 * Refuses with a reason when the plot is full or the garden has not saved enough
 * growth, and changes nothing when it refuses. This is `plantSeedInState`
 * applied to the live garden and written back, so the rules have one home.
 *
 * @returns {{ok: boolean, reason: string|null, cost: number, kind: string}}
 */
export function plantSeed(kind = 0) {
  const result = plantSeedInState(liveGardenState(), kind);
  if (!result.ok) {
    return { ok: false, reason: result.reason, cost: result.cost, kind: result.kind };
  }
  growth = result.state.growth;
  const index = kindIndex(result.kind);
  // The visitor sowed this plot by hand, so the visit records it. Only the live
  // action counts: `plantSeedInState` is the pure rehearsal and never reaches here.
  const visit = visitOrZero(garden.visit);
  garden = {
    ...garden,
    ...(index === 0 ? { sprouts: result.state.sprouts } : { bloomSprouts: result.state.bloomSprouts }),
    visit: { ...visit, sown: visit.sown + 1 },
  };
  writeStoredGarden(garden);
  notify();
  return { ok: true, reason: null, cost: result.cost, kind: result.kind };
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
  const result = openBedInState(liveGardenState());
  if (!result.ok) {
    return { ok: false, reason: result.reason, cost: result.cost, beds: result.beds };
  }
  growth = result.state.growth;
  garden = { ...garden, beds: result.state.beds };
  writeStoredGarden(garden);
  notify();
  return { ok: true, reason: null, cost: result.cost, beds: result.beds };
}
