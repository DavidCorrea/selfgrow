import { execSync } from "child_process";
import fs from "fs";
import {
  repoRoot,
  log,
  ghAnnotation,
  truncate,
  printRunSummary,
  errorData,
  loadPrompt,
  runAgent,
  extractAgentResponse,
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

async function main() {
  log("info", "--- Product Owner Daily Review ---");

  const rawOutput = await runAgent({
    label: "Product Owner",
    systemPrompt: loadPrompt("product-owner"),
  });

  const parsed = extractAgentResponse("Product Owner", rawOutput);
  if (!parsed) {
    printRunSummary();
    return;
  }

  if (parsed.outcome === "skip") {
    log("info", `Product Owner: no refinement needed. ${parsed.summary || ""}`);
    printRunSummary();
    return;
  }

  const result = applyRefinement(parsed);
  if (!result.changed) {
    printRunSummary();
    return;
  }

  try {
    const diff = execSync("git diff docs/VISION.md", { cwd: repoRoot }).toString();
    log("info", "Diff:", diff);
  } catch {
    // ignore diff errors
  }

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
    log("info", `Committed and pushed: ${commitMessage}`);
  } catch (e) {
    log("error", "Commit/push failed", errorData(e));
    ghAnnotation("error", `Commit/push failed: ${e.message}`);
  }

  printRunSummary();
}

main().catch((err) => {
  log("error", "Product Owner failed", errorData(err));
  ghAnnotation("error", `Product Owner failed: ${err.message || err}`);
  printRunSummary();
  process.exit(1);
});
