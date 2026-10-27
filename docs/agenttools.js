/**
 * selfgrow as an agent meets it: the state a visitor can read, and the moves a
 * visitor can make. There is nothing here a person cannot also see or press, so
 * an agent plays the game through the same surface, at the same pace.
 */

import {
  addCardToDeck,
  attackMatch,
  concedeMatch,
  continueMatch,
  discardSavedMatch,
  endMatchTurn,
  playAgain,
  playMatchCard,
  readCollection,
  readMatch,
  readState,
  removeCardFromDeck,
  selectOpponent,
  setCollectionView,
  showScreen,
  startMatch,
  toggleMatchRules,
  toggleOpponentDeck,
} from "./app.js";

// The screens the page has. The list is the tool's own schema as well as the
// page's, so a caller cannot ask for a screen that does not exist.
const SCREENS = ["home", "collection", "play"];

/**
 * Run a page action on a caller's behalf. The page's actions throw a readable
 * reason when they cannot be taken — a visitor sees that reason in the status
 * line — but a tool may not throw on its own example, so the refusal is handed
 * back as an `error` field the caller can read instead. A match tool asked for
 * on a page with no deck or no match therefore reports why, rather than dying.
 */
function attempted(action) {
  try {
    return action();
  } catch (error) {
    return { error: error.message };
  }
}

export function tools() {
  return [
    {
      name: "get-state",
      title: "Read what the page shows",
      description:
        "Returns everything the page shows a visitor right now: which screen is open (home, collection or play), how many cards you own, how many of them are different, and how many different cards the game holds in all (`setTotal`, so `distinctCards` of `setTotal` is how much of the set is collected), which cards the Collection screen's set list is showing (`collectionView`, \"all\" for every card in the game or \"missing\" for only the ones not collected yet — the set-collection-view tool switches it), the deck — how many cards it holds, the most it may hold, the fewest a match needs, and each card in it, each with its name, cost, attack, health and ability text (`ability`, the words printed on the card's face such as \"When played: draw a card\", \"When played: heal your hero 2\" or \"When played: deal 1 damage to the opponent's front card\", or null for a card that carries none) — whether progress is saved for next time, how many matches you have finished (`matchesPlayed`) and won (`wins`), the result of the last finished match (`result`: `outcome` is \"win\" or \"loss\", `awarded` is the card a win added or null, `setComplete` says whether that card was a duplicate added only because you already owned every card in the game, and `firstWin` is true exactly when that win was your first against that opponent — the result screen says so in words when it is, and false for a loss, a repeat win or a match recorded twice), which card the Collection screen marks as newly collected (`newlyCollected`: the id of the card that win added to your collection, marked in the set list with the words \"Newly collected\" as well as in the styling, or null when nothing new was earned — no result yet, a loss, or a win whose only card was a duplicate because you already owned every card in the game — so a caller can point a player at what they have just earned), the card the next win would add (`nextReward`: the first reward card you do not own yet, with its name, cost, attack and health, shown on the home screen under \"Next win earns\" as the card itself, or null once you own every reward card — and `nextRewardComplete` is true exactly then; this is the same card a win actually awards, so ask for it to see what is left to collect and what your next win will give you), what the Play screen tells a newcomer about a match (`matchRules`: `shown`, whether the how-a-match-works strip is on screen rather than folded away, and `points`, the same three labelled lines a visitor reads), and the actions you can take from here. Its `match` field always names the opponent — `opponentName`, the character whose fixed deck a match is against, named before a match starts as well as during one. When a match is running that field carries the whole board: whether the match is over and who won (`over` and `winner`), whose turn it is (`turn`, `\"player\"` or `\"opponent\"` — the same words the board prints as \"Your turn\" or \"<opponentName>'s turn\"), both heroes' health, your energy and its maximum, your hand (with the ids play-card wants, each card carrying its `ability` — the text printed on its face, or null), both tables — each card with the health it has left, which drops as the tables fight — how many cards the opponent holds (`opponentHand`, shown on the board as one face-down card back per card) and how many you have left to draw, the ordered log of what has happened, naming every card that fell and every card an ability drew, its last line the blow that ended the match — and the moves available now. `canContinue` and `savedMatch` report an unfinished match the browser kept from a page left behind (`savedMatch` is a short summary — `opponentName`, `turn`, both healths and `logLength` — and is null while that match is the one loaded), which the continue-match tool picks back up. If starting a match would throw an unfinished saved match away, `startConflict` names what is in the way rather than the save being replaced: it is null unless a start is waiting on that answer, and otherwise carries a `reason` naming the waiting opponent beside the same `savedMatch` summary — continue that match, or discard it with the discard-saved-match tool and deal a new one. `opponents` lists every character a match can be against — each with the `id` start-match and choose-opponent take, its name, the look it cuts, the kind of deck it brings, `deck` — the ids of the fixed cards that opponent is dealt, in the order the picker shows their faces, whose names, costs, attacks, healths and the copies you own are what list-collection returns — `deckShown`, whether those faces are open in the picker right now, which toggle-opponent-deck changes — and `record`, how you have fared against them: `matches` played against that opponent, `wins` of them won, and `beaten`, true once you have beaten them at least once. A record of no matches is a first meeting, and the picker prints that record under each character — \"No matches yet\", then \"2 of 3 matches won\", and \"Beaten — 2 of 3 matches won\" once you have beaten them, so whom you have yet to beat is read from the same state an agent reads. The record is saved with the rest of your progress, so it survives closing the page — and `selectedOpponentId` says which of them the Play screen's picker has chosen, and so which one the next match would be against. Ask it first to see where you stand — comparing the decks on offer card by card — and again after every move to see what changed.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readState();
      },
    },
    {
      name: "get-match-rules",
      title: "Read how a match works",
      description:
        "Returns the three things a match asks of a new player, exactly as the Play screen's \"How a match works\" strip prints them: each point's short `label` and its one-line `text` — that cards cost energy (the price is on the card's face, and the energy readout refills and grows every turn), that the cards on your table strike the opponent's cards and then their hero once their table is empty, and that the first hero at 0 loses — together with `shown`, whether that strip is currently on screen rather than folded away. Ask it to explain the game to a newcomer before a match; the same words are what a visitor reads on the Play screen.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readState().matchRules;
      },
    },
    {
      name: "toggle-match-rules",
      title: "Fold or open the match-rules strip",
      description:
        "Folds away or opens the Play screen's \"How a match works\" strip, exactly as pressing its \"Show rules\"/\"Hide rules\" button does, and returns the rules afterwards (`shown` and the three `points`) so the caller can see the strip's new state. The strip stands only while there is no match on the board; a player who has finished a match opens it folded. It changes nothing about the game itself. Ask get-match-rules first to read what the strip says.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: {},
      async execute() {
        return toggleMatchRules().matchRules;
      },
    },
    {
      name: "list-collection",
      title: "List the whole card set and what you own of it",
      description:
        "Returns every card in the game, one entry per card in catalog order with its name, cost to play, attack, health, the ability printed on its face (`ability` — the extra thing a card does the moment it is played, such as \"When played: draw a card\", \"When played: heal your hero 2\" or \"When played: deal 1 damage to the opponent's front card\", or null for a card that carries none), how many copies you hold (`copies`) and whether you hold any at all (`owned`) — a card you have not collected yet appears too, with 0 copies and `owned` false, and unlike a card you own it offers no way into a deck. Also returns the totals: `cardsOwned` (copies held), `distinctCards` (different cards collected), `setTotal` (how many different cards the game has) and `saved`, so `distinctCards` of `setTotal` says how close the set is to complete and the entries say exactly which cards are missing. It also returns `view`, which cards the Collection screen's set list is showing right now (\"all\" or \"missing\"), so a caller reads the same view the buttons do. Ask it when the caller needs the actual cards rather than only the counts get-state reports.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readCollection();
      },
    },
    {
      name: "set-collection-view",
      title: "Show every card, or only those still to collect",
      description:
        "Switches the Collection screen's set list between every card in the game and only the cards you have not collected yet, exactly as pressing the \"All cards\" or \"Still to collect\" button does. Pass \"all\" to list the whole set, or \"missing\" to hide the cards you already hold and show only those still to collect — the same entries list-collection describes. It changes only what the list shows: the cards you own and your deck are untouched, and the count of cards collected of the set stays visible in both views. Returns the state afterwards, with `collectionView` saying which view is now showing. Ask list-collection to read the cards in either view, and get-state to see which view is showing before switching.",
      inputSchema: {
        type: "object",
        properties: {
          view: {
            type: "string",
            enum: ["all", "missing"],
            description:
              'Which cards the set lists: "all" for every card in the game, "missing" for only the cards not collected yet.',
          },
        },
        required: ["view"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { view: "missing" },
      async execute(input = {}) {
        return attempted(() => setCollectionView(input.view));
      },
    },
    // A first visit opens with a full ten-card deck, so removal is declared
    // before addition: each tool's example must be a move that really works on
    // the page the visitor is actually looking at, and on a full deck an add can
    // only follow a remove.
    {
      name: "remove-card-to-deck",
      title: "Remove a card from your deck",
      description:
        "Removes one copy of a card from your deck and returns it to the collection, exactly as pressing its \"Remove … from deck\" button on the Collection screen does — one call drops one copy, so a card held twice needs two calls to leave the deck entirely. Refused, with the reason, when no copy of the card is in the deck. Returns the state afterwards so you can see the deck it changed.",
      inputSchema: {
        type: "object",
        properties: {
          cardId: {
            type: "string",
            description: "The id of the card to take out of the deck, as get-state reports it.",
          },
        },
        required: ["cardId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { cardId: "sprout" },
      async execute(input = {}) {
        return removeCardFromDeck(input.cardId);
      },
    },
    {
      name: "add-card-to-deck",
      title: "Add an owned card to your deck",
      description:
        "Adds one owned copy of a card to your deck, exactly as pressing its \"Add … to deck\" button on the Collection screen does. A card owned in three copies can go in the deck three times, each call adding one more, up to the deck's limit of ten. Refused, with the reason, when the card is not owned, when every copy you own is already in the deck (the reason names how many you own), or when the deck is already at its limit of ten. Returns the state afterwards so you can see the deck it changed.",
      inputSchema: {
        type: "object",
        properties: {
          cardId: {
            type: "string",
            description: "The id of the owned card to add, as list-collection reports it.",
          },
        },
        required: ["cardId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { cardId: "sprout" },
      async execute(input = {}) {
        return addCardToDeck(input.cardId);
      },
    },
    {
      name: "start-match",
      title: "Start a match against a chosen opponent",
      description:
        "Shuffles your saved deck, deals you a starting hand, and opens the Play screen on a match against one of the characters in get-state's `opponents` — `opponentName` and `opponentId` in the match it returns — each of whom plays a fixed deck of their own rather than a copy of yours, so the deck you built is what you are up against and who you face is a choice. Pass `opponentId` to name who to face, exactly as picking one in the Play screen's picker does; omit it to face the one already chosen (`selectedOpponentId`). The chosen character's name follows the whole match — the intro, the board's labels and the opening log line — and a match saved in the browser keeps the opponent it was started against when it is picked back up. At the start of each side's own turn it draws a card while its deck holds one, and a side's energy maximum grows by one per own turn up to the dearest card, so a spent hand refills and every deck can be played to an end. Any match already running or finished is replaced, so this is also how you play another one after a result. An unfinished match saved in the browser is never thrown away by this call: while one is waiting that is not the match on the board, nothing is dealt and the state comes back with `startConflict` naming the waiting opponent instead — continue it with continue-match, or confirm the discard with discard-saved-match and then deal. Returns the whole match — `opponentId`, `opponentName`, `over` false, both heroes' health, your energy, your hand and table, the opponent's table and the ordered log — so the caller can begin playing. When your deck holds fewer cards than a match needs, or the id names no opponent, it changes nothing and returns an `error` field naming the problem instead.",
      inputSchema: {
        type: "object",
        properties: {
          opponentId: {
            type: "string",
            description:
              "The id of the opponent to face, as get-state's `opponents` lists it (for example \"thornmere\", \"emberwake\" or \"mistfen\"). Omit to face the opponent already chosen.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { opponentId: "emberwake" },
      async execute(input = {}) {
        return attempted(() => startMatch(input.opponentId));
      },
    },
    {
      name: "discard-saved-match",
      title: "Discard the saved match and deal a new one",
      description:
        "Throws away the unfinished match saved in the browser and deals a fresh one in its place, exactly as pressing \"Discard and start new\" on the Play screen's choice does — the only way a waiting match is ever replaced. It is the confirmed form of start-match: call it when get-state reports a `startConflict` (or `canContinue`) and the caller would rather play a new match than continue that one. Pass `opponentId` to name who the new match is against, exactly as start-match does; omit it to face the one already chosen (`selectedOpponentId`). This discards the saved match for good — health, hands, tables and log all go — so ask a human first when the match in progress is not the caller's own. Returns the whole fresh match afterwards — `opponentId`, `opponentName`, `over` false, both heroes' health, your energy, your hand and table, the opponent's table and the ordered log — or an `error` field when the deck holds fewer cards than a match needs or the id names no opponent.",
      inputSchema: {
        type: "object",
        properties: {
          opponentId: {
            type: "string",
            description:
              "The id of the opponent the new match is against, as get-state's `opponents` lists it (for example \"thornmere\", \"emberwake\" or \"mistfen\"). Omit to face the opponent already chosen.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: {},
      async execute(input = {}) {
        return attempted(() => discardSavedMatch(input.opponentId));
      },
    },
    {
      name: "choose-opponent",
      title: "Choose who the next match is against",
      description:
        "Chooses which opponent the next match will be against, exactly as picking one in the Play screen's picker does — it changes `selectedOpponentId` in the state get-state returns, and the name the Play screen prints before a match, without dealing a match or touching one already running. Every opponent's deck kind and the ids of the cards it brings are listed in get-state's `opponents`, so a caller can choose by the deck it wants to play against — exactly the cards the Play screen's picker shows under each character. Returns the state afterwards; a match already in progress keeps the opponent it was started against. Refused, with an `error` field naming the ids that do exist, when the id names no opponent.",
      inputSchema: {
        type: "object",
        properties: {
          opponentId: {
            type: "string",
            description:
              "The id of the opponent to face next, as get-state's `opponents` lists it (for example \"thornmere\", \"emberwake\" or \"mistfen\").",
          },
        },
        required: ["opponentId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { opponentId: "thornmere" },
      async execute(input = {}) {
        return attempted(() => selectOpponent(input.opponentId));
      },
    },
    {
      name: "toggle-opponent-deck",
      title: "Show or fold away an opponent's cards in the picker",
      description:
        "Opens or folds away the cards of one opponent's deck in the Play screen's picker, exactly as pressing that character's \"Their deck\" line does, and returns that opponent afterwards — `deck`, the ids of the cards it is dealt, and `deckShown`, whether their faces are now on screen — so the caller can see which way it went. `deckShown` is false while the picker itself is not on screen, because the picker stands only before a match: the cards a match is fought with never change with this, and are always readable from get-state's `opponents[].deck` whether the deck is open or not. Ask get-state first to read the deck before opening it.",
      inputSchema: {
        type: "object",
        properties: {
          opponentId: {
            type: "string",
            description:
              "The id of the opponent whose deck to fold or open, as get-state's `opponents` lists it (for example \"thornmere\", \"emberwake\" or \"mistfen\").",
          },
        },
        required: ["opponentId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { opponentId: "mistfen" },
      async execute(input = {}) {
        return attempted(() => {
          const state = toggleOpponentDeck(input.opponentId);
          return state.opponents.find((opponent) => opponent.id === input.opponentId);
        });
      },
    },
    {
      name: "play-card",
      title: "Play a card from your hand",
      description:
        "Plays a card from your hand by spending its energy cost, exactly as pressing its \"Play …\" button does: the card moves to your table, your energy drops by its cost, and a line is added to the match log. A card whose face says \"When played: draw a card\" (its `ability` in get-state) also draws you the top card of your deck as it lands, on a log line naming the card drawn and reflected in your hand and in how many cards you have left to draw — so a card can trade a little of the board for a fresh option. A card whose face says \"When played: heal your hero 2\" instead mends your hero as it lands: your health rises by 2, never past the 20 a hero starts with, on a log line stating the health afterwards — so a slow deck has an answer to an early rush. A card whose face says \"When played: deal 1 damage to the opponent's front card\" strikes the board as it lands: the front card of the opponent's table loses 1 health, or — once that table is empty — the opponent's hero does, on a log line naming what was hit and what it has left, and a card worn to 0 this way leaves the table on the same line a card killed at the end of a turn does, so a card can answer what is already on the board rather than only adding to it. Your table fights when you end the turn, so no card played here decides the match by itself: each of your cards strikes the front card of the opponent's table while it holds one, and only reaches the opponent's hero once that table is empty. Pass a cardId from get-state's match.hand to choose the card; when cardId is omitted, the most expensive card you can afford is played. Returns the whole match afterwards, or an `error` field saying why when there is no match, the match is already over, the card is not in your hand, or it costs more energy than you have.",
      inputSchema: {
        type: "object",
        properties: {
          cardId: {
            type: "string",
            description:
              "The id of a card in your hand, as get-state's match.hand lists it. Omit to play the most expensive card you can afford.",
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: {},
      async execute(input = {}) {
        return attempted(() => playMatchCard(input.cardId));
      },
    },
    {
      name: "end-turn",
      title: "End your turn",
      description:
        "Ends your turn, and the two tables fight. Your cards each deal their attack to the front card of the opponent's table while it holds one: that card's health drops, and at zero it leaves the table with a log line naming it — the opponent's hero is untouched until its table is empty. A card you already sent at a chosen target with the attack tool has struck and is spent, so it is skipped here and only the rest attack the front card — which is why ending the turn without attacking is always safe. The opponent then takes a turn of its own — drawing a card while its deck holds one, its energy growing and refilling, and playing cards the way its character chooses — Thornmere the dearest it can afford, Emberwake and Mistfen the cheapest, so their tables fill with several small strikers — each of which is logged as an \"Opponent plays …\" line naming the card and its cost, so the log shows how that opponent plays, a card it plays that carries the draw ability adding one to its hand on a line naming what it drew, one that carries the heal ability mending the opponent's hero on a line stating its health afterwards, and one that carries the strike ability damaging the front card of your table — or your hero once your table is empty — on a line naming what it hit and what it has left — and its cards do the same to the front card of your table, reaching your hero only once your table is empty. The turn comes back to you with your energy grown and refilled and a card drawn while your deck holds one. The match ends the moment either hero's health reaches zero: the log's last line is that final blow, `over` turns true, `winner` names the side that won, and the turn is not handed back to anyone. Every step is added to the match log. Returns the whole match afterwards so you can read what changed, or an `error` field saying why when there is no match, the match is already over, or it is not your turn.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: {},
      async execute() {
        return attempted(endMatchTurn);
      },
    },
    {
      name: "attack",
      title: "Send one of your cards at a chosen target",
      description:
        "Directs one card on your own table at one chosen card on the opponent's table, or — only once the opponent's table is empty — at the opponent's hero, instead of leaving the blow to the front line. Pass the `attackerId` of a card on your table (from get-state's match.table) and the `target` id of a card on the opponent's table (from match.opponentTable), or the string \"hero\" to strike the opponent directly when that table is empty. Exactly one blow lands, with the same card-fall and hero-fall rules as ending the turn, and the attacker is spent for the rest of your turn, so end-turn will not send it again. You need not use this at all: ending the turn still sends every card you did not spend at the front card. Returns the whole match afterwards so you can read what changed, or an `error` field saying why when there is no match, the match is over, it is not your turn, the named card is not on your table, it has already attacked this turn, the target is not on the opponent's table, or the hero is named while a card still stands in front of it.",
      inputSchema: {
        type: "object",
        properties: {
          attackerId: {
            type: "string",
            description: "The id of a card on your own table, as get-state's match.table lists it.",
          },
          target: {
            type: "string",
            description:
              "The id of a card on the opponent's table, as match.opponentTable lists it, or \"hero\" to strike the opponent directly when that table is empty.",
          },
        },
        required: ["attackerId", "target"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { attackerId: "sprout", target: "thornling" },
      async execute(input = {}) {
        return attempted(() => attackMatch(input.attackerId, input.target));
      },
    },
    {
      name: "concede-match",
      title: "Give up the match in progress",
      description:
        "Gives up the match being played, exactly as pressing \"Concede\" on the Play screen does: the match ends at once as a loss — it counts as a match played and not a win, and earns no card — and the result stays on the board with \"Play again\" beside it. The closing log line says the match was conceded, the match reports `over` true with `winner` \"opponent\", `outcome` \"loss\" and `conceded` true, and the saved match is cleared so the abandoned game is not offered to continue. Use it when a game is going badly or began against the wrong deck and a fresh one is wanted; play-again or start-match then deals the next. Returns the state afterwards, or an `error` field saying why when no match is in progress or the match is already over.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: {},
      async execute() {
        return attempted(concedeMatch);
      },
    },
    {
      name: "get-match",
      title: "Read the match on the Play screen",
      description:
        "Returns the match on its own, without the rest of the page. `opponentName` always names the character being faced, whose fixed deck is their own rather than a copy of yours — before a match starts it is who one would be against. `active` is false when no match has been started. While a match is running `over` is false and `turn` says whose move it is, with both heroes' health, your energy and its maximum, your hand (with the ids play-card wants), both tables — each card with the health it has left, which drops as the tables fight, and whether it has already attacked this turn (`hasAttacked`) — how many cards the opponent holds (`opponentHand`, shown on the board as one face-down card back per card) and how many you have left to draw, the ordered log, including a line each time a side draws a card at the start of its own turn, a line each time a card's when-played ability fires — a card drawn, a hero's health after a mend, or the blow a card strikes as it lands — and a line naming each card that fell off a table — and the moves available now, which always include \"Concede\" while the match can still be given up. Once the match has ended — a hero fallen or the match conceded — `over` is true, `winner` is \"player\" or \"opponent\", `outcome` says \"win\" or \"loss\" from your side, `conceded` says whether you gave the match up rather than losing your hero, `recorded` says whether the result has already been saved, the log's last line is the final blow that ended it — or the concession, in which case `conceded` is true and no hero fell, and `actions` is empty because a finished match accepts no more moves — so this is the tool to ask whether the match is still going and who won.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readMatch();
      },
    },
    {
      name: "play-again",
      title: "Play another match after one has finished",
      description:
        "Deals a fresh match from your saved deck against the opponent you last faced and opens the Play screen on it, exactly as pressing \"Play again\" on a finished match does: a new shuffle of both decks — yours and the opponent's own fixed one — both heroes back to their full health, and the finished match replaced. To face a different character after a result, use choose-opponent or start-match with an `opponentId` instead. Ask get-match for `over` first to see whether there is a result waiting; a match that is still running is replaced too, which start-match does as well. Refused, with an `error` field naming the shortfall, when your deck holds fewer cards than a match needs.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: {},
      async execute() {
        return attempted(playAgain);
      },
    },
    {
      name: "continue-match",
      title: "Pick up the match you left",
      description:
        "Restores the unfinished match saved in the browser and opens the Play screen on it, exactly as pressing \"Continue match\" on the home screen does: both heroes' health, energy, hands, tables and decks come back exactly as they were and the ordered log is restored whole, with play carrying on from the same turn. The match is written to the browser as it changes, so this is how a caller picks up a game that was left behind when the page was closed. A finished match is never saved, and starting a new one asks before it replaces the record — start-match reports a `startConflict` instead of discarding it, and only discard-saved-match confirms the loss — so this is refused, with an `error` field, when there is no unfinished match to continue. Ask get-state for `canContinue` to see whether there is one before calling it, or read a `startConflict` while a start is waiting on the choice.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: {},
      async execute() {
        return attempted(continueMatch);
      },
    },
    {
      name: "show-screen",
      title: "Open a screen",
      description:
        "Opens one of the game's screens — home, where you stand; collection, the cards you own; or play, a match against an opponent. This is exactly what pressing Play or Collection does for a visitor, and it returns the state afterwards so you can see the screen that is now open.",
      inputSchema: {
        type: "object",
        properties: {
          screen: {
            type: "string",
            enum: SCREENS,
            description: "Which screen to open: home, collection or play.",
          },
        },
        required: ["screen"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: { screen: "collection" },
      async execute(input = {}) {
        return showScreen(input.screen);
      },
    },
  ];
}
