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

import { CARD_BY_ID, DECK_LIMIT, MINIMUM_DECK_SIZE } from "./cards.js";
import {
  collectionSize,
  listDeckCards,
  listOwnedCards,
  loadGame,
  recordResult,
  saveDeck,
} from "./collection.js";
import { createMatch, endTurn, playCard } from "./match.js";

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

/** A table list, or a single line saying it is empty. */
function renderMatchTable(list, cards, emptyText) {
  if (!list) return;
  if (!cards.length) {
    const empty = document.createElement("li");
    empty.className = "match-empty";
    empty.textContent = emptyText;
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...cards.map((card) => matchCardItem(card)));
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
      `Final health: your hero ${match.player.health}, the opponent hero ${match.opponent.health}.`;
  }
  if (resultReward) resultReward.textContent = rewardText(won);
}

/**
 * What a finished match added, in words: the card a win earned, or plainly that
 * nothing was earned. Read from the result the match was recorded with, so what
 * the page says and what the save holds are the same thing.
 */
function rewardText(won) {
  const awarded = state.result?.awarded;
  if (awarded) {
    return (
      `New card: ${awarded.name} — cost ${awarded.cost}, attack ${awarded.attack}, ` +
      `health ${awarded.health} — was added to your collection.`
    );
  }
  return won
    ? "No new card this time."
    : "A loss records the match but earns no card — win a match to grow your collection.";
}

/**
 * Draw the match board: both heroes' health, the player's energy, the hand, both
 * tables and the log — all of it text, so a sighted player, a screen reader and
 * an agent read the same match. With no match in progress the board is hidden
 * and the note about the deck and the Start match button stand in its place.
 * Once a hero has fallen the hand and the End turn button go with it and the
 * result stands in their place, so there is nothing left to press.
 */
function renderMatch() {
  const match = state.match;
  if (matchBoard) matchBoard.hidden = !match;
  if (matchIntro) matchIntro.hidden = Boolean(match);
  if (startMatchButton) startMatchButton.hidden = Boolean(match);
  if (endTurnButton) endTurnButton.hidden = !match || match.over || match.turn !== "player";
  renderMatchResult(match);
  if (!match) return;

  if (matchFields.playerHealth) matchFields.playerHealth.textContent = String(match.player.health);
  if (matchFields.opponentHealth) matchFields.opponentHealth.textContent = String(match.opponent.health);
  if (matchFields.energy) matchFields.energy.textContent = `${match.player.energy} of ${match.player.maxEnergy}`;
  if (matchFields.opponentHand) matchFields.opponentHand.textContent = String(match.opponent.hand.length);
  if (matchFields.deckRemaining) matchFields.deckRemaining.textContent = String(match.player.deck.length);

  renderMatchHand(match);
  renderMatchTable(matchTableList, match.player.table, "Your table is empty.");
  renderMatchTable(matchOpponentTableList, match.opponent.table, "The opponent's table is empty.");
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
  state.result = { outcome: match.outcome, awarded: record.awarded };
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
  finishMatch();
  render();
  return readState();
}

/**
 * The button on an owned card that adds it to the deck, or takes it back out.
 * The label says which it will do, so the same control is both actions and a
 * keyboard visitor never has to guess what pressing it does.
 */
function deckToggleButton(card) {
  const inDeck = state.deck.includes(card.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary deck-toggle";
  button.dataset.deckToggle = card.id;
  button.textContent = inDeck ? `Remove ${card.name} from deck` : `Add ${card.name} to deck`;
  if (inDeck) button.classList.add("is-in-deck");
  button.addEventListener("click", () => toggleDeckCard(card.id));
  return button;
}

/** One owned card, as a list item that reads its name, numbers and deck toggle. */
function ownedCardRow(card) {
  const item = document.createElement("li");
  item.className = "owned-card";
  item.dataset.cardId = card.id;

  const head = document.createElement("div");
  head.className = "owned-head";

  const name = document.createElement("span");
  name.className = "owned-name";
  name.textContent = card.name;
  head.append(name);

  // A count only where there is more than one to count; one copy is the default.
  if (card.copies > 1) {
    const copies = document.createElement("span");
    copies.className = "owned-copies";
    copies.dataset.copies = String(card.copies);
    copies.textContent = `${card.copies} copies`;
    head.append(copies);
  }

  const stats = document.createElement("dl");
  stats.className = "owned-stats";
  for (const [label, key] of [
    ["Cost", "cost"],
    ["Attack", "attack"],
    ["Health", "health"],
  ]) {
    const stat = document.createElement("div");
    stat.className = "owned-stat";
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.dataset.stat = key;
    value.textContent = String(card[key]);
    stat.append(term, value);
    stats.append(stat);
  }

  item.append(head, stats, deckToggleButton(card));
  return item;
}

/** One card in the deck, read as its name and its three numbers. */
function deckCardRow(card) {
  const item = document.createElement("li");
  item.className = "deck-card";
  item.dataset.cardId = card.id;

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

/** Draw the owned cards, each with the control that adds or removes it. */
function renderOwnedCards() {
  const list = document.getElementById("collection-list");
  if (!list) return;

  const cards = listOwnedCards(state.cards);
  if (!cards.length) {
    const empty = document.createElement("li");
    empty.className = "collection-empty";
    empty.textContent = "You own no cards yet.";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...cards.map(ownedCardRow));
}

/** Draw the deck's current contents, as a list of readable card names. */
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

/** Draw the whole Collection screen: every owned card and the deck beside it. */
function renderCollection() {
  renderOwnedCards();
  renderDeck();
}

/** Put the refusal or confirmation in the always-present status line. */
function setDeckMessage(message) {
  if (deckMessage) deckMessage.textContent = message;
}

/** Return focus to a card's toggle after the list was redrawn under it. */
function focusDeckToggle(cardId) {
  const button = document.querySelector(`[data-deck-toggle="${cardId}"]`);
  if (button) button.focus();
}

/**
 * What pressing a card's toggle does: add it to the deck, or take it out. A
 * refusal is shown in the status line rather than swallowed, because a control
 * that silently does nothing tells the player nothing.
 */
function toggleDeckCard(cardId) {
  const inDeck = state.deck.includes(cardId);
  const name = cardName(cardId);
  try {
    if (inDeck) {
      removeCardFromDeck(cardId);
      setDeckMessage(`Removed ${name} from your deck.`);
    } else {
      addCardToDeck(cardId);
      setDeckMessage(`Added ${name} to your deck.`);
    }
  } catch (error) {
    setDeckMessage(error.message);
  }
  focusDeckToggle(cardId);
}

/** Persist the deck beside the collection and redraw everything that reads it. */
function commitDeck() {
  state.saved = saveDeck(state.cards, state.deck);
  render();
  renderCollection();
}

/**
 * Everything the page currently shows: the screen that is open, how many cards
 * the player owns and how many are different, the deck — its size, its limit,
 * the fewest cards a match needs and the cards themselves — whether it will
 * survive closing the page, how many matches have been played and won, the
 * result of the last finished match (whether it was a win or a loss, and the
 * card a win awarded), and the actions they can take from here. This is what
 * the get-state tool returns.
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
  return { id: card.id, name: card.name, cost: card.cost, attack: card.attack, health: card.health };
}

/**
 * Everything the match currently shows: whether one is in progress, whether it
 * is over and which hero won, whose turn it is, both heroes' health, the
 * player's energy, the hand, both tables, how many cards are left to draw, the
 * ordered log of what happened — its last line the final blow — and the moves
 * available now, of which a finished match offers none. With no match it says
 * so, so a reader can tell the difference between "nothing has happened yet"
 * and "a match with an empty hand". A finished match also carries its
 * `outcome` — "win" or "loss" from the player's side — and whether it has been
 * recorded to the save yet.
 */
export function readMatch() {
  const match = state.match;
  if (!match) {
    return {
      active: false,
      over: false,
      winner: null,
      outcome: null,
      recorded: false,
      turn: null,
      playerHealth: null,
      opponentHealth: null,
      energy: null,
      maxEnergy: null,
      hand: [],
      table: [],
      opponentTable: [],
      deckRemaining: state.deck.length,
      log: [],
      actions: [],
    };
  }

  return {
    active: true,
    over: match.over,
    winner: match.winner,
    outcome: match.outcome,
    recorded: match.recorded,
    turn: match.turn,
    playerHealth: match.player.health,
    opponentHealth: match.opponent.health,
    energy: match.player.energy,
    maxEnergy: match.player.maxEnergy,
    hand: match.player.hand.map(describeMatchCard),
    table: match.player.table.map(describeMatchCard),
    opponentTable: match.opponent.table.map(describeMatchCard),
    deckRemaining: match.player.deck.length,
    log: [...match.log],
    actions:
      !match.over && match.turn === "player"
        ? [...match.player.hand.map((card) => `Play ${card.name} (cost ${card.cost})`), "End turn"]
        : [],
  };
}

/**
 * Every card the player owns, with its name, cost, attack, health and how many
 * copies — the same list the Collection screen prints. This is what the
 * list-collection tool returns.
 */
export function readCollection() {
  return {
    cards: listOwnedCards(state.cards),
    cardsOwned: state.cardsOwned,
    distinctCards: state.distinctCards,
    saved: state.saved,
  };
}

/**
 * Add an owned card to the deck — what a visitor does by pressing its "Add … to
 * deck" button, and what the add-card-to-deck tool does on their behalf.
 * Refused, with a reason, when the card is not owned, is already in the deck, or
 * the deck is already at its limit. Returns the state afterwards.
 */
export function addCardToDeck(cardId) {
  if (!state.cards.some((card) => card.id === cardId)) {
    throw new Error(`you do not own "${cardId}", so it cannot go in your deck`);
  }
  if (state.deck.includes(cardId)) {
    throw new Error(`"${cardName(cardId)}" is already in your deck`);
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
 * Remove a card from the deck — what a visitor does by pressing its "Remove …
 * from deck" button, and what the remove-card-to-deck tool does on their behalf.
 * Refused, with a reason, when the card is not in the deck. Returns the state
 * afterwards.
 */
export function removeCardFromDeck(cardId) {
  if (!state.deck.includes(cardId)) {
    throw new Error(`"${cardName(cardId)}" is not in your deck, so it cannot be removed`);
  }

  state.deck = state.deck.filter((id) => id !== cardId);
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
