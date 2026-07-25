// CURATOR — the only agent that subtracts.
//
// The PM proposes, the Builder ships, the PO grows the Vision: every other agent
// makes the guide bigger. The Vision commits to being "curated, not accumulated",
// and nothing else in the pipeline can honour that, so this agent exists purely to
// ask what should go.
//
// It doesn't delete anything itself. It proposes ordinary tickets and lets the
// Builder do the work under the usual review and verification — removal is
// destructive, and it should pass the same gates as any other change.
import fs from "fs";
import { join } from "path";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
  errorData,
  repoRoot,
  readVision,
  getBoardSnapshot,
  createIssue,
  moveCard,
  setIssuePriority,
  ensurePriorityLabels,
  recordTicket,
} from "./shared.mjs";

// Never propose more than this in one run. A curator that removes a lot at once
// is indistinguishable from a bug, and the damage is hard to walk back.
const MAX_PROPOSALS = 2;

// Below this the collection is too thin to prune — removing from a guide with a
// handful of specimens makes it worse, whatever their individual quality.
const MIN_SPECIMENS_TO_CURATE = 4;

const SPECIMEN_DIR = join(repoRoot, "docs", "specimens");

/**
 * Read the shipped specimens. The Curator is judging craft, so it gets the actual
 * source rather than a file listing — a title says almost nothing about whether a
 * specimen earns its page.
 */
function readSpecimens() {
  let entries;
  try {
    entries = fs.readdirSync(SPECIMEN_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.m?js$/.test(e.name))
    .map((e) => {
      const path = join(SPECIMEN_DIR, e.name);
      let source = "";
      try { source = fs.readFileSync(path, "utf-8"); } catch { /* unreadable — report the name alone */ }
      return { name: e.name, source };
    });
}

function formatSpecimens(specimens) {
  return specimens
    .map((s) => `### docs/specimens/${s.name}\n\`\`\`js\n${s.source.slice(0, 4000)}\n\`\`\``)
    .join("\n\n");
}

async function main() {
  log("info", "=== Curator — review the collection ===");

  const specimens = readSpecimens();
  if (specimens.length < MIN_SPECIMENS_TO_CURATE) {
    log("info", `Only ${specimens.length} specimen(s) — too few to curate (needs ${MIN_SPECIMENS_TO_CURATE}). Nothing to do.`);
    printRunSummary("Curator");
    return;
  }

  const { boardState } = getBoardSnapshot();
  const rawOutput = await withLogGroup("Curator", () =>
    runAgent({
      label: "Curator",
      systemPrompt: fillTemplate(loadPrompt("curator"), {
        VISION: readVision(),
        SPECIMENS: formatSpecimens(specimens),
        BOARD_STATE: boardState,
      }),
      tools: ["read"],
    })
  );

  const parsed = extractAgentResponse("Curator", rawOutput, {});
  if (!parsed) {
    printRunSummary("Curator");
    return;
  }
  if (parsed.outcome === "skip") {
    log("info", `Curator: nothing to change. ${parsed.summary || ""}`);
    printRunSummary("Curator");
    return;
  }

  const proposals = (Array.isArray(parsed.data?.proposals) ? parsed.data.proposals : [])
    .filter((p) => p && p.title && p.body);
  if (!proposals.length) {
    log("info", "Curator: approved but proposed nothing actionable.");
    printRunSummary("Curator");
    return;
  }
  if (proposals.length > MAX_PROPOSALS) {
    log("warn", `Curator proposed ${proposals.length} changes — keeping the first ${MAX_PROPOSALS}, since removing much at once is hard to undo.`);
  }

  ensurePriorityLabels();
  for (const item of proposals.slice(0, MAX_PROPOSALS)) {
    const criteria = (Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [])
      .map((c) => String(c).trim())
      .filter(Boolean);
    const body = [
      String(item.body).trim(),
      criteria.length ? `## Acceptance criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}` : "",
      "_Proposed by the Curator: this ticket removes or consolidates shipped work._",
    ].filter(Boolean).join("\n\n");

    const number = createIssue(item.title, body);
    if (number) {
      moveCard(number, "Backlog");
      // Curation is never urgent. It should never outrank the work that makes the
      // guide better, only fill the gaps between it.
      setIssuePriority(number, "low", []);
      recordTicket("created", number, item.title);
    }
  }

  printRunSummary("Curator");
}

main().catch((err) => {
  log("error", `Curator failed: ${err.message || err}`);
  printRunSummary("Curator");
  process.exit(1);
});
