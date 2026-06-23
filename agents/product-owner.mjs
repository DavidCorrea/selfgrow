import fs from "fs";
import {
  repoRoot,
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  runAgent,
  extractAgentResponse,
  gitExec,
  configureGitIdentity,
} from "./shared.mjs";

// ---------------------------------------------------------------------------
// Apply refinement to VISION.md
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyRefinement(parsed) {
  if (!parsed || parsed.outcome === "skip") {
    return { changed: false, reason: parsed?.summary || "No refinement needed." };
  }

  const { action, section, content, oldText } = parsed.data;
  const summary = parsed.summary;

  if (!section || !action || !content || !summary) {
    log("warn", "Missing required fields in Product Owner output.", { parsed: parsed.data });
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
      log("warn", `Section "${section}" not found in VISION.md.`);
      return { changed: false };
    }

    const updated = current.replace(sectionRegex, (fullMatch) => {
      return fullMatch.trimEnd() + "\n\n" + content + "\n";
    });

    fs.writeFileSync(visionPath, updated, "utf-8");
    log("info", `Appended to section "${section}".`);

  } else if (action === "refine") {
    if (!oldText) {
      log("warn", "Refine action requires oldText.");
      return { changed: false };
    }
    if (!current.includes(oldText)) {
      log("warn", "oldText not found in VISION.md.");
      return { changed: false };
    }
    const updated = current.replace(oldText, content);
    fs.writeFileSync(visionPath, updated, "utf-8");
    log("info", `Refined text in section "${section}".`);

  } else {
    log("warn", `Unknown action: ${action}`);
    return { changed: false };
  }

  return { changed: true, summary };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Commit VISION.md and push to main, surviving concurrent pushes by rebasing
 * on rejection and retrying.
 */
function commitAndPushVision(commitMessage, { retries = 5 } = {}) {
  configureGitIdentity();
  gitExec("add docs/VISION.md");
  gitExec(`commit -m "${commitMessage.replace(/"/g, '\\"')}"`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      gitExec("push origin HEAD:main");
      log("info", `Committed and pushed (attempt ${attempt}): ${commitMessage}`);
      return;
    } catch (e) {
      if (attempt === retries) {
        throw new Error(`Push to main rejected after ${retries} attempts: ${e.message}`);
      }
      log("warn", `Push rejected, rebasing on origin/main and retrying (${attempt}/${retries}).`);
      gitExec("fetch origin");
      gitExec("rebase origin/main");
    }
  }
}

async function main() {
  log("info", "=== Product Owner Daily Review ===");

  const rawOutput = await withLogGroup("Product Owner", () =>
    runAgent({
      label: "Product Owner",
      systemPrompt: loadPrompt("product-owner"),
    })
  );

  const parsed = extractAgentResponse("Product Owner", rawOutput, {
    requiredDataFields: ["action"],
  });
  if (!parsed) {
    printRunSummary("Product Owner");
    return;
  }

  if (parsed.outcome === "skip") {
    log("info", `Product Owner: no refinement needed. ${parsed.summary || ""}`);
    printRunSummary("Product Owner");
    return;
  }

  const result = applyRefinement(parsed);
  if (!result.changed) {
    log("info", `Product Owner: no change applied. ${result.reason || ""}`);
    printRunSummary("Product Owner");
    return;
  }

  try {
    log("info", "VISION.md diff:", gitExec("diff docs/VISION.md"));
  } catch {
    // ignore diff errors
  }

  try {
    commitAndPushVision(result.summary);
  } catch (e) {
    log("error", `Commit/push failed: ${e.message}`);
  }

  printRunSummary("Product Owner");
}

main().catch((err) => {
  log("error", `Product Owner failed: ${err.message || err}`);
  printRunSummary("Product Owner");
  process.exit(1);
});
