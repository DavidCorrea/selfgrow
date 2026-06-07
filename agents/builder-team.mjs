import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const MAX_SCOUT_RETRIES = 3;
const MAX_BUILDER_RETRIES = 3;
const RAW_OUTPUT_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// Structured logger
// ---------------------------------------------------------------------------

const runLog = [];

function log(level, message, data) {
  const entry = { time: new Date().toISOString(), level, message, data };
  runLog.push(entry);
  const prefix = `[${entry.time}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(prefix, message);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, message);
  }
}

function ghAnnotation(kind, message) {
  const level = kind === "error" ? "error" : "warning";
  console.log(`::${level}::${message}`);
}

function truncate(str, max = RAW_OUTPUT_MAX_CHARS) {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... [truncated, ${str.length} total chars]`;
}

function printRunSummary() {
  console.log("\n" + "=".repeat(60));
  console.log("RUN SUMMARY");
  console.log("=".repeat(60));
  for (const entry of runLog) {
    const icon =
      entry.level === "error" ? "❌" :
      entry.level === "warn"  ? "⚠️" :
      entry.level === "info"  ? "ℹ️" : "  ";
    console.log(`${icon} [${entry.level.toUpperCase()}] ${entry.message}`);
  }
  console.log("=".repeat(60) + "\n");
}

// ---------------------------------------------------------------------------
// Shared constraints (used by all agents)
// ---------------------------------------------------------------------------

const SHARED_CONSTRAINTS = [
  "Self-contained only — no external services, APIs, or third-party integrations.",
  "Use fake/hardcoded data where needed.",
  "Responsive: relative units (rem, em, %, vw/vh) and media queries. Test mentally at 375px, 768px, 1200px+.",
  "Accessible: keyboard navigable, ARIA labels, reduced-motion support.",
  "CSS-only animations where possible (GPU-friendly).",
  "Dark, nature-inspired palette with soft glows.",
  "Every feature must feel organic — nothing jarring or mechanical.",
].join("\n");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runAgent({ label, systemPrompt, tools }) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.getAll().find(
    (m) => m.provider === "openrouter" && m.id === "openrouter/owl-alpha"
  );

  const loader = new DefaultResourceLoader({ cwd: __dirname, agentDir: __dirname });
  const startTime = Date.now();
  log("info", `${label} agent started`);

  return loader.reload().then(() =>
    createAgentSession({
      cwd: repoRoot,
      sessionManager: SessionManager.inMemory(),
      resourceLoader: loader,
      model,
      authStorage,
      modelRegistry,
      tools,
    }).then(({ session }) => {
      let output = "";
      session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
        }
      });

      return session
        .prompt(systemPrompt)
        .then(() => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const messages = session.state.messages;
          const lastAssistant = [...messages].reverse().find(
            (m) => m.role === "assistant"
          );
          if (lastAssistant && lastAssistant.content) {
            const fullText = Array.isArray(lastAssistant.content)
              ? lastAssistant.content
                  .filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("")
              : lastAssistant.content;
            if (fullText) output = fullText;
          }
          log("info", `${label} agent completed in ${elapsed}s`);
          session.dispose();
          return output;
        })
        .catch((err) => {
          session.dispose();
          throw err;
        });
    })
  );
}

function extractJSON(label, text) {
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = blockMatch ? blockMatch[1].trim() : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        log("warn", `${label} output could not be parsed as JSON`, {
          rawOutput: truncate(text),
        });
        ghAnnotation("warning", `${label}: output could not be parsed as JSON`);
        return null;
      }
    }
    log("warn", `${label} output could not be parsed as JSON (no JSON object found)`, {
      rawOutput: truncate(text),
    });
    ghAnnotation("warning", `${label}: output could not be parsed as JSON`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Git branch helpers
// ---------------------------------------------------------------------------

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function createBranchName(issueNumber, issueTitle, suggestion) {
  if (issueNumber) {
    return `agent/issue-${issueNumber}-${slugify(issueTitle)}`;
  }
  return `agent/feature-${slugify(suggestion)}`;
}

function gitExec(args, opts = {}) {
  const cmd = "git " + args;
  return execSync(cmd, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024, ...opts }).toString().trim();
}

/**
 * Create and checkout a new branch from main.
 */
function createBranch(branchName) {
  try {
    gitExec("fetch origin");
    gitExec("checkout main");
    gitExec(`checkout -b ${branchName}`);
    log("info", `Created branch: ${branchName}`);
  } catch (e) {
    // Branch may already exist from a previous run — reset it to main
    log("warn", `Branch ${branchName} may already exist, resetting to main.`);
    gitExec("checkout main");
    gitExec(`branch -D ${branchName}`);
    gitExec(`checkout -b ${branchName}`);
    log("info", `Recreated branch: ${branchName}`);
  }
}

/**
 * Merge origin/main into the current branch. Returns { clean: true } on success,
 * or { clean: false, conflictedFiles, statusOutput } on conflict.
 */
function mergeMainIntoBranch() {
  try {
    gitExec("fetch origin");
    gitExec("merge origin/main --no-edit");
    log("info", "Merged origin/main into branch — clean.");
    return { clean: true };
  } catch (e) {
    const status = gitExec("status --porcelain");
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

/**
 * Abort a merge and return to the pre-merge state.
 */
function abortMerge() {
  try {
    gitExec("merge --abort");
    log("info", "Aborted merge.");
  } catch {
    // ignore — may not be in a merge
  }
}

/**
 * Fast-forward merge the branch into main, push, and delete the branch.
 */
function mergeBranchToMain(branchName) {
  gitExec("checkout main");
  gitExec(`merge --ff-only ${branchName}`);
  log("info", `Fast-forward merged ${branchName} into main.`);
  gitExec("push origin main");
  log("info", "Pushed main.");
  gitExec(`branch -d ${branchName}`);
  log("info", `Deleted local branch ${branchName}.`);
  try {
    gitExec(`push origin --delete ${branchName}`);
  } catch {
    // remote branch may not exist — fine
  }
}

// ---------------------------------------------------------------------------
// Issue helpers
// ---------------------------------------------------------------------------

function loadOpenIssues() {
  try {
    const raw = fs.readFileSync("/tmp/open-issues.json", "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function closeIssue(issueNumber, commitMessage) {
  const comment = "Fixed in commit: " + commitMessage + "\n\nThis issue has been addressed by the Builder Team.";
  try {
    execSync(
      'gh issue comment ' + issueNumber + ' --body "' + comment.replace(/"/g, '\\"') + '"',
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    execSync(
      'gh issue close ' + issueNumber,
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    log("info", `Closed issue #${issueNumber}`);
  } catch (e) {
    log("warn", `Could not close issue #${issueNumber}`, errorData(e));
  }
}

async function labelIssue(issueNumber, label) {
  try {
    execSync(
      'gh issue edit ' + issueNumber + ' --add-label "' + label + '"',
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    log("info", `Labeled issue #${issueNumber} as "${label}"`);
  } catch (e) {
    log("warn", `Could not label issue #${issueNumber}`, errorData(e));
  }
}

// ---------------------------------------------------------------------------
// Agent prompts
// ---------------------------------------------------------------------------

function buildScoutPrompt(feedback, openIssues) {
  const hasIssues = openIssues && openIssues.length > 0;

  let prompt = "";

  if (hasIssues) {
    prompt +=
`You are the SCOUT. Your job is to assess the project and propose ONE change.

There are open GitHub issues that need attention. Evaluate them first — a real, fixable bug takes priority over new features. But you may also propose a new feature, a refactor, or a cleanup if no issue is actionable.

## Open GitHub Issues
${JSON.stringify(openIssues, null, 2)}
`;
  } else {
    prompt +=
`You are the SCOUT. Your job is to assess the project and propose ONE change.

Explore the codebase, changelog, and vision to understand where things stand. Then propose something that moves the project forward — a new feature, a refactor, a cleanup, or a content addition.
`;
  }

  if (feedback) {
    prompt += "\n## Feedback From Validator (Previous Attempt Was Rejected)\n" + feedback + "\n";
  }

  prompt +=
`
## Constraints
${SHARED_CONSTRAINTS}
- If fixing an issue, reference which issue number you are addressing.
- Refactors are valid: if code has gotten messy, duplicated, or hard to follow, propose cleaning it up.
- Cleanup is valid: orphaned elements, dead code, or visual inconsistencies from previous runs are fair game.

## Output

Respond with ONLY a valid JSON object:

{
  "appConcept": "If VISION.md exists paste its one-sentence concept here. If not, invent a one-sentence concept.",
  "suggestion": "One concise sentence describing the change.",
  "details": "A short paragraph explaining what to build and why.",
  "files": ["docs/index.html", "docs/styles.css"],
  "issueNumber": <number or null>,
  "issueAction": "fix, close-invalid, or null"
}
`;

  return prompt;
}

function buildValidatorPrompt(scoutOutput) {
  return (
`You are the VALIDATOR. Review the Scout's proposal below.

Assess whether the proposal is novel, feasible, and aligned with the project. Check the codebase and changelog to verify it doesn't already exist or contradict the vision.

## Decision Criteria
- REJECT if the exact idea already exists.
- REJECT if the appConcept is incoherent or empty.
- REJECT if the proposal requires external services or APIs.
- REJECT if the issueAction is "close-invalid" — invalid issues should just be labeled, not built.
- APPROVE otherwise — be loose and permissive.

## SCOUT OUTPUT
${scoutOutput}

## Output

Respond with ONLY a valid JSON object:

{
  "decision": "APPROVED or REJECTED",
  "reason": "One sentence explaining your decision.",
  "scoutOutput": <the full Scout output object above, verbatim>
}
`
  );
}

function buildBuilderPrompt(validatorOutput, reviewerFeedback, issueNumber, issueTitle) {
  const issueContext = issueNumber
    ? `You are fixing issue #${issueNumber}: "${issueTitle}". Your commit message MUST reference this issue (e.g., "Fix layout overflow on mobile (closes #${issueNumber})").\n`
    : "";

  let prompt =
`You are the BUILDER. Implement the approved proposal described in the Validator output below.

Read the proposal, explore the files you need to modify, and implement the change. Keep it self-contained, lightweight, and well-organized.

## Constraints
${SHARED_CONSTRAINTS}

## Code Organization
- docs/script.js is the main entry point. It can import from other files (e.g. \`import { initTheme } from './js/theme.js'\`).
- You MAY create new files under docs/js/ to keep code organized (e.g. docs/js/tiles.js, docs/js/visitors.js, docs/js/soundscape.js, etc.).
- You MAY also split docs/styles.css into separate files under docs/css/ (e.g. docs/css/tiles.css, docs/css/visitors.css, docs/css/soundscape.css, etc.) and add corresponding \`<link>\` tags in index.html.
- If you split code into modules, remember to add \`<script type="module">\` tags or keep imports in script.js.
- Keep it simple — only split if it genuinely improves clarity.

## After Implementing
- Update docs/CHANGELOG.md — append a new entry with today's date and what you added.
- If the Scout proposed a new appConcept and docs/VISION.md does not exist, create docs/VISION.md.
- Do NOT commit or push — the pipeline handles that.
${issueContext}`;

  if (reviewerFeedback) {
    prompt +=
`
## Reviewer Feedback (Issues to Fix)
The Reviewer found these problems (may include issues from previous runs):
${reviewerFeedback}

Fix ALL issues above. You may edit any file. Do not introduce new issues.
`;
  }

  prompt +=
`
## VALIDATOR OUTPUT
${validatorOutput}

## Output

After implementing, respond with ONLY a valid JSON object:

{
  "commitMessage": "Short descriptive commit message (imperative mood, e.g. 'Fix tile animation stutter on mobile' or 'Fix layout overflow on mobile (closes #3)')",
  "summary": "One sentence describing what was built and any issues fixed."
}
`;

  return prompt;
}

function buildMergeConflictPrompt(conflictedFiles, statusOutput, originalCommitMessage) {
  return (
`You are the BUILDER. Your branch has merge conflicts with origin/main that need to be resolved.

## Conflicted Files
${conflictedFiles.join("\n")}

## Git Status
${statusOutput}

## Original Work
Your original commit message was: "${originalCommitMessage}"

## What To Do
1. Read each conflicted file carefully.
2. Resolve the conflicts by keeping the best version of each change — your work AND the incoming changes from main should coexist when possible.
3. Look for conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`) and replace each conflicted section with the correct resolved code.
4. After resolving all conflicts, stage the files with \`git add\` and commit with a message like "Resolve merge conflicts with origin/main".
5. Do NOT run any other commands or make other changes — just fix the conflicts.

## Output

After resolving, respond with ONLY a valid JSON object:

{
  "resolvedFiles": ["file1.js", "file2.css"],
  "summary": "One sentence describing how conflicts were resolved."
}
`
  );
}

function buildReviewerPrompt() {
  return (
`You are the REVIEWER. Review the entire page for quality — not just the latest change. Previous runs may have left broken code; catch it all.

Read through the HTML, CSS, JS, changelog, and vision. Check for broken markup, syntax errors, dead code, missing responsive patterns, external API references, and drift from the project's vision. Verify the changelog has a recent entry.

## Output

Respond with ONLY a valid JSON object:

{
  "decision": "APPROVED or NEEDS_FIX",
  "issues": ["Description of issue 1", "Description of issue 2"]
}

If everything is good:
{
  "decision": "APPROVED",
  "issues": []
}
`
  );
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
    const scoutJSON = extractJSON("Scout", scoutOutput);
    if (!scoutJSON) {
      feedback = "Output was not valid JSON. Respond with valid JSON only.";
      continue;
    }

    // If the Scout identified an invalid issue, label and skip
    if (scoutJSON.issueAction === "close-invalid" && scoutJSON.issueNumber) {
      log("info", `Scout: issue #${scoutJSON.issueNumber} is invalid/out of scope.`);
      await labelIssue(scoutJSON.issueNumber, "invalid");
      const comment = "Reviewed by the Builder Team — this issue is not actionable or is out of scope for the current vision of the project.";
      try {
        execSync(
          'gh issue comment ' + scoutJSON.issueNumber + ' --body "' + comment + '"',
          { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
        );
        execSync(
          'gh issue close ' + scoutJSON.issueNumber,
          { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
        );
        log("info", `Closed issue #${scoutJSON.issueNumber} as invalid.`);
      } catch (e) {
        log("warn", "Could not close issue", errorData(e));
      }
      return;
    }

    // Track which issue we're addressing
    if (scoutJSON.issueNumber) {
      addressedIssue = scoutJSON.issueNumber;
      const issue = openIssues.find((i) => i.number === addressedIssue);
      addressedIssueTitle = issue ? issue.title : "Unknown issue";
      log("info", `Scout: addressing issue #${addressedIssue} — ${addressedIssueTitle}`);
    }

    // 2. Validator
    const validatorOutput = await runAgent({
      label: "Validator",
      systemPrompt: buildValidatorPrompt(scoutOutput),
      tools: ["read", "bash"],
    });
    const validatorJSON = extractJSON("Validator", validatorOutput);
    if (!validatorJSON) {
      feedback = "Output was not valid JSON. Respond with valid JSON only.";
      continue;
    }

    const { decision, reason } = validatorJSON;
    log("info", `Validator: ${decision} — ${reason}`);

    if (decision !== "APPROVED") {
      feedback = reason;
      log("warn", `Validator rejected: ${reason}`);
      continue;
    }

    // 3. Create a feature branch
    const branchName = createBranchName(addressedIssue, addressedIssueTitle, scoutJSON.suggestion);
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
      const builderJSON = extractJSON("Builder", builderOutput);
      if (builderJSON && builderJSON.commitMessage) {
        commitMessage = builderJSON.commitMessage;
        log("info", `Builder summary: ${builderJSON.summary || "n/a"}`);
      }

      // Review
      const reviewerOutput = await runAgent({
        label: "Reviewer",
        systemPrompt: buildReviewerPrompt(),
        tools: ["read", "bash"],
      });
      const reviewerJSON = extractJSON("Reviewer", reviewerOutput);

      if (!reviewerJSON) {
        reviewerFeedback = "The Reviewer output could not be parsed. Check your your work for obvious issues.";
        continue;
      }

      if (reviewerJSON.decision === "APPROVED") {
        log("info", "Reviewer: APPROVED");
        break;
      }

      const issueCount = reviewerJSON.issues ? reviewerJSON.issues.length : 0;
      log("warn", `Reviewer: NEEDS_FIX — ${issueCount} issue(s)`, {
        issues: reviewerJSON.issues,
      });
      reviewerFeedback = reviewerJSON.issues ? reviewerJSON.issues.join("\n- ") : "Unknown issues found.";

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
      // Ask the Builder to resolve merge conflicts
      log("info", "Sending merge conflicts to Builder for resolution.");
      const conflictPrompt = buildMergeConflictPrompt(mergeResult.conflictedFiles, mergeResult.statusOutput, commitMessage);
      const resolverOutput = await runAgent({
        label: "Builder",
        systemPrompt: conflictPrompt,
        tools: ["read", "bash", "edit", "write"],
      });
      const resolverJSON = extractJSON("Builder", resolverOutput);

      // Check if conflicts are resolved
      const remaining = gitExec("diff --name-only --diff-filter=U");
      if (remaining) {
        log("error", "Builder could not resolve all merge conflicts. Aborting.", {
          remainingConflicts: remaining.split("\n"),
        });
        ghAnnotation("error", `Merge conflicts could not be resolved automatically. Branch: ${branchName}`);
        abortMerge();
        break;
      }

      // Commit the merge resolution
      gitExec("add -A");
      const resolutionMessage = `Resolve merge conflicts with origin/main (closes #${addressedIssue || "n/a"})`;
      gitExec(`commit -m "${resolutionMessage}"`);
      gitExec(`push origin ${branchName}`);
      log("info", "Merge conflicts resolved and pushed.");

      // Re-run review after conflict resolution
      const postMergeReviewerOutput = await runAgent({
        label: "Reviewer",
        systemPrompt: buildReviewerPrompt(),
        tools: ["read", "bash"],
      });
      const postMergeReviewerJSON = extractJSON("Reviewer", postMergeReviewerOutput);
      if (postMergeReviewerJSON && postMergeReviewerJSON.decision !== "APPROVED") {
        log("warn", "Post-merge review found issues. Committing as-is.", {
          issues: postMergeReviewerJSON.issues,
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

function errorData(e) {
  return {
    message: e.message || String(e),
    stack: e.stack || null,
  };
}

main().catch((err) => {
  log("error", "Pipeline failed", errorData(err));
  ghAnnotation("error", `Pipeline failed: ${err.message || err}`);
  printRunSummary();
  process.exit(1);
});
