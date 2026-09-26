/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState, gatherWood, craftUpgrade, gatherStone, buildWall, consumeOfflineWoodGained, UPGRADE_COST, WALL_COST, STONE_GATHER_AMOUNT } from "./engine.js";

const GOAL_WOOD = 10;
const GOAL_STONE = 5;

/**
 * Read the offline gain from the DOM.
 * Returns 0 when no gain is pending (overlay hidden).
 */
function readOfflineWoodGained() {
  const overlay = document.getElementById('offline-summary');
  if (!overlay || overlay.hidden) return 0;
  const el = document.getElementById('offline-wood-amount');
  if (!el) return 0;
  const text = el.textContent.trim();
  const num = parseFloat(text);
  return isNaN(num) ? 0 : Math.max(0, num);
}

function readOfflineStoneGained() {
  const overlay = document.getElementById('offline-summary');
  if (!overlay || overlay.hidden) return 0;
  const el = document.getElementById('offline-stone-amount');
  if (!el) return 0;
  const text = el.textContent.trim();
  const num = parseFloat(text);
  return isNaN(num) ? 0 : Math.max(0, num);
}

/**
 * Compute stone rate from total wood earned.
 */
function computeStoneRate(totalWoodEarned) {
  return 0.05 + totalWoodEarned * 0.001;
}

/**
 * Determine the current goal phase based on state.
 */
function determineGoal(s) {
  const reachedFirstGoal = s.wood >= GOAL_WOOD;
  const doneFirstSharpen = s.upgradeLevel >= 1;
  const stoneUnlocked = s.stoneUnlocked;

  if (!reachedFirstGoal) {
    return {
      description: "Gather " + GOAL_WOOD + " wood",
      type: "first-goal",
      target: GOAL_WOOD,
      progress: s.wood,
      reached: false,
    };
  }

  if (reachedFirstGoal && !doneFirstSharpen) {
    return {
      description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
      type: "upgrade",
      cost: UPGRADE_COST,
      progressToNext: s.wood % UPGRADE_COST,
      upgradeAvailable: s.wood >= UPGRADE_COST,
    };
  }

  // Stone is now unlocked
  if (!(s.wallLevel > 0) && s.stone < GOAL_STONE) {
    return {
      description: "Gather " + GOAL_STONE + " stone",
      type: "stone-goal",
      target: GOAL_STONE,
      progress: s.stone,
      reached: false,
    };
  }

  if (s.stone >= GOAL_STONE && !(s.wallLevel > 0)) {
    return {
      description: "Build a Wall (" + WALL_COST + " stone)",
      type: "build-wall-goal",
      cost: WALL_COST,
      progressToNext: s.stone % WALL_COST,
      wallAvailable: s.stone >= WALL_COST,
    };
  }

  // Wall built — show dual-goal until both wood and stone reach thresholds
  // Once both thresholds are met, transition to sharpen cycle
  const dualWoodTarget = 10;
  const dualStoneTarget = 5;
  if (s.wood < dualWoodTarget || s.stone < dualStoneTarget) {
    return {
      description: "Forge: " + dualWoodTarget + " wood + " + dualStoneTarget + " stone",
      type: "dual-goal",
      resources: [
        { name: "Wood", current: Math.min(s.wood, dualWoodTarget), target: dualWoodTarget },
        { name: "Stone", current: Math.min(s.stone, dualStoneTarget), target: dualStoneTarget },
      ],
      reached: false,
    };
  }

  // Dual-goal completed — back to sharpening cycle
  return {
    description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
    type: "upgrade",
    cost: UPGRADE_COST,
    progressToNext: s.wood % UPGRADE_COST,
    upgradeAvailable: s.wood >= UPGRADE_COST,
  };
}

/**
 * Augment a raw state snapshot with goal, upgrade, and stone info.
 */
function withGoal(s) {
  const upgradeAvailable = s.wood >= UPGRADE_COST;
  const reachedFirstGoal = s.wood >= GOAL_WOOD;
  const canGatherStone = s.stoneUnlocked;
  const wallAvailable = s.stoneUnlocked && s.stone >= WALL_COST;
  const stoneRate = s.stoneUnlocked ? computeStoneRate(s.totalWoodEarned) : 0;
  const clickPower = 1 + s.wallLevel;

  return {
    wood: s.wood,
    rate: s.rate,
    totalWoodEarned: s.totalWoodEarned,
    timestamp: s.timestamp,
    upgradeLevel: s.upgradeLevel,
    stone: s.stone,
    stoneRate: stoneRate,
    stoneUnlocked: s.stoneUnlocked,
    wallLevel: s.wallLevel,
    clickPower: clickPower,
    wallBuilt: s.wallLevel > 0,
    offlineSummaryVisible: !document.getElementById('offline-summary')?.hidden,
    offlineWoodGained: readOfflineWoodGained(),
    offlineStoneGained: readOfflineStoneGained(),
    firstGoal: {
      target: GOAL_WOOD,
      current: Math.min(s.wood, GOAL_WOOD),
      reached: s.wood >= GOAL_WOOD,
    },
    nextGoal: determineGoal(s),
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
        + "stone count, stone accumulation rate, wall level, click power, "
        + "whether stone is unlocked, timestamp, whether the offline-summary "
        + "overlay is currently visible, how much wood and stone were gained "
        + "while away (offlineWoodGained / offlineStoneGained), and the current "
        + "goal (first goal, upgrade goal, stone goal, or build-wall goal).",
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
        + '"gather" — instantly adds +1 wood (or more based on wall level); '
        + '"sharpen" — consumes ' + UPGRADE_COST + ' wood to permanently increase the wood accumulation rate; '
        + '"gather-stone" — instantly adds +' + STONE_GATHER_AMOUNT + ' stone (only available after stone is unlocked); '
        + '"build-wall" — consumes ' + WALL_COST + ' stone to permanently increase click power for wood; '
        + '"dismiss-offline" — dismisses the offline-summary overlay if visible.',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: 'The action to perform. Supported: "gather", "sharpen", "gather-stone", "build-wall", "dismiss-offline".',
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
        if (action === "gather-stone") {
          const result = gatherStone();
          return withGoal(result.state);
        }
        if (action === "build-wall") {
          const result = buildWall();
          return withGoal(result.state);
        }
        if (action === "dismiss-offline") {
          const overlay = document.getElementById("offline-summary");
          if (overlay && !overlay.hidden) {
            overlay.hidden = true;
            const btnGather = document.getElementById("btn-gather");
            if (btnGather) btnGather.disabled = false;
            document.body.style.pointerEvents = "";
          }
          return withGoal(getState());
        }
        throw new Error('Unknown action "' + action + '". Supported: gather, sharpen, gather-stone, build-wall, dismiss-offline');
      },
    },
  ];
}