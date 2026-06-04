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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runAgent({ systemPrompt }) {
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
      tools: ["read", "write", "edit"],
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

// ---------------------------------------------------------------------------
// Product Owner Agent prompt
// ---------------------------------------------------------------------------

function buildProductOwnerPrompt() {
  return [
    "You are the PRODUCT OWNER for a project called **selfgrow** — a living, growing digital garden web app.",
    "",
    "## Your Role",
    "",
    "You are the steward of the product vision. Each day, you review the current state of the project and make **one small, meaningful refinement** to VISION.md. You are not building features — you are curating the direction.",
    "",
    "Read the current vision, changelog, and open issues. Look at what's actually in the codebase. Then decide: does the vision need a small refinement, or is it fine as-is?",
    "",
    "## Rules",
    "",
    "- **Be minimal.** Add or change ONE small thing per run. A single sentence, a new bullet, a clarifying phrase.",
    "- **Never remove existing entries.** Only add or refine.",
    "- **Additive over rewrites.** Prefer appending a new idea over restructuring old ones.",
    "- **Ground in reality.** Your refinement should reflect what exists in the code, not invent disconnected fantasies.",
    "- **Think like a product owner:** user experience, emotional resonance, coherence, next steps, design philosophy.",
    "- **If nothing needs refinement**, respond with ONLY: `NO_CHANGE` — do not touch any files.",
    "",
    "## Valuable Refinements",
    "",
    "- Add a new roadmap item that naturally follows from what's built",
    "- Refine the language in Core Philosophy or Design Principles to more accurately reflect the current app",
    "- Add a clarifying \"why\" to an existing principle",
    "- Note an emotional or experiential quality the garden should evoke",
    "- Suggest a future direction that builds on the current trajectory",
    "- Add a constraint or guideline that would improve coherence",
    "- Address a user-reported issue — if an open bug or feature request is relevant, the refinement can respond to it",
    "",
    "## Refinements to Avoid",
    "",
    "- Rewriting existing sections (too noisy)",
    "- Adding roadmap items unrelated to the garden metaphor",
    "- Copying what's already in CHANGELOG.md into VISION.md",
    "- Generic platitudes (\"users love simplicity\")",
    "- Anything that contradicts the self-contained, calm, agent-driven philosophy",
    "",
    "## Output",
    "",
    "If you have a refinement, output ONLY a JSON object:",
    "",
    "```json",
    "{",
    "  \"section\": \"The section header to edit (e.g. 'Core Philosophy', 'Design Principles', 'Direction')\",",
    "  \"action\": \"append or refine\",",
    "  \"content\": \"The exact text to add or the refined text to replace with\",",
    "  \"summary\": \"One imperative sentence describing the decision, e.g. 'Add garden sounds to roadmap' or 'Clarify that growth should feel unhurried'\"",
    "}",
    "```",
    "",
    "- If `action` is `append`: your content will be added to the end of the specified section.",
    "- If `action` is `refine`: you must also include the `oldText` key containing the EXACT existing text to replace.",
    "- `summary` is required and will be used as the commit message — write it as an imperative phrase, concise and specific.",
    "",
    "If nothing needs refinement, output ONLY: NO_CHANGE",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Parse Product Owner output and apply change
// ---------------------------------------------------------------------------

function parseOutput(rawOutput) {
  const trimmed = rawOutput.trim();

  if (trimmed === "NO_CHANGE") {
    return { changed: false };
  }

  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = blockMatch ? blockMatch[1].trim() : trimmed;

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        parsed = JSON.parse(objMatch[0]);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  return parsed;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyRefinement(parsed) {
  if (!parsed || parsed.changed === false) {
    return { changed: false };
  }

  const { section, action, content, oldText, summary } = parsed;

  if (!section || !action || !content || !summary) {
    console.log("Missing required fields in Product Owner output.");
    return { changed: false };
  }

  const visionPath = repoRoot + "/docs/VISION.md";
  const current = fs.readFileSync(visionPath, "utf-8");

  if (action === "append") {
    const sectionRegex = new RegExp(
      `(${escapeRegex(section)}[\\s\\S]*?)(?=\\n## |$)`,
      "i"
    );
    const match = current.match(sectionRegex);
    if (!match) {
      console.log(`Section "${section}" not found in VISION.md.`);
      return { changed: false };
    }

    const updated = current.replace(sectionRegex, (fullMatch) => {
      return fullMatch.trimEnd() + "\n\n" + content + "\n";
    });

    fs.writeFileSync(visionPath, updated, "utf-8");
    console.log(`Appended to section "${section}".`);

  } else if (action === "refine") {
    if (!oldText) {
      console.log("Refine action requires oldText.");
      return { changed: false };
    }
    if (!current.includes(oldText)) {
      console.log("oldText not found in VISION.md.");
      return { changed: false };
    }
    const updated = current.replace(oldText, content);
    fs.writeFileSync(visionPath, updated, "utf-8");
    console.log(`Refined text in section "${section}".`);

  } else {
    console.log(`Unknown action: ${action}`);
    return { changed: false };
  }

  return { changed: true, summary };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n--- Product Owner Daily Review ---\n");

  const rawOutput = await runAgent({
    systemPrompt: buildProductOwnerPrompt(),
  });

  const parsed = parseOutput(rawOutput);
  if (!parsed) {
    console.log("Could not parse Product Owner output. No changes made.");
    return;
  }

  if (parsed.changed === false) {
    console.log("Product Owner: no refinement needed today.");
    return;
  }

  const result = applyRefinement(parsed);
  if (!result.changed) {
    return;
  }

  // Show what changed
  try {
    const diff = execSync("git diff docs/VISION.md", { cwd: repoRoot }).toString();
    console.log("\nDiff:\n" + diff);
  } catch {
    // ignore diff errors
  }

  // Commit and push with the agent's summary as the commit message
  const commitMessage = result.summary;
  try {
    execSync(
      'git config user.name "github-actions[bot]" && ' +
      'git config user.email "github-actions[bot]@users.noreply.github.com" && ' +
      'git add docs/VISION.md && ' +
      'git commit -m "' + commitMessage.replace(/"/g, '\\"') + '" && ' +
      'git push',
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
    );
    console.log("Committed and pushed: " + commitMessage);
  } catch (e) {
    console.log("Commit/push issue:", (e.message || "").slice(0, 200));
  }
}

main().catch((err) => {
  console.error("Product Owner failed:", err);
  process.exit(1);
});
