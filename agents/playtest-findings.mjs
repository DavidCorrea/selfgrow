// PLAYTEST FINDINGS — what happens to a finding after the Playtester files it.
//
// A finding used to end the moment the Product Manager read it: it answered with
// a few tickets and closed the original in the same run. Nothing ever asked
// whether those tickets fixed what the Playtester saw. On the last product the
// Playtester filed "The visual canvas is a dark void" five times over five
// weeks; each time the PM answered with two to four small tickets and retired
// the finding, every one of those tickets shipped, and the Playtester's verdict
// did not change once. "The tickets closed" had quietly become the definition of
// "the experience improved", and only the Playtester could tell the two apart.
//
// So a finding now lives until the one role that saw the problem says it is
// gone:
//
//   untriaged — filed, nobody has answered it. The PM answers it or drops it.
//   answered  — the PM filed tickets for it. It stays open, records which
//               tickets they were, and the next Playtester session is shown it
//               and must say `verified` (it closes as completed) or `persisting`.
//   escalated — it persisted after its whole answer had landed, ESCALATE_AFTER
//               times. It goes back to the PM marked as a failed approach, and
//               stays marked until it is verified, so the PO sees it too.
//
// Every stage is derived from labels and one body line, like `waiting` and the
// `Blocked by:` line: nothing here keeps state of its own, so nothing can drift.
import {
  log,
  ghExec,
  errorData,
  labelNames,
  editIssueLabels,
  rewriteIssueBody,
  commentIssue,
  isPlaytestFeedback,
  PLAYTEST_LABEL,
} from "./shared.mjs";

export const ANSWERED_LABEL = "answered";
export const ESCALATED_LABEL = "escalated";
const PERSISTED_LABEL_RE = /^persisted:(\d+)$/;

// How many sessions a finding may persist after its answer has landed before the
// answer is declared the wrong one. Two rather than one because a single session
// is a single opinion from a model that sees two frames: one "still there" can
// be the Playtester's variance, two in a row is the product.
export const ESCALATE_AFTER = Number(process.env.PLAYTEST_ESCALATE_AFTER || 2);

// The body line naming the current answer. One line in the finding's own body,
// the same shape as `Blocked by:`, so the answer travels with the issue and is
// read back from the same listing that carries the finding.
const ANSWERED_BY_LINE_RE = /^[ \t]*answered by[ \t]*:[ \t]*(.+)$/im;

// Every earlier answer to this same finding, which a new answer replaced. Kept
// because the likeliest mistake after an answer fails is prescribing it again,
// and the PM cannot avoid repeating what it cannot see.
const TRIED_BEFORE_LINE_RE = /^[ \t]*tried before[ \t]*:[ \t]*(.+)$/im;

const lineNumbers = (body, re) => {
  const line = (body || "").match(re);
  if (!line) return [];
  return [...new Set((line[1].match(/#(\d+)/g) || []).map((s) => Number(s.slice(1))))];
};

/** The tickets currently recorded as this finding's answer (may be empty). */
export function answeringTickets(issue) {
  return lineNumbers(issue?.body, ANSWERED_BY_LINE_RE);
}

/** The tickets of every earlier answer a newer one replaced (may be empty). */
export function triedBefore(issue) {
  return lineNumbers(issue?.body, TRIED_BEFORE_LINE_RE);
}

// Where the Playtester remembers itself — its verdicts are read here by the
// roles that act on them, not only by the Playtester.
export const PLAYTESTER_JOURNAL = "Playtester — log";

/** A finding the PM has answered and the Playtester has not yet judged. */
export function isAnswered(issue) {
  return isPlaytestFeedback(issue) && labelNames(issue).includes(ANSWERED_LABEL);
}

/** A finding waiting on the PM: never answered, or escalated back to it. */
export function needsAnswer(issue) {
  return isPlaytestFeedback(issue) && !labelNames(issue).includes(ANSWERED_LABEL);
}

export function isEscalated(issue) {
  return isPlaytestFeedback(issue) && labelNames(issue).includes(ESCALATED_LABEL);
}

/** How many sessions this finding has persisted since its current answer landed. */
export function persistCount(issue) {
  for (const name of labelNames(issue)) {
    const match = name.match(PERSISTED_LABEL_RE);
    if (match) return Number(match[1]);
  }
  return 0;
}

const persistedLabel = (count) => `persisted:${count}`;

/** The line an answering ticket carries, so the link reads both ways. */
export function addressesLine(findingNumber) {
  return `Addresses: #${findingNumber}`;
}

/**
 * What answering `issue` with `tickets` changes on it.
 *
 * The persist count starts over: it measures THIS answer, and an escalated
 * finding being answered again is exactly a new approach getting its own tries.
 * `escalated` is deliberately kept — it is cleared only by a verification, so a
 * finding that needed a second approach stays visible as one.
 */
export function planAnswer(issue, tickets) {
  const tried = [...new Set([...triedBefore(issue), ...answeringTickets(issue)])].filter((n) => !tickets.includes(n));
  const lines = [
    `Answered by: ${tickets.map((n) => `#${n}`).join(", ")}`,
    ...(tried.length ? [`Tried before: ${tried.map((n) => `#${n}`).join(", ")}`] : []),
  ];
  const body = (issue.body || "").replace(ANSWERED_BY_LINE_RE, "").replace(TRIED_BEFORE_LINE_RE, "").trim();
  const count = persistCount(issue);
  return {
    body: `${body}\n\n${lines.join("\n")}`,
    add: [ANSWERED_LABEL],
    remove: count ? [persistedLabel(count)] : [],
    comment: [
      `## Answered by the Product Manager`,
      "",
      `Tickets: ${tickets.map((n) => `#${n}`).join(", ")}.`,
      "",
      "_This stays open until the Playtester has played the product with them shipped and says whether what it saw has changed._",
    ].join("\n"),
  };
}

/**
 * What one of the Playtester's follow-ups changes on an answered finding, or null
 * for a status it does not understand.
 *
 * A persisting finding counts against its answer only once that answer has
 * LANDED — no answering ticket still open. Before then nothing has changed for
 * the Playtester to see, and counting it would escalate an answer nobody has
 * tried yet. Closed counts as landed whether the ticket shipped or was retired:
 * either way nothing more of this answer is coming.
 */
export function planFollowUp(issue, { status, note } = {}, openNumbers, { escalateAfter = ESCALATE_AFTER } = {}) {
  const said = String(note || "").trim();
  const kind = String(status || "").toLowerCase().trim();
  if (kind === "verified") {
    return {
      close: true,
      add: [],
      remove: [],
      comment: ["## Verified by the Playtester", "", said || "(no detail given)", "", "_The experience changed, so this is closed as completed._"].join("\n"),
    };
  }
  if (kind !== "persisting") return null;

  const header = ["## Still there — the Playtester", "", said || "(no detail given)", ""];
  const pending = answeringTickets(issue).filter((n) => openNumbers.has(n));
  if (pending.length) {
    return {
      close: false,
      add: [],
      remove: [],
      comment: [...header, `_Its answer has not fully landed (${pending.map((n) => `#${n}`).join(", ")} still open), so this does not count against it._`].join("\n"),
    };
  }

  const current = persistCount(issue);
  const count = current + 1;
  const remove = current ? [persistedLabel(current)] : [];
  if (count >= escalateAfter) {
    return {
      close: false,
      escalated: true,
      add: [ESCALATED_LABEL, persistedLabel(count)],
      remove: [ANSWERED_LABEL, ...remove],
      comment: [
        ...header,
        `**Escalated.** Its answer shipped and this has persisted ${count} session(s) since. ` +
          "The Product Manager must try a different approach rather than another ticket like the last ones.",
      ].join("\n"),
    };
  }
  return {
    close: false,
    add: [persistedLabel(count)],
    remove,
    comment: [...header, `_Its answer has landed and this persisted (${count} of ${escalateAfter} before it escalates)._`].join("\n"),
  };
}

/** Record `tickets` as the answer to `issue`. Best-effort, like every board write. */
export function answerFinding(issue, tickets) {
  const plan = planAnswer(issue, tickets);
  rewriteIssueBody(issue.number, plan.body);
  editIssueLabels(issue.number, plan);
  commentIssue(issue.number, plan.comment);
  log("info", `Playtest: #${issue.number} answered by ${tickets.map((n) => `#${n}`).join(", ")} — open until the Playtester verifies it.`);
}

/** Apply one of the Playtester's follow-ups. Returns the plan applied, or null. */
export function applyFollowUp(issue, followUp, openNumbers) {
  const plan = planFollowUp(issue, followUp, openNumbers);
  if (!plan) {
    log("warn", `Playtest: ignoring follow-up on #${issue.number} with unknown status "${followUp?.status}".`);
    return null;
  }
  commentIssue(issue.number, plan.comment);
  editIssueLabels(issue.number, plan);
  if (plan.close) {
    try {
      ghExec(["issue", "close", String(issue.number), "--reason", "completed"]);
    } catch (e) {
      log("warn", `Could not close verified finding #${issue.number}.`, errorData(e));
    }
  }
  log("info", `Playtest: #${issue.number} ${plan.close ? "verified and closed" : plan.escalated ? "escalated" : "persisting"}.`);
  return plan;
}

// ---------------------------------------------------------------------------
// Hearing the Playtester — what the roles that act on findings are shown.
//
// The Playtester's verdicts used to reach only its own journal, which no other
// role read, and the Product Owner saw only findings "still untriaged" — a list
// the Product Manager empties every morning, so it was always empty by Monday.
// Five sessions of the same verdict were therefore invisible to the one role
// that decides whether a milestone is done.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const sameTitle = (a, b) => String(a || "").toLowerCase().trim() === String(b || "").toLowerCase().trim();
const numbered = (numbers) => numbers.map((n) => `#${n}`).join(", ");

function findingStage(issue) {
  const answered = labelNames(issue).includes(ANSWERED_LABEL);
  if (isEscalated(issue)) {
    return answered ? "escalated, and answered again with a different approach" : "escalated — no answer so far has fixed it";
  }
  return answered ? "answered, waiting on the Playtester" : "untriaged";
}

/**
 * Every open finding, with how long it has been open, where it stands, and how
 * many sessions it has outlived its answer. Age and persistence are the two
 * facts that tell a complaint the backlog is failing to answer from a new one.
 */
export function renderOpenFindings(openIssues, now = Date.now()) {
  const findings = openIssues.filter(isPlaytestFeedback);
  if (!findings.length) return "(no playtest findings open)";
  return findings
    .map((issue) => {
      const days = issue.createdAt ? Math.floor((now - Date.parse(issue.createdAt)) / DAY_MS) : null;
      const answers = answeringTickets(issue);
      const tried = triedBefore(issue);
      const facts = [
        days === null ? "" : `open ${days} day(s)`,
        findingStage(issue),
        persistCount(issue) ? `persisted ${persistCount(issue)} session(s) since its answer landed` : "",
        answers.length ? `answered by ${numbered(answers)}` : "",
        tried.length ? `earlier answers that did not fix it: ${numbered(tried)}` : "",
      ].filter(Boolean);
      return `- #${issue.number} ${issue.title} — ${facts.join("; ")}`;
    })
    .join("\n");
}

/**
 * The verdict line of each Playtester journal entry, oldest first. Each is the
 * Playtester's own summary of a whole session, and read in a row they show the
 * one thing no single finding can: whether the product is getting better.
 */
export function renderPlaytesterVerdicts(entries) {
  if (!entries.length) return "(the Playtester has no sessions on record)";
  return entries
    .map((entry) => {
      const date = String(entry).match(/^\[([^\]]*)\]/)?.[1] || "undated";
      const verdict = String(entry).match(/\*\*Decided:\*\*\s*([\s\S]*?)(?=\n\*\*|$)/)?.[1].trim();
      return `- ${date}: ${verdict || "(no verdict recorded)"}`;
    })
    .join("\n");
}

/**
 * Closed findings and closed tickets, for telling the PM what earlier answers
 * tried. Throws when either listing fails: an empty history reads as "nothing
 * has been tried", which is precisely the belief that had one complaint answered
 * five times the same way.
 *
 * Titles and close reasons only for the tickets — the question is what was tried
 * and whether it shipped, not how. The limit is a window, not a census: a ticket
 * older than it is named by number alone.
 */
export function fetchAnswerHistory() {
  const list = (argv, what) => {
    try {
      return JSON.parse(ghExec(argv));
    } catch (e) {
      throw new Error(`Could not list ${what}: ${e.message}`, { cause: e });
    }
  };
  const closedFindings = list(
    ["issue", "list", "--state", "closed", "--label", PLAYTEST_LABEL, "--limit", "200", "--json", "number,title,body,stateReason"],
    "closed playtest findings"
  );
  const closedTickets = list(
    ["issue", "list", "--state", "closed", "--limit", "500", "--json", "number,title,stateReason"],
    "closed tickets"
  );
  return { closedFindings, closedTickets: new Map(closedTickets.map((i) => [i.number, i])) };
}

/**
 * The earlier answers to this complaint, and whether each helped: answers to
 * this same finding that a newer one replaced, the answer that just failed if it
 * escalated, and every closed finding filed under the same title — the
 * Playtester reuses a title exactly when a complaint persists, so a same-titled
 * finding is the same complaint coming back.
 */
export function priorAnswers(finding, closedFindings) {
  const rounds = [];
  const tried = triedBefore(finding);
  if (tried.length) rounds.push({ from: finding.number, tickets: tried, outcome: "did not fix it" });
  const current = answeringTickets(finding);
  if (isEscalated(finding) && !isAnswered(finding) && current.length) {
    rounds.push({ from: finding.number, tickets: current, outcome: "shipped, and the Playtester still saw this — escalated" });
  }
  for (const earlier of closedFindings) {
    if (earlier.number === finding.number || !sameTitle(earlier.title, finding.title)) continue;
    const earlierTried = triedBefore(earlier);
    if (earlierTried.length) rounds.push({ from: earlier.number, tickets: earlierTried, outcome: "did not fix it" });
    rounds.push({
      from: earlier.number,
      tickets: answeringTickets(earlier),
      outcome:
        earlier.stateReason === "COMPLETED"
          ? "the Playtester verified it fixed, and the complaint came back anyway"
          : "closed without the Playtester ever confirming it was fixed",
    });
  }
  return rounds;
}

/** priorAnswers as prompt text, naming each ticket and whether it shipped. */
export function renderPriorAnswers(finding, history, openIssues) {
  const rounds = priorAnswers(finding, history.closedFindings);
  if (!rounds.length) return "";
  const open = new Map(openIssues.map((i) => [i.number, i]));
  const describe = (n) => {
    if (open.has(n)) return `#${n} ${open.get(n).title} (not shipped yet)`;
    const closed = history.closedTickets.get(n);
    if (!closed) return `#${n}`;
    return `#${n} ${closed.title} (${closed.stateReason === "COMPLETED" ? "shipped" : "retired"})`;
  };
  const lines = rounds.map((round) => {
    const where = round.from === finding.number ? "On this finding" : `On #${round.from}, an earlier filing of the same complaint`;
    const tickets = round.tickets.length
      ? round.tickets.map(describe).join("; ")
      : "tickets not recorded (answered before answers were tracked)";
    return `- ${where}: ${tickets} — ${round.outcome}.`;
  });
  return ["#### Answered before", ...lines].join("\n");
}

/**
 * The Product Manager handing a finding up instead of answering it again, when
 * it cannot see an approach that differs from what already failed. It stays
 * waiting on the PM, marked so the Product Owner sees it among what holds the
 * milestone open.
 */
export function planEscalation(reason) {
  return {
    add: [ESCALATED_LABEL],
    remove: [],
    comment: [
      "## Escalated by the Product Manager",
      "",
      String(reason || "").trim() || "(no reason given)",
      "",
      "_No answer the Product Manager can see differs enough from what was already tried. Left for the Product Owner to weigh against the milestone and the Vision._",
    ].join("\n"),
  };
}

/** Apply planEscalation. Best-effort, like every board write. */
export function escalateFinding(issue, reason) {
  const plan = planEscalation(reason);
  editIssueLabels(issue.number, plan);
  commentIssue(issue.number, plan.comment);
  log("info", `Playtest: #${issue.number} escalated by the Product Manager.`);
}
