// Labels and ticket state: who filed a ticket, whether it can be built yet, in
// what order, and what happens when it keeps failing.

import { log, errorData } from "./log.mjs";
import { removeCard } from "./board.mjs";
import { ghExec } from "./git.mjs";
import { ghComment } from "./github.mjs";

// ---------------------------------------------------------------------------
// Labels — every label the pipeline applies, and the color it is created in
// ---------------------------------------------------------------------------

// Stamped on every issue the pipeline creates (see createIssue), which makes its
// ABSENCE the reliable marker of a human-filed one. Absence is the better test
// precisely because no human action maintains it: there is no label to forget.
export const AGENT_LABEL = "agent";

// Marks Builder-filed code-health tickets so the PM (and humans) can spot them.
export const TECH_DEBT_LABEL = "tech-debt";

// Priority is expressed as a single label so it shows on board cards and is
// visible to the Builder via the issue's labels.
export const PRIORITY_LABELS = { high: "priority:high", medium: "priority:medium", low: "priority:low" };

// The Product Manager's mark that a ticket is ready to build: it says what the
// player gets, how to tell it shipped, and where it sits in the queue. Only the
// PM's run applies it (see product-manager.mjs). Everyone else — the Tech Lead,
// the Builder's tech debt, the Playtester, a person — files tickets without it.
//
// Before this, any open ticket was buildable the moment it was filed. A Tech Lead
// ticket filed on Thursday morning could be built that afternoon with no
// priority and no player-facing description, and tickets written from the App
// Review read like the checker — selectors and CSS properties as acceptance
// criteria — because nothing stood between whoever filed them and the Devs.
export const GROOMED_LABEL = "groomed";

// Shown on tickets whose prerequisites haven't shipped, so the board answers
// "why isn't this moving?" at a glance instead of only inside the issue body.
// Distinct from BLOCKED_LABEL ("parked, it keeps failing") — this one is normal.
const WAITING_LABEL = "waiting";

// A ticket the Builder failed to ship too many times, parked so the Scout stops
// re-picking it (see recordTicketFailure). `attempts:N` counts the failures.
const BLOCKED_LABEL = "blocked";
const ATTEMPTS_LABEL_RE = /^attempts:(\d+)$/;

// Not every issue is work.
//
// The pipeline files three kinds of issue that describe something rather than
// ask for it, and the Devs must never pick one up and try to build it:
//
//   playtest — an experience the Playtester had ("the page felt static for the
//              first minute"). The Product Manager answers each with real
//              tickets, or drops it; an answered one stays open until the
//              Playtester says whether the experience changed.
//   health   — a diagnostic about the PIPELINE, addressed to whoever maintains
//              it. Nothing in docs/ can fix "the changelog stopped growing".
//   digest   — the weekly report.
//
// The last two are now published as Discussions rather than issues, which is a
// better fit and removes the problem at the source. These stay because issues
// filed under the old behaviour are still open, and because a label can always be
// added by hand — a guard that costs a set lookup is cheaper than the build it
// would otherwise waste.
//
// Left buildable, each is a ticket the Devs engage, fail to satisfy, and
// eventually park — spending two builds to discover the issue was never a
// request.
export const PLAYTEST_LABEL = "playtest";
const HEALTH_LABEL = "health";
const DIGEST_LABEL = "digest";

// The color each label is created in, whichever code path adds it first: the
// creation uses --force, so a label first added with the wrong color would keep it.
const LABEL_COLORS = {
  [TECH_DEBT_LABEL]: "d4c5f9",
  [PRIORITY_LABELS.high]: "d73a4a",
  [PRIORITY_LABELS.medium]: "fbca04",
  [PRIORITY_LABELS.low]: "0e8a16",
  [GROOMED_LABEL]: "0075ca",
  // Muted grey-blue: waiting is a normal state, not a warning.
  [WAITING_LABEL]: "c5def5",
  [BLOCKED_LABEL]: "b60205",
};
const ATTEMPTS_COLOR = "e4b8b8";
const DEFAULT_LABEL_COLOR = "ededed";

function labelColor(name) {
  if (ATTEMPTS_LABEL_RE.test(name)) return ATTEMPTS_COLOR;
  return LABEL_COLORS[name] ?? DEFAULT_LABEL_COLOR;
}

/** An issue's label names as plain strings (gh returns objects; humans add strings). */
export function labelNames(issue) {
  return (issue?.labels || []).map((l) => l.name || l);
}

/**
 * An issue a person filed, rather than the pipeline.
 *
 * Note the direction: this is not a label anyone adds, it is one the agents add
 * to their own. A ticket nobody stamped came from outside.
 */
export function isManualIssue(issue) {
  return !labelNames(issue).includes(AGENT_LABEL);
}

/**
 * Rewrite a ticket's body — how the Product Manager sharpens a human request
 * into something buildable instead of closing it for being unclear, and how a
 * playtest finding records the tickets that answered it.
 */
export function rewriteIssueBody(issueNumber, body) {
  try {
    ghExec(["issue", "edit", String(issueNumber), "--body-file", "-"], { input: body });
    log("info", `Rewrote the body of #${issueNumber}.`);
    return true;
  } catch (e) {
    log("warn", `Could not rewrite the body of #${issueNumber}.`, errorData(e));
    return false;
  }
}

/**
 * True when an open ticket already carries this title, whatever state it is in.
 *
 * Pass the WHOLE open board, not the buildable candidates. The Devs used to check
 * only the tickets offered to the Scout, and a tech-debt ticket filed earlier is
 * rarely among them — it is unprioritized, waiting on something, parked, or
 * claimed by an open PR — so the same debt was filed again on every merge that
 * noticed it.
 */
export function isAlreadyTracked(title, openIssues) {
  const wanted = (title || "").toLowerCase().trim();
  return openIssues.some((issue) => (issue.title || "").toLowerCase().trim() === wanted);
}

const _ensuredLabels = new Set();
function ensureLabel(name) {
  if (_ensuredLabels.has(name)) return;
  _ensuredLabels.add(name);
  try {
    ghExec(["label", "create", name, "--color", labelColor(name), "--force"]);
  } catch {
    // exists / no perms — non-fatal
  }
}

/**
 * Add and remove labels on an issue in one edit, creating any added label first —
 * `gh issue edit --add-label` refuses a label the repository does not have yet.
 * Best-effort; returns whether the edit landed. `failure` is what the log says
 * when it does not.
 */
export function editIssueLabels(issueNumber, { add = [], remove = [], failure = `Could not relabel #${issueNumber}.` } = {}) {
  add.forEach(ensureLabel);
  const edits = [...add.flatMap((name) => ["--add-label", name]), ...remove.flatMap((name) => ["--remove-label", name])];
  if (!edits.length) return true;
  try {
    ghExec(["issue", "edit", String(issueNumber), ...edits]);
    return true;
  } catch (e) {
    log("warn", failure, errorData(e));
    return false;
  }
}

/**
 * Create a new issue (body piped over stdin for safety). Always carries the
 * `agent` label; pass extra labels (e.g. tech-debt) as the third arg. Ensures
 * each label exists first. Returns the new issue number, or null.
 */
export function createIssue(title, body, labels = []) {
  const all = [AGENT_LABEL, ...labels];
  all.forEach(ensureLabel);
  const labelArgs = all.flatMap((l) => ["--label", l]);
  try {
    const out = ghExec(
      ["issue", "create", "--title", String(title), ...labelArgs, "--body-file", "-"],
      { input: body || "" }
    ).trim();
    const match = out.match(/\/issues\/(\d+)/);
    const number = match ? Number(match[1]) : null;
    log("info", `Created issue #${number}: ${title}`);
    return number;
  } catch (e) {
    log("warn", `Could not create issue "${title}"`, errorData(e));
    return null;
  }
}

/** Ensure the priority labels and the `agent` marker label exist. Best-effort, idempotent. */
export function ensurePriorityLabels() {
  [...Object.values(PRIORITY_LABELS), AGENT_LABEL, WAITING_LABEL, GROOMED_LABEL].forEach(ensureLabel);
}

/**
 * Set an issue's priority to a single level, clearing any other priority label.
 * `currentLabels` is the issue's existing label names (so we only remove ones
 * actually present). Best-effort; returns boolean.
 */
export function setIssuePriority(issueNumber, priority, currentLabels = []) {
  const target = PRIORITY_LABELS[priority];
  if (!target) {
    log("warn", `Priority: unknown level "${priority}" for #${issueNumber}.`);
    return false;
  }
  const remove = Object.values(PRIORITY_LABELS).filter((label) => label !== target && currentLabels.includes(label));
  const landed = editIssueLabels(issueNumber, { add: [target], remove, failure: `Could not set priority on #${issueNumber}.` });
  if (landed) log("info", `Priority: #${issueNumber} → ${priority}.`);
  return landed;
}

// ---------------------------------------------------------------------------
// Failure tracking — stop the Builder re-picking tickets it can't ship
//
// A ticket the Builder repeatedly abandons would otherwise be picked again every
// run (the Scout always takes the highest-priority open ticket), starving the
// whole backlog. We count failed attempts on the issue itself (an `attempts:N`
// label) and, once it crosses a threshold, park it with `blocked` — the Builder
// skips blocked tickets, and the Product Manager splits or retires them.
// ---------------------------------------------------------------------------

/** Cumulative failed-attempt count the Builder has recorded on an issue (0 if none). */
export function attemptCount(issue) {
  for (const name of labelNames(issue)) {
    const m = name.match(ATTEMPTS_LABEL_RE);
    if (m) return Number(m[1]);
  }
  return 0;
}

export function isBlocked(issue) {
  return labelNames(issue).includes(BLOCKED_LABEL);
}

const DIAGNOSIS_HEADING = "## Tech Lead diagnosis";

/**
 * A parked ticket's body with the Tech Lead's diagnosis as its last section,
 * replacing any earlier one: the Product Manager decides from the latest
 * reading, and a stack of old ones would read as several opinions.
 */
export function withDiagnosis(body, { diagnosis, recommendation, smallerPiece }, date) {
  const original = String(body || "");
  const cut = original.indexOf(DIAGNOSIS_HEADING);
  const kept = (cut === -1 ? original : original.slice(0, cut)).trimEnd();
  const section = [
    `${DIAGNOSIS_HEADING} (${date})\n${String(diagnosis || "").trim()}`,
    `**Recommendation:** ${String(recommendation || "").trim()}`,
    smallerPiece ? `**Smaller piece:** ${String(smallerPiece).trim()}` : "",
  ].filter(Boolean).join("\n\n");
  return kept ? `${kept}\n\n${section}` : section;
}

export function hasDiagnosis(issue) {
  return String(issue?.body || "").includes(DIAGNOSIS_HEADING);
}

// ---------------------------------------------------------------------------
// Ticket dependencies
//
// A ticket declares what must ship before it, as one line in its body:
//   Blocked by: #134, #135
//
// This is deliberately NOT the `blocked` label, which means something else:
// "parked after failing repeatedly, a human or the PM should split it". A ticket
// waiting its turn hasn't failed at all, and marking it blocked would invite the
// PM to retire work that is perfectly good and simply not ready yet.
//
// A dependency counts as met once its issue is closed as shipped, so the ordering
// resolves itself as the Builder ships: no state to maintain, and the whole graph
// is visible in the issue body a human reads.
//
// Closed as NOT PLANNED is not shipped. A retired prerequisite used to release
// everything waiting on it — including when the PM split it into pieces none of
// which had shipped yet — so the dependant was built on a foundation that did
// not exist. It now stays waiting, and the board tells whoever reads it which
// prerequisite was retired, so the PM can re-scope or retire the dependant
// rather than leave it stranded.
// ---------------------------------------------------------------------------

const DEPENDS_ON_LINE_RE = /^[ \t]*(?:blocked by|depends on)[ \t]*:[ \t]*(.+)$/im;

/** Issue numbers this ticket declares it must wait for (may be empty). */
export function dependencyNumbers(issue) {
  const line = (issue?.body || "").match(DEPENDS_ON_LINE_RE);
  if (!line) return [];
  const found = line[1].match(/#(\d+)/g) || [];
  return [...new Set(found.map((s) => Number(s.slice(1))))].filter((n) => n !== issue?.number);
}

/**
 * Dependencies that haven't shipped yet, given the set of still-open issue
 * numbers. A dependency that is closed as shipped — or that never existed — is
 * treated as met, so a stale reference can never strand a ticket forever. One
 * closed as not planned is unmet: see retiredDependencies.
 *
 * But only once that is confirmed. Absent from the open set used to be enough,
 * and absent is not the same as closed: an issue filed after the listing, or one
 * a listing missed, looked shipped and released everything waiting on it.
 */
export function unmetDependencies(issue, openNumbers, isShipped = isConfirmedShipped) {
  return dependencyNumbers(issue).filter((n) => openNumbers.has(n) || !isShipped(n));
}

/**
 * Dependencies that were closed as not planned. Each one will never ship, so the
 * ticket waiting on it will never be released by the Builder; only re-scoping or
 * retiring the ticket frees it, and that is the PM's call to make.
 */
export function retiredDependencies(issue, openNumbers, isRetired = isConfirmedRetired) {
  return dependencyNumbers(issue).filter((n) => !openNumbers.has(n) && isRetired(n));
}

// Confirmed outcomes only — an issue can be reopened, but a run is short enough
// that one closing mid-run and reopening is not worth a second lookup.
const confirmedOutcomes = new Map();

/**
 * What became of dependency `number`: "shipped" when it closed as anything but
 * not planned, or does not exist at all (either way nothing is left to wait
 * for); "retired" when it closed as not planned; "unconfirmed" when it is open,
 * or when the lookup fails — a dependency nobody could see is one that has not
 * been shown to ship.
 */
function dependencyOutcome(number) {
  if (confirmedOutcomes.has(number)) return confirmedOutcomes.get(number);
  let outcome;
  try {
    const [state, reason] = ghExec(
      ["api", `repos/{owner}/{repo}/issues/${number}`, "--jq", `.state + " " + (.state_reason // "")`],
      { stdio: "pipe" }
    ).trim().split(" ");
    if (state !== "closed") outcome = "unconfirmed";
    else outcome = reason === "not_planned" ? "retired" : "shipped";
  } catch (e) {
    // 404: never existed. 410: deleted. A stale reference, not a blocker.
    outcome = /HTTP (404|410)/.test(`${e.stderr || ""} ${e.message}`) ? "shipped" : "unconfirmed";
    if (outcome === "unconfirmed") log("warn", `Dependencies: could not confirm #${number} has shipped — treating it as unmet.`, errorData(e));
  }
  if (outcome !== "unconfirmed") confirmedOutcomes.set(number, outcome);
  return outcome;
}

export function isConfirmedShipped(number) {
  return dependencyOutcome(number) === "shipped";
}

export function isConfirmedRetired(number) {
  return dependencyOutcome(number) === "retired";
}

// Issues that describe something rather than ask for it — see PLAYTEST_LABEL.
const NON_WORK_LABELS = new Set([PLAYTEST_LABEL, HEALTH_LABEL, DIGEST_LABEL]);

/** An issue that reports something rather than asking for work. */
export function isNonWorkIssue(issue) {
  return labelNames(issue).some((name) => NON_WORK_LABELS.has(name));
}

/**
 * Playtest feedback, which is an observation rather than a ticket — untriaged, or
 * answered and waiting on the Playtester's verdict (see playtest-findings.mjs).
 */
export function isPlaytestFeedback(issue) {
  return labelNames(issue).includes(PLAYTEST_LABEL);
}

/** Groomed by the Product Manager — see GROOMED_LABEL. */
export function isGroomed(issue) {
  return labelNames(issue).includes(GROOMED_LABEL);
}

/**
 * True when the Builder may pick this ticket up now: groomed, not parked, not a
 * report of something, and everything it declared it depends on has shipped.
 */
export function isBuildable(issue, openNumbers, isShipped = isConfirmedShipped) {
  return (
    isGroomed(issue) &&
    !isBlocked(issue) &&
    !isNonWorkIssue(issue) &&
    unmetDependencies(issue, openNumbers, isShipped).length === 0
  );
}

const PRIORITY_RANK = {
  [PRIORITY_LABELS.high]: 0,
  [PRIORITY_LABELS.medium]: 1,
  [PRIORITY_LABELS.low]: 2,
};

/** A ticket's own priority as a sortable rank; unlabelled sorts last. */
export function priorityRank(issue) {
  const names = labelNames(issue);
  for (const [label, rank] of Object.entries(PRIORITY_RANK)) {
    if (names.includes(label)) return rank;
  }
  return 3;
}

/**
 * The rank a ticket should be BUILT at: the best priority among itself and
 * everything that transitively waits on it.
 *
 * A blocker is worth exactly what it unblocks. #170 is priority:low but gates
 * #171 -> #172 -> #173, all priority:high, so on its own label it sorts behind
 * every trivial ticket on the board — and the three tickets that actually matter
 * stay unreachable while the pipeline ships peripheral work. Rank it as high and
 * the chain starts moving.
 *
 * Deliberately does NOT relabel the ticket. The label is what a human said this
 * work is worth; this is only the order to do it in, and conflating the two would
 * quietly rewrite the roadmap on the board.
 */
export function effectivePriorityRank(issue, openIssues) {
  let best = priorityRank(issue);
  const seen = new Set([issue.number]);
  let frontier = new Set([issue.number]);
  // Widen a level at a time: dependents of the ticket, then their dependents.
  // Cycles are possible in hand-written "Blocked by:" lines, so `seen` guards
  // termination rather than assuming the graph is acyclic.
  while (frontier.size && best > 0) {
    const next = new Set();
    for (const candidate of openIssues) {
      if (seen.has(candidate.number)) continue;
      if (!dependencyNumbers(candidate).some((dep) => frontier.has(dep))) continue;
      seen.add(candidate.number);
      best = Math.min(best, priorityRank(candidate));
      next.add(candidate.number);
    }
    frontier = next;
  }
  return best;
}

/** Open tickets that transitively wait on this one, best priority first. */
export function dependentsOf(issue, openIssues) {
  return openIssues
    .filter(
      (other) =>
        other.number !== issue.number &&
        dependencyNumbers(other).includes(issue.number)
    )
    .sort((a, b) => priorityRank(a) - priorityRank(b));
}

/**
 * The open tickets a Builder may take now, best first: ranked by what each one
 * unblocks, not only by its own label, and carrying that list so the Scout — who
 * chooses from labels — can see why a low ticket sorts first. #170 was
 * priority:low and gated a chain of three priority:high tickets; on its label
 * alone it was passed over every time.
 *
 * Ties go to the oldest, so a re-run reaches for the same tickets in the same
 * order. Attempt count is deliberately NOT a tiebreak: hard, foundational tickets
 * are exactly the ones that fail once, and demoting them let every easy
 * peripheral ticket overtake them forever. Perpetual failures are parked at
 * MAX_TICKET_ATTEMPTS instead.
 */
export function rankBuildable(open, { exclude = new Set() } = {}) {
  const openNumbers = new Set(open.map((issue) => issue.number));
  return open
    .filter((issue) => !exclude.has(issue.number) && isBuildable(issue, openNumbers))
    .map((issue) => {
      const unblocks = dependentsOf(issue, open);
      if (!unblocks.length) return issue;
      return {
        ...issue,
        unblocks: unblocks.map((dependent) => ({
          number: dependent.number,
          title: dependent.title,
          priority: labelNames(dependent).find((name) => name.startsWith("priority:")) || "unlabeled",
        })),
      };
    })
    .sort(
      (a, b) =>
        effectivePriorityRank(a, open) - effectivePriorityRank(b, open) ||
        a.number - b.number
    );
}

/**
 * "#n waits on #a, #b" for each ticket held back by an unshipped dependency, so a
 * stuck backlog is diagnosable instead of looking like an empty one.
 */
export function describeWaiting(issues, openNumbers) {
  return issues
    .map((issue) => ({ number: issue.number, deps: unmetDependencies(issue, openNumbers) }))
    .filter((waiting) => waiting.deps.length)
    .map((waiting) => `#${waiting.number} waits on ${waiting.deps.map((dep) => `#${dep}`).join(", ")}`);
}

/**
 * The candidate the Scout named, or null when it named none of them.
 *
 * The Scout is a model, and its `issueNumber` is whatever it wrote: a number, a
 * string, a ticket from memory rather than from the list. Taken on trust, a
 * number outside the list became a stub ticket with an empty body, and the
 * Builder was sent to fix a ticket nobody had offered — possibly one that is
 * parked, claimed by an open PR, or already closed. A numeric string is still
 * the model meaning a number, so it counts.
 */
export function chosenCandidate(issueNumber, candidates) {
  const number = typeof issueNumber === "string" && /^\s*\d+\s*$/.test(issueNumber)
    ? Number(issueNumber)
    : issueNumber;
  if (!Number.isInteger(number)) return null;
  return candidates.find((candidate) => candidate.number === number) || null;
}

/** The `Blocked by:` line for an issue body, or "" when there are no deps. */
export function dependencyLine(numbers) {
  const deps = (numbers || []).filter((n) => Number.isInteger(n) && n > 0);
  return deps.length ? `Blocked by: ${deps.map((n) => `#${n}`).join(", ")}` : "";
}

/** The acceptance criteria as a checklist, or "" when there are none. */
export function criteriaSection(acceptanceCriteria) {
  const criteria = (Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [])
    .map((criterion) => String(criterion).trim())
    .filter(Boolean);
  return criteria.length ? `## Acceptance criteria\n${criteria.map((criterion) => `- [ ] ${criterion}`).join("\n")}` : "";
}

/**
 * A model sends notes as a string or a list; a list stringified as-is joins its
 * items with commas into one unreadable line.
 */
export function notesText(note) {
  return Array.isArray(note)
    ? note.map((item) => `- ${String(item).trim().replace(/^- /, "")}`).join("\n")
    : String(note || "").trim();
}

// Technical detail lives in its own section so the top of a ticket can say what
// the player gets. Tickets used to carry selectors and CSS properties as their
// acceptance criteria, which told the Builder how to satisfy a checker rather
// than what the player should notice.
export function devNotesSection(...notes) {
  const text = notes.map(notesText).filter(Boolean).join("\n\n");
  return text ? `## Dev Notes\n${text}` : "";
}

/**
 * Reconcile the `waiting` label across the open backlog: add it to tickets with
 * unmet dependencies, remove it from tickets that have been released. Derived
 * from the bodies every time rather than tracked, so it cannot drift — and it is
 * removal that matters most, since a stale `waiting` on buildable work would
 * misreport a healthy backlog as a stuck one.
 *
 * Best-effort and quiet: label edits are cosmetic, so a failure never interrupts
 * the caller. Returns the number of labels changed.
 */
export function syncWaitingLabels(openIssues) {
  const issues = Array.isArray(openIssues) ? openIssues : [];
  const openNumbers = new Set(issues.map((i) => i.number));
  let changed = 0;

  for (const issue of issues) {
    const waiting = unmetDependencies(issue, openNumbers).length > 0;
    const labelled = labelNames(issue).includes(WAITING_LABEL);
    if (waiting === labelled) continue;
    const landed = editIssueLabels(issue.number, {
      [waiting ? "add" : "remove"]: [WAITING_LABEL],
      failure: `Could not update the ${WAITING_LABEL} label on #${issue.number}.`,
    });
    if (!landed) continue;
    changed++;
    log("info", waiting
      ? `#${issue.number} labelled ${WAITING_LABEL} (waits on ${unmetDependencies(issue, openNumbers).map((d) => `#${d}`).join(", ")}).`
      : `#${issue.number} released — ${WAITING_LABEL} label removed.`);
  }
  return changed;
}

/**
 * Record that a Builder run failed to ship `issue`. Bumps its `attempts:N`
 * label; once the count reaches `maxAttempts` the ticket is parked (the `blocked`
 * label + demoted to low) so the Scout stops re-picking it and the PM can split
 * or retire it. Best-effort; returns the new attempt count.
 */
export function recordTicketFailure(issue, reason, maxAttempts) {
  const number = issue?.number;
  if (!number) return 0;

  const current = attemptCount(issue);
  const next = current + 1;
  const previousLabel = `attempts:${current}`;
  editIssueLabels(number, {
    add: [`attempts:${next}`],
    remove: current > 0 && labelNames(issue).includes(previousLabel) ? [previousLabel] : [],
    failure: `Could not bump attempt count on #${number}.`,
  });

  if (next >= maxAttempts) {
    parkBlockedTicket(number, next, reason, labelNames(issue));
  } else {
    log("info", `Ticket #${number}: failed attempt ${next}/${maxAttempts}.`);
  }
  return next;
}

function parkBlockedTicket(number, attempts, reason, currentLabels) {
  editIssueLabels(number, { add: [BLOCKED_LABEL], failure: `Could not block #${number}.` });
  // Demote so it sinks even if a human later unblocks it without re-triaging.
  setIssuePriority(number, "low", currentLabels);

  const body = [
    "## ⛔ Parked by the Devs",
    "",
    `The Builder failed to ship this ticket ${attempts} time(s); most recent reason:`,
    "",
    `> ${reason || "no detail"}`,
    "",
    "It's now **blocked** so the Builder stops retrying it. The Tech Lead diagnoses why it failed on Thursday, and the Product Manager then decides whether it returns smaller or is dropped.",
  ].join("\n");
  try {
    ghComment(number, body);
  } catch (e) {
    log("warn", `Could not comment on blocked #${number}.`, errorData(e));
  }
  log("warn", `Ticket #${number} parked as blocked after ${attempts} failed attempt(s).`);
}

/**
 * Close a ticket the Product Manager decided to retire (split/superseded/won't-do).
 *
 * As NOT PLANNED, and off the board. A plain close is "completed", and its card
 * used to be moved to Done — the column the prompts define as already shipped —
 * so every report and every later run read a retirement as work that was built.
 * Removed rather than left in some other column because the board's own
 * automation moves a closed item to Done, and no column means "decided against".
 */
export async function retireIssue(number, reason) {
  const body = ["## Retired by the Product Manager", "", reason || "Superseded or no longer worth building in its current form."].join("\n");
  try {
    ghComment(number, body);
    ghExec(["issue", "close", String(number), "--reason", "not planned"]);
    log("info", `Retired issue #${number}.`);
  } catch (e) {
    log("warn", `Could not retire #${number}.`, errorData(e));
    return;
  }
  removeCard(number);
}
