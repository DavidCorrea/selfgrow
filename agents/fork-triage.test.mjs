// The comment a fork contributor actually receives.
//
// It is very likely the only response they will get, and it is written by a
// machine on behalf of a project they have no other contact with. So what it must
// never do matters as much as what it says: never claim to have run the code,
// never promise an outcome, never leave them unsure whether a person was involved.
import test from "node:test";
import assert from "node:assert/strict";
import { renderComment } from "./triage-fork-pr.mjs";

const review = (over = {}) => ({ verdict: "approve", summary: "Looks fine.", issues: [], ...over });

test("answering a contributor", async (t) => {
  await t.test("thanks them by name", () => {
    assert.match(renderComment(review()), /Thanks for this, @/);
  });

  await t.test("says plainly when nothing is blocking", () => {
    assert.match(renderComment(review()), /This looks sound to me/);
  });

  await t.test("lists blocking problems when there are some", () => {
    const body = renderComment(review({
      verdict: "revise",
      issues: ["docs/garden.js: the season index can go negative"],
    }));
    assert.match(body, /needs a change/);
    assert.match(body, /season index can go negative/);
  });

  await t.test("leads with 'already shipped' when that is the answer, and does not blame them", () => {
    // The most common outcome by far: agents work the same tickets outsiders do.
    const body = renderComment(review({
      alreadyShipped: "docs/index.html already sets minDistance and maxDistance.",
    }));
    assert.match(body, /already shipped/);
    assert.match(body, /docs\/index\.html already sets/);
    assert.match(body, /not a criticism/);
  });
});

test("what the comment must never claim", async (t) => {
  await t.test("says it has not run the code", () => {
    assert.match(renderComment(review()), /I have not run it/);
  });

  await t.test("says a maintainer decides, so nothing reads as a promise", () => {
    assert.match(renderComment(review()), /A maintainer decides what happens next/);
  });

  await t.test("declares itself automated, in every outcome", () => {
    for (const r of [review(), review({ verdict: "revise", issues: ["x"] }), review({ alreadyShipped: "y" })]) {
      assert.match(renderComment(r), /built by autonomous agents/);
    }
  });

  await t.test("admits when it only saw part of the change", () => {
    const body = renderComment(review(), true);
    assert.match(body, /too large to read in full/);
  });

  await t.test("stays silent about truncation when it read everything", () => {
    assert.ok(!renderComment(review(), false).includes("too large"));
  });
});
