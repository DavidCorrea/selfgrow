// The comment a fork contributor actually receives.
//
// It is very likely the only response they will get, and it is written by a
// machine on behalf of a project they have no other contact with. So what it must
// never do matters as much as what it says: never claim to have run the code,
// never promise an outcome, never leave them unsure whether a person was involved.
import test from "node:test";
import assert from "node:assert/strict";
import { renderComment, touchedPaths, isReadableBasePath, redactSecrets } from "./triage-fork-pr.mjs";

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

// The review has no tools, so the only base code it sees is what the script
// reads for it — from paths a stranger wrote into the diff headers.
test("choosing which base files the review is shown", async (t) => {
  const tracked = new Set(["docs/index.html", "docs/garden.js"]);

  await t.test("finds every file the diff touches, once each", () => {
    const diff = [
      "diff --git a/docs/index.html b/docs/index.html",
      "--- a/docs/index.html",
      "+++ b/docs/index.html",
      "diff --git a/docs/garden.js b/docs/garden.js",
      "diff --git a/docs/index.html b/docs/index.html",
    ].join("\n");
    assert.deepEqual(touchedPaths(diff), ["docs/index.html", "docs/garden.js"]);
  });

  await t.test("ignores header-shaped text that is not at the start of a line", () => {
    assert.deepEqual(touchedPaths("+ // diff --git a/.git/config b/.git/config"), []);
  });

  await t.test("reads a file the base tracks", () => {
    assert.ok(isReadableBasePath("docs/garden.js", tracked));
  });

  await t.test("refuses an absolute path, even one that is tracked", () => {
    assert.ok(!isReadableBasePath("/proc/self/environ", new Set(["/proc/self/environ"])));
  });

  await t.test("refuses a path that climbs out with ..", () => {
    assert.ok(!isReadableBasePath("docs/../../etc/passwd", new Set(["docs/../../etc/passwd"])));
    assert.ok(!isReadableBasePath("docs\\..\\secret", new Set(["docs\\..\\secret"])));
  });

  await t.test("refuses a file git does not track, like .git/config", () => {
    assert.ok(!isReadableBasePath(".git/config", tracked));
  });

  await t.test("refuses a file the fork is adding, since the base has no version of it", () => {
    assert.ok(!isReadableBasePath("docs/new-feature.js", tracked));
  });
});

test("keeping secrets out of the public comment", async (t) => {
  await t.test("replaces every occurrence of a secret's value", () => {
    const body = redactSecrets("key sk-or-123 and again sk-or-123", ["sk-or-123"]);
    assert.equal(body, "key [redacted] and again [redacted]");
  });

  await t.test("redacts each secret it is given", () => {
    assert.equal(redactSecrets("sk-or-123 ghs_abc", ["sk-or-123", "ghs_abc"]), "[redacted] [redacted]");
  });

  await t.test("leaves the comment alone when a secret is unset", () => {
    assert.equal(redactSecrets("Looks fine.", [undefined, ""]), "Looks fine.");
  });
});
