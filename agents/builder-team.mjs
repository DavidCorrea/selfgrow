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
  unmetDependencies,
  syncWaitingLabels,
  triggerWorkflow,
  readVision,
  readLessons,
  appendLesson,
  closeIssue,
  closeIssueAsInvalid,
  createIssue,
  TECH_DEBT_LABEL,
  moveCard,
  createPR,
  approvePR,
  mergePR,
  closePR,
  appendChangelogEntry,
  publishWiki,
  verifyBuild,
  runAgent,
  isRequestBudgetSpent,
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

// Drain several tickets per run (better runner utilization — one npm ci +
// Playwright install amortized over multiple builds) up to a wall-clock budget,
// kept under the job's 60-minute timeout.
// When TICKET_NUMBER is set, this run is one slot of a parallel build and owns
// exactly that ticket — the assignment was made once, up front, by plan-build.mjs.
// Draining more than its own ticket would collide with a sibling slot's work.
const ASSIGNED_TICKET = Number(process.env.TICKET_NUMBER || 0) || null;

const MAX_TICKETS_PER_RUN = ASSIGNED_TICKET
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
Tickets the Builder previously gave up on, newest first, and why. If your ticket resembles one of these, plan around what went wrong — a smaller slice, a different approach, or a prerequisite first. These are warnings from experience, not rules: a lesson describes one failed attempt, not a verdict that the work cannot be done.

${lessons}`;
}

function buildScoutPrompt(feedback, openIssues, vision) {
  const issuesSection = `Pick exactly ONE of the open tickets below to work on, and plan its implementation. Choose by priority: a \`priority:high\` label beats \`priority:medium\` beats \`priority:low\` beats unlabeled; break ties by what most moves the project forward. Do NOT invent work outside these tickets.

## Open Tickets (each includes its labels — priority is one of them)
${JSON.stringify(openIssues, null, 2)}`;

  const feedbackSection = feedback
    ? `## Feedback From Validator (Previous Attempt Was Rejected)
${feedback}`
    : "";

  return fillTemplate(loadPrompt("scout"), {
    ISSUES_SECTION: issuesSection,
    FEEDBACK_SECTION: feedbackSection,
    LESSONS_SECTION: buildLessonsSection(),
    VISION: vision,
  });
}

function buildValidatorPrompt(scoutOutput, vision) {
  return fillTemplate(loadPrompt("validator"), {
    SCOUT_OUTPUT: scoutOutput,
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
    publishWiki(`Record why #${issue.number} was abandoned`);
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
// Build a single ticket: Scout → Validator → Builder → review → merge.
//
// Returns { addressedIssue, addressedIssueObj, outcome, reason, ticketFault }:
//   outcome "merged"    — PR approved and merged.
//   outcome "invalid"   — Scout judged the ticket out of scope; it was closed.
//   outcome "abandoned" — a ticket was engaged but couldn't ship (ticketFault
//                         tells the caller whether to count it as a failure).
//   outcome "none"      — no ticket could even be planned (Scout produced nothing).
// ---------------------------------------------------------------------------

async function buildTicket(openIssues, vision) {
  let feedback = null;
  let addressedIssue = null;
  let addressedIssueTitle = null;
  let addressedIssueObj = null;

  for (let attempt = 1; attempt <= MAX_SCOUT_RETRIES; attempt++) {
    log("info", `=== Scout Attempt ${attempt}/${MAX_SCOUT_RETRIES} ===`);

    // 1. Scout
    const scoutOutput = await withLogGroup(`Scout (attempt ${attempt})`, () =>
      runAgent({
        label: "Scout",
        systemPrompt: buildScoutPrompt(feedback, openIssues, vision),
        tools: ["read", "bash"],
      })
    );
    const scoutResult = extractAgentResponse("Scout", scoutOutput, {
      requiredDataFields: ["appConcept", "suggestion", "details", "files"],
    });
    if (!scoutResult) continue;
    const { data: scoutData } = scoutResult;

    // If the Scout identified an invalid issue, label, close, and report it.
    if (scoutData.issueAction === "close-invalid" && scoutData.issueNumber) {
      log("info", `Scout: issue #${scoutData.issueNumber} is invalid/out of scope.`);
      await closeIssueAsInvalid(scoutData.issueNumber, scoutData.issueReason);
      const obj = openIssues.find((i) => i.number === scoutData.issueNumber);
      return { addressedIssue: scoutData.issueNumber, addressedIssueObj: obj, outcome: "invalid" };
    }

    // Track which issue we're addressing
    if (scoutData.issueNumber) {
      addressedIssue = scoutData.issueNumber;
      const issue = openIssues.find((i) => i.number === addressedIssue);
      addressedIssueTitle = issue ? issue.title : scoutData.issueTitle || "Unknown issue";
      addressedIssueObj = issue || { number: addressedIssue, title: addressedIssueTitle, body: "" };
      log("info", `Scout: addressing issue #${addressedIssue} — ${addressedIssueTitle}`);
    }

    // 2. Validator
    const validatorOutput = await withLogGroup("Validator", () =>
      runAgent({
        label: "Validator",
        systemPrompt: buildValidatorPrompt(scoutOutput, vision),
        tools: ["read", "bash"],
      })
    );
    const validatorResult = extractAgentResponse("Validator", validatorOutput, {
      requiredDataFields: ["reason"],
    });
    if (!validatorResult) continue;
    const { outcome, data: validatorData } = validatorResult;

    log("info", `Validator: ${outcome} — ${validatorData.reason || validatorResult.summary}`);

    if (outcome !== "approve") {
      feedback = validatorData.reason || validatorResult.summary;
      log("warn", `Validator rejected: ${feedback}`);
      continue;
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
        const reviewerOutput = await withLogGroup(`Reviewer (attempt ${buildAttempt})`, () =>
          runAgent({
            label: "Reviewer",
            systemPrompt: buildReviewerPrompt(reviewContext),
            tools: ["read", "bash"],
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
      if (!mergePR(prNumber)) {
        log("error", "PR merge failed — leaving PR open and card In review for inspection.");
        return { addressedIssue, addressedIssueObj, outcome: "abandoned", reason: "PR merge failed.", ticketFault: false };
      }
      try { gitExec("checkout main"); } catch {}

      // 9. Record the change in the canonical changelog (wiki). Best-effort — the
      //    code has already merged, so a wiki hiccup can't undo the feature.
      const entry = builderChangelogEntry || `${commitMessage}${addressedIssue ? ` (closes #${addressedIssue})` : ""}`;
      if (appendChangelogEntry(entry)) {
        publishWiki(`Changelog: ${commitMessage}`);
      }

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
      reason: feedback ? `No workable plan after ${MAX_SCOUT_RETRIES} attempts: ${feedback}` : "No workable plan produced.",
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

  // Product vision (from the wiki) grounds the Scout's plan and the Validator's
  // alignment check — they no longer read it from a repo file.
  const vision = readVision();

  const attempted = new Set(); // tickets engaged this run — never re-pick them
  const deadline = Date.now() + RUN_BUDGET_MS;
  let mergedCount = 0;

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

    // A parallel slot sees only its own ticket, so the Scout cannot wander onto
    // work a sibling slot is already building.
    if (ASSIGNED_TICKET) {
      candidates = candidates.filter((i) => i.number === ASSIGNED_TICKET);
      if (!candidates.length) {
        log("info", `Assigned ticket #${ASSIGNED_TICKET} is no longer available (closed, parked, or newly blocked) — nothing to do.`);
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
    if (result.outcome === "none") {
      log("info", "No ticket could be planned this pass — stopping.");
      break;
    }
  }

  log("info", `Run complete — ${mergedCount} ticket(s) merged.`);
  maybeReplenishBacklog(mergedCount);
  printRunSummary("Builder Team");
}

main().catch((err) => {
  log("error", `Pipeline failed: ${err.message || err}`);
  printRunSummary("Builder Team");
  process.exit(1);
});
