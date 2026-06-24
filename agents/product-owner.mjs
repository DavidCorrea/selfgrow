import fs from "fs";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
  getBoardSnapshot,
  readVision,
  wikiPath,
  publishWiki,
} from "./shared.mjs";

// ---------------------------------------------------------------------------
// Apply a refinement to the canonical Vision page (in the wiki)
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

  const visionPath = wikiPath("Vision.md");
  if (!visionPath) {
    log("warn", "Wiki unavailable — cannot edit the vision.");
    return { changed: false };
  }
  let current;
  try {
    current = fs.readFileSync(visionPath, "utf-8");
  } catch {
    log("warn", "Vision.md not found in the wiki (seed it first).");
    return { changed: false };
  }

  if (action === "append") {
    const sectionRegex = new RegExp(`(${escapeRegex(section)}[\\s\\S]*?)(?=\\n## |$)`, "i");
    const match = current.match(sectionRegex);
    if (!match) {
      log("warn", `Section "${section}" not found in Vision.`);
      return { changed: false };
    }
    const updated = current.replace(sectionRegex, (fullMatch) => fullMatch.trimEnd() + "\n\n" + content + "\n");
    fs.writeFileSync(visionPath, updated, "utf-8");
    log("info", `Appended to section "${section}".`);
  } else if (action === "refine") {
    if (!oldText) {
      log("warn", "Refine action requires oldText.");
      return { changed: false };
    }
    if (!current.includes(oldText)) {
      log("warn", "oldText not found in Vision.");
      return { changed: false };
    }
    fs.writeFileSync(visionPath, current.replace(oldText, content), "utf-8");
    log("info", `Refined text in section "${section}".`);
  } else {
    log("warn", `Unknown action: ${action}`);
    return { changed: false };
  }

  return { changed: true, summary };
}

// ---------------------------------------------------------------------------
// Main — steward the vision (canonical in the wiki); the PM owns the backlog
// ---------------------------------------------------------------------------

async function main() {
  log("info", "=== Product Owner — Vision Review ===");

  const { boardState } = getBoardSnapshot();
  const vision = readVision();
  if (vision.startsWith("(Vision unavailable")) {
    log("error", "Wiki not reachable / not seeded — skipping vision review.");
    printRunSummary("Product Owner");
    return;
  }

  const rawOutput = await withLogGroup("Product Owner", () =>
    runAgent({
      label: "Product Owner",
      systemPrompt: fillTemplate(loadPrompt("product-owner"), {
        VISION: vision,
        BOARD_STATE: boardState,
      }),
    })
  );

  const parsed = extractAgentResponse("Product Owner", rawOutput, {});
  if (!parsed) {
    printRunSummary("Product Owner");
    return;
  }

  if (parsed.outcome === "skip") {
    log("info", `Product Owner: no vision change. ${parsed.summary || ""}`);
    printRunSummary("Product Owner");
    return;
  }

  const result = applyRefinement(parsed);
  if (!result.changed) {
    log("info", `Product Owner: no vision change applied. ${result.reason || ""}`);
    printRunSummary("Product Owner");
    return;
  }

  publishWiki(result.summary);
  printRunSummary("Product Owner");
}

main().catch((err) => {
  log("error", `Product Owner failed: ${err.message || err}`);
  printRunSummary("Product Owner");
  process.exit(1);
});
