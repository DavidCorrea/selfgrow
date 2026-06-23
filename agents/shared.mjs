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
import { dirname, join } from "path";
import fs from "fs";
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
}) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.getAll().find(
    (m) => `${m.provider}/${m.id}` === MODEL_ID
  );
  if (!model) {
    throw new Error(
      `Model "${MODEL_ID}" not found in the registry. ` +
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

export function log(level, message, data) {
  const entry = { time: new Date().toISOString(), level, message, data };
  runLog.push(entry);
  if (level === "debug") return; // debug entries collected but not printed
  const prefix = `[${entry.time}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(prefix, message);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, message);
  }
  // Surface warnings/errors as GitHub Actions annotations (shown in the run summary UI).
  if (isGitHubActions && (level === "warn" || level === "error")) {
    const ghLevel = level === "warn" ? "warning" : "error";
    console.log(`::${ghLevel}::${escapeWorkflowData(message)}`);
  }
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
  const icon = (level) =>
    level === "error" ? "❌" :
    level === "warn"  ? "⚠️" :
    level === "info"  ? "ℹ️" : "  ";

  console.log("\n" + "=".repeat(60));
  console.log(title.toUpperCase());
  console.log("=".repeat(60));
  for (const entry of runLog) {
    if (entry.level === "debug") continue;
    console.log(`${icon(entry.level)} [${entry.level.toUpperCase()}] ${entry.message}`);
  }
  console.log("=".repeat(60) + "\n");

  // Mirror the summary into the GitHub Actions job summary panel.
  const errors = runLog.filter((e) => e.level === "error").length;
  const warns = runLog.filter((e) => e.level === "warn").length;
  const lines = [
    `## ${title}`,
    "",
    `**Result:** ${errors > 0 ? "❌ errors" : warns > 0 ? "⚠️ completed with warnings" : "✅ clean"} `
      + `· ${errors} error(s), ${warns} warning(s)`,
    "",
    "| | Level | Message |",
    "| --- | --- | --- |",
    ...runLog
      .filter((e) => e.level !== "debug")
      .map((e) => `| ${icon(e.level)} | ${e.level.toUpperCase()} | ${String(e.message).replace(/\|/g, "\\|")} |`),
    "",
  ];
  appendJobSummary(lines.join("\n"));
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
    gitExec(`push origin --delete ${branchName}`);
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
  // Clear any leftover branch of the same name from a prior failed run.
  try {
    gitExec(`branch -D ${branchName}`);
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

export const OPEN_ISSUES_PATH = process.env.OPEN_ISSUES_PATH || "/tmp/open-issues.json";

export function loadOpenIssues() {
  if (!fs.existsSync(OPEN_ISSUES_PATH)) {
    log("info", `No open-issues file at ${OPEN_ISSUES_PATH}; proceeding without issues.`);
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(OPEN_ISSUES_PATH, "utf-8"));
  } catch (e) {
    log("warn", `Failed to read/parse ${OPEN_ISSUES_PATH}; proceeding without issues.`, errorData(e));
    return [];
  }
}

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
