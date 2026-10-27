/**
 * A match: one game of selfgrow against the opponent, taken a turn at a time.
 *
 * The two sides play different decks: the player plays the deck they built, and
 * the opponent plays `OPPONENT_DECK` — a fixed deck of its own, under a name of
 * its own — so a match is against a character rather than a mirror of the
 * player, and the cards chosen for a deck change what is on the other side of
 * the table.
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
 * Each side begins its own turn with a draw step: while its deck still holds a
 * card it draws the top one, so a spent hand refills and the deck wears down to
 * nothing. Its energy also grows — refilled to its maximum, and its maximum up
 * by one after the first turn, never past ENERGY_CAP — so a deck of cards the
 * opening energy cannot cover still becomes playable, and no match can stall
 * with both sides unable to act.
 *
 * A match ends the moment either hero's health reaches zero: `over` turns true,
 * `winner` names the side that dealt the final blow, `outcome` says it from the
 * player's side ("win" or "loss"), and the log's last line is that blow, in
 * words a player can read back. Health is clamped at zero as it lands, so the
 * number on the board and the number here never disagree. `recorded` is false
 * until the result has been saved, so a finished match is never counted twice.
 *
 * A table is fought over. When a side ends its turn, each of its cards deals its
 * attack to the front card of the other table while that table has one: the
 * front card's health drops, and at zero it leaves the table with a line naming
 * it. Only once a side's table is empty do that side's attackers reach the enemy
 * hero, so a wall of cards is worn down card by card before the hero behind it
 * is touched.
 *
 * The front card is only the default. During their own turn the player may send
 * one of their table cards at a card of their choosing on the opponent's table —
 * or at the hero, once that table is empty — with `attack`. A card that has
 * struck this way is spent for the rest of the turn, so it is skipped when the
 * turn is ended and neither player nor opponent strikes twice with one card.
 */

import { CARDS, CARD_BY_ID, MINIMUM_DECK_SIZE, OPPONENT_DECK, OPPONENT_NAME } from "./cards.js";

/** Both heroes start at this much health and stay there until a match can end. */
export const HERO_HEALTH = 20;

/** How many cards each side is dealt from its shuffled deck at the start. */
export const STARTING_HAND = 3;

/**
 * The target a player names to send a table card straight at the opponent hero
 * rather than at a card. It is the one target that is not a card id.
 */
export const HERO_TARGET = "hero";

/** The energy a side has at the start of its first own turn. */
export const MAX_ENERGY = 3;

/**
 * The most energy a side can ever grow to: one more than the dearest card, so a
 * deck of nothing but the most expensive cards can still be played to an end.
 * A side's maximum rises by one at the start of each of its own turns after the
 * first, and stops here.
 */
export const ENERGY_CAP = Math.max(...CARDS.map((card) => card.cost));

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
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    // Whether the card has already struck during its owner's current turn. It
    // is reset as each of that side's own turns begins, so a card strikes at
    // most once per turn whichever way the player directs it.
    hasAttacked: false,
  };
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

/**
 * One side of the match: full health, full energy, a dealt hand and a deck.
 *
 * Every pile — hand, table and deck — holds card objects made by `cardOf`, so a
 * card drawn from the deck is already complete and needs no conversion: a side
 * holds one kind of card everywhere.
 */
function createSide(deckIds, rng) {
  const order = shuffled(deckIds, rng).map(cardOf);
  return {
    health: HERO_HEALTH,
    energy: MAX_ENERGY,
    maxEnergy: MAX_ENERGY,
    turns: 0,
    hand: order.slice(0, STARTING_HAND),
    table: [],
    deck: order.slice(STARTING_HAND),
  };
}

/**
 * Begin one side's own turn: count it, let its energy grow by one after the
 * first turn (never past ENERGY_CAP), refill its energy to its maximum, and draw
 * the top card of its deck while there is one. Returns the card drawn, or null
 * when the deck is spent — so the caller can say in the match log what happened,
 * in the words of the side whose turn it is. The deck already holds complete
 * cards, so the card drawn is pushed into the hand exactly as it came.
 */
function beginTurn(side) {
  side.turns += 1;
  if (side.turns > 1) side.maxEnergy = Math.min(ENERGY_CAP, side.maxEnergy + 1);
  side.energy = side.maxEnergy;
  // A new own turn freshens every card on the table, so each may strike once
  // again, however it struck on the turn before.
  for (const card of side.table) card.hasAttacked = false;
  if (side.deck.length === 0) return null;
  const card = side.deck.shift();
  side.hand.push(card);
  return card;
}

/**
 * Start a match from the player's deck ids. The player is dealt their own deck
 * and the opponent is dealt `OPPONENT_DECK`, each shuffled separately, and each
 * side is dealt a starting hand — then the player's first turn begins at once,
 * drawing a card while the deck holds one. Refused when the deck holds fewer
 * cards than a match needs.
 */
export function createMatch(deckIds, { rng = Math.random } = {}) {
  const held = Array.isArray(deckIds) ? deckIds.length : 0;
  if (held < MINIMUM_DECK_SIZE) {
    throw new Error(`a match needs at least ${MINIMUM_DECK_SIZE} cards in your deck, but it holds ${held}`);
  }

  const match = {
    id: createMatchId(),
    opponentName: OPPONENT_NAME,
    turn: "player",
    over: false,
    winner: null,
    outcome: null,
    recorded: false,
    player: createSide(deckIds, rng),
    opponent: createSide(OPPONENT_DECK, rng),
    log: [],
  };
  // The match opens on the player's first turn, which draws a card. The line is
  // logged after the opening note so the note counts the hand after the draw.
  const openingDraw = beginTurn(match.player);
  appendLog(
    match,
    `Match started against ${match.opponentName}. You hold ${match.player.hand.length} cards; ` +
      `the opponent holds ${match.opponent.hand.length}.`
  );
  if (openingDraw) {
    appendLog(match, `You draw ${openingDraw.name} — ${match.player.deck.length} left in deck.`);
  }
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
 * One blow from `card`: its attack lands on `targetCard` when one is named,
 * otherwise on the hero behind the table. A card worn to zero leaves its table
 * on a line naming it; a hero worn to zero ends the match. Health is clamped at
 * zero, so the number a player reads is the number the match holds.
 *
 * `attackerWord` and `defenderWord` name the two sides in the log's words
 * ("Your"/"you" and "Opponent's"/"the opponent"); the table a fallen card stood
 * on is named from the side that owns it, so a fall reads from the side that
 * lost it. Returns true when this was the blow that ended the match — the match
 * is then over, its winner is the side that dealt it, and no side is taking
 * turns any more.
 */
function landBlow(match, card, defender, attackerWord, defenderWord, healthWord, targetCard) {
  const defenderIsPlayer = defender === match.player;
  const tableOwner = defenderIsPlayer ? "your" : "the opponent's";
  const tableOwnerOpening = defenderIsPlayer ? "Your" : "The opponent's";

  if (targetCard) {
    targetCard.health = Math.max(0, targetCard.health - card.attack);
    const fell = targetCard.health === 0;
    appendLog(
      match,
      `${attackerWord} ${card.name} deals ${card.attack} to ${tableOwner} ${targetCard.name} — ` +
        `it has ${targetCard.health} health left.`
    );
    if (!fell) return false;
    defender.table.splice(defender.table.indexOf(targetCard), 1);
    appendLog(match, `${tableOwnerOpening} ${targetCard.name} falls — it leaves ${tableOwner} table.`);
    return false;
  }

  defender.health = Math.max(0, defender.health - card.attack);
  const fell = defender.health === 0;
  appendLog(
    match,
    `${attackerWord} ${card.name} deals ${card.attack} to ${defenderWord} — ${healthWord} ` +
      `${defender.health}.${fell ? ` ${fallLine(defenderIsPlayer)}` : ""}`
  );
  if (!fell) return false;

  match.over = true;
  match.winner = defenderIsPlayer ? "opponent" : "player";
  match.outcome = match.winner === "player" ? "win" : "loss";
  match.turn = null;
  return true;
}

/**
 * Every unspent card on `attacker`'s table deals its attack, in order. While
 * `defender` still holds a card on its table the blow lands on that front card
 * instead of the hero — its health drops, and at zero it leaves the table on a
 * line naming it — so a table is worn down card by card. Only once that table
 * is empty do the blows reach the hero, exactly as they always did. A card the
 * player already sent at a chosen target with `attack` is spent and skipped, so
 * it does not strike twice in one turn. Returns true when this was the blow that
 * ended the match.
 */
function dealDamage(match, attacker, defender, attackerWord, defenderWord, healthWord) {
  for (const card of attacker.table) {
    if (card.hasAttacked) continue;
    card.hasAttacked = true;
    const front = defender.table[0];
    if (landBlow(match, card, defender, attackerWord, defenderWord, healthWord, front)) return true;
  }
  return false;
}

/** The name a refusal uses for a card: its catalog name, or the id as it came. */
function nameFor(cardId) {
  return CARD_BY_ID.get(cardId)?.name ?? String(cardId);
}

/**
 * Direct one of the player's table cards at the opponent card named by `target`,
 * or — when `target` is `HERO_TARGET` and no card stands in front of it — at the
 * opponent's hero. Exactly one blow lands, with the same log wording, card-fall
 * and hero-fall rules as ending the turn, and the attacker is spent for the rest
 * of the turn so it will not strike again when the turn is ended. Refused, with
 * a reason and without changing anything, when the match is over, it is not the
 * player's turn, no such card is on the player's table, that card has already
 * struck this turn, the named target is not on the opponent's table, or the hero
 * is named while a card still stands in front of it.
 */
export function attack(match, attackerId, target) {
  if (match.over) {
    throw new Error("the match is over — press Play again");
  }
  if (match.turn !== "player") {
    throw new Error("it is not your turn — the opponent is taking its turn");
  }

  const named = match.player.table.filter((card) => card.id === attackerId);
  if (named.length === 0) {
    throw new Error(`"${nameFor(attackerId)}" is not on your table, so it cannot attack`);
  }
  const attacker = named.find((card) => !card.hasAttacked);
  if (!attacker) {
    throw new Error(`"${named[0].name}" has already attacked this turn`);
  }

  if (target === HERO_TARGET) {
    if (match.opponent.table.length) {
      throw new Error("the opponent's hero is behind its table — attack one of its cards first");
    }
  } else if (typeof target !== "string" || !match.opponent.table.some((card) => card.id === target)) {
    throw new Error(`"${nameFor(target)}" is not on the opponent's table, so it cannot be attacked`);
  }

  attacker.hasAttacked = true;
  const targetCard = target === HERO_TARGET ? null : match.opponent.table.find((card) => card.id === target);
  landBlow(match, attacker, match.opponent, "Your", "the opponent", "opponent health", targetCard);
  return match;
}

/**
 * The opponent's turn: grow and refill its energy, draw a card while it can,
 * play what it can afford, then attack. Returns true when its table's attack
 * ended the match, so the caller stops rather than handing the turn back to a
 * hero that is no longer standing.
 */
function takeOpponentTurn(match) {
  const opponent = match.opponent;
  const drawn = beginTurn(opponent);
  if (drawn) appendLog(match, `The opponent draws ${drawn.name} — ${opponent.deck.length} left in deck.`);

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
 * End the player's turn: the player's table attacks the opponent's front table
 * card while it has one and its hero once the table is empty, the opponent takes
 * a turn of its own, and the turn comes back to the player — its energy grown
 * and refilled, a card drawn while the deck holds one. Every step appends one
 * line to the log, in order. Refused when the match is over or it is
 * not the player's turn. The turn stops the moment either hero falls: the
 * surviving side's blow is the last line logged, and nothing after it happens.
 */
export function endTurn(match) {
  if (match.over) {
    throw new Error("the match is over — press Play again");
  }
  if (match.turn !== "player") {
    throw new Error("it is not your turn to end");
  }

  match.turn = "opponent";
  const logBefore = match.log.length;
  if (dealDamage(match, match.player, match.opponent, "Your", "the opponent", "opponent health")) {
    return match;
  }
  // A table with no cards at all is the one case that lands nothing — and so
  // the only case that logs nothing. Damage to a card counts as damage.
  if (match.log.length === logBefore) appendLog(match, "Your table deals no damage.");

  appendLog(match, "Opponent's turn.");
  if (takeOpponentTurn(match)) return match;

  match.turn = "player";
  const drawn = beginTurn(match.player);
  appendLog(
    match,
    `Your turn — energy refreshed to ${match.player.energy} of ${match.player.maxEnergy}.`
  );
  if (drawn) appendLog(match, `You draw ${drawn.name} — ${match.player.deck.length} left in deck.`);
  return match;
}
