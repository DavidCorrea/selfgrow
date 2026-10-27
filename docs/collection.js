/**
 * The player's collection and deck, and the one place both are read from and
 * written to.
 *
 * A collection is a list of `{ id, copies }` entries in catalog order; a deck is
 * a flat list of owned card ids, one entry per copy, never holding more copies of
 * an id than the player owns and never more than `DECK_LIMIT` in all. Both live
 * in one versioned record under a single key, so closing the page and
 * coming back is the same collection and the same deck. Storage is never assumed
 * to work: when the browser refuses it, the collection is kept in memory for the
 * session and reported as not saved, rather than the page losing the player's
 * cards.
 */

import { CARDS, CARD_BY_ID, DECK_LIMIT, REWARD_POOL, STARTER_COLLECTION } from "./cards.js";

/**
 * The single key a save lives under — the collection, the deck and the progress
 * beside them. A change to their shape needs a new key; the deck, the wins and
 * the matches were each added additively, so a save written before one existed
 * still reads as one that simply has none of it yet.
 */
export const STORAGE_KEY = "selfgrow.collection.v1";

// The version stamped into the saved payload, so a future shape can be told
// apart from this one instead of being read as if it were the same.
const STORAGE_VERSION = 1;

const STORAGE_PROBE_KEY = "selfgrow.storage.probe";

// Held in module scope so a browser that blocks storage still keeps one
// collection for the whole session instead of a fresh one per call.
let fallbackStorage = null;

function memoryStorage() {
  const entries = new Map();
  return {
    durable: false,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

/**
 * The storage the game uses: the browser's own when it works, otherwise a
 * session-only one that reports itself as not durable. Both answer to the same
 * small interface, so nothing above this line has to care which it got.
 */
function defaultStorage() {
  try {
    const store = window.localStorage;
    store.setItem(STORAGE_PROBE_KEY, "1");
    store.removeItem(STORAGE_PROBE_KEY);
    return {
      durable: true,
      getItem: (key) => store.getItem(key),
      setItem: (key, value) => store.setItem(key, value),
      removeItem: (key) => store.removeItem(key),
    };
  } catch {
    if (!fallbackStorage) fallbackStorage = memoryStorage();
    return fallbackStorage;
  }
}

/** A fresh copy of what a new player is dealt. */
function starterCards() {
  return STARTER_COLLECTION.map(({ id, copies }) => ({ id, copies }));
}

/**
 * Read a raw saved payload into a collection, or null when there is nothing
 * usable in it. Entries that name an unknown card or a nonsense copy count are
 * dropped; duplicate ids are added together. The result is in catalog order, so
 * the order a save happened to be written in never changes what the player sees.
 */
function normalizeCollection(saved) {
  if (!saved || saved.version !== STORAGE_VERSION || !Array.isArray(saved.cards)) return null;

  const copiesById = new Map();
  for (const entry of saved.cards) {
    const card = CARD_BY_ID.get(entry?.id);
    const copies = Number(entry?.copies);
    // A copy count is a whole, sane number. Absurd values are dropped rather
    // than reaching the screen as "1e+21 copies".
    if (!card || !Number.isSafeInteger(copies) || copies < 1) continue;
    copiesById.set(card.id, (copiesById.get(card.id) ?? 0) + copies);
  }

  return CARDS.filter((card) => copiesById.has(card.id)).map((card) => ({
    id: card.id,
    copies: copiesById.get(card.id),
  }));
}

/**
 * Read the saved payload as the browser stored it, or null when there is none to
 * read — the key is absent or the text will not parse. The shape of the payload
 * is judged by whoever reads a field out of it, not here.
 */
function readPayload(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * A deck read from a saved payload: owned card ids only, at most as many copies
 * of each as the player owns, never more than `DECK_LIMIT` in all. A deck naming
 * a card the player does not own, or repeating an id more times than it is owned,
 * is cleaned up rather than reaching the screen.
 */
function normalizeDeck(payload, cards) {
  if (!Array.isArray(payload?.deck)) return [];

  const ownedCopies = new Map(cards.map((card) => [card.id, card.copies]));
  const placed = new Map();
  const deck = [];
  for (const id of payload.deck) {
    if (typeof id !== "string") continue;
    const owned = ownedCopies.get(id) ?? 0;
    const already = placed.get(id) ?? 0;
    if (already >= owned) continue;
    placed.set(id, already + 1);
    deck.push(id);
    if (deck.length === DECK_LIMIT) break;
  }
  return deck;
}

/**
 * The saved collection, or null when there is none to read — the key is absent,
 * the payload will not parse, or it is not a collection this version knows.
 */
export function readCollection(storage = defaultStorage()) {
  return normalizeCollection(readPayload(storage));
}

/** A whole, sane count — anything else (negative, fractional, absurd) reads as 0. */
function wholeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * The progress saved beside the cards: how many matches have been finished, how
 * many of them were won, and the id of the last result recorded. The id is what
 * keeps a single match from being counted twice when its result is revisited.
 * A save written before these fields existed reads as a player who has played
 * nothing yet, rather than as a broken save.
 */
export function readProgress(storage = defaultStorage()) {
  const payload = readPayload(storage);
  return {
    wins: wholeCount(payload?.wins),
    matches: wholeCount(payload?.matches),
    lastMatchId: typeof payload?.lastMatchId === "string" ? payload.lastMatchId : null,
  };
}

/**
 * The saved deck, in the order it was chosen, or an empty one when there is no
 * usable save. Only cards the saved collection owns can be in it.
 */
export function readDeck(storage = defaultStorage()) {
  const payload = readPayload(storage);
  const cards = normalizeCollection(payload);
  if (!cards) return [];
  return normalizeDeck(payload, cards);
}

/** Write a collection, a deck and progress to storage, returning false when the write fails. */
function writeSave(cards, deck, storage, progress = readProgress(storage)) {
  const cleanDeck = normalizeDeck({ deck }, cards);
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        cards,
        deck: cleanDeck,
        wins: wholeCount(progress?.wins),
        matches: wholeCount(progress?.matches),
        lastMatchId: progress?.lastMatchId ?? null,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/** Save a collection, keeping whatever deck and progress are already stored beside it. */
export function saveCollection(cards, storage = defaultStorage()) {
  return writeSave(cards, readDeck(storage), storage);
}

/** Save a deck beside the collection it was chosen from. */
export function saveDeck(cards, deck, storage = defaultStorage()) {
  return writeSave(cards, deck, storage);
}

/** The collection with one more copy of `cardId`, still in catalog order. */
function withExtraCopy(cards, cardId) {
  const copiesById = new Map(cards.map((card) => [card.id, card.copies]));
  copiesById.set(cardId, (copiesById.get(cardId) ?? 0) + 1);
  return CARDS.filter((card) => copiesById.has(card.id)).map((card) => ({
    id: card.id,
    copies: copiesById.get(card.id),
  }));
}

/**
 * Record a finished match. The match counts toward the matches played; a win
 * adds exactly one reward card to the collection, and a loss adds none. A win
 * earns the first reward card the player does not hold yet, so each win keeps
 * the collection growing; only once every reward card is held does it fall back
 * to the cycle of `REWARD_POOL` by wins — a duplicate — and report the set as
 * complete.
 *
 * `matchId` is remembered so that recording the same match again — a result
 * screen asked for twice — does nothing instead of awarding a second card.
 * Returns the collection this produced, the new totals, the card that was added
 * (or null), whether the set was already complete (`setComplete`, true only when
 * the reward was a duplicate because nothing was left to earn), and whether the
 * save will survive closing the page.
 */
export function recordResult(outcome, matchId, storage = defaultStorage()) {
  const cards = readCollection(storage) ?? starterCards();
  const progress = readProgress(storage);

  if (matchId != null && progress.lastMatchId === matchId) {
    return {
      cards,
      wins: progress.wins,
      matches: progress.matches,
      awarded: null,
      setComplete: false,
      recorded: false,
      saved: storage?.durable !== false,
    };
  }

  const won = outcome === "win";
  // The starter collection owns every non-reward card, so a reward card the
  // player does not hold is simply a card they do not own — and none left to
  // earn means the whole game's set is already held.
  const owned = new Set(cards.map((card) => card.id));
  const unownedRewardId = REWARD_POOL.find((id) => !owned.has(id));
  const setComplete = won && unownedRewardId === undefined;
  const awardedId = won
    ? (unownedRewardId ?? REWARD_POOL[progress.wins % REWARD_POOL.length])
    : null;
  const nextCards = awardedId ? withExtraCopy(cards, awardedId) : cards;
  const wins = progress.wins + (won ? 1 : 0);
  const matches = progress.matches + 1;
  const wrote = writeSave(nextCards, readDeck(storage), storage, {
    wins,
    matches,
    lastMatchId: matchId ?? progress.lastMatchId,
  });

  return {
    cards: nextCards,
    wins,
    matches,
    awarded: awardedId ? { ...CARD_BY_ID.get(awardedId) } : null,
    setComplete,
    recorded: true,
    saved: wrote && storage?.durable !== false,
  };
}

/**
 * The game to open with: the saved collection and deck when there is a usable
 * save, otherwise the starter collection and an empty deck, saved so the next
 * visit finds them.
 *
 * `saved` says whether the player's cards and deck will still be here after they
 * close the page — false when storage is blocked or the write failed, which the
 * page shows rather than pretending they are safe.
 */
export function loadGame(storage = defaultStorage()) {
  const progress = readProgress(storage);
  const cards = readCollection(storage);
  if (cards) {
    return {
      cards,
      deck: readDeck(storage),
      wins: progress.wins,
      matches: progress.matches,
      saved: storage?.durable !== false,
    };
  }

  const starter = starterCards();
  const wrote = saveDeck(starter, [], storage);
  return { cards: starter, deck: [], wins: 0, matches: 0, saved: wrote && storage?.durable !== false };
}

/** How many cards the collection holds, copies counted. */
export function collectionSize(cards) {
  return cards.reduce((total, card) => total + card.copies, 0);
}

/** The collection with each card's name, cost, attack and health filled in. */
export function listOwnedCards(cards) {
  return cards.map(({ id, copies }) => {
    const card = CARD_BY_ID.get(id);
    return { id, name: card.name, cost: card.cost, attack: card.attack, health: card.health, copies };
  });
}

/** The deck as full card descriptions, in the order the player chose them. */
export function listDeckCards(deck) {
  return deck.map((id) => {
    const card = CARD_BY_ID.get(id);
    return { id, name: card.name, cost: card.cost, attack: card.attack, health: card.health };
  });
}
