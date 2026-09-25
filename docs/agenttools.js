/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState, gatherWood } from "./engine.js";

const GOAL_WOOD = 10;

/**
 * Augment a raw state snapshot with goal info.
 */
function withGoal(s) {
  return {
    wood: s.wood,
    rate: s.rate,
    timestamp: s.timestamp,
    goal: {
      target: GOAL_WOOD,
      current: Math.min(s.wood, GOAL_WOOD),
      reached: s.wood >= GOAL_WOOD,
    },
  };
}

/**
 * @returns {Array<import("./webmcp.js").ToolDescriptor>}
 */
export function tools() {
  return [
    {
      name: "read-state",
      description: "Returns the current game state the page is showing to the "
        + "visitor: wood count, accumulation rate, timestamp of the last "
        + "tick or save, and the current goal progress.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return withGoal(getState());
      },
    },
    {
      name: "perform-action",
      description: "Performs a named action the visitor could take from the "
        + "page, and returns the state afterwards. Supported actions: "
        + '"gather" — instantly adds +1 wood.',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: 'The action to perform. Currently supported: "gather".',
          },
        },
        required: ["action"],
      },
      annotations: { readOnlyHint: false },
      example: { action: "gather" },
      async execute({ action }) {
        if (action === "gather") {
          return withGoal(gatherWood());
        }
        throw new Error(`Unknown action "${action}". Supported: gather`);
      },
    },
  ];
}