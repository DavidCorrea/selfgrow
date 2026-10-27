/**
 * The cards selfgrow knows about, the hand a new player is dealt, and the deck
 * the opponent brings.
 *
 * Everything here is plain data defined in the product — no card is fetched, and
 * no stat is computed from another. A card is identified by its `id`, and that is
 * the only field a saved collection stores; every display field is looked up from
 * here, so renaming a card never loses the copies a player owns of it.
 */

/** Every card in the game: id, name, cost to play, attack, health. */
export const CARDS = [
  { id: "sprout", name: "Sprout", cost: 1, attack: 1, health: 1 },
  { id: "pebble-toad", name: "Pebble Toad", cost: 1, attack: 1, health: 2 },
  { id: "thornling", name: "Thornling", cost: 2, attack: 2, health: 1 },
  { id: "sun-moth", name: "Sun Moth", cost: 2, attack: 1, health: 3 },
  { id: "bramble-hound", name: "Bramble Hound", cost: 2, attack: 3, health: 1 },
  { id: "glowcap", name: "Glowcap", cost: 3, attack: 2, health: 4 },
  { id: "mudback-turtle", name: "Mudback Turtle", cost: 3, attack: 1, health: 5 },
  { id: "vine-lasher", name: "Vine Lasher", cost: 3, attack: 3, health: 2 },
  { id: "storm-crow", name: "Storm Crow", cost: 4, attack: 4, health: 2 },
  { id: "emberling", name: "Emberling", cost: 4, attack: 3, health: 3 },
  { id: "root-colossus", name: "Root Colossus", cost: 5, attack: 5, health: 6 },
  { id: "elder-oak", name: "Elder Oak", cost: 6, attack: 4, health: 9 },
  // The reward cards, earned by winning rather than dealt at the start. They are
  // real cards — playable, and saved like any other — so a win grows what a
  // player can put in a deck.
  { id: "moon-bloom", name: "Moon Bloom", cost: 2, attack: 2, health: 3 },
  { id: "amber-antler", name: "Amber Antler", cost: 4, attack: 4, health: 3 },
  { id: "cinder-shrike", name: "Cinder Shrike", cost: 3, attack: 4, health: 1 },
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
export const REWARD_POOL = ["moon-bloom", "amber-antler", "cinder-shrike"];

/**
 * The opponent the player faces: a character, with a deck of their own.
 *
 * The deck is fixed — the same ten cards in every match — and drawn from the
 * same catalog a player's deck is, so every card the opponent draws and plays
 * is a real card the player can own. It is deliberately not the player's deck:
 * what you choose for your own deck is what you are up against, instead of a
 * race against a copy of yourself.
 */
export const OPPONENT_NAME = "Thornmere";

/**
 * The fixed deck the opponent is dealt from: slow, thorned, mud-backed growth,
 * the opposite of a deck built for speed.
 *
 * The order is part of the fixture, not an accident: a deal with a fixed random
 * source leaves the second, third and fourth cards in the opponent's opening
 * hand, so the turtle and the thornling there are what the match's own checks
 * fight with. Reordering this list means rethinking those checks.
 */
export const OPPONENT_DECK = [
  "vine-lasher",
  "mudback-turtle",
  "thornling",
  "glowcap",
  "bramble-hound",
  "moon-bloom",
  "cinder-shrike",
  "sun-moth",
  "root-colossus",
  "elder-oak",
];
