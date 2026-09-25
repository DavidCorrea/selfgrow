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
  planAnswer,
  planFollowUp,
  ANSWERED_LABEL,
  ESCALATED_LABEL,
} from "./playtest-findings.mjs";
import { planRetirements, renderPlaytestFeedback, formatTicketBody, findingAddressed } from "./product-manager.mjs";
import { renderAnsweredFindings } from "./playtester.mjs";

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
