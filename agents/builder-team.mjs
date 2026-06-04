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

function extractJSON(text) {
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
        return null;
      }
    }
    return null;
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
    console.log("Closed issue #" + issueNumber);
  } catch (e) {
    console.log("Could not close issue #" + issueNumber + ":", (e.message || "").slice(0, 200));
  }
}

async function labelIssue(issueNumber, label) {
  try {
    execSync(
      'gh issue edit ' + issueNumber + ' --add-label "' + label + '"',
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    console.log("Labeled issue #" + issueNumber + " as \"" + label + "\"");
  } catch (e) {
    console.log("Could not label issue #" + issueNumber + ":", (e.message || "").slice(0, 200));
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
    console.log("Found " + openIssues.length + " open issue(s). Prioritizing fixes.");
  } else {
    console.log("No open issues. Proceeding with feature exploration.");
  }

  let approved = false;
  let feedback = null;
  let addressedIssue = null;
  let addressedIssueTitle = null;

  for (let attempt = 1; attempt <= MAX_SCOUT_RETRIES; attempt++) {
    console.log("\n--- Scout Attempt " + attempt + " ---");

    // 1. Scout
    const scoutOutput = await runAgent({
      label: "Scout",
      systemPrompt: buildScoutPrompt(feedback, openIssues),
      tools: ["read", "bash"],
    });
    const scoutJSON = extractJSON(scoutOutput);
    if (!scoutJSON) {
      console.log("Scout output failed to parse, retrying...");
      feedback = "Output was not valid JSON. Respond with valid JSON only.";
      continue;
    }

    // If the Scout identified an invalid issue, label and skip
    if (scoutJSON.issueAction === "close-invalid" && scoutJSON.issueNumber) {
      console.log("Scout: issue #" + scoutJSON.issueNumber + " is invalid/out of scope.");
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
        console.log("Closed issue #" + scoutJSON.issueNumber + " as invalid.");
      } catch (e) {
        console.log("Could not close issue:", (e.message || "").slice(0, 200));
      }
      return;
    }

    // Track which issue we're addressing
    if (scoutJSON.issueNumber) {
      addressedIssue = scoutJSON.issueNumber;
      const issue = openIssues.find((i) => i.number === addressedIssue);
      addressedIssueTitle = issue ? issue.title : "Unknown issue";
      console.log("Scout: addressing issue #" + addressedIssue + " — " + addressedIssueTitle);
    }

    // 2. Validator
    const validatorOutput = await runAgent({
      label: "Validator",
      systemPrompt: buildValidatorPrompt(scoutOutput),
      tools: ["read", "bash"],
    });
    const validatorJSON = extractJSON(validatorOutput);
    if (!validatorJSON) {
      console.log("Validator output failed to parse, retrying...");
      feedback = "Output was not valid JSON. Respond with valid JSON only.";
      continue;
    }

    const { decision, reason } = validatorJSON;
    console.log("Validator: " + decision + " — " + reason);

    if (decision !== "APPROVED") {
      feedback = reason;
      continue;
    }

    // 3. Builder <-> Reviewer loop
    approved = true;
    let reviewerFeedback = null;
    let commitMessage = "Agent build";

    for (let buildAttempt = 1; buildAttempt <= MAX_BUILDER_RETRIES; buildAttempt++) {
      console.log("\n--- Build Attempt " + buildAttempt + " ---");

      // Build
      const builderOutput = await runAgent({
        label: "Builder",
        systemPrompt: buildBuilderPrompt(validatorOutput, reviewerFeedback, addressedIssue, addressedIssueTitle),
        tools: ["read", "bash", "edit", "write"],
      });
      const builderJSON = extractJSON(builderOutput);
      if (builderJSON && builderJSON.commitMessage) {
        commitMessage = builderJSON.commitMessage;
        console.log("Builder summary: " + (builderJSON.summary || "n/a"));
      }

      // Review
      const reviewerOutput = await runAgent({
        label: "Reviewer",
        systemPrompt: buildReviewerPrompt(),
        tools: ["read", "bash"],
      });
      const reviewerJSON = extractJSON(reviewerOutput);

      if (!reviewerJSON) {
        console.log("Reviewer output failed to parse, sending back to Builder...");
        reviewerFeedback = "The Reviewer output could not be parsed. Check your your work for obvious issues.";
        continue;
      }

      if (reviewerJSON.decision === "APPROVED") {
        console.log("Reviewer: APPROVED");
        break;
      }

      const issueCount = reviewerJSON.issues ? reviewerJSON.issues.length : 0;
      console.log("Reviewer: NEEDS_FIX — " + issueCount + " issue(s)");
      reviewerFeedback = reviewerJSON.issues ? reviewerJSON.issues.join("\n- ") : "Unknown issues found.";

      if (buildAttempt === MAX_BUILDER_RETRIES) {
        console.log("Max build retries reached. Committing as-is.");
      }
    }

    // Commit and push
    try {
      const status = execSync("git status --porcelain", { cwd: repoRoot }).toString().trim();
      if (status) {
        execSync(
          'git config user.name "github-actions[bot]" && ' +
          'git config user.email "github-actions[bot]@users.noreply.github.com" && ' +
          'git add -A && git commit -m "' + commitMessage.replace(/"/g, '\\"') + '" && git push',
          { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
        );
        console.log("Committed and pushed: " + commitMessage);
      } else {
        try {
          execSync("git push", { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
          console.log("Pushed existing commit.");
        } catch {
          console.log("Nothing to push.");
        }
      }
    } catch (e) {
      console.log("Commit/push issue:", (e.message || "").slice(0, 200));
    }

    // Close the addressed issue
    if (addressedIssue) {
      await closeIssue(addressedIssue, commitMessage);
    }

    console.log("\nPipeline complete.");
    break;
  }

  if (!approved) {
    console.log("No proposal approved after retries. Exiting.");
  }
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
