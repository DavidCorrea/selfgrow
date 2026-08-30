// Work that came from a person rather than the pipeline.
//
// The whole guarantee rests on one inverted signal — the agents label their own
// tickets, so an unlabelled one came from outside — and on the pipeline never
// closing such a ticket quietly. Both are pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { isManualIssue } from "./shared.mjs";
import { gatherWeek, renderDigest } from "./weekly-report.mjs";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const agentIssue = (number, title, extra = []) =>
  ({ number, title, labels: ["agent", ...extra].map((name) => ({ name })) });
const humanIssue = (number, title, extra = []) =>
  ({ number, title, labels: extra.map((name) => ({ name })) });

test("telling a person's ticket from the pipeline's", async (t) => {
  await t.test("treats an unlabelled ticket as human-filed", () => {
    assert.equal(isManualIssue(humanIssue(1, "Make the garden louder")), true);
  });

  await t.test("treats anything the agents stamped as theirs", () => {
    assert.equal(isManualIssue(agentIssue(2, "Add a star field")), false);
  });

  await t.test("reads the marker through other labels", () => {
    assert.equal(isManualIssue(agentIssue(3, "x", ["priority:high", "tech-debt"])), false);
    assert.equal(isManualIssue(humanIssue(4, "y", ["priority:high"])), true);
  });

  await t.test("treats an issue with no labels field at all as human-filed", () => {
    // The safe direction: a ticket of unknown provenance gets the protections of
    // a human one, rather than being silently retirable.
    assert.equal(isManualIssue({ number: 5, title: "z" }), true);
  });
});

test("telling the reader what became of what they asked for", async (t) => {
  const ledger = new Map([[daysAgo(1), 100]]);

  await t.test("separates their tickets from the pipeline's own", () => {
    const week = gatherWeek({
      closed: [
        { ...humanIssue(1, "Mine"), closedAt: `${daysAgo(1)}T10:00:00Z` },
        { ...agentIssue(2, "Theirs"), closedAt: `${daysAgo(1)}T10:00:00Z` },
      ],
      open: [humanIssue(3, "Mine, queued"), agentIssue(4, "Theirs, queued")],
      ledger,
    });
    assert.deepEqual(week.yours.shipped.map((i) => i.number), [1]);
    assert.deepEqual(week.yours.open.map((i) => i.number), [3]);
    assert.equal(week.shipped.length, 2, "the overall count still includes both");
  });

  await t.test("calls out a request that got stuck", () => {
    const week = gatherWeek({
      closed: [],
      open: [humanIssue(9, "Mine, failing", ["blocked"])],
      ledger,
    });
    assert.deepEqual(week.yours.parked.map((i) => i.number), [9]);
    assert.deepEqual(week.yours.open, [], "a parked ticket is not also reported as queued");
  });

  await t.test("reports each outcome in the digest", () => {
    const week = {
      shipped: [], parked: [], playtest: [], openCount: 3, spend: 100,
      yours: {
        shipped: [{ number: 1, title: "Louder garden" }],
        open: [{ number: 3, title: "Quieter nights" }],
        parked: [{ number: 9, title: "Impossible thing" }],
      },
    };
    const body = renderDigest(week, "narrative", null);
    assert.match(body, /## What you asked for/);
    assert.match(body, /\*\*Shipped\*\* — Louder garden \(#1\)/);
    assert.match(body, /\*\*Stuck\*\* — Impossible thing \(#9\)/);
    assert.match(body, /Still queued — Quieter nights \(#3\)/);
  });

  await t.test("omits the section entirely when they asked for nothing", () => {
    const week = { shipped: [], parked: [], playtest: [], openCount: 0, spend: 0,
      yours: { shipped: [], open: [], parked: [] } };
    assert.ok(!renderDigest(week, "x", null).includes("What you asked for"));
  });
});
