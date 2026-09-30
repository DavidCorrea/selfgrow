/**
 * agenttools.js — selfgrow's agent-facing capabilities.
 *
 * Every tool an agent can invoke is defined here. The layer maps one-to-one
 * with what the page shows a visitor: every visible field gets a read tool,
 * every visitor action gets a write tool.
 *
 * @module agenttools
 */

import { getState, gatherWood, craftUpgrade, gatherStone, buildWall, forgeTool, sendExpedition, chooseAwayEventOption, getReturnSummary, formatElapsed, formatRate, nextDiscoveryAfter, discoveryCollection, returnDiscoveryText, sharpenAvailable, sharpenThreshold, wallAvailable, expeditionUnlocked, displayAmount, exportSave, importSave, describeGoal, computeStoneRateFor, effectiveWoodRate, expeditionMultiplierFor, clickPowerFor, FIRST_GOAL_WOOD, UPGRADE_COST, RATE_INCREASE_PER_UPGRADE, GOAL_STONE, WALL_COST, WALL_CLICK_POWER_BONUS, STONE_GATHER_AMOUNT, EXPEDITION_FORGE_LEVEL, FORGE_WOOD_COST_BASE, FORGE_STONE_COST_BASE, FORGE_WOOD_COST_INC, FORGE_STONE_COST_INC, FORGE_WOOD_RATE_BONUS, FORGE_CLICK_POWER_BONUS, EXPEDITION_WOOD_COST_BASE, EXPEDITION_STONE_COST_BASE, EXPEDITION_WOOD_COST_INC, EXPEDITION_STONE_COST_INC, EXPEDITION_WOOD_RATE_MULTIPLIER, DISCOVERY_MIN_SEC, AWAY_EVENT_MIN_SEC, AWAY_EVENT_LUMP_SEC, AWAY_EVENT_RATE_BONUS_FRACTION, awayRateBonusFor, AWAY_EVENTS, discoverForElapsed, FINDS_LIST_LIMIT } from "./engine.js";

/**
 * The last return as the welcome-back panel is showing it, read straight from
 * the engine's own record rather than parsed from the panel's text. The panel
 * and this reader share one source, so they can never report different numbers.
 *
 * `available` is true whenever a real return is on record, whether or not the
 * panel is currently up — it is what the status panel's re-open control keys
 * off. The amounts and the find stay zeroed while the panel is hidden, matching
 * the panel being absent; `chosenOption` is a fact of the record itself, so it
 * is reported whenever the return is on record, even after the panel is hidden.
 *
 * @returns {{
 *   available: boolean,
 *   wood: number,
 *   stone: number,
 *   elapsed: string|null,
 *   discovery: { name: string, bonus: number|null, permanent: boolean, alreadyOwned: boolean, sentence: string }|null,
 *   chosenOption: { id: string, label: string, effect: {kind: string, amount: number}, effectText: string }|null,
 * }}
 */
function readReturnSummary() {
  const ret = getReturnSummary();
  const available = ret.visible;
  const chosenOption = ret.chosenOption ?? null;
  const overlay = document.getElementById("offline-summary");
  if (!available || !overlay || overlay.hidden) {
    return { available, wood: 0, stone: 0, elapsed: null, discovery: null, chosenOption };
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
          sentence: returnDiscoveryText(ret.discovery),
        }
      : null,
    chosenOption,
  };
}

/**
 * Augment a raw state snapshot with goal, upgrade, and stone info.
 */
function withGoal(s) {
  const upgradeAvailable = sharpenAvailable(s);
  const stoneRate = s.stoneUnlocked ? computeStoneRateFor(s.totalWoodEarned) : 0;
  // The engine's own chop-power rule, so the agent is told exactly the number
  // the Gather Wood button promises.
  const clickPower = clickPowerFor(s);
  const ret = readReturnSummary();
  // Snapshots come in two shapes: the raw state (has discoveryId) and
  // getState()'s view (only discovery.id). Reading whichever is present keeps
  // one ladder lookup for both, so the tool and the panel cannot disagree.
  const ownedDiscoveryId = s.discoveryId ?? s.discovery?.id ?? null;
  const nextDiscovery = nextDiscoveryAfter(ownedDiscoveryId);
  // The whole collection, not just the strongest rung: every find the player
  // has reached plus the next locked one. getState() already derives it; a raw
  // snapshot (the sandbox clone) gets the same derivation here, so the page and
  // the tools read one list.
  const finds = s.finds ?? discoveryCollection(ownedDiscoveryId);

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
    // Whether the most recent save write reached storage — false while the page
    // shows its "progress not saved" warning. Read from the live save so a
    // sandbox projection reports the real outcome, not a clone's absent field.
    savePersisted: s.savePersisted ?? getState().savePersisted,
    elapsed: s.firstTimestamp ? formatElapsed(Date.now() - new Date(s.firstTimestamp).getTime()) : '\u2014',
    upgradeLevel: s.upgradeLevel,
    stone: s.stone,
    stoneRate: stoneRate,
    stoneUnlocked: s.stoneUnlocked,
    discovery: s.discovery || null,
    // The first find active play earned in this session, or null when none has
    // been earned: {id, name, bonus, text} where text is the exact sentence the
    // page's status message shows announcing it.
    sessionFind: s.sessionFind ?? null,
    // The two-choice happening a real return is offering right now, or null
    // when there is none. Cloned by the engine, so the tool can hand it out
    // without a caller being able to edit the save through it.
    pendingEvent: s.pendingEvent ?? null,
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
    // The option taken from the last return's decision, or null when it offered
    // none or the player has not chosen. It is the same record the panel words
    // its 'You chose' line from, so the page and the tool cannot disagree.
    offlineChosenOption: ret.chosenOption,
    nextAwayDiscovery: nextDiscovery
      ? { name: nextDiscovery.name, minSec: nextDiscovery.minSec, bonus: nextDiscovery.bonus, woodPerSec: nextDiscovery.bonus, elapsed: formatElapsed(nextDiscovery.minSec * 1000) }
      : null,
    // The Finds list the page shows: the rungs already reached in ladder order,
    // each with the wood/s it grants, how many weaker ones the display
    // summarises (hiddenCount), and the next rung still locked.
    finds: {
      collected: finds.collected.map((rung) => ({ id: rung.id, name: rung.name, bonus: rung.bonus, woodPerSec: rung.bonus })),
      hiddenCount: finds.hiddenCount,
      total: finds.total,
      next: finds.next
        ? { id: finds.next.id, name: finds.next.name, minSec: finds.next.minSec, bonus: finds.next.bonus, woodPerSec: finds.next.bonus, elapsed: formatElapsed(finds.next.minSec * 1000) }
        : null,
    },
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
 * The game's progression in the order it comes, read from the engine's own
 * thresholds and worded the way the goal panel words it. A cold agent can take
 * the first entry and act on it: the first goal and the action that reaches it.
 *
 * @param {import("./engine.js").GameState} s
 * @returns {Array<{order: number, type: string, description: string, action: string, requirement: object}>}
 */
function rulesGoals(s) {
  return [
    {
      order: 1,
      type: "first-goal",
      description: "Gather " + FIRST_GOAL_WOOD + " wood",
      action: "gather",
      requirement: { wood: FIRST_GOAL_WOOD },
    },
    {
      order: 2,
      type: "upgrade",
      description: "Craft a Sharpening (" + UPGRADE_COST + " wood)",
      action: "sharpen",
      requirement: { wood: UPGRADE_COST },
    },
    {
      order: 3,
      type: "stone-goal",
      description: "Gather " + GOAL_STONE + " stone",
      action: "gather-stone",
      requirement: { stone: GOAL_STONE },
    },
    {
      order: 4,
      type: "build-wall-goal",
      description: "Build a Wall (" + WALL_COST + " stone)",
      action: "build-wall",
      requirement: { stone: WALL_COST },
    },
    {
      order: 5,
      type: "forge-goal",
      description: "Forge a tool \u2014 need " + s.forgeWoodCost + " wood and " + s.forgeStoneCost + " stone",
      action: "forge-tool",
      requirement: { wood: s.forgeWoodCost, stone: s.forgeStoneCost },
    },
    {
      order: 6,
      type: "expedition-goal",
      description: "Send scouts on expedition \u2014 need " + s.expeditionWoodCost + " wood and " + s.expeditionStoneCost + " stone",
      action: "send-expedition",
      requirement: { forgeLevel: EXPEDITION_FORGE_LEVEL, wood: s.expeditionWoodCost, stone: s.expeditionStoneCost },
    },
  ];
}

/**
 * A repeatable upgrade's escalating cost stated as a formula, so a caller can
 * project the price at any level rather than only the level it read. The
 * numbers are the engine's own base and increment constants.
 */
function escalatingCostFormula(woodBase, woodIncrement, stoneBase, stoneIncrement) {
  return "wood = " + woodBase + " + level * " + woodIncrement
    + ", stone = " + stoneBase + " + level * " + stoneIncrement;
}

/**
 * Every action a visitor can take, with what it costs, what it changes, the
 * sentence the page prints beside its button, and what must be true before it
 * works. Costs, effects and effect text are assembled only from engine
 * constants and the live state's own derived costs, so the rules an agent
 * learns are exactly the ones the page plays by.
 *
 * @param {import("./engine.js").GameState} s
 * @returns {Array<{id: string, label: string, cost: object, costFormula?: string, effect: object, effectText: string, requires?: object}>}
 */
function rulesActions(s) {
  const clickPower = clickPowerFor(s);
  return [
    {
      id: "gather",
      label: "Gather Wood",
      cost: {},
      effect: { woodPerChop: clickPower },
      effectText: "+" + String(clickPower) + " / chop",
    },
    {
      id: "sharpen",
      label: "Sharpen Axe",
      cost: { wood: UPGRADE_COST },
      effect: { woodRatePerSec: RATE_INCREASE_PER_UPGRADE },
      effectText: "+" + formatRate(RATE_INCREASE_PER_UPGRADE) + " wood/s. The first sharpen unlocks stone.",
      requires: { woodBanked: sharpenThreshold(s) },
    },
    {
      id: "gather-stone",
      label: "Gather Stone",
      cost: {},
      effect: { stone: STONE_GATHER_AMOUNT },
      effectText: "+" + String(STONE_GATHER_AMOUNT) + " / mine",
      requires: { stoneUnlocked: true },
    },
    {
      id: "build-wall",
      label: "Build Wall",
      cost: { stone: WALL_COST },
      effect: { woodPerChop: WALL_CLICK_POWER_BONUS },
      effectText: "+" + String(WALL_CLICK_POWER_BONUS) + " wood per chop. The first wall unlocks the forge.",
      requires: { stoneUnlocked: true },
    },
    {
      id: "forge-tool",
      label: "Forge Tool",
      cost: { wood: s.forgeWoodCost, stone: s.forgeStoneCost },
      costFormula: escalatingCostFormula(FORGE_WOOD_COST_BASE, FORGE_WOOD_COST_INC, FORGE_STONE_COST_BASE, FORGE_STONE_COST_INC),
      effect: { woodRatePerSec: FORGE_WOOD_RATE_BONUS, woodPerChop: FORGE_CLICK_POWER_BONUS },
      effectText: "+" + formatRate(FORGE_WOOD_RATE_BONUS) + " wood/s and +" + String(FORGE_CLICK_POWER_BONUS) + " per chop",
      requires: { wallLevel: 1 },
    },
    {
      id: "send-expedition",
      label: "Send Expedition",
      cost: { wood: s.expeditionWoodCost, stone: s.expeditionStoneCost },
      costFormula: escalatingCostFormula(EXPEDITION_WOOD_COST_BASE, EXPEDITION_WOOD_COST_INC, EXPEDITION_STONE_COST_BASE, EXPEDITION_STONE_COST_INC),
      effect: { woodRateMultiplierPerMap: EXPEDITION_WOOD_RATE_MULTIPLIER },
      effectText: "+" + (EXPEDITION_WOOD_RATE_MULTIPLIER * 100) + "% wood rate per map",
      requires: { forgeLevel: EXPEDITION_FORGE_LEVEL },
    },
  ];
}

/**
 * What each system unlocks and what opens it, read from the same gates the
 * engine enforces, so the chain an agent learns is the chain the game plays.
 *
 * @returns {Array<{system: string, openedBy: string, at: object, description: string}>}
 */
function rulesUnlocks() {
  return [
    {
      system: "stone",
      openedBy: "sharpen",
      at: { upgradeLevel: 1 },
      description: "The first sharpen unlocks stone.",
    },
    {
      system: "forge",
      openedBy: "build-wall",
      at: { wallLevel: 1 },
      description: "The first wall unlocks the forge.",
    },
    {
      system: "expedition",
      openedBy: "forge-tool",
      at: { forgeLevel: EXPEDITION_FORGE_LEVEL },
      description: "Reaching forge level " + EXPEDITION_FORGE_LEVEL + " unlocks expeditions.",
    },
  ];
}

/**
 * The next rung of the away-find ladder, the absence it needs and the wood/s it
 * grants, read from the engine's own ladder so the rules and the page name the
 * same find and promise the same reward.
 *
 * @param {import("./engine.js").GameState} s
 * @returns {{ id: string, name: string, minSec: number, bonus: number, woodPerSec: number, elapsed: string }|null}
 */
function rulesNextAwayFind(s) {
  const next = nextDiscoveryAfter(s.discoveryId ?? s.discovery?.id ?? null);
  return next
    ? { id: next.id, name: next.name, minSec: next.minSec, bonus: next.bonus, woodPerSec: next.bonus, elapsed: formatElapsed(next.minSec * 1000) }
    : null;
}

/**
 * The away loop — the part the game is built around — stated as rules: what an
 * absence turns up, the decision a return offers, and how a sandbox rehearses
 * one. Every figure is read from the engine's own constants and ladder, and
 * the sentences are assembled from those same values, so a rule here cannot
 * drift from the rule the page plays by.
 *
 * The ladder's endlessness is derived, not asserted: the deepest rung the
 * engine can name for an absurd absence is probed, and the ladder counts as
 * endless because a further rung still follows it.
 *
 * @param {import("./engine.js").GameState} s
 * @returns {object}
 */
function rulesAway(s) {
  const exampleFind = discoverForElapsed(DISCOVERY_MIN_SEC);
  const deepestFind = discoverForElapsed(1e15);
  const strongestKinds = [...new Set(AWAY_EVENTS.flatMap((event) => event.kinds))];
  // The one amount this save's rate option would add, read once so the figure
  // the rule states and the figure rateBonus reports can never differ.
  const rateBonus = awayRateBonusFor(s);
  return {
    finds: {
      minSec: DISCOVERY_MIN_SEC,
      minElapsed: formatElapsed(DISCOVERY_MIN_SEC * 1000),
      example: exampleFind
        ? { id: exampleFind.id, name: exampleFind.name, bonus: exampleFind.bonus, minSec: exampleFind.minSec }
        : null,
      neverEnds: Boolean(deepestFind && nextDiscoveryAfter(deepestFind.id)),
      weakerOrRepeatAddsNothing: true,
      listLimit: FINDS_LIST_LIMIT,
      rule: "A longer absence always turns up a stronger named find, and a find, once kept, "
        + "adds permanently to wood/s. The shortest absence that turns anything up is " + DISCOVERY_MIN_SEC
        + " seconds. The ladder has no end, so there is always "
        + "a stronger find beyond the one owned; the Finds list shows the " + FINDS_LIST_LIMIT
        + " strongest kept and summarises the rest. A find weaker than one already owned, or the same "
        + "rung found again, adds nothing new.",
    },
    event: {
      minSec: AWAY_EVENT_MIN_SEC,
      minElapsed: formatElapsed(AWAY_EVENT_MIN_SEC * 1000),
      optionCount: 2,
      kinds: strongestKinds,
      // Stone is swapped for wood while the stone system is still locked, so
      // the choice the player actually sees can differ from the pool's kinds.
      stoneShownAsWood: !s.stoneUnlocked,
      lumpSec: AWAY_EVENT_LUMP_SEC,
      rateBonus,
      rateBonusFraction: AWAY_EVENT_RATE_BONUS_FRACTION,
      oneWay: true,
      rule: "A return of at least " + AWAY_EVENT_MIN_SEC + " seconds offers a happening with exactly two "
        + "choices. Each choice grants one thing: a lump of wood, "
        + "a lump of stone (shown as wood while stone is still locked), or a permanent +"
        + formatRate(rateBonus) + " wood/s. The wood and stone lumps are worth "
        + AWAY_EVENT_LUMP_SEC + "s of production at the rates in force, and the rate option adds "
        + AWAY_EVENT_RATE_BONUS_FRACTION + " of the same wood/s for good, so it pays for itself in "
        + (AWAY_EVENT_LUMP_SEC / AWAY_EVENT_RATE_BONUS_FRACTION) + "s of production at any rate "
        + "(rateBonus / rateBonusFraction state the same rule). The absence and how many happenings "
        + "this save has already been offered together choose which one, so returns of the same "
        + "length advance through the pool (" + AWAY_EVENTS.length + " happenings) instead of repeating "
        + "one decision; the sequence is fixed for a save, so a return can never be a gamble. "
        + "Choosing is one-way: once one "
        + "option is taken the other can never then be taken.",
    },
    sandbox: {
      tools: ["sandbox-create", "sandbox-fast-forward", "sandbox-fast-forward-next-find", "sandbox-rehearse-choice", "sandbox-exit"],
      rule: "An absence can be rehearsed. A sandbox clones the current save and fast-forwarding it "
        + "projects exactly the find and the happening a real absence of that length would turn up, "
        + "without touching the real save. Each choice the happening offers can then be rehearsed "
        + "against the clone (sandbox-rehearse-choice), which reports the projected wood, stone and "
        + "rates that choice would leave behind without spending it; sandbox-exit discards the "
        + "rehearsal and leaves the real choice unresolved.",
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
        + "visitor: wood count, base accumulation rate (rate), the rate the game "
        + "actually pays once earned maps are applied (effectiveRate) and the map "
        + "factor scaling it (expeditionMultiplier), number of upgrades crafted, "
        + "stone count, stone accumulation rate, wall level, forge level, "
        + "forge wood cost, forge stone cost, click power, "
        + "expedition level, maps, expedition wood cost, expedition stone cost, "
        + "whether stone is unlocked, timestamp, firstTimestamp (ISO date of first save), "
        + "whether the current save is actually being persisted to storage (savePersisted: "
        + "false while a write is failing and the page shows its 'progress not saved' warning, "
        + "true when saving works), "
        + "elapsed (formatted duration since first save), whether the offline-summary "
        + "overlay is currently visible (offlineSummaryVisible), whether a real return is "
        + "on record and can be re-opened (returnAvailable, true even after the panel was "
        + "dismissed), how much wood and stone were gained "
        + "while away (offlineWoodGained / offlineStoneGained), the human-text "
        + "duration of that absence as shown in the panel (offlineElapsed, e.g. "
        + "'3m 20s' or '1d 4h 0m', null when nothing was gained or the panel is "
        + "hidden), the away discovery "
        + "named in the welcome-back panel this return (offlineDiscovery: "
        + "{name, bonus, permanent, alreadyOwned, sentence}). bonus is the wood/s boost "
        + "the find granted and permanent is true because the find is kept; both are "
        + "null/false when the find added nothing because it was already owned or was "
        + "weaker than one owned, in which case alreadyOwned says whether it was the "
        + "same rung already in the collection, and sentence is the exact sentence the panel "
        + "shows for it (a credited find names the wood/s it added; a repeat or weaker "
        + "find makes no claim of a new find); offlineDiscovery itself is null when nothing was found. "
        + "offlineChosenOption is the option the player took from that same return's decision "
        + "({id, label, effect: {kind, amount}, effectText}) or null when the return offered no decision "
        + "or none has been taken yet; it is part of the return's own record, so it survives a reload and "
        + "matches the panel's 'You chose' line. The away discovery owned so far (discovery: "
        + "{id, name, bonus} or null, whose bonus is already included in rate), and the "
        + "next away discovery still to earn (nextAwayDiscovery: {name, minSec, bonus, woodPerSec, "
        + "elapsed} where minSec is the absence in seconds needed to find it, bonus/woodPerSec is "
        + "the wood/s the rung will add when earned, and elapsed is that "
        + "duration as text) \u2014 the ladder has no end, so this names a rung for every valid "
        + "save and is null only when the saved discovery id is unrecognised). finds is the "
        + "Finds list the page shows: {collected: [{id, name, bonus, woodPerSec}] in ladder order "
        + "(weaker to stronger), hiddenCount (how many older finds the display summarises), total "
        + "(the true number kept), next: {id, name, minSec, bonus, woodPerSec, elapsed} for the rung still locked or "
        + "null when the saved id is unrecognised}. milestones object "
        + "(sharpenAvailable, stoneNowUnlocked, wallAvailable, forgeNowUnlocked, expeditionNowUnlocked), "
        + "and the current goal (first goal, upgrade goal, stone goal, build-wall goal, forge goal, or expedition goal) as nextGoal "
        + "{description, type, available, resources: [{name, current, target}]}, whose resources are the same "
        + "figures the page prints beside the goal's bar and on the welcome-back panel's next-goal line. "
        + "pendingEvent is the two-choice happening a real return is offering, or null when "
        + "there is none: {id, title, options: [{id, label, effect: {kind, amount}, effectText}]}"
        + " with exactly two options. Each effectText states exactly what choosing that option "
        + "grants (a lump of wood, a lump of stone, or a permanent wood/s increase sized from "
        + "the wood/s in force when the return is collected), and each "
        + "option's id is the value to pass to the choose-away-event action."
        + " sessionFind is the first discovery active play earned in this session "
        + "(an in-session counterpart to an away find), or null when none has been "
        + "earned: {id, name, bonus, text}, where bonus is the wood/s it added (already "
        + "included in rate) and text is the exact sentence the page's status message "
        + "shows announcing it.",
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
        + '"choose-away-event" — takes one option of the pending away event, granting exactly the effect that option states and then removing the event; pass the chosen option\'s id in "option" (a wood, stone or rate option, as read from read-state.pendingEvent.options[].id). Choosing is irreversible — the other option can never then be taken — and is refused with a reason when no event is pending or the option is not one of its two. '
        + '"dismiss-offline" — dismisses the offline-summary overlay if visible; '
        + '"show-return" — re-opens the last return\'s summary (the status panel\'s Last return control), refused with a reason when there is no return on record.',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: 'The action to perform. Supported: "gather", "sharpen", "gather-stone", "build-wall", "forge-tool", "send-expedition", "choose-away-event", "dismiss-offline", "show-return".',
          },
          option: {
            type: "string",
            description: 'Only for "choose-away-event": the id of the option to take ("wood", "stone" or "rate"), as listed in read-state.pendingEvent.options[].id.',
          },
        },
        required: ["action"],
      },
      annotations: { readOnlyHint: false },
      example: { action: "gather" },
      async execute({ action, option }) {
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
        if (action === "choose-away-event") {
          // The engine's own one apply-then-clear path, so the effect an agent
          // takes is exactly the effect a click on the option would grant.
          const result = chooseAwayEventOption(option);
          if (!result.chosen) {
            return { ok: false, reason: result.reason, ...withGoal(result.state) };
          }
          return { ok: true, chosenOptionId: result.chosenOptionId, effect: result.effect, ...withGoal(result.state) };
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
        throw new Error('Unknown action "' + action + '". Supported: gather, sharpen, gather-stone, build-wall, forge-tool, send-expedition, choose-away-event, dismiss-offline, show-return');
      },
    },
    {
      name: "read-rules",
      description: "Returns the game's rules — what to aim for and how it opens up — "
        + "without any of the current numbers read-state reports. goals lists the progression "
        + "in the order it comes, each {order, type, description, action (the action id that "
        + "reaches it), requirement (the engine thresholds it needs)}: first-goal ('Gather "
        + FIRST_GOAL_WOOD + " wood'), upgrade (craft a sharpening), stone-goal, "
        + "build-wall-goal, forge-goal, expedition-goal. actions lists every action a visitor "
        + "can take, each {id, label, cost (wood/stone consumed, empty when free), costFormula "
        + "(the escalating rule for the repeatable forge/expedition costs, so a price at any "
        + "level can be projected), effect (the numeric change it makes, e.g. woodRatePerSec "
        + "or woodPerChop), effectText (the exact sentence the page prints beside that button), "
        + "requires (what must be true before it works)}. unlocks names the chain: the first "
        + "sharpen opens stone, the first wall opens the forge, forge level " + EXPEDITION_FORGE_LEVEL
        + " opens expeditions. nextAwayFind is the next rung of the away-find ladder, the "
        + "absence it needs and the wood/s it grants {id, name, minSec, bonus, woodPerSec, elapsed}, "
        + "or null when the save names no rung. "
        + "away describes the loop the game is built around: finds is the away-find ladder "
        + "(minSec/minElapsed = the shortest absence that turns anything up, an example rung, "
        + "neverEnds = the ladder has no end so a stronger find always waits, "
        + "weakerOrRepeatAddsNothing, listLimit, and the rule in words); event is the two-choice "
        + "happening a return of minSec or more offers (optionCount, kinds it can grant, "
        + "stoneShownAsWood while stone is locked, lumpSec = seconds of production a wood/stone "
        + "lump is worth, rateBonus = the permanent wood/s a rate option adds for this save "
        + "(read from the state, not a constant) and rateBonusFraction = the share of the effective "
        + "wood/s that bonus is, oneWay, and the "
        + "rule in words); sandbox names the rehearsal tools and states that fast-forwarding "
        + "projects the find and happening a real absence would turn up without touching the "
        + "save. "
        + "Every number is read from the engine's own constants, so an agent that has never "
        + "seen the screen can learn the game and name the first goal and its action.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute() {
        const s = getState();
        return {
          goals: rulesGoals(s),
          actions: rulesActions(s),
          unlocks: rulesUnlocks(),
          nextAwayFind: rulesNextAwayFind(s),
          away: rulesAway(s),
        };
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
        + "same length would name (null when the length turns up nothing). Also returns event — "
        + "the two-choice happening a real return would offer, read from the engine's own rule "
        + "({id, title, options: [{id, label, effect: {kind, amount}, effectText}]} with exactly "
        + "two options): the decision already pending in the real save when one is waiting, "
        + "otherwise the happening this absence would derive — null when nothing is waiting and "
        + "the absence is too short. The event is "
        + "reported only: the sandbox never resolves the choice and the real save is untouched. "
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
        // The decision a real absence of this length would offer, drawn by the
        // engine's own rule. Reported, never resolved: the sandbox has no way
        // to choose, so a caller can see the choice without spending it.
        out.event = result ? result.event : null;
        // The clone's milestone crossings during this interval are authoritative;
        // keep the state-derived keys (sharpenDone, wallBuilt) alongside them.
        if (result && result.milestones) out.milestones = { ...out.milestones, ...result.milestones };
        return out;
      },
    },
    {
      name: "sandbox-fast-forward-next-find",
      description: "Fast-forwards the active sandbox clone by exactly the absence the next "
        + "away find needs — one call to rehearse \"when do I get the next find\" instead of "
        + "guessing a preset length. Returns sandboxSeconds (the absence it simulated), "
        + "targetedDiscovery {id, name, minSec} naming the rung it jumped to (null, without "
        + "fast-forwarding, when the save holds no recognised find id), and discovery — the "
        + "find a real absence of that length turns up, read from the engine's own rule, so "
        + "the result always matches what the game would show. Also returns event — the "
        + "two-choice happening a real return would offer ({id, title, options} with exactly two "
        + "options): the decision already pending in the real save when one is waiting, otherwise "
        + "the one this absence would derive — null when nothing is waiting and the absence is "
        + "too short — reported only, never "
        + "resolved. Also returns the projected state afterwards. If the sandbox is not active, "
        + "creates one first.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false },
      example: {},
      async execute() {
        const clone = ensureSandbox();
        if (!clone) throw new Error("Could not open a sandbox clone.");
        // The same ladder lookup the sandbox panel, the status bar and the
        // welcome-back panel read, so this jump can never rehearse an interval
        // that targets a different find than the one the page names.
        const rung = nextDiscoveryAfter(clone.discoveryId ?? clone.discovery?.id ?? null);
        if (!rung) {
          // A corrupt save names no rung. Report the projection as it stands
          // with no target rather than inventing an interval or throwing.
          const out = withGoal(clone);
          out.sandboxActive = true;
          out.sandboxSeconds = 0;
          out.targetedDiscovery = null;
          out.discovery = null;
          out.event = null;
          return out;
        }
        const woodBefore = clone.wood;
        const result = typeof window.__fastForwardSandbox === "function"
          ? window.__fastForwardSandbox(rung.minSec)
          : null;
        const projected = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : clone;
        const out = withGoal(projected || clone);
        out.sandboxActive = true;
        out.sandboxSeconds = rung.minSec;
        out.targetedDiscovery = { id: rung.id, name: rung.name, minSec: rung.minSec };
        out.woodGained = (projected ? projected.wood : clone.wood) - woodBefore;
        // The rehearsal's own away find, named by the engine's discovery rule —
        // the very rung that was targeted, never a bigger number.
        out.discovery = result ? result.discovery : null;
        // The decision a real absence of this length would offer, reported the
        // same way sandbox-fast-forward reports it, so the two rehearsals of
        // the same absence can never disagree about the choice it offers.
        out.event = result ? result.event : null;
        if (result && result.milestones) out.milestones = { ...out.milestones, ...result.milestones };
        return out;
      },
    },
    {
      name: "sandbox-rehearse-choice",
      description: "Rehearses one option of the two-choice happening the sandbox is currently "
        + "offering, against the isolated sandbox clone only. Returns where that choice would lead — "
        + "the projected wood, stone, wood/s (woodRate) and stone/s (stoneRate) it would leave "
        + "behind — so a caller can compare the options before spending the real choice. The real "
        + "save's pending event is never resolved or touched; only the clone changes, and calling "
        + "it again with the other option compares outcomes rather than adding them. Returns "
        + "rehearsed:false with a reason when the sandbox is offering no choice or the id names no "
        + "option of it. Fast-forward first so a happening is offered.",
      inputSchema: {
        type: "object",
        properties: {
          option: {
            type: "string",
            description: "Which option of the offered happening to rehearse, by its id (e.g. 'wood', 'stone' or 'rate').",
          },
        },
        required: ["option"],
      },
      annotations: { readOnlyHint: false },
      example: { option: "wood" },
      async execute({ option }) {
        const clone = ensureSandbox();
        if (!clone) throw new Error("Could not open a sandbox clone.");
        // The happening the sandbox is offering: the one it just projected, or
        // the decision the clone is already carrying when nothing has been
        // fast-forwarded yet. Never the real save's — this only reads the clone.
        const event = typeof window.__getSandboxEvent === "function"
          ? window.__getSandboxEvent()
          : clone.pendingEvent;
        if (!event) {
          const out = withGoal(clone);
          out.sandboxActive = true;
          out.rehearsed = false;
          out.reason = "The sandbox is offering no away-event choice right now; fast-forward first.";
          return out;
        }
        const projection = typeof window.__rehearseSandboxChoice === "function"
          ? window.__rehearseSandboxChoice(option)
          : null;
        if (!projection) {
          const out = withGoal(clone);
          out.sandboxActive = true;
          out.rehearsed = false;
          out.reason = `"${option}" is not one of the options the sandbox is offering.`;
          return out;
        }
        const projected = typeof window.__getSandboxClone === "function" ? window.__getSandboxClone() : clone;
        const out = withGoal(projected || clone);
        out.sandboxActive = true;
        out.rehearsed = true;
        out.option = projection.optionId;
        out.effect = projection.effect;
        out.woodRate = projection.woodRate;
        out.stoneRate = projection.stoneRate;
        // The happening being rehearsed, and the real save's own decision read
        // straight from the engine — proof for the caller that the rehearsal
        // changed only the clone and left the real choice waiting.
        out.event = event;
        out.realPendingEvent = getState().pendingEvent;
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