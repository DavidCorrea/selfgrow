/**
 * selfgrow as an agent meets it: the state a visitor can read, and the moves a
 * visitor can make. There is nothing here a person cannot also see or press, so
 * an agent plays the game through the same surface, at the same pace.
 */

import { readState, showScreen } from "./app.js";

// The screens the page has. The list is the tool's own schema as well as the
// page's, so a caller cannot ask for a screen that does not exist.
const SCREENS = ["home", "collection", "play"];

export function tools() {
  return [
    {
      name: "get-state",
      title: "Read what the page shows",
      description:
        "Returns everything the page shows a visitor right now: which screen is open (home, collection or play), how many cards you own, how many cards your deck holds, and the actions you can take from here. Ask it first to see where you stand, and again after every move to see what changed.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readState();
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
