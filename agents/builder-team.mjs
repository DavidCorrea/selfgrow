import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  extractAgentResponse,
  gitExec,
  configureGitIdentity,
  createBranchName,
  createBranch,
  mergeMainIntoBranch,
  abortMerge,
  deleteRemoteBranch,
  loadOpenIssues,
  closeIssue,
  closeIssueAsInvalid,
  moveCard,
  createPR,
  approvePR,
  mergePR,
  closePR,
  appendChangelogEntry,
  publishWiki,
  runAgent,
} from "./shared.mjs";

const MAX_SCOUT_RETRIES = 3;
// Up to this many build → review cycles on a PR before we revoke (close) it.
const MAX_BUILDER_RETRIES = 5;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildScoutPrompt(feedback, openIssues) {
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
  });
}

function buildValidatorPrompt(scoutOutput) {
  return fillTemplate(loadPrompt("validator"), {
    SCOUT_OUTPUT: scoutOutput,
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
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  configureGitIdentity();

  const openIssues = await loadOpenIssues();

  // The Builder works only on existing tickets — never invents work. If the
  // backlog is empty, there's nothing to do; the Product Manager fills it.
  if (openIssues.length === 0) {
    log("info", "No open tickets — nothing to build. (The Product Manager grooms the backlog.)");
    printRunSummary("Builder Team");
    return;
  }
  log("info", `Found ${openIssues.length} open ticket(s). Picking the highest-priority one.`);

  let approved = false;
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
        systemPrompt: buildScoutPrompt(feedback, openIssues),
        tools: ["read", "bash"],
      })
    );
    const scoutResult = extractAgentResponse("Scout", scoutOutput, {
      requiredDataFields: ["appConcept", "suggestion", "details", "files"],
    });
    if (!scoutResult) continue;
    const { data: scoutData } = scoutResult;

    // If the Scout identified an invalid issue, label and skip
    if (scoutData.issueAction === "close-invalid" && scoutData.issueNumber) {
      log("info", `Scout: issue #${scoutData.issueNumber} is invalid/out of scope.`);
      await closeIssueAsInvalid(scoutData.issueNumber, scoutData.issueReason);
      printRunSummary("Builder Team");
      return;
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
        systemPrompt: buildValidatorPrompt(scoutOutput),
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
    if (addressedIssue) moveCard(addressedIssue, "In Progress");

    // 4. Build → open PR → review/address loop (capped at MAX_BUILDER_RETRIES).
    //    Each attempt commits + pushes so the PR reflects the work and the
    //    Reviewer sees a real diff. The card moves Todo → In Progress → In Review.
    approved = true;
    let reviewerFeedback = null;
    let commitMessage = "Agent build";
    let builderSummary = null;
    let builderChangelogEntry = null;
    let builderEverSucceeded = false;
    let reviewerApproved = false;
    let prNumber = null;
    let abandoned = false;

    const abandon = (reason, closePr) => {
      log("warn", `Abandoning ticket: ${reason}`);
      if (closePr && prNumber) closePR(prNumber, reason);
      cleanupBranch(branchName);
      if (addressedIssue) moveCard(addressedIssue, "Todo"); // return to the backlog
      abandoned = true;
    };

    for (let buildAttempt = 1; buildAttempt <= MAX_BUILDER_RETRIES; buildAttempt++) {
      log("info", `=== Build Attempt ${buildAttempt}/${MAX_BUILDER_RETRIES} ===`);

      const builderOutput = await withLogGroup(`Builder (attempt ${buildAttempt})`, () =>
        runAgent({
          label: "Builder",
          systemPrompt: buildBuilderPrompt(scoutOutput, reviewerFeedback, addressedIssueObj),
          tools: ["read", "bash", "edit", "write"],
          thinkingLevel: "medium",
        })
      );
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
      if (builderResult.summary) builderSummary = builderResult.summary;
      log("info", `Builder: ${builderResult.summary}`);

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
        abandon(`Build pipeline error: ${e.message}`, true);
        break;
      }

      // Open the PR once, after the first push (as the bot).
      if (!prNumber) {
        const prBody = `${builderSummary || commitMessage}${addressedIssue ? `\n\nRefs #${addressedIssue}` : ""}`;
        prNumber = createPR(branchName, commitMessage, prBody);
        if (!prNumber) {
          abandon("Could not open PR.", false);
          break;
        }
        if (addressedIssue) moveCard(addressedIssue, "In Review");
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

    if (abandoned) break;

    // 5. Builder never produced usable work / no PR — clean up.
    if (!builderEverSucceeded || !prNumber) {
      abandon("Builder failed on every attempt.", false);
      break;
    }

    // 6. Not approved within the cap → revoke the PR, return ticket to the backlog.
    if (!reviewerApproved) {
      abandon(
        `Closed automatically after ${MAX_BUILDER_RETRIES} review cycles without approval. Returning to the backlog for a fresh attempt.`,
        true
      );
      break;
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
        break;
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
        abandon(`Conflict resolution failed: ${e.message}`, true);
        break;
      }
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
      log("error", "PR merge failed — leaving PR open and card In Review for inspection.");
      break;
    }
    try { gitExec("checkout main"); } catch {}

    // 9. Record the change in the canonical changelog (wiki). Best-effort — the
    //    code has already merged, so a wiki hiccup can't undo the feature.
    const entry = builderChangelogEntry || `${commitMessage}${addressedIssue ? ` (closes #${addressedIssue})` : ""}`;
    if (appendChangelogEntry(entry)) {
      publishWiki(`Changelog: ${commitMessage}`);
    }

    // 10. Close the issue with a meaningful summary, mark the card Done.
    if (addressedIssue) {
      await closeIssue(addressedIssue, { summary: builderSummary, commitMessage, commitSha });
      moveCard(addressedIssue, "Done");
    }

    log("info", "Pipeline complete — PR approved and merged.");
    break;
  }

  if (!approved) {
    log("warn", "No proposal approved after retries.");
  }

  printRunSummary("Builder Team");
}

main().catch((err) => {
  log("error", `Pipeline failed: ${err.message || err}`);
  printRunSummary("Builder Team");
  process.exit(1);
});
