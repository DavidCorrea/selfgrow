// Keep pi current, and keep the model chain honest about the pi that is installed.
//
// These two jobs belong in one place because they fail together: pi's bundled
// model snapshot is where the chain's ids are resolved, and pi's free lineup
// rotates. Bumping pi without re-checking the chain is how the pipeline ends up
// silently running on auto-discovered substitutes (see model-check.mjs); checking
// the chain without ever bumping pi is how it drifts years behind.
//
// The run is a no-op unless the version actually moves, so a week with no pi
// release costs nothing at all — no requests, no PR, no commit.
//
// What it does about the chain: it ASSERTS it, and nothing more. If an id is gone
// from the new pi's registry, the whole bump is REVERTED and an issue is filed.
// Staying on a pi whose chain works beats advancing to one whose chain doesn't.
//
// It used to repair the chain itself — probe free candidates, swap in whichever
// returned the JSON envelope, drop the rest. That machinery existed because free
// ids rotate out of pi's registry every few weeks and its substitute pool was
// "any free model". The chain is two deliberately chosen paid models now: the
// pool is gone, the rotation is far slower, and choosing a replacement is a
// judgement about cost, coding ability and provider independence that a 2-request
// probe cannot make. So a broken chain is now a ticket, not a self-repair.
//
// The change lands as a PR opened by the bot, approved by the PAT and merged
// automatically — no human in the loop, but CI runs and the trail is auditable.
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import { join } from "path";
import {
  log,
  logGroup,
  printRunSummary,
  errorData,
  repoRoot,
  gitExec,
  configureGitIdentity,
  createBranch,
  deleteRemoteBranch,
  createPR,
  approvePR,
  mergePR,
  createIssue,
  readModelChain,
  appendJobSummary,
  TECH_DEBT_LABEL,
} from "./shared.mjs";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Subprocess helpers
//
// Everything that touches pi's registry MUST run in a FRESH process. This one
// imported shared.mjs (and through it the OLD pi) before npm replaced it on disk,
// so any check performed in-process would report the version we are replacing.
// ---------------------------------------------------------------------------

function runNode(args) {
  const res = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/** Parse the JSON a --json subprocess printed, ignoring any log lines around it. */
function parseJsonOutput(stdout) {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

function installedVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(join(repoRoot, "node_modules", PI_PACKAGE, "package.json"), "utf-8")
    ).version;
  } catch {
    return null;
  }
}

function latestVersion() {
  return execFileSync("npm", ["view", PI_PACKAGE, "version"], {
    cwd: repoRoot,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Check the chain against the pi now on disk. Returns model-check's JSON report. */
function checkChain() {
  const { status, stdout, stderr } = runNode(["agents/model-check.mjs", "--json"]);
  const report = parseJsonOutput(stdout);
  if (!report) {
    throw new Error(`model-check.mjs produced no usable report (exit ${status}): ${stderr.trim().split("\n")[0] || "no output"}`);
  }
  return report;
}

/** Undo the dependency bump so the repo stays on the pi it was working with. */
function revertBump() {
  try {
    gitExec("checkout -- package.json package-lock.json");
    execFileSync("npm", ["ci"], { cwd: repoRoot, stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
    log("info", "Reverted the bump and reinstalled the previous pi.");
  } catch (e) {
    log("error", "Could not revert the bump — the working tree may be left on the new pi.", errorData(e));
  }
}

function buildPrBody({ from, to, report }) {
  const lines = [
    `Bumps \`${PI_PACKAGE}\` from **${from}** to **${to}**.`,
    "",
    "## Model chain",
    "",
    `All ${report.entries.length} configured model(s) are still present in pi ${to}'s registry — \`agents/models.json\` is unchanged.`,
    "",
    ...report.entries.map((e) => `- \`${e.id}\` — $${e.cost?.input}/$${e.cost?.output} per M tokens`),
    "",
    "---",
    "",
    "_Opened by `agents/pi-update.mjs`. Approved and merged automatically — the chain is asserted by `model-check.mjs` in CI, so a bad chain fails the build rather than reaching a run._",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

async function main() {
  log("info", "=== pi update — bump the agent runtime and re-check the model chain ===");
  configureGitIdentity();

  const from = installedVersion();
  const to = latestVersion();
  log("info", `${PI_PACKAGE}: installed ${from || "(unknown)"}, latest ${to}.`);

  if (!from) {
    log("error", "pi is not installed — run `npm ci` first. Nothing to compare against.");
    printRunSummary("pi update");
    process.exit(1);
  }
  // Report what a real run would do and stop — no install, no branch, no requests.
  // The only safe way to exercise this script outside CI, since everything after
  // this point mutates the repo.
  if (process.argv.includes("--dry-run")) {
    log("info", from === to
      ? "Dry run: already on the latest pi — a real run would exit here having spent nothing."
      : `Dry run: a real run would branch, install pi ${to}, re-check the chain (${readModelChain().length} model(s)), and open a self-merging PR.`);
    printRunSummary("pi update (dry run)");
    return;
  }

  if (from === to) {
    log("info", "Already on the latest pi — nothing to do (no requests spent, no PR opened).");
    appendJobSummary(`## pi update\n\nAlready on \`${PI_PACKAGE}\` **${to}** — no change.`);
    printRunSummary("pi update");
    return;
  }

  // Branch BEFORE installing, so the bump lands on the branch and `git checkout --`
  // in revertBump has a clean base to return to.
  const branchName = `agent/pi-update-${to}${process.env.GITHUB_RUN_ID ? `-${process.env.GITHUB_RUN_ID}` : ""}`;
  createBranch(branchName);

  const endInstall = logGroup(`Install pi ${to}`);
  try {
    execFileSync("npm", ["install", `${PI_PACKAGE}@${to}`, "--save-exact=false"], {
      cwd: repoRoot,
      stdio: "inherit",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    endInstall();
    log("error", `Could not install pi ${to} — leaving the repo on ${from}.`, errorData(e));
    revertBump();
    gitExec("checkout main");
    deleteRemoteBranch(branchName);
    createIssue(
      `pi ${to} could not be installed`,
      `\`agents/pi-update.mjs\` failed to install \`${PI_PACKAGE}@${to}\` (currently on ${from}).\n\n\`\`\`\n${(e.message || String(e)).slice(0, 1500)}\n\`\`\`\n\nThe repo is unchanged. Investigate before the next weekly run.`,
      [TECH_DEBT_LABEL]
    );
    printRunSummary("pi update");
    process.exit(1);
  }
  endInstall();

  // Every check from here runs in a fresh process against the pi just installed.
  let report;
  try {
    report = checkChain();
  } catch (e) {
    log("error", `pi ${to} is installed but its registry could not be read — reverting.`, errorData(e));
    revertBump();
    gitExec("checkout main");
    deleteRemoteBranch(branchName);
    createIssue(
      `pi ${to} installs but its model registry cannot be read`,
      `\`agents/model-check.mjs\` could not resolve any model against \`${PI_PACKAGE}@${to}\`, so the bump was reverted and the repo stays on ${from}.\n\n\`\`\`\n${(e.message || String(e)).slice(0, 1500)}\n\`\`\`\n\nThis usually means pi's API changed — \`ModelRuntime.create\` / \`getModels\` in \`agents/shared.mjs\` are the places to look.`,
      [TECH_DEBT_LABEL]
    );
    printRunSummary("pi update");
    process.exit(1);
  }

  if (!report.ok) {
    log(
      "error",
      `pi ${to} no longer knows ${report.broken.length} of ${report.entries.length} configured model(s) — reverting the bump.`
    );
    revertBump();
    gitExec("checkout main");
    deleteRemoteBranch(branchName);
    createIssue(
      `pi ${to} leaves the model chain broken`,
      [
        `Bumping \`${PI_PACKAGE}\` from ${from} to ${to} breaks ${report.broken.length} of ${report.entries.length} configured model(s). The bump was **reverted** — the repo stays on ${from}.`,
        "",
        "Broken entries:",
        ...report.broken.map((b) => `- \`${b.id}\` — ${b.status}`),
        "",
        "Pick the replacement by hand in `agents/models.json`: a paid model from a different provider family than the surviving entry, coding-tuned, with reasoning support. Two entries is the target — the second exists so the Reviewer can be drawn from a different model than wrote the code.",
      ].join("\n"),
      [TECH_DEBT_LABEL]
    );
    printRunSummary("pi update");
    process.exit(1);
  }

  // Commit whatever actually changed.
  const changed = gitExec("status --porcelain");
  if (!changed) {
    log("warn", "Nothing changed on disk despite a version difference — no PR to open.");
    gitExec("checkout main");
    deleteRemoteBranch(branchName);
    printRunSummary("pi update");
    return;
  }
  log("info", `Committing:\n${changed}`);
  gitExec("add -A");
  // execFileSync, not a shell string: the message is ours, but this file should not
  // be the one that reintroduces shell interpolation of generated text.
  execFileSync("git", ["commit", "-m", `Bump ${PI_PACKAGE} to ${to} and re-check the model chain`], {
    cwd: repoRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  gitExec(`push origin ${branchName}`);

  const body = buildPrBody({ from, to, report });
  appendJobSummary(`## pi update\n\n${body}`);

  const prNumber = createPR(branchName, `Bump pi to ${to} and re-check the model chain`, body);
  if (!prNumber) {
    log("error", "Could not open the PR — the branch is pushed, so nothing is lost. Open it by hand.");
    printRunSummary("pi update");
    process.exit(1);
  }
  approvePR(prNumber, "Approved automatically: the chain is asserted by model-check.mjs against the pi being installed.");
  if (!(await mergePR(prNumber))) {
    log("error", `PR #${prNumber} could not be merged — leaving it open for inspection.`);
    printRunSummary("pi update");
    process.exit(1);
  }
  try { gitExec("checkout main"); } catch { /* the merge already landed */ }

  log("info", `pi ${from} → ${to} merged via PR #${prNumber}.`);
  printRunSummary("pi update");
}

main().catch((err) => {
  log("error", `pi update failed: ${err.message || err}`, errorData(err));
  printRunSummary("pi update");
  process.exit(1);
});
