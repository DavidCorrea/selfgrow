/**
 * agenttools.js — what an agent can do with this garden.
 *
 * The garden already maintains a state panel in the DOM, because a canvas is
 * opaque to a screen reader and to the build's app review alike. An agent is the
 * third consumer of that same answer, so the tools read the panel rather than
 * the scene: it is the surface the product promises to keep meaningful, and a
 * tool built on it cannot drift from what a visitor is told.
 *
 * There are no write tools yet, and that is a finding rather than an omission.
 * The garden is ambient — a visitor watches it, orbits the camera, and comes
 * back later. Nothing a person can do to it changes state that anything can read
 * back, so there is nothing honest to expose. Giving an agent powers the UI does
 * not have would be a second interface to maintain, and it would drift from the
 * first one. If the garden grows something to do, a tool for it ships in the
 * same change.
 */

/* Each field of the state panel, and the element that carries it. The panel is
 * the contract here: an id that disappears is a broken tool, which is exactly
 * what the self-checks assert. */
const STATE_FIELDS = {
  season: "season-display",
  timeOfDay: "time-display",
  weather: "weather-display",
  growing: "growing-description",
  plot: "plot-description",
  acknowledgment: "garden-state-acknowledgment",
  visit: "visit-display",
};

/**
 * Read the garden's state panel into a plain object.
 *
 * A missing element reports null rather than an empty string, so a caller can
 * tell "the garden has nothing to say about this" from "this part of the page
 * is gone".
 */
export function readGardenState() {
  const state = {};
  for (const [field, elementId] of Object.entries(STATE_FIELDS)) {
    const element = document.getElementById(elementId);
    state[field] = element ? element.textContent.trim() : null;
  }
  return state;
}

export function tools() {
  return [
    {
      name: "get-garden-state",
      title: "Get garden state",
      description:
        "Describes the garden as it is right now: the current season, the time "
        + "of day, the weather, what is growing in the plot, and the garden's "
        + "most recent acknowledgment of the visitor, and how many times this "
        + "visitor has been here before. The garden changes slowly "
        + "and on its own — seasons turn over about twelve minutes and the day "
        + "over about three — so calling this again after a wait returns "
        + "something different.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readGardenState();
      },
    },
  ];
}
