import {
  __dirname,
  repoRoot,
  log,
  ghAnnotation,
  printRunSummary,
  errorData,
  loadPrompt,
  fillTemplate,
  extractAgentResponse,
  gitExec,
  createBranchName,
  createBranch,
  mergeMainIntoBranch,
  abortMerge,
  mergeBranchToMain,
  loadOpenIssues,
  closeIssue,
  labelIssue,
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

function buildBuilderPrompt(validatorOutput, reviewerFeedback, issueNumber, issueTitle) {
  const issueContext = issueNumber
    ? `You are fixing issue #${issueNumber}: "${issueTitle}". Your commit message MUST reference this issue (e.g., "Fix layout overflow on mobile (closes #${issueNumber})").`
    : "";

  const reviewerFeedbackSection = reviewerFeedback
    ? `## Reviewer Feedback (Issues to Fix)
The Reviewer found these problems (may include issues from previous runs):
${reviewerFeedback}

Fix ALL issues above. You may edit any file. Do not introduce new issues.`
    : "";

  return fillTemplate(loadPrompt("builder"), {
    ISSUE_CONTEXT: issueContext,
    REVIEWER_FEEDBACK: reviewerFeedbackSection,
    VALIDATOR_OUTPUT: validatorOutput,
  });
}

function buildMergeConflictPrompt(conflictedFiles, statusOutput, originalCommitMessage) {
  return fillTemplate(loadPrompt("merge-conflict"), {
    CONFLICTED_FILES: conflictedFiles.join("\n"),
    STATUS_OUTPUT: statusOutput,
    ORIGINAL_COMMIT_MESSAGE: originalCommitMessage,
  });
}

function buildReviewerPrompt() {
  return loadPrompt("reviewer");
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
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

  for (let attempt = 1; attempt <= MAX_SCOUT_RETRIES; attempt++) {
    log("info", `--- Scout Attempt ${attempt} ---`);

    // 1. Scout
    const scoutOutput = await runAgent({
      label: "Scout",
      systemPrompt: buildScoutPrompt(feedback, openIssues),
      tools: ["read", "bash"],
    });
    const scoutResult = extractAgentResponse("Scout", scoutOutput);
    if (!scoutResult) continue;
    const { data: scoutData } = scoutResult;

    // If the Scout identified an invalid issue, label and skip
    if (scoutData.issueAction === "close-invalid" && scoutData.issueNumber) {
      log("info", `Scout: issue #${scoutData.issueNumber} is invalid/out of scope.`);
      await labelIssue(scoutData.issueNumber, "invalid");
      try {
        execSync(
          `gh issue comment ${scoutData.issueNumber} --body "Reviewed by the Builder Team — this issue is not actionable or is out of scope for the current vision of the project."`,
          { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
        );
        execSync(
          `gh issue close ${scoutData.issueNumber}`,
          { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
        );
        log("info", `Closed issue #${scoutData.issueNumber} as invalid.`);
      } catch (e) {
        log("warn", "Could not close issue", errorData(e));
      }
      printRunSummary();
      return;
    }

    // Track which issue we're addressing
    if (scoutData.issueNumber) {
      addressedIssue = scoutData.issueNumber;
      const issue = openIssues.find((i) => i.number === addressedIssue);
      addressedIssueTitle = issue ? issue.title : scoutData.issueTitle || "Unknown issue";
      log("info", `Scout: addressing issue #${addressedIssue} — ${addressedIssueTitle}`);
    }

    // 2. Validator
    const validatorOutput = await runAgent({
      label: "Validator",
      systemPrompt: buildValidatorPrompt(scoutOutput),
      tools: ["read", "bash"],
    });
    const validatorResult = extractAgentResponse("Validator", validatorOutput);
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

    for (let buildAttempt = 1; buildAttempt <= MAX_BUILDER_RETRIES; buildAttempt++) {
      log("info", `--- Build Attempt ${buildAttempt} ---`);

      // Build
      const builderOutput = await runAgent({
        label: "Builder",
        systemPrompt: buildBuilderPrompt(validatorOutput, reviewerFeedback, addressedIssue, addressedIssueTitle),
        tools: ["read", "bash", "edit", "write"],
      });
      // Builder is a worker — parse JSON but don't require outcome
      const builderResult = extractAgentResponse("Builder", builderOutput, { requireOutcome: false });
      if (builderResult && builderResult.data.commitMessage) {
        commitMessage = builderResult.data.commitMessage;
        log("info", `Builder summary: ${builderResult.summary}`);
      }

      // Review
      const reviewerOutput = await runAgent({
        label: "Reviewer",
        systemPrompt: buildReviewerPrompt(),
        tools: ["read", "bash"],
      });
      const reviewerResult = extractAgentResponse("Reviewer", reviewerOutput);
      if (!reviewerResult) {
        reviewerFeedback = "The Reviewer output could not be parsed. Check your your work for obvious issues.";
        continue;
      }

      if (reviewerResult.outcome === "approve") {
        log("info", "Reviewer: APPROVED");
        break;
      }

      const issueCount = reviewerResult.data.issues ? reviewerResult.data.issues.length : 0;
      log("warn", `Reviewer: REVISE — ${issueCount} issue(s)`, {
        issues: reviewerResult.data.issues,
      });
      reviewerFeedback = reviewerResult.data.issues ? reviewerResult.data.issues.join("\n- ") : "Unknown issues found.";

      if (buildAttempt === MAX_BUILDER_RETRIES) {
        log("warn", "Max build retries reached. Committing as-is.");
      }
    }

    // 5. Commit on the branch
    try {
      const status = gitExec("status --porcelain");
      if (status) {
        gitExec('config user.name "github-actions[bot]"');
        gitExec('config user.email "github-actions[bot]@users.noreply.github.com"');
        gitExec("add -A");
        gitExec(`commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
        gitExec(`push origin ${branchName}`);
        log("info", `Committed and pushed branch: ${commitMessage}`);
      } else {
        gitExec(`push origin ${branchName}`);
        log("info", "Pushed existing commits on branch.");
      }
    } catch (e) {
      log("error", "Branch commit/push failed", errorData(e));
      ghAnnotation("error", `Branch commit/push failed: ${e.message}`);
      break;
    }

    // 6. Merge main into branch to pick up any concurrent changes
    const mergeResult = mergeMainIntoBranch();
    if (!mergeResult.clean) {
      log("info", "Sending merge conflicts to Builder for resolution.");
      const conflictPrompt = buildMergeConflictPrompt(mergeResult.conflictedFiles, mergeResult.statusOutput, commitMessage);
      const resolverOutput = await runAgent({
        label: "Builder",
        systemPrompt: conflictPrompt,
        tools: ["read", "bash", "edit", "write"],
      });
      // Conflict resolver is a worker — parse JSON but don't require outcome
      extractAgentResponse("Builder", resolverOutput, { requireOutcome: false });

      const remaining = gitExec("diff --name-only --diff-filter=U");
      if (remaining) {
        log("error", "Builder could not resolve all merge conflicts. Aborting.", {
          remainingConflicts: remaining.split("\n"),
        });
        ghAnnotation("error", `Merge conflicts could not be resolved automatically. Branch: ${branchName}`);
        abortMerge();
        break;
      }

      gitExec("add -A");
      gitExec(`commit -m "Resolve merge conflicts with origin/main (closes #${addressedIssue || "n/a"})"`);
      gitExec(`push origin ${branchName}`);
      log("info", "Merge conflicts resolved and pushed.");

      const postMergeOutput = await runAgent({
        label: "Reviewer",
        systemPrompt: buildReviewerPrompt(),
        tools: ["read", "bash"],
      });
      const postMergeResult = extractAgentResponse("Reviewer", postMergeOutput);
      if (postMergeResult && postMergeResult.outcome !== "approve") {
        log("warn", "Post-merge review found issues. Committing as-is.", {
          issues: postMergeResult.data.issues,
        });
      }
    }

    // 7. Fast-forward merge into main, push, and clean up
    try {
      mergeBranchToMain(branchName);
    } catch (e) {
      log("error", "Failed to merge branch into main", errorData(e));
      ghAnnotation("error", `Failed to merge ${branchName} into main: ${e.message}`);
      break;
    }

    // 8. Close the addressed issue
    if (addressedIssue) {
      await closeIssue(addressedIssue, commitMessage);
    }

    log("info", "Pipeline complete.");
    break;
  }

  if (!approved) {
    log("warn", "No proposal approved after retries. Exiting.");
    ghAnnotation("warning", "No proposal approved after retries.");
  }

  printRunSummary();
}

main().catch((err) => {
  log("error", "Pipeline failed", errorData(err));
  ghAnnotation("error", `Pipeline failed: ${err.message || err}`);
  printRunSummary();
  process.exit(1);
});
