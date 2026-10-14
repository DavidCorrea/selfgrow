/**
 * The garden as a picture: how much growth looks like what on the soil.
 *
 * `gardenForm` is the whole mapping — one pure function from the live growth
 * number to a named form and how far through that form the garden is. The pixel
 * art draws from it and the page states it in words, so the picture and the
 * text beside it come from the same call and cannot disagree.
 *
 * The mapping is logarithmic on thresholds that are round powers of ten, so
 * each rise moves the picture by a proportional step rather than a fixed count.
 * A linear count would fill the screen in the first minute and have nothing
 * left to show for the rest of the game.
 */

// The milestone ladder belongs to the simulation, not the picture: the plot
// draws a crown from the very same function the readout and `get-state` are
// built from, so what stands on the soil can never disagree with the number
// beside it.
import { MILESTONE_MULTIPLIER, kindMilestoneMultiplier } from "./garden.js";

/**
 * The forms a garden passes through, lowest first. Each `at` is the growth at
 * which that form begins; the last one keeps filling past its own threshold
 * rather than freezing at the top of the scale.
 */
export const FORMS = Object.freeze([
  { at: 0, name: "bare soil" },
  { at: 1, name: "a sprout" },
  { at: 10, name: "a seedling" },
  { at: 100, name: "a bed of seedlings" },
  { at: 1e3, name: "a stand of plants" },
  { at: 1e4, name: "a hedge" },
  { at: 1e5, name: "a grove" },
  { at: 1e6, name: "a wood" },
  { at: 1e9, name: "an orchard" },
  { at: 1e12, name: "a wild garden" },
]);

// The stride past the last threshold, matching the stride into it (1e9 → 1e12),
// so the fill keeps moving at amounts nothing has reached yet.
const LAST_STRIDE = 1000;

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Where `amount` sits inside the form that starts at `at`, from 0 to 1. */
function fillWithin(amount, at, nextAt) {
  if (amount <= at) return 0;
  // Bare soil has no lower threshold to measure from, so its first shoots are
  // counted one by one until the first real form takes over.
  if (at === 0) return clamp01(amount);
  const span = Math.log10(nextAt / at);
  if (!(span > 0)) return 0;
  return clamp01(Math.log10(amount / at) / span);
}

/** The amount at which the tier at `index` gives way to the next one. */
function nextThreshold(tiers, index) {
  if (index + 1 < tiers.length) return tiers[index + 1].at;
  return tiers[index].at * LAST_STRIDE;
}

/**
 * Which form `growth` is in, and how far through it, as
 * `{ index, name, at, nextAt, fill }`.
 *
 * `fill` runs from 0 at the form's threshold to 1 at the next one. Zero,
 * negative, missing or non-finite growth is bare soil — nothing grown.
 */
export function gardenForm(growth) {
  const amount = Number.isFinite(growth) && growth > 0 ? growth : 0;
  let index = 0;
  for (let i = FORMS.length - 1; i > 0; i -= 1) {
    if (amount >= FORMS[i].at) {
      index = i;
      break;
    }
  }
  const at = FORMS[index].at;
  const nextAt = nextThreshold(FORMS, index);
  return { index, name: FORMS[index].name, at, nextAt, fill: fillWithin(amount, at, nextAt) };
}

// --- Every mark the garden has ever grown -----------------------------------
//
// Current growth is what the garden holds right now; the lifetime is everything
// it has ever produced, and a replant trades the first for a lasting bonus while
// keeping the second. The plot therefore carries a second layer drawn from the
// lifetime alone — ground the garden has worked long enough to age, and the
// structures it has built on it — so a replanted plot still reads as a garden
// with a history rather than as soil nothing has ever touched, while the current
// growth still decides how full the plot is today.

/**
 * The tiers a garden's lifetime passes through, lowest first: what the ground
 * itself has become, from everything the garden has ever produced.
 *
 * The thresholds are powers of ten, like the forms, so each tier is the same
 * proportional step of history. The first one sits on the replant wall — the
 * lifetime of 100 a replant is first earned at — so the ground is already
 * turning over by the time a replant can hand the garden a lasting bonus.
 */
export const ESTABLISHMENTS = Object.freeze([
  { at: 0, name: "fresh ground" },
  { at: 1e2, name: "turned soil" },
  { at: 1e4, name: "worked ground" },
  { at: 1e6, name: "old ground" },
  { at: 1e9, name: "deep soil" },
  { at: 1e12, name: "ancient ground" },
]);

/**
 * How established the ground is, from the garden's lifetime growth alone, as
 * `{ index, name, at, nextAt, fill }` — the shape `gardenForm` returns for the
 * current growth.
 *
 * One pure mapping, so the aged ground and the structures the plot draws, the
 * readout beside them and `get-state` all come from this call and cannot
 * disagree. Zero, negative, missing or non-finite lifetime is fresh ground with
 * no fill: a garden with no history draws exactly what the plot drew before
 * this layer existed, which is also what a sandbox — one span of a garden, not
 * a life — carries. `fill` runs from 0 at the tier's threshold to 1 at the next
 * one, and past the last threshold the ground keeps filling.
 */
export function establishment(lifetime) {
  const amount = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 0;
  let index = 0;
  for (let i = ESTABLISHMENTS.length - 1; i > 0; i -= 1) {
    if (amount >= ESTABLISHMENTS[i].at) {
      index = i;
      break;
    }
  }
  const at = ESTABLISHMENTS[index].at;
  const nextAt = nextThreshold(ESTABLISHMENTS, index);
  // Fresh ground has nothing grown into it to be part-way through, so it holds
  // no fill at all rather than the first tier's share of one.
  const fill = at === 0 ? 0 : fillWithin(amount, at, nextAt);
  return { index, name: ESTABLISHMENTS[index].name, at, nextAt, fill };
}

// --- Filling the plot with the garden's own growth --------------------------
//
// The plot draws one sprite per plant and seed, so its bare count alone says
// little about how grown the garden is: a garden named "a stand of plants" can
// hold a single plant. The picture therefore carries the growth too, covering
// the soil with ground growth chosen from the form and how far through it the
// garden is, and growing that cover as the form advances.

/**
 * How much of the plot the garden's own growth has covered, from 0 on bare soil
 * toward 1 as the garden fills.
 *
 * Growth fills both within a form and from one form to the next, so a garden
 * holding a single plant but carrying a thousand growth still reads as a plot
 * the garden has taken over. It runs `(index + fill) / 5`, which puts most of
 * the plot under growth by "a stand of plants" and all of it from "a hedge"
 * on, and saturates past that so the top of the scale stays full.
 */
function coverRatio(form) {
  return clamp01((form.index + form.fill) / 5);
}

/**
 * A stable number in [0, 1) for one cell of soil.
 *
 * The ground the garden covers is chosen by hashing each cell rather than by
 * storing where it grew, so the same cell always hashes the same way and the
 * covered set only ever grows as the ratio rises. The same state and phase
 * therefore draw the same picture — what a still frame and reduced motion need.
 */
function cellHash(cell) {
  const value = Math.sin(cell * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The ground the garden has grown over, as `{ cells, covered, ratio }`.
 *
 * `cells` is the soil the plot draws, `covered` how many of those cells carry
 * ground growth, and `ratio` the share of the plot that growth has reached. A
 * cell is covered when its own hash falls below the ratio, so the covered set
 * is nested as the garden rises and two calls on one state always agree.
 */
export function groundCover(state) {
  const growth = state && Number.isFinite(state.growth) ? state.growth : 0;
  const ratio = coverRatio(gardenForm(growth));
  const { cells } = plotBounds(state);
  let covered = 0;
  for (let cell = 0; cell < cells; cell += 1) {
    if (cellHash(cell) < ratio) covered += 1;
  }
  return { cells, covered, ratio };
}

/**
 * The share of the plot the garden's lifetime has aged, from 0 on fresh ground
 * toward 1 as the whole plot holds the garden's history.
 *
 * It runs `(index + fill) / ESTABLISHMENTS.length` — one tier's worth of ground
 * per tier of lifetime — so each step of the garden's history visibly darkens
 * more of the plot than the last, and the last tier keeps filling toward every
 * cell however far the lifetime climbs past it.
 */
function agedRatio(established) {
  return clamp01((established.index + established.fill) / ESTABLISHMENTS.length);
}

/**
 * A stable number in [0, 1) for one cell of aged ground.
 *
 * Salted apart from `cellHash`, so the ground the garden's history has aged and
 * the ground its current growth covers are different sets of cells: the two
 * layers sit beside each other instead of the younger one hiding the older.
 */
function agedHash(cell) {
  const value = Math.sin((cell + 1) * 24.317 + 173.931) * 43758.5453;
  return value - Math.floor(value);
}

// --- Drawing the form on the soil -------------------------------------------
//
// The plot is a small grid of soil cells drawn at whole-pixel sizes and scaled
// up by CSS with `image-rendering: pixelated`. The ground widens as the garden
// rises through forms and widens again with every bed of soil opened, while a
// bounded number of plants stands on it — never more plants than there is
// ground, so a month of growth cannot flood the picture.

/** One cell of soil, in canvas pixels. */
const CELL = 24;
// Four columns by three rows on bare soil — the twelve plots one bed holds — so
// the bitmap starts out a 4:3 field rather than the long thin band it used to
// be, and fits the column the layout gives it. Every bed opened widens the
// drawn ground to hold that bed's plots, so a garden always has a cell for
// every seed and plant its readout counts, while the row cap keeps the sprite
// count bounded however large the save grows.
const COLUMNS = 4;
const BASE_ROWS = 3;
const MAX_ROWS = 12;
const FORMS_PER_ROW = 3;
// The plots one bed holds, as the plot itself defines a bed: three rows of four.
const BED_CELLS = COLUMNS * BASE_ROWS;

/** How many rows of soil this form has spread to. */
function rowsForForm(index) {
  return Math.min(MAX_ROWS, BASE_ROWS + Math.floor(index / FORMS_PER_ROW));
}

/** The beds of soil a drawn state owns; anything unknown is one bed. */
function bedsFor(state) {
  const beds = state && Number.isFinite(state.beds) ? Math.floor(state.beds) : 1;
  return beds >= 1 ? beds : 1;
}

/**
 * The plots `state` owns: the capacity the readout counts against when the
 * state carries one, and one bed's worth per bed otherwise.
 */
function capacityFor(state) {
  if (state && Number.isFinite(state.capacity) && state.capacity > 0) return Math.floor(state.capacity);
  return bedsFor(state) * BED_CELLS;
}

/**
 * The plot's pixel bounds for `state`: the grid of soil cells it draws and the
 * sprite cap that grid imposes.
 *
 * The grid holds the garden's form — a bigger garden is drawn larger — and its
 * capacity, so a full bed of plots always has a cell for every seed and plant
 * the readout counts. Both are bounded by the row cap, so a save carrying more
 * plots than the plot can show still draws a bounded picture.
 */
export function plotBounds(state) {
  const growth = state && Number.isFinite(state.growth) ? state.growth : 0;
  const forCapacity = Math.ceil(capacityFor(state) / COLUMNS);
  const rows = Math.min(MAX_ROWS, Math.max(rowsForForm(gardenForm(growth).index), forCapacity));
  return {
    cell: CELL,
    columns: COLUMNS,
    maxRows: MAX_ROWS,
    rows,
    width: COLUMNS * CELL,
    height: rows * CELL,
    cells: rows * COLUMNS,
  };
}

// --- Breathing --------------------------------------------------------------
//
// The plot is redrawn every tick, and a `phase` that advances with the ticks
// shifts the foliage by whole pixels so the garden visibly breathes between the
// milestones where its form changes. The sway is a small repeating pattern, so
// the same state and phase always draw the same picture and reduced motion can
// pin the phase to a single still frame.

/** The sideways steps a swaying plant takes, in pixels, one per phase. */
const SWAY_PATTERN = Object.freeze([0, 1, 1, 0, -1, -1]);

/**
 * How far a plant sways this phase: a whole pixel, from a per-plant `beat` so
 * neighbours do not move in lockstep. Always one of SWAY_PATTERN's steps.
 */
function swayPixels(phase, beat) {
  const step = (Math.floor(phase) + beat) % SWAY_PATTERN.length;
  return SWAY_PATTERN[(step + SWAY_PATTERN.length) % SWAY_PATTERN.length];
}

/**
 * The phase to draw at, from the render loop's frame and the visitor's motion
 * preference. Reduced motion — or a plot with nothing growing on it — is a
 * single still frame (`0`); otherwise the phase advances with the frame so the
 * garden breathes. It is pure, so the still frame can be asserted in a test.
 */
export function motionPhase({ reduced, frame, living } = {}) {
  if (reduced || !living) return 0;
  return Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
}

/**
 * The foliage each season draws: bare twigs in winter, blossom in spring, the
 * full deep canopy in summer, and turned amber with fallen leaves in autumn.
 */
const SEASON_FOLIAGE = Object.freeze({
  winter: "bare",
  spring: "blossom",
  summer: "lush",
  autumn: "turning",
});

/**
 * How a season looks on the plot: the season's own leaf colours, the foliage it
 * draws, and the key it resolves to.
 *
 * The season is the one already in the state — the same value the readout and
 * `get-state` report — so the picture and the words cannot disagree. An unknown
 * or missing key falls back to the base leaf colours and the full canopy, which
 * is what a caller that never knew about seasons has always drawn, and resolves
 * to `key: null` so the fallback is visible rather than passed off as a season.
 * Pure, so the look a season draws can be asserted without a canvas.
 *
 * @returns {{key: string|null, foliage: string, palette: object}}
 */
export function seasonLook(palette, seasonKey) {
  const leaves = palette && palette.leafSeasons ? palette.leafSeasons[seasonKey] : null;
  if (!leaves) return { key: null, foliage: "lush", palette };
  return {
    key: seasonKey,
    foliage: SEASON_FOLIAGE[seasonKey] ?? "lush",
    palette: { ...palette, leaf: leaves.leaf, leafLight: leaves.leafLight, leafDeep: leaves.leafDeep },
  };
}

// --- The soil's own face ----------------------------------------------------
//
// A plot of one flat square repeated reads as a grid of holes rather than as
// ground, so each cell carries its own small marks — a furrow, a damp patch, a
// pebble, a stray weed — chosen by hashing the cell and the season together.
// The plot is filled once, as a single field of soil, and the marks are drawn
// inside it, so neighbouring cells share no seam and the ground reads as one
// patch that changes with the garden's year rather than twelve copies of a
// square. Nothing here reads the animation phase, so the soil is a still frame
// whatever the motion preference: only the foliage sways.

/**
 * Each season's own shift in the soil hash, so the ground changes with the
 * garden's year. An unknown or missing season hashes as the base garden, which
 * is what a caller that never knew about seasons has always drawn.
 */
const SEASON_SOIL_SEED = Object.freeze({
  winter: 13,
  spring: 47,
  summer: 0,
  autumn: 89,
});

/** A stable number in [0, 1) for one cell, one season and one mark. */
function soilHash(cell, seasonSeed, salt) {
  const value = Math.sin((cell + 1) * 12.9898 + seasonSeed * 7.13 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * The marks one cell of soil carries, from the cell index and the season alone.
 *
 * Every mark sits off the cell's first columns, so the seam between two cells
 * stays plain soil and the field reads as one patch rather than a grid of
 * tiles. The same cell and season always hash the same way, and an unknown or
 * missing season falls back to the base garden's soil.
 *
 * @returns {{lip: boolean, furrow: boolean, furrowY: number, damp: boolean,
 *   dampX: number, dampY: number, pebble: boolean, pebbleX: number,
 *   pebbleY: number, weed: boolean, weedX: number}}
 */
export function soilFace(cell, seasonKey) {
  const seasonSeed = SEASON_SOIL_SEED[seasonKey] ?? 0;
  const at = (salt) => soilHash(cell, seasonSeed, salt);
  const lipAt = at(1);
  const furrowAt = at(2);
  const dampAt = at(3);
  const pebbleAt = at(4);
  const weedAt = at(5);
  return {
    lip: lipAt < 0.5,
    furrow: furrowAt < 0.4,
    furrowY: 8 + 2 * Math.floor(furrowAt * 5),
    damp: dampAt < 0.35,
    dampX: 4 + Math.floor(dampAt * 16),
    dampY: 8 + Math.floor(dampAt * 11),
    pebble: pebbleAt < 0.35,
    pebbleX: 5 + Math.floor(pebbleAt * 14),
    pebbleY: 10 + Math.floor(pebbleAt * 9),
    weed: weedAt < 0.25,
    weedX: 6 + Math.floor(weedAt * 12),
  };
}

/**
 * The marks of one cell on the field of soil. In autumn a few fallen leaves lie
 * on some of the cells too, so the turned season reads on the ground and not
 * only in the canopy. Every colour comes from the palette, so the marks stay in
 * the same garden as the panels around them.
 *
 * A cell that carries a seed or plant draws no weed tuft, so the ground stops
 * growing a shoot that a visitor would read as another sprout standing beside
 * the one the readout counts.
 */
function drawSoil(ctx, x, y, palette, foliage, face, cell, occupied) {
  if (face.lip) {
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + 3, y + 2, 6, 2);
  }
  if (face.furrow) {
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + 3, y + face.furrowY, CELL - 6, 1);
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + 5, y + face.furrowY + 1, CELL - 10, 1);
  }
  if (face.damp) {
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + face.dampX, y + face.dampY, 4, 2);
  }
  if (face.pebble) {
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + face.pebbleX, y + face.pebbleY, 3, 2);
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + face.pebbleX, y + face.pebbleY + 2, 3, 1);
  }
  if (face.weed && !occupied) {
    // A low tuft in the soil's own dark and light tones: it reads as weedy
    // ground, and never wears the leaf green of a growing thing, so no mark of
    // bare soil can be mistaken for a seed or a plant standing beside it.
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + face.weedX, y + CELL - 3, 1, 3);
    ctx.fillRect(x + face.weedX + 2, y + CELL - 4, 1, 4);
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + face.weedX + 2, y + CELL - 5, 1, 1);
  }
  if (foliage === "turning" && cell % 3 === 1) {
    // Fallen leaves on the turned ground, in the soil's two tones rather than
    // the season's leaf green: the ground may not share the colour of the
    // plants growing out of it.
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + 5, y + CELL - 8, 3, 2);
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + CELL - 9, y + CELL - 12, 3, 2);
  }
}

/**
 * The low growth the garden's own form lays over a covered cell: short blades the
 * garden has taken the soil with.
 *
 * It is drawn in the soil's own dark and light tones — never the leaf green a
 * seed or a plant carries — and kept far shorter and flatter than any planted
 * sprite, so it reads as ground the garden has covered rather than a field of
 * plants, and the taller herb and bloom silhouettes still stand out of it.
 * `cell` varies the blades, so a filled plot looks like many shoots and not one
 * stamp.
 */
function drawGroundGrowth(ctx, x, y, palette, cell) {
  const base = y + CELL;
  // Four blades whose spacing and height come from the cell's own hash, so the
  // cover is uneven ground rather than a mown lawn.
  for (let i = 0; i < 4; i += 1) {
    const across = 2 + i * 5 + Math.floor(cellHash(cell + i * 29) * 3);
    const height = 2 + Math.floor(cellHash(cell + i * 71) * 3);
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + across, base - height, 2, height);
  }
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(x + 3, base - 3, 4, 1);
  ctx.fillRect(x + CELL - 9, base - 4, 5, 1);
}

/**
 * The aged ground one cell carries: clods of old humus dug through the soil.
 *
 * In the soil's own two tones, drawn under the garden's current ground growth,
 * so a long-worked plot reads as deeper, looser earth and a replanted one still
 * shows the history standing under its fresh seedling. Each clod is a low mound
 * with a lit crown, and every position comes from the cell alone — no phase is
 * read, so the layer is a still frame whatever the motion preference.
 */
function drawAgedGround(ctx, x, y, palette, cell) {
  for (let i = 0; i < 2; i += 1) {
    const clodX = x + 2 + Math.floor(agedHash(cell + i * 37) * 14);
    const clodY = y + 3 + Math.floor(agedHash(cell + i * 53) * 15);
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(clodX + 1, clodY, 4, 2);
    ctx.fillRect(clodX, clodY + 2, 6, 2);
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(clodX + 2, clodY, 2, 1);
    ctx.fillRect(clodX + 1, clodY + 2, 1, 1);
  }
}

// The garden's lasting structures: one course of stones per tier of history, up
// to a cap so the tallest wall still leaves the plot's ground readable, and one
// cairn per tier, capped so the markers never crowd the wall they stand on.
const STONE_WIDTH = 6;
const STONE_HEIGHT = 3;
const WALL_COURSES_MAX = 3;
const CAIRNS_MAX = 4;

/** How many courses of wall the garden's history has laid: one per tier, capped. */
function wallCourses(established) {
  return Math.min(WALL_COURSES_MAX, established.index);
}

/**
 * The stone wall along the plot's bottom edge: a course of stones per tier of
 * the garden's lifetime.
 *
 * It is the garden's oldest structure — the retaining wall of ground the
 * visitor has worked — so it is drawn from the lifetime alone and stands in
 * front of the garden, where a replant that has left the plot bare again still
 * shows it. Alternate courses are offset by half a stone, so the wall reads as
 * laid stonework rather than as one striped band.
 */
function drawStoneWall(ctx, palette, width, height, courses) {
  for (let course = 0; course < courses; course += 1) {
    const y = height - STONE_HEIGHT * (course + 1);
    const offset = course % 2 === 0 ? 0 : STONE_WIDTH / 2;
    for (let x = -offset; x < width; x += STONE_WIDTH) {
      ctx.fillStyle = palette.soilLight;
      ctx.fillRect(x, y, STONE_WIDTH - 1, STONE_HEIGHT - 1);
      ctx.fillStyle = palette.soilDeep;
      ctx.fillRect(x + STONE_WIDTH - 1, y, 1, STONE_HEIGHT);
      ctx.fillRect(x, y + STONE_HEIGHT - 1, STONE_WIDTH - 1, 1);
    }
  }
}

/**
 * The cairns standing on the wall, one per tier of the garden's lifetime
 * (capped): a small pile of stones the visitor's history has raised.
 *
 * They are spaced along the plot's width rather than placed on cells, so they
 * never claim the plot a seed or plant stands on, and they are drawn with no
 * phase, so they hold still while the garden breathes and under reduced motion.
 */
function drawCairns(ctx, palette, width, height, count, courses) {
  const ground = height - STONE_HEIGHT * courses;
  for (let i = 0; i < count; i += 1) {
    const x = Math.round((i + 1) * (width / (count + 1)) - STONE_WIDTH / 2);
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + 1, ground - 3, 6, 3);
    ctx.fillRect(x + 2, ground - 6, 4, 3);
    ctx.fillRect(x + 3, ground - 8, 3, 2);
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + 1, ground - 1, 6, 1);
    ctx.fillRect(x + 2, ground - 4, 4, 1);
  }
}

/**
 * An ungrown seed in the ground: a mound of turned soil with the seed itself
 * standing proud of it and two tiny leaves pushing out.
 *
 * It fills most of the cell, so an ungrown seed is a mark a visitor can point
 * at rather than a speck lost in the soil. A herb seed's pip is the soil's own
 * dark; a bloom seed's is a closed bloom-coloured bud, so the two kinds are
 * told apart before either has grown. The leaves `dx` sway while the seed stays
 * rooted.
 */
function drawSeed(ctx, x, y, palette, dx, bloom) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  // The mound: a pale ridge of turned soil across the cell's foot.
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(centre - 8, base - 3, 16, 3);
  ctx.fillRect(centre - 5, base - 5, 10, 2);
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 8, base - 1, 16, 1);
  // The seed itself, standing out of the mound.
  ctx.fillStyle = bloom ? palette.bloom : palette.soilDeep;
  ctx.fillRect(centre - 2, base - 11, 5, 6);
  ctx.fillStyle = bloom ? palette.sun : palette.soilLight;
  ctx.fillRect(centre - 1, base - 10, 2, 2);
  // Two tiny leaves, the first sign of the plant to come.
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1 + dx, base - 13, 2, 3);
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(centre - 6 + dx, base - 14, 4, 3);
  ctx.fillRect(centre + 3 + dx, base - 14, 4, 3);
}

/** One herb plant on the soil, chosen by the form and grown by how full it is. */
function drawPlant(ctx, x, y, palette, foliage, index, growthTier, dx) {
  if (index <= 4) drawHerb(ctx, x, y, palette, index, growthTier, dx);
  else if (index === 5) drawHedge(ctx, x, y, palette, growthTier, dx, foliage);
  else drawTree(ctx, x, y, palette, index, growthTier, false, dx, foliage);
}

/**
 * One bloom plant: the same silhouette the form gives a herb, but always in
 * flower, so the two kinds read differently at every size — a large bloom head
 * where the herb carries bare leaf.
 */
function drawBloomPlant(ctx, x, y, palette, foliage, index, growthTier, dx) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  if (index <= 4) {
    const height = Math.min(CELL - 10, 13 + growthTier * 2 + Math.min(index, 3));
    ctx.fillStyle = palette.leafDeep;
    ctx.fillRect(centre - 1, base - height, 2, height);
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(centre - 7 + dx, base - Math.round(height * 0.35), 5, 3);
    ctx.fillRect(centre + 2 + dx, base - Math.round(height * 0.65), 5, 3);
    // The head: a large bloom around a sun centre, sitting on the stem.
    const headY = base - height;
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(centre - 5 + dx, headY - 8, 10, 8);
    ctx.fillRect(centre - 7 + dx, headY - 5, 14, 4);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 2 + dx, headY - 6, 4, 4);
  } else if (index === 5) {
    drawHedge(ctx, x, y, palette, growthTier, dx, foliage);
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(x + 4 + dx, y + CELL - 14, 4, 4);
    ctx.fillRect(x + CELL - 8 + dx, y + CELL - 10, 4, 4);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(x + 5 + dx, y + CELL - 13, 2, 2);
    ctx.fillRect(x + CELL - 7 + dx, y + CELL - 9, 2, 2);
  } else {
    drawTree(ctx, x, y, palette, index, growthTier, true, dx, foliage);
  }
}

/**
 * A herb plant: a full-height stem with three pairs of leaves and no flower, so
 * it stands the height of the cell and stays plainly a herb beside a bloom.
 */
function drawHerb(ctx, x, y, palette, index, growthTier, dx) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  const height = Math.min(CELL - 2, 18 + growthTier * 2 + Math.min(index, 3));
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - height, 2, height);
  ctx.fillStyle = palette.leaf;
  for (const at of [0.25, 0.55, 0.85]) {
    const leafY = base - Math.round(height * at);
    ctx.fillRect(centre - 7 + dx, leafY - 1, 5, 3);
    ctx.fillRect(centre + 2 + dx, leafY - 3, 5, 3);
  }
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(centre - 6 + dx, base - Math.round(height * 0.55) - 1, 3, 1);
  ctx.fillRect(centre + 3 + dx, base - Math.round(height * 0.85) - 3, 3, 1);
}

/** A leafy mass that fills the cell, close to the ground; its crown sways by `dx`. */
function drawHedge(ctx, x, y, palette, growthTier, dx, foliage) {
  const base = y + CELL;
  const height = Math.min(CELL - 2, 18 + growthTier * 2);
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(x + 3 + dx, base - height, CELL - 6, height);
  ctx.fillStyle = palette.leaf;
  ctx.fillRect(x + 5 + dx, base - height + 2, CELL - 10, height - 4);
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(x + 7 + dx, base - height + 3, CELL - 14, 2);
  ctx.fillRect(x + 8 + dx, base - height + 8, CELL - 16, 2);
  if (foliage === "blossom") {
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(x + 6 + dx, base - height + 5, 3, 3);
    ctx.fillRect(x + CELL - 10 + dx, base - height + 7, 3, 3);
  }
}

/**
 * A trunk under a canopy that fills the cell and grows with the form. A herb
 * carries its own bloom only from the eighth form on; a bloom plant (`flowered`)
 * is covered in flower from the first tree on, so the kinds stay apart however
 * tall they grow. In winter the canopy falls to bare twigs; in spring it carries
 * blossom.
 */
function drawTree(ctx, x, y, palette, index, growthTier, flowered, dx, foliage) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  const trunkHeight = 5 + growthTier;
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 2, base - trunkHeight, 4, trunkHeight);

  const canopyHeight = Math.min(CELL - trunkHeight - 1, 12 + (index - 6) + growthTier * 2);
  const canopyWidth = Math.min(CELL - 2, 14 + (index - 6) * 2);
  const canopyBottom = base - trunkHeight;
  const canopyTop = canopyBottom - canopyHeight;
  // The canopy, not the trunk, catches the breeze.
  const left = Math.round(centre - canopyWidth / 2) + dx;
  if (foliage === "bare") {
    // Winter: the leaves have dropped, leaving the branches they hung on. The
    // bloom of a flowering tree stays on them, so the kinds still read apart.
    ctx.fillStyle = palette.leafDeep;
    ctx.fillRect(centre - 1, canopyTop, 2, canopyHeight + 1);
    ctx.fillRect(left + 2, canopyTop + 3, 4, 2);
    ctx.fillRect(left + canopyWidth - 6, canopyTop + 6, 4, 2);
  } else {
    ctx.fillStyle = palette.leafDeep;
    ctx.fillRect(left, canopyTop, canopyWidth, canopyHeight);
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(left + 2, canopyTop + 2, canopyWidth - 4, canopyHeight - 4);
  }
  if (index >= 8 || flowered) {
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(left + 3, canopyTop + 3, 3, 3);
    ctx.fillRect(left + canopyWidth - 6, canopyTop + 5, 3, 3);
    ctx.fillRect(left + Math.floor(canopyWidth / 2), canopyTop + 1, 3, 3);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(left + 6, canopyTop + 5, 2, 2);
  } else if (foliage === "blossom") {
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(left + 4, canopyTop + 3, 2, 2);
    ctx.fillRect(left + canopyWidth - 7, canopyTop + 4, 2, 2);
  }
  if (index >= 9) {
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 1, canopyTop + 4, 2, 2);
    ctx.fillStyle = palette.leafLight;
    ctx.fillRect(left + 4, canopyTop + 7, 3, 2);
  }
}

/**
 * The crown a plant wears once its kind has earned a milestone: a still golden
 * crest across the top of its cell, one peak wider for each rung of the kind's
 * ladder, so the doubled output the readout states stands on the plot itself.
 *
 * It reads no animation phase, so the reward holds in the single still frame
 * reduced motion pins to, and it is drawn in the same sun the plot marks every
 * event with, over a dark band that keeps it legible against the foliage.
 */
function drawMilestoneCrown(ctx, x, y, palette, tier) {
  const peaks = tier + 2;
  const spacing = 3;
  const width = (peaks - 1) * spacing + 2;
  const left = Math.round(x + CELL / 2 - width / 2);
  const foot = y + 5;
  // A dark band first, so the crest reads as a crown set on the plant rather
  // than as flecks of light lost in the leaves behind it.
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(left - 1, foot, width + 2, 1);
  ctx.fillStyle = palette.sun;
  for (let peak = 0; peak < peaks; peak += 1) {
    // The middle peak stands a pixel taller, so the crest points upward.
    const height = peak === Math.floor(peaks / 2) ? 4 : 3;
    ctx.fillRect(left + peak * spacing, foot - height, 2, height);
  }
}

/**
 * The marks a return leaves on the plot: a still sun tick over each cell whose
 * plant matured while away, and a still sun frame around the ground when the
 * garden reached a form it did not have.
 *
 * They are drawn over the garden and never move, so they read the same under
 * reduced motion as under any other preference, and a returning player sees the
 * change itself rather than only a sentence about it. `marks` is the object
 * `returnMarkCells` returns: the cells to tick and whether to frame the plot.
 */
function drawReturnMarks(ctx, palette, width, height, marks) {
  ctx.fillStyle = palette.sun;
  for (const cell of marks.cells) {
    const x = (cell % COLUMNS) * CELL;
    const y = Math.floor(cell / COLUMNS) * CELL;
    const centre = x + CELL / 2;
    // A small downward chevron at the top of the cell, pointing at the plant
    // that has just matured.
    ctx.fillRect(centre - 2, y + 1, 5, 2);
    ctx.fillRect(centre - 1, y + 3, 3, 2);
    ctx.fillRect(centre, y + 5, 1, 1);
  }
  if (marks.form) {
    // Brackets at opposite corners frame the whole plot, because the garden's
    // shape itself is new.
    ctx.fillRect(0, 0, 7, 2);
    ctx.fillRect(0, 0, 2, 7);
    ctx.fillRect(width - 7, height - 2, 7, 2);
    ctx.fillRect(width - 2, height - 7, 2, 7);
  }
}

/**
 * A visitor on the plot: a bee large enough to be a mark of its own, hovering
 * over the first grown plant.
 *
 * Drawn from the same `:root` palette as everything else — a head, a striped
 * sun body and bloom wings — so it belongs to the garden rather than looking
 * pasted on. It is never the only account of the visit: the readout and
 * `get-state` name the pollinator and the boost it brings.
 */
function drawPollinator(ctx, x, y, palette, driftX, driftY) {
  const centre = x + CELL / 2 + driftX;
  const top = y + 3 + driftY;
  // Bloom wings above the body, one either side of the head.
  ctx.fillStyle = palette.bloom;
  ctx.fillRect(centre - 7, top - 1, 5, 4);
  ctx.fillRect(centre + 2, top - 1, 5, 4);
  // A dark head at the front, then the striped sun body.
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 7, top + 1, 3, 4);
  ctx.fillStyle = palette.sun;
  ctx.fillRect(centre - 4, top + 1, 10, 6);
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 1, top + 1, 2, 6);
  ctx.fillRect(centre + 3, top + 1, 2, 6);
}

/**
 * The pollinator's home: a small hive of stacked sun bars, its stripes and
 * entrance cut in the soil's own dark, standing still in the plot's top-right
 * cell.
 *
 * It is drawn with no phase, so the hive never moves while the garden breathes
 * around it, and every colour comes from the same palette as the plants, so it
 * belongs to this garden rather than looking pasted on. The plot draws it
 * whenever grown plants stand on the garden — the place a pollinator lives —
 * which is exactly what `pollinatorPlot` reads off the state.
 */
function drawPollinatorHome(ctx, x, y, palette) {
  ctx.fillStyle = palette.sun;
  ctx.fillRect(x + 7, y + 10, 10, 3);
  ctx.fillRect(x + 5, y + 13, 14, 4);
  ctx.fillRect(x + 6, y + 17, 12, 4);
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(x + 5, y + 13, 14, 1);
  ctx.fillRect(x + 6, y + 17, 12, 1);
  // The entrance, so the stack reads as a hive rather than a pile of bars.
  ctx.fillRect(x + 10, y + 18, 4, 3);
}

/**
 * The pollinator at rest, perched on the hive roof between visits: the same bee
 * the visiting frame draws, set still on the home so a garden between visits
 * still shows that a pollinator lives here.
 *
 * It sits above the hive's top bar, so the home's anchor pixel stays the hive's
 * own colour whether the bee is resting or out visiting.
 */
function drawRestingBee(ctx, x, y, palette) {
  drawPollinator(ctx, x, y, palette, 0, 0);
}

/**
 * The pollen a visiting bee has stirred up: a few still sun specks across the
 * plants, so a visit looks busier than a resting home at a glance.
 *
 * Their count and positions come from the grown plants, not the animation
 * phase, so the visit differs from the rest in the single still frame that
 * reduced motion pins to and that a pixel probe reads.
 */
function drawPollenSpecks(ctx, palette, plants) {
  const count = Math.min(5, 1 + plants);
  const span = (COLUMNS - 1) * CELL - 12;
  ctx.fillStyle = palette.sun;
  for (let i = 0; i < count; i += 1) {
    const x = 6 + ((i * 29) % span);
    const y = 3 + ((i * 7) % 12);
    ctx.fillRect(x, y, 2, 2);
  }
}

/**
 * What the pollinator is doing on the plot, as a pure reading of `state`:
 * whether its home stands here, and whether it is out visiting right now.
 *
 * `home` is a garden with grown plants — the place a pollinator lives — which
 * is the same grown-plant count the plot draws and `get-state` reports;
 * `visiting` is that home with a visit on now, and `resting` the visits
 * between. No new saved field: it reads exactly the `plants`/`plantCounts` and
 * `pollinator.visiting` the readout already carries, so the picture and the
 * agent tools cannot disagree about the pollinator's state.
 *
 * @returns {{home: boolean, visiting: boolean, resting: boolean}}
 */
export function pollinatorPlot(state) {
  const { herbPlants, bloomPlants } = kindsOnPlot(state);
  const home = herbPlants + bloomPlants > 0;
  const visiting = home && Boolean(state?.pollinator?.visiting);
  return { home, visiting, resting: home && !visiting };
}

/**
 * How many milestones each kind on the plot has earned, as
 * `[herbTier, bloomTier]` — the degree of reward the plot draws on that kind's
 * plants.
 *
 * The counts are the ones the plot already draws and `get-state` reports, and
 * the degree is read off `kindMilestoneMultiplier` — the exact function behind
 * the readout's milestone multiplier and the simulation's boost — so the crown
 * on the plot can never drift from the figure beside it. It is the multiplier's
 * logarithm in base `MILESTONE_MULTIPLIER`: 0 for a kind that has earned none,
 * 1 for the first rung, and so on. Pure, so the tiers can be asserted without a
 * canvas.
 */
export function plotMilestoneTiers(state) {
  const { herbPlants, bloomPlants } = kindsOnPlot(state);
  const tierOf = (index, plants) =>
    Math.round(Math.log(kindMilestoneMultiplier(index, plants)) / Math.log(MILESTONE_MULTIPLIER));
  return [tierOf(0, herbPlants), tierOf(1, bloomPlants)];
}

/**
 * Every mark the plot draws, in the order it draws them: one per grown plant
 * and one per ungrown seed the readout counts, herb before bloom in each pair.
 *
 * `drawGarden` draws exactly these, and nothing else, so the picture cannot
 * disagree with the numbers beside it: a garden counting twelve plots of soil
 * draws twelve marks. Each mark carries the cell it lands on, and the list is
 * cut off at the cells the plot actually has, so a save carrying more plants
 * than plots is drawn bounded rather than flooded.
 *
 * @returns {Array<{kind: "herb-plant"|"bloom-plant"|"herb-seed"|"bloom-seed", cell: number}>}
 */
export function plotMarks(state) {
  const { cells } = plotBounds(state);
  const { herbPlants, bloomPlants, herbSeeds, bloomSeeds } = kindsOnPlot(state);
  const marks = [];
  const add = (kind, count) => {
    for (let i = 0; i < count && marks.length < cells; i += 1) marks.push({ kind, cell: marks.length });
  };
  add("herb-plant", herbPlants);
  add("bloom-plant", bloomPlants);
  add("herb-seed", herbSeeds);
  add("bloom-seed", bloomSeeds);
  return marks;
}

/**
 * The plots the picture owns, plot by plot.
 *
 * The plot draws one cell of soil per plot of the garden's capacity, so this
 * reads `plotBounds` for the grid and `plotMarks` for what stands on it and
 * names each plot the picture can be counted by: its cell, the column and row it
 * sits in, the bed it belongs to and whether a seed or plant holds it. The plot
 * count is `min(capacity, ground cells)` — the ground the garden's form spreads
 * beyond the plots carries no plot, and a save with more plots than the grid can
 * hold is drawn bounded rather than flooded. `beds` is how many beds those plots
 * fill and `fullBeds` the beds whose every plot is held, so a bed reads as full
 * exactly when its plots do. Pure, so the drawn garden can be counted against
 * the readout beside it without a canvas.
 *
 * `marks` is the list `plotMarks` already returned, so a caller that has it can
 * hand it back instead of rebuilding it.
 */
export function plotCells(state, marks = plotMarks(state)) {
  const { columns, rows, cells } = plotBounds(state);
  const capacity = capacityFor(state);
  const occupied = new Set(marks.map((mark) => mark.cell));
  const count = Math.min(capacity, cells);
  const plots = [];
  for (let cell = 0; cell < count; cell += 1) {
    plots.push({
      cell,
      column: cell % columns,
      row: Math.floor(cell / columns),
      bed: Math.floor(cell / BED_CELLS),
      occupied: occupied.has(cell),
    });
  }
  const beds = Math.ceil(count / BED_CELLS);
  const fullBeds = [];
  for (let bed = 0; bed < beds; bed += 1) {
    const inBed = plots.filter((plot) => plot.bed === bed);
    if (inBed.length > 0 && inBed.every((plot) => plot.occupied)) fullBeds.push(bed);
  }
  return { columns, rows, cells, capacity, plots, beds, fullBeds };
}

/**
 * The plots the visitor sowed by hand, as the cells that carry a standing sign.
 *
 * The visit record counts how many plots the visitor sowed, not which ones — the
 * plot model has no per-plot identity to name them by — so the mark lands on the
 * first that many occupied cells, the same cells `plotMarks` fills in order. The
 * count is bounded by the marks actually drawn and reads zero when there is no
 * visit or the visitor has sown nothing, so a save that sowed more plots than
 * the picture holds is drawn bounded rather than flooded. Pure, so the drawn
 * signs and the words beside them can be checked without a canvas.
 *
 * `marks` is the list `plotMarks` already returned, so a caller that has it can
 * hand it back instead of rebuilding it.
 *
 * @returns {number[]} the cells carrying a hand-worked sign, in draw order.
 */
export function tendedMarkCells(state, marks = plotMarks(state)) {
  const sown = state && state.visit && Number.isFinite(state.visit.sown) ? Math.floor(state.visit.sown) : 0;
  const count = Math.min(Math.max(0, sown), marks.length);
  const cells = [];
  for (let i = 0; i < count; i += 1) cells.push(marks[i].cell);
  return cells;
}

/**
 * Draw one mark on the plot: a grown plant, an ungrown seed or a bloom's bud,
 * each in its own recognisable sprite, at the cell it landed on. A grown plant
 * whose kind has earned a milestone wears its crown over the sprite, so the
 * reward is seen on the plot and not only stated in a label; a seed never does,
 * because a milestone counts grown plants.
 */
function drawMark(ctx, mark, palette, foliage, formIndex, growthTier, sway, milestoneTier) {
  const x = (mark.cell % COLUMNS) * CELL;
  const y = Math.floor(mark.cell / COLUMNS) * CELL;
  if (mark.kind === "herb-seed") {
    drawSeed(ctx, x, y, palette, sway, false);
    return;
  }
  if (mark.kind === "bloom-seed") {
    drawSeed(ctx, x, y, palette, sway, true);
    return;
  }
  if (mark.kind === "herb-plant") drawPlant(ctx, x, y, palette, foliage, formIndex, growthTier, sway);
  else drawBloomPlant(ctx, x, y, palette, foliage, formIndex, growthTier, sway);
  if (milestoneTier > 0) drawMilestoneCrown(ctx, x, y, palette, milestoneTier);
}

/**
 * The sign a plot the visitor sowed by hand carries: a small standing marker — a
 * pale board on a dark stake, planted in the soil — so the ground the visitor
 * worked reads differently from ground the garden sowed on its own.
 *
 * It is cut in the soil's own two tones rather than the leaf green or sun of a
 * growing thing, so it belongs to the ground it stands in and no mark of an
 * untouched plot can be mistaken for one. It reads no animation phase, so it
 * holds still in the single frame reduced motion pins to, and it is drawn over
 * the sprite on its cell, where the visitor can point at the plots they worked.
 */
function drawTendedSign(ctx, x, y, palette) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  // The stake, planted in the soil under the board.
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 1, base - 10, 2, 10);
  // The board: a dark backing with a pale face set inside it, so the sign reads
  // as a marker standing in the plot rather than a bar laid across it.
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 5, base - 17, 10, 7);
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(centre - 4, base - 16, 8, 4);
  // A dark post showing through the face, so the board is plainly a sign.
  ctx.fillRect(centre - 1, base - 16, 2, 2);
}

// How far a plot's bed edge is held inside its left and right edges, in pixels:
// enough that the edges of neighbouring plots never meet, so the soil between
// two columns stays plain ground and the field is not ruled into a grid.
const PLOT_EDGE_INSET = 3;

/**
 * A low bed edge on every plot of soil, in the soil's own tones.
 *
 * Each plot carries a one-pixel lit ridge along its top with a dark line beneath
 * it, held inside the plot's left and right edges, so the horizontal seams break
 * into one segment per plot and a visitor can count the plots across and down.
 * The gap the inset leaves between neighbouring columns keeps the vertical seams
 * plain soil, so the plot still reads as one patch of ground rather than a grid
 * of outlined tiles. A bed whose every plot is held is then closed by a
 * full-width lit rim along its first row and the foot of its last, so a bed reads
 * as full exactly when its plots are full. Nothing here reads the animation
 * phase, so the edges hold in the still frame reduced motion pins to.
 *
 * `grid` is the `plotCells` reading of the same state, so the drawn edge and the
 * counted plot are one and the same.
 */
function drawPlotEdges(ctx, palette, width, grid) {
  for (const plot of grid.plots) {
    const x = plot.column * CELL;
    const y = plot.row * CELL;
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(x + PLOT_EDGE_INSET, y, CELL - PLOT_EDGE_INSET * 2, 1);
    ctx.fillStyle = palette.soilDeep;
    ctx.fillRect(x + PLOT_EDGE_INSET, y + 1, CELL - PLOT_EDGE_INSET * 2, 1);
  }
  // A bed is BASE_ROWS rows of COLUMNS plots, so its first row and its foot are
  // named by its index alone.
  for (const bed of grid.fullBeds) {
    const top = bed * BASE_ROWS * CELL;
    const foot = (bed + 1) * BASE_ROWS * CELL - 1;
    ctx.fillStyle = palette.soilLight;
    ctx.fillRect(0, top, width, 1);
    ctx.fillRect(0, foot, width, 1);
  }
}

/**
 * Draw `state`'s garden onto `canvas`, painting only with `palette`.
 *
 * The picture is a pure view of the state and the animation `phase`: the form and
 * the garden's capacity set how much ground there is and how big a grown plant is,
 * the garden's own growth covers that ground with low growth so a low-plant,
 * high-growth garden still visibly fills, the season the state names sets the
 * foliage colours and shape, and `plotMarks` says what stands on it — the grown
 * plants first, then the ungrown seeds, herb before bloom — and whether a
 * pollinator lives here and is out working the plants right now. A grown plant
 * whose kind has reached a milestone wears a still crown over it, so the doubled
 * output the readout states shows on the plot as well. The season is
 * read from `state.season.key`, which is the same value the readout and
 * `get-state` report, so the picture and the words cannot disagree. The same
 * state and phase always draw the same way, and every colour comes from the
 * palette read off `:root`, so the plot belongs to the same garden as the panels
 * around it. The number of marks is bounded by the cells on screen, so a save
 * carrying more plants than plots cannot flood the picture. Every plot of soil
 * carries a low bed edge in the soil's own tones — a lit ridge along its top with
 * the vertical seams left plain — and a bed whose plots are all held is closed by
 * a lit rim, so the picture can be counted plot by plot against the panel's
 * 'Plots of soil' beside it.
 *
 * The lifetime is a second, lasting layer under all of it: `state.lifetimeGrowth`
 * — the same value the readout and `get-state` report — decides how much of the
 * ground has aged and how much wall and how many cairns the garden has built, so
 * an old, well-kept garden reads as established at a glance and a replanted plot
 * is never drawn as soil nothing has touched. It is hash-derived and reads no
 * phase, so it holds in the still frame reduced motion pins to.
 *
 * The plots the visitor sowed by hand carry a still standing sign, drawn from
 * `state.visit.sown` — the same hand-work count the readout and `get-state`
 * report — so a garden the visitor worked reads differently from one they only
 * watched. The signs read no phase and go on over the sprites, and a replant
 * clears the visit with the rest of the plot, so the signs go with it.
 */
export function drawGarden(canvas, state, palette, phase = 0) {
  if (!canvas || !palette) return;
  const growth = state && Number.isFinite(state.growth) ? state.growth : 0;
  const form = gardenForm(growth);
  const established = establishment(state?.lifetimeGrowth);
  const aged = agedRatio(established);
  const courses = wallCourses(established);
  const look = seasonLook(palette, state?.season?.key);
  const paint = look.palette;
  const { cells, width, height } = plotBounds(state);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  // One field of soil, not a tile per cell: the whole plot is filled once, so
  // neighbouring cells share no seam and the plot reads as continuous ground.
  ctx.fillStyle = paint.soil;
  ctx.fillRect(0, 0, width, height);

  const marks = plotMarks(state);
  const occupied = new Set(marks.map((mark) => mark.cell));
  // The bed edge goes on the bare field, before the soil's face and the sprites
  // are drawn over it: every plot of soil is drawn as its own plot, so a visitor
  // can count the picture against the 'Plots of soil' the panel beside it reports.
  drawPlotEdges(ctx, paint, width, plotCells(state, marks));
  const plants = marks.filter((mark) => mark.kind === "herb-plant" || mark.kind === "bloom-plant").length;
  const growthTier = Math.min(2, Math.floor(form.fill * 3));
  // The garden's own growth, not only the plants it owns, fills the soil.
  const cover = groundCover(state);
  for (let cell = 0; cell < cells; cell += 1) {
    const x = (cell % COLUMNS) * CELL;
    const y = Math.floor(cell / COLUMNS) * CELL;
    drawSoil(ctx, x, y, paint, look.foliage, soilFace(cell, look.key), cell, occupied.has(cell));
    // The ground the garden's lifetime has aged goes on under the ground its
    // current growth covers, so an old plot reads as deeper soil and a
    // replanted one still shows what its growth no longer does.
    if (agedHash(cell) < aged) drawAgedGround(ctx, x, y, paint, cell);
    // Ground growth goes on first, so the planted sprites stand out of it.
    if (cellHash(cell) < cover.ratio) drawGroundGrowth(ctx, x, y, paint, cell);
  }
  // Every seed and plant the readout counts, drawn on its own cell. The herb
  // plants stand first, then the blooms, then the seeds of each kind. A grown
  // plant of a kind that has earned a milestone wears a crown, so the doubled
  // output the readout states is drawn on the plot too.
  const tiers = plotMilestoneTiers(state);
  for (const mark of marks) {
    const tier = mark.kind === "herb-plant" ? tiers[0] : mark.kind === "bloom-plant" ? tiers[1] : 0;
    drawMark(ctx, mark, paint, look.foliage, form.index, growthTier, swayPixels(phase, mark.cell), tier);
  }
  // The plots the visitor sowed by hand carry a standing sign over the sprite,
  // so the ground they worked reads differently from ground the garden sowed on
  // its own. The sign reads no phase, so it holds in the still frame.
  for (const cell of tendedMarkCells(state, marks)) {
    drawTendedSign(ctx, (cell % COLUMNS) * CELL, Math.floor(cell / COLUMNS) * CELL, paint);
  }
  // The garden's lasting structures stand in front of it: the wall its lifetime
  // has laid along the foot of the plot and a cairn per tier, so an established
  // garden reads as established at a glance and a replant does not erase what
  // was built. Nothing here reads the phase, so they hold still.
  if (established.index > 0) {
    drawStoneWall(ctx, paint, width, height, courses);
    drawCairns(ctx, paint, width, height, Math.min(CAIRNS_MAX, established.index), courses);
  }
  // The pollinator's home stands on the plot whenever grown plants do. Between
  // visits the bee rests still on the hive; during one the hive stays and the
  // bee is out over the plants with pollen in the air, so the picture says both
  // that a pollinator lives here and whether it is busy right now.
  const pollinator = pollinatorPlot(state);
  if (pollinator.home) {
    drawPollinatorHome(ctx, width - CELL, 0, paint);
    if (pollinator.visiting) {
      drawPollinator(ctx, 0, 0, paint, swayPixels(phase, 1), swayPixels(phase, 3));
      if (plants > 1) drawPollinator(ctx, CELL, 0, paint, swayPixels(phase, 2), swayPixels(phase, 4));
      drawPollenSpecks(ctx, paint, plants);
    } else {
      drawRestingBee(ctx, width - CELL, 0, paint);
    }
  }
  // The return marks go on last, over the garden: what grew while the visitor
  // was away stands out until they notice it.
  const returns = returnMarkCells(state, { cells });
  if (returns.cells.length > 0 || returns.form) drawReturnMarks(ctx, paint, width, height, returns);
}

/**
 * How many of each kind stand on the plot: grown plants and ungrown seeds,
 * herb and bloom.
 *
 * A state carries its per-kind counts in `plantCounts`/`seedCounts` (what the
 * page passes); a state that only knew the one kind falls back to its totals as
 * herb, so an old caller draws exactly what it always drew. The counts are
 * floored at the cells on screen by `plotMarks`, not here.
 */
function kindsOnPlot(state) {
  const wanted = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  const growingTimers = (timers) =>
    Array.isArray(timers) ? timers.filter((timer) => Number.isFinite(timer) && timer > 0).length : 0;

  let herbPlants;
  let bloomPlants;
  if (state && Array.isArray(state.plantCounts)) {
    herbPlants = wanted(state.plantCounts[0]);
    bloomPlants = wanted(state.plantCounts[1]);
  } else {
    herbPlants = wanted(state && state.plants);
    bloomPlants = wanted(state && state.bloomPlants);
  }

  let herbSeeds;
  let bloomSeeds;
  if (state && Array.isArray(state.seedCounts)) {
    herbSeeds = wanted(state.seedCounts[0]);
    bloomSeeds = wanted(state.seedCounts[1]);
  } else if (state && (Array.isArray(state.sprouts) || Array.isArray(state.bloomSprouts))) {
    herbSeeds = growingTimers(state.sprouts);
    bloomSeeds = growingTimers(state.bloomSprouts);
  } else {
    herbSeeds = wanted(state && state.seeds);
    bloomSeeds = 0;
  }
  return { herbPlants, bloomPlants, herbSeeds, bloomSeeds };
}

/**
 * Where a return's marks land on the plot: the cells whose plants matured while
 * the visitor was away, and whether a new form was reached.
 *
 * Per-plant age is not tracked, so a mark lands on the newest plants the plot
 * draws — the tail of the grown-plant run, which is where a seed that has just
 * matured sits. The count is bounded by the plants on screen, and a state with
 * no marks returns none. Pure, so a test can assert it without a canvas.
 *
 * @returns {{cells: number[], form: boolean}}
 */
export function returnMarkCells(state, bounds) {
  const marks = state && state.returnMarks;
  if (!marks) return { cells: [], form: false };
  const limit = bounds && Number.isFinite(bounds.cells) ? bounds.cells : plotBounds(state).cells;
  const { herbPlants, bloomPlants } = kindsOnPlot(state);
  const plants = Math.min(limit, herbPlants + bloomPlants);
  const marked = Number.isFinite(marks.plants) && marks.plants > 0 ? Math.floor(marks.plants) : 0;
  const count = Math.min(plants, marked);
  const cells = [];
  for (let step = 0; step < count; step += 1) cells.push(plants - 1 - step);
  return { cells, form: Boolean(marks.form) };
}
