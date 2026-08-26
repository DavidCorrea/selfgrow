import { pathToFileURL } from "url";
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
  reviewApp,
  fetchOpenIssues,
  isBlocked,
  isBuildable,
  triggerWorkflow,
  dependencyLine,
  syncWaitingLabels,
} from "./shared.mjs";

// How much title-token similarity counts as a near-duplicate.
//
// This pass now catches only NEAR-IDENTICAL titles. Anything more subtle is the
// model's job (filterSemanticDuplicates), because tokens fundamentally cannot
// tell "a device found in the Condenser Gallery" from "the Condenser Gallery"
// itself — and getting that wrong here deletes good work with no recovery.
//
// The measure is Jaccard (shared / union), NOT the overlap coefficient
// (shared / smaller set) this used to use. Overlap rewards size mismatch: a
// short existing title that is a subset of a longer proposal scores a perfect
// 1.00. One real title — "Fix contrast on  to meet WCAG AA", which lost its
// element name to a formatting bug and kept just three content words — therefore
// matched EVERY future contrast ticket, permanently. Jaccard is symmetric and
// penalises the size gap instead.
export const NEAR_DUP_THRESHOLD = Number(process.env.NEAR_DUP_THRESHOLD || 0.9);

// Most tickets one grooming pass may create. A ceiling rather than a target —
// the prompt still asks for only what earns its place — but it bounds how much
// work a single run can queue for the Builder, and therefore how much a day can
// spend building it.
const MAX_NEW_TICKETS_PER_RUN = Number(process.env.MAX_NEW_TICKETS_PER_RUN || 10);

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

/**
 * The existing title `title` is a near-duplicate of, or null when it is new.
 *
 * Returns the match and its score rather than a bare boolean, so a rejection can
 * say what it collided with and how hard. A dedup that deletes work without
 * naming its reason is not auditable, and this one silently discarded three
 * good tickets before anyone noticed.
 *
 * @param {string} title
 * @param {{title: string, tokens: Set<string>}[]} existing
 * @returns {{title: string, score: number}|null}
 */
export function nearDuplicateOf(title, existing) {
  const a = titleTokens(title);
  if (a.size === 0) return null;
  let best = null;
  let bestScore = 0;
  for (const entry of existing) {
    const b = entry.tokens;
    if (!b || b.size === 0) continue;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared++;
    const score = shared / new Set([...a, ...b]).size; // Jaccard
    if (score > bestScore) {
      bestScore = score;
      best = entry.title;
    }
  }
  return bestScore >= NEAR_DUP_THRESHOLD ? { title: best, score: bestScore } : null;
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

/**
 * Hand off to the Builder — but only when grooming actually left something
 * buildable. The Builder used to start whenever a PM run merely *completed*,
 * which is a different fact: guard-skipped runs and self-triggered bursts all
 * "complete", so a single grooming pass could start it nine times. Dispatching it
 * here means one grooming pass leads to at most one Builder run, and none at all
 * when the board is empty. Best-effort: a failed dispatch just means the next
 * daily run picks the work up.
 */
function kickBuilder() {
  const open = fetchOpenIssues(100);
  const openNumbers = new Set(open.map((i) => i.number));
  // Reconcile the `waiting` labels now that this run's tickets exist, so the
  // board shows what is held back before the Builder even starts.
  syncWaitingLabels(open);
  const buildable = open.filter((i) => isBuildable(i, openNumbers));
  if (buildable.length === 0) {
    log("info", "No buildable tickets after grooming — not starting the Builder.");
    return;
  }
  log("info", `${buildable.length} buildable ticket(s) — starting the Builder.`);
  triggerWorkflow("builder-team.yml");
}

// ---------------------------------------------------------------------------
// Backlog grooming — create prioritized tickets on the board (best-effort)
// ---------------------------------------------------------------------------

// Compose the issue body the Builder reads: the PM's description followed by the
// acceptance criteria as a checklist, so "what to build" and "how we know it's
// done" travel together on the ticket. Criteria are optional and defensive.
function formatTicketBody(item, dependencyNumbers = []) {
  const parts = [String(item.body || "").trim()];
  const criteria = (Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  if (criteria.length) {
    parts.push(`## Acceptance criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}`);
  }
  const deps = dependencyLine(dependencyNumbers);
  if (deps) parts.push(deps);
  return parts.join("\n\n");
}

// A ticket may declare what must ship first as `dependsOn`, holding either an
// existing ticket ("#134") or the exact title of another ticket in the same batch
// — the PM has no numbers for work it is proposing in the very same breath.
function normalizeTitle(title) {
  return String(title || "").trim().toLowerCase();
}

/**
 * Order proposals so a ticket is always created after the ones it depends on,
 * which is what lets its body reference their real issue numbers. Depth-first,
 * with visited-tracking that breaks dependency cycles by simply emitting the
 * ticket anyway — a cycle is the model's mistake, and refusing to create any of
 * the tickets would be a worse outcome than creating them unordered.
 */
function orderByDependencies(items) {
  const byTitle = new Map(items.map((i) => [normalizeTitle(i.title), i]));
  const ordered = [];
  const state = new Map(); // title -> "visiting" | "done"

  const visit = (item) => {
    const key = normalizeTitle(item.title);
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") return; // cycle — stop descending
    state.set(key, "visiting");
    for (const dep of Array.isArray(item.dependsOn) ? item.dependsOn : []) {
      const depItem = byTitle.get(normalizeTitle(dep));
      if (depItem && depItem !== item) visit(depItem);
    }
    state.set(key, "done");
    ordered.push(item);
  };

  items.forEach(visit);
  return ordered;
}

async function groomBacklog(proposed, openIssues, boardItems) {
  if (!Array.isArray(proposed) || proposed.length === 0) {
    log("info", "Backlog: no tickets proposed.");
    return;
  }

  // Two pools, because the two passes are good at different questions.
  //
  // The token pass only compares against work that is still OPEN or in flight —
  // "is this already queued?" is a question tokens can answer. It deliberately
  // ignores the Done column: that pool only ever grows (108 shipped titles and
  // counting), so including it made every run harder to pass than the last, and
  // the pipeline eventually proposed nothing at all.
  //
  // The model pass sees everything including shipped work, because "have we
  // already built this?" needs judgment about content, not title vocabulary.
  const liveTitles = [
    ...openIssues.map((i) => i.title),
    ...boardItems.filter((i) => i.status !== "Done").map((i) => i.title),
  ].filter(Boolean);
  const allTitles = [
    ...openIssues.map((i) => i.title),
    ...boardItems.map((i) => i.title),
  ].filter(Boolean);

  // Pass 1 — deterministic: drop near-identical titles only, and dedup later
  // proposals against ones already accepted this run.
  const seen = liveTitles.map((title) => ({ title, tokens: titleTokens(title) }));
  const heuristicSurvivors = [];
  for (const item of proposed) {
    if (!item || !item.title || !item.body) continue;
    const match = nearDuplicateOf(item.title, seen);
    if (match) {
      log(
        "info",
        `Backlog: skipping near-duplicate "${item.title}" — ${match.score.toFixed(2)} similar to "${match.title}".`
      );
      continue;
    }
    heuristicSurvivors.push(item);
    seen.push({ title: item.title, tokens: titleTokens(item.title) });
  }

  // Pass 2 — semantic: a model call decides everything ambiguous, including
  // whether a proposal repeats something already shipped.
  const survivors = await filterSemanticDuplicates(heuristicSurvivors, allTitles);

  // Dropping EVERY proposal is a filter symptom, not a finished project — the
  // run just spent a full session generating work and kept none of it. Loud, so
  // the next occurrence is one glance at the summary rather than a forensic dig
  // through the logs.
  if (survivors.length === 0) {
    log(
      "warn",
      `Backlog: all ${proposed.length} proposed ticket(s) were rejected as duplicates and NOTHING was created. ` +
        `That usually means the dedup is miscalibrated rather than that the project is complete — check the ` +
        `skip lines above for what each one matched.`
    );
  }

  // Create dependencies before the tickets that wait on them, so each body can
  // name real issue numbers.
  const numberByTitle = new Map();
  let created = 0;
  // Order first, then truncate: orderByDependencies emits dependencies before
  // the tickets that wait on them, so cutting from the end drops leaves and
  // keeps foundations. Anything cut simply gets reproposed next run.
  const ordered = orderByDependencies(survivors);
  if (ordered.length > MAX_NEW_TICKETS_PER_RUN) {
    log(
      "info",
      `Backlog: ${ordered.length} ticket(s) survived grooming — creating the first ${MAX_NEW_TICKETS_PER_RUN}, ` +
        `the rest can be reproposed next run.`
    );
  }
  for (const item of ordered.slice(0, MAX_NEW_TICKETS_PER_RUN)) {
    // Resolve each declared dependency to an issue number: "#134" points at an
    // existing ticket, anything else at another ticket in this batch. A reference
    // that resolves to nothing is dropped rather than guessed at — a dependency
    // on a ticket that was deduped away is already satisfied by the ticket that
    // survived in its place.
    const deps = [];
    for (const raw of Array.isArray(item.dependsOn) ? item.dependsOn : []) {
      const ref = String(raw).trim();
      const explicit = ref.match(/^#?(\d+)$/);
      const number = explicit ? Number(explicit[1]) : numberByTitle.get(normalizeTitle(ref));
      if (number) deps.push(number);
      else log("info", `Backlog: "${item.title}" references unknown dependency "${ref}" — ignoring it.`);
    }

    const number = createIssue(item.title, formatTicketBody(item, deps));
    if (number) {
      numberByTitle.set(normalizeTitle(item.title), number);
      moveCard(number, "Backlog"); // best-effort; also adds it to the board
      setIssuePriority(number, item.priority || "medium", []);
      recordTicket("created", number, item.title);
      created++;
      if (deps.length) {
        log("info", `Backlog: #${number} "${item.title}" waits on ${deps.map((d) => `#${d}`).join(", ")}.`);
      }
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

  // Measure the live app and exercise its controls. No model is involved, so this
  // runs every time and costs nothing against the daily request cap.
  const review = await withLogGroup("App review", () => reviewApp());
  const appObservations = review || "(no defects measured and nothing broke when exercised)";

  const rawOutput = await withLogGroup("Product Manager", () =>
    runAgent({
      label: "Product Manager",
      systemPrompt: fillTemplate(loadPrompt("product-manager"), {
        VISION: vision,
        BOARD_STATE: boardState,
        APP_OBSERVATIONS: appObservations,
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
  // Full board items, not just titles: grooming needs each item's column to tell
  // shipped work from work still in flight.
  await groomBacklog(data.backlog, remainingOpen, boardItems);

  kickBuilder();
  printRunSummary("Product Manager");
}

// Only groom when RUN, never when imported — the same guard model-probe.mjs and
// curator.mjs use, so agents/dedup-check.mjs can exercise the dedup heuristic
// without spending a model session as a side effect of loading this file.
export { titleTokens };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Product Manager failed: ${err.message || err}`);
    printRunSummary("Product Manager");
    process.exit(1);
  });
}
