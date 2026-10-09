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

function drawSoil(ctx, x, y, palette) {
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = palette.soil;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(x + 2, y + 2, CELL - 4, 2);
}

/** A herb seed that has just sprouted: a low shoot on a fresh mound of soil. */
function drawSprout(ctx, x, y, palette) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(centre - 4, base - 2, 8, 2);
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - 6, 2, 5);
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(centre - 4, base - 6, 3, 2);
  ctx.fillRect(centre + 2, base - 6, 3, 2);
}

/** A bloom seed that has just sprouted: a closed bud on a fresh mound of soil. */
function drawBud(ctx, x, y, palette) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  ctx.fillStyle = palette.soilLight;
  ctx.fillRect(centre - 4, base - 2, 8, 2);
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - 5, 2, 4);
  ctx.fillStyle = palette.bloom;
  ctx.fillRect(centre - 2, base - 8, 4, 3);
}

/** One herb plant on the soil, chosen by the form and grown by how full it is. */
function drawPlant(ctx, x, y, palette, index, growthTier) {
  if (index <= 4) drawHerb(ctx, x, y, palette, index, growthTier);
  else if (index === 5) drawHedge(ctx, x, y, palette, growthTier);
  else drawTree(ctx, x, y, palette, index, growthTier, false);
}

/**
 * One bloom plant: the same silhouette the form gives a herb, but always in
 * flower, so the two kinds read differently at every size — petals and a sun
 * centre where the herb carries bare leaf.
 */
function drawBloomPlant(ctx, x, y, palette, index, growthTier) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  if (index <= 4) {
    const height = 7 + index * 2 + growthTier * 3;
    ctx.fillStyle = palette.leafDeep;
    ctx.fillRect(centre - 1, base - height, 2, height);
    ctx.fillStyle = palette.leaf;
    ctx.fillRect(centre - 5, base - height + 3, 4, 3);
    ctx.fillRect(centre + 2, base - height + 5, 4, 3);
    // The head: petals in the bloom colour around a sun centre.
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(centre - 3, base - height - 4, 6, 4);
    ctx.fillRect(centre - 1, base - height - 6, 2, 2);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 1, base - height - 3, 2, 2);
  } else if (index === 5) {
    drawHedge(ctx, x, y, palette, growthTier);
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(x + 5, y + CELL - 12, 2, 2);
    ctx.fillRect(x + CELL - 9, y + CELL - 8, 2, 2);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(x + CELL - 12, y + CELL - 11, 2, 2);
  } else {
    drawTree(ctx, x, y, palette, index, growthTier, true);
  }
}

/** A thin shoot — a sprout, a seedling, or a stand of them, taller as it grows. */
function drawHerb(ctx, x, y, palette, index, growthTier) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  const height = 7 + index * 2 + growthTier * 3;
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(centre - 1, base - height, 2, height);
  ctx.fillStyle = palette.leaf;
  ctx.fillRect(centre - 5, base - height + 1, 4, 3);
  ctx.fillRect(centre + 2, base - height + 4, 4, 3);
  if (index >= 2) ctx.fillRect(centre - 5, base - height + 7, 4, 3);
  if (index >= 4) {
    ctx.fillStyle = palette.sun;
    ctx.fillRect(centre - 2, base - height - 3, 4, 4);
  }
}

/** A low leafy mass, close to the ground. */
function drawHedge(ctx, x, y, palette, growthTier) {
  const base = y + CELL;
  const height = 8 + growthTier * 3;
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(x + 2, base - height, CELL - 4, height);
  ctx.fillStyle = palette.leaf;
  ctx.fillRect(x + 4, base - height + 2, CELL - 8, height - 4);
  ctx.fillStyle = palette.leafLight;
  ctx.fillRect(x + 6, base - height + 3, CELL - 12, 2);
}

/**
 * A trunk under a canopy that grows with the form. A herb carries its own
 * bloom only from the eighth form on; a bloom plant (`flowered`) is covered in
 * flower from the first tree on, so the kinds stay apart however tall they grow.
 */
function drawTree(ctx, x, y, palette, index, growthTier, flowered) {
  const base = y + CELL;
  const centre = x + CELL / 2;
  const trunkHeight = 6 + growthTier * 2;
  ctx.fillStyle = palette.soilDeep;
  ctx.fillRect(centre - 2, base - trunkHeight, 4, trunkHeight);

  const canopyHeight = 6 + (index - 6) + growthTier * 2;
  const canopyWidth = Math.min(CELL - 2, 10 + (index - 6) * 2);
  const canopyBottom = base - trunkHeight;
  const canopyTop = canopyBottom - canopyHeight;
  const left = Math.round(centre - canopyWidth / 2);
  ctx.fillStyle = palette.leafDeep;
  ctx.fillRect(left, canopyTop, canopyWidth, canopyHeight);
  ctx.fillStyle = palette.leaf;
  ctx.fillRect(left + 2, canopyTop + 2, canopyWidth - 4, canopyHeight - 4);
  if (index >= 8 || flowered) {
    ctx.fillStyle = palette.bloom;
    ctx.fillRect(left + 3, canopyTop + 3, 2, 2);
    ctx.fillRect(left + canopyWidth - 6, canopyTop + 5, 2, 2);
    ctx.fillRect(left + Math.floor(canopyWidth / 2), canopyTop + 1, 2, 2);
    ctx.fillStyle = palette.sun;
    ctx.fillRect(left + 6, canopyTop + 5, 2, 2);
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
function drawPollinator(ctx, x, y, palette) {
  const centre = x + CELL / 2;
  const top = y + 2;
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
 * The picture is a pure view of the state: the form and the beds of soil set how
 * much ground there is and how big a grown plant is, and the plot's own counts
 * say what stands on it — the grown plants first, then the sprouting seeds, then
 * bare soil. The same amount always draws the same way, and every colour comes
 * from the palette read off `:root`, so the plot belongs to the same garden as
 * the panels around it. The number of sprites is bounded by the cells on screen,
 * so a save carrying more plants than plots cannot flood the picture.
 */
export function drawGarden(canvas, state, palette) {
  if (!canvas || !palette) return;
  const growth = state && Number.isFinite(state.growth) ? state.growth : 0;
  const form = gardenForm(growth);
  const rows = Math.min(MAX_ROWS, rowsForForm(form.index) + (bedsFor(state) - 1) * ROWS_PER_BED);
  const cells = rows * COLUMNS;
  const width = COLUMNS * CELL;
  const height = rows * CELL;
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
  for (let cell = 0; cell < cells; cell += 1) {
    const x = (cell % COLUMNS) * CELL;
    const y = Math.floor(cell / COLUMNS) * CELL;
    drawSoil(ctx, x, y, palette);
    if (cell < kinds.herbPlants) drawPlant(ctx, x, y, palette, form.index, growthTier);
    else if (cell < plants) drawBloomPlant(ctx, x, y, palette, form.index, growthTier);
    else if (cell < plants + kinds.herbSeeds) drawSprout(ctx, x, y, palette);
    else if (cell < plants + sprouts) drawBud(ctx, x, y, palette);
  }
  // A visit is drawn over the first plant, the one the bee lands on; with no
  // plants there is nowhere for it to visit.
  if (plants > 0 && state && state.pollinator && state.pollinator.visiting) {
    drawPollinator(ctx, 0, 0, palette);
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
