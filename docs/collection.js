/**
 * The player's collection and deck, the match in progress, and the one place
 * all of them are read from and written to.
 *
 * A collection is a list of `{ id, copies }` entries in catalog order; a deck is
 * a flat list of owned card ids, one entry per copy, never holding more copies of
 * an id than the player owns and never more than `DECK_LIMIT` in all. Both live
 * in one versioned record under a single key, so closing the page and
 * coming back is the same collection and the same deck. The match in progress is
 * saved whole under a key of its own and read back by rebuilding it, so a half-
 * played game is progress that survives the page closing too. Storage is never
 * assumed to work: when the browser refuses it, the collection is kept in memory
 * for the session and reported as not saved, rather than the page losing the
 * player's cards — and a match that cannot be written is simply not offered back.
 */

import {
  CARDS,
  CARD_BY_ID,
  DECK_LIMIT,
  OPPONENT_BY_ID,
  OPPONENTS,
  REWARD_POOL,
  STARTER_COLLECTION,
} from "./cards.js";
import { ENERGY_CAP, HERO_HEALTH } from "./match.js";

/**
 * The single key a save lives under — the collection, the deck and the progress
 * beside them. A change to their shape needs a new key; the deck, the wins, the
 * matches and the record against each opponent were each added additively, so a
 * save written before one existed still reads as one that simply has none of it
 * yet.
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
 * A ready-to-play deck built from what a player owns: the catalog walked in
 * order, taking one entry per owned copy of each card until `DECK_LIMIT` is
 * reached. Every id is one the collection holds, no id appears more times than
 * its copies, and the result is derived from the collection alone — so it is the
 * same deck every time and can be checked.
 */
function starterDeck(cards) {
  const owned = new Map(cards.map((card) => [card.id, card.copies]));
  const deck = [];
  for (const card of CARDS) {
    const copies = owned.get(card.id) ?? 0;
    for (let copy = 0; copy < copies && deck.length < DECK_LIMIT; copy += 1) {
      deck.push(card.id);
    }
    if (deck.length === DECK_LIMIT) break;
  }
  return deck;
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
 * The record a player has against each opponent, read from a saved payload: one
 * entry per opponent faced, `{ wins, matches }`, keyed by the opponent's id. A
 * record with no matches behind it is no record — a first meeting reads as one —
 * an id this game does not have is dropped rather than carried, and wins are
 * never allowed to exceed the matches they were won in. A save written before
 * opponents existed reads as a player who has faced nobody yet.
 */
function normalizeOpponents(saved) {
  const opponents = {};
  if (!saved || typeof saved !== "object") return opponents;

  for (const [opponentId, record] of Object.entries(saved)) {
    if (!OPPONENT_BY_ID.has(opponentId)) continue;
    const matches = wholeCount(record?.matches);
    if (matches === 0) continue;
    opponents[opponentId] = { wins: Math.min(wholeCount(record?.wins), matches), matches };
  }
  return opponents;
}

/**
 * The progress saved beside the cards: how many matches have been finished, how
 * many of them were won, the id of the last result recorded, and the record held
 * against each opponent (`opponents`, keyed by opponent id). The id is what
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
    opponents: normalizeOpponents(payload?.opponents),
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

// --------------------------------------------------------------------------
// The match in progress
// --------------------------------------------------------------------------

/**
 * The key an unfinished match is saved under, kept apart from the collection
 * save so the shape of one is never read as if it were the other. A change to a
 * match's shape needs a new key; the match is written whole, so a save from
 * before a field existed reads as a match without it.
 */
export const MATCH_STORAGE_KEY = "selfgrow.match.v1";

// The version stamped into a saved match, so a future shape can be told apart
// from this one instead of being read as if it were the same.
const MATCH_STORAGE_VERSION = 1;

/** A whole, sane number within `[min, max]`, or false — how a saved count is judged. */
function isWholeInRange(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** A card copied out of the catalog, so a restored match never hands out the catalog's own object. */
function catalogCard(cardId) {
  const card = CARD_BY_ID.get(cardId);
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    ability: card.ability ?? null,
    fallAbility: card.fallAbility ?? null,
    hasAttacked: false,
  };
}

/**
 * One pile of a restored side, or null when a card in it is not one a match
 * could hold. A card in hand or in the deck takes its catalog stats, as it was
 * dealt; a card on the table keeps the health it is down to and whether it has
 * already struck, so a wounded card comes back wounded rather than healed.
 */
function restorePile(cards, onTable) {
  if (!Array.isArray(cards)) return null;

  const restored = [];
  for (const entry of cards) {
    const known = CARD_BY_ID.get(entry?.id);
    if (!known) return null;
    const card = catalogCard(known.id);
    if (onTable) {
      if (!isWholeInRange(entry.health, 1, known.health)) return null;
      card.health = entry.health;
      card.hasAttacked = Boolean(entry.hasAttacked);
    }
    restored.push(card);
  }
  return restored;
}

/** One side of a restored match, or null when any of its numbers could not be on a board. */
function restoreSide(saved) {
  if (!saved || typeof saved !== "object") return null;
  if (!isWholeInRange(saved.health, 1, HERO_HEALTH)) return null;
  if (!isWholeInRange(saved.maxEnergy, 1, ENERGY_CAP)) return null;
  // A side never holds more energy than its maximum: it is refilled to it at the
  // start of its own turn, and cards only spend from there.
  if (!isWholeInRange(saved.energy, 0, saved.maxEnergy)) return null;
  if (!Number.isSafeInteger(saved.turns) || saved.turns < 0) return null;

  const hand = restorePile(saved.hand, false);
  const table = restorePile(saved.table, true);
  const deck = restorePile(saved.deck, false);
  if (!hand || !table || !deck) return null;

  return {
    health: saved.health,
    energy: saved.energy,
    maxEnergy: saved.maxEnergy,
    turns: saved.turns,
    hand,
    table,
    deck,
  };
}

/**
 * Rebuild a match from the payload the browser stored, or null when it is not an
 * unfinished match this version can restore. It is a rebuild rather than a
 * replay: every card is looked up in the catalog again, so a save naming a card
 * that no longer exists — or a hero with impossible health — reads as no match at
 * all instead of a broken board.
 */
function rehydrateMatch(saved) {
  if (!saved || saved.version !== MATCH_STORAGE_VERSION) return null;
  // A finished match is never saved; one that says it is finished is a record,
  // not a game to pick back up.
  if (saved.over === true || saved.recorded === true) return null;
  // An unfinished match always sits on the player's turn: the opponent takes its
  // whole turn inside one move, so no save is ever taken mid-turn.
  if (saved.turn !== "player") return null;
  if (typeof saved.id !== "string" || !saved.id) return null;
  if (typeof saved.opponentName !== "string" || !saved.opponentName.trim()) return null;
  if (!Array.isArray(saved.log) || !saved.log.every((line) => typeof line === "string")) return null;

  const player = restoreSide(saved.player);
  const opponent = restoreSide(saved.opponent);
  if (!player || !opponent) return null;

  // Which character the match is against. A save written before a player could
  // choose an opponent carries only the name, so the id is read from the name it
  // does carry rather than the match coming back without one.
  const faced = OPPONENTS.find(
    (entry) => entry.id === saved.opponentId || entry.name === saved.opponentName
  );

  return {
    id: saved.id,
    opponentId: faced?.id ?? null,
    opponentName: saved.opponentName,
    turn: "player",
    over: false,
    winner: null,
    outcome: null,
    recorded: false,
    player,
    opponent,
    log: [...saved.log],
  };
}

/**
 * The unfinished match saved in the browser, or null when there is none to
 * restore — the key is absent, the text will not parse, or it is not an
 * unfinished match this version holds. A browser that refuses storage reads as
 * no match, so nothing is ever offered that could not be read back.
 */
export function readSavedMatch(storage = defaultStorage()) {
  let raw;
  try {
    raw = storage.getItem(MATCH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return rehydrateMatch(parsed);
}

/**
 * Save the match in progress, returning false when the write fails so the page
 * can tell a match the browser will keep from one it would not.
 */
export function saveMatch(match, storage = defaultStorage()) {
  try {
    storage.setItem(MATCH_STORAGE_KEY, JSON.stringify({ version: MATCH_STORAGE_VERSION, ...match }));
    return true;
  } catch {
    return false;
  }
}

/** Forget the saved match — a finished one, or one a new deal has replaced. */
export function clearSavedMatch(storage = defaultStorage()) {
  try {
    storage.removeItem(MATCH_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
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
        opponents: normalizeOpponents(progress?.opponents),
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
 * The reward card a win would add next: the first card in `REWARD_POOL` the
 * collection does not hold, or null once every one of them is held.
 *
 * This is the one place the choice is made, so the card the home screen promises
 * under "Next win earns" and the card `recordResult` actually awards can never
 * disagree. The starter collection holds every non-reward card, so a reward card
 * not held is simply one left to earn.
 */
export function nextRewardId(cards) {
  const owned = new Set(cards.map((card) => card.id));
  return REWARD_POOL.find((id) => !owned.has(id)) ?? null;
}

/**
 * Record a finished match. The match counts toward the matches played; a win
 * adds exactly one reward card to the collection, and a loss adds none. A win
 * earns the first reward card the player does not hold yet — the same card
 * `nextRewardId` names — so each win keeps the collection growing; only once
 * every reward card is held does it fall back to the cycle of `REWARD_POOL` by
 * wins — a duplicate — and report the set as complete.
 *
 * `opponentId` is who the match was against, so the result is counted against
 * that opponent's own record and nobody else's. The match always counts there;
 * the win only when the match was won.
 *
 * `matchId` is remembered so that recording the same match again — a result
 * screen asked for twice — does nothing instead of awarding a second card.
 * Returns the collection this produced, the new totals, the record held against
 * each opponent (`opponents`), whether this win was the first against that
 * opponent (`firstWin`), the card that was added (or null), whether the set was
 * already complete (`setComplete`, true only when the reward was a duplicate
 * because nothing was left to earn), and whether the save will survive closing
 * the page.
 */
export function recordResult(outcome, matchId, storage = defaultStorage(), opponentId = null) {
  const cards = readCollection(storage) ?? starterCards();
  const progress = readProgress(storage);

  if (matchId != null && progress.lastMatchId === matchId) {
    return {
      cards,
      wins: progress.wins,
      matches: progress.matches,
      opponents: progress.opponents,
      firstWin: false,
      awarded: null,
      setComplete: false,
      recorded: false,
      saved: storage?.durable !== false,
    };
  }

  const won = outcome === "win";
  // A reward card left to earn is a card the player does not own; none left
  // means the whole game's set is already held.
  const unownedRewardId = nextRewardId(cards);
  const setComplete = won && unownedRewardId === null;
  const awardedId = won
    ? (unownedRewardId ?? REWARD_POOL[progress.wins % REWARD_POOL.length])
    : null;
  const nextCards = awardedId ? withExtraCopy(cards, awardedId) : cards;
  const wins = progress.wins + (won ? 1 : 0);
  const matches = progress.matches + 1;
  const faced = countOpponentResult(progress.opponents, opponentId, won);
  const wrote = writeSave(nextCards, readDeck(storage), storage, {
    wins,
    matches,
    lastMatchId: matchId ?? progress.lastMatchId,
    opponents: faced.opponents,
  });

  return {
    cards: nextCards,
    wins,
    matches,
    opponents: faced.opponents,
    firstWin: faced.firstWin,
    awarded: awardedId ? { ...CARD_BY_ID.get(awardedId) } : null,
    setComplete,
    recorded: true,
    saved: wrote && storage?.durable !== false,
  };
}

/**
 * One finished match counted against the opponent it was fought: that
 * opponent's record gains a match, and a win too when the match was won. The
 * `firstWin` beside it is true exactly when the win was that opponent's first,
 * so the result screen can say so. An id naming no opponent this game has
 * changes nothing and is never a first win, rather than leaving a record behind
 * for a character nobody can face.
 */
function countOpponentResult(opponents, opponentId, won) {
  if (!OPPONENT_BY_ID.has(opponentId)) return { opponents, firstWin: false };

  const before = opponents[opponentId] ?? { wins: 0, matches: 0 };
  return {
    opponents: {
      ...opponents,
      [opponentId]: { wins: before.wins + (won ? 1 : 0), matches: before.matches + 1 },
    },
    firstWin: won && before.wins === 0,
  };
}

/**
 * The game to open with: the saved collection and deck when there is a usable
 * save, otherwise the starter collection and a ready-to-play deck built from it,
 * saved so the next visit finds them.
 *
 * A deck is dealt rather than left empty so a first visit opens with a game in
 * hand: a saved deck is always returned untouched, but a save with no deck — or
 * none at all — is given the same default, built from the cards the player owns.
 * A card once placed can still be taken out on the Collection screen, so the
 * default is a starting point rather than a locked deck.
 *
 * `saved` says whether the player's cards and deck will still be here after they
 * close the page — false when storage is blocked or the write failed, which the
 * page shows rather than pretending they are safe.
 */
export function loadGame(storage = defaultStorage()) {
  const progress = readProgress(storage);
  const cards = readCollection(storage);
  if (cards) {
    const saved = readDeck(storage);
    if (saved.length > 0) {
      return {
        cards,
        deck: saved,
        wins: progress.wins,
        matches: progress.matches,
        opponents: progress.opponents,
        saved: storage?.durable !== false,
      };
    }
    const deck = starterDeck(cards);
    const wrote = saveDeck(cards, deck, storage);
    return {
      cards,
      deck,
      wins: progress.wins,
      matches: progress.matches,
      opponents: progress.opponents,
      saved: wrote && storage?.durable !== false,
    };
  }

  const starter = starterCards();
  const deck = starterDeck(starter);
  const wrote = saveDeck(starter, deck, storage);
  return {
    cards: starter,
    deck,
    wins: 0,
    matches: 0,
    opponents: {},
    saved: wrote && storage?.durable !== false,
  };
}

/** How many cards the collection holds, copies counted. */
export function collectionSize(cards) {
  return cards.reduce((total, card) => total + card.copies, 0);
}

/**
 * The collection with each card's name, cost, attack, health and both abilities
 * filled in — `ability` for the text it prints when played and `fallAbility` for
 * the text it prints when it falls, each `null` for a card that carries none.
 */
export function listOwnedCards(cards) {
  return cards.map(({ id, copies }) => {
    const card = CARD_BY_ID.get(id);
    return {
      id,
      name: card.name,
      cost: card.cost,
      attack: card.attack,
      health: card.health,
      ability: card.ability ?? null,
      fallAbility: card.fallAbility ?? null,
      copies,
    };
  });
}

/**
 * Every card in the game, in catalog order, each with its name, cost, attack,
 * health and its two abilities (`ability` for when it is played and `fallAbility`
 * for when it falls, each the text on its face or `null` when it has none), how
 * many copies the collection holds, and whether it holds any at all. A card the player
 * does not own appears too — zero copies, `owned` false — so the whole set can be
 * shown beside what has been collected from it.
 */
export function listAllCards(cards) {
  const copiesById = new Map(cards.map((card) => [card.id, card.copies]));
  return CARDS.map((card) => {
    const copies = copiesById.get(card.id) ?? 0;
    return {
      id: card.id,
      name: card.name,
      cost: card.cost,
      attack: card.attack,
      health: card.health,
      ability: card.ability ?? null,
      fallAbility: card.fallAbility ?? null,
      copies,
      owned: copies > 0,
    };
  });
}

/**
 * The deck as full card descriptions, in the order the player chose them, each
 * with its when-played and fall ability text, or `null` for either it does not
 * carry.
 */
export function listDeckCards(deck) {
  return deck.map((id) => {
    const card = CARD_BY_ID.get(id);
    return {
      id,
      name: card.name,
      cost: card.cost,
      attack: card.attack,
      health: card.health,
      ability: card.ability ?? null,
      fallAbility: card.fallAbility ?? null,
    };
  });
}
