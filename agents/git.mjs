// Every git and gh subprocess, and the branch operations built on them.

import { execFileSync } from "child_process";
import fs from "fs";
import { join } from "path";
import { log } from "./log.mjs";
import { gitAuthEnv, secret } from "./secrets.mjs";
import { repoRoot } from "./paths.mjs";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

// git and gh are always run from an argv array, never a shell string. Commit
// messages, issue and PR titles, and branch names all carry model-written text,
// and this runner holds a PAT: through a shell, a backtick or `$(...)` in any of
// them is a command, and escaping only `"` (which is what the old string form
// did) stops none of it. With execFileSync there is no shell, so no quoting rules
// to get wrong — every argument arrives exactly as written.

//
// Each hands its token to that one child and nowhere else (see secrets.mjs): gh
// and git are not model-controlled, the tools' shells are. GIT_TOKEN is the token
// that pushes — given only to the jobs that push, whose checkouts no longer
// persist one on disk.

const EXEC_OPTIONS = { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 };

export function gitExec(argv, opts = {}) {
  const env = { ...process.env, ...gitAuthEnv(secret("GIT_TOKEN")) };
  return execFileSync("git", argv, { ...EXEC_OPTIONS, env, ...opts }).toString().trim();
}

/** gh, authenticated as `token` — by default the run's GH_TOKEN. */
export function ghExec(argv, { token = secret("GH_TOKEN"), ...opts } = {}) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return execFileSync("gh", argv, { ...EXEC_OPTIONS, env, ...opts }).toString();
}

/**
 * Run git where failing is an expected answer — the branch is not there, no merge
 * is in progress — and say whether it worked. git's complaint is captured rather
 * than printed. Cleanup only: anything a caller relies on goes through gitExec.
 */
function gitTry(argv, opts = {}) {
  try {
    gitExec(argv, { stdio: "pipe", ...opts });
    return true;
  } catch {
    return false;
  }
}

// The paths that ARE the machine: its workflows and permissions, its agents,
// prompts and skills, and the dependencies it runs on. A change there decides
// what every later review, merge and secret does, so the agents that would be
// governed by it are the wrong ones to wave it through — an approval from the
// pipeline is only as trustworthy as the pipeline, and this is the change that
// could rewrite it.
const MACHINE_DIRS = [".github/", "agents/"];
const MACHINE_FILES = new Set(["package.json", "package-lock.json"]);

/** True when any changed path is part of the machine — see MACHINE_DIRS. */
export function changesTheMachine(paths) {
  return paths.some((path) => MACHINE_FILES.has(path) || MACHINE_DIRS.some((dir) => path.startsWith(dir)));
}

const nulSeparated = (output) => output.split("\0").filter(Boolean);

/**
 * Undo every change the working tree holds to the machine, and return the paths
 * undone. The Devs merge their own PRs, so without this a Builder that edited a
 * prompt or a skill would merge it unreviewed — and before that, the Reviewer in
 * the same run would already be reading the edited version.
 */
export function revertMachineEdits(dir = repoRoot) {
  const git = (argv) => gitExec(argv, { cwd: dir });
  const tracked = nulSeparated(git(["diff", "HEAD", "--name-only", "--no-renames", "-z"]))
    .filter((path) => changesTheMachine([path]));
  const added = nulSeparated(git(["ls-files", "--others", "--exclude-standard", "-z"]))
    .filter((path) => changesTheMachine([path]));
  if (tracked.length) git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
  for (const path of added) fs.rmSync(join(dir, path), { force: true });
  return [...tracked, ...added].sort();
}

let gitIdentityConfigured = false;

/**
 * Set the committer identity once per process. Idempotent — safe to call from
 * any code path that is about to create a commit.
 */
export function configureGitIdentity() {
  if (gitIdentityConfigured) return;
  gitExec(["config", "user.name", "github-actions[bot]"]);
  gitExec(["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
  gitIdentityConfigured = true;
}

/** Stage everything in the working tree and commit it as one change. */
export function commitAll(message) {
  gitExec(["add", "-A"]);
  gitExec(["commit", "-m", message]);
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
 * Delete a branch on origin if it exists. Best-effort — never throws. The branch
 * usually doesn't exist on origin, since run-scoped names are unique.
 */
export function deleteRemoteBranch(branchName) {
  if (gitTry(["push", "origin", "--delete", branchName])) log("info", `Deleted remote branch ${branchName}.`);
}

export function createBranch(branchName) {
  gitExec(["fetch", "origin"]);
  gitExec(["checkout", "main"]);
  // Base the branch on the real remote tip, not a possibly-stale local main.
  gitExec(["reset", "--hard", "origin/main"]);
  // Clear any leftover branch of the same name from a prior failed run. With
  // run-scoped names this is usually a no-op.
  gitTry(["branch", "-D", branchName]);
  deleteRemoteBranch(branchName);
  gitExec(["checkout", "-b", branchName]);
  log("info", `Created branch: ${branchName}`);
}

export function mergeMainIntoBranch() {
  try {
    gitExec(["fetch", "origin"]);
    gitExec(["merge", "origin/main", "--no-edit"]);
    log("info", "Merged origin/main into branch — clean.");
    return { clean: true };
  } catch {
    const status = gitExec(["status", "--porcelain"]);
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

/** Abort a merge in progress, if there is one. */
export function abortMerge() {
  if (gitTry(["merge", "--abort"])) log("info", "Aborted merge.");
}

/**
 * Throw away whatever an abandoned ticket left behind and stand on origin/main
 * again, with the ticket's local branch deleted.
 *
 * A ticket can be abandoned mid-anything: a verify that failed on uncommitted
 * edits, or a conflict-resolution agent that threw with the merge still open.
 * A plain `git checkout main` fails on either, and it used to fail silently, so
 * the NEXT ticket's createBranch hit the same dirty tree outside any handler and
 * took down the whole run.
 *
 * So this one throws. If the tree cannot be put back, no ticket after it can
 * start either, and the run should say so here rather than one ticket later.
 * `opts` reaches gitExec, which is how the tests point it at a scratch repo.
 */
export function returnToCleanMain(branchName, opts = {}) {
  const git = (argv) => gitExec(argv, { stdio: "pipe", ...opts });
  // No merge in progress is the usual case.
  gitTry(["merge", "--abort"], opts);
  git(["reset", "--hard"]);
  git(["clean", "-fd"]);
  git(["checkout", "-f", "-B", "main", "origin/main"]);
  // The branch may never have been created locally.
  gitTry(["branch", "-D", branchName], opts);
}
