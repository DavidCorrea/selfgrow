/**
 * selfgrow — the page's state, and the one place it is written onto the page.
 *
 * `state` is the whole truth about what is on screen: which screen is open, what
 * the player owns, which cards they have chosen for their deck, and whether it
 * will survive closing the page. `render()` writes it into the page's text and
 * `readState()` / `readCollection()` hand the same fields back, so a screen
 * reader, the Playtester and an agent's tool all read one surface — whatever the
 * page says is what a tool returns, and what a tool does is what the page shows.
 */

import { cardArtSvg, cardBackSvg } from "./cardart.js";
import { CARDS, CARD_BY_ID, DECK_LIMIT, MINIMUM_DECK_SIZE, OPPONENT_NAME } from "./cards.js";
import {
  collectionSize,
  listAllCards,
  listDeckCards,
  listOwnedCards,
  loadGame,
  recordResult,
  saveDeck,
} from "./collection.js";
import { attack, createMatch, endTurn, HERO_TARGET, playCard } from "./match.js";

// The screens the page has, and the word each is announced by. A screen name is
// also the value an agent passes to the show-screen tool.
const SCREEN_LABELS = {
  home: "Home",
  collection: "Collection",
  play: "Play",
};

// The cards are read once, here, the same way a returning player's saved game
// is: everything below works from whatever this opener produced.
const opened = loadGame();

const state = {
  screen: "home",
  cards: opened.cards,
  cardsOwned: collectionSize(opened.cards),
  distinctCards: opened.cards.length,
  // How many different cards the game holds in all, so what has been collected
  // can be read against the whole set rather than on its own.
  setTotal: CARDS.length,
  deck: opened.deck,
  deckLimit: DECK_LIMIT,
  minimumDeckSize: MINIMUM_DECK_SIZE,
  saved: opened.saved,
  // How the player has done across every finished match — kept in the same save
  // as the cards, so a reload keeps both what was won and what was earned.
  wins: opened.wins,
  matchesPlayed: opened.matches,
  // The result of the most recently finished match, or null until one ends:
  // whether it was a win or a loss, and the card a win awarded, if any.
  result: null,
  // The match in progress, or null before one is started. It lives only in this
  // page session: closing the page ends the match, the way leaving the table does.
  match: null,
  // Which of the player's table cards the next chosen attack comes from, or null
  // when none is picked — so End turn still sends the whole table at the front
  // card by default. It is a page-only choice, cleared with each new turn.
  selectedAttacker: null,
};

const screens = new Map(
  Object.keys(SCREEN_LABELS).map((name) => [name, document.getElementById(`screen-${name}`)])
);

// Every place on the page a count is printed, wherever the card prints it.
const countFields = {};
for (const element of document.querySelectorAll("[data-field]")) {
  (countFields[element.dataset.field] ??= []).push(element);
}

const screenStatus = document.getElementById("screen-status");
const storageNote = document.getElementById("storage-note");
const deckMessage = document.getElementById("deck-message");
const deckSummary = document.getElementById("deck-summary");

// The match board's places, gathered once. Each is optional so a missing one
// degrades to a missing readout rather than a page that will not render.
const matchBoard = document.getElementById("match-board");
const matchIntro = document.getElementById("match-intro");
const matchIntroOpponent = document.getElementById("match-intro-opponent");
const matchOpponentName = document.getElementById("match-opponent-name");
const matchOpponentHealthLabel = document.getElementById("match-opponent-health-label");
const matchOpponentHandLabel = document.getElementById("match-opponent-hand-label");
const matchOpponentTableHeading = document.getElementById("match-opponent-table-heading");
const matchMessage = document.getElementById("match-message");
const startMatchButton = document.getElementById("action-start-match");
const endTurnButton = document.getElementById("action-end-turn");
const matchFields = {
  playerHealth: document.getElementById("match-player-health"),
  opponentHealth: document.getElementById("match-opponent-health"),
  energy: document.getElementById("match-energy"),
  opponentHand: document.getElementById("match-opponent-hand"),
  deckRemaining: document.getElementById("match-deck-remaining"),
};
const matchHandList = document.getElementById("match-hand");
const matchHandSide = document.getElementById("match-hand-side");
const matchTableList = document.getElementById("match-table");
const matchOpponentTableList = document.getElementById("match-opponent-table");
const matchOpponentHandBacks = document.getElementById("match-opponent-hand-backs");
const matchDeckStack = document.getElementById("match-deck-stack");
const matchLogList = document.getElementById("match-log");
const matchResult = document.getElementById("match-result");
const matchResultHeading = document.getElementById("match-result-heading");
const matchFinalHealth = document.getElementById("match-final-health");
const resultReward = document.getElementById("result-reward");
const playAgainButton = document.getElementById("action-play-again");

/**
 * The counts the page prints, with the deck size derived from the deck itself so
 * the number can never drift from the cards it counts.
 */
function counts() {
  return { ...state, deckSize: state.deck.length };
}

/** Write the state onto the page: the open screen, every count, and the save note. */
function render() {
  for (const [name, section] of screens) {
    const isOpen = name === state.screen;
    section.hidden = !isOpen;
    if (isOpen) section.setAttribute("aria-current", "true");
    else section.removeAttribute("aria-current");
  }

  const shown = counts();
  for (const [field, elements] of Object.entries(countFields)) {
    if (shown[field] === undefined) continue;
    for (const element of elements) element.textContent = String(shown[field]);
  }

  if (storageNote) storageNote.hidden = state.saved;
  if (deckSummary) deckSummary.textContent = deckSummaryText();

  renderMatch();

  screenStatus.textContent = `${SCREEN_LABELS[state.screen]} screen`;
}

/** The home screen's one-line deck summary: its size, then the cards in it. */
function deckSummaryText() {
  if (!state.deck.length) return "Your deck is empty — choose cards from your Collection.";
  const names = listDeckCards(state.deck)
    .map((card) => card.name)
    .join(", ");
  return `Deck size ${state.deck.length} of ${state.deckLimit}: ${names}.`;
}

/** The name of a card the player owns, or the id when it is not a real card. */
function cardName(cardId) {
  return CARD_BY_ID.get(cardId)?.name ?? String(cardId);
}

/** A card in the match as the page prints it: its name, then cost/attack/health. */
function matchCardItem(card, { playable = false, affordable = true } = {}) {
  const item = document.createElement("li");
  item.className = "match-card";
  item.dataset.cardId = card.id;

  // The card's picture, first, so the same card is recognised by sight in a
  // match as it is in the collection. A card the art module does not know yet
  // gets no picture rather than an empty frame, as in the collection.
  const art = cardArtSvg(card.id, card.name);
  if (art) item.append(art);

  const name = document.createElement("span");
  name.className = "match-card-name";
  name.textContent = card.name;

  const stats = document.createElement("span");
  stats.className = "match-card-stats";
  stats.setAttribute("aria-label", `cost ${card.cost}, attack ${card.attack}, health ${card.health}`);
  stats.textContent = `${card.cost}/${card.attack}/${card.health}`;

  const head = document.createElement("span");
  head.className = "match-card-head";
  head.append(name, stats);
  item.append(head);

  // A card in hand is also the control that plays it, labelled with what it
  // costs, so a keyboard visitor never has to guess which card a button means.
  if (playable) {
    item.classList.add("match-card-playable");
    // A card the energy cannot cover yet is dimmed and says so, but stays
    // pressable so pressing it can explain the shortfall rather than be dead.
    if (!affordable) item.classList.add("is-unaffordable");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary match-play";
    button.textContent = `Play ${card.name} (cost ${card.cost})`;
    button.setAttribute(
      "aria-label",
      `Play ${card.name} — cost ${card.cost}, attack ${card.attack}, health ${card.health}` +
        (affordable ? "" : ", which you cannot afford yet")
    );
    button.addEventListener("click", () => runMatchAction(() => playMatchCard(card.id)));
    item.append(button);
  }

  return item;
}

/** Return focus to a control after the board was redrawn under it. */
function focusMatchControl(selector) {
  document.querySelector(selector)?.focus();
}

/**
 * The control that picks a card on the player's own table to attack with. Its
 * label names the card, and `aria-pressed` says whether it is the one picked, so
 * a keyboard or screen-reader player reads the choice without seeing a colour.
 */
function attackSelectControl(card) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "btn btn-secondary match-attack-select";
  control.setAttribute("aria-pressed", String(state.selectedAttacker === card.id));
  control.textContent = `Attack with ${card.name}`;
  control.setAttribute(
    "aria-label",
    `Attack with ${card.name} — attack ${card.attack}, health ${card.health}` +
      (card.hasAttacked ? ", which has already attacked this turn" : "")
  );
  control.addEventListener("click", () =>
    runMatchAction(() => {
      selectMatchAttacker(card.id);
      focusMatchControl(`#match-table [data-card-id="${card.id}"] .match-attack-select`);
    })
  );
  return control;
}

/** The control that sends the picked card at this opponent table card. */
function attackTargetControl(card) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "btn btn-secondary match-attack-target";
  control.textContent = `Attack ${card.name}`;
  control.setAttribute(
    "aria-label",
    `Attack ${card.name} — cost ${card.cost}, attack ${card.attack}, health ${card.health}`
  );
  control.addEventListener("click", () =>
    runMatchAction(() => {
      attackMatch(state.selectedAttacker, card.id);
      focusMatchControl(`#match-opponent-table [data-card-id="${card.id}"] .match-attack-target`);
    })
  );
  return control;
}

/**
 * An empty table, said twice: the sentence a screen reader and an agent read,
 * and — beside it — the outline of a card slot on the playing surface, so an
 * empty table looks like a table waiting for a card rather than a blank panel.
 */
function emptyTableItem(sentence) {
  const item = document.createElement("li");
  item.className = "match-empty";
  const slot = document.createElement("span");
  slot.className = "match-empty-slot";
  slot.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "match-empty-text";
  text.textContent = sentence;
  item.append(slot, text);
  return item;
}

/**
 * The player's table, each card with the control that picks it to strike with.
 * The controls appear only on the player's own turn in a live match, so a
 * finished match or the opponent's turn offers no move nobody can make.
 */
function renderPlayerTable(match, canAttack) {
  if (!matchTableList) return;
  if (!match.player.table.length) {
    matchTableList.replaceChildren(emptyTableItem("Your table is empty."));
    return;
  }
  matchTableList.replaceChildren(
    ...match.player.table.map((card) => {
      const item = matchCardItem(card);
      if (!canAttack) return item;
      item.classList.add("match-card-action");
      if (card.hasAttacked) item.classList.add("is-spent");
      item.append(attackSelectControl(card));
      return item;
    })
  );
}

/**
 * The opponent's table, each card with the control that sends the picked card at
 * it, and — once the table is empty — the one control that sends it at the hero
 * behind. Like the player's own controls, these appear only on the player's own
 * turn in a live match.
 */
function renderOpponentTable(match, canAttack) {
  if (!matchOpponentTableList) return;
  if (!match.opponent.table.length) {
    const children = [emptyTableItem(`${match.opponentName}'s table is empty.`)];
    if (canAttack) {
      const item = document.createElement("li");
      item.className = "match-card match-card-action match-attack-hero-item";
      const control = document.createElement("button");
      control.type = "button";
      control.className = "btn btn-secondary match-attack-hero";
      control.textContent = "Attack the opponent hero";
      control.addEventListener("click", () =>
        runMatchAction(() => {
          attackMatch(state.selectedAttacker, HERO_TARGET);
          focusMatchControl(".match-attack-hero");
        })
      );
      item.append(control);
      children.push(item);
    }
    matchOpponentTableList.replaceChildren(...children);
    return;
  }
  matchOpponentTableList.replaceChildren(
    ...match.opponent.table.map((card) => {
      const item = matchCardItem(card);
      if (!canAttack) return item;
      item.classList.add("match-card-action");
      item.append(attackTargetControl(card));
      return item;
    })
  );
}

/**
 * The player's hand, each card with the button that plays it. A finished match
 * has no playable hand, so the list is emptied rather than left holding buttons
 * for moves nobody can make any more.
 */
function renderMatchHand(match) {
  if (!matchHandList) return;
  if (match.over) {
    matchHandList.replaceChildren();
    return;
  }
  if (!match.player.hand.length) {
    const empty = document.createElement("li");
    empty.className = "match-empty";
    empty.textContent = "Your hand is empty.";
    matchHandList.replaceChildren(empty);
    return;
  }
  matchHandList.replaceChildren(
    ...match.player.hand.map((card) =>
      matchCardItem(card, { playable: true, affordable: card.cost <= match.player.energy })
    )
  );
}

/**
 * A pile of face-down cards: one back per card it holds. It is how a count of
 * cards reads as cards — the opponent's hand and the deck still to draw — and
 * each back carries its own place in the pile (`--i`) so a stack fans out and
 * its height follows how many cards are left. The pile is decorative; the count
 * is printed in words beside it.
 */
function renderCardPile(list, count, emptyLabel) {
  if (!list) return;
  if (count === 0) {
    const item = document.createElement("li");
    item.className = "card-pile-empty";
    item.textContent = emptyLabel;
    list.replaceChildren(item);
    return;
  }
  list.replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const item = document.createElement("li");
      item.className = "card-pile-card";
      item.style.setProperty("--i", String(index));
      item.append(cardBackSvg());
      return item;
    })
  );
}

/**
 * The ordered log, one line per thing that happened, oldest first. The list
 * scrolls in place, so the newest line — and the final blow at the end of a
 * match — is scrolled into view rather than left below the fold for the player
 * to find.
 */
function renderMatchLog(match) {
  if (!matchLogList) return;
  matchLogList.replaceChildren(
    ...match.log.map((line) => {
      const item = document.createElement("li");
      item.className = "match-log-line";
      item.textContent = line;
      return item;
    })
  );
  matchLogList.scrollTop = matchLogList.scrollHeight;
}

/**
 * The result of a finished match, said once: who won, both heroes' final health,
 * how many matches the player has now finished and won, and the one card a win
 * added. Shown only once a hero has fallen, in the same board the match was
 * played on, so a result is a state of the match rather than a second screen.
 */
function renderMatchResult(match) {
  const finished = Boolean(match?.over);
  if (matchResult) matchResult.hidden = !finished;
  if (playAgainButton) playAgainButton.hidden = !finished;
  if (matchHandSide) matchHandSide.hidden = finished;
  if (!finished) return;

  const won = match.winner === "player";
  if (matchResultHeading) matchResultHeading.textContent = won ? "You won" : "You lost";
  if (matchFinalHealth) {
    matchFinalHealth.textContent =
      `Final health: your hero ${match.player.health}, ${match.opponentName} ${match.opponent.health}.`;
  }
  if (resultReward) {
    const awarded = state.result?.awarded;
    if (awarded) {
      const label = document.createElement("span");
      label.className = "award-card-label";
      label.textContent = awardLabelText(state.result?.setComplete);
      resultReward.replaceChildren(label, awardCardFigure(awarded));
    } else {
      resultReward.textContent = rewardText(won);
    }
  }
}

/**
 * The words beside the card a win earned. A win that had nothing left to earn
 * says so — the collection is complete, and the card it added is a duplicate —
 * instead of claiming a new card was added.
 */
export function awardLabelText(setComplete) {
  return setComplete
    ? "Set complete — a duplicate copy added to your collection:"
    : "New card — added to your collection:";
}

/**
 * The card a win earned, shown as the card itself: its picture, then its name
 * and its three numbers, built from the same card data and the same art as the
 * collection and the match. A win is the only way to grow the collection, so the
 * reward is shown as the card a player will then look for among their own.
 */
export function awardCardFigure(card) {
  const figure = document.createElement("figure");
  figure.className = "award-card";
  figure.dataset.cardId = card.id;

  // The card's picture, so the reward is recognised by sight. A card the art
  // module does not know yet gets no picture rather than an empty frame, and the
  // name beside it is what stands in for it.
  const art = cardArtSvg(card.id, card.name);
  if (art) figure.append(art);

  const caption = document.createElement("figcaption");
  caption.className = "award-card-caption";

  const name = document.createElement("span");
  name.className = "award-card-name";
  name.textContent = card.name;

  const stats = document.createElement("span");
  stats.className = "award-card-stats";
  stats.setAttribute("aria-label", `cost ${card.cost}, attack ${card.attack}, health ${card.health}`);
  stats.textContent = `${card.cost}/${card.attack}/${card.health}`;

  caption.append(name, stats);
  figure.append(caption);
  return figure;
}

/**
 * What a finished match added, in words, when no card was earned: a win that
 * awarded nothing, or a loss. Read from the result the match was recorded with,
 * so what the page says and what the save holds are the same thing.
 */
function rewardText(won) {
  return won
    ? "No new card this time."
    : "A loss records the match but earns no card — win a match to grow your collection.";
}

/**
 * Draw the match board: who the match is against, both heroes' health, the
 * player's energy, the hand, both tables and the log — all of it text, so a
 * sighted player, a screen reader and an agent read the same match. With no
 * match in progress the board is hidden and the note about the deck, the
 * opponent and the Start match button stand in its place. Once a hero has fallen
 * the hand and the End turn button go with it and the result stands in their
 * place, so there is nothing left to press.
 */
function renderMatch() {
  const match = state.match;
  if (matchBoard) matchBoard.hidden = !match;
  if (matchIntro) matchIntro.hidden = Boolean(match);
  // The opponent is a character, named before the match and on the board, from
  // the one place the opponent is defined.
  if (matchIntroOpponent) matchIntroOpponent.textContent = OPPONENT_NAME;
  if (startMatchButton) startMatchButton.hidden = Boolean(match);
  if (endTurnButton) endTurnButton.hidden = !match || match.over || match.turn !== "player";
  renderMatchResult(match);
  if (!match) return;

  if (matchOpponentName) matchOpponentName.textContent = `Opponent: ${match.opponentName}`;
  if (matchOpponentHealthLabel) matchOpponentHealthLabel.textContent = `${match.opponentName} health`;
  if (matchOpponentHandLabel) matchOpponentHandLabel.textContent = `${match.opponentName}'s hand`;
  if (matchOpponentTableHeading) matchOpponentTableHeading.textContent = `${match.opponentName}'s table`;

  if (matchFields.playerHealth) matchFields.playerHealth.textContent = String(match.player.health);
  if (matchFields.opponentHealth) matchFields.opponentHealth.textContent = String(match.opponent.health);
  if (matchFields.energy) matchFields.energy.textContent = `${match.player.energy} of ${match.player.maxEnergy}`;
  if (matchFields.opponentHand) matchFields.opponentHand.textContent = String(match.opponent.hand.length);
  if (matchFields.deckRemaining) matchFields.deckRemaining.textContent = String(match.player.deck.length);

  const canAttack = !match.over && match.turn === "player";
  renderMatchHand(match);
  renderCardPile(matchOpponentHandBacks, match.opponent.hand.length, "No cards in hand");
  renderCardPile(matchDeckStack, match.player.deck.length, "Deck empty");
  renderPlayerTable(match, canAttack);
  renderOpponentTable(match, canAttack);
  renderMatchLog(match);
}

/** Put the refusal or confirmation in the match's always-present status line. */
function setMatchMessage(message) {
  if (matchMessage) matchMessage.textContent = message;
}

/**
 * Run a match action, keeping the player on their feet: a refusal is shown in
 * the status line, and when the control that was pressed is gone with the hand
 * it lived in, focus lands on something that is still on screen — the result
 * when the move ended the match, so the outcome is heard rather than lost.
 */
function runMatchAction(action) {
  setMatchMessage("");
  const endedBefore = Boolean(state.match?.over);
  try {
    action();
  } catch (error) {
    setMatchMessage(error.message);
    return;
  }

  if (state.match?.over && !endedBefore) {
    matchResultHeading?.focus();
    return;
  }
  const focused = document.activeElement;
  const stillOnScreen = focused && focused !== document.body && document.contains(focused) && !focused.hidden;
  if (!stillOnScreen) document.getElementById("play-heading")?.focus();
}

/**
 * Start a match from the saved deck — what a visitor does by pressing Start
 * match, and what the start-match tool does on their behalf. Refused, with the
 * reason, when the deck holds fewer cards than a match needs. Opens the Play
 * screen and returns the state afterwards.
 */
export function startMatch() {
  state.match = createMatch(state.deck);
  state.result = null;
  state.screen = "play";
  state.selectedAttacker = null;
  setMatchMessage("");
  render();
  return readState();
}

/**
 * Record a match that has just ended, exactly once, and redraw what it changed.
 * A match is marked recorded the moment it is saved, so a result shown again
 * cannot count the match twice or award a second card.
 */
function finishMatch() {
  const match = state.match;
  if (!match?.over || match.recorded) return;
  match.recorded = true;

  const record = recordResult(match.outcome, match.id);
  state.cards = record.cards;
  state.cardsOwned = collectionSize(record.cards);
  state.distinctCards = record.cards.length;
  state.wins = record.wins;
  state.matchesPlayed = record.matches;
  state.saved = record.saved;
  state.result = { outcome: match.outcome, awarded: record.awarded, setComplete: record.setComplete };
  renderCollection();
}

/**
 * Deal a fresh match after one has been played out — what a visitor does by
 * pressing Play again on the result, and what the play-again tool does on their
 * behalf. It is the same act as starting a match: the finished one is replaced.
 */
export function playAgain() {
  return startMatch();
}

/**
 * Play a card from the hand — what a visitor does by pressing its "Play …"
 * button, and what the play-card tool does on their behalf. Refused, with the
 * reason, when there is no match or the card cannot be played. Returns the state
 * afterwards.
 */
export function playMatchCard(cardId) {
  if (!state.match) throw new Error("no match is in progress — start one first");
  playCard(state.match, cardId);
  finishMatch();
  render();
  return readState();
}

/**
 * End the player's turn — what a visitor does by pressing End turn, and what the
 * end-turn tool does on their behalf. Refused, with the reason, when there is no
 * match. Returns the state afterwards.
 */
export function endMatchTurn() {
  if (!state.match) throw new Error("no match is in progress — start one first");
  endTurn(state.match);
  state.selectedAttacker = null;
  finishMatch();
  render();
  return readState();
}

/**
 * Send one of the player's table cards at a chosen opponent card, or at the
 * opponent's hero once its table is empty — what a visitor does by picking their
 * card and pressing a target, and what the attack tool does on their behalf.
 * Refused, with the reason, when there is no match, no attacker is picked, or
 * the engine refuses the blow; the pick is cleared once the blow has landed.
 * Returns the state afterwards.
 */
export function attackMatch(attackerId, target) {
  if (!state.match) throw new Error("no match is in progress — start one first");
  if (!attackerId) throw new Error("pick one of your table cards to attack with first");
  attack(state.match, attackerId, target);
  state.selectedAttacker = null;
  finishMatch();
  render();
  return readState();
}

/**
 * Pick which of the player's table cards the next chosen attack comes from, or
 * clear the pick when the same card is pressed again. A card that has already
 * attacked cannot be picked, and says so rather than being silently ignored.
 * Picking changes nothing on the board by itself; the target controls only act
 * on the card it names.
 */
function selectMatchAttacker(attackerId) {
  const match = state.match;
  if (!match || match.over || match.turn !== "player") return;
  const canStrike = match.player.table.some((card) => card.id === attackerId && !card.hasAttacked);
  if (state.selectedAttacker === attackerId) {
    state.selectedAttacker = null;
  } else if (!canStrike) {
    setMatchMessage(`${cardName(attackerId)} has already attacked this turn.`);
    return;
  } else {
    state.selectedAttacker = attackerId;
  }
  setMatchMessage("");
  render();
}

/** How many copies of `cardId` the deck currently holds. */
function deckCopies(cardId) {
  return state.deck.filter((id) => id === cardId).length;
}

/**
 * The controls on an owned card: how many of its copies are in the deck, and the
 * two buttons that add one more or take one out. Both stay enabled even when the
 * action would be refused, so pressing one shows the reason instead of a dead
 * control telling the player nothing.
 */
function deckControls(card) {
  const placed = deckCopies(card.id);
  const wrap = document.createElement("div");
  wrap.className = "deck-actions";

  const count = document.createElement("span");
  count.className = "owned-in-deck";
  count.dataset.inDeck = card.id;
  count.textContent = `In deck: ${placed} of ${card.copies}`;

  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-secondary deck-add";
  add.dataset.deckAdd = card.id;
  add.textContent = `Add ${card.name} to deck`;
  if (placed >= card.copies) add.classList.add("is-at-limit");
  add.addEventListener("click", () => addDeckCard(card.id));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-secondary deck-remove";
  remove.dataset.deckRemove = card.id;
  remove.textContent = `Remove ${card.name} from deck`;
  if (!placed) remove.classList.add("is-at-limit");
  remove.addEventListener("click", () => removeDeckCard(card.id));

  wrap.append(count, add, remove);
  return wrap;
}

/**
 * One card in the collection, as a face that shows its picture and reads its
 * name, numbers and copy count. A card the player holds carries the deck
 * controls that put a copy in the deck or take one out; a card they do not hold
 * yet is marked as not collected and offers no way into a deck.
 */
function collectionCardRow(card) {
  const item = document.createElement("li");
  item.className = card.owned ? "owned-card" : "unowned-card";
  item.dataset.cardId = card.id;

  // The card's picture, first, so a player learns the card by sight — whether
  // they hold it yet or are looking at what there is to collect. A card the art
  // module does not know yet gets no picture rather than an empty frame, and the
  // name below is what stands in for it.
  const art = cardArtSvg(card.id, card.name);
  if (art) item.append(art);

  const head = document.createElement("div");
  head.className = "card-face-head";

  const name = document.createElement("span");
  name.className = "card-face-name";
  name.textContent = card.name;
  head.append(name);

  // A count only where there is more than one to count; one copy is the default.
  if (card.copies > 1) {
    const copies = document.createElement("span");
    copies.className = "card-face-copies";
    copies.dataset.copies = String(card.copies);
    copies.textContent = `${card.copies} copies`;
    head.append(copies);
  }

  const stats = document.createElement("dl");
  stats.className = "card-face-stats";
  for (const [label, key] of [
    ["Cost", "cost"],
    ["Attack", "attack"],
    ["Health", "health"],
  ]) {
    const stat = document.createElement("div");
    stat.className = "card-face-stat";
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.dataset.stat = key;
    value.textContent = String(card[key]);
    stat.append(term, value);
    stats.append(stat);
  }

  item.append(head, stats);
  item.append(card.owned ? deckControls(card) : notCollectedNote());
  return item;
}

/**
 * What stands where a card's deck controls would: the plain statement that this
 * card is part of the set but not part of the collection yet, so a player reads
 * it as something to collect toward rather than as a card they have.
 */
function notCollectedNote() {
  const note = document.createElement("p");
  note.className = "unowned-note";
  note.textContent = "Not yet collected";
  return note;
}

/** One card in the deck, shown as its picture and read as its name and three
 * numbers, so the deck reads as a hand of cards. */
function deckCardRow(card) {
  const item = document.createElement("li");
  item.className = "deck-card";
  item.dataset.cardId = card.id;

  // The card's picture, first, so the deck is known by sight the way the owned
  // cards are. A card the art module does not know yet gets no picture rather
  // than an empty frame, and the name below is what stands in for it.
  const art = cardArtSvg(card.id, card.name);
  if (art) item.append(art);

  const name = document.createElement("span");
  name.className = "deck-card-name";
  name.textContent = card.name;

  const stats = document.createElement("span");
  stats.className = "deck-card-stats";
  stats.setAttribute("aria-label", `cost ${card.cost}, attack ${card.attack}, health ${card.health}`);
  stats.textContent = `${card.cost}/${card.attack}/${card.health}`;

  item.append(name, stats);
  return item;
}

/**
 * Draw every card in the game: the ones the player holds with their deck
 * controls, and the ones they do not yet with a note saying so — so the screen
 * shows the whole set and how much of it is collected, not only what is held.
 */
function renderCollectionCards() {
  const list = document.getElementById("collection-list");
  if (!list) return;

  list.replaceChildren(...listAllCards(state.cards).map(collectionCardRow));
}

/** Draw the deck's current contents, each card as a face that shows its picture
 * and reads its name and numbers. */
function renderDeck() {
  const list = document.getElementById("deck-list");
  if (!list) return;

  const cards = listDeckCards(state.deck);
  if (!cards.length) {
    const empty = document.createElement("li");
    empty.className = "deck-empty";
    empty.textContent = "No cards in your deck yet.";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...cards.map(deckCardRow));
}

/** Draw the whole Collection screen: every card in the game and the deck beside it. */
function renderCollection() {
  renderCollectionCards();
  renderDeck();
}

/** Put the refusal or confirmation in the always-present status line. */
function setDeckMessage(message) {
  if (deckMessage) deckMessage.textContent = message;
}

/** Return focus to a card's add or remove button after the list was redrawn under it. */
function focusDeckControl(attribute, cardId) {
  const button = document.querySelector(`[data-${attribute}="${cardId}"]`);
  if (button) button.focus();
}

/**
 * What pressing a card's Add button does: put one more copy in the deck. A
 * refusal is shown in the status line rather than swallowed, because a control
 * that silently does nothing tells the player nothing.
 */
function addDeckCard(cardId) {
  try {
    addCardToDeck(cardId);
    setDeckMessage(`Added ${cardName(cardId)} to your deck.`);
  } catch (error) {
    setDeckMessage(error.message);
  }
  focusDeckControl("deck-add", cardId);
}

/** What pressing a card's Remove button does: take one copy back out of the deck. */
function removeDeckCard(cardId) {
  try {
    removeCardFromDeck(cardId);
    setDeckMessage(`Removed ${cardName(cardId)} from your deck.`);
  } catch (error) {
    setDeckMessage(error.message);
  }
  focusDeckControl("deck-remove", cardId);
}

/** Persist the deck beside the collection and redraw everything that reads it. */
function commitDeck() {
  state.saved = saveDeck(state.cards, state.deck);
  render();
  renderCollection();
}

/**
 * Everything the page currently shows: the screen that is open, how many cards
 * the player owns and how many are different out of the whole set, the deck — its
 * size, its limit, the fewest cards a match needs and the cards themselves —
 * whether it will survive closing the page, how many matches have been played and
 * won, the result of the last finished match (whether it was a win or a loss, the
 * card a win awarded, and whether that completed the set), and the actions they
 * can take from here. This is what the get-state tool returns.
 */
export function readState() {
  // Only the actions a visitor can actually reach: a control this screen hides
  // is not something they can press, so an agent should not be told it can.
  const actions = [...screens.get(state.screen).querySelectorAll("button")]
    .filter((button) => !button.hidden)
    .map((button) => button.textContent.trim());

  return {
    screen: state.screen,
    cardsOwned: state.cardsOwned,
    distinctCards: state.distinctCards,
    setTotal: state.setTotal,
    deckSize: state.deck.length,
    deckLimit: state.deckLimit,
    minimumDeckSize: state.minimumDeckSize,
    deck: listDeckCards(state.deck),
    wins: state.wins,
    matchesPlayed: state.matchesPlayed,
    result: state.result ? { ...state.result } : null,
    saved: state.saved,
    match: readMatch(),
    actions,
  };
}

/** A match card as plain data, so a tool can carry it across the JSON boundary. */
function describeMatchCard(card) {
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    hasAttacked: Boolean(card.hasAttacked),
  };
}

/**
 * Everything the match currently shows: whether one is in progress, whether it
 * is over and which hero won, whose turn it is, which of the player's table
 * cards is picked to attack with (`selectedAttacker`, a card id or null), both
 * heroes' health, the player's energy, the hand, both tables — each table card
 * saying whether it has already attacked this turn (`hasAttacked`) — how many
 * cards the opponent holds (`opponentHand`, the face-down backs the board shows)
 * and how many are left to draw, the ordered log of what happened — its last line the
 * final blow — and the moves
 * available now, of which a finished match offers none. `opponentName` names the
 * character being faced, whose deck is its own rather than a copy of the
 * player's. With no match it says so — `active` false, and `opponentName` the
 * character a match would be against, the name the Play screen prints before one
 * starts — so a reader can tell the difference between "nothing has happened
 * yet" and "a match with an empty hand". A finished match also carries its
 * `outcome` — "win" or "loss" from the player's side — and whether it has been
 * recorded to the save yet.
 */
export function readMatch() {
  const match = state.match;
  if (!match) {
    return {
      active: false,
      opponentName: OPPONENT_NAME,
      over: false,
      winner: null,
      outcome: null,
      recorded: false,
      turn: null,
      selectedAttacker: null,
      playerHealth: null,
      opponentHealth: null,
      energy: null,
      maxEnergy: null,
      hand: [],
      table: [],
      opponentTable: [],
      opponentHand: 0,
      deckRemaining: state.deck.length,
      log: [],
      actions: [],
    };
  }

  return {
    active: true,
    opponentName: match.opponentName,
    over: match.over,
    winner: match.winner,
    outcome: match.outcome,
    recorded: match.recorded,
    turn: match.turn,
    selectedAttacker: state.selectedAttacker,
    playerHealth: match.player.health,
    opponentHealth: match.opponent.health,
    energy: match.player.energy,
    maxEnergy: match.player.maxEnergy,
    hand: match.player.hand.map(describeMatchCard),
    table: match.player.table.map(describeMatchCard),
    opponentTable: match.opponent.table.map(describeMatchCard),
    opponentHand: match.opponent.hand.length,
    deckRemaining: match.player.deck.length,
    log: [...match.log],
    actions:
      !match.over && match.turn === "player"
        ? [...match.player.hand.map((card) => `Play ${card.name} (cost ${card.cost})`), "End turn"]
        : [],
  };
}

/**
 * Every card in the game, each saying whether the player owns it and how many
 * copies are held — the whole set the Collection screen shows, which is what
 * the list-collection tool returns. `ownedCards` narrows it to what is actually
 * held, and `setTotal` is how many different cards the game has, so
 * `distinctCards` of `setTotal` is how close the set is to complete.
 */
export function readCollection() {
  return {
    cards: listAllCards(state.cards),
    ownedCards: listOwnedCards(state.cards),
    cardsOwned: state.cardsOwned,
    distinctCards: state.distinctCards,
    setTotal: state.setTotal,
    saved: state.saved,
  };
}

/** `1 copy` / `3 copies`, so a refusal reads as a sentence about what is owned. */
function copiesLabel(count) {
  return `${count} ${count === 1 ? "copy" : "copies"}`;
}

/**
 * Add one owned copy of a card to the deck — what a visitor does by pressing its
 * "Add … to deck" button, and what the add-card-to-deck tool does on their
 * behalf. A player may hold as many copies of an id as they own, up to the deck's
 * limit. Refused, with a reason, when the card is not owned, when every owned
 * copy is already in the deck, or when the deck is already at its limit. Returns
 * the state afterwards.
 */
export function addCardToDeck(cardId) {
  const owned = state.cards.find((card) => card.id === cardId)?.copies ?? 0;
  if (owned < 1) {
    throw new Error(`you do not own "${cardId}", so it cannot go in your deck`);
  }
  if (deckCopies(cardId) >= owned) {
    throw new Error(
      `you own ${copiesLabel(owned)} of "${cardName(cardId)}" and all ${owned} are already in your deck`
    );
  }
  if (state.deck.length >= state.deckLimit) {
    throw new Error(
      `not added: your deck already holds ${state.deckLimit} cards — remove one before adding another`
    );
  }

  state.deck = [...state.deck, cardId];
  commitDeck();
  return readState();
}

/**
 * Remove one copy of a card from the deck — what a visitor does by pressing its
 * "Remove … from deck" button, and what the remove-card-to-deck tool does on
 * their behalf. Refused, with a reason, when no copy of the card is in the deck.
 * Returns the state afterwards.
 */
export function removeCardFromDeck(cardId) {
  const at = state.deck.indexOf(cardId);
  if (at === -1) {
    throw new Error(`"${cardName(cardId)}" is not in your deck, so it cannot be removed`);
  }

  state.deck = [...state.deck.slice(0, at), ...state.deck.slice(at + 1)];
  commitDeck();
  return readState();
}

/**
 * Open a screen — what a visitor does by pressing Play or Collection, and what
 * the show-screen tool does on their behalf. A screen the page does not have is
 * refused before anything moves, so a bad call cannot leave the page blank.
 * Returns the state afterwards, the same shape readState() gives.
 */
export function showScreen(screen) {
  if (!screens.has(screen)) {
    throw new Error(`unknown screen "${screen}" — selfgrow has: ${[...screens.keys()].join(", ")}`);
  }

  const changed = screen !== state.screen;
  state.screen = screen;
  render();

  // The button that was pressed is now hidden, which would drop a keyboard
  // visitor's focus on the floor: land them at the top of the screen that opened.
  if (changed) screens.get(screen).querySelector("h2").focus();

  return readState();
}

for (const button of document.querySelectorAll("[data-screen-target]")) {
  button.addEventListener("click", () => showScreen(button.dataset.screenTarget));
}

startMatchButton?.addEventListener("click", () => runMatchAction(() => startMatch()));
playAgainButton?.addEventListener("click", () => runMatchAction(() => playAgain()));
endTurnButton?.addEventListener("click", () => runMatchAction(() => endMatchTurn()));

render();
renderCollection();
