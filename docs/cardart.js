/**
 * selfgrow — the picture on every card, and the portrait of every opponent.
 *
 * Each card is drawn here, once, as a flat silhouette inside one shared frame,
 * and each opponent as a figure of the same kind without the frame, so a player
 * learns the cards and the characters by sight the way a real card is learned,
 * and one added later belongs with the ones already on the table. Nothing is
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
 *   - Characters. An opponent is drawn the same way, larger and without the card
 *     frame: one figure in a 64x64 square, standing on one shared ground line at
 *     y=56. The figure is that opponent's accent instead of the foil, so
 *     Thornmere, Emberwake, Mistfen, Barrowmere, Rootwarden, Mossheart,
 *     Twinbough, Quillmere and Galehollow are told apart by sight the way a card
 *     is — the same shape language, so a character added later belongs with
 *     these.
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
  portrait: {
    medium: "a flat vector silhouette, one figure per opponent, with no outlines, gradients or shadows — the same medium as the creatures on the cards",
    viewBox: "0 0 64 64",
    groundLine: "every figure stands on one shared ground line at y=56, inside x=6..58",
    palette: {
      // The opponent's own accent, named by `accent` in docs/cards.js and carried
      // on the picker option as --opponent-accent, so a portrait is drawn in the
      // colour of the character it belongs to.
      body: "--opponent-accent",
      detail: "--on-foil",
    },
  },
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
  [
    "thorn-gale",
    {
      description: "A swirling gust: a curved crescent of wind trailing three thorned spikes",
      inner: `
        <path class="art-body" d="M14 42 C22 22 50 12 78 20 C64 24 46 28 34 40 C46 50 64 54 84 48 C62 62 30 58 14 42 Z" />
        <path class="art-body" d="M28 36 L16 22 L36 30 Z" />
        <path class="art-body" d="M42 22 L40 4 L54 16 Z" />
        <path class="art-body" d="M60 16 L70 2 L68 20 Z" />
        <circle class="art-accent" cx="46" cy="38" r="2.6" />
      `,
    },
  ],
  [
    "gustling",
    {
      description: "A small whirl: a rounded gust with two leaf-wings and a seed at its centre",
      inner: `
        <path class="art-body" d="M48 22 C57 23 64 31 64 41 C64 49 57 54 48 54 C39 54 32 49 32 41 C32 31 39 23 48 22 Z" />
        <path class="art-body" d="M33 33 C24 22 13 25 9 35 C17 44 28 44 34 38 Z" />
        <path class="art-body" d="M63 33 C72 22 83 25 87 35 C79 44 68 44 62 38 Z" />
        <circle class="art-accent" cx="48" cy="40" r="4.5" />
      `,
    },
  ],
  [
    "storm-roc",
    {
      description: "A broad-winged bird: spread wings, a beaked head and a forked tail",
      inner: `
        <path class="art-body" d="M38 28 C28 20 13 23 9 33 C17 40 28 42 38 38 Z" />
        <path class="art-body" d="M58 28 C68 20 83 23 87 33 C79 40 68 42 58 38 Z" />
        <path class="art-body" d="M48 20 C54 20 58 25 58 31 L58 44 C58 50 54 54 48 54 C42 54 38 50 38 44 L38 31 C38 25 42 20 48 20 Z" />
        <circle class="art-body" cx="48" cy="17" r="7" />
        <path class="art-body" d="M52 13 L62 17 L52 21 Z" />
        <path class="art-body" d="M42 52 L35 62 L47 56 Z" />
        <path class="art-body" d="M54 52 L61 62 L49 56 Z" />
        <circle class="art-accent" cx="49" cy="16" r="2" />
      `,
    },
  ],
  [
    "seed-pod",
    {
      description: "A seed pod split open: a rounded pod parted into a cup below and a lifted lid above, with two seeds inside",
      inner: `
        <path class="art-body" d="M28 34 C28 46 36 54 48 54 C60 54 68 46 68 34 Z" />
        <path class="art-body" d="M30 30 C32 18 40 12 48 12 C56 12 64 18 66 30 C60 26 54 24 48 24 C42 24 36 26 30 30 Z" />
        <circle class="art-accent" cx="40" cy="38" r="3.4" />
        <circle class="art-accent" cx="56" cy="38" r="3.4" />
      `,
    },
  ],
  [
    "comfrey-root",
    {
      description: "A root crown: a rounded crown with a two-leaved shoot above and three tapered roots trailing below",
      inner: `
        <path class="art-body" d="M48 6 C50 6 51 8 51 11 L51 20 L45 20 L45 11 C45 8 46 6 48 6 Z" />
        <path class="art-body" d="M48 12 C41 12 35 8 33 2 C41 2 46 6 48 12 Z" />
        <path class="art-body" d="M48 12 C55 12 61 8 63 2 C55 2 50 6 48 12 Z" />
        <ellipse class="art-body" cx="48" cy="28" rx="17" ry="12" />
        <path class="art-body" d="M40 37 C38 44 33 50 27 54 L35 54 C40 50 43 44 45 38 Z" />
        <path class="art-body" d="M56 37 C58 44 63 50 69 54 L61 54 C56 50 53 44 51 38 Z" />
        <path class="art-body" d="M46 40 L45 54 L51 54 L50 40 Z" />
        <circle class="art-accent" cx="42" cy="27" r="2.6" />
        <circle class="art-accent" cx="54" cy="27" r="2.6" />
      `,
    },
  ],
  [
    "whipthorn",
    {
      description:
        "A thorned whip: a gripped handle with a lash curling up and over into a barbed tip, thorns along its back",
      inner: `
        <path class="art-body" d="M43 54 L43 45 L53 45 L53 54 Z" />
        <path class="art-body" d="M48 46 C48 30 56 18 70 18 C80 18 86 26 84 36 L78 36 C79 30 76 24 70 24 C60 24 54 34 54 46 Z" />
        <path class="art-body" d="M83 36 L88 46 L78 42 Z" />
        <path class="art-body" d="M62 20 L60 8 L70 16 Z" />
        <path class="art-body" d="M74 17 L79 6 L85 16 Z" />
        <path class="art-body" d="M47 34 L39 27 L49 26 Z" />
        <circle class="art-accent" cx="48" cy="50" r="2.6" />
      `,
    },
  ],
  [
    "lantern-bough",
    {
      description:
        "A lit bough: a thick branch reaching up to the right with two leaves, a cord hanging from its tip, and a lantern with a glowing seed inside",
      inner: `
        <path class="art-body" d="M8 52 C24 50 40 44 54 33 C63 26 69 22 76 20 L76 27 C70 29 64 32 57 38 C44 48 28 55 10 57 Z" />
        <path class="art-body" d="M40 40 C33 31 39 20 52 16 C56 27 50 37 40 40 Z" />
        <path class="art-body" d="M28 48 C22 40 26 30 36 25 C41 35 36 45 28 48 Z" />
        <rect class="art-body" x="72.5" y="20" width="3" height="9" rx="1.5" />
        <path class="art-body" d="M68 27 L80 27 L78 32 L70 32 Z" />
        <path class="art-body" d="M67 31 L81 31 L77 49 L71 49 Z" />
        <path class="art-body" d="M69 49 L79 49 L78 53 L70 53 Z" />
        <circle class="art-accent" cx="74" cy="40" r="4.2" />
      `,
    },
  ],
  [
    "thornback-behemoth",
    {
      description:
        "A massive thorn-backed beast: a broad low body ridged with three thorns, four stubby legs, a heavy tail and a horned head with one eye",
      inner: `
        <path class="art-body" d="M11 38 L3 33 L5 45 L13 47 Z" />
        <ellipse class="art-body" cx="47" cy="42" rx="34" ry="13" />
        <path class="art-body" d="M23 31 L20 17 L32 29 Z" />
        <path class="art-body" d="M38 29 L41 13 L49 27 Z" />
        <path class="art-body" d="M55 29 L61 16 L65 29 Z" />
        <path class="art-body" d="M70 33 C82 31 90 37 90 45 L85 52 L68 50 Z" />
        <path class="art-body" d="M83 33 L90 22 L87 35 Z" />
        <path class="art-body" d="M25 48 L34 48 L34 55 L26 55 Z" />
        <path class="art-body" d="M42 48 L51 48 L51 55 L43 55 Z" />
        <path class="art-body" d="M58 48 L66 48 L67 55 L59 55 Z" />
        <circle class="art-accent" cx="80" cy="39" r="2.6" />
      `,
    },
  ],
  [
    "sunspear-bloom",
    {
      description:
        "A sunlit bloom on a short stalk: a spear tip rising out of its head, two leaves below, and two seeds spilling to the ground",
      inner: `
        <rect class="art-body" x="45.5" y="22" width="5" height="32" rx="2.5" />
        <path class="art-body" d="M47 40 C37 42 27 35 24 23 C36 21 45 28 47 40 Z" />
        <path class="art-body" d="M49 34 C59 36 69 29 72 17 C60 15 51 22 49 34 Z" />
        <path class="art-body" d="M48 1 L55 14 L48 21 L41 14 Z" />
        <ellipse class="art-body" cx="48" cy="24" rx="13" ry="7" />
        <ellipse class="art-body" cx="26" cy="51" rx="5" ry="3.6" />
        <ellipse class="art-body" cx="70" cy="49" rx="4.6" ry="3.3" />
        <circle class="art-accent" cx="48" cy="24" r="2.6" />
      `,
    },
  ],
  [
    "climbing-ivy",
    {
      description:
        "A climbing vine: a curving stem climbing up the frame with four pointed leaves and two berries",
      inner: `
        <path class="art-body" d="M46 54 C44 44 46 34 50 24 C54 14 54 9 50 5 L56 5 C59 10 59 16 55 26 C51 36 49 44 52 54 Z" />
        <path class="art-body" d="M47 46 C36 48 26 41 24 29 C36 28 45 35 47 46 Z" />
        <path class="art-body" d="M51 36 C62 38 72 31 74 19 C62 18 53 25 51 36 Z" />
        <path class="art-body" d="M49 26 C38 28 28 21 26 9 C38 8 47 15 49 26 Z" />
        <path class="art-body" d="M51 18 C60 20 68 14 70 4 C60 3 52 9 51 18 Z" />
        <circle class="art-accent" cx="46" cy="40" r="2.6" />
        <circle class="art-accent" cx="52" cy="30" r="2.6" />
      `,
    },
  ],
  [
    "budding-sapling",
    {
      description:
        "A young sapling: a short shoot with two broad leaves low down and a bud at its tip",
      inner: `
        <rect class="art-body" x="45.5" y="22" width="5" height="32" rx="2.5" />
        <path class="art-body" d="M47 42 C35 44 24 37 21 24 C34 23 45 31 47 42 Z" />
        <path class="art-body" d="M49 36 C61 38 72 31 75 18 C62 17 51 25 49 36 Z" />
        <ellipse class="art-body" cx="48" cy="13" rx="6.5" ry="8" />
        <circle class="art-accent" cx="48" cy="13" r="2.6" />
      `,
    },
  ],
  [
    "sunroot-treant",
    {
      description:
        "A walking tree: a thick trunk on two root legs, two branch arms and a sun-crown of rays above its head",
      inner: `
        <path class="art-body" d="M38 50 L24 62 L34 62 L44 52 Z" />
        <path class="art-body" d="M58 50 L72 62 L62 62 L52 52 Z" />
        <path class="art-body" d="M48 8 C58 8 65 18 65 30 C65 40 63 46 65 52 L31 52 C33 46 31 40 31 30 C31 18 38 8 48 8 Z" />
        <path class="art-body" d="M31 28 L15 21 L14 30 L29 34 Z" />
        <path class="art-body" d="M65 28 L81 21 L82 30 L67 34 Z" />
        <circle class="art-body" cx="48" cy="11" r="7" />
        <path class="art-body" d="M48 1 L51 6 L45 6 Z" />
        <path class="art-body" d="M37 6 L41 10 L36 12 Z" />
        <path class="art-body" d="M59 6 L55 10 L60 12 Z" />
        <circle class="art-accent" cx="41" cy="26" r="2.6" />
        <circle class="art-accent" cx="55" cy="26" r="2.6" />
      `,
    },
  ],
  [
    "worldroot-ancient",
    {
      description:
        "A gnarled ancient: a wide knot-holed trunk over arching roots, with a branch crown of leaves",
      inner: `
        <path class="art-body" d="M12 54 C20 43 32 41 48 41 C64 41 76 43 84 54 Z" />
        <path class="art-body" d="M34 54 C32 40 35 26 41 16 L55 16 C61 26 64 40 62 54 Z" />
        <path class="art-body" d="M41 18 C34 12 26 10 19 13 L20 20 C27 18 34 21 41 27 Z" />
        <path class="art-body" d="M55 18 C62 12 70 10 77 13 L76 20 C69 18 62 21 55 27 Z" />
        <circle class="art-body" cx="20" cy="13" r="6.5" />
        <circle class="art-body" cx="76" cy="13" r="6.5" />
        <circle class="art-body" cx="48" cy="12" r="8" />
        <circle class="art-accent" cx="48" cy="45" r="3.4" />
      `,
    },
  ],
  [
    "dewglass-moth",
    {
      description:
        "A moth: a slim upright body with two droplet wings outspread, eyes on the wing joints and a droplet resting on its back",
      inner: `
        <path class="art-body" d="M40 34 C29 16 18 15 21 30 C23 39 32 48 40 50 Z" />
        <path class="art-body" d="M56 34 C67 16 78 15 75 30 C73 39 64 48 56 50 Z" />
        <ellipse class="art-body" cx="48" cy="40" rx="8" ry="14" />
        <circle class="art-body" cx="48" cy="24" r="5.5" />
        <circle class="art-accent" cx="34" cy="38" r="2.6" />
        <circle class="art-accent" cx="62" cy="38" r="2.6" />
      `,
    },
  ],
  [
    "mossheart-chalice",
    {
      description:
        "A chalice: a wide bowl on a stem over a splayed foot, moss tufts at the foot and a heart set into the bowl",
      inner: `
        <path class="art-body" d="M28 20 C28 39 38 47 48 47 C58 47 68 39 68 20 Z" />
        <path class="art-body" d="M26 14 L70 14 L72 20 L24 20 Z" />
        <rect class="art-body" x="45" y="47" width="6" height="7" rx="2" />
        <path class="art-body" d="M34 54 C38 50 44 52 48 54 C52 52 58 50 62 54 Z" />
        <path class="art-body" d="M26 50 C20 47 15 49 13 53 C19 55 23 55 28 54 Z" />
        <path class="art-body" d="M70 50 C76 47 81 49 83 53 C77 55 73 55 68 54 Z" />
        <path class="art-accent" d="M48 33 C44 27 38 29 40 35 C41 39 48 43 48 43 C48 43 55 39 56 35 C58 29 52 27 48 33 Z" />
      `,
    },
  ],
  [
    "elderheart-willow",
    {
      description:
        "A willow: a stout trunk under a drooping frond crown, roots sprawling at its foot and a heart cut into the bark",
      inner: `
        <path class="art-body" d="M14 54 C23 45 35 43 48 43 C61 43 73 45 82 54 Z" />
        <path class="art-body" d="M38 52 C36 40 40 28 48 22 C56 28 60 40 58 52 Z" />
        <path class="art-body" d="M48 22 C35 17 21 15 11 21 L13 31 C25 27 40 31 48 39 Z" />
        <path class="art-body" d="M48 22 C61 17 75 15 85 21 L83 31 C71 27 56 31 48 39 Z" />
        <path class="art-body" d="M11 21 C7 19 6 26 11 28 L13 31 Z" />
        <path class="art-body" d="M85 21 C89 19 90 26 85 28 L83 31 Z" />
        <circle class="art-body" cx="48" cy="15" r="7" />
        <path class="art-accent" d="M48 45 C44 40 38 42 40 47 C41 50 48 53 48 53 C48 53 55 50 56 47 C58 42 52 40 48 45 Z" />
      `,
    },
  ],
  [
    "mire-spore",
    {
      description:
        "A spore puff: a round puffball on a short stalk, burst open at its crown with spore motes drifting above",
      inner: `
        <path class="art-body" d="M42 54 L42 44 L54 44 L54 54 Z" />
        <circle class="art-body" cx="48" cy="32" r="18" />
        <path class="art-body" d="M48 12 L54 20 L48 24 L42 20 Z" />
        <circle class="art-body" cx="20" cy="16" r="3.4" />
        <circle class="art-body" cx="76" cy="11" r="2.8" />
        <circle class="art-body" cx="48" cy="3" r="2.4" />
        <circle class="art-body" cx="68" cy="30" r="2.2" />
        <circle class="art-accent" cx="42" cy="32" r="2.6" />
        <circle class="art-accent" cx="54" cy="32" r="2.6" />
      `,
    },
  ],
  [
    "heartwood-sapling",
    {
      description:
        "A young heartwood sapling: a forked trunk opening into two branches with a leaf on each and a heart knot cut into the bark",
      inner: `
        <path class="art-body" d="M34 54 C38 46 40 36 42 26 L54 26 C56 36 58 46 62 54 Z" />
        <path class="art-body" d="M42 28 C36 20 30 15 22 12 L20 19 C28 23 34 29 39 37 Z" />
        <path class="art-body" d="M54 28 C60 20 66 15 74 12 L76 19 C68 23 62 29 57 37 Z" />
        <path class="art-body" d="M22 12 C16 4 24 0 30 6 C34 9 31 15 22 12 Z" />
        <path class="art-body" d="M74 12 C80 4 72 0 66 6 C62 9 65 15 74 12 Z" />
        <path class="art-accent" d="M48 48 C44 43 38 45 40 50 C41 53 48 56 48 56 C48 56 55 53 56 50 C58 45 52 43 48 48 Z" />
      `,
    },
  ],
  [
    "spearroot-colossus",
    {
      description:
        "A spearroot colossus: a broad trunk body braced on splayed roots, two long spear arms thrust out, a thorn crown and one eye",
      inner: `
        <path class="art-body" d="M30 50 L12 58 L26 60 L38 52 Z" />
        <path class="art-body" d="M66 50 L84 58 L70 60 L58 52 Z" />
        <path class="art-body" d="M48 16 C58 16 64 25 64 36 C64 44 62 48 64 54 L32 54 C34 48 32 44 32 36 C32 25 38 16 48 16 Z" />
        <path class="art-body" d="M34 26 L6 19 L6 29 L34 35 Z" />
        <path class="art-body" d="M62 26 L90 19 L90 29 L62 35 Z" />
        <path class="art-body" d="M40 18 L44 4 L48 16 Z" />
        <path class="art-body" d="M56 18 L52 4 L48 16 Z" />
        <circle class="art-accent" cx="48" cy="30" r="3" />
      `,
    },
  ],
  [
    "scrollbark",
    {
      description:
        "A standing bough: a curved trunk with bark peeling away in three curled sheets, a snapped tip and one dark knot",
      inner: `
        <path class="art-body" d="M44 54 C42 42 44 30 49 18 L57 18 C59 30 60 42 58 54 Z" />
        <path class="art-body" d="M44 50 C32 49 23 40 25 28 C37 30 45 39 44 50 Z" />
        <path class="art-body" d="M48 32 C39 31 32 23 33 13 C43 15 49 22 48 32 Z" />
        <path class="art-body" d="M57 44 C69 43 78 34 76 22 C65 24 57 33 57 44 Z" />
        <path class="art-body" d="M49 18 L46 8 L53 15 Z" />
        <path class="art-body" d="M44 52 L32 54 L46 54 Z" />
        <path class="art-body" d="M58 52 L70 54 L56 54 Z" />
        <circle class="art-accent" cx="52" cy="39" r="3" />
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
 * Who each opponent is, drawn: one figure per character, in the same flat
 * silhouettes as the creatures on the cards but standing on their own rather
 * than in a card's frame. Each figure is a different one — a hooded warden, an
 * upright herald, a figure rising from the fen, a hunched grave-tender under a
 * wide hat, a rooted warden half tree and half stone, a bowed mender over a
 * chalice, a forked two-bough spirit, a stooped archivist bent over a scroll, a
 * lean wind-caller with its arms flung wide in a gale — so an opponent is
 * recognised by sight before the name is read, exactly as a card is.
 */
const OPPONENT_PORTRAITS = new Map([
  [
    "thornmere",
    {
      description: "A hooded warden in a cloak, a thorn crown on the hood and a staff at his side",
      inner: `
        <rect class="portrait-body" x="9" y="10" width="4" height="46" rx="2" />
        <circle class="portrait-body" cx="11" cy="8" r="4" />
        <path class="portrait-body" d="M38 30 C27 30 21 40 20 56 L56 56 C55 40 49 30 38 30 Z" />
        <circle class="portrait-body" cx="38" cy="22" r="10" />
        <path class="portrait-body" d="M28 14 L30 3 L34 15 Z" />
        <path class="portrait-body" d="M37 13 L39 1 L43 14 Z" />
        <path class="portrait-body" d="M45 15 L49 5 L48 16 Z" />
        <circle class="portrait-accent" cx="34" cy="22" r="2.4" />
        <circle class="portrait-accent" cx="42" cy="22" r="2.4" />
      `,
    },
  ],
  [
    "emberwake",
    {
      description: "An upright herald in a robe with both arms out, a flame crest over the head and sparks at the hands",
      inner: `
        <path class="portrait-body" d="M33 33 C23 33 19 43 18 56 L48 56 C47 43 43 33 33 33 Z" />
        <path class="portrait-body" d="M23 34 L10 25 L7 31 L20 40 Z" />
        <path class="portrait-body" d="M43 34 L56 25 L59 31 L46 40 Z" />
        <circle class="portrait-body" cx="33" cy="25" r="8" />
        <path class="portrait-body" d="M33 2 C35 7 40 9 40 13 a7 7 0 0 1 -14 0 C26 9 30 7 31 3 C32 7 33 8 33 11 Z" />
        <circle class="portrait-body" cx="11" cy="15" r="2.6" />
        <circle class="portrait-body" cx="55" cy="14" r="2.4" />
        <circle class="portrait-accent" cx="30" cy="24" r="2.2" />
        <circle class="portrait-accent" cx="36" cy="24" r="2.2" />
        <path class="portrait-accent" d="M33 7 C34 10 37 11 37 13 a4 4 0 0 1 -8 0 C29 11 32 10 32 8 Z" />
      `,
    },
  ],
  [
    "mistfen",
    {
      description: "A draped figure rising from the fen, standing in a rippled line of water among four reeds",
      inner: `
        <rect class="portrait-body" x="7" y="24" width="3" height="32" rx="1.5" />
        <rect class="portrait-body" x="12" y="12" width="3" height="44" rx="1.5" />
        <rect class="portrait-body" x="50" y="26" width="3" height="30" rx="1.5" />
        <rect class="portrait-body" x="55" y="15" width="3" height="41" rx="1.5" />
        <path class="portrait-body" d="M34 19 C26 19 22 28 21 36 C20 45 20 51 20 56 L48 56 C48 51 48 45 47 36 C46 28 42 19 34 19 Z" />
        <path class="portrait-body" d="M6 52.5 C15 50.5 23 54.5 32 52.5 C41 50.5 49 54.5 58 52.5 L58 56 L6 56 Z" />
        <circle class="portrait-accent" cx="30" cy="30" r="2.2" />
        <circle class="portrait-accent" cx="38" cy="30" r="2.2" />
      `,
    },
  ],
  [
    "barrowmere",
    {
      description:
        "A hunched grave-tender under a wide-brimmed hat, its cloak reaching the ground, with leaves drifting around it",
      inner: `
        <path class="portrait-body" d="M30 14 L31 5 C33 3 39 3 41 5 L42 14 Z" />
        <path class="portrait-body" d="M20 15 C25 8 47 8 52 15 C47 21 25 21 20 15 Z" />
        <path class="portrait-body" d="M11 32 C8 29 8 23 12.5 21 C15.5 25 14.5 30 11 32 Z" />
        <path class="portrait-body" d="M54 24 C51 21 51 15 55.5 13 C58 17 57 22 54 24 Z" />
        <path class="portrait-body" d="M50 42 C47 39 48 33 52 31 C55 35 54 40 50 42 Z" />
        <circle class="portrait-body" cx="36" cy="24" r="6" />
        <path class="portrait-body" d="M36 30 C27 30 21 39 20 48 C19 53 19 55 19 56 L53 56 C53 55 53 53 52 48 C51 39 45 30 36 30 Z" />
        <circle class="portrait-accent" cx="33.5" cy="24" r="1.7" />
        <circle class="portrait-accent" cx="38.5" cy="24" r="1.7" />
      `,
    },
  ],
  [
    "rootwarden",
    {
      description:
        "A rooted warden half tree and half stone, its trunk-body spreading into roots on the ground and a broad stone crown over two eyes",
      inner: `
        <path class="portrait-body" d="M23 56 C23 44 25 32 29 26 C32 21 37 21 40 26 C44 32 46 44 46 56 Z" />
        <path class="portrait-body" d="M7 56 C15 51 22 53 30 56 Z" />
        <path class="portrait-body" d="M57 56 C50 51 43 53 35 56 Z" />
        <path class="portrait-body" d="M25 21 L28 10 L38 8 L41 19 Z" />
        <path class="portrait-body" d="M24 31 L10 20 L8 26 L22 37 Z" />
        <path class="portrait-body" d="M45 34 L57 20 L59 26 L47 40 Z" />
        <circle class="portrait-accent" cx="31" cy="16" r="2" />
        <circle class="portrait-accent" cx="38" cy="16" r="2" />
      `,
    },
  ],
  [
    "mossheart",
    {
      description:
        "A bowed mender, its back hunched high and its head dropped low over a chalice held out in both hands, with moss at its foot",
      inner: `
        <path class="portrait-body" d="M24 56 C20 41 26 27 38 24 C49 21 56 31 55 43 C54 51 51 54 48 56 Z" />
        <circle class="portrait-body" cx="25" cy="37" r="7" />
        <path class="portrait-body" d="M28 36 L21 42 L20 47 L32 44 Z" />
        <path class="portrait-body" d="M13 41 L27 41 C27 47 23 51 20 51 C17 51 13 47 13 41 Z" />
        <rect class="portrait-body" x="18.5" y="50" width="3" height="6" rx="1.5" />
        <path class="portrait-body" d="M6 56 C7.5 52 10.5 52 12 56 Z" />
        <path class="portrait-body" d="M52 56 C53.5 52 56.5 52 58 56 Z" />
        <ellipse class="portrait-accent" cx="20" cy="43" rx="4.4" ry="1.3" />
        <circle class="portrait-accent" cx="22" cy="36" r="1.7" />
      `,
    },
  ],
  [
    "twinbough",
    {
      description:
        "A forked spirit: a trunk-body splitting into two raised boughs, each forking again into twin tips around a crowned head with two eyes",
      inner: `
        <path class="portrait-body" d="M24 56 C23 46 25 38 29 33 L39 33 C43 38 45 46 44 56 Z" />
        <circle class="portrait-body" cx="34" cy="27" r="9" />
        <path class="portrait-body" d="M28 32 L17 18 L11 12 L18 8 L31 26 Z" />
        <path class="portrait-body" d="M40 32 L51 18 L57 12 L50 8 L37 26 Z" />
        <path class="portrait-body" d="M16 13 L10 2 L16 1 L23 10 Z" />
        <path class="portrait-body" d="M52 13 L58 2 L52 1 L45 10 Z" />
        <circle class="portrait-accent" cx="31" cy="27" r="2" />
        <circle class="portrait-accent" cx="37" cy="27" r="2" />
      `,
    },
  ],
  [
    "quillmere",
    {
      description:
        "A stooped archivist hunched low over a scroll held out before it, a pointed hood down over two eyes, a small stack of scrolls at its feet",
      inner: `
        <path class="portrait-body" d="M14 56 C10 47 13 35 21 30 C28 25 39 26 44 32 C48 37 48 48 47 56 Z" />
        <path class="portrait-body" d="M34 20 L27 10 L36 15 Z" />
        <circle class="portrait-body" cx="42" cy="23" r="6.5" />
        <path class="portrait-body" d="M33 22 C33 13 41 7 47 10 C53 13 54 20 49 24 C45 20 38 20 33 22 Z" />
        <path class="portrait-body" d="M38 35 L45 39 L43 43 L36 39 Z" />
        <rect class="portrait-body" x="43" y="37" width="15" height="7" rx="3.5" />
        <path class="portrait-body" d="M8 56 C8 52 13 52 13 56 Z" />
        <path class="portrait-body" d="M14 56 C14 53 19 53 19 56 Z" />
        <circle class="portrait-accent" cx="40" cy="23" r="1.6" />
        <circle class="portrait-accent" cx="45" cy="23" r="1.6" />
        <rect class="portrait-accent" x="46" y="39.5" width="9" height="1.4" rx="0.7" />
      `,
    },
  ],
  [
    "galehollow",
    {
      description:
        "A lean wind-caller with both arms flung wide, its hair and torn hem streaming sideways in the gale it holds open",
      inner: `
        <path class="portrait-body" d="M28 30 C24 40 23 50 21 56 L43 56 C42 50 42 40 38 30 Z" />
        <path class="portrait-body" d="M43 56 C48 52 54 51 58 52 C53 55 49 56 45 56 Z" />
        <circle class="portrait-body" cx="33" cy="22" r="7" />
        <path class="portrait-body" d="M28 31 L11 21 L8 26 L25 38 Z" />
        <path class="portrait-body" d="M38 31 L55 21 L58 26 L41 38 Z" />
        <path class="portrait-body" d="M37 16 C44 14 50 12 57 8 C51 15 47 20 40 21 C38 21 37 19 37 16 Z" />
        <circle class="portrait-accent" cx="31" cy="22" r="1.7" />
        <circle class="portrait-accent" cx="36" cy="22" r="1.7" />
      `,
    },
  ],
]);

/**
 * The drawing for one opponent: its description and the SVG markup of its
 * figure, or null when no portrait answers to that id — the same shape as
 * cardArt(), so a caller can check a portrait against the written style.
 */
export function opponentPortrait(opponentId) {
  return OPPONENT_PORTRAITS.get(opponentId) ?? null;
}

/**
 * One opponent's portrait, as an <svg> the page can drop beside their name: the
 * figure drawn in that opponent's own accent colour, hidden from assistive
 * technology because the opponent's name, look and deck are written beside it —
 * the picture is what a sighted player sees, not a second thing to be read out.
 */
export function opponentPortraitSvg(opponent) {
  const portrait = opponentPortrait(opponent.id);
  if (!portrait) return null;

  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", "opponent-portrait");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = portrait.inner;
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
