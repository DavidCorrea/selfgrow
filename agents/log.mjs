// Structured logging, run history, and the ticket ledger the end-of-run summary
// reports from.
//
// Split out of shared.mjs so the layers below it — the wiki, in particular — can
// log without importing the module that imports them. It depends on nothing but
// the filesystem and the environment, which is what makes it the bottom layer.
import fs from "fs";

const runLog = [];
const isGitHubActions = Boolean(process.env.GITHUB_ACTIONS);

export function getRunLog() {
  return runLog;
}

// Tickets the run affected — this, not the step log, is what the summary reports.
const ticketOutcomes = [];

/** Every ticket this run acted on, for the end-of-run summary. */
export function getTicketOutcomes() {
  return ticketOutcomes;
}

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
