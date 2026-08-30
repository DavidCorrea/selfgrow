// The Devs, applied to a pull request a person opened.
//
// Opening a PR is a contribution, not a request for permission. In a real team
// you open one and your colleagues take it from there — they verify it, review
// it, push fixes if it needs them, and merge it. Nobody hands it back and asks
// the author to also be the maintainer. That is the whole point of having a team,
// and it is what this does.
//
// The same gates as any agent-built change, in the same order: verify, review,
// address, verify again, merge. A human PR gets no easier a path than the
// pipeline's own work, and no harder one.
//
// TWO THINGS IT WILL NOT DO.
//
// It never closes the PR. Every other failure path in this pipeline can abandon
// work, because that work is the pipeline's own and re-picking a ticket costs a
// run. This work belongs to a person, and closing it deletes the branch. When it
// cannot get a PR to green it says so on the PR and stops — the change stays
// exactly where its author left it.
//
// And it never merges anything that has not passed verify. There is no override
// for "the reviewer liked it": the build's four layers are the same
// non-negotiable gate they are for every agent-built ticket.
//
// One mechanical difference worth knowing. On the pipeline's own PRs the bot
// opens and the PAT approves, because GitHub will not let an author approve their
// own PR. Here the author IS the PAT's owner, so the identities flip: the bot
// approves instead.
import { execSync } from "child_process";
import { pathToFileURL } from "url";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
  errorData,
  gitExec,
  configureGitIdentity,
  verifyBuild,
  repoRoot,
  commentIssue,
  approvePR,
  mergePR,
  readVision,
  getLastModelUsed,
  isRequestBudgetLow,
} from "./shared.mjs";

const PR_NUMBER = Number(process.env.PR_NUMBER || 0);
const PR_BRANCH = process.env.PR_BRANCH || "";
const PR_TITLE = process.env.PR_TITLE || "";
const PR_BODY = process.env.PR_BODY || "";
const PR_AUTHOR = process.env.PR_AUTHOR || "someone";

// How many times the Devs will try to get someone else's PR to green.
//
// Lower than the pipeline's own MAX_BUILDER_RETRIES (3), deliberately. Each cycle
// rewrites a branch its author is watching, and a change they did not ask for is
// more costly to them than a wasted run is to us. Two attempts, then it says what
// is wrong and leaves it alone.
const MAX_CYCLES = Number(process.env.MAX_PR_REVIEW_CYCLES || 2);

// Requests held back for the review that has to follow a fix. Starting a fix we
// cannot afford to re-review leaves the PR in a worse state than not starting.
const TAIL_RESERVE = Number(process.env.PR_TAIL_RESERVE || 30);

/** Say it on the PR. Nothing here is silent — the author is watching this page. */
function say(body) {
  commentIssue(PR_NUMBER, body);
}

function buildFixPrompt(problems) {
  return fillTemplate(loadPrompt("builder"), {
    ISSUE_CONTEXT: `## What this pull request is for
${PR_AUTHOR} opened PR #${PR_NUMBER}: "${PR_TITLE}".

${PR_BODY || "(no description)"}

You are finishing someone else's work, not replacing it. Keep their approach and
their intent; change what has to change to make it ship, and nothing else. A
rewrite that passes the checks but discards what they were doing is a worse
outcome than leaving it failing.`,
    REVIEWER_FEEDBACK: `## What has to be fixed
${problems}

Fix exactly these. Do not take the opportunity to change anything else.`,
    PROPOSAL: `The change is already written and on this branch. Read the diff with \`git diff main...HEAD\` before editing anything.`,
  });
}

function buildReviewPrompt() {
  return fillTemplate(loadPrompt("reviewer"), {
    CHANGE_CONTEXT: `## Change Context
This is PR #${PR_NUMBER}, "${PR_TITLE}", opened by ${PR_AUTHOR} — a person, not an
agent in this pipeline. There is no ticket behind it and no plan to check it
against; judge the change on its own terms and against the Vision.

${PR_BODY || "(no description given)"}

Hold it to exactly the standard you hold the pipeline's own work to. Not higher,
because a contribution is not on trial; and not lower, because this merges to the
same main.

## The Vision
${readVision()}`,
  });
}

/**
 * Push whatever the Builder just changed back to the contributor's branch.
 *
 * Only ever an addition to their work — the branch is never reset or rebased, so
 * their commits stay theirs and the fix is a commit of its own that they can read
 * or drop.
 */
function pushFix(problems) {
  if (!gitExec("status --porcelain")) {
    log("info", "The fix produced no changes.");
    return false;
  }
  try {
    gitExec("add -A");
    gitExec(`commit -m "Address review on #${PR_NUMBER}\n\n${problems.slice(0, 400).replace(/"/g, "'")}"`);
    gitExec(`push origin HEAD:${PR_BRANCH}`);
    log("info", "Pushed a fix to the contributor's branch.");
    return true;
  } catch (e) {
    log("warn", "Could not push the fix.", errorData(e));
    return false;
  }
}

/**
 * The harness's own gate: lint and the test suite.
 *
 * verifyBuild only judges docs/ — the product. A PR that changes agents/ would
 * otherwise merge on a green check of code it never touched, which is precisely
 * backwards for the part of the repo that decides everything else. Free, so it
 * runs on every PR rather than only when a path matched.
 */
function verifyHarness() {
  for (const [name, command] of [["lint", "npm run lint"], ["tests", "npm test"]]) {
    try {
      execSync(command, { cwd: repoRoot, stdio: "pipe" });
    } catch (e) {
      const output = `${e.stdout || ""}${e.stderr || ""}`.toString().trim();
      return {
        ok: false,
        layer: `harness ${name}`,
        errors: [output.slice(-2000) || `\`${command}\` failed`],
      };
    }
  }
  return { ok: true, layer: null, errors: [] };
}

/** Every gate the pipeline holds its own work to, cheapest first. */
async function verify(label) {
  const harness = await withLogGroup(`${label} — harness`, async () => verifyHarness());
  if (!harness.ok) {
    log("warn", `${label} failed the ${harness.layer} check.`, { errors: harness.errors });
    return harness;
  }
  const result = await withLogGroup(`${label} — product`, () => verifyBuild());
  if (!result.ok) {
    log("warn", `${label} failed at the ${result.layer} layer.`, { errors: result.errors });
  }
  return result;
}

async function main() {
  if (!PR_NUMBER || !PR_BRANCH) {
    log("error", "No pull request to review — PR_NUMBER and PR_BRANCH are required.");
    process.exit(1);
  }
  log("info", `=== Reviewing PR #${PR_NUMBER} by ${PR_AUTHOR} ===`);
  configureGitIdentity();

  let problems = null;

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    // 1. Verify first. A change that does not run is not worth a reviewer's
    //    session, and the failures are more useful than any opinion about them.
    const built = await verify(`Verify (cycle ${cycle})`);
    problems = built.ok ? null : `The automated ${built.layer} check fails:\n- ${built.errors.join("\n- ")}`;

    // 2. Review, when there is something worth reviewing.
    if (!problems) {
      const output = await withLogGroup(`Reviewer (cycle ${cycle})`, () =>
        runAgent({
          label: "Reviewer",
          systemPrompt: buildReviewPrompt(),
          tools: ["read", "bash"],
        })
      );
      const review = extractAgentResponse("Reviewer", output, { requiredDataFields: ["issues"] });
      if (!review) {
        // The reviewer is the only thing that can hold a green build back, so an
        // unreadable answer must not read as approval.
        say(
          "The Devs could not produce a usable review of this change. The automated checks pass, " +
            "so it is safe to merge, but nobody has read it — merge it yourself if you are happy with it."
        );
        printRunSummary("PR review");
        return;
      }
      if (review.outcome === "approve") {
        // 3. Approve as the BOT: the PAT is the author here, and GitHub does not
        //    let an author approve their own PR.
        approvePR(PR_NUMBER, `Reviewed by the Devs — checks pass and no blocking issues. ${review.summary || ""}`);
        if (await mergePR(PR_NUMBER)) {
          log("info", `Merged #${PR_NUMBER}.`);
        } else {
          say("This is approved and passing, but the merge failed — it may need a branch update or a protected-branch rule satisfied.");
        }
        printRunSummary("PR review");
        return;
      }
      problems = (review.data.issues || []).join("\n- ");
      log("warn", `Reviewer: revise — ${review.data.issues?.length || 0} issue(s).`);
    }

    // 4. Fix it, rather than handing it back. The last cycle reports instead:
    //    a fix nobody will re-review is a change pushed to someone's branch on
    //    nobody's authority.
    if (cycle === MAX_CYCLES || isRequestBudgetLow(TAIL_RESERVE)) break;

    const fix = await withLogGroup(`Builder (cycle ${cycle})`, () =>
      runAgent({
        label: "Builder",
        systemPrompt: buildFixPrompt(problems),
        tools: ["read", "bash", "edit", "write"],
        thinkingLevel: "medium",
        // Whoever reviewed it should not also be the one fixing it.
        avoidModel: getLastModelUsed(),
      })
    );
    extractAgentResponse("Builder", fix, { requireOutcome: false, requiredDataFields: ["commitMessage"] });
    if (!pushFix(problems)) break;
  }

  // 5. Out of cycles. Say what is wrong and leave the PR exactly as it is — it is
  //    someone's work, and this is the one path in the pipeline that never
  //    abandons what it cannot finish.
  say(
    [
      `The Devs could not get this to a mergeable state after ${MAX_CYCLES} attempt(s). ` +
        "Nothing has been closed and your branch is intact — anything pushed is a separate commit you can drop.",
      "",
      "What is still outstanding:",
      "",
      `- ${problems || "an unknown problem — see the run log"}`,
    ].join("\n")
  );
  printRunSummary("PR review");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `PR review failed: ${err.message || err}`);
    // Never leave the author guessing: a crashed run is still an answer.
    if (PR_NUMBER) {
      say("The Devs hit an unexpected error reviewing this and stopped. Your branch is untouched by this run.");
    }
    printRunSummary("PR review");
    process.exit(1);
  });
}
