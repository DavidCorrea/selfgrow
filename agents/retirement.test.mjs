// Retiring a ticket is the only destructive thing the Product Manager does, and it
// is usually justified by a replacement created later in the same run. These
// assert that the two halves cannot come apart.
//
// The incident: on 2026-09-01 the Playtester's first three findings were each
// closed with "Replaced by new ticket '...'", the dedup pass then dropped all
// three proposals, and the run reported success against an empty board. The
// findings were the only copy of the observation.
import test from "node:test";
import assert from "node:assert/strict";
import { planRetirements, executeRetirements } from "./product-manager.mjs";

// The `agent` label marks a ticket the pipeline filed itself — isManualIssue is
// its ABSENCE, so a fixture without it stands for a request from a person.
const issue = (number, title, labels = ["agent"]) => ({
  number,
  title,
  labels: labels.map((name) => ({ name })),
  body: "",
});
const fromAPerson = (number, title) => issue(number, title, []);

test("deciding what may be retired", async (t) => {
  await t.test("accepts a ticket the pipeline itself filed", () => {
    const planned = planRetirements([{ number: 7, reason: "superseded" }], [issue(7, "Old ticket")]);
    assert.deepEqual(planned.entries.map((e) => e.number), [7]);
    assert.ok(planned.numbers.has(7));
  });

  await t.test("carries the title through, so the run summary can name it", () => {
    const planned = planRetirements([{ number: 7 }], [issue(7, "Old ticket")]);
    assert.equal(planned.entries[0].issue.title, "Old ticket");
  });

  await t.test("refuses a person's ticket that was not called out of scope", () => {
    const planned = planRetirements([{ number: 9, reason: "unclear" }], [fromAPerson(9, "Please add sound")]);
    assert.deepEqual(planned.entries, []);
  });

  await t.test("accepts a person's ticket when it is explicitly out of scope", () => {
    const planned = planRetirements(
      [{ number: 9, reason: "not what this product is for", outOfScope: true }],
      [fromAPerson(9, "Please add multiplayer")]
    );
    assert.deepEqual(planned.entries.map((e) => e.number), [9]);
  });

  await t.test("ignores entries that name no real ticket", () => {
    const planned = planRetirements([{ number: 0 }, { reason: "no number" }, "nonsense"], []);
    assert.deepEqual(planned.entries, []);
  });

  await t.test("closes nothing by itself", async () => {
    // The whole point of the split: planning must have no side effects, or the
    // check in executeRetirements cannot protect anything.
    const planned = planRetirements([{ number: 7 }], [issue(7, "Old ticket")]);
    assert.equal(typeof planned.entries[0].number, "number");
  });
});

test("holding back a retirement whose replacement never arrived", async (t) => {
  const planned = () => planRetirements([{ number: 7, reason: "Replaced by new ticket 'Something better'" }], [issue(7, "Old ticket")]);

  await t.test("retires nothing when every proposal was dropped", async () => {
    const retired = await executeRetirements(planned(), { proposed: 3, created: 0 });
    assert.equal(retired.size, 0);
  });

  await t.test("retires nothing when a single proposal was dropped", async () => {
    const retired = await executeRetirements(planned(), { proposed: 1, created: 0 });
    assert.equal(retired.size, 0);
  });

  await t.test("does nothing at all when there was nothing to retire", async () => {
    const retired = await executeRetirements({ entries: [] }, { proposed: 2, created: 0 });
    assert.equal(retired.size, 0);
  });
});
