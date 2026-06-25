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
  createIssue,
  moveCard,
  ensurePriorityLabels,
  setIssuePriority,
  recordTicket,
} from "./shared.mjs";

const norm = (t) => (t || "").toLowerCase().trim();

// Keep the backlog from growing unbounded — the PM only tops it up to this many
// open issues, so builder-team can drain it over time.
const BACKLOG_CEILING = Number(process.env.BACKLOG_CEILING || 6);

// ---------------------------------------------------------------------------
// Backlog grooming — create prioritized tickets on the board (best-effort)
// ---------------------------------------------------------------------------

function groomBacklog(proposed, openIssues, boardTitles) {
  if (!Array.isArray(proposed) || proposed.length === 0) {
    log("info", "Backlog: no tickets proposed.");
    return;
  }
  const room = BACKLOG_CEILING - openIssues.length;
  if (room <= 0) {
    log("info", `Backlog: ${openIssues.length} open issue(s) ≥ ceiling ${BACKLOG_CEILING} — not creating new tickets.`);
    return;
  }

  // Dedup against everything on the board (incl. shipped/Done) and all open issues.
  const seen = new Set([...openIssues.map((i) => norm(i.title)), ...boardTitles.map(norm)]);
  let created = 0;
  for (const item of proposed) {
    if (created >= room) break;
    if (!item || !item.title || !item.body) continue;
    const key = norm(item.title);
    if (seen.has(key)) {
      log("info", `Backlog: skipping duplicate "${item.title}".`);
      continue;
    }
    const number = createIssue(item.title, item.body);
    if (number) {
      moveCard(number, "Backlog"); // best-effort; also adds it to the board
      setIssuePriority(number, item.priority || "medium", []);
      recordTicket("created", number, item.title);
      seen.add(key);
      created++;
    }
  }
  log("info", `Backlog: created ${created} ticket(s) (ceiling ${BACKLOG_CEILING}, ${openIssues.length} already open).`);
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

async function main() {
  log("info", "=== Product Manager — Backlog Grooming ===");

  const { openIssues, boardItems, boardState } = getBoardSnapshot();
  const vision = readVision();
  ensurePriorityLabels();

  const rawOutput = await withLogGroup("Product Manager", () =>
    runAgent({
      label: "Product Manager",
      systemPrompt: fillTemplate(loadPrompt("product-manager"), {
        VISION: vision,
        BOARD_STATE: boardState,
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
  // 1. Triage + prioritize existing open tickets (pull inbound onto the board).
  triageExisting(openIssues, boardItems, data.triage);
  // 2. Create new prioritized tickets toward the vision.
  groomBacklog(data.backlog, openIssues, boardItems.map((i) => i.title));

  printRunSummary("Product Manager");
}

main().catch((err) => {
  log("error", `Product Manager failed: ${err.message || err}`);
  printRunSummary("Product Manager");
  process.exit(1);
});
