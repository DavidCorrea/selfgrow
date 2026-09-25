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

/** The tickets currently recorded as this finding's answer (may be empty). */
export function answeringTickets(issue) {
  const line = (issue?.body || "").match(ANSWERED_BY_LINE_RE);
  if (!line) return [];
  return [...new Set((line[1].match(/#(\d+)/g) || []).map((s) => Number(s.slice(1))))];
}

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
  const line = `Answered by: ${tickets.map((n) => `#${n}`).join(", ")}`;
  const body = (issue.body || "").trim();
  const count = persistCount(issue);
  return {
    body: ANSWERED_BY_LINE_RE.test(body) ? body.replace(ANSWERED_BY_LINE_RE, line) : `${body}\n\n${line}`,
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
