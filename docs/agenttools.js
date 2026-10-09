/**
 * The product's capabilities, as tools an agent can invoke.
 *
 * Derived from what the page shows a visitor and what it lets them do — nothing
 * more. `get-state` returns every field the page displays; `plant-seed` is the
 * one action the page offers, and it returns the same fields afterwards so the
 * caller can see what it changed.
 */

import { getState, plantSeed } from "./main.js";

export function tools() {
  return [
    {
      name: "get-state",
      title: "Read the garden",
      description:
        "Returns everything the page shows a visitor right now: how many seeds " +
        "have been planted, how many sprouts the plot holds, and the plot's " +
        "capacity. Ask before acting so you know what the visitor sees.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return getState();
      },
    },
    {
      name: "plant-seed",
      title: "Plant a seed",
      description:
        "Plants one seed in the garden, raising the seed count by exactly one " +
        "and growing a sprout when the plot still has room. Returns the garden's " +
        "state afterwards so the caller can see the count it changed. Use it in " +
        "place of pressing the page's Plant a seed button.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, consequentialHint: false },
      example: {},
      async execute() {
        plantSeed();
        return getState();
      },
    },
  ];
}