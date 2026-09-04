// TECH LEAD — the only agent that looks at the codebase as a whole.
//
// Every other engineering judgement here is scoped to one ticket. The Scout plans
// one, the Builder writes one, the Reviewer reads one diff. Nobody owns the shape
// of the thing they are collectively producing, and it shows: sixteen modules,
// each placed by a role with no memory of the last fifteen decisions.
//
// Three jobs, which are one job seen from three sides — all of them ask "is this
// codebase still able to absorb the next ticket?":
//
//   1. SHAPE. Structure worth changing: a module doing two jobs, duplication that
//      has earned an abstraction, code nothing reaches any more.
//   2. THE TEST SUITE. docs/selftest.js is the only independent judge in the
//      pipeline — it is what can disagree with the Builder for reasons the
//      Builder does not share. It is written incidentally, a few lines at a time,
//      by whoever shipped each feature, and until now nobody had ever read it
//      whole or asked whether its checks could actually fail.
//   3. BLOCKED TICKETS. Work the Devs gave up on twice. "Why did this fail and
//      what should happen to it" is a technical question, and it used to be
//      answered by the Product Manager from a title and a failure count.
//
// It proposes; it does not act. Everything it decides becomes an ordinary ticket
// that goes through the same planning, review and verification as any other
// change — including the removals, which are the ones that most deserve it.
import fs from "fs";
import { execSync } from "child_process";
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
  retireIssue,
  isBlocked,
  dependencyLine,
  errorData,
} from "./shared.mjs";
import {
  readJournal,
  appendJournal,
  renderJournalEntry,
  readDecisions,
  renderDecisions,
} from "./discussions.mjs";

// Never propose more than this in one run. A structural change is disruptive and
// a removal is hard to walk back; a run that rewrites everything at once is
// indistinguishable from a bug.
const MAX_PROPOSALS = 3;

// Below this the product is too thin to have a shape worth discussing — early on
// almost everything is load-bearing, and there is nothing to consolidate.
const MIN_FILES_TO_REVIEW = 4;

const SOURCE_DIR = join(repoRoot, "docs");

// What counts as a unit of shipped work. Markup is deliberately excluded: a page
// is rarely removable on its own, and including it crowds out the code where
// accumulated cruft actually hides.
const SOURCE_EXTENSIONS = /\.(m?js|css)$/;

const SELFTEST_FILE = "selftest.js";

// How much source is INLINED in the prompt. Deliberately modest, because it is
// no longer how the review sees the codebase.
//
// It used to be everything, capped at 24,000 characters — and the product is
// 136,000. Eight of fourteen files were dropped without being named, the largest
// was cut to its first tenth, and the review would conclude the codebase was
// sound having read under a fifth of it. Raising the cap only moves the number at
// which that happens again.
//
// So the prompt carries a complete MANIFEST of what exists — every file, its
// size, its exports — and inlines only the recently changed ones. Everything else
// the review opens for itself with the `read` tool, which it has always had. That
// is how a person would do it: read the map, then open what matters.
const MAX_CHARS_PER_FILE = 6000;
const MAX_INLINED_CHARS = 30000;

// The self-check suite gets its own allowance and is read as a whole. Judging
// whether a suite's checks could fail is impossible from a truncated third of it,
// and it is the one file this agent is here to own.
const MAX_SELFTEST_CHARS = 20000;

/**
 * When this agent last completed a review, so the report below can say what has
 * happened since.
 *
 * Taken from the workflow's own run history rather than a marker file: the run
 * history is already the truth, and a marker is one more thing to write, lose,
 * and disagree with reality. Null on the first ever run, which is correct — the
 * first review has no "since".
 */
function lastReviewedAt() {
  try {
    const runs = JSON.parse(
      execSync(`gh run list --workflow tech-lead.yml --status success --limit 2 --json createdAt`, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      }).toString()
    );
    // [0] is very likely THIS run if it is already recorded, so prefer the one before.
    return runs[1]?.createdAt || runs[0]?.createdAt || null;
  } catch (e) {
    log("warn", "Could not read when the last review ran — treating this as a first look.", errorData(e));
    return null;
  }
}

/**
 * What has landed in the product since the last review: the commits, and the set
 * of files they touched.
 *
 * This does NOT narrow what gets reviewed. Shape is a property of the whole — two
 * modules doing the same job in different words is invisible in a diff, and so is
 * code nothing reaches. It only says where the week's activity was, so a full
 * review can start somewhere useful instead of cold.
 */
function readChanges(since) {
  if (!since) return { summary: null, changedFiles: new Set() };
  try {
    const range = `--since="${since}"`;
    const commits = execSync(`git log ${range} --no-merges --format="%h %s" -- docs/`, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim();
    const files = execSync(`git log ${range} --no-merges --name-only --format="" -- docs/`, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim().split("\n").map((f) => f.trim()).filter(Boolean);
    return { summary: commits || null, changedFiles: new Set(files) };
  } catch (e) {
    log("warn", "Could not read what changed since the last review.", errorData(e));
    return { summary: null, changedFiles: new Set() };
  }
}

function renderChanges(since, { summary, changedFiles }) {
  if (!since) {
    return "This is your first review — everything is new to you. Read the codebase as a whole and judge the shape it has arrived at, rather than looking for what moved.";
  }
  if (!summary) {
    return `Nothing has changed under \`docs/\` since your last review on ${since.slice(0, 10)}. Anything you propose is something an earlier review missed or chose to leave, so hold a higher bar than usual.`;
  }
  return [
    `Since your last review on ${since.slice(0, 10)}:`,
    "",
    summary,
    "",
    `Files touched: ${[...changedFiles].join(", ") || "none"}`,
  ].join("\n");
}

/** Every source file under docs/, deepest paths included, as repo-relative names. */
export function listSourceFiles(dir) {
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
    } else if (SOURCE_EXTENSIONS.test(entry.name) && entry.name !== SELFTEST_FILE) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Read the shipped source. The judgement here is about craft, so it gets the
 * actual code rather than a file listing — a name says almost nothing about
 * whether a module earns its place.
 */
function readSources() {
  return listSourceFiles(SOURCE_DIR).map((path) => {
    let source = "";
    try { source = fs.readFileSync(path, "utf-8"); } catch { /* unreadable — report the name alone */ }
    return { name: relative(repoRoot, path), source };
  });
}

/**
 * Order the source so the most relevant files come first.
 *
 * Recently changed files, then the rest largest-first. Changed files earn the
 * front because they are where a new problem is most likely to be; large files
 * come next because cruft accumulates by volume — a 4,000-line module is a better
 * place to look for two jobs in one file than a 40-line one.
 */
export function prioritizeSources(sources, changedFiles = new Set()) {
  const changed = (file) => changedFiles.has(file.name);
  return [...sources].sort((a, b) => {
    if (changed(a) !== changed(b)) return changed(a) ? -1 : 1;
    return b.source.length - a.source.length;
  });
}

// `export function foo`, `export const bar`, `export class Baz` — enough to say
// what a module offers without reading it. Not a parser, and it does not need to
// be: a missed export costs a line of the map, not a wrong judgement.
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm;

function exportsOf(source) {
  return [...source.matchAll(EXPORT_RE)].map((m) => m[1]);
}

/**
 * Every file in the product, with its size and what it offers.
 *
 * Always complete, whatever the budget. This is what makes "I have not read that
 * file" something the review can know rather than a silent gap: it can see that
 * groundNoise.js exists and exports createGroundNoiseTexture even on a week when
 * nothing inlined it.
 */
export function renderManifest(sources, changedFiles = new Set()) {
  const rows = prioritizeSources(sources, changedFiles).map((file) => {
    const names = exportsOf(file.source);
    const marker = changedFiles.has(file.name) ? " *" : "";
    return `- \`${file.name}\`${marker} — ${file.source.length} chars, exports: ${names.length ? names.join(", ") : "(none)"}`;
  });
  return [
    rows.join("\n"),
    changedFiles.size ? "\n`*` marks a file touched since your last review." : "",
  ].filter(Boolean).join("\n");
}

/**
 * Inline the most relevant source, and say plainly what was left for the review
 * to open itself.
 *
 * The distinction matters more than the budget: a file that is merely NOT INLINED
 * is one the review can still read, while a file it does not know exists is a
 * silent hole it will conclude around. The manifest above covers the second case;
 * this only decides what is convenient to have already.
 */
export function formatSources(sources, changedFiles = new Set()) {
  const ordered = prioritizeSources(sources, changedFiles);
  const blocks = [];
  const notInlined = [];
  let budget = MAX_INLINED_CHARS;

  for (const file of ordered) {
    if (budget <= 0) {
      notInlined.push(file.name);
      continue;
    }
    const body = file.source.slice(0, Math.min(MAX_CHARS_PER_FILE, budget));
    budget -= body.length;
    const truncated = body.length < file.source.length
      ? `\n_(showing the first ${body.length} of ${file.source.length} characters — open the file to see the rest)_`
      : "";
    blocks.push(`### ${file.name}\n\`\`\`\n${body}\n\`\`\`${truncated}`);
  }

  if (notInlined.length) {
    blocks.push(
      `### Not inlined\nThese are in the manifest above but not reproduced here, to keep this readable. ` +
        `Open any of them with the read tool — do NOT judge them unread:\n` +
        notInlined.map((name) => `- ${name}`).join("\n")
    );
  }
  return blocks.join("\n\n");
}

/** The self-check suite, read on its own terms. */
function readSelfTest() {
  try {
    const source = fs.readFileSync(join(SOURCE_DIR, SELFTEST_FILE), "utf-8");
    return source.length > MAX_SELFTEST_CHARS
      ? `${source.slice(0, MAX_SELFTEST_CHARS)}\n\n_(truncated — the suite is ${source.length} characters)_`
      : source;
  } catch {
    return "";
  }
}

/**
 * Tickets the Devs engaged and gave up on. Each carries the reason the last
 * attempt failed, recorded on the issue when it was parked, which is the
 * evidence for deciding what should happen to it.
 */
function readBlockedTickets(openIssues) {
  return openIssues.filter(isBlocked).map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: (issue.body || "").slice(0, 1500),
  }));
}

function renderBlocked(blocked) {
  if (!blocked.length) return "(nothing is parked — the Devs are shipping what they pick up)";
  return blocked
    .map((t) => `### #${t.number} — ${t.title}\n${t.body}`)
    .join("\n\n");
}

/**
 * File a proposal as an ordinary ticket.
 *
 * Structural work and removals are never urgent: they should fill the gaps
 * between the work that makes the product better, not outrank it. The exception
 * is coverage — a feature nothing can catch misbehaving is a live risk, not
 * housekeeping — so those keep the priority the Tech Lead assigned.
 */
function fileProposal(item, dependsOn = []) {
  const criteria = (Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria : [])
    .map((c) => String(c).trim())
    .filter(Boolean);
  const body = [
    String(item.body).trim(),
    criteria.length ? `## Acceptance criteria\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}` : "",
    dependencyLine(dependsOn),
    "_Proposed by the Tech Lead, who reads the whole codebase rather than one ticket._",
  ].filter(Boolean).join("\n\n");

  const number = createIssue(item.title, body);
  if (!number) return null;
  moveCard(number, "Backlog");
  setIssuePriority(number, item.kind === "coverage" ? "medium" : "low", []);
  recordTicket("created", number, item.title);
  return number;
}

/**
 * Act on the verdicts for parked tickets: each is either replaced by a smaller
 * ticket that can actually ship, or dropped. Both close the original — leaving it
 * open just wastes board space, since the Devs will not touch it.
 */
// The thread this role remembers itself in.
const JOURNAL = "Tech Lead — log";

/**
 * The parked-ticket rulings, one line each, for the journal.
 *
 * Kept to number + shape of the ruling rather than the reasoning: the reasoning
 * is already on the ticket, and what a future review needs is "have I ruled on
 * this before, and which way".
 */
function renderRulings(verdicts) {
  return (Array.isArray(verdicts) ? verdicts : [])
    .filter((v) => Number(v?.number))
    .map((v) => `#${Number(v.number)} ${v.replacement?.title ? "returned smaller" : "dropped"}`)
    .join("; ");
}

async function resolveBlocked(verdicts, blocked) {
  const parked = new Set(blocked.map((t) => t.number));
  let handled = 0;

  for (const verdict of Array.isArray(verdicts) ? verdicts : []) {
    const number = Number(verdict?.number);
    if (!parked.has(number)) continue;

    let replacement = null;
    if (verdict.replacement?.title && verdict.replacement?.body) {
      replacement = fileProposal({ ...verdict.replacement, kind: "shape" });
    }
    const reason = replacement
      ? `Parked after repeated failures, and replaced by #${replacement}. ${verdict.reason || ""}`.trim()
      : `Parked after repeated failures and dropped. ${verdict.reason || ""}`.trim();
    await retireIssue(number, reason);
    moveCard(number, "Done");
    recordTicket("retired", number, `#${number}`);
    handled++;
  }
  if (handled) log("info", `Resolved ${handled} parked ticket(s).`);
}

async function main() {
  log("info", "=== Tech Lead — review the codebase ===");

  const sources = readSources();
  const { openIssues, boardState } = getBoardSnapshot();
  const blocked = readBlockedTickets(openIssues);

  const since = lastReviewedAt();
  const changes = readChanges(since);
  log("info", since
    ? `Reviewing everything, starting from the ${changes.changedFiles.size} file(s) touched since ${since.slice(0, 10)}.`
    : "First review — reading the whole codebase cold.");

  // Nothing to say about the shape of four files, but a parked ticket still needs
  // a verdict — so a thin product skips the review and keeps the triage.
  if (sources.length < MIN_FILES_TO_REVIEW && !blocked.length) {
    log("info", `Only ${sources.length} shipped file(s) and nothing parked — nothing to review yet.`);
    printRunSummary("Tech Lead");
    return;
  }

  // Its own past reviews. This role rules on whether a parked ticket comes back,

  // and without a record it can rule the opposite way next week on the same

  // ticket and never know it did.

  const past = readJournal(JOURNAL);


  const rawOutput = await withLogGroup("Tech Lead", () =>
    runAgent({
      label: "Tech Lead",
      systemPrompt: fillTemplate(loadPrompt("tech-lead"), {
        VISION: readVision(),
        MANIFEST: renderManifest(sources, changes.changedFiles),
        SOURCES: formatSources(sources, changes.changedFiles),
        CHANGES: renderChanges(since, changes),
        SELFTEST: readSelfTest() || "(the product ships no self-check suite yet)",
        BLOCKED: renderBlocked(blocked),
        BOARD_STATE: boardState,
        PAST: past.length ? past.join("\n\n") : "(nothing recorded yet — this is the first review)",
        // Structural decisions it might otherwise propose undoing. Most of what is
        // in Decisions is about the harness, which is exactly this role's subject.
        DECISIONS: (() => {
          const decisions = readDecisions();
          return decisions.length ? renderDecisions(decisions) : "(nothing settled yet)";
        })(),
      }),
      tools: ["read"],
    })
  );

  const parsed = extractAgentResponse("Tech Lead", rawOutput, { requireOutcome: false });
  if (!parsed) {
    printRunSummary("Tech Lead");
    return;
  }
  log("info", `Tech Lead: ${parsed.summary || ""}`);

  ensurePriorityLabels();
  await resolveBlocked(parsed.data?.blocked, blocked);

  const proposals = (Array.isArray(parsed.data?.proposals) ? parsed.data.proposals : [])
    .filter((p) => p && p.title && p.body);
  if (proposals.length > MAX_PROPOSALS) {
    log("warn", `Tech Lead proposed ${proposals.length} changes — keeping the first ${MAX_PROPOSALS}; reshaping much at once is hard to review and harder to undo.`);
  }
  for (const item of proposals.slice(0, MAX_PROPOSALS)) fileProposal(item);
  if (!proposals.length) log("info", "Tech Lead: the codebase is sound as it stands — nothing proposed.");

  // What this review concluded, for the next one to read. Rulings are the part
  // worth remembering: this role decides whether a parked ticket comes back, and
  // without a record it can rule the opposite way next week on the same ticket
  // and never know it did.
  appendJournal(
    JOURNAL,
    renderJournalEntry({
      decided: proposals.length
        ? proposals.slice(0, MAX_PROPOSALS).map((p) => `"${p.title}"`).join("; ")
        : "Nothing proposed — the codebase is sound as it stands",
      because: parsed.summary || "",
      extra: {
        Rulings: renderRulings(parsed.data?.blocked),
      },
    })
  );

  printRunSummary("Tech Lead");
}

// Only review when RUN, never when imported, so the file-selection helpers can be
// exercised without spending a session on the model.
export { SOURCE_DIR };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Tech Lead failed: ${err.message || err}`);
    printRunSummary("Tech Lead");
    process.exit(1);
  });
}
