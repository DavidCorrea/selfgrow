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

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, relative, extname } from "path";
import fs from "fs";
import http from "http";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

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
// These are pi registry ids (provider/id); override via env TEXT_MODEL
// (comma-separated). Unknown ids degrade cleanly — resolveTextModels() drops any
// the registry doesn't know and auto-discovers free models when none remain.
export const TEXT_MODELS = (
  process.env.TEXT_MODEL ||
  // These ids must exist in pi's bundled model snapshot (pi-ai's
  // models.generated.js) — the registry is NOT fetched live from OpenRouter, so
  // an id pi doesn't know is skipped, not requested. Verified against the
  // installed pi version; re-check after bumping pi, as its free lineup rotates.
  // Ordered by ENVELOPE RELIABILITY, not by size. "Biggest first" was the old
  // rule and it was actively expensive: measured over one day, the 550B head
  // answered without usable JSON in 18 of 42 sessions and returned empty in 6 more
  // — a 57% failure rate — and each failure is a COMPLETED session that gets
  // discarded. One such Scout session ran 101 turns before failing, burning 63% of
  // that run's whole allowance before any work started.
  //
  // Size also buys nothing here: docs/ is a single 16K file, so a 1M context
  // window is dead weight next to actually returning the JSON the agents parse.
  //
  // ling-3.0-flash led on the evidence available (3 of 3 usable), followed by the
  // models OpenRouter reports as supporting structured_outputs — an imperfect but
  // real proxy for envelope discipline. nemotron-ultra stays last: capable, and
  // worth having when everything above it has failed, but not worth paying for
  // first. Confirm with `node agents/model-probe.mjs` before trusting this order.
  //
  // Deliberately SHORT. Each fallback is a real request charged against the daily
  // cap, so a long tail of weak models mostly buys wasted requests: by the time
  // the 7th model is answering, the output is rarely worth building on. One
  // model per provider family keeps the fallbacks genuinely independent.
  [
    "openrouter/inclusionai/ling-3.0-flash:free",
    "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
    "openrouter/openai/gpt-oss-20b:free",
    "openrouter/cohere/north-mini-code:free",
    "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Back-compat: the historical single-model default is just the head of the chain.
export const MODEL_ID = TEXT_MODELS[0];

// Never send thinkingLevel "off": every free model in pi's snapshot is a
// reasoning model, and some endpoints reject a disabled-reasoning request
// outright ("Reasoning is mandatory for this endpoint and cannot be disabled",
// HTTP 400) — a wasted request against the daily cap. "low" is the real floor.
export const MIN_THINKING_LEVEL = "low";

// Default kickoff turn when a caller doesn't supply one. The agent's full role
// lives in the system prompt; this just tells it to begin.
const DEFAULT_TASK =
  "Carry out the task described in your instructions now, then respond with the required JSON object and nothing else.";

// Meta-routers dispatch to an arbitrary underlying model, so a run using one is
// not reproducible — never auto-discover them.
const META_ROUTER_IDS = new Set(["auto", "openrouter/free", "openrouter/fusion"]);

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
 * True when an error is OpenRouter's ACCOUNT-WIDE free-request cap, not a
 * per-model limit. This distinction is the difference between one wasted request
 * and a whole chain of them: the cap is shared by every free model, so falling
 * through to the next model cannot possibly succeed. Callers must stop the chain
 * immediately instead of burning the rest of it on a guaranteed failure.
 */
export function isDailyQuotaExhausted(err) {
  if (err?.quotaExhausted) return true; // already recognised and re-labelled once
  return /free-models-per-day|free_models_per_day/i.test(err?.message || "");
}

// ---------------------------------------------------------------------------
// Request budget — the free tier caps REQUESTS per day (50 on the free tier),
// not tokens, so requests are the scarce resource to spend deliberately. Every
// attempt counts, including ones that fail or return empty, because the cap is
// charged on the call and not on the result.
//
// This is a per-run allowance, checked between units of work (never mid-ticket,
// which would strand a half-built PR). It exists so one run can't drain the
// whole day and starve every later run.
// ---------------------------------------------------------------------------

export const MODEL_REQUEST_BUDGET = Number(process.env.MODEL_REQUEST_BUDGET || 20);

let modelRequestCount = 0;

// Agent TURNS, which is what OpenRouter actually charges: one completion request
// per turn of the agentic loop, so a session that makes 20 tool calls costs ~20
// requests while modelRequestCount above records 1. The budget still counts
// sessions; this only measures the gap, so the budget can be re-expressed in the
// real unit once we know the multiplier. See runAgent.
let modelTurnCount = 0;

/** How many model requests this run has spent (successes and failures alike). */
export function getModelRequestCount() {
  return modelRequestCount;
}

/** Real OpenRouter requests this run made — one per agent turn, not per session. */
export function getModelTurnCount() {
  return modelTurnCount;
}

/**
 * True once the run has spent its request allowance.
 *
 * Measured in TURNS, because that's what OpenRouter charges. This used to compare
 * sessions against the budget, which made every ceiling in .github/workflows/ read
 * roughly 16x smaller than the spend it authorised — a "250-request" slot was
 * thousands of real requests, and the account's 1000/day fell over while the
 * counter still read 62.
 */
export function isRequestBudgetSpent() {
  return modelTurnCount >= MODEL_REQUEST_BUDGET;
}

/**
 * True while fewer than `reserve` requests remain — a soft stop for work that is
 * worth starting only if it can finish. Draining the budget to zero mid-ticket is
 * how a run ends with an unreviewed PR and nothing merged; leaving a reserve is
 * how the day still ships something.
 */
export function isRequestBudgetLow(reserve = 60) {
  return modelTurnCount >= MODEL_REQUEST_BUDGET - reserve;
}

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
 * Resolve the text-model chain against pi's ACTUAL registry, so a pi upgrade or
 * a rotated-out free model degrades cleanly instead of throwing on the first id:
 *   1. keep configured TEXT_MODELS that exist; warn (distinctly) about any that don't,
 *   2. if none remain, auto-discover free OpenRouter text models pi currently
 *      knows (excluding meta-routers) so agents keep running.
 * Returns an ordered list of model ids (possibly empty).
 */
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
  if (present.length) return present;

  const discovered = all
    .filter(
      (m) =>
        m.provider === "openrouter" &&
        m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0 &&
        !META_ROUTER_IDS.has(m.id)
    )
    .map(modelIdOf)
    .slice(0, 4);
  if (discovered.length) {
    log("warn", `Model chain: no configured text model is in pi's registry — auto-discovered ${discovered.length} free model(s): ${discovered.join(", ")}.`);
  } else {
    log("warn", "Model chain: no configured or discoverable free text models.");
  }
  return discovered;
}

/**
 * Run a one-shot agent. With no explicit `modelId`, tries the TEXT_MODELS chain
 * in order until one answers — free models rate-limit constantly, so the next in
 * line usually picks up the slack. Pass an explicit `modelId` to pin a single
 * model (the vision path does this, driving its own chain).
 *
 * @param {object} opts
 * @param {string} [opts.label]          - Name for logging.
 * @param {string} opts.systemPrompt     - The agent's role/instructions. Set as the
 *                                          actual system prompt (not a user message).
 * @param {string} [opts.task]           - The user turn that kicks the agent off.
 * @param {string[]} [opts.tools]        - Allowed tool names.
 * @param {string} [opts.thinkingLevel]  - "off" | "low" | "medium" | "high".
 * @param {string} [opts.modelId]        - Pin a single model; omit to use the chain.
 */
export async function runAgent(opts) {
  const { modelId, label = "Agent", expectJson = true } = opts;

  // Explicit model: run exactly that one (caller owns any fallback, e.g. vision).
  if (modelId) return runAgentOnce(opts);

  // No explicit model: try each model in the chain until one returns content.
  const chain = await resolveTextModels();
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
        if (!expectJson || containsParseableJSON(out)) return out;
        log("warn", `${label}: ${id} answered without usable JSON — trying next model.`, {
          raw: out.length > 120 ? out.slice(0, 120) + "…" : out,
        });
      } else {
        log("warn", `${label}: ${id} returned empty — trying next model.`);
      }
    } catch (e) {
      lastErr = e;
      // Our own budget, like the account cap below, is not per-model: the next
      // model in the chain would be refused identically. Rethrow the original so
      // the budgetExhausted marker survives for callers that branch on it —
      // wrapping it here is what made the gate look like a model failure and
      // burn the whole chain proving it.
      if (e.budgetExhausted) throw e;
      // The daily cap is account-wide — every remaining model shares it, so
      // continuing would burn one request per model to fail identically.
      if (isDailyQuotaExhausted(e)) {
        const err = new Error(
          `${label}: OpenRouter's daily free-request cap is exhausted — stopping ` +
            `without trying the remaining ${chain.length - chain.indexOf(id) - 1} model(s). ` +
            `The cap is per account, not per model, so it resets at 00:00 UTC.`
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
  // Hard floor. The soft checks at safe checkpoints should stop a run long before
  // this fires, but turns are only known once a session ENDS, so without a gate
  // here a single long session can overrun the whole allowance unobserved. Typed
  // so callers can tell "out of budget" from "the model failed".
  if (isRequestBudgetSpent()) {
    const err = new Error(
      `Request budget spent (${modelTurnCount}/${MODEL_REQUEST_BUDGET} requests) — ` +
        `refusing to start ${label}. Raise MODEL_REQUEST_BUDGET or wait for the 00:00 UTC reset.`
    );
    err.budgetExhausted = true;
    throw err;
  }

  const startTime = Date.now();
  // Count the attempt, not the success — the daily cap is charged either way.
  modelRequestCount++;
  log("info", `${label} agent started (request ${modelRequestCount}/${MODEL_REQUEST_BUDGET} this run)`);

  return loader.reload().then(() =>
    createAgentSession({
      cwd: repoRoot,
      sessionManager: SessionManager.inMemory(),
      resourceLoader: loader,
      model,
      thinkingLevel,
      modelRuntime,
      tools,
    }).then(({ session }) => {
      let output = "";
      session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
        }
      });

      return session
        .prompt(task)
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
            session.dispose();
            throw new Error(
              `${label} model call failed: ${lastAssistant.errorMessage || "unknown error"}`
            );
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
          // that's one per turn — to expose the multiplier the budget ignores.
          // Measurement only for now; nothing spends against this yet.
          const turns = messages.filter((m) => m.role === "assistant").length;
          modelTurnCount += turns;
          log(
            "info",
            `${label} agent completed in ${elapsed}s — ${turns} turn(s), ` +
              `${modelTurnCount} real request(s) this run vs ${modelRequestCount} counted`
          );
          session.dispose();
          return output;
        })
        .catch((err) => {
          // A session that throws still spent every turn it took to get there —
          // and retry loops are exactly where the cap goes — so count before
          // rethrowing rather than under-reporting the expensive case.
          modelTurnCount += (session.state?.messages || []).filter(
            (m) => m.role === "assistant"
          ).length;
          session.dispose();
          throw err;
        });
    })
  );
}

// ---------------------------------------------------------------------------
// Structured logger
// ---------------------------------------------------------------------------

const runLog = [];
const isGitHubActions = Boolean(process.env.GITHUB_ACTIONS);

export function getRunLog() {
  return runLog;
}

// Tickets the run affected — this, not the step log, is what the summary reports.
const ticketOutcomes = [];

/**
 * Record a ticket this run acted on, for the end-of-run summary.
 * @param {string} status - what happened: "done" | "failed" | "created"
 * @param {number} number - issue number
 * @param {string} title  - issue title
 * @param {string} [detail] - optional context (e.g. the reason a build failed)
 */
export function recordTicket(status, number, title, detail) {
  ticketOutcomes.push({ status, number, title, detail });
}

export function log(level, message, data) {
  runLog.push({ level, message, data });
  if (level === "debug") return; // debug entries collected but not printed

  // In CI, warnings/errors become native annotations — they render inline once
  // AND surface at the top of the run. Don't also print a plain line (that's the
  // doubling). Elsewhere, a minimal level tag keeps info lines clean.
  if (isGitHubActions && (level === "warn" || level === "error")) {
    const ghLevel = level === "warn" ? "warning" : "error";
    console.log(`::${ghLevel}::${escapeWorkflowData(message)}`);
  } else {
    console.log(level === "info" ? message : `${level.toUpperCase()}: ${message}`);
  }
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

// Escape per GitHub's workflow-command rules so annotations render literally.
function escapeWorkflowData(str) {
  return String(str).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Group subsequent log output under a collapsible section in the Actions log.
 * Returns a function that closes the group. No-op outside GitHub Actions.
 */
export function logGroup(title) {
  if (isGitHubActions) console.log(`::group::${escapeWorkflowData(title)}`);
  else console.log(`\n--- ${title} ---`);
  return () => {
    if (isGitHubActions) console.log("::endgroup::");
  };
}

/** Run an async block wrapped in a collapsible Actions log group. */
export async function withLogGroup(title, fn) {
  const end = logGroup(title);
  try {
    return await fn();
  } finally {
    end();
  }
}

/** Append a Markdown line to the GitHub Actions job summary, if available. */
export function appendJobSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, markdown + "\n");
  } catch {
    // best-effort — never fail a run over a summary write
  }
}

const RAW_OUTPUT_MAX_CHARS = 2000;

export function truncate(str, max = RAW_OUTPUT_MAX_CHARS) {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... [truncated, ${str.length} total chars]`;
}

export function errorData(e) {
  return {
    message: e.message || String(e),
    stack: e.stack || null,
  };
}

export function printRunSummary(title = "Run Summary") {
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
  // one is what the daily cap counts.
  const spend =
    `${modelRequestCount} agent session(s), ${modelTurnCount} model request(s)`;
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

export function fillTemplate(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
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

export function gitExec(args, opts = {}) {
  const cmd = "git " + args;
  return execSync(cmd, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024, ...opts }).toString().trim();
}

let gitIdentityConfigured = false;

/**
 * Set the committer identity once per process. Idempotent — safe to call from
 * any code path that is about to create a commit.
 */
export function configureGitIdentity() {
  if (gitIdentityConfigured) return;
  gitExec('config user.name "github-actions[bot]"');
  gitExec('config user.email "github-actions[bot]@users.noreply.github.com"');
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
    gitExec(`push origin --delete ${branchName}`, { stdio: "pipe" });
    log("info", `Deleted remote branch ${branchName}.`);
  } catch {
    // remote branch may not exist — fine
  }
}

export function createBranch(branchName) {
  gitExec("fetch origin");
  gitExec("checkout main");
  // Base the branch on the real remote tip, not a possibly-stale local main.
  gitExec("reset --hard origin/main");
  // Clear any leftover branch of the same name from a prior failed run. With
  // run-scoped names this is usually a no-op, so capture stderr rather than leak
  // git's "branch not found" to the console.
  try {
    gitExec(`branch -D ${branchName}`, { stdio: "pipe" });
  } catch {
    // local branch may not exist — fine
  }
  deleteRemoteBranch(branchName);
  gitExec(`checkout -b ${branchName}`);
  log("info", `Created branch: ${branchName}`);
}

export function mergeMainIntoBranch() {
  try {
    gitExec("fetch origin");
    gitExec("merge origin/main --no-edit");
    log("info", "Merged origin/main into branch — clean.");
    return { clean: true };
  } catch (e) {
    const status = gitExec("status --porcelain");
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
    gitExec("merge --abort");
    log("info", "Aborted merge.");
  } catch {
    // ignore — may not be in a merge
  }
}

export function abortRebase() {
  try {
    gitExec("rebase --abort");
    log("info", "Aborted rebase.");
  } catch {
    // ignore — may not be in a rebase
  }
}

/**
 * Land a branch on main, surviving concurrent pushes from other runs.
 *
 * Each attempt re-fetches origin/main, rebases the branch on top of it, then
 * fast-forwards main and pushes. If the push is rejected (another run advanced
 * origin/main in between), we retry from a fresh fetch.
 */
export function mergeBranchToMain(branchName, { retries = 5 } = {}) {
  let pushed = false;
  for (let attempt = 1; attempt <= retries; attempt++) {
    gitExec("fetch origin");
    gitExec(`checkout ${branchName}`);
    try {
      gitExec("rebase origin/main");
    } catch (e) {
      // Leave no half-finished rebase behind for callers' cleanup.
      abortRebase();
      throw new Error(`Rebase of ${branchName} onto origin/main failed: ${e.message}`);
    }
    gitExec("checkout main");
    gitExec("reset --hard origin/main");
    gitExec(`merge --ff-only ${branchName}`);
    try {
      gitExec("push origin main");
      log("info", `Merged ${branchName} into main and pushed (attempt ${attempt}).`);
      pushed = true;
      break;
    } catch (e) {
      if (attempt === retries) {
        throw new Error(`Push to main rejected after ${retries} attempts: ${e.message}`);
      }
      log("warn", `Push to main rejected, retrying (${attempt}/${retries}).`);
    }
  }
  if (!pushed) return;

  try {
    gitExec(`branch -d ${branchName}`);
    log("info", `Deleted local branch ${branchName}.`);
  } catch {
    // not fully merged according to git — leave it for inspection
  }
  deleteRemoteBranch(branchName);
}

// ---------------------------------------------------------------------------
// GitHub issue helpers
// ---------------------------------------------------------------------------

// Post a comment by piping the body over stdin, so arbitrary Markdown/prose
// (backticks, $, quotes, newlines) is never interpreted by the shell.
function ghComment(issueNumber, body) {
  execSync(`gh issue comment ${issueNumber} --body-file -`, {
    cwd: repoRoot,
    input: body,
    maxBuffer: 10 * 1024 * 1024,
  });
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
  // Tolerate the legacy `closeIssue(n, commitMessage)` call shape.
  if (typeof info === "string") info = { commitMessage: info };
  const { summary, commitMessage, commitSha } = info;

  const lines = ["## ✅ Resolved by the Builder Team", ""];
  if (summary) lines.push(summary, "");
  if (commitMessage) {
    const shortSha = commitSha ? `\`${commitSha.slice(0, 7)}\` — ` : "";
    lines.push(`**Commit:** ${shortSha}${commitMessage}`);
  }
  const body =
    lines.join("\n").trim() || "This issue has been addressed by the Builder Team.";

  try {
    ghComment(issueNumber, body);
    execSync(`gh issue close ${issueNumber}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
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

/** Label, comment, and close an issue the Scout judged invalid / out of scope. */
export async function closeIssueAsInvalid(issueNumber, reason) {
  await labelIssue(issueNumber, "invalid");
  const lines = ["## Closed by the Builder Team", ""];
  if (reason) {
    lines.push("After review, this isn't something the team will act on right now:", "", reason);
  } else {
    lines.push(
      "After review, this issue isn't actionable or is out of scope for the current vision of the project."
    );
  }
  lines.push("", "_If you think this was closed in error, reopen the issue with more detail._");
  await commentIssue(issueNumber, lines.join("\n"));
  try {
    execSync(`gh issue close ${issueNumber}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    log("info", `Closed issue #${issueNumber} as invalid.`);
  } catch (e) {
    log("warn", `Could not close issue #${issueNumber}`, errorData(e));
  }
}

/**
 * Comment and close a ticket that was replaced by smaller pieces.
 *
 * Deliberately not closeIssue(), which announces "✅ Resolved by the Builder Team"
 * — nothing was built here, and a reader following the trail needs to land on the
 * children rather than believe the work shipped.
 *
 * @param {number} issueNumber
 * @param {number[]} childNumbers - the replacements, in build order
 * @param {string} [why]          - the Scout's one-line reason it was too big
 */
export async function closeIssueAsSplit(issueNumber, childNumbers, why) {
  const lines = ["## Split by the Builder Team", ""];
  lines.push(
    why
      ? `This ticket was too big to ship in one Builder pass: ${why}`
      : "This ticket was too big to ship in one Builder pass."
  );
  lines.push(
    "",
    "It has been replaced by these tickets, which build in this order:",
    "",
    ...childNumbers.map((n, i) => `${i + 1}. #${n}`),
    "",
    "_No work was lost — closing this one only means it is tracked in the pieces above._"
  );
  await commentIssue(issueNumber, lines.join("\n"));
  try {
    execSync(`gh issue close ${issueNumber}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    log("info", `Closed issue #${issueNumber} as split.`);
  } catch (e) {
    log("warn", `Could not close issue #${issueNumber}`, errorData(e));
  }
}

export async function labelIssue(issueNumber, label) {
  try {
    execSync(
      `gh issue edit ${issueNumber} --add-label "${label}"`,
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    log("info", `Labeled issue #${issueNumber} as "${label}"`);
  } catch (e) {
    log("warn", `Could not label issue #${issueNumber}`, errorData(e));
  }
}

/** Fetch open issues live via gh. Returns [] on failure. */
export function fetchOpenIssues(limit = 100) {
  try {
    return JSON.parse(
      execSync(
        `gh issue list --state open --json number,title,body,labels,createdAt --limit ${limit}`,
        { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
      ).toString()
    );
  } catch (e) {
    log("warn", "Could not fetch open issues.", errorData(e));
    return [];
  }
}

// Marks issues the agents create, so issue-triggered workflows can skip their
// own creations and avoid self-trigger loops.
export const AGENT_LABEL = "agent";
// Marks Builder-filed code-health tickets so the PM (and humans) can spot them.
export const TECH_DEBT_LABEL = "tech-debt";

const _ensuredLabels = new Set();
function ensureLabel(name, color = "ededed") {
  if (_ensuredLabels.has(name)) return;
  _ensuredLabels.add(name);
  try {
    execSync(`gh label create "${name}" --color ${color} --force`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
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
  const labelArgs = all.map((l) => `--label "${l}"`).join(" ");
  try {
    const out = execSync(
      `gh issue create --title "${String(title).replace(/"/g, '\\"')}" ${labelArgs} --body-file -`,
      { cwd: repoRoot, input: body || "", maxBuffer: 10 * 1024 * 1024 }
    ).toString().trim();
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
  for (const [name, color] of labels) {
    try {
      execSync(`gh label create "${name}" --color ${color} --force`, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      // label may already exist / no perms — non-fatal
    }
  }
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
    .map((l) => `--remove-label "${l}"`)
    .join(" ");
  try {
    execSync(`gh issue edit ${issueNumber} --add-label "${target}" ${removes}`.trim(), {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
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
 */
export function unmetDependencies(issue, openNumbers) {
  return dependencyNumbers(issue).filter((n) => openNumbers.has(n));
}

/**
 * True when the Builder may pick this ticket up now: not parked, and everything
 * it declared it depends on has shipped.
 */
export function isBuildable(issue, openNumbers) {
  return !isBlocked(issue) && unmetDependencies(issue, openNumbers).length === 0;
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
      execSync(`gh issue edit ${issue.number} ${flag} "${WAITING_LABEL}"`, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
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

  const edits = [`--add-label "${nextLabel}"`];
  const prevLabel = `attempts:${current}`;
  if (current > 0 && labelNames(issue).includes(prevLabel)) edits.push(`--remove-label "${prevLabel}"`);
  try {
    execSync(`gh issue edit ${number} ${edits.join(" ")}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
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
    execSync(`gh issue edit ${number} --add-label "${BLOCKED_LABEL}"`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    log("warn", `Could not block #${number}.`, errorData(e));
  }
  // Demote so it sinks even if a human later unblocks it without re-triaging.
  setIssuePriority(number, "low", currentLabels);

  const body = [
    "## ⛔ Parked by the Builder Team",
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
    execSync(`gh issue close ${number}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
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
    execSync(`gh workflow run ${workflowFile}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
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

function ghProjectJson(args) {
  return JSON.parse(
    execSync(`gh ${args}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString()
  );
}

let _projectMeta = null;

/**
 * Discover and cache the project's node id, the Status field id, and a
 * {columnName: optionId} map. Returns null if it can't be resolved.
 */
export function getProjectMeta() {
  if (_projectMeta) return _projectMeta;
  try {
    const view = ghProjectJson(
      `project view ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json`
    );
    const fieldsRaw = ghProjectJson(
      `project field-list ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json`
    );
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
  const repo = ghProjectJson("repo view --json nameWithOwner").nameWithOwner;
  return `https://github.com/${repo}/issues/${issueNumber}`;
}

/** Find the board item id for an issue number, or null if it isn't on the board. */
function findProjectItemId(issueNumber) {
  try {
    const res = ghProjectJson(
      `project item-list ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json --limit 200`
    );
    const items = res.items || [];
    const match = items.find((it) => it.content && it.content.number === Number(issueNumber));
    return match ? match.id : null;
  } catch (e) {
    log("warn", `Board: could not list items for issue #${issueNumber}.`, errorData(e));
    return null;
  }
}

/**
 * List every board item with its column (Status). Returns
 * [{ number, title, status }] — number is null for draft items. [] on failure.
 */
export function listProjectItems() {
  try {
    const res = ghProjectJson(
      `project item-list ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json --limit 200`
    );
    return (res.items || []).map((it) => ({
      number: it.content && typeof it.content.number === "number" ? it.content.number : null,
      title: it.title || (it.content && it.content.title) || "(untitled)",
      status: it.status || "No Status",
    }));
  } catch (e) {
    log("warn", "Board: could not list items.", errorData(e));
    return [];
  }
}

/** Add an issue to the board; returns the item id (or null). Idempotent in effect. */
export function addIssueToProject(issueNumber) {
  const existing = findProjectItemId(issueNumber);
  if (existing) return existing;
  try {
    const res = ghProjectJson(
      `project item-add ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --url ${repoIssueUrl(issueNumber)} --format json`
    );
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
    execSync(
      `gh project item-edit --id ${itemId} --project-id ${meta.projectId} ` +
        `--field-id ${meta.statusFieldId} --single-select-option-id ${optionId}`,
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
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

  // Labels per open ticket (so the board shows priority / tech-debt tags). The
  // `agent` marker is internal plumbing — hide it.
  const labelsByNumber = new Map(
    openIssues.map((i) => [
      i.number,
      (i.labels || []).map((l) => l.name || l).filter((n) => n !== "agent"),
    ])
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

// The wiki is the canonical home for Vision + Changelog. Clone it once per run
// and cache the directory; agents read/write the pages there.
let _wikiDir;
export function getWikiDir() {
  if (_wikiDir !== undefined) return _wikiDir;
  _wikiDir = cloneWiki() || null;
  return _wikiDir;
}

/** Absolute path to a page inside the cloned wiki, or null if the wiki is unreachable. */
export function wikiPath(pageFile) {
  const dir = getWikiDir();
  return dir ? join(dir, pageFile) : null;
}

/** Read the canonical Vision page from the wiki. */
export function readVision() {
  const p = wikiPath("Vision.md");
  if (p) { try { return fs.readFileSync(p, "utf-8"); } catch {} }
  return "(Vision unavailable — wiki not reachable or not yet seeded)";
}

/** Read the canonical Changelog page from the wiki. */
export function readChangelog() {
  const p = wikiPath("Changelog.md");
  if (p) { try { return fs.readFileSync(p, "utf-8"); } catch {} }
  return "(Changelog unavailable — wiki not reachable or not yet seeded)";
}

/** Commit and push the cached wiki clone. Best-effort. */
export function publishWiki(message) {
  const dir = getWikiDir();
  if (dir) pushWiki(dir, message);
}

/**
 * Append a dated bullet to the wiki Changelog page (grouped under today's date
 * header, matching the existing format). Writes to the clone; call publishWiki()
 * after to push. Returns false if the wiki is unreachable.
 */
export function appendChangelogEntry(entry) {
  const p = wikiPath("Changelog.md");
  if (!p) {
    log("warn", "Changelog: wiki unavailable; entry not recorded.");
    return false;
  }
  let content = "";
  try { content = fs.readFileSync(p, "utf-8"); } catch {}
  const date = new Date().toISOString().slice(0, 10);
  const header = `## ${date}`;
  const bullet = `- ${String(entry).trim()}`;
  if (!content.trim()) {
    content = `# Changelog\n\n${header}\n\n${bullet}\n`;
  } else if (content.includes(header)) {
    content = content.replace(header, `${header}\n${bullet}`);
  } else {
    const title = content.match(/^# .*$/m);
    content = title
      ? content.replace(title[0], `${title[0]}\n\n${header}\n\n${bullet}`)
      : `# Changelog\n\n${header}\n\n${bullet}\n\n${content}`;
  }
  fs.writeFileSync(p, content, "utf-8");
  log("info", `Changelog: recorded entry under ${date}.`);
  return true;
}

/**
 * Record why a ticket was given up on, newest first, on the wiki's Lessons page.
 *
 * Without this the pipeline has no memory: a ticket parks, its Builder run's logs
 * age out, and the next Scout re-derives the same dead end from scratch — paying
 * again to learn what the project already knew. The page is fed back into the
 * Scout's context, so a failure becomes information instead of just a stopped
 * ticket. Best-effort.
 */
export function appendLesson(entry) {
  const p = wikiPath("Lessons.md");
  if (!p) {
    log("warn", "Lessons: wiki unavailable; post-mortem not recorded.");
    return false;
  }
  let content = "";
  try { content = fs.readFileSync(p, "utf-8"); } catch {}
  const date = new Date().toISOString().slice(0, 10);
  const block = `## ${date} — ${String(entry.title || "").trim()}\n\n${String(entry.body || "").trim()}\n`;
  const heading = "# Lessons";
  const intro =
    "What the agents have tried and abandoned, and why. Read this before planning " +
    "work that resembles anything below — the point of writing it down is not to " +
    "learn it twice.";

  if (!content.trim()) {
    content = `${heading}\n\n${intro}\n\n${block}`;
  } else {
    // Newest first, so a Scout reading top-down meets the most recent dead ends
    // first: insert above the newest existing entry, or append when there is none.
    const firstEntry = content.indexOf("\n## ");
    content = firstEntry === -1
      ? `${content.trimEnd()}\n\n${block}`
      : `${content.slice(0, firstEntry + 1)}${block}\n${content.slice(firstEntry + 1)}`;
  }
  fs.writeFileSync(p, content, "utf-8");
  log("info", `Lessons: recorded a post-mortem for "${entry.title}".`);
  return true;
}

/** Read the wiki's Lessons page (past dead ends), or "" when there are none. */
export function readLessons() {
  const p = wikiPath("Lessons.md");
  if (p) { try { return fs.readFileSync(p, "utf-8"); } catch {} }
  return "";
}

// ---------------------------------------------------------------------------
// GitHub Wiki (a separate .wiki.git repo — no content API, so we use git)
// ---------------------------------------------------------------------------

/**
 * Clone the repo's wiki into `dir` using the token in the environment. Returns
 * the dir, or null if it fails (e.g. the wiki isn't enabled/initialized yet).
 * Best-effort — never throws.
 */
export function cloneWiki(dir = "/tmp/selfgrow-wiki") {
  try {
    const repo = JSON.parse(
      execSync("gh repo view --json nameWithOwner", { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString()
    ).nameWithOwner;
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
    const url = `https://x-access-token:${token}@github.com/${repo}.wiki.git`;
    execSync(`rm -rf "${dir}" && git clone "${url}" "${dir}"`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
    execSync(`git -C "${dir}" config user.name "github-actions[bot]"`, { maxBuffer: 10 * 1024 * 1024 });
    execSync(`git -C "${dir}" config user.email "github-actions[bot]@users.noreply.github.com"`, { maxBuffer: 10 * 1024 * 1024 });
    log("info", `Wiki: cloned ${repo}.wiki.`);
    return dir;
  } catch (e) {
    log("warn", "Wiki: clone failed — is the wiki enabled and initialized (create one page in the UI first)?", errorData(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pull Requests (two identities: the bot opens, the PAT approves — so a real
// approval is possible without a human, since you can't approve your own PR)
// ---------------------------------------------------------------------------

const patToken = () => process.env.GH_TOKEN || process.env.AGENT_PAT || "";
const botToken = () => process.env.BOT_TOKEN || process.env.GITHUB_TOKEN || "";

function ghAs(token, args, opts = {}) {
  return execSync(`gh ${args}`, {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
    env: { ...process.env, GH_TOKEN: token },
  });
}

/** Open a PR from `branchName` into main as the bot. Returns PR number, or null. */
export function createPR(branchName, title, body) {
  try {
    const out = ghAs(
      botToken(),
      `pr create --base main --head ${branchName} --title "${String(title).replace(/"/g, '\\"')}" --body-file -`,
      { input: body || "" }
    ).toString().trim();
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
    ghAs(patToken(), `pr review ${prNumber} --approve --body-file -`, {
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
export function mergePR(prNumber) {
  try {
    ghAs(patToken(), `pr merge ${prNumber} --merge --delete-branch`);
    log("info", `PR: merged #${prNumber}.`);
    return true;
  } catch (e) {
    log("warn", `PR: could not merge #${prNumber}.`, errorData(e));
    return false;
  }
}

/** Close (revoke) a PR without merging, optionally leaving a comment. Deletes the branch. */
export function closePR(prNumber, comment) {
  try {
    if (comment) ghAs(patToken(), `pr comment ${prNumber} --body-file -`, { input: comment });
    ghAs(patToken(), `pr close ${prNumber} --delete-branch`);
    log("info", `PR: closed #${prNumber}.`);
    return true;
  } catch (e) {
    log("warn", `PR: could not close #${prNumber}.`, errorData(e));
    return false;
  }
}

/** Commit and push staged wiki changes in `dir`. No-op if nothing changed. Best-effort. */
export function pushWiki(dir, message) {
  try {
    const status = execSync(`git -C "${dir}" status --porcelain`, { maxBuffer: 10 * 1024 * 1024 }).toString().trim();
    if (!status) {
      log("info", "Wiki: no changes to publish.");
      return;
    }
    execSync(`git -C "${dir}" add -A`, { maxBuffer: 10 * 1024 * 1024 });
    execSync(`git -C "${dir}" commit -m "${message.replace(/"/g, '\\"')}"`, { maxBuffer: 10 * 1024 * 1024 });
    execSync(`git -C "${dir}" push`, { maxBuffer: 10 * 1024 * 1024 });
    log("info", "Wiki: published.");
  } catch (e) {
    log("warn", "Wiki: push failed.", errorData(e));
  }
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

function startStaticServer(rootDir) {
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
// How long any single program may run before the language is expected to stop
// it. A capability that can hang the playground is a broken capability.
const PROGRAM_TIMEOUT_MS = 2000;

/**
 * Run the language's own documentation against the language.
 *
 * The Vision's central claim is that the reference cannot drift, because every
 * example in it is executed. This is where that claim is enforced: each
 * capability's examples are run through the interpreter and compared to the
 * documented result, and each capability's declared properties are checked.
 *
 * No model is involved, so it costs nothing and cannot be argued with — the
 * language either does what its reference says or it does not.
 *
 * Returns an array of failure strings (empty when everything holds). A project
 * with no interpreter yet passes.
 */
async function checkLanguage(browser, url, dir) {
  if (!fs.existsSync(join(dir, "lang", "run.js"))) {
    log("info", "Verify: no docs/lang/run.js yet — skipping the language checks.");
    return [];
  }
  const capabilityDir = join(dir, "capabilities");
  let files = [];
  try {
    files = fs
      .readdirSync(capabilityDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.m?js$/.test(e.name))
      .map((e) => e.name);
  } catch {
    log("info", "Verify: no docs/capabilities/ yet — skipping the language checks.");
    return [];
  }
  if (!files.length) return [];

  const page = await browser.newPage();
  const failures = [];
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    const result = await page.evaluate(
      async ({ files, timeoutMs }) => {
        const problems = [];
        let lang;
        try {
          lang = await import("./lang/run.js");
        } catch (e) {
          return [`docs/lang/run.js could not be imported — ${e.message}`];
        }
        if (typeof lang.run !== "function") {
          return ["docs/lang/run.js does not export run()"];
        }

        // A program that never finishes must be stopped by the language, not by
        // the browser giving up — so time it here and report the language's
        // failure to bound it.
        const runBounded = (source) => {
          const started = performance.now();
          const value = lang.run(source);
          const elapsed = performance.now() - started;
          if (elapsed > timeoutMs) throw new Error(`took ${Math.round(elapsed)}ms — the language did not stop it`);
          return value;
        };

        for (const file of files) {
          let mod;
          try {
            mod = await import(`./capabilities/${file}`);
          } catch (e) {
            problems.push(`${file}: could not be imported — ${e.message}`);
            continue;
          }

          const examples = mod.meta && Array.isArray(mod.meta.examples) ? mod.meta.examples : null;
          if (!mod.meta || !mod.meta.name) problems.push(`${file}: meta.name is missing`);
          if (!examples || examples.length === 0) {
            problems.push(`${file}: declares no examples — a capability with none is undocumented and untested at once`);
            continue;
          }

          for (const example of examples) {
            if (typeof example?.source !== "string" || example.result === undefined) {
              problems.push(`${file}: an example is missing source or result`);
              continue;
            }
            let actual;
            try {
              actual = runBounded(example.source);
            } catch (e) {
              problems.push(`${file}: the documented example \`${example.source}\` failed to run — ${e.message}`);
              continue;
            }
            if (String(actual) !== String(example.result)) {
              problems.push(
                `${file}: the reference says \`${example.source}\` gives \`${example.result}\`, but it gives \`${actual}\` — the documentation has drifted`
              );
            }
          }

          if (typeof mod.checkProperties === "function") {
            try {
              for (const msg of mod.checkProperties(runBounded) || []) {
                problems.push(`${file}: property broken — ${msg}`);
              }
            } catch (e) {
              problems.push(`${file}: checkProperties threw — ${e.message}`);
            }
          }
          if (problems.length > 12) return problems; // enough to act on
        }
        return problems;
      },
      { files, timeoutMs: PROGRAM_TIMEOUT_MS }
    );
    failures.push(...result);
  } catch (e) {
    log("warn", "Verify: language checks could not run.", errorData(e));
  } finally {
    await page.close().catch(() => {});
  }
  return failures;
}

/**
 * Verify the built app under `relDir`. Returns { ok, layer, errors }:
 *   - layer "syntax"   — a JS file fails `node --check`
 *   - layer "lint"     — ESLint reports an error (e.g. no-undef: undefined function)
 *   - layer "runtime"  — the page throws a console error / uncaught exception / failed load
 *   - layer "language" — the language broke its own reference: a documented
 *                        example stopped being true, or a declared property broke
 * ok:true (layer null) means all available layers passed (or were skipped).
 */
export async function verifyBuild(relDir = "docs") {
  const dir = join(repoRoot, relDir);
  const rel = (f) => relative(repoRoot, f);

  // Layer 1 — syntax.
  const syntaxErrors = [];
  for (const f of listJsFiles(dir)) {
    try {
      execSync(`node --check "${f}"`, { cwd: repoRoot, stdio: "pipe" });
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

  // Layer 4 — the language against its own reference. Only worth running when the
  // page itself is sound; example failures on a page that is already throwing
  // would just be noise from the same root cause.
  let languageFailures = [];
  if (!errors.length) {
    try {
      languageFailures = await checkLanguage(browser, `http://127.0.0.1:${port}/`, dir);
    } catch (e) {
      log("warn", "Verify: language layer failed to run.", errorData(e));
    }
  }

  if (browser) await browser.close().catch(() => {});
  server.close();

  if (errors.length) return { ok: false, layer: "runtime", errors: [...new Set(errors)] };
  if (languageFailures.length) {
    return { ok: false, layer: "language", errors: [...new Set(languageFailures)] };
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
const REVIEW_VIEWPORTS = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
];

// Caps so one badly-broken page can't produce a thousand-line report. The point
// is to name the worst offenders, not to enumerate every instance.
const MAX_DEFECTS_PER_KIND = 5;
// WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or >=19px bold).
const CONTRAST_MIN_NORMAL = 4.5;
const CONTRAST_MIN_LARGE = 3;

/**
 * Measure layout/appearance defects in the page as rendered. Runs entirely in the
 * browser and returns plain strings. Anything genuinely subjective (does this feel
 * calm? is the hierarchy right?) is deliberately NOT here — this function only
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    postDefects = await measureLayoutDefects(page, "desktop, after interacting");
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
      page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      // The garden animates in; let it settle so we measure a steady state.
      await page.waitForTimeout(1500);
      recordDefects(vp.label, await measureLayoutDefects(page));
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
