/**
 * Pixel-art sprites, drawn in code as inline SVG.
 *
 * Every sprite is a 12x12 grid of single characters. "." is transparent and
 * every other character maps to one colour in the game's existing CSS palette,
 * so the art can only ever use colours the rest of the page already uses.
 *
 * Each sprite becomes a real `<svg>` of one `<rect>` per filled cell — page
 * elements, never a canvas — so it scales crisply, reads as structure to the
 * DOM, and can sit inside a button without hiding the real text beside it.
 */

/** Character-to-colour map, using only the game's existing palette. */
export const SPRITE_PALETTE = {
  "#": "#0a0a0f", // page background — outlines
  g: "#00ff88", // highlight green — leaves
  b: "#8899cc", // stone blue-grey
  s: "#8888aa", // dim grey — shadow / trunk
  o: "#ff8844", // forge orange
  p: "#ff66aa", // map pink
  y: "#ffd700", // accent gold
  r: "#ff6b35", // panel orange
  w: "#e0e0e0", // text white
};

/** 12x12 character grids, one per system's gather action. */
export const SPRITES = {
  // A tree to chop.
  wood: [
    ".....gg.....",
    "....gggg....",
    "...gggggg...",
    "..gggggggg..",
    ".gggggggggg.",
    "gggggggggggg",
    ".gggggggggg.",
    "..gggggggg..",
    "...gggggg...",
    ".....ss.....",
    ".....ss.....",
    "....ssss....",
  ],
  // A rock to mine: outlined so it reads on the stone-coloured button.
  stone: [
    "............",
    "....####....",
    "..##bbbb##..",
    ".#bbsbbbbb#.",
    "#bbsbbbbbbb#",
    "#bbbbbbbbbb#",
    "#bbbbbbbbbb#",
    ".#bbbbbbbb#.",
    "..##bbbb##..",
    "...##bb##...",
    "....####....",
    "............",
  ],
  // An anvil to forge on: steel grey with a dark outline on the orange button.
  forge: [
    "............",
    "...######...",
    "..#ssssss#..",
    "..#ssssss#..",
    ".#ssssssss#.",
    ".#ssssssss#.",
    "#ssssssssss#",
    "#ssssssssss#",
    "..########..",
    "..########..",
    ".##########.",
    "............",
  ],
  // A map to send an expedition by: gold parchment on the pink button.
  expedition: [
    "............",
    ".##########.",
    ".#yyyyyyyy#.",
    ".#yrrrrrry#.",
    ".#yyrrrryy#.",
    ".#yyyyyyyy#.",
    ".#yrrrrrry#.",
    ".#yyyyyyyy#.",
    ".#yyyyyyyy#.",
    ".....#......",
    ".....#......",
    "############",
  ],
};

/** The CSS class each kind's reaction animates (see index.html keyframes). */
const REACTION_CLASSES = {
  wood: "react-wood",
  stone: "react-stone",
  forge: "react-forge",
  expedition: "react-expedition",
};

const REACTION_MS = 420;
const FLOAT_MS = 720;

/**
 * Build one sprite as an inline SVG string.
 *
 * @param {string} kind  key in SPRITES, e.g. "wood"
 * @returns {string} an `<svg class="sprite">` with one `<rect>` per filled cell
 */
export function spriteSvg(kind) {
  const grid = SPRITES[kind];
  if (!grid) throw new Error("Unknown sprite kind: " + kind);

  const rects = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const fill = SPRITE_PALETTE[row[x]];
      if (!fill) continue;
      rects.push(
        '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill + '"/>'
      );
    }
  }

  return '<svg class="sprite" data-sprite-kind="' + kind + '"'
    + ' viewBox="0 0 12 12" shape-rendering="crispEdges"'
    + ' focusable="false" aria-hidden="true">'
    + rects.join("")
    + "</svg>";
}

/** Replace a mount element's contents with the named sprite. */
export function mountSprite(container, kind) {
  if (!container) return;
  container.innerHTML = spriteSvg(kind);
}

/** Mount every `[data-sprite]` placeholder under `root`, once at init. */
export function mountSprites(root = document) {
  for (const mount of root.querySelectorAll("[data-sprite]")) {
    mountSprite(mount, mount.dataset.sprite);
  }
}

/** Whether the visitor has asked their system to reduce motion. */
export function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Show that using a system's picture did something.
 *
 * Adds the kind's short reaction class to the button (tree shakes, rock chips,
 * anvil sparks, map sways) and floats an aria-hidden "+N" up out of it. With
 * reduced motion on it does neither — the picture stays exactly as it is.
 *
 * @param {HTMLElement} button  the action button the picture belongs to
 * @param {string} kind         key in SPRITES
 * @param {{ reduced?: boolean, gain: string|number }} options
 */
export function playReaction(button, kind, { reduced = prefersReducedMotion(), gain } = {}) {
  if (reduced || !button) return;

  for (const cls of Object.values(REACTION_CLASSES)) button.classList.remove(cls);
  // Restart the animation if the same picture is used again immediately.
  void button.offsetWidth;
  const reactionClass = REACTION_CLASSES[kind];
  if (reactionClass) {
    button.classList.add(reactionClass);
    setTimeout(() => button.classList.remove(reactionClass), REACTION_MS);
  }

  const stale = button.querySelector(".float-gain");
  if (stale) stale.remove();
  const float = document.createElement("span");
  float.className = "float-gain";
  float.setAttribute("aria-hidden", "true");
  float.textContent = "+" + gain;
  button.appendChild(float);
  setTimeout(() => float.remove(), FLOAT_MS);
}
