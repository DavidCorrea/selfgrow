/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState, gatherWood, craftUpgrade, UPGRADE_COST } from "./engine.js";

const GOAL_WOOD = 10;

/**
 * Augment a raw state snapshot with goal and upgrade info.
 */
function withGoal(s) {
  const upgradeAvailable = s.wood >= UPGRADE_COST;
  const reachedFirstGoal = s.wood >= GOAL_WOOD;
  return {
    wood: s.wood,
    rate: s.rate,
    timestamp: s.timestamp,
    upgradeLevel: s.upgradeLevel,
    offlineSummaryVisible: !document.getElementById('offline-summary')?.hidden,
    firstGoal: {
      target: GOAL_WOOD,
      current: Math.min(s.wood, GOAL_WOOD),
      reached: s.wood >= GOAL_WOOD,
    },
    nextGoal: reachedFirstGoal
      ? {
          description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
          type: "upgrade",
          cost: UPGRADE_COST,
          progressToNext: s.wood % UPGRADE_COST,
          upgradeAvailable: upgradeAvailable,
        }
      : {
          description: "Gather " + GOAL_WOOD + " wood",
          type: "first-goal",
          target: GOAL_WOOD,
          progress: s.wood,
          reached: false,
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
        + "visitor: wood count, accumulation rate, number of upgrades crafted, "
        + "timestamp, whether the offline-summary overlay is currently visible, "
        + "and the current goal (first goal or upgrade goal).",
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
        + '"gather" — instantly adds +1 wood; '
        + '"sharpen" — consumes ' + UPGRADE_COST + ' wood to permanently increase the wood accumulation rate; '
        + '"dismiss-offline" — dismisses the offline-summary overlay if visible.',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: 'The action to perform. Supported: "gather", "sharpen", "dismiss-offline".',
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
        if (action === "sharpen") {
          const result = craftUpgrade();
          return withGoal(result.state);
        }
        if (action === "dismiss-offline") {
          const overlay = document.getElementById("offline-summary");
          if (overlay && !overlay.hidden) {
            overlay.hidden = true;
            overlay.style.display = ""; // clear inline display override
            const btnGather = document.getElementById("btn-gather");
            if (btnGather) btnGather.disabled = false;
            document.body.style.pointerEvents = "";
            overlay.style.pointerEvents = "";
          }
          return withGoal(getState());
        }
        throw new Error('Unknown action "' + action + '". Supported: gather, sharpen, dismiss-offline');
      },
    },
  ];
}