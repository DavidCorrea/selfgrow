/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

/**
 * @returns {Array<import("./webmcp.js").ToolDescriptor>}
 */
export function tools() {
  return [
    {
      name: "read-state",
      description: "Returns the current game state the page is showing to the "
        + "visitor: resource counts, unlocked features, and any active progress. "
        + "Initially returns an empty state — { resource: 0 } — until the game "
        + "engine ships.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return { resource: 0 };
      },
    },
  ];
}