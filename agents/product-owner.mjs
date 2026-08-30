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
  commitToWiki,
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
    return null;
  }

  return {
    summary,
    // Pure: takes the Vision as it is on the remote right now and returns what it
    // should become, or null when the edit no longer applies. commitToWiki may
    // call this several times, once per push attempt.
    refine(current) {
      if (!current.trim()) {
        log("warn", "Vision.md is empty in the wiki (seed it first).");
        return null;
      }
      if (action === "append") {
        const sectionRegex = new RegExp(`(${escapeRegex(section)}[\\s\\S]*?)(?=\\n## |$)`, "i");
        if (!sectionRegex.test(current)) {
          log("warn", `Section "${section}" not found in Vision.`);
          return null;
        }
        return current.replace(sectionRegex, (fullMatch) => fullMatch.trimEnd() + "\n\n" + content + "\n");
      }
      if (action === "refine") {
        if (!oldText) {
          log("warn", "Refine action requires oldText.");
          return null;
        }
        if (!current.includes(oldText)) {
          log("warn", "oldText not found in Vision.");
          return null;
        }
        return current.replace(oldText, content);
      }
      log("warn", `Unknown action: ${action}`);
      return null;
    },
  };
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

  const refinement = applyRefinement(parsed);
  if (!refinement) {
    printRunSummary("Product Owner");
    return;
  }

  if (commitToWiki("Vision.md", refinement.refine, refinement.summary)) {
    log("info", `Product Owner: ${refinement.summary}`);
  }
  printRunSummary("Product Owner");
}

main().catch((err) => {
  log("error", `Product Owner failed: ${err.message || err}`);
  printRunSummary("Product Owner");
  process.exit(1);
});
