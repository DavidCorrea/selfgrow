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

import { cardArtSvg, cardBackSvg, opponentPortraitSvg } from "./cardart.js";
import {
  CARDS,
  CARD_BY_ID,
  CLEAR_ON_PLAY,
  DECK_LIMIT,
  DEFAULT_OPPONENT,
  DRAW_ON_FALL,
  DRAW_ON_PLAY,
  drawsACard,
  GROWTH_ABILITY,
  HEAL_ON_FALL,
  HEAL_ON_PLAY,
  MINIMUM_DECK_SIZE,
  OPPONENTS,
  STRIKE_ON_FALL,
  STRIKE_ON_PLAY,
} from "./cards.js";
import {
  checkSaveCode,
  clearSavedMatch,
  collectionSize,
  listAllCards,
  listDeckCards,
  listOwnedCards,
  loadGame,
  nextRewardId,
  readSavedMatch,
  recordResult,
  restoreSaveCode as restoreGameCode,
  saveCode,
  saveDeck,
  saveMatch,
} from "./collection.js";
import { attack, concede, createMatch, endTurn, HERO_TARGET, playCard, readyToStrike } from "./match.js";

// The screens the page has, and the word each is announced by. A screen name is
// also the value an agent passes to the show-screen tool.
const SCREEN_LABELS = {
  home: "Home",
  collection: "Collection",
  play: "Play",
};

// The eight views the Collection screen's set list can be in: every card in the
// game, only the ones not collected yet, only the ones whose face carries a
// when-played ability, only the ones that mend your hero when played, only the
// ones whose face draws you a card, only the ones whose face carries a fall
// ability, only the ones that grow while they stay, or only the ones that carry
// more than one ability and so act twice. The list is also the schema a tool
// checks against, so a caller cannot ask for a view the page does not show.
const COLLECTION_VIEWS = ["all", "missing", "abilities", "mends", "draws", "falls", "grows", "twice"];

// The two orders the Collection screen's set list can be read in: the catalog's
// own order, or cheapest first. The list is also the schema a tool checks
// against, so a caller cannot ask for an order the page does not show.
const COLLECTION_ORDERS = ["catalog", "cost"];

// The four things a card can do the moment it is played, in the very words its
// face prints them. Each ability is written once in docs/cards.js; the shared
// "When played:" prefix is dropped here because the rule's own label already
// says a card acts as it lands. So the rule a newcomer reads and the ability a
// card prints are one list and cannot say different things.
const whenPlayedEffects = [DRAW_ON_PLAY, HEAL_ON_PLAY, STRIKE_ON_PLAY, CLEAR_ON_PLAY].map((ability) =>
  ability.replace(/^When played:\s*/, "")
);

// The three things a card can do the moment it leaves the table, read from the
// same constants a card's face prints. The shared "When this falls:" prefix is
// dropped for the same reason the when-played prefix is: the rule's own label
// already says a card acts as it falls. So the rule a newcomer reads and the
// fall a card pays out are one list and cannot say different things.
const fallEffects = [DRAW_ON_FALL, HEAL_ON_FALL, STRIKE_ON_FALL].map((ability) =>
  ability.replace(/^When this falls:\s*/, "")
);

// The one thing a card can do while it stays, read from the same constant a
// card's face prints. The shared "Grows:" prefix is dropped for the same reason
// the other prefixes are: the rule's own words say a card grows as it stays. So
// the rule a newcomer reads and the growth a card prints are one line and
// cannot say different things.
const growthEffect = GROWTH_ABILITY.replace(/^Grows:\s*/, "");

// "a, b, or c", so a rule listing abilities reads as one sentence.
const listed = (words) => `${words.slice(0, -1).join(", ")}, or ${words.at(-1)}`;

// What a match asks of a player, in the four things a newcomer cannot yet read
// for themselves: what a card costs, how the table fights, which hero loses, and
// what a card's face can say it does when it is played, when it falls or while
// it stays growing. They are written once, here, and both the Play screen and
// the get-match-rules tool read them, so the page and the tool cannot drift
// apart.
const MATCH_RULES = [
  {
    label: "Cards cost energy",
    text: "each card's face shows its price; energy readout refills and grows each turn",
  },
  {
    label: "Your cards fight theirs",
    text: "your table strikes theirs, and hits their hero once their table is empty",
  },
  {
    label: "First hero to 0 loses",
    text: "both heroes start at 20 health; the first to reach 0 ends it",
  },
  // One point covers all three, rather than three rows: the strip stands before
  // the picker, and extra rows pushed the opponent picker past the fold on a
  // short window. Folding them keeps the strip reading in one breath and the
  // picker where a newcomer can reach it. The played half is named before the
  // word "fall" and the fall and growth halves after it, so each half reads on
  // its own.
  {
    label: "Some cards act when played, when they fall or while they stay — a card can carry more than one",
    text: `a played card can ${listed(whenPlayedEffects)}; a card that falls can ${listed(fallEffects)}; a card that stays grows ${growthEffect}`,
  },
];

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
  // How the player has fared against each opponent, keyed by opponent id: the
  // wins and the matches played against them. It is kept in the same save as
  // the cards, so whom a player has beaten survives closing the page.
  opponentsRecord: opened.opponents,
  // Whether the Play screen's how-a-match-works strip is open. A player who has
  // not finished a match meets it open; once they have, it stays folded.
  rulesOpen: opened.matches === 0,
  // The result of the most recently finished match, or null until one ends:
  // whether it was a win or a loss, and the card a win awarded, if any.
  result: null,
  // The match in progress, or null before one is started. It is saved to the
  // browser as it changes, so a match left behind can be picked up again.
  match: null,
  // The unfinished match read back from the browser, or null when there is none.
  // It is what the home screen offers to continue until a match is loaded, at
  // which point it is the live match itself and there is nothing to continue.
  savedMatch: readSavedMatch(),
  // Whether a press of Start match is waiting on the player's answer about an
  // unfinished saved match: continue that match, or discard it and deal a new
  // one. Nothing is dealt or saved while it is set.
  startPending: false,
  // Which of the player's table cards the next chosen attack comes from, or null
  // when none is picked — so End turn still sends the whole table at the front
  // card by default. It is a page-only choice, cleared with each new turn.
  selectedAttacker: null,
  // Which cards the Collection screen's set list shows: "all" for every card in
  // the game, "missing" for only the ones not collected yet, "abilities" for
  // only the ones that act when played, "falls" for only the ones that act when
  // they fall. It is a page-only choice, so switching it never touches the
  // collection or the deck.
  collectionView: "all",
  // How the Collection screen's set list is read: "catalog" in the game's own
  // order, "cost" cheapest first. Like the view, it is a page-only choice, so
  // switching it never touches the collection or the deck.
  collectionOrder: "catalog",
  // The opponent the next match will be against, chosen from the picker on the
  // Play screen. It belongs to the page rather than to a match: a match already
  // running keeps the opponent it was started against.
  opponentId: DEFAULT_OPPONENT.id,
  // Whether the Collection screen's save-and-restore section is open. It holds
  // the save code and the restore controls, folded away so the deck a player
  // came to work on is what the screen opens on; opening it only shows those
  // controls. Page-only, so it is never written to a save.
  saveRestoreOpen: false,
  // Whether the Collection screen's save-code panel is open, so a caller can
  // read the same fact the button's label carries. Revealing the code only sets
  // this and fills the box: it reads the save and writes nothing, so the
  // collection, the deck and the record are exactly as they were.
  saveCodeShown: false,
  // The save code a player has pasted in and is being asked to confirm before it
  // replaces the game they have — `{ code, summary }` while an answer is waited
  // on, or null when nothing is waiting. A code only ever arrives here after it
  // was checked, and the game is not touched until the player answers, so a paste
  // by accident cannot wipe anything by itself.
  restorePending: null,
  // What the restore control last said: why a pasted code was refused, or what a
  // finished restore replaced. The question a waiting code asks is built from
  // its own summary, not from here.
  restoreMessage: "",
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
const homeDeckList = document.getElementById("home-deck-list");
// The buttons that switch which cards the set list shows, gathered once so
// their pressed state can be redrawn.
const collectionViewButtons = [...document.querySelectorAll("[data-collection-view]")];
// The two buttons that order the set list by the catalog or by cost, gathered
// once so their pressed state can be redrawn.
const collectionOrderButtons = [...document.querySelectorAll("[data-collection-order]")];
// The home screen's promise of what the next win will add, and the place its
// card is drawn. Both optional, so a missing one degrades to no figure.
const nextRewardHeading = document.getElementById("next-reward-heading");
const nextRewardBody = document.getElementById("next-reward-body");

// The Collection screen's fold over the save and restore controls: the body
// holding both panels, and the one button that shows and hides it. Optional for
// the same reason the panels are, so a missing one degrades to a missing fold.
const saveRestoreBody = document.getElementById("save-restore-body");
const saveRestoreToggle = document.getElementById("action-toggle-save-restore");

// The Collection screen's save-code control: the one button that reveals and
// hides the code, the panel holding the box and the copy button, and the status
// line that says in words what happened. All optional, so a missing one degrades
// to a missing control rather than a page that will not render.
const saveCodeButton = document.getElementById("action-save-code");
const saveCodePanel = document.getElementById("save-code-panel");
const saveCodeText = document.getElementById("save-code-text");
const copySaveCodeButton = document.getElementById("action-copy-save-code");
const saveCodeStatus = document.getElementById("save-code-status");
// What the save-code status line says — empty until the code is revealed, then
// the words that say the code is on screen, or that it was copied, or that the
// clipboard refused and the code is selected to copy by hand.
let saveCodeMessage = "";

// The Collection screen's restore control: the box a code is pasted into, the
// button that checks it and asks, the two answers to that question, and the line
// that says in words what happened. All optional, so a missing one degrades to a
// missing control rather than a page that will not render.
const restoreCodeText = document.getElementById("restore-code-text");
const restoreCodeButton = document.getElementById("action-restore-save-code");
const restoreConfirm = document.getElementById("restore-confirm");
const restoreConfirmText = document.getElementById("restore-confirm-text");
const replaceGameButton = document.getElementById("action-replace-game");
const cancelRestoreButton = document.getElementById("action-cancel-restore");
const restoreCodeStatus = document.getElementById("restore-code-status");

// The match board's places, gathered once. Each is optional so a missing one
// degrades to a missing readout rather than a page that will not render.
const matchBoard = document.getElementById("match-board");
const matchIntro = document.getElementById("match-intro");
const matchIntroLine = document.getElementById("match-intro-line");
const matchIntroOpponent = document.getElementById("match-intro-opponent");
const matchIntroDeck = document.getElementById("match-intro-deck");
const opponentPicker = document.getElementById("opponent-picker");
const opponentOptions = document.getElementById("opponent-options");
const matchRulesSection = document.getElementById("match-rules");
const matchRulesPoints = document.getElementById("match-rules-points");
const matchRulesToggle = document.getElementById("action-toggle-rules");
const matchOpponentName = document.getElementById("match-opponent-name");
const matchOpponentPortrait = document.getElementById("match-opponent-portrait");
const matchOpponentHealthLabel = document.getElementById("match-opponent-health-label");
// The label their hero wears when it is the thing an ending turn would strike,
// standing where their cards would once the table in front of it is empty.
const matchOpponentStrikeTarget = document.getElementById("match-opponent-strike-target");
const matchOpponentHandLabel = document.getElementById("match-opponent-hand-label");
const matchOpponentEnergyLabel = document.getElementById("match-opponent-energy-label");
const matchOpponentTableHeading = document.getElementById("match-opponent-table-heading");
const matchMessage = document.getElementById("match-message");
const startMatchButton = document.getElementById("action-start-match");
// The two answers to a pending start: keep the saved match, or throw it away.
// Both sit in the same rail as the button that asked, so the choice is one
// press away from where it was raised.
const continueSavedButton = document.getElementById("action-continue-saved");
const discardSavedButton = document.getElementById("action-discard-saved");
const endTurnButton = document.getElementById("action-end-turn");
const concedeButton = document.getElementById("action-concede");
const matchTurnStanding = document.getElementById("match-turn-standing");
const matchTurn = document.getElementById("match-turn");
const matchReadyStanding = document.getElementById("match-ready-standing");
const matchReady = document.getElementById("match-ready");
const matchFields = {
  playerHealth: document.getElementById("match-player-health"),
  opponentHealth: document.getElementById("match-opponent-health"),
  energy: document.getElementById("match-energy"),
  opponentHand: document.getElementById("match-opponent-hand"),
  opponentEnergy: document.getElementById("match-opponent-energy"),
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
const resultFirstWin = document.getElementById("result-first-win");
const resultReward = document.getElementById("result-reward");
const playAgainButton = document.getElementById("action-play-again");

// The home screen's offer to pick up a match left behind, with the few numbers
// that say which match it is and the one control that resumes it.
const continueSection = document.getElementById("continue-match");
const continueOpponent = document.getElementById("continue-opponent");
const continuePlayerHealth = document.getElementById("continue-player-health");
const continueOpponentHealth = document.getElementById("continue-opponent-health");
const continueTurn = document.getElementById("continue-turn");
const continueButton = document.getElementById("action-continue-match");

// The board the page last drew, or null when none was drawn. The next draw is
// diffed against it, so a blow that has just landed can be shown on the cards
// rather than only read in the log. It is cleared with the match it belongs to,
// so nothing is ever reacted to across two different games.
let shownBoard = null;
// The reactions the last board draw marked, kept so the state an agent reads can
// report the same "just played" fact the cards wear. It is set beside `shownBoard`
// and cleared with it, so a fact never outlives the board it belongs to.
let shownReactions = null;

/**
 * The counts the page prints, with the deck size and the opponents beaten derived
 * from what they count, so neither number can drift from the cards and the
 * records it is read from.
 */
function counts() {
  return {
    ...state,
    deckSize: state.deck.length,
    opponentsBeaten: opponentsBeatenCount(),
    opponentsTotal: OPPONENTS.length,
  };
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
  renderHomeDeck();

  renderMatch();
  renderMatchRules();
  renderContinueOffer();
  renderNextReward();
  renderSaveRestore();
  renderSaveCode();
  renderRestore();

  screenStatus.textContent = `${SCREEN_LABELS[state.screen]} screen`;
}

/**
 * Draw the Collection screen's save-and-restore fold: whether the body holding
 * the save-code and restore panels is open, and what the one button offers
 * next. The button says in words the same thing `aria-expanded` says silently,
 * so the fold is read whether or not the styling is.
 */
function renderSaveRestore() {
  if (!saveRestoreBody) return;
  saveRestoreBody.hidden = !state.saveRestoreOpen;
  if (saveRestoreToggle) {
    saveRestoreToggle.setAttribute("aria-expanded", String(state.saveRestoreOpen));
    saveRestoreToggle.textContent = state.saveRestoreOpen
      ? "Hide save and restore"
      : "Show save and restore";
  }
}

/**
 * Draw the Collection screen's save-code control: whether the panel is open,
 * what the button offers next, and the words the status line carries. The button
 * says the same thing in words that `aria-expanded` says silently, so the state
 * is read whether or not the styling is.
 */
function renderSaveCode() {
  if (!saveCodePanel) return;
  saveCodePanel.hidden = !state.saveCodeShown;
  if (saveCodeButton) {
    saveCodeButton.setAttribute("aria-expanded", String(state.saveCodeShown));
    saveCodeButton.textContent = state.saveCodeShown ? "Hide save code" : "Show save code";
  }
  // The box always holds the code for the game as it stands now, so a code left
  // on screen while a match is won and lost is refreshed rather than stale. It
  // is only rewritten when it changed, so a player selecting the code by hand is
  // not interrupted by a redraw that would drop the selection.
  if (state.saveCodeShown && saveCodeText) {
    const current = saveCode();
    if (saveCodeText.value !== current) saveCodeText.value = current;
  }
  if (saveCodeStatus) saveCodeStatus.textContent = saveCodeMessage;
}

/**
 * Draw the Collection screen's restore control: whether a pasted code is
 * waiting on the player's answer — and then the two answers, the one that
 * replaces the game and the one that keeps it — and the words the status line
 * carries. The question says what the code holds, so the player is answering
 * about a game rather than about a string, and the status line is where a
 * refusal says in plain words why nothing was changed.
 */
function renderRestore() {
  if (!restoreConfirm) return;
  const waiting = state.restorePending;
  restoreConfirm.hidden = !waiting;
  if (restoreConfirmText) {
    restoreConfirmText.textContent = waiting ? restoreQuestion(waiting.summary) : "";
  }
  if (restoreCodeStatus) restoreCodeStatus.textContent = state.restoreMessage;
}

/**
 * The question a waiting code asks, in the code's own numbers: how much is about
 * to arrive, and that the game it replaces cannot be brought back. Written from
 * the summary `checkSaveCode` produced, so the question and the game a
 * confirmation actually restores are one reading of one code.
 */
function restoreQuestion({ cards, distinct, deck, wins, matches }) {
  return (
    `This code holds ${cards} ${cards === 1 ? "card" : "cards"} (${distinct} different), ` +
    `a deck of ${deck}, and ${wins} ${wins === 1 ? "win" : "wins"} in ${matches} ` +
    `${matches === 1 ? "match" : "matches"}. Replacing your game cannot be undone.`
  );
}

/**
 * The home screen's deck summary: its size alone, in words. The cards it counts
 * are drawn as their own faces under the actions, so the sentence carries the
 * count a screen reader hears without repeating every name the faces show.
 */
function deckSummaryText() {
  if (!state.deck.length) return "Your deck is empty — choose cards from your Collection.";
  return `Deck size ${state.deck.length} of ${state.deckLimit}.`;
}

/**
 * Draw the saved deck on the home screen as its cards, each the same face the
 * deck panel and the opponent picker use — picture, name and three numbers — so
 * a player recognises what they are about to play by sight. An empty deck says
 * so in words rather than reading as a deck with cards but no contents.
 */
function renderHomeDeck() {
  if (!homeDeckList) return;
  const cards = listDeckCards(state.deck);
  if (!cards.length) {
    const empty = document.createElement("li");
    empty.className = "deck-empty";
    empty.textContent = "No cards in your deck yet.";
    homeDeckList.replaceChildren(empty);
    return;
  }
  homeDeckList.replaceChildren(...cards.map(deckCardRow));
}

/** The name of a card the player owns, or the id when it is not a real card. */
function cardName(cardId) {
  return CARD_BY_ID.get(cardId)?.name ?? String(cardId);
}

/**
 * The text box a card's face prints, in the same words on every card everywhere
 * it is shown, or null when the card carries no ability at all. A card that
 * carries more than one ability prints them as lines of one box in the order the
 * card's own texts are written — when-played first, then growth, then fall — so
 * the text a reader looks for stays first and a card that carries only a growth
 * or fall ability still reads its text. The caller adds the result to the face it
 * builds, so a card reads the same in the collection, the deck, the hand and on
 * the match table.
 */
function cardAbilityNote(card) {
  const lines = [card.ability, card.growthAbility, card.fallAbility].filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length === 1) return cardAbilityLine(lines[0]);

  const box = document.createElement("div");
  box.className = "card-abilities";
  box.append(...lines.map(cardAbilityLine));
  return box;
}

/** One line of a card's text box, in the words printed on its face. */
function cardAbilityLine(text) {
  const line = document.createElement("p");
  line.className = "card-ability";
  line.textContent = text;
  return line;
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

  const ability = cardAbilityNote(card);
  if (ability) item.append(ability);

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
        (card.ability ? `, ${card.ability}` : "") +
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
      const attackerId = state.selectedAttacker;
      attackMatch(attackerId, card.id);
      // The blow spends the attacker and clears the pick, so this very control
      // goes with it; focus lands back on the card that struck, which is still
      // on the table until the turn ends.
      focusMatchControl(`#match-table [data-card-id="${attackerId}"] .match-attack-select`);
    })
  );
  return control;
}

/**
 * The card the player picked to attack with, or null when none is picked. The
 * pick names a card that is still standing on the player's table and has not
 * yet attacked; the opponent's target controls are drawn only while this names
 * a card, so the board never invites a move that cannot be made.
 */
function pickedAttacker(match) {
  if (!state.selectedAttacker) return null;
  return (
    match.player.table.find(
      (card) => card.id === state.selectedAttacker && !card.hasAttacked
    ) || null
  );
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
 * The stable name of one copy of a card on a table: its id, and how many copies
 * of that same id already stood before it. Two identical cards on one table are
 * told apart this way, so a hit on one is never read as a hit on the other.
 */
function tableOccurrenceKey(seen, cardId) {
  const copies = seen.get(cardId) ?? 0;
  seen.set(cardId, copies + 1);
  return `${cardId}#${copies}`;
}

/**
 * The two lines a when-played draw and mend write, each naming the card that
 * fired and the side it acted for — "you" for the player, "the opponent" for
 * the other. They are matched whole so the turn's own draw ("You draw X — …"),
 * which names no card of its own and no beneficiary, is never read as an
 * ability. A when-played strike needs no line of its own: it lands through the
 * same blow line a turn's strikes use, and the strikers pass already catches it.
 */
const DRAW_FIRED = /^(.+?) draws .+ for (you|the opponent) — \d+ left in deck\.$/;
const MEND_FIRED = /^(.+?) heals (you|the opponent) for \d+ — .+\.$/;

/**
 * What changed on the board since it was last drawn: for each side, which of its
 * cards have just been struck, have just struck, or have just fired a when-played
 * draw or mend as they landed, and which cards have left the table. Empty when
 * this is a different match than the one drawn last — a new, continued or
 * replaced game has no blow to show.
 */
function reactionsToShow(board, match) {
  const reactions = { player: {}, opponent: {}, fallen: { player: [], opponent: [] } };
  if (!board || board.id !== match.id) return reactions;

  // Who struck, and which card fired an ability as it landed, is read from the
  // lines the turn just added to the log. A card's `hasAttacked` cannot be used
  // for the strike: the turn ends by freshening every card on the surviving
  // side's table, so by the time the board is drawn a card that struck and has
  // attacked again reads as unspent. The log keeps the blow.
  const strikers = { player: new Set(), opponent: new Set() };
  const abilityFirers = { player: new Set(), opponent: new Set() };
  for (const line of match.log.slice(board.logLength)) {
    const blow = /^(Your|Opponent's) (.+?) deals \d+ to /.exec(line);
    if (blow) strikers[blow[1] === "Your" ? "player" : "opponent"].add(blow[2]);

    const fired = DRAW_FIRED.exec(line) ?? MEND_FIRED.exec(line);
    if (fired) abilityFirers[fired[2] === "you" ? "player" : "opponent"].add(fired[1]);
  }

  for (const side of ["player", "opponent"]) {
    const before = new Map(board[side].map((entry) => [entry.key, entry]));
    const now = snapshotTable(match[side].table);
    const standing = new Set(now.map((entry) => entry.key));
    const struck = strikers[side];
    const fired = abilityFirers[side];

    for (const entry of now) {
      const was = before.get(entry.key);
      const reaction = {};
      if (was && entry.health < was.health) reaction.hit = true;
      if (struck.has(entry.name)) reaction.striking = true;
      if (fired.has(entry.name)) reaction.ability = true;
      // A card the opponent played on the turn just ended stands where it did not
      // stand on the last draw: a new occurrence key on its table. The scope is
      // the opponent's table alone, because the player's own plays are visible in
      // their hand and energy as they happen.
      if (side === "opponent" && !was) reaction.justPlayed = true;
      if (reaction.hit || reaction.striking || reaction.ability || reaction.justPlayed) {
        reactions[side][entry.key] = reaction;
      }
    }
    reactions.fallen[side] = board[side].filter((entry) => !standing.has(entry.key));
  }
  return reactions;
}

/** The board as it is now, for the next draw to be diffed against. */
function snapshotBoard(match) {
  return {
    id: match.id,
    logLength: match.log.length,
    player: snapshotTable(match.player.table),
    opponent: snapshotTable(match.opponent.table),
  };
}

/** One side's table, each card by its copy, its id, name and current health. */
function snapshotTable(table) {
  const seen = new Map();
  return table.map((card) => ({
    key: tableOccurrenceKey(seen, card.id),
    id: card.id,
    name: card.name,
    health: card.health,
  }));
}

/**
 * Mark a freshly drawn card with the classes of the blow it just took or struck,
 * of the when-played ability it just fired as it landed, or of the opponent
 * having played it on its last turn. A blow and an ability are styling only, the
 * log naming them in words; a card the opponent just played also carries its
 * wording on the face, because the log lists every play of a turn while the table
 * shows only the cards as they now stand, and a player should not have to read
 * the log back to see what is new.
 */
function markCardReaction(item, reaction) {
  if (!reaction) return;
  if (reaction.hit) item.classList.add("is-hit");
  if (reaction.striking) item.classList.add("is-striking");
  if (reaction.ability) item.classList.add("is-ability");
  if (reaction.justPlayed) {
    item.classList.add("is-just-played");
    const mark = document.createElement("span");
    mark.className = "match-just-played-mark";
    mark.textContent = "Just played";
    item.append(mark);
  }
}

/**
 * A card that has just left a table, drawn leaving it: the card's own art and a
 * caption, faded and lowered off the row. It is decoration only — the match log
 * already names the fall — so it is hidden from assistive technology and takes
 * no pointer, and it carries no `data-card-id`, so it never reads as a card
 * still standing on the table.
 */
function fallingCardItem(card) {
  const item = document.createElement("li");
  item.className = "match-card match-card-falling";
  item.setAttribute("aria-hidden", "true");
  const art = cardArtSvg(card.id, card.name);
  if (art) item.append(art);
  const caption = document.createElement("span");
  caption.className = "match-card-falling-caption";
  caption.textContent = "falls";
  item.append(caption);
  return item;
}

/**
 * The player's table, each card with the control that picks it to strike with.
 * The controls appear only on the player's own turn in a live match, so a
 * finished match or the opponent's turn offers no move nobody can make. A blow
 * the last draw missed is marked on the card here, and a card that fell since
 * then is drawn leaving the row.
 */
function renderPlayerTable(match, canAttack, reactions) {
  if (!matchTableList) return;
  const seen = new Map();
  const children = match.player.table.map((card) => {
    const item = matchCardItem(card);
    markCardReaction(item, reactions.player[tableOccurrenceKey(seen, card.id)]);
    if (!canAttack) return item;
    item.classList.add("match-card-action");
    if (card.hasAttacked) item.classList.add("is-spent");
    item.append(attackSelectControl(card));
    return item;
  });
  if (!children.length) children.push(emptyTableItem("Your table is empty."));
  children.push(...reactions.fallen.player.map(fallingCardItem));
  matchTableList.replaceChildren(...children);
}

/**
 * What the player's ending turn would strike: the card at the front of the
 * opponent's table, or — once that table is empty — the opponent's hero. Null
 * whenever no turn of the player's is in progress, so the mark goes with the
 * turn it belongs to. It is a label rather than a control: ending the turn is
 * the move, and where the blows land follows from it. The board and the state a
 * tool reads are both filled from here, so the card marked and the card struck
 * are one answer.
 */
export function endOfTurnTarget(match) {
  if (!match || match.over || match.turn !== "player") return null;
  const front = match.opponent.table[0];
  if (front) return { kind: "card", cardId: front.id, name: front.name };
  return { kind: "hero", cardId: null, name: match.opponentName };
}

/**
 * The opponent's table, each card with the control that sends the picked card at
 * it, and — once the table is empty — the one control that sends it at the hero
 * behind. These appear only on the player's own turn in a live match and only
 * once a table card has been picked to attack with, so no target is offered for
 * a blow that cannot be made. The card an ending turn would strike carries its
 * own wording instead, whether or not a target has been picked: that blow is
 * coming whichever card strikes, so the mark stands on its own.
 */
function renderOpponentTable(match, canAttack, reactions) {
  if (!matchOpponentTableList) return;
  const seen = new Map();
  // The opponent's controls appear only once the player has picked a card to
  // attack with, so the board offers a target exactly when one can be struck.
  const targetable = canAttack && Boolean(pickedAttacker(match));
  const strikeTarget = endOfTurnTarget(match);
  const children = match.opponent.table.map((card, index) => {
    const item = matchCardItem(card);
    markCardReaction(item, reactions.opponent[tableOccurrenceKey(seen, card.id)]);
    // The front of the table is read by position, not by id: two copies of one
    // card can stand side by side, and only the first of them is struck. The
    // mark is added after the card's own face, so a screen reader hears the card
    // named and numbered before the wording; it is drawn first on the face by
    // CSS, because a table surface is a fixed height on a wide window and a tall
    // card's lower edge is the part that scrolls out of it.
    if (strikeTarget?.kind === "card" && index === 0) {
      item.classList.add("is-end-turn-target");
      const mark = document.createElement("span");
      mark.className = "match-strike-mark";
      mark.textContent = "Your end of turn strikes this card";
      item.append(mark);
    }
    if (!targetable) return item;
    item.classList.add("match-card-action");
    item.append(attackTargetControl(card));
    return item;
  });
  if (!match.opponent.table.length) {
    children.push(emptyTableItem(`${match.opponentName}'s table is empty.`));
    if (targetable) {
      const item = document.createElement("li");
      item.className = "match-card match-card-action match-attack-hero-item";
      const control = document.createElement("button");
      control.type = "button";
      control.className = "btn btn-secondary match-attack-hero";
      control.textContent = "Attack the opponent hero";
      control.addEventListener("click", () =>
        runMatchAction(() => {
          const attackerId = state.selectedAttacker;
          attackMatch(attackerId, HERO_TARGET);
          focusMatchControl(`#match-table [data-card-id="${attackerId}"] .match-attack-select`);
        })
      );
      item.append(control);
      children.push(item);
    }
  }
  children.push(...reactions.fallen.opponent.map(fallingCardItem));
  matchOpponentTableList.replaceChildren(...children);
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
 *
 * The scroll waits for the frame instead of running here: reading `scrollHeight`
 * forces the browser to lay the page out, and a match writes the log on every
 * render, so scrolling inline once per render is a layout per render. Coalescing
 * to one requestAnimationFrame per frame keeps the newest line in view at the
 * same visible moment, at one layout rather than one per line of the match.
 */
let logScrollQueued = false;

function scrollMatchLogToNewestLine() {
  if (logScrollQueued || !matchLogList) return;
  logScrollQueued = true;
  requestAnimationFrame(() => {
    logScrollQueued = false;
    if (matchLogList) matchLogList.scrollTop = matchLogList.scrollHeight;
  });
}

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
  scrollMatchLogToNewestLine();
}

/**
 * The result of a finished match, said once: whether the player won, lost or gave
 * the match up, both heroes' final health, how many matches the player has now
 * finished and won, the one card a win added, and — when the win was the first
 * against that opponent — that it was. Shown only once the match is over — a
 * hero fallen or a match conceded — in the same board it was played on, so a
 * result is a state of the match rather than a second screen.
 */
function renderMatchResult(match) {
  const finished = Boolean(match?.over);
  if (matchResult) matchResult.hidden = !finished;
  if (playAgainButton) playAgainButton.hidden = !finished;
  if (matchHandSide) matchHandSide.hidden = finished;
  if (!finished) return;

  const won = match.winner === "player";
  if (matchResultHeading) {
    matchResultHeading.textContent = match.conceded ? "You conceded" : won ? "You won" : "You lost";
  }
  if (matchFinalHealth) {
    // A conceded match has no final blow, so it says the standing the player
    // walked away from rather than claiming a hero fell at the numbers shown.
    const standing = `your hero ${match.player.health}, ${match.opponentName} ${match.opponent.health}`;
    matchFinalHealth.textContent = match.conceded
      ? `Conceded with no hero fallen: ${standing}.`
      : `Final health: ${standing}.`;
  }
  // The payoff of a first win, said where the win happened: the picker's record
  // alone would be a screen away from the result that moved it.
  if (resultFirstWin) {
    const firstWin = won && state.result?.firstWin;
    resultFirstWin.textContent = firstWin ? `Your first win against ${match.opponentName}.` : "";
    resultFirstWin.hidden = !firstWin;
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
 * The id of the card the most recent win added to the collection, or null when
 * there is nothing to mark: no result yet, a loss, or a win whose only card was a
 * duplicate because every card in the game was already held. A fresh win is
 * exactly a win that awarded a card without completing the set, which is how the
 * result itself reads the difference — so the mark and the result cannot
 * disagree about whether anything new was earned.
 */
export function newlyCollectedId(result) {
  return result?.awarded && !result?.setComplete ? result.awarded.id : null;
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
  const ability = cardAbilityNote(card);
  if (ability) caption.append(ability);
  figure.append(caption);
  return figure;
}

/**
 * The heading over the home screen's next-reward card: what the next win is
 * working toward, or the plain fact that there is nothing left to earn.
 */
export function nextRewardHeadingText(setComplete) {
  return setComplete ? "Set complete" : "Next win earns";
}

/**
 * The reward card the next win would add, read from the same choice `recordResult`
 * awards by, or null once the player owns every reward card. It is read against
 * the opponent the picker has chosen and whether that opponent has already been
 * beaten, so the home screen promises a first win's signature card while it is
 * still to collect and the usual reward once the opponent is beaten.
 */
export function nextRewardCard() {
  const opponent = selectedOpponent();
  const { wins } = opponentRecord(opponent.id);
  const id = nextRewardId(state.cards, opponent, wins > 0);
  return id ? CARD_BY_ID.get(id) : null;
}

/**
 * Where the card the next win promises comes from: "signature" when it is the
 * chosen opponent's own signature card, still to collect, and so earned only by
 * beating that opponent; "pool" when it is an ordinary reward card any win
 * earns; or null when there is no card left to promise. It reads the same
 * `nextRewardCard` choice a win awards by, so the note the home screen prints
 * and the branch a win takes can never disagree.
 */
export function nextRewardSource() {
  const opponent = selectedOpponent();
  const card = nextRewardCard();
  if (!card) return null;
  if (card.id === opponent.signature && !isSignatureEarned(opponent)) return "signature";
  return "pool";
}

/**
 * Who earns the card the next win promises, in words: the opponent to beat when
 * the card is that opponent's own signature, or the plain fact that any win
 * earns it when it is an ordinary reward. An empty string when there is no card
 * to promise. This is what the home screen prints beside the card, so the
 * promise points at a match to play rather than at a card alone.
 */
export function nextRewardNoteText(source, opponentName) {
  if (source === "signature") return `Beat ${opponentName} to earn it.`;
  if (source === "pool") return "Any win earns it.";
  return "";
}

/**
 * Show, on the home screen, the card the next win will add: the label over it,
 * then the card itself — its picture, name and three numbers — so the goal a win
 * is working toward is visible before the match rather than only after it. Once
 * every reward card is held there is no next card to promise, so it says the set
 * is complete instead and shows no figure.
 *
 * `state.cards` is updated the moment a match is recorded, so after a win this
 * advances to the following unowned card.
 */
function renderNextReward() {
  if (!nextRewardHeading || !nextRewardBody) return;
  const card = nextRewardCard();
  nextRewardHeading.textContent = nextRewardHeadingText(card === null);
  if (card) {
    const note = document.createElement("p");
    note.className = "next-reward-note next-reward-earned-by";
    note.textContent = nextRewardNoteText(nextRewardSource(), selectedOpponent().name);
    nextRewardBody.replaceChildren(awardCardFigure(card), note);
    return;
  }
  const note = document.createElement("p");
  note.className = "next-reward-note";
  note.textContent = "You own every reward card — nothing left to earn.";
  nextRewardBody.replaceChildren(note);
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
 * Whether the Play screen is standing before a match: with none started yet, or
 * once the last one is over so the next can be against someone else. A match in
 * progress owns the screen, and its own labels say who it is against.
 */
function isBeforeMatch() {
  return !state.match || state.match.over;
}

/** The opponent the next match would be against, out of the one list of them. */
function selectedOpponent() {
  return OPPONENTS.find((opponent) => opponent.id === state.opponentId) ?? DEFAULT_OPPONENT;
}

/**
 * The opponent a running match is against, out of the one list of them: the one
 * the match's `opponentId` names, then the one its `opponentName` names, then
 * the default — so a match saved before opponents carried an id still resolves.
 */
function matchOpponent(match) {
  return (
    OPPONENTS.find((opponent) => opponent.id === match.opponentId) ??
    OPPONENTS.find((opponent) => opponent.name === match.opponentName) ??
    DEFAULT_OPPONENT
  );
}

/**
 * Draw the opponent's portrait at the head of the board, beside the name and
 * health the board already prints, for as long as a match runs. Before a match
 * and once one is over there is no opponent on the board to show, so the slot is
 * emptied and hidden — the result stands where the character did.
 */
function renderMatchOpponentPortrait(match) {
  if (!matchOpponentPortrait) return;
  const opponent = match && !match.over ? matchOpponent(match) : null;
  const portrait = opponent ? opponentPortraitSvg(opponent) : null;
  if (!portrait) {
    matchOpponentPortrait.replaceChildren();
    matchOpponentPortrait.hidden = true;
    return;
  }
  // The accent names a token in styles.css, so the portrait is painted in the
  // opponent's own colour the same way the picker paints it.
  matchOpponentPortrait.style.setProperty("--opponent-accent", `var(${opponent.accent})`);
  matchOpponentPortrait.replaceChildren(portrait);
  matchOpponentPortrait.hidden = false;
}

/**
 * How the player has fared against one opponent, in words: "No matches yet"
 * before the first meeting, then how many of the matches played were won, and
 * the word "Beaten" in front of it once they have been beaten. The beaten mark
 * is that word rather than a colour, so a player who cannot tell colours apart
 * reads the same record as anyone else.
 */
export function opponentRecordText(wins, matches) {
  const played = Number.isSafeInteger(matches) && matches > 0 ? matches : 0;
  if (played === 0) return "No matches yet";
  const won = Number.isSafeInteger(wins) && wins > 0 ? Math.min(wins, played) : 0;
  const record = `${won} of ${played} ${played === 1 ? "match" : "matches"} won`;
  return won > 0 ? `Beaten — ${record}` : record;
}

/** The record the page holds against an opponent, read as a pair of counts. */
function opponentRecord(opponentId) {
  const record = state.opponentsRecord?.[opponentId];
  return { wins: record?.wins ?? 0, matches: record?.matches ?? 0 };
}

/**
 * How many characters the player has beaten at least once — the goal the home
 * screen counts beside the set, read from the same per-opponent record the
 * picker prints, so a first win raises it and beating the same opponent again
 * does not.
 */
function opponentsBeatenCount() {
  return OPPONENTS.filter((opponent) => opponentRecord(opponent.id).wins > 0).length;
}

/**
 * What an opponent's signature card is marked with in their deck: the promise a
 * first win against them still earns it, and the plain fact once it is already
 * earned — the player owns it, or has already beaten them. Both are words, so a
 * screen reader and an agent read the mark the same way a sighted player does.
 */
export function signatureMarkText(earned) {
  return earned ? "Already earned" : "First win earns this card";
}

/**
 * Whether the card a first win against an opponent earns is already the player's:
 * they own a copy, or they have already beaten that opponent. Read from the same
 * `opponentRecord` and `state.cards` the state layer exposes, so the mark in the
 * deck and what an agent reads can never disagree.
 */
function isSignatureEarned(opponent) {
  if (opponentRecord(opponent.id).wins > 0) return true;
  return state.cards.some((card) => card.id === opponent.signature);
}

/**
 * Write one opponent's record onto its line in the picker: the words from
 * `opponentRecordText`, and the emphasis that marks an opponent already beaten.
 * Called on every draw, so the line is right after a match has moved it.
 */
function writeOpponentRecord(line, opponentId) {
  const { wins, matches } = opponentRecord(opponentId);
  line.textContent = opponentRecordText(wins, matches);
  line.classList.toggle("opponent-record-beaten", wins > 0);
}

/**
 * One opponent in the picker, as a radio a keyboard can reach and a thumb can
 * tap: the opponent's portrait, their name, their look, the kind of deck they
 * bring and how the player has fared against them so far, with all of that as
 * the radio's label so pressing any part of it picks that opponent — and, under
 * it, the deck itself, so who to face is not chosen on words alone.
 */
function opponentOption(opponent) {
  const option = document.createElement("div");
  option.className = "opponent-option";
  option.dataset.opponentId = opponent.id;
  // The accent names a token in styles.css, so the colour itself stays written
  // in the one place the page writes colours.
  option.style.setProperty("--opponent-accent", `var(${opponent.accent})`);

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "opponent";
  radio.value = opponent.id;
  radio.className = "opponent-radio";

  const text = document.createElement("span");
  text.className = "opponent-text";

  const name = document.createElement("span");
  name.className = "opponent-name";
  name.textContent = opponent.name;

  // How the player has fared against this opponent, filled in on every draw
  // rather than only here, because the options are built once and a match moves
  // the record behind them.
  const record = document.createElement("span");
  record.className = "opponent-record";
  writeOpponentRecord(record, opponent.id);

  // The name and the record share a row where the width allows it — the record
  // is about the character, and on a phone one row for both keeps the picker
  // from costing a line of its own on each stacked option.
  const head = document.createElement("span");
  head.className = "opponent-head";
  head.append(name, record);

  const look = document.createElement("span");
  look.className = "opponent-look";
  look.textContent = opponent.look;

  const deck = document.createElement("span");
  deck.className = "opponent-deck";
  deck.textContent = opponent.description;

  text.append(head, look, deck);

  const choice = document.createElement("label");
  choice.className = "opponent-choice";
  const portrait = opponentPortraitSvg(opponent);
  choice.append(radio, ...(portrait ? [portrait] : []), text);

  option.append(choice, opponentDeckFold(opponent));
  return option;
}

/**
 * The cards an opponent brings, folded into their option: the ten faces a match
 * against them is dealt, each its picture with a name and three numbers, so an
 * opponent is chosen with the deck in sight instead of on the promise of a
 * sentence.
 *
 * Folded rather than always drawn because ten faces under every opponent would
 * push the picker, and Start match with it, off the first screen — and the line
 * above still says the kind of deck each one brings for a player who never
 * opens it.
 */
function opponentDeckFold(opponent) {
  const cards = listDeckCards(opponent.deck);

  const fold = document.createElement("details");
  fold.className = "opponent-deck-fold";

  const toggle = document.createElement("summary");
  toggle.className = "opponent-deck-toggle";
  toggle.textContent = `Their deck, ${cards.length} cards`;

  // The one card a first win against them earns is marked in words, so choosing
  // who to face also shows which of the ten stands for how they play and whether
  // it is still on offer.
  const signatureNote = signatureMarkText(isSignatureEarned(opponent));

  const list = document.createElement("ul");
  list.className = "opponent-deck-cards";
  list.replaceChildren(
    ...cards.map((card) =>
      card.id === opponent.signature ? deckCardRow(card, signatureNote) : deckCardRow(card)
    )
  );

  fold.append(toggle, list);
  return fold;
}

/**
 * One opponent's deck fold in the picker, out of the options built once at load:
 * what both the page and the state read to say whether that deck is open.
 */
function opponentDeckFoldFor(opponentId) {
  // An id no option answers to is a caller's mistake rather than a page fault,
  // so it is escaped rather than left to break the selector.
  const option = opponentOptions?.querySelector(`[data-opponent-id="${CSS.escape(String(opponentId))}"]`);
  return option?.querySelector("details.opponent-deck-fold") ?? null;
}

/**
 * Write the chosen opponent into the picker and the note above it, and show them
 * only while the Play screen stands before a match. The options are built once
 * and only their checked state changes, so a radio a keyboard visitor is
 * standing on keeps its focus while the choice is made.
 */
function renderOpponentChoice() {
  if (opponentPicker) opponentPicker.hidden = !isBeforeMatch();
  // With a result on the board the note about the deck has had its say: the
  // picker alone stands above the board, to choose who the next match is against.
  if (matchIntroLine) matchIntroLine.hidden = Boolean(state.match);
  for (const option of opponentOptions?.querySelectorAll(".opponent-option") ?? []) {
    const radio = option.querySelector("input");
    if (radio) radio.checked = radio.value === state.opponentId;
    // The record line is written on every draw, so a result that has just moved
    // it is read from the picker the moment the player looks back at it.
    const record = option.querySelector(".opponent-record");
    if (record) writeOpponentRecord(record, option.dataset.opponentId);
    // The signature mark is refreshed in the same breath: beating an opponent
    // takes their card off offer, and the deck must not keep promising it.
    const mark = option.querySelector(".signature-note");
    if (mark) {
      const opponent = OPPONENTS.find((entry) => entry.id === option.dataset.opponentId);
      if (opponent) mark.textContent = signatureMarkText(isSignatureEarned(opponent));
    }
  }
  const opponent = selectedOpponent();
  if (matchIntroOpponent) matchIntroOpponent.textContent = opponent.name;
  if (matchIntroDeck) matchIntroDeck.textContent = opponent.description.toLowerCase();
}

/**
 * The Play screen's how-a-match-works strip: the four points open or fold with
 * `state.rulesOpen` — open for a player who has not finished a match, folded
 * once they have, with the one control still naming what it does.
 */
function renderMatchRules() {
  if (!matchRulesSection) return;
  // The strip belongs to standing before a match: once one has been dealt, and
  // while its result is on the board, the strip goes with the note so the only
  // things left to press are the ways on. A player who opens the Play screen
  // again after a finished match meets the strip folded rather than gone.
  matchRulesSection.hidden = Boolean(state.match);
  if (matchRulesPoints) matchRulesPoints.hidden = !state.rulesOpen;
  if (matchRulesToggle) {
    matchRulesToggle.setAttribute("aria-expanded", String(state.rulesOpen));
    matchRulesToggle.textContent = state.rulesOpen ? "Hide rules" : "Show rules";
  }
}

/**
 * Whose turn it is, in the board's words: the player is "Your turn", the
 * opponent is named, so a player waiting on a turn that is not theirs can see
 * who it is waiting on rather than guess.
 */
export function turnLabel(turn, opponentName) {
  return turn === "player" ? "Your turn" : `${opponentName}'s turn`;
}

/**
 * Draw the match board: who the match is against, both heroes' health, the
 * player's energy, the hand, both tables and the log — all of it text, so a
 * sighted player, a screen reader and an agent read the same match. With no
 * match in progress the board is hidden and the opponent picker, the note about
 * the deck, the opponent it names and the Start match button stand in its place.
 * Once the match is over the hand, the End turn button and the Concede button go
 * with it and the result stands in their place, so there is nothing left to press.
 */
function renderMatch() {
  const match = state.match;
  if (matchBoard) matchBoard.hidden = !match;
  if (matchIntro) matchIntro.hidden = !isBeforeMatch();
  // Who is being faced is read from the picker's choice before a match, and from
  // the match itself once one is running — so a choice changes nothing about the
  // match already on the board.
  renderOpponentChoice();
  // A start that is waiting on the player's answer shows the two answers instead
  // of the button that asked, so the rail offers exactly one way on at a time.
  const startPending = state.startPending;
  if (startMatchButton) startMatchButton.hidden = Boolean(match) || startPending;
  if (continueSavedButton) continueSavedButton.hidden = !startPending;
  if (discardSavedButton) discardSavedButton.hidden = !startPending;
  // The pending choice carries two full-sentence answers, so on a phone they
  // stack instead of fighting for one row of the docked bar; the screen marks
  // itself so the layout knows the bar is taller for it.
  screens.get("play").dataset.startPending = String(startPending);
  if (endTurnButton) endTurnButton.hidden = !match || match.over || match.turn !== "player";
  // Whose move it is, said plainly for as long as the match runs: the log's last
  // line is a record of what happened, not a standing answer to "am I waiting on
  // the opponent or is the board waiting on me?". It goes with the match, so no
  // side is named a turn before one starts or after it ends.
  if (matchTurnStanding) matchTurnStanding.hidden = !match || match.over;
  if (matchTurn && match && !match.over) {
    const label = turnLabel(match.turn, match.opponentName);
    // Written only when it changes, so the live region speaks on the turn
    // passing rather than on every redraw of the board.
    if (matchTurn.textContent !== label) matchTurn.textContent = label;
  }
  // How much of this turn is still to come: the cards that will strike when the
  // turn is ended and the attack they hold, so the ending is planned rather than
  // guessed. It goes with the player's own turn, so no figure stands for a turn
  // nobody is taking — and nothing is said of a bare zero: an empty table and a
  // spent one are named in words instead.
  if (matchReadyStanding) {
    const readyTurn = Boolean(match) && !match.over && match.turn === "player";
    matchReadyStanding.hidden = !readyTurn;
    if (readyTurn && matchReady) {
      const { count, attack } = readyToStrike(match.player);
      matchReady.textContent =
        match.player.table.length === 0
          ? "No cards on the table"
          : count === 0
            ? "Every card has struck"
            : `${count} ${count === 1 ? "card" : "cards"} · ${attack} attack`;
    }
  }
  // Giving up is offered right up until a match is over, so a player who is
  // losing, or who picked the wrong deck, always has a way out that keeps the
  // record honest; once there is nothing left to give up, it goes with the hand.
  if (concedeButton) concedeButton.hidden = !match || match.over;
  renderMatchResult(match);
  renderMatchOpponentPortrait(match);
  // The one target an ending turn would strike, said in words: the opponent's
  // hero, once the table in front of it is empty. It names the hero because it
  // stands on the empty battlefield rather than beside the hero — and it goes
  // with the turn, while a card standing there carries the mark instead.
  if (matchOpponentStrikeTarget) {
    const heroTarget = endOfTurnTarget(match);
    const atHero = heroTarget?.kind === "hero";
    matchOpponentStrikeTarget.hidden = !atHero;
    if (atHero) {
      matchOpponentStrikeTarget.textContent = `Your end of turn strikes ${heroTarget.name}`;
    }
  }
  if (!match) {
    shownBoard = null;
    shownReactions = null;
    return;
  }

  if (matchOpponentName) matchOpponentName.textContent = `Opponent: ${match.opponentName}`;
  if (matchOpponentHealthLabel) matchOpponentHealthLabel.textContent = `${match.opponentName} health`;
  if (matchOpponentHandLabel) matchOpponentHandLabel.textContent = `${match.opponentName}'s hand`;
  if (matchOpponentEnergyLabel) matchOpponentEnergyLabel.textContent = `${match.opponentName}'s energy`;
  if (matchOpponentTableHeading) matchOpponentTableHeading.textContent = `${match.opponentName}'s table`;

  if (matchFields.playerHealth) matchFields.playerHealth.textContent = String(match.player.health);
  if (matchFields.opponentHealth) matchFields.opponentHealth.textContent = String(match.opponent.health);
  if (matchFields.energy) matchFields.energy.textContent = `${match.player.energy} of ${match.player.maxEnergy}`;
  if (matchFields.opponentHand) matchFields.opponentHand.textContent = String(match.opponent.hand.length);
  if (matchFields.opponentEnergy) {
    matchFields.opponentEnergy.textContent = `${match.opponent.energy} of ${match.opponent.maxEnergy}`;
  }
  if (matchFields.deckRemaining) matchFields.deckRemaining.textContent = String(match.player.deck.length);

  const canAttack = !match.over && match.turn === "player";
  // The blow this draw is showing is whatever changed since the last one, read
  // before the board is rebuilt so the fresh cards can carry it. The snapshot of
  // the board now drawn is kept for the next comparison.
  const reactions = reactionsToShow(shownBoard, match);
  renderMatchHand(match);
  renderCardPile(matchOpponentHandBacks, match.opponent.hand.length, "No cards in hand");
  renderCardPile(matchDeckStack, match.player.deck.length, "Deck empty");
  renderPlayerTable(match, canAttack, reactions);
  renderOpponentTable(match, canAttack, reactions);
  renderMatchLog(match);
  shownBoard = snapshotBoard(match);
  shownReactions = reactions;
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
 * The saved match the home screen offers to continue: the one read back from the
 * browser that is not the match already loaded and being played. A live match is
 * saved as it changes, so while it is loaded the record is that same match — the
 * game is in hand, and there is nothing to continue back into.
 */
function offerableSavedMatch() {
  const saved = state.savedMatch;
  if (!saved) return null;
  // The loaded match is the one on the board — finished or not, there is nothing
  // to continue back into. Only a match that is not the live one is offered.
  if (state.match && state.match.id === saved.id) return null;
  return saved;
}

/** The few numbers that say which match the home screen is offering to continue. */
function savedMatchSummary(saved) {
  if (!saved) return null;
  return {
    opponentName: saved.opponentName,
    turn: saved.turn,
    playerHealth: saved.player.health,
    opponentHealth: saved.opponent.health,
    logLength: saved.log.length,
  };
}

/**
 * Show or hide the home screen's offer to pick up the match that was left, with
 * the labels that say which match it is: who it is against, both heroes' health
 * and whose turn it is. With no saved match the whole section is hidden.
 */
function renderContinueOffer() {
  const saved = offerableSavedMatch();
  if (continueSection) continueSection.hidden = !saved;
  if (!saved) return;
  if (continueOpponent) continueOpponent.textContent = saved.opponentName;
  if (continuePlayerHealth) continuePlayerHealth.textContent = String(saved.player.health);
  if (continueOpponentHealth) continueOpponentHealth.textContent = String(saved.opponent.health);
  // A saved match always sits on the player's turn: the opponent takes its whole
  // turn inside one move, so a save is never taken mid-turn.
  if (continueTurn) continueTurn.textContent = "You";
}

/**
 * Write the match in progress to the browser, or clear the record once it is
 * over, so the home screen can offer exactly the match a player could still pick
 * up — and no finished one. A browser that refuses the write leaves nothing to
 * offer, rather than an offer that cannot be kept.
 */
function persistMatch() {
  const match = state.match;
  if (!match || match.over) {
    clearSavedMatch();
    state.savedMatch = null;
    return;
  }
  state.savedMatch = saveMatch(match) ? match : null;
}

/**
 * Re-read the saved match from the browser and redraw the offer — the state a
 * page freshly opened finds itself in. Exported so the page's own checks can put
 * the offer back in step with storage after writing a match to it directly.
 */
export function refreshSavedMatch() {
  state.savedMatch = readSavedMatch();
  render();
  return readState();
}

/**
 * Ask what to do about the unfinished match that is waiting, rather than throw
 * it away: a plain question in the match's own status line, the two controls
 * that answer it in the same rail, and focus on the one that keeps the match.
 * Nothing is dealt or saved until the player answers.
 */
function askToReplaceSavedMatch(waiting) {
  state.startPending = true;
  state.screen = "play";
  setMatchMessage(
    `You have an unfinished match against ${waiting.opponentName}. Continue it, or discard it and start a new one.`
  );
  render();
  continueSavedButton?.focus();
  return readState();
}

/**
 * Start a match from the saved deck, against the opponent named by `opponentId`
 * — the one picked in the Play screen's picker unless another is named. What a
 * visitor does by pressing Start match, and what the start-match tool does on
 * their behalf. Refused, with the reason, when the deck holds fewer cards than a
 * match needs or the opponent is not one this game has.
 *
 * An unfinished match saved from a page left behind is never overwritten by
 * accident: starting while one is waiting, with no confirmed discard, deals
 * nothing and instead asks the player to continue that match or discard it,
 * returning the state with `startConflict` naming what is waiting. Only
 * `discardSaved: true` — what Discard and start new does — deals and saves the
 * new match in its place. Opens the Play screen and returns the state.
 */
export function startMatch(opponentId = state.opponentId, { discardSaved = false, rng } = {}) {
  const waiting = offerableSavedMatch();
  if (waiting && !discardSaved) {
    return askToReplaceSavedMatch(waiting);
  }

  state.startPending = false;
  // `rng` is for the product's own self-checks, which deal a known match from a
  // fixed shuffle; a visitor's match leaves it undefined and the engine uses
  // Math.random as it always has.
  state.match = createMatch(state.deck, { opponentId, rng });
  // The picker follows the match that was actually dealt, so a refused start
  // leaves the choice where it was.
  state.opponentId = state.match.opponentId;
  // The last result goes with the match it belonged to, and the mark it put on
  // the collection goes with it — the new match has earned nothing yet.
  state.result = null;
  state.screen = "play";
  state.selectedAttacker = null;
  setMatchMessage("");
  persistMatch();
  render();
  renderCollection();
  return readState();
}

/**
 * Throw away the unfinished match that is waiting and deal a fresh one in its
 * place — what a visitor does by pressing Discard and start new on the choice,
 * and what the discard-saved-match tool does on their behalf. It is `startMatch`
 * with the discarding confirmed, so it is the only way a waiting match is ever
 * replaced. Returns the state afterwards.
 */
export function discardSavedMatch(opponentId = state.opponentId) {
  return startMatch(opponentId, { discardSaved: true });
}

/**
 * Choose which opponent the next match is against — what a visitor does by
 * picking one in the Play screen's picker, and what the choose-opponent tool does
 * on their behalf. The choice belongs to the page rather than to a match, so a
 * match already running keeps the opponent it was started against, and an
 * unfinished match picked up later still faces it. Refused, with the reason, when
 * the id names no opponent this game has. Returns the state afterwards.
 */
export function selectOpponent(opponentId) {
  if (!OPPONENTS.some((opponent) => opponent.id === opponentId)) {
    const known = OPPONENTS.map((opponent) => opponent.id).join(", ");
    throw new Error(`there is no opponent called "${opponentId}" to face — pick one of: ${known}`);
  }
  state.opponentId = opponentId;
  render();
  return readState();
}

/**
 * Open or fold away one opponent's deck in the picker — what a visitor does by
 * pressing that character's "Their deck" line, and what the toggle-opponent-deck
 * tool does on their behalf. It only changes what the picker shows, never who the
 * next match is against. Returns the state afterwards, the same shape readState()
 * gives.
 */
export function toggleOpponentDeck(opponentId) {
  const fold = opponentDeckFoldFor(opponentId);
  if (!fold) {
    const known = OPPONENTS.map((opponent) => opponent.id).join(", ");
    throw new Error(`there is no opponent called "${opponentId}" to show the deck of — pick one of: ${known}`);
  }
  fold.open = !fold.open;
  return readState();
}

/**
 * Fold away or open the Play screen's how-a-match-works strip — what a visitor
 * does by pressing its "Show rules"/"Hide rules" button, and what the
 * toggle-match-rules tool does on their behalf. The fold belongs to the page,
 * not to a match: folding it hides the points and says so to a screen reader,
 * and a player who has finished a match opens folded. Returns the state
 * afterwards, the same shape readState() gives.
 */
export function toggleMatchRules() {
  state.rulesOpen = !state.rulesOpen;
  render();
  return readState();
}

/**
 * Open or fold away the Collection screen's save-and-restore section — what a
 * visitor does by pressing its "Show save and restore"/"Hide save and restore"
 * button, and what the toggle-save-restore tool does on their behalf. Opening
 * it only shows the save code and restore controls; folding it hides them and
 * says so to a screen reader. Returns the state afterwards, the same shape
 * readState() gives.
 */
export function toggleSaveRestore() {
  state.saveRestoreOpen = !state.saveRestoreOpen;
  render();
  return readState();
}

/**
 * Choose which cards the Collection screen's set list shows — what a visitor
 * does by pressing the "All cards", "Still to collect", "Acts when played",
 * "Mends your hero", "Draws a card", "Acts when they fall", "Grows each turn"
 * or "Acts twice" button, and what the set-collection-view tool does on their
 * behalf. It only changes what the list shows: the collection and the deck are
 * untouched.
 * Refused, with the reason, when the view is not one of COLLECTION_VIEWS.
 * Returns the state afterwards, the same shape readState() gives.
 */
export function setCollectionView(view) {
  if (!COLLECTION_VIEWS.includes(view)) {
    throw new Error(`there is no "${view}" view of the collection to show — pick one of: ${COLLECTION_VIEWS.join(", ")}`);
  }
  state.collectionView = view;
  renderCollection();
  return readState();
}

/**
 * Choose how the Collection screen's set list is read — what a visitor does by
 * pressing the "Catalog order" or "By cost" button, and what the
 * set-collection-order tool does on their behalf. "catalog" keeps the game's
 * own order, "cost" reads the same cards cheapest first. It only changes how
 * the list is read: the collection and the deck are untouched. Refused, with
 * the reason, when the order names neither "catalog" nor "cost". Returns the
 * state afterwards, the same shape readState() gives.
 */
export function setCollectionOrder(order) {
  if (!COLLECTION_ORDERS.includes(order)) {
    throw new Error(`there is no "${order}" order for the collection to show — pick one of: ${COLLECTION_ORDERS.join(", ")}`);
  }
  state.collectionOrder = order;
  renderCollection();
  return readState();
}

/**
 * The whole game as one save code, with whether the code is on screen right now
 * — what the get-save-code tool returns, and what the page's own box holds. The
 * code is always present, whether the panel is open or not, because it is
 * derived from the save rather than from the panel. It is read-only: reading it
 * changes nothing.
 */
export function readSaveCode() {
  return { code: saveCode(), shown: state.saveCodeShown };
}

/**
 * Open or close the Collection screen's save code — what a visitor does by
 * pressing "Show save code" or "Hide save code", and what the
 * set-save-code-shown tool does on their behalf. Revealing fills the box with a
 * freshly derived code; hiding clears the words that were about it. Either way
 * only the panel and those words change, so the collection, the deck and the
 * record are exactly as they were. Returns `{ code, shown }` afterwards.
 */
export function setSaveCodeShown(shown) {
  state.saveCodeShown = Boolean(shown);
  // Revealing the code is pointless while the section holding it is folded, so
  // asking for it open also opens the fold; hiding the code leaves the fold as
  // the player left it.
  if (state.saveCodeShown) state.saveRestoreOpen = true;
  saveCodeMessage = state.saveCodeShown
    ? "Your save code is on screen — copy it, or select it by hand."
    : "";
  renderSaveRestore();
  renderSaveCode();
  return readSaveCode();
}

/**
 * Put the save code on the clipboard — what pressing "Copy save code" does. The
 * clipboard may be missing or refused, so a failed copy selects the code in its
 * box instead and says so in words, rather than the player being told it worked
 * when it did not. Returns the words the status line now shows.
 */
async function copySaveCode() {
  let copied = false;
  try {
    await navigator.clipboard.writeText(saveCode());
    copied = true;
  } catch {
    copied = false;
  }

  if (copied) {
    saveCodeMessage = "Save code copied to the clipboard.";
  } else {
    // Selecting the code is the fallback the clipboard failure leaves: it is
    // already selectable by hand, and this puts it in reach of one more press.
    saveCodeText?.focus();
    saveCodeText?.select();
    saveCodeMessage = "Couldn't copy automatically — the save code is selected, copy it by hand.";
  }
  renderSaveCode();
  return saveCodeMessage;
}

/**
 * Read a pasted save code and ask before it replaces anything — what a visitor
 * does by pasting a code and pressing "Restore save code". A code that is not
 * ours, or is damaged, is refused here with the reason in the status line and
 * nothing touched; a code that is ours leaves the game exactly as it was and
 * puts the question on screen instead, holding `{ code, summary }` until the
 * player answers. No write of any kind happens on this path, so a paste by
 * accident cannot wipe a game. Returns whether a question is now on screen.
 */
function requestRestoreSaveCode(code) {
  const checked = checkSaveCode(code);
  state.restorePending = checked.ok ? { code: code.trim(), summary: checked.summary } : null;
  state.restoreMessage = checked.ok ? "" : `${checked.reason} Nothing was changed.`;
  renderRestore();
  return checked.ok;
}

/**
 * Answer no to a waiting restore: the question goes, the pasted code is
 * forgotten and the game stays exactly as it is.
 */
function cancelRestoreSaveCode() {
  state.restorePending = null;
  state.restoreMessage = "Nothing was changed — your game is exactly as it was.";
  renderRestore();
}

/**
 * Answer yes: put the game the code carries back, replacing the collection, the
 * deck and the record as one — what pressing "Replace my game" does, and what
 * the restore-save-code tool does on a caller's behalf. The code is judged
 * again here, so a call that skips the question cannot slip a bad code past it.
 * The restored game is adopted whole — the counts, the deck, the record and the
 * rules strip, exactly as a freshly opened page would read it — and everything
 * that belonged to the game being replaced goes with it: the match in progress,
 * the unfinished match saved beside it, a start waiting on an answer and the
 * last result. The home and Collection screens are redrawn from the restored
 * game so both show its cards and numbers. Returns the state afterwards; a
 * refused code throws the plain reason and leaves storage untouched.
 */
export function restoreSaveCode(code) {
  const result = restoreGameCode(code);
  if (!result.ok) {
    state.restorePending = null;
    state.restoreMessage = `${result.reason} Nothing was changed.`;
    renderRestore();
    throw new Error(state.restoreMessage);
  }

  const opened = loadGame();
  state.cards = opened.cards;
  state.cardsOwned = collectionSize(opened.cards);
  state.distinctCards = opened.cards.length;
  state.deck = opened.deck;
  state.saved = opened.saved;
  state.wins = opened.wins;
  state.matchesPlayed = opened.matches;
  state.opponentsRecord = opened.opponents;
  state.rulesOpen = opened.matches === 0;
  // The board, the result it left and the unfinished match saved beside it
  // belonged to the game being replaced, so they go with it rather than sitting
  // over a record they no longer describe.
  state.match = null;
  state.savedMatch = null;
  state.startPending = false;
  state.result = null;
  state.selectedAttacker = null;
  state.restorePending = null;
  state.restoreMessage =
    `Your game was restored: ${result.summary.cards} cards, a deck of ${result.summary.deck}, ` +
    `${result.summary.wins} ${result.summary.wins === 1 ? "win" : "wins"} in ` +
    `${result.summary.matches} ${result.summary.matches === 1 ? "match" : "matches"}.`;

  render();
  renderCollection();
  return readState();
}

/**
 * What pressing "Replace my game" does: apply the code the player was just asked
 * about. The confirmation only exists while one is waiting, so a press with
 * nothing pending says so rather than doing nothing at all.
 */
function confirmRestoreSaveCode() {
  const pending = state.restorePending;
  if (!pending) {
    state.restoreMessage = 'Paste a save code and press "Restore save code" first.';
    renderRestore();
    return;
  }
  try {
    restoreSaveCode(pending.code);
  } catch {
    // The refusal is already in the status line, in plain words, so the press
    // has nothing to add to it.
  }
  // The control that was pressed is gone with the question, so the keyboard is
  // left on the one that is still there.
  restoreCodeButton?.focus();
}

/**
 * Pick up the match that was left: set it running again from the saved record —
 * both sides' health, energy, hands, tables, decks and the log exactly as they
 * were, on the same side's turn — open the Play screen and return the state.
 * Refused, with the reason, when there is no unfinished match to continue.
 */
export function continueMatch() {
  const saved = offerableSavedMatch();
  if (!saved) {
    throw new Error("there is no unfinished match to continue — start a new one");
  }
  state.match = saved;
  state.result = null;
  state.screen = "play";
  state.selectedAttacker = null;
  // Continuing is one answer to the choice a Start match raised; the question
  // goes with the match that answers it.
  state.startPending = false;
  setMatchMessage("");
  render();
  // The result of the match left behind goes with it, and so does the mark it
  // put on the collection.
  renderCollection();
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

  const record = recordResult(match.outcome, match.id, undefined, match.opponentId);
  state.cards = record.cards;
  state.cardsOwned = collectionSize(record.cards);
  state.distinctCards = record.cards.length;
  state.wins = record.wins;
  state.matchesPlayed = record.matches;
  state.opponentsRecord = record.opponents;
  // The newcomer's strip has had its say: a returning player opens it folded.
  state.rulesOpen = false;
  state.saved = record.saved;
  state.result = {
    outcome: match.outcome,
    awarded: record.awarded,
    setComplete: record.setComplete,
    // Whether this win was the player's first against this opponent, so the
    // result can say so where the win happened.
    firstWin: record.firstWin,
  };
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
  persistMatch();
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
  persistMatch();
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
  persistMatch();
  render();
  return readState();
}

/**
 * Give up the match in front of you — what a visitor does by pressing Concede,
 * and what the concede-match tool does on their behalf. The match ends at once
 * as a loss, recorded through the same path a finished one takes, so it counts
 * as a match played, not a win, and earns no card; the saved match is cleared
 * with it, so the abandoned game is never offered to continue, and the result
 * stays on the board with Play again beside it. Refused, with the reason, when
 * no match is in progress or it is already over. Returns the state afterwards.
 */
export function concedeMatch() {
  if (!state.match) throw new Error("no match is in progress — start one first");
  concede(state.match);
  state.selectedAttacker = null;
  finishMatch();
  persistMatch();
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
 * yet is marked as not collected and offers no way into a deck. The card the most
 * recent win added is marked as newly collected, in words as well as in the
 * styling, so it is found again among the set it has just joined.
 */
function collectionCardRow(card) {
  const item = document.createElement("li");
  item.className = card.owned ? "owned-card" : "unowned-card";
  item.dataset.cardId = card.id;

  // What the last win added, marked where the set is listed: a player who has
  // just earned a card comes back to the collection to find it, and the result
  // that named it is a screen away.
  const isNewlyCollected = card.id === newlyCollectedId(state.result);
  if (isNewlyCollected) item.classList.add("newly-collected");

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

  // A signature card stands for the opponent it is won from, and is won only by
  // beating them, so its row names them — a player browsing the set reads who
  // to beat for a card they are still missing rather than having to guess.
  if (card.signatureOf) head.append(signatureNote(`${card.signatureOf.name}'s signature`));

  // The card the last win added says so beside its own name, in the row the set
  // is read card by card — a word, so the mark is never a colour alone.
  if (isNewlyCollected) head.append(newlyCollectedNote());

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
  const ability = cardAbilityNote(card);
  if (ability) item.append(ability);
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

/**
 * What marks the card the most recent win added, read in words beside the card's
 * own name: the styling adds the look, and the word is what a screen reader and
 * an agent read, so the mark never rests on telling colours apart.
 */
function newlyCollectedNote() {
  const note = document.createElement("span");
  note.className = "newly-collected-note";
  note.textContent = "Newly collected";
  return note;
}

/**
 * What an opponent's signature card is marked with wherever it is listed — the
 * character it stands for in the collection, the promise a first win earns it in
 * the picker's deck fold. The words carry the mark; the styling only frames it.
 */
function signatureNote(text) {
  const note = document.createElement("span");
  note.className = "signature-note";
  note.textContent = text;
  return note;
}

/** One card in the deck, shown as its picture and read as its name and three
 * numbers, so the deck reads as a hand of cards. `note`, when given, is the mark
 * an opponent's signature card carries in the picker's deck fold. */
function deckCardRow(card, note) {
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
  if (note) item.append(signatureNote(note));
  const ability = cardAbilityNote(card);
  if (ability) item.append(ability);
  return item;
}

// What each view of the set list says it is showing: the words a screen reader
// hears for the list, and the note it prints when the view has nothing to list.
// Written once per view, so a view's label and its empty note always describe
// the same cards.
export const COLLECTION_VIEW_TEXT = {
  all: {
    label: "Every card in the game, with the cards in your collection marked",
    empty: "You have collected every card in the game.",
  },
  missing: {
    label: "Cards in the game not collected yet",
    empty: "You have collected every card in the game.",
  },
  abilities: {
    label: "Cards in the game that act when played",
    empty: "No card in the game acts when played.",
  },
  mends: {
    label: "Cards in the game that mend your hero when played",
    empty: "No card in the game mends your hero when played.",
  },
  draws: {
    label: "Cards in the game that draw you a card",
    empty: "No card in the game draws you a card.",
  },
  falls: {
    label: "Cards in the game that act when they fall",
    empty: "No card in the game acts when it falls.",
  },
  grows: {
    label: "Cards in the game that grow while they stay",
    empty: "No card in the game grows while it stays.",
  },
  twice: {
    label: "Cards in the game that act twice, carrying more than one ability",
    empty: "No card in the game carries two abilities, so none acts twice.",
  },
};

/**
 * Whether a card belongs in the view the set list is showing: every card in
 * "all", the ones not collected yet in "missing", the ones whose face does
 * something the moment it is played in "abilities", the ones whose face mends
 * your hero when it is played in "mends", the ones whose face draws you a card
 * — whether at play or at fall — in "draws", the ones whose face does something
 * the moment it leaves the table in "falls", the ones that grow while they
 * stay in "grows", and the ones whose face carries more than one ability — so
 * it acts at more than one moment — in "twice". A card that heals only as it
 * falls is not in "mends": the view is for the mending you play, not the
 * mending a trade pays back.
 */
/**
 * Whether a card acts twice: more than one of the three moments a face can act
 * at — it is played, it stays, it falls — has text written for it. One shared
 * predicate, so the Collection screen's "twice" view and the deck's "Acts twice"
 * count can never disagree.
 */
function actsTwice(card) {
  return [card.ability, card.growthAbility, card.fallAbility].filter((ability) => ability !== null).length >= 2;
}

function isInCollectionView(card) {
  if (state.collectionView === "missing") return !card.owned;
  if (state.collectionView === "abilities") return card.ability !== null;
  if (state.collectionView === "mends") return card.ability === HEAL_ON_PLAY;
  if (state.collectionView === "draws") return drawsACard(card);
  if (state.collectionView === "falls") return card.fallAbility !== null;
  if (state.collectionView === "grows") return card.growthAbility !== null;
  if (state.collectionView === "twice") return actsTwice(card);
  return true;
}

/**
 * The cards the active view lists, before any order is applied — the one
 * filtered list the drawn rows and the view's own "collected" count both read,
 * so the count under the buttons can never disagree with the cards above it.
 */
function collectionViewCards() {
  return listAllCards(state.cards).filter(isInCollectionView);
}

/**
 * Draw the card set: every card in the game — the ones the player holds with
 * their deck controls, and the ones they do not yet with a note saying so — or,
 * in the "missing" view, only the cards not collected yet, so a player working
 * toward a full set can hide what they already have, or, in the "abilities"
 * view, only the cards whose face carries a when-played ability, in the "mends"
 * view, only those that mend your hero when played, in the "draws" view, only
 * those whose face draws you a card whether at play or at fall, in the "falls"
 * view, only those carrying a fall ability, in the "grows" view, only those that grow
 * while they stay, or, in the "twice" view, only those that carry more than one
 * ability and so act at more than one moment, so any ability can be chosen for
 * on purpose. When a view has nothing to list, it says so rather than reading as
 * an empty set.
 */
function renderCollectionCards() {
  const list = document.getElementById("collection-list");
  if (!list) return;

  const view = COLLECTION_VIEW_TEXT[state.collectionView];
  const catalogCards = listAllCards(state.cards);
  const catalogIndexById = new Map(catalogCards.map((card, index) => [card.id, index]));
  const shown = collectionViewCards();
  // Catalog order is the default reading; "cost" reorders a copy of the same
  // cards cheapest-first, ties left in catalog order so the list reads the same
  // every time. It changes nothing about the collection or the deck.
  const cards =
    state.collectionOrder === "cost"
      ? [...shown].sort((a, b) => a.cost - b.cost || catalogIndexById.get(a.id) - catalogIndexById.get(b.id))
      : shown;

  // The list names what it is showing, so a screen reader hears the same view
  // the buttons say is selected.
  list.setAttribute("aria-label", view.label);

  // The views built around an ability say how much of what they list is already
  // held, so a player building around it sees how close they are to the rest.
  // The whole-set and still-to-collect views leave that to the standing above
  // the list, and keep this line hidden.
  const viewCount = document.getElementById("collection-view-count");
  if (viewCount) {
    const showsViewCount = state.collectionView !== "all" && state.collectionView !== "missing";
    viewCount.hidden = !showsViewCount;
    viewCount.textContent = showsViewCount
      ? `${shown.filter((card) => card.owned).length} of ${shown.length} collected`
      : "";
  }

  if (!cards.length) {
    const empty = document.createElement("li");
    empty.className = "collection-empty";
    empty.textContent = view.empty;
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...cards.map(collectionCardRow));
}

/**
 * Mark which of the set's view buttons is pressed, so the view on screen is read
 * without relying on colour: the word and `aria-pressed` carry the fact.
 */
function renderCollectionView() {
  for (const button of collectionViewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.collectionView === state.collectionView));
  }
}

/**
 * Mark which of the set's order buttons is pressed, so the order on screen is
 * read without relying on colour: the word and `aria-pressed` carry the fact.
 */
function renderCollectionOrder() {
  for (const button of collectionOrderButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.collectionOrder === state.collectionOrder));
  }
}

/** Draw the deck's current contents, each card as a face that shows its picture
 * and reads its name and numbers, and its cost curve under them. */
function renderDeck() {
  const list = document.getElementById("deck-list");
  if (!list) return;

  const cards = listDeckCards(state.deck);
  if (!cards.length) {
    const empty = document.createElement("li");
    empty.className = "deck-empty";
    empty.textContent = "No cards in your deck yet.";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...cards.map(deckCardRow));
  }

  renderDeckCurve();
}

/**
 * The deck's shape as a cost curve: one row for each energy cost the deck holds,
 * saying the cost and how many of the deck's cards are at it, cheapest first.
 * Derived from the same cards the deck panel draws, so the curve and the deck
 * can never disagree.
 */
function deckCostCurve() {
  const countsByCost = new Map();
  for (const card of listDeckCards(state.deck)) {
    countsByCost.set(card.cost, (countsByCost.get(card.cost) ?? 0) + 1);
  }
  return [...countsByCost.entries()]
    .sort(([costA], [costB]) => costA - costB)
    .map(([cost, count]) => ({ cost, count }));
}

/**
 * The deck's strength as two sums — the attack it brings and the health it can
 * absorb — beside how many of its cards act when played, how many act when they
 * fall, how many mend your hero, how many grow each turn and how many act twice,
 * over the same cards the deck panel draws, so the totals and the deck can never
 * disagree. Null for an empty deck, so nothing is shown where there is nothing to
 * total.
 */
function deckTotals() {
  const cards = listDeckCards(state.deck);
  if (!cards.length) return null;
  return cards.reduce(
    (totals, card) => ({
      attack: totals.attack + card.attack,
      health: totals.health + card.health,
      whenPlayed: totals.whenPlayed + (card.ability ? 1 : 0),
      whenFalls: totals.whenFalls + (card.fallAbility ? 1 : 0),
      // The same when-played-heal predicate the Collection screen's "mends"
      // view filters by, so the count and that view can never disagree.
      mends: totals.mends + (card.ability === HEAL_ON_PLAY ? 1 : 0),
      grows: totals.grows + (card.growthAbility ? 1 : 0),
      // The same two-ability predicate the Collection screen's "twice" view
      // filters by, so the count and that view can never disagree.
      twice: totals.twice + (actsTwice(card) ? 1 : 0),
    }),
    { attack: 0, health: 0, whenPlayed: 0, whenFalls: 0, mends: 0, grows: 0, twice: 0 }
  );
}

/** One row of the cost curve: the cost it is at, and how many of the deck's cards have it. */
function deckCurveRow({ cost, count }) {
  const item = document.createElement("li");
  item.className = "deck-curve-row";
  item.dataset.cost = String(cost);

  const costLabel = document.createElement("span");
  costLabel.className = "deck-curve-cost";
  costLabel.textContent = `Cost ${cost}`;

  const countLabel = document.createElement("span");
  countLabel.className = "deck-curve-count";
  countLabel.textContent = count === 1 ? "1 card" : `${count} cards`;

  // A real space between the labels, so the row reads "Cost 2 3 cards" rather
  // than running the numbers together as "Cost 23 cards". Layout drops a
  // whitespace-only text run between flex items, so only the two labels show.
  item.append(costLabel, document.createTextNode(" "), countLabel);
  return item;
}

/**
 * Draw the deck's cost curve under its cards. The whole block, heading and all,
 * is hidden for a deck holding no cards, so an empty deck shows only its own
 * empty note and there is no curve to read.
 */
function renderDeckCurve() {
  const block = document.getElementById("deck-curve");
  if (!block) return;

  const rows = deckCostCurve();
  const totals = deckTotals();
  block.hidden = rows.length === 0;

  const list = document.getElementById("deck-curve-list");
  if (list) list.replaceChildren(...rows.map(deckCurveRow));

  // The totals are shown beside the curve, in the same block that hides for an
  // empty deck, so an empty deck still reads only its own empty note.
  const attack = document.getElementById("deck-total-attack");
  const health = document.getElementById("deck-total-health");
  const whenPlayed = document.getElementById("deck-total-when-played");
  const mends = document.getElementById("deck-total-mends");
  const whenFalls = document.getElementById("deck-total-when-falls");
  const grows = document.getElementById("deck-total-grows");
  const twice = document.getElementById("deck-total-twice");
  if (attack) attack.textContent = totals ? String(totals.attack) : "";
  if (health) health.textContent = totals ? String(totals.health) : "";
  if (whenPlayed) whenPlayed.textContent = totals ? String(totals.whenPlayed) : "";
  if (mends) mends.textContent = totals ? String(totals.mends) : "";
  if (whenFalls) whenFalls.textContent = totals ? String(totals.whenFalls) : "";
  if (grows) grows.textContent = totals ? String(totals.grows) : "";
  if (twice) twice.textContent = totals ? String(totals.twice) : "";
}

/** Draw the whole Collection screen: the card set, which view it is in, and the deck beside it. */
function renderCollection() {
  renderCollectionCards();
  renderCollectionView();
  renderCollectionOrder();
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
 * the player owns and how many are different out of the whole set, how many
 * opponents have been beaten at least once out of every character there is
 * (`opponentsBeaten` of `opponentsTotal` — the second goal beside the set, rising
 * on a first win against a character and holding on a repeat), the deck — its
 * size, its limit, the fewest cards a match needs, the cards themselves, its
 * `deckCurve` shape (one `{ cost, count }` per energy cost the deck holds) and
 * its strength as two sums (`deckAttack` and `deckHealth`) beside how many of
 * its cards act when played (`deckWhenPlayed`), how many mend your hero
 * (`deckMends`), how many act when they fall (`deckWhenFalls`), how many
 * grow each turn (`deckGrows`) and how many act twice, carrying more than one
 * ability (`deckTwice`) — all seven null
 * for an empty deck — whether it will survive closing the page, how many matches have
 * been played and won, the result of the last finished match (whether it was a win or a loss, the
 * card a win awarded, whether that completed the set, and `firstWin` — whether
 * that win was the player's first against that opponent), which card the
 * Collection screen marks as newly collected (`newlyCollected` — the id of the
 * card the last win added to the collection, or null when nothing was newly
 * earned: no result yet, a loss, or a win whose only card was a duplicate), the
 * card the next win would add (`nextReward`, with `nextRewardComplete` true once
 * every reward card is owned), whether the Collection screen's save-and-restore
 * section is open (`saveRestoreShown`, the fold holding both the save code and
 * the restore controls, the same fact its "Show save and restore"/"Hide save and
 * restore" button carries — the toggle-save-restore tool flips it), whether the
 * Collection screen's save-code panel is open (`saveCodeShown`, the same fact
 * the "Show save code"/"Hide save code" button carries — the get-save-code tool
 * returns the code itself),
 * whether the Collection screen is waiting on the player's answer about a pasted
 * save code before it replaces the game (`restorePending`) and what its restore
 * status line says (`restoreMessage` — why a code was refused, or what a
 * finished restore replaced),
 * the four points the Play screen tells a newcomer about a match and
 * whether that strip is showing
 * (`matchRules`), the opponents a match can be fought against (`opponents` — each
 * with the id to start a match with, its name, its look, the kind of deck it
 * brings, the `deck` of card ids it is dealt, whose cards list-collection names
 * the costs and numbers of, whether that deck's cards are open in the picker,
 * `deckShown`, and `record` — the `wins` and `matches` held against that
 * opponent and whether they have been `beaten`, as the picker's own record line
 * reads it) and which of them the next match would be against
 * (`selectedOpponentId`), the match the home screen offers to continue
 * (`canContinue` and the `savedMatch` summary of an unfinished game left in the
 * browser), the choice a Start match is waiting on rather than throwing that
 * match away (`startConflict` — null unless a start is pending, and otherwise a
 * `reason` naming the waiting opponent beside the same `savedMatch` summary), and
 * the actions they can take from here. This is what the get-state tool returns.
 */
export function readState() {
  const nextReward = nextRewardCard();
  const deckTotal = deckTotals();

  // Only the actions a visitor can actually reach: a control this screen hides
  // — on its own or inside a hidden section — is not something they can press,
  // so an agent should not be told it can.
  const actions = [...screens.get(state.screen).querySelectorAll("button")]
    .filter((button) => !button.hidden && !button.closest("[hidden]"))
    .map((button) => button.textContent.trim());

  const offerable = offerableSavedMatch();

  // The conflict is only standing while a start is actually waiting on it, so a
  // caller that has not asked to start anything reads null here and uses
  // `canContinue`/`savedMatch` for the match merely on offer.
  const startConflict =
    state.startPending && offerable
      ? {
          reason:
            `An unfinished match against ${offerable.opponentName} is saved. Continue it, ` +
            "or discard it and start a new one.",
          savedMatch: savedMatchSummary(offerable),
        }
      : null;

  return {
    screen: state.screen,
    cardsOwned: state.cardsOwned,
    distinctCards: state.distinctCards,
    setTotal: state.setTotal,
    // The second goal beside the set: how many opponents the player has beaten
    // at least once (`opponentsBeaten`), out of every character a match can be
    // against (`opponentsTotal`) — the same figure the home screen prints under
    // "Opponents beaten", read from the per-opponent records below.
    opponentsBeaten: opponentsBeatenCount(),
    opponentsTotal: OPPONENTS.length,
    // Which cards the Collection screen's set list is showing: "all", "missing",
    // "abilities", "mends", "falls", "grows" or "twice".
    collectionView: state.collectionView,
    // How that list is read: "catalog" for the game's own order, "cost" cheapest first.
    collectionOrder: state.collectionOrder,
    // Whether the Collection screen's save-and-restore section is open right
    // now — the fold holding both the save code and the restore controls, the
    // same fact the "Show save and restore"/"Hide save and restore" button's
    // label carries. The toggle-save-restore tool flips it.
    saveRestoreShown: state.saveRestoreOpen,
    // Whether the Collection screen's save-code panel is open right now, so a
    // caller reads the same fact the "Show save code"/"Hide save code" button's
    // label carries. The get-save-code tool returns the code itself.
    saveCodeShown: state.saveCodeShown,
    // Whether the Collection screen is waiting on the player's answer about a
    // pasted save code before it replaces the game, and the words the restore
    // control's status line carries — the refusal of a code that is not ours, or
    // what a finished restore replaced. `restorePending` true is what the two
    // "Replace my game"/"Cancel" buttons are on screen for; the restore-save-code
    // tool applies a code without waiting on an answer.
    restorePending: state.restorePending !== null,
    restoreMessage: state.restoreMessage,
    deckSize: state.deck.length,
    deckLimit: state.deckLimit,
    minimumDeckSize: state.minimumDeckSize,
    deck: listDeckCards(state.deck),
    // The deck's shape as a cost curve: one row per energy cost it holds, each
    // saying the cost and how many of the deck's cards are at it, cheapest first
    // — the same rows the Collection screen draws under the deck. Empty for an
    // empty deck, matching the note the screen shows instead of a curve.
    deckCurve: deckCostCurve(),
    // The deck's strength as two sums: the attack it brings (`deckAttack`) and
    // the health it can absorb (`deckHealth`), over the same cards the deck panel
    // draws and shown beside its cost curve. Beside them, how many of the deck's
    // cards act when played (`deckWhenPlayed`), how many mend your hero
    // (`deckMends`) — the same "Mends your hero" count the panel prints, so a
    // player building a deck that stays alive sees its shape as it is built — how
    // many act when they fall (`deckWhenFalls`), how many grow each turn
    // (`deckGrows`) and how many act twice, carrying more than one ability
    // (`deckTwice`) — the same "Acts twice" count the panel prints, so a player
    // building around two-ability cards sees that deck taking shape. All seven
    // are null for an empty deck, matching the note the screen shows instead of
    // totals of zero.
    deckAttack: deckTotal ? deckTotal.attack : null,
    deckHealth: deckTotal ? deckTotal.health : null,
    deckWhenPlayed: deckTotal ? deckTotal.whenPlayed : null,
    deckMends: deckTotal ? deckTotal.mends : null,
    deckWhenFalls: deckTotal ? deckTotal.whenFalls : null,
    deckGrows: deckTotal ? deckTotal.grows : null,
    deckTwice: deckTotal ? deckTotal.twice : null,
    wins: state.wins,
    matchesPlayed: state.matchesPlayed,
    // What the Play screen tells a newcomer about a match, and whether that strip
    // is on screen right now rather than folded away.
    matchRules: {
      shown: Boolean(matchRulesPoints && !matchRulesPoints.closest("[hidden]")),
      points: MATCH_RULES.map(({ label, text }) => ({ label, text })),
    },
    result: state.result ? { ...state.result } : null,
    // The card the most recent win added to the collection — the one the
    // Collection screen marks as newly collected — or null when there is nothing
    // to mark: no result yet, a loss, or a win whose only card was a duplicate.
    newlyCollected: newlyCollectedId(state.result),
    // The card a win would add next, as the home screen shows it under "Next win
    // earns": the signature card of the opponent the picker has chosen while
    // that opponent is unbeaten and the card is unowned, otherwise the first
    // reward card not yet owned — with its name, cost, attack and health, or
    // null, with `nextRewardComplete` true, once every reward card is owned.
    nextReward: nextReward ? { ...nextReward } : null,
    // Who earns that card, in the same words the home screen prints beside it:
    // the opponent to beat when the card is their own unowned signature, or the
    // plain fact that any win earns it when it is an ordinary reward — and null
    // once there is no card left to promise. It comes from the same shared choice
    // as `nextReward`, so the page and the state tell one story.
    nextRewardNote: nextReward
      ? nextRewardNoteText(nextRewardSource(), selectedOpponent().name)
      : null,
    nextRewardComplete: nextReward === null,
    saved: state.saved,
    // Who a match could be against, and which of them the next one would be —
    // the picker the Play screen offers, as plain data. Each brings the fixed
    // deck the match will deal it, as the card ids list-collection describes, so
    // the cards the picker promises and the ones played are one list; `deckShown`
    // says whether those cards are open in the picker right now.
    opponents: OPPONENTS.map(({ id, name, look, description, deck, signature }) => {
      const fold = opponentDeckFoldFor(id);
      const { wins, matches } = opponentRecord(id);
      return {
        id,
        name,
        look,
        description,
        // The card that stands for how this opponent plays, and so the one a
        // first win against them earns while it is still to collect. It is the
        // id list-collection names, so a caller can point a player at it.
        signature,
        // What the picker's deck fold marks that card with, in the same words a
        // player reads: the promise while it is still to earn, or the plain fact
        // once it is already earned — the player owns it or has beaten them.
        signatureNote: signatureMarkText(isSignatureEarned({ id, signature })),
        deck: [...deck],
        deckShown: Boolean(fold && fold.open && !fold.closest("[hidden]")),
        // How the player has fared against this opponent, as the picker's own
        // record line reads it: the matches played, the wins, and whether they
        // have been beaten at all.
        record: { wins, matches, beaten: wins > 0 },
      };
    }),
    selectedOpponentId: state.opponentId,
    match: readMatch(),
    canContinue: Boolean(offerable),
    savedMatch: savedMatchSummary(offerable),
    startConflict,
    actions,
  };
}

/**
 * The opponent's table as plain data, each card also saying whether the last
 * board draw marked it as one the opponent just played — the same class and
 * wording the card wears, so an agent reads what a player sees. The occurrence
 * keys are built in table order, the same way the board builds them, so a
 * duplicate card is told from its twin.
 */
function describeOpponentTable(match) {
  const seen = new Map();
  const reactions = shownReactions?.opponent ?? {};
  return match.opponent.table.map((card) => ({
    ...describeMatchCard(card),
    justPlayed: Boolean(reactions[tableOccurrenceKey(seen, card.id)]?.justPlayed),
  }));
}

/** A match card as plain data, so a tool can carry it across the JSON boundary. */
function describeMatchCard(card) {
  return {
    id: card.id,
    name: card.name,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    ability: card.ability ?? null,
    // The ability the card carries for growing while it stays on the table,
    // resolved from the catalog by id too, so a match card dealt before the
    // field existed still reports it.
    growthAbility: card.growthAbility ?? CARD_BY_ID.get(card.id)?.growthAbility ?? null,
    // The ability the card carries for when it leaves the table, resolved from
    // the catalog by id too, so a match card dealt before the field existed
    // still reports it.
    fallAbility: card.fallAbility ?? CARD_BY_ID.get(card.id)?.fallAbility ?? null,
    hasAttacked: Boolean(card.hasAttacked),
  };
}

/**
 * Everything the match currently shows: whether one is in progress, whether it
 * is over and which hero won, whose turn it is, which of the player's table
 * cards is picked to attack with (`selectedAttacker`, a card id or null), both
 * heroes' health, the player's energy, the hand, both tables — each table card
 * saying whether it has already attacked this turn (`hasAttacked`), and each
 * card of the opponent's table also saying whether the board marks it as one the
 * opponent just played on its last turn (`justPlayed`, true only on the draw
 * that follows that turn) — how many
 * cards the opponent holds (`opponentHand`, the face-down backs the board shows)
 * with the energy the opponent has to spend on its own turn and its maximum
 * (`opponentEnergy`/`opponentMaxEnergy`, the same "X of Y" the board prints
 * beside their hand) and how many are left to draw, the ordered log of what happened — its last line the
 * final blow, or the concession when the match was given up — and the moves
 * available now — a live match always offers Concede beside its other moves, and
 * a finished one offers none. `endOfTurnTarget` is what every card of the
 * player's that has not already struck would hit when the turn is ended: the
 * front card of the opponent's table as `{ kind: "card", cardId, name }`, or the
 * opponent's hero as `{ kind: "hero", cardId: null, name }` once that table is
 * empty — the same fact the board prints as a mark on that card or hero, and
 * null when it is not the player's turn or the match is over. `readyAttackers`
 * is how many of the player's table cards have not struck yet, and `readyAttack`
 * the total attack they hold — the cards an ending turn would still send — the
 * same two figures the board prints as "Ready to strike", both null when it is
 * not the player's turn or the match is over. `opponentId` and
 * `opponentName` name the character being faced, whose deck is its own rather
 * than a copy of the player's. With no match it says so — `active` false, and
 * `opponentId`/`opponentName` the character the picker has chosen, the name the
 * Play screen prints before one starts — so a reader can tell the difference
 * between "nothing has happened yet" and "a match with an empty hand". A
 * finished match also carries its `outcome` — "win" or "loss" from the player's
 * side — whether the player gave it up rather than losing a hero (`conceded`),
 * and whether it has been recorded to the save yet.
 */
export function readMatch() {
  const match = state.match;
  if (!match) {
    return {
      active: false,
      opponentId: state.opponentId,
      opponentName: selectedOpponent().name,
      over: false,
      winner: null,
      outcome: null,
      conceded: false,
      recorded: false,
      turn: null,
      selectedAttacker: null,
      endOfTurnTarget: null,
      readyAttackers: null,
      readyAttack: null,
      playerHealth: null,
      opponentHealth: null,
      energy: null,
      maxEnergy: null,
      opponentEnergy: null,
      opponentMaxEnergy: null,
      hand: [],
      table: [],
      opponentTable: [],
      opponentHand: 0,
      deckRemaining: state.deck.length,
      log: [],
      actions: [],
    };
  }

  // How much of the player's own turn is still to come: how many of their table
  // cards have not struck yet and the total attack they hold — the same two
  // figures the board prints as "Ready to strike". Both are null unless the
  // player's own turn is live, so the figures belong to the turn they describe
  // and a caller can tell that no turn of the player's is running.
  const ready = !match.over && match.turn === "player" ? readyToStrike(match.player) : null;

  return {
    active: true,
    opponentId: match.opponentId,
    opponentName: match.opponentName,
    over: match.over,
    winner: match.winner,
    outcome: match.outcome,
    conceded: Boolean(match.conceded),
    recorded: match.recorded,
    turn: match.turn,
    selectedAttacker: state.selectedAttacker,
    endOfTurnTarget: endOfTurnTarget(match),
    readyAttackers: ready ? ready.count : null,
    readyAttack: ready ? ready.attack : null,
    playerHealth: match.player.health,
    opponentHealth: match.opponent.health,
    energy: match.player.energy,
    maxEnergy: match.player.maxEnergy,
    opponentEnergy: match.opponent.energy,
    opponentMaxEnergy: match.opponent.maxEnergy,
    hand: match.player.hand.map(describeMatchCard),
    table: match.player.table.map(describeMatchCard),
    opponentTable: describeOpponentTable(match),
    opponentHand: match.opponent.hand.length,
    deckRemaining: match.player.deck.length,
    log: [...match.log],
    // Giving up is a move a live match always offers, whichever side is taking
    // its turn; everything else needs the player's own turn and a match to play.
    actions: !match.over
      ? [
          ...(match.turn === "player"
            ? [...match.player.hand.map((card) => `Play ${card.name} (cost ${card.cost})`), "End turn"]
            : []),
          "Concede",
        ]
      : [],
  };
}

/**
 * Every card in the game, each saying whether the player owns it and how many
 * copies are held — the whole set the Collection screen shows, which is what
 * the list-collection tool returns. `ownedCards` narrows it to what is actually
 * held, and `setTotal` is how many different cards the game has, so
 * `distinctCards` of `setTotal` is how close the set is to complete. `view`
 * says which cards the Collection screen's set list is showing — every card,
 * only the ones not collected yet, only those that act when played, only those
 * that mend your hero when played, only those that act when they fall, only
 * those that grow while they stay, or only those that carry more than one
 * ability and so act twice — and `order` how those cards are read, in
 * the game's own catalog order or cheapest first. `viewCollected` of `viewTotal` is how much of that view the player
 * already holds, the same "2 of 5 collected" line the ability views print.
 */
export function readCollection() {
  const viewCards = collectionViewCards();
  return {
    cards: listAllCards(state.cards),
    ownedCards: listOwnedCards(state.cards),
    cardsOwned: state.cardsOwned,
    distinctCards: state.distinctCards,
    setTotal: state.setTotal,
    // Which cards the Collection screen's set list is showing: "all", "missing",
    // "abilities", "mends", "falls", "grows" or "twice".
    view: state.collectionView,
    // How that list is read: "catalog" for the game's own order, "cost" cheapest first.
    order: state.collectionOrder,
    // How many of the cards the active view lists the player already holds, and
    // how many it lists in all — the "2 of 5 collected" line under the view
    // buttons in the ability views ("abilities", "mends", "falls", "grows" and
    // "twice").
    viewCollected: viewCards.filter((card) => card.owned).length,
    viewTotal: viewCards.length,
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
  // A start waiting on the player's answer is backed out of by leaving Play: the
  // saved match is left exactly as it was, and the question goes with the screen
  // it was asked on — so returning to Play offers the start again.
  if (state.startPending && screen !== "play") {
    state.startPending = false;
    setMatchMessage("");
  }
  render();

  // The button that was pressed is now hidden, which would drop a keyboard
  // visitor's focus on the floor: land them at the top of the screen that opened.
  if (changed) screens.get(screen).querySelector("h2").focus();

  return readState();
}

for (const button of document.querySelectorAll("[data-screen-target]")) {
  button.addEventListener("click", () => showScreen(button.dataset.screenTarget));
}

// The picker's options are built once from the list of opponents, and its
// choice becomes the opponent the next match is against.
if (opponentOptions) {
  opponentOptions.replaceChildren(...OPPONENTS.map(opponentOption));
}

// The rules points are written once, from the same list the tool reads, so the
// words a visitor sees are the words an agent gets.
if (matchRulesPoints) {
  matchRulesPoints.replaceChildren(
    ...MATCH_RULES.map((rule) => {
      const point = document.createElement("div");
      point.className = "match-rule";
      const label = document.createElement("dt");
      label.className = "match-rule-label";
      label.textContent = rule.label;
      const text = document.createElement("dd");
      text.className = "match-rule-text";
      text.textContent = rule.text;
      point.append(label, text);
      return point;
    })
  );
}
opponentPicker?.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement) runMatchAction(() => selectOpponent(event.target.value));
});

matchRulesToggle?.addEventListener("click", () => toggleMatchRules());
for (const button of collectionViewButtons) {
  button.addEventListener("click", () => setCollectionView(button.dataset.collectionView));
}
for (const button of collectionOrderButtons) {
  button.addEventListener("click", () => setCollectionOrder(button.dataset.collectionOrder));
}
saveRestoreToggle?.addEventListener("click", () => toggleSaveRestore());
saveCodeButton?.addEventListener("click", () => setSaveCodeShown(!state.saveCodeShown));
copySaveCodeButton?.addEventListener("click", () => copySaveCode());
restoreCodeButton?.addEventListener("click", () => {
  if (requestRestoreSaveCode(restoreCodeText?.value ?? "")) replaceGameButton?.focus();
});
replaceGameButton?.addEventListener("click", () => confirmRestoreSaveCode());
cancelRestoreButton?.addEventListener("click", () => {
  cancelRestoreSaveCode();
  restoreCodeButton?.focus();
});
startMatchButton?.addEventListener("click", () => runMatchAction(() => startMatch()));
continueSavedButton?.addEventListener("click", () => runMatchAction(() => continueMatch()));
discardSavedButton?.addEventListener("click", () => runMatchAction(() => discardSavedMatch()));
continueButton?.addEventListener("click", () => runMatchAction(() => continueMatch()));
playAgainButton?.addEventListener("click", () => runMatchAction(() => playAgain()));
endTurnButton?.addEventListener("click", () => runMatchAction(() => endMatchTurn()));
concedeButton?.addEventListener("click", () => runMatchAction(() => concedeMatch()));

render();
renderCollection();
