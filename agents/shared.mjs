/**
 * Shared utilities for agent runner scripts.
 *
 * Standard agent response envelope:
 *   { status: "success"|"error", summary: string, outcome?: string, data: object }
 *
 * Outcome values for gate agents:
 *   "approve" — yes, proceed
 *   "reject"  — no, stop
 *   "revise"  — needs changes
 *   "skip"    — nothing to do
 */

import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, relative, extname, sep } from "path";
import fs from "fs";
import os from "os";
import http from "http";
import {
  createAgentSession,
  createBashToolDefinition,
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// Two layers below this one. shared.mjs re-exports both so the existing
// `from "./shared.mjs"` imports keep working, but new code should import from
// the specific module — that is the point of having split them.
import { log, appendJobSummary, errorData, getRunLog, getTicketOutcomes, truncate } from "./log.mjs";

export {
  log,
  logGroup,
  withLogGroup,
  appendJobSummary,
  truncate,
  errorData,
  getRunLog,
  recordTicket,
} from "./log.mjs";
export {
  cloneWiki,
  getWikiDir,
  wikiPath,
  readPage,
  commitToWiki,
  readVision,
  readChangelog,
  appendChangelogEntry,
  writePage,
  writeStory,
} from "./wiki.mjs";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, "..");
export const promptsDir = join(__dirname, "prompts");

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

// Text models tried in order — on a rate-limit / error / empty response, fall
// through to the next. Free models share tight, shared limits, so a fallback
// chain matters far more than retrying one model.
//
// Both entries are PAID. An exhausted balance or a hit spend cap surfaces as an
// ordinary request error, which isDailyQuotaExhausted recognises and the
// fall-through below already handles — and since that refusal is account-wide, it
// stops the chain rather than walking it.
// These are pi registry ids (provider/id); override via env TEXT_MODEL
// (comma-separated). The chain itself lives in agents/models.json, as DATA rather
// than a literal here, so tooling can read and assert it without parsing prose.
export const MODELS_FILE = join(__dirname, "models.json");

/** The configured chain as [{ id, why }] — the file's order, which is meaningful. */
export function readModelChain() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MODELS_FILE, "utf-8"));
    return (Array.isArray(parsed.text) ? parsed.text : []).filter((m) => m && m.id);
  } catch (e) {
    // Never fatal, and deliberately NOT log(): this runs while the module is still
    // initializing (TEXT_MODELS below), before the logger's own state exists.
    // An unreadable file degrades to auto-discovery in resolveTextModels(), the
    // same path a fully rotated-out chain takes.
    console.log(`WARN: model chain: could not read ${MODELS_FILE} (${e.message}) — falling back to auto-discovery.`);
    return [];
  }
}

/** Write the chain back, preserving the file's `_comment`. Used by pi-update.mjs. */
export function writeModelChain(entries) {
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(MODELS_FILE, "utf-8"));
  } catch { /* writing a fresh file is fine */ }
  // `paid` rides along because dropping it would silently re-arm the free-only
  // assertion in model-check.mjs, and the next repair would evict a head that is
  // billing money on purpose.
  const payload = {
    ...existing,
    text: entries.map(({ id, why, paid }) => (paid ? { id, paid, why } : { id, why })),
  };
  fs.writeFileSync(MODELS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

// These ids must exist in pi's bundled model snapshot (pi-ai's
// models.generated.js) — the registry is NOT fetched live from OpenRouter, so
// an id pi doesn't know is skipped, not requested. `node agents/model-check.mjs`
// asserts the whole chain against the installed pi, and the weekly pi-update
// workflow runs it on every bump, because pi's free lineup rotates.
//
// TWO entries, and the second one is the point. A Reviewer drawn from the same
// model that wrote the code is re-rolling one opinion, so preferDifferentModel
// rotates the chain to put a different family first — which it can only do if
// there is a different family in it. See models.json for why these two.
//
// It is NOT a cost ladder. The five free models that used to sit below the head
// were fallbacks for an exhausted free tier that no longer bounds anything, and
// each one cost a wasted request on the way down.
export const TEXT_MODELS = (
  process.env.TEXT_MODEL || readModelChain().map((m) => m.id).join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Back-compat: the historical single-model default is just the head of the chain.
export const MODEL_ID = TEXT_MODELS[0];

// Never send thinkingLevel "off": both configured models are reasoning models,
// and some endpoints reject a disabled-reasoning request
// outright ("Reasoning is mandatory for this endpoint and cannot be disabled",
// HTTP 400) — a wasted request against the daily cap. "low" is the real floor.
export const MIN_THINKING_LEVEL = "low";

// Default kickoff turn when a caller doesn't supply one. The agent's full role
// lives in the system prompt; this just tells it to begin.
const DEFAULT_TASK =
  "Carry out the task described in your instructions now, then respond with the required JSON object and nothing else.";

// Meta-routers dispatch to an arbitrary underlying model, so a run using one is
// not reproducible — never auto-discover them.
export const META_ROUTER_IDS = new Set(["auto", "openrouter/free", "openrouter/fusion"]);

// pi's model/auth runtime. Creation is async and reads ~/.pi auth + the bundled
// model snapshot, so it's built once and shared by every model call in the run.
// Credentials still come from OPENROUTER_API_KEY via pi-ai's env lookup.
let modelRuntimePromise;
function getModelRuntime() {
  // No network refresh: resolve ids against pi's bundled snapshot, so a run's
  // model lineup can't shift underneath it mid-flight.
  modelRuntimePromise ??= ModelRuntime.create({ allowModelNetwork: false });
  return modelRuntimePromise;
}

const modelIdOf = (m) => `${m.provider}/${m.id}`;

/**
 * True when an error means the ACCOUNT cannot pay, rather than one model failing.
 *
 * This is THE stop signal: the pipeline no longer predicts its own spend from a
 * ledger, so a provider refusing to bill is how it learns the money is gone. It
 * stops the chain, because an account-wide refusal applies to every model and
 * falling through would burn one request per model to fail identically.
 *
 * DELIBERATELY NARROW, because the cost of a false positive is high and was paid
 * on 2026-09-04: a transient failure from the second model was read as "the
 * account is out of credits", so instead of retrying, four tickets were abandoned
 * and the run failed — with $30 of $40 still on the key. Two patterns caused it
 * and are gone:
 *
 *   - `insufficient_quota` — upstream providers use it for THEIR capacity limits,
 *     which is a transient condition and nothing to do with the buyer's balance.
 *   - a bare `402` anywhere in the message — far too easy to hit by accident, and
 *     `err.status` already covers the real thing.
 *
 * What remains has to be about money: a 402 status (Payment Required, which is
 * unambiguous), wording naming credits or a balance, or the free tier's per-day
 * request cap, which still applies if a `:free` id is ever configured again.
 *
 * Anything else is a model failure. Model failures get retried; this does not.
 * When in doubt, return false — a wasted retry costs one request, and a wrong
 * "we are out of money" costs the ticket.
 */
export function isDailyQuotaExhausted(err) {
  if (err?.quotaExhausted) return true; // already recognised and re-labelled once
  if (err?.status === 402) return true;
  return /free-models-per-day|free_models_per_day|insufficient credits|requires more credits|negative balance|exceeded your .{0,40}(credit|spend|budget)/i.test(
    err?.message || ""
  );
}

// ---------------------------------------------------------------------------
// Session limits — two ceilings on ONE agent session, and nothing above them.
//
// There is deliberately no per-run or per-day request budget here any more. Spend
// is bounded where it can actually be enforced: a spend cap on the OpenRouter key
// itself. Everything this module used to do — a per-process allowance, a shared
// daily ledger on the wiki, a blind budget for when that ledger was unreachable —
// was an attempt to PREDICT the account's remaining balance from inside the
// pipeline, and the prediction was the fragile part. Four places could stop a run,
// three of them had each been wrong at least once, and the day's real ceiling was
// a sum of numbers set by hand in eight workflow files.
//
// The provider is the authority on the balance, so let it answer: a refusal comes
// back as an error, isDailyQuotaExhausted recognises it, and runAgent stops the
// chain. One stop signal, and it cannot disagree with the truth.
//
// What survives are the two limits that were never about money. Both bound a
// SINGLE session, and both exist because of a specific failure.
// ---------------------------------------------------------------------------

// Hard ceiling on TURNS INSIDE one session. Nothing else stops a session that is
// looping rather than working: a Scout once ran 101 turns without producing a
// plan. 40 is ~4x the 8-10 turns a healthy session takes on a merged ticket, so it
// never fires on real work; it only stops a loop.
export const MAX_SESSION_TURNS = Number(process.env.MAX_SESSION_TURNS || 40);

// The same guard in the other unit the runner can kill us over. A turn cap does
// nothing about a session that is slow rather than looping, and the runner's job
// timeout does not negotiate: the Product Owner was killed at 20 minutes, losing
// the whole session.
//
// Which limit bites first still matters. An agent that stops itself closes its PR
// cleanly and lets the next ticket continue; an agent stopped by the runner leaves
// an orphaned branch. So this must stay comfortably under every job's
// timeout-minutes — see the workflows, where the job cap is 2-3x this.
export const MAX_SESSION_MINUTES = Number(process.env.MAX_SESSION_MINUTES || 12);

let modelRequestCount = 0;

// The model that produced this run's last usable answer. Read by callers that
// want the NEXT agent to be a different one — see preferDifferentModel.
let lastModelUsed = null;

/** The model behind the most recent usable answer, or null. */
export function getLastModelUsed() {
  return lastModelUsed;
}

// Agent TURNS, which is what OpenRouter actually charges: one completion request
// per turn of the agentic loop, so a session that makes 20 tool calls costs ~20
// requests while modelRequestCount above records 1.
//
// Reported, not enforced against: the run summary says what a run cost so a
// regression in cost-per-ticket has somewhere to show up. modelRequestCount above
// is SESSIONS, and the two differ by an order of magnitude — conflating them is
// the ~16x accounting error this counter exists to have fixed.
let modelTurnCount = 0;

/** Real OpenRouter requests this run made — one per agent turn, not per session. */
export function getModelTurnCount() {
  return modelTurnCount;
}

/**
 * Every model pi knows, as [{ provider, id, cost, ... }]. Throws if the registry
 * can't be read — callers that must not fail use getAllModels() instead.
 *
 * Reads pi's BUNDLED snapshot with no network and no credentials, which is what
 * makes model-check.mjs free to run on every PR.
 */
export async function listRegistryModels() {
  return (await getModelRuntime()).getModels();
}

/** A registry model's chain id (`provider/id`). */
export const registryModelId = modelIdOf;

/** Every model pi knows, or null when the runtime can't be read. */
async function getAllModels() {
  try {
    return (await getModelRuntime()).getModels();
  } catch (e) {
    log("warn", "Model chain: could not read pi's registry.", errorData(e));
    return null;
  }
}

/**
 * Resolve the text-model chain against pi's ACTUAL registry, so a pi upgrade that
 * rotates an id out degrades to the surviving entries instead of throwing on the
 * first one. Returns an ordered list of ids, possibly empty.
 *
 * An empty result is deliberately fatal upstream (runAgent throws). This used to
 * auto-discover free OpenRouter models so the agents "kept running" — which is
 * the quiet demotion model-check.mjs exists to catch, and it is worse now that the
 * configured models are chosen for cost, coding ability and provider family. A
 * loud failure is better than a day's work done by an arbitrary model.
 */
/**
 * The chain, reordered so `avoid` is tried LAST.
 *
 * Review is only worth its request if it can disagree, and a Reviewer drawn from
 * the same model that just wrote the code is largely re-rolling one opinion — the
 * build/review loop then buys three correlated passes. Rotating the chain costs
 * nothing and makes the second read independent whenever the chain has more than
 * one working entry.
 *
 * It never REMOVES the avoided model: a chain of one, or a day when everything
 * above it is failing, still has to produce a review. A correlated reviewer beats
 * no reviewer, and the alternative is shipping unreviewed.
 */
export function preferDifferentModel(chain, avoid) {
  if (!avoid) return chain;
  const others = chain.filter((id) => id !== avoid);
  return others.length ? [...others, ...chain.filter((id) => id === avoid)] : chain;
}

async function resolveTextModels() {
  const all = await getAllModels();
  if (!all) {
    log("warn", "Model chain: using configured ids as-is.");
    return TEXT_MODELS;
  }
  const present = [];
  for (const id of TEXT_MODELS) {
    if (all.some((m) => modelIdOf(m) === id)) present.push(id);
    else log("warn", `Model chain: "${id}" is not in pi's registry (rotated out / version drift?) — skipping it.`);
  }
  if (!present.length) {
    log("error", "Model chain: NO configured text model is in pi's registry — fix agents/models.json (`node agents/model-check.mjs` says which entries are gone).");
  }
  return present;
}

/**
 * The first configured model that accepts image input, or null when none does.
 *
 * Vision is a property of the model, not of the chain: `deepseek-v4-flash` at the
 * head is text-only, and pi drops image content for a model whose registry entry
 * does not declare `input: image` — silently, which is the failure mode worth
 * avoiding. So a caller that wants to send a picture pins the model this returns
 * rather than trusting whichever entry the chain reaches first.
 *
 * Returns null rather than throwing: an agent that can see is an upgrade to a
 * report, never a precondition for one, so every caller degrades to text.
 */
export async function firstVisionModel() {
  const all = await getAllModels();
  if (!all) return null;
  for (const id of await resolveTextModels()) {
    const model = all.find((m) => modelIdOf(m) === id);
    if (model && (model.input || []).includes("image")) return id;
  }
  return null;
}

/**
 * Run a one-shot agent. With no explicit `modelId`, tries the TEXT_MODELS chain
 * in order until one answers, so a provider having a bad afternoon costs a retry
 * rather than the run. Pass an explicit `modelId` to pin a single model — which is
 * what sending `images` requires, since only some models can see (firstVisionModel).
 *
 * @param {object} opts
 * @param {string} [opts.label]          - Name for logging.
 * @param {string} opts.systemPrompt     - The agent's role/instructions. Set as the
 *                                          actual system prompt (not a user message).
 * @param {string} [opts.task]           - The user turn that kicks the agent off.
 * @param {string[]} [opts.tools]        - Allowed tool names.
 * @param {string} [opts.thinkingLevel]  - "off" | "low" | "medium" | "high".
 * @param {string} [opts.modelId]        - Pin a single model; omit to use the chain.
 * @param {object[]} [opts.images]       - Image parts ({ type, data, mimeType }) to
 *                                          attach to the kickoff turn. Requires a
 *                                          model that accepts image input.
 */
export async function runAgent(opts) {
  const { modelId, label = "Agent", expectJson = true, avoidModel = null } = opts;

  // Explicit model: run exactly that one (caller owns any fallback, e.g. vision).
  if (modelId) return runAgentOnce(opts);

  // No explicit model: try each model in the chain until one returns content.
  const chain = preferDifferentModel(await resolveTextModels(), avoidModel);
  if (!chain.length) {
    throw new Error(
      "No usable text model in pi's registry. " +
        "Check OPENROUTER_API_KEY and TEXT_MODEL."
    );
  }
  let lastErr;
  for (const id of chain) {
    const attemptLabel = chain.length > 1 ? `${label} (${id})` : label;
    try {
      const out = await runAgentOnce({ ...opts, modelId: id, label: attemptLabel });
      if ((out || "").trim()) {
        // "Non-empty" is not the same as "usable". A model can answer with a
        // leaked tool-call tag or a paragraph of prose where the envelope should
        // be — which used to end the run on the first model, because the chain
        // only fell through on errors and empty strings. Unusable is a failure.
        if (!expectJson || containsParseableJSON(out)) {
          // Only a model whose answer is actually USED counts as the one to avoid
          // next; one that answered unusably and fell through did not write
          // anything the next agent could be biased by.
          lastModelUsed = id;
          return out;
        }
        log("warn", `${label}: ${id} answered without usable JSON — trying next model.`, {
          raw: out.length > 120 ? out.slice(0, 120) + "…" : out,
        });
      } else {
        log("warn", `${label}: ${id} returned empty — trying next model.`);
      }
    } catch (e) {
      lastErr = e;
      // A capped session is not the fault of the model that ran it: a runaway
      // usually repeats, so walking the chain buys another MAX_SESSION_TURNS per
      // model to watch the same loop. Rethrow the original so the marker survives
      // for callers that branch on it.
      if (e.sessionCapped) throw e;
      // A billing refusal is account-wide — every remaining model shares the same
      // balance, so continuing would burn one request per model to fail
      // identically.
      if (isDailyQuotaExhausted(e)) {
        // Log the provider's OWN words before replacing them. The rewrite used to
        // discard them, and on 2026-09-04 that left 806 lines of run log in which
        // the actual failure appeared nowhere: every line said "OpenRouter's daily
        // free-request cap is exhausted ... resets at 00:00 UTC" on a paid key
        // with $30 on it, and which pattern had matched was unknowable.
        log("error", `${label}: ${id} refused the request as a billing failure — stopping the chain.`, errorData(e));
        const err = new Error(
          `${label}: ${id} refused the request as a billing failure, so the ` +
            `remaining ${chain.length - chain.indexOf(id) - 1} model(s) were not tried — ` +
            `they bill the same account. Check the balance on OPENROUTER_API_KEY. ` +
            `The provider said: ${truncate(String(e?.message || e), 300)}`
        );
        // The rewritten message no longer matches the provider's wording, so
        // isDailyQuotaExhausted would stop recognising its own error. Mark it.
        err.quotaExhausted = true;
        throw err;
      }
      log("warn", `${label}: ${id} failed — trying next model.`, errorData(e));
    }
  }
  throw new Error(
    `${label}: no model in the chain produced a usable answer.` +
      (lastErr ? ` Last error: ${lastErr.message}` : "")
  );
}

// ---------------------------------------------------------------------------
// What an agent's tools can reach
// ---------------------------------------------------------------------------

// The variables a tool subprocess keeps. An ALLOWLIST, because the agents read
// text strangers wrote — Ideas, issues, ticket bodies — and pi's bash tool
// otherwise hands every child the runner's whole environment, so one injected
// `env` would print OPENROUTER_API_KEY and the PAT into the transcript. A
// denylist fails open: the next secret a workflow adds is exposed until someone
// remembers to name it. What survives is what a shell, git, node, npm and
// Playwright need to find themselves and each other.
const TOOL_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TZ",
  "TMPDIR",
  "CI",
  "NODE_ENV",
  "PLAYWRIGHT_BROWSERS_PATH",
]);
// PI_* is pi's own session metadata (model, session id), which its bash tool
// advertises to the agent; it carries nothing secret.
const TOOL_ENV_PREFIXES = ["LC_", "XDG_", "PI_"];

/** The subset of `env` a tool subprocess may see — see TOOL_ENV_NAMES. */
export function toolSubprocessEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => TOOL_ENV_NAMES.has(name) || TOOL_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
    )
  );
}

/**
 * True when a fully resolved path lies inside one of `roots`.
 *
 * The read tool needs this even with a clean bash env, because read runs IN the
 * runner's own process: `/proc/self/environ` through it is the unfiltered
 * environment, secrets and all. Callers pass a realpath so a symlink in the
 * checkout cannot point back out.
 */
export function isInsideRoots(realPath, roots) {
  return roots.some((root) => realPath === root || realPath.startsWith(root + sep));
}

// The repo is what agents work on; the temp dir is where pi's bash tool spills
// output too long to return, and it tells the agent to read it from there.
const readableRoots = () => [fs.realpathSync(repoRoot), fs.realpathSync(os.tmpdir())];

async function assertReadable(absolutePath) {
  const realPath = await fs.promises.realpath(absolutePath);
  if (!isInsideRoots(realPath, readableRoots())) {
    throw new Error(`${absolutePath} is outside the repository — the read tool only reads the checkout.`);
  }
  return realPath;
}

// Replaces pi's built-in read and bash by name (a custom tool of the same name
// wins in pi's registry); each agent's `tools` list still decides which it gets.
function confinedTools() {
  return [
    createReadToolDefinition(repoRoot, {
      operations: {
        access: async (path) => fs.promises.access(await assertReadable(path), fs.constants.R_OK),
        readFile: async (path) => fs.promises.readFile(await assertReadable(path)),
        detectImageMimeType: detectSupportedImageMimeTypeFromFile,
      },
    }),
    createBashToolDefinition(repoRoot, {
      spawnHook: (context) => ({ ...context, env: toolSubprocessEnv(context.env) }),
    }),
  ];
}

/**
 * Run a single one-shot agent against exactly one model. The chain logic lives in
 * runAgent; this is the per-model attempt.
 */
async function runAgentOnce({
  label = "Agent",
  systemPrompt,
  task = DEFAULT_TASK,
  tools = ["read"],
  thinkingLevel = MIN_THINKING_LEVEL,
  modelId = MODEL_ID,
  images = [],
}) {
  // Clamp rather than trust the caller — "off" costs a request and returns 400
  // on reasoning-mandatory endpoints (see MIN_THINKING_LEVEL).
  if (thinkingLevel === "off") thinkingLevel = MIN_THINKING_LEVEL;
  const modelRuntime = await getModelRuntime();
  const model = modelRuntime.getModels().find((m) => modelIdOf(m) === modelId);
  if (!model) {
    throw new Error(
      `Model "${modelId}" not found in the registry. ` +
        `Check OPENROUTER_API_KEY and that the model id is still valid.`
    );
  }

  // Say so rather than sending pictures to a model that cannot see them. pi drops
  // image parts for a text-only model without complaint, which would leave an
  // agent describing a screenshot it was never shown — the most expensive kind of
  // confident answer. The caller picks its model with firstVisionModel(); this is
  // the assertion that it did.
  if (images.length && !(model.input || []).includes("image")) {
    log(
      "warn",
      `${label}: "${modelId}" does not accept image input — dropping ${images.length} image(s) and running text-only.`
    );
    images = [];
  }

  // Set our role as the real system prompt and run with a clean, deterministic
  // resource set — no ambient skills/extensions/context files from disk (~/.pi),
  // and no default APPEND_SYSTEM.md. Discovery is rooted at the repo, matching
  // the session cwd the agent actually reads and edits in.
  const loader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir: repoRoot,
    systemPrompt,
    appendSystemPrompt: [],
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  const startTime = Date.now();
  // Count the attempt, not the success — a failed call is charged either way.
  modelRequestCount++;
  // Sessions and turns are different units and must never share a fraction: this
  // used to read `request N/BUDGET` with a session count over a turn budget, which
  // is the exact confusion that let a run authorise ~16x what its ceiling said.
  log(
    "info",
    `${label} agent started (session ${modelRequestCount} this run; ` +
      `${modelTurnCount} request(s) spent so far)`
  );

  return loader.reload().then(() =>
    createAgentSession({
      cwd: repoRoot,
      sessionManager: SessionManager.inMemory(),
      resourceLoader: loader,
      model,
      thinkingLevel,
      modelRuntime,
      tools,
      customTools: confinedTools(),
    }).then(({ session }) => {
      let output = "";
      // Turns spent so far, read live. The session's own message list is the only
      // honest source — an assistant message IS a charged completion, whatever the
      // event that revealed it — so count from state on every event rather than
      // trusting one event type to mean "a turn happened".
      let turnsSeen = 0;
      let capHit = false;
      // Turns already added to modelTurnCount. Spend is charged AS IT HAPPENS
      // rather than in one lump when the session settles, because a session that
      // never settles — the runner's timeout, a cancel — would otherwise be spent
      // but uncounted, and the signal handler would have nothing to write down.
      // It also makes the budget checks honest mid-session instead of only
      // between them.
      let chargedTurns = 0;
      const chargeTurns = (turns) => {
        if (turns <= chargedTurns) return;
        modelTurnCount += turns - chargedTurns;
        chargedTurns = turns;
      };

      // Stop a session that is slow rather than looping, before the runner does.
      // Aborting here is worth real money: the caller gets its partial output, the
      // spend is recorded, and the run ends on its own terms.
      const sessionDeadline = setTimeout(() => {
        if (capHit) return;
        capHit = true;
        log(
          "warn",
          `${label}: hit the ${MAX_SESSION_MINUTES}-minute session cap — aborting it. ` +
            "Stopping here keeps the job's own timeout from killing the run mid-session."
        );
        session.abort().catch(() => {});
      }, MAX_SESSION_MINUTES * 60 * 1000);
      // Never hold the process open on this timer alone.
      sessionDeadline.unref?.();

      session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
        }
        // Streaming deltas arrive thousands of times per turn and never change the
        // message COUNT, so don't walk the list for them — only for the events that
        // can mean a message was appended.
        if (event.type === "message_update" || event.type === "bash_execution_update") return;
        turnsSeen = (session.state?.messages || []).filter(
          (m) => m.role === "assistant"
        ).length;
        chargeTurns(turnsSeen);
        if (!capHit && turnsSeen >= MAX_SESSION_TURNS) {
          // Abort once, then let the normal completion path record the spend. A
          // session this long is looping, not thinking: every further turn is a
          // charged request the run will not get a merge out of.
          capHit = true;
          log(
            "warn",
            `${label}: hit the ${MAX_SESSION_TURNS}-turn session cap — aborting it. ` +
              "The session is looping; stopping it here protects the day's remaining requests."
          );
          session.abort().catch(() => {});
        }
      });

      // Settle up, whichever way the session ends. The turns were charged as they
      // arrived, so this only catches whatever the last event missed — a final
      // assistant message can land with no further event to observe it.
      //
      // Reconciling rather than adding is what keeps this idempotent. Both paths
      // below used to add the whole count independently, so a session that threw
      // INSIDE the success path (a model error, say) was billed twice in our own
      // accounting — over-reporting, which starves later runs as surely as
      // under-reporting overspends. Returns the turn count so the caller can log it.
      const recordSpend = () => {
        clearTimeout(sessionDeadline);
        const turns = (session.state?.messages || []).filter(
          (m) => m.role === "assistant"
        ).length;
        chargeTurns(turns);
        return turns;
      };

      // With images, the kickoff turn has to be a content ARRAY, which prompt()
      // does not take — sendUserMessage does, and triggers a turn the same way.
      const kickoff = images.length
        ? session.sendUserMessage([{ type: "text", text: task }, ...images])
        : session.prompt(task);

      return kickoff
        .then(() => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const messages = session.state.messages;
          const lastAssistant = [...messages].reverse().find(
            (m) => m.role === "assistant"
          );
          // The model can fail without throwing — the error lands on the
          // assistant message as stopReason "error". Surface it loudly instead
          // of returning empty output (which looks like an unparseable response).
          if (lastAssistant && lastAssistant.stopReason === "error") {
            recordSpend();
            session.dispose();
            const detail = lastAssistant.errorMessage || "unknown error";
            // A free slug that OpenRouter has since moved behind payment. Called
            // out by name because model-check.mjs structurally CANNOT catch it:
            // that check reads pi's BUNDLED snapshot, which still reports the id
            // as costing 0/0 long after the live provider stopped serving it
            // free. Without this the failure reads as a generic model error and
            // the dead entry sits in the chain wasting a request per fallthrough.
            if (/unavailable for free|available for free/i.test(detail)) {
              log(
                "error",
                `${label}: "${modelId}" is NO LONGER FREE at OpenRouter, though pi's snapshot still lists it as free. ` +
                  `model-check.mjs cannot see this — remove or repoint the entry in agents/models.json by hand.`
              );
            }
            throw new Error(`${label} model call failed: ${detail}`);
          }
          if (lastAssistant && lastAssistant.content) {
            const fullText = Array.isArray(lastAssistant.content)
              ? lastAssistant.content
                  .filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("")
              : lastAssistant.content;
            if (fullText) output = fullText;
          }
          // A session is ONE budget unit but many OpenRouter requests: the
          // agentic loop issues a completion per turn, so every tool call is
          // another charge against the daily cap. Count assistant messages —
          // that's one per turn — because that is what the account is billed for.
          const turns = recordSpend();
          log(
            "info",
            `${label} agent completed in ${elapsed}s — ${turns} turn(s), ` +
              `${modelTurnCount} request(s) this run`
          );
          session.dispose();
          // An aborted session that produced nothing is a failure, and a loud one.
          // Marked as capped rather than a model fault so runAgent does NOT walk
          // the rest of the chain — a runaway usually repeats, and proving it costs
          // another MAX_SESSION_TURNS per model.
          if (capHit && !output.trim()) {
            const err = new Error(
              `${label} was capped without answering (${turns} turn(s) spent) — ` +
                `it hit either the ${MAX_SESSION_TURNS}-turn or the ` +
                `${MAX_SESSION_MINUTES}-minute session cap; the warning above says which.`
            );
            err.sessionCapped = true;
            throw err;
          }
          return output;
        })
        .catch((err) => {
          // A session that throws still spent every turn it took to get there —
          // and retry loops are exactly where the cap goes — so count before
          // rethrowing rather than under-reporting the expensive case.
          recordSpend();
          session.dispose();
          // An abort can surface here instead of above, depending on where the
          // session was when it was stopped. Mark it either way, so runAgent stops
          // rather than paying another MAX_SESSION_TURNS per remaining model to
          // watch the same runaway repeat.
          // Guarded: modules run in strict mode, where setting a property on a
          // thrown primitive is a TypeError that would mask the real failure.
          if (capHit && err && typeof err === "object") err.sessionCapped = true;
          throw err;
        });
    })
  );
}

export function printRunSummary(title = "Run Summary") {
  const runLog = getRunLog();
  const ticketOutcomes = getTicketOutcomes();
  const errors = runLog.filter((e) => e.level === "error").length;
  const warns = runLog.filter((e) => e.level === "warn").length;
  const result = errors ? "errors" : warns ? "completed with warnings" : "clean";

  const oneLine = (s) => String(s).replace(/\s*\n\s*/g, " ").trim();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const ticketLine = (t) =>
    `${cap(t.status)} — #${t.number} ${t.title}${t.detail ? ` (${oneLine(t.detail)})` : ""}`;

  // Compact stdout recap — result, the tickets we touched, then any warn/error.
  // The full per-line story already streamed live, so don't replay it.
  // Both units, because they differ by an order of magnitude and only the second
  // one is what the provider charges. This run only: the account's own spend is
  // the provider's to report, and its cap is the provider's to enforce.
  const spend =
    `${modelRequestCount} agent session(s), ${modelTurnCount} model request(s) this run`;
  console.log(`\n=== ${title}: ${result} · ${errors} error(s), ${warns} warning(s) · ${spend} ===`);
  ticketOutcomes.forEach((t) => console.log(`  ${ticketLine(t)}`));
  for (const entry of runLog) {
    if (entry.level === "warn" || entry.level === "error") {
      console.log(`  ${entry.level.toUpperCase()}: ${entry.message}`);
    }
  }

  // The GitHub job-summary panel reports the result line and, below it, the
  // tickets this run affected — that's the whole story worth keeping there.
  const md = [`## ${title}`, "", `${result} · ${errors} error(s) · ${warns} warning(s) · ${spend}`, ""];
  if (ticketOutcomes.length) {
    ticketOutcomes.forEach((t) => md.push(`- ${ticketLine(t)}`));
  } else {
    md.push("_No tickets affected._");
  }
  appendJobSummary(md.join("\n"));
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

export function loadPrompt(name) {
  const raw = fs.readFileSync(join(promptsDir, `${name}.md`), "utf-8");
  // Inline shared partials referenced as {{include:partial-name}} (one level).
  return raw.replace(/\{\{include:([\w-]+)\}\}/g, (_, partial) =>
    fs.readFileSync(join(promptsDir, `${partial}.md`), "utf-8").trim()
  );
}

/**
 * Substitute `{{NAME}}` placeholders; a name with no replacement stays as written.
 *
 * One pass with a replacer function, and both halves matter. The values are
 * diffs, files and issue bodies, so as a replacement STRING a `$&` or `$'` in
 * them expanded into the template around it. And substituting one key at a time
 * meant a value that happened to contain `{{VISION}}` — a prompt file in a diff,
 * a stranger's PR body — was expanded by the next key, splicing prompt text in
 * wherever the value said.
 */
export function fillTemplate(template, replacements) {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name) =>
    Object.hasOwn(replacements, name) ? String(replacements[name]) : placeholder
  );
}

// ---------------------------------------------------------------------------
// JSON extraction + envelope validation
// ---------------------------------------------------------------------------

export function extractJSON(label, text) {
  // Try to extract from a fenced code block first
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = blockMatch ? blockMatch[1].trim() : text.trim();

  // Try direct parse first
  try {
    return JSON.parse(candidate);
  } catch { /* fall through */ }

  // Try to find a complete JSON object by matching braces.
  const jsonObj = extractFirstJSONObject(candidate);
  if (jsonObj) {
    try {
      return JSON.parse(jsonObj);
    } catch { /* fall through */ }
  }

  const snippet = text.length > 200 ? text.slice(0, 200) + "…" : text;
  log("warn", `${label}: output could not be parsed as JSON`, { raw: snippet });
  return null;
}

/**
 * Quietly test whether text contains a parseable JSON object, for deciding
 * whether to accept a model's answer or fall through to the next model. Unlike
 * extractJSON this logs nothing — a rejected attempt is routine, not a problem.
 */
function containsParseableJSON(text) {
  const t = (text || "").trim();
  if (!t) return false;
  const block = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = block ? block[1].trim() : t;
  try {
    JSON.parse(candidate);
    return true;
  } catch { /* fall through */ }
  const obj = extractFirstJSONObject(candidate);
  if (!obj) return false;
  try {
    JSON.parse(obj);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the first complete JSON object from a string by counting brace depth.
 * Handles braces inside JSON strings correctly.
 */
function extractFirstJSONObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse and validate the standard agent response envelope + data shape.
 *
 * @param {string} label - Agent name for logging
 * @param {string} text - Raw agent output
 * @param {object} options
 * @param {boolean} [options.requireOutcome=true] - Whether outcome field is required
 * @param {string[]} [options.requiredDataFields] - Required fields in data object
 * @returns {object|null} Parsed response or null on failure
 */
export function extractAgentResponse(label, text, { requireOutcome = true, requiredDataFields = [] } = {}) {
  const parsed = extractJSON(label, text);
  if (!parsed) return null;

  if (!parsed.status || !parsed.summary || !parsed.data) {
    log("warn", `${label}: response missing required envelope fields (status, summary, data)`);
    return null;
  }

  if (requireOutcome && !parsed.outcome) {
    log("warn", `${label}: response missing required envelope field: outcome`);
    return null;
  }

  if (parsed.status === "error") {
    log("warn", `${label}: ${parsed.summary}`);
    return null;
  }

  // Validate data shape
  if (requiredDataFields.length > 0) {
    const missing = requiredDataFields.filter((f) => !(f in parsed.data));
    if (missing.length > 0) {
      log("warn", `${label}: data missing required fields: ${missing.join(", ")}`);
      return null;
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

// git and gh are always run from an argv array, never a shell string. Commit
// messages, issue and PR titles, and branch names all carry model-written text,
// and this runner holds a PAT: through a shell, a backtick or `$(...)` in any of
// them is a command, and escaping only `"` (which is what the old string form
// did) stops none of it. With execFileSync there is no shell, so no quoting rules
// to get wrong — every argument arrives exactly as written.

export function gitExec(argv, opts = {}) {
  return execFileSync("git", argv, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024, ...opts }).toString().trim();
}

export function ghExec(argv, opts = {}) {
  return execFileSync("gh", argv, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024, ...opts }).toString();
}

let gitIdentityConfigured = false;

/**
 * Set the committer identity once per process. Idempotent — safe to call from
 * any code path that is about to create a commit.
 */
export function configureGitIdentity() {
  if (gitIdentityConfigured) return;
  gitExec(["config", "user.name", "github-actions[bot]"]);
  gitExec(["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
  gitIdentityConfigured = true;
}

export function slugify(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function createBranchName(issueNumber, issueTitle, suggestion) {
  // A short run-scoped suffix keeps branch names unique across reruns so a
  // failed prior run on the same issue can't cause a non-fast-forward push.
  const runId = process.env.GITHUB_RUN_ID;
  const suffix = runId ? `-${runId}` : "";
  const base = issueNumber
    ? `agent/issue-${issueNumber}-${slugify(issueTitle) || "fix"}`
    : `agent/feature-${slugify(suggestion) || "change"}`;
  return `${base}${suffix}`;
}

/**
 * Delete a branch on origin if it exists. Best-effort — never throws.
 */
export function deleteRemoteBranch(branchName) {
  try {
    // Best-effort: the branch usually doesn't exist on origin (run-scoped names
    // are unique), so capture stderr rather than leak git's "remote ref does not
    // exist" to the console.
    gitExec(["push", "origin", "--delete", branchName], { stdio: "pipe" });
    log("info", `Deleted remote branch ${branchName}.`);
  } catch {
    // remote branch may not exist — fine
  }
}

export function createBranch(branchName) {
  gitExec(["fetch", "origin"]);
  gitExec(["checkout", "main"]);
  // Base the branch on the real remote tip, not a possibly-stale local main.
  gitExec(["reset", "--hard", "origin/main"]);
  // Clear any leftover branch of the same name from a prior failed run. With
  // run-scoped names this is usually a no-op, so capture stderr rather than leak
  // git's "branch not found" to the console.
  try {
    gitExec(["branch", "-D", branchName], { stdio: "pipe" });
  } catch {
    // local branch may not exist — fine
  }
  deleteRemoteBranch(branchName);
  gitExec(["checkout", "-b", branchName]);
  log("info", `Created branch: ${branchName}`);
}

export function mergeMainIntoBranch() {
  try {
    gitExec(["fetch", "origin"]);
    gitExec(["merge", "origin/main", "--no-edit"]);
    log("info", "Merged origin/main into branch — clean.");
    return { clean: true };
  } catch {
    const status = gitExec(["status", "--porcelain"]);
    const conflicted = status
      .split("\n")
      .filter((l) => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DD"))
      .map((l) => l.slice(3));
    log("warn", "Merge conflict when pulling main into branch", {
      conflictedFiles: conflicted,
    });
    return { clean: false, conflictedFiles: conflicted, statusOutput: status };
  }
}

export function abortMerge() {
  try {
    gitExec(["merge", "--abort"]);
    log("info", "Aborted merge.");
  } catch {
    // ignore — may not be in a merge
  }
}

/**
 * Throw away whatever an abandoned ticket left behind and stand on origin/main
 * again, with the ticket's local branch deleted.
 *
 * A ticket can be abandoned mid-anything: a verify that failed on uncommitted
 * edits, or a conflict-resolution agent that threw with the merge still open.
 * A plain `git checkout main` fails on either, and it used to fail silently, so
 * the NEXT ticket's createBranch hit the same dirty tree outside any handler and
 * took down the whole run.
 *
 * So this one throws. If the tree cannot be put back, no ticket after it can
 * start either, and the run should say so here rather than one ticket later.
 * `opts` reaches gitExec, which is how the tests point it at a scratch repo.
 */
export function returnToCleanMain(branchName, opts = {}) {
  const git = (argv) => gitExec(argv, { stdio: "pipe", ...opts });
  try {
    git(["merge", "--abort"]);
  } catch {
    // no merge in progress — the usual case
  }
  git(["reset", "--hard"]);
  git(["clean", "-fd"]);
  git(["checkout", "-f", "-B", "main", "origin/main"]);
  try {
    git(["branch", "-D", branchName]);
  } catch {
    // the branch was never created locally — fine
  }
}

// ---------------------------------------------------------------------------
// GitHub issue helpers
// ---------------------------------------------------------------------------

// Post a comment by piping the body over stdin: a long body can outgrow what
// fits in a single argument, and stdin has no such limit.
function ghComment(issueNumber, body) {
  ghExec(["issue", "comment", String(issueNumber), "--body-file", "-"], { input: body });
}

/**
 * Comment with what was actually done, then close the issue.
 *
 * @param {number} issueNumber
 * @param {object} info
 * @param {string} [info.summary]       - Builder's description of what changed (the "why/what").
 * @param {string} [info.commitMessage] - Commit subject line.
 * @param {string} [info.commitSha]     - Full commit SHA on main.
 */
export async function closeIssue(issueNumber, info = {}) {
  const { summary, commitMessage, commitSha } = info;

  const lines = ["## ✅ Resolved by the Devs", ""];
  if (summary) lines.push(summary, "");
  if (commitMessage) {
    const shortSha = commitSha ? `\`${commitSha.slice(0, 7)}\` — ` : "";
    lines.push(`**Commit:** ${shortSha}${commitMessage}`);
  }
  const body =
    lines.join("\n").trim() || "This issue has been addressed by the Devs.";

  try {
    ghComment(issueNumber, body);
    ghExec(["issue", "close", String(issueNumber)]);
    log("info", `Closed issue #${issueNumber}`);
  } catch (e) {
    log("warn", `Could not close issue #${issueNumber}`, errorData(e));
  }
}

export async function commentIssue(issueNumber, body) {
  try {
    ghComment(issueNumber, body);
  } catch (e) {
    log("warn", `Could not comment on issue #${issueNumber}`, errorData(e));
  }
}

/**
 * Fetch open issues live via gh. Throws when the listing fails.
 *
 * It used to return [] instead, and every caller read that as "the board is
 * empty": the Devs saw nothing to build, the PM groomed without dedup, and Health
 * judged an empty backlog. A failed lookup is not an empty board, so it is not
 * allowed to look like one.
 */
export function fetchOpenIssues() {
  let issues;
  try {
    issues = JSON.parse(
      ghExec(["issue", "list", "--state", "open", "--json", "number,title,body,labels,createdAt", "--limit", String(LISTING_LIMIT)])
    );
  } catch (e) {
    throw new Error(`Could not list open issues: ${e.message}`, { cause: e });
  }
  rejectTruncated(issues.length, "open issues");
  return issues;
}

// How many rows a listing asks gh for. Deliberately far above any real board:
// the point is not to page through thousands, it is that a listing which reaches
// this is known to be cut short rather than taken for the whole.
const LISTING_LIMIT = 1000;

/**
 * Throw when a listing came back at its limit.
 *
 * gh stops at --limit without saying so, and a truncated list reads as a complete
 * one: an open blocker past the cutoff looked shipped and released everything
 * waiting on it. Exactly at the limit is treated as cut short too — one false
 * alarm at a thousand rows is cheaper than one silent miss.
 */
function rejectTruncated(count, what, limit = LISTING_LIMIT) {
  if (count >= limit) {
    throw new Error(`Listing ${what} reached its limit of ${limit}, so it may be incomplete — raise the limit.`);
  }
}

// ---------------------------------------------------------------------------
// Milestones — the planning horizon
//
// Priority says which ticket comes first. It cannot say what the project is
// TRYING to do this month, and without that the backlog is filled by adjacency:
// every ticket is found next to whatever shipped last, each individually sound,
// and the aggregate has no shape. Three separate tickets about one butterfly's
// behaviour, discovered on three separate days, is what that looks like.
//
// GitHub's own milestones, rather than a wiki page, because the board and the
// issues already understand them — progress is visible without anything here
// counting it.
// ---------------------------------------------------------------------------

/**
 * The milestone the project is currently working toward, or null when none is
 * open. Throws when it cannot tell: "none is open" is what makes startMilestone
 * create one without closing the old, and two open milestones is no horizon.
 */
export function getCurrentMilestone() {
  let list;
  try {
    list = JSON.parse(ghExec(["api", "repos/{owner}/{repo}/milestones?state=open&sort=due_on&direction=asc"]));
  } catch (e) {
    throw new Error(`Could not read the open milestones: ${e.message}`, { cause: e });
  }
  if (!list.length) return null;
  const { title, description, number, open_issues: open, closed_issues: closed } = list[0];
  return { title, description, number, open, closed };
}

/**
 * Start a new milestone, closing whatever it replaces.
 *
 * One open milestone at a time, on purpose: two is not a horizon, it is a
 * backlog with headings. Returns the new one, or null when nothing changed.
 */
export function startMilestone(title, description) {
  if (!title) return null;
  try {
    const current = getCurrentMilestone();
    if (current && current.title === title) return current;
    const created = JSON.parse(
      ghExec(["api", "repos/{owner}/{repo}/milestones", "-f", `title=${title}`, "-f", `description=${description || ""}`])
    );
    if (current) {
      ghExec(["api", "--method", "PATCH", `repos/{owner}/{repo}/milestones/${current.number}`, "-f", "state=closed"]);
      log("info", `Milestones: closed "${current.title}" (${current.closed} of ${current.open + current.closed} shipped).`);
    }
    log("info", `Milestones: now working toward "${title}".`);
    return { title, description, number: created.number, open: 0, closed: 0 };
  } catch (e) {
    log("warn", `Milestones: could not start "${title}".`, errorData(e));
    return null;
  }
}

/** Put a ticket on the current milestone. Best-effort — never blocks grooming. */
export function setIssueMilestone(issueNumber, title) {
  if (!title) return;
  try {
    ghExec(["issue", "edit", String(issueNumber), "--milestone", title]);
  } catch (e) {
    log("warn", `Milestones: could not assign #${issueNumber}.`, errorData(e));
  }
}

// Stamped on every issue the pipeline creates (see createIssue), which makes its
// ABSENCE the reliable marker of a human-filed one. Absence is the better test
// precisely because no human action maintains it: there is no label to forget.
export const AGENT_LABEL = "agent";

/**
 * An issue a person filed, rather than the pipeline.
 *
 * Note the direction: this is not a label anyone adds, it is one the agents add
 * to their own. A ticket nobody stamped came from outside.
 */
export function isManualIssue(issue) {
  return !labelNames(issue).includes(AGENT_LABEL);
}

/**
 * Rewrite a ticket's body — how the Product Manager sharpens a human request
 * into something buildable instead of closing it for being unclear.
 */
export function rewriteIssueBody(issueNumber, body) {
  try {
    ghExec(["issue", "edit", String(issueNumber), "--body-file", "-"], { input: body });
    log("info", `Sharpened #${issueNumber} into a buildable ticket.`);
    return true;
  } catch (e) {
    log("warn", `Could not rewrite the body of #${issueNumber}.`, errorData(e));
    return false;
  }
}
// Marks Builder-filed code-health tickets so the PM (and humans) can spot them.
export const TECH_DEBT_LABEL = "tech-debt";

/**
 * True when an open ticket already carries this title, whatever state it is in.
 *
 * Pass the WHOLE open board, not the buildable candidates. The Devs used to check
 * only the tickets offered to the Scout, and a tech-debt ticket filed earlier is
 * rarely among them — it is unprioritized, waiting on something, parked, or
 * claimed by an open PR — so the same debt was filed again on every merge that
 * noticed it.
 */
export function isAlreadyTracked(title, openIssues) {
  const wanted = (title || "").toLowerCase().trim();
  return openIssues.some((issue) => (issue.title || "").toLowerCase().trim() === wanted);
}

const _ensuredLabels = new Set();
function ensureLabel(name, color = "ededed") {
  if (_ensuredLabels.has(name)) return;
  _ensuredLabels.add(name);
  try {
    ghExec(["label", "create", name, "--color", color, "--force"]);
  } catch {
    // exists / no perms — non-fatal
  }
}

/**
 * Create a new issue (body piped over stdin for safety). Always carries the
 * `agent` label; pass extra labels (e.g. tech-debt) as the third arg. Ensures
 * each label exists first. Returns the new issue number, or null.
 */
export function createIssue(title, body, labels = []) {
  const all = [AGENT_LABEL, ...labels];
  all.forEach((l) => ensureLabel(l, l === TECH_DEBT_LABEL ? "d4c5f9" : "ededed"));
  const labelArgs = all.flatMap((l) => ["--label", l]);
  try {
    const out = ghExec(
      ["issue", "create", "--title", String(title), ...labelArgs, "--body-file", "-"],
      { input: body || "" }
    ).trim();
    const match = out.match(/\/issues\/(\d+)/);
    const number = match ? Number(match[1]) : null;
    log("info", `Created issue #${number}: ${title}`);
    return number;
  } catch (e) {
    log("warn", `Could not create issue "${title}"`, errorData(e));
    return null;
  }
}

// Priority is expressed as a single label so it shows on board cards and is
// visible to the Builder via the issue's labels.
export const PRIORITY_LABELS = { high: "priority:high", medium: "priority:medium", low: "priority:low" };

/** Ensure the priority labels and the `agent` marker label exist. Best-effort, idempotent. */
export function ensurePriorityLabels() {
  const labels = [
    [PRIORITY_LABELS.high, "d73a4a"],
    [PRIORITY_LABELS.medium, "fbca04"],
    [PRIORITY_LABELS.low, "0e8a16"],
    [AGENT_LABEL, "ededed"],
    // Muted grey-blue: waiting is a normal state, not a warning.
    [WAITING_LABEL, "c5def5"],
  ];
  for (const [name, color] of labels) ensureLabel(name, color);
}

/**
 * Set an issue's priority to a single level, clearing any other priority label.
 * `currentLabels` is the issue's existing label names (so we only remove ones
 * actually present). Best-effort; returns boolean.
 */
export function setIssuePriority(issueNumber, priority, currentLabels = []) {
  const target = PRIORITY_LABELS[priority];
  if (!target) {
    log("warn", `Priority: unknown level "${priority}" for #${issueNumber}.`);
    return false;
  }
  const removes = Object.values(PRIORITY_LABELS)
    .filter((l) => l !== target && currentLabels.includes(l))
    .flatMap((l) => ["--remove-label", l]);
  try {
    ghExec(["issue", "edit", String(issueNumber), "--add-label", target, ...removes]);
    log("info", `Priority: #${issueNumber} → ${priority}.`);
    return true;
  } catch (e) {
    log("warn", `Could not set priority on #${issueNumber}.`, errorData(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Failure tracking — stop the Builder re-picking tickets it can't ship
//
// A ticket the Builder repeatedly abandons would otherwise be picked again every
// run (the Scout always takes the highest-priority open ticket), starving the
// whole backlog. We count failed attempts on the issue itself (an `attempts:N`
// label) and, once it crosses a threshold, park it with `blocked` — the Builder
// skips blocked tickets, and the Product Manager splits or retires them.
// ---------------------------------------------------------------------------

export const BLOCKED_LABEL = "blocked";
const ATTEMPTS_LABEL_RE = /^attempts:(\d+)$/;

/** An issue's label names as plain strings (gh returns objects; humans add strings). */
export function labelNames(issue) {
  return (issue?.labels || []).map((l) => l.name || l);
}

/** Cumulative failed-attempt count the Builder has recorded on an issue (0 if none). */
export function attemptCount(issue) {
  for (const name of labelNames(issue)) {
    const m = name.match(ATTEMPTS_LABEL_RE);
    if (m) return Number(m[1]);
  }
  return 0;
}

export function isBlocked(issue) {
  return labelNames(issue).includes(BLOCKED_LABEL);
}

// ---------------------------------------------------------------------------
// Ticket dependencies
//
// A ticket declares what must ship before it, as one line in its body:
//   Blocked by: #134, #135
//
// This is deliberately NOT the `blocked` label, which means something else:
// "parked after failing repeatedly, a human or the PM should split it". A ticket
// waiting its turn hasn't failed at all, and marking it blocked would invite the
// PM to retire work that is perfectly good and simply not ready yet.
//
// A dependency counts as met once its issue is closed, so the ordering resolves
// itself as the Builder ships: no state to maintain, and the whole graph is
// visible in the issue body a human reads.
// ---------------------------------------------------------------------------

const DEPENDS_ON_LINE_RE = /^[ \t]*(?:blocked by|depends on)[ \t]*:[ \t]*(.+)$/im;

/** Issue numbers this ticket declares it must wait for (may be empty). */
export function dependencyNumbers(issue) {
  const line = (issue?.body || "").match(DEPENDS_ON_LINE_RE);
  if (!line) return [];
  const found = line[1].match(/#(\d+)/g) || [];
  return [...new Set(found.map((s) => Number(s.slice(1))))].filter((n) => n !== issue?.number);
}

/**
 * Dependencies that haven't shipped yet, given the set of still-open issue
 * numbers. A dependency that is closed — or that never existed / was retired —
 * is treated as met, so a stale reference can never strand a ticket forever.
 *
 * But only once that is confirmed. Absent from the open set used to be enough,
 * and absent is not the same as closed: an issue filed after the listing, or one
 * a listing missed, looked shipped and released everything waiting on it.
 */
export function unmetDependencies(issue, openNumbers, isShipped = isConfirmedShipped) {
  return dependencyNumbers(issue).filter((n) => openNumbers.has(n) || !isShipped(n));
}

// Confirmed only — an issue can be reopened, but a run is short enough that one
// closing mid-run and reopening is not worth a second lookup.
const confirmedShipped = new Set();

/**
 * Whether issue `number` is closed, or does not exist at all — either way nothing
 * is left to wait for. False when it is open, or when the lookup fails: a
 * dependency nobody could see is one that has not been shown to ship.
 */
export function isConfirmedShipped(number) {
  if (confirmedShipped.has(number)) return true;
  let shipped;
  try {
    shipped = ghExec(["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", ".state"], { stdio: "pipe" }).trim() === "closed";
  } catch (e) {
    // 404: never existed. 410: deleted. A stale reference, not a blocker.
    shipped = /HTTP (404|410)/.test(`${e.stderr || ""} ${e.message}`);
    if (!shipped) log("warn", `Dependencies: could not confirm #${number} has shipped — treating it as unmet.`, errorData(e));
  }
  if (shipped) confirmedShipped.add(number);
  return shipped;
}

// Not every issue is work.
//
// The pipeline files three kinds of issue that describe something rather than
// ask for it, and the Devs must never pick one up and try to build it:
//
//   playtest — an experience the Playtester had ("the page felt static for the
//              first minute"). The Product Manager turns each into a real ticket
//              with acceptance criteria, or drops it, and closes the original.
//   health   — a diagnostic about the PIPELINE, addressed to whoever maintains
//              it. Nothing in docs/ can fix "the changelog stopped growing".
//   digest   — the weekly report.
//
// The last two are now published as Discussions rather than issues, which is a
// better fit and removes the problem at the source. These stay because issues
// filed under the old behaviour are still open, and because a label can always be
// added by hand — a guard that costs a set lookup is cheaper than the build it
// would otherwise waste.
//
// Left buildable, each is a ticket the Devs engage, fail to satisfy, and
// eventually park — spending two builds to discover the issue was never a
// request.
export const PLAYTEST_LABEL = "playtest";
export const HEALTH_LABEL = "health";
export const DIGEST_LABEL = "digest";

const NON_WORK_LABELS = new Set([PLAYTEST_LABEL, HEALTH_LABEL, DIGEST_LABEL]);

/** An issue that reports something rather than asking for work. */
export function isNonWorkIssue(issue) {
  return labelNames(issue).some((name) => NON_WORK_LABELS.has(name));
}

/** Untriaged playtest feedback, which is an observation rather than a ticket. */
export function isPlaytestFeedback(issue) {
  return labelNames(issue).includes(PLAYTEST_LABEL);
}

/**
 * True when the Builder may pick this ticket up now: not parked, not a report of
 * something, and everything it declared it depends on has shipped.
 */
export function isBuildable(issue, openNumbers, isShipped = isConfirmedShipped) {
  return (
    !isBlocked(issue) &&
    !isNonWorkIssue(issue) &&
    unmetDependencies(issue, openNumbers, isShipped).length === 0
  );
}

const PRIORITY_RANK = {
  [PRIORITY_LABELS.high]: 0,
  [PRIORITY_LABELS.medium]: 1,
  [PRIORITY_LABELS.low]: 2,
};

/** A ticket's own priority as a sortable rank; unlabelled sorts last. */
export function priorityRank(issue) {
  const names = (issue.labels || []).map((l) => l.name || l);
  for (const [label, rank] of Object.entries(PRIORITY_RANK)) {
    if (names.includes(label)) return rank;
  }
  return 3;
}

/**
 * The rank a ticket should be BUILT at: the best priority among itself and
 * everything that transitively waits on it.
 *
 * A blocker is worth exactly what it unblocks. #170 is priority:low but gates
 * #171 -> #172 -> #173, all priority:high, so on its own label it sorts behind
 * every trivial ticket on the board — and the three tickets that actually matter
 * stay unreachable while the pipeline ships peripheral work. Rank it as high and
 * the chain starts moving.
 *
 * Deliberately does NOT relabel the ticket. The label is what a human said this
 * work is worth; this is only the order to do it in, and conflating the two would
 * quietly rewrite the roadmap on the board.
 */
export function effectivePriorityRank(issue, openIssues) {
  let best = priorityRank(issue);
  const seen = new Set([issue.number]);
  let frontier = new Set([issue.number]);
  // Widen a level at a time: dependents of the ticket, then their dependents.
  // Cycles are possible in hand-written "Blocked by:" lines, so `seen` guards
  // termination rather than assuming the graph is acyclic.
  while (frontier.size && best > 0) {
    const next = new Set();
    for (const candidate of openIssues) {
      if (seen.has(candidate.number)) continue;
      if (!dependencyNumbers(candidate).some((dep) => frontier.has(dep))) continue;
      seen.add(candidate.number);
      best = Math.min(best, priorityRank(candidate));
      next.add(candidate.number);
    }
    frontier = next;
  }
  return best;
}

/** Open tickets that transitively wait on this one, best priority first. */
export function dependentsOf(issue, openIssues) {
  return openIssues
    .filter(
      (other) =>
        other.number !== issue.number &&
        dependencyNumbers(other).includes(issue.number)
    )
    .sort((a, b) => priorityRank(a) - priorityRank(b));
}

/**
 * The candidate the Scout named, or null when it named none of them.
 *
 * The Scout is a model, and its `issueNumber` is whatever it wrote: a number, a
 * string, a ticket from memory rather than from the list. Taken on trust, a
 * number outside the list became a stub ticket with an empty body, and the
 * Builder was sent to fix a ticket nobody had offered — possibly one that is
 * parked, claimed by an open PR, or already closed. A numeric string is still
 * the model meaning a number, so it counts.
 */
export function chosenCandidate(issueNumber, candidates) {
  const number = typeof issueNumber === "string" && /^\s*\d+\s*$/.test(issueNumber)
    ? Number(issueNumber)
    : issueNumber;
  if (!Number.isInteger(number)) return null;
  return candidates.find((candidate) => candidate.number === number) || null;
}

/** The `Blocked by:` line for an issue body, or "" when there are no deps. */
export function dependencyLine(numbers) {
  const deps = (numbers || []).filter((n) => Number.isInteger(n) && n > 0);
  return deps.length ? `Blocked by: ${deps.map((n) => `#${n}`).join(", ")}` : "";
}

// Shown on tickets whose prerequisites haven't shipped, so the board answers
// "why isn't this moving?" at a glance instead of only inside the issue body.
// Distinct from BLOCKED_LABEL ("parked, it keeps failing") — this one is normal.
export const WAITING_LABEL = "waiting";

/**
 * Reconcile the `waiting` label across the open backlog: add it to tickets with
 * unmet dependencies, remove it from tickets that have been released. Derived
 * from the bodies every time rather than tracked, so it cannot drift — and it is
 * removal that matters most, since a stale `waiting` on buildable work would
 * misreport a healthy backlog as a stuck one.
 *
 * Best-effort and quiet: label edits are cosmetic, so a failure never interrupts
 * the caller. Returns the number of labels changed.
 */
export function syncWaitingLabels(openIssues) {
  const issues = Array.isArray(openIssues) ? openIssues : [];
  const openNumbers = new Set(issues.map((i) => i.number));
  let changed = 0;

  for (const issue of issues) {
    const waiting = unmetDependencies(issue, openNumbers).length > 0;
    const labelled = labelNames(issue).includes(WAITING_LABEL);
    if (waiting === labelled) continue;
    const flag = waiting ? "--add-label" : "--remove-label";
    try {
      ghExec(["issue", "edit", String(issue.number), flag, WAITING_LABEL]);
      changed++;
      log("info", waiting
        ? `#${issue.number} labelled ${WAITING_LABEL} (waits on ${unmetDependencies(issue, openNumbers).map((d) => `#${d}`).join(", ")}).`
        : `#${issue.number} released — ${WAITING_LABEL} label removed.`);
    } catch (e) {
      log("warn", `Could not update the ${WAITING_LABEL} label on #${issue.number}.`, errorData(e));
    }
  }
  return changed;
}

/**
 * Record that a Builder run failed to ship `issue`. Bumps its `attempts:N`
 * label; once the count reaches `maxAttempts` the ticket is parked (the `blocked`
 * label + demoted to low) so the Scout stops re-picking it and the PM can split
 * or retire it. Best-effort; returns the new attempt count.
 */
export function recordTicketFailure(issue, reason, maxAttempts) {
  const number = issue?.number;
  if (!number) return 0;

  const current = attemptCount(issue);
  const next = current + 1;
  const nextLabel = `attempts:${next}`;
  ensureLabel(nextLabel, "e4b8b8");

  const edits = ["--add-label", nextLabel];
  const prevLabel = `attempts:${current}`;
  if (current > 0 && labelNames(issue).includes(prevLabel)) edits.push("--remove-label", prevLabel);
  try {
    ghExec(["issue", "edit", String(number), ...edits]);
  } catch (e) {
    log("warn", `Could not bump attempt count on #${number}.`, errorData(e));
  }

  if (next >= maxAttempts) {
    parkBlockedTicket(number, next, reason, labelNames(issue));
  } else {
    log("info", `Ticket #${number}: failed attempt ${next}/${maxAttempts}.`);
  }
  return next;
}

function parkBlockedTicket(number, attempts, reason, currentLabels) {
  ensureLabel(BLOCKED_LABEL, "b60205");
  try {
    ghExec(["issue", "edit", String(number), "--add-label", BLOCKED_LABEL]);
  } catch (e) {
    log("warn", `Could not block #${number}.`, errorData(e));
  }
  // Demote so it sinks even if a human later unblocks it without re-triaging.
  setIssuePriority(number, "low", currentLabels);

  const body = [
    "## ⛔ Parked by the Devs",
    "",
    `The Builder failed to ship this ticket ${attempts} time(s); most recent reason:`,
    "",
    `> ${reason || "no detail"}`,
    "",
    "It's now **blocked** so the Builder stops retrying it. The Product Manager should split it into a smaller, concrete ticket or retire it.",
  ].join("\n");
  try {
    ghComment(number, body);
  } catch (e) {
    log("warn", `Could not comment on blocked #${number}.`, errorData(e));
  }
  log("warn", `Ticket #${number} parked as blocked after ${attempts} failed attempt(s).`);
}

/** Close a ticket the Product Manager decided to retire (split/superseded/won't-do). */
export async function retireIssue(number, reason) {
  const body = ["## Retired by the Product Manager", "", reason || "Superseded or no longer worth building in its current form."].join("\n");
  try {
    ghComment(number, body);
    ghExec(["issue", "close", String(number)]);
    log("info", `Retired issue #${number}.`);
  } catch (e) {
    log("warn", `Could not retire #${number}.`, errorData(e));
  }
}

/**
 * Best-effort: dispatch another agent workflow by file name (demand-driven
 * refill). Uses GH_TOKEN (the PAT), so the caller workflow's `permissions:` block
 * doesn't gate it; the target workflow just needs a `workflow_dispatch` trigger.
 */
export function triggerWorkflow(workflowFile) {
  try {
    ghExec(["workflow", "run", workflowFile]);
    log("info", `Dispatched workflow ${workflowFile}.`);
    return true;
  } catch (e) {
    log("warn", `Could not dispatch workflow ${workflowFile}.`, errorData(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// GitHub Projects (Kanban board) helpers
//
// All board operations are BEST-EFFORT: they log and return false/null on any
// failure and never throw, so the board can never break the build/commit flow.
// Requires `gh` authenticated with a token carrying the `project` scope
// (set GH_TOKEN to a PAT in CI — the default GITHUB_TOKEN can't access Projects).
// ---------------------------------------------------------------------------

// "@me" references the authenticated user (the PAT owner). Passing a literal
// login makes `gh project` fail with "unknown owner type"; @me avoids that.
export const PROJECT_OWNER = process.env.GH_PROJECT_OWNER || "@me";
export const PROJECT_NUMBER = process.env.GH_PROJECT_NUMBER || "3";

function ghProjectJson(argv) {
  return JSON.parse(ghExec(argv));
}

let _projectMeta = null;

/**
 * Discover and cache the project's node id, the Status field id, and a
 * {columnName: optionId} map. Returns null if it can't be resolved.
 */
export function getProjectMeta() {
  if (_projectMeta) return _projectMeta;
  try {
    const view = ghProjectJson(["project", "view", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--format", "json"]);
    const fieldsRaw = ghProjectJson(["project", "field-list", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--format", "json"]);
    const fields = Array.isArray(fieldsRaw) ? fieldsRaw : fieldsRaw.fields || [];
    const statusField = fields.find((f) => f.name === "Status");
    if (!view.id || !statusField || !statusField.id) {
      log("warn", "Board: could not resolve project id or Status field — skipping board updates.");
      return null;
    }
    const options = {};
    (statusField.options || []).forEach((o) => { options[o.name] = o.id; });
    _projectMeta = { projectId: view.id, statusFieldId: statusField.id, options };
    return _projectMeta;
  } catch (e) {
    log("warn", "Board: project discovery failed — skipping board updates.", errorData(e));
    return null;
  }
}

function repoIssueUrl(issueNumber) {
  const repo = ghProjectJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  return `https://github.com/${repo}/issues/${issueNumber}`;
}

/** Every item on the board, raw. Throws when gh fails or the listing was cut short. */
function readProjectItems() {
  const res = ghProjectJson([
    "project", "item-list", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--format", "json", "--limit", String(LISTING_LIMIT),
  ]);
  const items = res.items || [];
  rejectTruncated(items.length, "the board's items");
  return items;
}

/** Find the board item id for an issue number, or null if it isn't on the board. */
function findProjectItemId(issueNumber) {
  try {
    const items = readProjectItems();
    const match = items.find((it) => it.content && it.content.number === Number(issueNumber));
    return match ? match.id : null;
  } catch (e) {
    log("warn", `Board: could not list items for issue #${issueNumber}.`, errorData(e));
    return null;
  }
}

/**
 * List every board item with its column (Status). Returns
 * [{ number, title, status }] — number is null for draft items. Throws when the
 * board cannot be read: the PM dedups new tickets against these titles, and an
 * unreadable board is not an empty one.
 */
export function listProjectItems() {
  let items;
  try {
    items = readProjectItems();
  } catch (e) {
    throw new Error(`Could not list the board's items: ${e.message}`, { cause: e });
  }
  return items.map((it) => ({
    number: it.content && typeof it.content.number === "number" ? it.content.number : null,
    title: it.title || (it.content && it.content.title) || "(untitled)",
    status: it.status || "No Status",
  }));
}

/** Add an issue to the board; returns the item id (or null). Idempotent in effect. */
export function addIssueToProject(issueNumber) {
  const existing = findProjectItemId(issueNumber);
  if (existing) return existing;
  try {
    const res = ghProjectJson([
      "project", "item-add", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--url", repoIssueUrl(issueNumber), "--format", "json",
    ]);
    log("info", `Board: added issue #${issueNumber}.`);
    return res.id || null;
  } catch (e) {
    log("warn", `Board: could not add issue #${issueNumber}.`, errorData(e));
    return null;
  }
}

/**
 * Move an issue's card to a named Status column (e.g. "In progress", "Done").
 * Adds the issue to the board first if needed. Best-effort; returns boolean.
 */
export function moveCard(issueNumber, statusName) {
  const meta = getProjectMeta();
  if (!meta) return false;
  const optionId = meta.options[statusName];
  if (!optionId) {
    log("warn", `Board: no column "${statusName}" — skipping move for #${issueNumber}.`);
    return false;
  }
  const itemId = findProjectItemId(issueNumber) || addIssueToProject(issueNumber);
  if (!itemId) return false;
  try {
    ghExec([
      "project", "item-edit", "--id", itemId, "--project-id", meta.projectId,
      "--field-id", meta.statusFieldId, "--single-select-option-id", optionId,
    ]);
    log("info", `Board: moved issue #${issueNumber} → "${statusName}".`);
    return true;
  } catch (e) {
    log("warn", `Board: could not move issue #${issueNumber} to "${statusName}".`, errorData(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared snapshots (used by both the Product Owner and Product Manager)
// ---------------------------------------------------------------------------

/**
 * Snapshot of the project's tickets: live open issues, raw board items, and a
 * human-readable board grouped by column (with any un-boarded open issues folded
 * into a "Todo (not yet on board)" group so nothing is invisible).
 */
export function getBoardSnapshot() {
  const openIssues = fetchOpenIssues();
  const boardItems = listProjectItems();

  // Labels per open ticket (so the board shows priority / tech-debt tags).
  //
  // The `agent` marker itself is plumbing and stays hidden — but its ABSENCE is
  // the only signal that a person filed the ticket, and hiding the label hid that
  // too. So it is inverted into something the reader can act on: an agent ticket
  // gets no marker, a human one says so.
  const labelsByNumber = new Map(
    openIssues.map((i) => {
      const names = (i.labels || []).map((l) => l.name || l);
      const visible = names.filter((n) => n !== AGENT_LABEL);
      return [i.number, names.includes(AGENT_LABEL) ? visible : [...visible, "from a person"]];
    })
  );
  const tag = (num) => {
    const labs = num != null ? labelsByNumber.get(num) || [] : [];
    return labs.length ? ` _(${labs.join(", ")})_` : "";
  };

  const groups = {};
  for (const it of boardItems) (groups[it.status] ||= []).push(it);
  const onBoard = new Set(boardItems.map((i) => i.number).filter((n) => n != null));
  for (const iss of openIssues) {
    if (!onBoard.has(iss.number)) {
      (groups["Todo (not yet on board)"] ||= []).push({ number: iss.number, title: iss.title });
    }
  }
  const boardState = Object.keys(groups).length
    ? Object.entries(groups)
        .map(([status, list]) =>
          `**${status}** (${list.length}):\n` +
          list.map((i) => `- ${i.number ? "#" + i.number + " " : ""}${i.title}${tag(i.number)}`).join("\n")
        )
        .join("\n\n")
    : "(no tickets yet — the board is empty)";

  return { openIssues, boardItems, boardState };
}

// ---------------------------------------------------------------------------
// Pull Requests — two identities, because GitHub will not let an author approve
// their own PR.
//
// The PAT OPENS and the bot APPROVES. It used to be the other way round, and the
// reason it changed is a rule that is easy to miss: GitHub does not trigger
// workflows for events created by GITHUB_TOKEN. That is a deliberate recursion
// guard, and it means a PR the bot opens gets its checks CREATED but parked,
// waiting for a human to press a button.
//
// That cost nothing while CI had path filters and agent PRs never matched them.
// The moment the checks became universal and required, every agent PR stalled:
// #502 sat for 42 minutes, its Devs run gave up waiting, reported zero merges,
// and skipped recording the change it had actually made.
//
// A PAT-created PR triggers workflows normally. So the PAT opens, and the bot —
// a genuinely different identity — approves.
//
// The same rule governs every PUSH, not just the opening, and that half cost a
// second incident: #510's first event ran CI and passed, then the Builder pushed
// a revision for the Reviewer and that event came back `action_required`. Only
// tickets needing a second Builder attempt were affected, which is what made it
// look intermittent. The workflows that push branches now check out with the PAT
// — see the note on the checkout step in devs.yml.
// ---------------------------------------------------------------------------

const patToken = () => process.env.GH_TOKEN || process.env.AGENT_PAT || "";
const botToken = () => process.env.BOT_TOKEN || process.env.GITHUB_TOKEN || "";

function ghAs(token, argv, opts = {}) {
  return ghExec(argv, { ...opts, env: { ...process.env, GH_TOKEN: token } });
}

/**
 * The body of a ticket's PR: what the Builder says it did, then the closing line.
 *
 * `Closes`, not `Refs`: GitHub closes an issue on merge only for a closing
 * keyword, and `Refs` is not one. With it, whether the ticket closed rested on the
 * model happening to write "closes #N" in its commit message — and a PR merged by
 * the reconcile step, which never runs closeIssue, left its ticket open.
 */
export function agentPullRequestBody(summary, issueNumber) {
  return issueNumber ? `${summary}\n\nCloses #${issueNumber}` : summary;
}

/** Open a PR from `branchName` into main as the bot. Returns PR number, or null. */
export function createPR(branchName, title, body) {
  try {
    const out = ghAs(
      // The PAT, so the PR's checks actually start. See the note above.
      patToken(),
      ["pr", "create", "--base", "main", "--head", branchName, "--title", String(title), "--body-file", "-"],
      { input: body || "" }
    ).trim();
    const m = out.match(/\/pull\/(\d+)/);
    const num = m ? Number(m[1]) : null;
    log("info", `PR: opened #${num} for ${branchName}.`);
    return num;
  } catch (e) {
    log("warn", `PR: could not open for ${branchName}.`, errorData(e));
    return null;
  }
}

/** Submit an approving review as the PAT user (a different identity than the bot author). */
export function approvePR(prNumber, body) {
  try {
    // The bot, because the PAT is now the author and nobody may approve their own.
    ghAs(botToken(), ["pr", "review", String(prNumber), "--approve", "--body-file", "-"], {
      input: body || "Approved by the Reviewer agent.",
    });
    log("info", `PR: approved #${prNumber}.`);
    return true;
  } catch (e) {
    log("warn", `PR: could not approve #${prNumber}.`, errorData(e));
    return false;
  }
}

/** Merge a PR with a merge commit and delete its branch. Best-effort. */
// How long to wait for a PR to actually land after asking for it.
//
// The agents open a PR and try to merge it seconds later, long before any
// required check has finished. Before, that worked because nothing was required
// and the merge went straight through — the agent's own in-process verify was the
// only gate, and it was self-imposed. Now the merge waits for the checks, which
// means waiting for a runner to start, install and run them.
//
// Sized against the two jobs it waits on: lint and tests are seconds, the product
// verify pays for a Chromium install. Ten minutes covers both with room for a
// queued runner, and a ticket that exceeds it is left as an open PR for the next
// run rather than merged blind.
const MERGE_WAIT_MS = Number(process.env.MERGE_WAIT_MS || 10 * 60 * 1000);
const MERGE_POLL_MS = Number(process.env.MERGE_POLL_MS || 15 * 1000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function prState(prNumber) {
  try {
    return JSON.parse(
      ghAs(patToken(), ["pr", "view", String(prNumber), "--json", "state,mergedAt,mergeStateStatus"], { stdio: "pipe" })
    );
  } catch {
    return null;
  }
}

/**
 * Merge a pull request, letting the repository's required checks decide.
 *
 * Asks for auto-merge rather than merging outright: GitHub then merges the
 * moment the checks pass, and refuses if they do not. That inverts where the
 * trust sits. It used to be the agent asserting its own verify had passed and
 * then merging on that assertion; now it asks, and something outside the agent
 * answers.
 *
 * Falls back to a direct merge when auto-merge is unavailable — a repository
 * without it configured must still be able to ship.
 */
export async function mergePR(prNumber) {
  let waiting = false;
  try {
    ghAs(patToken(), ["pr", "merge", String(prNumber), "--auto", "--merge", "--delete-branch"]);
    waiting = true;
    log("info", `PR: #${prNumber} will merge when its checks pass.`);
  } catch (e) {
    log("info", `PR: auto-merge unavailable for #${prNumber} — merging directly.`, errorData(e));
    try {
      ghAs(patToken(), ["pr", "merge", String(prNumber), "--merge", "--delete-branch"]);
      log("info", `PR: merged #${prNumber}.`);
      return true;
    } catch (direct) {
      log("warn", `PR: could not merge #${prNumber}.`, errorData(direct));
      return false;
    }
  }

  // Wait for it to actually land. The next ticket branches from this merge, so
  // continuing before it exists would build on a main that does not have it yet.
  const deadline = Date.now() + MERGE_WAIT_MS;
  while (waiting && Date.now() < deadline) {
    await sleep(MERGE_POLL_MS);
    const state = prState(prNumber);
    if (state?.mergedAt) {
      log("info", `PR: merged #${prNumber}.`);
      return true;
    }
    if (state?.state === "CLOSED") {
      log("warn", `PR: #${prNumber} was closed without merging.`);
      return false;
    }
  }
  log(
    "warn",
    `PR: #${prNumber} did not merge within ${Math.round(MERGE_WAIT_MS / 60000)} minutes — ` +
      "its checks are still running or have failed. Leaving it open; auto-merge will land it if they pass."
  );
  return false;
}

/** Close (revoke) a PR without merging, optionally leaving a comment. Deletes the branch. */
export function closePR(prNumber, comment) {
  try {
    if (comment) ghAs(patToken(), ["pr", "comment", String(prNumber), "--body-file", "-"], { input: comment });
    ghAs(patToken(), ["pr", "close", String(prNumber), "--delete-branch"]);
    log("info", `PR: closed #${prNumber}.`);
    return true;
  } catch (e) {
    log("warn", `PR: could not close #${prNumber}.`, errorData(e));
    return false;
  }
}


// ---------------------------------------------------------------------------
// Open agent PRs — the work the pipeline has already started.
//
// A run that ends in `unlanded` leaves a real PR behind: approved, armed for
// auto-merge, waiting on checks that had not finished. Nothing wrote that down,
// so the next run saw an open ticket, branched again (branch names carry a
// run-scoped suffix, so never the same branch twice) and opened a SECOND PR for
// the same ticket. Issue #687 collected three that way, the oldest of which had
// drifted into conflict by the time anyone looked.
//
// These functions are what makes an open PR visible to the next run. The
// classification is deliberately deterministic — no model reads a diff here. A PR
// is claimed by its branch, and what to do about it follows from its checks.
// ---------------------------------------------------------------------------

export const AGENT_BRANCH_PREFIX = "agent/issue-";

// How long an agent PR may sit open before the next run takes it back.
//
// Not a patience setting — a handover. Below this the run that opened the PR may
// still be watching it (mergePR waits ten minutes for the checks), and two runs
// acting on one PR is how the duplicates started. Above it, nobody is: that run
// ended hours ago, and whatever the PR is waiting for is not coming.
//
// Twelve hours is shorter than the gap between the daily runs, so every stalled
// PR is reconciled by the next one and none survives a second night.
export const PR_STALE_MS = Number(process.env.PR_STALE_HOURS || 12) * 60 * 60 * 1000;

/** The ticket an agent branch was cut for, or null when it isn't one. */
export function issueNumberFromAgentBranch(branchName) {
  const m = /^agent\/issue-(\d+)-/.exec(branchName || "");
  return m ? Number(m[1]) : null;
}

/**
 * Every open PR the pipeline opened for a ticket, with enough state to judge it.
 *
 * Throws when the listing fails. It used to return [] so a run could keep
 * building — but these PRs ARE the guard against building a ticket twice, and an
 * empty list drops the guard: every ticket with a PR in flight looks unclaimed,
 * and the run opens a second PR beside it.
 */
export function fetchOpenAgentPullRequests() {
  let prs;
  try {
    prs = JSON.parse(
      ghAs(
        patToken(),
        ["pr", "list", "--state", "open", "--limit", String(LISTING_LIMIT), "--json", "number,headRefName,createdAt,url,title,mergeable,statusCheckRollup"],
        { stdio: "pipe" }
      )
    );
  } catch (e) {
    throw new Error(`Could not list open pull requests: ${e.message}`, { cause: e });
  }
  rejectTruncated(prs.length, "open pull requests");
  return prs.filter((pr) => issueNumberFromAgentBranch(pr.headRefName));
}

/**
 * What an open agent PR is waiting for, and whether waiting is still reasonable.
 *
 * Pure so the policy can be tested without the API. `stale` is the only
 * time-dependent part: a PR younger than the threshold is left entirely alone,
 * because the run that opened it may still be watching it.
 */
export function classifyAgentPullRequest(pr, { now = Date.now(), staleMs } = {}) {
  const checks = pr.statusCheckRollup || [];
  const verdict = (c) => c.conclusion || c.state || "";
  const failed = checks.filter((c) => ["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR"].includes(verdict(c)));
  const pending = checks.filter((c) => ["PENDING", "IN_PROGRESS", "QUEUED", "EXPECTED", ""].includes(verdict(c)));

  let state;
  if (pr.mergeable === "CONFLICTING") state = "conflicting";
  else if (failed.length) state = "failing";
  else if (pending.length || !checks.length) state = "pending";
  else state = "passing";

  return {
    number: pr.number,
    url: pr.url,
    issueNumber: issueNumberFromAgentBranch(pr.headRefName),
    branch: pr.headRefName,
    state,
    failedChecks: failed.map((c) => c.name || c.context).filter(Boolean),
    ageMs: now - new Date(pr.createdAt).getTime(),
    stale: now - new Date(pr.createdAt).getTime() > staleMs,
  };
}

/**
 * What a run does about one classified agent PR, and whether its ticket stays
 * claimed so the same run does not build it a second time.
 *
 *   "leave"  — nothing to do now; the PR stands.
 *   "merge"  — it passed and never landed: re-arm the merge and wait for it.
 *   "close"  — failing or conflicting: close it and strike the ticket.
 *   "retire" — its ticket is no longer open (shipped, split, superseded): close
 *              it without merging, because landing it would ship work the board
 *              has already decided against.
 *
 * A ticket stays claimed for as long as its PR stays open. Claiming only the PRs
 * left alone let a passing PR whose merge did not land in time go unclaimed, and
 * the same run branched the ticket again beside it.
 *
 * `alreadyAwaited` is the run's memory of PRs it has already waited on. The
 * reconcile runs before every ticket, and mergePR waits up to ten minutes; without
 * it, one PR whose checks never finish costs ten minutes per pass.
 */
export function decideAgentPullRequest(verdict, { issueOpen, alreadyAwaited }) {
  if (!verdict.stale) return { action: "leave", claimed: true };
  if (!issueOpen) return { action: "retire", claimed: false };
  if (verdict.state === "pending") return { action: "leave", claimed: true };
  if (verdict.state === "passing") return { action: alreadyAwaited ? "leave" : "merge", claimed: true };
  return { action: "close", claimed: false };
}

// ---------------------------------------------------------------------------
// Layered build verification: syntax → static analysis (lint) → runtime smoke.
// Cheap checks first; stop at the first failing layer. ESLint and Playwright
// are best-effort — if a tool isn't installed, that layer is skipped (warned),
// never blocking the pipeline.
// ---------------------------------------------------------------------------

function listJsFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const STATIC_MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

/**
 * Serve a directory on a random loopback port. Exported so an agent that drives
 * the live app can host it the same way the build's own verify does, rather than
 * standing up a second, subtly different server.
 */
export function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const filePath = join(rootDir, p);
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": STATIC_MIME[extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}
// How long the product's whole self-check suite may run. A suite that can hang
// the page is itself a defect, and a Builder waiting on it is burning its clock.
const SELF_TEST_TIMEOUT_MS = 2000;

/**
 * Run the product's own self-checks, in the real browser, against the real page.
 *
 * Layers 1-3 prove the code parses, lints, and loads without throwing. None of
 * them prove the product actually DOES what it claims — which is exactly the
 * failure a Builder is most likely to ship, because it looks green everywhere
 * else. This is where that claim is enforced.
 *
 * The contract is deliberately tiny (see agents/prompts/_product-contract.md):
 * `docs/selftest.js` exports `checks()`, which returns an array of
 * human-readable failure strings — empty when everything holds. What counts as
 * a check is the product's business; that it can be executed is ours.
 *
 * No model is involved, so it costs nothing and cannot be argued with. A project
 * that ships no selftest.js yet passes, so a brand-new repo isn't blocked before
 * it has anything to check.
 */
async function checkSelfTests(browser, url, dir) {
  if (!fs.existsSync(join(dir, "selftest.js"))) {
    log("info", "Verify: no docs/selftest.js yet — skipping the self-check layer.");
    return [];
  }

  const page = await browser.newPage();
  const failures = [];
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    const result = await page.evaluate(
      async ({ timeoutMs }) => {
        let mod;
        try {
          mod = await import("./selftest.js");
        } catch (e) {
          return [`docs/selftest.js could not be imported — ${e.message}`];
        }
        if (typeof mod.checks !== "function") {
          return ["docs/selftest.js does not export checks()"];
        }

        // Time the suite here rather than letting the browser give up, so a
        // runaway check is reported as the product's failure to bound itself.
        const started = performance.now();
        let problems;
        try {
          problems = await mod.checks();
        } catch (e) {
          return [`docs/selftest.js checks() threw — ${e.message}`];
        }
        const elapsed = performance.now() - started;
        if (elapsed > timeoutMs) {
          return [`docs/selftest.js checks() took ${Math.round(elapsed)}ms — it must finish within ${timeoutMs}ms`];
        }
        if (!Array.isArray(problems)) {
          return ["docs/selftest.js checks() did not return an array of failure strings"];
        }
        return problems.map(String).slice(0, 12); // enough to act on
      },
      { timeoutMs: SELF_TEST_TIMEOUT_MS }
    );
    failures.push(...result);
  } catch (e) {
    log("warn", "Verify: self-checks could not run.", errorData(e));
  } finally {
    await page.close().catch(() => {});
  }
  return failures;
}

// How long the whole tool layer may take to answer. Every handler is called
// once, so this bounds the product, not a single tool.
const AGENT_TOOLS_TIMEOUT_MS = 3000;

// A tool name is what an agent types. Lowercase kebab-case keeps it unambiguous
// across the JSON boundary and matches the names in the WebMCP specification's
// own examples.
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Below this a description is a label, not an interface. The caller cannot see
// the screen and picks the tool from these words alone.
const MIN_TOOL_DESCRIPTION_CHARS = 40;

/**
 * Judge the tool descriptors a product declares.
 *
 * Pure, and separate from the browser work on purpose: everything here is a
 * property of the descriptors themselves, so it can be tested in Node against
 * hand-written cases instead of only against whatever the product happens to
 * ship today. The browser's job is to collect these summaries and to call the
 * handlers; deciding what is wrong with them is this function's.
 *
 * `summaries` are plain objects, one per tool — see checkAgentTools.
 * Returns an array of plain-language failure messages, empty when all holds.
 */
export function validateToolDescriptors(summaries) {
  if (!Array.isArray(summaries)) {
    return ["docs/agenttools.js tools() did not return an array of tool descriptors"];
  }
  if (!summaries.length) {
    return ["docs/agenttools.js tools() returned no tools — a product no agent can use"];
  }

  const problems = [];
  const seen = new Set();

  for (const [index, tool] of summaries.entries()) {
    const label = tool.name ? `"${tool.name}"` : `tool #${index + 1}`;

    if (!tool.name) {
      problems.push(`${label} has no name — every tool needs one an agent can call it by.`);
    } else if (!TOOL_NAME_PATTERN.test(tool.name)) {
      problems.push(`${label} is not a lowercase kebab-case name (expected e.g. "get-state").`);
    } else if (seen.has(tool.name)) {
      problems.push(`${label} is declared twice — a caller cannot tell which one it is invoking.`);
    }
    if (tool.name) seen.add(tool.name);

    const description = (tool.description || "").trim();
    if (!description) {
      problems.push(`${label} has no description — it is the whole interface, and the caller cannot see the screen.`);
    } else if (description.length < MIN_TOOL_DESCRIPTION_CHARS) {
      problems.push(
        `${label} has a ${description.length}-character description — say what it returns and when it is worth `
        + `asking, in at least ${MIN_TOOL_DESCRIPTION_CHARS} characters.`
      );
    }

    if (!tool.inputSchema || tool.inputSchema.type !== "object") {
      problems.push(`${label} needs an inputSchema that is a JSON Schema object (\`{ type: "object", ... }\`).`);
    }

    if (!tool.hasExecute) {
      problems.push(`${label} has no execute() — a described capability nothing implements.`);
    }
    if (!tool.hasExample) {
      problems.push(`${label} has no example input — the build calls every tool, and cannot call this one.`);
    }

    if (tool.mutates && !tool.annotated) {
      problems.push(
        `${label} changes something but declares no annotations — set readOnlyHint: false, and `
        + `consequentialHint: true when it is destructive, so a caller knows whether to ask a human first.`
      );
    }

    if (tool.invocation && !tool.invocation.ok) {
      problems.push(`${label} failed when called with its own example — ${tool.invocation.error}`);
    }
  }

  return problems;
}

/**
 * Run the product's declared tools, in the real browser, on the real page.
 *
 * The self-check contract proves the product does what it claims for a person.
 * This proves it does what it claims for an agent — a surface that is invisible
 * in every other layer, because a broken tool breaks no page and throws no
 * console error. It is assembled one ticket at a time by whoever ships each
 * feature, which is the same way selftest.js is assembled and the same reason
 * somebody has to read it whole.
 *
 * Registration is deliberately NOT exercised here: `document.modelContext` does
 * not exist in headless Chromium, so the only honest thing to verify is that the
 * descriptors are sound and the handlers work. Whether the browser accepts them
 * is docs/webmcp.js's business, and it is one call.
 *
 * No model is involved, so it costs nothing and cannot be argued with. A project
 * that ships no agenttools.js yet passes, so a brand-new repo isn't blocked
 * before it has anything to expose.
 */
async function checkAgentTools(browser, url, dir) {
  if (!fs.existsSync(join(dir, "agenttools.js"))) {
    log("info", "Verify: no docs/agenttools.js yet — skipping the agent-tools layer.");
    return [];
  }

  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    const summaries = await page.evaluate(
      async ({ timeoutMs }) => {
        let mod;
        try {
          mod = await import("./agenttools.js");
        } catch (e) {
          return { fatal: `docs/agenttools.js could not be imported — ${e.message}` };
        }
        if (typeof mod.tools !== "function") {
          return { fatal: "docs/agenttools.js does not export tools()" };
        }

        let declared;
        try {
          declared = mod.tools();
        } catch (e) {
          return { fatal: `docs/agenttools.js tools() threw — ${e.message}` };
        }
        if (!Array.isArray(declared)) return { summaries: declared };

        const deadline = Date.now() + timeoutMs;
        const collected = [];
        for (const tool of declared) {
          const summary = {
            name: tool && tool.name,
            description: tool && tool.description,
            inputSchema: tool && tool.inputSchema,
            hasExecute: !!(tool && typeof tool.execute === "function"),
            hasExample: !!(tool && tool.example !== undefined),
            annotated: !!(tool && tool.annotations),
            mutates: !(tool && tool.annotations && tool.annotations.readOnlyHint),
          };

          if (summary.hasExecute && summary.hasExample) {
            const remaining = deadline - Date.now();
            const controller = new AbortController();
            try {
              if (remaining <= 0) throw new Error("the tool layer ran out of time before this tool was reached");
              const result = await Promise.race([
                tool.execute(tool.example, { signal: controller.signal }),
                new Promise((_, reject) =>
                  setTimeout(() => {
                    controller.abort();
                    reject(new Error(`it did not answer within ${timeoutMs}ms`));
                  }, remaining)
                ),
              ]);
              // An agent receives this across a JSON boundary, so a result it
              // cannot carry is the same as no result at all.
              JSON.stringify(result === undefined ? null : result);
              summary.invocation = { ok: true };
            } catch (e) {
              summary.invocation = { ok: false, error: e.message };
            }
          }

          collected.push(summary);
        }
        return { summaries: collected };
      },
      { timeoutMs: AGENT_TOOLS_TIMEOUT_MS }
    );

    if (summaries.fatal) return [summaries.fatal];
    return validateToolDescriptors(summaries.summaries).slice(0, 12);
  } catch (e) {
    log("warn", "Verify: agent tools could not run.", errorData(e));
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Verify the built app under `relDir`. Returns { ok, layer, errors }:
 *   - layer "syntax"     — a JS file fails `node --check`
 *   - layer "lint"       — ESLint reports an error (e.g. no-undef: undefined function)
 *   - layer "runtime"    — the page throws a console error / uncaught exception / failed load
 *   - layer "selftest"   — the product's own checks() reported a broken claim
 *   - layer "agenttools" — a tool the product declares is unsound or does not run
 * ok:true (layer null) means all available layers passed (or were skipped).
 */
export async function verifyBuild(relDir = "docs") {
  const dir = join(repoRoot, relDir);
  const rel = (f) => relative(repoRoot, f);

  // Layer 1 — syntax.
  const syntaxErrors = [];
  for (const f of listJsFiles(dir)) {
    try {
      execFileSync(process.execPath, ["--check", f], { cwd: repoRoot, stdio: "pipe" });
    } catch (e) {
      syntaxErrors.push(`${rel(f)}: ${String(e.stderr || e.message).split("\n")[0]}`);
    }
  }
  if (syntaxErrors.length) return { ok: false, layer: "syntax", errors: syntaxErrors };

  // Layer 2 — static analysis (ESLint, best-effort).
  try {
    const { ESLint } = await import("eslint");
    // Don't throw when a pattern matches nothing (no .mjs files, or an empty
    // docs/ on a brand-new project) — that's not a verification failure.
    const eslint = new ESLint({ errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles([join(relDir, "**/*.js"), join(relDir, "**/*.mjs")]);
    const lintErrors = [];
    for (const r of results) {
      for (const m of r.messages) {
        if (m.severity === 2) lintErrors.push(`${rel(r.filePath)}:${m.line} ${m.message} (${m.ruleId || "parse"})`);
      }
    }
    if (lintErrors.length) return { ok: false, layer: "lint", errors: [...new Set(lintErrors)] };
  } catch (e) {
    log("warn", "Verify: ESLint unavailable — skipping lint layer.", errorData(e));
  }

  // Layer 3 — runtime smoke (Playwright, best-effort).
  if (!fs.existsSync(join(dir, "index.html"))) {
    log("info", "Verify: no index.html yet — skipping runtime check.");
    return { ok: true, layer: null, errors: [] };
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    log("warn", "Verify: Playwright unavailable — skipping runtime check.", errorData(e));
    return { ok: true, layer: null, errors: [] };
  }

  const { server, port } = await startStaticServer(dir);
  const errors = [];
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("requestfailed", (r) => {
      const t = r.failure()?.errorText || "";
      if (!/aborted/i.test(t)) errors.push(`failed load: ${r.url()} (${t})`);
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2500);
  } catch (e) {
    errors.push(`navigation: ${e.message}`);
  }

  // Layer 4 — the product against its own claims. Only worth running when the
  // page itself is sound; check failures on a page that is already throwing
  // would just be noise from the same root cause.
  let selfTestFailures = [];
  let agentToolFailures = [];
  if (!errors.length) {
    try {
      selfTestFailures = await checkSelfTests(browser, `http://127.0.0.1:${port}/`, dir);
    } catch (e) {
      log("warn", "Verify: self-check layer failed to run.", errorData(e));
    }
    // Layer 5 — the product against what it promises an agent. Only worth
    // running once its own checks pass: a broken product reports broken tools
    // from the same root cause.
    if (!selfTestFailures.length) {
      try {
        agentToolFailures = await checkAgentTools(browser, `http://127.0.0.1:${port}/`, dir);
      } catch (e) {
        log("warn", "Verify: agent-tools layer failed to run.", errorData(e));
      }
    }
  }

  if (browser) await browser.close().catch(() => {});
  server.close();

  if (errors.length) return { ok: false, layer: "runtime", errors: [...new Set(errors)] };
  if (selfTestFailures.length) {
    return { ok: false, layer: "selftest", errors: [...new Set(selfTestFailures)] };
  }
  if (agentToolFailures.length) {
    return { ok: false, layer: "agenttools", errors: [...new Set(agentToolFailures)] };
  }
  return { ok: true, layer: null, errors: [] };
}

// ---------------------------------------------------------------------------
// App review — judge the built site WITHOUT a vision model.
//
// The agents can't see, but "can't see" turned out not to require a pair of eyes:
// everything a screenshot critique was asked to spot — overflow, overlap,
// unreadable contrast, collapsed regions, broken images, unstyled content — is a
// measurable property of the rendered page. So the browser measures it directly
// via getBoundingClientRect + getComputedStyle, and reports exact selectors
// instead of "something looks off on mobile".
//
// This is deterministic, costs ZERO model requests, and cannot invent a defect
// that isn't there — which matters more than it sounds: a hallucinated defect
// became a ticket, and the Builder then spent real requests "fixing" nothing.
// ---------------------------------------------------------------------------

// Viewports the layout is measured at. Defects are reported per viewport, since
// nearly all of them are width-dependent.
//
// The phone is a real one, not a narrow desktop window: touch and isMobile change
// what the page is told about itself (pointer media queries, the meta viewport),
// and a layout that only reflows for a narrow mouse-driven window has not been
// tested on the device a visitor holds. The desktop is a common laptop-to-monitor
// size wide enough that a layout leaving most of it empty is visibly doing so.
export const REVIEW_VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900, touch: false },
  { label: "phone", width: 390, height: 844, touch: true },
];

// Playwright context options for a viewport, so every page opened at one is the
// same device rather than the same width.
export const viewportOptions = (vp) => ({
  viewport: { width: vp.width, height: vp.height },
  isMobile: vp.touch,
  hasTouch: vp.touch,
});

// A page whose content spans less than this share of a desktop window is a
// narrow column in the middle of an empty screen. Loose on purpose: a sidebar
// layout with generous margins clears it easily, and only a layout that ignores
// most of the window does not.
const MIN_DESKTOP_CONTENT_SPAN = 0.6;

// The smallest comfortable touch target. WCAG asks for 44px at AAA and 24px at
// AA; 40 sits between them because a phone game is tapped repeatedly, and a
// target a thumb misses one time in five is a control that does not work.
const MIN_TAP_TARGET_PX = 40;

/**
 * How much of a desktop window the page's content actually uses, as a defect
 * message — or null when it uses enough. `span` is the horizontal extent of every
 * visible piece of content (text, media, controls) — not of the containers around
 * it, since a full-width background behind a centred column is still a column.
 */
export function describeNarrowLayout({ viewportWidth, contentLeft, contentRight }) {
  if (!(viewportWidth > 0) || !(contentRight > contentLeft)) return null;
  const left = Math.max(0, contentLeft);
  const right = Math.min(viewportWidth, contentRight);
  const share = (right - left) / viewportWidth;
  if (share >= MIN_DESKTOP_CONTENT_SPAN) return null;
  return `narrow centre column: content spans ${Math.round(share * 100)}% of the ${viewportWidth}px window ` +
    `(${Math.round(left)}px to ${Math.round(right)}px) — a large screen should use the whole window, ` +
    `not leave ${Math.round((1 - share) * 100)}% of it empty.`;
}

/**
 * Controls too small to hit reliably with a thumb, as defect messages — capped
 * like every other kind, so a toolbar of tiny icons names the worst few rather
 * than all of them. `targets` are the rendered boxes of interactive elements.
 */
export function describeSmallTapTargets(targets) {
  // A box a pixel thin is the visually-hidden pattern (a skip link, a label for
  // screen readers) — present for assistive technology, never meant to be tapped.
  const isVisuallyHidden = (target) => target.width <= 1 || target.height <= 1;
  return targets
    .filter((target) => !isVisuallyHidden(target))
    .filter((target) => target.width < MIN_TAP_TARGET_PX || target.height < MIN_TAP_TARGET_PX)
    .sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))
    .slice(0, MAX_DEFECTS_PER_KIND)
    .map((target) =>
      `tap target ${Math.round(target.width)}x${Math.round(target.height)}px is under the ${MIN_TAP_TARGET_PX}px minimum for touch: ${target.label}`
    );
}

/**
 * The raw boxes the screen-use checks above judge: the horizontal extent of all
 * visible content, and the size of every visible control. Measured in the page,
 * judged in node, so the thresholds are testable without a browser.
 */
async function measureScreenUse(page) {
  return page.evaluate(() => {
    const isShown = (el, rect) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${text ? ` ("${text}")` : ""}`;
    };

    let contentLeft = Infinity;
    let contentRight = -Infinity;
    for (const el of [...document.querySelectorAll("body *")].slice(0, 1500)) {
      const isContent = ["IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(el.tagName.toUpperCase()) ||
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!isContent) continue;
      const rect = el.getBoundingClientRect();
      if (!isShown(el, rect)) continue;
      contentLeft = Math.min(contentLeft, rect.left);
      contentRight = Math.max(contentRight, rect.right);
    }

    const controls = document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]');
    const tapTargets = [];
    for (const el of controls) {
      // A checkbox wrapped in its label is tapped through the label, so the label
      // is the target a thumb actually aims at.
      const target = el.closest("label") || el;
      const rect = target.getBoundingClientRect();
      if (!isShown(target, rect)) continue;
      tapTargets.push({ label: describe(el), width: rect.width, height: rect.height });
    }
    return { viewportWidth: window.innerWidth, contentLeft, contentRight, tapTargets };
  });
}

/**
 * The screen-use defects for one viewport. Each check only means something on its
 * own kind of screen — a phone column is SUPPOSED to be narrow, and a mouse does
 * not need a 40px target.
 */
async function measureScreenUseDefects(page, vp) {
  const measured = await measureScreenUse(page);
  if (vp.touch) return describeSmallTapTargets(measured.tapTargets);
  const narrow = describeNarrowLayout(measured);
  return narrow ? [narrow] : [];
}

// Caps so one badly-broken page can't produce a thousand-line report. The point
// is to name the worst offenders, not to enumerate every instance.
const MAX_DEFECTS_PER_KIND = 5;
// WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or >=19px bold).
const CONTRAST_MIN_NORMAL = 4.5;
const CONTRAST_MIN_LARGE = 3;

/**
 * Measure layout/appearance defects in the page as rendered. Runs entirely in the
 * browser and returns plain strings. Anything genuinely subjective (does this feel
 * right? is the hierarchy right?) is deliberately NOT here — this function only
 * reports things that are true or false, never matters of taste.
 */
async function measureLayoutDefects(page) {
  return page.evaluate(
    ({ maxPerKind, minNormal, minLarge }) => {
      const defects = [];
      const add = (kind, list, msg) => {
        if (list.length < maxPerKind) {
          list.push(msg);
          defects.push(msg);
        }
      };

      // A short, stable, human-readable handle for an element.
      const describe = (el) => {
        const id = el.id ? `#${el.id}` : "";
        const cls = el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : "";
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
        return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` ("${text}")` : ""}`;
      };

      // An element can have a healthy box of its own and still be invisible,
      // because an ancestor collapsed to nothing and clips it. Such children are
      // not on screen, so measuring their overlap or contrast reports defects the
      // visitor can never see.
      const isClippedByAncestor = (el) => {
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
          const s = getComputedStyle(node);
          if (s.overflow === "hidden" || s.overflow === "clip") {
            const r = node.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return true;
          }
        }
        return false;
      };

      const isRendered = (el, style, rect) =>
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !isClippedByAncestor(el);

      // --- Unstyled content: no author CSS applied at all. -------------------
      if (document.styleSheets.length === 0) {
        defects.push("no stylesheet is applied — the page is rendering unstyled.");
      }

      // --- Page-level horizontal overflow. ----------------------------------
      const doc = document.scrollingElement || document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) {
        defects.push(
          `the page scrolls horizontally: content is ${doc.scrollWidth}px wide in a ${window.innerWidth}px viewport.`
        );
      }

      const all = [...document.querySelectorAll("body *")].slice(0, 1500);
      const visible = [];
      const overflowing = [];
      const collapsed = [];
      const brokenImages = [];
      const lowContrast = [];

      for (const el of all) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        // --- Broken images. -------------------------------------------------
        if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0) {
          add("broken", brokenImages, `broken or missing image: ${describe(el)} (src="${el.getAttribute("src") || ""}")`);
          continue;
        }

        // --- Collapsed containers: has children but no rendered size. -------
        if (
          style.display !== "none" &&
          el.children.length > 0 &&
          (rect.width === 0 || rect.height === 0) &&
          style.position !== "absolute" &&
          style.position !== "fixed"
        ) {
          add("collapsed", collapsed, `collapsed container (${Math.round(rect.width)}x${Math.round(rect.height)}) despite ${el.children.length} child element(s): ${describe(el)}`);
        }

        if (!isRendered(el, style, rect)) continue;

        // --- Elements past the right edge. ----------------------------------
        if (rect.right > window.innerWidth + 1 && rect.left < window.innerWidth) {
          add("overflow", overflowing, `element runs ${Math.round(rect.right - window.innerWidth)}px past the right edge: ${describe(el)}`);
        }

        // Track leaf-ish text nodes for overlap + contrast.
        const ownText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0
        );
        if (ownText) visible.push({ el, rect, style });
      }

      // --- Contrast of text against its effective background. ---------------
      const parseColor = (c) => {
        const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
      };
      // Walk up until an ancestor paints an opaque background; default to white.
      const effectiveBackground = (el) => {
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          const bg = parseColor(getComputedStyle(node).backgroundColor);
          if (bg && bg.a > 0.5) return bg;
        }
        const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
        return bodyBg && bodyBg.a > 0.5 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
      };
      const luminance = ({ r, g, b }) => {
        const ch = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };

      for (const { el, style } of visible) {
        const fg = parseColor(style.color);
        if (!fg || fg.a < 0.5) continue;
        const bg = effectiveBackground(el);
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(style.fontSize) || 16;
        const bold = Number(style.fontWeight) >= 700;
        const floor = size >= 24 || (size >= 19 && bold) ? minLarge : minNormal;
        if (ratio < floor) {
          add("contrast", lowContrast, `text contrast ${ratio.toFixed(2)}:1 is below the ${floor}:1 minimum (${style.color} on rgb(${bg.r},${bg.g},${bg.b})): ${describe(el)}`);
        }
      }

      // --- Overlapping text: two text elements sharing the same pixels. -----
      const overlaps = [];
      for (let i = 0; i < visible.length && overlaps.length < maxPerKind; i++) {
        for (let j = i + 1; j < visible.length && overlaps.length < maxPerKind; j++) {
          const a = visible[i];
          const b = visible[j];
          // Nested elements legitimately share space — only compare siblings.
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (w <= 0 || h <= 0) continue;
          const areaA = a.rect.width * a.rect.height;
          const areaB = b.rect.width * b.rect.height;
          const share = (w * h) / Math.min(areaA, areaB);
          if (share > 0.4) {
            add("overlap", overlaps, `text overlaps (${Math.round(share * 100)}% of the smaller box): ${describe(a.el)} over ${describe(b.el)}`);
          }
        }
      }

      return defects;
    },
    {
      maxPerKind: MAX_DEFECTS_PER_KIND,
      minNormal: CONTRAST_MIN_NORMAL,
      minLarge: CONTRAST_MIN_LARGE,
    }
  );
}

// Most interactive elements the sweep will exercise per run.
const MAX_INTERACTIONS = 12;

// A sample value the sweep types into text fields, so form-driven behavior
// (validation, persistence, errors) gets exercised — not just clicks.
const FILL_VALUE = "Automated review test entry";
const TEXT_INPUT_TYPES = ["", "text", "search", "email", "url", "tel", "password", "number"];

// Exercise one element the way a user would: type into text fields, choose an
// option in selects, click everything else. Returns the verb performed so the
// caller can phrase findings and skip the no-effect check for fills/selects.
async function exerciseTarget(loc, t) {
  if (t.tag === "select") {
    try {
      await loc.selectOption({ index: 1 });
      return "select";
    } catch {
      await loc.click({ timeout: 2000 });
      return "click";
    }
  }
  if (t.tag === "textarea" || (t.tag === "input" && TEXT_INPUT_TYPES.includes(t.type))) {
    await loc.fill(FILL_VALUE, { timeout: 2000 });
    return "fill";
  }
  await loc.click({ timeout: 2000 });
  return "click";
}

/**
 * Drive the app like a user: click each interactive element and record what
 * happens — a JS error it triggers (high-confidence bug) or no DOM effect at all
 * (low-confidence; a canvas/JS-only app can legitimately not change the DOM).
 * Returns a list of human-readable findings. Best-effort; never throws.
 */
async function exploreInteractions(browser, url) {
  const page = await browser.newPage(viewportOptions(REVIEW_VIEWPORTS[0]));
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));

  // Tag the interactive elements so we can re-locate each one to click it.
  const tagTargets = () =>
    page.evaluate((limit) => {
      const sel = 'a[href], button, input, select, textarea, [role="button"], [onclick]';
      const found = new Set(document.querySelectorAll(sel));
      for (const el of document.querySelectorAll("*")) {
        if (getComputedStyle(el).cursor === "pointer") found.add(el);
      }
      return Array.from(found).slice(0, limit).map((el, i) => {
        el.setAttribute("data-explore-id", String(i));
        const text = (el.innerText || el.value || el.getAttribute("aria-label") || "")
          .trim().replace(/\s+/g, " ");
        return {
          id: i,
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute("type") || "").toLowerCase(),
          label: (text || el.tagName.toLowerCase()).slice(0, 40),
        };
      });
    }, MAX_INTERACTIONS);

  const findings = [];
  const base = url.split("#")[0];
  let postDefects = [];
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    const targets = await tagTargets();
    for (const t of targets) {
      const loc = page.locator(`[data-explore-id="${t.id}"]`);
      if ((await loc.count()) === 0) continue; // DOM changed out from under us
      const errBefore = errors.length;
      const htmlBefore = await page.evaluate(() => document.body.innerHTML);
      let action;
      try {
        action = await exerciseTarget(loc, t);
      } catch (e) {
        findings.push(`"${t.label}" — could not be exercised: ${String(e.message).split("\n")[0]}`);
        continue;
      }
      await page.waitForTimeout(500);
      const newErrors = errors.slice(errBefore);
      if (newErrors.length) {
        findings.push(`"${t.label}" — ${action} triggered a JS error: ${newErrors[0]}`);
      } else if (page.url().split("#")[0] !== base) {
        findings.push(`"${t.label}" — navigated away to ${page.url()}`);
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
        await tagTargets().catch(() => {});
      } else if (action === "click" && !["input", "textarea", "select"].includes(t.tag)) {
        // Only clicked controls are expected to mutate the DOM; fills/selects
        // change their own value, not structure, so they're not "no-effect" bugs.
        const htmlAfter = await page.evaluate(() => document.body.innerHTML);
        if (htmlAfter === htmlBefore) {
          findings.push(`"${t.label}" — looks interactive but had no visible effect (may be canvas/JS-only).`);
        }
      }
    }
    // Measure the app as the user LEAVES it — panels open, fields filled. First
    // paint is the easy case; a layout usually breaks once something is expanded,
    // and this state is unreachable from a fresh page load.
    postDefects = await measureLayoutDefects(page);
  } catch (e) {
    findings.push(`interaction sweep stopped early: ${String(e.message).split("\n")[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
  return { findings, postDefects };
}
/**
 * Review the built site with no model involved at all: measure the rendered
 * layout at each viewport, then drive every interactive element and record what
 * breaks. Returns a `## Defects` / `## Functional` report for the Product Manager,
 * or null when there's nothing to review (no page yet, Playwright missing).
 *
 * Costs zero model requests and never throws — any failure degrades to a partial
 * report or null, and the caller proceeds.
 */
export async function reviewApp(relDir = "docs") {
  const dir = join(repoRoot, relDir);
  if (!fs.existsSync(join(dir, "index.html"))) {
    log("info", "App review: no index.html yet — skipping.");
    return null;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    log("warn", "App review: Playwright unavailable — skipping.", errorData(e));
    return null;
  }

  const { server, port } = await startStaticServer(dir);
  const url = `http://127.0.0.1:${port}/`;
  // defect message -> the viewports it occurs at. Most faults reproduce at every
  // width, and repeating each one per viewport buried the width-specific ones
  // (which are the interesting kind) in three times as much text.
  const defectsByViewport = new Map();
  const recordDefects = (label, messages) => {
    for (const msg of messages) {
      if (!defectsByViewport.has(msg)) defectsByViewport.set(msg, []);
      defectsByViewport.get(msg).push(label);
    }
  };
  let functional = [];
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    log("warn", "App review: could not launch browser — skipping.", errorData(e));
    server.close();
    return null;
  }

  // Measure the layout at each viewport (best-effort per viewport, so one bad
  // width still lets the others report).
  for (const vp of REVIEW_VIEWPORTS) {
    let page;
    try {
      page = await browser.newPage(viewportOptions(vp));
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      // The product may animate in; let it settle so we measure a steady state.
      await page.waitForTimeout(1500);
      recordDefects(vp.label, await measureLayoutDefects(page));
      recordDefects(vp.label, await measureScreenUseDefects(page, vp));
    } catch (e) {
      log("warn", `App review: could not measure the ${vp.label} layout.`, errorData(e));
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  // Drive the app and record what breaks, then measure the state it's left in.
  try {
    const sweep = await exploreInteractions(browser, url);
    functional = sweep.findings;
    recordDefects("desktop, after interacting", sweep.postDefects);
  } catch (e) {
    log("warn", "App review: interaction sweep failed.", errorData(e));
  }

  await browser.close().catch(() => {});
  server.close();

  const parts = [];
  if (defectsByViewport.size) {
    const lines = [...defectsByViewport].map(([msg, labels]) => `- ${msg} (at: ${labels.join("; ")})`);
    parts.push(`## Defects (measured in the rendered page)\n${lines.join("\n")}`);
  }
  if (functional.length) {
    parts.push(`## Functional (observed behavior)\n${functional.map((f) => `- ${f}`).join("\n")}`);
  }
  if (!parts.length) {
    log("info", "App review: no defects measured and nothing broke when exercised.");
    return null;
  }
  const report = parts.join("\n\n");
  log("info", `App review (measured layout + interaction sweep):\n${report}`);
  return report;
}
