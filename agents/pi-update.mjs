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
// What it will and will not do to the chain:
//   - It replaces ONLY entries that model-check.mjs calls broken (gone from the
//     registry, or — for entries not marked `paid` — no longer free). A working
//     id is never touched, and a deliberately paid one is never evicted for its
//     price. If a paid entry does rotate out, its substitute comes from the
//     free-only suggestion list, which degrades the chain to free rather than
//     silently picking a replacement with an unreviewed price.
//   - Every substitute is probed against the new pi BEFORE it is committed, and a
//     candidate that fails to return the JSON envelope is not used. Existing in
//     the registry is not evidence that a model works here.
//   - It never reorders surviving entries. The order encodes measured envelope
//     reliability, and one 2-request sample is not grounds to overwrite that.
//   - If the chain cannot be repaired with models that actually work, the whole
//     bump is REVERTED and an issue is filed. Staying on a pi whose chain works
//     beats advancing to one whose chain doesn't.
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
  writeModelChain,
  appendJobSummary,
  TECH_DEBT_LABEL,
} from "./shared.mjs";
import { renderProbeTable } from "./model-probe.mjs";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

// Most substitutes to try when the chain breaks. Each costs 2 requests to probe,
// so this bounds the repair's price; the chain only needs enough working models to
// make its fallbacks independent, not every free model in existence.
const MAX_CANDIDATES = Number(process.env.MAX_MODEL_CANDIDATES || 4);

// Below this the chain has no meaningful fallback left and the pipeline is one
// rate-limit away from doing nothing all day.
const MIN_CHAIN_LENGTH = Number(process.env.MIN_CHAIN_LENGTH || 3);

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

/** Probe ids against the installed pi. Returns { rows, usableIds, quotaHit }. */
function probe(ids) {
  if (!ids.length) return { rows: [], usableIds: [], quotaHit: false };
  const { stdout, stderr } = runNode(["agents/model-probe.mjs", "--json", ids.join(",")]);
  const report = parseJsonOutput(stdout);
  if (!report) {
    log("warn", `Probe produced no usable report: ${stderr.trim().split("\n")[0] || "no output"}`);
    return { rows: [], usableIds: [], quotaHit: false };
  }
  return report;
}

/**
 * Replace broken chain entries with probed-usable substitutes, in place, so the
 * surviving order is preserved. Returns { entries, replaced, dropped, rows }.
 */
function repairChain(report) {
  const brokenIds = new Set(report.broken.map((b) => b.id));
  const candidates = report.suggestions.slice(0, MAX_CANDIDATES);

  log("info", `Chain repair: ${brokenIds.size} broken entry(ies), probing ${candidates.length} candidate(s) — ${candidates.length * 2} request(s).`);
  const { rows, usableIds } = probe(candidates);
  const unusable = candidates.filter((id) => !usableIds.includes(id));
  if (unusable.length) {
    log("warn", `Chain repair: rejecting ${unusable.length} candidate(s) that did not return the envelope: ${unusable.join(", ")}.`);
  }

  const available = [...usableIds];
  const replaced = [];
  const dropped = [];
  const entries = [];
  for (const entry of report.entries) {
    if (!brokenIds.has(entry.id)) {
      entries.push({ id: entry.id, why: entry.why, paid: entry.paid });
      continue;
    }
    const substitute = available.shift();
    if (substitute) {
      entries.push({
        id: substitute,
        why: `Replaced \`${entry.id}\` (${entry.status}) automatically; verified by model-probe against pi at the time of the swap.`,
      });
      replaced.push({ from: entry.id, to: substitute, status: entry.status });
    } else {
      dropped.push({ id: entry.id, status: entry.status });
    }
  }
  return { entries, replaced, dropped, rows };
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

function buildPrBody({ from, to, report, repair, chainRows }) {
  const lines = [
    `Bumps \`${PI_PACKAGE}\` from **${from}** to **${to}**.`,
    "",
    "## Model chain",
    "",
  ];

  if (report.ok) {
    lines.push(`All ${report.entries.length} configured model(s) are still present and free in pi ${to}'s registry — \`agents/models.json\` is unchanged.`);
  } else {
    lines.push(`\`model-check.mjs\` found ${report.broken.length} broken entry(ies) against pi ${to}:`, "");
    for (const b of report.broken) lines.push(`- \`${b.id}\` — ${b.status}`);
    lines.push("");
    if (repair.replaced.length) {
      lines.push("Replaced automatically, each verified by a live probe before being committed:", "");
      for (const r of repair.replaced) lines.push(`- \`${r.from}\` (${r.status}) → \`${r.to}\``);
      lines.push("");
    }
    if (repair.dropped.length) {
      lines.push(
        "Removed with no substitute available (pi knows no other free model that returned the envelope):",
        "",
        ...repair.dropped.map((d) => `- \`${d.id}\` (${d.status})`),
        ""
      );
    }
    lines.push(
      "Surviving entries keep their position: the chain's order encodes measured envelope reliability, and this automation does not reorder it.",
      ""
    );
  }

  if (chainRows.length) {
    lines.push(
      "## Probe results",
      "",
      "Each model asked for the JSON envelope twice — once with tools offered, once without. A model counts as usable only if both answers parse.",
      "",
      renderProbeTable(chainRows),
      ""
    );
  }

  lines.push(
    "---",
    "",
    "_Opened by `agents/pi-update.mjs`. Approved and merged automatically — the chain is asserted by `model-check.mjs` in CI, so a bad chain fails the build rather than reaching a run._"
  );
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
      : `Dry run: a real run would branch, install pi ${to}, re-check the chain (${readModelChain().length} model(s)), probe it, and open a self-merging PR.`);
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

  let repair = { entries: readModelChain(), replaced: [], dropped: [], rows: [] };
  if (!report.ok) {
    repair = repairChain(report);

    if (repair.entries.length < MIN_CHAIN_LENGTH) {
      log(
        "error",
        `Chain repair left only ${repair.entries.length} working model(s), under the ${MIN_CHAIN_LENGTH} minimum — reverting the bump.`
      );
      revertBump();
      gitExec("checkout main");
      deleteRemoteBranch(branchName);
      createIssue(
        `pi ${to} leaves the model chain unrepairable`,
        [
          `Bumping \`${PI_PACKAGE}\` from ${from} to ${to} breaks ${report.broken.length} of ${report.entries.length} configured model(s), and pi ${to} knows no free substitutes that return the JSON envelope. The bump was **reverted** — the repo stays on ${from}.`,
          "",
          "Broken entries:",
          ...report.broken.map((b) => `- \`${b.id}\` — ${b.status}`),
          "",
          repair.rows.length
            ? `Candidates probed and rejected:\n\n${renderProbeTable(repair.rows)}`
            : "No candidates were available to probe.",
          "",
          "A human needs to choose a chain here: either a different free lineup, or a paid model with a budget to match.",
        ].join("\n"),
        [TECH_DEBT_LABEL]
      );
      printRunSummary("pi update");
      process.exit(1);
    }

    writeModelChain(repair.entries);
    log("info", `Wrote agents/models.json — ${repair.replaced.length} replaced, ${repair.dropped.length} dropped, ${repair.entries.length} model(s) in the chain.`);
  }

  // Probe the chain as it now stands, skipping anything the repair already probed,
  // so the PR reports real evidence for every model the pipeline will rely on.
  const alreadyProbed = new Set(repair.rows.map((r) => r.modelId));
  const toProbe = repair.entries.map((e) => e.id).filter((id) => !alreadyProbed.has(id));
  log("info", `Probing the resulting chain — ${toProbe.length} model(s), ${toProbe.length * 2} request(s).`);
  const chainProbe = probe(toProbe);
  const chainRows = [...repair.rows, ...chainProbe.rows];

  const unusable = repair.entries.map((e) => e.id).filter((id) => {
    const mine = chainRows.filter((r) => r.modelId === id);
    return mine.length > 0 && !mine.every((r) => r.usable);
  });
  if (unusable.length) {
    // Not fatal, and deliberately so: a free endpoint rate-limiting during a probe
    // is indistinguishable here from one that has genuinely broken, and the chain
    // exists precisely to tolerate a model that answers badly today. Say it loudly
    // in the PR instead of blocking a pi bump on a flaky sample.
    log("warn", `${unusable.length} chain model(s) did not return the envelope in this probe: ${unusable.join(", ")}. Kept — the chain tolerates a bad model, and one sample is not proof.`);
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

  const body = buildPrBody({ from, to, report, repair, chainRows });
  appendJobSummary(`## pi update\n\n${body}`);

  const prNumber = createPR(branchName, `Bump pi to ${to} and re-check the model chain`, body);
  if (!prNumber) {
    log("error", "Could not open the PR — the branch is pushed, so nothing is lost. Open it by hand.");
    printRunSummary("pi update");
    process.exit(1);
  }
  approvePR(prNumber, "Approved automatically: the chain is asserted by model-check.mjs and every substitute was probed before it was committed.");
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
