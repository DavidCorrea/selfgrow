// Ticket ordering and readiness. These decide what the Builder picks up and in
// what order, so a fault here doesn't crash anything — it quietly builds the
// wrong thing, or stalls a chain nobody notices is stalled.
import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptCount,
  isBlocked,
  dependencyNumbers,
  unmetDependencies,
  isBuildable,
  isPlaytestFeedback,
  priorityRank,
  effectivePriorityRank,
  dependentsOf,
  dependencyLine,
  slugify,
  createBranchName,
} from "./shared.mjs";

const issue = (number, { body = "", labels = [], title = `Ticket ${number}` } = {}) =>
  ({ number, title, body, labels: labels.map((name) => ({ name })) });

test("declaring what a ticket waits for", async (t) => {
  await t.test("reads the numbers off a Blocked by: line", () => {
    assert.deepEqual(dependencyNumbers(issue(5, { body: "Do the thing.\n\nBlocked by: #3, #4" })), [3, 4]);
  });

  await t.test("accepts 'Depends on:' as the same declaration", () => {
    assert.deepEqual(dependencyNumbers(issue(5, { body: "Depends on: #3" })), [3]);
  });

  await t.test("is case- and whitespace-insensitive, because a model writes this line", () => {
    assert.deepEqual(dependencyNumbers(issue(5, { body: "  BLOCKED BY :  #3" })), [3]);
  });

  await t.test("ignores a ticket that lists itself, which would strand it forever", () => {
    assert.deepEqual(dependencyNumbers(issue(5, { body: "Blocked by: #5, #3" })), [3]);
  });

  await t.test("counts a repeated number once", () => {
    assert.deepEqual(dependencyNumbers(issue(5, { body: "Blocked by: #3, #3" })), [3]);
  });

  await t.test("finds nothing in a body that never mentions dependencies", () => {
    assert.deepEqual(dependencyNumbers(issue(5, { body: "Fixes the thing near #3." })), []);
  });

  await t.test("treats a missing body as no dependencies", () => {
    assert.deepEqual(dependencyNumbers({ number: 5 }), []);
  });
});

test("deciding whether a ticket can be built now", async (t) => {
  await t.test("waits while a dependency is still open", () => {
    const ticket = issue(5, { body: "Blocked by: #3" });
    assert.deepEqual(unmetDependencies(ticket, new Set([3, 5])), [3]);
    assert.equal(isBuildable(ticket, new Set([3, 5])), false);
  });

  await t.test("is released once the dependency ships", () => {
    const ticket = issue(5, { body: "Blocked by: #3" });
    assert.deepEqual(unmetDependencies(ticket, new Set([5])), []);
    assert.equal(isBuildable(ticket, new Set([5])), true);
  });

  await t.test("treats a dependency that no longer exists as met, so a stale reference cannot strand it", () => {
    assert.equal(isBuildable(issue(5, { body: "Blocked by: #999" }), new Set([5])), true);
  });

  await t.test("refuses a ticket parked after repeated failures", () => {
    assert.equal(isBuildable(issue(5, { labels: ["blocked"] }), new Set([5])), false);
  });

  await t.test("builds an unblocked ticket with no dependencies", () => {
    assert.equal(isBuildable(issue(5), new Set([5])), true);
  });

  await t.test("refuses raw playtest feedback, which is an observation rather than work", () => {
    // "The first minute felt static" has no acceptance criteria and no ask. The
    // Builder must never pick one up; the PM turns it into a real ticket first.
    const finding = issue(5, { labels: ["playtest"] });
    assert.equal(isPlaytestFeedback(finding), true);
    assert.equal(isBuildable(finding, new Set([5])), false);
  });

  await t.test("builds the ticket the PM wrote from a finding, which carries no playtest label", () => {
    assert.equal(isBuildable(issue(6, { labels: ["priority:high"] }), new Set([6])), true);
  });
});

test("counting a ticket's failed attempts", async (t) => {
  await t.test("reads the attempts label", () => {
    assert.equal(attemptCount(issue(5, { labels: ["attempts:2"] })), 2);
  });

  await t.test("reports none when the ticket has never failed", () => {
    assert.equal(attemptCount(issue(5, { labels: ["priority:high"] })), 0);
  });

  await t.test("handles labels given as plain strings, which is how a human adds them", () => {
    assert.equal(attemptCount({ number: 5, labels: ["attempts:3"] }), 3);
    assert.equal(isBlocked({ number: 5, labels: ["blocked"] }), true);
  });
});

test("ordering the backlog", async (t) => {
  await t.test("sorts by the ticket's own priority label", () => {
    assert.equal(priorityRank(issue(1, { labels: ["priority:high"] })), 0);
    assert.equal(priorityRank(issue(2, { labels: ["priority:medium"] })), 1);
    assert.equal(priorityRank(issue(3, { labels: ["priority:low"] })), 2);
  });

  await t.test("sorts an unlabelled ticket last", () => {
    assert.ok(priorityRank(issue(4)) > priorityRank(issue(3, { labels: ["priority:low"] })));
  });

  await t.test("lifts a low blocker to the rank of the high work waiting on it", () => {
    const blocker = issue(170, { labels: ["priority:low"] });
    const waiting = issue(171, { labels: ["priority:high"], body: "Blocked by: #170" });
    assert.equal(priorityRank(blocker), 2, "its own label is unchanged");
    assert.equal(effectivePriorityRank(blocker, [blocker, waiting]), 0);
  });

  await t.test("lifts through a chain, not just direct dependents", () => {
    const blocker = issue(170, { labels: ["priority:low"] });
    const middle = issue(171, { labels: ["priority:low"], body: "Blocked by: #170" });
    const far = issue(172, { labels: ["priority:high"], body: "Blocked by: #171" });
    assert.equal(effectivePriorityRank(blocker, [blocker, middle, far]), 0);
  });

  await t.test("terminates on a dependency cycle rather than hanging the run", () => {
    const a = issue(1, { labels: ["priority:low"], body: "Blocked by: #2" });
    const b = issue(2, { labels: ["priority:low"], body: "Blocked by: #1" });
    assert.equal(effectivePriorityRank(a, [a, b]), 2);
  });

  await t.test("leaves a ticket nothing waits on at its own rank", () => {
    const lone = issue(1, { labels: ["priority:low"] });
    assert.equal(effectivePriorityRank(lone, [lone]), 2);
  });
});

test("reporting what a ticket unblocks", async (t) => {
  await t.test("lists its dependents, most important first", () => {
    const blocker = issue(1);
    const low = issue(2, { labels: ["priority:low"], body: "Blocked by: #1" });
    const high = issue(3, { labels: ["priority:high"], body: "Blocked by: #1" });
    assert.deepEqual(dependentsOf(blocker, [blocker, low, high]).map((i) => i.number), [3, 2]);
  });

  await t.test("never lists the ticket itself", () => {
    const self = issue(1, { body: "Blocked by: #1" });
    assert.deepEqual(dependentsOf(self, [self]), []);
  });
});

test("writing the dependency line onto a new ticket", async (t) => {
  await t.test("renders the numbers it was given", () => {
    assert.equal(dependencyLine([3, 4]), "Blocked by: #3, #4");
  });

  await t.test("round-trips through the parser that reads it back", () => {
    assert.deepEqual(dependencyNumbers({ number: 9, body: dependencyLine([3, 4]) }), [3, 4]);
  });

  await t.test("writes nothing when there are no dependencies", () => {
    assert.equal(dependencyLine([]), "");
    assert.equal(dependencyLine(undefined), "");
  });

  await t.test("drops values that are not real issue numbers", () => {
    assert.equal(dependencyLine([0, -1, 1.5, 3]), "Blocked by: #3");
  });
});

test("naming a branch for a ticket", async (t) => {
  await t.test("slugifies a title into something git accepts", () => {
    assert.equal(slugify("Add a Tension Wheel (device!)"), "add-a-tension-wheel-device");
  });

  await t.test("keeps a slug short enough to leave room for the rest of the ref", () => {
    assert.ok(slugify("x".repeat(80)).length <= 40);
  });

  await t.test("never leaves a leading or trailing separator", () => {
    assert.equal(slugify("  !!hello!!  "), "hello");
  });

  await t.test("names the branch after the issue it addresses", () => {
    assert.match(createBranchName(42, "Add a gear", "x"), /^agent\/issue-42-add-a-gear/);
  });

  await t.test("falls back to the suggestion when there is no issue", () => {
    assert.match(createBranchName(null, null, "Add a gear"), /^agent\/feature-add-a-gear/);
  });

  await t.test("stays valid when the title slugifies to nothing", () => {
    assert.match(createBranchName(42, "!!!", "x"), /^agent\/issue-42-fix/);
  });
});
