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
} from "./shared.mjs";

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

// Per-file and total caps on how much source goes into the prompt. Without the
// total, a product with fifty small files would blow the context and the model
// would judge whichever half survived truncation.
const MAX_CHARS_PER_FILE = 4000;
const MAX_CHARS_TOTAL = 24000;

// The self-check suite gets its own, larger allowance. It is read as a whole or
// not at all — judging whether a suite's checks could fail is impossible from a
// truncated third of it, and it is the one file this agent is here to own.
const MAX_SELFTEST_CHARS = 20000;

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

export function formatSources(sources) {
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

  // Nothing to say about the shape of four files, but a parked ticket still needs
  // a verdict — so a thin product skips the review and keeps the triage.
  if (sources.length < MIN_FILES_TO_REVIEW && !blocked.length) {
    log("info", `Only ${sources.length} shipped file(s) and nothing parked — nothing to review yet.`);
    printRunSummary("Tech Lead");
    return;
  }

  const rawOutput = await withLogGroup("Tech Lead", () =>
    runAgent({
      label: "Tech Lead",
      systemPrompt: fillTemplate(loadPrompt("tech-lead"), {
        VISION: readVision(),
        SOURCES: formatSources(sources),
        SELFTEST: readSelfTest() || "(the product ships no self-check suite yet)",
        BLOCKED: renderBlocked(blocked),
        BOARD_STATE: boardState,
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
