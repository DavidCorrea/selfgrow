// What shipped: telling a ticket that was built from one that was only closed.

import { isPlaytestFeedback } from "./backlog.mjs";
import { ghExec } from "./git.mjs";

/**
 * Whether a closed ticket was actually built. Closed is not the same thing:
 * the PM also closes tickets it retires — split, superseded, won't-do, a triaged
 * playtest finding — and every report that counted "closed" listed those as
 * shipped. A retired "The visual canvas is a dark void" appeared under "Shipped
 * this week", and the retro concluded the dark canvas was solved.
 *
 * The close reason is the one signal every path sets: the Devs close as
 * completed, a retirement closes as not planned. Linked PRs are not — the Devs
 * close most tickets themselves, so their closedByPullRequestsReferences is empty.
 */
export function isShipped(issue) {
  // A playtest finding also closes as completed — once the Playtester confirms
  // the experience changed — but it is an observation, not work, and listing
  // "The canvas is a dark void" under what shipped would read as the complaint
  // having been built. The tickets that answered it are what shipped.
  return issue.stateReason === "COMPLETED" && !isPlaytestFeedback(issue);
}

/**
 * The message of the commit a reset makes when it deletes the old product from
 * main. Shared by the reset, which writes it, and productStartedAt, which reads
 * it back as the moment the current product began — reword one without the
 * other and the old product's shipped work counts for the new one again.
 */
export const RESET_COMMIT_MESSAGE = "Clear the previous product for a fresh start";

/**
 * When the current product began: the committer date of the newest reset commit
 * among `commits` (as `gh search commits --json commit` lists them), or null when
 * there has never been a reset — then everything ever shipped is this product's.
 *
 * Search matches words, not whole messages, so a commit that merely mentions the
 * reset is left out here: only a subject that IS the reset's message counts.
 */
export function productStartedAt(commits) {
  const resetDates = commits
    .filter(({ commit }) => commit.message.split("\n")[0].trim() === RESET_COMMIT_MESSAGE)
    .map(({ commit }) => commit.committer.date)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return resetDates[0] || null;
}

/**
 * Ask GitHub when the current product began. The commit search API rather than
 * `git log --grep` because the agents that read what shipped check main out
 * shallow — one commit deep, the reset commit is not there to find. Throws when
 * the search fails: guessing "no reset" would hand the old product's work to the
 * new one.
 */
function fetchProductStart() {
  try {
    const repo = process.env.GITHUB_REPOSITORY
      || ghExec(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
    const commits = JSON.parse(
      ghExec([
        "search", "commits", `"${RESET_COMMIT_MESSAGE}"`, "--repo", repo,
        "--sort", "committer-date", "--order", "desc", "--limit", "20", "--json", "commit",
      ])
    );
    return productStartedAt(commits);
  } catch (e) {
    throw new Error(`Could not find when the current product began: ${e.message}`, { cause: e });
  }
}

/**
 * Closed tickets that shipped for the CURRENT product, newest first. Throws when
 * a lookup fails: an empty list is a week where nothing shipped, and every
 * reader of this would report exactly that.
 *
 * Bounded by the last reset because closed issues outlive it: the old product's
 * work shipped in the days before a reset otherwise counted as the new product's
 * first week in the retro, Health and the weekly report.
 *
 * Labels included deliberately: the weekly report tells what a person asked for
 * from what the pipeline proposed by the ABSENCE of the `agent` label. Fetch
 * without labels and every shipped ticket looks human-filed.
 */
export function fetchShippedIssues(limit = 200) {
  let closed;
  try {
    closed = JSON.parse(
      ghExec([
        "issue", "list", "--state", "closed", "--limit", String(limit),
        "--json", "number,title,closedAt,labels,stateReason",
      ])
    );
  } catch (e) {
    throw new Error(`Could not list closed issues: ${e.message}`, { cause: e });
  }
  const shipped = closed.filter(isShipped);
  const productStart = fetchProductStart();
  if (!productStart) return shipped;
  return shipped.filter((issue) => Date.parse(issue.closedAt) >= Date.parse(productStart));
}
