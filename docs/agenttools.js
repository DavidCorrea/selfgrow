/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState } from "./engine.js";

/**
 * @returns {Array<import("./webmcp.js").ToolDescriptor>}
 */
export function tools() {
  return [
    {
      name: "read-state",
      description: "Returns the current game state the page is showing to the "
        + "visitor: wood count, accumulation rate, and the timestamp of the "
        + "last tick or save.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        const s = getState();
        return {
          wood: s.wood,
          rate: s.rate,
          timestamp: s.timestamp,
        };
      },
    },
  ];
}