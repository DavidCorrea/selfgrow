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
  isRequestBudgetLow,
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
  isRequestBudgetSpent,
  getLastModelUsed,
  initDailyLedger,
  MODEL_REQUEST_BUDGET,
} from "./shared.mjs";

const MAX_SCOUT_RETRIES = 2;
// Up to this many build → review cycles on a PR before we revoke (close) it.
// Kept modest because each cycle is several slow free-model calls + a verify;
// the job has a wall-clock budget.
const MAX_BUILDER_RETRIES = 3;

// Cross-run failures a single ticket may rack up before it's parked (blocked) so
// the Scout stops re-picking it every run. See recordTicketFailure in shared.
const MAX_TICKET_ATTEMPTS = Number(process.env.MAX_TICKET_ATTEMPTS || 2);

// Requests held back for the steps AFTER the Builder — Reviewer, and a possible
// address-feedback pass — so a completed build always gets the chance to become a
// merge. Too small and the run throws away finished work, as it did on #149; too
// large and it never starts anything. Sized from merged tickets, where a Reviewer
// ran 7-9 turns, so 40 covers the tail several times over against a 150 budget.
const BUILD_TAIL_RESERVE = Number(process.env.BUILD_TAIL_RESERVE || 40);

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
//   outcome "none"      — no ticket could even be planned (Scout produced nothing).
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

/**
 * Give a ticket back after the planning phase failed. Nothing live has been
 * touched yet, so this only records the attempt — and records NO fault, because
 * a capped or unreachable model says nothing about whether the ticket is good.
 */
function planningFailure(addressedIssue, addressedIssueObj, addressedIssueTitle, stage) {
  const reason = `${stage} could not produce a usable answer (model capped or unavailable) — no work was started.`;
  if (addressedIssue) recordTicket("failed", addressedIssue, addressedIssueTitle, reason);
  return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason, ticketFault: false };
}

async function buildTicket(openIssues, vision) {
  let addressedIssue = null;
  let addressedIssueTitle = null;
  let addressedIssueObj = null;

  for (let attempt = 1; attempt <= MAX_SCOUT_RETRIES; attempt++) {
    log("info", `=== Scout Attempt ${attempt}/${MAX_SCOUT_RETRIES} ===`);

    // 1. Scout
    const scoutOutput = await runPlanningAgent(`Scout (attempt ${attempt})`, {
      label: "Scout",
      systemPrompt: buildScoutPrompt(openIssues, vision),
      tools: ["read", "bash"],
    });
    if (!scoutOutput) {
      // The whole model chain failed or was capped. Retrying just spends the
      // same chain again, so give this ticket back and let the run continue.
      return planningFailure(addressedIssue, addressedIssueObj, addressedIssueTitle, "Scout");
    }
    const scoutResult = extractAgentResponse("Scout", scoutOutput, {
      requiredDataFields: ["appConcept", "suggestion", "details", "files"],
    });
    if (!scoutResult) continue;
    const { data: scoutData } = scoutResult;

    // Track which issue we're addressing
    if (scoutData.issueNumber) {
      addressedIssue = scoutData.issueNumber;
      const issue = openIssues.find((i) => i.number === addressedIssue);
      addressedIssueTitle = issue ? issue.title : scoutData.issueTitle || "Unknown issue";
      addressedIssueObj = issue || { number: addressedIssue, title: addressedIssueTitle, body: "" };
      log("info", `Scout: addressing issue #${addressedIssue} — ${addressedIssueTitle}`);
    }

    // 3. Create a feature branch
    const branchName = createBranchName(addressedIssue, addressedIssueTitle, scoutData.suggestion);
    createBranch(branchName);

    // Reflect "work started" on the Kanban board (best-effort).
    if (addressedIssue) moveCard(addressedIssue, "In progress");

    // 4. Build → open PR → review/address loop (capped at MAX_BUILDER_RETRIES).
    //    Each attempt commits + pushes so the PR reflects the work and the
    //    Reviewer sees a real diff. The card moves Todo → In progress → In review.
    let reviewerFeedback = null;
    let commitMessage = "Agent build";
    let builderSummary = null;
    let builderChangelogEntry = null;
    let builderTechDebt = null;
    let builderEverSucceeded = false;
    let reviewerApproved = false;
    let prNumber = null;

    // How this ticket ended up — set by abandon()/the merge path and returned to
    // the drain loop, which decides whether to count it as a failure.
    let outcomeKind = null; // "abandoned" | "merged"
    let outcomeReason = null;
    let ticketFault = true;

    const abandon = (reason, closePr, fault = true) => {
      log("warn", `Abandoning ticket: ${reason}`);
      if (closePr && prNumber) closePR(prNumber, reason);
      cleanupBranch(branchName);
      if (addressedIssue) {
        moveCard(addressedIssue, "Backlog"); // return to the backlog
        recordTicket("failed", addressedIssue, addressedIssueTitle, reason);
      }
      outcomeKind = "abandoned";
      outcomeReason = reason;
      ticketFault = fault;
    };

    // Everything from here on touches live state (the branch, the PR, the
    // board card). Any uncaught throw — most commonly a model call dying on
    // rate limits — must still abandon cleanly, or the branch and card are
    // orphaned. Route every such error through abandon().
    try {
      for (let buildAttempt = 1; buildAttempt <= MAX_BUILDER_RETRIES; buildAttempt++) {
        // Never START a build we cannot afford to FINISH.
        //
        // A Builder session is the most expensive thing here (measured: 66 turns,
        // 36 minutes) and it is worthless without the Reviewer that follows it. On
        // #149 the Builder ran to completion, the Reviewer was then refused on
        // budget, and the whole thing was thrown away — the run spent its entire
        // allowance and shipped nothing. Reserve enough for the finishing steps
        // BEFORE the expensive one, so the cheap tail can always run.
        //
        // A retry is additionally optional: stop and leave the previous attempt's
        // PR intact and reviewable rather than starting work that strands it.
        if (isRequestBudgetLow(BUILD_TAIL_RESERVE)) {
          log(
            "warn",
            buildAttempt > 1
              ? `Request budget nearly spent — not starting build attempt ${buildAttempt}. ` +
                  `The PR stands as-is and the next run picks up the review.`
              : `Request budget nearly spent — not starting the Builder, which could not be ` +
                  `reviewed or merged on what remains. Leaving #${addressedIssue} for the next run.`
          );
          break;
        }
        log("info", `=== Build Attempt ${buildAttempt}/${MAX_BUILDER_RETRIES} ===`);

        let builderOutput;
        try {
          builderOutput = await withLogGroup(`Builder (attempt ${buildAttempt})`, () =>
            runAgent({
              label: "Builder",
              systemPrompt: buildBuilderPrompt(scoutOutput, reviewerFeedback, addressedIssueObj),
              tools: ["read", "bash", "edit", "write"],
              thinkingLevel: "medium",
            })
          );
        } catch (e) {
          // Running out of budget, or out of daily quota, is not transient: every
          // remaining attempt is guaranteed to fail the same way, and retrying
          // just spends the reserve confirming it. Propagate instead.
          if (e.budgetExhausted || isDailyQuotaExhausted(e)) throw e;
          // Transient model/provider errors (rate limit, upstream harmony-parse
          // glitch) — retry the next attempt rather than abandoning. Only a
          // persistent failure (all attempts) falls through to abandon below.
          log("warn", `Builder model call failed (attempt ${buildAttempt}/${MAX_BUILDER_RETRIES}) — retrying: ${e.message || e}`);
          continue;
        }
        const builderResult = extractAgentResponse("Builder", builderOutput, {
          requireOutcome: false,
          requiredDataFields: ["commitMessage"],
        });
        if (!builderResult) {
          log("warn", "Builder produced no valid response this attempt.");
          reviewerFeedback = "Your previous response could not be parsed. Re-implement and return the required JSON envelope.";
          continue;
        }
        builderEverSucceeded = true;
        const builderModel = getLastModelUsed();
        if (builderResult.data.commitMessage) commitMessage = builderResult.data.commitMessage;
        if (builderResult.data.changelogEntry) builderChangelogEntry = builderResult.data.changelogEntry;
        if (builderResult.data.techDebt) builderTechDebt = builderResult.data.techDebt;
        if (builderResult.summary) builderSummary = builderResult.summary;
        log("info", `Builder: ${builderResult.summary}`);

        // Layered verify (syntax → lint → runtime) on the working tree BEFORE
        // committing. Failures go straight back to the Builder to fix — broken
        // code never reaches the PR or the merge.
        const verify = await withLogGroup("Verify", () => verifyBuild());
        if (!verify.ok) {
          log("warn", `Verify failed at the ${verify.layer} check — ${verify.errors.length} issue(s).`, { errors: verify.errors });
          reviewerFeedback = `Your change fails the automated ${verify.layer} check. Fix these specific problems, then return your result:\n- ${verify.errors.join("\n- ")}`;
          continue;
        }

        // Commit + push this attempt's work.
        try {
          if (gitExec("status --porcelain")) {
            gitExec("add -A");
            gitExec(`commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
            log("info", `Committed: ${commitMessage}`);
          }
          if (gitExec(`rev-list --count main..${branchName}`) === "0") {
            if (!prNumber) {
              abandon("Builder produced no changes.", false);
              break;
            }
            log("warn", "No new changes this attempt; re-reviewing the existing PR.");
          } else {
            gitExec(`push origin ${branchName}`);
          }
        } catch (e) {
          abandon(`Build pipeline error: ${e.message}`, true, false);
          break;
        }

        // Open the PR once, after the first push (as the bot).
        if (!prNumber) {
          const prBody = `${builderSummary || commitMessage}${addressedIssue ? `\n\nRefs #${addressedIssue}` : ""}`;
          prNumber = createPR(branchName, commitMessage, prBody);
          if (!prNumber) {
            abandon("Could not open PR.", false, false);
            break;
          }
          if (addressedIssue) moveCard(addressedIssue, "In review");
        }

        // Review the open PR.
        const reviewContext = [
          builderSummary ? `The Builder reports: ${builderSummary}` : null,
          addressedIssueObj ? `This change should fix issue #${addressedIssueObj.number}: "${addressedIssueObj.title}".` : null,
          `This is PR #${prNumber} on branch ${branchName}.`,
        ].filter(Boolean).join("\n");
        // Review the work with a DIFFERENT model than wrote it, where the chain
        // allows. Builder and Reviewer used to come off the same chain, usually
        // landing on the same model, so the three review cycles below bought three
        // re-rolls of one opinion. Falls back to the same model rather than
        // skipping the review.
        const reviewerOutput = await withLogGroup(`Reviewer (attempt ${buildAttempt})`, () =>
          runAgent({
            label: "Reviewer",
            systemPrompt: buildReviewerPrompt(reviewContext),
            tools: ["read", "bash"],
            avoidModel: builderModel,
          })
        );
        const reviewerResult = extractAgentResponse("Reviewer", reviewerOutput, {
          requiredDataFields: ["issues"],
        });
        if (!reviewerResult) {
          reviewerFeedback = "The Reviewer output could not be parsed. Check your work for obvious issues.";
          continue;
        }
        if (reviewerResult.outcome === "approve") {
          log("info", "Reviewer: APPROVED");
          reviewerApproved = true;
          break;
        }
        const issueCount = reviewerResult.data.issues ? reviewerResult.data.issues.length : 0;
        log("warn", `Reviewer: REVISE — ${issueCount} issue(s)`, { issues: reviewerResult.data.issues });
        reviewerFeedback = reviewerResult.data.issues ? reviewerResult.data.issues.join("\n- ") : "Unknown issues found.";
      }

      if (outcomeKind === "abandoned") {
        return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
      }

      // 5. Builder never produced usable work / no PR — clean up.
      if (!builderEverSucceeded || !prNumber) {
        abandon("Builder failed on every attempt.", false);
        return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
      }

      // 6. Not approved within the cap → revoke the PR, return ticket to the backlog.
      if (!reviewerApproved) {
        abandon(
          `Closed automatically after ${MAX_BUILDER_RETRIES} review cycles without approval. Returning to the backlog for a fresh attempt.`,
          true
        );
        return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
      }

      // 7. Bring the branch up to date with main so the PR is mergeable.
      const mergeResult = mergeMainIntoBranch();
      if (!mergeResult.clean) {
        log("warn", "Merge conflict with origin/main — sending to Builder for resolution.", {
          conflictedFiles: mergeResult.conflictedFiles,
        });
        const conflictPrompt = buildMergeConflictPrompt(mergeResult.conflictedFiles, mergeResult.statusOutput, commitMessage);
        const resolverOutput = await withLogGroup("Builder (conflict resolution)", () =>
          runAgent({
            label: "Builder",
            systemPrompt: conflictPrompt,
            tools: ["read", "bash", "edit", "write"],
            thinkingLevel: "medium",
          })
        );
        extractAgentResponse("Builder", resolverOutput, { requireOutcome: false, requiredDataFields: ["resolvedFiles"] });

        if (gitExec("diff --name-only --diff-filter=U")) {
          abortMerge();
          abandon("Unresolved merge conflicts with main.", true);
          return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
        }
        try {
          const resolveMsg = addressedIssue
            ? `Resolve merge conflicts with origin/main (refs #${addressedIssue})`
            : "Resolve merge conflicts with origin/main";
          gitExec("add -A");
          gitExec(`commit -m "${resolveMsg}"`);
          gitExec(`push origin ${branchName}`);
          log("info", "Merge conflicts resolved and pushed.");
        } catch (e) {
          abortMerge();
          abandon(`Conflict resolution failed: ${e.message}`, true, false);
          return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
        }
      }

      // Final gate: the branch (now merged with latest main) must still pass verify.
      const finalVerify = await withLogGroup("Verify (pre-merge)", () => verifyBuild());
      if (!finalVerify.ok) {
        abandon(`Failed the ${finalVerify.layer} check after merging main:\n- ${finalVerify.errors.join("\n- ")}`, true);
        return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
      }

      // 8. Approve (as the PAT user — a different identity than the bot author) and merge.
      let commitSha = null;
      try {
        commitSha = gitExec(`rev-parse ${branchName}`);
      } catch {
        // non-fatal — comment just omits the SHA
      }
      approvePR(prNumber, "Approved by the Reviewer agent — all blocking issues resolved.");
      if (!(await mergePR(prNumber))) {
        // Auto-merge stays armed, so this usually lands on its own once the
        // checks finish — but not before this run would have branched the NEXT
        // ticket from a main that does not have it. So the run stops here rather
        // than building on a tree it cannot see. No strike: nothing about the
        // ticket failed.
        log("error", "PR did not land in time — stopping the run so the next ticket does not branch from a main without it.");
        return {
          addressedIssue,
          addressedIssueObj,
          outcome: "unlanded",
          reason: "Approved and armed for auto-merge, but it had not landed when the run had to stop.",
          ticketFault: false,
        };
      }
      try { gitExec("checkout main"); } catch {}

      // 9. Record the change in the canonical changelog (wiki). The code has
      //    already merged, so a failure here cannot undo the feature — but it is
      //    reported as an error, not swallowed: an unrecorded merge is a merge
      //    the Scribe and the digest will never mention.
      const entry = builderChangelogEntry || `${commitMessage}${addressedIssue ? ` (closes #${addressedIssue})` : ""}`;
      appendChangelogEntry(entry, `Changelog: ${commitMessage}`);

      // 10. File any tech debt the Builder flagged → a new ticket the PM prioritizes
      //     (one per run, deduped against current open tickets, left unprioritized).
      if (builderTechDebt && builderTechDebt.title && builderTechDebt.body) {
        const td = builderTechDebt;
        const dup = openIssues.some(
          (i) => (i.title || "").toLowerCase().trim() === td.title.toLowerCase().trim()
        );
        if (dup) {
          log("info", `Tech debt: "${td.title}" already tracked — skipping.`);
        } else {
          const n = createIssue(td.title, td.body, [TECH_DEBT_LABEL]);
          if (n) {
            moveCard(n, "Todo"); // PM assigns priority on its next run
            recordTicket("created", n, td.title);
          }
        }
      }

      // 11. Close the issue with a meaningful summary, mark the card Done.
      if (addressedIssue) {
        await closeIssue(addressedIssue, { summary: builderSummary, commitMessage, commitSha });
        moveCard(addressedIssue, "Done");
        recordTicket("done", addressedIssue, addressedIssueTitle);
      }

      log("info", "Pipeline complete — PR approved and merged.");
      return { addressedIssue, addressedIssueObj, outcome: "merged" };
    } catch (buildError) {
      // An unhandled throw mid-build (e.g. the model stopped responding on rate
      // limits) would otherwise leave the branch pushed and the card stuck "In
      // progress". Surface it loudly, then abandon so cleanup runs. Infra fault,
      // not the ticket's — don't count it toward blocking.
      log("error", `Unrecoverable error mid-build: ${buildError.message || buildError}`, errorData(buildError));
      abandon(`Aborted by an unexpected error (e.g. model rate limit): ${buildError.message || buildError}`, true, false);
      return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: outcomeReason, ticketFault };
    }
  }

  // The Scout retries were exhausted without ever approving a plan.
  if (addressedIssue) {
    return {
      addressedIssue,
      addressedIssueObj,
      outcome: "abandoned",
      reason: `The Scout could not produce a usable plan in ${MAX_SCOUT_RETRIES} attempts.`,
      ticketFault: true,
    };
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

  // Open the shared ledger before the first budget check rather than lazily on the
  // first model call: the loop below asks whether the day can afford another
  // ticket, and on ticket 1 that question would otherwise be answered from an
  // empty count — reading as "the whole day is free" on a day already spent.
  initDailyLedger();

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
    // Checked between tickets, never mid-ticket — stopping inside buildTicket
    // would strand a half-reviewed PR.
    if (isRequestBudgetSpent()) {
      log("info", `Model-request budget (${MODEL_REQUEST_BUDGET}) spent — stopping after ${mergedCount} merge(s) to leave requests for later runs.`);
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
    const result = await buildTicket(candidates, vision);

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
