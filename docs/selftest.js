/**
 * Check that selfgrow still opens on a home screen that says what the game is
 * and where the player stands, that every new player is dealt a starter
 * collection which survives closing the page, that a match played to the last
 * blow ends with a result both a player and an agent can read, and that an agent
 * reads and drives that same surface rather than a second one nobody can see.
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

  // --- Every card has its own picture, in the one shared style ----------------

  const cardCatalog = await import("./cards.js");
  let cardArt;
  try {
    cardArt = await import("./cardart.js");
  } catch (e) {
    fail(`docs/cardart.js could not be imported, so no card's picture can be checked — ${e.message}`);
  }

  if (cardArt) {
    // A card the page has no drawing for is a fallback, not a blank frame: an
    // unknown id has to answer null so the caller can print the card's name.
    if (cardArt.cardArt("no-such-card") !== null) {
      fail("cardArt() invented a picture for a card that does not exist instead of answering null");
    }

    const style = cardArt.ART_STYLE;
    if (!style?.palette?.body || !style?.palette?.frame || !style?.shapeLanguage) {
      fail(
        "the art style is not written down beside the pictures (no palette and shape language), " +
          "so a card added later cannot be drawn to match the ones already here"
      );
    }

    const drawings = new Map();
    for (const card of cardCatalog.CARDS) {
      const art = cardArt.cardArt(card.id);
      if (!art) {
        fail(`"${card.name}" has no picture, so a player has nothing to know the card by`);
        continue;
      }
      const drawing = (art.inner || "").replace(/\s+/g, " ").trim();
      if (!drawing) {
        fail(`"${card.name}" has a picture with nothing drawn in it`);
        continue;
      }
      if (!art.description?.trim()) {
        fail(`"${card.name}"'s picture is not described, so it cannot be checked against the style`);
      }
      drawings.set(card.id, drawing);

      // Every drawing is built from the same shape classes, so the set stays one
      // set however many cards are added.
      const classes = [...drawing.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
      const stray = classes.filter((name) => name !== "art-body" && name !== "art-accent");
      if (stray.length) {
        fail(
          `"${card.id}"'s drawing uses the shape class(es) ${stray.join(", ")} that no other card uses, ` +
            "so it would not match the rest of the set"
        );
      }
      if (!classes.includes("art-body")) {
        fail(`"${card.id}"'s drawing has no creature in it (nothing carries the art-body shape)`);
      }

      // A picture that points anywhere would be fetched, and this page loads
      // with nothing leaving its own origin.
      if (/https?:|<image|href=/i.test(drawing)) {
        fail(`"${card.id}"'s drawing points outside the page, so showing it would need a request of its own`);
      }
    }

    // Two cards drawn identically are one card to a player's eye.
    const drawnBy = new Map();
    for (const [id, drawing] of drawings) {
      const twin = drawnBy.get(drawing);
      if (twin) fail(`"${id}" and "${twin}" are drawn identically, so the two cards cannot be told apart by sight`);
      else drawnBy.set(drawing, id);
    }

    // The picture on each owned card: the card's name as its text alternative,
    // inside the one shared frame, drawn in the card's own palette.
    const probe = document.createElement("span");
    probe.style.color = "var(--foil)";
    document.body.append(probe);
    const foil = getComputedStyle(probe).color;
    probe.remove();

    for (const row of document.querySelectorAll("#collection-list .owned-card")) {
      const name = textOf(row.querySelector(".owned-name")) || row.dataset.cardId;
      const picture = row.querySelector("svg.card-art");
      if (!picture) {
        fail(`the card "${name}" is shown with no picture, so it cannot be learned by sight`);
        continue;
      }
      if (picture.getAttribute("role") !== "img") {
        fail(`the picture on "${name}" is not announced as an image (role="${picture.getAttribute("role")}")`);
      }
      if (picture.getAttribute("aria-label") !== name) {
        fail(
          `the picture on "${name}" is described as "${picture.getAttribute("aria-label") || "(nothing)"}" ` +
            "instead of the card's own name"
        );
      }
      if (!picture.querySelector(".art-frame")) {
        fail(`the picture on "${name}" is not drawn in the frame every other card uses`);
      }
      const creature = picture.querySelector(".art-body");
      if (!creature) {
        fail(`the picture on "${name}" has no creature in it, only its frame`);
      } else if (getComputedStyle(creature).fill !== foil) {
        fail(
          `the creature on "${name}" is filled ${getComputedStyle(creature).fill} where the card's ` +
            `palette prints it ${foil}, so the pictures are not in the card's palette`
        );
      }
      for (const node of picture.querySelectorAll("*")) {
        const pointsOut = node.tagName.toLowerCase() === "image"
          ? "an <image>"
          : [...node.attributes].find((attribute) => /https?:|url\(/i.test(attribute.value))?.value;
        if (pointsOut) {
          fail(`the picture on "${name}" points outside the page (${pointsOut}), so drawing it would need a request`);
        }
      }
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

  // --- A win grows the collection; a loss does not --------------------------

  // A save of the real collection with no matches played yet, so the first win
  // earns the first card in the reward pool.
  const progressStore = stubStorage();
  collection.saveCollection(owned.cards, progressStore);
  const wonFirst = collection.recordResult("win", "match-a", progressStore);
  if (!wonFirst.recorded) {
    fail("recording a win reported the match was not recorded, so a win would not count");
  }
  if (!wonFirst.awarded || wonFirst.awarded.id !== cardCatalog.REWARD_POOL[0]) {
    fail(
      `a first win awarded ${JSON.stringify(wonFirst.awarded)} instead of the first reward card ` +
        `"${cardCatalog.REWARD_POOL[0]}"`
    );
  }
  const awardedId = wonFirst.awarded?.id;
  const ownedBefore = owned.cards.find((card) => card.id === awardedId)?.copies ?? 0;
  const ownedAfter = wonFirst.cards.find((card) => card.id === awardedId)?.copies ?? 0;
  if (ownedAfter !== ownedBefore + 1) {
    fail(
      `a win left ${ownedAfter} copies of "${awardedId}" instead of exactly one more than the ${ownedBefore} owned`
    );
  }
  if (wonFirst.wins !== 1 || wonFirst.matches !== 1) {
    fail(`a first win reported ${wonFirst.wins} win(s) and ${wonFirst.matches} match(es) instead of 1 and 1`);
  }

  // Recording the same match again counts nothing and awards nothing, so a
  // result screen revisited cannot grow the collection twice.
  const replayed = collection.recordResult("win", "match-a", progressStore);
  if (replayed.recorded || replayed.awarded) {
    fail(
      `the same match recorded twice was counted again (recorded ${replayed.recorded}, awarded ` +
        `${JSON.stringify(replayed.awarded)})`
    );
  }
  if (replayed.wins !== 1 || replayed.matches !== 1) {
    fail(
      `recording the same match twice reported ${replayed.wins} win(s) and ${replayed.matches} match(es) instead of 1 and 1`
    );
  }

  // A second, different win gives the next card in the pool.
  const wonSecond = collection.recordResult("win", "match-b", progressStore);
  if (wonSecond.awarded?.id !== cardCatalog.REWARD_POOL[1]) {
    fail(
      `a second win awarded "${wonSecond.awarded?.id}" instead of the next reward card "${cardCatalog.REWARD_POOL[1]}"`
    );
  }

  // A loss is counted but earns nothing, and leaves the collection untouched.
  const cardsBeforeLoss = JSON.stringify(asIdCopies(wonSecond.cards));
  const lost = collection.recordResult("loss", "match-c", progressStore);
  if (lost.awarded !== null || lost.recorded !== true) {
    fail(`a loss awarded ${JSON.stringify(lost.awarded)} instead of nothing`);
  }
  if (lost.wins !== 2 || lost.matches !== 3) {
    fail(`after two wins and a loss the record reads ${lost.wins} win(s) and ${lost.matches} match(es) instead of 2 and 3`);
  }
  if (JSON.stringify(asIdCopies(lost.cards)) !== cardsBeforeLoss) {
    fail("a loss changed the collection, though only a win may add a card");
  }

  // All of it survives a reload: the totals and the cards that were earned.
  const savedProgress = collection.readProgress(progressStore);
  if (savedProgress.wins !== 2 || savedProgress.matches !== 3) {
    fail(
      `the saved record read back ${savedProgress.wins} win(s) and ${savedProgress.matches} match(es) instead of 2 and 3`
    );
  }
  const reloadedAwarded = collection
    .readCollection(progressStore)
    .find((card) => card.id === cardCatalog.REWARD_POOL[0]);
  if (!reloadedAwarded || reloadedAwarded.copies < 1) {
    fail(`the card won in a match did not survive a save and load: ${JSON.stringify(collection.readCollection(progressStore))}`);
  }

  // A save written before wins and matches existed still opens, reading as a
  // player who has played nothing yet rather than as a broken record.
  const olderSave = stubStorage({
    [collection.STORAGE_KEY]: JSON.stringify({
      version: 1,
      cards: owned.cards.map(({ id, copies }) => ({ id, copies })),
      deck: [],
    }),
  });
  const olderProgress = collection.readProgress(olderSave);
  if (olderProgress.wins !== 0 || olderProgress.matches !== 0) {
    fail(
      `a save written before wins and matches existed read back ${olderProgress.wins} win(s) and ` +
        `${olderProgress.matches} match(es) instead of 0 and 0`
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
    const openingHand = matchEngine.STARTING_HAND + 1; // the dealt hand plus the card drawn on the opening turn
    if (dealt.player.hand.length !== openingHand) {
      fail(
        `a match dealt ${dealt.player.hand.length} cards instead of an opening hand of ${openingHand} ` +
          `(${matchEngine.STARTING_HAND} dealt plus the card drawn at the start of the player's first turn)`
      );
    }
    const deckIdSet = new Set(cheapDeck);
    for (const card of dealt.player.hand) {
      if (!deckIdSet.has(card.id)) {
        fail(`a match dealt "${card.id}", which is not in the deck it was dealt from`);
      }
    }
    if (dealt.player.deck.length !== cheapDeck.length - openingHand) {
      fail(`a match left ${dealt.player.deck.length} cards in the deck instead of ${cheapDeck.length - openingHand}`);
    }
    if (!dealt.log.some((line) => /draw/i.test(line))) {
      fail("the opening turn drew a card but the match log never says a card was drawn");
    }

    const affordable = dealt.player.hand.find((card) => card.cost <= dealt.player.energy);
    if (!affordable) {
      fail("the controlled cheap deck dealt nothing affordable, so the turn loop cannot be tested");
    } else {
      matchEngine.playCard(dealt, affordable.id);
      const attackTotal = dealt.player.table.reduce((total, card) => total + card.attack, 0);
      const opponentHealthBefore = dealt.opponent.health;
      const handBefore = dealt.player.hand.length;
      const deckBefore = dealt.player.deck.length;
      const opponentDeckBefore = dealt.opponent.deck.length;
      const logBefore = dealt.log.length;
      matchEngine.endTurn(dealt);
      const addedLines = dealt.log.slice(logBefore);

      if (deckBefore > 0 && dealt.player.deck.length !== deckBefore - 1) {
        fail(
          `the new turn left ${dealt.player.deck.length} cards in the deck instead of drawing one from ${deckBefore}`
        );
      }
      if (dealt.player.hand.length !== handBefore + 1) {
        fail(
          `the new turn left ${dealt.player.hand.length} cards in hand instead of drawing one onto ${handBefore}`
        );
      }
      if (!addedLines.some((line) => /^You draw /.test(line))) {
        fail(`the new turn drew a card without logging it: the turn added ${JSON.stringify(addedLines)}`);
      }
      if (opponentDeckBefore > 0 && !addedLines.some((line) => /^The opponent draws /.test(line))) {
        fail(
          `the opponent's turn drew a card without logging it: the turn added ${JSON.stringify(addedLines)}`
        );
      }

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

    // A match always reaches a result: two small decks race each other, and the
    // moment a hero falls the match is over, the winner is named, and no move is
    // accepted any more.
    const race = matchEngine.createMatch(cheapDeck);
    for (let move = 0; move < 40 && !race.over; move += 1) {
      const playable = race.player.hand.find((card) => card.cost <= race.player.energy);
      if (playable) matchEngine.playCard(race, playable.id);
      else matchEngine.endTurn(race);
    }

    if (!race.over) {
      fail(
        `40 moves into a match both heroes were still standing (${race.player.health} and ` +
          `${race.opponent.health} health), so a match never reaches the result it is played for`
      );
    } else {
      if (race.winner !== "player" && race.winner !== "opponent") {
        fail(`a finished match reports "${race.winner}" as its winner instead of the player or the opponent`);
      }
      const expectedOutcome = race.winner === "player" ? "win" : "loss";
      if (race.outcome !== expectedOutcome) {
        fail(
          `a match won by the "${race.winner}" reports outcome "${race.outcome}" instead of "${expectedOutcome}"`
        );
      }
      const champion = race.winner === "player" ? race.player : race.opponent;
      const fallen = race.winner === "player" ? race.opponent : race.player;
      if (fallen.health !== 0) {
        fail(`the losing hero of a finished match is at ${fallen.health} health instead of 0`);
      }
      if (champion.health < 1) {
        fail(`the winning hero of a finished match is at ${champion.health} health, so nobody really won it`);
      }
      if (race.player.health < 0 || race.opponent.health < 0) {
        fail(
          `hero health fell below zero (${race.player.health} and ${race.opponent.health}), so the board ` +
            "would print a number smaller than a hero can have"
        );
      }

      const finalLine = race.log[race.log.length - 1] ?? "";
      if (!champion.table.some((card) => finalLine.includes(card.name))) {
        fail(`the match log's last line does not name the card that won the match: it reads "${finalLine}"`);
      }
      if (!finalLine.toLowerCase().includes(race.winner === "player" ? "you won" : "you lost")) {
        fail(`the match log's last line does not say who won: it reads "${finalLine}"`);
      }

      const frozen = JSON.stringify([race.player.health, race.opponent.health, race.log.length]);
      for (const [what, move] of [
        ["playing a card", () => matchEngine.playCard(race, race.player.hand[0]?.id)],
        ["ending the turn", () => matchEngine.endTurn(race)],
      ]) {
        let refusal = null;
        try {
          move();
        } catch (error) {
          refusal = error.message;
        }
        if (!refusal) {
          fail(`a match that is over still accepted ${what}`);
        } else if (!refusal.includes("over")) {
          fail(`a finished match refused ${what} without saying the match is over: "${refusal}"`);
        }
      }
      if (JSON.stringify([race.player.health, race.opponent.health, race.log.length]) !== frozen) {
        fail("a move on a finished match changed the match anyway");
      }
    }

    // A draw moves a card rather than making one: through every draw so far,
    // each side's cards still add up to the deck it was dealt from.
    for (const [who, side] of [
      ["player", dealt.player],
      ["opponent", dealt.opponent],
    ]) {
      const held = side.hand.length + side.table.length + side.deck.length;
      if (held !== cheapDeck.length) {
        fail(
          `the ${who}'s cards add up to ${held} after drawing, instead of the ${cheapDeck.length} it was dealt ` +
            "— a draw duplicated or dropped one"
        );
      }
    }

    // An exhausted deck draws nothing and says nothing, but the turn still runs.
    const spent = matchEngine.createMatch(cheapDeck, { rng: fixedRng });
    spent.player.deck = [];
    spent.opponent.deck = [];
    const spentLogBefore = spent.log.length;
    matchEngine.endTurn(spent);
    const spentLines = spent.log.slice(spentLogBefore);
    if (spent.over) {
      fail("a turn with both decks spent ended the match instead of continuing it");
    } else {
      const drew = spentLines.filter((line) => /draw/i.test(line));
      if (drew.length) {
        fail(`an empty deck still drew a card: ${JSON.stringify(drew)}`);
      }
      if (spent.turn !== "player") {
        fail(`a turn with both decks spent left it as the ${spent.turn}'s turn instead of the player's`);
      }
    }

    // The regression this ticket is about: a deck of nothing but the dearest
    // cards — none affordable on the first turn — still plays to a result,
    // because each side's energy grows by one per turn up to the dearest card.
    const dearest = [...cardCatalog.CARDS]
      .sort((a, b) => b.cost - a.cost || b.attack - a.attack)
      .slice(0, 5)
      .map((card) => card.id);
    const priceyDeck = matchEngine.createMatch(dearest, { rng: fixedRng });
    for (let move = 0; move < 30 && !priceyDeck.over; move += 1) {
      const playable = priceyDeck.player.hand.find((card) => card.cost <= priceyDeck.player.energy);
      if (playable) matchEngine.playCard(priceyDeck, playable.id);
      else matchEngine.endTurn(priceyDeck);
    }
    if (!priceyDeck.over) {
      fail(
        `a deck of only the dearest cards stalled: 30 moves in, both heroes stood at ` +
          `${priceyDeck.player.health} and ${priceyDeck.opponent.health} health, so the match never reached a result`
      );
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
      ["wins", "wins"],
      ["matchesPlayed", "matches played"],
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
    const openingDeal = matchEngine.STARTING_HAND + 1; // dealt hand plus the card drawn on the opening turn
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
      if (m.hand.length !== openingDeal) {
        fail(
          `a new match dealt ${m.hand.length} cards instead of an opening hand of ${openingDeal} ` +
            "(the dealt hand plus the card drawn at the start of the player's first turn)"
        );
      }
      if (m.table.length !== 0 || m.opponentTable.length !== 0) {
        fail("a new match begins with cards already on a table");
      }
      if (m.deckRemaining !== deckAtStart.length - openingDeal) {
        fail(`a match from a deck of ${deckAtStart.length} left ${m.deckRemaining} cards to draw instead of ${deckAtStart.length - openingDeal}`);
      }
      if (!m.log.some((line) => /draw/i.test(line))) {
        fail("the opening turn drew a card but the match log never says a card was drawn");
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
      if (textOf(document.getElementById("match-deck-remaining")) !== String(m.deckRemaining)) {
        fail(
          `the board prints ${textOf(document.getElementById("match-deck-remaining"))} cards left in deck ` +
            `instead of the ${m.deckRemaining} the match holds`
        );
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

        // While it cannot be paid for the card still says so, stays pressable
        // and keeps its full "Play <name> (cost N)" label, so a keyboard or
        // screen-reader player loses nothing.
        const row = document.querySelector(`#match-hand [data-card-id="${stuckCard.id}"]`);
        const button = row ? row.querySelector("button") : null;
        if (!row || !row.classList.contains("is-unaffordable")) {
          fail(
            `the card "${stuckCard.name}", costing ${stuckCard.cost} against ${stuck.energy} energy, ` +
              "is not marked unaffordable"
          );
        }
        if (button && button.disabled) {
          fail(`the control for the unaffordable "${stuckCard.name}" is disabled, so pressing it cannot explain the shortfall`);
        }
        const wanted = `Play ${stuckCard.name} (cost ${stuckCard.cost})`;
        if (button && button.textContent.trim() !== wanted) {
          fail(`the control for the unaffordable "${stuckCard.name}" reads "${textOf(button)}" instead of "${wanted}"`);
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
      const turnLines = afterEnd.log.slice(beforeEnd.log.length);
      if (beforeEnd.deckRemaining > 0) {
        if (afterEnd.deckRemaining !== beforeEnd.deckRemaining - 1) {
          fail(
            `the new turn left ${afterEnd.deckRemaining} cards in the deck instead of drawing one from ` +
              `${beforeEnd.deckRemaining}`
          );
        }
        if (!turnLines.some((line) => /^You draw /.test(line))) {
          fail(`the new turn drew a card without logging it: the turn added ${JSON.stringify(turnLines)}`);
        }
      }

      // Every card in the match — your hand and both tables — is drawn with the
      // same picture it has in the collection, its name as the text alternative
      // and its numbers still readable, so a card is known by sight wherever it
      // appears.
      for (const [where, selector, cards] of [
        ["your hand", "#match-hand", afterEnd.hand],
        ["your table", "#match-table", afterEnd.table],
        ["the opponent's table", "#match-opponent-table", afterEnd.opponentTable],
      ]) {
        for (const card of cards) {
          const row = document.querySelector(`${selector} [data-card-id="${card.id}"]`);
          if (!row) {
            fail(`the board does not show "${card.name}" on ${where}, which the match holds there`);
            continue;
          }
          const picture = row.querySelector("svg.card-art");
          if (!picture) {
            fail(`the card "${card.name}" on ${where} is shown with no picture, so it cannot be learned by sight`);
            continue;
          }
          if (picture.getAttribute("role") !== "img") {
            fail(
              `the picture on "${card.name}" (${where}) is not announced as an image ` +
                `(role="${picture.getAttribute("role")}")`
            );
          }
          if (picture.getAttribute("aria-label") !== card.name) {
            fail(
              `the picture on "${card.name}" (${where}) is described as ` +
                `"${picture.getAttribute("aria-label") || "(nothing)"}" instead of the card's own name`
            );
          }
          if (!picture.querySelector(".art-frame") || !picture.querySelector(".art-body")) {
            fail(`the picture on "${card.name}" (${where}) is not drawn in the shared frame and creature`);
          }
          // The same card is the same picture wherever it appears.
          const inCollection = document.querySelector(`#collection-list [data-card-id="${card.id}"] svg.card-art`);
          if (inCollection && inCollection.outerHTML !== picture.outerHTML) {
            fail(
              `"${card.name}" looks different in the match (${where}) than in the collection, so one card has two pictures`
            );
          }
          const printed = textOf(row.querySelector(".match-card-stats"));
          const numbers = `${card.cost}/${card.attack}/${card.health}`;
          if (printed !== numbers) {
            fail(`"${card.name}" (${where}) prints its cost/attack/health as "${printed}" instead of "${numbers}"`);
          }
        }
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

  // --- A match played to a result, and what the page shows of it -------------

  const resultBlock = document.getElementById("match-result");
  const resultHeading = document.getElementById("match-result-heading");
  const resultHealth = document.getElementById("match-final-health");
  const resultReward = document.getElementById("result-reward");
  const handSide = document.getElementById("match-hand-side");
  const endTurnButton = document.getElementById("action-end-turn");

  /**
   * Everything a finished match has to show, whichever side won: the state says
   * who won, the health agrees with it, the page says the same in words, the
   * log's last line is the winning play, and the only things left to press are
   * the ways out of the result.
   */
  const checkResult = (played, ended) => {
    if (!ended || !ended.over) {
      fail(
        `${played}, but the match never ended — both heroes were still standing at ` +
          `${ended?.playerHealth} and ${ended?.opponentHealth} health`
      );
      return;
    }

    if (ended.winner !== "player" && ended.winner !== "opponent") {
      fail(`the finished match names "${ended.winner}" as its winner instead of the player or the opponent`);
    }
    const youWon = ended.winner === "player";
    const champion = youWon ? ended.playerHealth : ended.opponentHealth;
    const fallen = youWon ? ended.opponentHealth : ended.playerHealth;
    if (fallen !== 0 || champion < 1) {
      fail(
        `the match ended with your hero at ${ended.playerHealth} and the opponent's at ${ended.opponentHealth} ` +
          "health, so either the losing hero is not at 0 or the winning hero is not standing"
      );
    }

    if (!resultBlock || resultBlock.hidden) {
      fail(`${played}, but the page shows no result, so a player never learns how the match ended`);
    } else {
      const outcome = youWon ? "You won" : "You lost";
      if (textOf(resultHeading) !== outcome) {
        fail(`the result reads "${textOf(resultHeading) || "(nothing)"}" where the match says "${outcome}"`);
      }
      const finalHealth = textOf(resultHealth);
      for (const health of [ended.playerHealth, ended.opponentHealth]) {
        if (!finalHealth.includes(String(health))) {
          fail(`the result does not state both heroes' final health: it reads "${finalHealth}"`);
        }
      }
      if (endTurnButton && !endTurnButton.hidden) {
        fail("a finished match still offers End turn, so a player can keep playing a match that is over");
      }
      if (handSide && !handSide.hidden) {
        fail("a finished match still shows the hand, so a player can keep playing a match that is over");
      }
      const again = buttonNamed("play", "Play again");
      if (!again || again.hidden) {
        fail("a finished match offers no Play again, so a player cannot start another one from the result");
      }
      const home = buttonNamed("play", "Back to home");
      if (!home || home.hidden) {
        fail("a finished match cannot get back home, so a player is stuck on the result");
      }
    }

    const finalLine = (ended.log || [])[ended.log.length - 1] ?? "";
    const winnerTable = youWon ? ended.table : ended.opponentTable;
    if (!(winnerTable || []).some((card) => finalLine.includes(card.name))) {
      fail(`the last line of the match log does not name the play that won the match: it reads "${finalLine}"`);
    }
    if (!finalLine.toLowerCase().includes(youWon ? "you won" : "you lost")) {
      fail(`the last line of the match log does not say who won: it reads "${finalLine}"`);
    }
    if ((ended.log || []).length < 2) {
      fail("the match log holds a result but nothing that led to it");
    }
    if ((ended.actions || []).length) {
      fail(`a finished match still lists the moves ${ended.actions.join(", ")}, though none of them can be made`);
    }
    const offered = game.readState().actions.filter((label) => label !== "Play again" && label !== "Back to home");
    if (offered.length) {
      fail(`a finished match still offers an agent ${offered.join(", ")}, which a player cannot press`);
    }
    if (document.activeElement !== resultHeading) {
      fail("when the match ended, focus was left off the result, so a keyboard visitor is not told how it went");
    }
  };

  // Play the strongest card your energy covers, then end the turn, until the
  // match is over — how a sensible player finishes a game. Bounded, so a match
  // that will not end fails this check instead of hanging the whole suite.
  const playToResult = () => {
    for (let move = 0; move < 30; move += 1) {
      const live = game.readState().match;
      if (!live || live.over) return live;
      const strongest = live.hand
        .filter((card) => card.cost <= live.energy)
        .sort((a, b) => b.attack - a.attack)[0];
      if (strongest) {
        document.querySelector(`#match-hand [data-card-id="${strongest.id}"] button`)?.click();
      } else {
        endTurnButton.click();
      }
    }
    return game.readState().match;
  };

  // These checks play from a known deck a match can always play out of: every
  // card but the two dearest is one the opening energy covers, and a side draws
  // one card at the start of each of its own turns, so a dealt hand always
  // holds something playable and the deck refills instead of emptying. Built
  // from the player's own cards and through the deck's own controls, so the
  // checks do not depend on what the collection happens to hold later.
  if (matchEngine) {
    const byCost = [...owned.cards].sort((a, b) => b.cost - a.cost);
    const tooDear = byCost.filter((card) => card.cost > matchEngine.MAX_ENERGY).slice(0, 2);
    const affordable = byCost.filter((card) => card.cost <= matchEngine.MAX_ENERGY);
    const knownDeck = [...tooDear, ...affordable].slice(0, game.readState().deckLimit);

    for (const card of game.readState().deck) {
      if (!knownDeck.some((wanted) => wanted.id === card.id)) game.removeCardFromDeck(card.id);
    }
    for (const card of knownDeck) {
      if (!deckIds().includes(card.id)) game.addCardToDeck(card.id);
    }
  }

  const cardsHeldBefore = collection.collectionSize(game.readCollection().cards);
  game.startMatch();
  const playedOut = playToResult();
  checkResult("playing the strongest card your energy covers, turn after turn", playedOut);

  // A win grows the collection by exactly one card and names it; a loss adds
  // none. Which side wins a real match is the shuffle's choice, so each branch
  // is checked for what it must do when it happens.
  const afterPlay = game.readState();
  const cardsHeldAfter = collection.collectionSize(game.readCollection().cards);
  if (playedOut?.outcome === "win") {
    const awarded = afterPlay.result?.awarded;
    if (!awarded) {
      fail("the player won a match but the result reports no card was awarded");
    } else if (!cardCatalog.REWARD_POOL.includes(awarded.id)) {
      fail(`a win awarded "${awarded.id}", which is not one of the reward cards ${JSON.stringify(cardCatalog.REWARD_POOL)}`);
    } else if (cardsHeldAfter !== cardsHeldBefore + 1) {
      fail(`a won match left the collection holding ${cardsHeldAfter} card(s) instead of exactly one more than ${cardsHeldBefore}`);
    } else if (!textOf(resultReward).includes(awarded.name)) {
      fail(`a win added "${awarded.name}" but the result does not say which card: it reads "${textOf(resultReward)}"`);
    }
  } else if (playedOut?.outcome === "loss") {
    if (afterPlay.result?.awarded !== null) {
      fail(`a lost match awarded ${JSON.stringify(afterPlay.result?.awarded)} instead of nothing`);
    }
    if (cardsHeldAfter !== cardsHeldBefore) {
      fail(`a lost match grew the collection from ${cardsHeldBefore} to ${cardsHeldAfter} card(s)`);
    }
  }

  // A finished match takes no further move, and a refused move leaves it alone.
  const finished = game.readState().match;
  if (finished?.over) {
    const frozen = JSON.stringify(finished);
    for (const [what, move] of [
      ["a card", () => game.playMatchCard(finished.hand[0]?.id)],
      ["the turn", () => game.endMatchTurn()],
    ]) {
      let refusal = null;
      try {
        move();
      } catch (error) {
        refusal = error.message;
      }
      if (!refusal) {
        fail(`a finished match still accepted ${what} through the page`);
      } else if (!refusal.toLowerCase().includes("over")) {
        fail(`a finished match refused ${what} without saying the match is over: "${refusal}"`);
      }
    }
    if (JSON.stringify(game.readState().match) !== frozen) {
      fail("a move on a finished match changed the match anyway");
    }
  }

  // Play again deals the same deck into a fresh match and clears the result.
  const playAgainButton = buttonNamed("play", "Play again");
  if (playAgainButton) {
    playAgainButton.click();
    const restarted = game.readState();
    if (!restarted.match || restarted.match.active !== true || restarted.match.over) {
      fail("pressing Play again did not leave a fresh match running");
    } else {
      if (restarted.match.playerHealth !== 20 || restarted.match.opponentHealth !== 20) {
        fail(
          `Play again started a match at ${restarted.match.playerHealth} and ${restarted.match.opponentHealth} ` +
            "health instead of both heroes at 20"
        );
      }
      if (restarted.screen !== "play") {
        fail(`Play again left the page on the "${restarted.screen}" screen instead of the match`);
      }
      if (resultBlock && !resultBlock.hidden) {
        fail("the result of the finished match is still on screen after Play again");
      }
      if (!playAgainButton.hidden) {
        fail("Play again is still offered in a match that has only just begun");
      }
    }
  }

  // Idling loses: end turn after turn without playing a card and the opponent's
  // table cuts your hero down. The page has to say so, with your hero at zero,
  // record the match, and earn nothing for the loss.
  const beforeIdle = game.readState();
  game.startMatch();
  for (let turn = 0; turn < 30 && !game.readState().match?.over; turn += 1) {
    endTurnButton.click();
  }
  const idled = game.readState().match;
  checkResult("ending every turn without playing a card", idled);
  if (idled?.over) {
    if (idled.winner !== "opponent") {
      fail(`a player who played no card at all won the match (winner "${idled.winner}"), which no card on the table can have done`);
    }
    if (idled.playerHealth !== 0) {
      fail(`idling left your hero at ${idled.playerHealth} health instead of a fallen 0`);
    }

    // Finishing the match recorded it: the count climbed, the win count held,
    // and the result says plainly that no card was earned.
    const afterIdle = game.readState();
    if (afterIdle.matchesPlayed !== beforeIdle.matchesPlayed + 1) {
      fail(
        `finishing a match left matchesPlayed at ${afterIdle.matchesPlayed} instead of ` +
          `${beforeIdle.matchesPlayed + 1}`
      );
    }
    if (afterIdle.wins !== beforeIdle.wins) {
      fail(`a loss moved the win count from ${beforeIdle.wins} to ${afterIdle.wins}`);
    }
    if (afterIdle.result?.outcome !== "loss" || afterIdle.result?.awarded !== null) {
      fail(
        `after a loss the page's result reads ${JSON.stringify(afterIdle.result)} instead of a loss that awarded nothing`
      );
    }
    if (!textOf(resultReward).toLowerCase().includes("no card")) {
      fail(`after a loss the page does not say no card was earned: it reads "${textOf(resultReward) || "(nothing)"}"`);
    }

    // The record survives being closed and opened again.
    const reopened = collection.loadGame();
    if (reopened.wins !== afterIdle.wins || reopened.matches !== afterIdle.matchesPlayed) {
      fail(
        `a reload read back ${reopened.wins} win(s) and ${reopened.matches} match(es) instead of ` +
          `${afterIdle.wins} and ${afterIdle.matchesPlayed}`
      );
    }

    // The home screen shows the same wins and matches the state holds.
    game.showScreen("home");
    for (const [field, label] of [
      ["wins", "wins"],
      ["matchesPlayed", "matches played"],
    ]) {
      const shown = home.querySelector(`[data-field="${field}"]`);
      if (!shown) {
        fail(`the home screen shows no ${label} (nothing carries data-field="${field}")`);
      } else if (Number(textOf(shown)) !== afterIdle[field]) {
        fail(`the home screen shows ${textOf(shown)} ${label} while the state holds ${afterIdle[field]}`);
      }
    }
    if (!textOf(home).toLowerCase().includes("matches played")) {
      fail("the home screen gives a matches-played number without naming it");
    }
  }

  // --- The result, through an agent's tools ---------------------------------

  const getMatchTool = toolNamed("get-match");
  if (!getMatchTool) {
    fail('no "get-match" tool is declared, so an agent cannot read the match on its own');
  } else {
    if (!getMatchTool.annotations || getMatchTool.annotations.readOnlyHint !== true) {
      fail('"get-match" does not declare itself read-only, though it changes nothing');
    }
    const reported = await getMatchTool.execute({});
    const live = game.readState().match;
    if (!reported || reported.over !== live.over || reported.winner !== live.winner) {
      fail(
        `get-match reports over ${reported?.over} and winner ${reported?.winner} while the page says ` +
          `over ${live?.over} and winner ${live?.winner}`
      );
    }
    if (reported?.playerHealth !== live.playerHealth || reported?.opponentHealth !== live.opponentHealth) {
      fail(
        `get-match reports ${reported?.playerHealth} and ${reported?.opponentHealth} health while the page says ` +
          `${live.playerHealth} and ${live.opponentHealth}`
      );
    }
    if (!Array.isArray(reported?.log) || reported.log.length !== live.log.length) {
      fail(`get-match returns ${reported?.log?.length} log lines while the page holds ${live.log.length}`);
    }
    if (reported?.outcome !== live.outcome || reported?.recorded !== live.recorded) {
      fail(
        `get-match reports outcome "${reported?.outcome}" (recorded ${reported?.recorded}) while the page says ` +
          `"${live.outcome}" (recorded ${live.recorded})`
      );
    }
    // The hand and both tables are still the same lists the page draws, so an
    // agent reads the same cards a visitor sees.
    for (const field of ["hand", "table", "opponentTable"]) {
      if (JSON.stringify(reported?.[field]) !== JSON.stringify(live[field])) {
        fail(
          `get-match returns ${JSON.stringify(reported?.[field])} for ${field} while the page holds ` +
            `${JSON.stringify(live[field])}`
        );
      }
    }
  }

  // get-state is how an agent sees the collection grow: the totals, and the card
  // a win awarded. After the loss just played, it has to say nothing was added.
  if (getState) {
    const reportedState = await getState.execute({});
    const liveState = game.readState();
    if (reportedState.wins !== liveState.wins || reportedState.matchesPlayed !== liveState.matchesPlayed) {
      fail(
        `get-state reports ${reportedState.wins} win(s) and ${reportedState.matchesPlayed} match(es) while the page says ` +
          `${liveState.wins} and ${liveState.matchesPlayed}`
      );
    }
    if (JSON.stringify(reportedState.result) !== JSON.stringify(liveState.result)) {
      fail(
        `get-state reports result ${JSON.stringify(reportedState.result)} while the page says ` +
          `${JSON.stringify(liveState.result)}`
      );
    }
    if (liveState.result?.outcome === "loss" && reportedState.result?.awarded !== null) {
      fail(
        `after a loss get-state reports an awarded card ${JSON.stringify(reportedState.result?.awarded)}, ` +
          "so an agent cannot tell nothing was earned"
      );
    }
  }

  const playAgainTool = toolNamed("play-again");
  if (!playAgainTool) {
    fail('no "play-again" tool is declared, so an agent cannot start another match the way a visitor can');
  } else {
    if (!playAgainTool.annotations || playAgainTool.annotations.readOnlyHint !== false) {
      fail('"play-again" starts a match but is not marked as changing anything (readOnlyHint: false)');
    }
    const restarted = await playAgainTool.execute({});
    if (!restarted.match || restarted.match.active !== true || restarted.match.over) {
      fail("the play-again tool did not leave a fresh match running");
    } else {
      if (restarted.match.playerHealth !== 20 || restarted.match.opponentHealth !== 20) {
        fail(
          `the play-again tool left the heroes at ${restarted.match.playerHealth} and ` +
            `${restarted.match.opponentHealth} health instead of both at 20`
        );
      }
      if (openScreens().join(", ") !== "play") {
        fail(`the play-again tool left "${openScreens().join(", ")}" open instead of the match`);
      }
    }
  }

  // --- Every screen fits the window it is opened in -------------------------

  // The suite runs in whatever window the build opened it in, so what holds at
  // every width is checked at every width, and the checks that only mean
  // something on one kind of screen are gated on it.
  //
  // The window is read from the document element rather than `innerWidth`: on a
  // phone a page that overflows does not scroll sideways — the browser widens the
  // layout viewport and shrinks the page to fit it, so `innerWidth` grows to
  // match the overflow and hides the fault being looked for.
  const PHONE_WIDTH = 719; // where the page's own phone layout begins
  // A control a thumb can hit: the page holds this floor on every button, so the
  // card controls' smaller padding never shrinks one below it.
  const MIN_TAP_TARGET_PX = 44;
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;
  const viewportHeight = root.clientHeight;
  const isPhone = viewportWidth <= PHONE_WIDTH;
  const scrolling = document.scrollingElement || root;
  const rectOf = (element) => element.getBoundingClientRect();

  /**
   * The horizontal extent of everything a screen paints: the elements carrying
   * text or media, rather than the containers around them, so a full-width
   * background behind a centred column still measures as a column.
   */
  function paintedExtent() {
    let left = Infinity;
    let right = -Infinity;
    for (const element of [...document.querySelectorAll("body *")].slice(0, 1500)) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const carriesContent =
        ["IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(element.tagName) ||
        [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
      if (!carriesContent) continue;
      const rect = rectOf(element);
      if (rect.width === 0 || rect.height === 0) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    return { left, right };
  }

  /** What a control says it does: its own words, or the name given to it. */
  const controlName = (control) =>
    (control.innerText || control.value || control.getAttribute("aria-label") || "").trim();

  // A match on the Play screen is what the phone layout is measured with: both
  // heroes, the energy, the hand and the actions have to share the first screen,
  // and an empty board would measure none of them.
  if (!game.readState().match || game.readState().match.over) {
    try {
      game.startMatch();
    } catch (error) {
      fail(`a match could not be dealt to measure the screens with — ${error.message}`);
    }
  }

  for (const name of SCREENS) {
    game.showScreen(name);
    window.scrollTo(0, 0);

    // It has to fit: nothing sideways, and nothing painted past the edge.
    if (scrolling.scrollWidth > viewportWidth + 1) {
      fail(
        `the "${name}" screen scrolls sideways on a ${viewportWidth}px window: its content is ` +
          `${scrolling.scrollWidth}px wide, so part of it is off the right edge`
      );
    }
    const extent = paintedExtent();
    if (extent.right > viewportWidth + 1 && extent.left < viewportWidth) {
      fail(
        `the "${name}" screen paints ${Math.round(extent.right - viewportWidth)}px past the right edge of a ` +
          `${viewportWidth}px window, so part of it is cut off`
      );
    }

    // A large window has to be played on, not framed: the same screen in a
    // narrow column in the middle of it is the screen a phone gets, only smaller.
    if (!isPhone && extent.right > extent.left) {
      const span = (Math.min(viewportWidth, extent.right) - Math.max(0, extent.left)) / viewportWidth;
      if (span < 0.6) {
        fail(
          `the "${name}" screen uses ${Math.round(span * 100)}% of a ${viewportWidth}px window, so most of a ` +
            "large screen is left empty instead of being played on"
        );
      }
    }

    // And it has to be usable without a mouse: every control a real one, named,
    // and reachable with Tab.
    const controls = [
      ...screen(name).querySelectorAll("button, a[href], input, select, textarea, [role='button']"),
    ].filter((control) => {
      const rect = rectOf(control);
      return rect.width > 0 && rect.height > 0;
    });
    if (!controls.length) {
      fail(`the "${name}" screen offers no control at all, so a visitor can do nothing from it`);
    }
    for (const control of controls) {
      const tag = control.tagName.toLowerCase();
      const label = controlName(control) || tag;
      if (!controlName(control)) {
        fail(`a ${tag} on the "${name}" screen has no name, so nobody can tell what pressing it does`);
      }
      if (!["button", "a", "input", "select", "textarea"].includes(tag)) {
        fail(
          `"${label}" on the "${name}" screen is a ${tag} rather than a real control, ` +
            "so a keyboard or a screen reader cannot operate it"
        );
      }
      if (control.tabIndex < 0) {
        fail(`"${label}" on the "${name}" screen cannot be reached with Tab, so it is unusable without a mouse`);
      }
    }

    // And it has to be hittable by a thumb. The height is what promises that,
    // whatever a button's own padding works out to, so the smallest card control
    // has to clear it as well as the rail's big actions.
    for (const button of screen(name).querySelectorAll("button")) {
      const height = rectOf(button).height;
      if (height === 0) continue;
      const label = controlName(button) || "a button";
      const floor = parseFloat(getComputedStyle(button).minHeight) || 0;
      if (floor < MIN_TAP_TARGET_PX || height < MIN_TAP_TARGET_PX) {
        fail(
          `the "${label}" button on the "${name}" screen is ${Math.round(height)}px tall with a ` +
            `${floor}px floor, so a thumb cannot hit it reliably — every button needs to reach ` +
            `${MIN_TAP_TARGET_PX}px`
        );
      }
    }

    // The controls that sit on a card face — a deck toggle, a card's Play — get
    // their own smaller padding and font, because a card holds many of them and
    // each has to read as quieter than the screen's own actions. Those sizes only
    // take effect if they outrank `.btn` in the cascade; when they do not, the
    // card control renders at exactly the rail's size and its size rules are dead.
    const cardControl = { collection: ".deck-toggle", play: ".match-play" }[name];
    const railButtons = [...screen(name).querySelectorAll(".actions .btn")].filter(
      (button) => rectOf(button).height > 0
    );
    if (cardControl && railButtons.length) {
      // The rail's largest button is the one a card control has to sit under: on
      // the play screen that is End turn, on the collection it is Back to home.
      const railSizes = railButtons.map((button) => parseFloat(getComputedStyle(button).fontSize));
      const railSize = Math.max(...railSizes);
      const railLabel = controlName(railButtons[railSizes.indexOf(railSize)]);
      const cardControls = [...screen(name).querySelectorAll(cardControl)].filter(
        (button) => rectOf(button).height > 0
      );
      if (!cardControls.length) {
        fail(`the "${name}" screen shows no ${cardControl} control, so its smaller size cannot be checked`);
      }
      const overridden = cardControls.filter(
        (button) => !(parseFloat(getComputedStyle(button).fontSize) < railSize)
      );
      if (overridden.length) {
        fail(
          `${overridden.length} of the ${cardControls.length} card controls on the "${name}" screen, such as ` +
            `"${controlName(overridden[0])}", render at ${railSize}px like the rail's "${railLabel}", so the ` +
            "smaller font-size they are given is being overridden by .btn"
        );
      }
    }
  }
  game.showScreen("play");
  window.scrollTo(0, 0);

  // Keyboard focus has to be visible wherever it lands. The rule is read from the
  // stylesheet rather than a focused control measured, because this suite clicks
  // a great deal — and after a click `:focus-visible` deliberately matches
  // nothing on a programmatic focus, so a focused control would answer the wrong
  // question.
  function focusRing() {
    const flatten = (rules) =>
      [...rules].flatMap((rule) => (rule.cssRules && rule.cssRules.length ? flatten(rule.cssRules) : [rule]));
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return flatten(sheet.cssRules);
      } catch {
        return []; // a stylesheet this page does not own is not this page's to answer for
      }
    });
    let ring = null;
    for (const rule of rules) {
      if (!rule.selectorText?.includes(":focus-visible")) continue;
      const declared = rule.style.outline || rule.style.boxShadow;
      if (declared) ring = declared; // the later rule wins, as it does in the cascade
    }
    return ring;
  }
  const ring = focusRing();
  if (!ring) {
    fail("no :focus-visible rule declares an outline, so a keyboard visitor cannot see which control has focus");
  } else if (/^(none|0)(\s|$)/.test(ring)) {
    fail(
      `the last :focus-visible rule leaves focus invisible (${ring}), so a keyboard visitor cannot see which control has focus`
    );
  }

  // The deck's toggle says which way it will go, so whether a card is in the
  // deck is read from its label rather than from the colour of its keyline.
  const deckToggles = [...document.querySelectorAll(".deck-toggle")];
  if (!deckToggles.length) {
    fail("the collection screen offers no deck toggle, so a card cannot be added to the deck");
  }
  for (const toggle of deckToggles) {
    const label = textOf(toggle);
    if (!/^(Add|Remove) .+ (to|from) deck$/.test(label)) {
      fail(
        `a deck toggle does not say what pressing it will do: it reads "${label || "(nothing)"}" ` +
          "instead of naming the card and whether it is added or removed"
      );
    }
  }

  // --- The match fits a phone in portrait -----------------------------------

  if (isPhone) {
    const live = game.readState().match;
    if (!live || live.over) {
      fail("no live match could be dealt, so the match's layout on a phone cannot be checked");
    } else {
      const bar = document.querySelector("#screen-play .actions");
      const barTop = bar ? rectOf(bar).top : viewportHeight;
      for (const [what, element] of [
        ["your health", document.getElementById("match-player-health")],
        ["the opponent's health", document.getElementById("match-opponent-health")],
        ["your energy", document.getElementById("match-energy")],
        ["your hand", document.getElementById("match-hand")],
        ["End turn", document.getElementById("action-end-turn")],
      ]) {
        if (!element || element.hidden) {
          fail(`${what} is not on the match screen, so a phone cannot show it on the first screen`);
          continue;
        }
        const bottom = rectOf(element).bottom;
        if (bottom > viewportHeight + 1) {
          fail(
            `${what} ends ${Math.round(bottom - viewportHeight)}px below the fold on a ` +
              `${viewportWidth}x${viewportHeight} phone, so a match cannot be read without scrolling`
          );
        }
      }
      const hand = document.getElementById("match-hand");
      if (hand && rectOf(hand).bottom > barTop + 1) {
        fail(
          `the hand reaches ${Math.round(rectOf(hand).bottom)}px while the action bar starts at ` +
            `${Math.round(barTop)}px, so the bar covers the cards a player has to press`
        );
      }
    }
  }

  return problems;
}
