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

/** The growth at which the form at `index` gives way to the next one. */
function nextThreshold(index) {
  if (index + 1 < FORMS.length) return FORMS[index + 1].at;
  return FORMS[index].at * LAST_STRIDE;
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
  const nextAt = nextThreshold(index);
  return { index, name: FORMS[index].name, at, nextAt, fill: fillWithin(amount, at, nextAt) };
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

// --- Drawing the form on the soil -------------------------------------------
//
// The plot is a small grid of soil cells drawn at whole-pixel sizes and scaled
// up by CSS with `image-rendering: pixelated`. The ground widens as the garden
// rises through forms and widens again with every bed of soil opened, while a
// bounded number of plants stands on it — never more plants than there is
// ground, so a month of growth cannot flood the picture.

/** One cell of soil, in canvas pixels. */
const CELL = 24;
const COLUMNS = 6;
const BASE_ROWS = 2;
const MAX_ROWS = 10;
const FORMS_PER_ROW = 3;
// Every bed beyond the first widens the drawn ground by two rows of soil, so
// opening a bed is visible, while the row cap keeps the sprite count bounded.
const ROWS_PER_BED = 2;

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
 * The plot's pixel bounds for `state`: the grid of soil cells it draws and the
 * sprite cap that grid imposes. Every garden, however large, is drawn inside
 * these bounds, so the number of sprites can never grow with the save.
 */
export function plotBounds(state) {
  const growth = state && Number.isFinite(state.growth) ? state.growth : 0;
  const wanted = rowsForForm(gardenForm(growth).index) + (bedsFor(state) - 1) * ROWS_PER_BED;
  const rows = Math.min(MAX_ROWS, wanted);
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

/**
 * One cell of soil. In autumn a few fallen leaves lie on some of the cells, so
 * the turned season reads on the ground and not only in the canopy.
 */
function drawSoil(ctx, x, y, palette, foliage, cell) {
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = palette.soil;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(x + 2, y + 2, CELL - 4, 2);
  if (foliage === "turning" && cell % 3 === 1) {
    ctx.fillStyle = palette.leafDeep;
    ctx.fillRect(x + 5, y + CELL - 8, 3, 2);
    ctx.fillStyle = palette.leafLight;
    ctx.fillRect(x + CELL - 9, y + CELL - 12, 3, 2);
  }
}

/**
 * The low growth the garden's own form lays over a covered cell: short blades of
 * young leaf spread across the soil.
 *
 * It is drawn in the season's own leaf colours and kept well below the planted
 * sprites, so it reads as ground the garden has taken rather than a plant — and
 * the taller herb and bloom silhouettes still stand out of it. `cell` varies
 * the blades, so a filled plot looks like many shoots and not one stamp.
 */
function drawGroundGrowth(ctx, x, y, palette, cell) {
  const base = y + CELL;
  // Four blades whose spacing and height come from the cell's own hash, so the
  // cover is uneven ground rather than a mown lawn.
  for (let i = 0; i < 4; i += 1) {
    const across = 2 + i * 5 + Math.floor(cellHash(cell + i * 29) * 3);
    const height = 2 + Math.floor(cellHash(cell + i * 71) * 3);
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(x + across, base - height, 2, height);
  }
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(x + 3, base - 3, 4, 1);
  ctx.fillRect(x + CELL - 9, base - 4, 5, 1);
}

/**
 * A herb seed that has just sprouted: a low shoot on a fresh mound of soil. Its
 * leaves `dx` sway while the shoot stays rooted.
 */
function drawSprout(ctx, x, y, palette, dx) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(centre - 4, base - 2, 8, 2);
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - 6, 2, 5);
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(centre - 4 + dx, base - 6, 3, 2);
  ctx.fillRect(centre + 2 + dx, base - 6, 3, 2);
}

/**
 * A bloom seed that has just sprouted: a bud on a fresh mound of soil. `open`
 * is the second step of the animation — the closed bud opens its petals around
 * a sun centre, so a sprout visibly opens into a plant.
 */
function drawBud(ctx, x, y, palette, open) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(centre - 4, base - 2, 8, 2);
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - 5, 2, 4);
  ctx.fillStyle = palette.bloom;
  if (open) {
    ctx.fillRect(centre - 4, base - 8, 3, 3);
    ctx.fillRect(centre + 1, base - 8, 3, 3);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 1, base - 7, 2, 2);
  } else {
    ctx.fillRect(centre - 2, base - 8, 4, 3);
  }
}

/** One herb plant on the soil, chosen by the form and grown by how full it is. */
function drawPlant(ctx, x, y, palette, foliage, index, growthTier, dx) {
  if (index <= 4) drawHerb(ctx, x, y, palette, index, growthTier, dx);
  else if (index === 5) drawHedge(ctx, x, y, palette, growthTier, dx, foliage);
  else drawTree(ctx, x, y, palette, index, growthTier, false, dx, foliage);
}

/**
 * One bloom plant: the same silhouette the form gives a herb, but always in
 * flower, so the two kinds read differently at every size — petals and a sun
 * centre where the herb carries bare leaf.
 */
function drawBloomPlant(ctx, x, y, palette, foliage, index, growthTier, dx) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  if (index <= 4) {
    const height = 7 + index * 2 + growthTier * 3;
    ctx.fillStyle = palette.leafDeep;
    ctx.fillRect(centre - 1, base - height, 2, height);
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(centre - 5 + dx, base - height + 3, 4, 3);
    ctx.fillRect(centre + 2 + dx, base - height + 5, 4, 3);
    // The head: petals in the bloom colour around a sun centre.
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(centre - 3 + dx, base - height - 4, 6, 4);
    ctx.fillRect(centre - 1 + dx, base - height - 6, 2, 2);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 1 + dx, base - height - 3, 2, 2);
  } else if (index === 5) {
    drawHedge(ctx, x, y, palette, growthTier, dx, foliage);
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(x + 5 + dx, y + CELL - 12, 2, 2);
    ctx.fillRect(x + CELL - 9 + dx, y + CELL - 8, 2, 2);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(x + CELL - 12 + dx, y + CELL - 11, 2, 2);
  } else {
    drawTree(ctx, x, y, palette, index, growthTier, true, dx, foliage);
  }
}

/** A thin shoot — a sprout, a seedling, or a stand of them, taller as it grows. */
function drawHerb(ctx, x, y, palette, index, growthTier, dx) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  const height = 7 + index * 2 + growthTier * 3;
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - height, 2, height);
  ctx.fillStyle = palette.leaf;
  ctx.fillRect(centre - 5 + dx, base - height + 1, 4, 3);
  ctx.fillRect(centre + 2 + dx, base - height + 4, 4, 3);
  if (index >= 2) ctx.fillRect(centre - 5 + dx, base - height + 7, 4, 3);
  if (index >= 4) {
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 2 + dx, base - height - 3, 4, 4);
  }
}

/** A low leafy mass, close to the ground; its whole crown sways by `dx`. */
function drawHedge(ctx, x, y, palette, growthTier, dx, foliage) {
  const base = y + CELL;
  const height = 8 + growthTier * 3;
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(x + 2 + dx, base - height, CELL - 4, height);
  ctx.fillStyle = palette.leaf;
  ctx.fillRect(x + 4 + dx, base - height + 2, CELL - 8, height - 4);
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(x + 6 + dx, base - height + 3, CELL - 12, 2);
  if (foliage === "blossom") {
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(x + 7 + dx, base - height + 5, 2, 2);
    ctx.fillRect(x + CELL - 11 + dx, base - height + 7, 2, 2);
  }
}

/**
 * A trunk under a canopy that grows with the form. A herb carries its own
 * bloom only from the eighth form on; a bloom plant (`flowered`) is covered in
 * flower from the first tree on, so the kinds stay apart however tall they grow.
 * In winter the canopy falls to bare twigs; in spring it carries blossom.
 */
function drawTree(ctx, x, y, palette, index, growthTier, flowered, dx, foliage) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  const trunkHeight = 6 + growthTier * 2;
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 2, base - trunkHeight, 4, trunkHeight);

  const canopyHeight = 6 + (index - 6) + growthTier * 2;
  const canopyWidth = Math.min(CELL - 2, 10 + (index - 6) * 2);
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
    ctx.fillRect(left + 3, canopyTop + 3, 2, 2);
    ctx.fillRect(left + canopyWidth - 6, canopyTop + 5, 2, 2);
    ctx.fillRect(left + Math.floor(canopyWidth / 2), canopyTop + 1, 2, 2);
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
 * A visitor on the plot: a small bee hovering above the first grown plant.
 *
 * Drawn from the same `:root` palette as everything else — a sun body with
 * dark stripes and bloom wings — so it belongs to the garden rather than
 * looking pasted on. It is never the only account of the visit: the readout
 * and `get-state` name the pollinator and the boost it brings.
 */
function drawPollinator(ctx, x, y, palette, driftX, driftY) {
  const centre = x + CELL / 2 + driftX;
  const top = y + 2 + driftY;
  ctx.fillStyle = palette.bloom;
  ctx.fillRect(centre - 6, top - 2, 4, 3);
  ctx.fillRect(centre + 2, top - 2, 4, 3);
  ctx.fillStyle = palette.sun;
  ctx.fillRect(centre - 4, top, 8, 5);
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 4, top + 1, 8, 1);
  ctx.fillRect(centre - 4, top + 3, 8, 1);
}

/**
 * Draw `state`'s garden onto `canvas`, painting only with `palette`.
 *
 * The picture is a pure view of the state and the animation `phase`: the form and
 * the beds of soil set how much ground there is and how big a grown plant is,
 * the garden's own growth covers that ground with low growth so a low-plant,
 * high-growth garden still visibly fills, the season the state names sets the
 * foliage colours and shape, and the plot's own counts say what stands on it —
 * the grown plants first, then the sprouting seeds, then bare soil. The season
 * is read from `state.season.key`, which is the same value the readout and
 * `get-state` report, so the picture and the words
 * cannot disagree. The same state and phase always draw the same way, and every
 * colour comes from the palette read off `:root`, so the plot belongs to the same
 * garden as the panels around it. The number of sprites is bounded by the cells
 * on screen, so a save carrying more plants than plots cannot flood the picture.
 */
export function drawGarden(canvas, state, palette, phase = 0) {
  if (!canvas || !palette) return;
  const growth = state && Number.isFinite(state.growth) ? state.growth : 0;
  const form = gardenForm(growth);
  const look = seasonLook(palette, state?.season?.key);
  const paint = look.palette;
  const { cells, width, height } = plotBounds(state);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  const kinds = kindsOnPlot(state);
  // Seeds only take the ground the grown plants have not already filled.
  const plants = Math.min(cells, kinds.herbPlants + kinds.bloomPlants);
  const sprouts = Math.min(cells - plants, kinds.herbSeeds + kinds.bloomSeeds);
  const growthTier = Math.min(2, Math.floor(form.fill * 3));
  // The garden's own growth, not only the plants it owns, fills the soil.
  const cover = groundCover(state);
  for (let cell = 0; cell < cells; cell += 1) {
    const x = (cell % COLUMNS) * CELL;
    const y = Math.floor(cell / COLUMNS) * CELL;
    const sway = swayPixels(phase, cell);
    drawSoil(ctx, x, y, paint, look.foliage, cell);
    // Ground growth goes on first, so the planted sprites stand out of it.
    if (cellHash(cell) < cover.ratio) drawGroundGrowth(ctx, x, y, paint, cell);
    if (cell < kinds.herbPlants) drawPlant(ctx, x, y, paint, look.foliage, form.index, growthTier, sway);
    else if (cell < plants) drawBloomPlant(ctx, x, y, paint, look.foliage, form.index, growthTier, sway);
    else if (cell < plants + kinds.herbSeeds) drawSprout(ctx, x, y, paint, sway);
    // A bud holds each step for two ticks, so it opens and closes at a calmer
    // beat than the sway.
    else if (cell < plants + sprouts) drawBud(ctx, x, y, paint, Math.floor((phase + cell) / 2) % 2 === 0);
  }
  // A visit is drawn over the first plant, the one the bee lands on; with no
  // plants there is nowhere for it to visit. It drifts a pixel or two on the
  // breeze rather than hovering dead still.
  if (plants > 0 && state && state.pollinator && state.pollinator.visiting) {
    drawPollinator(ctx, 0, 0, paint, swayPixels(phase, 1), swayPixels(phase, 3));
  }
}

/**
 * How many of each kind stand on the plot: grown plants and ungrown seeds,
 * herb and bloom.
 *
 * A state carries its per-kind counts in `plantCounts`/`seedCounts` (what the
 * page passes); a state that only knew the one kind falls back to its totals as
 * herb, so an old caller draws exactly what it always drew. The counts are
 * floored at the cells on screen by `drawGarden`, not here.
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
