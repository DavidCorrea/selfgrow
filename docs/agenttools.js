/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState, gatherWood, craftUpgrade, gatherStone, buildWall, forgeTool, sendExpedition, getReturnSummary, formatElapsed, nextDiscoveryAfter, returnDiscoveryText, sharpenAvailable, wallAvailable, expeditionUnlocked, displayAmount, exportSave, importSave, describeGoal, computeStoneRateFor, effectiveWoodRate, expeditionMultiplierFor, FIRST_GOAL_WOOD, UPGRADE_COST, WALL_COST, STONE_GATHER_AMOUNT, FORGE_CLICK_POWER_BONUS } from "./engine.js";

/**
 * The last return as the welcome-back panel is showing it, read straight from
 * the engine's own record rather than parsed from the panel's text. The panel
 * and this reader share one source, so they can never report different numbers.
 *
 * `available` is true whenever a real return is on record, whether or not the
 * panel is currently up — it is what the status panel's re-open control keys
 * off. The amounts and the find stay zeroed while the panel is hidden, matching
 * the panel being absent.
 *
 * @returns {{
 *   available: boolean,
 *   wood: number,
 *   stone: number,
 *   elapsed: string|null,
 *   discovery: { name: string, bonus: number|null, permanent: boolean, alreadyOwned: boolean, note: string }|null,
 * }}
 */
function readReturnSummary() {
  const ret = getReturnSummary();
  const available = ret.visible;
  const overlay = document.getElementById("offline-summary");
  if (!available || !overlay || overlay.hidden) {
    return { available, wood: 0, stone: 0, elapsed: null, discovery: null };
  }
  return {
    available,
    wood: ret.wood,
    stone: ret.stone,
    elapsed: ret.elapsed,
    discovery: ret.discovery
      ? {
          name: ret.discovery.name,
          bonus: ret.discovery.credited ? ret.discovery.bonus : null,
          permanent: ret.discovery.credited,
          alreadyOwned: Boolean(ret.discovery.alreadyOwned),
          note: returnDiscoveryText(ret.discovery),
        }
      : null,
  };
}

/**
 * Augment a raw state snapshot with goal, upgrade, and stone info.
 */
function withGoal(s) {
  const upgradeAvailable = sharpenAvailable(s);
  const stoneRate = s.stoneUnlocked ? computeStoneRateFor(s.totalWoodEarned) : 0;
  const clickPower = 1 + s.wallLevel * 1 + s.forgeLevel * FORGE_CLICK_POWER_BONUS;
  const ret = readReturnSummary();
  // Snapshots come in two shapes: the raw state (has discoveryId) and
  // getState()'s view (only discovery.id). Reading whichever is present keeps
  // one ladder lookup for both, so the tool and the panel cannot disagree.
  const ownedDiscoveryId = s.discoveryId ?? s.discovery?.id ?? null;
  const nextDiscovery = nextDiscoveryAfter(ownedDiscoveryId);

  return {
    wood: s.wood,
    rate: s.rate,
    // The rate the game actually pays once the earned maps are applied, plus
    // the map factor itself — both read from the engine's own rule so the tool,
    // the status panel and the sandbox can never show different figures.
    effectiveRate: effectiveWoodRate(s),
    expeditionMultiplier: expeditionMultiplierFor(s.maps),
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
    // Whether a real return is on record and can be re-opened, independent of
    // whether the panel is up right now — the same gate the status panel uses.
    returnAvailable: ret.available,
    offlineWoodGained: ret.wood,
    offlineStoneGained: ret.stone,
    offlineElapsed: ret.elapsed,
    offlineDiscovery: ret.discovery,
    nextAwayDiscovery: nextDiscovery
      ? { name: nextDiscovery.name, minSec: nextDiscovery.minSec, elapsed: formatElapsed(nextDiscovery.minSec * 1000) }
      : null,
    milestones: {
      sharpenAvailable: sharpenAvailable(s),
      stoneNowUnlocked: s.stoneUnlocked,
      // The wall and expedition milestones come from the engine's own rules,
      // the same comparisons the goal panel and the engine's catch-up use, so
      // an agent can never be told a system is open while the page disagrees.
      wallAvailable: wallAvailable(s),
      forgeNowUnlocked: s.wallLevel >= 1,
      expeditionNowUnlocked: expeditionUnlocked(s),
      sharpenDone: s.upgradeLevel >= 1,
      wallBuilt: s.wallLevel >= 1,
    },
    firstGoal: {
      target: FIRST_GOAL_WOOD,
      current: displayAmount(Math.min(s.wood, FIRST_GOAL_WOOD)),
      reached: s.wood >= FIRST_GOAL_WOOD,
    },
    nextGoal: describeGoal(s),
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
        + "visitor: wood count, base accumulation rate (rate), the rate the game "
        + "actually pays once earned maps are applied (effectiveRate) and the map "
        + "factor scaling it (expeditionMultiplier), number of upgrades crafted, "
        + "stone count, stone accumulation rate, wall level, forge level, "
        + "forge wood cost, forge stone cost, click power, "
        + "expedition level, maps, expedition wood cost, expedition stone cost, "
        + "whether stone is unlocked, timestamp, firstTimestamp (ISO date of first save), "
        + "elapsed (formatted duration since first save), whether the offline-summary "
        + "overlay is currently visible (offlineSummaryVisible), whether a real return is "
        + "on record and can be re-opened (returnAvailable, true even after the panel was "
        + "dismissed), how much wood and stone were gained "
        + "while away (offlineWoodGained / offlineStoneGained), the human-text "
        + "duration of that absence as shown in the panel (offlineElapsed, e.g. "
        + "'3m 20s' or '1d 4h 0m', null when nothing was gained or the panel is "
        + "hidden), the away discovery "
        + "named in the welcome-back panel this return (offlineDiscovery: "
        + "{name, bonus, permanent, alreadyOwned, note}). bonus is the wood/s boost "
        + "the find granted and permanent is true because the find is kept; both are "
        + "null/false when the find added nothing because it was already owned or was "
        + "weaker than one owned, in which case alreadyOwned says whether it was the "
        + "same rung already in the collection, and note is the exact sentence the panel "
        + "shows for it; offlineDiscovery itself is null when nothing was found. The away discovery owned so far (discovery: "
        + "{id, name, bonus} or null, whose bonus is already included in rate), and the "
        + "next away discovery still to earn (nextAwayDiscovery: {name, minSec, elapsed} "
        + "where minSec is the absence in seconds needed to find it and elapsed is that "
        + "duration as text) \u2014 the ladder has no end, so this names a rung for every valid "
        + "save and is null only when the saved discovery id is unrecognised), milestones object "
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
        + '"dismiss-offline" — dismisses the offline-summary overlay if visible; '
        + '"show-return" — re-opens the last return\'s summary (the status panel\'s Last return control), refused with a reason when there is no return on record.',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: 'The action to perform. Supported: "gather", "sharpen", "gather-stone", "build-wall", "forge-tool", "send-expedition", "dismiss-offline", "show-return".',
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
        if (action === "show-return") {
          const summary = readReturnSummary();
          if (!summary.available) {
            return { ok: false, reason: "There is no return to show yet.", ...withGoal(getState()) };
          }
          if (typeof window.__showReturn === "function") {
            // Route through the page's own handler so the overlay opens exactly
            // as it does for a click on the Last return control.
            window.__showReturn();
          }
          return { ok: true, ...withGoal(getState()) };
        }
        throw new Error('Unknown action "' + action + '". Supported: gather, sharpen, gather-stone, build-wall, forge-tool, send-expedition, dismiss-offline, show-return');
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
        // No time has passed yet, so this rehearsal has named no find.
        result.discovery = null;
        return result;
      },
    },
    {
      name: "sandbox-fast-forward",
      description: "Fast-forwards the active sandbox clone by a given number of seconds. "
        + "Returns projected resources, milestones, and the away find a real absence of that "
        + "same length would name (null when the length turns up nothing). "
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
        // The rehearsal's own away find, named by the engine's discovery rule —
        // what a real absence of this length would turn up, not a bigger number.
        out.discovery = result ? result.discovery : null;
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