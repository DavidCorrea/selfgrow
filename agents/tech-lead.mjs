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
//   3. BLOCKED TICKETS. Work the Devs gave up on twice. "Why did this fail" is a
//      technical question, and it used to be answered by the Product Manager from
//      a title and a failure count. So the Tech Lead diagnoses, on the ticket
//      itself; the Product Manager decides whether it returns smaller or is
//      dropped, because whether it is still worth doing is a product question.
//
// It proposes; it does not act. Everything it decides becomes an ordinary ticket
// that the Product Manager grooms before anyone builds it — including the
// removals, which are the ones that most deserve it.
import { log, recordTicket, errorData } from "./log.mjs";
import { runEntrypoint, runAgent } from "./agent.mjs";
import { loadPrompt, fillTemplate, extractAgentResponse } from "./prompts.mjs";
import { gitExec, ghExec } from "./git.mjs";
import { getBoardSnapshot } from "./board-snapshot.mjs";
import { createIssue, rewriteIssueBody, isBlocked, dependencyLine, criteriaSection, withDiagnosis } from "./backlog.mjs";
import { readSources, renderManifest, formatSources, readSelfTest, readAgentTools } from "./product-source.mjs";
import { moveCard } from "./board.mjs";
import { readVision } from "./wiki.mjs";
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
      ghExec(["run", "list", "--workflow", "tech-lead.yml", "--status", "success", "--limit", "2", "--json", "createdAt"])
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
    const range = `--since=${since}`;
    const commits = gitExec(["log", range, "--no-merges", "--format=%h %s", "--", "docs/"]);
    const files = gitExec(["log", range, "--no-merges", "--name-only", "--format=", "--", "docs/"])
      .split("\n").map((f) => f.trim()).filter(Boolean);
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
    // The diagnosis is written back onto the whole body, never the prompt's cut.
    fullBody: issue.body || "",
  }));
}

function renderBlocked(blocked) {
  if (!blocked.length) return "(nothing is parked — the Devs are shipping what they pick up)";
  return blocked
    .map((t) => `### #${t.number} — ${t.title}\n${t.body}`)
    .join("\n\n");
}

// How urgent the Tech Lead thinks each kind of proposal is. A view for the
// Product Manager to weigh, not a priority: structural work and removals should
// fill the gaps between work that makes the product better, while a feature
// nothing can catch misbehaving is a live risk rather than housekeeping. An
// interface defect is either, depending on whether it locks someone out.
const URGENCY_BY_KIND = {
  coverage: "Urgency: a coverage gap — a live risk, not housekeeping.",
  shape: "Urgency: structural — worth doing between work that makes the product better, not ahead of it.",
  interface: "Urgency: an interface defect already on the page — a barrier locks someone out; polish can wait for a gap.",
};

/**
 * File a proposal as an ordinary ticket. It arrives ungroomed, so nothing builds
 * it until the Product Manager has said what it means for the product and set
 * its priority.
 */
function fileProposal(item, dependsOn = []) {
  const body = [
    String(item.body).trim(),
    criteriaSection(item.acceptanceCriteria),
    dependencyLine(dependsOn),
    URGENCY_BY_KIND[item.kind] || "",
    "_Proposed by the Tech Lead, who reads the whole codebase rather than one ticket._",
  ].filter(Boolean).join("\n\n");

  const number = createIssue(item.title, body);
  if (!number) return null;
  moveCard(number, "Backlog");
  recordTicket("created", number, item.title);
  return number;
}

// The thread this role remembers itself in.
const JOURNAL = "Tech Lead — log";

/**
 * The parked-ticket diagnoses, one line each, for the journal.
 *
 * Kept to number + recommendation rather than the reasoning: the reasoning is on
 * the ticket, and what a future review needs is "have I diagnosed this before,
 * and which way did I lean".
 */
function renderDiagnoses(diagnoses) {
  return (Array.isArray(diagnoses) ? diagnoses : [])
    .filter((entry) => Number(entry?.number))
    .map((entry) => `#${Number(entry.number)} ${entry.recommendation || "no recommendation"}`)
    .join("; ");
}

/**
 * Write each diagnosis onto its parked ticket, where the Product Manager reads
 * it. Nothing is closed or filed here: returning a ticket or dropping it is the
 * Product Manager's decision.
 */
function recordDiagnoses(diagnoses, blocked) {
  const parked = new Map(blocked.map((ticket) => [ticket.number, ticket]));
  const today = new Date().toISOString().slice(0, 10);
  let recorded = 0;
  for (const entry of Array.isArray(diagnoses) ? diagnoses : []) {
    const ticket = parked.get(Number(entry?.number));
    if (!ticket || !entry.diagnosis) continue;
    if (rewriteIssueBody(ticket.number, withDiagnosis(ticket.fullBody, entry, today))) recorded++;
  }
  if (recorded) log("info", `Diagnosed ${recorded} parked ticket(s) for the Product Manager.`);
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
  // a diagnosis — so a thin product skips the review and keeps the triage.
  if (sources.length < MIN_FILES_TO_REVIEW && !blocked.length) {
    log("info", `Only ${sources.length} shipped file(s) and nothing parked — nothing to review yet.`);
    return;
  }

  // Its own past reviews. This role diagnoses parked tickets, and without a
  // record it can lean the opposite way next week on the same ticket and never
  // know it did.

  const past = readJournal(JOURNAL);

  const rawOutput = await runAgent({
    label: "Tech Lead",
    systemPrompt: fillTemplate(loadPrompt("tech-lead"), {
      VISION: readVision(),
      MANIFEST: renderManifest(sources, changes.changedFiles),
      SOURCES: formatSources(sources, changes.changedFiles),
      CHANGES: renderChanges(since, changes),
      SELFTEST: readSelfTest() || "(the product ships no self-check suite yet)",
      AGENT_TOOLS: readAgentTools() || "(the product declares no agent tools yet)",
      BLOCKED: renderBlocked(blocked),
      BOARD_STATE: boardState,
      PAST: past.length ? past.join("\n\n") : "(nothing recorded yet — this is the first review)",
      // Structural decisions it might otherwise propose undoing. Most of what is
      // in Decisions is about the harness, which is exactly this role's subject.
      DECISIONS: renderDecisions(readDecisions()),
    }),
    tools: ["read"],
    // The Reviewer checks these rules only on the lines a change touches, so a
    // violation already in docs/ is never looked at again unless someone here
    // files it.
    skills: ["web-interface-guidelines"],
  });

  const parsed = extractAgentResponse("Tech Lead", rawOutput, { requireOutcome: false });
  if (!parsed) {
    return;
  }
  log("info", `Tech Lead: ${parsed.summary || ""}`);

  recordDiagnoses(parsed.data?.blocked, blocked);

  const proposals = (Array.isArray(parsed.data?.proposals) ? parsed.data.proposals : [])
    .filter((p) => p && p.title && p.body);
  if (proposals.length > MAX_PROPOSALS) {
    log("warn", `Tech Lead proposed ${proposals.length} changes — keeping the first ${MAX_PROPOSALS}; reshaping much at once is hard to review and harder to undo.`);
  }
  for (const item of proposals.slice(0, MAX_PROPOSALS)) fileProposal(item);
  if (!proposals.length) log("info", "Tech Lead: the codebase is sound as it stands — nothing proposed.");

  // What this review concluded, for the next one to read. Diagnoses are the part
  // worth remembering: without a record this role can lean the opposite way next
  // week on the same ticket and never know it did.
  appendJournal(
    JOURNAL,
    renderJournalEntry({
      decided: proposals.length
        ? proposals.slice(0, MAX_PROPOSALS).map((p) => `"${p.title}"`).join("; ")
        : "Nothing proposed — the codebase is sound as it stands",
      because: parsed.summary || "",
      extra: {
        Diagnoses: renderDiagnoses(parsed.data?.blocked),
      },
    })
  );

}

// Only review when RUN, never when imported, so the file-selection helpers can be
// exercised without spending a session on the model.

runEntrypoint(import.meta.url, "Tech Lead", main);
