import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
  extractJSON,
  errorData,
  getBoardSnapshot,
  readVision,
  createIssue,
  moveCard,
  ensurePriorityLabels,
  setIssuePriority,
  recordTicket,
  retireIssue,
  visualCritique,
} from "./shared.mjs";

// How much title-token overlap (intersection / smaller set) counts as a near-dup.
const NEAR_DUP_THRESHOLD = 0.6;

// Generic ticket-phrasing words carry no topic — drop them so "Add a journal"
// and "Introduce the journal" both reduce to {journal} and match.
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with",
  "add", "create", "introduce", "implement", "build", "make", "new",
  "support", "enable", "improve", "update", "fix", "page", "feature",
]);

// Conservative singularize so "cycles" matches "cycle" — trim a trailing plural
// "s" only (keep short words and "...ss" like "process" intact).
function singularize(word) {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

// Reduce a title to its meaningful content words (lowercased, depunctuated,
// singularized), dropping generic phrasing words.
function titleTokens(title) {
  return new Set(
    (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map(singularize)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

// True when `title`'s content words overlap an existing title's heavily enough
// to be the same idea reworded. Overlap coefficient is lenient on length, so a
// short title contained in a longer one still matches.
function isNearDuplicate(title, existingTokenSets) {
  const a = titleTokens(title);
  if (a.size === 0) return false;
  for (const b of existingTokenSets) {
    if (b.size === 0) continue;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared / Math.min(a.size, b.size) >= NEAR_DUP_THRESHOLD) return true;
  }
  return false;
}

/**
 * Second-line dedup: a model call that catches reworded duplicates the token
 * overlap missed (same goal, different vocabulary). Best-effort — on any failure
 * it keeps every proposal rather than risk dropping good tickets.
 */
async function filterSemanticDuplicates(proposals, existingTitles) {
  if (proposals.length === 0 || existingTitles.length === 0) return proposals;

  const systemPrompt = `You are deduplicating a product backlog.

Existing tickets:
${existingTitles.map((t) => `- ${t}`).join("\n")}

Proposed new tickets:
${proposals.map((p, i) => `${i}. ${p.title} — ${p.body}`).join("\n")}

Return ONLY JSON: {"duplicates": [<index>, ...]} listing the indexes of proposed tickets that are substantially the same as an EXISTING ticket above — the same feature or goal, even if worded differently. Use an empty array if none are duplicates.`;

  try {
    const out = await withLogGroup("Dedup check", () =>
      runAgent({ label: "PM dedup", systemPrompt, tools: [] })
    );
    const parsed = extractJSON("PM dedup", out);
    const dupes = new Set(
      (parsed && Array.isArray(parsed.duplicates) ? parsed.duplicates : []).map(Number)
    );
    const kept = proposals.filter((_, i) => !dupes.has(i));
    if (kept.length < proposals.length) {
      log("info", `Dedup: semantic pass dropped ${proposals.length - kept.length} proposal(s).`);
    }
    return kept;
  } catch (e) {
    log("warn", "Dedup: semantic pass failed — keeping the heuristic survivors.", errorData(e));
    return proposals;
  }
}

// ---------------------------------------------------------------------------
// Backlog grooming — create prioritized tickets on the board (best-effort)
// ---------------------------------------------------------------------------

// Compose the issue body the Builder reads: the PM's description followed by the
// acceptance criteria as a checklist, so "what to build" and "how we know it's
// done" travel together on the ticket. Criteria are optional and defensive.
function formatTicketBody(item) {
  const parts = [String(item.body || "").trim()];
  const criteria = (Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  if (criteria.length) {
    parts.push(`## Acceptance criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

async function groomBacklog(proposed, openIssues, boardTitles) {
  if (!Array.isArray(proposed) || proposed.length === 0) {
    log("info", "Backlog: no tickets proposed.");
    return;
  }

  // Dedup against everything on the board (incl. shipped/Done) and all open issues.
  const existingTitles = [...openIssues.map((i) => i.title), ...boardTitles].filter(Boolean);

  // Pass 1 — deterministic: drop exact and reworded near-duplicate titles, and
  // dedup later proposals against ones we've already accepted this run.
  const tokenSets = existingTitles.map(titleTokens);
  const heuristicSurvivors = [];
  for (const item of proposed) {
    if (!item || !item.title || !item.body) continue;
    if (isNearDuplicate(item.title, tokenSets)) {
      log("info", `Backlog: skipping near-duplicate "${item.title}".`);
      continue;
    }
    heuristicSurvivors.push(item);
    tokenSets.push(titleTokens(item.title));
  }

  // Pass 2 — semantic: a model call catches reworded dupes the tokens missed.
  const survivors = await filterSemanticDuplicates(heuristicSurvivors, existingTitles);

  let created = 0;
  for (const item of survivors) {
    const number = createIssue(item.title, formatTicketBody(item));
    if (number) {
      moveCard(number, "Backlog"); // best-effort; also adds it to the board
      setIssuePriority(number, item.priority || "medium", []);
      recordTicket("created", number, item.title);
      created++;
    }
  }
  log("info", `Backlog: created ${created} ticket(s) (${openIssues.length} already open).`);
}

/**
 * Triage existing open tickets: ensure each is on the board (Todo) and apply the
 * PM's assigned priority. Best-effort.
 */
function triageExisting(openIssues, boardItems, triage) {
  const onBoard = new Set(boardItems.map((i) => i.number).filter((n) => n != null));
  const priorityOf = new Map(
    (Array.isArray(triage) ? triage : [])
      .filter((t) => t && t.number && t.priority)
      .map((t) => [Number(t.number), t.priority])
  );

  for (const iss of openIssues) {
    if (!onBoard.has(iss.number)) {
      moveCard(iss.number, "Backlog"); // pull inbound issues onto the board
    }
    const priority = priorityOf.get(iss.number);
    if (priority) {
      const current = (iss.labels || []).map((l) => l.name || l);
      setIssuePriority(iss.number, priority, current);
    }
  }
}

/**
 * Close the tickets the PM chose to retire (blocked tickets it split or dropped).
 * Returns the set of retired issue numbers. Best-effort.
 */
async function retireBlocked(retire) {
  const numbers = (Array.isArray(retire) ? retire : [])
    .map((n) => Number(typeof n === "object" && n ? n.number : n))
    .filter((n) => Number.isInteger(n) && n > 0);
  const retired = new Set();
  for (const number of numbers) {
    await retireIssue(number, "Retired by the Product Manager — repeatedly failed to ship; split into a smaller ticket or dropped.");
    moveCard(number, "Done"); // reflect the closure on the board (best-effort)
    recordTicket("retired", number, `#${number}`);
    retired.add(number);
  }
  if (retired.size) log("info", `Retired ${retired.size} blocked ticket(s).`);
  return retired;
}

async function main() {
  log("info", "=== Product Manager — Backlog Grooming ===");

  const { openIssues, boardItems, boardState } = getBoardSnapshot();
  const vision = readVision();
  ensurePriorityLabels();

  // A vision model looks at the live app and judges it against the Vision — the
  // only place appearance is assessed, since the agents themselves can't see.
  // Best-effort; anchored to the Vision so "quality" means fidelity to intent.
  const critique = await withLogGroup("Visual check", () => visualCritique(vision));
  const visualObservations = critique || "(no visual issues observed this run)";

  const rawOutput = await withLogGroup("Product Manager", () =>
    runAgent({
      label: "Product Manager",
      systemPrompt: fillTemplate(loadPrompt("product-manager"), {
        VISION: vision,
        BOARD_STATE: boardState,
        VISUAL_OBSERVATIONS: visualObservations,
      }),
      tools: ["read", "bash"],
    })
  );

  // Worker agent — parse JSON but don't require an outcome field.
  const parsed = extractAgentResponse("Product Manager", rawOutput, { requireOutcome: false });
  if (!parsed) {
    printRunSummary("Product Manager");
    return;
  }

  const data = parsed.data || {};
  // 1. Retire blocked tickets the PM gave up on (split into fresh tickets via
  //    `backlog`, or dropped outright). Done first so retired tickets drop out of
  //    `remainingOpen` and don't skew the grooming pass's dedup below.
  const retired = await retireBlocked(data.retire);
  const remainingOpen = openIssues.filter((i) => !retired.has(i.number));
  // 2. Triage + prioritize existing open tickets (pull inbound onto the board).
  triageExisting(remainingOpen, boardItems, data.triage);
  // 3. Create new prioritized tickets toward the vision.
  await groomBacklog(data.backlog, remainingOpen, boardItems.map((i) => i.title));

  printRunSummary("Product Manager");
}

main().catch((err) => {
  log("error", `Product Manager failed: ${err.message || err}`);
  printRunSummary("Product Manager");
  process.exit(1);
});
