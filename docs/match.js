/**
 * A match: one game of selfgrow against the opponent, taken a turn at a time.
 *
 * The match is a plain object — two sides of numbers and card lists, whose turn
 * it is, and an ordered log of plain sentences. There is no DOM here and no
 * hidden randomness: the only random thing is the shuffle, which takes its
 * random source as an argument, so a caller can deal a repeatable game and a
 * check can assert what a turn did instead of what it happened to do.
 *
 * `playCard` and `endTurn` mutate the match they are given and return it. A move
 * they cannot make is refused by throwing a sentence a player can read, leaving
 * the match untouched — including any move at all once the match is over.
 *
 * A match ends the moment either hero's health reaches zero: `over` turns true,
 * `winner` names the side that dealt the final blow, `outcome` says it from the
 * player's side ("win" or "loss"), and the log's last line is that blow, in
 * words a player can read back. Health is clamped at zero as it lands, so the
 * number on the board and the number here never disagree. `recorded` is false
 * until the result has been saved, so a finished match is never counted twice.
 *
 * Damage goes to heroes only, so a card is never damaged and the rule that a
 * card at zero health leaves the table is unreachable — there is nothing here
 * that could reach it.
 */

import { CARDS, CARD_BY_ID, MINIMUM_DECK_SIZE } from "./cards.js";

/** Both heroes start at this much health and stay there until a match can end. */
export const HERO_HEALTH = 20;

/** How many cards each side is dealt from its shuffled deck at the start. */
export const STARTING_HAND = 3;

/** The most energy a side has at the start of each of its own turns. */
export const MAX_ENERGY = 3;

// Where each card sits in the catalog, so a tie between two affordable cards is
// broken the same way every time rather than by hand order.
const CATALOG_ORDER = new Map(CARDS.map((card, index) => [card.id, index]));

// A match is given a fresh id as it is dealt, so the result of one match can be
// told apart from the result of the next — the save records the id it counted.
let matchesStarted = 0;
function createMatchId() {
  matchesStarted += 1;
  return `match-${Date.now().toString(36)}-${matchesStarted}`;
}

/** A card the match can hold, copied out of the catalog so nothing mutates it. */
function cardOf(cardId) {
  const card = CARD_BY_ID.get(cardId);
  if (!card) throw new Error(`"${cardId}" is not a card, so it cannot be in a match`);
  return { id: card.id, name: card.name, cost: card.cost, attack: card.attack, health: card.health };
}

/** A fresh copy of the ids, shuffled with `rng` using Fisher–Yates. */
function shuffled(ids, rng) {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    // Clamp so an rng that returns exactly 1 (a stub, not Math.random) cannot
    // index past the end of the array.
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** One side of the match: full health, full energy, a dealt hand and a deck. */
function createSide(deckIds, rng) {
  const order = shuffled(deckIds, rng);
  return {
    health: HERO_HEALTH,
    energy: MAX_ENERGY,
    maxEnergy: MAX_ENERGY,
    hand: order.slice(0, STARTING_HAND).map(cardOf),
    table: [],
    deck: order.slice(STARTING_HAND),
  };
}

/**
 * Start a match from the player's deck ids. Both sides play a mirror of the same
 * deck, each shuffled separately, and each is dealt a starting hand. Refused
 * when the deck holds fewer cards than a match needs.
 */
export function createMatch(deckIds, { rng = Math.random } = {}) {
  const held = Array.isArray(deckIds) ? deckIds.length : 0;
  if (held < MINIMUM_DECK_SIZE) {
    throw new Error(`a match needs at least ${MINIMUM_DECK_SIZE} cards in your deck, but it holds ${held}`);
  }

  const match = {
    id: createMatchId(),
    turn: "player",
    over: false,
    winner: null,
    outcome: null,
    recorded: false,
    player: createSide(deckIds, rng),
    opponent: createSide(deckIds, rng),
    log: [],
  };
  appendLog(
    match,
    `Match started. You hold ${match.player.hand.length} cards; the opponent holds ${match.opponent.hand.length}.`
  );
  return match;
}

/** The catalog rank of a card, used only to break a tie between two cards. */
function catalogRank(card) {
  return CATALOG_ORDER.get(card.id) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The best card a side can afford: the most expensive, then the stronger, then
 * the one earliest in the catalog. This is how the opponent chooses, and the
 * same rule backs a `playCard` that was given no particular card.
 */
function bestAffordable(hand, energy) {
  let best = null;
  for (const card of hand) {
    if (card.cost > energy) continue;
    if (
      best === null ||
      card.cost > best.cost ||
      (card.cost === best.cost && card.attack > best.attack) ||
      (card.cost === best.cost && card.attack === best.attack && catalogRank(card) < catalogRank(best))
    ) {
      best = card;
    }
  }
  return best;
}

function appendLog(match, line) {
  match.log.push(line);
}

/**
 * Play the card named by `cardId` from the player's hand: it moves to the table,
 * its cost leaves the player's energy, and the log gains a line. When `cardId`
 * is omitted the best card the player can afford is played instead. Refused,
 * with a reason and without changing anything, when the match is over, it is not
 * the player's turn, the named card is not in hand, or it costs more energy than
 * the player has.
 */
export function playCard(match, cardId) {
  if (match.over) {
    throw new Error("the match is over — press Play again");
  }
  if (match.turn !== "player") {
    throw new Error("it is not your turn — the opponent is taking its turn");
  }

  const card =
    cardId == null
      ? bestAffordable(match.player.hand, match.player.energy)
      : match.player.hand.find((held) => held.id === cardId);

  if (!card) {
    if (cardId == null) {
      throw new Error(`you cannot afford any card in your hand — you have ${match.player.energy} energy`);
    }
    const name = CARD_BY_ID.get(cardId)?.name ?? cardId;
    throw new Error(`"${name}" is not in your hand`);
  }
  if (card.cost > match.player.energy) {
    throw new Error(
      `you cannot afford ${card.name}: it costs ${card.cost} energy and you have ${match.player.energy}`
    );
  }

  match.player.hand.splice(match.player.hand.indexOf(card), 1);
  match.player.table.push(card);
  match.player.energy -= card.cost;
  appendLog(
    match,
    `You play ${card.name} (cost ${card.cost}) — energy ${match.player.energy} of ${match.player.maxEnergy}.`
  );
  return match;
}

/** How the final blow reads, said from the player's side of the table. */
function fallLine(loserIsPlayer) {
  return loserIsPlayer ? "Your hero falls — you lost." : "The opponent hero falls — you won.";
}

/**
 * Every card on `attacker`'s table deals its attack to `defender`'s hero, in
 * order, until the table is spent or the hero falls. Health is clamped at zero,
 * so the number a player reads is the number the match holds. Returns true when
 * this was the blow that ended the match — the match is then over, its winner is
 * the side that dealt it, and no side is taking turns any more.
 */
function dealDamage(match, attacker, defender, attackerWord, defenderWord, healthWord) {
  for (const card of attacker.table) {
    defender.health = Math.max(0, defender.health - card.attack);
    const fell = defender.health === 0;
    appendLog(
      match,
      `${attackerWord} ${card.name} deals ${card.attack} to ${defenderWord} — ${healthWord} ` +
        `${defender.health}.${fell ? ` ${fallLine(defender === match.player)}` : ""}`
    );
    if (!fell) continue;

    match.over = true;
    match.winner = defender === match.player ? "opponent" : "player";
    match.outcome = match.winner === "player" ? "win" : "loss";
    match.turn = null;
    return true;
  }
  return false;
}

/**
 * The opponent's turn: refresh its energy, play what it can afford, then attack.
 * Returns true when its table's attack ended the match, so the caller stops
 * rather than handing the turn back to a hero that is no longer standing.
 */
function takeOpponentTurn(match) {
  const opponent = match.opponent;
  opponent.energy = opponent.maxEnergy;

  let played = 0;
  for (;;) {
    const card = bestAffordable(opponent.hand, opponent.energy);
    if (!card) break;
    opponent.hand.splice(opponent.hand.indexOf(card), 1);
    opponent.table.push(card);
    opponent.energy -= card.cost;
    played += 1;
    appendLog(
      match,
      `Opponent plays ${card.name} (cost ${card.cost}) — energy ${opponent.energy} of ${opponent.maxEnergy}.`
    );
  }
  if (played === 0) appendLog(match, "Opponent plays no cards.");

  return dealDamage(match, opponent, match.player, "Opponent's", "you", "your health");
}

/**
 * End the player's turn: the player's table attacks the opponent's hero, the
 * opponent takes a turn of its own, and the turn comes back to the player with
 * energy refreshed. Every step appends one line to the log, in order. Refused
 * when the match is over or it is not the player's turn. The turn stops the
 * moment either hero falls: the surviving side's blow is the last line logged,
 * and nothing after it happens.
 */
export function endTurn(match) {
  if (match.over) {
    throw new Error("the match is over — press Play again");
  }
  if (match.turn !== "player") {
    throw new Error("it is not your turn to end");
  }

  match.turn = "opponent";
  const opponentHealthBefore = match.opponent.health;
  if (dealDamage(match, match.player, match.opponent, "Your", "the opponent", "opponent health")) {
    return match;
  }
  if (match.opponent.health === opponentHealthBefore) appendLog(match, "Your table deals no damage.");

  appendLog(match, "Opponent's turn.");
  if (takeOpponentTurn(match)) return match;

  match.turn = "player";
  match.player.energy = match.player.maxEnergy;
  appendLog(
    match,
    `Your turn — energy refreshed to ${match.player.energy} of ${match.player.maxEnergy}.`
  );
  return match;
}
