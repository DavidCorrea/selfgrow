// Pull requests, opened and approved by two different identities.

import { log, errorData } from "./log.mjs";
import { secret } from "./secrets.mjs";
import { isGroomed } from "./backlog.mjs";
import { ghExec } from "./git.mjs";
import { LISTING_LIMIT, rejectTruncated } from "./github.mjs";

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
// look intermittent. The workflows that push branches now push with the PAT as
// GIT_TOKEN — see the note on git-token in devs.yml.
// ---------------------------------------------------------------------------

const patToken = () => secret("GH_TOKEN") || secret("AGENT_PAT");
const botToken = () => secret("BOT_TOKEN") || secret("GITHUB_TOKEN");

function ghAs(token, argv, opts = {}) {
  return ghExec(argv, { ...opts, token });
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

/** Open a PR from `branchName` into main as the PAT user. Returns PR number, or null. */
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

/** Submit an approving review as the bot (a different identity than the PAT author). */
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
 * Merge a pull request with a merge commit and delete its branch, letting the
 * repository's required checks decide.
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

/**
 * Why a ticket being built should no longer be merged, or null when it should.
 *
 * Asked right before the merge, because the reconcile above only runs between
 * tickets: a run already building never saw its ticket retired. #922 merged two
 * minutes after its ticket #916 was closed as not planned, and shipped exactly
 * the workaround the retirement had refused.
 */
export function whyTicketNoLongerWanted(ticket) {
  if (ticket.state !== "open") return "its ticket was closed while this was being built";
  if (!isGroomed(ticket)) return "its ticket is no longer groomed, so the Product Manager has taken it back";
  return null;
}

/**
 * A ticket's current state and labels, read fresh. Throws when the read fails —
 * a failed read is never an open ticket, or the merge it guards goes ahead.
 */
export function fetchTicketState(number) {
  const ticket = JSON.parse(
    ghExec(["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", "{state, labels: [.labels[] | {name}]}"], { stdio: "pipe" })
  );
  return { state: ticket.state, labels: ticket.labels };
}
