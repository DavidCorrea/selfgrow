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
  mergeBranchToMain,
  deleteRemoteBranch,
  loadOpenIssues,
  closeIssue,
  closeIssueAsInvalid,
  runAgent,
} from "./shared.mjs";

const MAX_SCOUT_RETRIES = 3;
const MAX_BUILDER_RETRIES = 3;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildScoutPrompt(feedback, openIssues) {
  const hasIssues = openIssues && openIssues.length > 0;
  const issuesSection = hasIssues
    ? `There are open GitHub issues that need attention. Evaluate them first — a real, fixable bug takes priority over new features. But you may also propose a new feature, a refactor, or a cleanup if no issue actionable.

## Open GitHub Issues
${JSON.stringify(openIssues, null, 2)}`
    : `Explore the codebase, changelog, and vision to understand where things stand. Then propose something that moves the project forward — a new feature, a refactor, a cleanup, or a content addition.`;

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
  const hasIssues = openIssues.length > 0;

  if (hasIssues) {
    log("info", `Found ${openIssues.length} open issue(s). Prioritizing fixes.`);
  } else {
    log("info", "No open issues. Proceeding with feature exploration.");
  }

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

    // 4. Builder <-> Reviewer loop (on the branch)
    approved = true;
    let reviewerFeedback = null;
    let commitMessage = "Agent build";
    let builderSummary = null;
    let builderSucceeded = false;
    let reviewerApproved = false;

    for (let buildAttempt = 1; buildAttempt <= MAX_BUILDER_RETRIES; buildAttempt++) {
      log("info", `=== Build Attempt ${buildAttempt}/${MAX_BUILDER_RETRIES} ===`);

      // Build
      const builderOutput = await withLogGroup(`Builder (attempt ${buildAttempt})`, () =>
        runAgent({
          label: "Builder",
          systemPrompt: buildBuilderPrompt(scoutOutput, reviewerFeedback, addressedIssueObj),
          tools: ["read", "bash", "edit", "write"],
          thinkingLevel: "medium",
        })
      );
      // Builder is a worker — parse JSON but don't require outcome
      const builderResult = extractAgentResponse("Builder", builderOutput, {
        requireOutcome: false,
        requiredDataFields: ["commitMessage"],
      });
      if (!builderResult) {
        log("warn", "Builder produced no valid response this attempt.");
        reviewerFeedback = "Your previous response could not be parsed. Re-implement and return the required JSON envelope.";
        continue;
      }
      builderSucceeded = true;
      if (builderResult.data.commitMessage) {
        commitMessage = builderResult.data.commitMessage;
      }
      // Keep the latest non-empty summary to explain the fix on the issue.
      if (builderResult.summary) {
        builderSummary = builderResult.summary;
      }
      log("info", `Builder: ${builderResult.summary}`);

      // Review
      const reviewContext = [
        builderSummary ? `The Builder reports: ${builderSummary}` : null,
        addressedIssueObj
          ? `This change should fix issue #${addressedIssueObj.number}: "${addressedIssueObj.title}".`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
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
      log("warn", `Reviewer: REVISE — ${issueCount} issue(s)`, {
        issues: reviewerResult.data.issues,
      });
      reviewerFeedback = reviewerResult.data.issues ? reviewerResult.data.issues.join("\n- ") : "Unknown issues found.";

      if (buildAttempt === MAX_BUILDER_RETRIES) {
        log("warn", "Max build retries reached without approval.");
      }
    }

    // If the Builder never produced a usable result, don't land anything.
    if (!builderSucceeded) {
      log("error", "Builder failed on every attempt — discarding branch.");
      cleanupBranch(branchName);
      break;
    }
    if (!reviewerApproved) {
      log("warn", "Landing un-approved work after exhausting review retries.");
    }

    // 5. Commit on the branch
    try {
      const status = gitExec("status --porcelain");
      if (status) {
        gitExec("add -A");
        gitExec(`commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
        log("info", `Committed branch: ${commitMessage}`);
      }
      // Nothing to commit and no new commits? Then the Builder made no changes.
      if (!status && gitExec(`rev-list --count main..${branchName}`) === "0") {
        log("warn", "Builder produced no changes — discarding branch.");
        cleanupBranch(branchName);
        break;
      }
      gitExec(`push origin ${branchName}`);
      log("info", `Pushed branch ${branchName}.`);
    } catch (e) {
      log("error", `Branch commit/push failed: ${e.message}`);
      cleanupBranch(branchName);
      break;
    }

    // 6. Merge main into branch to pick up any concurrent changes
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
      // Conflict resolver is a worker — parse JSON but don't require outcome
      extractAgentResponse("Builder", resolverOutput, {
        requireOutcome: false,
        requiredDataFields: ["resolvedFiles"],
      });

      const remaining = gitExec("diff --name-only --diff-filter=U");
      if (remaining) {
        log("error", "Builder could not resolve all merge conflicts — aborting merge.", {
          branch: branchName,
          remainingConflicts: remaining.split("\n"),
        });
        abortMerge();
        cleanupBranch(branchName);
        break;
      }

      // The pipeline owns the commit (the resolver only edits files).
      try {
        const resolveMsg = addressedIssue
          ? `Resolve merge conflicts with origin/main (refs #${addressedIssue})`
          : "Resolve merge conflicts with origin/main";
        gitExec("add -A");
        gitExec(`commit -m "${resolveMsg}"`);
        gitExec(`push origin ${branchName}`);
        log("info", "Merge conflicts resolved and pushed.");
      } catch (e) {
        log("error", `Failed to commit conflict resolution: ${e.message}`);
        abortMerge();
        cleanupBranch(branchName);
        break;
      }

      const postMergeOutput = await withLogGroup("Reviewer (post-merge)", () =>
        runAgent({
          label: "Reviewer",
          systemPrompt: buildReviewerPrompt(
            "This review is AFTER resolving merge conflicts with origin/main. Pay special attention to the merge: no leftover conflict markers, and both the incoming changes and this branch's work coexist correctly."
          ),
          tools: ["read", "bash"],
        })
      );
      const postMergeResult = extractAgentResponse("Reviewer", postMergeOutput, {
        requiredDataFields: ["issues"],
      });
      if (postMergeResult && postMergeResult.outcome !== "approve") {
        log("warn", "Post-merge review found issues. Landing as-is.", {
          issues: postMergeResult.data.issues,
        });
      }
    }

    // 7. Rebase onto latest main, fast-forward merge, push, and clean up
    try {
      mergeBranchToMain(branchName);
    } catch (e) {
      log("error", `Failed to merge ${branchName} into main: ${e.message}`);
      cleanupBranch(branchName);
      break;
    }

    // 8. Close the addressed issue with a meaningful summary of the fix
    if (addressedIssue) {
      let commitSha = null;
      try {
        commitSha = gitExec("rev-parse HEAD");
      } catch {
        // non-fatal — comment just omits the SHA
      }
      await closeIssue(addressedIssue, {
        summary: builderSummary,
        commitMessage,
        commitSha,
      });
    }

    log("info", "Pipeline complete.");
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
