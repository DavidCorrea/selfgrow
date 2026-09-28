/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState, gatherWood, craftUpgrade, gatherStone, buildWall, forgeTool, sendExpedition, consumeOfflineWoodGained, formatElapsed, sharpenAvailable, displayAmount, exportSave, importSave, FIRST_GOAL_WOOD, UPGRADE_COST, WALL_COST, STONE_GATHER_AMOUNT, FORGE_CLICK_POWER_BONUS, EXPEDITION_WOOD_COST_BASE, EXPEDITION_STONE_COST_BASE } from "./engine.js";

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
 * Read the absence duration shown in the welcome-back panel.
 * Returns null when no panel is showing.
 */
function readOfflineElapsed() {
  const overlay = document.getElementById('offline-summary');
  if (!overlay || overlay.hidden) return null;
  const el = document.getElementById('offline-elapsed');
  if (!el) return null;
  const text = el.textContent.trim();
  return text ? text : null;
}

/**
 * Read the away discovery named in the welcome-back panel, with the wood/s
 * bonus it granted. Returns null when no panel is showing or it found nothing
 * this return. The bonus is parsed from the panel's own bonus line, so the
 * number an agent sees is exactly the one the visitor is reading; when the
 * find granted no bonus the panel shows no line and the bonus is null.
 *
 * @returns {{ name: string, bonus: number|null, permanent: boolean }|null}
 */
function readOfflineDiscovery() {
  const overlay = document.getElementById('offline-summary');
  if (!overlay || overlay.hidden) return null;
  const line = document.getElementById('offline-discovery-line');
  if (!line || line.hidden) return null;
  const nameEl = document.getElementById('offline-discovery-name');
  const name = nameEl ? nameEl.textContent.trim() : '';
  if (!name) return null;

  const bonusEl = document.getElementById('offline-discovery-bonus');
  const showsBonus = Boolean(bonusEl && !bonusEl.hidden);
  const match = showsBonus ? bonusEl.textContent.match(/\+(\d+(?:\.\d+)?)\s*wood\/s/) : null;
  return { name, bonus: match ? Number(match[1]) : null, permanent: showsBonus };
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
  const reachedFirstGoal = s.wood >= FIRST_GOAL_WOOD;
  const doneFirstSharpen = s.upgradeLevel >= 1;
  const stoneUnlocked = s.stoneUnlocked;

  if (!reachedFirstGoal) {
    return {
      description: "Gather " + FIRST_GOAL_WOOD + " wood",
      type: "first-goal",
      target: FIRST_GOAL_WOOD,
      progress: displayAmount(s.wood),
      reached: false,
    };
  }

  if (reachedFirstGoal && !doneFirstSharpen) {
    return {
      description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
      type: "upgrade",
      cost: UPGRADE_COST,
      progressToNext: displayAmount(Math.min(s.wood, UPGRADE_COST)),
      upgradeAvailable: sharpenAvailable(s),
    };
  }

  // Stone is now unlocked
  if (!(s.wallLevel > 0) && s.stone < GOAL_STONE) {
    return {
      description: "Gather " + GOAL_STONE + " stone",
      type: "stone-goal",
      target: GOAL_STONE,
      progress: displayAmount(s.stone),
      reached: false,
    };
  }

  if (s.stone >= GOAL_STONE && !(s.wallLevel > 0)) {
    return {
      description: "Build a Wall (" + WALL_COST + " stone)",
      type: "build-wall-goal",
      cost: WALL_COST,
      progressToNext: displayAmount(Math.min(s.stone, WALL_COST)),
      wallAvailable: s.stone >= WALL_COST,
    };
  }

  // Wall built — show forge goal or expedition goal (once forge level >= 5)
  if (s.wallLevel > 0) {
    if (s.forgeLevel >= 5) {
      return {
        description: "Send scouts on expedition \u2014 need " + s.expeditionWoodCost + " wood and " + s.expeditionStoneCost + " stone",
        type: "expedition-goal",
        expeditionLevel: s.expeditionLevel,
        resources: [
          { name: "Wood", current: displayAmount(Math.min(s.wood, s.expeditionWoodCost)), target: s.expeditionWoodCost },
          { name: "Stone", current: displayAmount(Math.min(s.stone, s.expeditionStoneCost)), target: s.expeditionStoneCost },
        ],
        canSendExpedition: s.wood >= s.expeditionWoodCost && s.stone >= s.expeditionStoneCost,
      };
    }
    return {
      description: "Forge a tool \u2014 need " + s.forgeWoodCost + " wood and " + s.forgeStoneCost + " stone",
      type: "forge-goal",
      forgeLevel: s.forgeLevel,
      resources: [
        { name: "Wood", current: displayAmount(Math.min(s.wood, s.forgeWoodCost)), target: s.forgeWoodCost },
        { name: "Stone", current: displayAmount(Math.min(s.stone, s.forgeStoneCost)), target: s.forgeStoneCost },
      ],
      canForge: s.wood >= s.forgeWoodCost && s.stone >= s.forgeStoneCost,
    };
  }

  // Fallback — sharpen cycle
  return {
    description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
    type: "upgrade",
    cost: UPGRADE_COST,
    progressToNext: displayAmount(Math.min(s.wood, UPGRADE_COST)),
    upgradeAvailable: sharpenAvailable(s),
  };
}

/**
 * Augment a raw state snapshot with goal, upgrade, and stone info.
 */
function withGoal(s) {
  const upgradeAvailable = sharpenAvailable(s);
  const reachedFirstGoal = s.wood >= FIRST_GOAL_WOOD;
  const canGatherStone = s.stoneUnlocked;
  const wallAvailable = s.stoneUnlocked && s.stone >= WALL_COST;
  const stoneRate = s.stoneUnlocked ? computeStoneRate(s.totalWoodEarned) : 0;
  const clickPower = 1 + s.wallLevel * 1 + s.forgeLevel * FORGE_CLICK_POWER_BONUS;

  return {
    wood: s.wood,
    rate: s.rate,
    totalWoodEarned: s.totalWoodEarned,
    totalStoneEarned: s.totalStoneEarned,
    timestamp: s.timestamp,
    firstTimestamp: s.firstTimestamp,
    elapsed: s.firstTimestamp ? formatElapsed(Date.now() - new Date(s.firstTimestamp).getTime()) : '\u2014',
    upgradeLevel: s.upgradeLevel,
    stone: s.stone,
    stoneRate: stoneRate,
    stoneUnlocked: s.stoneUnlocked,
    discovery: s.discovery || null,
    wallLevel: s.wallLevel,
    forgeLevel: s.forgeLevel,
    forgeWoodCost: s.forgeWoodCost,
    forgeStoneCost: s.forgeStoneCost,
    expeditionLevel: s.expeditionLevel,
    maps: s.maps,
    expeditionWoodCost: s.expeditionWoodCost,
    expeditionStoneCost: s.expeditionStoneCost,
    clickPower: clickPower,
    wallBuilt: s.wallLevel > 0,
    upgradeAvailable: upgradeAvailable,
    offlineSummaryVisible: !document.getElementById('offline-summary')?.hidden,
    offlineWoodGained: readOfflineWoodGained(),
    offlineStoneGained: readOfflineStoneGained(),
    offlineElapsed: readOfflineElapsed(),
    offlineDiscovery: readOfflineDiscovery(),
    milestones: {
      sharpenAvailable: sharpenAvailable(s),
      stoneNowUnlocked: s.stoneUnlocked,
      wallAvailable: s.stoneUnlocked && s.stone >= 5 && s.wallLevel === 0,
      forgeNowUnlocked: s.wallLevel >= 1,
      expeditionNowUnlocked: s.forgeLevel >= 5,
      sharpenDone: s.upgradeLevel >= 1,
      wallBuilt: s.wallLevel >= 1,
    },
    firstGoal: {
      target: FIRST_GOAL_WOOD,
      current: displayAmount(Math.min(s.wood, FIRST_GOAL_WOOD)),
      reached: s.wood >= FIRST_GOAL_WOOD,
    },
    nextGoal: determineGoal(s),
  };
}

/**
 * Return the open sandbox clone, opening a sandbox from the current real save
 * when none is active. Keeps sandbox tools working whatever order they are
 * called in, including right after a sandbox-exit.
 *
 * @returns {import("./engine.js").GameState|null}
 */
function ensureSandbox() {
  const current = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
  if (current) return current;
  if (typeof window.__enterSandbox === "function") window.__enterSandbox();
  return typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : null;
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
        + "stone count, stone accumulation rate, wall level, forge level, "
        + "forge wood cost, forge stone cost, click power, "
        + "expedition level, maps, expedition wood cost, expedition stone cost, "
        + "whether stone is unlocked, timestamp, firstTimestamp (ISO date of first save), "
        + "elapsed (formatted duration since first save), whether the offline-summary "
        + "overlay is currently visible, how much wood and stone were gained "
        + "while away (offlineWoodGained / offlineStoneGained), the human-text "
        + "duration of that absence as shown in the panel (offlineElapsed, e.g. "
        + "'3m 20s' or '1d 4h 0m', null when nothing was gained or the panel is "
        + "hidden), the away discovery "
        + "named in the welcome-back panel this return (offlineDiscovery: "
        + "{name, bonus, permanent} where bonus is the wood/s boost it granted "
        + "and permanent is true because the find is kept, null when nothing was "
        + "found or the find granted no bonus), the lasting away discovery owned "
        + "so far (discovery: "
        + "{id, name, bonus} or null, whose bonus is already included in rate), milestones object "
        + "(sharpenAvailable, stoneNowUnlocked, wallAvailable, forgeNowUnlocked, expeditionNowUnlocked), "
        + "and the current goal (first goal, upgrade goal, stone goal, build-wall goal, forge goal, or expedition goal).",
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
        + '"gather" — instantly adds +1 wood (or more based on wall and forge level); '
        + '"sharpen" — once the first goal is reached, consumes ' + UPGRADE_COST + ' wood to permanently increase the wood accumulation rate (refused with a reason before then); '
        + '"gather-stone" — instantly adds +' + STONE_GATHER_AMOUNT + ' stone (only available after stone is unlocked); '
        + '"build-wall" — consumes ' + WALL_COST + ' stone to permanently increase click power for wood; '
        + '"forge-tool" — consumes wood and stone to forge a tool, permanently boosting wood rate and click power; '
        + '"send-expedition" — consumes wood and stone to send scouts on an expedition, earning 1 map resource that multiplies wood rate; '
        + '"dismiss-offline" — dismisses the offline-summary overlay if visible.',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: 'The action to perform. Supported: "gather", "sharpen", "gather-stone", "build-wall", "forge-tool", "send-expedition", "dismiss-offline".',
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
          if (!result.upgraded) {
            return { ok: false, reason: result.reason, ...withGoal(result.state) };
          }
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
        if (action === "forge-tool") {
          const result = forgeTool();
          return withGoal(result.state);
        }
        if (action === "send-expedition") {
          const result = sendExpedition();
          return withGoal(result.state);
        }
        if (action === "dismiss-offline") {
          const overlay = document.getElementById("offline-summary");
          if (overlay && !overlay.hidden) {
            if (typeof window.__dismissOffline === "function") {
              // Route through the page's own handler so overlay isolation and
              // focus restoration happen exactly as they do for a click.
              window.__dismissOffline();
            } else {
              overlay.hidden = true;
              const btnGather = document.getElementById("btn-gather");
              if (btnGather) btnGather.disabled = false;
              document.body.style.pointerEvents = "";
              // Reconcile action button states immediately (no 500ms renderUI delay)
              if (typeof window.__renderUI === "function") window.__renderUI();
            }
          }
          return withGoal(getState());
        }
        throw new Error('Unknown action "' + action + '". Supported: gather, sharpen, gather-stone, build-wall, forge-tool, send-expedition, dismiss-offline');
      },
    },
    {
      name: "read-save-code",
      description: "Returns the visitor's current save as a portable text code — the same "
        + "string the Save Backup panel reveals and copies. The code encodes the whole "
        + "save (wood, rate, upgrades, stone, wall, forge, expedition, maps, discoveries "
        + "and timestamps) and can be handed back to restore-save on another browser or "
        + "after clearing site data. Use it to back up a save before something risky.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        return { code: exportSave() };
      },
    },
    {
      name: "restore-save",
      description: "Replaces the current save with the one held in a text code (as returned "
        + "by read-save-code), restoring wood, upgrades, stone, wall, forge, expedition, "
        + "maps, discoveries and timestamps. Returns ok:true with the state afterwards, or "
        + "ok:false and a plain reason when the code is missing, corrupted or not a save — "
        + "in which case the existing save is left untouched.",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "A save code produced by read-save-code.",
          },
        },
        required: ["code"],
      },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: { code: "e30=" },
      async execute({ code }) {
        const result = importSave(code);
        if (!result.ok) {
          return { ok: false, reason: result.reason, ...withGoal(result.state) };
        }
        // Reflect the restored save on the page immediately, like the panel does.
        if (typeof window.__renderUI === "function") window.__renderUI();
        return { ok: true, ...withGoal(result.state) };
      },
    },
    {
      name: "sandbox-create",
      description: "Creates an isolated sandbox clone of the current game state. "
        + "Returns projected state as it stands right now (no time passed yet). "
        + "Nothing done in the sandbox ever affects the real save. Use this before sandbox-fast-forward.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        const clone = ensureSandbox();
        if (!clone) throw new Error("Could not open a sandbox clone.");
        const result = withGoal(clone);
        result.sandboxActive = true;
        return result;
      },
    },
    {
      name: "sandbox-fast-forward",
      description: "Fast-forwards the active sandbox clone by a given number of seconds. "
        + "Returns projected resources and milestones after the elapsed time. "
        + "If the sandbox is not active, creates one first.",
      inputSchema: {
        type: "object",
        properties: {
          seconds: {
            type: "number",
            description: "How many seconds to simulate (e.g., 10 for 10x, 3600 for 1h, 86400 for 1d, 2592000 for 1mo).",
          },
        },
        required: ["seconds"],
      },
      annotations: { readOnlyHint: false },
      example: { seconds: 3600 },
      async execute({ seconds }) {
        const clone = ensureSandbox();
        if (!clone) throw new Error("Could not open a sandbox clone.");
        const woodBefore = clone.wood;
        const result = typeof window.__fastForwardSandbox === "function"
          ? window.__fastForwardSandbox(seconds)
          : null;
        const projected = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : clone;
        const out = withGoal(projected || clone);
        out.sandboxActive = true;
        out.sandboxSeconds = seconds;
        out.woodGained = (projected ? projected.wood : clone.wood) - woodBefore;
        // The clone's milestone crossings during this interval are authoritative;
        // keep the state-derived keys (sharpenDone, wallBuilt) alongside them.
        if (result && result.milestones) out.milestones = { ...out.milestones, ...result.milestones };
        return out;
      },
    },
    {
      name: "sandbox-exit",
      description: "Exits the sandbox mode, discarding all sandbox state changes. "
        + "Real game state is returned afterwards, unchanged.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, consequentialHint: true },
      example: {},
      async execute() {
        if (typeof window.__exitSandbox === "function") window.__exitSandbox();
        return withGoal(getState());
      },
    },
  ];
}