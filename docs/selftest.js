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

  const reloaded = collection.loadCollection();
  if (!sameCards(reloaded.cards, owned.cards)) {
    fail(
      `reloading the saved collection (what a browser reload does) gave different cards: ` +
        `${JSON.stringify(reloaded.cards)} instead of ${JSON.stringify(asIdCopies(owned.cards))}`
    );
  } else if (!reloaded.saved) {
    fail("the saved collection was read back but not reported as saved, so the page says it may be lost");
  }

  if (state.collectionSaved !== true) {
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

  const blocked = collection.loadCollection(blockedStorage());
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

  const corrupt = collection.loadCollection(stubStorage({ [collection.STORAGE_KEY]: "}{ not json" }));
  if (corrupt.cards.length < 10) {
    fail(
      `an unreadable save was not replaced by a valid starter collection: the player would open with ` +
        `${corrupt.cards.length} card(s)`
    );
  }

  const foreign = collection.loadCollection(
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

  return problems;
}
