/**
 * Check that selfgrow still opens on a home screen that says what the game is
 * and where the player stands, that every new player is dealt a starter
 * collection which survives closing the page, that a match is dealt against a
 * named opponent who brings a deck of their own rather than a copy of the
 * player's, that a match in progress is saved as it changes so the home screen
 * can offer to continue it, that a match played to the last blow ends with a
 * result both a player and an agent can read, that a collection card's parts
 * stay in their own column at a phone's width with nothing off the edge, and
 * that an agent reads and drives that same surface rather than a second one
 * nobody can see.
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
  const cardCatalog = await import("./cards.js");
  // The ability a card's face carries, as docs/cards.js writes it — null for a
  // card that does nothing when played. Every surface that reports a card is
  // held to this one answer.
  const catalogAbility = (id) => cardCatalog.CARD_BY_ID.get(id)?.ability ?? null;
  // The ability a card carries for when it falls, read the same way — null for a
  // card that does nothing as it leaves the table.
  const catalogFallAbility = (id) => cardCatalog.CARD_BY_ID.get(id)?.fallAbility ?? null;
  const snapshot = game.readCollection();
  // The Collection screen now shows the whole card set, so `snapshot.cards` is
  // every card in the game. The checks that speak of what the player holds read
  // `ownedCards`; `owned` keeps the shape they were written against.
  const owned = { ...snapshot, cards: snapshot.ownedCards };

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

  // The home screen's next-win block as a visitor reads it: the heading, and —
  // while a reward card remains — that card's picture, name and three numbers.
  const readNextReward = () => {
    const section = home.querySelector("#next-reward");
    const figure = section?.querySelector(".award-card");
    const stats = figure?.querySelector(".award-card-stats");
    return {
      section,
      heading: textOf(section?.querySelector("h3")),
      hasFigure: Boolean(figure),
      cardId: figure?.dataset.cardId ?? null,
      name: textOf(figure?.querySelector(".award-card-name")),
      stats: textOf(stats),
      statsLabel: stats?.getAttribute("aria-label") ?? "",
      pictureName: figure?.querySelector(".card-art")?.getAttribute("aria-label") ?? null,
    };
  };

  // What the home screen shows for the next win must be the same card the state
  // reports — the card a win actually awards — so the promise and the reward
  // cannot drift apart.
  const checkNextRewardShown = () => {
    const live = game.readState();
    const shown = readNextReward();
    if (!shown.section) {
      fail("the home screen has no place for the card the next win will add (#next-reward)");
      return;
    }
    // The state's next card must be the one shared choice a win awards by, so the
    // home screen's promise can never drift from the reward.
    if (typeof collection.nextRewardId === "function") {
      const expectedId = collection.nextRewardId(game.readCollection().ownedCards);
      if (expectedId !== (live.nextReward?.id ?? null)) {
        fail(
          `the state's next-win card is "${live.nextReward?.id ?? null}" while the shared reward choice ` +
            `names "${expectedId}", so the promise and the award can disagree`
        );
      }
    }
    if (typeof game.nextRewardHeadingText === "function") {
      const expected = game.nextRewardHeadingText(live.nextRewardComplete);
      if (shown.heading !== expected) {
        fail(`the home screen's next-win heading reads "${shown.heading}" instead of "${expected}"`);
      }
    }
    if (live.nextRewardComplete) {
      if (shown.hasFigure) {
        fail("the home screen shows a next-win card although the player owns every reward card");
      }
      return;
    }
    const card = live.nextReward;
    if (!card) {
      fail("the home screen promises no next card while the state says one is left to earn");
      return;
    }
    if (shown.cardId !== card.id) {
      fail(`the home screen's next-win card is "${shown.cardId}" while the state says "${card.id}"`);
    }
    if (shown.name !== card.name) {
      fail(`the home screen names its next-win card "${shown.name}" while the state says "${card.name}"`);
    }
    const numbers = `${card.cost}/${card.attack}/${card.health}`;
    if (shown.stats !== numbers) {
      fail(
        `the home screen's next-win card reads "${shown.stats}" instead of "${numbers}" ` +
          "(cost/attack/health)"
      );
    }
    if (shown.statsLabel !== `cost ${card.cost}, attack ${card.attack}, health ${card.health}`) {
      fail(`the home screen's next-win numbers are not their own labelled values: "${shown.statsLabel}"`);
    }
    if (shown.pictureName !== card.name) {
      fail(
        `the home screen's next-win picture is described as "${shown.pictureName}" instead of the ` +
          `card's own name "${card.name}"`
      );
    }
  };

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

  // Collecting is the point of the game, so how much of the set is collected
  // sits on the first screen — the same number the Collection screen prints.
  const homeCollected = home.querySelector('[data-field="distinctCards"]')?.closest(".standing");
  if (!homeCollected) {
    fail('the home screen does not show how many different cards are collected (nothing carries data-field="distinctCards")');
  } else {
    const homeCollectedValue = textOf(homeCollected.querySelector(".standing-value"));
    const homeCollectedLabel = textOf(homeCollected.querySelector(".standing-label"));
    const expectedCollected = `${owned.distinctCards} of ${cardCatalog.CARDS.length}`;
    if (!homeCollected.closest("dl")) {
      fail(
        "the cards-collected number is not in a description list beside a label, so it is read without what it counts"
      );
    }
    if (!homeCollectedLabel.toLowerCase().includes("collect")) {
      fail(
        `the home screen's count of cards collected is labelled "${homeCollectedLabel || "(nothing)"}", which does not say what it counts`
      );
    }
    if (homeCollectedValue !== expectedCollected) {
      fail(
        `the home screen says "${homeCollectedValue || "(nothing)"}" where the player has collected ` +
          `${expectedCollected} different cards`
      );
    }

    // The Collection screen shows the same figure, so the two screens a player
    // reads the set on can never tell them different things.
    const shownOnCollection = textOf(
      document
        .querySelector('#screen-collection [data-field="distinctCards"]')
        ?.closest(".standing")
        ?.querySelector(".standing-value")
    );
    if (shownOnCollection && shownOnCollection !== homeCollectedValue) {
      fail(
        `the home screen says "${homeCollectedValue}" cards collected while the Collection screen says ` +
          `"${shownOnCollection}" — the two disagree`
      );
    }
  }

  const deckSizeValue = home.querySelector('[data-field="deckSize"]');
  if (!deckSizeValue) {
    fail('the home screen does not show deck size (nothing carries data-field="deckSize")');
  } else {
    if (!deckSizeValue.closest("dl")) {
      fail("the deck size number is not in a description list beside a label, so it is read without what it counts");
    }
    if (!home.textContent.toLowerCase().includes("deck size")) {
      fail("the home screen gives a number for deck size without naming it anywhere");
    }
    const shown = Number(textOf(deckSizeValue));
    if (!Number.isInteger(shown)) {
      fail(`deck size shows "${textOf(deckSizeValue)}" — a count has to be a whole number`);
    } else if (shown !== state.deckSize) {
      fail(`deck size shows ${shown} while the page's state says ${state.deckSize} — the card and the state have drifted apart`);
    }
  }

  // A first visit is dealt a ready-to-play deck built from the starter
  // collection, so Play and Start match work without a trip to the Collection.
  if (state.deckSize !== 10) {
    fail(`a first visit should open with a ready-to-play deck of ten cards, but the page reports ${state.deckSize}`);
  }
  if (state.deckSize < state.minimumDeckSize) {
    fail(
      `a first visit's deck holds ${state.deckSize} card(s), fewer than the ${state.minimumDeckSize} a match needs, ` +
        "so a new player could not start a match"
    );
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

  // --- The Collection screen prints the whole set, owned and not --------------

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
    const ownedRows = [...list.querySelectorAll(".owned-card")];
    if (ownedRows.length !== owned.distinctCards) {
      fail(
        `the collection screen marks ${ownedRows.length} card(s) as owned while the player owns ${owned.distinctCards} different one(s)`
      );
    }

    const rowsById = new Map(ownedRows.map((row) => [row.dataset.cardId, row]));
    for (const card of owned.cards) {
      const row = rowsById.get(card.id);
      if (!row) {
        fail(`the collection screen does not mark "${card.name}" as owned, though the player holds it`);
        continue;
      }
      const name = textOf(row.querySelector(".card-face-name"));
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

    const firstRow = ownedRows[0];
    if (firstRow) {
      const labels = [...firstRow.querySelectorAll(".card-face-stat dt")].map(textOf);
      for (const label of ["Cost", "Attack", "Health"]) {
        if (!labels.includes(label)) {
          fail(`an owned card's numbers are not labelled: expected a "${label}" label, found ${labels.join(", ") || "none"}`);
        }
      }
    }

    // --- The whole set, not only what is owned -------------------------------

    // Every card in the game appears exactly once, so a player sees the set they
    // are collecting toward and not only the cards they already hold.
    const setIds = cardCatalog.CARDS.map((card) => card.id);
    const rowIds = [...list.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);
    const missingFromSet = setIds.filter((id) => !rowIds.includes(id));
    const notInGame = rowIds.filter((id) => !setIds.includes(id));
    if (missingFromSet.length) {
      fail(
        `the collection screen does not show ${missingFromSet.join(", ")}, so the set a player is collecting toward is incomplete`
      );
    }
    if (notInGame.length) {
      fail(`the collection screen lists ${notInGame.join(", ")} — not cards in the game`);
    }
    if (new Set(rowIds).size !== rowIds.length) {
      fail(`the collection screen shows the same card more than once: ${rowIds.join(", ")}`);
    }

    // A card the player does not hold is marked as not collected and offers no
    // way into a deck; a card they do hold carries the deck controls.
    const heldIds = new Set(owned.cards.map((card) => card.id));
    for (const row of list.querySelectorAll("[data-card-id]")) {
      const id = row.dataset.cardId;
      const name = cardCatalog.CARD_BY_ID.get(id)?.name ?? id;
      const held = heldIds.has(id);
      if (held && !row.classList.contains("owned-card")) {
        fail(`the collection screen does not mark "${name}" as owned, though the player holds it (class "${row.className}")`);
      }
      if (!held && !row.classList.contains("unowned-card")) {
        fail(`the collection screen does not mark "${name}" as not yet collected (class "${row.className}")`);
      }
      if (!held && row.querySelector(".deck-add, .deck-remove")) {
        fail(`"${name}" is not collected yet, but the collection screen offers a deck control for it`);
      }
      if (!held && !textOf(row).includes("Not yet collected")) {
        fail(`"${name}" is not collected yet but the screen does not say so: it reads "${textOf(row)}"`);
      }
    }

    // How much of the set is collected, as a labelled number out of the total.
    const collectedStanding = document
      .querySelector('#screen-collection [data-field="distinctCards"]')
      ?.closest(".standing");
    if (!collectedStanding) {
      fail("the collection screen does not state how many different cards of the game you have collected");
    } else {
      const collectedValue = textOf(collectedStanding.querySelector(".standing-value"));
      const collectedLabel = textOf(collectedStanding.querySelector(".standing-label"));
      const expectedCollected = `${owned.distinctCards} of ${cardCatalog.CARDS.length}`;
      if (collectedValue !== expectedCollected) {
        fail(
          `the collection screen says "${collectedValue || "(nothing)"}" where the player has collected ` +
            `${expectedCollected} different cards`
        );
      }
      if (!collectedLabel.toLowerCase().includes("collect")) {
        fail(`the count of cards collected is labelled "${collectedLabel || "(nothing)"}", which does not say what it counts`);
      }
    }
  }

  // --- Every card has its own picture, in the one shared style ----------------

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

    // --- Every card a win can award is a real, unowned, pictured reward ------

    // A win is the only way to own a reward card, so the pool is the whole of
    // what collecting offers. Each one must be a card the game can play (in the
    // catalog), a card the player cannot already have (absent from the starter
    // collection), and a card a player can know by sight (a described drawing).
    const rewardPool = cardCatalog.REWARD_POOL;
    const starterIds = new Set(cardCatalog.STARTER_COLLECTION.map((entry) => entry.id));
    if (rewardPool.length < 3) {
      fail(`the game offers only ${rewardPool.length} reward card(s), so a win stops being something new too soon`);
    }
    for (const id of rewardPool) {
      const card = cardCatalog.CARD_BY_ID.get(id);
      if (!card) {
        fail(`the reward pool names "${id}", which is not a card in the game, so a win cannot award it`);
        continue;
      }
      if (starterIds.has(id)) {
        fail(`"${card.name}" is a reward card but is also dealt at the start, so a win for it is not something new`);
      }
      const art = cardArt.cardArt(id);
      if (!art || !(art.inner || "").trim()) {
        fail(`the reward card "${card.name}" has no picture, so the card a win earns cannot be known by sight`);
      } else if (!art.description?.trim()) {
        fail(`the reward card "${card.name}"'s picture is not described, so it cannot be checked against the style`);
      }
    }

    // Every card is obtainable: either dealt at the start or earned by winning.
    // A card in the catalog that is in neither is a card no player can ever own.
    const rewardIds = new Set(rewardPool);
    for (const card of cardCatalog.CARDS) {
      if (!starterIds.has(card.id) && !rewardIds.has(card.id)) {
        fail(
          `"${card.name}" is in the card catalog but neither in the starting collection nor in the reward pool, ` +
            "so no player can ever own it"
        );
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

    for (const row of document.querySelectorAll("#collection-list .owned-card, #collection-list .unowned-card")) {
      const name = textOf(row.querySelector(".card-face-name")) || row.dataset.cardId;
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

  // --- The card a win earns is shown as the card itself ----------------------

  // A reward is the reason a match is played again, so it is shown as the card
  // a player will recognise, not only named. Built from a known reward card so
  // this holds regardless of which card the match happened to award.
  const rewardCard = cardCatalog.CARD_BY_ID.get(cardCatalog.REWARD_POOL[0]);
  if (typeof game.awardCardFigure !== "function") {
    fail("app.js does not export awardCardFigure, so the card a win earns cannot be shown as a card");
  } else {
    const figure = game.awardCardFigure(rewardCard);
    if (figure.dataset.cardId !== rewardCard.id) {
      fail(`the earned-card figure is labelled "${figure.dataset.cardId}" instead of the awarded card "${rewardCard.id}"`);
    }
    const picture = figure.querySelector(".card-art");
    if (!picture) {
      fail(`the earned-card figure for "${rewardCard.name}" shows no picture`);
    } else if (picture.getAttribute("aria-label") !== rewardCard.name) {
      fail(`the earned card's picture is announced as "${picture.getAttribute("aria-label")}" instead of "${rewardCard.name}"`);
    }
    if (figure.querySelector(".award-card-name")?.textContent !== rewardCard.name) {
      fail(`the earned-card figure does not name the awarded card "${rewardCard.name}"`);
    }
    const numbers = `${rewardCard.cost}/${rewardCard.attack}/${rewardCard.health}`;
    const stats = figure.querySelector(".award-card-stats");
    if (stats?.textContent !== numbers) {
      fail(`the earned-card figure reads "${stats?.textContent}" instead of the awarded card's "${numbers}"`);
    }
    if (stats.getAttribute("aria-label") !== `cost ${rewardCard.cost}, attack ${rewardCard.attack}, health ${rewardCard.health}`) {
      fail(`the earned card's numbers are not their own labelled values: "${stats.getAttribute("aria-label")}"`);
    }
  }

  // --- The next win's card is shown before the match -------------------------

  // A win's card is already decided when the home screen is on: the same card the
  // state reports is the one the win will add, shown as the card itself under a
  // short heading, so a player can see the goal rather than only the count.
  checkNextRewardShown();

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
  if (replayed.setComplete) {
    fail("re-recording a match reported the collection as complete, though the replay earned no card");
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

  // --- A win earns a card you do not own yet ---------------------------------

  // A win prefers a reward card the player holds none of, rather than the next
  // card in the cycle. This save holds every reward card but the last, and has
  // exactly as many wins behind it as the pool is long — so the old cycle would
  // hand back the first reward card, which the save already owns, while a win
  // that prefers what is unowned earns the one it does not have.
  const pool = cardCatalog.REWARD_POOL;
  const heldRewards = pool.slice(0, -1);
  const unownedReward = pool[pool.length - 1];
  const winsBehind = pool.length;
  const partialRewards = stubStorage({
    [collection.STORAGE_KEY]: JSON.stringify({
      version: 1,
      cards: [
        ...owned.cards.map(({ id, copies }) => ({ id, copies })),
        ...heldRewards.map((id) => ({ id, copies: 1 })),
      ],
      deck: [],
      wins: winsBehind,
      matches: winsBehind,
      lastMatchId: "match-earlier",
    }),
  });
  const wonUnowned = collection.recordResult("win", "match-next", partialRewards);
  if (wonUnowned.awarded?.id !== unownedReward) {
    fail(
      `a win against a save owning ${JSON.stringify(heldRewards)} but not "${unownedReward}" awarded ` +
        `"${wonUnowned.awarded?.id}" instead of the card it did not own`
    );
  }
  if (wonUnowned.setComplete) {
    fail("a win with a reward card still unowned reported the whole collection as complete");
  }
  const partialCards = collection.readCollection(partialRewards);
  if ((partialCards.find((card) => card.id === unownedReward)?.copies ?? 0) !== 1) {
    fail(
      `the unowned reward "${unownedReward}" a win added was not saved once: ` + JSON.stringify(partialCards)
    );
  }
  const untouchedRewards = heldRewards.filter(
    (id) => (partialCards.find((card) => card.id === id)?.copies ?? 0) !== 1
  );
  if (untouchedRewards.length) {
    fail(`a win changed the copies owned of ${JSON.stringify(untouchedRewards)}, though it may only add one card`);
  }

  // --- Once every card is owned, a win adds a duplicate and says so ----------

  // The whole set is held, so there is nothing new left to earn: the win falls
  // back to the cycle — a reward card the player already owns — and reports the
  // collection as complete instead of claiming a new card.
  const fullRewards = stubStorage({
    [collection.STORAGE_KEY]: JSON.stringify({
      version: 1,
      cards: [
        ...owned.cards.map(({ id, copies }) => ({ id, copies })),
        ...pool.map((id) => ({ id, copies: 1 })),
      ],
      deck: [],
      wins: 5,
      matches: 5,
      lastMatchId: "match-earlier",
    }),
  });
  const completeCards = collection.readCollection(fullRewards);
  const completeSize = collection.collectionSize(completeCards);
  const wonComplete = collection.recordResult("win", "match-complete", fullRewards);
  if (!wonComplete.setComplete) {
    fail("a win against a save owning every card in the game did not report the collection as complete");
  }
  if (!wonComplete.awarded || !pool.includes(wonComplete.awarded.id)) {
    fail(
      `a win on a complete collection awarded ${JSON.stringify(wonComplete.awarded)} instead of a reward card`
    );
  } else {
    const ownedBefore = completeCards.find((card) => card.id === wonComplete.awarded.id)?.copies ?? 0;
    const ownedAfter = wonComplete.cards.find((card) => card.id === wonComplete.awarded.id)?.copies ?? 0;
    if (ownedBefore < 1) {
      fail(`a win on a complete collection awarded "${wonComplete.awarded.id}", which the player did not own`);
    }
    if (ownedAfter !== ownedBefore + 1) {
      fail(
        `a win on a complete collection left ${ownedAfter} copies of "${wonComplete.awarded.id}" instead of one ` +
          `duplicate on top of the ${ownedBefore} owned`
      );
    }
  }
  if (collection.collectionSize(wonComplete.cards) !== completeSize + 1) {
    fail(
      `a win on a complete collection added ${collection.collectionSize(wonComplete.cards) - completeSize} card(s) ` +
        "instead of exactly one duplicate"
    );
  }

  // The result's own words: a completed collection says so, and does not claim a
  // new card; a win that earned a card the player did not own still says it was
  // new. Read from the same function the result panel uses, so what is checked
  // here is what a player reads.
  if (typeof game.awardLabelText !== "function") {
    fail("app.js does not export awardLabelText, so the result's words for an earned card cannot be checked");
  } else {
    const completeWords = game.awardLabelText(true);
    const newCardWords = game.awardLabelText(false);
    if (!completeWords.toLowerCase().includes("complete")) {
      fail(`a completed collection's result does not say the set is complete: it reads "${completeWords}"`);
    }
    if (completeWords.toLowerCase().includes("new card")) {
      fail(`a completed collection's result claims a new card was added: it reads "${completeWords}"`);
    }
    if (!newCardWords.toLowerCase().includes("new card")) {
      fail(`a win that earned an unowned card does not say it was new: it reads "${newCardWords}"`);
    }
    if (newCardWords === completeWords) {
      fail("the result says the same thing whether or not a new card was earned");
    }
  }

  // --- The card the last win added, told apart from the rest of the set -------

  // A win's reward stops being visible the moment the result is left behind, so
  // the card a fresh win added is marked where the set is listed. Which card that
  // is has to be one answer: a win that added a card the player did not own marks
  // it, and a loss, a win whose only card was a duplicate, and a page with no
  // result yet all mark nothing.
  if (typeof game.newlyCollectedId !== "function") {
    fail(
      "app.js does not export newlyCollectedId, so the card the last win added cannot be told apart " +
        "from the rest of the set"
    );
  } else {
    const rewardId = cardCatalog.REWARD_POOL[0];
    for (const [what, result, expected] of [
      ["a win that added a card the player did not own", { outcome: "win", awarded: { id: rewardId }, setComplete: false }, rewardId],
      ["a win whose only card was a duplicate", { outcome: "win", awarded: { id: rewardId }, setComplete: true }, null],
      ["a loss", { outcome: "loss", awarded: null, setComplete: false }, null],
      ["a win that awarded nothing", { outcome: "win", awarded: null }, null],
      ["no result at all", null, null],
    ]) {
      const marked = game.newlyCollectedId(result);
      if (marked !== expected) {
        fail(
          `after ${what} the newly collected card reads ${JSON.stringify(marked)} instead of ${JSON.stringify(expected)}`
        );
      }
    }
  }

  // --- The card the next win will add, decided in one place -----------------

  // The home screen promises the card the next win will add; a win must award
  // exactly that card, so both read the one choice rather than each deriving it
  // and the promise quietly drifting from the reward.
  if (typeof collection.nextRewardId !== "function") {
    fail(
      "collection.js does not export nextRewardId, so the home screen's next-win card and a win's " +
        "award cannot be one choice"
    );
  } else {
    const promisedStore = stubStorage();
    // A controlled starting point with no reward card held, so the first win has
    // something new to earn regardless of what the browser happened to save.
    const baseCards = cardCatalog.STARTER_COLLECTION.map(({ id, copies }) => ({ id, copies }));
    collection.saveCollection(baseCards, promisedStore);
    const promised = collection.nextRewardId(baseCards);
    const award = collection.recordResult("win", "match-promise", promisedStore);
    if (!promised || promised !== award.awarded?.id) {
      fail(
        `the home screen would promise "${promised}" as the next win's card while the win awarded ` +
          `"${award.awarded?.id}", so the promise and the reward disagree`
      );
    }

    // A win moves the goal on: the next-win card becomes the following card not
    // yet owned, never the one just earned and never a duplicate while any remain.
    const heldAfterWin = collection.readCollection(promisedStore) ?? [];
    const following = collection.nextRewardId(heldAfterWin);
    if (following === promised) {
      fail(`after a win earned "${promised}" the next-win card is still "${following}", so the goal never moves`);
    }
    if (following !== null && heldAfterWin.some((card) => card.id === following)) {
      fail(
        `the next-win card after that win ("${following}") is one the player already owns, so it is not left ` +
          "to earn"
      );
    }

    // Once every reward card is held there is no next card at all — the home
    // screen's cue to say the set is complete rather than promise a duplicate.
    const everything = baseCards.concat(pool.map((id) => ({ id, copies: 1 })));
    if (collection.nextRewardId(everything) !== null) {
      fail(
        `with every reward card held the next-win card is still ` +
          `"${collection.nextRewardId(everything)}" instead of none`
      );
    }
  }

  // The word over the card says what the next win earns, and — once the whole
  // reward pool is held — says the set is complete instead.
  if (typeof game.nextRewardHeadingText !== "function") {
    fail("app.js does not export nextRewardHeadingText, so the word over the next-win card cannot be checked");
  } else {
    const completeHeading = game.nextRewardHeadingText(true);
    const nextHeading = game.nextRewardHeadingText(false);
    if (!completeHeading.toLowerCase().includes("complete")) {
      fail(`with the set complete the next-win heading reads "${completeHeading}", which does not say so`);
    }
    if (nextHeading.toLowerCase().includes("complete")) {
      fail(`with a card left to earn the next-win heading reads "${nextHeading}", claiming the set is complete`);
    }
    if (nextHeading === completeHeading) {
      fail("the next-win heading says the same thing whether or not the set is complete");
    }
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

  // --- How you have fared against each opponent -----------------------------

  // Each opponent brings a deck of its own and plays it its own way, so which of
  // them has been beaten is worth knowing. The record lives in the save beside
  // the cards, and a result moves only the opponent it was fought against.
  const recordStore = stubStorage();
  collection.saveCollection(owned.cards, recordStore);
  const [firstOpponent, secondOpponent] = cardCatalog.OPPONENTS ?? [];

  if (!firstOpponent || !secondOpponent) {
    fail(
      `the game offers ${(cardCatalog.OPPONENTS ?? []).length} opponent(s), so a record against one cannot be ` +
        "told apart from a record against another"
    );
  } else {
    const firstWin = collection.recordResult("win", "record-win-1", recordStore, firstOpponent.id);
    if (firstWin.firstWin !== true) {
      fail(
        `a first win against "${firstOpponent.id}" reported firstWin ${firstWin.firstWin}, so the result screen ` +
          "would not mark it as a first"
      );
    }
    const firstRecord = firstWin.opponents?.[firstOpponent.id];
    if (firstRecord?.wins !== 1 || firstRecord?.matches !== 1) {
      fail(
        `a first win against "${firstOpponent.id}" left the record ${JSON.stringify(firstRecord)} instead of ` +
          "{ wins: 1, matches: 1 }"
      );
    }
    if (firstWin.opponents?.[secondOpponent.id]) {
      fail(
        `a win against "${firstOpponent.id}" also gave "${secondOpponent.id}" the record ` +
          `${JSON.stringify(firstWin.opponents[secondOpponent.id])}, though the match was not against it`
      );
    }

    // A second win is not a first, and a loss counts the match without counting a
    // win — and neither moves the other opponent's record.
    const secondWin = collection.recordResult("win", "record-win-2", recordStore, firstOpponent.id);
    if (secondWin.firstWin !== false) {
      fail(
        `a second win against "${firstOpponent.id}" reported firstWin ${secondWin.firstWin}, so a repeat win ` +
          "would be announced as a first"
      );
    }
    const lostToSecond = collection.recordResult("loss", "record-loss-1", recordStore, secondOpponent.id);
    if (lostToSecond.firstWin) {
      fail(`a loss against "${secondOpponent.id}" reported a first win, though the match was lost`);
    }
    const firstAfter = lostToSecond.opponents?.[firstOpponent.id];
    const secondAfter = lostToSecond.opponents?.[secondOpponent.id];
    if (firstAfter?.wins !== 2 || firstAfter?.matches !== 2) {
      fail(
        `after two wins and a loss the record against "${firstOpponent.id}" reads ${JSON.stringify(firstAfter)} ` +
          "instead of { wins: 2, matches: 2 }"
      );
    }
    if (secondAfter?.wins !== 0 || secondAfter?.matches !== 1) {
      fail(
        `after a loss the record against "${secondOpponent.id}" reads ${JSON.stringify(secondAfter)} instead of ` +
          "{ wins: 0, matches: 1 }"
      );
    }

    // The same match recorded again — a result screen asked for twice — moves
    // neither opponent's record. The id remembered is the last result recorded,
    // so the loss just counted is the one replayed here.
    const replayedRecord = collection.recordResult("loss", "record-loss-1", recordStore, secondOpponent.id);
    if (replayedRecord.recorded || replayedRecord.firstWin) {
      fail(
        `recording the same match twice reported it ${replayedRecord.recorded ? "recorded" : "unrecorded"} with ` +
          `firstWin ${replayedRecord.firstWin}, so a revisited result would count twice`
      );
    }
    if (JSON.stringify(replayedRecord.opponents?.[secondOpponent.id]) !== JSON.stringify(secondAfter)) {
      fail(
        `recording the same match twice changed the record against "${secondOpponent.id}" from ` +
          `${JSON.stringify(secondAfter)} to ${JSON.stringify(replayedRecord.opponents?.[secondOpponent.id])}`
      );
    }
    if (JSON.stringify(replayedRecord.opponents?.[firstOpponent.id]) !== JSON.stringify(firstAfter)) {
      fail(
        `recording the same match twice changed the record against "${firstOpponent.id}" from ` +
          `${JSON.stringify(firstAfter)} to ${JSON.stringify(replayedRecord.opponents?.[firstOpponent.id])}`
      );
    }

    // It survives closing the page: the same records read back from the save.
    const savedRecords = collection.readProgress(recordStore).opponents;
    if (JSON.stringify(savedRecords?.[firstOpponent.id]) !== JSON.stringify({ wins: 2, matches: 2 })) {
      fail(
        `the record against "${firstOpponent.id}" did not survive a save and load: it read back ` +
          `${JSON.stringify(savedRecords?.[firstOpponent.id])} instead of { wins: 2, matches: 2 }`
      );
    }
    if (JSON.stringify(savedRecords?.[secondOpponent.id]) !== JSON.stringify({ wins: 0, matches: 1 })) {
      fail(
        `the record against "${secondOpponent.id}" did not survive a save and load: it read back ` +
          `${JSON.stringify(savedRecords?.[secondOpponent.id])} instead of { wins: 0, matches: 1 }`
      );
    }

    // Changing the deck writes the same save, so it must carry the records with
    // it rather than leaving the player who has been beaten behind.
    collection.saveDeck(collection.readCollection(recordStore), ["sprout"], recordStore);
    const afterDeckSave = collection.readProgress(recordStore).opponents;
    if (JSON.stringify(afterDeckSave?.[firstOpponent.id]) !== JSON.stringify({ wins: 2, matches: 2 })) {
      fail(
        `saving the deck forgot the record against "${firstOpponent.id}": it reads ` +
          `${JSON.stringify(afterDeckSave?.[firstOpponent.id])} instead of { wins: 2, matches: 2 }`
      );
    }

    // A save written before opponents were recorded reads as a player who has
    // faced nobody yet, rather than as a broken record.
    const beforeOpponents = collection.readProgress(olderSave).opponents;
    if (!beforeOpponents || Object.keys(beforeOpponents).length) {
      fail(
        `a save written before opponents were recorded read back ${JSON.stringify(beforeOpponents)} instead of no ` +
          "records at all"
      );
    }

    // And a junk record is cleaned up rather than reaching the screen: a wins
    // count above the matches played, and an opponent this game does not have.
    const junkRecords = stubStorage({
      [collection.STORAGE_KEY]: JSON.stringify({
        version: 1,
        cards: owned.cards.map(({ id, copies }) => ({ id, copies })),
        deck: [],
        opponents: {
          [firstOpponent.id]: { wins: 9, matches: 2 },
          "no-such-opponent": { wins: 4, matches: 4 },
        },
      }),
    });
    const cleanedRecords = collection.readProgress(junkRecords).opponents;
    const cleanedFirst = cleanedRecords?.[firstOpponent.id];
    if (!cleanedFirst || cleanedFirst.matches !== 2 || cleanedFirst.wins > cleanedFirst.matches) {
      fail(
        `a saved record of { wins: 9, matches: 2 } read back as ${JSON.stringify(cleanedFirst)} instead of two ` +
          "matches with at most two wins, so a junk record reaches the screen"
      );
    }
    if (cleanedRecords?.["no-such-opponent"]) {
      fail(
        `a save naming the unknown opponent "no-such-opponent" kept a record for it ` +
          `(${JSON.stringify(cleanedRecords["no-such-opponent"])}), which nobody can face`
      );
    }
  }

  // What the picker prints under each character must be the record the state
  // carries, so a visitor and an agent read the same history — and a beaten
  // opponent is marked by a word rather than by colour alone.
  if (typeof game.opponentRecordText !== "function") {
    fail("app.js does not export opponentRecordText, so the picker's record line cannot be checked");
  } else {
    const liveWithRecords = game.readState();
    const recordOptions = [
      ...(document.getElementById("opponent-options")?.querySelectorAll(".opponent-option") ?? []),
    ];
    if (recordOptions.length !== liveWithRecords.opponents.length) {
      fail(
        `the picker draws ${recordOptions.length} opponent option(s) while the state lists ` +
          `${liveWithRecords.opponents.length}`
      );
    }
    for (const opponent of liveWithRecords.opponents) {
      const record = opponent.record;
      if (!record || !Number.isSafeInteger(record.wins) || !Number.isSafeInteger(record.matches)) {
        fail(
          `the state carries no readable record against "${opponent.id}" (${JSON.stringify(record)}), so an ` +
            "agent cannot tell how the player has fared against it"
        );
        continue;
      }
      if (record.beaten !== record.wins > 0) {
        fail(
          `the state says "${opponent.id}" beaten: ${record.beaten} with ${record.wins} win(s), so whether the ` +
            "opponent has been beaten is not read from the wins"
        );
      }
      const option = recordOptions.find((entry) => entry.dataset.opponentId === opponent.id);
      const line = option?.querySelector(".opponent-record");
      if (!line) {
        fail(
          `the picker's option for "${opponent.name}" shows no record line (.opponent-record), so a player ` +
            "choosing who to face cannot see how they have fared against it"
        );
        continue;
      }
      const expectedRecord = game.opponentRecordText(record.wins, record.matches);
      if (textOf(line) !== expectedRecord) {
        fail(
          `the picker's record for "${opponent.name}" reads "${textOf(line)}" while its ${record.wins} win(s) ` +
            `of ${record.matches} match(es) read as "${expectedRecord}"`
        );
      }
      if (line.classList.contains("opponent-record-beaten") !== record.wins > 0) {
        fail(
          `the picker's record for "${opponent.name}" is ${record.wins > 0 ? "not" : ""} marked beaten with ` +
            `${record.wins} win(s) against it`
        );
      }
    }

    // The words themselves: a first meeting reads as one, and an opponent beaten
    // says so in words rather than only in a colour.
    const noMeeting = game.opponentRecordText(0, 0);
    const unbeaten = game.opponentRecordText(0, 2);
    const beaten = game.opponentRecordText(1, 2);
    if (!/no match/i.test(noMeeting)) {
      fail(`an opponent never faced reads "${noMeeting}", which does not say there are no matches yet`);
    }
    if (!unbeaten.includes("0") || !unbeaten.includes("2")) {
      fail(`an opponent faced twice and never beaten reads "${unbeaten}", which does not say 0 of 2 matches won`);
    }
    if (!/beaten/i.test(beaten)) {
      fail(`an opponent beaten once reads "${beaten}", which does not say so in words`);
    }
    if (beaten.toLowerCase() === unbeaten.toLowerCase()) {
      fail("an opponent beaten once and one never beaten read the same record, so the mark carries nothing");
    }
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
  const heldCopies = (id) => deckIds().filter((held) => held === id).length;
  const ownedCopies = (id) => owned.cards.find((card) => card.id === id)?.copies ?? 0;
  const addControl = (id) => document.querySelector(`[data-deck-add="${id}"]`);
  const removeControl = (id) => document.querySelector(`[data-deck-remove="${id}"]`);

  // The deck's cost curve, read the two ways the change promises: as the state
  // an agent asks for, and as the labelled rows a visitor sees under the deck.
  const curveBlock = () => document.getElementById("deck-curve");
  const curve = () => game.readState().deckCurve;
  const curveRows = () => {
    const block = curveBlock();
    return block ? [...block.querySelectorAll(".deck-curve-row")] : [];
  };
  const curveSum = () => (curve() ?? []).reduce((total, row) => total + row.count, 0);

  if (!curveBlock()) {
    fail("the collection screen has no cost curve under the deck (#deck-curve), so the deck's shape cannot be read");
  }

  // A visit with no save at all is dealt the starter collection and a
  // ready-to-play deck built from it — the state a reload builds from nothing.
  const fresh = collection.loadGame(stubStorage());
  if (fresh.cards.length < 10) {
    fail(`a first visit with no save should be dealt the starter collection, but loadGame gave ${fresh.cards.length} card(s)`);
  }
  if (fresh.deck.length !== cardCatalog.DECK_LIMIT) {
    fail(
      `a first visit with no save should be dealt a ready-to-play deck of ${cardCatalog.DECK_LIMIT} cards, ` +
        `but loadGame gave ${fresh.deck.length}`
    );
  }
  // The deck is derivable: the catalog walked in order, one entry per owned copy,
  // stopping at the limit. So every id is owned, no id appears more times than
  // the player owns it, and the deck never breaks its own limit.
  const freshOwnedCopies = new Map(fresh.cards.map((card) => [card.id, card.copies]));
  const catalogOrder = cardCatalog.CARDS.map((card) => card.id);
  const freshInCatalogOrder = [...fresh.deck].sort(
    (a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b)
  );
  if (JSON.stringify(fresh.deck) !== JSON.stringify(freshInCatalogOrder)) {
    fail(
      `the starter deck is not in catalog order, so it cannot be derived: it reads ${JSON.stringify(fresh.deck)}`
    );
  }
  for (const id of new Set(fresh.deck)) {
    const held = fresh.deck.filter((inDeck) => inDeck === id).length;
    const ownedOf = freshOwnedCopies.get(id) ?? 0;
    if (held > ownedOf) {
      fail(
        `the starter deck holds "${id}" ${held} times although the player owns ${ownedOf} — ` +
          "a deck may never hold more copies of a card than are owned"
      );
    }
  }
  if (fresh.deck.some((id) => !freshOwnedCopies.has(id))) {
    fail(`the starter deck names a card the player does not own: ${JSON.stringify(fresh.deck)}`);
  }

  // A saved collection whose deck was saved empty is dealt the starter deck too,
  // so a player who cleared their deck is not locked out of playing; a saved deck
  // that holds cards is returned exactly as it was saved.
  const savedEmptyDeck = collection.loadGame(
    stubStorage({
      [collection.STORAGE_KEY]: JSON.stringify({
        version: 1,
        cards: owned.cards.map(({ id, copies }) => ({ id, copies })),
        deck: [],
      }),
    })
  );
  if (savedEmptyDeck.deck.length !== cardCatalog.DECK_LIMIT) {
    fail(
      `a saved empty deck was not replaced by a ready-to-play deck: loadGame gave ${savedEmptyDeck.deck.length} card(s)`
    );
  } else if (!sameCards(savedEmptyDeck.cards, owned.cards)) {
    fail("dealing a starter deck for an empty saved deck changed the cards the player owns");
  }

  // A returning player with a deck of their own keeps exactly that deck: the
  // default is only ever supplied when no deck was saved.
  const customDeck = [ownedIds[1], ownedIds[0], ownedIds[0]];
  const savedCustomDeck = collection.loadGame(
    stubStorage({
      [collection.STORAGE_KEY]: JSON.stringify({
        version: 1,
        cards: owned.cards.map(({ id, copies }) => ({ id, copies })),
        deck: customDeck,
      }),
    })
  );
  if (JSON.stringify(savedCustomDeck.deck) !== JSON.stringify(customDeck)) {
    fail(
      `a returning player's saved deck was changed: read ${JSON.stringify(savedCustomDeck.deck)} ` +
        `instead of ${JSON.stringify(customDeck)}`
    );
  }

  // The live page opened on the starter deck. Clearing it here proves every card
  // in the dealt deck can be taken back out — the default is a starting point,
  // not a locked deck — and leaves the state the rest of these checks build from.
  const dealtDeck = deckIds();
  if (dealtDeck.length === 0) {
    fail("the page opened with no deck, though a first visit should be dealt a ready-to-play one");
  }
  for (let guard = 0; deckIds().length > 0 && guard < 30; guard += 1) {
    const id = deckIds()[0];
    const before = heldCopies(id);
    const button = removeControl(id);
    if (!button) {
      fail(`the dealt deck holds "${id}" but the collection screen offers no way to remove it`);
      break;
    }
    button.click();
    if (heldCopies(id) !== before - 1) {
      fail(
        `removing "${id}" from the dealt deck left ${heldCopies(id)} of its ${before} copies instead of ${before - 1}`
      );
      break;
    }
  }
  if (deckIds().length !== 0) {
    fail(`the dealt deck could not be emptied on the collection screen: ${deckIds().length} card(s) remain`);
  }

  // An empty deck shows its own empty note and no curve at all: there is no
  // shape to read, and a block left on screen with no rows would say otherwise.
  const emptyNote = deckList ? textOf(deckList.querySelector(".deck-empty")) : "";
  if (!emptyNote) {
    fail("an empty deck no longer shows its empty note, so the screen reads as a deck with cards but no contents");
  }
  if (curve().length !== 0) {
    fail(`an empty deck reports a cost curve: ${JSON.stringify(curve())}`);
  }
  if (curveBlock() && !curveBlock().hidden) {
    fail("a deck holding no cards still shows a cost curve instead of only the empty-deck note");
  }
  if (curveRows().length !== 0) {
    fail(`an empty deck draws ${curveRows().length} cost-curve row(s) although it holds no cards`);
  }

  // One card in the deck puts exactly one row on the curve, at that card's cost
  // and counting one — the curve follows the deck the moment it changes.
  const loneId = ownedIds[0];
  game.addCardToDeck(loneId);
  const loneCardCost = game.readState().deck.find((card) => card.id === loneId).cost;
  if (JSON.stringify(curve()) !== JSON.stringify([{ cost: loneCardCost, count: 1 }])) {
    fail(
      `adding one card to an empty deck should put one row on the curve at cost ${loneCardCost} counting 1, ` +
        `but the curve reads ${JSON.stringify(curve())}`
    );
  }
  if (curveSum() !== 1) {
    fail(`a one-card deck's cost curve counts ${curveSum()} card(s) instead of 1`);
  }
  if (curveBlock() && curveBlock().hidden) {
    fail("adding a card to an empty deck leaves the cost curve hidden");
  }
  const loneRows = curveRows();
  if (loneRows.length !== 1) {
    fail(`a one-card deck draws ${loneRows.length} cost-curve row(s) instead of 1`);
  } else {
    const loneText = textOf(loneRows[0]);
    if (!loneText.includes(`Cost ${loneCardCost}`)) {
      fail(`a one-card deck's cost-curve row does not name its cost ${loneCardCost}: it reads "${loneText}"`);
    }
    if (!/\b1 card\b/.test(loneText)) {
      fail(`a one-card deck's cost-curve row does not say 1 card in the singular: it reads "${loneText}"`);
    }
  }

  // Taking that card back out returns the deck to empty: the block hides again.
  game.removeCardFromDeck(loneId);
  if (curve().length !== 0 || curveRows().length !== 0) {
    fail(
      `removing the deck's only card left the curve reading ${JSON.stringify(curve())} with ` +
        `${curveRows().length} row(s) drawn`
    );
  }
  if (curveBlock() && !curveBlock().hidden) {
    fail("a deck emptied again still shows a cost curve instead of only the empty-deck note");
  }

  // A card owned in several copies can be put in the deck that many times, so a
  // collection of duplicates is worth building around. The starter collection
  // holds three Sprouts, which is a real owned card rather than a fixture.
  const multipleId = owned.cards.find((card) => card.copies >= 3)?.id;
  if (!multipleId) {
    fail("the collection holds no card in three or more copies, so a duplicate deck cannot be built");
  } else {
    for (let copy = 0; copy < 3; copy++) game.addCardToDeck(multipleId);
    if (heldCopies(multipleId) !== 3) {
      fail(
        `"${multipleId}" is owned in ${ownedCopies(multipleId)} copies but only ${heldCopies(multipleId)} ` +
          "reached the deck — duplicates are still being dropped"
      );
    }

    // A fourth copy than the player owns is refused, and the reason names how
    // many they do own.
    let overOwned = "";
    try {
      game.addCardToDeck(multipleId);
    } catch (error) {
      overOwned = error.message;
    }
    if (!overOwned) {
      fail(`a fourth copy of "${multipleId}" was added although only ${ownedCopies(multipleId)} are owned`);
    } else if (!overOwned.includes(String(ownedCopies(multipleId)))) {
      fail(
        `a fourth copy of "${multipleId}" was refused without naming the ${ownedCopies(multipleId)} owned: ` +
          `"${overOwned}"`
      );
    }
  }

  // Fill the rest of the deck with the other owned cards, so the ten-card limit
  // is reached by a real deck a player could build.
  for (const id of ownedIds) {
    if (deckIds().length >= 10) break;
    if (deckIds().includes(id)) continue;
    game.addCardToDeck(id);
  }
  if (deckIds().length !== 10) {
    fail(`a full deck of ten cards was built but it reports ${deckIds().length}`);
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

  // The cost curve under the deck reads that same deck: one row per energy cost
  // it holds, each naming the cost and how many of the deck's cards are at it,
  // and the counts adding up to the deck's size.
  const fullCurve = curve();
  if (curveBlock() && curveBlock().hidden) {
    fail("a ten-card deck hides its cost curve, so the deck's shape cannot be seen while building");
  }
  const drawnCosts = curveRows().map((row) => Number(row.dataset.cost));
  const expectedCosts = fullCurve.map((row) => row.cost);
  if (JSON.stringify(drawnCosts) !== JSON.stringify(expectedCosts)) {
    fail(
      `the cost curve on the page draws costs ${JSON.stringify(drawnCosts)} while the state holds ` +
        `${JSON.stringify(expectedCosts)}`
    );
  }
  for (const row of curveRows()) {
    const cost = Number(row.dataset.cost);
    const entry = fullCurve.find((curveRow) => curveRow.cost === cost);
    const rowText = textOf(row);
    if (!entry) {
      fail(`the cost curve draws a row for cost ${cost}, which the state's curve does not hold`);
      continue;
    }
    if (!rowText.includes(`Cost ${cost}`)) {
      fail(`the cost-curve row for cost ${cost} does not name its cost: it reads "${rowText}"`);
    }
    const countWords = entry.count === 1 ? "1 card" : `${entry.count} cards`;
    if (!rowText.includes(countWords)) {
      fail(
        `the cost-curve row for cost ${cost} does not say "${countWords}": it reads "${rowText}"`
      );
    }
  }
  if (curveSum() !== game.readState().deckSize) {
    fail(
      `the cost curve counts ${curveSum()} card(s) across its costs while the deck holds ` +
        `${game.readState().deckSize}`
    );
  }
  if (curveSum() !== 10) {
    fail(`a ten-card deck's cost curve counts ${curveSum()} card(s) instead of 10`);
  }

  // Each card in the deck is shown as its picture — the same name as its text
  // alternative, in the one shared frame and creature — so the deck reads as a
  // hand of cards rather than a list of names. Its numbers stay printed beside
  // the picture so the card still reads as text.
  const deckPictureRows = () => (deckList ? [...deckList.querySelectorAll(".deck-card")] : []).filter((row) => {
    const picture = row.querySelector("svg.card-art");
    if (!picture) {
      fail(`the deck card "${row.dataset.cardId}" is shown with no picture, so the deck cannot be read by sight`);
      return false;
    }
    const name = textOf(row.querySelector(".deck-card-name")) || row.dataset.cardId;
    if (picture.getAttribute("role") !== "img") {
      fail(`the picture on deck card "${name}" is not announced as an image (role="${picture.getAttribute("role")}")`);
    }
    if (picture.getAttribute("aria-label") !== name) {
      fail(
        `the picture on deck card "${name}" is described as ` +
          `"${picture.getAttribute("aria-label") || "(nothing)"}" instead of the card's own name`
      );
    }
    if (!picture.querySelector(".art-frame") || !picture.querySelector(".art-body")) {
      fail(`the picture on deck card "${name}" is not drawn in the shared frame and creature`);
    }
    const card = game.readState().deck.find((entry) => entry.id === row.dataset.cardId);
    const printed = textOf(row.querySelector(".deck-card-stats"));
    const numbers = card ? `${card.cost}/${card.attack}/${card.health}` : "";
    if (!card) {
      fail(`the deck list shows a card "${row.dataset.cardId}" the state does not hold`);
    } else if (printed !== numbers) {
      fail(`deck card "${name}" prints its cost/attack/health as "${printed}" instead of "${numbers}"`);
    }
    return true;
  });
  if (deckPictureRows().length !== game.readState().deck.length) {
    fail(
      `the deck holds ${game.readState().deck.length} card(s) but only ${deckPictureRows().length} of them ` +
        `are shown as a picture in the deck list`
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

  // Every owned card says how many of its copies are in the deck, so the count a
  // duplicate deck is read from stays on the page beside the card itself.
  const ownedRows = list ? [...list.querySelectorAll(".owned-card")] : [];
  for (const row of ownedRows) {
    const id = row.dataset.cardId;
    const shown = textOf(row.querySelector(`[data-in-deck="${id}"]`));
    const expected = `In deck: ${heldCopies(id)} of ${ownedCopies(id)}`;
    if (!shown) {
      fail(`the collection screen does not say how many copies of "${id}" are in the deck`);
    } else if (shown !== expected) {
      fail(
        `"${id}" is owned in ${ownedCopies(id)} copies with ${heldCopies(id)} in the deck, but the collection ` +
          `screen reads "${shown}" instead of "${expected}"`
      );
    }
  }

  // The eleventh card is refused, and the page says why.
  const eleventhId = ownedIds.find((id) => !deckIds().includes(id));
  if (!eleventhId) {
    fail("every owned card is already in the deck, so the ten-card limit cannot be checked");
  } else {
    const eleventhButton = addControl(eleventhId);
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
      // A refused add leaves the deck's pictures as they were: it redraws them
      // together with the size it reports.
      if (deckPictureRows().length !== game.readState().deck.length) {
        fail(
          `after a refused add the deck holds ${game.readState().deck.length} card(s) but ` +
            `${deckPictureRows().length} are shown as a picture`
        );
      }
    }
  }

  // Pressing Add on a card whose every owned copy is already placed reports the
  // refusal naming the owned count rather than quietly doing nothing.
  if (multipleId) {
    const atLimitButton = addControl(multipleId);
    if (!atLimitButton) {
      fail(`the collection screen has no Add control for "${multipleId}"`);
    } else {
      atLimitButton.click();
      if (heldCopies(multipleId) !== ownedCopies(multipleId)) {
        fail(
          `pressing Add on "${multipleId}", all ${ownedCopies(multipleId)} of which are already placed, ` +
            `changed the deck to ${heldCopies(multipleId)} copies`
        );
      }
      const refusal = textOf(document.getElementById("deck-message"));
      if (!refusal.includes(String(ownedCopies(multipleId)))) {
        fail(
          `pressing Add on "${multipleId}" with all ${ownedCopies(multipleId)} copies already placed was ` +
            `refused without naming the owned count: "${refusal || "(nothing)"}"`
        );
      }
    }
  }

  // Taking one copy out drops exactly one, and the page says what happened.
  const firstDeckId = deckIds()[0];
  const firstCopiesBefore = heldCopies(firstDeckId);
  const removeButton = removeControl(firstDeckId);
  if (!removeButton) {
    fail(`the collection screen has no control to remove "${firstDeckId}" from the deck`);
  } else {
    removeButton.click();
    if (deckIds().length !== 9) {
      fail(`removing a card left the deck at ${deckIds().length} cards instead of nine`);
    }
    if (heldCopies(firstDeckId) !== firstCopiesBefore - 1) {
      fail(
        `removing "${firstDeckId}" left ${heldCopies(firstDeckId)} of its ${firstCopiesBefore} copies instead of ` +
          `${firstCopiesBefore - 1} — a remove must drop exactly one copy`
      );
    }
    if (!textOf(document.getElementById("deck-message")).toLowerCase().includes("removed")) {
      fail("removing a card did not tell the player what happened");
    }
    // The same redraw that drops the size to nine drops its picture too, so the
    // deck's pictures never disagree with the deck the state holds.
    if (deckPictureRows().length !== game.readState().deck.length) {
      fail(
        `after removing a card the deck holds ${game.readState().deck.length} card(s) but ` +
          `${deckPictureRows().length} are shown as a picture`
      );
    }
    // The curve follows the deck on the spot: a removal drops its count with it
    // rather than waiting for the screen to be reopened.
    if (curveSum() !== game.readState().deckSize) {
      fail(
        `after removing a card the cost curve counts ${curveSum()} card(s) while the deck holds ` +
          `${game.readState().deckSize}`
      );
    }
    if (curveSum() !== 9) {
      fail(`after removing a card the cost curve counts ${curveSum()} card(s) instead of nine`);
    }
  }

  // What the page holds now is what a reload reads back, duplicates included.
  const savedDeck = deckIds();
  const reloadedGame = collection.loadGame();
  if (JSON.stringify(reloadedGame.deck) !== JSON.stringify(savedDeck)) {
    fail(
      `the deck did not survive a reload: the page holds ${JSON.stringify(savedDeck)} but loadGame ` +
        `read back ${JSON.stringify(reloadedGame.deck)}`
    );
  }
  const duplicateId = savedDeck.find((id) => savedDeck.filter((held) => held === id).length > 1);
  if (!duplicateId) {
    fail("the deck holds no duplicate, so duplicates surviving a reload cannot be checked");
  } else {
    const reloadedCopies = reloadedGame.deck.filter((id) => id === duplicateId).length;
    const savedCopies = savedDeck.filter((id) => id === duplicateId).length;
    if (reloadedCopies !== savedCopies) {
      fail(
        `a deck holding "${duplicateId}" ${savedCopies} times read back with ${reloadedCopies} copies`
      );
    }
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

  // A saved deck is trimmed on the way in: an unowned id is dropped, and a card
  // repeated more times than it is owned keeps only the copies that are owned.
  const tripleId = owned.cards.find((card) => card.copies >= 3).id;
  const trimmedDeck = savedWithDeck([
    tripleId,
    tripleId,
    tripleId,
    tripleId,
    tripleId,
    "not-a-real-card",
    ownedIds[1],
  ]);
  const expectedTrim = [tripleId, tripleId, tripleId, ownedIds[1]];
  if (JSON.stringify(trimmedDeck.deck) !== JSON.stringify(expectedTrim)) {
    fail(
      `a saved deck with five copies of a card owned three times and an unowned id was not trimmed: read ` +
        `${JSON.stringify(trimmedDeck.deck)} instead of ${JSON.stringify(expectedTrim)}`
    );
  }

  // A saved deck with more than ten distinct-owned cards is capped at the limit.
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

    // A deck built from duplicates is dealt as the copies it holds: three Sprouts
    // in the deck is three Sprout cards dealt, not one collapsed to a single.
    const duplicateDeck = ["sprout", "sprout", "sprout", "pebble-toad", "bramble-hound", "thornling"];
    const dealtDoubles = matchEngine.createMatch(duplicateDeck, { rng: fixedRng });
    const dealtIds = [
      ...dealtDoubles.player.hand,
      ...dealtDoubles.player.table,
      ...dealtDoubles.player.deck,
    ].map((card) => card.id);
    const dealtCopies = (id) => dealtIds.filter((held) => held === id).length;
    if (dealtIds.length !== duplicateDeck.length) {
      fail(
        `a match dealt ${dealtIds.length} card(s) from a deck of ${duplicateDeck.length}, so duplicates were dropped`
      );
    }
    for (const id of new Set(duplicateDeck)) {
      const held = duplicateDeck.filter((deckId) => deckId === id).length;
      if (dealtCopies(id) !== held) {
        fail(`a deck holding ${held} copies of "${id}" dealt ${dealtCopies(id)} of them`);
      }
    }

    // A draw moves a card rather than making one: after dealing and the opening
    // draw — and before any card can be fought off a table — each side's cards
    // still add up to the deck it was dealt from: the player's own deck, and the
    // opponent's fixed one.
    for (const [who, side, dealtFrom] of [
      ["player", dealt.player, cheapDeck],
      ["opponent", dealt.opponent, cardCatalog.OPPONENT_DECK ?? []],
    ]) {
      const held = side.hand.length + side.table.length + side.deck.length;
      if (held !== dealtFrom.length) {
        fail(
          `the ${who}'s cards add up to ${held} after dealing, instead of the ${dealtFrom.length} it was dealt ` +
            "— a draw duplicated or dropped one"
        );
      }
    }

    // The opponent is a character with a deck of its own: fixed, built from the
    // same catalog a player's deck is, and not the player's deck. A mirror is
    // what this ticket removed — with one, the cards chosen for your own deck
    // change nothing about the match.
    const opponentDeck = cardCatalog.OPPONENT_DECK;
    if (typeof cardCatalog.OPPONENT_NAME !== "string" || cardCatalog.OPPONENT_NAME.trim() === "") {
      fail("docs/cards.js names no opponent, so the Play screen cannot say who a match is against");
    }
    if (!Array.isArray(opponentDeck) || !opponentDeck.length) {
      fail("docs/cards.js declares no OPPONENT_DECK, so the opponent has no deck of its own to be dealt from");
    } else {
      for (const id of opponentDeck) {
        if (!cardCatalog.CARD_BY_ID.has(id)) {
          fail(`the opponent's deck names "${id}", which is not a card in the catalog`);
        }
      }
      const opponentCards = [...dealt.opponent.hand, ...dealt.opponent.table, ...dealt.opponent.deck];
      const stray = opponentCards.filter((card) => !opponentDeck.includes(card.id)).map((card) => card.id);
      if (stray.length) {
        fail(
          `the opponent was dealt ${JSON.stringify(stray)}, which is not in the opponent's own deck ` +
            JSON.stringify(opponentDeck)
        );
      }
      const borrowed = opponentCards.filter((card) => cheapDeck.includes(card.id));
      if (opponentCards.length && borrowed.length === opponentCards.length) {
        fail(
          `every card the opponent was dealt (${JSON.stringify(borrowed.map((card) => card.id))}) comes from the ` +
            "player's own deck, so the opponent is playing a mirror instead of a deck of its own"
        );
      }
    }

    // Who a match is against is a choice, so there has to be more than one
    // character to choose: each named, each described by the kind of deck it
    // brings, each bringing real cards of its own. Thornmere stays first, with
    // the deck the checks above were written against.
    const opponentChoices = cardCatalog.OPPONENTS;
    if (!Array.isArray(opponentChoices) || opponentChoices.length < 2) {
      fail(
        `docs/cards.js offers ${Array.isArray(opponentChoices) ? opponentChoices.length : "no"} opponent(s), so ` +
          "every match is against the same character and a player has nothing to choose"
      );
    } else {
      const choiceIds = opponentChoices.map((opponent) => opponent.id);
      if (new Set(choiceIds).size !== choiceIds.length) {
        fail(`two opponents share an id, so one of them cannot be chosen: ${JSON.stringify(choiceIds)}`);
      }
      for (const opponent of opponentChoices) {
        for (const field of ["id", "name", "look", "description", "accent"]) {
          if (typeof opponent[field] !== "string" || !opponent[field].trim()) {
            fail(
              `the opponent ${JSON.stringify(opponent.id)} has no ${field}, so the Play screen cannot offer it ` +
                "as a character with a deck of its own"
            );
          }
        }
        if (!Array.isArray(opponent.deck) || opponent.deck.length < cardCatalog.MINIMUM_DECK_SIZE) {
          fail(
            `the opponent "${opponent.name}" brings ${Array.isArray(opponent.deck) ? opponent.deck.length : "no"} ` +
              `cards instead of a deck of at least ${cardCatalog.MINIMUM_DECK_SIZE}`
          );
          continue;
        }
        if (opponent.deck.length !== cardCatalog.DECK_LIMIT) {
          fail(
            `the opponent "${opponent.name}" brings ${opponent.deck.length} cards instead of the fixed ` +
              `${cardCatalog.DECK_LIMIT} a deck holds`
          );
        }
        for (const id of opponent.deck) {
          if (!cardCatalog.CARD_BY_ID.has(id)) {
            fail(`the opponent "${opponent.name}" brings "${id}", which is not a card in the catalog`);
          }
        }
      }

      // Every opponent is a character a player can see: a portrait of its own,
      // drawn in the one shape language the whole set is drawn in and in that
      // opponent's own accent — so a character added later is recognised by sight
      // as well as by name, instead of being a name with nothing to know it by.
      // The style it is drawn to is written down beside the drawings, so the next
      // opponent is drawn to match rather than guessed at.
      const portraitStyle = cardArt?.ART_STYLE?.portrait;
      if (portraitStyle?.viewBox !== "0 0 64 64") {
        fail(
          "the art style does not say what frame a portrait is drawn in (no viewBox 0 0 64 64), " +
            "so the next opponent's portrait would be guessed at"
        );
      }
      if (!/y=56/.test(portraitStyle?.groundLine ?? "")) {
        fail(
          "the art style does not say where a portrait stands (no shared ground line at y=56), " +
            "so the figures of different opponents would sit differently"
        );
      }
      if (!portraitStyle?.palette?.body || !portraitStyle?.palette?.detail) {
        fail(
          "the art style does not say what a portrait is painted in (no body and detail tokens), " +
            "so a character added later could be drawn in colours of its own"
        );
      }

      const rootStyle = getComputedStyle(document.documentElement);
      // A drawing without its class names is the shapes themselves, so two
      // different pictures of the same figure come out the same whatever each is
      // painted in — the way a portrait borrowing a card's creature would.
      const shapesOf = (markup) =>
        (markup || "").replace(/\s+/g, " ").replace(/class="[^"]*"\s*/g, "").trim();
      // The figures the cards are drawn from, so a portrait cannot be a card's
      // creature used a second time.
      const cardShapes = new Map();
      for (const card of cardCatalog.CARDS) {
        const shapes = shapesOf(cardArt?.cardArt(card.id)?.inner);
        if (shapes) cardShapes.set(shapes, card.name);
      }
      const portraitShapes = new Map();
      for (const opponent of opponentChoices) {
        const accent = rootStyle.getPropertyValue(opponent.accent).trim();
        if (!accent) {
          fail(
            `the opponent "${opponent.name}" is coloured by the token ${JSON.stringify(opponent.accent)}, ` +
              "which styles.css does not define, so its portrait would be drawn in no colour at all"
          );
        }
        if (!cardArt) continue;

        const portrait = cardArt.opponentPortrait(opponent.id);
        if (!portrait) {
          fail(
            `the opponent "${opponent.name}" has no portrait, so a player choosing who to face never ` +
              "sees the character they are up against"
          );
          continue;
        }
        const drawing = (portrait.inner || "").replace(/\s+/g, " ").trim();
        if (!drawing) {
          fail(`the portrait of "${opponent.name}" has nothing drawn in it`);
          continue;
        }
        if (!portrait.description?.trim()) {
          fail(
            `the portrait of "${opponent.name}" is not described, so it cannot be checked against ` +
              "the written style"
          );
        }
        // Every portrait is drawn from the same shape classes as the others, so
        // the characters stay one set however many are added.
        const classes = [...drawing.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
        const stray = classes.filter((name) => name !== "portrait-body" && name !== "portrait-accent");
        if (stray.length) {
          fail(
            `the portrait of "${opponent.name}" uses the shape class(es) ${stray.join(", ")} that no ` +
              "other portrait uses, so it would not match the rest of the set"
          );
        }
        if (!classes.includes("portrait-body")) {
          fail(`the portrait of "${opponent.name}" has no figure in it (nothing carries the portrait-body shape)`);
        }
        // A portrait that points anywhere would be fetched, and this page loads
        // with nothing leaving its own origin.
        if (/https?:|<image|href=/i.test(drawing)) {
          fail(`the portrait of "${opponent.name}" points outside the page, so showing it would need a request`);
        }
        const shapes = shapesOf(drawing);
        const otherPortrait = portraitShapes.get(shapes);
        if (otherPortrait) {
          fail(
            `the portraits of "${otherPortrait}" and "${opponent.name}" are drawn identically, so the ` +
              "two characters cannot be told apart by sight"
          );
        } else {
          portraitShapes.set(shapes, opponent.name);
        }
        const sameCard = cardShapes.get(shapes);
        if (sameCard) {
          fail(
            `the portrait of "${opponent.name}" is the drawing of the card "${sameCard}", so the ` +
              "character is shown as a card rather than as itself"
          );
        }

        const svg = cardArt.opponentPortraitSvg(opponent);
        if (!svg) {
          fail(
            `the portrait of "${opponent.name}" is drawn but the page is handed no picture for it, ` +
              "so the picker would show the name alone"
          );
          continue;
        }
        if (svg.getAttribute("viewBox") !== portraitStyle?.viewBox) {
          fail(
            `the portrait of "${opponent.name}" is drawn in the viewBox ` +
              `${JSON.stringify(svg.getAttribute("viewBox"))} instead of the ` +
              `${JSON.stringify(portraitStyle?.viewBox)} the style names`
          );
        }
        if (svg.getAttribute("aria-hidden") !== "true") {
          fail(
            `the portrait of "${opponent.name}" is not hidden from assistive technology, though its ` +
              "name, look and deck are written beside it"
          );
        }
      }
      if (opponentChoices[0]?.name !== cardCatalog.OPPONENT_NAME) {
        fail(
          `the first opponent offered is ${JSON.stringify(opponentChoices[0]?.name)} while a match without a ` +
            `choice is against ${JSON.stringify(cardCatalog.OPPONENT_NAME)}, so the default is not the one offered first`
        );
      }

      // Facing any opponent but the first is a different match: its id and name
      // on the match, its name in the opening line, and cards from its own deck
      // alone. Every opponent after the first is played through, so a third
      // added later is held to the same promise without this check changing.
      for (const otherOpponent of opponentChoices.slice(1)) {
        let againstOther = null;
        try {
          againstOther = matchEngine.createMatch(cheapDeck, { rng: fixedRng, opponentId: otherOpponent.id });
        } catch (error) {
          fail(`a match against "${otherOpponent.id}" was refused — ${error.message}`);
        }
        if (!againstOther) continue;
        if (againstOther.opponentName !== otherOpponent.name) {
          fail(
            `a match started against "${otherOpponent.id}" reports its opponent as ` +
              `${JSON.stringify(againstOther.opponentName)} instead of ${JSON.stringify(otherOpponent.name)}`
          );
        }
        if (againstOther.opponentId !== otherOpponent.id) {
          fail(
            `a match started against "${otherOpponent.id}" carries the id ` +
              `${JSON.stringify(againstOther.opponentId)}, so which opponent it was dealt against is lost`
          );
        }
        if (!String(againstOther.log[0] ?? "").includes(otherOpponent.name)) {
          fail(
            `the opening log line of a match against "${otherOpponent.name}" reads ` +
              `${JSON.stringify(againstOther.log[0])} instead of naming who it is against`
          );
        }
        const dealtSide = [...againstOther.opponent.hand, ...againstOther.opponent.table, ...againstOther.opponent.deck];
        const fromOtherDeck = dealtSide.filter((card) => !otherOpponent.deck.includes(card.id));
        if (fromOtherDeck.length) {
          fail(
            `the opponent "${otherOpponent.name}" was dealt ${JSON.stringify(fromOtherDeck.map((card) => card.id))}, ` +
              `which is not in that opponent's own deck`
          );
        }
        if (dealtSide.length !== otherOpponent.deck.length) {
          fail(
            `the opponent "${otherOpponent.name}" holds ${dealtSide.length} cards instead of the ` +
              `${otherOpponent.deck.length} it brings`
          );
        }
      }

      // An opponent this game does not have is refused before anything is dealt.
      let unknownRefused = false;
      try {
        matchEngine.createMatch(cheapDeck, { rng: fixedRng, opponentId: "no-such-opponent" });
      } catch {
        unknownRefused = true;
      }
      if (!unknownRefused) {
        fail('a match was started against "no-such-opponent", which is not an opponent this game has');
      }

      // How an opponent plays is part of who it is: each declares whether it
      // holds out for the dearest card it can afford or spends on the cheapest
      // first, and not every opponent plays the same way — otherwise facing one
      // feels exactly like facing the other, whatever the descriptions promise.
      for (const opponent of opponentChoices) {
        if (opponent.cardPreference !== "dearest" && opponent.cardPreference !== "cheapest") {
          fail(
            `the opponent "${opponent.name}" plays ${JSON.stringify(opponent.cardPreference)} — a preference has to ` +
              'be "dearest" (its biggest affordable body) or "cheapest" (its smallest cards first)'
          );
        }
      }
      const preferences = new Set(opponentChoices.map((opponent) => opponent.cardPreference));
      if (preferences.size < 2) {
        fail(
          `every opponent plays the same way (${JSON.stringify([...preferences])}), so facing one feels exactly ` +
            "like facing the other however differently their decks are described"
        );
      }

      // The first turn of the fixed deal shows that difference in the log: with
      // the same shuffle Thornmere's hand holds a cost-3 Glowcap and a cost-3
      // Mudback Turtle, so it holds out for one cost-3 body (the Glowcap, the
      // stronger of the two), while Emberwake's holds a cost-1 Sprout and a
      // cost-1 Pebble Toad, so it plays both cheap strikers in a single turn. The
      // played costs are read back off the table the opponent built.
      const firstTurnPlays = (opponentId) => {
        const match = matchEngine.createMatch(cheapDeck, { rng: fixedRng, opponentId });
        matchEngine.endTurn(match);
        return {
          costs: match.opponent.table.map((card) => card.cost),
          lines: match.log.filter((line) => /^Opponent plays /.test(line)),
        };
      };

      const slowTurn = firstTurnPlays("thornmere");
      const fastTurn = firstTurnPlays("emberwake");
      const nonDecreasing = (costs) => costs.every((cost, at) => at === 0 || costs[at - 1] <= cost);
      const nonIncreasing = (costs) => costs.every((cost, at) => at === 0 || costs[at - 1] >= cost);

      if (slowTurn.costs.length !== 1) {
        fail(
          `Thornmere's first turn played ${slowTurn.costs.length} card(s) (costs ${JSON.stringify(slowTurn.costs)}) — ` +
            "the slow deck should hold out for its one biggest affordable body"
        );
      } else if (!nonIncreasing(slowTurn.costs)) {
        fail(`Thornmere played its first turn's costs ${JSON.stringify(slowTurn.costs)}, which does not lead with its dearest card`);
      }
      if (fastTurn.costs.length < 2) {
        fail(
          `Emberwake's first turn played ${fastTurn.costs.length} card(s) (costs ${JSON.stringify(fastTurn.costs)}) — ` +
            "the fast deck should fill its table with several cheap strikers in one turn"
        );
      } else if (!nonDecreasing(fastTurn.costs)) {
        fail(`Emberwake played its first turn's costs ${JSON.stringify(fastTurn.costs)}, which does not lead with its cheapest cards`);
      }
      if (JSON.stringify(slowTurn.costs) === JSON.stringify(fastTurn.costs)) {
        fail(
          `Thornmere and Emberwake played the same first turn (costs ${JSON.stringify(slowTurn.costs)}), so the match ` +
            "does not play the kind of deck each is described as"
        );
      }
      for (const [name, turn] of [
        ["Thornmere", slowTurn],
        ["Emberwake", fastTurn],
      ]) {
        if (turn.lines.length !== turn.costs.length) {
          fail(
            `${name} played ${turn.costs.length} card(s) but the log holds ${turn.lines.length} "Opponent plays" ` +
              `line(s): ${JSON.stringify(turn.lines)}`
          );
        }
      }
      if (JSON.stringify(slowTurn.lines) === JSON.stringify(fastTurn.lines)) {
        fail(
          `the match log reads the same for both opponents (${JSON.stringify(slowTurn.lines)}), so a player cannot see ` +
            "them play differently"
        );
      }

      // However an opponent chooses its cards, a match against it still reaches a
      // result: a win or a loss, not a board neither side can finish.
      for (const opponent of opponentChoices) {
        const finishing = matchEngine.createMatch(cheapDeck, { rng: fixedRng, opponentId: opponent.id });
        for (let move = 0; move < 120 && !finishing.over; move += 1) {
          const playable = finishing.player.hand.find((card) => card.cost <= finishing.player.energy);
          if (playable) matchEngine.playCard(finishing, playable.id);
          else matchEngine.endTurn(finishing);
        }
        if (!finishing.over) {
          fail(
            `a match against "${opponent.name}" (${opponent.cardPreference}) did not reach a result in 120 moves — ` +
              `both heroes stood at ${finishing.player.health} and ${finishing.opponent.health} health`
          );
        } else if (finishing.outcome !== "win" && finishing.outcome !== "loss") {
          fail(
            `a match against "${opponent.name}" finished with outcome ${JSON.stringify(finishing.outcome)} instead of a ` +
              "win or a loss"
          );
        }
      }

      // Each opponent brings a card that does something as it lands, chosen so
      // the ability suits the match its description promises: the slow, wearing
      // character mends its hero, the fast ones strike the board. A player meets
      // the ability inside a match and learns to watch for it on the opponent's
      // turn, so each fixed deck is required to hold such a card and each is seen
      // to fire it on its own turn. The ability assigned to each opponent is the
      // product's own claim about what kind of match it plays, so it is written
      // down here and a new opponent has to be placed deliberately rather than
      // slipping through unchecked.
      const promisedAbility = new Map([
        ["thornmere", cardCatalog.HEAL_ON_PLAY],
        ["emberwake", cardCatalog.STRIKE_ON_PLAY],
        ["mistfen", cardCatalog.STRIKE_ON_PLAY],
      ]);
      for (const opponent of opponentChoices) {
        const promised = promisedAbility.get(opponent.id);
        if (!promised) {
          fail(
            `the opponent "${opponent.name}" is not assigned a when-played ability, so whether its deck suits ` +
              "the match its description promises cannot be checked"
          );
          continue;
        }
        const carried = opponent.deck.filter((id) => cardCatalog.CARD_BY_ID.get(id)?.ability === promised);
        if (!carried.length) {
          fail(
            `the opponent "${opponent.name}" brings no card that says ${JSON.stringify(promised)}, so the match ` +
              "it advertises never shows the ability its kind of play promises"
          );
          continue;
        }

        // One bounded turn in which the opponent holds only its ability card, so
        // that card is played whatever way the character chooses, and its trigger
        // is seen to fire and to be logged. The hand is set up rather than dealt
        // so the turn proves the ability, not the shuffle.
        const abilityCard = cardCatalog.CARD_BY_ID.get(carried[0]);
        const tooDear = { ...cardCatalog.CARD_BY_ID.get("elder-oak"), hasAttacked: false };
        const firing = matchEngine.createMatch(cheapDeck, { rng: fixedRng, opponentId: opponent.id });
        firing.opponent.hand = [{ ...abilityCard, hasAttacked: false }];
        firing.opponent.deck = [{ ...tooDear }, { ...tooDear }, { ...tooDear }];
        firing.opponent.energy = abilityCard.cost;
        firing.opponent.maxEnergy = abilityCard.cost;
        // The mend is read off the opponent's own hero, so nothing is placed in
        // front of it to wound it on the way; a strike needs a card to land on.
        firing.opponent.health = 8;
        if (promised === cardCatalog.STRIKE_ON_PLAY) {
          firing.player.table = [{ ...cardCatalog.CARD_BY_ID.get("mudback-turtle"), hasAttacked: false }];
        }
        const firingLogBefore = firing.log.length;
        matchEngine.endTurn(firing);
        const firedLines = firing.log.slice(firingLogBefore);

        if (!firing.opponent.table.some((card) => card.id === abilityCard.id)) {
          fail(
            `the opponent "${opponent.name}" did not play "${abilityCard.name}", the only card in its hand, on ` +
              `its turn (its table holds ${JSON.stringify(firing.opponent.table.map((card) => card.id))})`
          );
          continue;
        }
        if (promised === cardCatalog.HEAL_ON_PLAY) {
          const healed = 8 + cardCatalog.HEAL_ON_PLAY_AMOUNT;
          if (firing.opponent.health !== healed) {
            fail(
              `the opponent "${opponent.name}" played "${abilityCard.name}" but its hero stands at ` +
                `${firing.opponent.health} health instead of ${healed}, so its mend did not fire`
            );
          }
          if (
            !firedLines.some(
              (line) => line.includes(abilityCard.name) && line.includes(`opponent health ${firing.opponent.health}`)
            )
          ) {
            fail(
              `the opponent "${opponent.name}" mended its hero but the log does not say so: the turn added ` +
                JSON.stringify(firedLines)
            );
          }
        } else if (promised === cardCatalog.STRIKE_ON_PLAY) {
          const strikeLine = `Opponent's ${abilityCard.name} deals ${cardCatalog.STRIKE_ON_PLAY_AMOUNT} to your `;
          if (!firedLines.some((line) => line.startsWith(strikeLine))) {
            fail(
              `the opponent "${opponent.name}" struck with "${abilityCard.name}" but the log does not say so: ` +
                `the turn added ${JSON.stringify(firedLines)}`
            );
          }
        }
      }
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

    // Every pile in a match holds the same kind of card: the deck is dealt as
    // complete card objects, like the hand and the table, so a card drawn from
    // it arrives with its real name and numbers instead of a raw id that has
    // none. A wrong shape — a bare id string, a name of "undefined" — is what
    // these checks are written to catch.
    const cardShapeProblem = (where, card, { canBeDamaged = false } = {}) => {
      if (!card || typeof card !== "object") {
        return `${where} holds ${JSON.stringify(card)} instead of a card object, so it has no name`;
      }
      if (typeof card.name !== "string" || card.name.trim() === "" || card.name === "undefined") {
        return `${where} holds a card with no real name (id "${card.id}", name ${JSON.stringify(card.name)})`;
      }
      const catalogCard = cardCatalog.CARD_BY_ID.get(card.id);
      if (!catalogCard) {
        return `${where} holds "${card.name}" with id "${card.id}", which is not in the card catalog`;
      }
      for (const field of ["name", "cost", "attack"]) {
        if (card[field] !== catalogCard[field]) {
          return (
            `${where} holds "${card.name}" with ${field} ${JSON.stringify(card[field])} ` +
              `instead of the catalog's ${JSON.stringify(catalogCard[field])}`
          );
        }
      }
      // A card on a table may have been worn down in a fight, so it reads
      // between one and its printed health; a card in a hand or a deck is
      // always at its printed health.
      if (canBeDamaged) {
        const fought = typeof card.health === "number" && card.health > 0 && card.health <= catalogCard.health;
        if (!fought) {
          return (
            `${where} holds "${card.name}" at ${JSON.stringify(card.health)} health, which is neither the ` +
              `${catalogCard.health} it was printed at nor a value a fight could have left it with`
          );
        }
      } else if (card.health !== catalogCard.health) {
        return (
          `${where} holds "${card.name}" at ${JSON.stringify(card.health)} health instead of the ` +
            `${catalogCard.health} the catalog prints`
        );
      }
      return null;
    };

    const shapeDeck = ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"];
    const shape = matchEngine.createMatch(shapeDeck, { rng: fixedRng });

    // A freshly dealt deck holds complete cards, not ids.
    for (const [who, side] of [
      ["player", shape.player],
      ["opponent", shape.opponent],
    ]) {
      if (side.deck.length === 0) {
        fail(`a match dealt the ${who} no card left in its deck, so nothing about a deck's cards can be checked`);
      }
      for (const card of side.deck) {
        const problem = cardShapeProblem(`the ${who}'s deck after dealing`, card);
        if (problem) fail(problem);
      }
      for (const card of side.hand) {
        const problem = cardShapeProblem(`the ${who}'s hand after dealing`, card);
        if (problem) fail(problem);
      }
    }

    // The card a turn draws lands in the hand complete, under the name the log
    // says was drawn — never blank, never "undefined".
    const shapeLogBefore = shape.log.length;
    const shapeDeckBefore = shape.player.deck.length;
    matchEngine.endTurn(shape);
    const shapeDrawLine = shape.log.slice(shapeLogBefore).find((line) => /^You draw /.test(line));
    if (shapeDeckBefore > 0 && !shapeDrawLine) {
      fail(`a turn began with ${shapeDeckBefore} cards left in the deck but the log never says a card was drawn`);
    } else if (shapeDrawLine) {
      const drawnName = shapeDrawLine.slice("You draw ".length).split(" — ")[0];
      const drawnCard = shape.player.hand.find((card) => card.name === drawnName);
      if (!drawnCard) {
        fail(
          `the log says you drew "${drawnName}" but no card with that name is in the hand — ` +
            `the hand holds ${JSON.stringify(shape.player.hand.map((card) => card.name))}`
        );
      } else {
        const problem = cardShapeProblem(`the card drawn ("${drawnName}") onto the hand`, drawnCard);
        if (problem) fail(problem);
      }
    }

    // Played to the bottom of the deck: with the deck spent, every card the
    // match still shows — in hand or on either table — is complete and agrees
    // with the catalog. A hand holding a raw id would trip this.
    for (let turn = 0; turn < 10 && shape.player.deck.length > 0 && !shape.over; turn += 1) {
      matchEngine.endTurn(shape);
    }
    if (!shape.over && shape.player.deck.length !== 0) {
      fail(`ten turns left ${shape.player.deck.length} cards in the player's deck, so a spent deck cannot be checked`);
    }
    for (const [who, side] of [
      ["player", shape.player],
      ["opponent", shape.opponent],
    ]) {
      for (const card of side.hand) {
        const problem = cardShapeProblem(`the ${who}'s hand at the bottom of the deck`, card);
        if (problem) fail(problem);
      }
      for (const card of side.table) {
        const problem = cardShapeProblem(`the ${who}'s table at the bottom of the deck`, card, { canBeDamaged: true });
        if (problem) fail(problem);
      }
    }

    // A table is fought over. A known board — one card each side, taken from the
    // hands the fixed shuffle deals — makes the arithmetic exact: your card hits
    // the front card of the opponent's table, the hero behind it is untouched,
    // and a card worn to zero leaves the table with the log naming it. The
    // player's deck below is chosen so that hand holds a Sprout; the opponent's
    // own deck (docs/cards.js) leads with a Mudback Turtle and a Thornling for
    // the same reason.
    const fightDeck = ["sprout", "thornling", "mudback-turtle", "sprout", "sprout"];
    const takeFromHand = (side, id) => {
      const at = side.hand.findIndex((card) => card.id === id);
      return at < 0 ? null : side.hand.splice(at, 1)[0];
    };

    const fight = matchEngine.createMatch(fightDeck, { rng: fixedRng });
    const yourFighter = takeFromHand(fight.player, "sprout");
    const theirWall = takeFromHand(fight.opponent, "mudback-turtle");
    if (!yourFighter || !theirWall) {
      fail(
        "the controlled fight deck did not deal a Sprout to the player and a Mudback Turtle to the opponent, " +
          "so table combat cannot be checked"
      );
    } else {
      fight.player.table = [yourFighter];
      fight.opponent.table = [theirWall];
      const theirHeroBefore = fight.opponent.health;
      const wallHealthBefore = theirWall.health;
      const fightLogBefore = fight.log.length;
      matchEngine.endTurn(fight);
      const fightLines = fight.log.slice(fightLogBefore);

      if (theirWall.health !== wallHealthBefore - yourFighter.attack) {
        fail(
          `ending the turn left the opponent's front card "${theirWall.name}" at ${theirWall.health} health ` +
            `instead of ${wallHealthBefore - yourFighter.attack} after ${yourFighter.attack} damage from "${yourFighter.name}"`
        );
      }
      if (fight.opponent.health !== theirHeroBefore) {
        fail(
          `ending the turn cut the opponent's hero to ${fight.opponent.health} while its table still held ` +
            `"${theirWall.name}", so the blow went past the card in front of it`
        );
      }
      const hitLine = fightLines.find(
        (line) => line.includes(yourFighter.name) && line.includes(theirWall.name)
      );
      if (!hitLine) {
        fail(
          `the attack on the opponent's "${theirWall.name}" was not logged by name: the turn added ` +
            JSON.stringify(fightLines)
        );
      } else if (!hitLine.includes(`${theirWall.health} health left`)) {
        fail(`the log line for the hit on "${theirWall.name}" does not state its remaining health ${theirWall.health}: "${hitLine}"`);
      }
    }

    // A card worn to zero leaves its table, and the log names the card that
    // fell. The front card of the opponent's table starts one hit from falling,
    // so nothing after the first blow can be what removed it.
    const fall = matchEngine.createMatch(fightDeck, { rng: fixedRng });
    const striker = takeFromHand(fall.player, "sprout");
    const doomed = takeFromHand(fall.opponent, "thornling");
    if (!striker || !doomed || doomed.health > striker.attack) {
      fail(
        "the controlled fight deck did not deal a card the player can fell in one blow, so a card leaving the table cannot be checked"
      );
    } else {
      fall.player.table = [striker];
      fall.opponent.table = [doomed];
      const theirHeroBefore = fall.opponent.health;
      const fallLogBefore = fall.log.length;
      matchEngine.endTurn(fall);
      const fallLines = fall.log.slice(fallLogBefore);

      if (fall.opponent.table.includes(doomed)) {
        fail(`the opponent's "${doomed.name}" was reduced to 0 health but stayed on the table`);
      }
      if (fall.opponent.health !== theirHeroBefore) {
        fail(
          `the opponent's hero fell to ${fall.opponent.health} on the blow that emptied its table, instead of ` +
            "staying untouched until the table was clear"
        );
      }
      const fellLine = fallLines.find((line) => line.includes(doomed.name) && /falls/i.test(line));
      if (!fellLine) {
        fail(
          `the match log never says the fallen "${doomed.name}" left the table: the turn added ` +
            JSON.stringify(fallLines)
        );
      } else if (!/opponent's table/i.test(fellLine)) {
        fail(`the log says "${doomed.name}" fell without saying which table it left: "${fellLine}"`);
      }
      if (!fallLines.some((line) => line.includes(doomed.name) && line.includes("0 health"))) {
        fail(`the log never shows "${doomed.name}" at 0 health before it left the table: ${JSON.stringify(fallLines)}`);
      }
    }

    // The opponent's turn is fought over the same way: its cards hit the front
    // card of your table, and your hero is untouched while that card stands.
    const defend = matchEngine.createMatch(fightDeck, { rng: fixedRng });
    const yourWall = takeFromHand(defend.player, "mudback-turtle");
    const theirFighter = takeFromHand(defend.opponent, "thornling");
    if (!yourWall || !theirFighter) {
      fail(
        "the controlled fight deck did not deal a Mudback Turtle to the player and a Thornling to the opponent, " +
          "so the opponent's attack cannot be checked"
      );
    } else {
      defend.player.table = [yourWall];
      defend.opponent.table = [theirFighter];
      const yourHeroBefore = defend.player.health;
      const wallHealthBefore = yourWall.health;
      matchEngine.endTurn(defend);
      // Every card on the opponent's table attacked once during its turn, and
      // nothing the player did can have damaged its own card in between.
      const incoming = defend.opponent.table.reduce((total, card) => total + card.attack, 0);

      if (yourWall.health !== Math.max(0, wallHealthBefore - incoming)) {
        fail(
          `the opponent's turn left your front card "${yourWall.name}" at ${yourWall.health} health instead of ` +
            `${Math.max(0, wallHealthBefore - incoming)} after ${incoming} damage from its table`
        );
      }
      if (yourWall.health === 0 && defend.player.table.includes(yourWall)) {
        fail(`your "${yourWall.name}" was reduced to 0 health by the opponent but stayed on the table`);
      }
      if (yourWall.health > 0 && defend.player.health !== yourHeroBefore) {
        fail(
          `the opponent's turn cut your hero to ${defend.player.health} while your table still held ` +
            `"${yourWall.name}", so the blow went past the card in front of it`
        );
      }
      if (!defend.log.some((line) => line.includes(`your ${yourWall.name}`) && line.includes("health"))) {
        fail(`the opponent's attack on your "${yourWall.name}" was not logged against that card`);
      }
    }

    // The player directs a blow, rather than leaving every attack to the front
    // line. A card on the player's table can be sent at any card on the
    // opponent's table: that card takes the damage while the front card and the
    // hero behind it are untouched, and a card worn to zero leaves the table,
    // named in the log. A target that is not there, and the hero while a card
    // still stands in front of it, are refused without changing anything.
    if (typeof matchEngine.attack !== "function") {
      fail("docs/match.js exports no attack(), so a player cannot choose which card to strike");
    } else {
      const aimed = matchEngine.createMatch(fightDeck, { rng: fixedRng });
      const shooter = takeFromHand(aimed.player, "sprout");
      const aimedFront = takeFromHand(aimed.opponent, "mudback-turtle");
      const aimedBack = takeFromHand(aimed.opponent, "glowcap");
      if (!shooter || !aimedFront || !aimedBack) {
        fail("the controlled fight deck did not deal the cards a chosen-target check needs");
      } else {
        aimed.player.table = [shooter];
        aimed.opponent.table = [aimedFront, aimedBack];
        const frontBefore = aimedFront.health;
        const backBefore = aimedBack.health;
        const heroBefore = aimed.opponent.health;
        const aimedLogBefore = aimed.log.length;
        matchEngine.attack(aimed, shooter.id, aimedBack.id);
        const aimedLines = aimed.log.slice(aimedLogBefore);

        if (aimedBack.health !== backBefore - shooter.attack) {
          fail(
            `attacking the opponent's "${aimedBack.name}" with "${shooter.name}" left it at ${aimedBack.health} ` +
              `health instead of ${backBefore - shooter.attack}`
          );
        }
        if (aimedFront.health !== frontBefore || aimed.opponent.health !== heroBefore) {
          fail(
            `attacking past the opponent's front card left the front "${aimedFront.name}" at ${aimedFront.health} ` +
              `health and the hero at ${aimed.opponent.health} instead of untouched`
          );
        }
        if (!aimedLines.some((line) => line.includes(shooter.name) && line.includes(aimedBack.name))) {
          fail(
            `the attack on the chosen "${aimedBack.name}" was not logged against that card: ${JSON.stringify(aimedLines)}`
          );
        }
      }

      // A chosen card can be felled even though another card stands in front of it.
      const pickOff = matchEngine.createMatch(fightDeck, { rng: fixedRng });
      const hitter = takeFromHand(pickOff.player, "thornling");
      const guard = takeFromHand(pickOff.opponent, "mudback-turtle");
      const mark = takeFromHand(pickOff.opponent, "thornling");
      if (!hitter || !guard || !mark || mark.health > hitter.attack) {
        fail(
          "the controlled fight deck did not deal a card the player can fell behind the front, " +
            "so a chosen fall cannot be checked"
        );
      } else {
        pickOff.player.table = [hitter];
        pickOff.opponent.table = [guard, mark];
        const heroBeforeFall = pickOff.opponent.health;
        const pickLogBefore = pickOff.log.length;
        matchEngine.attack(pickOff, hitter.id, mark.id);
        const pickLines = pickOff.log.slice(pickLogBefore);
        if (pickOff.opponent.table.includes(mark)) {
          fail(`the chosen "${mark.name}" was worn to 0 health but stayed on the opponent's table`);
        }
        if (pickOff.opponent.table[0] !== guard) {
          fail("the front card left the table when a card behind it was the one felled");
        }
        if (pickOff.opponent.health !== heroBeforeFall) {
          fail("a blow at a chosen card past the front one reached the opponent's hero");
        }
        if (!pickLines.some((line) => line.includes(mark.name) && /falls/i.test(line))) {
          fail(`the log never says the chosen "${mark.name}" fell: ${JSON.stringify(pickLines)}`);
        }
      }

      // A target that is not on the opponent's table is refused, and nothing moves.
      const bogus = matchEngine.createMatch(fightDeck, { rng: fixedRng });
      const bogusAttacker = takeFromHand(bogus.player, "sprout");
      const bogusFront = takeFromHand(bogus.opponent, "mudback-turtle");
      if (!bogusAttacker || !bogusFront) {
        fail("the controlled fight deck did not deal the cards a refused-target check needs");
      } else {
        bogus.player.table = [bogusAttacker];
        bogus.opponent.table = [bogusFront];
        const frozen = JSON.stringify([bogusFront.health, bogus.opponent.health, bogus.log.length]);
        let refusal = null;
        try {
          matchEngine.attack(bogus, bogusAttacker.id, "not-a-real-card");
        } catch (error) {
          refusal = error.message;
        }
        if (!refusal) {
          fail("attacking a card that is not on the opponent's table was allowed");
        } else if (!refusal.includes("not-a-real-card")) {
          fail(`a target that is not on the opponent's table was refused without naming it: "${refusal}"`);
        }
        if (JSON.stringify([bogusFront.health, bogus.opponent.health, bogus.log.length]) !== frozen) {
          fail("a refused attack changed the match anyway");
        }

        // The hero is refused while a card still stands in front of it.
        const heroGuardBefore = bogus.opponent.health;
        let heroRefusal = null;
        try {
          matchEngine.attack(bogus, bogusAttacker.id, "hero");
        } catch (error) {
          heroRefusal = error.message;
        }
        if (!heroRefusal) {
          fail("attacking the opponent hero was allowed while its table still held a card");
        } else if (!/table|card/i.test(heroRefusal)) {
          fail(`a hero attack behind a card was refused without saying the table stands in front: "${heroRefusal}"`);
        }
        if (bogus.opponent.health !== heroGuardBefore || bogus.opponent.table.length !== 1) {
          fail("a refused hero attack changed the opponent's board anyway");
        }
      }

      // With nothing in front of it, the hero can be struck instead.
      const openField = matchEngine.createMatch(fightDeck, { rng: fixedRng });
      const heroStriker = takeFromHand(openField.player, "thornling");
      if (!heroStriker) {
        fail("the controlled fight deck did not deal a card a clear swing at the hero needs");
      } else {
        openField.player.table = [heroStriker];
        openField.opponent.table = [];
        const openHeroBefore = openField.opponent.health;
        const openLogBefore = openField.log.length;
        matchEngine.attack(openField, heroStriker.id, "hero");
        if (openField.opponent.health !== openHeroBefore - heroStriker.attack) {
          fail(
            `an attack at the empty opponent table left its hero at ${openField.opponent.health} instead of ` +
              `${openHeroBefore - heroStriker.attack} after ${heroStriker.attack} damage`
          );
        }
        const openLines = openField.log.slice(openLogBefore);
        if (!openLines.some((line) => line.includes(heroStriker.name) && /opponent health/.test(line))) {
          fail(`the blow at the opponent hero was not logged as hero damage: ${JSON.stringify(openLines)}`);
        }
      }

      // A card strikes once a turn: a second attack with the same card is
      // refused, and ending the turn skips it rather than letting it strike again.
      const spentOnce = matchEngine.createMatch(fightDeck, { rng: fixedRng });
      const spentCard = takeFromHand(spentOnce.player, "sprout");
      const spentTarget = takeFromHand(spentOnce.opponent, "mudback-turtle");
      if (!spentCard || !spentTarget) {
        fail("the controlled fight deck did not deal the cards a spent-attacker check needs");
      } else {
        spentOnce.player.table = [spentCard];
        spentOnce.opponent.table = [spentTarget];
        matchEngine.attack(spentOnce, spentCard.id, spentTarget.id);
        const targetAfterFirst = spentTarget.health;
        let repeatRefusal = null;
        try {
          matchEngine.attack(spentOnce, spentCard.id, spentTarget.id);
        } catch (error) {
          repeatRefusal = error.message;
        }
        if (!repeatRefusal) {
          fail("a card that had already attacked was allowed to attack again in the same turn");
        } else if (!/already/i.test(repeatRefusal)) {
          fail(`a repeat attack was refused without saying the card had already attacked: "${repeatRefusal}"`);
        }
        if (spentTarget.health !== targetAfterFirst) {
          fail("a refused second attack changed the target anyway");
        }

        const spentLogBefore = spentOnce.log.length;
        matchEngine.endTurn(spentOnce);
        const spentTurnLines = spentOnce.log.slice(spentLogBefore);
        const opponentAt = spentTurnLines.indexOf("Opponent's turn.");
        const playerLines = opponentAt >= 0 ? spentTurnLines.slice(0, opponentAt) : spentTurnLines;
        if (playerLines.some((line) => line.includes(spentCard.name))) {
          fail(
            `a card that had already attacked struck again when the turn was ended: ${JSON.stringify(playerLines)}`
          );
        }
        if (!playerLines.includes("Your table deals no damage.")) {
          fail(
            `a turn whose only table card was already spent did not say no damage was dealt: ${JSON.stringify(playerLines)}`
          );
        }
      }
    }

    // A match always reaches a result: two small decks race each other, and the
    // moment a hero falls the match is over, the winner is named, and no move is
    // accepted any more.
    const race = matchEngine.createMatch(cheapDeck);
    for (let move = 0; move < 60 && !race.over; move += 1) {
      const playable = race.player.hand.find((card) => card.cost <= race.player.energy);
      if (playable) matchEngine.playCard(race, playable.id);
      else matchEngine.endTurn(race);
    }

    if (!race.over) {
      fail(
        `60 moves into a match both heroes were still standing (${race.player.health} and ` +
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
    for (let move = 0; move < 60 && !priceyDeck.over; move += 1) {
      const playable = priceyDeck.player.hand.find((card) => card.cost <= priceyDeck.player.energy);
      if (playable) matchEngine.playCard(priceyDeck, playable.id);
      else matchEngine.endTurn(priceyDeck);
    }
    if (!priceyDeck.over) {
      fail(
        `a deck of only the dearest cards stalled: 60 moves in, both heroes stood at ` +
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
      ["setTotal", "cards in the set"],
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
      if (card.ability !== catalogAbility(card.id)) {
        fail(
          `get-state returns the deck card "${card.name}" with ability ${JSON.stringify(card.ability ?? null)} ` +
            `where its face says ${JSON.stringify(catalogAbility(card.id))}`
        );
      }
    }

    // The deck's shape while it is built is part of what the page shows, so it is
    // part of what get-state returns: one row per energy cost the deck holds,
    // whose counts add up to the deck's size.
    if (JSON.stringify(reported.deckCurve) !== JSON.stringify(live.deckCurve)) {
      fail(
        `get-state reports the deck curve as ${JSON.stringify(reported.deckCurve)} while the page says ` +
          `${JSON.stringify(live.deckCurve)}`
      );
    }
    const reportedCurveSum = (Array.isArray(reported.deckCurve) ? reported.deckCurve : []).reduce(
      (total, row) => total + row.count,
      0
    );
    if (reportedCurveSum !== live.deckSize) {
      fail(
        `get-state's deck curve counts ${reportedCurveSum} card(s) across its costs while the deck holds ` +
          `${live.deckSize}`
      );
    }

    // The card the next win will add is part of what the home screen shows, so it
    // is part of what get-state returns — the same card a win actually awards.
    if (JSON.stringify(reported.nextReward) !== JSON.stringify(live.nextReward)) {
      fail(
        `get-state reports nextReward ${JSON.stringify(reported.nextReward)} while the page's state says ` +
          `${JSON.stringify(live.nextReward)}`
      );
    }
    if (reported.nextRewardComplete !== live.nextRewardComplete) {
      fail(
        `get-state reports nextRewardComplete ${reported.nextRewardComplete} while the page's state says ` +
          `${live.nextRewardComplete}`
      );
    }
  }

  const listCollection = toolNamed("list-collection");
  if (!listCollection) {
    fail('no "list-collection" tool is declared, so an agent cannot read the cards in the game');
  } else {
    if (!listCollection.annotations || listCollection.annotations.readOnlyHint !== true) {
      fail('"list-collection" does not declare itself read-only, though it changes nothing');
    }
    const listed = await listCollection.execute({});
    const listedCards = Array.isArray(listed.cards) ? listed.cards : [];

    // The tool returns the whole set, so what an agent reads is what the screen
    // shows: every card, each saying whether it is owned and how many copies.
    const setIds = cardCatalog.CARDS.map((card) => card.id);
    const listedIds = listedCards.map((card) => card.id);
    const missingFromSet = setIds.filter((id) => !listedIds.includes(id));
    if (listedIds.length !== setIds.length || missingFromSet.length) {
      fail(
        `list-collection returns ${listedIds.length} card(s) instead of the whole set of ${setIds.length}, ` +
          `missing ${missingFromSet.join(", ") || "none"}`
      );
    }
    if (new Set(listedIds).size !== listedIds.length) {
      fail(`list-collection lists a card more than once: ${listedIds.join(", ")}`);
    }
    const heldCopies = new Map(owned.cards.map((card) => [card.id, card.copies]));
    for (const card of listedCards) {
      const copies = heldCopies.get(card.id) ?? 0;
      if (card.copies !== copies) {
        fail(`list-collection says "${card.name}" is held in ${card.copies} copies while the player holds ${copies}`);
      }
      if (card.owned !== copies > 0) {
        fail(`list-collection says "${card.name}" is owned ${card.owned} while the player holds ${copies} copies`);
      }
      for (const stat of ["cost", "attack", "health"]) {
        if (!Number.isInteger(card[stat])) {
          fail(`list-collection returns "${card.name}" with no ${stat}, so an agent cannot judge the card`);
        }
      }
      // A card's ability is half of what it is: an agent choosing a deck reads
      // the same words the card's face prints, or null for a card that does
      // nothing when played.
      if (card.ability !== catalogAbility(card.id)) {
        fail(
          `list-collection returns "${card.name}" with ability ${JSON.stringify(card.ability ?? null)} where its ` +
            `face says ${JSON.stringify(catalogAbility(card.id))}`
        );
      }
    }
    for (const [id, expected] of [
      ["glowcap", "When played: draw a card"],
      ["moon-bloom", "When played: draw a card"],
      ["sprout", cardCatalog.HEAL_ON_PLAY],
      ["dewdrop-nymph", cardCatalog.HEAL_ON_PLAY],
    ]) {
      const entry = listedCards.find((card) => card.id === id);
      if (!entry) {
        fail(`list-collection does not return "${id}", so its ability cannot be read`);
      } else if (entry.ability !== expected) {
        fail(
          `list-collection returns "${id}" with ability ${JSON.stringify(entry.ability ?? null)} instead of ` +
            `${JSON.stringify(expected)}`
        );
      }
    }
    if (listed.distinctCards !== owned.distinctCards) {
      fail(`list-collection reports ${listed.distinctCards} different cards while the page says ${owned.distinctCards}`);
    }
    if (listed.setTotal !== cardCatalog.CARDS.length) {
      fail(`list-collection reports a set of ${listed.setTotal} cards while the game has ${cardCatalog.CARDS.length}`);
    }
  }

  // --- The set can show only the cards still to collect ----------------------

  // A player working toward a full set can hide the cards they already hold. The
  // view is a page choice, so switching it must leave the collection and the
  // deck exactly as they were, and both a visitor and an agent can read which
  // view is showing.
  const setCollectionViewTool = toolNamed("set-collection-view");
  const setViewButtons = [...document.querySelectorAll("[data-collection-view]")];
  const setList = document.getElementById("collection-list");
  if (!setCollectionViewTool) {
    fail('no "set-collection-view" tool is declared, so an agent cannot choose between every card and only those still to collect');
  } else if (setList) {
    if (setViewButtons.length !== 3) {
      fail(
        `the Collection screen offers ${setViewButtons.length} view control(s) where it should offer three — every card, only those still to collect, and only those that act when played`
      );
    }

    // The default is the whole set, as get-state, list-collection and the page
    // all agree, and every card id is listed.
    const beforeView = game.readCollection();
    const beforeState = game.readState();
    const setIds = cardCatalog.CARDS.map((card) => card.id);
    if (beforeView.view !== "all") {
      fail(`the collection opens showing the "${beforeView.view}" view where "all" — every card — is expected`);
    }
    if (beforeState.collectionView !== beforeView.view) {
      fail(
        `get-state reports the collection view as "${beforeState.collectionView}" while list-collection reports "${beforeView.view}"`
      );
    }
    const allRows = [...setList.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);
    if (allRows.length !== setIds.length) {
      fail(`the collection's "all" view lists ${allRows.length} card(s) where the game has ${setIds.length}`);
    }

    // Switching to "missing" lists only the cards the player does not hold.
    const afterMissingView = await setCollectionViewTool.execute({ view: "missing" });
    if (afterMissingView.collectionView !== "missing") {
      fail(`switching the set to "missing" reports the view as "${afterMissingView.collectionView}" instead of "missing"`);
    }
    const heldIds = new Set(beforeView.ownedCards.map((card) => card.id));
    const expectedMissing = setIds.filter((id) => !heldIds.has(id));
    const missingRows = [...setList.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);
    const wrongMissing = missingRows.filter((id) => heldIds.has(id));
    const stillShowing = expectedMissing.filter((id) => !missingRows.includes(id));
    if (missingRows.length !== expectedMissing.length || wrongMissing.length || stillShowing.length) {
      fail(
        `the "missing" view lists ${missingRows.length} card(s) where ${expectedMissing.length} are uncollected` +
          `${wrongMissing.length ? `; it still shows collected ${wrongMissing.join(", ")}` : ""}` +
          `${stillShowing.length ? `; it hides uncollected ${stillShowing.join(", ")}` : ""}`
      );
    }
    if (setList.querySelectorAll(".owned-card").length) {
      fail(
        `the "missing" view marks ${setList.querySelectorAll(".owned-card").length} card(s) as owned, though it should list only cards not yet collected`
      );
    }
    const pressedMissing = setViewButtons
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.collectionView);
    if (pressedMissing.length !== 1 || pressedMissing[0] !== "missing") {
      fail(`the "missing" view does not mark its own button pressed (pressed: ${pressedMissing.join(", ") || "none"})`);
    }

    // Switching the view touches neither the collection nor the deck.
    const afterState = game.readState();
    const afterView = game.readCollection();
    if (JSON.stringify(asIdCopies(afterView.ownedCards)) !== JSON.stringify(asIdCopies(beforeView.ownedCards))) {
      fail("switching the set view changed the cards in the collection");
    }
    if (JSON.stringify(afterState.deck) !== JSON.stringify(beforeState.deck)) {
      fail("switching the set view changed the deck");
    }
    const missingState = await getState.execute({});
    if (missingState.collectionView !== "missing") {
      fail(`get-state reports the collection view as "${missingState.collectionView}" while the "missing" view is showing`);
    }

    // Switching back restores the whole set and marks "all" pressed.
    const backState = await setCollectionViewTool.execute({ view: "all" });
    if (backState.collectionView !== "all") {
      fail(`switching the set back to "all" reports the view as "${backState.collectionView}"`);
    }
    const backRows = [...setList.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);
    if (backRows.length !== setIds.length) {
      fail(`the collection's "all" view lists ${backRows.length} card(s) after switching back where the game has ${setIds.length}`);
    }
    const backOwned = setList.querySelectorAll(".owned-card").length;
    if (backOwned !== beforeView.distinctCards) {
      fail(
        `the collection's "all" view marks ${backOwned} card(s) as owned after switching back, where the player owns ${beforeView.distinctCards} different one(s)`
      );
    }
    const pressedAll = setViewButtons
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.collectionView);
    if (pressedAll.length !== 1 || pressedAll[0] !== "all") {
      fail(`the "all" view does not mark its own button pressed (pressed: ${pressedAll.join(", ") || "none"})`);
    }

    // The "abilities" view lists only the cards whose face carries a when-played
    // ability — owned and unowned alike — so a player building around one can see
    // the cards that carry it instead of reading the whole set. Which cards those
    // are is the catalog's answer, not the page's.
    const abilityIds = setIds.filter((id) => catalogAbility(id) !== null);
    if (!abilityIds.length) {
      fail('no card in the game carries a when-played ability, so the "abilities" view has nothing to list');
    }
    const allViewListLabel = setList.getAttribute("aria-label");
    const afterAbilityView = await setCollectionViewTool.execute({ view: "abilities" });
    if (afterAbilityView.collectionView !== "abilities") {
      fail(`switching the set to "abilities" reports the view as "${afterAbilityView.collectionView}" instead of "abilities"`);
    }
    const abilityRows = [...setList.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);
    if (abilityRows.join(", ") !== abilityIds.join(", ")) {
      const withoutAbility = abilityRows.filter((id) => catalogAbility(id) === null);
      const hidden = abilityIds.filter((id) => !abilityRows.includes(id));
      fail(
        `the "abilities" view lists ${abilityRows.length} card(s) in the order ${abilityRows.slice(0, 4).join(", ")}, … where the game's ` +
          `${abilityIds.length} ability card(s) in catalog order are ${abilityIds.join(", ")}` +
          `${withoutAbility.length ? `; it shows ${withoutAbility.join(", ")}, which carry no when-played ability` : ""}` +
          `${hidden.length ? `; it hides ${hidden.join(", ")}, which carry one` : ""}`
      );
    }
    const pressedAbilities = setViewButtons
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.collectionView);
    if (pressedAbilities.length !== 1 || pressedAbilities[0] !== "abilities") {
      fail(`the "abilities" view does not mark its own button pressed (pressed: ${pressedAbilities.join(", ") || "none"})`);
    }
    if (setList.getAttribute("aria-label") === allViewListLabel) {
      fail(
        'the set list names what it lists the same way in the "abilities" view as in the "all" view, so a screen reader cannot tell which cards are showing'
      );
    }

    // Both readers agree on the view, and switching it leaves the count of cards
    // collected, the collection and the deck exactly as they were.
    const abilityState = await getState.execute({});
    if (abilityState.collectionView !== "abilities") {
      fail(`get-state reports the collection view as "${abilityState.collectionView}" while the "abilities" view is showing`);
    }
    if (game.readCollection().view !== "abilities") {
      fail(`list-collection reports the collection view as "${game.readCollection().view}" while the "abilities" view is showing`);
    }
    const collectedWhileShowing = textOf(
      document.querySelector('#screen-collection [data-field="distinctCards"]')?.closest(".standing-value")
    );
    const collectedExpected = `${beforeView.distinctCards} of ${beforeView.setTotal}`;
    if (collectedWhileShowing !== collectedExpected) {
      fail(
        `the "abilities" view leaves the cards collected reading "${collectedWhileShowing}" where the set stands at "${collectedExpected}"`
      );
    }
    const afterAbilityCollection = game.readCollection();
    if (JSON.stringify(asIdCopies(afterAbilityCollection.ownedCards)) !== JSON.stringify(asIdCopies(beforeView.ownedCards))) {
      fail('switching the set to the "abilities" view changed the cards in the collection');
    }
    if (JSON.stringify(game.readState().deck) !== JSON.stringify(beforeState.deck)) {
      fail('switching the set to the "abilities" view changed the deck');
    }

    const backFromAbilityView = await setCollectionViewTool.execute({ view: "all" });
    if (backFromAbilityView.collectionView !== "all") {
      fail(`switching the set back from "abilities" reports the view as "${backFromAbilityView.collectionView}"`);
    }

    // A view the page does not have is refused with a reason, and changes nothing.
    const refusedView = await setCollectionViewTool.execute({ view: "everything" });
    if (!refusedView.error) {
      fail('setting the collection view to "everything" was accepted, though the page has only "all", "missing" and "abilities"');
    }
    if (game.readCollection().view !== "all") {
      fail(`a refused view left the collection showing "${game.readCollection().view}" instead of "all"`);
    }
  }

  // --- The same set can be read cheapest first -------------------------------

  // A player looking for a card to add can read the set from cheapest to
  // dearest instead of in the game's catalog order. The order is a page choice,
  // so switching it must leave the collection and the deck exactly as they
  // were, and both a visitor and an agent can read which order is showing.
  const setCollectionOrderTool = toolNamed("set-collection-order");
  const setOrderButtons = [...document.querySelectorAll("[data-collection-order]")];
  if (!setCollectionOrderTool) {
    fail('no "set-collection-order" tool is declared, so an agent cannot order the set by cost the way a visitor can');
  } else if (setList) {
    if (setOrderButtons.length !== 2) {
      fail(
        `the Collection screen offers ${setOrderButtons.length} order control(s) where it should offer two — catalog order and by cost`
      );
    }

    const catalogIds = cardCatalog.CARDS.map((card) => card.id);
    const costById = new Map(cardCatalog.CARDS.map((card) => [card.id, card.cost]));
    const setRowIds = () => [...setList.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);

    // The default is catalog order, as get-state, list-collection and the page
    // all agree, and the rows read in the catalog's own order.
    const beforeOrderState = game.readState();
    const beforeOrderView = game.readCollection();
    if (beforeOrderState.collectionOrder !== "catalog") {
      fail(`the collection opens in the "${beforeOrderState.collectionOrder}" order where "catalog" is expected`);
    }
    if (beforeOrderView.order !== beforeOrderState.collectionOrder) {
      fail(
        `get-state reports the collection order as "${beforeOrderState.collectionOrder}" while list-collection reports "${beforeOrderView.order}"`
      );
    }
    const catalogRows = setRowIds();
    if (catalogRows.join(", ") !== catalogIds.join(", ")) {
      fail(
        `the collection opens in an order that is not the catalog's: it lists ${catalogRows.slice(0, 4).join(", ")}, … ` +
          `instead of ${catalogIds.slice(0, 4).join(", ")}, …`
      );
    }
    const pressedCatalog = setOrderButtons
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.collectionOrder);
    if (pressedCatalog.length !== 1 || pressedCatalog[0] !== "catalog") {
      fail(`the catalog order does not mark its own button pressed (pressed: ${pressedCatalog.join(", ") || "none"})`);
    }

    // Switching to cost keeps exactly the same cards, cheapest first with ties
    // in catalog order, and reports the order in both get-state and
    // list-collection.
    const switchedOrder = await setCollectionOrderTool.execute({ order: "cost" });
    if (switchedOrder.collectionOrder !== "cost") {
      fail(`switching the set to "cost" reports the order as "${switchedOrder.collectionOrder}" instead of "cost"`);
    }
    const orderedState = await getState.execute({});
    if (orderedState.collectionOrder !== "cost") {
      fail(`get-state reports the collection order as "${orderedState.collectionOrder}" while the "cost" order is showing`);
    }
    if (game.readCollection().order !== "cost") {
      fail(`list-collection reports the collection order as "${game.readCollection().order}" while the "cost" order is showing`);
    }
    const costRows = setRowIds();
    if (costRows.length !== catalogRows.length || [...costRows].sort().join(", ") !== [...catalogRows].sort().join(", ")) {
      fail(
        `ordering the set by cost changed which cards are listed: ${costRows.length} row(s) where catalog order lists ${catalogRows.length}`
      );
    }
    const expectedCostRows = [...catalogRows].sort(
      (a, b) => costById.get(a) - costById.get(b) || catalogIds.indexOf(a) - catalogIds.indexOf(b)
    );
    if (costRows.join(", ") !== expectedCostRows.join(", ")) {
      fail(`the set ordered by cost is not cheapest first with ties in catalog order: it reads ${costRows.join(", ")}`);
    }
    const outOfOrder = costRows.filter((id, index) => index > 0 && costById.get(id) < costById.get(costRows[index - 1]));
    if (outOfOrder.length) {
      fail(`the cost order steps back down in price at ${outOfOrder.join(", ")}, though it should rise from cheapest to dearest`);
    }
    const pressedCost = setOrderButtons
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.collectionOrder);
    if (pressedCost.length !== 1 || pressedCost[0] !== "cost") {
      fail(`the cost order does not mark its own button pressed (pressed: ${pressedCost.join(", ") || "none"})`);
    }

    // Ordering touches neither the collection nor the deck.
    const afterOrderState = game.readState();
    const afterOrderView = game.readCollection();
    if (JSON.stringify(asIdCopies(afterOrderView.ownedCards)) !== JSON.stringify(asIdCopies(beforeOrderView.ownedCards))) {
      fail("ordering the set by cost changed the cards in the collection");
    }
    if (JSON.stringify(afterOrderState.deck) !== JSON.stringify(beforeOrderState.deck)) {
      fail("ordering the set by cost changed the deck");
    }

    // The order composes with the view: the cost order still lists only the
    // cards the "missing" view shows, read cheapest first.
    await setCollectionViewTool.execute({ view: "missing" });
    const missingCostRows = setRowIds();
    const heldIds = new Set(beforeOrderView.ownedCards.map((card) => card.id));
    const expectedMissingCost = expectedCostRows.filter((id) => !heldIds.has(id));
    if (missingCostRows.join(", ") !== expectedMissingCost.join(", ")) {
      fail(
        `the "missing" view in cost order reads ${missingCostRows.slice(0, 4).join(", ")}, … where the uncollected cards cheapest first are expected`
      );
    }

    // The same holds for the "abilities" view: exactly the cards that act when
    // played, cheapest first, so what a deck around an ability would cost reads
    // off the list.
    await setCollectionViewTool.execute({ view: "abilities" });
    const abilityCostRows = setRowIds();
    const expectedAbilityCost = expectedCostRows.filter((id) => catalogAbility(id) !== null);
    if (abilityCostRows.join(", ") !== expectedAbilityCost.join(", ")) {
      fail(
        `the "abilities" view in cost order reads ${abilityCostRows.slice(0, 4).join(", ")}, … where the game's ability cards ` +
          `cheapest first are ${expectedAbilityCost.join(", ")}`
      );
    }
    await setCollectionViewTool.execute({ view: "all" });

    // Switching back restores catalog order and marks "catalog" pressed.
    const backOrderState = await setCollectionOrderTool.execute({ order: "catalog" });
    if (backOrderState.collectionOrder !== "catalog") {
      fail(`switching the set back to "catalog" reports the order as "${backOrderState.collectionOrder}"`);
    }
    if (setRowIds().join(", ") !== catalogIds.join(", ")) {
      fail("the set did not return to catalog order after switching back");
    }

    // An order the page does not have is refused with a reason, and changes nothing.
    const refusedOrder = await setCollectionOrderTool.execute({ order: "cheapest" });
    if (!refusedOrder.error) {
      fail('setting the collection order to "cheapest" was accepted, though the page has only "catalog" and "cost"');
    }
    if (game.readState().collectionOrder !== "catalog") {
      fail(`a refused order left the collection reading in "${game.readState().collectionOrder}" instead of "catalog"`);
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

  // Before a match begins, the Play screen names who the player is about to
  // face, and the state an agent reads names the same character — the opponent
  // is a character rather than a copy of the player.
  const introBeforeMatch = textOf(document.getElementById("match-intro"));
  if (typeof cardCatalog.OPPONENT_NAME === "string") {
    if (!introBeforeMatch.includes(cardCatalog.OPPONENT_NAME)) {
      fail(
        `the Play screen does not name the opponent before a match: the note reads ` +
          `"${introBeforeMatch || "(nothing)"}"`
      );
    }
    const beforeAnyMatch = game.readState().match;
    if (!beforeAnyMatch.active && beforeAnyMatch.opponentName !== cardCatalog.OPPONENT_NAME) {
      fail(
        `with no match running the state reports the opponent as ${JSON.stringify(beforeAnyMatch.opponentName)} ` +
          `instead of the character the Play screen names (${JSON.stringify(cardCatalog.OPPONENT_NAME)})`
      );
    }
  }

  // Before a match, the Play screen offers who to face: one option per opponent,
  // each naming its character and the kind of deck it brings, with one of them
  // chosen already so Start match opens a board without a second decision.
  game.showScreen("play");
  const beforeMatchState = game.readState();
  const offeredOpponents = beforeMatchState.opponents;
  if (!Array.isArray(offeredOpponents) || offeredOpponents.length < 2) {
    fail(
      `the state offers ${Array.isArray(offeredOpponents) ? offeredOpponents.length : "no"} opponent(s) before a ` +
        "match, so an agent cannot tell who could be faced"
    );
  } else {
    for (const opponent of offeredOpponents) {
      if (!opponent.id || !opponent.name || !opponent.description) {
        fail(`an opponent on offer is not named and described by its deck: ${JSON.stringify(opponent)}`);
      }
      // What each opponent brings is part of what is on offer, so an agent can
      // read the same deck a visitor is shown rather than only its kind. The ids
      // are the cards list-collection describes in full.
      const catalogDeck = cardCatalog.OPPONENT_BY_ID.get(opponent.id)?.deck;
      if (!Array.isArray(opponent.deck) || !opponent.deck.length) {
        fail(
          `the state does not say which cards "${opponent.name}" brings (that opponent has no deck of card ids), ` +
            "so an agent cannot read the deck the picker shows"
        );
      } else if (catalogDeck && opponent.deck.join(", ") !== catalogDeck.join(", ")) {
        fail(
          `the state says "${opponent.name}" brings ${JSON.stringify(opponent.deck)} while docs/cards.js gives it ` +
            JSON.stringify(catalogDeck)
        );
      }
    }
    if (!offeredOpponents.some((opponent) => opponent.id === beforeMatchState.selectedOpponentId)) {
      fail(
        `the state says the chosen opponent is ${JSON.stringify(beforeMatchState.selectedOpponentId)}, which is not ` +
          "one of the opponents it offers"
      );
    }
  }

  const picker = document.getElementById("opponent-picker");
  const pickerRadios = [...(picker?.querySelectorAll("input[type='radio']") ?? [])];
  if (!picker || picker.hidden) {
    fail("the Play screen offers no opponents to choose from before a match");
  } else {
    if (pickerRadios.length !== (offeredOpponents ?? []).length) {
      fail(
        `the Play screen offers ${pickerRadios.length} opponent(s) to pick while the state lists ` +
          `${(offeredOpponents ?? []).length}`
      );
    }
    const checkedRadios = pickerRadios.filter((radio) => radio.checked);
    if (checkedRadios.length !== 1) {
      fail(
        `the opponent picker has ${checkedRadios.length} opponent(s) chosen instead of exactly one, so what Start ` +
          "match would face is not clear"
      );
    } else if (checkedRadios[0].value !== beforeMatchState.selectedOpponentId) {
      fail(
        `the picker shows "${checkedRadios[0].value}" chosen while the state says ` +
          `"${beforeMatchState.selectedOpponentId}" is`
      );
    }
    for (const radio of pickerRadios) {
      const option = radio.closest("label") ?? radio.parentElement;
      const words = textOf(option);
      const opponent = (offeredOpponents ?? []).find((entry) => entry.id === radio.value);
      if (!opponent) {
        fail(`the picker offers "${radio.value}", which the state does not list as an opponent`);
        continue;
      }
      if (!words.includes(opponent.name)) {
        fail(`the picker's option for "${opponent.id}" reads "${words}" instead of naming ${opponent.name}`);
      }
      if (!words.includes(opponent.description)) {
        fail(
          `the picker's option for "${opponent.name}" does not say what kind of deck it brings (` +
            `${JSON.stringify(opponent.description)})`
        );
      }
      if (!words.includes(opponent.look)) {
        fail(
          `the picker's option for "${opponent.name}" does not read the look of the character ` +
            `(${JSON.stringify(opponent.look)}), so a sighted player and a screen reader do not read the same opponent`
        );
      }

      // The character is seen, not only named: the option carries a portrait of
      // the opponent, painted in that opponent's own accent, and the portrait is
      // hidden from assistive technology because the name and look are written
      // beside it. A portrait in the wrong colour or a missing one is a character
      // a player cannot tell from the others.
      const portrait = option?.querySelector("svg.opponent-portrait");
      if (!portrait) {
        fail(`the picker's option for "${opponent.name}" shows no portrait of the character, only its name`);
      } else {
        if (portrait.getAttribute("aria-hidden") !== "true") {
          fail(
            `the picker's portrait of "${opponent.name}" is not hidden from assistive technology, so its ` +
              "shape would be read out beside the name and look it already has"
          );
        }
        const body = portrait.querySelector(".portrait-body");
        if (!body) {
          fail(`the picker's portrait of "${opponent.name}" has no figure in it`);
        } else {
          // The accent token is the catalog's, read as a colour the way the page
          // resolves it: the state carries a name and a look, not a palette.
          const accentToken = cardCatalog.OPPONENT_BY_ID.get(opponent.id)?.accent;
          const probe = document.createElement("span");
          probe.style.color = `var(${accentToken})`;
          option.append(probe);
          const accent = getComputedStyle(probe).color;
          probe.remove();
          const painted = getComputedStyle(body).fill;
          if (painted !== accent) {
            fail(
              `the picker's portrait of "${opponent.name}" is filled ${painted} where that opponent's ` +
                `accent (${accentToken}) is ${accent}, so the character is not drawn in its own colour`
            );
          }
        }
      }

      // Choosing who to face is done with the deck in sight, not on the promise
      // of a sentence: the option carries the faces of the very cards a match
      // against this opponent is dealt — each its picture, its name and the
      // three numbers list-collection reports — read out of the option's own
      // fold so the picker promises what the board will hold.
      const optionCard = radio.closest(".opponent-option");
      const fold = optionCard?.querySelector("details.opponent-deck-fold");
      if (!optionCard || !fold) {
        fail(
          `the picker's option for "${opponent.name}" shows no cards of the deck that opponent brings, ` +
            "only the kind of deck in words"
        );
        continue;
      }

      const faces = [...fold.querySelectorAll("[data-card-id]")];
      const shownIds = faces.map((face) => face.dataset.cardId);
      if (shownIds.join(", ") !== (opponent.deck ?? []).join(", ")) {
        fail(
          `the picker's option for "${opponent.name}" shows ${JSON.stringify(shownIds)} while a match against ` +
            `them is dealt ${JSON.stringify(opponent.deck)}`
        );
      }

      for (const face of faces) {
        const card = cardCatalog.CARD_BY_ID.get(face.dataset.cardId);
        if (!card) continue; // an unknown id is already reported by the comparison above
        const nameRead = textOf(face.querySelector(".deck-card-name"));
        const statsRead = textOf(face.querySelector(".deck-card-stats"));
        const statsExpected = `${card.cost}/${card.attack}/${card.health}`;
        if (nameRead !== card.name || statsRead !== statsExpected) {
          fail(
            `the card "${card.id}" in "${opponent.name}"'s deck reads "${nameRead} ${statsRead}" where it ` +
              `should read "${card.name} ${statsExpected}" (cost/attack/health)`
          );
        }
        if (!face.querySelector("svg.card-art")) {
          fail(`the card "${card.id}" in "${opponent.name}"'s deck is a name and numbers with no picture`);
        }
      }

      // The deck is the one the match deals, not a second list kept beside it:
      // the engine, given this opponent, deals exactly the cards the option shows.
      if (matchEngine) {
        const engineDeal = matchEngine.createMatch(deckIds(), { opponentId: opponent.id }).opponent;
        const dealtIds = [...engineDeal.hand, ...engineDeal.table, ...engineDeal.deck]
          .map((card) => card.id)
          .sort();
        if (dealtIds.join(", ") !== [...shownIds].sort().join(", ")) {
          fail(
            `a match against "${opponent.name}" is dealt ${JSON.stringify(dealtIds)} while the picker promised ` +
              JSON.stringify(shownIds)
          );
        }
      }

      // The fold says how many cards it holds, and is closed until asked, so the
      // picker and the Start match button stay on the first screen; opening it
      // paints every face it holds.
      const toggle = fold.querySelector("summary");
      if (!toggle || !textOf(toggle).includes(String(faces.length))) {
        fail(
          `"${opponent.name}"'s deck fold reads ${JSON.stringify(textOf(toggle))}, which does not say it holds ` +
            `${faces.length} cards`
        );
      }
      if (fold.open) {
        fail(
          `"${opponent.name}"'s deck starts open, so ten faces per opponent push the picker down the page ` +
            "before anyone has asked to see them"
        );
      } else {
        fold.open = true;
        const painted = faces.filter((face) => face.getBoundingClientRect().height > 0).length;
        fold.open = false;
        if (painted !== faces.length) {
          fail(
            `opening "${opponent.name}"'s deck painted ${painted} of the ${faces.length} card faces it holds`
          );
        }
        if (game.readState().opponents.find((entry) => entry.id === opponent.id)?.deckShown) {
          fail(`the state says "${opponent.name}"'s deck is on screen while the picker has it folded away`);
        }
      }
    }

    // Opening a deck is a move a visitor makes, so it is a tool too: it flips one
    // opponent's cards and leaves every other deck where it was, which the state
    // reports back.
    const deckTool = toolNamed("toggle-opponent-deck");
    const foldedOpponent = offeredOpponents?.[0];
    if (!deckTool) {
      fail('no "toggle-opponent-deck" tool is declared, so an agent cannot open an opponent\'s cards as a visitor can');
    } else if (!deckTool.annotations || deckTool.annotations.readOnlyHint !== false) {
      fail('"toggle-opponent-deck" changes what the picker shows but is not marked as changing anything');
    } else if (foldedOpponent) {
      const opened = await deckTool.execute({ opponentId: foldedOpponent.id });
      const shownAfter = game
        .readState()
        .opponents.filter((entry) => entry.deckShown)
        .map((entry) => entry.id);
      if (opened?.deckShown !== true || shownAfter.join(", ") !== foldedOpponent.id) {
        fail(
          `the toggle-opponent-deck tool reports ${JSON.stringify(opened?.deckShown)} open while the state says ` +
            `${JSON.stringify(shownAfter)} is — opening one opponent's deck should show that one and only that one`
        );
      }
      const closed = await deckTool.execute({ opponentId: foldedOpponent.id });
      if (closed?.deckShown !== false || game.readState().opponents.some((entry) => entry.deckShown)) {
        fail("folding an opponent's deck away again through the tool did not leave every deck closed");
      }
      const refused = await deckTool.execute({ opponentId: "no-such-opponent" });
      if (!refused?.error) {
        fail("toggle-opponent-deck opened a deck for an id that is not an opponent, instead of refusing it");
      }
    }
  }

  // --- What a newcomer is told before a match -------------------------------

  // The Play screen stands before a match with a short how-a-match-works strip:
  // four labelled points — what a card costs, how the table fights, which hero
  // losing ends it, and what a card does the moment it is played — folded behind
  // one control. A player who has not finished a match meets it open, and the
  // same words and whether they show are what the get-match-rules tool hands an
  // agent. The strip must not push the picker or the Start match button off the
  // first screen.
  {
    const rulesSection = document.getElementById("match-rules");
    const rulesPoints = document.getElementById("match-rules-points");
    const rulesToggle = document.getElementById("action-toggle-rules");
    const rulesState = game.readState().matchRules;

    if (!rulesSection || !rulesPoints || !rulesToggle) {
      fail(
        "the Play screen has no how-a-match-works strip (#match-rules, #match-rules-points and " +
          "#action-toggle-rules must all exist), so a first-time player is never told how a match works"
      );
    } else if (!rulesState || !Array.isArray(rulesState.points) || rulesState.points.length !== 4) {
      fail(
        `the state exposes ${JSON.stringify(rulesState?.points)} as the match rules instead of four ` +
          "labelled points, so an agent cannot teach a newcomer how a match works"
      );
    } else {
      const labels = [...rulesPoints.querySelectorAll("dt")].map((dt) => textOf(dt));
      const lines = [...rulesPoints.querySelectorAll("dd")].map((dd) => textOf(dd));
      if (labels.length !== 4 || lines.length !== 4) {
        fail(
          `the Play screen prints ${labels.length} rule label(s) and ${lines.length} rule line(s) instead ` +
            "of four labelled points"
        );
      }
      rulesState.points.forEach((point, index) => {
        if (!point.label || !point.text) {
          fail(`match rule ${index + 1} is missing its label or its line: ${JSON.stringify(point)}`);
        } else if (labels[index] !== point.label || lines[index] !== point.text) {
          fail(
            `rule ${index + 1} reads "${labels[index]} — ${lines[index]}" on the page while the state hands an ` +
              `agent "${point.label} — ${point.text}"`
          );
        }
      });
      const allRules = rulesState.points.map((point) => `${point.label} ${point.text}`).join(" ").toLowerCase();
      for (const [word, why] of [
        ["energy", "that a card is paid for with energy"],
        ["card", "that cards are what fight"],
        ["hero", "which hero losing ends the match"],
      ]) {
        if (!allRules.includes(word)) {
          fail(`the match rules never mention "${word}", so a newcomer cannot read ${why}: they read "${allRules}"`);
        }
      }

      // The fourth point is the newest rule: a card can act the moment it is
      // played. It names all three things a card can do as it lands, in the
      // words a card's own face prints them — the abilities are read from
      // docs/cards.js, so the rule a newcomer reads and the card they watch
      // cannot say different things.
      const whenPlayedPoint = rulesState.points[3];
      if (!whenPlayedPoint) {
        fail("the match rules carry no fourth point, so nothing tells a newcomer a card can act as it lands");
      } else {
        const fourthRule = `${whenPlayedPoint.label} ${whenPlayedPoint.text}`.toLowerCase();
        if (!fourthRule.includes("played")) {
          fail(
            `the fourth match rule reads "${whenPlayedPoint.label} — ${whenPlayedPoint.text}", whose label never ` +
              "says a card can act when played"
          );
        }
        for (const [ability, why] of [
          [cardCatalog.DRAW_ON_PLAY, "draw you a card"],
          [cardCatalog.HEAL_ON_PLAY, "heal your hero"],
          [cardCatalog.STRIKE_ON_PLAY, "strike the opponent's front card"],
          [cardCatalog.CLEAR_ON_PLAY, "sweep every card on the opponent's table"],
        ]) {
          // The rule drops the shared "When played:" prefix its own label stands
          // in for, so the rest of the ability is what must appear.
          const words = ability.replace(/^When played:\s*/, "").toLowerCase();
          if (!fourthRule.includes(words)) {
            fail(
              `the fourth match rule reads "${whenPlayedPoint.label} — ${whenPlayedPoint.text}", which never says ` +
                `a played card can "${words}", so a newcomer may never learn a card can ${why}`
            );
          }
        }
      }

      // The control names its action and carries the expanded state a screen
      // reader reads, so the strip folds and reopens on the keyboard as on a tap.
      if (rulesToggle.tagName !== "BUTTON") {
        fail(
          `the rules strip's control is a <${rulesToggle.tagName.toLowerCase()}>, not a button, so a ` +
            "keyboard cannot fold it"
        );
      }
      if (rulesToggle.getAttribute("aria-controls") !== rulesPoints.id) {
        fail(
          `the rules control points at ${JSON.stringify(rulesToggle.getAttribute("aria-controls"))} instead ` +
            `of the points it folds (#${rulesPoints.id})`
        );
      }

      // A player who has not finished a match meets the points open, and the one
      // control folds and reopens them for both the page and the state an agent
      // reads.
      if (game.readState().matchesPlayed === 0) {
        if (!rulesState.shown || rulesToggle.getAttribute("aria-expanded") !== "true" || rulesPoints.hidden) {
          fail("a player who has not finished a match is not shown how a match works on the Play screen");
        }
        rulesToggle.click();
        const folded = game.readState().matchRules;
        if (folded.shown !== false || rulesToggle.getAttribute("aria-expanded") !== "false" || !rulesPoints.hidden) {
          fail("folding the rules strip did not hide the points or did not reach the state an agent reads");
        }
        rulesToggle.click();
        const reopened = game.readState().matchRules;
        if (reopened.shown !== true || rulesToggle.getAttribute("aria-expanded") !== "true" || rulesPoints.hidden) {
          fail("reopening the rules strip did not show the points again or did not reach the state an agent reads");
        }
      }

      // With the points open, what a newcomer reads and the Start match button
      // share the first screen, on a phone and on a wide window alike.
      if (rulesSection.hidden || rulesSection.getBoundingClientRect().height === 0) {
        fail("the rules strip has no place on the Play screen before a match, so a visitor cannot read it");
      } else {
        const foldHeight = document.documentElement.clientHeight;
        const width = document.documentElement.clientWidth;
        for (const [what, id] of [
          ["the opponent picker", "opponent-picker"],
          ["Start match", "action-start-match"],
        ]) {
          const box = document.getElementById(id)?.getBoundingClientRect();
          if (box && box.height > 0 && box.bottom > foldHeight + 1) {
            fail(
              `with the rules shown, ${what} ends ${Math.round(box.bottom - foldHeight)}px below the fold on ` +
                `a ${width}x${foldHeight} window`
            );
          }
        }
      }

      // The same words, reachable by an agent: the tool returns the rules the page
      // prints and whether they are showing.
      const rulesTool = toolNamed("get-match-rules");
      if (!rulesTool) {
        fail('no "get-match-rules" tool is declared, so an agent cannot read what the page tells a newcomer');
      } else {
        if (!rulesTool.annotations || rulesTool.annotations.readOnlyHint !== true) {
          fail('"get-match-rules" does not declare itself read-only, though it only reads');
        }
        const viaTool = await rulesTool.execute({});
        const live = game.readState().matchRules;
        if (!viaTool || typeof viaTool.shown !== "boolean" || !Array.isArray(viaTool.points) || viaTool.points.length !== 4) {
          fail(`the get-match-rules tool returns ${JSON.stringify(viaTool)} instead of four points and whether they show`);
        } else if (JSON.stringify(viaTool.points) !== JSON.stringify(live.points) || viaTool.shown !== live.shown) {
          fail("the get-match-rules tool returns different rules, or a different shown state, than the page's own state");
        }
      }

      // Folding the strip is a move a visitor can make, so it is a tool too: it
      // flips the strip and reports the flip, and leaves it where it was put.
      const toggleTool = toolNamed("toggle-match-rules");
      if (!toggleTool) {
        fail('no "toggle-match-rules" tool is declared, so an agent cannot fold the rules as a visitor can');
      } else if (!toggleTool.annotations || toggleTool.annotations.readOnlyHint !== false) {
        fail('"toggle-match-rules" changes the strip but is not marked as changing anything (readOnlyHint: false)');
      } else if (game.readState().matchesPlayed === 0) {
        const wasShown = game.readState().matchRules.shown;
        const toggled = await toggleTool.execute({});
        if (!toggled || toggled.shown === wasShown || !Array.isArray(toggled.points) || toggled.points.length !== 4) {
          fail(`the toggle-match-rules tool returned ${JSON.stringify(toggled)}, which does not report the strip flipped`);
        } else if (game.readState().matchRules.shown === wasShown) {
          fail("the toggle-match-rules tool reported flipping the strip but the page did not change");
        }
        await toggleTool.execute({});
        if (game.readState().matchRules.shown !== wasShown) {
          fail("toggling the rules strip twice through the tool did not leave it as it was");
        }
      }
    }
  }

  // Before a match the board has no opponent to show, so its portrait slot is
  // empty and hidden even while the Play screen stands ready.
  const beforeMatchPortrait = document.getElementById("match-opponent-portrait");
  if (!beforeMatchPortrait) {
    fail("the board has no portrait slot (#match-opponent-portrait), so the opponent's character can never stand on it");
  } else if (!beforeMatchPortrait.hidden || beforeMatchPortrait.querySelector("svg.opponent-portrait")) {
    fail("the board shows an opponent's portrait before a match, when there is no one being faced");
  }

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

      // The opponent is a named character, and the Play screen says who it is —
      // in the match a tool reads and in the board a visitor looks at.
      if (m.opponentName !== cardCatalog.OPPONENT_NAME) {
        fail(
          `the match reports its opponent as ${JSON.stringify(m.opponentName)} instead of the character ` +
            `docs/cards.js names (${JSON.stringify(cardCatalog.OPPONENT_NAME)})`
        );
      } else {
        const boardText = textOf(document.getElementById("match-board"));
        if (!boardText.includes(m.opponentName)) {
          fail(
            `the Play screen never names the opponent being faced ("${m.opponentName}"): the board reads ` +
              `"${boardText}"`
          );
        }
        const opponentLine = textOf(document.getElementById("match-opponent-name"));
        if (!opponentLine.includes(m.opponentName)) {
          fail(
            `the board's own line for the opponent reads "${opponentLine || "(nothing)"}" instead of naming ` +
              `"${m.opponentName}"`
          );
        }
      }

      // The character the picker showed leads the board: the opponent's portrait
      // stands beside the name and health the board prints, drawn in that
      // opponent's own accent and hidden from assistive technology because the
      // name is already written into the health label. A portrait of the wrong
      // opponent, or one missing, is a character the player cannot know.
      const boardPortrait = document.getElementById("match-opponent-portrait");
      const facing =
        cardCatalog.OPPONENT_BY_ID.get(m.opponentId) ??
        (offeredOpponents ?? []).find((opponent) => opponent.name === m.opponentName) ??
        null;
      if (!boardPortrait) {
        fail("the board has no portrait slot (#match-opponent-portrait), so the opponent's character is not on the board");
      } else if (boardPortrait.hidden) {
        fail(`a match against ${m.opponentName} is running but the board hides the opponent's portrait`);
      } else {
        const portrait = boardPortrait.querySelector("svg.opponent-portrait");
        if (!portrait) {
          fail(`a match against ${m.opponentName} is running but the board shows no portrait of the opponent beside their name`);
        } else {
          if (portrait.getAttribute("aria-hidden") !== "true") {
            fail(
              `the board's portrait of "${m.opponentName}" is not hidden from assistive technology, so its shape ` +
                "would be read beside the name the health label already carries"
            );
          }
          const figure = portrait.querySelector(".portrait-body");
          if (!figure) {
            fail(`the board's portrait of "${m.opponentName}" has no figure in it`);
          }
          if (facing) {
            const pickerPortrait = cardArt?.opponentPortraitSvg(facing);
            if (!pickerPortrait || portrait.innerHTML !== pickerPortrait.innerHTML) {
              fail(
                `the board's portrait of "${m.opponentName}" is not the drawing the picker showed for that ` +
                  "opponent, so the choice made in the picker does not carry onto the table"
              );
            }
            const accentToken = facing.accent;
            const probe = document.createElement("span");
            probe.style.color = `var(${accentToken})`;
            boardPortrait.append(probe);
            const accent = getComputedStyle(probe).color;
            probe.remove();
            const painted = getComputedStyle(figure).fill;
            if (painted !== accent) {
              fail(
                `the board's portrait of "${facing.name}" is filled ${painted} where that opponent's accent ` +
                  `(${accentToken}) is ${accent}, so the character is not drawn in its own colour`
              );
            }
          }
        }
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
      if (picker && !picker.hidden) {
        fail("a match is running but the Play screen still offers a choice of opponents");
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

      // Whose turn it is stands on the board in words, so a player never has to
      // infer it from the log's last line or from the End turn button appearing.
      if (game.turnLabel("player", m.opponentName) !== "Your turn") {
        fail(
          `the turn label for the player reads ${JSON.stringify(game.turnLabel("player", m.opponentName))} ` +
            'instead of "Your turn"'
        );
      }
      if (game.turnLabel("opponent", m.opponentName) !== `${m.opponentName}'s turn`) {
        fail(
          `the turn label for the opponent reads ${JSON.stringify(game.turnLabel("opponent", m.opponentName))} ` +
            `instead of naming who is being faced ("${m.opponentName}'s turn")`
        );
      }
      const turnStanding = document.getElementById("match-turn-standing");
      const turnValue = document.getElementById("match-turn");
      if (!turnStanding || !turnValue) {
        fail("the board has no turn indicator (#match-turn-standing / #match-turn), so whose turn it is is never said");
      } else if (turnStanding.hidden) {
        fail("a match is running but the board's turn indicator is hidden, so nothing says whose turn it is");
      } else {
        if (textOf(turnStanding.querySelector(".standing-label")) !== "Turn") {
          fail(
            `the turn indicator's label reads ${JSON.stringify(textOf(turnStanding.querySelector(".standing-label")))} ` +
              'instead of "Turn", so the value beside it is read without what it is'
          );
        }
        const isLive =
          turnValue.getAttribute("role") === "status" || Boolean(turnValue.getAttribute("aria-live"));
        if (!isLive) {
          fail(
            'the turn indicator is not a live region (no role="status" and no aria-live), so a screen reader ' +
              "is never told when the turn passes"
          );
        }
        const expectedTurn = game.turnLabel(m.turn, m.opponentName);
        if (textOf(turnValue) !== expectedTurn) {
          fail(
            `the board says ${JSON.stringify(textOf(turnValue) || "(nothing)")} where the match is on the ` +
              `${m.turn}'s turn ("${expectedTurn}")`
          );
        }
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

      // The board is a battlefield, not a diagram: both tables lie on their own
      // playing surface, the opponent's hand is one face-down back per card it
      // holds, the deck is a stack of backs that shrinks, and an empty table
      // still reads as a table — in a picture and in words.
      if (game.readState().match.opponentHand !== m.opponentHand) {
        fail(
          `the match reports the opponent holding ${game.readState().match.opponentHand} card(s) instead of ` +
            `the ${m.opponentHand} it holds, so a tool cannot see the hand the board shows`
        );
      }
      const opponentHandBacks = [...document.querySelectorAll("#match-opponent-hand-backs .card-back")];
      if (opponentHandBacks.length !== m.opponentHand) {
        fail(
          `the opponent holds ${m.opponentHand} card(s) but their hand shows ` +
            `${opponentHandBacks.length} face-down card(s)`
        );
      }
      if (
        opponentHandBacks.length &&
        !opponentHandBacks.every((back) => back.getAttribute("aria-hidden") === "true")
      ) {
        fail(
          "the opponent's face-down cards are not hidden from assistive technology, so a screen reader " +
            "hears a stack of unnamed pictures"
        );
      }
      const deckStack = [...document.querySelectorAll("#match-deck-stack .card-back")];
      if (deckStack.length !== m.deckRemaining) {
        fail(
          `the deck holds ${m.deckRemaining} card(s) but its stack shows ${deckStack.length} face-down card(s)`
        );
      }
      for (const [where, selector, sentence] of [
        ["your table", "#match-table", "Your table is empty."],
        ["the opponent's table", "#match-opponent-table", `${m.opponentName}'s table is empty.`],
      ]) {
        const tableList = document.querySelector(selector);
        if (!tableList?.closest(".match-surface")) {
          fail(`${where} is not drawn on a playing surface, so the board reads as an empty panel`);
        }
        if (!textOf(tableList).includes(sentence)) {
          fail(
            `${where} does not say it is empty in words: ${selector} reads ` +
              `"${textOf(tableList) || "(nothing)"}"`
          );
        }
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
        // A card that draws a card when played trades its own place in the hand
        // for the one it draws, so the hand shrinks by one only when it does not.
        // A card with any other when-played ability — one that mends the hero —
        // leaves the hand the same size.
        const drawnByPlay = catalogAbility(affordable.id) === cardCatalog.DRAW_ON_PLAY ? 1 : 0;
        if (afterPlay.hand.length !== handBefore - 1 + drawnByPlay) {
          fail(
            `playing ${affordable.name} left ${afterPlay.hand.length} cards in hand instead of ` +
              `${handBefore - 1 + drawnByPlay}` +
              (drawnByPlay ? " (one played, one drawn by its ability)" : "")
          );
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

      // Ending the turn: the player's table strikes, then the opponent takes
      // its turn, the turn returns and energy is full. The opponent's own turn
      // can mend its hero (a when-played heal), so the health the player's blow
      // left is read from the log's own words before the opponent's turn
      // begins — the final total may already have been restored.
      const beforeEnd = game.readState().match;
      const ourAttack = beforeEnd.table.reduce((total, card) => total + card.attack, 0);
      game.endMatchTurn();
      const afterEnd = game.readState().match;
      const blowLines = afterEnd.log.slice(beforeEnd.log.length);
      const opponentTurnAt = blowLines.indexOf("Opponent's turn.");
      const playerBlowLines = opponentTurnAt === -1 ? blowLines : blowLines.slice(0, opponentTurnAt);
      const healthAfterBlow = playerBlowLines.reduce((health, line) => {
        const shown = /opponent health (\d+)\.$/.exec(line);
        return shown ? Number(shown[1]) : health;
      }, beforeEnd.opponentHealth);
      const expectedOpponentHealth = Math.max(0, beforeEnd.opponentHealth - ourAttack);
      if (healthAfterBlow !== expectedOpponentHealth) {
        fail(
          `your table's ${ourAttack} damage left the opponent at ${healthAfterBlow} instead of ` +
            `${expectedOpponentHealth} (the turn ended with the opponent at ${afterEnd.opponentHealth})`
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
      // And what it played comes from its own deck, not the player's: the same
      // catalog, a different set of cards.
      const opponentPlayed = afterEnd.opponentTable.map((card) => card.id);
      const outsideOpponentDeck = opponentPlayed.filter((id) => !(cardCatalog.OPPONENT_DECK ?? []).includes(id));
      if (outsideOpponentDeck.length) {
        fail(
          `the opponent played ${JSON.stringify(outsideOpponentDeck)}, which is not in the deck it was dealt from ` +
            JSON.stringify(cardCatalog.OPPONENT_DECK)
        );
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

      // The deck stack shrinks with the deck, and the opponent's backs follow
      // their hand as it draws and plays — so the counts a visitor sees change
      // with the game, not only the numbers beside them.
      const shrunkStack = [...document.querySelectorAll("#match-deck-stack .card-back")];
      if (shrunkStack.length !== afterEnd.deckRemaining) {
        fail(
          `after a turn the deck holds ${afterEnd.deckRemaining} card(s) but its stack shows ${shrunkStack.length}`
        );
      }
      if (afterEnd.deckRemaining < beforeEnd.deckRemaining && shrunkStack.length >= deckStack.length) {
        fail(
          `the deck drew a card (from ${beforeEnd.deckRemaining} to ${afterEnd.deckRemaining}) but its stack did not ` +
            `shrink (from ${deckStack.length} to ${shrunkStack.length})`
        );
      }
      const handBacksAfter = [...document.querySelectorAll("#match-opponent-hand-backs .card-back")];
      if (handBacksAfter.length !== afterEnd.opponentHand) {
        fail(
          `the opponent holds ${afterEnd.opponentHand} card(s) after its turn but their hand shows ` +
            `${handBacksAfter.length} face-down card(s)`
        );
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

      // Every card in a match is a picture-first face: the drawing fills the top
      // of the card, the name and numbers read as a caption under it, and the
      // control that uses the card stays below the face. The same card is the
      // same size wherever it appears, so a card on a table is never a smaller
      // thumbnail of the one in hand.
      const smallestArtWidth = {};
      for (const [where, selector, cards] of [
        ["your hand", "#match-hand", afterEnd.hand],
        ["your table", "#match-table", afterEnd.table],
        ["the opponent's table", "#match-opponent-table", afterEnd.opponentTable],
      ]) {
        let smallest = Infinity;
        for (const card of cards) {
          const row = document.querySelector(`${selector} [data-card-id="${card.id}"]`);
          if (!row) continue;
          const face = row.getBoundingClientRect();
          const caption = row.querySelector(".match-card-head");
          const art = row.querySelector("svg.card-art");
          const control = row.querySelector("button");
          const printedName = textOf(row.querySelector(".match-card-name"));
          const printedStats = textOf(row.querySelector(".match-card-stats"));

          if (printedName !== card.name) {
            fail(
              `the card face for "${card.name}" on ${where} does not print its name as a caption: it reads "${printedName}"`
            );
          }
          if (!printedStats) {
            fail(`the card face for "${card.name}" on ${where} shows no cost/attack/health, so the picture is the whole face`);
          }
          if (!art) {
            fail(`the card face for "${card.name}" on ${where} has no drawing filling it`);
            continue;
          }
          const artRect = art.getBoundingClientRect();
          const captionRect = caption ? caption.getBoundingClientRect() : null;
          if (captionRect && artRect.bottom > captionRect.top + 1) {
            fail(
              `on ${where} the drawing on "${card.name}" runs past its name and numbers instead of sitting above them ` +
                "as the top of the face"
            );
          }
          if (artRect.width < face.width * 0.85) {
            fail(
              `on ${where} the drawing on "${card.name}" fills only ${Math.round((artRect.width / face.width) * 100)}% of ` +
                "the card's width, so the creature is a thumbnail rather than the face"
            );
          }
          if (artRect.width < 64 || artRect.height < 40) {
            fail(
              `on ${where} the drawing on "${card.name}" is ${Math.round(artRect.width)}x${Math.round(artRect.height)}px, ` +
                "too small to know the creature by at a glance"
            );
          }
          if (control) {
            if (captionRect && control.getBoundingClientRect().top < captionRect.bottom - 1) {
              fail(`the control on "${card.name}" (${where}) sits on the face rather than under it`);
            }
            if (!`${textOf(control)} ${control.getAttribute("aria-label") || ""}`.includes(card.name)) {
              fail(`the control on "${card.name}" (${where}) does not name the card it acts on`);
            }
          }
          smallest = Math.min(smallest, artRect.width);
        }
        if (smallest !== Infinity) smallestArtWidth[where] = smallest;
      }
      // A card on a table is never drawn smaller than the one in hand.
      if (smallestArtWidth["your hand"]) {
        for (const where of ["your table", "the opponent's table"]) {
          const tableArt = smallestArtWidth[where];
          if (tableArt && tableArt < smallestArtWidth["your hand"] * 0.85) {
            fail(
              `the smallest drawing on ${where} is ${Math.round(tableArt)}px wide while the hand's smallest is ` +
                `${Math.round(smallestArtWidth["your hand"])}px, so the same card is drawn smaller on a table than in hand`
            );
          }
        }
      }

      // A card with no drawing still reads as its name and numbers rather than an
      // empty frame: the same face without its picture keeps the caption.
      const sampleFace = document.querySelector("#match-hand .match-card");
      if (sampleFace) {
        const bare = sampleFace.cloneNode(true);
        bare.removeAttribute("data-card-id");
        bare.querySelector("svg.card-art")?.remove();
        document.getElementById("match-hand")?.append(bare);
        const bareName = textOf(bare.querySelector(".match-card-name"));
        const bareStats = textOf(bare.querySelector(".match-card-stats"));
        if (bare.getBoundingClientRect().height <= 0 || !bareName || !bareStats) {
          fail(
            "a match card with no drawing collapses instead of reading its name and numbers " +
              `(name "${bareName}", numbers "${bareStats}")`
          );
        }
        bare.remove();
      }
    }

    // The player directs an attack with their own hand on the keyboard: every
    // card on their table offers a control that picks it to strike with, every
    // card on the opponent's table offers a target, and picking both lands the
    // blow on the chosen card — with the pick and the spent card carried in the
    // state an agent reads, not only in colour.
    {
      let live = game.readState().match;
      for (let i = 0; i < 6 && !live.table.length; i += 1) {
        const playableAgain = live.hand.find((card) => card.cost <= live.energy);
        if (!playableAgain) break;
        game.playMatchCard(playableAgain.id);
        live = game.readState().match;
      }
      const attackerCard = live.table.find((card) => !card.hasAttacked);
      const targetCard = live.opponentTable[0];
      if (!attackerCard || !targetCard) {
        fail("no attacker and opponent card were on the table, so choosing an attack cannot be checked on the page");
      } else {
        const selectButton = document.querySelector(
          `#match-table [data-card-id="${attackerCard.id}"] .match-attack-select`
        );
        const targetButton = document.querySelector(
          `#match-opponent-table [data-card-id="${targetCard.id}"] .match-attack-target`
        );
        if (!selectButton) {
          fail(`"${attackerCard.name}" on your table offers no control to attack with it`);
        } else if (selectButton.getAttribute("aria-pressed") !== "false") {
          fail(`the attack control for "${attackerCard.name}" is pressed before it has been picked`);
        } else if (!textOf(selectButton).includes(attackerCard.name)) {
          fail(`the control to attack with "${attackerCard.name}" does not name the card: "${textOf(selectButton)}"`);
        }
        if (!targetButton) {
          fail(`"${targetCard.name}" on the opponent's table offers no control to attack it`);
        } else if (!textOf(targetButton).includes(targetCard.name)) {
          fail(`the control to attack "${targetCard.name}" does not name the card: "${textOf(targetButton)}"`);
        }

        if (selectButton && targetButton) {
          selectButton.click();
          const chosen = game.readState().match;
          if (chosen.selectedAttacker !== attackerCard.id) {
            fail(
              `choosing "${attackerCard.name}" left the match's picked attacker as ` +
                `${JSON.stringify(chosen.selectedAttacker)}`
            );
          }
          const pressed = document.querySelector(
            `#match-table [data-card-id="${attackerCard.id}"] .match-attack-select`
          );
          if (!pressed || pressed.getAttribute("aria-pressed") !== "true") {
            fail(`choosing "${attackerCard.name}" did not mark its control pressed`);
          }

          const healthBefore = targetCard.health;
          document
            .querySelector(`#match-opponent-table [data-card-id="${targetCard.id}"] .match-attack-target`)
            ?.click();
          const afterAttack = game.readState().match;
          const hit = afterAttack.opponentTable.find((card) => card.id === targetCard.id);
          if (healthBefore > attackerCard.attack) {
            if (!hit || hit.health !== healthBefore - attackerCard.attack) {
              fail(
                `attacking the chosen "${targetCard.name}" from "${attackerCard.name}" left it at ` +
                  `${hit ? hit.health : "(gone)"} health instead of ${healthBefore - attackerCard.attack}`
              );
            }
          } else if (hit) {
            fail(
              `the chosen "${targetCard.name}" was struck for ${attackerCard.attack} from ${healthBefore} ` +
                "health but stayed on the table"
            );
          }
          if (afterAttack.selectedAttacker !== null) {
            fail(`the pick was not cleared after an attack: it still names ${JSON.stringify(afterAttack.selectedAttacker)}`);
          }
          const spent = afterAttack.table.find((card) => card.id === attackerCard.id);
          if (spent && !spent.hasAttacked) {
            fail(`"${attackerCard.name}" was not marked spent after attacking`);
          }
        }
      }
    }
  }

  // --- The match through an agent's tools -----------------------------------

  const startMatchTool = toolNamed("start-match");
  const playCardTool = toolNamed("play-card");
  const endTurnTool = toolNamed("end-turn");
  const attackTool = toolNamed("attack");
  for (const [name, tool] of [
    ["start-match", startMatchTool],
    ["play-card", playCardTool],
    ["end-turn", endTurnTool],
    ["attack", attackTool],
  ]) {
    if (!tool) {
      fail(`no "${name}" tool is declared, so an agent cannot make the move a visitor can`);
      continue;
    }
    if (!tool.annotations || tool.annotations.readOnlyHint !== false) {
      fail(`"${name}" changes the match but is not marked as changing anything (readOnlyHint: false)`);
    }
  }

  if (startMatchTool && playCardTool && endTurnTool && attackTool) {
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
        for (const field of ["playerHealth", "opponentHealth", "energy", "maxEnergy", "opponentHand"]) {
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

    // The attack tool directs one of the player's cards at a chosen target. The
    // opponent has cards on its table after its turn, so an agent can send one
    // of its own at a chosen card and read the damage back. The player's earlier
    // card may have fallen to the opponent's blow, so a card is played first if
    // the table has emptied.
    for (let i = 0; i < 6 && !(game.readState().match.table || []).length; i += 1) {
      const liveNow = game.readState().match;
      const playableNow = liveNow.hand.find((card) => card.cost <= liveNow.energy);
      if (!playableNow) break;
      await playCardTool.execute({ cardId: playableNow.id });
    }
    const beforeAttack = game.readState().match;
    const attacker = (beforeAttack.table || []).find((card) => !card.hasAttacked);
    const target = (beforeAttack.opponentTable || [])[0];
    if (!attacker || !target) {
      fail("no attacker and opponent card were on the table, so the attack tool cannot be checked");
    } else {
      const targetHealthBefore = target.health;
      const afterAttack = await attackTool.execute({ attackerId: attacker.id, target: target.id });
      const hit = (afterAttack.match.opponentTable || []).find((card) => card.id === target.id);
      if (targetHealthBefore > attacker.attack) {
        if (!hit || hit.health !== targetHealthBefore - attacker.attack) {
          fail(
            `the attack tool left "${target.name}" at ${hit ? hit.health : "(gone)"} instead of ` +
              `${targetHealthBefore - attacker.attack}`
          );
        }
      } else if (hit) {
        fail(
          `the attack tool struck "${target.name}" for ${attacker.attack} from ${targetHealthBefore} health ` +
            "but it stayed on the table"
        );
      }
      const struck = (afterAttack.match.table || []).find((card) => card.id === attacker.id);
      if (!struck || !struck.hasAttacked) {
        fail(`the attack tool did not mark "${attacker.name}" spent for the rest of the turn`);
      }
      if (!(afterAttack.match.log || []).some((line) => line.includes(attacker.name) && line.includes(target.name))) {
        fail(`the attack tool's blow on "${target.name}" was not logged by name`);
      }
    }

    // A refused attack comes back as an `error` field, not a thrown handler.
    const refusedAttack = await attackTool.execute({ attackerId: "not-a-real-card", target: "hero" });
    if (!refusedAttack || !refusedAttack.error) {
      fail('the attack tool accepted an attacker that is not on the table ("not-a-real-card")');
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
   * The cards the Collection screen currently marks as newly collected, by id.
   * The mark is what tells a returning player what the last win added, so it is
   * read from the page the player actually sees rather than from the state that
   * draws it.
   */
  const markedNewlyCollected = () =>
    [...document.querySelectorAll("#collection-list .newly-collected")].map((row) => row.dataset.cardId);

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
      const finishedTurn = document.getElementById("match-turn-standing");
      if (finishedTurn && (!finishedTurn.hidden || getComputedStyle(finishedTurn).display !== "none")) {
        fail("a finished match still says whose turn it is, though no side has one any more");
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
      // A finished match has no opponent left to face, so the board's portrait
      // gives up its place with the match even though the board still stands
      // showing the result.
      const finishedPortrait = document.getElementById("match-opponent-portrait");
      if (finishedPortrait && (!finishedPortrait.hidden || finishedPortrait.querySelector("svg.opponent-portrait"))) {
        fail(`${played}, but the board still shows the opponent's portrait though the match is over`);
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
    for (let move = 0; move < 60; move += 1) {
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

    // The deck was built earlier to exercise duplicates; this match needs a known
    // hand, so it is rebuilt to one copy of each chosen card.
    for (const id of [...deckIds()]) {
      if (!knownDeck.some((wanted) => wanted.id === id) || heldCopies(id) > 1) {
        game.removeCardFromDeck(id);
      }
    }
    for (const card of knownDeck) {
      if (!deckIds().includes(card.id)) game.addCardToDeck(card.id);
    }
  }

  /** The record the page holds against each opponent, keyed by opponent id. */
  const opponentRecordsNow = () =>
    Object.fromEntries(
      game.readState().opponents.map((opponent) => [
        opponent.id,
        { wins: opponent.record.wins, matches: opponent.record.matches },
      ])
    );

  /**
   * How one match moved each opponent's record, keyed by opponent id — so a
   * result can be shown to move the opponent it was fought and nobody else's.
   */
  const recordMoves = (before) => {
    const after = opponentRecordsNow();
    return Object.fromEntries(
      Object.entries(after).map(([id, record]) => [
        id,
        { wins: record.wins - before[id].wins, matches: record.matches - before[id].matches },
      ])
    );
  };

  const cardsHeldBefore = collection.collectionSize(game.readCollection().ownedCards);
  // What the player owned before the match, so the reward can be told apart from
  // a card they already held — which is what decides how the result reads.
  const ownedIdsBeforeMatch = game.readCollection().ownedCards.map((card) => card.id);
  // And what each opponent's record held before it, so the match's own effect on
  // it can be told from a record that was already there.
  const recordsBeforeMatch = opponentRecordsNow();
  game.startMatch();
  const playedOut = playToResult();
  checkResult("playing the strongest card your energy covers, turn after turn", playedOut);

  // Once a match has been finished the rules fold for good: a returning player
  // no longer meets the newcomer's strip open, even though the control remains
  // to open it again.
  const afterRulesMatch = game.readState();
  if (afterRulesMatch.matchesPlayed < 1) {
    fail("a match was played out but matchesPlayed is still 0, so a returning player cannot be told apart");
  } else if (afterRulesMatch.matchRules?.shown) {
    fail("the rules strip is still shown after a match has been played, so a returning player does not get their space back");
  }
  if (document.getElementById("action-toggle-rules")?.getAttribute("aria-expanded") !== "false") {
    fail("after a match the rules control still reports the rules as expanded");
  }
  if (!document.getElementById("match-rules-points")?.hidden) {
    fail("after a match the rules points are still open instead of folded");
  }

  // A win grows the collection by exactly one card and names it; a loss adds
  // none. Which side wins a real match is the shuffle's choice, so each branch
  // is checked for what it must do when it happens.
  const afterPlay = game.readState();
  const cardsHeldAfter = collection.collectionSize(game.readCollection().ownedCards);
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
  }

  // The win says where it stands against the opponent it was won against: it
  // moves that opponent's record and nobody else's, and a first win is announced
  // on the result where the win happened. Whether a real match is won is the
  // shuffle's to decide, so each branch is checked for what it must say.
  if (playedOut?.outcome === "win") {
    const moves = recordMoves(recordsBeforeMatch);
    const facedId = playedOut.opponentId;
    if (moves[facedId]?.wins !== 1 || moves[facedId]?.matches !== 1) {
      fail(
        `a win against "${facedId}" moved its record by ${JSON.stringify(moves[facedId])} instead of one win ` +
          "and one match"
      );
    }
    const strayMoves = Object.entries(moves).filter(
      ([id, move]) => id !== facedId && (move.wins || move.matches)
    );
    if (strayMoves.length) {
      fail(
        `a win against "${facedId}" also moved the record against ` +
          `${JSON.stringify(strayMoves.map(([id]) => id))}, which the match was not fought against`
      );
    }

    const firstWinLine = document.getElementById("result-first-win");
    if (!firstWinLine) {
      fail("the result has no place for a first win against an opponent (#result-first-win is missing)");
    } else if (afterPlay.result?.firstWin) {
      if (firstWinLine.hidden || !textOf(firstWinLine).includes(playedOut.opponentName)) {
        fail(
          `a first win against "${playedOut.opponentName}" is not announced on the result: it reads ` +
            `"${textOf(firstWinLine)}" (hidden ${firstWinLine.hidden})`
        );
      }
    } else if (!firstWinLine.hidden || textOf(firstWinLine)) {
      fail(
        `a win that was not a first still reads "${textOf(firstWinLine)}" on the result, so the mark is not ` +
          "kept for a first win"
      );
    }
  }

  // A win shows the card it earned as the card itself: its picture beside its
  // own name and numbers, and the same card that joined the collection.
  if (playedOut?.outcome === "win" && afterPlay.result?.awarded) {
    const awarded = afterPlay.result.awarded;
    const figure = resultReward?.querySelector(".award-card");
    if (!figure) {
      fail(`a win added "${awarded.name}" but the result shows no card, only the words "${textOf(resultReward)}"`);
    } else if (figure.dataset.cardId !== awarded.id) {
      fail(`the result shows card "${figure.dataset.cardId}" instead of the awarded "${awarded.id}"`);
    } else {
      const picture = figure.querySelector(".card-art");
      if (!picture || picture.getAttribute("aria-label") !== awarded.name) {
        fail(`the picture in the result is not the awarded "${awarded.name}"`);
      }
      const numbers = `${awarded.cost}/${awarded.attack}/${awarded.health}`;
      if (figure.querySelector(".award-card-stats")?.textContent !== numbers) {
        fail(`the card shown in the result reads "${figure.querySelector(".award-card-stats")?.textContent}" instead of the awarded "${numbers}"`);
      }
      const ownedIds = (game.readCollection().ownedCards || []).map((card) => card.id);
      if (!ownedIds.includes(awarded.id)) {
        fail(`the result shows "${awarded.id}", which is not a card the win added to the collection`);
      }

      // A card the player already held can only have come from a collection with
      // nothing new left to earn, so the two must agree: a new card is what a win
      // without anything unowned to give looks like, and a duplicate is what a
      // completed set looks like. The result's own words follow from that.
      const alreadyOwned = ownedIdsBeforeMatch.includes(awarded.id);
      if (afterPlay.result?.setComplete !== alreadyOwned) {
        fail(
          `the result reports the set as complete ${afterPlay.result?.setComplete} after a win that awarded ` +
            `"${awarded.id}", which the player ${alreadyOwned ? "already owned" : "did not own"}`
        );
      }
      const expectedLabel = alreadyOwned
        ? "Set complete — a duplicate copy added to your collection:"
        : "New card — added to your collection:";
      if (!textOf(resultReward).startsWith(expectedLabel)) {
        fail(
          `a win that awarded "${awarded.id}" is labelled "${textOf(resultReward)}" instead of "${expectedLabel}"`
        );
      }

      // The card the win added stays findable after the result is left behind:
      // the collection marks it, in a word a screen reader reads as well as in
      // the styling. A win whose only card was a duplicate has nothing new to
      // mark, because nothing new was earned.
      const expectedMark = afterPlay.result?.setComplete ? null : awarded.id;
      if (afterPlay.newlyCollected !== expectedMark) {
        fail(
          `after a win that awarded "${awarded.id}" (set complete ${afterPlay.result?.setComplete}) the state ` +
            `reports newlyCollected ${JSON.stringify(afterPlay.newlyCollected)} instead of ${JSON.stringify(expectedMark)}`
        );
      }
      const marked = markedNewlyCollected();
      if (expectedMark === null) {
        if (marked.length) {
          fail(
            `a win that added only a duplicate marked ${marked.join(", ")} as newly collected, though nothing new ` +
              "was earned"
          );
        }
      } else if (marked.length !== 1 || marked[0] !== expectedMark) {
        fail(
          `a win added "${awarded.name}" but the collection marks ${JSON.stringify(marked)} as newly collected ` +
            `instead of just "${expectedMark}"`
        );
      } else {
        const note = document.querySelector(`#collection-list [data-card-id="${expectedMark}"] .newly-collected-note`);
        const words = textOf(note);
        if (!note || !words.toLowerCase().includes("new")) {
          fail(
            `the collection marks "${awarded.name}" as newly collected without saying so in words: it reads ` +
              `"${words || "(nothing)"}"`
          );
        } else if (note.getAttribute("aria-hidden") === "true") {
          fail(`the "Newly collected" mark on "${awarded.name}" is hidden from screen readers`);
        }
      }
    }
  }

  if (playedOut?.outcome === "loss") {
    if (afterPlay.result?.awarded !== null) {
      fail(`a lost match awarded ${JSON.stringify(afterPlay.result?.awarded)} instead of nothing`);
    }
    if (cardsHeldAfter !== cardsHeldBefore) {
      fail(`a lost match grew the collection from ${cardsHeldBefore} to ${cardsHeldAfter} card(s)`);
    }
    if (resultReward?.querySelector(".card-art")) {
      fail("a lost match shows a card in the result, but a loss earns nothing");
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
  const recordsBeforeIdle = opponentRecordsNow();
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
    if (afterIdle.newlyCollected !== null) {
      fail(
        `after a loss the state reports newlyCollected ${JSON.stringify(afterIdle.newlyCollected)} instead of null, ` +
          "so an agent would read a card as newly earned by a loss"
      );
    }
    const markedAfterIdle = markedNewlyCollected();
    if (markedAfterIdle.length) {
      fail(`after a loss the collection still marks ${markedAfterIdle.join(", ")} as newly collected`);
    }
    if (!textOf(resultReward).toLowerCase().includes("no card")) {
      fail(`after a loss the page does not say no card was earned: it reads "${textOf(resultReward) || "(nothing)"}"`);
    }
    if (resultReward?.querySelector(".card-art")) {
      fail("after a loss the result shows a card, but a loss earns nothing");
    }

    // A loss is counted against the opponent it was fought and nobody else:
    // the match climbs that opponent's record without a win, so a record of how
    // often each has been faced stays honest.
    const lossMoves = recordMoves(recordsBeforeIdle);
    const facedId = idled.opponentId;
    if (lossMoves[facedId]?.wins !== 0 || lossMoves[facedId]?.matches !== 1) {
      fail(
        `a loss against "${facedId}" moved its record by ${JSON.stringify(lossMoves[facedId])} instead of no ` +
          "wins and one match"
      );
    }
    const strayLossMoves = Object.entries(lossMoves).filter(
      ([id, move]) => id !== facedId && (move.wins || move.matches)
    );
    if (strayLossMoves.length) {
      fail(
        `a loss against "${facedId}" also moved the record against ` +
          `${JSON.stringify(strayLossMoves.map(([id]) => id))}, which the match was not fought against`
      );
    }
    const firstWinAfterLoss = document.getElementById("result-first-win");
    if (firstWinAfterLoss && (!firstWinAfterLoss.hidden || textOf(firstWinAfterLoss))) {
      fail(
        `after a loss the result reads "${textOf(firstWinAfterLoss)}", though no win happened to be a first`
      );
    }
    if (idled.opponentId && afterIdle.opponents.some((opponent) => opponent.id === idled.opponentId && opponent.record.matches < 1)) {
      fail(`the loss against "${idled.opponentId}" was not recorded against it, so the picker would not show it`);
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
    if (reported?.opponentName !== live.opponentName) {
      fail(
        `get-match reports the opponent as ${JSON.stringify(reported?.opponentName)} while the page says ` +
          `${JSON.stringify(live.opponentName)}`
      );
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
    // After the matches just played have moved the goal, the live home screen
    // still names the same next-win card the state reports.
    checkNextRewardShown();
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

  // --- A match left behind is saved, offered and picked back up -------------

  // A half-played match is progress, so it is written to the browser as it
  // changes and offered again on the home screen when the page is reopened.
  // These checks drive the page, then read storage back the way a reload does.
  if (matchEngine && typeof collection.readSavedMatch === "function") {
    // Play one card in a fresh match, then read the saved match back.
    game.showScreen("home");
    game.startMatch();
    const dealSize = game.readState().deckSize;
    const liveStart = game.readState().match;
    const firstPlayable = liveStart.hand.find((card) => card.cost <= liveStart.energy);
    if (!firstPlayable) {
      fail("the match-persistence checks found no affordable card to play, so a saved match cannot be checked");
    } else {
      game.playMatchCard(firstPlayable.id);
    }
    const liveMatch = game.readState().match;

    if (typeof collection.saveMatch !== "function" || typeof collection.clearSavedMatch !== "function") {
      fail("docs/collection.js does not save, read and clear an unfinished match, so a reload loses the game in progress");
    }

    const savedNow = collection.readSavedMatch();
    if (!savedNow) {
      fail(`after playing a card nothing is saved under "${collection.MATCH_STORAGE_KEY}", so reloading loses the match`);
    } else {
      // The saved match is the live board: both healths, energy, whose turn, the
      // hand, both tables, both decks and the log.
      if (
        savedNow.player.health !== liveMatch.playerHealth ||
        savedNow.opponent.health !== liveMatch.opponentHealth ||
        savedNow.turn !== liveMatch.turn ||
        savedNow.player.energy !== liveMatch.energy ||
        savedNow.player.maxEnergy !== liveMatch.maxEnergy
      ) {
        fail(
          `the saved match reads ${savedNow.player.health}/${savedNow.opponent.health} health on the ${savedNow.turn}'s ` +
            `turn with ${savedNow.player.energy} energy, while the page holds ${liveMatch.playerHealth}/` +
            `${liveMatch.opponentHealth} on the ${liveMatch.turn}'s turn with ${liveMatch.energy}`
        );
      }
      if (JSON.stringify(savedNow.log) !== JSON.stringify(liveMatch.log)) {
        fail(`the saved match log does not match the live one: ${JSON.stringify(savedNow.log)} vs ${JSON.stringify(liveMatch.log)}`);
      }
      if (JSON.stringify(savedNow.player.hand.map((card) => card.id)) !== JSON.stringify(liveMatch.hand.map((card) => card.id))) {
        fail("the saved match's hand does not match the hand the page holds");
      }
      if (JSON.stringify(savedNow.player.table.map((card) => card.id)) !== JSON.stringify(liveMatch.table.map((card) => card.id))) {
        fail("the saved match's table does not match the table the page holds");
      }
      for (const card of savedNow.player.table) {
        const shown = liveMatch.table.find((live) => live.id === card.id);
        if (!shown || shown.health !== card.health || Boolean(shown.hasAttacked) !== card.hasAttacked) {
          fail(`the saved table card "${card.id}" does not match the page's ${JSON.stringify(shown)}`);
        }
      }
      if (savedNow.opponent.hand.length !== liveMatch.opponentHand) {
        fail(
          `the saved opponent hand holds ${savedNow.opponent.hand.length} cards instead of the ` +
            `${liveMatch.opponentHand} the page shows`
        );
      }
      if (savedNow.player.deck.length !== liveMatch.deckRemaining) {
        fail(
          `the saved deck holds ${savedNow.player.deck.length} cards instead of the ${liveMatch.deckRemaining} left to draw`
        );
      }
      // No card is lost or duplicated across a side's three piles, so a reload
      // deals exactly the deck the match was dealt from.
      for (const [who, side, total] of [
        ["player", savedNow.player, dealSize],
        ["opponent", savedNow.opponent, (cardCatalog.OPPONENT_DECK || []).length],
      ]) {
        const held = side.hand.length + side.table.length + side.deck.length;
        if (held !== total) {
          fail(`the saved ${who}'s cards add up to ${held} instead of the ${total} dealt, so a reload would lose or duplicate one`);
        }
      }
      // Every restored card is looked up in the catalog again: a save names only
      // ids, and the page rebuilds the card from the game's own data.
      const rebuilt = [
        ...savedNow.player.hand,
        ...savedNow.player.deck,
        ...savedNow.opponent.hand,
        ...savedNow.opponent.deck,
      ];
      for (const card of rebuilt) {
        const known = cardCatalog.CARD_BY_ID.get(card.id);
        if (!known || card.name !== known.name || card.cost !== known.cost || card.attack !== known.attack || card.health !== known.health) {
          fail(`a restored card "${card.id}" does not carry the catalog's own stats`);
        }
      }
    }

    // A card on the table keeps the health it is down to and whether it has
    // struck; a card in hand or in the deck takes its catalog stats back, so a
    // wounded card comes back wounded rather than healed.
    const storedPayload = JSON.parse(window.localStorage.getItem(collection.MATCH_STORAGE_KEY) ?? "null");
    if (!storedPayload) {
      fail("no match payload is in storage, so nothing about restoring one can be checked");
    } else {
      const wounded = {
        version: 1,
        id: "check-match-wounded",
        opponentName: "Thornmere",
        turn: "player",
        over: false,
        winner: null,
        outcome: null,
        recorded: false,
        player: {
          health: 17,
          energy: 2,
          maxEnergy: 4,
          turns: 3,
          hand: [{ id: "sprout" }],
          table: [{ id: "glowcap", health: 2, hasAttacked: true }],
          deck: [{ id: "elder-oak" }],
        },
        opponent: {
          health: 12,
          energy: 1,
          maxEnergy: 5,
          turns: 2,
          hand: [],
          table: [{ id: "mudback-turtle", health: 4, hasAttacked: false }],
          deck: [],
        },
        log: ["a line from earlier"],
      };
      const healed = collection.readSavedMatch(
        stubStorage({ [collection.MATCH_STORAGE_KEY]: JSON.stringify(wounded) })
      );
      if (!healed) {
        fail("a whole, unfinished match was not restored from storage");
      } else {
        const tableCard = healed.player.table[0];
        if (tableCard.health !== 2 || tableCard.hasAttacked !== true) {
          fail(
            `a wounded table card came back at ${tableCard.health} health (spent ${tableCard.hasAttacked}) instead of 2 and spent`
          );
        }
        const handCard = healed.player.hand[0];
        const sprout = cardCatalog.CARD_BY_ID.get("sprout");
        if (handCard.health !== sprout.health || handCard.attack !== sprout.attack) {
          fail(`a restored hand card reads ${handCard.health}/${handCard.attack} instead of the catalog's ${sprout.health}/${sprout.attack}`);
        }
      }

      // What cannot be an unfinished match is read as no match at all.
      const withPayload = (change) =>
        collection.readSavedMatch(
          stubStorage({ [collection.MATCH_STORAGE_KEY]: JSON.stringify({ ...storedPayload, ...change }) })
        );
      for (const [what, change] of [
        ["from another version", { version: 99 }],
        ["already finished", { over: true }],
        ["already recorded", { recorded: true }],
        ["on nobody's turn", { turn: "nobody" }],
        ["naming a card that does not exist", { player: { ...storedPayload.player, hand: [{ id: "not-a-real-card" }] } }],
        ["with impossible health", { opponent: { ...storedPayload.opponent, health: 9999 } }],
        ["with impossible energy", { player: { ...storedPayload.player, energy: 1e21 } }],
        ["with a log that is not words", { log: [{ not: "a line" }] }],
      ]) {
        if (withPayload(change) !== null) {
          fail(`a saved match ${what} was restored instead of read as no match`);
        }
      }
      if (collection.readSavedMatch(stubStorage()) !== null) {
        fail("an absent match key was read as a saved match");
      }
      if (collection.readSavedMatch(stubStorage({ [collection.MATCH_STORAGE_KEY]: "}{ not json" })) !== null) {
        fail("an unreadable saved match was restored instead of ignored");
      }
      if (collection.readSavedMatch(blockedStorage()) !== null) {
        fail("a browser that refuses storage still reported a saved match to continue");
      }
      if (collection.saveMatch(storedPayload, blockedStorage())) {
        fail("saving a match to blocked storage reported success, so a lost match is treated as saved");
      }
      if (collection.clearSavedMatch(blockedStorage())) {
        fail("clearing a match from blocked storage reported success");
      }
    }

    // A match left behind — a different one from the live match — is written to
    // storage, then offered on the home screen and picked back up from it.
    const left = matchEngine.createMatch(
      ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
      { rng: () => 0 }
    );
    matchEngine.playCard(left, left.player.hand.find((card) => card.cost <= left.player.energy).id);
    matchEngine.endTurn(left);
    collection.saveMatch(left);
    game.showScreen("home");
    game.refreshSavedMatch();

    const offeredState = game.readState();
    if (!offeredState.canContinue) {
      fail("a match is saved in the browser but the page does not report one to continue");
    }
    const summary = offeredState.savedMatch;
    if (!summary || summary.opponentName !== left.opponentName) {
      fail(`the page offers ${JSON.stringify(summary)} instead of the saved match against "${left.opponentName}"`);
    } else if (
      summary.playerHealth !== left.player.health ||
      summary.opponentHealth !== left.opponent.health ||
      summary.turn !== left.turn ||
      summary.logLength !== left.log.length
    ) {
      fail(
        `the offered match summary reads ${JSON.stringify(summary)} instead of ${JSON.stringify({
          opponentName: left.opponentName,
          turn: left.turn,
          playerHealth: left.player.health,
          opponentHealth: left.opponent.health,
          logLength: left.log.length,
        })}`
      );
    }
    if (!offeredState.actions.includes("Continue match")) {
      fail(`the home screen offers ${JSON.stringify(offeredState.actions)} with an unfinished match saved, so no continue action is reachable`);
    }

    const offerSection = document.getElementById("continue-match");
    if (!offerSection || offerSection.hidden) {
      fail("the home screen shows nothing to continue a match saved in the browser");
    } else {
      const opponentShown = textOf(document.getElementById("continue-opponent"));
      if (!opponentShown.includes(left.opponentName)) {
        fail(`the continue offer names "${opponentShown}" instead of the opponent "${left.opponentName}"`);
      }
      if (textOf(document.getElementById("continue-player-health")) !== String(left.player.health)) {
        fail(`the continue offer shows your health as "${textOf(document.getElementById("continue-player-health"))}" instead of ${left.player.health}`);
      }
      if (textOf(document.getElementById("continue-opponent-health")) !== String(left.opponent.health)) {
        fail(`the continue offer shows the opponent's health as "${textOf(document.getElementById("continue-opponent-health"))}" instead of ${left.opponent.health}`);
      }
      if (textOf(document.getElementById("continue-turn")) !== "You") {
        fail(`the continue offer says "${textOf(document.getElementById("continue-turn"))}" instead of naming whose turn it is`);
      }
      const offerButton = buttonNamed("home", "Continue match");
      if (!offerButton) {
        fail("the continue offer has no control to pick the match back up");
      }
    }

    // Continue restores exactly that board and turn, through the tool an agent
    // would use as well as through the page's own function.
    const continueTool = toolNamed("continue-match");
    if (!continueTool) {
      fail('no "continue-match" tool is declared, so an agent cannot pick up a match a visitor can');
    } else if (!continueTool.annotations || continueTool.annotations.readOnlyHint !== false) {
      fail('"continue-match" changes the page but is not marked as changing anything (readOnlyHint: false)');
    }
    if (continueTool) {
      const m = (await continueTool.execute({})).match;
      if (!m || !m.active) {
        fail("the continue-match tool did not leave a live match running");
      } else {
        const tableOf = (cards) =>
          cards.map((card) => ({ id: card.id, health: card.health, spent: Boolean(card.hasAttacked) }));
        for (const [what, expected, found] of [
          ["opponent", left.opponentName, m.opponentName],
          ["turn", left.turn, m.turn],
          ["your health", left.player.health, m.playerHealth],
          ["the opponent's health", left.opponent.health, m.opponentHealth],
          ["your energy", left.player.energy, m.energy],
          ["your energy maximum", left.player.maxEnergy, m.maxEnergy],
          ["hand", left.player.hand.map((card) => card.id), (m.hand || []).map((card) => card.id)],
          ["table", tableOf(left.player.table), tableOf(m.table || [])],
          ["opponent table", tableOf(left.opponent.table), tableOf(m.opponentTable || [])],
          ["log", left.log, m.log],
        ]) {
          if (JSON.stringify(found) !== JSON.stringify(expected)) {
            fail(
              `the continued match's ${what} reads ${JSON.stringify(found)} instead of the saved ` +
                `${JSON.stringify(expected)}`
            );
          }
        }
        if (m.deckRemaining !== left.player.deck.length) {
          fail(
            `the continued match has ${m.deckRemaining} cards left to draw instead of the saved ${left.player.deck.length}`
          );
        }
        if (m.opponentHand !== left.opponent.hand.length) {
          fail(
            `the continued opponent holds ${m.opponentHand} cards instead of the saved ${left.opponent.hand.length}`
          );
        }
        if (openScreens().join(", ") !== "play") {
          fail(`continuing a match left "${openScreens().join(", ")}" open instead of the match`);
        }
        if (textOf(document.getElementById("match-player-health")) !== String(left.player.health)) {
          fail(
            `the board prints your health as "${textOf(document.getElementById("match-player-health"))}" ` +
              `after continuing, instead of the saved ${left.player.health}`
          );
        }
      }
    }

    // Starting a new match replaces whatever was saved, and a match left in
    // progress is not offered once it is the one already on the board.
    const leftId = left.id;
    game.startMatch();
    const replaced = collection.readSavedMatch();
    if (!replaced || replaced.id === leftId) {
      fail("starting a new match did not replace the match saved in the browser");
    }
    if (game.readState().canContinue) {
      fail("the page still offers to continue an older match after a new one is started");
    }

    // A finished match is never saved or offered: playing one out clears the
    // record and leaves the home screen with nothing to continue.
    const finishedMatch = playToResult();
    if (!finishedMatch?.over) {
      fail("a match could not be played to an end, so a finished match leaving nothing saved cannot be checked");
    } else if (collection.readSavedMatch() !== null) {
      fail("a finished match was left saved, so reopening the page would offer to continue a game that is over");
    }
    game.showScreen("home");
    const afterFinish = game.readState();
    if (afterFinish.canContinue) {
      fail("the home screen offers to continue a match that is already finished");
    }
    if (offerSection && !offerSection.hidden) {
      fail("the continue offer is still shown on the home screen though the match is finished");
    }

    // Leave a fresh live match, so the checks that follow measure a board rather
    // than a finished game.
    game.startMatch();
  }

  // --- Starting a match asks before it throws away the one you left ----------

  // An unfinished match saved in the browser is progress, so pressing Start match
  // must not silently overwrite it: the player is asked, in the same rail as the
  // status line, whether to continue that match or discard it and start fresh,
  // and nothing is dealt or saved until they answer. Backing out leaves the save
  // exactly as it was, and the start-match tool reports the same conflict rather
  // than overwriting, with the discard-saved-match tool confirming the loss.
  const continueSavedControl = document.getElementById("action-continue-saved");
  const discardSavedControl = document.getElementById("action-discard-saved");
  if (!continueSavedControl || !discardSavedControl) {
    fail(
      "the Play screen has no way to answer a start that would discard a saved match " +
        "(#action-continue-saved / #action-discard-saved are missing)"
    );
  }
  if (matchEngine && typeof game.discardSavedMatch === "function") {
    /**
     * Whole, unfinished match payloads that are not the one on the board — the
     * state a returning player is in, reached here by writing them to storage
     * and reading them back the way a reload does.
     */
    const waitingMatch = (id, logLine) => ({
      id,
      opponentId: "emberwake",
      opponentName: "Emberwake",
      turn: "player",
      over: false,
      winner: null,
      outcome: null,
      recorded: false,
      player: {
        health: 15,
        energy: 2,
        maxEnergy: 4,
        turns: 3,
        hand: [{ id: "sprout" }],
        table: [{ id: "glowcap", health: 2, hasAttacked: true }],
        deck: [{ id: "elder-oak" }],
      },
      opponent: {
        health: 11,
        energy: 1,
        maxEnergy: 5,
        turns: 2,
        hand: [],
        table: [{ id: "mudback-turtle", health: 4, hasAttacked: false }],
        deck: [],
      },
      log: [logLine],
    });
    /** Put `payload` in storage as the match waiting to be continued. */
    const saveWaiting = (payload) => {
      collection.saveMatch(payload);
      game.refreshSavedMatch();
    };
    /**
     * The few fields that tell one board from another, read alike from a match
     * the page reports (playerHealth) and a match read back from storage
     * (player.health) — so an overwrite or a lost match is caught either way.
     */
    const boardShape = (m) =>
      JSON.stringify({
        opponentName: m?.opponentName,
        playerHealth: m?.playerHealth ?? m?.player?.health,
        opponentHealth: m?.opponentHealth ?? m?.opponent?.health,
        log: (m?.log ?? []).join(" | "),
      });

    if (continueSavedControl?.hidden === false || discardSavedControl?.hidden === false) {
      fail("the continue-or-discard choice is on screen before any start asked for it");
    }
    if (game.readState().startConflict) {
      fail("get-state reports a start conflict before a start was asked for");
    }

    const waiting = waitingMatch("check-waiting-match", "A match left waiting to be picked up.");
    saveWaiting(waiting);
    const savedBefore = window.localStorage.getItem(collection.MATCH_STORAGE_KEY);
    const liveBefore = game.readState().match;
    if (!game.readState().canContinue) {
      fail("a match saved in the browser is not offered to continue, so the start conflict cannot be checked");
    }

    // Pressing Start match asks rather than deals: the saved match is untouched,
    // the board is unchanged, and the question names the waiting opponent.
    const asked = game.startMatch();
    if (!asked.startConflict) {
      fail(
        "starting a match with an unfinished one saved reported no conflict, so the saved match " +
          "is replaced without the player being asked"
      );
    } else {
      if (!String(asked.startConflict.reason).includes(waiting.opponentName)) {
        fail(
          `the start conflict reads ${JSON.stringify(asked.startConflict.reason)} without naming the ` +
            `waiting opponent "${waiting.opponentName}"`
        );
      }
      if (asked.startConflict.savedMatch?.opponentName !== waiting.opponentName) {
        fail(
          `the start conflict describes ${JSON.stringify(asked.startConflict.savedMatch)} instead of the ` +
            `waiting match against "${waiting.opponentName}"`
        );
      }
    }
    if (window.localStorage.getItem(collection.MATCH_STORAGE_KEY) !== savedBefore) {
      fail("starting a match with an unfinished one saved rewrote the saved match before the player answered");
    }
    if (!game.readState().canContinue) {
      fail("the saved match stopped being offered to continue as soon as a start was asked about");
    }
    if (boardShape(game.readState().match) !== boardShape(liveBefore)) {
      fail("starting a match with an unfinished one saved dealt a new one before the player answered");
    }

    // The two answers stand where the Start match button was, one keyboard-
    // reachable button each, and both are in the actions an agent reads.
    for (const [label, control] of [
      ["Continue saved match", continueSavedControl],
      ["Discard and start new", discardSavedControl],
    ]) {
      if (!control) continue;
      if (control.hidden || control.closest("[hidden]")) {
        fail(`the "${label}" answer is hidden while a start is waiting on the choice`);
      }
      if (control.tagName !== "BUTTON" || control.tabIndex < 0) {
        fail(`the "${label}" answer is not a button a keyboard can reach`);
      }
    }
    const actionsWhileAsking = game.readState().actions;
    for (const label of ["Continue saved match", "Discard and start new"]) {
      if (!actionsWhileAsking.includes(label)) {
        fail(
          `the choice is on screen but get-state lists ${JSON.stringify(actionsWhileAsking)} ` +
            `without "${label}"`
        );
      }
    }
    const question = textOf(document.getElementById("match-message"));
    if (!question.includes(waiting.opponentName)) {
      fail(
        `the choice asked in the status line reads "${question || "(nothing)"}" without naming the ` +
          `waiting opponent "${waiting.opponentName}"`
      );
    }

    // The tool an agent uses reports the same conflict rather than overwriting.
    if (startMatchTool) {
      const viaTool = await startMatchTool.execute({});
      if (!viaTool?.startConflict) {
        fail(
          "the start-match tool did not report the conflict with a saved match waiting, so an agent " +
            "would overwrite it silently"
        );
      }
      if (window.localStorage.getItem(collection.MATCH_STORAGE_KEY) !== savedBefore) {
        fail("the start-match tool rewrote the saved match before the conflict was answered");
      }
    }

    // Backing out — leaving the Play screen — leaves the saved match and the home
    // screen's Continue offer exactly as they were.
    game.showScreen("home");
    const backedOut = game.readState();
    if (backedOut.startConflict) {
      fail("the continue-or-discard choice was still standing after leaving the Play screen");
    }
    if (!backedOut.canContinue) {
      fail("backing out of the choice threw the saved match away");
    }
    if (window.localStorage.getItem(collection.MATCH_STORAGE_KEY) !== savedBefore) {
      fail("backing out of the choice rewrote the saved match");
    }
    const homeOffer = document.getElementById("continue-match");
    if (homeOffer?.hidden) {
      fail("the home screen's Continue offer is gone after backing out of the choice");
    }
    game.showScreen("play");
    if (game.readState().startConflict) {
      fail("the choice was still standing after leaving the Play screen and coming back");
    }
    for (const control of [continueSavedControl, discardSavedControl]) {
      if (control && !control.hidden) {
        fail(`the "${textOf(control)}" answer is still on screen after backing out of the choice`);
      }
    }
    if (textOf(document.getElementById("match-message")).includes("unfinished")) {
      fail("the question a start raised is still in the status line after backing out of it");
    }

    // Answering with Continue opens the saved match exactly as it was left.
    game.startMatch();
    if (continueSavedControl) {
      continueSavedControl.click();
      const picked = game.readState();
      if (picked.startConflict) {
        fail("continuing the saved match from the choice left the choice standing");
      }
      if (!picked.match?.active) {
        fail("continuing the saved match from the choice left no match on the board");
      } else if (boardShape(picked.match) !== boardShape(collection.readSavedMatch())) {
        fail(
          "continuing from the choice did not bring the saved match back exactly as it was left: " +
            `${boardShape(picked.match)} instead of ${boardShape(collection.readSavedMatch())}`
        );
      }
    }

    // Confirming the discard deals a fresh match and only then replaces the save;
    // the tool is the same move for an agent.
    const discardTool = toolNamed("discard-saved-match");
    if (!discardTool) {
      fail('no "discard-saved-match" tool is declared, so an agent cannot confirm a discard a visitor can');
    } else {
      const annotations = discardTool.annotations ?? {};
      if (annotations.readOnlyHint !== false) {
        fail('"discard-saved-match" changes the page but is not marked as changing anything (readOnlyHint: false)');
      }
      if (annotations.consequentialHint !== true) {
        fail('"discard-saved-match" throws a match away for good but is not marked as hard to undo (consequentialHint: true)');
      }

      const discardedWaiting = waitingMatch(
        "check-waiting-match-discarded",
        "Yet another match left waiting."
      );
      saveWaiting(discardedWaiting);
      const askedAgain = game.startMatch();
      if (!askedAgain.startConflict) {
        fail("starting a match with another unfinished one saved reported no conflict");
      }
      const liveBeforeDiscard = game.readState().match;

      const discarded = await discardTool.execute({});
      if (!discarded?.match?.active) {
        fail(
          `the discard-saved-match tool did not deal a fresh match: it reported ${JSON.stringify(discarded?.match)}`
        );
      }
      if (discarded?.startConflict) {
        fail("the conflict is still standing after the discard was confirmed");
      }
      const savedAfterDiscard = collection.readSavedMatch();
      if (!savedAfterDiscard || savedAfterDiscard.id === discardedWaiting.id) {
        fail("discarding did not replace the saved match, so reopening would offer the thrown-away game");
      } else if (boardShape(savedAfterDiscard) !== boardShape(discarded?.match)) {
        fail("the freshly dealt match is not the one now saved, so reloading would pick up a different game");
      }
      if (discarded?.match?.active && boardShape(discarded.match) === boardShape(liveBeforeDiscard)) {
        fail("discarding the saved match did not deal a new one");
      }
    }
  }

  // --- A player can give a match up and start another -----------------------

  // A match a player no longer wants — because they are losing, or because they
  // picked the wrong deck — can be given up at any moment before it is over. It
  // ends at once as a loss, is counted exactly once and earns no card, the saved
  // match is cleared so it is never offered again, and the same result offers a
  // fresh game. An agent gets the same move as a tool.
  if (matchEngine) {
    /**
     * Deal a match, give it up with `giveUp`, and check the result both a player
     * and an agent read: the match says it was conceded, the record counts one
     * more match and no win, no card was earned, and nothing is left saved to
     * continue. Returns the state the move reported, or null when it never ran.
     */
    const concedeFrom = async (what, giveUp) => {
      game.startMatch();
      const before = game.readState();
      if (!before.match?.active || before.match.over) {
        fail(`no live match could be dealt, so ${what} cannot be checked`);
        return null;
      }

      const winsBefore = before.wins;
      const playedBefore = before.matchesPlayed;
      const cardsBefore = collection.collectionSize(game.readCollection().ownedCards);

      let after;
      try {
        after = await giveUp();
      } catch (error) {
        fail(`${what} was refused — ${error.message}`);
        return null;
      }

      const ended = after?.match;
      if (!ended?.over) {
        fail(`${what} left the match running: it reports over ${JSON.stringify(ended?.over)}`);
        return null;
      }
      if (!ended.active) {
        fail(`${what} left the page with no match on the board to show the result`);
      }
      for (const [subject, expected, found] of [
        ["the winner", "opponent", ended.winner],
        ["the outcome", "loss", ended.outcome],
        ["whether it was conceded", true, ended.conceded],
        ["whose turn it is", null, ended.turn],
      ]) {
        if (found !== expected) {
          fail(
            `after ${what} the match reports ${subject} as ${JSON.stringify(found)} instead of ` +
              `${JSON.stringify(expected)}`
          );
        }
      }

      const finalLine = ended.log[ended.log.length - 1] ?? "";
      if (!finalLine.toLowerCase().includes("concede")) {
        fail(`the last line of a conceded match's log does not say it was conceded: it reads "${finalLine}"`);
      }
      if (!finalLine.toLowerCase().includes("you lost")) {
        fail(`the last line of a conceded match's log does not say the player lost: it reads "${finalLine}"`);
      }

      if (after.matchesPlayed !== playedBefore + 1) {
        fail(
          `after ${what} matches played reads ${after.matchesPlayed} instead of one more than ` +
            `${playedBefore}, which is what a recorded match adds`
        );
      }
      if (after.wins !== winsBefore) {
        fail(`after ${what} wins reads ${after.wins} instead of ${winsBefore} — giving up counted as a win`);
      }
      if (after.result?.outcome !== "loss" || after.result?.awarded) {
        fail(`after ${what} the result reads ${JSON.stringify(after.result)} instead of a loss that awarded no card`);
      }
      const cardsAfter = collection.collectionSize(game.readCollection().ownedCards);
      if (cardsAfter !== cardsBefore) {
        fail(
          `after ${what} the collection holds ${cardsAfter} card(s) instead of ${cardsBefore} — ` +
            "giving up a match earned a card"
        );
      }
      if (collection.readSavedMatch() !== null) {
        fail(`after ${what} the abandoned match is still saved, so the home screen would offer to continue it`);
      }
      if (game.readState().canContinue) {
        fail(`after ${what} the page still reports an unfinished match to continue`);
      }

      return after;
    };

    // Given up from the board, with the control a player presses.
    const beforePress = game.startMatch();
    const concedeControl = document.getElementById("action-concede");
    if (!beforePress.match?.active) {
      fail("no live match could be dealt, so the Concede control cannot be checked");
    } else if (!concedeControl) {
      fail(
        "the Play screen has no Concede control (#action-concede), so a player who is losing " +
          "has no way out of a match"
      );
    } else {
      if (concedeControl.hidden || concedeControl.closest("[hidden]")) {
        fail("the Concede control is hidden during a live match, so a player cannot give one up");
      }
      if (concedeControl.tagName !== "BUTTON" || concedeControl.tabIndex < 0) {
        fail("the Concede control is not a button a keyboard can reach");
      }
      if (!textOf(concedeControl).toLowerCase().includes("concede")) {
        fail(`the Concede control reads "${textOf(concedeControl)}" instead of naming what pressing it does`);
      }
      if (!beforePress.actions.includes("Concede")) {
        fail(`the moves a live match reports are ${JSON.stringify(beforePress.actions)}, which does not include Concede`);
      }
      if (beforePress.match.conceded) {
        fail("a match that has not been given up already reports itself as conceded");
      }
    }

    await concedeFrom("pressing Concede during a match", () => {
      document.getElementById("action-concede")?.click();
      return game.readState();
    });

    const afterConcede = game.readState();
    const resultHeading = textOf(document.getElementById("match-result-heading"));
    if (resultHeading !== "You conceded") {
      fail(`the result of a conceded match reads "${resultHeading || "(nothing)"}" instead of "You conceded"`);
    }
    if (concedeControl && !concedeControl.hidden) {
      fail("the Concede control is still offered once the match is over, though there is nothing left to give up");
    }
    if (afterConcede.actions.includes("Concede")) {
      fail(`a finished match still lists Concede among its moves: ${JSON.stringify(afterConcede.actions)}`);
    }

    // The result offers a fresh match, and it is a new game rather than the
    // abandoned one dealt back.
    game.showScreen("play");
    const freshButton = buttonNamed("play", "Play again");
    if (!freshButton || freshButton.hidden) {
      fail("a conceded match offers no Play again, so a player cannot begin a fresh match from the result");
    } else {
      freshButton.click();
      const fresh = game.readState().match;
      if (!fresh?.active || fresh.over) {
        fail("Play again after conceding did not deal a fresh match");
      } else if (fresh.log.some((line) => line.toLowerCase().includes("concede"))) {
        fail("Play again after conceding resumed the abandoned match instead of dealing a new one");
      } else if (concedeControl?.hidden) {
        fail("a fresh match after conceding offers no way to give that one up too");
      }
    }

    // And the same move through the tool an agent uses.
    const concedeTool = toolNamed("concede-match");
    if (!concedeTool) {
      fail('no "concede-match" tool is declared, so an agent cannot give up a match a visitor can');
    } else {
      const annotations = concedeTool.annotations ?? {};
      if (annotations.readOnlyHint !== false) {
        fail('"concede-match" changes the page but is not marked as changing anything (readOnlyHint: false)');
      }
      if (annotations.consequentialHint !== true) {
        fail('"concede-match" ends the match for good but is not marked as hard to undo (consequentialHint: true)');
      }

      const viaTool = await concedeFrom("conceding through the concede-match tool", () => concedeTool.execute({}));
      if (viaTool) {
        const second = await concedeTool.execute({});
        if (!second?.error) {
          fail(`conceding a match that is already over returned ${JSON.stringify(second)}, which reports no error`);
        } else if (game.readState().matchesPlayed !== viaTool.matchesPlayed) {
          fail("a refused second concede changed the number of matches played, so the result was counted twice");
        }
      }
    }

    // Leave a live match running, so the layout checks that follow measure a
    // board a player can actually play.
    game.startMatch();
  }

  // --- Choosing an opponent before a match ----------------------------------

  // Which character a match is against is a choice the page offers and an agent
  // makes with the same ids: the chosen one's name and deck follow the whole
  // match — the intro, the board's labels, the opening log line and the save a
  // reload picks back up.
  const opponentChoices = cardCatalog.OPPONENTS ?? [];
  if (opponentChoices.length >= 2) {
    // The third opponent, where there is one: the newest character is the one
    // most likely to be half-wired in, so the picker is exercised against it.
    const chosenOpponent = opponentChoices[2] ?? opponentChoices[1];
    const defaultOpponent = opponentChoices[0];
    const chooseTool = toolNamed("choose-opponent");
    const startTool = toolNamed("start-match");

    if (!chooseTool) {
      fail('no "choose-opponent" tool is declared, so an agent cannot pick who to face the way a visitor can');
    } else if (!chooseTool.annotations || chooseTool.annotations.readOnlyHint !== false) {
      fail('"choose-opponent" changes the page but is not marked as changing anything (readOnlyHint: false)');
    }

    // Picking an opponent changes who the next match would be against, and the
    // Play screen's own note follows.
    if (chooseTool) {
      const chosen = await chooseTool.execute({ opponentId: chosenOpponent.id });
      if (chosen.selectedOpponentId !== chosenOpponent.id) {
        fail(
          `the choose-opponent tool reports "${chosen.selectedOpponentId}" chosen after being asked for ` +
            `"${chosenOpponent.id}"`
        );
      }
      const chosenName = textOf(document.getElementById("match-intro-opponent"));
      if (!chosenName.includes(chosenOpponent.name)) {
        fail(
          `the Play screen still names "${chosenName || "(nobody)"}" before a match after choosing ` +
            `"${chosenOpponent.name}"`
        );
      }
      const checkedNow = [...document.querySelectorAll("#opponent-picker input[type='radio']")].filter(
        (radio) => radio.checked
      );
      if (checkedNow.length !== 1 || checkedNow[0].value !== chosenOpponent.id) {
        fail(
          `the picker shows ${JSON.stringify(checkedNow.map((radio) => radio.value))} chosen after choosing ` +
            `"${chosenOpponent.id}"`
        );
      }

      let refusedUnknownOpponent = false;
      try {
        await chooseTool.execute({ opponentId: "no-such-opponent" });
      } catch {
        refusedUnknownOpponent = true;
      }
      const refusedByError = game.readState().selectedOpponentId;
      if (!refusedUnknownOpponent && refusedByError === "no-such-opponent") {
        fail('choose-opponent accepted "no-such-opponent", which is not an opponent this game has');
      }
    }

    // The page's own act of starting a match, against the chosen opponent.
    let againstChosen = null;
    try {
      againstChosen = game.startMatch(chosenOpponent.id);
    } catch (error) {
      fail(`starting a match against "${chosenOpponent.id}" was refused — ${error.message}`);
    }
    if (againstChosen) {
      const m = againstChosen.match;
      if (m?.opponentName !== chosenOpponent.name || m?.opponentId !== chosenOpponent.id) {
        fail(
          `a match started against "${chosenOpponent.id}" reports ${JSON.stringify(m?.opponentName)} ` +
            `(${JSON.stringify(m?.opponentId)}) instead of "${chosenOpponent.name}"`
        );
      }
      if (!String(m?.log?.[0] ?? "").includes(chosenOpponent.name)) {
        fail(
          `the opening log line reads ${JSON.stringify(m?.log?.[0])} instead of naming the opponent ` +
            `"${chosenOpponent.name}"`
        );
      }
      for (const [what, element] of [
        ["the opponent's health", "match-opponent-health-label"],
        ["the opponent's hand", "match-opponent-hand-label"],
        ["the opponent's table", "match-opponent-table-heading"],
        ["the board's opponent line", "match-opponent-name"],
      ]) {
        const shown = textOf(document.getElementById(element));
        if (!shown.includes(chosenOpponent.name)) {
          fail(
            `${what} reads "${shown || "(nothing)"}" instead of naming the opponent "${chosenOpponent.name}"`
          );
        }
      }

      // The choice belongs to the match it started: the unfinished match saved
      // in the browser is against that character, so picking it back up later
      // does not quietly face somebody else.
      const savedChosen = collection.readSavedMatch();
      if (!savedChosen) {
        fail("a match against a chosen opponent was not saved, so reloading would lose who it is against");
      } else if (savedChosen.opponentName !== chosenOpponent.name || savedChosen.opponentId !== chosenOpponent.id) {
        fail(
          `the saved match is against ${JSON.stringify(savedChosen.opponentName)} ` +
            `(${JSON.stringify(savedChosen.opponentId)}) instead of "${chosenOpponent.name}"`
        );
      }

      // The state an agent reads says who is on offer and who is being faced.
      const afterChoose = game.readState();
      if (!Array.isArray(afterChoose.opponents) || afterChoose.opponents.length !== opponentChoices.length) {
        fail(
          `get-state lists ${(afterChoose.opponents ?? []).length} opponent(s) while the game has ` +
            `${opponentChoices.length}`
        );
      }
      if (afterChoose.selectedOpponentId !== chosenOpponent.id) {
        fail(
          `get-state says the chosen opponent is "${afterChoose.selectedOpponentId}" after a match was started ` +
            `against "${chosenOpponent.id}"`
        );
      }
    }

    // And the same thing through the tool an agent uses, with the ids a caller
    // would take from get-state's opponents — the default character and the
    // newest one, so the third is driven end to end through the tool too.
    if (startTool) {
      for (const viaToolOpponent of [defaultOpponent, chosenOpponent]) {
        const viaTool = await startTool.execute({ opponentId: viaToolOpponent.id });
        if (viaTool?.match?.opponentName !== viaToolOpponent.name) {
          fail(
            `the start-match tool reports ${JSON.stringify(viaTool?.match?.opponentName)} after being asked for ` +
              `"${viaToolOpponent.id}"`
          );
        } else if (!String(viaTool.match.log?.[0] ?? "").includes(viaToolOpponent.name)) {
          fail(
            `a match started by the tool against "${viaToolOpponent.name}" opens with ` +
              `${JSON.stringify(viaTool.match.log?.[0])}, which does not name it`
          );
        }
        if (viaTool?.selectedOpponentId !== viaToolOpponent.id) {
          fail(
            `after the start-match tool faced "${viaToolOpponent.id}" the state says the chosen opponent is ` +
              `"${viaTool?.selectedOpponentId}"`
          );
        }
      }

      // An id no opponent answers to is refused rather than dealt as anybody.
      let refusedByTool = false;
      try {
        const refused = await startTool.execute({ opponentId: "no-such-opponent" });
        refusedByTool = Boolean(refused?.error);
      } catch {
        refusedByTool = true;
      }
      if (!refusedByTool) {
        fail('the start-match tool started a match against "no-such-opponent", which is not an opponent');
      }
      if (game.readState().match?.opponentId !== chosenOpponent.id) {
        fail("a refused start-match changed which opponent the live match is against");
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

    // The controls that sit on a card face — a deck Add, a card's Play — get
    // their own smaller padding and font, because a card holds many of them and
    // each has to read as quieter than the screen's own actions. Those sizes only
    // take effect if they outrank `.btn` in the cascade; when they do not, the
    // card control renders at exactly the rail's size and its size rules are dead.
    const cardControl = { collection: ".deck-add", play: ".match-play" }[name];
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

  // A card's Add and Remove controls each say which way they move it, so whether
  // a card is in the deck is read from a label rather than from the colour of its
  // keyline.
  for (const [selector, pattern, which] of [
    [".deck-add", /^Add .+ to deck$/, "Add"],
    [".deck-remove", /^Remove .+ from deck$/, "Remove"],
  ]) {
    const controls = [...document.querySelectorAll(selector)];
    if (!controls.length) {
      fail(`the collection screen offers no ${which} control, so a card's copies cannot be managed`);
      continue;
    }
    for (const control of controls) {
      const label = textOf(control);
      if (!pattern.test(label)) {
        fail(
          `a deck's ${which} control does not say what pressing it will do: it reads "${label || "(nothing)"}" ` +
            `instead of naming the card and which way it moves it`
        );
      }
    }
  }

  // --- The match fits a phone in portrait -----------------------------------

  // The way back off the board, wherever the match's controls are laid out.
  const backToHome = document.querySelector('#screen-play .actions [data-screen-target="home"]');

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
        ["Back to home", backToHome],
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

  // --- The match fits a wide window ------------------------------------------

  // A laptop is the window a match is most often played in, so the whole board has
  // to be there too — the same promise the phone keeps by docking its controls.
  // End turn advances the game, and a player who has to scroll to it every turn is
  // playing a worse game than the one on their phone. The suite opens in a smaller
  // window than that, so the window this is measured against is the height the
  // ticket names rather than whatever the checks happen to run in.
  const WIDE_WINDOW_HEIGHT = 900;
  const WIDE_LAYOUT_WIDTH = 860; // where the page's own wide match layout begins

  if (!isPhone && viewportWidth >= WIDE_LAYOUT_WIDTH) {
    window.scrollTo(0, 0);
    const live = game.readState().match;
    if (!live || live.over) {
      fail("no live match could be dealt, so the match's layout on a wide window cannot be checked");
    } else {
      for (const [what, element] of [
        ["your health", document.getElementById("match-player-health")],
        ["the opponent's health", document.getElementById("match-opponent-health")],
        ["your energy", document.getElementById("match-energy")],
        ["your hand", document.getElementById("match-hand")],
        ["your table", document.getElementById("match-player-table-side")],
        ["the opponent's table", document.getElementById("match-opponent-table-side")],
        ["End turn", document.getElementById("action-end-turn")],
        ["Back to home", backToHome],
      ]) {
        if (!element || element.hidden) {
          fail(`${what} is not on the match screen, so a wide window cannot show it on the first screen`);
          continue;
        }
        const bottom = rectOf(element).bottom;
        if (bottom > WIDE_WINDOW_HEIGHT + 1) {
          fail(
            `${what} ends ${Math.round(bottom - WIDE_WINDOW_HEIGHT)}px below the fold of a ` +
              `${viewportWidth}x${WIDE_WINDOW_HEIGHT} window, so a match cannot be played without scrolling`
          );
        }
      }

      // The log grows with the match, so it has to be the panel that scrolls and
      // not the page: sixty lines in, the record is still readable where it sits
      // and the controls are still where they were.
      const log = document.getElementById("match-log");
      if (!log) {
        fail("the match screen has no match log, so what happened in a match cannot be read");
      } else {
        const added = Array.from({ length: 60 }, (_, i) => {
          const line = document.createElement("li");
          line.className = "match-log-line";
          line.textContent = `measured line ${i + 1} — a long enough line to wrap in its panel`;
          return line;
        });
        log.append(...added);
        const pageHeight = scrolling.scrollHeight;
        const logScrolls = log.scrollHeight > log.clientHeight + 1;
        for (const line of added) line.remove();
        if (!logScrolls) {
          fail(
            `a long match log does not scroll in its own panel — sixty lines fitted in ${log.clientHeight}px, ` +
              "so the panel is growing with the log instead of holding its place"
          );
        }
        if (pageHeight > WIDE_WINDOW_HEIGHT + 1) {
          fail(
            `a long match log makes the page taller: it is ${pageHeight}px on a ${viewportWidth}x` +
              `${WIDE_WINDOW_HEIGHT} window, so the controls a player needs scroll away`
          );
        }
      }
    }
  }

  // --- A card that draws a card when it is played ----------------------------

  // The first card ability: a card whose face says so draws its owner a card as
  // it lands. It is written once in docs/cards.js, fires from one trigger in
  // docs/match.js for both sides, and reads the same on every card face — so a
  // card is more than its three numbers and a match stays symmetric.
  const abilityText = cardCatalog.DRAW_ON_PLAY;
  const glowcapCard = cardCatalog.CARD_BY_ID.get("glowcap");
  const moonBloomCard = cardCatalog.CARD_BY_ID.get("moon-bloom");
  const plainCard = cardCatalog.CARD_BY_ID.get("pebble-toad");

  if (typeof abilityText !== "string" || !abilityText.trim()) {
    fail("docs/cards.js names no ability for a card that draws a card when played, so no card can say what it does");
  } else {
    // One ability card the player starts with, one they have to earn, so a player
    // meets the ability early and keeps finding it.
    if (glowcapCard?.ability !== abilityText) {
      fail(
        `Glowcap's ability reads ${JSON.stringify(glowcapCard?.ability ?? null)} instead of ` +
          `${JSON.stringify(abilityText)}, so a card the player starts with does not draw them a card`
      );
    }
    if (moonBloomCard?.ability !== abilityText) {
      fail(
        `Moon Bloom's ability reads ${JSON.stringify(moonBloomCard?.ability ?? null)} instead of ` +
          `${JSON.stringify(abilityText)}, so the first reward card does not draw its owner a card`
      );
    }
    if (!(cardCatalog.STARTER_COLLECTION ?? []).some((entry) => entry.id === "glowcap")) {
      fail("the card that draws a card is not in the starter collection, so a new player never meets the ability");
    }
    if (!(cardCatalog.REWARD_POOL ?? []).includes("moon-bloom")) {
      fail("the reward card that draws a card is not in the reward pool, so a player can never earn a second one");
    }
    if (plainCard?.ability !== undefined) {
      fail(
        `"${plainCard?.name}" carries the ability ${JSON.stringify(plainCard?.ability)}, though only the cards ` +
          "that say so on their face should do anything when played"
      );
    }

    // How a card face prints the ability, read off the page rather than its data:
    // the collection shows every card in the game, owned or not, and each one says
    // what it does.
    const abilityOnFace = (face) => textOf(face?.querySelector(".card-ability"));
    for (const face of document.querySelectorAll("#collection-list [data-card-id]")) {
      const id = face.dataset.cardId;
      // A card prints its when-played ability first and its fall ability as the
      // only line when it carries no when-played one, so the face's first
      // ability line is whichever of the two the card carries.
      const expected = catalogAbility(id) ?? catalogFallAbility(id) ?? "";
      if (abilityOnFace(face) !== expected) {
        const name = cardCatalog.CARD_BY_ID.get(id)?.name ?? id;
        fail(
          `the collection's "${name}" reads ${JSON.stringify(abilityOnFace(face))} where its ability is ` +
            `${JSON.stringify(expected)}, so a player cannot see what the card does`
        );
      }
    }
    const glowcapInCollection = document.querySelector('#collection-list [data-card-id="glowcap"]');
    if (abilityOnFace(glowcapInCollection) !== abilityText) {
      fail(
        `Glowcap's card in the collection does not say "${abilityText}" on its face ` +
          `(it reads ${JSON.stringify(abilityOnFace(glowcapInCollection))})`
      );
    }

    // The deck faces print it too: the opponent's deck fold is the ten faces a
    // match brings, drawn by the same deck-card face a player's own deck uses, and
    // Thornmere's deck holds the Glowcap and the Moon Bloom.
    for (const [opponentId, abilityId] of [
      ["thornmere", "glowcap"],
      ["thornmere", "moon-bloom"],
      ["emberwake", "moon-bloom"],
    ]) {
      const deckFace = document.querySelector(
        `#opponent-options [data-opponent-id="${opponentId}"] .opponent-deck-cards [data-card-id="${abilityId}"]`
      );
      if (abilityOnFace(deckFace) !== abilityText) {
        fail(
          `the deck face for "${abilityId}" in "${opponentId}"'s deck does not say "${abilityText}" ` +
            `(it reads ${JSON.stringify(abilityOnFace(deckFace))})`
        );
      }
    }

    // The card a win earned says it on its face as well.
    const rewardFace = game.awardCardFigure(moonBloomCard);
    if (abilityOnFace(rewardFace) !== abilityText) {
      fail(
        `the earned-card face of Moon Bloom does not say "${abilityText}" ` +
          `(it reads ${JSON.stringify(abilityOnFace(rewardFace))})`
      );
    }

    // The trigger itself, through the board a player sees: a controlled hand with
    // a Glowcap in it and two cards left to draw, loaded the way a saved match is.
    if (!matchEngine || typeof game.continueMatch !== "function") {
      fail("the match engine or the continue-match action is missing, so the draw-on-play trigger cannot be checked");
    } else if (
      !collection.saveMatch({
        id: "check-draw-on-play",
        opponentName: cardCatalog.OPPONENT_NAME,
        turn: "player",
        over: false,
        winner: null,
        outcome: null,
        recorded: false,
        player: {
          health: 20,
          energy: 3,
          maxEnergy: 3,
          turns: 1,
          hand: [
            { id: "glowcap", health: 4, hasAttacked: false },
            { id: "sprout", health: 1, hasAttacked: false },
          ],
          table: [],
          deck: [
            { id: "pebble-toad", health: 2, hasAttacked: false },
            { id: "sun-moth", health: 3, hasAttacked: false },
          ],
        },
        opponent: { health: 20, energy: 1, maxEnergy: 1, turns: 0, hand: [], table: [], deck: [] },
        log: ["A match set up to play a card that draws a card."],
      })
    ) {
      fail("a controlled board with Glowcap in hand could not be saved, so the draw-on-play trigger cannot be checked");
    } else {
      game.refreshSavedMatch();
      let drawBoard = null;
      try {
        drawBoard = game.continueMatch();
      } catch (e) {
        fail(`a controlled board with Glowcap in hand could not be loaded — ${e.message}`);
      }

      if (drawBoard?.match) {
        // The card in hand says on its own face what it will do when played.
        const glowcapInHand = document.querySelector('#match-hand [data-card-id="glowcap"]');
        if (abilityOnFace(glowcapInHand) !== abilityText) {
          fail(
            `Glowcap in your hand does not say "${abilityText}" on its face ` +
              `(it reads ${JSON.stringify(abilityOnFace(glowcapInHand))})`
          );
        }

        const beforePlay = game.readState().match;
        const handBefore = beforePlay.hand.map((card) => card.id);
        const logBefore = beforePlay.log.length;
        game.playMatchCard("glowcap");
        const afterPlay = game.readState().match;

        const played = afterPlay.table.find((card) => card.id === "glowcap");
        if (!played) {
          fail('playing Glowcap did not put it on the table, so the card that draws a card was never played');
        } else if (abilityOnFace(document.querySelector('#match-table [data-card-id="glowcap"]')) !== abilityText) {
          fail(
            `Glowcap on the table does not say "${abilityText}" on its face, so the card reads differently ` +
              "there than in the collection"
          );
        }
        if (afterPlay.hand.length !== handBefore.length) {
          fail(
            `playing Glowcap left ${afterPlay.hand.length} card(s) in hand instead of drawing one onto the ` +
              `${handBefore.length} it was played from (one played, one drawn)`
          );
        }
        if (!afterPlay.hand.some((card) => card.id === "pebble-toad")) {
          fail(
            `playing Glowcap drew ${JSON.stringify(afterPlay.hand.map((card) => card.id))} instead of the top ` +
              'card of the deck ("pebble-toad")'
          );
        }
        if (afterPlay.deckRemaining !== 1) {
          fail(`the draw left ${afterPlay.deckRemaining} card(s) to draw instead of the one the deck held after it`);
        }
        if (afterPlay.energy !== 0) {
          fail(
            `playing Glowcap, which costs 3, left ${afterPlay.energy} energy instead of spending its cost ` +
              "on top of drawing a card"
          );
        }
        const drawLine = afterPlay.log.slice(logBefore).find((line) => /^Glowcap draws .+ for you /.test(line));
        if (!drawLine) {
          fail(
            `the log does not say Glowcap drew a card: the play added ${JSON.stringify(afterPlay.log.slice(logBefore))}`
          );
        } else if (!drawLine.includes("Pebble Toad")) {
          fail(`the log line for the drawn card does not name it: "${drawLine}"`);
        }
        if (!document.querySelector('#match-hand [data-card-id="pebble-toad"]')) {
          fail("the card drawn by Glowcap is not in the hand on the board, though the state says it is held");
        }

        // The card that drew as it landed is marked on the table it landed on,
        // so the ability is seen on the board and not only read in the log.
        const drawer = document.querySelector('#match-table [data-card-id="glowcap"]');
        if (!drawer?.classList.contains("is-ability")) {
          fail(
            "the card that drew a card as it landed is not marked on the table, so its ability is only " +
              "read in the log"
          );
        }

        // The mark lasts one action and no longer: the next turn clears it, so
        // no card ever reads as permanently marked.
        game.endMatchTurn();
        if (document.querySelector('#match-table .match-card.is-ability')) {
          fail("the mark for a card that drew as it landed outlived the action, so a card stays marked");
        }
      }

      // The same trigger for the opponent: a Moon Bloom in its hand is played on
      // its turn, and it draws a card and says so — a match is symmetric.
      const opponentBoard = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      const elderOak = { ...cardCatalog.CARD_BY_ID.get("elder-oak"), hasAttacked: false };
      // Its hand holds only the Moon Bloom, and its deck only cards too dear for
      // the energy it has, so the Moon Bloom is the one card it plays.
      opponentBoard.opponent.hand = [{ ...moonBloomCard, hasAttacked: false }];
      opponentBoard.opponent.deck = [{ ...elderOak }, { ...elderOak }, { ...elderOak }];
      opponentBoard.opponent.energy = 2;
      opponentBoard.opponent.maxEnergy = 2;
      const opponentLogBefore = opponentBoard.log.length;
      matchEngine.endTurn(opponentBoard);
      const opponentLines = opponentBoard.log.slice(opponentLogBefore);

      if (!opponentBoard.opponent.table.some((card) => card.id === "moon-bloom")) {
        fail(
          `the opponent did not play the Moon Bloom in its hand on its turn ` +
            `(its table holds ${JSON.stringify(opponentBoard.opponent.table.map((card) => card.id))})`
        );
      }
      if (opponentBoard.opponent.energy !== 0) {
        fail(`the opponent's Moon Bloom (cost 2) left it ${opponentBoard.opponent.energy} energy instead of spending it`);
      }
      const opponentHandIds = opponentBoard.opponent.hand.map((card) => card.id);
      if (opponentHandIds.filter((id) => id === "elder-oak").length !== 2) {
        fail(
          `the opponent's Moon Bloom left it the hand ${JSON.stringify(opponentHandIds)} instead of the card it ` +
            "drew on its turn plus the one the ability drew"
        );
      }
      if (opponentBoard.opponent.deck.length !== 1) {
        fail(
          `the opponent's deck holds ${opponentBoard.opponent.deck.length} card(s) after drawing two of three, ` +
            "so the ability did not draw from the deck"
        );
      }
      const opponentDrawLine = opponentLines.find((line) => /^Moon Bloom draws .+ for the opponent /.test(line));
      if (!opponentDrawLine) {
        fail(`the log does not say the opponent's Moon Bloom drew it a card: the turn added ${JSON.stringify(opponentLines)}`);
      } else if (!opponentDrawLine.includes("Elder Oak")) {
        fail(`the log line for the card the opponent drew does not name it: "${opponentDrawLine}"`);
      }

      // A spent deck is not a broken trigger: the card still lands and still
      // costs its energy, and nothing extra is claimed in the log.
      const emptyDeckBoard = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      emptyDeckBoard.player.hand = [{ ...glowcapCard, hasAttacked: false }];
      emptyDeckBoard.player.deck = [];
      emptyDeckBoard.player.energy = 3;
      emptyDeckBoard.player.maxEnergy = 3;
      const emptyLogBefore = emptyDeckBoard.log.length;
      matchEngine.playCard(emptyDeckBoard, "glowcap");
      const emptyLines = emptyDeckBoard.log.slice(emptyLogBefore);
      if (!emptyDeckBoard.player.table.some((card) => card.id === "glowcap")) {
        fail("playing a card that draws a card with an empty deck did not put it on the table");
      }
      if (emptyDeckBoard.player.energy !== 0) {
        fail(`playing Glowcap with an empty deck left ${emptyDeckBoard.player.energy} energy instead of spending 3`);
      }
      if (emptyLines.some((line) => /draw/i.test(line))) {
        fail(`a card that draws from an empty deck claimed a draw: ${JSON.stringify(emptyLines)}`);
      }
    }
  }

  // --- A card that mends its owner's hero when it is played ------------------

  // The second when-played ability: a card whose face says so raises its owner's
  // hero as it lands, never past the 20 a hero starts with. It shares the draw
  // ability's trigger and its card-face line, so nothing new is invented to show
  // it — and, like the draw ability, it is dealt at the start and then collected
  // for, so a slow deck has an answer to an early rush.
  const healText = cardCatalog.HEAL_ON_PLAY;
  const healAmount = cardCatalog.HEAL_ON_PLAY_AMOUNT;
  const healerInStarter = cardCatalog.CARD_BY_ID.get("sprout");
  const healerInReward = cardCatalog.CARD_BY_ID.get("dewdrop-nymph");
  const heroHealth = matchEngine?.HERO_HEALTH ?? 20;
  // How a card face prints the ability, read off the page rather than its data.
  const faceAbility = (face) => textOf(face?.querySelector(".card-ability"));

  if (typeof healText !== "string" || !healText.trim()) {
    fail("docs/cards.js names no ability for a card that heals its hero when played, so no card can say what it does");
  } else if (!Number.isInteger(healAmount) || healAmount < 1) {
    fail(`the heal ability restores ${JSON.stringify(healAmount)} health, which is not a whole positive number`);
  } else if (!healText.includes(String(healAmount))) {
    fail(
      `the heal ability reads ${JSON.stringify(healText)}, which does not name the ${healAmount} it heals by, ` +
        "so the card's face and the trigger can disagree"
    );
  } else {
    // One healer the player starts with, one they have to collect.
    for (const [card, where] of [
      [healerInStarter, "the starter collection"],
      [healerInReward, "the reward pool"],
    ]) {
      if (card?.ability !== healText) {
        fail(
          `"${card?.name ?? "?"}" (${where}) carries the ability ${JSON.stringify(card?.ability ?? null)} instead ` +
            `of ${JSON.stringify(healText)}, so the card does not mend its hero when played`
        );
      }
    }

    // The line is on the face wherever the card is shown: the collection, an
    // opponent's deck fold, and the card a win earns.
    for (const [where, face] of [
      ["the collection", document.querySelector('#collection-list [data-card-id="dewdrop-nymph"]')],
      [
        "Thornmere's deck",
        document.querySelector(
          '#opponent-options [data-opponent-id="thornmere"] .opponent-deck-cards [data-card-id="dewdrop-nymph"]'
        ),
      ],
      [
        "Emberwake's deck",
        document.querySelector(
          '#opponent-options [data-opponent-id="emberwake"] .opponent-deck-cards [data-card-id="dewdrop-nymph"]'
        ),
      ],
      [
        "Mistfen's deck",
        document.querySelector(
          '#opponent-options [data-opponent-id="mistfen"] .opponent-deck-cards [data-card-id="sprout"]'
        ),
      ],
    ]) {
      if (faceAbility(face) !== healText) {
        fail(
          `the healer shown in ${where} does not say "${healText}" on its face ` +
            `(it reads ${JSON.stringify(faceAbility(face))})`
        );
      }
    }
    const rewardHealFace = game.awardCardFigure(healerInReward);
    if (faceAbility(rewardHealFace) !== healText) {
      fail(
        `the earned-card face of Dewdrop Nymph does not say "${healText}" on its face ` +
          `(it reads ${JSON.stringify(faceAbility(rewardHealFace))})`
      );
    }

    if (!matchEngine || typeof game.continueMatch !== "function") {
      fail("the match engine or the continue-match action is missing, so the heal-on-play trigger cannot be checked");
    } else {
      // Through the board a player sees: a healer in hand and a damaged hero,
      // loaded the way a saved match is.
      const savedHealBoard = collection.saveMatch({
        id: "check-heal-on-play",
        opponentName: cardCatalog.OPPONENT_NAME,
        turn: "player",
        over: false,
        winner: null,
        outcome: null,
        recorded: false,
        player: {
          health: 11,
          energy: 3,
          maxEnergy: 3,
          turns: 1,
          hand: [{ id: "sprout", health: 1, hasAttacked: false }],
          // A Toad in front of the healer, so the healer is still standing when
          // the mark it carried is checked for after the next turn.
          table: [{ id: "pebble-toad", health: 2, hasAttacked: false }],
          deck: [{ id: "sun-moth", health: 3, hasAttacked: false }],
        },
        // A healer of its own in hand and a deck far too dear for the one energy
        // it will hold, so its healer is the one card it plays on its turn — and
        // the mark for it belongs on its own table, not the player's.
        opponent: {
          health: 20,
          energy: 1,
          maxEnergy: 1,
          turns: 0,
          hand: [{ id: "dewdrop-nymph", health: 3, hasAttacked: false }],
          table: [],
          deck: [
            { id: "elder-oak", health: 9, hasAttacked: false },
            { id: "elder-oak", health: 9, hasAttacked: false },
          ],
        },
        log: ["A match set up to play a card that heals its hero."],
      });
      if (!savedHealBoard) {
        fail("a controlled board with a healer in hand could not be saved, so the heal-on-play trigger cannot be checked");
      } else {
        game.refreshSavedMatch();
        let healBoard = null;
        try {
          healBoard = game.continueMatch();
        } catch (e) {
          fail(`a controlled board with a healer in hand could not be loaded — ${e.message}`);
        }

        if (healBoard?.match) {
          const healerInHand = document.querySelector('#match-hand [data-card-id="sprout"]');
          if (faceAbility(healerInHand) !== healText) {
            fail(
              `the healer in your hand does not say "${healText}" on its face ` +
                `(it reads ${JSON.stringify(faceAbility(healerInHand))})`
            );
          }

          const beforePlay = game.readState().match;
          const healerInState = beforePlay.hand.find((card) => card.id === "sprout");
          if (healerInState?.ability !== healText) {
            fail(
              `an agent reading your hand sees the healer's ability as ` +
                `${JSON.stringify(healerInState?.ability ?? null)} instead of ${JSON.stringify(healText)}`
            );
          }

          // Played through the tool an agent uses, so the ability is usable by
          // an agent and not only by a visitor; it falls back to the page action
          // only so the checks below still run when the tool is missing.
          const playHealerTool = toolNamed("play-card");
          if (!playHealerTool) {
            fail('no "play-card" tool is declared, so an agent cannot play the healer a visitor can');
          }
          const healthBefore = beforePlay.playerHealth;
          const logBefore = beforePlay.log.length;
          const played = playHealerTool
            ? await playHealerTool.execute({ cardId: "sprout" })
            : game.playMatchCard("sprout");
          const afterPlay = played.match;
          const expectedHealth = Math.min(heroHealth, healthBefore + healAmount);

          if (afterPlay.playerHealth !== expectedHealth) {
            fail(
              `playing the healer left your hero at ${afterPlay.playerHealth} health instead of ${expectedHealth} ` +
                `(${healthBefore} before plus the ${healAmount} on the card's face)`
            );
          }
          if (textOf(document.getElementById("match-player-health")) !== String(afterPlay.playerHealth)) {
            fail(
              `the board prints your health as "${textOf(document.getElementById("match-player-health"))}" after ` +
                `the heal while the match holds ${afterPlay.playerHealth}`
            );
          }
          if (
            !afterPlay.log
              .slice(logBefore)
              .some((line) => line.includes(`your health ${afterPlay.playerHealth}`))
          ) {
            fail(
              `the log does not state your health after the heal: the play added ` +
                `${JSON.stringify(afterPlay.log.slice(logBefore))}`
            );
          }
          if (faceAbility(document.querySelector('#match-table [data-card-id="sprout"]')) !== healText) {
            fail(
              `the healer on the table does not say "${healText}" on its face, so the card reads differently ` +
                "there than in the collection"
            );
          }

          // The healer that mended your hero as it landed is marked on the table
          // it landed on, so the mend is seen on the board and not only read in
          // the log; the mark goes on the next action; and it names the side the
          // card belongs to — the opponent's own healer is marked on its table.
          const markedHealer = document.querySelector('#match-table [data-card-id="sprout"]');
          if (!markedHealer?.classList.contains("is-ability")) {
            fail(
              "the card that mended your hero as it landed is not marked on the table, so its ability is " +
                "only read in the log"
            );
          }
          game.endMatchTurn();
          const healerAfterTurn = document.querySelector('#match-table [data-card-id="sprout"]');
          if (!healerAfterTurn) {
            fail("the healer left the table before the mark it carried could be checked for a second time");
          } else if (healerAfterTurn.classList.contains("is-ability")) {
            fail("the mark for a card that mended as it landed outlived the action, so a card stays marked");
          }
          const opponentHealer = document.querySelector('#match-opponent-table [data-card-id="dewdrop-nymph"]');
          if (!opponentHealer) {
            fail(
              "the opponent did not play its healer on the turn, so the mark cannot be seen on the table " +
                "that owns the card"
            );
          } else if (!opponentHealer.classList.contains("is-ability")) {
            fail(
              "the opponent's healer is not marked on the opponent's table after it mended its hero, so the " +
                "mark does not land on the side that owns the card"
            );
          }
        }
      }

      // The clamp, through the engine: a mend can undo damage but cannot make a
      // hero tougher than new — at one short of full it reaches full, and at
      // full it stays there.
      for (const startHealth of [heroHealth - 1, heroHealth]) {
        const clampBoard = matchEngine.createMatch(
          ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
          { rng: () => 0 }
        );
        clampBoard.player.hand = [{ ...healerInStarter, hasAttacked: false }];
        clampBoard.player.energy = 1;
        clampBoard.player.maxEnergy = 1;
        clampBoard.player.health = startHealth;
        const clampLogBefore = clampBoard.log.length;
        matchEngine.playCard(clampBoard, "sprout");
        if (clampBoard.player.health !== heroHealth) {
          fail(
            `a heal from ${startHealth} health left the hero at ${clampBoard.player.health} instead of the ` +
              `${heroHealth} a hero starts with, so a heal can make a hero tougher than new`
          );
        }
        if (!clampBoard.log.slice(clampLogBefore).some((line) => line.includes(`your health ${heroHealth}`))) {
          fail(
            `the log does not state the hero's health after a clamped heal: the play added ` +
              `${JSON.stringify(clampBoard.log.slice(clampLogBefore))}`
          );
        }
      }

      // A damaged hero is mended by exactly the amount on the card's face, and
      // the cost still leaves the energy.
      const mended = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      mended.player.hand = [{ ...healerInStarter, hasAttacked: false }];
      mended.player.energy = 1;
      mended.player.maxEnergy = 1;
      mended.player.health = 7;
      matchEngine.playCard(mended, "sprout");
      if (mended.player.health !== 7 + healAmount) {
        fail(
          `playing a healer left your hero at ${mended.player.health} health instead of the ${7 + healAmount} it ` +
            `started at plus the ${healAmount} on the card's face`
        );
      }
      if (mended.player.energy !== 0) {
        fail(`playing the healer (cost 1) left ${mended.player.energy} energy instead of spending its cost`);
      }
      if (!mended.player.table.some((card) => card.id === "sprout")) {
        fail("playing the healer did not put it on the table");
      }

      // The opponent heals the same way when it plays one: the same trigger, the
      // same clamp, and the log states its health afterwards.
      const opponentHeal = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      const tooDear = { ...cardCatalog.CARD_BY_ID.get("elder-oak"), hasAttacked: false };
      opponentHeal.opponent.hand = [{ ...healerInReward, hasAttacked: false }];
      opponentHeal.opponent.deck = [{ ...tooDear }, { ...tooDear }, { ...tooDear }];
      opponentHeal.opponent.health = 8;
      opponentHeal.opponent.energy = 1;
      opponentHeal.opponent.maxEnergy = 1;
      const opponentHealLogBefore = opponentHeal.log.length;
      matchEngine.endTurn(opponentHeal);
      const opponentHealLines = opponentHeal.log.slice(opponentHealLogBefore);

      if (!opponentHeal.opponent.table.some((card) => card.id === "dewdrop-nymph")) {
        fail(
          `the opponent did not play the healer in its hand on its turn ` +
            `(its table holds ${JSON.stringify(opponentHeal.opponent.table.map((card) => card.id))})`
        );
      }
      if (opponentHeal.opponent.health !== 8 + healAmount) {
        fail(
          `the opponent's healer left it at ${opponentHeal.opponent.health} health instead of the ` +
            `${8 + healAmount} it started at plus the ${healAmount} on the card's face`
        );
      }
      if (!opponentHealLines.some((line) => line.includes(`opponent health ${opponentHeal.opponent.health}`))) {
        fail(
          `the log does not state the opponent's health after its heal: the turn added ` +
            `${JSON.stringify(opponentHealLines)}`
        );
      }
    }
  }

  // --- A card that strikes the board when it is played -----------------------

  // The third when-played ability: a card whose face says so deals its damage to
  // the opponent's front card as it lands, or to the opponent's hero once that
  // table is empty — the same targeting and the same fall wording a blow at the
  // end of a turn uses, because it is the same blow. It is the ability that lets
  // a card answer what is already on the board instead of only adding to it, and
  // it is carried by the two reward cards whose art reads as the aggressive ones.
  const strikeText = cardCatalog.STRIKE_ON_PLAY;
  const strikeAmount = cardCatalog.STRIKE_ON_PLAY_AMOUNT;
  const strikerForThornmere = cardCatalog.CARD_BY_ID.get("cinder-shrike");
  const strikerForMistfen = cardCatalog.CARD_BY_ID.get("fern-drake");

  if (typeof strikeText !== "string" || !strikeText.trim()) {
    fail("docs/cards.js names no ability for a card that strikes the board when played, so no card can say what it does");
  } else if (!Number.isInteger(strikeAmount) || strikeAmount < 1) {
    fail(`the strike ability deals ${JSON.stringify(strikeAmount)} damage, which is not a whole positive number`);
  } else if (!strikeText.includes(String(strikeAmount))) {
    fail(
      `the strike ability reads ${JSON.stringify(strikeText)}, which does not name the ${strikeAmount} it deals by, ` +
        "so the card's face and the trigger can disagree"
    );
  } else {
    // The ability is on the cards whose art reads as the aggressive ones, so the
    // card's look and what it does agree.
    for (const card of [strikerForThornmere, strikerForMistfen]) {
      if (card?.ability !== strikeText) {
        fail(
          `"${card?.name ?? "?"}" carries the ability ${JSON.stringify(card?.ability ?? null)} instead of ` +
            `${JSON.stringify(strikeText)}, so a card that reads as a striker does not strike when played`
        );
      }
    }

    // The line is on the face wherever the card is shown: the collection, an
    // opponent's deck fold, and the card a win earns.
    for (const [where, face] of [
      ["the collection", document.querySelector('#collection-list [data-card-id="cinder-shrike"]')],
      [
        "Thornmere's deck",
        document.querySelector(
          '#opponent-options [data-opponent-id="thornmere"] .opponent-deck-cards [data-card-id="cinder-shrike"]'
        ),
      ],
      [
        "Mistfen's deck",
        document.querySelector(
          '#opponent-options [data-opponent-id="mistfen"] .opponent-deck-cards [data-card-id="fern-drake"]'
        ),
      ],
    ]) {
      if (faceAbility(face) !== strikeText) {
        fail(
          `the striker shown in ${where} does not say "${strikeText}" on its face ` +
            `(it reads ${JSON.stringify(faceAbility(face))})`
        );
      }
    }
    const rewardStrikeFace = game.awardCardFigure(strikerForThornmere);
    if (faceAbility(rewardStrikeFace) !== strikeText) {
      fail(
        `the earned-card face of Cinder Shrike does not say "${strikeText}" on its face ` +
          `(it reads ${JSON.stringify(faceAbility(rewardStrikeFace))})`
      );
    }

    if (!matchEngine || typeof game.continueMatch !== "function") {
      fail("the match engine or the continue-match action is missing, so the strike-on-play trigger cannot be checked");
    } else {
      // Through the board a player sees: a striker in hand and one card standing
      // on the opponent's table, loaded the way a saved match is.
      const savedStrikeBoard = collection.saveMatch({
        id: "check-strike-on-play",
        opponentName: cardCatalog.OPPONENT_NAME,
        turn: "player",
        over: false,
        winner: null,
        outcome: null,
        recorded: false,
        player: {
          health: 20,
          energy: 3,
          maxEnergy: 3,
          turns: 1,
          hand: [
            { id: "cinder-shrike", health: 1, hasAttacked: false },
            { id: "pebble-toad", health: 2, hasAttacked: false },
          ],
          table: [],
          deck: [{ id: "sun-moth", health: 3, hasAttacked: false }],
        },
        opponent: {
          health: 20,
          energy: 1,
          maxEnergy: 1,
          turns: 0,
          hand: [],
          table: [{ id: "mudback-turtle", health: 5, hasAttacked: false }],
          deck: [],
        },
        log: ["A match set up to play a card that strikes the board."],
      });
      if (!savedStrikeBoard) {
        fail("a controlled board with a striker in hand could not be saved, so the strike-on-play trigger cannot be checked");
      } else {
        game.refreshSavedMatch();
        let strikeBoard = null;
        try {
          strikeBoard = game.continueMatch();
        } catch (e) {
          fail(`a controlled board with a striker in hand could not be loaded — ${e.message}`);
        }

        if (strikeBoard?.match) {
          const strikerInHand = document.querySelector('#match-hand [data-card-id="cinder-shrike"]');
          if (faceAbility(strikerInHand) !== strikeText) {
            fail(
              `the striker in your hand does not say "${strikeText}" on its face ` +
                `(it reads ${JSON.stringify(faceAbility(strikerInHand))})`
            );
          }

          const beforePlay = game.readState().match;
          const strikerInState = beforePlay.hand.find((card) => card.id === "cinder-shrike");
          if (strikerInState?.ability !== strikeText) {
            fail(
              `an agent reading your hand sees the striker's ability as ` +
                `${JSON.stringify(strikerInState?.ability ?? null)} instead of ${JSON.stringify(strikeText)}`
            );
          }

          // Played through the tool an agent uses, so the ability is usable by
          // an agent and not only by a visitor; it falls back to the page action
          // only so the checks below still run when the tool is missing.
          const playStrikerTool = toolNamed("play-card");
          if (!playStrikerTool) {
            fail('no "play-card" tool is declared, so an agent cannot play the striker a visitor can');
          }
          const frontBefore = beforePlay.opponentTable[0];
          const theirHeroBefore = beforePlay.opponentHealth;
          const logBefore = beforePlay.log.length;
          const played = playStrikerTool
            ? await playStrikerTool.execute({ cardId: "cinder-shrike" })
            : game.playMatchCard("cinder-shrike");
          const afterPlay = played.match;
          const frontAfter = (afterPlay.opponentTable || []).find((card) => card.id === frontBefore.id);
          const frontExpected = frontBefore.health - strikeAmount;

          if (!frontAfter || frontAfter.health !== frontExpected) {
            fail(
              `playing the striker left the opponent's front card "${frontBefore.name}" at ` +
                `${frontAfter ? frontAfter.health : "(gone)"} health instead of ${frontExpected}`
            );
          }
          if (afterPlay.opponentHealth !== theirHeroBefore) {
            fail(
              `playing the striker cut the opponent's hero to ${afterPlay.opponentHealth} while its table still ` +
                `held "${frontBefore.name}", so the strike went past the card in front of it`
            );
          }
          const strikeLine = afterPlay.log
            .slice(logBefore)
            .find((line) => line.includes("Cinder Shrike") && line.includes(frontBefore.name));
          if (!strikeLine) {
            fail(
              `the log does not say the striker hit "${frontBefore.name}": the play added ` +
                JSON.stringify(afterPlay.log.slice(logBefore))
            );
          } else if (!strikeLine.includes(`${frontExpected} health left`)) {
            fail(`the log line for the strike does not state what "${frontBefore.name}" has left: "${strikeLine}"`);
          }
          if (faceAbility(document.querySelector('#match-table [data-card-id="cinder-shrike"]')) !== strikeText) {
            fail(
              `the striker on the table does not say "${strikeText}" on its face, so the card reads differently ` +
                "there than in the collection"
            );
          }
        }
      }

      // The hero, once the opponent's table is empty: the same strike reaches
      // past an empty table, and the log states the health it left.
      const openFieldStrike = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      openFieldStrike.player.hand = [{ ...strikerForThornmere, hasAttacked: false }];
      openFieldStrike.player.energy = 3;
      openFieldStrike.player.maxEnergy = 3;
      const openHeroBefore = openFieldStrike.opponent.health;
      const openLogBefore = openFieldStrike.log.length;
      matchEngine.playCard(openFieldStrike, "cinder-shrike");
      const openLines = openFieldStrike.log.slice(openLogBefore);
      if (openFieldStrike.opponent.health !== openHeroBefore - strikeAmount) {
        fail(
          `a strike at the empty opponent table left its hero at ${openFieldStrike.opponent.health} instead of ` +
            `${openHeroBefore - strikeAmount}`
        );
      }
      if (
        !openLines.some(
          (line) => line.includes("Cinder Shrike") && line.includes(`opponent health ${openFieldStrike.opponent.health}`)
        )
      ) {
        fail(
          `the log does not state the opponent's health after a strike at its hero: the play added ` +
            JSON.stringify(openLines)
        );
      }

      // A card worn to zero by the strike leaves the table on the same line a
      // card killed at the end of a turn does.
      const fallenStrike = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      fallenStrike.player.hand = [{ ...strikerForThornmere, hasAttacked: false }];
      fallenStrike.player.energy = 3;
      fallenStrike.player.maxEnergy = 3;
      const doomedFront = { ...cardCatalog.CARD_BY_ID.get("pebble-toad"), health: 1, hasAttacked: false };
      fallenStrike.opponent.table = [doomedFront];
      const fallLogBefore = fallenStrike.log.length;
      matchEngine.playCard(fallenStrike, "cinder-shrike");
      const strikeFallLines = fallenStrike.log.slice(fallLogBefore);
      if (fallenStrike.opponent.table.includes(doomedFront)) {
        fail(`the opponent's "${doomedFront.name}" was worn to 0 by a strike but stayed on the table`);
      }
      const strikeFallLine = strikeFallLines.find((line) => line.includes(doomedFront.name) && /falls/i.test(line));
      if (!strikeFallLine) {
        fail(
          `the match log never says the card a strike killed left the table: the play added ` +
            JSON.stringify(strikeFallLines)
        );
      } else if (!/opponent's table/i.test(strikeFallLine)) {
        fail(`the log says "${doomedFront.name}" fell without saying which table it left: "${strikeFallLine}"`);
      }
      if (!strikeFallLines.some((line) => line.includes(doomedFront.name) && line.includes("0 health"))) {
        fail(
          `the log never shows "${doomedFront.name}" at 0 health before the strike removed it: ` +
            JSON.stringify(strikeFallLines)
        );
      }

      // The same trigger for the opponent: a striker in its hand hits the front
      // card of your table as it lands, and the log names what it hit.
      const opponentStrike = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      const tooDear = { ...cardCatalog.CARD_BY_ID.get("elder-oak"), hasAttacked: false };
      opponentStrike.opponent.hand = [{ ...strikerForMistfen, hasAttacked: false }];
      opponentStrike.opponent.deck = [{ ...tooDear }, { ...tooDear }, { ...tooDear }];
      opponentStrike.opponent.energy = 2;
      opponentStrike.opponent.maxEnergy = 2;
      const yourFront = { ...cardCatalog.CARD_BY_ID.get("mudback-turtle"), hasAttacked: false };
      opponentStrike.player.table = [yourFront];
      const yourFrontBefore = yourFront.health;
      const opponentStrikeLogBefore = opponentStrike.log.length;
      matchEngine.endTurn(opponentStrike);
      const opponentStrikeLines = opponentStrike.log.slice(opponentStrikeLogBefore);

      if (!opponentStrike.opponent.table.some((card) => card.id === "fern-drake")) {
        fail(
          `the opponent did not play the striker in its hand on its turn ` +
            `(its table holds ${JSON.stringify(opponentStrike.opponent.table.map((card) => card.id))})`
        );
      }
      // Its table also strikes at the end of its turn, so the front card loses
      // the strike and every attacker's blow — and the strike is the part the
      // arithmetic proves: without it the card would stand one health higher.
      const incoming = opponentStrike.opponent.table.reduce((total, card) => total + card.attack, 0);
      const yourFrontExpected = Math.max(0, yourFrontBefore - strikeAmount - incoming);
      if (yourFront.health !== yourFrontExpected) {
        fail(
          `the opponent's striker left your front card "${yourFront.name}" at ${yourFront.health} health instead ` +
            `of ${yourFrontExpected} (${strikeAmount} from the strike plus ${incoming} from its table)`
        );
      }
      if (!opponentStrikeLines.some((line) => line.includes("Fern Drake") && line.includes(yourFront.name))) {
        fail(
          `the log does not say the opponent's striker hit your "${yourFront.name}": the turn added ` +
            JSON.stringify(opponentStrikeLines)
        );
      }
    }
  }

  // --- A card that clears the opponent's table when it is played -------------

  // The fourth when-played ability: a card whose face says so deals its damage to
  // every card on the opponent's table at once, each on the same blow line and the
  // same "falls — it leaves … table" line a turn's blows use — the answer to a
  // table that has out-numbered one card's single strike. It is carried by a
  // reward card whose art reads as a sweeping gale.
  const clearText = cardCatalog.CLEAR_ON_PLAY;
  const clearAmount = cardCatalog.CLEAR_ON_PLAY_AMOUNT;
  const clearer = cardCatalog.CARD_BY_ID.get("thorn-gale");

  if (typeof clearText !== "string" || !clearText.trim()) {
    fail("docs/cards.js names no ability for a card that clears the opponent's table when played, so no card can say what it does");
  } else if (!Number.isInteger(clearAmount) || clearAmount < 1) {
    fail(`the clear ability deals ${JSON.stringify(clearAmount)} damage, which is not a whole positive number`);
  } else if (!clearText.includes(String(clearAmount))) {
    fail(
      `the clear ability reads ${JSON.stringify(clearText)}, which does not name the ${clearAmount} it deals by, ` +
        "so the card's face and the trigger can disagree"
    );
  } else if (clearer?.ability !== clearText) {
    fail(
      `"${clearer?.name ?? "?"}" carries the ability ${JSON.stringify(clearer?.ability ?? null)} instead of ` +
        `${JSON.stringify(clearText)}, so the card that reads as a sweep does not clear the table when played`
    );
  } else if (!cardCatalog.REWARD_POOL.includes(clearer.id)) {
    fail(
      `"${clearer.name}" carries the clear ability but is not in the reward pool, so a win can never add it ` +
        "to a collection"
    );
  } else {
    // The line is on the face wherever the card is shown: the collection, and the
    // card a win earns.
    const collectionClearFace = document.querySelector('#collection-list [data-card-id="thorn-gale"]');
    if (faceAbility(collectionClearFace) !== clearText) {
      fail(
        `the clearer shown in the collection does not say "${clearText}" on its face ` +
          `(it reads ${JSON.stringify(faceAbility(collectionClearFace))})`
      );
    }
    const rewardClearFace = game.awardCardFigure(clearer);
    if (faceAbility(rewardClearFace) !== clearText) {
      fail(
        `the earned-card face of Thorn Gale does not say "${clearText}" on its face ` +
          `(it reads ${JSON.stringify(faceAbility(rewardClearFace))})`
      );
    }

    if (!matchEngine || typeof game.continueMatch !== "function") {
      fail("the match engine or the continue-match action is missing, so the clear-on-play trigger cannot be checked");
    } else {
      // Through the board a player sees: a clearer in hand and a mixed opposing
      // table — two cards the sweep should kill, one healthy card it should only
      // wound, and the hero behind them all it must never touch.
      const savedClearBoard = collection.saveMatch({
        id: "check-clear-on-play",
        opponentName: cardCatalog.OPPONENT_NAME,
        turn: "player",
        over: false,
        winner: null,
        outcome: null,
        recorded: false,
        player: {
          health: 20,
          energy: 5,
          maxEnergy: 5,
          turns: 1,
          hand: [
            { id: "thorn-gale", health: 4, hasAttacked: false },
            { id: "pebble-toad", health: 2, hasAttacked: false },
          ],
          table: [],
          deck: [{ id: "sun-moth", health: 3, hasAttacked: false }],
        },
        opponent: {
          health: 20,
          energy: 1,
          maxEnergy: 1,
          turns: 0,
          hand: [],
          table: [
            { id: "pebble-toad", health: 1, hasAttacked: false },
            { id: "thornling", health: 1, hasAttacked: false },
            { id: "mudback-turtle", health: 5, hasAttacked: false },
          ],
          deck: [],
        },
        log: ["A match set up to play a card that clears the opponent's table."],
      });
      if (!savedClearBoard) {
        fail("a controlled board with a clearer in hand could not be saved, so the clear-on-play trigger cannot be checked");
      } else {
        game.refreshSavedMatch();
        let clearBoard = null;
        try {
          clearBoard = game.continueMatch();
        } catch (e) {
          fail(`a controlled board with a clearer in hand could not be loaded — ${e.message}`);
        }

        if (clearBoard?.match) {
          const clearerInHand = document.querySelector('#match-hand [data-card-id="thorn-gale"]');
          if (faceAbility(clearerInHand) !== clearText) {
            fail(
              `the clearer in your hand does not say "${clearText}" on its face ` +
                `(it reads ${JSON.stringify(faceAbility(clearerInHand))})`
            );
          }

          const beforePlay = game.readState().match;
          const clearerInState = beforePlay.hand.find((card) => card.id === "thorn-gale");
          if (clearerInState?.ability !== clearText) {
            fail(
              `an agent reading your hand sees the clearer's ability as ` +
                `${JSON.stringify(clearerInState?.ability ?? null)} instead of ${JSON.stringify(clearText)}`
            );
          }

          // Played through the tool an agent uses, so the ability is usable by an
          // agent and not only by a visitor; it falls back to the page action
          // only so the checks below still run when the tool is missing.
          const playClearTool = toolNamed("play-card");
          if (!playClearTool) {
            fail('no "play-card" tool is declared, so an agent cannot play the clearer a visitor can');
          }
          const tableBefore = beforePlay.opponentTable.map((card) => ({ id: card.id, health: card.health }));
          const theirHeroBefore = beforePlay.opponentHealth;
          const logBefore = beforePlay.log.length;
          const played = playClearTool
            ? await playClearTool.execute({ cardId: "thorn-gale" })
            : game.playMatchCard("thorn-gale");
          const afterPlay = played.match;
          const tableAfter = afterPlay.opponentTable || [];
          const clearLines = afterPlay.log.slice(logBefore);

          if (afterPlay.opponentHealth !== theirHeroBefore) {
            fail(
              `clearing the opponent's table left its hero at ${afterPlay.opponentHealth} instead of ` +
                `${theirHeroBefore}, so the sweep went past the cards in front of it`
            );
          }

          // Every card taken loses exactly the amount on the face, and a card worn
          // to 0 leaves the table with the usual fall line behind it.
          for (const card of tableBefore) {
            const name = cardCatalog.CARD_BY_ID.get(card.id)?.name ?? card.id;
            const expected = Math.max(0, card.health - clearAmount);
            const survivor = tableAfter.find((entry) => entry.id === card.id);
            if (expected === 0) {
              if (survivor) {
                fail(
                  `the "${name}" was worn to 0 by the sweep but stayed on the table at ${survivor.health} health`
                );
                continue;
              }
              const fallLine = clearLines.find((line) => line.includes(name) && /falls/i.test(line));
              if (!fallLine) {
                fail(
                  `the match log never says "${name}", worn to 0 by the sweep, left the table: the play added ` +
                    JSON.stringify(clearLines)
                );
              } else if (!/opponent's table/i.test(fallLine)) {
                fail(`the log says "${name}" fell without saying which table it left: "${fallLine}"`);
              }
            } else if (!survivor || survivor.health !== expected) {
              fail(
                `the sweep left the opponent's "${name}" at ` +
                  `${survivor ? survivor.health : "(gone)"} health instead of ${expected}`
              );
            }
          }

          // One blow line per card the sweep crossed, each naming the card and what
          // it has left — the way the log already reports a single blow.
          const sweptBlows = clearLines.filter((line) => line.includes("Thorn Gale") && line.includes("deals"));
          if (sweptBlows.length !== tableBefore.length) {
            fail(
              `the sweep logged ${sweptBlows.length} blow(s) for a table of ${tableBefore.length} card(s): ` +
                JSON.stringify(clearLines)
            );
          }
          for (const card of tableBefore) {
            const name = cardCatalog.CARD_BY_ID.get(card.id)?.name ?? card.id;
            const expected = Math.max(0, card.health - clearAmount);
            if (!clearLines.some((line) => line.includes(name) && line.includes(`${expected} health left`))) {
              fail(
                `the log never shows the swept "${name}" at ${expected} health left: ` +
                  JSON.stringify(clearLines)
              );
            }
          }

          if (faceAbility(document.querySelector('#match-table [data-card-id="thorn-gale"]')) !== clearText) {
            fail(
              `the clearer on the table does not say "${clearText}" on its face, so the card reads differently ` +
                "there than in the collection"
            );
          }
        }
      }
    }

    // The sweep is met from both sides of the table, so a player learns to hold
    // back against it and not only to hold it: the slow, wearing opponent brings
    // the clearing card in its fixed deck, and the picker promises it by name
    // before a match against that character is dealt.
    const thornmere = cardCatalog.OPPONENT_BY_ID.get("thornmere");
    const thornmereDeck = thornmere?.deck ?? [];
    const stateThornmereDeck = () =>
      game.readState().opponents.find((entry) => entry.id === "thornmere")?.deck ?? [];
    if (!thornmereDeck.includes(clearer.id)) {
      fail(
        `Thornmere's fixed deck ${JSON.stringify(thornmereDeck)} does not hold "${clearer.name}", so the opponent ` +
          "never answers the player's table with the sweep the player can hold"
      );
    } else if (!stateThornmereDeck().includes(clearer.id)) {
      fail(
        `an agent reading the state sees Thornmere's deck as ${JSON.stringify(stateThornmereDeck())}, which does ` +
          `not name "${clearer.name}"`
      );
    } else {
      const deckToolForClear = toolNamed("toggle-opponent-deck");
      if (!deckToolForClear) {
        fail(
          'no "toggle-opponent-deck" tool is declared, so an agent cannot open the sweep-bringing deck a visitor can'
        );
      } else {
        const openedClearDeck = await deckToolForClear.execute({ opponentId: "thornmere" });
        if (!(openedClearDeck?.deck ?? []).includes(clearer.id)) {
          fail(
            `opening Thornmere's deck reports ${JSON.stringify(openedClearDeck?.deck ?? null)}, which does not name ` +
              `"${clearer.name}"`
          );
        }
        // Fold it away again, so the picker is left as it was found.
        await deckToolForClear.execute({ opponentId: "thornmere" });
      }
    }

    // The picker shows the sweep on the face of the very card Thornmere promises,
    // so a player reads it before the match is dealt.
    const thornmereClearFace = document.querySelector(
      '#opponent-options [data-opponent-id="thornmere"] .opponent-deck-cards [data-card-id="thorn-gale"]'
    );
    if (faceAbility(thornmereClearFace) !== clearText) {
      fail(
        `the clearer in Thornmere's deck fold does not say "${clearText}" on its face ` +
          `(it reads ${JSON.stringify(faceAbility(thornmereClearFace))})`
      );
    }

    // The opponent's own turn, through the same engine the board runs on: a
    // Thornmere holding only its clear card sweeps a mixed player's table, so the
    // sweep is met from the other side of the table — every card takes the damage
    // on its face, each card worn to 0 leaves on the usual fall line, and the hero
    // behind the cards is never touched.
    if (matchEngine) {
      const sweptAgainst = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { opponentId: "thornmere" }
      );
      sweptAgainst.player.table = [
        { ...cardCatalog.CARD_BY_ID.get("sprout"), health: 1, hasAttacked: false },
        { ...cardCatalog.CARD_BY_ID.get("thornling"), health: 2, hasAttacked: false },
        { ...cardCatalog.CARD_BY_ID.get("mudback-turtle"), health: 5, hasAttacked: false },
      ];
      sweptAgainst.player.deck = [];
      sweptAgainst.opponent.hand = [{ ...clearer, hasAttacked: false }];
      sweptAgainst.opponent.deck = [];
      sweptAgainst.opponent.energy = clearer.cost;
      sweptAgainst.opponent.maxEnergy = clearer.cost;
      sweptAgainst.opponent.table = [];

      const yourHealthBefore = sweptAgainst.player.health;
      const yourTableBefore = sweptAgainst.player.table.map((card) => ({ id: card.id, health: card.health }));
      const turnLogBefore = sweptAgainst.log.length;
      matchEngine.endTurn(sweptAgainst);
      const sweepLines = sweptAgainst.log.slice(turnLogBefore);
      const sweepPrefix = `Opponent's ${clearer.name} deals ${clearAmount} to `;

      if (!sweptAgainst.opponent.table.some((card) => card.id === clearer.id)) {
        fail(
          `Thornmere did not play "${clearer.name}", the only card in its hand, on its turn (its table holds ` +
            `${JSON.stringify(sweptAgainst.opponent.table.map((card) => card.id))})`
        );
      }

      const sweptBlows = sweepLines.filter((line) => line.startsWith(sweepPrefix));
      if (sweptBlows.length !== yourTableBefore.length) {
        fail(
          `Thornmere's sweep logged ${sweptBlows.length} blow(s) for your table of ${yourTableBefore.length} ` +
            `card(s): ${JSON.stringify(sweepLines)}`
        );
      }
      // Each card the sweep crosses takes exactly the damage on the face, read off
      // its own blow line rather than the table afterwards: the cards still
      // standing then strike the opponent's table, so what is left there at the
      // end of the turn is not only the sweep's doing.
      for (const card of yourTableBefore) {
        const name = cardCatalog.CARD_BY_ID.get(card.id)?.name ?? card.id;
        const expected = Math.max(0, card.health - clearAmount);
        if (!sweptBlows.some((line) => line.includes(name) && line.includes(`${expected} health left`))) {
          fail(
            `Thornmere's sweep never shows your "${name}" at ${expected} health left: ` +
              JSON.stringify(sweepLines)
          );
        }
        // A card the sweep wore to 0 leaves your table at once, on the match's
        // usual fall line; a card it only wounded stays to fight the turn.
        if (expected === 0) {
          if (sweptAgainst.player.table.some((entry) => entry.id === card.id)) {
            fail(`your "${name}" was worn to 0 by Thornmere's sweep but is still on your table`);
          }
          if (!sweepLines.some((line) => line.includes(name) && /falls/i.test(line) && /your table/i.test(line))) {
            fail(
              `the match log never says your "${name}", worn to 0 by Thornmere's sweep, left your table: ` +
                JSON.stringify(sweepLines)
            );
          }
        }
      }

      // The sweep crosses the cards, not the hero behind them.
      if (sweepLines.some((line) => line.startsWith(`${sweepPrefix}you `))) {
        fail(`Thornmere's sweep went past your table to your hero: ${JSON.stringify(sweepLines)}`);
      }
      if (sweptAgainst.player.health !== yourHealthBefore) {
        fail(
          `Thornmere's sweep left your hero at ${sweptAgainst.player.health} health instead of ${yourHealthBefore}`
        );
      }
    }
  }

  // --- Two more cards that clear the opponent's table, across the cost curve --

  // A sweep carried at one price is a single reward; carried at two it is a tool
  // a deck can be built around — a cheap body a player can hold for the early
  // turns, and a heavy one for a deck that survives into the late game. Each
  // prints the ability in the same words as the first clearing card, each is
  // pictured in the shared style, and each is a reward a win can add.
  const sweepingCards = [
    { id: "gustling", costBand: [2, 3] },
    { id: "storm-roc", costBand: [5, 6] },
  ];
  for (const { id, costBand } of sweepingCards) {
    const card = cardCatalog.CARD_BY_ID.get(id);
    if (!card) {
      fail(`the sweeping card "${id}" is not in the card catalog, so the ability is still carried at one price only`);
      continue;
    }
    if (card.ability !== cardCatalog.CLEAR_ON_PLAY) {
      fail(
        `"${card.name}" carries the ability ${JSON.stringify(card.ability ?? null)} instead of ` +
          `${JSON.stringify(cardCatalog.CLEAR_ON_PLAY)}, so it does not clear the table in the same words as the others`
      );
    }
    if (card.cost < costBand[0] || card.cost > costBand[1]) {
      fail(
        `"${card.name}" costs ${card.cost} where a sweeping card is wanted between ${costBand[0]} and ` +
          `${costBand[1]}, so the ability is not spread across the cost curve`
      );
    }
    if (!pool.includes(id)) {
      fail(`"${card.name}" carries the clear ability but is not in the reward pool, so a win can never add it`);
    }
    const art = cardArt?.cardArt(id);
    if (!art || !(art.inner || "").trim()) {
      fail(`the sweeping card "${card.name}" has no picture, so it cannot be known by sight`);
    } else if (!art.description?.trim()) {
      fail(`the sweeping card "${card.name}"'s picture is not described, so it cannot be checked against the style`);
    }
  }

  // Both are cards a win can add: with every reward card before them held, the
  // next-win card walks to the cheap one and then to the heavy one, and a win
  // awards exactly the card that walk named.
  if (typeof collection.nextRewardId !== "function") {
    fail("collection.js does not export nextRewardId, so the sweeping cards cannot be checked as winnable");
  } else {
    const starters = cardCatalog.STARTER_COLLECTION.map(({ id, copies }) => ({ id, copies }));
    const heldBefore = starters.concat(pool.slice(0, pool.indexOf("gustling")).map((id) => ({ id, copies: 1 })));
    const promisedFirst = collection.nextRewardId(heldBefore);
    if (promisedFirst !== "gustling") {
      fail(
        `with the reward cards before it held the next-win card is "${promisedFirst}" instead of "gustling", ` +
          "so the cheap sweeping card cannot be won"
      );
    }
    const sweepStore = stubStorage();
    collection.saveCollection(heldBefore, sweepStore);
    const wonCheap = collection.recordResult("win", "match-gustling", sweepStore);
    if (wonCheap.awarded?.id !== "gustling") {
      fail(`a win that should add the cheap sweeping card awarded "${wonCheap.awarded?.id}" instead of "gustling"`);
    }
    const promisedSecond = collection.nextRewardId(wonCheap.cards);
    if (promisedSecond !== "storm-roc") {
      fail(
        `after winning "gustling" the next-win card is "${promisedSecond}" instead of "storm-roc", ` +
          "so the heavy sweeping card cannot be won"
      );
    }
    const wonHeavy = collection.recordResult("win", "match-storm-roc", sweepStore);
    if (wonHeavy.awarded?.id !== "storm-roc") {
      fail(`a win that should add the heavy sweeping card awarded "${wonHeavy.awarded?.id}" instead of "storm-roc"`);
    }
  }

  // The ability reads off the list an agent is handed and off the page a player
  // reads: both sweeping cards appear in list-collection with the same words, and
  // the "abilities" view lists them beside the first clearing card.
  const listForSweepers = toolNamed("list-collection");
  if (listForSweepers) {
    const listed = await listForSweepers.execute({});
    const listedCards = Array.isArray(listed.cards) ? listed.cards : [];
    for (const { id } of sweepingCards) {
      const name = cardCatalog.CARD_BY_ID.get(id)?.name ?? id;
      const entry = listedCards.find((card) => card.id === id);
      if (!entry) {
        fail(`list-collection does not return "${name}", so an agent cannot read the sweeping card it can win`);
      } else if (entry.ability !== cardCatalog.CLEAR_ON_PLAY) {
        fail(
          `list-collection returns "${name}" with ability ${JSON.stringify(entry.ability ?? null)} instead of ` +
            `${JSON.stringify(cardCatalog.CLEAR_ON_PLAY)}`
        );
      }
    }
  }
  const abilityViewForSweepers = toolNamed("set-collection-view");
  const sweepSetList = document.getElementById("collection-list");
  if (abilityViewForSweepers && sweepSetList) {
    await abilityViewForSweepers.execute({ view: "abilities" });
    const sweepRows = [...sweepSetList.querySelectorAll("[data-card-id]")].map((row) => row.dataset.cardId);
    if (!sweepRows.includes("thorn-gale")) {
      fail('the "abilities" view does not list the first clearing card "thorn-gale"');
    }
    for (const { id } of sweepingCards) {
      const name = cardCatalog.CARD_BY_ID.get(id)?.name ?? id;
      if (!sweepRows.includes(id)) {
        fail(
          `the "abilities" view does not list "${name}" beside the other when-played cards ` +
            `(it shows ${sweepRows.join(", ")})`
        );
      }
    }
    await abilityViewForSweepers.execute({ view: "all" });
  }

  // --- A blow is shown on the table, not only in the log ---------------------

  // A turn's blows land as movement on the cards: the strikers lift, the cards
  // they hit shake while their health figures drop in place, and a card worn out
  // visibly leaves its table — while the log still names every blow, and the
  // controls stay where they were. Reduced motion turns the movement off and
  // leaves the numbers and the log to carry the turn alone.
  if (matchEngine && typeof game.continueMatch === "function") {
    // A controlled board, dealt through the engine's own save shape: three
    // strikers, each dealing two — one bloodies the opponent's front card, one
    // finishes it, and one bloodies the card behind. So one blow is shown on a
    // card that falls and another on a card that survives it.
    const controlled = {
      id: "check-match-blows",
      opponentName: cardCatalog.OPPONENT_NAME,
      turn: "player",
      over: false,
      winner: null,
      outcome: null,
      recorded: false,
      player: {
        health: 20,
        energy: 3,
        maxEnergy: 3,
        turns: 0,
        hand: [],
        table: [
          { id: "glowcap", health: 4, hasAttacked: false },
          { id: "moon-bloom", health: 3, hasAttacked: false },
          { id: "twilight-fox", health: 2, hasAttacked: false },
        ],
        deck: [],
      },
      opponent: {
        health: 20,
        energy: 3,
        maxEnergy: 3,
        turns: 0,
        hand: [],
        table: [
          { id: "emberling", health: 3, hasAttacked: false },
          { id: "mudback-turtle", health: 5, hasAttacked: false },
        ],
        deck: [],
      },
      log: ["A match set up to show a blow landing."],
    };

    if (!collection.saveMatch(controlled)) {
      fail("a controlled match could not be saved, so the blows it shows cannot be checked");
    } else {
      game.refreshSavedMatch();
      let loaded = null;
      try {
        loaded = game.continueMatch();
      } catch (e) {
        fail(`a controlled match could not be loaded to check the blows it shows — ${e.message}`);
      }

      if (loaded?.match) {
        // The first draw is a clean baseline: nothing has struck or been hit yet.
        const atLoad = [...document.querySelectorAll("#match-table .match-card")];
        if (atLoad.some((card) => card.classList.contains("is-striking") || card.classList.contains("is-hit"))) {
          fail(
            "a freshly loaded match already shows a card as striking or hit, so a blow cannot be told " +
              "from the first draw"
          );
        }

        const logBefore = loaded.match.log.length;
        const fallenId = "emberling";
        game.endMatchTurn();

        const shown = game.readState().match;
        const newLines = shown.log.slice(logBefore).join(" | ");

        // The card that struck lifts.
        const striking = document.querySelector('#match-table [data-card-id="glowcap"]');
        if (!striking?.classList.contains("is-striking")) {
          fail("a card that struck during the turn is not marked as striking on the table");
        }

        // The card behind the fallen one survives its wound and shows the new
        // health figure in place: a Mudback Turtle at 3 health reads 3/1/3.
        const wounded = document.querySelector('#match-opponent-table [data-card-id="mudback-turtle"]');
        if (!wounded?.classList.contains("is-hit")) {
          fail("a card that took damage and survived is not marked as hit on the table");
        }
        const woundedStats = wounded?.querySelector(".match-card-stats");
        if (woundedStats && woundedStats.textContent !== "3/1/3") {
          fail(
            `a card that took damage reads "${textOf(woundedStats)}" instead of the new "3/1/3" ` +
              "(cost/attack/health)"
          );
        }

        // The fallen card is gone from the table but visibly leaving it, on a
        // marker that says nothing to assistive technology — the log carries the
        // fall to everyone.
        if (document.querySelector(`#match-opponent-table [data-card-id="${fallenId}"]`)) {
          fail(`a card worn to zero ("${fallenId}") is still standing on the opponent's table`);
        }
        const leaving = document.querySelector("#match-opponent-table .match-card-falling");
        if (!leaving) {
          fail("a card that fell left the table without any visible mark of it leaving");
        } else if (leaving.getAttribute("aria-hidden") !== "true") {
          fail(
            "the marker for a falling card is not hidden from assistive technology, so the fall is " +
              "announced a second time"
          );
        } else if (leaving.dataset.cardId) {
          fail("the falling marker carries a data-card-id, so it reads as a card still on the table");
        } else if (!textOf(leaving).toLowerCase().includes("fall")) {
          fail("the marker for a falling card does not say the card is leaving the table");
        }
        if (!newLines.toLowerCase().includes("falls")) {
          fail(`the log does not name the fall: the turn added ${JSON.stringify(newLines)}`);
        }

        // The board stayed usable throughout: the End turn control is still there
        // to make the next move.
        const endButton = document.getElementById("action-end-turn");
        if (!endButton || endButton.hidden) {
          fail("the End turn control is gone while the reaction plays, so the board could not be used");
        }
      }
    }

    // Reduced motion: one media block turns every reaction off and hides the
    // leaving card, so nothing moves and the numbers and log carry the turn. The
    // ability's mark is not motion, so it must survive the block — a mark that
    // was only an animation would leave the card reading as an ordinary one.
    const pageRules = [];
    const reducedRules = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // a stylesheet this page does not own is not this page's to answer for
      }
      for (const rule of rules) {
        pageRules.push(rule);
        if (rule.media?.mediaText?.includes("prefers-reduced-motion")) reducedRules.push(...rule.cssRules);
      }
    }
    for (const selector of [
      ".match-card.is-striking",
      ".match-card.is-hit",
      ".match-card.is-ability",
      ".match-card-falling",
    ]) {
      const off = reducedRules.some(
        (rule) => rule.selectorText?.includes(selector) && /(^|\s)none(\s|$|,)/.test(rule.style.animation ?? "")
      );
      if (!off) {
        fail(
          `reduced motion does not turn the "${selector}" reaction off, so it still moves for a visitor ` +
            "who asked it not to"
        );
      }
    }
    const staticAbilityMark = pageRules.some(
      (rule) =>
        rule.selectorText?.includes(".match-card.is-ability") &&
        /(border-color|box-shadow|outline)\s*:/.test(rule.style?.cssText ?? "")
    );
    if (!staticAbilityMark) {
      fail(
        "the mark for a card that fired a when-played ability is animation-only, so with reduced motion the " +
          "card would read as an ordinary one"
      );
    }
    const hidesFalling = reducedRules.some(
      (rule) =>
        rule.selectorText?.includes(".match-card-falling") && /(^|\s)none(\s|$|,)/.test(rule.style.display ?? "")
    );
    if (!hidesFalling) {
      fail("reduced motion does not hide the falling-card marker, so a card could still appear to leave the table");
    }
  }

  // --- A card that draws its owner a card when it falls ----------------------

  // The first fall ability: a card whose face says so draws its owner a card the
  // moment it leaves the table, whichever blow removed it — a chosen attack, a
  // turn's blows or a sweeping card. It lives in a `fallAbility` field of its own
  // rather than overloading `ability`, so the when-played text keeps its exact
  // meaning and the one trigger in docs/match.js fires it from every removal path.
  // The pod that carries it is a reward card, so removing it hands the opponent a
  // card instead of only taking a body.
  const fallText = cardCatalog.DRAW_ON_FALL;
  const seedPod = cardCatalog.CARD_BY_ID.get("seed-pod");

  if (typeof fallText !== "string" || !fallText.trim()) {
    fail("docs/cards.js names no fall ability, so no card can say what it does when it leaves the table");
  } else if (!seedPod) {
    fail('"seed-pod" is not a card in the game, so the fall ability has no card that carries it');
  } else {
    if (seedPod.fallAbility !== fallText) {
      fail(
        `"${seedPod.name}" carries the fall ability ${JSON.stringify(seedPod.fallAbility ?? null)} instead of ` +
          `${JSON.stringify(fallText)}, so the pod does not draw its owner a card when it falls`
      );
    }
    if (seedPod.ability !== undefined) {
      fail(
        `"${seedPod.name}" carries a when-played ability ${JSON.stringify(seedPod.ability)}, though the fall ` +
          "ability belongs in a field of its own so the when-played text keeps its meaning"
      );
    }
    if (!cardCatalog.REWARD_POOL.includes(seedPod.id)) {
      fail(
        `"${seedPod.name}" carries the fall ability but is not in the reward pool, so a win can never add it ` +
          "to a collection"
      );
    }

    // The pod is a real card: it has its own described picture, and it can be
    // played like any other card.
    const podArt = cardArt?.cardArt(seedPod.id);
    if (!podArt || !(podArt.inner || "").trim()) {
      fail(`"${seedPod.name}" has no picture, so the card that carries the fall ability cannot be known by sight`);
    } else if (!podArt.description?.trim()) {
      fail(`"${seedPod.name}"'s picture is not described, so it cannot be checked against the style`);
    }
    if (matchEngine) {
      const playPod = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      playPod.player.hand = [{ ...seedPod, hasAttacked: false }];
      playPod.player.deck = [];
      playPod.player.energy = seedPod.cost;
      playPod.player.maxEnergy = seedPod.cost;
      matchEngine.playCard(playPod, "seed-pod");
      if (!playPod.player.table.some((card) => card.id === "seed-pod")) {
        fail(`playing "${seedPod.name}" did not put it on the table, so the pod is not a card a deck can play`);
      }
    }

    // The line is on the face wherever the pod is shown: the collection, and the
    // card a win earns.
    const collectionPodFace = document.querySelector('#collection-list [data-card-id="seed-pod"]');
    if (faceAbility(collectionPodFace) !== fallText) {
      fail(
        `the pod shown in the collection does not say ${JSON.stringify(fallText)} on its face ` +
          `(it reads ${JSON.stringify(faceAbility(collectionPodFace))})`
      );
    }
    const rewardPodFace = game.awardCardFigure(seedPod);
    if (faceAbility(rewardPodFace) !== fallText) {
      fail(
        `the earned-card face of the pod does not say ${JSON.stringify(fallText)} ` +
          `(it reads ${JSON.stringify(faceAbility(rewardPodFace))})`
      );
    }

    // A card may carry both abilities, and then prints both lines of its text
    // box — the when-played line first, the fall line under it — so neither text
    // is lost when a card does two things.
    const bothFace = game.awardCardFigure({ ...seedPod, ability: cardCatalog.DRAW_ON_PLAY });
    const bothLines = [...bothFace.querySelectorAll(".card-ability")].map((line) => textOf(line));
    if (bothLines.length !== 2 || bothLines[0] !== cardCatalog.DRAW_ON_PLAY || bothLines[1] !== fallText) {
      fail(
        `a card carrying both abilities prints ${JSON.stringify(bothLines)} on its face instead of the ` +
          `when-played line ${JSON.stringify(cardCatalog.DRAW_ON_PLAY)} above the fall line ${JSON.stringify(fallText)}`
      );
    }

    // An agent that lists the set reads the fall ability in the field written for
    // it, so the word on the card and the field a caller reads are one answer.
    if (listCollection) {
      const podEntry = (await listCollection.execute()).cards.find((card) => card.id === "seed-pod");
      if (podEntry?.fallAbility !== fallText) {
        fail(
          `list-collection returns the pod with fallAbility ${JSON.stringify(podEntry?.fallAbility ?? null)} ` +
            `instead of ${JSON.stringify(fallText)}`
        );
      }
    }

    // The trigger itself, through the engine the board runs on: a pod is killed
    // in each of the ways a table card can be removed, and each time its owner
    // draws the top of its own deck and the log names the pod and the card.
    if (!matchEngine) {
      fail("docs/match.js could not be imported, so the fall trigger cannot be checked");
    } else {
      const fallDeck = ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"];
      const topOfDeck = { ...cardCatalog.CARD_BY_ID.get("elder-oak"), hasAttacked: false };
      // A fresh striker per board: a match marks the card that attacked, so one
      // shared object would carry that mark into the next board and be refused.
      const sproutFor = () => ({ ...cardCatalog.CARD_BY_ID.get("sprout"), health: 1, hasAttacked: false });

      // (1) An ordinary chosen attack.
      const attackBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      attackBoard.player.table = [sproutFor()];
      attackBoard.player.hand = [];
      attackBoard.player.deck = [];
      attackBoard.opponent.table = [{ ...seedPod, health: 1, hasAttacked: false }];
      attackBoard.opponent.hand = [];
      attackBoard.opponent.deck = [{ ...topOfDeck }];
      const attackLogBefore = attackBoard.log.length;
      matchEngine.attack(attackBoard, "sprout", "seed-pod");
      const attackLines = attackBoard.log.slice(attackLogBefore);
      if (attackBoard.opponent.table.some((card) => card.id === "seed-pod")) {
        fail("a chosen attack left the pod on the table, so the fall trigger was never reached");
      }
      if (!attackLines.some((line) => line.includes(seedPod.name) && /falls/i.test(line))) {
        fail(`the log never says the fallen pod left the table: ${JSON.stringify(attackLines)}`);
      }
      if (attackBoard.opponent.hand.length !== 1) {
        fail(
          `killing the pod with an attack left its owner holding ${attackBoard.opponent.hand.length} card(s) ` +
            "instead of the one it drew as the pod fell"
        );
      }
      const attackDrawLine = attackLines.find((line) => line.includes(seedPod.name) && /draws/i.test(line));
      if (!attackDrawLine) {
        fail(`the log does not say the fallen pod drew its owner a card: ${JSON.stringify(attackLines)}`);
      } else if (!attackDrawLine.includes("Elder Oak")) {
        fail(`the log line for the pod's fall draw does not name the card drawn: "${attackDrawLine}"`);
      } else if (!/for the opponent/.test(attackDrawLine)) {
        fail(`the log does not say the pod's owner drew the card: "${attackDrawLine}"`);
      }

      // (2) A turn's blows, through endTurn.
      const turnBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      turnBoard.player.table = [sproutFor()];
      turnBoard.player.hand = [];
      turnBoard.player.deck = [];
      turnBoard.opponent.table = [{ ...seedPod, health: 1, hasAttacked: false }];
      turnBoard.opponent.hand = [];
      turnBoard.opponent.deck = [{ ...topOfDeck }];
      const turnLogBefore = turnBoard.log.length;
      matchEngine.endTurn(turnBoard);
      const turnLines = turnBoard.log.slice(turnLogBefore);
      if (!turnLines.some((line) => line.includes(seedPod.name) && /falls/i.test(line))) {
        fail(`ending the turn did not make the pod fall: ${JSON.stringify(turnLines)}`);
      }
      const turnDrawLine = turnLines.find((line) => line.includes(seedPod.name) && /draws/i.test(line));
      if (!turnDrawLine || !turnDrawLine.includes("Elder Oak")) {
        fail(
          "a turn's blows did not make the fallen pod draw its owner a card: the turn added " +
            JSON.stringify(turnLines)
        );
      }

      // (3) A sweeping card, through the clear ability it fires as it lands.
      const sweepBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      sweepBoard.player.hand = [{ ...cardCatalog.CARD_BY_ID.get("thorn-gale"), hasAttacked: false }];
      sweepBoard.player.table = [];
      sweepBoard.player.deck = [];
      sweepBoard.player.energy = 6;
      sweepBoard.player.maxEnergy = 6;
      sweepBoard.opponent.table = [
        { ...seedPod, health: 1, hasAttacked: false },
        { ...cardCatalog.CARD_BY_ID.get("mudback-turtle"), health: 5, hasAttacked: false },
      ];
      sweepBoard.opponent.hand = [];
      sweepBoard.opponent.deck = [{ ...topOfDeck }];
      const sweepLogBefore = sweepBoard.log.length;
      matchEngine.playCard(sweepBoard, "thorn-gale");
      const sweepLines = sweepBoard.log.slice(sweepLogBefore);
      if (sweepBoard.opponent.table.some((card) => card.id === "seed-pod")) {
        fail("a sweeping card left the pod on the table, so the fall trigger was never reached");
      }
      const sweepDrawLine = sweepLines.find((line) => line.includes(seedPod.name) && /draws/i.test(line));
      if (!sweepDrawLine || !sweepDrawLine.includes("Elder Oak")) {
        fail(
          "a sweeping card did not make the fallen pod draw its owner a card: the play added " +
            JSON.stringify(sweepLines)
        );
      }

      // (4) A pod held without the field, as a match saved before it existed
      // holds one: the ability is resolved from the catalog by id, so it still
      // fires.
      const legacyPod = {
        id: "seed-pod",
        name: seedPod.name,
        cost: seedPod.cost,
        attack: seedPod.attack,
        health: 1,
        hasAttacked: false,
      };
      const legacyBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      legacyBoard.player.table = [sproutFor()];
      legacyBoard.player.hand = [];
      legacyBoard.player.deck = [];
      legacyBoard.opponent.table = [{ ...legacyPod }];
      legacyBoard.opponent.hand = [];
      legacyBoard.opponent.deck = [{ ...topOfDeck }];
      matchEngine.attack(legacyBoard, "sprout", "seed-pod");
      if (!legacyBoard.opponent.hand.some((card) => card.id === "elder-oak")) {
        fail("a pod card without the field, as a match saved before it existed holds, did not draw when it fell");
      }

      // (5) A card with no fall ability changes nothing beyond the fall line the
      // log already prints: no draw, and no extra line.
      const plainBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      plainBoard.player.table = [sproutFor()];
      plainBoard.player.hand = [];
      plainBoard.player.deck = [];
      plainBoard.opponent.table = [{ ...cardCatalog.CARD_BY_ID.get("pebble-toad"), health: 1, hasAttacked: false }];
      plainBoard.opponent.hand = [];
      plainBoard.opponent.deck = [{ ...topOfDeck }];
      const plainLogBefore = plainBoard.log.length;
      matchEngine.attack(plainBoard, "sprout", "pebble-toad");
      const plainLines = plainBoard.log.slice(plainLogBefore);
      if (plainBoard.opponent.hand.length !== 0) {
        fail(
          `killing a card with no fall ability left its owner holding ${plainBoard.opponent.hand.length} card(s)`
        );
      }
      if (plainBoard.opponent.deck.length !== 1) {
        fail("killing a card with no fall ability drew from its owner's deck");
      }
      if (plainLines.some((line) => /draws/i.test(line))) {
        fail(`killing a card with no fall ability drew a card: ${JSON.stringify(plainLines)}`);
      }
      if (!plainLines.some((line) => line.includes("Pebble Toad") && /falls/i.test(line))) {
        fail(`the log does not print the usual fall line for a card with no fall ability: ${JSON.stringify(plainLines)}`);
      }
    }

    // The pod's face in a match, and the field an agent reads of a match card, as
    // the page shows them: a controlled board with the pod in hand is loaded the
    // way a saved match is.
    if (!matchEngine || typeof game.continueMatch !== "function") {
      fail("the match engine or the continue-match action is missing, so the pod in a match cannot be checked");
    } else if (
      !collection.saveMatch({
        id: "check-fall-ability",
        opponentName: cardCatalog.OPPONENT_NAME,
        turn: "player",
        over: false,
        winner: null,
        outcome: null,
        recorded: false,
        player: {
          health: 20,
          energy: 3,
          maxEnergy: 3,
          turns: 1,
          hand: [
            { id: "seed-pod", health: 1, hasAttacked: false },
            { id: "sprout", health: 1, hasAttacked: false },
          ],
          table: [],
          deck: [{ id: "pebble-toad", health: 2, hasAttacked: false }],
        },
        opponent: { health: 20, energy: 1, maxEnergy: 1, turns: 0, hand: [], table: [], deck: [] },
        log: ["A match set up to hold the pod that draws a card when it falls."],
      })
    ) {
      fail("a controlled board with the pod in hand could not be saved, so the pod in a match cannot be checked");
    } else {
      game.refreshSavedMatch();
      let fallBoard = null;
      try {
        fallBoard = game.continueMatch();
      } catch (e) {
        fail(`a controlled board with the pod in hand could not be loaded — ${e.message}`);
      }

      if (fallBoard?.match) {
        const podInHand = document.querySelector('#match-hand [data-card-id="seed-pod"]');
        if (faceAbility(podInHand) !== fallText) {
          fail(
            `the pod in your hand does not say ${JSON.stringify(fallText)} on its face ` +
              `(it reads ${JSON.stringify(faceAbility(podInHand))})`
          );
        }
        const podInState = fallBoard.match.hand.find((card) => card.id === "seed-pod");
        if (podInState?.fallAbility !== fallText) {
          fail(
            `an agent reading your hand sees the pod's fallAbility as ` +
              `${JSON.stringify(podInState?.fallAbility ?? null)} instead of ${JSON.stringify(fallText)}`
          );
        }
        if (getState) {
          const podViaTool = ((await getState.execute({})).match?.hand ?? []).find(
            (card) => card.id === "seed-pod"
          );
          if (podViaTool?.fallAbility !== fallText) {
            fail(
              `get-state returns the pod in your hand with fallAbility ` +
                `${JSON.stringify(podViaTool?.fallAbility ?? null)} instead of ${JSON.stringify(fallText)}`
            );
          }
        }
      }
    }
  }

  // --- A card that mends its owner's hero when it falls ----------------------

  // The second fall ability: a card whose face says so raises its owner's hero by
  // the amount it prints the moment it leaves the table, from the same one trigger
  // every removal path reaches — so losing a body a player expected to trade pays
  // health back, and a slow deck has a reason to keep one just to spend it. The
  // mend is capped at the health a hero starts a match with, and the log states
  // the health afterwards in the same words the board prints it, so the number a
  // reader sees is the number the board shows.
  const fallHealText = cardCatalog.HEAL_ON_FALL;
  const fallHealAmount = cardCatalog.HEAL_ON_FALL_AMOUNT;
  const comfreyRoot = cardCatalog.CARD_BY_ID.get("comfrey-root");

  if (typeof fallHealText !== "string" || !fallHealText.trim()) {
    fail("docs/cards.js names no ability for a card that heals its hero when it falls, so no card can say what it does");
  } else if (!Number.isInteger(fallHealAmount) || fallHealAmount < 1) {
    fail(`the fall heal restores ${JSON.stringify(fallHealAmount)} health, which is not a whole positive number`);
  } else if (!fallHealText.includes(String(fallHealAmount))) {
    fail(
      `the fall heal reads ${JSON.stringify(fallHealText)}, which does not name the ${fallHealAmount} it heals by, ` +
        "so the card's face and the trigger can disagree"
    );
  } else if (!comfreyRoot) {
    fail('"comfrey-root" is not a card in the game, so the fall heal has no card that carries it');
  } else {
    if (comfreyRoot.fallAbility !== fallHealText) {
      fail(
        `"${comfreyRoot.name}" carries the fall ability ${JSON.stringify(comfreyRoot.fallAbility ?? null)} instead of ` +
          `${JSON.stringify(fallHealText)}, so it does not mend its owner's hero when it falls`
      );
    }
    if (comfreyRoot.ability !== undefined) {
      fail(
        `"${comfreyRoot.name}" carries a when-played ability ${JSON.stringify(comfreyRoot.ability)}, though the fall ` +
          "ability belongs in a field of its own so the when-played text keeps its meaning"
      );
    }
    if (!cardCatalog.REWARD_POOL.includes(comfreyRoot.id)) {
      fail(
        `"${comfreyRoot.name}" carries the fall heal but is not in the reward pool, so a win can never add it ` +
          "to a collection"
      );
    }

    // The root is a real card: it has its own described picture, and it can be
    // played like any other card.
    const rootArt = cardArt?.cardArt(comfreyRoot.id);
    if (!rootArt || !(rootArt.inner || "").trim()) {
      fail(`"${comfreyRoot.name}" has no picture, so the card that carries the fall heal cannot be known by sight`);
    } else if (!rootArt.description?.trim()) {
      fail(`"${comfreyRoot.name}"'s picture is not described, so it cannot be checked against the style`);
    }
    if (matchEngine) {
      const playRoot = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      playRoot.player.hand = [{ ...comfreyRoot, hasAttacked: false }];
      playRoot.player.deck = [];
      playRoot.player.energy = comfreyRoot.cost;
      playRoot.player.maxEnergy = comfreyRoot.cost;
      matchEngine.playCard(playRoot, "comfrey-root");
      if (!playRoot.player.table.some((card) => card.id === "comfrey-root")) {
        fail(`playing "${comfreyRoot.name}" did not put it on the table, so it is not a card a deck can play`);
      }
    }

    // The line is on the face wherever the card is shown: the collection, and the
    // card a win earns.
    const collectionRootFace = document.querySelector('#collection-list [data-card-id="comfrey-root"]');
    if (faceAbility(collectionRootFace) !== fallHealText) {
      fail(
        `the root shown in the collection does not say ${JSON.stringify(fallHealText)} on its face ` +
          `(it reads ${JSON.stringify(faceAbility(collectionRootFace))})`
      );
    }
    const rewardRootFace = game.awardCardFigure(comfreyRoot);
    if (faceAbility(rewardRootFace) !== fallHealText) {
      fail(
        `the earned-card face of the root does not say ${JSON.stringify(fallHealText)} ` +
          `(it reads ${JSON.stringify(faceAbility(rewardRootFace))})`
      );
    }

    // An agent that lists the set reads the fall heal in the field written for it,
    // so the word on the card and the field a caller reads are one answer.
    if (listCollection) {
      const rootEntry = (await listCollection.execute()).cards.find((card) => card.id === "comfrey-root");
      if (rootEntry?.fallAbility !== fallHealText) {
        fail(
          `list-collection returns the root with fallAbility ${JSON.stringify(rootEntry?.fallAbility ?? null)} ` +
            `instead of ${JSON.stringify(fallHealText)}`
        );
      }
    }

    // The trigger itself, through the engine the board runs on.
    if (!matchEngine) {
      fail("docs/match.js could not be imported, so the fall heal cannot be checked");
    } else {
      const fallDeck = ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"];
      // The player's own root, felled by the opponent's turn: the hero it leaves
      // behind stands higher by the amount the face prints. A fresh board per
      // starting health, so the raise and the cap are told apart.
      const playerRootFalls = (startHealth) => {
        const board = matchEngine.createMatch(fallDeck, { rng: () => 0 });
        board.player.health = startHealth;
        board.player.table = [{ ...comfreyRoot, hasAttacked: false }];
        board.player.hand = [];
        board.player.deck = [];
        // Enough health to survive the root's own blow and then strike it down.
        board.opponent.table = [
          { ...cardCatalog.CARD_BY_ID.get("bramble-hound"), health: 4, hasAttacked: false },
        ];
        board.opponent.hand = [];
        board.opponent.deck = [];
        const before = board.log.length;
        matchEngine.endTurn(board);
        return { board, lines: board.log.slice(before) };
      };

      // (1) The raise: a hero at 10 stands at 12 after its root falls, and the
      // log states the health in the board's words.
      const raised = playerRootFalls(10);
      if (raised.board.player.table.some((card) => card.id === "comfrey-root")) {
        fail("a turn's blows left the root on the table, so the fall heal was never reached");
      }
      if (raised.board.player.health !== 12) {
        fail(
          `the fallen root left its owner's hero at ${raised.board.player.health} health instead of 12 ` +
            `(10 plus the ${fallHealAmount} it heals for)`
        );
      }
      const raiseLine = raised.lines.find((line) => line.includes(comfreyRoot.name) && /heals/i.test(line));
      if (!raiseLine) {
        fail(`the log does not say the fallen root healed its owner: ${JSON.stringify(raised.lines)}`);
      } else if (!raiseLine.includes(`your health ${raised.board.player.health}`)) {
        fail(
          `the log line for the root's fall heal does not state the health the board shows: "${raiseLine}"`
        );
      }

      // (2) The cap: a mend can undo damage but cannot make a hero tougher than
      // new, so a root falling for a hero already at its starting health pays
      // nothing above it.
      const capped = playerRootFalls(matchEngine.HERO_HEALTH);
      if (capped.board.player.health !== matchEngine.HERO_HEALTH) {
        fail(
          `a fall heal pushed a hero to ${capped.board.player.health} health, past the ${matchEngine.HERO_HEALTH} ` +
            "a hero starts a match with, so a mend can make a hero tougher than new"
        );
      }

      // (3) The opponent's copy mends the opponent's hero, and the log names that
      // side's health — the ability is symmetric, not the player's alone.
      const foeBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      foeBoard.player.table = [{ ...cardCatalog.CARD_BY_ID.get("sprout"), health: 1, hasAttacked: false }];
      foeBoard.player.hand = [];
      foeBoard.player.deck = [];
      foeBoard.opponent.health = 8;
      foeBoard.opponent.table = [{ ...comfreyRoot, health: 1, hasAttacked: false }];
      foeBoard.opponent.hand = [];
      const foeLogBefore = foeBoard.log.length;
      matchEngine.attack(foeBoard, "sprout", "comfrey-root");
      const foeLines = foeBoard.log.slice(foeLogBefore);
      if (foeBoard.opponent.health !== 10) {
        fail(
          `the opponent's fallen root left its hero at ${foeBoard.opponent.health} health instead of 10 ` +
            `(8 plus the ${fallHealAmount} it heals for)`
        );
      }
      const foeLine = foeLines.find((line) => line.includes(comfreyRoot.name) && /heals/i.test(line));
      if (!foeLine || !foeLine.includes(`opponent health ${foeBoard.opponent.health}`)) {
        fail(
          `the log line for the opponent's fall heal does not state the health the board shows: ` +
            `${JSON.stringify(foeLines)}`
        );
      }

      // (4) A card with no fall ability changes nothing: no heal, and no extra
      // line beyond the fall the log already prints.
      const plainBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      plainBoard.player.health = 10;
      plainBoard.player.table = [{ ...cardCatalog.CARD_BY_ID.get("sprout"), health: 1, hasAttacked: false }];
      plainBoard.player.hand = [];
      plainBoard.player.deck = [];
      plainBoard.opponent.table = [{ ...cardCatalog.CARD_BY_ID.get("pebble-toad"), health: 1, hasAttacked: false }];
      plainBoard.opponent.hand = [];
      const plainLogBefore = plainBoard.log.length;
      matchEngine.attack(plainBoard, "sprout", "pebble-toad");
      const plainLines = plainBoard.log.slice(plainLogBefore);
      if (plainBoard.player.health !== 10) {
        fail(
          `killing a card with no fall ability changed its owner's health to ${plainBoard.player.health} ` +
            "instead of 10"
        );
      }
      if (plainLines.some((line) => /heals/i.test(line))) {
        fail(`killing a card with no fall ability healed a hero: ${JSON.stringify(plainLines)}`);
      }
    }
  }

  // --- A card that strikes the board when it falls --------------------------

  // The third fall ability: a card whose face says so lands the same blow a
  // when-played strike lands the moment it leaves the table — on the front card
  // of the opponent's table, or on that side's hero once its table is empty — so
  // wiping a table with a sweeping card costs something. The blow reuses the same
  // tree as every other blow, so a card killed by a fall leaves the table on the
  // same line as one killed any other way, a fall caused by a fall fires its own
  // ability in turn, and a chain of falls stops once a hero has fallen.
  const fallStrikeText = cardCatalog.STRIKE_ON_FALL;
  const fallStrikeAmount = cardCatalog.STRIKE_ON_PLAY_AMOUNT;
  const whipthorn = cardCatalog.CARD_BY_ID.get("whipthorn");

  if (typeof fallStrikeText !== "string" || !fallStrikeText.trim()) {
    fail("docs/cards.js names no ability for a card that strikes the board when it falls, so no card can say what it does");
  } else if (!fallStrikeText.includes(String(fallStrikeAmount))) {
    fail(
      `the fall strike reads ${JSON.stringify(fallStrikeText)}, which does not name the ${fallStrikeAmount} it deals, ` +
        "so the card's face and the trigger can disagree"
    );
  } else if (!whipthorn) {
    fail('"whipthorn" is not a card in the game, so the fall strike has no card that carries it');
  } else {
    if (whipthorn.fallAbility !== fallStrikeText) {
      fail(
        `"${whipthorn.name}" carries the fall ability ${JSON.stringify(whipthorn.fallAbility ?? null)} instead of ` +
          `${JSON.stringify(fallStrikeText)}, so it does not strike the board when it falls`
      );
    }
    if (!cardCatalog.REWARD_POOL.includes(whipthorn.id)) {
      fail(
        `"${whipthorn.name}" carries the fall strike but is not in the reward pool, so a win can never add it ` +
          "to a collection"
      );
    }

    // The card is a real card: its own described picture, in the shared style,
    // and playable like any other.
    const whipArt = cardArt?.cardArt(whipthorn.id);
    if (!whipArt || !(whipArt.inner || "").trim()) {
      fail(`"${whipthorn.name}" has no picture, so the card that carries the fall strike cannot be known by sight`);
    } else if (!whipArt.description?.trim()) {
      fail(`"${whipthorn.name}"'s picture is not described, so it cannot be checked against the style`);
    } else if (!/art-body/.test(whipArt.inner)) {
      fail(`"${whipthorn.name}" is drawn without a creature in the foil the whole set is drawn in`);
    }
    if (matchEngine) {
      const playWhip = matchEngine.createMatch(
        ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"],
        { rng: () => 0 }
      );
      playWhip.player.hand = [{ ...whipthorn, hasAttacked: false }];
      playWhip.player.deck = [];
      playWhip.player.energy = whipthorn.cost;
      playWhip.player.maxEnergy = whipthorn.cost;
      matchEngine.playCard(playWhip, "whipthorn");
      if (!playWhip.player.table.some((card) => card.id === "whipthorn")) {
        fail(`playing "${whipthorn.name}" did not put it on the table, so it is not a card a deck can play`);
      }
      // A deck built from it is dealt from the catalog like any other deck, so
      // the card is one a player can collect, put in a deck and draw.
      const whipDeck = matchEngine.createMatch(
        ["whipthorn", "whipthorn", "whipthorn", "whipthorn", "whipthorn"],
        { rng: () => 0 }
      );
      const dealt = [...whipDeck.player.hand, ...whipDeck.player.deck];
      if (dealt.length !== 5 || dealt.some((card) => card.id !== "whipthorn")) {
        fail(
          `a deck of five Whipthorns was dealt as ${JSON.stringify(dealt.map((card) => card.id))}, so the card ` +
            "cannot be built into a deck"
        );
      }
    }

    // The line is on the face wherever the card is shown: the set list, and the
    // card a win earns.
    const collectionWhipFace = document.querySelector('#collection-list [data-card-id="whipthorn"]');
    if (faceAbility(collectionWhipFace) !== fallStrikeText) {
      fail(
        `the Whipthorn shown in the collection does not say ${JSON.stringify(fallStrikeText)} on its face ` +
          `(it reads ${JSON.stringify(faceAbility(collectionWhipFace))})`
      );
    }
    const rewardWhipFace = game.awardCardFigure(whipthorn);
    if (faceAbility(rewardWhipFace) !== fallStrikeText) {
      fail(
        `the earned-card face of the Whipthorn does not say ${JSON.stringify(fallStrikeText)} ` +
          `(it reads ${JSON.stringify(faceAbility(rewardWhipFace))})`
      );
    }

    // An agent that lists the set reads the fall strike in the field written for
    // it, so the word on the card and the field a caller reads are one answer.
    if (listCollection) {
      const whipEntry = (await listCollection.execute()).cards.find((card) => card.id === "whipthorn");
      if (whipEntry?.fallAbility !== fallStrikeText) {
        fail(
          `list-collection returns the Whipthorn with fallAbility ${JSON.stringify(whipEntry?.fallAbility ?? null)} ` +
            `instead of ${JSON.stringify(fallStrikeText)}`
        );
      }
    }

    // The trigger itself, through the engine the board runs on.
    if (!matchEngine) {
      fail("docs/match.js could not be imported, so the fall strike cannot be checked");
    } else {
      const fallDeck = ["sprout", "pebble-toad", "thornling", "sun-moth", "bramble-hound"];
      const turtleAt = (health) => ({ ...cardCatalog.CARD_BY_ID.get("mudback-turtle"), health, hasAttacked: false });
      const whipAt = (health) => ({ ...whipthorn, health, hasAttacked: false });

      // (1) A fall striking a card that is still standing: the player kills the
      // opponent's Whipthorn, and its dying blow lands on the player's front
      // card in exactly the words a turn's blow uses.
      const strikeBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      strikeBoard.player.table = [turtleAt(3)];
      strikeBoard.player.hand = [];
      strikeBoard.player.deck = [];
      strikeBoard.opponent.table = [whipAt(1)];
      strikeBoard.opponent.hand = [];
      strikeBoard.opponent.deck = [];
      const strikeLogBefore = strikeBoard.log.length;
      matchEngine.attack(strikeBoard, "mudback-turtle", "whipthorn");
      const strikeLines = strikeBoard.log.slice(strikeLogBefore);
      const struckTurtle = strikeBoard.player.table.find((card) => card.id === "mudback-turtle");
      if (!struckTurtle || struckTurtle.health !== 2) {
        fail(
          `a fallen Whipthorn left your front card at ${struckTurtle?.health ?? "(gone)"} health instead of 2 ` +
            `(3 less the ${fallStrikeAmount} its fall deals)`
        );
      }
      const expectedStrikeLine =
        `Opponent's Whipthorn deals ${fallStrikeAmount} to your Mudback Turtle — it has 2 health left.`;
      if (!strikeLines.includes(expectedStrikeLine)) {
        fail(
          `the log does not read a fallen Whipthorn's blow as a turn's blow does: expected ` +
            `${JSON.stringify(expectedStrikeLine)} among ${JSON.stringify(strikeLines)}`
        );
      }
      if (strikeBoard.over) {
        fail("a fall's blow at a card that survived ended the match");
      }

      // (2) A fall caused by a fall fires in turn, and the chain ends the match:
      // the player's turtle fells the opponent's Whipthorn, whose fall fells the
      // player's, whose fall reaches the opponent's last health. The blow that
      // ends the match is the last line, and the board is not still being played.
      const chainBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      chainBoard.player.table = [whipAt(1), turtleAt(5)];
      chainBoard.player.hand = [];
      chainBoard.player.deck = [];
      chainBoard.opponent.health = 1;
      chainBoard.opponent.table = [whipAt(1)];
      chainBoard.opponent.hand = [];
      chainBoard.opponent.deck = [];
      const chainLogBefore = chainBoard.log.length;
      matchEngine.attack(chainBoard, "mudback-turtle", "whipthorn");
      const chainLines = chainBoard.log.slice(chainLogBefore);
      if (chainBoard.player.table.some((card) => card.id === "whipthorn")) {
        fail("a fall's own blow left the second Whipthorn on the table, so the chain of falls stopped early");
      }
      if (!chainBoard.over || chainBoard.winner !== "player" || chainBoard.turn !== null) {
        fail(
          `a chain of falls that emptied the opponent's health left the match over=${chainBoard.over}, ` +
            `winner=${JSON.stringify(chainBoard.winner)}, turn=${JSON.stringify(chainBoard.turn)} — expected an ` +
            "ended match won by the player"
        );
      }
      const chainLastLine = chainLines[chainLines.length - 1] ?? "";
      if (!chainLastLine.endsWith("The opponent hero falls — you won.")) {
        fail(
          `the last line of a chain of falls is ${JSON.stringify(chainLastLine)} instead of the blow that ended ` +
            "the match"
        );
      }
      // The turtle's blow, the blow the first fallen Whipthorn landed, and the
      // blow the second one landed: three blows from one attack.
      const chainBlows = chainLines.filter((line) => /deals/.test(line)).length;
      if (chainBlows !== 3) {
        fail(`a chain of two falls logged ${chainBlows} blow(s) instead of the three the attack and the two falls dealt`);
      }

      // (3) A fall's blow reached through a sweeping card ends the match on the
      // same line a turn's blow would, and nothing is logged after it — so wiping
      // a table with a sweep is no longer a free move, and a board that answers
      // its own removal can win a match the sweep alone could not.
      const sweepBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      sweepBoard.player.table = [whipAt(1)];
      sweepBoard.player.hand = [{ ...cardCatalog.CARD_BY_ID.get("thorn-gale"), hasAttacked: false }];
      sweepBoard.player.deck = [];
      sweepBoard.player.energy = 6;
      sweepBoard.player.maxEnergy = 6;
      sweepBoard.opponent.health = 1;
      sweepBoard.opponent.table = [whipAt(1)];
      sweepBoard.opponent.hand = [];
      sweepBoard.opponent.deck = [];
      const sweepLogBefore = sweepBoard.log.length;
      matchEngine.playCard(sweepBoard, "thorn-gale");
      const sweepLines = sweepBoard.log.slice(sweepLogBefore);
      if (!sweepBoard.over || sweepBoard.winner !== "player" || sweepBoard.turn !== null) {
        fail(
          `a sweeping card that felled a Whipthorn left the match over=${sweepBoard.over}, ` +
            `winner=${JSON.stringify(sweepBoard.winner)}, turn=${JSON.stringify(sweepBoard.turn)} — expected the ` +
            "fallen Whipthorn's own blow to win it"
        );
      }
      const sweepLastLine = sweepLines[sweepLines.length - 1] ?? "";
      if (!sweepLastLine.endsWith("The opponent hero falls — you won.")) {
        fail(
          `the last line of a sweep that ended in a chain of falls is ${JSON.stringify(sweepLastLine)} instead ` +
            "of the blow that ended the match"
        );
      }

      // (4) A card with no fall ability still strikes nothing as it falls.
      const plainBoard = matchEngine.createMatch(fallDeck, { rng: () => 0 });
      plainBoard.player.table = [turtleAt(5)];
      plainBoard.player.hand = [];
      plainBoard.player.deck = [];
      plainBoard.opponent.table = [{ ...cardCatalog.CARD_BY_ID.get("pebble-toad"), health: 1, hasAttacked: false }];
      plainBoard.opponent.hand = [];
      plainBoard.opponent.deck = [];
      const plainStrikeBefore = plainBoard.log.length;
      matchEngine.attack(plainBoard, "mudback-turtle", "pebble-toad");
      const plainStrikeLines = plainBoard.log.slice(plainStrikeBefore);
      const untouchedTurtle = plainBoard.player.table.find((card) => card.id === "mudback-turtle");
      if (untouchedTurtle?.health !== 5) {
        fail(
          `killing a card with no fall ability struck the killer's table: your Mudback Turtle has ` +
            `${untouchedTurtle?.health ?? "(none)"} health instead of 5`
        );
      }
      if (plainStrikeLines.filter((line) => /deals/.test(line)).length !== 1) {
        fail(
          `killing a card with no fall ability logged ${plainStrikeLines.filter((line) => /deals/.test(line)).length} ` +
            "blow(s) instead of the one the attack dealt"
        );
      }
    }
  }

  // --- A first win is announced where the win happens -----------------------

  // The result screen is where a win lands, so that is where a first against an
  // opponent is said, and where the opponent's record is seen to move. The
  // record against the last opponent is cleared in the save first and a
  // controlled board is then won in one blow, so this is a first win whatever
  // earlier checks happened to play.
  const firstWinOpponent = (cardCatalog.OPPONENTS ?? [])[cardCatalog.OPPONENTS.length - 1];
  const firstWinSave = JSON.parse(window.localStorage.getItem(collection.STORAGE_KEY) ?? "null");
  const firstWinBoard = {
    id: "check-first-win",
    opponentId: firstWinOpponent?.id,
    opponentName: firstWinOpponent?.name,
    turn: "player",
    over: false,
    winner: null,
    outcome: null,
    recorded: false,
    // One striker with more than enough attack, and an opponent hero on its last
    // health with an empty table: the next blow ends the match, so it is won.
    player: {
      health: 20,
      energy: 5,
      maxEnergy: 5,
      turns: 0,
      hand: [],
      table: [{ id: "glowcap", health: 4, hasAttacked: false }],
      deck: [],
    },
    opponent: { health: 1, energy: 1, maxEnergy: 1, turns: 0, hand: [], table: [], deck: [] },
    log: ["A match set up so the next blow is a first win."],
  };

  if (!firstWinOpponent || !firstWinSave) {
    fail(
      "the save could not be read to check what a first win says, so a first win against an opponent " +
        "is left unverified"
    );
  } else if (collection.saveMatch(firstWinBoard)) {
    // Let the opponent stand unbeaten, so the win about to happen is its first.
    if (firstWinSave.opponents?.[firstWinOpponent.id]) {
      delete firstWinSave.opponents[firstWinOpponent.id];
      window.localStorage.setItem(collection.STORAGE_KEY, JSON.stringify(firstWinSave));
    }
    game.refreshSavedMatch();
    game.continueMatch();
    game.attackMatch("glowcap", "hero");

    const afterFirstWin = game.readState();
    if (afterFirstWin.result?.outcome !== "win" || afterFirstWin.result?.firstWin !== true) {
      fail(
        `a win against "${firstWinOpponent.id}" with no win recorded against it before read ` +
          `${JSON.stringify(afterFirstWin.result)}, so a first win is not told apart from a repeat`
      );
    }
    const winLine = document.getElementById("result-first-win");
    if (!winLine || winLine.hidden || !textOf(winLine).includes(firstWinOpponent.name)) {
      fail(
        `a first win against "${firstWinOpponent.name}" is not announced on the result: it reads ` +
          `"${textOf(winLine)}" (hidden ${winLine?.hidden})`
      );
    }

    // The card the win added is marked where the set is listed, so it is found
    // again once the result is left behind — with a word a screen reader reads,
    // not only a look. A win with nothing new left to earn marks nothing.
    const expectedMark = afterFirstWin.result?.setComplete ? null : (afterFirstWin.result?.awarded?.id ?? null);
    const markedRows = markedNewlyCollected();
    if (afterFirstWin.newlyCollected !== expectedMark) {
      fail(
        `a win left the state reporting newlyCollected ${JSON.stringify(afterFirstWin.newlyCollected)} instead of ` +
          `${JSON.stringify(expectedMark)}`
      );
    }
    if (expectedMark === null) {
      if (markedRows.length) {
        fail(`a win with nothing new to earn marked ${markedRows.join(", ")} as newly collected`);
      }
    } else if (markedRows.length !== 1 || markedRows[0] !== expectedMark) {
      fail(
        `a win added "${afterFirstWin.result?.awarded?.name}" but the collection marks ${JSON.stringify(markedRows)} ` +
          `as newly collected instead of just "${expectedMark}"`
      );
    } else {
      const markText = textOf(
        document.querySelector(`#collection-list [data-card-id="${expectedMark}"] .newly-collected-note`)
      );
      if (!markText.toLowerCase().includes("new")) {
        fail(
          `the card a win added is marked "${markText || "(nothing)"}" instead of in words a screen reader reads`
        );
      }

      // The mark belongs to the win that earned it: dealing the next match clears
      // it, so a card is never still advertised as newly collected a match later.
      game.startMatch();
      const stillMarked = markedNewlyCollected();
      if (game.readState().newlyCollected !== null || stillMarked.length) {
        fail(
          "starting another match left the last win's card marked as newly collected: the collection still marks " +
            `${JSON.stringify(stillMarked)} while the state says ` +
            `${JSON.stringify(game.readState().newlyCollected)}`
        );
      }
    }

    const afterRecord = afterFirstWin.opponents.find((opponent) => opponent.id === firstWinOpponent.id)?.record;
    if (afterRecord?.wins !== 1 || afterRecord?.matches !== 1 || !afterRecord.beaten) {
      fail(
        `the first win against "${firstWinOpponent.id}" left its record ${JSON.stringify(afterRecord)} over ` +
          "instead of one win in one match and marked beaten"
      );
    }
    const afterOption = document.querySelector(
      `#opponent-options [data-opponent-id="${firstWinOpponent.id}"] .opponent-record`
    );
    const expectedAfterWin = game.opponentRecordText(afterRecord?.wins ?? 0, afterRecord?.matches ?? 0);
    if (!afterOption || textOf(afterOption) !== expectedAfterWin) {
      fail(
        `after a first win the picker's record for "${firstWinOpponent.name}" reads ` +
          `"${textOf(afterOption)}" instead of "${expectedAfterWin}"`
      );
    }
    if (!afterOption?.classList.contains("opponent-record-beaten")) {
      fail(`the picker does not mark "${firstWinOpponent.name}" beaten after it was beaten`);
    }
  } else {
    fail("a controlled match could not be saved, so what a first win says cannot be checked");
  }

  // Last, because it opens the page a second time in a narrow frame: the build
  // runs this suite at a desktop width, where the phone layout is inert.
  problems.push(...(await collectionCardPhoneProblems()));

  return problems;
}

/**
 * The collection at a phone's width, measured in a real frame.
 *
 * The build opens the page at a desktop width, where the `max-width: 719px`
 * rules in styles.css never apply, so measuring the live page would silently
 * pass whatever the phone draws. This loads index.html again in a narrow,
 * off-screen iframe and measures every collection card: only the picture may
 * sit in the picture's column, and nothing may run past the frame's right edge.
 * The owned cards that carry a when-played ability are exactly the ones the
 * picture's fixed row span used to break, so the frame lists the real set rather
 * than a fixture.
 */
async function collectionCardPhoneProblems() {
  const problems = [];
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText =
    "position: fixed; left: -10000px; top: 0; width: 390px; height: 900px; border: 0;";
  frame.src = new URL("./index.html", import.meta.url).href;

  const waitFor = (test, timeoutMs) =>
    new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        let ok = false;
        try {
          ok = test();
        } catch {
          ok = false;
        }
        if (ok || Date.now() - started > timeoutMs) resolve(ok);
        else setTimeout(poll, 25);
      };
      poll();
    });

  try {
    const whenLoaded = new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      frame.addEventListener("load", done, { once: true });
      setTimeout(done, 2000);
    });
    document.body.append(frame);
    await whenLoaded;

    const listAppeared = await waitFor(
      () => frame.contentDocument?.querySelector("#collection-list > li"),
      1000
    );
    if (!listAppeared) {
      return [
        "the page was opened in a 390px frame but never listed a collection card, so a phone's card layout could not be measured",
      ];
    }

    const doc = frame.contentDocument;
    doc.getElementById("action-collection")?.click();
    await waitFor(() => !doc.getElementById("screen-collection")?.hidden, 400);

    for (const width of [390, 280]) {
      frame.style.width = `${width}px`;
      // Two frames so the new width is laid out before it is read.
      await new Promise((resolve) =>
        frame.contentWindow.requestAnimationFrame(() =>
          frame.contentWindow.requestAnimationFrame(resolve)
        )
      );
      problems.push(...collectionCardProblemsAt(doc, frame.contentWindow.innerWidth, width));
    }
  } finally {
    frame.remove();
  }

  return problems;
}

/**
 * What is wrong with the collection's layout at one frame width: a card part
 * that overlaps the picture's column, or a part that runs past the frame.
 */
function collectionCardProblemsAt(doc, frameWidth, width) {
  const problems = [];
  const list = doc.getElementById("collection-list");
  if (!list) return [`the collection list is missing at a ${width}px window`];

  const partName = (element) =>
    element.classList.contains("card-art")
      ? "picture"
      : element.className.split(" ").find(Boolean) || element.tagName.toLowerCase();

  const measure = (element) => element.getBoundingClientRect();
  const horizontalOverlap = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5;
  const verticalOverlap = (a, b) => a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5;

  const rows = [...list.querySelectorAll(":scope > li")];
  for (const row of rows) {
    const cardId = row.dataset.cardId ?? "(unknown)";
    const art = row.querySelector(":scope > .card-art");
    const artRect = art ? measure(art) : null;

    if (artRect) {
      const others = [...row.children]
        .filter((part) => part !== art)
        .map((part) => ({ part, rect: measure(part) }));
      // A card is drawn beside its picture when any part sits to the picture's
      // right on the same band; a card that has fallen back to one column for a
      // narrow window stacks every part below it instead.
      const beside = others.some(({ rect }) => rect.left >= artRect.right - 0.5);

      for (const { part, rect } of others) {
        const inPictureColumn = horizontalOverlap(rect, artRect);
        const overPicture = inPictureColumn && verticalOverlap(rect, artRect);
        if (overPicture || (beside && inPictureColumn)) {
          problems.push(
            `the "${cardId}" card lays ${partName(part)} in its picture's column at a ${width}px window`
          );
        }
      }
    }

    // Every box the row draws, down to each of the three numbers, so a part
    // that overflows its own column is caught rather than hidden inside it.
    for (const element of [row, ...row.querySelectorAll("*")]) {
      const rect = measure(element);
      if (rect.right > frameWidth + 1) {
        const over = Math.round(rect.right - frameWidth);
        problems.push(
          `the "${cardId}" card's ${partName(element)} runs ${over}px past the right edge at a ${width}px window`
        );
      }
    }
  }

  const listRect = measure(list);
  if (listRect.right > frameWidth + 1) {
    const over = Math.round(listRect.right - frameWidth);
    problems.push(`the collection list runs ${over}px past the right edge at a ${width}px window`);
  }

  return problems;
}
