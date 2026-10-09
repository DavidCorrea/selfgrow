/**
 * selfgrow — the garden's sample state.
 *
 * This first page holds one thing a visitor can change: how many seeds have
 * been planted. It exists to prove the look — palette, pixel font, panel and
 * button — and it is the seed the rest of the garden grows from. The plot holds
 * a fixed number of sprouts; the seed count keeps going past it, so the picture
 * stays bounded while the number grows.
 */

const PLOT_CAPACITY = 8;

// How a sprout is drawn: solid pixels on a 5-by-6 grid, coloured by CSS classes
// that draw from the palette. Kept here rather than in the markup so the sprite
// and the seedbed always have the same shape.
const SPRITE_PIXELS = [
  { className: "sprout-stem", x: 2, y: 2, width: 1, height: 4 },
  { className: "sprout-leaf", x: 0, y: 3, width: 2, height: 1 },
  { className: "sprout-leaf", x: 3, y: 2, width: 2, height: 1 },
  { className: "sprout-bloom", x: 2, y: 0, width: 1, height: 2 },
];

const SVG_NS = "http://www.w3.org/2000/svg";

let seedsPlanted = 0;

const seedCountEl = document.getElementById("seed-count");
const seedbedEl = document.getElementById("seedbed");

function makeSprout() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "sprout");
  svg.setAttribute("viewBox", "0 0 5 6");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const pixel of SPRITE_PIXELS) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", pixel.className);
    rect.setAttribute("x", pixel.x);
    rect.setAttribute("y", pixel.y);
    rect.setAttribute("width", pixel.width);
    rect.setAttribute("height", pixel.height);
    svg.appendChild(rect);
  }
  return svg;
}

function makeCell() {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.appendChild(makeSprout());
  return cell;
}

function buildSeedbed() {
  if (!seedbedEl) return;
  seedbedEl.replaceChildren(...Array.from({ length: PLOT_CAPACITY }, makeCell));
}

/** Show the current count and grow a sprout for every seed the plot has room for. */
export function render() {
  if (seedCountEl) seedCountEl.textContent = String(seedsPlanted);
  if (!seedbedEl) return;
  const grown = Math.min(seedsPlanted, PLOT_CAPACITY);
  [...seedbedEl.children].forEach((cell, index) => {
    cell.classList.toggle("is-grown", index < grown);
  });
}

/** Everything the page shows a visitor right now. */
export function getState() {
  return {
    seeds: seedsPlanted,
    sprouts: Math.min(seedsPlanted, PLOT_CAPACITY),
    plotCapacity: PLOT_CAPACITY,
  };
}

/** Plant one seed and return the state after it. */
export function plantSeed() {
  seedsPlanted += 1;
  render();
  return getState();
}

buildSeedbed();
render();

document.getElementById("plant-seed")?.addEventListener("click", () => plantSeed());