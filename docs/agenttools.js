/**
 * selfgrow as an agent meets it: the state a visitor can read, and the moves a
 * visitor can make. There is nothing here a person cannot also see or press, so
 * an agent plays the game through the same surface, at the same pace.
 */

import { addCardToDeck, readCollection, readState, removeCardFromDeck, showScreen } from "./app.js";

// The screens the page has. The list is the tool's own schema as well as the
// page's, so a caller cannot ask for a screen that does not exist.
const SCREENS = ["home", "collection", "play"];

export function tools() {
  return [
    {
      name: "get-state",
      title: "Read what the page shows",
      description:
        "Returns everything the page shows a visitor right now: which screen is open (home, collection or play), how many cards you own, how many of them are different, the deck — how many cards it holds, the most it may hold, the fewest a match needs, and each card in it — whether progress is saved for next time, and the actions you can take from here. Ask it first to see where you stand, and again after every move to see what changed.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readState();
      },
    },
    {
      name: "list-collection",
      title: "List every card you own",
      description:
        "Returns every card in the player's collection, one entry per card with its name, cost to play, attack, health and how many copies are owned, together with the total number of cards and how many are different. Ask it when the caller needs the actual cards, rather than only the counts get-state reports.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return readCollection();
      },
    },
    {
      name: "add-card-to-deck",
      title: "Add an owned card to your deck",
      description:
        "Adds one card you already own to your deck, exactly as pressing its \"Add … to deck\" button on the Collection screen does. Refused, with the reason, when the card is not owned, is already in the deck, or the deck is already at its limit of ten. Returns the state afterwards so you can see the deck it changed.",
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
      name: "remove-card-to-deck",
      title: "Remove a card from your deck",
      description:
        "Removes one card from your deck and returns it to the collection, exactly as pressing its \"Remove … from deck\" button on the Collection screen does. Refused, with the reason, when the card is not in the deck. Returns the state afterwards so you can see the deck it changed.",
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
