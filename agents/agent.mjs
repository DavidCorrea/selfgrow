// Running an agent session: the model chain, the limits on one session, what its
// tools may reach, and the skills it is given.

import fs from "fs";
import os from "os";
import { join, sep, relative } from "path";
import { fileURLToPath } from "url";
import {
  ModelRuntime,
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  createBashToolDefinition,
  loadSkillsFromDir,
  DefaultResourceLoader,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  log,
  withLogGroup,
  errorData,
  truncate,
  getRunLog,
  getTicketOutcomes,
  appendJobSummary,
} from "./log.mjs";
import { secret } from "./secrets.mjs";
import { agentsDir, repoRoot } from "./paths.mjs";
import { containsParseableJSON, extractAgentResponse } from "./prompts.mjs";

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
const MODELS_FILE = join(agentsDir, "models.json");

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

// Never send thinkingLevel "off": both configured models are reasoning models,
// and some endpoints reject a disabled-reasoning request
// outright ("Reasoning is mandatory for this endpoint and cannot be disabled",
// HTTP 400) — a wasted request against the daily cap. "low" is the real floor.
const MIN_THINKING_LEVEL = "low";

// Default kickoff turn when a caller doesn't supply one. The agent's full role
// lives in the system prompt; this just tells it to begin.
const DEFAULT_TASK =
  "Carry out the task described in your instructions now, then respond with the required JSON object and nothing else.";

// Meta-routers dispatch to an arbitrary underlying model, so a run using one is
// not reproducible — never auto-discover them.
export const META_ROUTER_IDS = new Set(["auto", "openrouter/free", "openrouter/fusion"]);

// pi's model/auth runtime. Creation is async and reads ~/.pi auth + the bundled
// model snapshot, so it's built once and shared by every model call in the run.
// The OpenRouter key is handed over as a runtime key — held in memory, never
// written to ~/.pi — because in CI it is not in the environment for pi-ai's own
// lookup to find (see secrets.mjs).
let modelRuntimePromise;
async function createModelRuntime() {
  // No network refresh: resolve ids against pi's bundled snapshot, so a run's
  // model lineup can't shift underneath it mid-flight.
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  const apiKey = secret("OPENROUTER_API_KEY");
  if (apiKey) await runtime.setRuntimeApiKey("openrouter", apiKey);
  return runtime;
}
function getModelRuntime() {
  modelRuntimePromise ??= createModelRuntime();
  return modelRuntimePromise;
}

/** A registry model's chain id (`provider/id`). */
export const modelIdOf = (m) => `${m.provider}/${m.id}`;

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
// plan. 40 is comfortably above what the planning and reviewing roles need, so for
// them it only stops a loop. The Builder is the exception — its merged sessions
// ran 34-36 turns, and every devs "abort" in September was this cap cutting real
// work off — so it carries its own, larger limits (BUILDER_SESSION_LIMITS).
const MAX_SESSION_TURNS = Number(process.env.MAX_SESSION_TURNS || 40);

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

// Both caps together, as a session receives them. A role whose healthy sessions
// are longer than the default passes its own — see BUILDER_SESSION_LIMITS in
// devs.mjs — rather than every role inheriting the longest one's budget.
const DEFAULT_SESSION_LIMITS = { turns: MAX_SESSION_TURNS, minutes: MAX_SESSION_MINUTES };

// How long the MODEL may go without a word — no token, no event — before it
// counts as that model failing. The session cap alone let one hung request spend
// a whole session: the weekly report sent one request to deepseek-v4-flash on
// 09-13 and again on 09-20 and heard nothing back for the full 12 minutes, while
// on 09-06 the same request was answered in ~25s. A silence this long is a stuck
// provider, not thinking — a healthy turn streams within seconds — so it is cut
// off early enough to leave the next model in the chain time to answer.
//
// Only the model's silence counts. Time a tool spends running (npm test, a
// Playwright pass) is ours, not the provider's, and is not held against it.
export const MAX_MODEL_SILENCE_MINUTES = Number(process.env.MAX_MODEL_SILENCE_MINUTES || 3);

/**
 * Tracks how long a session has been waiting on its model. Every pi event is a
 * sign of life; a tool in flight pauses the clock, since that wait is ours.
 * `now` is injectable so the rule can be tested without a session.
 */
export function createModelSilenceClock(now = Date.now) {
  let toolsRunning = 0;
  let lastHeard = now();
  return {
    hear(event) {
      if (event.type === "tool_execution_start") toolsRunning++;
      if (event.type === "tool_execution_end") toolsRunning = Math.max(0, toolsRunning - 1);
      lastHeard = now();
    },
    silentForMs() {
      return toolsRunning ? 0 : now() - lastHeard;
    },
  };
}

// Why we stop a session ourselves, worded once for both the log line at the
// moment we stop it and the error the caller receives.
const SESSION_STOPS = {
  turns: {
    cap: (limits) => `the ${limits.turns}-turn session cap`,
    why: "The session is looping; stopping it here protects the day's remaining requests.",
  },
  minutes: {
    cap: (limits) => `the ${limits.minutes}-minute session cap`,
    why: "Stopping here keeps the job's own timeout from killing the run mid-session.",
  },
};
const MODEL_SILENCE = `the model sent nothing for ${MAX_MODEL_SILENCE_MINUTES} minute(s)`;

/** What the log says at the moment we stop a session, and why. */
function stopLogMessage(reason, limits) {
  if (reason === "silent") return `${MODEL_SILENCE}; trying the next model.`;
  const stop = SESSION_STOPS[reason];
  return `hit ${stop.cap(limits)}. ${stop.why}`;
}

/**
 * The error for a session WE stopped, saying why in our words. pi reports its
 * own abort as "This operation was aborted", which is what the devs and PM runs
 * logged for every turn-capped session — indistinguishable from a provider
 * failure. The flag decides what runAgent does next (see chainVerdict).
 */
export function sessionAbortError(label, reason, turns, limits = DEFAULT_SESSION_LIMITS) {
  if (reason === "silent") {
    const err = new Error(`${label}: ${MODEL_SILENCE} — treated as that model failing (${turns} turn(s) spent).`);
    err.modelSilent = true;
    return err;
  }
  const err = new Error(`${label} was stopped by ${SESSION_STOPS[reason].cap(limits)} (${turns} turn(s) spent).`);
  err.sessionCapped = true;
  return err;
}

/**
 * What a failed attempt means for the rest of the chain: "capped" and "billing"
 * stop it, anything else — a silent model included — moves on to the next model.
 */
export function chainVerdict(err) {
  if (err?.sessionCapped) return "capped";
  if (isDailyQuotaExhausted(err)) return "billing";
  return "next";
}

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

/** Every model pi knows, or null when the runtime can't be read. */
async function getAllModels() {
  try {
    return await listRegistryModels();
  } catch (e) {
    log("warn", "Model chain: could not read pi's registry.", errorData(e));
    return null;
  }
}

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
async function resolveTextModels() {
  const all = await getAllModels();
  if (!all) {
    log("warn", "Model chain: using configured ids as-is.");
    return TEXT_MODELS;
  }
  return chainPresentIn(all);
}

/** The configured ids that `registry` still has, in chain order, saying which are gone. */
function chainPresentIn(registry) {
  const present = [];
  for (const id of TEXT_MODELS) {
    if (registry.some((m) => modelIdOf(m) === id)) present.push(id);
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
 * Vision is a property of the model, not of the chain: an entry can be text-only
 * (the head was, until 2026-09-27), and pi drops image content for a model whose registry entry
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
  for (const id of chainPresentIn(all)) {
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
 * @param {string} [opts.group]          - Title of the collapsible log section the
 *                                          session runs in; defaults to the label.
 * @param {string} opts.systemPrompt     - The agent's role/instructions. Set as the
 *                                          actual system prompt (not a user message).
 * @param {string} [opts.task]           - The user turn that kicks the agent off.
 * @param {string[]} [opts.tools]        - Allowed tool names.
 * @param {string[]} [opts.skills]       - Names of skills under agents/skills/ the
 *                                          agent may load. Needs read or bash.
 * @param {string} [opts.thinkingLevel]  - "off" | "low" | "medium" | "high".
 * @param {string} [opts.modelId]        - Pin a single model; omit to use the chain.
 * @param {object[]} [opts.images]       - Image parts ({ type, data, mimeType }) to
 *                                          attach to the kickoff turn. Requires a
 *                                          model that accepts image input.
 */
export async function runAgent({ group, ...callerOpts }) {
  return withLogGroup(group ?? callerOpts.label ?? "Agent", () => runAgentChain(callerOpts));
}

async function runAgentChain(callerOpts) {
  const { modelId, label = "Agent", expectJson = true, avoidModel = null } = callerOpts;
  // Resolved once, before the chain: a skill that is missing is missing for every
  // model, and a failed attempt would otherwise walk the chain to prove it.
  const { skills = [], ...agentOpts } = callerOpts;
  const opts = { ...agentOpts, skillPaths: skillPathsFor(skills, callerOpts.tools ?? ["read"]) };

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
      const verdict = chainVerdict(e);
      if (verdict === "capped") throw e;
      // A billing refusal is account-wide — every remaining model shares the same
      // balance, so continuing would burn one request per model to fail
      // identically.
      if (verdict === "billing") {
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

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

// Skills the harness ships, one `<name>/SKILL.md` each. Only these, and only the
// ones a caller names: the loader runs with noSkills, so nothing on the runner's
// disk can slip into an agent's instructions.
export const SKILLS_DIR = join(repoRoot, "agents", "skills");

// Skills the product ships, laid out the same way. They are product, not
// machine: the Devs write them like any other file in docs/, every agent that
// can read gets all of them, and a reset deletes them with the rest.
const PROJECT_SKILLS_DIR = join(repoRoot, "docs", "skills");

const skillDirectories = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];

/**
 * The SKILL.md paths an agent gets: the harness skills its caller named, checked
 * up front, then every project skill. pi reports a missing skill as a diagnostic
 * and runs on without it, and it lists skills only to an agent that has read or
 * bash to open them — both would leave the agent silently without what its
 * caller asked for. Project skills are nobody's request, so an agent that cannot
 * read simply goes without them.
 */
export function skillPathsFor(names, tools, projectSkillsDir = PROJECT_SKILLS_DIR) {
  const canRead = tools.some((tool) => tool === "read" || tool === "bash");
  if (names.length && !canRead) {
    throw new Error(`Skills ${names.join(", ")} were requested, but an agent needs the read or bash tool to load a skill (tools: [${tools.join(", ")}]).`);
  }
  const harnessPaths = names.map((name) => {
    const path = join(SKILLS_DIR, name, "SKILL.md");
    if (!fs.existsSync(path)) throw new Error(`Unknown skill "${name}": ${relative(repoRoot, path)} does not exist.`);
    return path;
  });
  if (!canRead) return harnessPaths;
  const projectPaths = skillDirectories(projectSkillsDir)
    .map((name) => join(projectSkillsDir, name, "SKILL.md"))
    .filter((path) => fs.existsSync(path));
  return [...harnessPaths, ...projectPaths];
}

/**
 * Why each project skill would not reach an agent, as build errors — empty when
 * they all load. The Devs write these, and pi skips a broken one with no more
 * than a diagnostic nobody reads, so the build is the only place it can be seen.
 */
export function projectSkillProblems(projectSkillsDir = PROJECT_SKILLS_DIR) {
  const harnessNames = new Set(skillDirectories(SKILLS_DIR));
  return skillDirectories(projectSkillsDir).flatMap((name) => {
    const dir = join(projectSkillsDir, name);
    const where = `${relative(repoRoot, dir) || dir}/SKILL.md`;
    if (!fs.existsSync(join(dir, "SKILL.md"))) return [`${relative(repoRoot, dir) || dir} has no SKILL.md, so it is not a skill.`];
    if (harnessNames.has(name)) return [`${where}: "${name}" is already a harness skill in agents/skills/ — pick another name.`];
    const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "project" });
    if (diagnostics.length) return diagnostics.map((diagnostic) => `${where}: ${diagnostic.message} — pi skips a skill it cannot load cleanly.`);
    const loadedName = skills[0]?.name;
    if (loadedName !== name) return [`${where}: the skill is named "${loadedName}" but its directory is "${name}" — make them match.`];
    return [];
  });
}

// The two roles that decide what a visitor sees. The Builder gets taste, the
// rules, a way to make what it builds hold up, and a way to look at
// what it built; the Reviewer gets only the rules, because it judges a change against the
// Vision and the ticket, not against its own sense of what would look better.
export const BUILDER_SKILLS = [
  "frontend-design",
  "web-interface-guidelines",
  "harden-the-interface",
  "see-your-change",
];
const REVIEWER_SKILLS = ["web-interface-guidelines"];

/**
 * One Reviewer session, configured the same wherever a change is judged, and its
 * answer parsed. Null when the answer could not be read — what that means is the
 * caller's to decide.
 */
export async function runReviewer({ group, systemPrompt, avoidModel = null }) {
  const output = await runAgent({
    label: "Reviewer",
    group,
    systemPrompt,
    tools: ["read", "bash"],
    skills: REVIEWER_SKILLS,
    avoidModel,
  });
  return extractAgentResponse("Reviewer", output, { requiredDataFields: ["issues"] });
}

/** Assistant messages so far — one per charged completion, whatever event revealed it. */
export function countAssistantTurns(messages = []) {
  return messages.filter((message) => message.role === "assistant").length;
}

/** The text of an assistant message, whether pi gave it as a string or as parts. */
export function assistantText(message) {
  if (!message?.content) return "";
  if (!Array.isArray(message.content)) return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Watch one session against its limits: the turn cap, the session deadline and
 * the model-silence clock. Stops the session at the first limit to bite and
 * remembers which one it was (`abortReason`: "turns", "minutes" or "silent").
 *
 * Spend is charged AS IT HAPPENS rather than in one lump when the session
 * settles, because a session that never settles — the runner's timeout, a
 * cancel — would otherwise be spent but uncounted. `settle()` clears the timers
 * and catches whatever the last event missed: a final assistant message can land
 * with no further event to observe it. It reconciles rather than adds, so a
 * session is never billed twice in our own accounting — both exit paths used to
 * add the whole count independently, and over-reporting starves later runs as
 * surely as under-reporting overspends. Returns the session's turn count.
 */
export function watchSession(session, { limits, label, startTime }) {
  let abortReason = null;
  let chargedTurns = 0;
  const turnsSoFar = () => countAssistantTurns(session.state?.messages);
  const chargeTurns = (turns) => {
    if (turns <= chargedTurns) return;
    modelTurnCount += turns - chargedTurns;
    chargedTurns = turns;
  };
  // Error, not warn: an aborted session is lost work, and it used to show only
  // as a warning annotation on a run that stayed green. Only the first limit to
  // bite gets to abort and name itself.
  const stop = (reason) => {
    if (abortReason) return;
    abortReason = reason;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    log("error", `${label}: aborted after ${elapsed}s — ${stopLogMessage(reason, limits)}`);
    session.abort().catch(() => {});
  };

  // Stop a session that is slow rather than looping, before the runner does: the
  // caller gets its partial output, the spend is recorded, and the run ends on
  // its own terms. Neither timer may hold the process open on its own.
  const deadline = setTimeout(() => stop("minutes"), limits.minutes * 60 * 1000);
  deadline.unref?.();

  // Stop a model that has gone quiet, so the chain can try the next one while
  // there is still session time left for it (see MAX_MODEL_SILENCE_MINUTES).
  const silence = createModelSilenceClock();
  const silenceWatch = setInterval(() => {
    if (silence.silentForMs() >= MAX_MODEL_SILENCE_MINUTES * 60 * 1000) stop("silent");
  }, 10 * 1000);
  silenceWatch.unref?.();

  session.subscribe((event) => {
    silence.hear(event);
    // Streaming deltas arrive thousands of times per turn and never change the
    // message COUNT, so don't walk the list for them — only for the events that
    // can mean a message was appended.
    if (event.type === "message_update" || event.type === "bash_execution_update") return;
    const turns = turnsSoFar();
    chargeTurns(turns);
    // A session this long is looping, not thinking: every further turn is a
    // charged request the run will not get a merge out of.
    if (turns >= limits.turns) stop("turns");
  });

  return {
    get abortReason() {
      return abortReason;
    },
    settle() {
      clearTimeout(deadline);
      clearInterval(silenceWatch);
      const turns = turnsSoFar();
      chargeTurns(turns);
      return turns;
    },
  };
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
  skillPaths = [],
  thinkingLevel = MIN_THINKING_LEVEL,
  modelId,
  images = [],
  sessionLimits = DEFAULT_SESSION_LIMITS,
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
  // the session cwd the agent actually reads and edits in. The only skills are
  // the ones the caller named (see skillPathsFor).
  const loader = new DefaultResourceLoader({
    cwd: repoRoot,
    agentDir: repoRoot,
    systemPrompt,
    appendSystemPrompt: [],
    additionalSkillPaths: skillPaths,
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

  await loader.reload();
  const { session } = await createAgentSession({
    cwd: repoRoot,
    sessionManager: SessionManager.inMemory(),
    resourceLoader: loader,
    model,
    thinkingLevel,
    modelRuntime,
    tools,
    customTools: confinedTools(),
  });
  const watch = watchSession(session, {
    limits: sessionLimits,
    label: label.includes(modelId) ? label : `${label} (${modelId})`,
    startTime,
  });
  let streamed = "";
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      streamed += event.assistantMessageEvent.delta;
    }
  });

  try {
    // With images, the kickoff turn has to be a content ARRAY, which prompt()
    // does not take — sendUserMessage does, and triggers a turn the same way.
    await (images.length
      ? session.sendUserMessage([{ type: "text", text: task }, ...images])
      : session.prompt(task));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const lastAssistant = session.state.messages.findLast((message) => message.role === "assistant");
    // A session WE stopped ends its turn as stopReason "error" with pi's "This
    // operation was aborted" — which the check below would report as the model
    // failing. Say which of our limits it was instead. A silent model is always a
    // failure: whatever it said before going quiet is not an answer.
    if (watch.abortReason === "silent" || (watch.abortReason && lastAssistant?.stopReason === "error")) {
      throw sessionAbortError(label, watch.abortReason, watch.settle(), sessionLimits);
    }
    // The model can fail without throwing — the error lands on the assistant
    // message as stopReason "error". Surface it loudly instead of returning empty
    // output (which looks like an unparseable response).
    if (lastAssistant?.stopReason === "error") {
      const detail = lastAssistant.errorMessage || "unknown error";
      // A free slug that OpenRouter has since moved behind payment. Called out by
      // name because model-check.mjs structurally CANNOT catch it: that check
      // reads pi's BUNDLED snapshot, which still reports the id as costing 0/0
      // long after the live provider stopped serving it free. Without this the
      // failure reads as a generic model error and the dead entry sits in the
      // chain wasting a request per fallthrough.
      if (/unavailable for free|available for free/i.test(detail)) {
        log(
          "error",
          `${label}: "${modelId}" is NO LONGER FREE at OpenRouter, though pi's snapshot still lists it as free. ` +
            `model-check.mjs cannot see this — remove or repoint the entry in agents/models.json by hand.`
        );
      }
      throw new Error(`${label} model call failed: ${detail}`);
    }
    const output = assistantText(lastAssistant) || streamed;
    // A session is ONE budget unit but many OpenRouter requests: the agentic loop
    // issues a completion per turn, so every tool call is another charge. Count
    // assistant messages — one per turn — because that is what the account is
    // billed for.
    const turns = watch.settle();
    log(
      "info",
      `${label} agent completed in ${elapsed}s — ${turns} turn(s), ` +
        `${modelTurnCount} request(s) this run`
    );
    // An aborted session that produced nothing is a failure, and a loud one.
    // Marked as capped rather than a model fault so runAgent does NOT walk the
    // rest of the chain — a runaway usually repeats, and proving it costs another
    // MAX_SESSION_TURNS per model.
    if (watch.abortReason && !output.trim()) throw sessionAbortError(label, watch.abortReason, turns, sessionLimits);
    return output;
  } catch (err) {
    // An abort can surface here instead of above, depending on where the session
    // was when it was stopped. Name our reason either way: a cap must stop
    // runAgent rather than pay another MAX_SESSION_TURNS per remaining model to
    // watch the same runaway repeat, and a silent model must let it move on.
    if (watch.abortReason && !err?.sessionCapped && !err?.modelSilent) {
      throw sessionAbortError(label, watch.abortReason, watch.settle(), sessionLimits);
    }
    throw err;
  } finally {
    // A session that throws still spent every turn it took to get there — and
    // retry loops are exactly where the cap goes — so it is charged either way.
    watch.settle();
    session.dispose();
  }
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

/**
 * Run a role's `main` when its file is the process entry point, never when it is
 * imported — the tests import role files for their pure functions, and loading
 * one must not start a run. The summary is printed once, however the run ends,
 * so no early return can forget it.
 *
 * A crash exits hard rather than setting exitCode: a session or browser left
 * open by the failure would otherwise keep the job alive until its timeout.
 * `onCrash` runs first, for a role that owes someone an answer even then.
 */
export function runEntrypoint(moduleUrl, label, main, { onCrash, exitWhenDone = false } = {}) {
  if (!isEntrypoint(moduleUrl, process.argv[1])) return;
  main().then(
    () => {
      printRunSummary(label);
      if (exitWhenDone) process.exit();
    },
    async (err) => {
      log("error", `${label} failed: ${err.message || err}`, errorData(err));
      try {
        await onCrash?.(err);
      } catch (crashErr) {
        log("error", `${label} could not report its crash: ${crashErr.message || crashErr}`, errorData(crashErr));
      }
      printRunSummary(label);
      process.exit(1);
    }
  );
}

/**
 * Whether the file at `moduleUrl` is the script Node was started with. Node
 * resolves a module's own URL to its real path but leaves argv as typed, so a
 * checkout reached through a symlink would otherwise look like an import, and
 * the role would exit 0 without running.
 */
export function isEntrypoint(moduleUrl, entryScript) {
  if (!entryScript) return false;
  const entryPath = fs.existsSync(entryScript) ? fs.realpathSync(entryScript) : entryScript;
  return entryPath === fileURLToPath(moduleUrl);
}
