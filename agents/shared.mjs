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
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
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

export const MODEL_ID = "openrouter/openai/gpt-oss-120b:free";

// Default kickoff turn when a caller doesn't supply one. The agent's full role
// lives in the system prompt; this just tells it to begin.
const DEFAULT_TASK =
  "Carry out the task described in your instructions now, then respond with the required JSON object and nothing else.";

/**
 * Run a single one-shot agent.
 *
 * @param {object} opts
 * @param {string} [opts.label]          - Name for logging.
 * @param {string} opts.systemPrompt     - The agent's role/instructions. Set as the
 *                                          actual system prompt (not a user message).
 * @param {string} [opts.task]           - The user turn that kicks the agent off.
 * @param {string[]} [opts.tools]        - Allowed tool names.
 * @param {string} [opts.thinkingLevel]  - "off" | "low" | "medium" | "high".
 */
export function runAgent({
  label = "Agent",
  systemPrompt,
  task = DEFAULT_TASK,
  tools = ["read"],
  thinkingLevel = "low",
  modelId = MODEL_ID,
  images,
}) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.getAll().find(
    (m) => `${m.provider}/${m.id}` === modelId
  );
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
  const startTime = Date.now();
  log("info", `${label} agent started`);

  return loader.reload().then(() =>
    createAgentSession({
      cwd: repoRoot,
      sessionManager: SessionManager.inMemory(),
      resourceLoader: loader,
      model,
      thinkingLevel,
      authStorage,
      modelRegistry,
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
        .prompt(task, images && images.length ? { images } : undefined)
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
          log("info", `${label} agent completed in ${elapsed}s`);
          session.dispose();
          return output;
        })
        .catch((err) => {
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
  console.log(`\n=== ${title}: ${result} · ${errors} error(s), ${warns} warning(s) ===`);
  ticketOutcomes.forEach((t) => console.log(`  ${ticketLine(t)}`));
  for (const entry of runLog) {
    if (entry.level === "warn" || entry.level === "error") {
      console.log(`  ${entry.level.toUpperCase()}: ${entry.message}`);
    }
  }

  // The GitHub job-summary panel reports the result line and, below it, the
  // tickets this run affected — that's the whole story worth keeping there.
  const md = [`## ${title}`, "", `${result} · ${errors} error(s) · ${warns} warning(s)`, ""];
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

/**
 * Verify the built app under `relDir`. Returns { ok, layer, errors }:
 *   - layer "syntax"  — a JS file fails `node --check`
 *   - layer "lint"    — ESLint reports an error (e.g. no-undef: undefined function)
 *   - layer "runtime" — the page throws a console error / uncaught exception / failed load
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
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  if (errors.length) return { ok: false, layer: "runtime", errors: [...new Set(errors)] };
  return { ok: true, layer: null, errors: [] };
}

// ---------------------------------------------------------------------------
// Visual critique — give the (text-only) agents a pair of eyes.
//
// The build/verify model can't see, so appearance is judged here: screenshot the
// built site at desktop + mobile widths and ask a VISION model to describe
// high-confidence layout/visual defects. It's a pure describer — text in, text
// out — whose findings feed the Product Manager (which turns real defects into
// tickets). Best-effort: any failure returns null and the caller proceeds.
// ---------------------------------------------------------------------------

// A free VLM by default; swap via env as OpenRouter's free lineup rotates.
// Vision models tried in order — on a rate-limit/error, fall through to the next.
// Free VLMs share tight, shared limits, so a fallback chain matters far more than
// retrying one model. These are pi registry ids (provider/id) and must be
// image-capable; override via env (comma-separated).
export const VISION_MODELS = (
  process.env.VISION_MODEL ||
  [
    "openrouter/google/gemma-4-31b-it:free",
    "openrouter/nvidia/nemotron-nano-12b-v2-vl:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VISION_VIEWPORTS = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
];

// "Quality" only means something relative to intent, so the critique is anchored
// to the Vision and split into two lanes: high-confidence Defects (near-certain,
// → tickets) and Vision-anchored Polish judged against a fixed rubric (→ optional
// suggestions). A fixed rubric keeps a subjective judgment consistent run to run.
function buildVisionPrompt(vision) {
  return [
    "You are reviewing screenshots of a browser-only web app at desktop and mobile widths.",
    "",
    "The app's intended experience (its north star) is:",
    vision && vision.trim() ? vision.trim() : "(not provided)",
    "",
    "Report in exactly these two sections, using these headings:",
    "",
    "## Defects",
    "Specific, high-confidence things that are visibly broken: overlapping elements, content cut " +
      "off or overflowing the viewport, unreadable contrast, broken/missing images, empty or " +
      "collapsed regions, unstyled content. One concise bullet each, naming the viewport. If there " +
      "are none, write: none.",
    "",
    "## Polish",
    "How well does the app embody the intended experience above? Give ONE short line per dimension — " +
      "the dimension, a brief verdict, and (only if weak) one concrete improvement. Dimensions: " +
      "visual hierarchy, spacing & alignment, typography & readability, color & contrast cohesion, " +
      "responsiveness (desktop vs mobile), interaction affordance, density. Tie every judgment to the " +
      "intended experience. Do not invent problems or give generic praise; if a dimension is fine, say so briefly.",
  ].join("\n");
}

// Most interactive elements the sweep will exercise per run.
const MAX_INTERACTIONS = 12;

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
        return { id: i, tag: el.tagName.toLowerCase(), label: (text || el.tagName.toLowerCase()).slice(0, 40) };
      });
    }, MAX_INTERACTIONS);

  const findings = [];
  const base = url.split("#")[0];
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    const targets = await tagTargets();
    for (const t of targets) {
      const loc = page.locator(`[data-explore-id="${t.id}"]`);
      if ((await loc.count()) === 0) continue; // DOM changed out from under us
      const errBefore = errors.length;
      const htmlBefore = await page.evaluate(() => document.body.innerHTML);
      try {
        await loc.click({ timeout: 2000 });
      } catch (e) {
        findings.push(`"${t.label}" — could not be clicked: ${String(e.message).split("\n")[0]}`);
        continue;
      }
      await page.waitForTimeout(500);
      const newErrors = errors.slice(errBefore);
      if (newErrors.length) {
        findings.push(`"${t.label}" — triggered a JS error: ${newErrors[0]}`);
      } else if (page.url().split("#")[0] !== base) {
        findings.push(`"${t.label}" — navigated away to ${page.url()}`);
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
        await tagTargets().catch(() => {});
      } else if (!["input", "textarea", "select"].includes(t.tag)) {
        // Form fields legitimately don't mutate the DOM on click; only flag others.
        const htmlAfter = await page.evaluate(() => document.body.innerHTML);
        if (htmlAfter === htmlBefore) {
          findings.push(`"${t.label}" — looks interactive but had no visible effect (may be canvas/JS-only).`);
        }
      }
    }
  } catch (e) {
    findings.push(`interaction sweep stopped early: ${String(e.message).split("\n")[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
  return findings;
}

/**
 * Resolve the vision-model chain against pi's ACTUAL registry, so a pi upgrade
 * that renames/removes a model degrades cleanly instead of silently failing:
 *   1. keep configured models that exist; warn (distinctly) about any that don't,
 *   2. if none remain, auto-discover free image-capable OpenRouter models pi
 *      currently knows (excluding meta-routers) so the check keeps working.
 * Returns an ordered list of model ids (possibly empty).
 */
function resolveVisionModels() {
  let all;
  try {
    all = ModelRegistry.create(AuthStorage.create()).getAll();
  } catch (e) {
    log("warn", "Visual check: could not read pi's model registry — using configured ids as-is.", errorData(e));
    return VISION_MODELS;
  }
  const idOf = (m) => `${m.provider}/${m.id}`;
  const present = [];
  for (const id of VISION_MODELS) {
    if (all.some((m) => idOf(m) === id)) present.push(id);
    else log("warn", `Visual check: "${id}" is not in pi's registry (version drift?) — skipping it.`);
  }
  if (present.length) return present;

  const discovered = all
    .filter(
      (m) =>
        m.provider === "openrouter" &&
        Array.isArray(m.input) && m.input.includes("image") &&
        m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0 &&
        m.id !== "auto" && m.id !== "openrouter/free" // skip meta-routers
    )
    .map(idOf)
    .slice(0, 4);
  if (discovered.length) {
    log("warn", `Visual check: no configured vision model is in pi's registry — auto-discovered ${discovered.length} free image model(s): ${discovered.join(", ")}.`);
  } else {
    log("warn", "Visual check: no configured or discoverable vision models — skipping the appearance critique.");
  }
  return discovered;
}

/**
 * Review the built site: drive its interactive elements to catch functional
 * breakage (no model needed) AND screenshot it for a vision-model critique of
 * appearance. The vision call goes through pi (runAgent) like every other model
 * call. Returns a combined report (Defects / Polish / Functional), or null when
 * nothing can run (no page yet, Playwright missing) or nothing is produced. Never throws.
 */
export async function visualCritique(vision, relDir = "docs") {
  const dir = join(repoRoot, relDir);
  if (!fs.existsSync(join(dir, "index.html"))) {
    log("info", "Visual check: no index.html yet — skipping.");
    return null;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    log("warn", "Visual check: Playwright unavailable — skipping.", errorData(e));
    return null;
  }

  const { server, port } = await startStaticServer(dir);
  const url = `http://127.0.0.1:${port}/`;
  const shots = [];
  let functional = [];
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    log("warn", "Visual check: could not launch browser — skipping.", errorData(e));
    server.close();
    return null;
  }

  // Static screenshots for the visual critique (best-effort).
  try {
    for (const vp of VISION_VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(1500);
      const png = await page.screenshot({ fullPage: true });
      shots.push({ label: vp.label, data: png.toString("base64") });
      await page.close();
    }
  } catch (e) {
    log("warn", "Visual check: screenshot capture failed.", errorData(e));
  }

  // Drive the app and record what breaks (best-effort, deterministic).
  try {
    functional = await exploreInteractions(browser, url);
  } catch (e) {
    log("warn", "Visual check: interaction sweep failed.", errorData(e));
  }

  await browser.close().catch(() => {});
  server.close();

  // Ask a vision model about appearance, through pi (same path as every other
  // model call). Try each model in the chain until one answers — free VLMs
  // rate-limit constantly, so the next in line usually picks up the slack.
  let visualText = null;
  if (shots.length && process.env.OPENROUTER_API_KEY) {
    const images = shots.map((s) => ({ type: "image", data: s.data, mimeType: "image/png" }));
    const task = `Review the attached screenshots and report as instructed. The images, in order, are: ${shots.map((s) => s.label).join(", ")}.`;
    for (const modelId of resolveVisionModels()) {
      try {
        const out = await runAgent({
          label: `Vision (${modelId})`,
          modelId,
          systemPrompt: buildVisionPrompt(vision),
          task,
          images,
          tools: [],
          thinkingLevel: "off",
        });
        visualText = (out || "").trim() || null;
        if (visualText) {
          log("info", `Visual check: critique from ${modelId}.`);
          break;
        }
        log("warn", `Visual check: ${modelId} returned empty — trying next.`);
      } catch (e) {
        log("warn", `Visual check: ${modelId} call failed — trying next.`, errorData(e));
      }
    }
    if (!visualText) {
      log("warn", "Visual check: every vision model was unavailable — skipping the appearance critique.");
    }
  } else if (shots.length) {
    log("info", "Visual check: no OPENROUTER_API_KEY — skipping the appearance critique.");
  }

  // Combine the model's visual critique with the deterministic interaction findings.
  const parts = [];
  if (visualText) parts.push(visualText);
  if (functional.length) {
    parts.push(`## Functional (observed behavior)\n${functional.map((f) => `- ${f}`).join("\n")}`);
  }
  if (!parts.length) {
    log("info", "Visual check: no critique produced.");
    return null;
  }
  const report = parts.join("\n\n");
  log("info", `App review (visual + interaction sweep):\n${report}`);
  return report;
}
