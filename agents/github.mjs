// Issues, milestones and workflow dispatch through gh.

import { log, errorData } from "./log.mjs";
import { ghExec } from "./git.mjs";

// ---------------------------------------------------------------------------
// GitHub issue helpers
// ---------------------------------------------------------------------------

// Post a comment by piping the body over stdin: a long body can outgrow what
// fits in a single argument, and stdin has no such limit.
export function ghComment(issueNumber, body) {
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

// How many rows a listing asks gh for. Deliberately far above any real board:
// the point is not to page through thousands, it is that a listing which reaches
// this is known to be cut short rather than taken for the whole.
export const LISTING_LIMIT = 1000;

/**
 * Throw when a listing came back at its limit.
 *
 * gh stops at --limit without saying so, and a truncated list reads as a complete
 * one: an open blocker past the cutoff looked shipped and released everything
 * waiting on it. Exactly at the limit is treated as cut short too — one false
 * alarm at a thousand rows is cheaper than one silent miss.
 */
export function rejectTruncated(count, what, limit = LISTING_LIMIT) {
  if (count >= limit) {
    throw new Error(`Listing ${what} reached its limit of ${limit}, so it may be incomplete — raise the limit.`);
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
 *
 * `closed` is GitHub's count, which includes retired tickets, so it is shown as
 * "closed" and never as "shipped" — see isShipped.
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
      log("info", `Milestones: closed "${current.title}" (${current.closed} of ${current.open + current.closed} closed).`);
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
