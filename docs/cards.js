/**
 * The cards selfgrow knows about, the hand a new player is dealt, and the
 * opponents a match can be fought against, each with the deck it brings.
 *
 * Everything here is plain data defined in the product — no card is fetched, and
 * no stat is computed from another. A card is identified by its `id`, and that is
 * the only field a saved collection stores; every display field is looked up from
 * here, so renaming a card never loses the copies a player owns of it.
 */

/**
 * The when-played abilities a card can carry, in the words printed on its face.
 * Each is written once here so the text on the card, the trigger in the match
 * and the text a tool reports can never drift apart.
 *
 * `DRAW_ON_PLAY` takes the top card of its owner's deck into that hand as the
 * card lands. `HEAL_ON_PLAY` mends its owner's hero instead — the other half of
 * what a card can do as it lands, and a slow deck's answer to an early rush.
 * `STRIKE_ON_PLAY` answers the board itself: the card hits the front card of the
 * opponent's table, or the opponent's hero once that table is empty, on the same
 * targeting the rest of the game uses when a turn ends.
 */
export const DRAW_ON_PLAY = "When played: draw a card";

/** How much health a card that heals its owner's hero when played restores. */
export const HEAL_ON_PLAY_AMOUNT = 2;

/**
 * The ability a card carries when it mends its owner's hero as it lands. The
 * amount is written into the words on the face from the same constant the match
 * heals by, so the card can never promise a number the trigger does not pay.
 */
export const HEAL_ON_PLAY = `When played: heal your hero ${HEAL_ON_PLAY_AMOUNT}`;

/** How much damage a card that strikes as it lands deals to the opponent's front
 * card, or to the opponent's hero once their table is empty. */
export const STRIKE_ON_PLAY_AMOUNT = 1;

/**
 * The ability a card carries when it strikes the board as it lands. The amount is
 * written into the words on the face from the same constant the match damages by,
 * so the card can never promise a number the trigger does not deal.
 */
export const STRIKE_ON_PLAY = `When played: deal ${STRIKE_ON_PLAY_AMOUNT} damage to the opponent's front card`;

/** Every card in the game: id, name, cost to play, attack, health, and the
 * ability printed on its face (absent on a card with none). */
export const CARDS = [
  // A seedling and a water spirit: the two living things that read as mending
  // what they touch, so each carries the heal ability below. Sprout is dealt at
  // the start and Dewdrop Nymph is a reward, so the ability is met early and
  // then collected for, as the draw ability is.
  { id: "sprout", name: "Sprout", cost: 1, attack: 1, health: 1, ability: HEAL_ON_PLAY },
  { id: "pebble-toad", name: "Pebble Toad", cost: 1, attack: 1, health: 2 },
  { id: "thornling", name: "Thornling", cost: 2, attack: 2, health: 1 },
  { id: "sun-moth", name: "Sun Moth", cost: 2, attack: 1, health: 3 },
  { id: "bramble-hound", name: "Bramble Hound", cost: 2, attack: 3, health: 1 },
  { id: "glowcap", name: "Glowcap", cost: 3, attack: 2, health: 4, ability: DRAW_ON_PLAY },
  { id: "mudback-turtle", name: "Mudback Turtle", cost: 3, attack: 1, health: 5 },
  { id: "vine-lasher", name: "Vine Lasher", cost: 3, attack: 3, health: 2 },
  { id: "storm-crow", name: "Storm Crow", cost: 4, attack: 4, health: 2 },
  { id: "emberling", name: "Emberling", cost: 4, attack: 3, health: 3 },
  { id: "root-colossus", name: "Root Colossus", cost: 5, attack: 5, health: 6 },
  { id: "elder-oak", name: "Elder Oak", cost: 6, attack: 4, health: 9 },
  // The reward cards, earned by winning rather than dealt at the start. They are
  // real cards — playable, and saved like any other — so a win grows what a
  // player can put in a deck. Moon Bloom, the first one a win earns, is also one
  // of the two cards that draw a card when played, so the ability is met in the
  // starter deck and then hunted for in the reward pool.
  { id: "moon-bloom", name: "Moon Bloom", cost: 2, attack: 2, health: 3, ability: DRAW_ON_PLAY },
  { id: "amber-antler", name: "Amber Antler", cost: 4, attack: 4, health: 3 },
  // Two reward cards read as the aggressive ones — a hooked-beak bird with a
  // fiery tip and a crested drake — so each carries the strike ability, the one
  // that answers what is already on the board rather than only adding to it.
  { id: "cinder-shrike", name: "Cinder Shrike", cost: 3, attack: 4, health: 1, ability: STRIKE_ON_PLAY },
  { id: "dewdrop-nymph", name: "Dewdrop Nymph", cost: 1, attack: 1, health: 3, ability: HEAL_ON_PLAY },
  { id: "twilight-fox", name: "Twilight Fox", cost: 3, attack: 2, health: 2 },
  { id: "bark-sentinel", name: "Bark Sentinel", cost: 5, attack: 3, health: 8 },
  // Six more reward cards, spread across the cost curve so a collection keeps
  // handing back something new at every size of deck.
  { id: "moss-glider", name: "Moss Glider", cost: 1, attack: 2, health: 1 },
  { id: "fern-drake", name: "Fern Drake", cost: 2, attack: 2, health: 2, ability: STRIKE_ON_PLAY },
  { id: "boulder-ram", name: "Boulder Ram", cost: 3, attack: 3, health: 2 },
  { id: "hollow-wisp", name: "Hollow Wisp", cost: 4, attack: 2, health: 5 },
  { id: "granite-warden", name: "Granite Warden", cost: 5, attack: 4, health: 6 },
  { id: "ironbark-titan", name: "Ironbark Titan", cost: 6, attack: 6, health: 7 },
];

/** Lookup by id — the shape the saved collection speaks in. */
export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

/**
 * The rules a deck is built to: no more than ten cards may be chosen, and a
 * match needs at least five before it is worth starting. Both are stated in the
 * UI beside the deck, and both are what the page enforces rather than merely
 * printing.
 */
export const DECK_LIMIT = 10;
export const MINIMUM_DECK_SIZE = 5;

/**
 * What a new player owns the first time they open the game: twelve different
 * cards, with a few of the cheap ones held in more than one copy.
 */
export const STARTER_COLLECTION = [
  // A reward card is deliberately absent here: winning is the only way to own
  // one, which is what makes a match worth playing again.

  { id: "sprout", copies: 3 },
  { id: "pebble-toad", copies: 2 },
  { id: "bramble-hound", copies: 2 },
  { id: "thornling", copies: 1 },
  { id: "sun-moth", copies: 1 },
  { id: "glowcap", copies: 1 },
  { id: "mudback-turtle", copies: 1 },
  { id: "vine-lasher", copies: 1 },
  { id: "storm-crow", copies: 1 },
  { id: "emberling", copies: 1 },
  { id: "root-colossus", copies: 1 },
  { id: "elder-oak", copies: 1 },
];

/**
 * The cards a win can add, in the order they are preferred: a win earns the
 * first one the player does not hold yet, so the order is the order the pool is
 * exhausted in. None of them is in the starter collection, so the first wins are
 * always cards the player did not already have. Once every one of them is held,
 * a win falls back to walking this list by how many matches have been won — a
 * duplicate.
 */
export const REWARD_POOL = [
  "moon-bloom",
  "amber-antler",
  "cinder-shrike",
  "dewdrop-nymph",
  "twilight-fox",
  "bark-sentinel",
  "moss-glider",
  "fern-drake",
  "boulder-ram",
  "hollow-wisp",
  "granite-warden",
  "ironbark-titan",
];

/**
 * The opponents a player can face: characters, each with a look and a deck of
 * their own.
 *
 * Every deck is fixed — the same ten cards in every match against that
 * character — and drawn from the same catalog a player's deck is, so every card
 * an opponent draws and plays is a real card the player can own. None of them is
 * the player's own deck: what you choose for your deck is what you are up
 * against, instead of a race against a copy of yourself. Facing a different
 * character is what changes the game from one puzzle into a choice.
 *
 * `accent` names a colour token from styles.css rather than a colour, so the one
 * place a colour is written stays the stylesheet, and the opponent's portrait in
 * docs/cardart.js is painted in it. `cardPreference` is how the opponent
 * spends its turn: `"dearest"` plays the biggest body it can afford, `"cheapest"`
 * plays its smallest cards first so its table fills with several at once — the
 * choice that makes the kind of deck its `description` promises the kind of match
 * it plays. Each deck also brings a card that does something as it lands, chosen
 * to suit that same promise — the slow, wearing character mends, the fast ones
 * strike — so a player meets the ability inside a match and learns to watch for
 * it on the opponent's turn. The first entry is the opponent a match is against
 * unless the player picks another.
 */
export const OPPONENTS = [
  {
    id: "thornmere",
    name: "Thornmere",
    look: "a thorned warden of the deep wood, mud-backed and slow to fall",
    description: "Slow, thorned growth — big bodies that wear you down",
    cardPreference: "dearest",
    accent: "--opponent-thornmere",
    deck: [
      "vine-lasher",
      "mudback-turtle",
      "thornling",
      "glowcap",
      "dewdrop-nymph",
      "moon-bloom",
      "cinder-shrike",
      "sun-moth",
      "root-colossus",
      "elder-oak",
    ],
  },
  {
    id: "emberwake",
    name: "Emberwake",
    look: "a burning herald, all sparks and lit grass",
    description: "Fast, cheap strikers that hit before you can answer",
    cardPreference: "cheapest",
    accent: "--opponent-emberwake",
    deck: [
      "dewdrop-nymph",
      "sprout",
      "pebble-toad",
      "bramble-hound",
      "cinder-shrike",
      "thornling",
      "twilight-fox",
      "moon-bloom",
      "vine-lasher",
      "emberling",
    ],
  },
  {
    id: "mistfen",
    name: "Mistfen",
    look: "a fog-bound fen where wet things creep and gather",
    description: "Cheap, creeping things that rise from the fen in numbers",
    cardPreference: "cheapest",
    accent: "--opponent-mistfen",
    deck: [
      "dewdrop-nymph",
      "sprout",
      "pebble-toad",
      "moss-glider",
      "thornling",
      "sun-moth",
      "bramble-hound",
      "twilight-fox",
      "moon-bloom",
      "fern-drake",
    ],
  },
];

/** The opponents a match can be fought against, looked up by the id a caller names. */
export const OPPONENT_BY_ID = new Map(OPPONENTS.map((opponent) => [opponent.id, opponent]));

/**
 * The opponent a match is against until another is chosen: Thornmere, first in
 * the list, whose deck is the fixture the match's own checks were written
 * against.
 */
export const DEFAULT_OPPONENT = OPPONENTS[0];

export const OPPONENT_NAME = DEFAULT_OPPONENT.name;

/**
 * Thornmere's fixed deck: slow, thorned, mud-backed growth, the opposite of a
 * deck built for speed.
 *
 * The order is part of the fixture, not an accident: a deal with a fixed random
 * source leaves the second, third and fourth cards in the opponent's opening
 * hand, so the turtle and the thornling there are what the match's own checks
 * fight with. Reordering this list means rethinking those checks.
 */
export const OPPONENT_DECK = DEFAULT_OPPONENT.deck;
