// A playtest finding stays open until the Playtester says it is gone.
//
// The incident: on the last product "The visual canvas is a dark void" was filed
// five times. Each time the Product Manager answered with a few tickets and closed
// the finding, every ticket shipped, and the Playtester's verdict never changed —
// because nothing ever asked it whether the tickets had worked.
import test from "node:test";
import assert from "node:assert/strict";
import {
  answeringTickets,
  isAnswered,
  needsAnswer,
  isEscalated,
  persistCount,
  triedBefore,
  planAnswer,
  planFollowUp,
  planEscalation,
  priorAnswers,
  renderPriorAnswers,
  renderOpenFindings,
  renderPlaytesterVerdicts,
  ANSWERED_LABEL,
  ESCALATED_LABEL,
} from "./playtest-findings.mjs";
import { planRetirements, renderPlaytestFeedback, formatTicketBody, findingAddressed } from "./product-manager.mjs";
import { renderAnsweredFindings } from "./playtester.mjs";
import { renderWeek } from "./product-owner.mjs";

const finding = (number, { labels = [], body = "## What I noticed\nThe canvas was dark.\n\n## Why it matters\nNothing to see." } = {}) => ({
  number,
  title: "The visual canvas is a dark void",
  labels: ["agent", "playtest", ...labels].map((name) => ({ name })),
  body,
});
const answeredBy = (tickets, labels = [ANSWERED_LABEL]) =>
  finding(591, { labels, body: `## What I noticed\nThe canvas was dark.\n\nAnswered by: ${tickets.map((n) => `#${n}`).join(", ")}` });

test("the stage a finding is in", async (t) => {
  await t.test("a freshly filed finding is waiting on the Product Manager", () => {
    assert.equal(needsAnswer(finding(1)), true);
    assert.equal(isAnswered(finding(1)), false);
  });

  await t.test("an answered finding is waiting on the Playtester, not the Product Manager", () => {
    const issue = answeredBy([10]);
    assert.equal(isAnswered(issue), true);
    assert.equal(needsAnswer(issue), false);
  });

  await t.test("an escalated finding is back with the Product Manager", () => {
    const issue = finding(1, { labels: [ESCALATED_LABEL] });
    assert.equal(isEscalated(issue), true);
    assert.equal(needsAnswer(issue), true);
  });

  await t.test("an ordinary ticket is never a finding in any stage", () => {
    const ticket = { number: 5, labels: [{ name: "agent" }, { name: ANSWERED_LABEL }] };
    assert.equal(isAnswered(ticket), false);
    assert.equal(needsAnswer(ticket), false);
  });

  await t.test("reads the answering tickets from the finding's own body", () => {
    assert.deepEqual(answeringTickets(answeredBy([10, 11])), [10, 11]);
    assert.deepEqual(answeringTickets(finding(1)), []);
  });
});

test("answering a finding", async (t) => {
  await t.test("records the tickets on the finding and marks it answered instead of closing it", () => {
    const plan = planAnswer(finding(591), [10, 11]);
    assert.match(plan.body, /^Answered by: #10, #11$/m);
    assert.match(plan.body, /The canvas was dark/);
    assert.deepEqual(plan.add, [ANSWERED_LABEL]);
    assert.equal(plan.close, undefined);
  });

  await t.test("replaces an earlier answer rather than listing two", () => {
    const plan = planAnswer(answeredBy([10], [ESCALATED_LABEL, "persisted:2"]), [20]);
    assert.deepEqual(answeringTickets({ body: plan.body }), [20]);
    assert.equal(plan.body.match(/Answered by/g).length, 1);
  });

  await t.test("keeps every replaced answer as tried before, so the history survives a second approach", () => {
    const once = planAnswer(answeredBy([10, 11], [ESCALATED_LABEL]), [20]);
    const twice = planAnswer({ ...finding(591), body: once.body }, [30]);
    assert.deepEqual(triedBefore({ body: twice.body }), [10, 11, 20]);
    assert.deepEqual(answeringTickets({ body: twice.body }), [30]);
  });

  await t.test("starts a new answer's persist count from zero but keeps it marked escalated", () => {
    const plan = planAnswer(answeredBy([10], [ESCALATED_LABEL, "persisted:2"]), [20]);
    assert.deepEqual(plan.remove, ["persisted:2"]);
    assert.ok(!plan.remove.includes(ESCALATED_LABEL));
  });

  await t.test("the ticket names the finding it answers", () => {
    const body = formatTicketBody({ body: "Light the scene." }, [], 591);
    assert.match(body, /^Addresses: #591$/m);
  });

  await t.test("only a finding waiting on an answer can be addressed", () => {
    const answerable = new Map([[591, finding(591)]]);
    assert.equal(findingAddressed({ addresses: "#591" }, answerable).number, 591);
    assert.equal(findingAddressed({ addresses: 656 }, answerable), null);
    assert.equal(findingAddressed({}, answerable), null);
  });

  await t.test("refuses to retire an answered finding, which is the Playtester's to close", () => {
    const planned = planRetirements([{ number: 591, reason: "answered" }], [answeredBy([10])]);
    assert.deepEqual(planned.entries, []);
  });

  await t.test("still retires a finding the Product Manager dropped", () => {
    const planned = planRetirements([{ number: 591, reason: "contradicts the Vision" }], [finding(591)]);
    assert.deepEqual(planned.entries.map((e) => e.number), [591]);
  });
});

test("the Playtester's verdict on an answered finding", async (t) => {
  const noneOpen = new Set();

  await t.test("verified closes it", () => {
    const plan = planFollowUp(answeredBy([10]), { status: "verified", note: "The canvas glows now." }, noneOpen);
    assert.equal(plan.close, true);
    assert.match(plan.comment, /The canvas glows now/);
  });

  await t.test("persisting before the answer has shipped does not count against it", () => {
    const plan = planFollowUp(answeredBy([10, 11]), { status: "persisting" }, new Set([11]));
    assert.equal(plan.close, false);
    assert.deepEqual(plan.add, []);
    assert.match(plan.comment, /#11 still open/);
  });

  await t.test("persisting once after the answer shipped is counted", () => {
    const plan = planFollowUp(answeredBy([10]), { status: "persisting", note: "Still dark." }, noneOpen);
    assert.deepEqual(plan.add, ["persisted:1"]);
    assert.equal(plan.escalated, undefined);
    assert.match(plan.comment, /Still dark/);
  });

  await t.test("persisting again after the answer shipped escalates it back to the Product Manager", () => {
    const plan = planFollowUp(answeredBy([10], [ANSWERED_LABEL, "persisted:1"]), { status: "persisting" }, noneOpen);
    assert.equal(plan.escalated, true);
    assert.deepEqual(plan.add, [ESCALATED_LABEL, "persisted:2"]);
    assert.deepEqual(plan.remove, [ANSWERED_LABEL, "persisted:1"]);
    assert.match(plan.comment, /different approach/);
  });

  await t.test("the count it escalates at is configurable", () => {
    const plan = planFollowUp(answeredBy([10]), { status: "persisting" }, noneOpen, { escalateAfter: 1 });
    assert.equal(plan.escalated, true);
  });

  await t.test("reads the status regardless of case", () => {
    assert.equal(planFollowUp(answeredBy([10]), { status: "Verified" }, noneOpen).close, true);
  });

  await t.test("ignores a status it does not understand rather than guessing", () => {
    assert.equal(planFollowUp(answeredBy([10]), { status: "fixed-ish" }, noneOpen), null);
  });

  await t.test("the persist count is read back from the label", () => {
    assert.equal(persistCount(answeredBy([10], [ANSWERED_LABEL, "persisted:3"])), 3);
    assert.equal(persistCount(answeredBy([10])), 0);
  });
});

test("what each role is shown", async (t) => {
  await t.test("the Product Manager sees findings waiting on it and not ones waiting on the Playtester", () => {
    const text = renderPlaytestFeedback([finding(1), answeredBy([10])]);
    assert.match(text, /#1 —/);
    assert.doesNotMatch(text, /#591/);
  });

  await t.test("the Product Manager is told an escalated finding needs a different approach", () => {
    const text = renderPlaytestFeedback([answeredBy([10], [ESCALATED_LABEL])]);
    assert.match(text, /escalated/);
    assert.match(text, /Answered by: #10/);
  });

  await t.test("the Playtester sees each answered finding, what it noticed, and which tickets have landed", () => {
    const text = renderAnsweredFindings([answeredBy([10, 11])], new Set([11]));
    assert.match(text, /#591 — The visual canvas is a dark void/);
    assert.match(text, /#10 \(closed\), #11 \(not shipped yet\)/);
    assert.match(text, /The canvas was dark/);
  });

  await t.test("the Playtester is told when nothing is waiting on it", () => {
    assert.match(renderAnsweredFindings([], new Set()), /none/);
  });
});

test("the Product Owner hears the Playtester", async (t) => {
  const now = Date.parse("2026-09-25T00:00:00Z");
  const dated = (issue, createdAt) => ({ ...issue, createdAt });

  await t.test("every open finding is listed with its age and where it stands, not only untriaged ones", () => {
    const text = renderOpenFindings(
      [dated(finding(1), "2026-09-20T00:00:00Z"), dated(answeredBy([10]), "2026-09-11T00:00:00Z")],
      now
    );
    assert.match(text, /#1 .* open 5 day\(s\); untriaged/);
    assert.match(text, /#591 .* open 14 day\(s\); answered, waiting on the Playtester; answered by #10/);
  });

  await t.test("an escalated finding says how many sessions it outlived its answer", () => {
    const text = renderOpenFindings([answeredBy([10], [ESCALATED_LABEL, "persisted:2"])], now);
    assert.match(text, /escalated — no answer so far has fixed it; persisted 2 session\(s\)/);
  });

  await t.test("ordinary tickets are not listed as findings", () => {
    assert.match(renderOpenFindings([{ number: 5, title: "Build it", labels: [{ name: "agent" }] }], now), /no playtest findings open/);
  });

  await t.test("the Playtester's verdicts are read out of its journal entries, oldest first", () => {
    const text = renderPlaytesterVerdicts([
      "[2026-09-16] **Decided:** A dark void. I would not come back.\n**Filed:** \"The visual canvas is a dark void\"",
      "[2026-09-23] **Decided:** Still a dark void.\n**Tool surface:** fine",
    ]);
    assert.equal(text, "- 2026-09-16: A dark void. I would not come back.\n- 2026-09-23: Still a dark void.");
  });

  await t.test("says so when the Playtester has no sessions on record", () => {
    assert.match(renderPlaytesterVerdicts([]), /no sessions on record/);
  });

  await t.test("the week carries both the verdicts and the open findings", () => {
    const week = renderWeek(
      { shipped: [], parked: [], open: [answeredBy([10])], verdicts: ["[2026-09-23] **Decided:** Still a dark void."] },
      now
    );
    assert.match(week, /Still a dark void/);
    assert.match(week, /#591 The visual canvas is a dark void/);
  });
});

test("the Product Manager remembers what it tried", async (t) => {
  const history = (closedFindings = [], closedTickets = []) => ({
    closedFindings,
    closedTickets: new Map(closedTickets.map((i) => [i.number, i])),
  });
  const closedFinding = (number, stateReason, body = "") => ({ number, title: "The visual canvas is a dark void", stateReason, body });

  await t.test("a finding answered for the first time has no history", () => {
    assert.deepEqual(priorAnswers(finding(812), []), []);
    assert.equal(renderPriorAnswers(finding(812), history(), []), "");
  });

  await t.test("an escalated finding shows the answer that shipped and did not help", () => {
    const rounds = priorAnswers(answeredBy([10], [ESCALATED_LABEL]), []);
    assert.deepEqual(rounds.map((r) => r.tickets), [[10]]);
    assert.match(rounds[0].outcome, /still saw this/);
  });

  await t.test("answers replaced on the same finding are shown as not having fixed it", () => {
    const issue = { ...finding(812, { labels: [ESCALATED_LABEL] }), body: "Answered by: #30\nTried before: #10, #20" };
    const rounds = priorAnswers(issue, []);
    assert.deepEqual(rounds.map((r) => [r.tickets, r.outcome]), [
      [[10, 20], "did not fix it"],
      [[30], "shipped, and the Playtester still saw this — escalated"],
    ]);
  });

  await t.test("an earlier finding filed under the same title is the same complaint coming back", () => {
    const rounds = priorAnswers(finding(812), [
      closedFinding(794, "COMPLETED", "Answered by: #700"),
      { number: 795, title: "Something else entirely", stateReason: "COMPLETED", body: "Answered by: #701" },
    ]);
    assert.deepEqual(rounds.map((r) => r.from), [794]);
    assert.match(rounds[0].outcome, /verified it fixed, and the complaint came back/);
  });

  await t.test("an earlier finding retired before answers were tracked still counts as a repeat", () => {
    const text = renderPriorAnswers(finding(812), history([closedFinding(591, "NOT_PLANNED")]), []);
    assert.match(text, /On #591, an earlier filing of the same complaint: tickets not recorded/);
    assert.match(text, /closed without the Playtester ever confirming it was fixed/);
  });

  await t.test("names each ticket and whether it shipped", () => {
    const text = renderPriorAnswers(
      answeredBy([10, 11, 12], [ESCALATED_LABEL]),
      history([], [{ number: 10, title: "Brighten the ground", stateReason: "COMPLETED" }, { number: 11, title: "Add a glow", stateReason: "NOT_PLANNED" }]),
      [{ number: 12, title: "Tint the sky" }]
    );
    assert.match(text, /#10 Brighten the ground \(shipped\); #11 Add a glow \(retired\); #12 Tint the sky \(not shipped yet\)/);
  });

  await t.test("the grooming prompt carries the history under the finding it belongs to", () => {
    const text = renderPlaytestFeedback(
      [answeredBy([10], [ESCALATED_LABEL])],
      history([], [{ number: 10, title: "Brighten the ground", stateReason: "COMPLETED" }])
    );
    assert.match(text, /#### Answered before\n- On this finding: #10 Brighten the ground \(shipped\)/);
  });

  await t.test("escalating instead of repeating marks the finding and records why", () => {
    const plan = planEscalation("Three lighting tickets shipped; the scene is still dark.");
    assert.deepEqual(plan.add, [ESCALATED_LABEL]);
    assert.match(plan.comment, /Three lighting tickets shipped/);
  });
});
