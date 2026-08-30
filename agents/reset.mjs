// RESET for a fresh project. Run via workflow_dispatch with the cron workflows
// paused. Clears everything the agents treat as MEMORY, so a new
// Vision starts from nothing instead of inheriting the old product's history.
//
// Order matters, and it is the reason this is a script rather than a checklist:
//   1. Cancel queued/running workflow runs — the Product Manager dispatches the
//      Builder and vice versa, so a queued signal fired mid-reset would happily
//      repopulate the board we are about to empty.
//   2. Close every open issue.
//   3. Close agent PRs and delete their branches.
//   4. Remove every item from the board (after closing, so closed-→-Done items
//      go too). Keeps the columns — the new project needs the same five.
//   5. Reset the wiki's memory pages.
//   6. Delete the accumulated `attempts:N` labels.
//   7. Delete the old product from main (everything outside HARNESS_PATHS).
//
// What it deliberately does NOT touch:
//   - `Vision.md` — the new one is yours to write, and it is the single input
//     every agent derives from. Nothing here can guess it.
//   - `Budget.md` — the daily OpenRouter request ledger tracks the ACCOUNT, not
//     the product. A reset is not a reason to let the day spend its allowance
//     twice, so the running total stays.
//   - Closed issues — GitHub keeps them as history and they cannot be deleted
//     via the API. The Product Manager only ever reads OPEN issues, so they are
//     inert; they just remain visible to humans.
//
// Guarded by a typed confirmation (see requireConfirmation), because every other
// agent here only adds and this one is irreversible in the directions that matter.
import fs from "fs";
import { execSync } from "child_process";
import {
  log,
  printRunSummary,
  errorData,
  repoRoot,
  gitExec,
  configureGitIdentity,
  getWikiDir,
  wikiPath,
  publishWiki,
  closePR,
  deleteRemoteBranch,
  fetchOpenIssues,
  PROJECT_OWNER,
  PROJECT_NUMBER,
} from "./shared.mjs";

// Everything the agent harness needs in order to keep running. The product is
// defined as EVERYTHING ELSE.
//
// This is a keep-list on purpose. It used to be a delete-list, and it missed
// something on both resets it ever ran: `test_ref.mjs` the first time, then
// `check-seeds.mjs`, `run-selftest.mjs` and `search-seeds.mjs` the second — all
// root-level Playwright helpers an agent wrote for the product it was building,
// and none of which a hardcoded delete-list could have anticipated. The harness
// is short and changes rarely; the product is unbounded and invents new files
// every week. Only one of those is safe to enumerate.
const HARNESS_PATHS = [
  ".github",
  ".gitignore",
  "agents",
  "eslint.config.mjs",
  "package.json",
  "package-lock.json",
  // Keeps the empty docs/ directory itself across a reset. Git tracks files and
  // not directories, so without this placeholder docs/ stops existing the moment
  // its last file is deleted — and the agents are told the code lives there and
  // to `ls docs/` before planning. An empty docs/ is the expected state of a
  // brand-new project; a missing one is a puzzle.
  "docs/.gitkeep",
];

// Only branches the agents create are touched. A human's work-in-progress branch
// is not this script's business.
const AGENT_BRANCH_PREFIX = "agent/";

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString();
}

function shJson(cmd) {
  return JSON.parse(sh(cmd));
}

/**
 * Cancel every queued or in-progress run except this one. Without this, the
 * reset races the pipeline it is trying to stop.
 */
function cancelPendingRuns() {
  const selfRunId = String(process.env.GITHUB_RUN_ID || "");
  let runs = [];
  try {
    runs = [
      ...shJson('gh run list --status queued --json databaseId,workflowName --limit 100'),
      ...shJson('gh run list --status in_progress --json databaseId,workflowName --limit 100'),
    ];
  } catch (e) {
    log("warn", "Could not list workflow runs — skipping cancellation.", errorData(e));
    return;
  }

  const pending = runs.filter((r) => String(r.databaseId) !== selfRunId);
  if (!pending.length) {
    log("info", "No queued or running workflows to cancel.");
    return;
  }
  log("info", `Cancelling ${pending.length} pending workflow run(s)...`);
  for (const run of pending) {
    try {
      sh(`gh run cancel ${run.databaseId}`);
      log("info", `Cancelled ${run.workflowName} (${run.databaseId}).`);
    } catch (e) {
      log("warn", `Could not cancel run ${run.databaseId}`, errorData(e));
    }
  }
}

function closeAllIssues() {
  const issues = fetchOpenIssues(500);
  log("info", `Closing ${issues.length} open issue(s)...`);
  for (const issue of issues) {
    try {
      sh(`gh issue close ${issue.number} --reason "not planned"`);
      log("info", `Closed #${issue.number}: ${issue.title}`);
    } catch (e) {
      log("warn", `Could not close #${issue.number}`, errorData(e));
    }
  }
}

/**
 * Close open PRs from agent branches and delete the branches, including any
 * orphaned by a crashed run (a branch with no PR still shadows the new project).
 */
function clearAgentBranches() {
  let openPRs = [];
  try {
    openPRs = shJson('gh pr list --state open --json number,headRefName --limit 200');
  } catch (e) {
    log("warn", "Could not list pull requests — skipping PR cleanup.", errorData(e));
  }

  // closePR deletes the head branch too, so the sweep below only has to catch
  // branches orphaned by a crashed run — ones that never got a PR.
  const agentPRs = openPRs.filter((pr) => pr.headRefName.startsWith(AGENT_BRANCH_PREFIX));
  log("info", `Closing ${agentPRs.length} open agent PR(s)...`);
  for (const pr of agentPRs) {
    closePR(pr.number, "Closing as part of a project reset — this work belongs to the previous product.");
  }

  let branches = [];
  try {
    branches = sh(`git ls-remote --heads origin "refs/heads/${AGENT_BRANCH_PREFIX}*"`)
      .split("\n")
      .map((line) => line.split("refs/heads/")[1])
      .filter(Boolean);
  } catch (e) {
    log("warn", "Could not list remote branches — skipping branch cleanup.", errorData(e));
    return;
  }

  if (branches.length) {
    log("info", `Deleting ${branches.length} orphaned agent branch(es)...`);
    for (const branch of branches) deleteRemoteBranch(branch);
  }
}

function clearBoard() {
  let items = [];
  try {
    const res = shJson(
      `gh project item-list ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json --limit 500`
    );
    items = res.items || [];
  } catch (e) {
    log("warn", "Could not list board items — skipping board clear.", errorData(e));
    return;
  }
  log("info", `Removing ${items.length} board item(s)...`);
  for (const item of items) {
    try {
      sh(`gh project item-delete ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --id ${item.id}`);
    } catch (e) {
      log("warn", `Could not remove board item ${item.id}`, errorData(e));
    }
  }
}

// Lessons is restored to its canonical empty form — the exact heading and intro
// appendLesson() writes when it creates the page — so the first post-mortem of
// the new project appends cleanly instead of rebuilding a half-formed page.
const EMPTY_WIKI_PAGES = {
  "Changelog.md": "# Changelog\n",
  "Lessons.md":
    "# Lessons\n\n" +
    "What the agents have tried and abandoned, and why. Read this before planning " +
    "work that resembles anything below — the point of writing it down is not to " +
    "learn it twice.\n",
  "Story.md": "# The Story So Far\n\nThis project is just beginning. The Scribe will write its story as it grows.\n",
  "Home.md":
    "# Wiki\n\nThe living record of this project, maintained by its autonomous agents.\n\n" +
    "- **[Vision](Vision)** — the north star (curated by the Product Owner).\n" +
    "- **[Changelog](Changelog)** — the dated record of what changed (written by the Builder).\n" +
    "- **[The Story So Far](Story)** — how the project has grown over time.\n" +
    "- **[Lessons](Lessons)** — work the agents abandoned, and why (written when a ticket is parked).\n",
};

/**
 * Blank the wiki pages that carry product memory. Lessons is the one that most
 * needs it: the Scout reads it before planning every build, so left in place it
 * teaches a brand-new project the dead ends of the old one.
 */
function resetWikiMemory() {
  if (!getWikiDir()) {
    log("warn", "Wiki unreachable — memory pages NOT reset. Do this by hand before starting.");
    return;
  }
  for (const [page, content] of Object.entries(EMPTY_WIKI_PAGES)) {
    const path = wikiPath(page);
    if (!path) continue;
    fs.writeFileSync(path, content, "utf-8");
    log("info", `Reset wiki page ${page}.`);
  }
  publishWiki("Reset project memory for a fresh start");
  log("info", "Left Vision.md and Budget.md untouched, by design.");
}

/**
 * Delete the `attempts:N` labels. Unlike the other labels these accumulate one
 * definition per attempt count ever reached, and they mean nothing to a project
 * whose tickets no longer exist. The rest are recreated on demand with --force.
 */
function deleteAttemptLabels() {
  let labels = [];
  try {
    labels = shJson("gh label list --json name --limit 200");
  } catch (e) {
    log("warn", "Could not list labels — skipping label cleanup.", errorData(e));
    return;
  }
  const stale = labels.map((l) => l.name).filter((name) => /^attempts:/.test(name));
  if (!stale.length) {
    log("info", "No attempts:N labels to delete.");
    return;
  }
  log("info", `Deleting ${stale.length} attempts:N label(s)...`);
  for (const name of stale) {
    try {
      sh(`gh label delete "${name}" --yes`);
    } catch (e) {
      log("warn", `Could not delete label ${name}`, errorData(e));
    }
  }
}

/**
 * Delete the old product from main and push. Runs LAST: everything above is
 * GitHub-side and reversible-ish, while this rewrites the repo.
 */
function clearProduct() {
  gitExec("fetch origin");
  gitExec("checkout main");
  gitExec("reset --hard origin/main");

  // Ask git what is tracked rather than guessing: a path git does not know makes
  // `git rm` fail, and this is the last and least reversible step.
  const tracked = gitExec("ls-files").split("\n").map((p) => p.trim()).filter(Boolean);
  const isHarness = (path) =>
    HARNESS_PATHS.some((keep) => path === keep || path.startsWith(`${keep}/`));
  const doomed = tracked.filter((path) => !isHarness(path));

  if (!doomed.length) {
    log("info", "No product files left to delete.");
    return;
  }
  log("info", `Deleting ${doomed.length} product file(s); keeping the agent harness.`);

  configureGitIdentity();
  // Batched: a mature product can be hundreds of files, which is more than one
  // command line should carry.
  const BATCH = 100;
  for (let i = 0; i < doomed.length; i += BATCH) {
    const batch = doomed.slice(i, i + BATCH).map((path) => `"${path}"`).join(" ");
    gitExec(`rm -r --quiet -- ${batch}`);
  }
  gitExec('commit -m "Clear the previous product for a fresh start"');
  try {
    gitExec("push origin main");
    log("info", `Deleted ${doomed.length} product file(s) from main.`);
  } catch (e) {
    log("error", "Could not push the product deletion to main — do it by hand.", errorData(e));
  }
}

// What the operator must type to arm the reset. The repository name, following
// the convention GitHub itself uses for deleting one: it cannot be typed by
// reflex, and it names the thing being emptied.
const CONFIRM_PHRASE = "selfgrow";

/**
 * Refuse to run unless the operator confirmed in words.
 *
 * The reset sits in the same Actions list as six harmless agents and used to
 * fire on a bare dispatch. Everything it does is recoverable in principle — the
 * product from git history, issues by reopening — and recovering all of it at
 * once, in order, is a bad afternoon nobody chose to have.
 *
 * Checked here rather than in the workflow so a hand-run `node agents/reset.mjs`
 * is guarded on the same terms.
 */
function requireConfirmation() {
  const given = (process.env.RESET_CONFIRM || "").trim();
  if (given === CONFIRM_PHRASE) return;
  log(
    "error",
    given
      ? `Refusing to reset: confirmation "${given}" does not match "${CONFIRM_PHRASE}".`
      : `Refusing to reset: no confirmation given. Set RESET_CONFIRM="${CONFIRM_PHRASE}" ` +
          "(the workflow asks for it as an input) to arm this."
  );
  process.exit(1);
}

function main() {
  requireConfirmation();
  log("info", "=== RESET — fresh-project cleanup ===");
  cancelPendingRuns();
  closeAllIssues();
  clearAgentBranches();
  clearBoard();
  resetWikiMemory();
  deleteAttemptLabels();
  clearProduct();
  log(
    "info",
    "Reset complete. Remaining manual steps: write the new Vision in the wiki, " +
      "re-enable the paused workflows, then dispatch the Product Manager."
  );
  printRunSummary("Reset");
}

try {
  main();
} catch (err) {
  log("error", "Reset failed.", errorData(err));
  process.exit(1);
}
