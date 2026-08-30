// CURATOR — the only agent that subtracts.
//
// The PM proposes, the Builder ships, the PO grows the Vision: every other agent
// makes the product bigger. The Vision commits to being "curated, not accumulated",
// and nothing else in the pipeline can honour that, so this agent exists purely to
// ask what should go.
//
// It doesn't delete anything itself. It proposes ordinary tickets and lets the
// Builder do the work under the usual review and verification — removal is
// destructive, and it should pass the same gates as any other change.
import fs from "fs";
import { join, relative } from "path";
import { pathToFileURL } from "url";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
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

// Below this the product is too thin to prune — early on almost everything is
// load-bearing, so removing anything makes it worse whatever its quality.
const MIN_FILES_TO_CURATE = 4;

const SOURCE_DIR = join(repoRoot, "docs");

// What counts as a unit of shipped work. Markup is deliberately excluded: a page
// is rarely removable on its own, and including it crowds out the code where
// accumulated cruft actually hides.
const CURATED_EXTENSIONS = /\.(m?js|css)$/;

// The product's own checks are not candidates for removal. Proposing to delete
// them would look exactly like curation and would quietly disarm the build's
// only test of whether the product works.
const NEVER_CURATE = new Set(["selftest.js"]);

// Per-file and total caps on how much source goes into the prompt. Without the
// total, a product with fifty small files would blow the context and the model
// would judge whichever half survived truncation.
const MAX_CHARS_PER_FILE = 4000;
const MAX_CHARS_TOTAL = 24000;

/** Every curatable file under docs/, deepest paths included, as repo-relative names. */
function listSourceFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(path));
    } else if (CURATED_EXTENSIONS.test(entry.name) && !NEVER_CURATE.has(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Read the shipped source. The Curator is judging craft, so it gets the actual
 * code rather than a file listing — a name says almost nothing about whether a
 * file earns its place.
 */
function readSources() {
  return listSourceFiles(SOURCE_DIR).map((path) => {
    let source = "";
    try { source = fs.readFileSync(path, "utf-8"); } catch { /* unreadable — report the name alone */ }
    return { name: relative(repoRoot, path), source };
  });
}

function formatSources(sources) {
  const blocks = [];
  let budget = MAX_CHARS_TOTAL;
  for (const file of sources) {
    if (budget <= 0) {
      blocks.push(`_(${sources.length - blocks.length} further file(s) omitted — too much source to read in one pass.)_`);
      break;
    }
    const body = file.source.slice(0, Math.min(MAX_CHARS_PER_FILE, budget));
    budget -= body.length;
    blocks.push(`### ${file.name}\n\`\`\`\n${body}\n\`\`\``);
  }
  return blocks.join("\n\n");
}

async function main() {
  log("info", "=== Curator — review the product ===");

  const sources = readSources();
  if (sources.length < MIN_FILES_TO_CURATE) {
    log("info", `Only ${sources.length} shipped file(s) — too few to curate (needs ${MIN_FILES_TO_CURATE}). Nothing to do.`);
    printRunSummary("Curator");
    return;
  }

  const { boardState } = getBoardSnapshot();
  const rawOutput = await withLogGroup("Curator", () =>
    runAgent({
      label: "Curator",
      systemPrompt: fillTemplate(loadPrompt("curator"), {
        VISION: readVision(),
        SOURCES: formatSources(sources),
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
      // product better, only fill the gaps between it.
      setIssuePriority(number, "low", []);
      recordTicket("created", number, item.title);
    }
  }

  printRunSummary("Curator");
}

// Only curate when RUN, never when imported — the same guard model-probe.mjs
// uses, so the file-selection helpers can be exercised without spending a
// session on the model.
export { listSourceFiles, formatSources, SOURCE_DIR };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Curator failed: ${err.message || err}`);
    printRunSummary("Curator");
    process.exit(1);
  });
}
