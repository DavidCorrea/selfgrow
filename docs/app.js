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
  saveDeck,
} from "./collection.js";

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
 * survive closing the page, and the actions they can take from here. This is
 * what the get-state tool returns.
 */
export function readState() {
  const actions = [...screens.get(state.screen).querySelectorAll("button")].map((button) =>
    button.textContent.trim()
  );

  return {
    screen: state.screen,
    cardsOwned: state.cardsOwned,
    distinctCards: state.distinctCards,
    deckSize: state.deck.length,
    deckLimit: state.deckLimit,
    minimumDeckSize: state.minimumDeckSize,
    deck: listDeckCards(state.deck),
    saved: state.saved,
    actions,
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

render();
renderCollection();
