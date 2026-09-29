/**
 * sprites.js — the game's pixel art, drawn in code.
 *
 * Every picture is a 16×16 grid of single-character cells turned into real
 * SVG <rect> elements, so the art is page elements a screen reader and the
 * build's app review can both inspect — never one opaque canvas. The colours
 * are the same palette the rest of the page already uses, and each sprite is
 * crisp at any size because the browser scales whole pixels
 * (shape-rendering: crispEdges).
 *
 * @module sprites
 */

/** Character → colour. Every value is a colour already used on the page. */
export const SPRITE_PALETTE = {
  G: "#00ff88", // highlight green
  g: "#66aa88", // sandbox green
  d: "#448866", // sandbox border green
  B: "#aa8866", // wall brown
  b: "#775533", // wall border brown
  S: "#8899cc", // stone
  s: "#5566aa", // stone border
  A: "#8888aa", // text-dim metal
  L: "#e0e0e0", // text light
  F: "#ff8844", // forge
  f: "#cc6622", // forge border
  M: "#ff66aa", // map
  m: "#cc4488", // map border
  Y: "#ffd700", // accent gold
};

/**
 * One 16×16 grid per sprite name. A "." is transparent; every other character
 * is looked up in SPRITE_PALETTE. Rows run top to bottom, left to right.
 */
export const SPRITE_GRIDS = {
  // The tree a player chops for wood.
  tree: [
    "................",
    "......dGGd......",
    "....dGGGGGGd....",
    "...dGGGGGGGGd...",
    "..dGGGGGGGGGGd..",
    ".dGGGGGGGGGGGGd.",
    "dGGGGGGGGGGGGGGd",
    "dGGGGgGGGGgGGGGd",
    "dGGGgGGGGGGgGGGd",
    ".dGGGGGGGGGGGGd.",
    "..dGGGGGGGGGGd..",
    "...dGGGGGGGGd...",
    ".......BB.......",
    ".......BB.......",
    "......BBBB......",
    ".....bBBBBb.....",
  ],
  // The rock a player mines for stone.
  rock: [
    "................",
    "................",
    "......ssss......",
    "....ssSSSSss....",
    "...sSSSSSSSSs...",
    "..sSSSSSSSSSSs..",
    ".sSSSSLLSSSSSSs.",
    "sSSSSLLLSSSSSSSs",
    "sSSSSLLSSSSSSSSs",
    "sSSSSSSSSSSSSSSs",
    ".sSSSSSSSSSSSSs.",
    "..sSSSSSSSSSSs..",
    "...ssSSSSSSss...",
    ".....ssssss.....",
    "................",
    "................",
  ],
  // The anvil a player forges a tool on.
  anvil: [
    "................",
    "................",
    "....LLLLLLLL....",
    "...LLLLLLLLLL...",
    "..LLAAAAAAAAAL..",
    "....AAAAAAAA....",
    ".....AAAAAA.....",
    ".....AAAAAA.....",
    "....AAAAAAAA....",
    "...AAAAAAAAAA...",
    "..AAAAAAAAAAAA..",
    "..AAAAAAAAAAAA..",
    "................",
    "................",
    "................",
    "................",
  ],
  // The map a player sends an expedition with.
  map: [
    "................",
    "..MMMMMMMMMMMM..",
    "..MLLLLLLLLLLM..",
    "..MLLLLYLLLLLM..",
    "..MLLLLLYLLLLM..",
    "..MLLYLLLLLLLM..",
    "..MLLLLLLYLLLM..",
    "..MLLYLLLLLLLM..",
    "..MLLLLYLLLLLM..",
    "..MLLLLLLLLLLM..",
    "..MLLLLLLLLLLM..",
    "..MMMMMMMMMMMM..",
    "................",
    "................",
    "................",
    "................",
  ],
};

/** The accessible name of each picture, announced where the picture is used. */
export const SPRITE_LABELS = {
  tree: "Tree",
  rock: "Rock",
  anvil: "Anvil",
  map: "Map",
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const GRID_SIZE = 16;

/**
 * Build the SVG for one named sprite: a 16×16 viewBox with one <rect> per
 * filled cell, so the art is ordinary page elements.
 *
 * @param {keyof typeof SPRITE_GRIDS} name
 * @returns {SVGSVGElement}
 */
export function createSpriteSvg(name) {
  const grid = SPRITE_GRIDS[name];
  if (!grid) {
    throw new Error(`createSpriteSvg: unknown sprite "${name}".`);
  }

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${GRID_SIZE} ${GRID_SIZE}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", SPRITE_LABELS[name]);
  svg.dataset.sprite = name;
  svg.classList.add("sprite-svg");

  grid.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const fill = SPRITE_PALETTE[cell];
      if (!fill) return;
      const rect = document.createElementNS(SVG_NAMESPACE, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", "1");
      rect.setAttribute("height", "1");
      rect.setAttribute("fill", fill);
      svg.appendChild(rect);
    });
  });

  return svg;
}
