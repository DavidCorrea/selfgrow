/**
 * Pixel-art sprites, drawn in code as inline SVG.
 *
 * Every sprite is a 12x12 grid of single characters. "." is transparent and
 * every other character maps to one colour in the game's existing CSS palette,
 * so the art can only ever use colours the rest of the page already uses.
 *
 * Each kind ships several stages and the system's level picks one, so a card's
 * picture shows how far that system has grown rather than merely existing.
 * Stage 0 is always the base picture, so a fresh system looks untouched.
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

/**
 * The level a system must reach before its picture advances to that stage.
 * One shared table for every kind keeps the four pictures advancing together;
 * index 0 is level 0, so a starting system always draws the base picture.
 */
const SPRITE_STAGE_THRESHOLDS = [0, 1, 3, 6];

/**
 * Staged 12x12 character grids, one list per system's gather action.
 * Within a list, index 0 is the base picture the system starts at.
 */
export const SPRITE_STAGES = {
  // A tree to chop — the canopy grows and fruits as the axe sharpens.
  wood: [
    [
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
    [
      "......gg....",
      ".....gggg...",
      "....gggggg..",
      "...gggggggg.",
      "..gggggggggg",
      ".ggggggggggg",
      "gggggggggggg",
      ".gggggggggg.",
      "..gggggggg..",
      "...gggggg...",
      ".....ss.....",
      "....ssss....",
    ],
    [
      ".....gggg...",
      "....gggggg..",
      "...gggggggg.",
      "..gggggggggg",
      ".ggggggggggg",
      "gggggggggggg",
      ".gggggggggg.",
      "..gggggggg..",
      "...gggggg...",
      ".....yy.....",
      ".....ss.....",
      "....ssss....",
    ],
    [
      "....gggggg..",
      "...gggggggg.",
      "..gggggggggg",
      ".ggggggggggg",
      "gggggggggggg",
      "gggggggggggg",
      ".gggggggggg.",
      "..gggggggg..",
      "...gggggg...",
      "....y..y....",
      ".....ss.....",
      "....ssss....",
    ],
  ],
  // A rock to mine: outlined so it reads on the stone-coloured button. Walls
  // rise around it as more are built.
  stone: [
    [
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
    [
      "............",
      "....####....",
      "..##bbbb##..",
      ".#bbsbbbbb#.",
      "#bbsbbbbbbb#",
      "#bbbbbbbbbb#",
      "#bbbbbbbbbb#",
      ".#bbbbbbbb#.",
      "..##bbbb##..",
      "..###bb###..",
      ".##b####b##.",
      "##bb####bb##",
    ],
    [
      "............",
      "....####....",
      "..##bbbb##..",
      ".#bbsbbbbb#.",
      "#bbsbbbbbbb#",
      "#bbbbbbbbbb#",
      "#bbbbbbbbbb#",
      "##bbbbbbbb##",
      "###bbbbbb###",
      "##.##bb##.##",
      "##.######.##",
      "##.######.##",
    ],
    [
      "....####....",
      "..##bbbb##..",
      ".#bbsbbbbb#.",
      "#bbsbbbbbbb#",
      "#bbbbbbbbbb#",
      "#bbbbbbbbbb#",
      ".#bbbbbbbb#.",
      "..########..",
      "..#......#..",
      "..#.####.#..",
      "..#.#bb#.#..",
      "..########..",
    ],
  ],
  // An anvil to forge on: steel grey with a dark outline on the orange button.
  // Gold glow gathers around it as the forge levels rise.
  forge: [
    [
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
    [
      ".....yy.....",
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
      "..y......y..",
    ],
    [
      "....y..y....",
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
      ".y.o....o.y.",
    ],
    [
      ".y........y.",
      "y..######..y",
      ".y#ssssss#y.",
      "..#ssssss#..",
      ".#ssssssss#.",
      "y#ssssssss#y",
      "#ssssssssss#",
      "#ssssssssss#",
      "..########..",
      "y.########.y",
      ".##########.",
      "yy.o....o.yy",
    ],
  ],
  // A map to send an expedition by: gold parchment on the pink button. Routes
  // and markers fill in as more maps are earned.
  expedition: [
    [
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
    [
      "............",
      ".##########.",
      ".#yyyyyyyy#.",
      ".#yrrrrrry#.",
      ".#yyrrrryy#.",
      ".#yyyppyyy#.",
      ".#yrrrrrry#.",
      ".#yyyyyyyy#.",
      ".#yyyyyyyy#.",
      ".....#......",
      ".....#......",
      "############",
    ],
    [
      "............",
      ".##########.",
      ".#yyyyyyyy#.",
      ".#yrrrrrry#.",
      ".#yyrrrryy#.",
      ".#yppppppy#.",
      ".#yrrrrrry#.",
      ".#yypyyppy#.",
      ".#yyyyyyyy#.",
      ".....#......",
      ".....#......",
      "############",
    ],
    [
      "............",
      ".##########.",
      ".#yyyyyyyy#.",
      ".#yyyrryyy#.",
      ".#yyyrryyy#.",
      ".#yppppppy#.",
      ".#yrrrrrry#.",
      ".#yypyyppy#.",
      ".#yyyyyyyy#.",
      ".....#......",
      ".....#......",
      "############",
    ],
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
 * Which stage of its picture a system is drawn at for a given level.
 *
 * @param {string} kind   key in SPRITE_STAGES, e.g. "wood"
 * @param {number} level  the system's level (0 for a fresh system)
 * @returns {number} index into SPRITE_STAGES[kind]; 0 at level 0
 */
export function spriteStage(kind, level) {
  const stages = SPRITE_STAGES[kind];
  if (!stages) throw new Error("Unknown sprite kind: " + kind);

  const reached = Number.isFinite(level) && level > 0 ? Math.floor(level) : 0;
  let stage = 0;
  for (let i = 0; i < SPRITE_STAGE_THRESHOLDS.length; i++) {
    if (reached >= SPRITE_STAGE_THRESHOLDS[i]) stage = i;
  }
  return Math.min(stage, stages.length - 1);
}

/**
 * Build one sprite as an inline SVG string.
 *
 * @param {string} kind   key in SPRITE_STAGES, e.g. "wood"
 * @param {number} level  the system's level; picks the stage drawn
 * @returns {string} an `<svg class="sprite">` with one `<rect>` per filled cell
 */
export function spriteSvg(kind, level = 0) {
  const stages = SPRITE_STAGES[kind];
  if (!stages) throw new Error("Unknown sprite kind: " + kind);
  const grid = stages[spriteStage(kind, level)];

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
    + ' data-sprite-stage="' + spriteStage(kind, level) + '"'
    + ' viewBox="0 0 12 12" shape-rendering="crispEdges"'
    + ' focusable="false" aria-hidden="true">'
    + rects.join("")
    + "</svg>";
}

/** Replace a mount element's contents with the named sprite at `level`. */
export function mountSprite(container, kind, level = 0) {
  if (!container) return;
  container.innerHTML = spriteSvg(kind, level);
  container.dataset.spriteStage = String(spriteStage(kind, level));
}

/** Mount every `[data-sprite]` placeholder under `root` at its base stage. */
export function mountSprites(root = document) {
  for (const mount of root.querySelectorAll("[data-sprite]")) {
    mountSprite(mount, mount.dataset.sprite);
  }
}

/**
 * Redraw every `[data-sprite]` mount under `root` at its system's level.
 *
 * The 500ms render loop calls this constantly, so a mount is only rebuilt when
 * its computed stage actually changed — the DOM never thrashes, and the card
 * picture and the header chip for a kind stay byte-identical.
 *
 * @param {Document|HTMLElement} root  subtree holding the sprite mounts
 * @param {Record<string, number>} levels  kind -> the level to draw it at
 */
export function updateSprites(root = document, levels = {}) {
  for (const mount of root.querySelectorAll("[data-sprite]")) {
    const kind = mount.dataset.sprite;
    const level = levels[kind] || 0;
    if (Number(mount.dataset.spriteStage) === spriteStage(kind, level)) continue;
    mountSprite(mount, kind, level);
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
 * @param {string} kind         key in SPRITE_STAGES
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
