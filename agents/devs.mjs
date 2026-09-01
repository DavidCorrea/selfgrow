import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  extractAgentResponse,
  errorData,
  gitExec,
  configureGitIdentity,
  createBranchName,
  createBranch,
  mergeMainIntoBranch,
  abortMerge,
  deleteRemoteBranch,
  fetchOpenIssues,
  recordTicket,
  recordTicketFailure,
  isBlocked,
  isBuildable,
  dependentsOf,
  effectivePriorityRank,
  isDailyQuotaExhausted,
  unmetDependencies,
  syncWaitingLabels,
  triggerWorkflow,
  readVision,
  readLessons,
  appendLesson,
  closeIssue,
  createIssue,
  TECH_DEBT_LABEL,
  moveCard,
  createPR,
  approvePR,
  mergePR,
  closePR,
  appendChangelogEntry,
  verifyBuild,
  runAgent,
  getLastModelUsed,
} from "./shared.mjs";

const MAX_SCOUT_RETRIES = 2;
// Up to this many build → review cycles on a PR before we revoke (close) it.
// Kept modest because each cycle is several slow free-model calls + a verify;
// the job has a wall-clock budget.
const MAX_BUILDER_RETRIES = 3;

// Cross-run failures a single ticket may rack up before it's parked (blocked) so
// the Scout stops re-picking it every run. See recordTicketFailure in shared.
const MAX_TICKET_ATTEMPTS = Number(process.env.MAX_TICKET_ATTEMPTS || 2);

// Wall-clock held back for the steps AFTER the Builder — Reviewer, and a possible
// address-feedback pass — so a completed build always gets the chance to become a
// merge. Too small and the run throws away finished work, as it did on #149; too
// large and it never starts anything.
//
// This used to be measured in requests, against a per-run request budget. The
// budget is gone (spend is capped on the key), but the lesson it encoded is not:
// the scarce resource is now the run's wall clock, so the reserve is denominated
// in that. Sized from merged tickets, where the Reviewer and a fix pass together
// ran 10-20 minutes; 25 covers the tail with room to spare.
const BUILD_TAIL_RESERVE_MS =
  Number(process.env.BUILD_TAIL_RESERVE_MINUTES || 25) * 60 * 1000;

// Drain several tickets per run, one after another, up to a wall-clock budget kept
// under the job's timeout. This is the normal shape: the workflow runs ONE build
// job and sizes the queue with MAX_TICKETS_PER_RUN, so a single checkout, npm ci
// and Chromium install is amortized over every ticket the day builds rather than
// re-paid per ticket. Each ticket still checks out the previous one's merge,
// because they run in sequence in the same working tree.
//
// TICKET_NUMBER pins the run to exactly one ticket. Nothing in CI sets it — it is
// for re-running a single ticket by hand without the run wandering onto whatever
// else the board happens to be offering.
const PINNED_TICKET = Number(process.env.TICKET_NUMBER || 0) || null;

const MAX_TICKETS_PER_RUN = PINNED_TICKET
  ? 1
  : Number(process.env.MAX_TICKETS_PER_RUN || 3);
const RUN_BUDGET_MS = Number(process.env.BUILD_RUN_BUDGET_MINUTES || 45) * 60 * 1000;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Past dead ends, for the Scout to read before planning. Framed as advice rather
 * than prohibition: a lesson explains why something failed once, which is a
 * reason to plan differently, not proof that the work is impossible.
 */
function buildLessonsSection() {
  const lessons = readLessons().trim();
  if (!lessons) return "";
  return `## Lessons From Abandoned Work
Tickets the Devs previously gave up on, newest first, and why. If your ticket resembles one of these, plan around what went wrong — a smaller slice, a different approach, or a prerequisite first. These are warnings from experience, not rules: a lesson describes one failed attempt, not a verdict that the work cannot be done.

${lessons}`;
}

function buildScoutPrompt(openIssues, vision) {
  const issuesSection = `Pick exactly ONE of the open tickets below to work on, and plan its implementation. The list is already in the order we want them built — prefer the first unless it is genuinely unworkable. Choose by priority: a \`priority:high\` label beats \`priority:medium\` beats \`priority:low\` beats unlabeled, EXCEPT that a ticket with an \`unblocks\` field counts as the highest priority among the tickets it unblocks — a blocker is worth what waits on it. Break ties by what most moves the project forward. Do NOT invent work outside these tickets.

## Open Tickets (each includes its labels — priority is one of them)
${JSON.stringify(openIssues, null, 2)}`;

  return fillTemplate(loadPrompt("scout"), {
    ISSUES_SECTION: issuesSection,
    LESSONS_SECTION: buildLessonsSection(),
    VISION: vision,
  });
}

function buildBuilderPrompt(proposal, reviewerFeedback, issue) {
  let issueContext = "";
  if (issue) {
    const body = issue.body ? `\n\n### Issue Description\n${issue.body}` : "";
    issueContext = `## Issue Being Fixed
You are fixing issue #${issue.number}: "${issue.title}". Your commit message MUST reference this issue (e.g., "Fix layout overflow on mobile (closes #${issue.number})"). Make sure the specific symptom described below is actually resolved.${body}`;
  }

  const reviewerFeedbackSection = reviewerFeedback
    ? `## Reviewer Feedback (Issues to Fix)
The Reviewer found these problems (may include issues from previous runs):
${reviewerFeedback}

Fix ALL issues above. You may edit any file. Do not introduce new issues.`
    : "";

  return fillTemplate(loadPrompt("builder"), {
    ISSUE_CONTEXT: issueContext,
    REVIEWER_FEEDBACK: reviewerFeedbackSection,
    PROPOSAL: proposal,
  });
}

function buildMergeConflictPrompt(conflictedFiles, statusOutput, originalCommitMessage) {
  return fillTemplate(loadPrompt("merge-conflict"), {
    CONFLICTED_FILES: conflictedFiles.join("\n"),
    STATUS_OUTPUT: statusOutput,
    ORIGINAL_COMMIT_MESSAGE: originalCommitMessage,
  });
}

function buildReviewerPrompt(changeContext = "") {
  const section = changeContext
    ? `## Change Context\n${changeContext}`
    : "";
  return fillTemplate(loadPrompt("reviewer"), { CHANGE_CONTEXT: section });
}

/**
 * Write down why a ticket was abandoned, on the wiki's Lessons page, so the next
 * Scout to plan something similar starts from what was learned instead of
 * rediscovering it. Best-effort in every direction: a failed model call or an
 * unreachable wiki costs a warning, never the run — this records history, it
 * doesn't change what the Builder does next.
 */
async function writePostMortem(issue, reason) {
  if (!issue?.number) return;
  try {
    const raw = await withLogGroup("Post-mortem", () =>
      runAgent({
        label: "Post-mortem",
        systemPrompt: fillTemplate(loadPrompt("post-mortem"), {
          TICKET_TITLE: issue.title || `#${issue.number}`,
          TICKET_NUMBER: String(issue.number),
          TICKET_BODY: (issue.body || "(no description)").slice(0, 2000),
          FAILURE_REASONS: reason || "(no reason was recorded)",
        }),
        tools: [],
      })
    );
    const parsed = extractAgentResponse("Post-mortem", raw, { requireOutcome: false });
    const lesson = parsed?.data?.lesson;
    if (!lesson) {
      log("warn", `Post-mortem: no lesson produced for #${issue.number}.`);
      return;
    }
    appendLesson({
      title: `#${issue.number} ${issue.title || ""}`.trim(),
      body: `${lesson}\n\n_Parked after ${MAX_TICKET_ATTEMPTS} attempts._`,
    });
  } catch (e) {
    log("warn", `Post-mortem: could not record a lesson for #${issue.number}.`, errorData(e));
  }
}

// ---------------------------------------------------------------------------
// Branch cleanup
// ---------------------------------------------------------------------------

/**
 * Abandon a feature branch: return to main and delete the branch locally and
 * (if it was pushed) on origin. Best-effort — never throws.
 */
function cleanupBranch(branchName) {
  try {
    gitExec("checkout main");
    gitExec(`branch -D ${branchName}`);
    log("info", `Cleaned up local branch ${branchName}.`);
  } catch {
    // branch may not exist locally — fine
  }
  deleteRemoteBranch(branchName);
}

// ---------------------------------------------------------------------------
// Build a single ticket: Scout → Builder → review → merge.
//
// Returns { addressedIssue, addressedIssueObj, outcome, reason, ticketFault }:
//   outcome "merged"    — PR approved and merged.
//   outcome "abandoned" — a ticket was engaged but couldn't ship (ticketFault
//                         tells the caller whether to count it as a failure).
//   outcome "unlanded"  — approved and armed for auto-merge, but not landed by the
//                         time the run had to stop (no fault, no strike).
//   outcome "none"      — no ticket could even be planned (Scout produced nothing).
//
// One stage per step, each returning either a terminal result or null to continue.
// It used to be a single 364-line function: see runToMerge for the sequence.
// ---------------------------------------------------------------------------

/**
 * Run the planning agent, turning a thrown model failure into null instead of
 * an exception.
 *
 * Planning happens BEFORE buildTicket's live-state guard, so anything thrown
 * here escaped the function entirely and killed the whole run: on 2026-08-26 a
 * capped planning agent ended a four-ticket job as `failure`, losing every
 * ticket queued behind it. The build phase has always degraded gracefully; the
 * cheapest agent in the loop was the only one that could take the run down.
 *
 * Planning touches no branch, no PR and no card, so a failure here costs exactly
 * one ticket and nothing needs cleaning up.
 *
 * The account-wide daily quota is the one thing still rethrown: when it is spent
 * nothing else can run either, so the run should stop rather than march through
 * the remaining tickets failing each the same way.
 */
async function runPlanningAgent(label, opts) {
  try {
    return await withLogGroup(label, () => runAgent(opts));
  } catch (e) {
    if (isDailyQuotaExhausted(e)) throw e;
    log("error", `${label} failed — abandoning this ticket, not the run: ${e.message || e}`, errorData(e));
    return null;
  }
}

/** The shape every stage returns to end the ticket. */
const ticketResult = (ctx, outcome, extra = {}) => ({
  addressedIssue: ctx.issueNumber,
  addressedIssueObj: ctx.issueObj,
  outcome,
  ...extra,
});

/**
 * Give a ticket back after the planning phase failed. Nothing live has been
 * touched yet, so this only records the attempt — and records NO fault, because
 * a capped or unreachable model says nothing about whether the ticket is good.
 */
function planningFailure(ctx, stage) {
  const reason = `${stage} could not produce a usable answer (model capped or unavailable) — no work was started.`;
  if (ctx.issueNumber) recordTicket("failed", ctx.issueNumber, ctx.issueTitle, reason);
  return ticketResult(ctx, "abandoned", { reason, ticketFault: false });
}

/**
 * Everything one ticket accumulates as it moves through the stages below.
 *
 * The stages used to be one 360-line function with all of this in scope as local
 * `let`s, which is why the budget checks, the git plumbing and the review loop
 * could interleave: nothing stopped them. Passing an explicit context is what
 * makes each stage nameable and separately readable.
 */
function newTicketContext({ openIssues, vision, deadline }) {
  return {
    openIssues,
    vision,
    deadline,
    // The ticket being addressed, once the Scout has picked one.
    issueNumber: null,
    issueTitle: null,
    issueObj: null,
    // Live state: created by startBranch, torn down by abandonTicket.
    branchName: null,
    prNumber: null,
    // What the Builder produced, carried forward to the merge and the changelog.
    commitMessage: "Agent build",
    builderSummary: null,
    builderChangelogEntry: null,
    builderTechDebt: null,
    builderModel: null,
    builderEverSucceeded: false,
    // What the last cycle told the Builder to fix, if anything.
    reviewerFeedback: null,
    reviewerApproved: false,
  };
}

/**
 * Give the ticket back: close the PR if asked, delete the branch, return the card
 * to the backlog, record the failure. `fault: false` means the ticket itself is
 * fine and something else broke — the drain loop uses it to decide whether this
 * counts toward parking the ticket.
 */
function abandonTicket(ctx, reason, { closePr = false, fault = true } = {}) {
  log("warn", `Abandoning ticket: ${reason}`);
  if (closePr && ctx.prNumber) closePR(ctx.prNumber, reason);
  cleanupBranch(ctx.branchName);
  if (ctx.issueNumber) {
    moveCard(ctx.issueNumber, "Backlog"); // return to the backlog
    recordTicket("failed", ctx.issueNumber, ctx.issueTitle, reason);
  }
  return ticketResult(ctx, "abandoned", { reason, ticketFault: fault });
}

// Distinguishes "the model chain itself failed" from "the answer did not parse".
// Both are falsy answers from the Scout, and only the second is worth retrying.
const PLANNING_FAILED = Symbol("planning failed");

/**
 * Stage 1 — plan. Returns the Scout's parsed plan, `null` when its answer could
 * not be parsed (worth another attempt), or PLANNING_FAILED when the chain itself
 * failed (not worth another attempt: the same chain would fail the same way).
 */
async function planChange(ctx, attempt) {
  const scoutOutput = await runPlanningAgent(`Scout (attempt ${attempt})`, {
    label: "Scout",
    systemPrompt: buildScoutPrompt(ctx.openIssues, ctx.vision),
    tools: ["read", "bash"],
  });
  if (!scoutOutput) return PLANNING_FAILED;

  const scoutResult = extractAgentResponse("Scout", scoutOutput, {
    requiredDataFields: ["appConcept", "suggestion", "details", "files"],
  });
  if (!scoutResult) return null;
  return { output: scoutOutput, data: scoutResult.data };
}

/** Stage 2 — name the ticket this run is addressing, from the plan. */
function identifyTicket(ctx, plan) {
  if (!plan.data.issueNumber) return;
  ctx.issueNumber = plan.data.issueNumber;
  const issue = ctx.openIssues.find((i) => i.number === ctx.issueNumber);
  ctx.issueTitle = issue ? issue.title : plan.data.issueTitle || "Unknown issue";
  ctx.issueObj = issue || { number: ctx.issueNumber, title: ctx.issueTitle, body: "" };
  log("info", `Scout: addressing issue #${ctx.issueNumber} — ${ctx.issueTitle}`);
}

/**
 * Stage 3 — take out the live state. Everything after this point must end through
 * abandonTicket or a merge, or the branch and the board card are orphaned.
 */
function startBranch(ctx, plan) {
  ctx.branchName = createBranchName(ctx.issueNumber, ctx.issueTitle, plan.data.suggestion);
  createBranch(ctx.branchName);
  // Reflect "work started" on the Kanban board (best-effort).
  if (ctx.issueNumber) moveCard(ctx.issueNumber, "In progress");
}

/**
 * Stage 4 — build → verify → push → review, up to MAX_BUILDER_RETRIES times.
 *
 * Each attempt commits and pushes so the PR reflects the work and the Reviewer
 * sees a real diff. The card moves Todo → In progress → In review. Returns a
 * terminal result when the ticket cannot go on, or null when the branch is
 * approved and ready for the merge stages.
 */
async function runBuildReviewLoop(ctx, plan) {
  for (let attempt = 1; attempt <= MAX_BUILDER_RETRIES; attempt++) {
    // Never START a build we cannot afford to FINISH.
    //
    // A Builder session is the most expensive thing here (measured: 66 turns, 36
    // minutes) and it is worthless without the Reviewer that follows it. On #149
    // the Builder ran to completion, the Reviewer was then refused, and the whole
    // thing was thrown away — the run spent everything it had and shipped nothing.
    // Reserve enough for the finishing steps BEFORE the expensive one, so the
    // cheap tail can always run.
    //
    // A retry is additionally optional: stop and leave the previous attempt's PR
    // intact and reviewable rather than starting work that strands it.
    if (Date.now() + BUILD_TAIL_RESERVE_MS > ctx.deadline) {
      const reserve = Math.round(BUILD_TAIL_RESERVE_MS / 60000);
      log(
        "warn",
        attempt > 1
          ? `Under ${reserve}m of the run's time left — not starting build attempt ${attempt}. ` +
              `The PR stands as-is and the next run picks up the review.`
          : `Under ${reserve}m of the run's time left — not starting the Builder, which could not be ` +
              `reviewed or merged in what remains. Leaving #${ctx.issueNumber} for the next run.`
      );
      break;
    }
    log("info", `=== Build Attempt ${attempt}/${MAX_BUILDER_RETRIES} ===`);

    let builderOutput;
    try {
      builderOutput = await withLogGroup(`Builder (attempt ${attempt})`, () =>
        runAgent({
          label: "Builder",
          systemPrompt: buildBuilderPrompt(plan.output, ctx.reviewerFeedback, ctx.issueObj),
          tools: ["read", "bash", "edit", "write"],
          thinkingLevel: "medium",
        })
      );
    } catch (e) {
      // A capped session, or an exhausted account, is not transient: every
      // remaining attempt is guaranteed to fail the same way, and retrying just
      // spends the tail confirming it. Propagate instead.
      if (e.sessionCapped || isDailyQuotaExhausted(e)) throw e;
      // Transient model/provider errors (rate limit, upstream harmony-parse
      // glitch) — retry the next attempt rather than abandoning. Only a persistent
      // failure (all attempts) falls through to the checks after this loop.
      log("warn", `Builder model call failed (attempt ${attempt}/${MAX_BUILDER_RETRIES}) — retrying: ${e.message || e}`);
      continue;
    }

    const builderResult = extractAgentResponse("Builder", builderOutput, {
      requireOutcome: false,
      requiredDataFields: ["commitMessage"],
    });
    if (!builderResult) {
      log("warn", "Builder produced no valid response this attempt.");
      ctx.reviewerFeedback = "Your previous response could not be parsed. Re-implement and return the required JSON envelope.";
      continue;
    }
    ctx.builderEverSucceeded = true;
    ctx.builderModel = getLastModelUsed();
    if (builderResult.data.commitMessage) ctx.commitMessage = builderResult.data.commitMessage;
    if (builderResult.data.changelogEntry) ctx.builderChangelogEntry = builderResult.data.changelogEntry;
    if (builderResult.data.techDebt) ctx.builderTechDebt = builderResult.data.techDebt;
    if (builderResult.summary) ctx.builderSummary = builderResult.summary;
    log("info", `Builder: ${builderResult.summary}`);

    // Layered verify (syntax → lint → runtime) on the working tree BEFORE
    // committing. Failures go straight back to the Builder to fix — broken code
    // never reaches the PR or the merge.
    const verify = await withLogGroup("Verify", () => verifyBuild());
    if (!verify.ok) {
      log("warn", `Verify failed at the ${verify.layer} check — ${verify.errors.length} issue(s).`, { errors: verify.errors });
      ctx.reviewerFeedback = `Your change fails the automated ${verify.layer} check. Fix these specific problems, then return your result:\n- ${verify.errors.join("\n- ")}`;
      continue;
    }

    const pushed = pushAttempt(ctx);
    if (pushed) return pushed;

    const opened = openPullRequest(ctx);
    if (opened) return opened;

    const review = await reviewOpenPR(ctx, attempt);
    if (review.approved) {
      ctx.reviewerApproved = true;
      break;
    }
    ctx.reviewerFeedback = review.feedback;
  }

  // The Builder never returned a single usable response. That is an INFRASTRUCTURE
  // failure, not a bad ticket — no fault, no strike.
  //
  // The distinction matters most on the day the account runs out of money. Spend is
  // capped by the balance on the OpenRouter key, and if that refusal does not match
  // isDailyQuotaExhausted (pi does not attach an HTTP status to model-call errors,
  // so recognition rests on the provider's message text) then every attempt fails
  // as an ordinary transient error. Charged as a fault, two such runs park the
  // ticket at MAX_TICKET_ATTEMPTS and the Tech Lead writes a post-mortem blaming
  // work that was never attempted. Topping the balance back up would then leave the
  // best tickets on the board marked unbuildable.
  //
  // A ticket the Builder genuinely cannot build fails AFTER producing something —
  // a change that does not verify, or a review it cannot satisfy. Producing nothing
  // at all says something about the pipeline, never about the ticket.
  if (!ctx.builderEverSucceeded) {
    return abandonTicket(ctx, "Builder returned no usable response on any attempt.", { fault: false });
  }
  // It built something but never got as far as a PR — most often the run's clock
  // ran out between a failed verify and the next attempt. Also not the ticket's
  // fault: nothing about it was ever judged.
  if (!ctx.prNumber) {
    return abandonTicket(ctx, "Builder produced work but the run ended before it could be opened for review.", { fault: false });
  }
  // Not approved within the cap → revoke the PR, return the ticket to the backlog.
  if (!ctx.reviewerApproved) {
    return abandonTicket(
      ctx,
      `Closed automatically after ${MAX_BUILDER_RETRIES} review cycles without approval. Returning to the backlog for a fresh attempt.`,
      { closePr: true }
    );
  }
  return null;
}

/**
 * Commit and push this attempt's work. Returns a terminal result when the attempt
 * produced nothing to review, or null to carry on.
 */
function pushAttempt(ctx) {
  try {
    if (gitExec("status --porcelain")) {
      gitExec("add -A");
      gitExec(`commit -m "${ctx.commitMessage.replace(/"/g, '\\"')}"`);
      log("info", `Committed: ${ctx.commitMessage}`);
    }
    if (gitExec(`rev-list --count main..${ctx.branchName}`) === "0") {
      if (!ctx.prNumber) return abandonTicket(ctx, "Builder produced no changes.");
      log("warn", "No new changes this attempt; re-reviewing the existing PR.");
      return null;
    }
    gitExec(`push origin ${ctx.branchName}`);
    return null;
  } catch (e) {
    return abandonTicket(ctx, `Build pipeline error: ${e.message}`, { closePr: true, fault: false });
  }
}

/** Open the PR once, after the first push. Returns a terminal result or null. */
function openPullRequest(ctx) {
  if (ctx.prNumber) return null;
  const prBody = `${ctx.builderSummary || ctx.commitMessage}${ctx.issueNumber ? `\n\nRefs #${ctx.issueNumber}` : ""}`;
  ctx.prNumber = createPR(ctx.branchName, ctx.commitMessage, prBody);
  if (!ctx.prNumber) return abandonTicket(ctx, "Could not open PR.", { fault: false });
  if (ctx.issueNumber) moveCard(ctx.issueNumber, "In review");
  return null;
}

/** Review the open PR. Returns { approved, feedback }. */
async function reviewOpenPR(ctx, attempt) {
  const reviewContext = [
    ctx.builderSummary ? `The Builder reports: ${ctx.builderSummary}` : null,
    ctx.issueObj ? `This change should fix issue #${ctx.issueObj.number}: "${ctx.issueObj.title}".` : null,
    `This is PR #${ctx.prNumber} on branch ${ctx.branchName}.`,
  ].filter(Boolean).join("\n");

  // Review the work with a DIFFERENT model than wrote it, where the chain allows.
  // Builder and Reviewer used to come off the same chain, usually landing on the
  // same model, so the three review cycles bought three re-rolls of one opinion.
  // Falls back to the same model rather than skipping the review.
  const reviewerOutput = await withLogGroup(`Reviewer (attempt ${attempt})`, () =>
    runAgent({
      label: "Reviewer",
      systemPrompt: buildReviewerPrompt(reviewContext),
      tools: ["read", "bash"],
      avoidModel: ctx.builderModel,
    })
  );
  const reviewerResult = extractAgentResponse("Reviewer", reviewerOutput, {
    requiredDataFields: ["issues"],
  });
  if (!reviewerResult) {
    return { approved: false, feedback: "The Reviewer output could not be parsed. Check your work for obvious issues." };
  }
  if (reviewerResult.outcome === "approve") {
    log("info", "Reviewer: APPROVED");
    return { approved: true };
  }
  const issues = reviewerResult.data.issues;
  log("warn", `Reviewer: REVISE — ${issues ? issues.length : 0} issue(s)`, { issues });
  return { approved: false, feedback: issues ? issues.join("\n- ") : "Unknown issues found." };
}

/**
 * Stage 5 — bring the branch up to date with main so the PR is mergeable, asking
 * the Builder to resolve any conflict. Returns a terminal result or null.
 */
async function reconcileWithMain(ctx) {
  const mergeResult = mergeMainIntoBranch();
  if (mergeResult.clean) return null;

  log("warn", "Merge conflict with origin/main — sending to Builder for resolution.", {
    conflictedFiles: mergeResult.conflictedFiles,
  });
  const resolverOutput = await withLogGroup("Builder (conflict resolution)", () =>
    runAgent({
      label: "Builder",
      systemPrompt: buildMergeConflictPrompt(mergeResult.conflictedFiles, mergeResult.statusOutput, ctx.commitMessage),
      tools: ["read", "bash", "edit", "write"],
      thinkingLevel: "medium",
    })
  );
  extractAgentResponse("Builder", resolverOutput, { requireOutcome: false, requiredDataFields: ["resolvedFiles"] });

  if (gitExec("diff --name-only --diff-filter=U")) {
    abortMerge();
    return abandonTicket(ctx, "Unresolved merge conflicts with main.", { closePr: true });
  }
  try {
    const resolveMsg = ctx.issueNumber
      ? `Resolve merge conflicts with origin/main (refs #${ctx.issueNumber})`
      : "Resolve merge conflicts with origin/main";
    gitExec("add -A");
    gitExec(`commit -m "${resolveMsg}"`);
    gitExec(`push origin ${ctx.branchName}`);
    log("info", "Merge conflicts resolved and pushed.");
    return null;
  } catch (e) {
    abortMerge();
    return abandonTicket(ctx, `Conflict resolution failed: ${e.message}`, { closePr: true, fault: false });
  }
}

/**
 * Stage 6 — the final gate: the branch, now merged with the latest main, must
 * still pass verify. Returns a terminal result or null.
 */
async function verifyBeforeMerge(ctx) {
  const finalVerify = await withLogGroup("Verify (pre-merge)", () => verifyBuild());
  if (finalVerify.ok) return null;
  return abandonTicket(
    ctx,
    `Failed the ${finalVerify.layer} check after merging main:\n- ${finalVerify.errors.join("\n- ")}`,
    { closePr: true }
  );
}

/**
 * Stage 7 — approve (as the PAT user, a different identity than the bot author),
 * merge, then write down what shipped. Always returns a terminal result.
 */
async function landAndRecord(ctx) {
  let commitSha = null;
  try {
    commitSha = gitExec(`rev-parse ${ctx.branchName}`);
  } catch {
    // non-fatal — the closing comment just omits the SHA
  }
  approvePR(ctx.prNumber, "Approved by the Reviewer agent — all blocking issues resolved.");
  if (!(await mergePR(ctx.prNumber))) {
    // Auto-merge stays armed, so this usually lands on its own once the checks
    // finish — but not before this run would have branched the NEXT ticket from a
    // main that does not have it. So the run stops here rather than building on a
    // tree it cannot see. No strike: nothing about the ticket failed.
    log("error", "PR did not land in time — stopping the run so the next ticket does not branch from a main without it.");
    return ticketResult(ctx, "unlanded", {
      reason: "Approved and armed for auto-merge, but it had not landed when the run had to stop.",
      ticketFault: false,
    });
  }
  try { gitExec("checkout main"); } catch {}

  // Record the change in the canonical changelog (wiki). The code has already
  // merged, so a failure here cannot undo the feature — but it is reported as an
  // error, not swallowed: an unrecorded merge is a merge the Story and the digest
  // will never mention.
  const entry =
    ctx.builderChangelogEntry ||
    `${ctx.commitMessage}${ctx.issueNumber ? ` (closes #${ctx.issueNumber})` : ""}`;
  appendChangelogEntry(entry, `Changelog: ${ctx.commitMessage}`);

  fileTechDebt(ctx);

  // Close the issue with a meaningful summary, mark the card Done.
  if (ctx.issueNumber) {
    await closeIssue(ctx.issueNumber, {
      summary: ctx.builderSummary,
      commitMessage: ctx.commitMessage,
      commitSha,
    });
    moveCard(ctx.issueNumber, "Done");
    recordTicket("done", ctx.issueNumber, ctx.issueTitle);
  }

  log("info", "Pipeline complete — PR approved and merged.");
  return ticketResult(ctx, "merged");
}

/**
 * File any tech debt the Builder flagged as a new ticket the PM prioritizes — one
 * per run, deduped against the open tickets, left unprioritized.
 */
function fileTechDebt(ctx) {
  const debt = ctx.builderTechDebt;
  if (!debt || !debt.title || !debt.body) return;
  const duplicate = ctx.openIssues.some(
    (i) => (i.title || "").toLowerCase().trim() === debt.title.toLowerCase().trim()
  );
  if (duplicate) {
    log("info", `Tech debt: "${debt.title}" already tracked — skipping.`);
    return;
  }
  const number = createIssue(debt.title, debt.body, [TECH_DEBT_LABEL]);
  if (number) {
    moveCard(number, "Todo"); // PM assigns priority on its next run
    recordTicket("created", number, debt.title);
  }
}

/**
 * Everything from the branch onward, in order. Each stage returns a terminal
 * result or null to continue, so the sequence reads as the pipeline it is.
 *
 * The try/catch is the reason this is one function: an unhandled throw mid-build
 * would otherwise leave the branch pushed and the card stuck "In progress".
 */
async function runToMerge(ctx, plan) {
  try {
    const build = await runBuildReviewLoop(ctx, plan);
    if (build) return build;

    const reconciled = await reconcileWithMain(ctx);
    if (reconciled) return reconciled;

    const verified = await verifyBeforeMerge(ctx);
    if (verified) return verified;

    return await landAndRecord(ctx);
  } catch (buildError) {
    // Surface it loudly, then abandon so cleanup runs. Infra fault, not the
    // ticket's — don't count it toward blocking.
    log("error", `Unrecoverable error mid-build: ${buildError.message || buildError}`, errorData(buildError));
    return abandonTicket(ctx, `Aborted by an unexpected error (e.g. model rate limit): ${buildError.message || buildError}`, {
      closePr: true,
      fault: false,
    });
  }
}

async function buildTicket(openIssues, vision, deadline) {
  const ctx = newTicketContext({ openIssues, vision, deadline });

  for (let attempt = 1; attempt <= MAX_SCOUT_RETRIES; attempt++) {
    log("info", `=== Scout Attempt ${attempt}/${MAX_SCOUT_RETRIES} ===`);

    const plan = await planChange(ctx, attempt);
    if (plan === PLANNING_FAILED) {
      // The whole model chain failed or was capped. Retrying just spends the same
      // chain again, so give this ticket back and let the run continue.
      return planningFailure(ctx, "Scout");
    }
    if (!plan) continue; // unparseable answer — worth one more attempt

    identifyTicket(ctx, plan);
    startBranch(ctx, plan);
    return await runToMerge(ctx, plan);
  }

  // The Scout retries were exhausted without ever producing a usable plan.
  if (ctx.issueNumber) {
    return ticketResult(ctx, "abandoned", {
      reason: `The Scout could not produce a usable plan in ${MAX_SCOUT_RETRIES} attempts.`,
      ticketFault: true,
    });
  }
  return { addressedIssue: null, addressedIssueObj: null, outcome: "none" };
}

// ---------------------------------------------------------------------------
// Demand-driven refill — ask the PM to groom when the backlog runs low.
// ---------------------------------------------------------------------------

function maybeReplenishBacklog(mergedCount) {
  // Only kick the PM when we actually shipped something this run. A run that
  // merged nothing means the PM (which just triggered us) already had its turn
  // and produced no buildable work — kicking it again would spin a tight
  // builder⇄PM loop on an empty backlog. Real progress is the gate.
  if (mergedCount === 0) {
    log("info", "No tickets merged this run — not kicking the PM (avoids an empty-backlog loop).");
    return;
  }
  // Refill only when the backlog is genuinely EMPTY, not merely low. Kicking the
  // PM starts a whole second PM→Builder chain, and on the free tier a day only
  // affords about one: a "low" backlog still has work for tomorrow's run, so
  // spending today's remaining requests to top it up buys nothing. Empty is
  // different — without a refill tomorrow's run would have nothing to do at all.
  const open = fetchOpenIssues(100);
  const openNumbers = new Set(open.map((i) => i.number));
  const buildable = open.filter((i) => isBuildable(i, openNumbers)).length;
  if (buildable === 0) {
    log("info", "Backlog empty — asking the Product Manager to refill so the next run has work.");
    triggerWorkflow("product-manager.yml");
  } else {
    log("info", `Backlog has ${buildable} buildable ticket(s) — leaving the refill to the next daily run.`);
  }
}

// ---------------------------------------------------------------------------
// Main — drain the highest-priority tickets within a wall-clock budget.
// ---------------------------------------------------------------------------

async function main() {
  configureGitIdentity();

  // Product vision (from the wiki) grounds the Scout's plan and the Reviewer's
  // alignment check — they no longer read it from a repo file.
  const vision = readVision();

  const attempted = new Set(); // tickets engaged this run — never re-pick them
  const deadline = Date.now() + RUN_BUDGET_MS;
  let mergedCount = 0;
  const pinnedTicket = PINNED_TICKET;

  for (let n = 1; n <= MAX_TICKETS_PER_RUN; n++) {
    if (Date.now() > deadline) {
      log("info", `Time budget (${Math.round(RUN_BUDGET_MS / 60000)}m) reached — stopping after ${mergedCount} merge(s).`);
      break;
    }
    // The Builder works only on existing tickets it hasn't already tried this
    // run — never invents work. A ticket is available when it isn't parked AND
    // everything it declared "Blocked by:" has shipped, so foundations get built
    // before the work that stands on them. Re-read every pass: a merge this run
    // may have just released the next ticket.
    const open = fetchOpenIssues(100);
    const openNumbers = new Set(open.map((i) => i.number));
    const untried = open.filter((i) => !attempted.has(i.number));
    let candidates = untried.filter((i) => isBuildable(i, openNumbers));

    // Rank by what each ticket unblocks, not only by its own label, and say so in
    // the ticket itself. The Scout chooses from labels, so sorting alone would not
    // move it: #170 is priority:low and gates a chain of three priority:high
    // tickets, and on its label the Scout will reach past it every time.
    candidates = [...candidates]
      .map((issue) => {
        const unblocks = dependentsOf(issue, open);
        if (!unblocks.length) return issue;
        return {
          ...issue,
          unblocks: unblocks.map((d) => ({
            number: d.number,
            title: d.title,
            priority: (d.labels || [])
              .map((l) => l.name || l)
              .find((n) => n.startsWith("priority:")) || "unlabeled",
          })),
        };
      })
      .sort(
        (a, b) =>
          effectivePriorityRank(a, open) - effectivePriorityRank(b, open) ||
          a.number - b.number
      );

    // A pinned run sees only its own ticket, so a hand-started rebuild of one
    // ticket cannot drift onto whatever else the board is offering.
    if (pinnedTicket) {
      candidates = candidates.filter((i) => i.number === pinnedTicket);
      if (!candidates.length) {
        log("info", `Pinned ticket #${pinnedTicket} is no longer available (closed, parked, or newly blocked) — nothing to do.`);
        break;
      }
    }

    if (candidates.length === 0) {
      const waiting = untried
        .filter((i) => !isBlocked(i))
        .map((i) => `#${i.number} waits on ${unmetDependencies(i, openNumbers).map((d) => `#${d}`).join(", ")}`)
        .filter((s) => !s.endsWith("waits on "));
      if (waiting.length) {
        // Not idle — every remaining ticket is waiting on something. Say what, so
        // a stuck backlog is diagnosable instead of looking like an empty one.
        log("info", `Nothing available: ${waiting.join("; ")}.`);
      } else {
        log("info", n === 1
          ? "No buildable tickets — nothing to build. (The Product Manager grooms the backlog.)"
          : `Backlog drained this run — built ${mergedCount}.`);
      }
      break;
    }

    log("info", `=== Ticket ${n}/${MAX_TICKETS_PER_RUN} — ${candidates.length} buildable ticket(s) on the board ===`);
    const result = await buildTicket(candidates, vision, deadline);

    if (result.addressedIssue) attempted.add(result.addressedIssue);
    if (result.outcome === "merged") {
      mergedCount++;
      // Shipping a ticket is the only thing that releases work waiting on it, so
      // clear the `waiting` labels it just satisfied rather than leaving the board
      // claiming tickets are held back by something already merged.
      syncWaitingLabels(fetchOpenIssues(100));
    }
    if (result.outcome === "abandoned" && result.ticketFault) {
      // Cross-run failure accounting — parks a perpetually-failing ticket so it
      // stops monopolizing the Builder.
      const attempts = recordTicketFailure(result.addressedIssueObj, result.reason, MAX_TICKET_ATTEMPTS);
      // Parked for good: write down why, while the reason is still in hand. After
      // this run the logs are the only record, and nothing reads those.
      if (attempts >= MAX_TICKET_ATTEMPTS) {
        await writePostMortem(result.addressedIssueObj, result.reason);
      }
    }
    if (result.outcome === "unlanded") {
      log("info", `#${result.addressedIssue} is waiting on its checks — stopping so nothing branches from a main without it.`);
      break;
    }
    if (result.outcome === "none") {
      log("info", "No ticket could be planned this pass — stopping.");
      break;
    }
  }

  log(
    "info",
    `Run complete — ${mergedCount} ticket(s) merged.`
  );
  maybeReplenishBacklog(mergedCount);
  printRunSummary("Devs");
}

main().catch((err) => {
  log("error", `Pipeline failed: ${err.message || err}`);
  printRunSummary("Devs");
  process.exit(1);
});
