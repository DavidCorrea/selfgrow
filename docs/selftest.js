/**
 * Check that selfgrow still opens on a home screen that says what the game is
 * and where the player stands, that every new player is dealt a starter
 * collection which survives closing the page, and that an agent reads and drives
 * that same surface rather than a second one nobody can see.
 *
 * Runs on the real page, in the real browser. Returns plain-language failures,
 * empty when everything holds.
 */

const SCREENS = ["home", "collection", "play"];

// Compare two collections by what actually identifies a card, so the order a
// save happened to be written in never counts as a difference.
const asIdCopies = (cards) =>
  cards
    .map((card) => ({ id: card.id, copies: card.copies }))
    .sort((a, b) => a.id.localeCompare(b.id));
const sameCards = (a, b) => JSON.stringify(asIdCopies(a)) === JSON.stringify(asIdCopies(b));

/** A storage that answers like the browser's but keeps everything in memory. */
function stubStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    durable: false,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

/** A storage that refuses everything, as a browser in private mode does. */
function blockedStorage() {
  const refuse = () => {
    throw new Error("storage is blocked");
  };
  return { durable: false, getItem: refuse, setItem: refuse, removeItem: refuse };
}

export async function checks() {
  const problems = [];
  const fail = (message) => problems.push(message);
  const textOf = (element) => (element ? element.textContent.replace(/\s+/g, " ").trim() : "");
  const screen = (name) => document.getElementById(`screen-${name}`);
  const openScreens = () => SCREENS.filter((name) => screen(name) && !screen(name).hidden);
  const buttonsOn = (name) => (screen(name) ? [...screen(name).querySelectorAll("button")] : []);
  const buttonNamed = (name, label) => buttonsOn(name).find((button) => textOf(button) === label);

  let game;
  let collection;
  try {
    game = await import("./app.js");
    collection = await import("./collection.js");
  } catch (e) {
    return [
      `docs/app.js or docs/collection.js could not be imported, so nothing about the page's state can be checked — ${e.message}`,
    ];
  }

  const state = game.readState();
  const owned = game.readCollection();

  // --- What a visitor meets first -------------------------------------------

  const open = openScreens();
  if (open.join(", ") !== "home") {
    fail(
      `the page opened showing ${open.length ? `"${open.join(", ")}"` : "no screen"} — ` +
        "a visitor should arrive on the home screen, with no other screen open beside it"
    );
  }

  const home = screen("home");
  if (!home) return [...problems, "the home screen is missing from the page (#screen-home)"];

  const wordmark = textOf(document.querySelector("h1"));
  if (!wordmark.toLowerCase().includes("selfgrow")) {
    fail(`the page's heading does not name the game: h1 reads "${wordmark || "(empty)"}"`);
  }

  const description = textOf(document.getElementById("game-description"));
  if (!description) {
    fail("the page does not describe the game anywhere (#game-description is empty)");
  } else {
    const missing = [
      ["card", "what kind of game it is"],
      ["collect", "that you collect cards"],
      ["deck", "that you build a deck"],
      ["opponent", "who you play against"],
    ].filter(([word]) => !description.toLowerCase().includes(word));
    if (missing.length) {
      fail(
        `the description does not say ${missing.map(([, why]) => why).join(", ")}: it reads "${description}"`
      );
    }
  }

  // --- Where the player stands, as a labelled number -------------------------

  for (const [field, label] of [
    ["cardsOwned", "cards owned"],
    ["deckSize", "deck size"],
  ]) {
    const value = home.querySelector(`[data-field="${field}"]`);
    if (!value) {
      fail(`the home screen does not show ${label} (nothing carries data-field="${field}")`);
      continue;
    }
    if (!value.closest("dl")) {
      fail(`the ${label} number is not in a description list beside a label, so it is read without what it counts`);
    }
    if (!home.textContent.toLowerCase().includes(label)) {
      fail(`the home screen gives a number for ${label} without naming it anywhere`);
    }
    const shown = Number(textOf(value));
    if (!Number.isInteger(shown)) {
      fail(`${label} shows "${textOf(value)}" — a count has to be a whole number`);
    } else if (shown !== state[field]) {
      fail(`${label} shows ${shown} while the page's state says ${state[field]} — the card and the state have drifted apart`);
    }
  }

  if (state.deckSize !== 0) {
    fail(`a first visit has no deck yet, but the page reports ${state.deckSize} card(s) in it`);
  }
  if (state.cardsOwned < 10) {
    fail(
      `a new visitor is dealt the starter collection, but the page reports only ${state.cardsOwned} card(s) owned`
    );
  }

  // --- The two actions ------------------------------------------------------

  for (const label of ["Play", "Collection"]) {
    const button = buttonNamed("home", label);
    if (!button) {
      fail(`the home screen has no "${label}" action — it offers ${buttonsOn("home").map(textOf).join(", ") || "nothing"}`);
      continue;
    }
    if (button.tagName !== "BUTTON") {
      fail(`"${label}" is a <${button.tagName.toLowerCase()}> rather than a <button>, so the keyboard cannot reach it as a button`);
    }
    button.focus();
    if (document.activeElement !== button) fail(`"${label}" cannot take keyboard focus`);
  }

  for (const [label, target] of [
    ["Play", "play"],
    ["Collection", "collection"],
  ]) {
    const button = buttonNamed("home", label);
    if (!button) continue;

    button.click();
    const landed = openScreens();
    if (landed.join(", ") !== target) {
      fail(`pressing "${label}" left ${landed.length ? `"${landed.join(", ")}"` : "no screen"} open instead of the ${target} screen`);
    }
    if (game.readState().screen !== target) {
      fail(`pressing "${label}" opened the ${target} screen while the page's state still says "${game.readState().screen}"`);
    }
    const status = textOf(document.getElementById("screen-status"));
    if (!status.toLowerCase().includes(target)) {
      fail(`the live status text does not name the open screen: it reads "${status}" while the ${target} screen is open`);
    }

    const back = buttonNamed(target, "Back to home");
    if (!back) {
      fail(`the ${target} screen has no "Back to home" action, so a visitor who lands there is stuck`);
      continue;
    }
    back.click();
    if (openScreens().join(", ") !== "home") {
      fail(`"Back to home" from the ${target} screen did not return to the home screen`);
    }
  }

  // --- A screen that does not exist is refused -------------------------------

  try {
    game.showScreen("shop");
    fail('opening a screen that does not exist ("shop") was allowed — this page has only home, collection and play');
  } catch {
    // Refusing is the expected path.
  }
  if (openScreens().join(", ") !== "home") {
    fail(`a refused screen change moved the page off the home screen: "${openScreens().join(", ")}" is open`);
  }

  for (const element of document.querySelectorAll("[data-field]")) {
    const field = element.dataset.field;
    if (Number(textOf(element)) !== game.readState()[field]) {
      fail(`the ${field} printed on the page is "${textOf(element)}" while the state says ${game.readState()[field]}`);
    }
  }

  // --- The starter collection is a real hand of cards ------------------------

  if (owned.distinctCards < 10) {
    fail(`a new visitor should start with at least ten different cards, but the collection has ${owned.distinctCards}`);
  }

  const ids = owned.cards.map((card) => card.id);
  if (new Set(ids).size !== ids.length) {
    fail(`the collection lists a card twice instead of counting its copies: ${ids.join(", ")}`);
  }
  for (const card of owned.cards) {
    if (!card.name) {
      fail(`owned card "${card.id}" has no name, so it cannot be read aloud or listed`);
    }
    for (const stat of ["cost", "attack", "health"]) {
      if (!Number.isInteger(card[stat]) || card[stat] < 1) {
        fail(
          `owned card "${card.name || card.id}" has ${stat} ${JSON.stringify(card[stat])} — ` +
            "every card needs a whole number of at least 1"
        );
      }
    }
    if (!Number.isInteger(card.copies) || card.copies < 1) {
      fail(`owned card "${card.name || card.id}" reports ${card.copies} copies — a card owned is owned at least once`);
    }
  }

  // --- The Collection screen prints every card it owns -----------------------

  const collectionScreen = screen("collection");
  const list = document.getElementById("collection-list");
  const heading = textOf(document.getElementById("collection-heading"));
  if (!collectionScreen) {
    fail("the collection screen is missing from the page (#screen-collection)");
  }
  if (!list) {
    fail("the collection screen has no card list (#collection-list)");
  }
  if (!heading.toLowerCase().includes("collection")) {
    fail(`the collection screen's heading does not name it: it reads "${heading || "(empty)"}"`);
  }
  if (list && !list.getAttribute("aria-label")) {
    // The list carries its own label so a screen reader announces what it is.
    fail("the collection list has no accessible name (aria-label), so it is read as an unlabelled list");
  }

  if (list) {
    const rows = [...list.querySelectorAll(".owned-card")];
    if (rows.length !== owned.distinctCards) {
      fail(
        `the collection screen shows ${rows.length} card(s) while the player owns ${owned.distinctCards} different one(s)`
      );
    }

    const rowsById = new Map(rows.map((row) => [row.dataset.cardId, row]));
    for (const card of owned.cards) {
      const row = rowsById.get(card.id);
      if (!row) {
        fail(`the collection screen does not list "${card.name}", which the player owns`);
        continue;
      }
      const name = textOf(row.querySelector(".owned-name"));
      if (name !== card.name) {
        fail(`the collection screen lists "${name}" where the collection holds "${card.name}"`);
      }
      for (const stat of ["cost", "attack", "health"]) {
        const shown = textOf(row.querySelector(`[data-stat="${stat}"]`));
        if (Number(shown) !== card[stat]) {
          fail(`"${card.name}" shows ${stat} ${shown || "(nothing)"} but the collection holds ${card[stat]}`);
        }
      }
      const copyBadge = row.querySelector("[data-copies]");
      if (card.copies > 1) {
        if (!copyBadge) {
          fail(`"${card.name}" is owned in ${card.copies} copies but the collection list does not say so`);
        } else if (Number(copyBadge.dataset.copies) !== card.copies) {
          fail(`"${card.name}" is owned in ${card.copies} copies but the list says ${copyBadge.textContent}`);
        }
      } else if (copyBadge) {
        fail(`"${card.name}" is owned once but the list shows a copy count (${textOf(copyBadge)})`);
      }
    }

    const firstRow = rows[0];
    if (firstRow) {
      const labels = [...firstRow.querySelectorAll(".owned-stat dt")].map(textOf);
      for (const label of ["Cost", "Attack", "Health"]) {
        if (!labels.includes(label)) {
          fail(`an owned card's numbers are not labelled: expected a "${label}" label, found ${labels.join(", ") || "none"}`);
        }
      }
    }

    if (list.querySelector(".collection-empty") && owned.distinctCards > 0) {
      fail("the collection screen shows its empty message even though the player owns cards");
    }
  }

  // --- The collection survives closing the page ------------------------------

  const raw = window.localStorage.getItem(collection.STORAGE_KEY);
  if (raw == null) {
    fail(`nothing is saved under "${collection.STORAGE_KEY}", so the collection is lost when the page closes`);
  }

  const reloaded = collection.loadGame();
  if (!sameCards(reloaded.cards, owned.cards)) {
    fail(
      `reloading the saved collection (what a browser reload does) gave different cards: ` +
        `${JSON.stringify(reloaded.cards)} instead of ${JSON.stringify(asIdCopies(owned.cards))}`
    );
  } else if (!reloaded.saved) {
    fail("the saved collection was read back but not reported as saved, so the page says it may be lost");
  }

  if (state.saved !== true) {
    fail("storage works in this browser, but the page reports the collection as not saved");
  }

  const stub = stubStorage();
  const sample = [
    { id: "sprout", copies: 2 },
    { id: "elder-oak", copies: 1 },
  ];
  const wrote = collection.saveCollection(sample, stub);
  if (!wrote) {
    fail("saving a collection to working storage reported failure, so the write is treated as lost");
  }
  const roundTripped = collection.readCollection(stub);
  if (!roundTripped || !sameCards(roundTripped, sample)) {
    fail(
      `a collection did not survive a save and load: wrote ${JSON.stringify(sample)}, ` +
        `read ${JSON.stringify(roundTripped)}`
    );
  }

  const blocked = collection.loadGame(blockedStorage());
  if (blocked.cards.length < 10) {
    fail(
      `when the browser blocks storage, a new visitor should still be dealt the starter collection, ` +
        `but got ${blocked.cards.length} card(s)`
    );
  }
  if (blocked.saved) {
    fail("when the browser blocks storage the collection cannot be saved, but the page reports it as saved");
  }
  if (collection.saveCollection(sample, blockedStorage())) {
    fail("saving to blocked storage reported success, so a lost collection is treated as saved");
  }

  const corrupt = collection.loadGame(stubStorage({ [collection.STORAGE_KEY]: "}{ not json" }));
  if (corrupt.cards.length < 10) {
    fail(
      `an unreadable save was not replaced by a valid starter collection: the player would open with ` +
        `${corrupt.cards.length} card(s)`
    );
  }

  const foreign = collection.loadGame(
    stubStorage({ [collection.STORAGE_KEY]: JSON.stringify({ version: 99, cards: [] }) })
  );
  if (foreign.cards.length < 10) {
    fail(
      `a save from another version left the player with ${foreign.cards.length} card(s) instead of the starter collection`
    );
  }

  const partial = collection.readCollection(
    stubStorage({
      [collection.STORAGE_KEY]: JSON.stringify({
        version: 1,
        cards: [
          { id: "sprout", copies: 2 },
          { id: "not-a-real-card", copies: 5 },
          { id: "elder-oak", copies: 0 },
          { id: "storm-crow", copies: 1e21 },
        ],
      }),
    })
  );
  if (partial === null || !sameCards(partial, [{ id: "sprout", copies: 2 }])) {
    fail(
      `a save naming an unknown card, a zero copy count and an impossible one was not cleaned up: read ` +
        `${JSON.stringify(partial)} instead of just the one real card`
    );
  }

  // --- The deck: chosen from the collection, capped, and kept ---------------

  const deckList = document.getElementById("deck-list");
  if (!deckList) {
    fail("the collection screen has no deck list (#deck-list), so the deck's contents cannot be read");
  } else if (!deckList.getAttribute("aria-label")) {
    fail("the deck list has no accessible name (aria-label), so it is read as an unlabelled list");
  }

  const collectionScreenText = textOf(screen("collection"));
  if (!collectionScreenText.toLowerCase().includes("deck")) {
    fail("the collection screen never names the deck a player is building there");
  }
  for (const [field, why] of [
    ["deckLimit", "the most cards a deck may hold"],
    ["minimumDeckSize", "the fewest cards a match needs"],
  ]) {
    if (!screen("collection").querySelector(`[data-field="${field}"]`)) {
      fail(`the collection screen does not state ${why} (nothing carries data-field="${field}")`);
    }
  }

  const ownedIds = owned.cards.map((card) => card.id);
  const deckIds = () => game.readState().deck.map((card) => card.id);

  // A visit with no save at all is dealt the starter collection and starts with
  // an empty deck — the state a reload builds from nothing.
  const fresh = collection.loadGame(stubStorage());
  if (fresh.cards.length < 10) {
    fail(`a first visit with no save should be dealt the starter collection, but loadGame gave ${fresh.cards.length} card(s)`);
  }
  if (fresh.deck.length !== 0) {
    fail(`a first visit should start with an empty deck, but loadGame gave ${fresh.deck.length} card(s) in it`);
  }

  for (const id of ownedIds.slice(0, 10)) game.addCardToDeck(id);
  if (deckIds().length !== 10) {
    fail(`ten cards were added to the deck but it reports ${deckIds().length}`);
  }
  if (game.readState().deckSize !== 10) {
    fail(`the deck holds ten cards but get-state reports deckSize ${game.readState().deckSize}`);
  }

  // The list on screen is that deck, as readable names.
  const deckRows = deckList ? [...deckList.querySelectorAll(".deck-card")] : [];
  const expectedDeckNames = game.readState().deck.map((card) => card.name);
  if (deckRows.length !== 10) {
    fail(`the deck holds ten cards but the collection screen lists ${deckRows.length}`);
  }
  const deckNames = deckRows.map((row) => textOf(row.querySelector(".deck-card-name")));
  if (JSON.stringify(deckNames) !== JSON.stringify(expectedDeckNames)) {
    fail(
      `the deck list on the page reads ${JSON.stringify(deckNames)} while the state holds ${JSON.stringify(expectedDeckNames)}`
    );
  }

  // The home screen summarises the same deck, by size and by name.
  const deckSummary = textOf(document.getElementById("deck-summary"));
  if (!deckSummary.includes("10")) {
    fail(`the home screen's deck summary does not state the deck's size: it reads "${deckSummary || "(nothing)"}"`);
  }
  if (!expectedDeckNames.every((name) => deckSummary.includes(name))) {
    fail(`the home screen's deck summary does not name every card in the deck: it reads "${deckSummary}"`);
  }

  // The eleventh card is refused, and the page says why.
  const eleventhId = ownedIds[10];
  const eleventhButton = document.querySelector(`[data-deck-toggle="${eleventhId}"]`);
  if (!eleventhButton) {
    fail(`the collection screen has no control to add "${eleventhId}", so a deck cannot be built from it`);
  } else {
    eleventhButton.click();
    if (deckIds().length !== 10) {
      fail(`adding an eleventh card changed the deck to ${deckIds().length} cards — a deck holds at most ten`);
    }
    const refusal = textOf(document.getElementById("deck-message"));
    if (!refusal.includes("10")) {
      fail(`an eleventh card was refused but the page does not say why: it reads "${refusal || "(nothing)"}"`);
    }
  }

  // Taking one out frees a slot, and the page says what happened.
  const firstDeckId = deckIds()[0];
  const removeButton = document.querySelector(`[data-deck-toggle="${firstDeckId}"]`);
  if (!removeButton) {
    fail(`the collection screen has no control to remove "${firstDeckId}" from the deck`);
  } else {
    removeButton.click();
    if (deckIds().length !== 9) {
      fail(`removing a card left the deck at ${deckIds().length} cards instead of nine`);
    }
    if (!textOf(document.getElementById("deck-message")).toLowerCase().includes("removed")) {
      fail("removing a card did not tell the player what happened");
    }
  }

  // What the page holds now is what a reload reads back.
  const savedDeck = deckIds();
  const reloadedGame = collection.loadGame();
  if (JSON.stringify(reloadedGame.deck) !== JSON.stringify(savedDeck)) {
    fail(
      `the deck did not survive a reload: the page holds ${JSON.stringify(savedDeck)} but loadGame ` +
        `read back ${JSON.stringify(reloadedGame.deck)}`
    );
  }
  const savedPayload = JSON.parse(window.localStorage.getItem(collection.STORAGE_KEY) ?? "null");
  if (!savedPayload || !Array.isArray(savedPayload.deck)) {
    fail("the saved record holds no deck, so the deck is lost when the page closes");
  }

  const savedWithDeck = (deck) =>
    collection.loadGame(
      stubStorage({
        [collection.STORAGE_KEY]: JSON.stringify({
          version: 1,
          cards: owned.cards.map(({ id, copies }) => ({ id, copies })),
          deck,
        }),
      })
    );

  // A saved deck naming a card the player does not own, or one card twice, is
  // cleaned up on the way in rather than reaching the page.
  const dirtyDeck = savedWithDeck([ownedIds[0], ownedIds[0], "not-a-real-card", ownedIds[1], ownedIds[2]]);
  if (JSON.stringify(dirtyDeck.deck) !== JSON.stringify(ownedIds.slice(0, 3))) {
    fail(
      `a saved deck with a duplicate and an unowned card was not cleaned up: read ${JSON.stringify(dirtyDeck.deck)} ` +
        `instead of ${JSON.stringify(ownedIds.slice(0, 3))}`
    )
  }

  // A saved deck with more than ten cards is capped at the limit.
  const overfullDeck = savedWithDeck(ownedIds);
  if (overfullDeck.deck.length !== 10) {
    fail(`a saved deck of ${ownedIds.length} ids was read back as ${overfullDeck.deck.length} cards, not a clean ten`);
  }

  // --- The match engine: a dealt hand, a refused play, a turn taken ---------

  let matchEngine;
  try {
    matchEngine = await import("./match.js");
  } catch (e) {
    fail(`docs/match.js could not be imported, so the match engine cannot be checked — ${e.message}`);
  }

  if (matchEngine) {
    // A deck smaller than a match needs cannot start one.
    try {
      matchEngine.createMatch(["sprout", "pebble-toad"]);
      fail("a match started from a deck smaller than the minimum, which no visitor can do");
    } catch {
      // Refusing is the expected path.
    }

    // A fixed random source deals a repeatable game, so the turn below has one
    // known outcome instead of whatever the shuffle happened to give.
    const fixedRng = () => 0;

    // Every hand card costs more than the starting energy, so any play is refused.
    const pricey = matchEngine.createMatch(
      ["storm-crow", "emberling", "root-colossus", "elder-oak", "vine-lasher"],
      { rng: fixedRng }
    );
    const tooExpensive = pricey.player.hand.find((card) => card.cost > pricey.player.energy);
    if (!tooExpensive) {
      fail("the controlled expensive deck dealt no unaffordable card, so a play refusal cannot be tested");
    } else {
      const handBefore = pricey.player.hand.map((card) => card.id);
      let refusal = null;
      try {
        matchEngine.playCard(pricey, tooExpensive.id);
      } catch (error) {
        refusal = error.message;
      }
      if (!refusal) {
        fail(
          `"${tooExpensive.name}" costs ${tooExpensive.cost} energy with only ${pricey.player.energy} available, ` +
            "but playing it was allowed"
        );
      } else if (!refusal.includes(String(tooExpensive.cost)) || !refusal.includes(String(pricey.player.energy))) {
        fail(`an unaffordable card was refused without naming the shortfall: "${refusal}"`);
      }
      if (JSON.stringify(pricey.player.hand.map((card) => card.id)) !== JSON.stringify(handBefore)) {
        fail("a refused card play changed the hand anyway");
      }
      if (pricey.player.table.length !== 0) {
        fail("a refused card play put a card on the table anyway");
      }
    }

    // A cheap deck: one card on the table, then the turn handed over and back.
    const cheapDeck = ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"];
    const dealt = matchEngine.createMatch(cheapDeck, { rng: fixedRng });
    if (dealt.player.hand.length !== 3) {
      fail(`a match dealt ${dealt.player.hand.length} cards instead of a starting hand of 3`);
    }
    const deckIdSet = new Set(cheapDeck);
    for (const card of dealt.player.hand) {
      if (!deckIdSet.has(card.id)) {
        fail(`a match dealt "${card.id}", which is not in the deck it was dealt from`);
      }
    }
    if (dealt.player.deck.length !== cheapDeck.length - 3) {
      fail(`a match left ${dealt.player.deck.length} cards in the deck instead of ${cheapDeck.length - 3}`);
    }

    const affordable = dealt.player.hand.find((card) => card.cost <= dealt.player.energy);
    if (!affordable) {
      fail("the controlled cheap deck dealt nothing affordable, so the turn loop cannot be tested");
    } else {
      matchEngine.playCard(dealt, affordable.id);
      const attackTotal = dealt.player.table.reduce((total, card) => total + card.attack, 0);
      const opponentHealthBefore = dealt.opponent.health;
      const logBefore = dealt.log.length;
      matchEngine.endTurn(dealt);

      if (dealt.opponent.health !== Math.max(0, opponentHealthBefore - attackTotal)) {
        fail(
          `ending the turn left the opponent at ${dealt.opponent.health} instead of ` +
            `${Math.max(0, opponentHealthBefore - attackTotal)} after ${attackTotal} damage from your table`
        );
      }
      if (dealt.turn !== "player") {
        fail(`ending the turn left it as the ${dealt.turn}'s turn instead of handing it back to the player`);
      }
      if (dealt.player.energy !== dealt.player.maxEnergy) {
        fail(`the new turn began with ${dealt.player.energy} energy instead of a refreshed ${dealt.player.maxEnergy}`);
      }
      if (dealt.opponent.table.length === 0) {
        fail("the opponent took a turn without playing any card from its affordable hand");
      }
      if (dealt.log.length <= logBefore) {
        fail("ending the turn added no line to the match log");
      }
      if (dealt.player.health < 1) {
        fail(`the opponent's attack cut the player's hero to ${dealt.player.health}, below the floor a match should hold`);
      }
    }
  }

  // --- The same surface, for an agent ---------------------------------------

  let declared;
  try {
    declared = (await import("./agenttools.js")).tools();
  } catch (e) {
    fail(`docs/agenttools.js could not be imported — ${e.message}`);
    return problems;
  }
  const toolNamed = (name) => declared.find((tool) => tool.name === name);

  const getState = toolNamed("get-state");
  if (!getState) {
    fail('no "get-state" tool is declared, so an agent cannot learn which screen is open or where the player stands');
  } else {
    const reported = await getState.execute({});
    if (reported.screen !== "home") {
      fail(`get-state reports the "${reported.screen}" screen while the page is showing home`);
    }
    for (const [field, label] of [
      ["cardsOwned", "cards owned"],
      ["distinctCards", "different cards"],
      ["deckSize", "deck size"],
    ]) {
      if (reported[field] !== game.readState()[field]) {
        fail(`get-state reports ${reported[field]} ${label} while the page's state says ${game.readState()[field]}`);
      }
    }
    const actions = Array.isArray(reported.actions) ? reported.actions : [];
    for (const label of ["Play", "Collection"]) {
      if (!actions.includes(label)) {
        fail(`get-state does not list the "${label}" action a visitor can press from home (it lists ${actions.join(", ") || "nothing"})`);
      }
    }

    // The deck is part of what the page shows, so it is part of what get-state
    // returns: its size, the limit it is built to, the minimum a match needs,
    // and the cards themselves.
    const live = game.readState();
    if (reported.deckLimit !== live.deckLimit) {
      fail(`get-state reports a deck limit of ${reported.deckLimit} while the page says ${live.deckLimit}`);
    }
    if (reported.minimumDeckSize !== live.minimumDeckSize) {
      fail(`get-state reports a minimum deck size of ${reported.minimumDeckSize} while the page says ${live.minimumDeckSize}`);
    }
    const reportedDeck = Array.isArray(reported.deck) ? reported.deck : [];
    if (reportedDeck.length !== live.deck.length) {
      fail(`get-state returns ${reportedDeck.length} deck card(s) while the page holds ${live.deck.length}`);
    }
    for (const card of reportedDeck) {
      if (!card.name) fail(`get-state returns a deck card "${card.id}" with no name, so an agent cannot read the deck`);
    }
  }

  const listCollection = toolNamed("list-collection");
  if (!listCollection) {
    fail('no "list-collection" tool is declared, so an agent cannot read the cards the player owns');
  } else {
    if (!listCollection.annotations || listCollection.annotations.readOnlyHint !== true) {
      fail('"list-collection" does not declare itself read-only, though it changes nothing');
    }
    const listed = await listCollection.execute({});
    const listedCards = Array.isArray(listed.cards) ? listed.cards : [];
    if (listedCards.length !== owned.distinctCards) {
      fail(
        `list-collection returns ${listedCards.length} card(s) while the player owns ${owned.distinctCards} different one(s)`
      );
    }
    if (!sameCards(listedCards, owned.cards)) {
      fail(
        `list-collection returns different cards from the page: ${JSON.stringify(asIdCopies(listedCards))} ` +
          `instead of ${JSON.stringify(asIdCopies(owned.cards))}`
      );
    }
    for (const card of listedCards) {
      for (const stat of ["cost", "attack", "health"]) {
        if (!Number.isInteger(card[stat])) {
          fail(`list-collection returns "${card.name}" with no ${stat}, so an agent cannot judge the card`);
        }
      }
    }
    if (listed.distinctCards !== owned.distinctCards) {
      fail(`list-collection reports ${listed.distinctCards} different cards while the page says ${owned.distinctCards}`);
    }
  }

  const showScreen = toolNamed("show-screen");
  if (!showScreen) {
    fail('no "show-screen" tool is declared, so an agent cannot open a screen the way a visitor can');
  } else {
    const after = await showScreen.execute({ screen: "play" });
    if (openScreens().join(", ") !== "play") {
      fail(`the show-screen tool did not open the play screen: "${openScreens().join(", ")}" is open on the page`);
    }
    if (after.screen !== "play") {
      fail(`the show-screen tool reports "${after.screen}" after opening the play screen`);
    }

    await showScreen.execute({ screen: "home" });
    if (openScreens().join(", ") !== "home") {
      fail("the show-screen tool could not bring the page back to the home screen");
    }
  }

  const addToDeckTool = toolNamed("add-card-to-deck");
  const removeFromDeckTool = toolNamed("remove-card-to-deck");
  if (!addToDeckTool) {
    fail('no "add-card-to-deck" tool is declared, so an agent cannot add a card the way a visitor can');
  }
  if (!removeFromDeckTool) {
    fail('no "remove-card-to-deck" tool is declared, so an agent cannot take a card out the way a visitor can');
  }
  for (const tool of [addToDeckTool, removeFromDeckTool]) {
    if (tool && (!tool.annotations || tool.annotations.readOnlyHint !== false)) {
      fail(`"${tool.name}" changes the deck but is not marked as changing anything (readOnlyHint: false)`);
    }
  }

  if (addToDeckTool && removeFromDeckTool) {
    const alreadyInDeck = new Set(deckIds());
    const candidate = ownedIds.find((id) => !alreadyInDeck.has(id));

    const added = await addToDeckTool.execute({ cardId: candidate });
    if (!(added.deck ?? []).some((card) => card.id === candidate)) {
      fail(`the add-card-to-deck tool returned a deck without the "${candidate}" it was asked to add`);
    }
    if (!deckIds().includes(candidate)) {
      fail(`the add-card-to-deck tool reported adding "${candidate}" but the page does not hold it`);
    }

    const removed = await removeFromDeckTool.execute({ cardId: candidate });
    if ((removed.deck ?? []).some((card) => card.id === candidate)) {
      fail(`the remove-card-to-deck tool left "${candidate}" in the deck it returned`);
    }
    if (deckIds().includes(candidate)) {
      fail(`the remove-card-to-deck tool reported removing "${candidate}" but the page still holds it`);
    }

    let refusedUnknown = false;
    try {
      await addToDeckTool.execute({ cardId: "not-a-real-card" });
    } catch {
      refusedUnknown = true;
    }
    if (!refusedUnknown) {
      fail('add-card-to-deck accepted a card the player does not own ("not-a-real-card")');
    }
  }

  // --- A match on the page: dealt, played and turned over -------------------

  const deckAtStart = deckIds();
  let started = null;
  try {
    started = game.startMatch();
  } catch (e) {
    fail(`starting a match with a deck of ${deckAtStart.length} cards was refused — ${e.message}`);
  }

  if (started) {
    const m = started.match;
    if (!m || m.active !== true) {
      fail("starting a match did not report an active match");
    }
    if (started.screen !== "play") {
      fail(`starting a match left the page on the "${started.screen}" screen instead of opening Play`);
    }
    if (openScreens().join(", ") !== "play") {
      fail(`starting a match left "${openScreens().join(", ")}" open on the page instead of the match`);
    }
    if (m) {
      if (m.turn !== "player") {
        fail(`a new match begins on the ${m.turn}'s turn instead of the player's`);
      }
      if (m.playerHealth !== 20 || m.opponentHealth !== 20) {
        fail(`a new match starts at ${m.playerHealth} and ${m.opponentHealth} health instead of both heroes at 20`);
      }
      if (m.energy !== m.maxEnergy) {
        fail(`a new match starts with ${m.energy} energy instead of a full ${m.maxEnergy}`);
      }
      if (m.hand.length !== 3) {
        fail(`a new match dealt ${m.hand.length} cards instead of a starting hand of 3`);
      }
      if (m.table.length !== 0 || m.opponentTable.length !== 0) {
        fail("a new match begins with cards already on a table");
      }
      if (m.deckRemaining !== deckAtStart.length - 3) {
        fail(`a match from a deck of ${deckAtStart.length} left ${m.deckRemaining} cards to draw instead of ${deckAtStart.length - 3}`);
      }
      const handIds = m.hand.map((card) => card.id);
      if (!handIds.every((id) => deckAtStart.includes(id))) {
        fail(`the match dealt a hand from outside the saved deck: ${handIds.join(", ")} is not among ${deckAtStart.join(", ")}`);
      }
      if (!Array.isArray(m.log) || m.log.length === 0) {
        fail("a new match has an empty log, so nothing it has done can be read back");
      }

      // The board prints that same match.
      const board = document.getElementById("match-board");
      const intro = document.getElementById("match-intro");
      if (!board || board.hidden) {
        fail("a match is running but the board is not on screen");
      }
      if (intro && !intro.hidden) {
        fail("a match is running but the pre-match note is still shown instead of the board");
      }
      const startButton = buttonNamed("play", "Start match");
      if (startButton && !startButton.hidden) {
        fail("a match is running but the Start match button is still offered");
      }
      const endButton = buttonNamed("play", "End turn");
      if (!endButton || endButton.hidden) {
        fail("a match is running on the player's turn but there is no End turn button");
      }
      if (textOf(document.getElementById("match-player-health")) !== String(m.playerHealth)) {
        fail(`the board prints your health as ${textOf(document.getElementById("match-player-health"))} instead of ${m.playerHealth}`);
      }
      if (textOf(document.getElementById("match-opponent-health")) !== String(m.opponentHealth)) {
        fail(`the board prints the opponent's health as ${textOf(document.getElementById("match-opponent-health"))} instead of ${m.opponentHealth}`);
      }
      if (!textOf(document.getElementById("match-energy")).includes(String(m.energy))) {
        fail(`the board prints your energy as "${textOf(document.getElementById("match-energy"))}", not the ${m.energy} the match holds`);
      }
      const handRows = [...document.querySelectorAll("#match-hand .match-card")];
      if (handRows.length !== m.hand.length) {
        fail(`the board shows ${handRows.length} card(s) in hand while the match holds ${m.hand.length}`);
      }
      for (const card of m.hand) {
        const row = document.querySelector(`#match-hand [data-card-id="${card.id}"]`);
        if (!row) {
          fail(`the board does not show "${card.name}", which the match holds in hand`);
          continue;
        }
        const button = row.querySelector("button");
        if (!button) {
          fail(`the card "${card.name}" in hand has no control to play it`);
        } else if (!button.textContent.includes(card.name)) {
          fail(`the control for "${card.name}" does not name the card: it reads "${textOf(button)}"`);
        }
      }
      const printedLog = [...document.querySelectorAll("#match-log li")].map(textOf);
      if (JSON.stringify(printedLog) !== JSON.stringify(m.log.map((line) => line.replace(/\s+/g, " ").trim()))) {
        fail(`the match log on the page does not match the match's log: it reads ${JSON.stringify(printedLog)}`);
      }

      // A card the player can afford, played by pressing its button.
      const affordable = m.hand.find((card) => card.cost <= m.energy);
      if (!affordable) {
        fail("the freshly dealt hand holds nothing affordable, so playing a card cannot be checked");
      } else {
        const button = document.querySelector(`#match-hand [data-card-id="${affordable.id}"] button`);
        const energyBefore = m.energy;
        const handBefore = m.hand.length;
        const logBefore = m.log.length;
        button.click();
        const afterPlay = game.readState().match;
        if (!afterPlay.table.some((card) => card.id === affordable.id)) {
          fail(`playing "${affordable.name}" did not put it on the table`);
        }
        if (afterPlay.hand.length !== handBefore - 1) {
          fail(`playing a card left ${afterPlay.hand.length} cards in hand instead of ${handBefore - 1}`);
        }
        if (afterPlay.energy !== energyBefore - affordable.cost) {
          fail(`playing a ${affordable.cost}-cost card left ${afterPlay.energy} energy instead of ${energyBefore - affordable.cost}`);
        }
        if (afterPlay.log.length <= logBefore) {
          fail("playing a card added no line to the match log");
        }
      }

      // Play every card the energy allows, then the card that is left cannot be
      // afforded and the page has to say so rather than silently do nothing.
      for (;;) {
        const live = game.readState().match;
        const next = live.hand.find((card) => card.cost <= live.energy);
        if (!next) break;
        document.querySelector(`#match-hand [data-card-id="${next.id}"] button`).click();
      }
      const stuck = game.readState().match;
      const stuckCard = stuck.hand[0];
      if (stuckCard) {
        document.querySelector(`#match-hand [data-card-id="${stuckCard.id}"] button`).click();
        const refusal = textOf(document.getElementById("match-message"));
        if (!refusal.toLowerCase().includes("afford")) {
          fail(`a card that cannot be afforded was refused without saying so: "${refusal || "(nothing)"}"`);
        }
        if (game.readState().match.hand.length !== stuck.hand.length) {
          fail("a card that could not be afforded was played anyway");
        }
      }

      // Ending the turn: the opponent acts, the turn returns and energy is full.
      const beforeEnd = game.readState().match;
      const ourAttack = beforeEnd.table.reduce((total, card) => total + card.attack, 0);
      game.endMatchTurn();
      const afterEnd = game.readState().match;
      if (afterEnd.opponentHealth !== Math.max(0, beforeEnd.opponentHealth - ourAttack)) {
        fail(
          `ending the turn left the opponent at ${afterEnd.opponentHealth} instead of ` +
            `${Math.max(0, beforeEnd.opponentHealth - ourAttack)} after ${ourAttack} damage from your table`
        );
      }
      if (afterEnd.turn !== "player") {
        fail(`the turn did not come back to the player — it is the ${afterEnd.turn}'s turn`);
      }
      if (afterEnd.energy !== afterEnd.maxEnergy) {
        fail(`the new turn began with ${afterEnd.energy} energy instead of a refreshed ${afterEnd.maxEnergy}`);
      }
      if (afterEnd.opponentTable.length === 0) {
        fail("the opponent took its turn without playing any affordable card");
      }
      if (afterEnd.log.length <= beforeEnd.log.length) {
        fail("ending the turn added no lines to the match log");
      }
    }
  }

  // --- The match through an agent's tools -----------------------------------

  const startMatchTool = toolNamed("start-match");
  const playCardTool = toolNamed("play-card");
  const endTurnTool = toolNamed("end-turn");
  for (const [name, tool] of [
    ["start-match", startMatchTool],
    ["play-card", playCardTool],
    ["end-turn", endTurnTool],
  ]) {
    if (!tool) {
      fail(`no "${name}" tool is declared, so an agent cannot make the move a visitor can`);
      continue;
    }
    if (!tool.annotations || tool.annotations.readOnlyHint !== false) {
      fail(`"${name}" changes the match but is not marked as changing anything (readOnlyHint: false)`);
    }
  }

  if (startMatchTool && playCardTool && endTurnTool) {
    const fresh = await startMatchTool.execute({});
    if (!fresh.match || fresh.match.active !== true) {
      fail('the start-match tool did not report an active match');
    }
    if (openScreens().join(", ") !== "play") {
      fail(`the start-match tool did not open the match: "${openScreens().join(", ")}" is open on the page`);
    }
    if (!fresh.match || !Array.isArray(fresh.match.log) || fresh.match.log.length === 0) {
      fail("the start-match tool returned a match with no log, so an agent cannot read what happened");
    }

    if (getState) {
      const reported = await getState.execute({});
      const live = game.readState().match;
      if (!reported.match || reported.match.active !== true) {
        fail("get-state does not return the active match, so an agent cannot read the game in progress");
      } else {
        for (const field of ["playerHealth", "opponentHealth", "energy", "maxEnergy"]) {
          if (reported.match[field] !== live[field]) {
            fail(`get-state reports match ${field} ${reported.match[field]} while the page says ${live[field]}`);
          }
        }
        if ((reported.match.hand || []).length !== live.hand.length) {
          fail(`get-state reports ${(reported.match.hand || []).length} cards in hand while the page holds ${live.hand.length}`);
        }
        if ((reported.match.log || []).length !== live.log.length) {
          fail(`get-state reports ${(reported.match.log || []).length} log lines while the page holds ${live.log.length}`);
        }
      }
    }

    const beforePlay = game.readState().match;
    const playable = beforePlay.hand.find((card) => card.cost <= beforePlay.energy);
    if (!playable) {
      fail("the started match's hand holds nothing affordable, so the play-card tool cannot be checked");
    } else {
      const afterPlay = await playCardTool.execute({ cardId: playable.id });
      if (!(afterPlay.match.table || []).some((card) => card.id === playable.id)) {
        fail(`the play-card tool reported a table without the "${playable.name}" it played`);
      }
      if (afterPlay.match.energy !== beforePlay.energy - playable.cost) {
        fail(`the play-card tool left ${afterPlay.match.energy} energy instead of ${beforePlay.energy - playable.cost}`);
      }
      let refused = false;
      try {
        const bad = await playCardTool.execute({ cardId: "not-a-real-card" });
        refused = Boolean(bad && bad.error);
      } catch {
        refused = true;
      }
      if (!refused) {
        fail('the play-card tool accepted a card that is not in the hand ("not-a-real-card")');
      }
    }

    const beforeTurn = game.readState().match;
    const afterTurn = await endTurnTool.execute({});
    if (afterTurn.match.turn !== "player") {
      fail(`the end-turn tool left it as the ${afterTurn.match.turn}'s turn instead of the player's`);
    }
    if (afterTurn.match.energy !== afterTurn.match.maxEnergy) {
      fail(`the end-turn tool did not refresh the player's energy (${afterTurn.match.energy} of ${afterTurn.match.maxEnergy})`);
    }
    if (!(afterTurn.match.log || []).length || afterTurn.match.log.length <= beforeTurn.log.length) {
      fail("the end-turn tool added no lines to the match log");
    }

    // Leave the page on a freshly started match, so whoever opens it next finds
    // the state these checks last described rather than one mid-turn.
    await startMatchTool.execute({});
  }

  return problems;
}
