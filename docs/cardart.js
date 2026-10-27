/**
 * selfgrow — the picture on every card.
 *
 * Each card is drawn here, once, as a flat silhouette inside one shared frame,
 * so a player learns the cards by sight the way a real card is learned, and a
 * card added later belongs with the ones already on the table. Nothing is
 * fetched: every drawing is inline SVG built from the same handful of shapes, so
 * the page makes no request that leaves its own origin and there is no build
 * step between a card and its picture.
 *
 * The art style, written down once so the next card can be drawn to match:
 *
 *   - Medium. A flat vector silhouette — one creature per card, a single solid
 *     mass with no outline of its own, no gradients and no shadows, the way a
 *     stamp prints.
 *   - Palette. The card's own tokens, taken from :root in styles.css. The frame
 *     is --table-lit with an --edge keyline; the creature is --foil; the one
 *     small detail a creature carries (an eye, a knot) is --on-foil, the colour
 *     the card prints on foil, so a detail reads as cut into the gold rather
 *     than smudged over it. A creature with no eye is drawn in --foil alone.
 *   - Shape language. Bodies are circles, ellipses and tapered wedges; a limb, a
 *     wing or a thorn is a wedge, never a stroke. Every creature is centred on
 *     the same ground line at y=54 and stays inside x=8..88, so every card sits
 *     the same way in the frame.
 *   - Framing. One 96x64 viewBox with a rounded frame inset 1.5 units. The frame
 *     is drawn once, by cardArtSvg, and each card's `inner` markup is only the
 *     creature inside it — so no card can be framed differently from another.
 *   - Marks. An opponent's sigil is the same language without the card frame: one
 *     solid mark in a 24x24 square, drawn in that opponent's accent instead of
 *     the foil, so opponents are told apart by what their mark is, not only by
 *     its colour.
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * The art style, as data: the palette by token and the shape language in words.
 * The pictures are the source of truth and this names what they share, so a card
 * drawn later can be checked against it rather than guessed at.
 */
export const ART_STYLE = {
  medium: "a flat vector silhouette, one creature per card, no outlines, gradients or shadows",
  palette: {
    frame: "--table-lit",
    keyline: "--edge",
    body: "--foil",
    detail: "--on-foil",
  },
  shapeLanguage:
    "circles, ellipses and tapered wedges centred on a shared ground line at y=54, inside one 96x64 rounded frame",
};

// The frame every card is drawn inside, so the whole set is framed by one shape
// rather than by one similar shape per card. It is the only stroke in a picture.
const FRAME = '<rect class="art-frame" x="1.5" y="1.5" width="93" height="61" rx="12"/>';

// What is printed on the back of a card: the shared frame around the game's own
// mark — a foil diamond with a dark inset and a foil seed at its centre, built
// from the same shapes as the creatures, so a card turned face down is still the
// game's card rather than a grey rectangle. It is one drawing, reused for every
// hidden card, so a hand of five backs reads as five cards and not one picture.
const CARD_BACK = `
  <path class="art-body" d="M48 9 L84 32 L48 55 L12 32 Z" />
  <path class="art-accent" d="M48 21 L66 32 L48 43 L30 32 Z" />
  <circle class="art-body" cx="48" cy="32" r="4.5" />
`;

/**
 * Every card's drawing: a short description of what it shows, and the SVG markup
 * of its creature. A card with no entry here has no picture yet, and the page
 * falls back to printing its name rather than an empty frame.
 */
const CARD_ART = new Map([
  [
    "sprout",
    {
      description: "A seedling: a short stem with two leaves",
      inner: `
        <rect class="art-body" x="45.5" y="28" width="5" height="26" rx="2.5" />
        <path class="art-body" d="M48 40 C38 42 29 35 27 24 C38 22 46 28 48 40 Z" />
        <path class="art-body" d="M48 32 C58 34 67 27 69 16 C58 14 50 20 48 32 Z" />
      `,
    },
  ],
  [
    "pebble-toad",
    {
      description: "A squat toad: a low wide body, two eye bumps and splayed feet",
      inner: `
        <ellipse class="art-body" cx="48" cy="42" rx="27" ry="15" />
        <ellipse class="art-body" cx="28" cy="55" rx="7" ry="3.5" />
        <ellipse class="art-body" cx="68" cy="55" rx="7" ry="3.5" />
        <circle class="art-body" cx="34" cy="25" r="8" />
        <circle class="art-body" cx="62" cy="25" r="8" />
        <circle class="art-accent" cx="34" cy="25" r="2.8" />
        <circle class="art-accent" cx="62" cy="25" r="2.8" />
      `,
    },
  ],
  [
    "thornling",
    {
      description: "A spiked ball: a round body bristling with thorns",
      inner: `
        <path class="art-body" d="M48 10 L55 24 L70 18 L63 32 L80 34 L66 42 L76 56 L60 50 L48 62 L36 50 L20 56 L30 42 L16 34 L33 32 L26 18 L41 24 Z" />
        <circle class="art-accent" cx="42" cy="38" r="3" />
        <circle class="art-accent" cx="54" cy="38" r="3" />
      `,
    },
  ],
  [
    "sun-moth",
    {
      description: "A moth with broad wings and two antennae",
      inner: `
        <path class="art-body" d="M46 34 C34 18 16 16 12 24 C10 30 18 38 30 42 C22 44 20 50 26 54 C36 58 44 50 46 42 Z" />
        <path class="art-body" d="M50 34 C62 18 80 16 84 24 C86 30 78 38 66 42 C74 44 76 50 70 54 C60 58 52 50 50 42 Z" />
        <ellipse class="art-body" cx="48" cy="38" rx="4" ry="15" />
        <path class="art-body" d="M44 22 C40 14 34 10 30 10 L30 14 C36 15 41 19 45 25 Z" />
        <path class="art-body" d="M52 22 C56 14 62 10 66 10 L66 14 C60 15 55 19 51 25 Z" />
        <circle class="art-accent" cx="44" cy="34" r="2.2" />
        <circle class="art-accent" cx="52" cy="34" r="2.2" />
      `,
    },
  ],
  [
    "bramble-hound",
    {
      description: "A four-legged hound: long body, pointed ears, snout and a curled tail",
      inner: `
        <path class="art-body" d="M22 28 C12 24 8 14 12 6 C16 14 22 18 26 22 Z" />
        <ellipse class="art-body" cx="42" cy="34" rx="22" ry="11" />
        <rect class="art-body" x="26" y="40" width="7" height="15" rx="3.5" />
        <rect class="art-body" x="40" y="40" width="7" height="15" rx="3.5" />
        <rect class="art-body" x="52" y="40" width="7" height="15" rx="3.5" />
        <rect class="art-body" x="62" y="40" width="7" height="15" rx="3.5" />
        <path class="art-body" d="M60 19 L55 6 L69 14 Z" />
        <path class="art-body" d="M72 16 L80 5 L84 17 Z" />
        <circle class="art-body" cx="66" cy="27" r="11" />
        <path class="art-body" d="M74 22 L88 29 L74 34 Z" />
        <circle class="art-accent" cx="68" cy="25" r="2.4" />
      `,
    },
  ],
  [
    "glowcap",
    {
      description: "A mushroom: a domed cap on a stout stem, speckled",
      inner: `
        <path class="art-body" d="M40 40 L56 40 L54 56 L42 56 Z" />
        <path class="art-body" d="M18 42 C18 24 32 12 48 12 C64 12 78 24 78 42 Z" />
        <circle class="art-accent" cx="36" cy="30" r="4" />
        <circle class="art-accent" cx="56" cy="24" r="3" />
        <circle class="art-accent" cx="62" cy="34" r="3.5" />
      `,
    },
  ],
  [
    "mudback-turtle",
    {
      description: "A turtle: a domed shell with a small head, feet and a tail",
      inner: `
        <ellipse class="art-body" cx="14" cy="44" rx="8" ry="6" />
        <path class="art-body" d="M20 46 C20 28 32 18 48 18 C64 18 76 28 76 46 Z" />
        <ellipse class="art-body" cx="30" cy="52" rx="7" ry="4" />
        <ellipse class="art-body" cx="62" cy="52" rx="7" ry="4" />
        <path class="art-body" d="M76 42 L88 38 L84 50 Z" />
        <path class="art-accent" d="M28 46 Q34 39 40 46 Q46 39 52 46 Q58 39 64 46 Q70 39 74 45 L74 46 Z" />
        <circle class="art-accent" cx="12" cy="42" r="2.2" />
      `,
    },
  ],
  [
    "vine-lasher",
    {
      description: "A whipping vine: one long S-curved lash with thorns and two leaves",
      inner: `
        <path class="art-body" d="M16 58 Q34 50 40 38 Q46 26 66 14 L72 18 Q52 30 46 42 Q40 54 22 62 Z" />
        <path class="art-body" d="M40 40 L27 33 L42 34 Z" />
        <path class="art-body" d="M54 25 L56 8 L65 20 Z" />
        <path class="art-body" d="M38 42 Q28 26 17 29 Q24 45 38 42 Z" />
        <path class="art-body" d="M60 20 Q74 4 85 14 Q77 28 60 20 Z" />
      `,
    },
  ],
  [
    "storm-crow",
    {
      description: "A crow with both wings swept wide, beak and fanned tail",
      inner: `
        <path class="art-body" d="M46 34 C32 20 14 16 8 22 C20 28 30 36 44 40 Z" />
        <path class="art-body" d="M50 34 C64 20 82 16 88 22 C76 28 66 36 52 40 Z" />
        <path class="art-body" d="M42 50 L36 62 L48 55 L60 62 L54 50 Z" />
        <ellipse class="art-body" cx="48" cy="40" rx="9" ry="14" />
        <circle class="art-body" cx="48" cy="24" r="9" />
        <path class="art-body" d="M55 21 L68 25 L55 29 Z" />
        <circle class="art-accent" cx="52" cy="22" r="2.4" />
      `,
    },
  ],
  [
    "emberling",
    {
      description: "A licking flame with two glowing eyes and stray sparks",
      inner: `
        <circle class="art-body" cx="24" cy="18" r="3" />
        <circle class="art-body" cx="72" cy="13" r="2.5" />
        <path class="art-body" d="M48 4 C50 14 56 18 62 24 C68 30 70 38 66 46 C62 54 54 58 46 58 C36 58 28 52 26 42 C24 34 28 28 34 24 C32 32 34 38 40 40 C38 30 42 16 48 4 Z" />
        <circle class="art-accent" cx="43" cy="42" r="2.6" />
        <circle class="art-accent" cx="53" cy="42" r="2.6" />
      `,
    },
  ],
  [
    "root-colossus",
    {
      description: "A hulking root figure: a broad trunk body, two arms, splayed roots and glowing eyes",
      inner: `
        <path class="art-body" d="M32 52 L16 62 L26 62 L38 54 Z" />
        <path class="art-body" d="M64 52 L80 62 L70 62 L58 54 Z" />
        <path class="art-body" d="M46 52 L42 62 L54 62 L50 52 Z" />
        <path class="art-body" d="M48 4 C58 4 66 14 66 26 C66 36 62 44 64 54 L32 54 C34 44 30 36 30 26 C30 14 38 4 48 4 Z" />
        <path class="art-body" d="M30 28 L14 22 L14 30 L28 34 Z" />
        <path class="art-body" d="M66 28 L82 22 L82 30 L68 34 Z" />
        <circle class="art-accent" cx="41" cy="24" r="2.6" />
        <circle class="art-accent" cx="55" cy="24" r="2.6" />
      `,
    },
  ],
  [
    "elder-oak",
    {
      description: "An old tree: a narrow trunk under a broad canopy of three crowns, with a knot",
      inner: `
        <rect class="art-body" x="43" y="30" width="10" height="26" rx="3" />
        <circle class="art-body" cx="34" cy="26" r="15" />
        <circle class="art-body" cx="62" cy="26" r="15" />
        <circle class="art-body" cx="48" cy="15" r="17" />
        <circle class="art-accent" cx="48" cy="46" r="3.4" />
      `,
    },
  ],
  [
    "moon-bloom",
    {
      description: "A flower of six petals around a dark centre, on a short stem",
      inner: `
        <rect class="art-body" x="46" y="46" width="4" height="16" rx="2" />
        <ellipse class="art-body" cx="48" cy="17" rx="6.5" ry="11" />
        <ellipse class="art-body" cx="48" cy="17" rx="6.5" ry="11" transform="rotate(60 48 33)" />
        <ellipse class="art-body" cx="48" cy="17" rx="6.5" ry="11" transform="rotate(120 48 33)" />
        <ellipse class="art-body" cx="48" cy="17" rx="6.5" ry="11" transform="rotate(180 48 33)" />
        <ellipse class="art-body" cx="48" cy="17" rx="6.5" ry="11" transform="rotate(240 48 33)" />
        <ellipse class="art-body" cx="48" cy="17" rx="6.5" ry="11" transform="rotate(300 48 33)" />
        <circle class="art-accent" cx="48" cy="33" r="5.5" />
      `,
    },
  ],
  [
    "amber-antler",
    {
      description: "A small head crowned with a pair of forked antlers",
      inner: `
        <path class="art-body" d="M42 44 C34 38 28 28 26 14 L34 12 C36 26 42 34 50 40 Z" />
        <path class="art-body" d="M31 28 L16 16 L22 9 L36 23 Z" />
        <path class="art-body" d="M54 44 C62 38 68 28 70 14 L62 12 C60 26 54 34 46 40 Z" />
        <path class="art-body" d="M65 28 L80 16 L74 9 L60 23 Z" />
        <ellipse class="art-body" cx="48" cy="47" rx="14" ry="10" />
        <ellipse class="art-body" cx="48" cy="56" rx="7" ry="5" />
        <circle class="art-accent" cx="43" cy="46" r="2.4" />
        <circle class="art-accent" cx="53" cy="46" r="2.4" />
      `,
    },
  ],
  [
    "cinder-shrike",
    {
      description: "A shrike: a crested bird with a hooked beak, a long tail and a fiery tip",
      inner: `
        <path class="art-body" d="M40 54 L34 62 L44 58 Z" />
        <path class="art-body" d="M20 52 L14 62 L28 57 Z" />
        <path class="art-body" d="M34 42 L14 58 L40 54 L46 46 Z" />
        <ellipse class="art-body" cx="42" cy="32" rx="12" ry="15" />
        <path class="art-body" d="M30 24 C24 30 24 40 30 44 L36 36 Z" />
        <circle class="art-body" cx="56" cy="20" r="9" />
        <path class="art-body" d="M63 18 L76 21 L63 25 Z" />
        <path class="art-body" d="M52 13 L58 3 L62 15 Z" />
        <circle class="art-accent" cx="58" cy="18" r="2.4" />
      `,
    },
  ],
  [
    "dewdrop-nymph",
    {
      description: "A dewdrop nymph: a droplet for a head on a slender body, with two leaf arms",
      inner: `
        <path class="art-body" d="M48 38 L54 54 L42 54 Z" />
        <path class="art-body" d="M42 42 Q28 38 22 28 Q34 29 42 38 Z" />
        <path class="art-body" d="M54 42 Q68 38 74 28 Q62 29 54 38 Z" />
        <path class="art-body" d="M48 14 C53 20 56 25 56 30 C56 35 52 39 48 39 C44 39 40 35 40 30 C40 25 43 20 48 14 Z" />
        <circle class="art-accent" cx="45" cy="29" r="1.8" />
        <circle class="art-accent" cx="51" cy="29" r="1.8" />
      `,
    },
  ],
  [
    "twilight-fox",
    {
      description: "A fox: a sleek body, two pointed ears and a long sweeping tail",
      inner: `
        <path class="art-body" d="M30 44 C14 40 6 26 10 14 C20 22 30 30 40 36 Z" />
        <ellipse class="art-body" cx="50" cy="40" rx="20" ry="11" />
        <rect class="art-body" x="40" y="46" width="7" height="8" rx="3.5" />
        <rect class="art-body" x="54" y="46" width="7" height="8" rx="3.5" />
        <path class="art-body" d="M56 18 L54 6 L66 14 Z" />
        <path class="art-body" d="M68 16 L76 5 L80 17 Z" />
        <circle class="art-body" cx="62" cy="26" r="11" />
        <path class="art-body" d="M70 26 L86 30 L70 34 Z" />
        <circle class="art-accent" cx="64" cy="24" r="2.2" />
      `,
    },
  ],
  [
    "bark-sentinel",
    {
      description: "A bark sentinel: a tall trunk body with a knotted face and two branch arms",
      inner: `
        <path class="art-body" d="M40 54 L32 62 L44 58 Z" />
        <path class="art-body" d="M56 54 L64 62 L52 58 Z" />
        <rect class="art-body" x="38" y="14" width="20" height="42" rx="9" />
        <ellipse class="art-body" cx="48" cy="12" rx="12" ry="8" />
        <path class="art-body" d="M38 26 L18 16 L16 24 L36 33 Z" />
        <path class="art-body" d="M58 26 L78 16 L80 24 L60 33 Z" />
        <circle class="art-accent" cx="43" cy="26" r="2.4" />
        <circle class="art-accent" cx="53" cy="26" r="2.4" />
        <circle class="art-accent" cx="48" cy="41" r="3" />
      `,
    },
  ],
  [
    "moss-glider",
    {
      description: "A gliding seed: a pointed kernel between two broad swept wings",
      inner: `
        <ellipse class="art-body" cx="48" cy="42" rx="7" ry="12" />
        <path class="art-body" d="M42 36 C28 20 12 14 8 20 C14 30 26 40 40 46 Z" />
        <path class="art-body" d="M54 36 C68 20 84 14 88 20 C82 30 70 40 56 46 Z" />
        <circle class="art-accent" cx="46" cy="38" r="2.2" />
      `,
    },
  ],
  [
    "fern-drake",
    {
      description: "A small drake: a low body, a crested frill, a snout and a curling tail",
      inner: `
        <path class="art-body" d="M20 46 C10 44 6 36 8 30 C14 36 20 40 28 42 Z" />
        <ellipse class="art-body" cx="40" cy="44" rx="16" ry="10" />
        <rect class="art-body" x="28" y="50" width="7" height="6" rx="3" />
        <rect class="art-body" x="46" y="50" width="7" height="6" rx="3" />
        <circle class="art-body" cx="62" cy="30" r="10" />
        <path class="art-body" d="M70 26 L86 30 L70 36 Z" />
        <path class="art-body" d="M52 24 L56 10 L62 22 Z" />
        <path class="art-body" d="M62 18 L66 8 L72 20 Z" />
        <path class="art-body" d="M70 22 L82 14 L76 26 Z" />
        <circle class="art-accent" cx="64" cy="28" r="2.2" />
      `,
    },
  ],
  [
    "boulder-ram",
    {
      description: "A ram: a heavy four-legged body, a blunt snout and two curled horns",
      inner: `
        <ellipse class="art-body" cx="48" cy="40" rx="20" ry="12" />
        <rect class="art-body" x="30" y="46" width="7" height="10" rx="3.5" />
        <rect class="art-body" x="46" y="46" width="7" height="10" rx="3.5" />
        <rect class="art-body" x="60" y="46" width="7" height="10" rx="3.5" />
        <circle class="art-body" cx="66" cy="28" r="10" />
        <path class="art-body" d="M72 26 L86 30 L73 34 Z" />
        <path class="art-body" d="M66 18 C76 8 86 12 84 20 C83 26 74 24 73 19 Z" />
        <path class="art-body" d="M54 18 C52 8 42 6 38 13 C36 19 42 23 48 22 Z" />
        <circle class="art-accent" cx="68" cy="26" r="2.2" />
      `,
    },
  ],
  [
    "hollow-wisp",
    {
      description: "A lantern wisp: a glowing orb above a narrowed lantern on three dangling tendrils",
      inner: `
        <circle class="art-body" cx="48" cy="20" r="12" />
        <path class="art-body" d="M36 32 L60 32 L55 50 L41 50 Z" />
        <path class="art-body" d="M41 50 L36 62 L44 52 Z" />
        <path class="art-body" d="M55 50 L60 62 L52 52 Z" />
        <path class="art-body" d="M48 56 L48 62 L52 56 Z" />
        <circle class="art-accent" cx="48" cy="20" r="3" />
      `,
    },
  ],
  [
    "granite-warden",
    {
      description: "A squat standing stone split by a cleft, set on a wide base",
      inner: `
        <path class="art-body" d="M32 50 L30 22 L42 12 L46 22 L54 22 L58 12 L70 22 L68 50 Z" />
        <path class="art-body" d="M26 50 L70 50 L68 58 L28 58 Z" />
        <circle class="art-accent" cx="42" cy="34" r="2.6" />
        <circle class="art-accent" cx="55" cy="34" r="2.6" />
      `,
    },
  ],
  [
    "ironbark-titan",
    {
      description: "A broad-trunked titan with a spiked branch crown, two limbs and splayed roots",
      inner: `
        <path class="art-body" d="M40 54 L36 62 L44 58 Z" />
        <path class="art-body" d="M56 54 L60 62 L52 58 Z" />
        <path class="art-body" d="M34 54 L30 26 C30 19 36 15 48 15 C60 15 66 19 66 26 L62 54 Z" />
        <path class="art-body" d="M40 15 L38 4 L45 12 Z" />
        <path class="art-body" d="M48 15 L48 2 L53 12 Z" />
        <path class="art-body" d="M56 15 L61 4 L58 13 Z" />
        <path class="art-body" d="M32 30 L14 19 L12 27 L30 38 Z" />
        <path class="art-body" d="M64 30 L82 19 L84 27 L66 38 Z" />
        <circle class="art-accent" cx="43" cy="30" r="2.6" />
        <circle class="art-accent" cx="53" cy="30" r="2.6" />
      `,
    },
  ],
]);

/**
 * The drawing for one card: its description and the SVG markup of its creature,
 * or null when the card has no picture yet. The caller decides what to show
 * instead — the page prints the card's name.
 */
export function cardArt(cardId) {
  return CARD_ART.get(cardId) ?? null;
}

/**
 * One card's picture, as an <svg> ready to drop onto a card face: the shared
 * frame, then the card's own creature. `label` is the text alternative a screen
 * reader reads in place of the drawing — the card's name, so the picture says
 * what it is to someone who cannot see it. Returns null when the card has no
 * drawing, so the caller can fall back rather than show an empty frame.
 */
export function cardArtSvg(cardId, label) {
  const art = cardArt(cardId);
  if (!art) return null;

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", "card-art");
  svg.setAttribute("viewBox", "0 0 96 64");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.innerHTML = FRAME + art.inner;
  return svg;
}

/**
 * The mark each opponent is known by, drawn in the same shape language as the
 * creatures: flat wedges and circles, one solid mass, no outline of its own.
 * Each is one drawing in a square frame, so an opponent is recognised by its
 * mark at a glance as well as by its name.
 */
const OPPONENT_SIGILS = new Map([
  [
    "bramble",
    {
      description: "A thorned stem leaning left",
      inner: `
        <path class="sigil-body" d="M10 23 L14 23 L12 2 Z" />
        <path class="sigil-body" d="M12 16 L2 10 L11 20 Z" />
        <path class="sigil-body" d="M12 10 L22 5 L13 14 Z" />
      `,
    },
  ],
  [
    "flame",
    {
      description: "A flame licking up from a bright core",
      inner: `
        <path class="sigil-body" d="M12 1 C14 7 19 9 19 15 a7 7 0 0 1 -14 0 C5 11 8 9 9 4 C10 8 12 9 12 12 Z" />
        <path class="sigil-accent" d="M12 11 C13 14 15 15 15 17.5 a3 3 0 0 1 -6 0 C9 15 11 14 11 12 Z" />
      `,
    },
  ],
]);

/**
 * One opponent's mark, as an <svg> the page can drop beside their name: a square
 * drawing in the opponent's own accent colour, hidden from assistive technology
 * because the opponent's name is written beside it — the picture is what a
 * sighted player sees, not a second thing to be read out.
 */
export function opponentSigilSvg(opponent) {
  const sigil = OPPONENT_SIGILS.get(opponent.sigil);
  if (!sigil) return null;

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", "opponent-sigil");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = sigil.inner;
  return svg;
}

/**
 * The back of a card, for a card a player is not allowed to see: the same frame
 * every card wears around the game's own mark. It carries no text of its own —
 * the pile it sits in is labelled with how many cards it holds, and that count
 * is what a screen reader reads — so the drawing is hidden from assistive
 * technology rather than announced once per card.
 */
export function cardBackSvg() {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", "card-art card-back");
  svg.setAttribute("viewBox", "0 0 96 64");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = FRAME + CARD_BACK;
  return svg;
}
