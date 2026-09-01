import { pathToFileURL } from "url";
import { execSync } from "child_process";
import fs from "fs";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
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
  isBuildable,
  triggerWorkflow,
  dependencyLine,
  syncWaitingLabels,
  isPlaytestFeedback,
  isManualIssue,
  rewriteIssueBody,
  repoRoot,
  getCurrentMilestone,
  setIssueMilestone,
} from "./shared.mjs";
import { publishWeeklyReport } from "./weekly-report.mjs";
import { listSourceFiles, formatSources, SOURCE_DIR } from "./tech-lead.mjs";

// The day the Product Manager does more than groom: it also reviews the shipped
// code for what should be REMOVED, and writes the week's report.
//
// Both are weekly rather than daily for the same reason — reading the product's
// whole source costs real prompt weight, and a narrative refresh has nothing new
// to say between merges. 0 is Sunday, which puts the report at the end of the
// week it describes and the curation pass right before the Product Owner reads
// the board on Monday.
const WEEKLY_DAY = Number(process.env.PM_WEEKLY_DAY ?? 0);

const isWeeklyRun = () => new Date().getUTCDay() === WEEKLY_DAY;

// How much title-token similarity counts as a near-duplicate.
//
// This pass catches only NEAR-IDENTICAL titles, and nothing catches anything
// subtler. A model pass used to; it deleted three good tickets in one call and is
// gone (see groomBacklog). Tokens fundamentally cannot tell "a device found in the
// Condenser Gallery" from "the Condenser Gallery" itself, so the threshold is set
// where tokens are actually reliable and everything below it reaches the board —
// where a duplicate costs one grooming pass rather than the work.
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
  triggerWorkflow("devs.yml");
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

async function groomBacklog(proposed, openIssues, boardItems, milestone) {
  if (!Array.isArray(proposed) || proposed.length === 0) {
    log("info", "Backlog: no tickets proposed.");
    return;
  }

  // ONE pass, deterministic, answering only "is this already queued?".
  //
  // There used to be a second, semantic pass: a model call handed the existing
  // titles and every proposal, returning the indexes to delete. It is gone. On
  // 2026-09-01 it dropped all three of the Playtester's first findings-turned-
  // tickets in 5.9 seconds against a board holding one unrelated audio ticket,
  // and because the PM had already closed the originals citing them, the day's
  // feedback was destroyed. On 2026-08-26 the same shape of failure cost three
  // proposals. A judgement that deletes work, cannot be reproduced, and is
  // confidently wrong as cheaply as it is right does not belong in front of the
  // board.
  //
  // What replaces it is nothing, on purpose. A duplicate ticket that reaches the
  // board costs one grooming pass to notice and retire — the PM reads the whole
  // board every morning. A proposal deleted here costs the work itself, and there
  // is no record it existed. Those are not comparable prices.
  //
  // The pool is work still OPEN or in flight, deliberately NOT the Done column:
  // that pool only ever grows (108 shipped titles and counting), so including it
  // made every run harder to pass than the last, and the pipeline eventually
  // proposed nothing at all.
  //
  // "Has this already been BUILT?" is answered in the grooming session itself,
  // which reads docs/ and retires a ticket asking for finished work.
  const liveTitles = [
    ...openIssues.map((i) => i.title),
    ...boardItems.filter((i) => i.status !== "Done").map((i) => i.title),
  ].filter(Boolean);

  // Near-identical titles only (NEAR_DUP_THRESHOLD is 0.9), and later proposals
  // are deduped against ones already accepted this run.
  const seen = liveTitles.map((title) => ({ title, tokens: titleTokens(title) }));
  const survivors = [];
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
    survivors.push(item);
    seen.push({ title: item.title, tokens: titleTokens(item.title) });
  }

  // A filter that rejects EVERYTHING is reporting on itself, not on the backlog.
  // The run just spent a session generating work and would keep none of it, and
  // "the project is complete" is a far less likely explanation than "the
  // comparison is wrong". So the proposals are kept and the filter is what gets
  // doubted. Warned loudly either way: a duplicate reaching the board is cheap to
  // retire, and this line is how the miscalibration gets noticed.
  if (survivors.length === 0 && proposed.length > 0) {
    log(
      "warn",
      `Backlog: the dedup rejected ALL ${proposed.length} proposed ticket(s) — keeping them anyway. ` +
        `A filter that drops everything is miscalibrated rather than a sign the project is finished; ` +
        `check the skip lines above for what each one matched, and retire any real duplicate next run.`
    );
    survivors.push(...proposed.filter((item) => item && item.title && item.body));
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
      // Everything proposed now serves the current milestone — that is the point
      // of having one, and it is what makes progress toward it visible without
      // anything here counting tickets.
      setIssueMilestone(number, milestone?.title);
      recordTicket("created", number, item.title);
      created++;
      if (deps.length) {
        log("info", `Backlog: #${number} "${item.title}" waits on ${deps.map((d) => `#${d}`).join(", ")}.`);
      }
    }
  }
  log("info", `Backlog: created ${created} ticket(s) (${openIssues.length} already open).`);
  // Returned because retirement now depends on it: a run that promised
  // replacements and created none does not get to close the originals.
  return { proposed: proposed.length, created };
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

function readFileSafely(path) {
  try {
    return fs.readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Tickets closed recently, for the week's report.
 *
 * Labels included deliberately: the report distinguishes what a person asked for
 * from what the pipeline proposed, and it does that by the ABSENCE of the `agent`
 * label. Fetch without labels and every shipped ticket looks human-filed.
 */
function fetchClosedIssues(limit = 200) {
  try {
    return JSON.parse(
      execSync(`gh issue list --state closed --limit ${limit} --json number,title,closedAt,labels`, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      }).toString()
    );
  } catch (e) {
    log("warn", "Could not read recently closed tickets.", errorData(e));
    return [];
  }
}

function renderMilestone(milestone) {
  if (!milestone) {
    return "No milestone is set. Propose whatever best serves the Vision, and keep the batch coherent — several tickets pulling in one direction beat the same number pulling in five.";
  }
  return [
    `**${milestone.title}**`,
    milestone.description || "",
    `Progress: ${milestone.closed} shipped, ${milestone.open} still open.`,
  ].filter(Boolean).join("\n\n");
}

function renderCuration(weekly, shippedCode) {
  if (!weekly) {
    return "_Not today — the removal pass runs once a week, and this is not that day. Propose additions only._";
  }
  return shippedCode || "_(the product has shipped no source yet — nothing to curate)_";
}

/**
 * Untriaged Playtester findings, for the grooming prompt.
 *
 * These are impressions of the live app, not tickets — isBuildable excludes
 * them, so they sit on the board until this run turns each into real work or
 * drops it. Either way the original is closed via `retire`, so a finding cannot
 * be re-triaged next week and become a second ticket for the same complaint.
 */
function renderPlaytestFeedback(openIssues) {
  const feedback = openIssues.filter(isPlaytestFeedback);
  if (!feedback.length) return "(no untriaged playtest feedback this run)";
  return feedback
    .map((issue) => `### #${issue.number} — ${issue.title}\n${(issue.body || "").trim()}`)
    .join("\n\n");
}

/**
 * Close the tickets the PM chose to retire (blocked tickets it split or dropped).
 * Returns the set of retired issue numbers. Best-effort.
 */
/**
 * Validate what the PM asked to retire, WITHOUT closing anything yet.
 *
 * Split from the closing half because closing used to run first, before the
 * grooming pass that creates the replacements. On 2026-09-01 that cost the
 * Playtester's first three findings: each was closed with "Replaced by new ticket
 * '...'", the dedup pass then dropped all three proposals, and the run reported
 * success with an empty board. The originals were the only copy of the
 * observation, and the tickets they pointed at never existed.
 *
 * Returns { entries, numbers } — the retirements to execute later, and the set of
 * numbers grooming should treat as already gone so they don't skew its dedup pool.
 */
function planRetirements(retire, openIssues = []) {
  const entries = (Array.isArray(retire) ? retire : [])
    .map((item) => ({
      number: Number(typeof item === "object" && item ? item.number : item),
      reason: typeof item === "object" && item ? item.reason : null,
      outOfScope: Boolean(typeof item === "object" && item && item.outOfScope),
    }))
    .filter((entry) => Number.isInteger(entry.number) && entry.number > 0);
  const byNumber = new Map(openIssues.map((issue) => [issue.number, issue]));
  const allowed = [];

  for (const { number, reason, outOfScope } of entries) {
    // A person's request is not the pipeline's to quietly discard.
    //
    // Grooming is told to retire anything it cannot describe concretely, and a
    // terse issue filed by a human at midnight is exactly that shape — so the one
    // channel for getting work into this system had a silent drop at the end of
    // it. Closing a human ticket now requires saying it is out of scope, which is
    // a judgement about the REQUEST; "I could not tell what you meant" is a
    // judgement about the wording, and the answer to that is to sharpen it.
    if (isManualIssue(byNumber.get(number) || {}) && !outOfScope) {
      log(
        "error",
        `Refusing to retire #${number}: it was filed by a person, and the Product Manager ` +
          "did not mark it out of scope. A human ticket that is merely unclear must be sharpened, not closed."
      );
      continue;
    }
    allowed.push({ number, reason, issue: byNumber.get(number) });
  }
  return { entries: allowed, numbers: new Set(allowed.map((e) => e.number)) };
}

/**
 * Close what planRetirements approved — unless this run's grooming produced
 * nothing.
 *
 * A grooming pass that proposed work and created NONE of it has had only its
 * destructive half survive: the reorganisation it planned (retire these, create
 * those) is now half a plan, and the half that remains deletes information. So it
 * closes nothing, and everything it wanted to retire comes back next run at the
 * cost of one grooming pass.
 *
 * Deliberately coarse. It also holds back retirements that had nothing to do with
 * a replacement — an out-of-scope closure, say — because telling them apart means
 * parsing the PM's prose for which ticket it meant, and a retirement deferred by a
 * day costs nothing while a destroyed observation is unrecoverable. The asymmetry
 * decides it.
 */
async function executeRetirements({ entries }, { proposed = 0, created = 0 } = {}) {
  if (!entries.length) return new Set();

  if (proposed > 0 && created === 0) {
    log(
      "error",
      `Refusing to retire ${entries.length} ticket(s) (${entries.map((e) => `#${e.number}`).join(", ")}): ` +
        `this run proposed ${proposed} replacement ticket(s) and created none of them, so closing these would ` +
        `delete the only copy of what they say and point at work that does not exist. They stay open for the ` +
        `next run.`
    );
    return new Set();
  }

  const retired = new Set();
  for (const { number, reason, issue } of entries) {
    // Everything the PM closes arrives here — a ticket split into pieces, one
    // asking for finished work, one out of scope, a parked ticket it gave up on,
    // and a triaged playtest finding. They used to close with the same note,
    // which told anyone reading a triaged finding that it had "repeatedly failed
    // to ship" — the opposite of what happened to it. The PM now says why, and
    // the fallbacks below only cover a PM that didn't.
    await retireIssue(number, reason || defaultRetireReason(issue));
    moveCard(number, "Done"); // reflect the closure on the board (best-effort)
    // The issue's TITLE, not its number again. This printed "Retired — #522 #522"
    // in every run summary, which reads as a bug in the numbering.
    recordTicket("retired", number, issue?.title || `#${number}`);
    retired.add(number);
  }
  if (retired.size) log("info", `Retired ${retired.size} ticket(s).`);
  return retired;
}

/**
 * Rewrite the human-filed tickets the Product Manager found too vague to build,
 * instead of closing them.
 *
 * The body it returns replaces the original, so the ticket keeps its number, its
 * author and its place on the board — the person who filed it sees their request
 * become buildable rather than see it closed.
 */
function sharpenTickets(sharpen, openIssues = []) {
  const byNumber = new Map(openIssues.map((issue) => [issue.number, issue]));
  let count = 0;
  for (const item of Array.isArray(sharpen) ? sharpen : []) {
    const number = Number(item?.number);
    const issue = byNumber.get(number);
    if (!issue || !item?.body) continue;
    // Only ever applied to human tickets. The pipeline's own are the PM's to
    // write correctly in the first place, and rewriting one would silently
    // discard whatever the agent that filed it recorded there.
    if (!isManualIssue(issue)) {
      log("warn", `Not sharpening #${number}: the pipeline wrote it, so rewriting it would lose what it recorded.`);
      continue;
    }
    const body = [
      String(item.body).trim(),
      Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length
        ? `## Acceptance criteria\n${item.acceptanceCriteria.map((c) => `- [ ] ${String(c).trim()}`).join("\n")}`
        : "",
      "_Filed by a person and sharpened by the Product Manager into something the Devs can build. The original request is in the history._",
    ].filter(Boolean).join("\n\n");
    if (rewriteIssueBody(number, body)) count++;
  }
  if (count) log("info", `Sharpened ${count} human-filed ticket(s).`);
}

/** Used only when the Product Manager closes a ticket without saying why. */
function defaultRetireReason(issue) {
  if (isPlaytestFeedback(issue || {})) {
    return "Triaged by the Product Manager — this playtest finding has been read, and either became a ticket of its own or was judged not worth acting on.";
  }
  return "Retired by the Product Manager — superseded, out of scope, or already built.";
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

  const milestone = getCurrentMilestone();
  log("info", milestone
    ? `Working toward "${milestone.title}" (${milestone.closed} shipped, ${milestone.open} open).`
    : "No milestone set — the Product Owner sets one each Monday.");

  // Curation is weekly, because it is the one part of grooming that needs the
  // product's whole source in the prompt. On other days the section says so, and
  // the run stays cheap.
  const weekly = isWeeklyRun();
  const shippedCode = weekly
    ? formatSources(
        listSourceFiles(SOURCE_DIR).map((path) => ({
          name: path.replace(`${SOURCE_DIR}/`, "docs/"),
          source: readFileSafely(path),
        }))
      )
    : "";

  const rawOutput = await withLogGroup("Product Manager", () =>
    runAgent({
      label: "Product Manager",
      systemPrompt: fillTemplate(loadPrompt("product-manager"), {
        VISION: vision,
        MILESTONE: renderMilestone(milestone),
        BOARD_STATE: boardState,
        APP_OBSERVATIONS: appObservations,
        PLAYTEST_FEEDBACK: renderPlaytestFeedback(openIssues),
        CURATION: renderCuration(weekly, shippedCode),
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
  // 1. Decide what to retire, but do not close it yet. Closing runs LAST, because
  //    a retirement is usually justified by a replacement the grooming pass has
  //    not created yet — see executeRetirements.
  const planned = planRetirements(data.retire, openIssues);
  // Sharpen before triage, so a rewritten ticket is prioritized as what it has
  // become rather than as the one-liner it arrived as.
  sharpenTickets(data.sharpen, openIssues);
  // Tickets on their way out are excluded from the pool grooming dedups against,
  // exactly as they were when this ran before grooming — a proposal that replaces
  // a ticket must not be rejected as a duplicate of the ticket it replaces.
  const remainingOpen = openIssues.filter((i) => !planned.numbers.has(i.number));
  // 2. Triage + prioritize existing open tickets (pull inbound onto the board).
  triageExisting(remainingOpen, boardItems, data.triage);
  // 3. Create new prioritized tickets toward the vision.
  // Full board items, not just titles: grooming needs each item's column to tell
  // shipped work from work still in flight.
  const groomed = await groomBacklog(data.backlog, remainingOpen, boardItems, milestone);
  // 4. Now close the originals — only if the replacements actually landed.
  await executeRetirements(planned, groomed);

  kickBuilder();

  // The week's report goes out last, so it describes a board this run has already
  // finished grooming. Best-effort: a failed report must never cost the day's
  // building.
  if (weekly) {
    try {
      await publishWeeklyReport({
        closed: fetchClosedIssues(),
        open: fetchOpenIssues(200),
        milestone,
      });
    } catch (e) {
      log("warn", "Weekly report: could not publish.", errorData(e));
    }
  }

  printRunSummary("Product Manager");
}

// Only groom when RUN, never when imported — the same guard tech-lead.mjs uses,
// so agents/dedup-check.mjs can exercise the dedup heuristic
// without spending a model session as a side effect of loading this file.
// planRetirements and executeRetirements are exported for the test suite: the
// invariant they hold — nothing is closed by a run that created no replacement —
// is worth asserting directly, and the incident it came from was silent.
export { titleTokens, planRetirements, executeRetirements };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Product Manager failed: ${err.message || err}`);
    printRunSummary("Product Manager");
    process.exit(1);
  });
}
