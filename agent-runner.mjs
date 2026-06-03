import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_SCOUT_RETRIES = 3;
const MAX_BUILDER_RETRIES = 3;

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
      cwd: __dirname,
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
// Agent prompts
// ---------------------------------------------------------------------------

function buildScoutPrompt(feedback) {
  let prompt =
`You are the SCOUT agent. Explore the current state of the project and propose ONE new feature or content addition.

## Context Gathering (Do This First)
1. Read index.html, styles.css, script.js — see what is on the page.
2. Read CHANGELOG.md — see what has been added before.
3. Read VISION.md if it exists — understand the app direction.
4. Run \`git log --oneline -20\` for commit history.
`;

  if (feedback) {
    prompt += "\n## Feedback From Validator (Previous Attempt Was Rejected)\n" + feedback + "\n";
  }

  prompt +=
`
## Guidelines
- Keep the feature SELF-CONTAINED. No external services, APIs, or third-party integrations.
- Use fake/hardcoded data if needed — that is perfectly fine.
- Be creative: quotes, animations, interactive elements, visual components, micro-games, etc.
- CLEANUP IS VALID: If the page has gotten messy or has orphaned/broken elements from previous runs, you may propose a cleanup feature.

## Your Output
Respond with ONLY a valid JSON object:

{
  "appConcept": "If VISION.md exists paste its one-sentence concept here. If not, invent a one-sentence concept.",
  "suggestion": "One concise sentence describing what to add.",
  "details": "A short paragraph explaining what to build and why.",
  "files": ["index.html", "styles.css"]
}
`;

  return prompt;
}

function buildValidatorPrompt(scoutOutput) {
  return (
`You are the VALIDATOR agent. Review the Scout's proposal below.

## Steps
1. Review the SCOUT OUTPUT below.
2. Read index.html, styles.css, script.js — check if this already exists.
3. Read CHANGELOG.md — check if this was done before.
4. Read VISION.md if it exists — check alignment.

## Decision Criteria
- REJECT if the exact idea already exists.
- REJECT if the appConcept is incoherent or empty.
- REJECT if the proposal requires external services or APIs.
- APPROVE otherwise — be loose and permissive.

## SCOUT OUTPUT
${scoutOutput}

## Your Output
Respond with ONLY a valid JSON object:

{
  "decision": "APPROVED or REJECTED",
  "reason": "One sentence explaining your decision.",
  "scoutOutput": <the full Scout output object above, verbatim>
}
`
  );
}

function buildBuilderPrompt(validatorOutput, reviewerFeedback) {
  let prompt =
`You are the BUILDER agent. Implement the approved feature described in the Validator output below.

## Steps
1. Read the VALIDATOR OUTPUT below — it contains the Scout's full proposal.
2. Read the files you need to modify.
3. Implement the feature. Self-contained, lightweight, no external dependencies.
   - MUST be responsive: use relative units (rem, em, %, vw/vh) and media queries. Test mentally at 375px, 768px, 1200px+.
   - Use fake/hardcoded data if needed.
4. Update CHANGELOG.md — append: "## <date>\\n<what you added and why>"
5. If the Scout proposed a new appConcept and VISION.md does not exist, create VISION.md.
6. Do NOT commit or push — the pipeline handles that.
`;

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

## Your Output
After implementing, respond with ONLY a valid JSON object:

{
  "commitMessage": "Short descriptive commit message (imperative mood, e.g. 'Add habit tracker with localStorage')",
  "summary": "One sentence describing what was built and any issues fixed."
}
`;

  return prompt;
}

function buildReviewerPrompt() {
  return (
`You are the REVIEWER agent. Review the ENTIRE page for quality — not just the latest change. Previous runs may have left broken code; catch it all.

## Steps
1. Read index.html — valid HTML, unclosed tags, viewport meta, no orphaned elements.
2. Read styles.css — balanced braces, responsive design, no dead code.
3. Read script.js — no syntax errors, no external API references, no unused code.
4. Run \`node --check script.js\` to verify JS syntax.
5. Read CHANGELOG.md — verify a recent entry exists.
6. Read VISION.md if it exists — check page aligns with concept.

## What to Look For
- Broken HTML (unclosed tags, orphaned elements from previous runs)
- CSS syntax errors, missing responsive patterns, dead code
- JS syntax errors, external API references, unused code
- Missing CHANGELOG update
- Content that drifts from VISION.md

## Your Output
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
  let approved = false;
  let feedback = null;

  for (let attempt = 1; attempt <= MAX_SCOUT_RETRIES; attempt++) {
    console.log("\n--- Scout Attempt " + attempt + " ---");

    // 1. Scout
    const scoutOutput = await runAgent({
      label: "Scout",
      systemPrompt: buildScoutPrompt(feedback),
      tools: ["read", "bash"],
    });
    const scoutJSON = extractJSON(scoutOutput);
    if (!scoutJSON) {
      console.log("Scout output failed to parse, retrying...");
      feedback = "Output was not valid JSON. Respond with valid JSON only.";
      continue;
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
        systemPrompt: buildBuilderPrompt(validatorOutput, reviewerFeedback),
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
        reviewerFeedback = "The Reviewer output could not be parsed. Check your work for obvious issues.";
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
      const status = execSync("git status --porcelain", { cwd: __dirname }).toString().trim();
      if (status) {
        execSync(
          'git config user.name "github-actions[bot]" && ' +
          'git config user.email "github-actions[bot]@users.noreply.github.com" && ' +
          'git add -A && git commit -m "' + commitMessage + '" && git push',
          { cwd: __dirname, maxBuffer: 10 * 1024 * 1024 }
        );
        console.log("Committed and pushed: " + commitMessage);
      } else {
        try {
          execSync("git push", { cwd: __dirname, maxBuffer: 10 * 1024 * 1024 });
          console.log("Pushed existing commit.");
        } catch {
          console.log("Nothing to push.");
        }
      }
    } catch (e) {
      console.log("Commit/push issue:", (e.message || "").slice(0, 200));
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
