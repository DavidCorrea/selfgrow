/**
 * The player's collection, and the one place it is read from and written to.
 *
 * A collection is a list of `{ id, copies }` entries in catalog order. It is
 * saved in the browser under a single versioned key, so closing the page and
 * coming back is the same collection. Storage is never assumed to work: when the
 * browser refuses it, the collection is kept in memory for the session and
 * reported as not saved, rather than the page losing the player's cards.
 */

import { CARDS, CARD_BY_ID, STARTER_COLLECTION } from "./cards.js";

/** The single key a collection lives under. A change of shape needs a new key. */
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
 * The saved collection, or null when there is none to read — the key is absent,
 * the payload will not parse, or it is not a collection this version knows.
 */
export function readCollection(storage = defaultStorage()) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    return normalizeCollection(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Write a collection to storage, returning false when the write fails. */
export function saveCollection(cards, storage = defaultStorage()) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, cards }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The collection to open the game with: the saved one when there is a usable
 * save, otherwise the starter collection, saved so the next visit finds it.
 *
 * `saved` says whether the player's cards will still be here after they close
 * the page — false when storage is blocked or the write failed, which the page
 * shows rather than pretending the collection is safe.
 */
export function loadCollection(storage = defaultStorage()) {
  const existing = readCollection(storage);
  if (existing) return { cards: existing, saved: storage?.durable !== false };

  const starter = starterCards();
  const wrote = saveCollection(starter, storage);
  return { cards: starter, saved: wrote && storage?.durable !== false };
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
