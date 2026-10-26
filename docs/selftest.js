/**
 * Check that selfgrow still opens on a home screen that says what the game is
 * and where the player stands — and that an agent reads and drives that same
 * surface, rather than a second one nobody can see.
 *
 * Runs on the real page, in the real browser. Returns plain-language failures,
 * empty when everything holds.
 */

const SCREENS = ["home", "collection", "play"];

export async function checks() {
  const problems = [];
  const fail = (message) => problems.push(message);
  const textOf = (element) => (element ? element.textContent.replace(/\s+/g, " ").trim() : "");
  const screen = (name) => document.getElementById(`screen-${name}`);
  const openScreens = () => SCREENS.filter((name) => screen(name) && !screen(name).hidden);
  const buttonsOn = (name) => (screen(name) ? [...screen(name).querySelectorAll("button")] : []);
  const buttonNamed = (name, label) => buttonsOn(name).find((button) => textOf(button) === label);

  let game;
  try {
    game = await import("./app.js");
  } catch (e) {
    return [`docs/app.js could not be imported, so nothing about the page's state can be checked — ${e.message}`];
  }

  const state = game.readState();

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

  if (state.cardsOwned !== 0 || state.deckSize !== 0) {
    fail(
      `a first visit owns nothing, but the page reports ${state.cardsOwned} card(s) owned ` +
        `and ${state.deckSize} in the deck — counts are shown from real state, never invented`
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
