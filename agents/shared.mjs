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

export function runAgent({ label = "Agent", systemPrompt, tools = ["read"] }) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.getAll().find(
    (m) => m.provider === "openrouter" && m.id === "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"
  );

  const loader = new DefaultResourceLoader({ cwd: __dirname, agentDir: __dirname });
  const startTime = Date.now();
  log("info", `${label} agent started`);

  return loader.reload().then(() =>
    createAgentSession({
      cwd: repoRoot,
      sessionManager: SessionManager.inMemory(),
      resourceLoader: loader,
      model,
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
        .prompt(systemPrompt)
        .then(() => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const messages = session.state.messages;
          const lastAssistant = [...messages].reverse().find(
            (m) => m.role === "assistant"
          );
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

export function getRunLog() {
  return runLog;
}

export function log(level, message, data) {
  const entry = { time: new Date().toISOString(), level, message, data };
  runLog.push(entry);
  const prefix = `[${entry.time}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(prefix, message);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, message);
  }
}

export function ghAnnotation(kind, message) {
  const level = kind === "error" ? "error" : "warning";
  console.log(`::${level}::${message}`);
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

export function printRunSummary() {
  console.log("\n" + "=".repeat(60));
  console.log("RUN SUMMARY");
  console.log("=".repeat(60));
  for (const entry of runLog) {
    const icon =
      entry.level === "error" ? "❌" :
      entry.level === "warn"  ? "⚠️" :
      entry.level === "info"  ? "ℹ️" : "  ";
    console.log(`${icon} [${entry.level.toUpperCase()}] ${entry.message}`);
  }
  console.log("=".repeat(60) + "\n");
}

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

export function loadPrompt(name) {
  return fs.readFileSync(join(promptsDir, `${name}.md`), "utf-8");
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
  } catch (e) {
    log("debug", `${label} direct JSON parse failed: ${e.message}`);
  }

  // Try to find a complete JSON object by matching braces.
  // This handles stray characters after the closing brace (e.g. extra } or prose).
  const jsonObj = extractFirstJSONObject(candidate);
  if (jsonObj) {
    try {
      return JSON.parse(jsonObj);
    } catch (e) {
      log("debug", `${label} extracted JSON object parse failed: ${e.message}`, {
        extracted: truncate(jsonObj),
      });
    }
  } else {
    log("debug", `${label}: no JSON object found in output`);
  }

  log("warn", `${label} output could not be parsed as JSON`, {
    rawOutput: truncate(text),
  });
  ghAnnotation("warning", `${label}: output could not be parsed as JSON`);
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
 * Parse and validate the standard agent response envelope.
 * Returns the parsed object on success, or null on parse failure or error status.
 *
 * Required fields: status, summary, data
 * Gate agents also require: outcome ("approve" | "reject" | "revise" | "skip")
 */
export function extractAgentResponse(label, text, { requireOutcome = true } = {}) {
  const parsed = extractJSON(label, text);
  if (!parsed) return null;

  if (!parsed.status || !parsed.summary || !parsed.data) {
    log("warn", `${label} response missing required envelope fields (status, summary, data)`, {
      rawOutput: truncate(text),
    });
    ghAnnotation("warning", `${label}: response missing envelope fields`);
    return null;
  }

  if (requireOutcome && !parsed.outcome) {
    log("warn", `${label} response missing required envelope field: outcome`, {
      rawOutput: truncate(text),
    });
    ghAnnotation("warning", `${label}: response missing outcome field`);
    return null;
  }

  if (parsed.status === "error") {
    log("warn", `${label} reported an error: ${parsed.summary}`);
    ghAnnotation("warning", `${label}: ${parsed.summary}`);
    return null;
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

export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function createBranchName(issueNumber, issueTitle, suggestion) {
  if (issueNumber) {
    return `agent/issue-${issueNumber}-${slugify(issueTitle)}`;
  }
  return `agent/feature-${slugify(suggestion)}`;
}

export function createBranch(branchName) {
  try {
    gitExec("fetch origin");
    gitExec("checkout main");
    gitExec(`checkout -b ${branchName}`);
    log("info", `Created branch: ${branchName}`);
  } catch (e) {
    log("warn", `Branch ${branchName} may already exist, resetting to main.`);
    gitExec("checkout main");
    gitExec(`branch -D ${branchName}`);
    gitExec(`checkout -b ${branchName}`);
    log("info", `Recreated branch: ${branchName}`);
  }
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

export function mergeBranchToMain(branchName) {
  gitExec("checkout main");
  gitExec(`merge --ff-only ${branchName}`);
  log("info", `Fast-forward merged ${branchName} into main.`);
  gitExec("push origin main");
  log("info", "Pushed main.");
  gitExec(`branch -d ${branchName}`);
  log("info", `Deleted local branch ${branchName}.`);
  try {
    gitExec(`push origin --delete ${branchName}`);
  } catch {
    // remote branch may not exist — fine
  }
}

// ---------------------------------------------------------------------------
// GitHub issue helpers
// ---------------------------------------------------------------------------

export function loadOpenIssues() {
  try {
    const raw = fs.readFileSync("/tmp/open-issues.json", "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function closeIssue(issueNumber, commitMessage) {
  const comment = "Fixed in commit: " + commitMessage + "\n\nThis issue has been addressed by the Builder Team.";
  try {
    execSync(
      `gh issue comment ${issueNumber} --body "${comment.replace(/"/g, '\\"')}"`,
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    execSync(
      `gh issue close ${issueNumber}`,
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    log("info", `Closed issue #${issueNumber}`);
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
