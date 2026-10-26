/**
 * selfgrow — the page's state, and the one place it is written onto the page.
 *
 * `state` is the whole truth about what is on screen: which screen is open, and
 * where the player stands. `render()` writes it into the page's text and
 * `readState()` hands the same fields back, so a screen reader, the Playtester
 * and an agent's tool all read one surface — whatever the page says is what a
 * tool returns, and what a tool does is what the page shows.
 */

// The screens the page has, and the word each is announced by. A screen name is
// also the value an agent passes to the show-screen tool.
const SCREEN_LABELS = {
  home: "Home",
  collection: "Collection",
  play: "Play",
};

const state = {
  screen: "home",
  cardsOwned: 0,
  deckSize: 0,
};

const screens = new Map(
  Object.keys(SCREEN_LABELS).map((name) => [name, document.getElementById(`screen-${name}`)])
);

// Every place on the page a count is printed, wherever the card prints it.
const countFields = {
  cardsOwned: [...document.querySelectorAll('[data-field="cardsOwned"]')],
  deckSize: [...document.querySelectorAll('[data-field="deckSize"]')],
};

const screenStatus = document.getElementById("screen-status");

/** Write the state onto the page: the open screen, and every count it belongs to. */
function render() {
  for (const [name, section] of screens) {
    const isOpen = name === state.screen;
    section.hidden = !isOpen;
    if (isOpen) section.setAttribute("aria-current", "true");
    else section.removeAttribute("aria-current");
  }

  for (const [field, elements] of Object.entries(countFields)) {
    for (const element of elements) element.textContent = String(state[field]);
  }

  screenStatus.textContent = `${SCREEN_LABELS[state.screen]} screen`;
}

/**
 * Everything the page currently shows: the screen that is open, how many cards
 * the player owns, how many are in the deck, and the actions they can take from
 * here. This is what the get-state tool returns.
 */
export function readState() {
  const actions = [...screens.get(state.screen).querySelectorAll("button")].map((button) =>
    button.textContent.trim()
  );

  return {
    screen: state.screen,
    cardsOwned: state.cardsOwned,
    deckSize: state.deckSize,
    actions,
  };
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
