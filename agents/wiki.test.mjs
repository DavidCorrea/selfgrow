// The page mutations, which commitToWiki replays against freshly fetched content
// on every push attempt. Two properties matter and both are load-bearing:
// the transformation has to be correct, and it has to be safe to run twice —
// a retry that duplicates the entry it just wrote is how a changelog rots.
import test from "node:test";
import assert from "node:assert/strict";
import { withChangelogEntry, withLesson } from "./wiki.mjs";

test("recording what shipped", async (t) => {
  await t.test("starts a page that does not exist yet", () => {
    const page = withChangelogEntry("", "Add a garden", "2026-08-30");
    assert.match(page, /^# Changelog/);
    assert.ok(page.includes("## 2026-08-30"));
    assert.ok(page.includes("- Add a garden"));
  });

  await t.test("groups a second entry under the same day", () => {
    let page = withChangelogEntry("", "First", "2026-08-30");
    page = withChangelogEntry(page, "Second", "2026-08-30");
    assert.equal(page.match(/## 2026-08-30/g).length, 1, "one heading for the day");
    assert.ok(page.includes("- First") && page.includes("- Second"));
  });

  await t.test("puts a new day above the previous one", () => {
    let page = withChangelogEntry("", "Older", "2026-08-29");
    page = withChangelogEntry(page, "Newer", "2026-08-30");
    assert.ok(page.indexOf("## 2026-08-30") < page.indexOf("## 2026-08-29"));
  });

  await t.test("is safe to replay, so a retried push cannot double-record a merge", () => {
    const once = withChangelogEntry("", "Add a garden", "2026-08-30");
    const twice = withChangelogEntry(once, "Add a garden", "2026-08-30");
    assert.equal(twice, once);
  });

  await t.test("keeps content it does not recognise, so a hand-written note survives", () => {
    const page = withChangelogEntry("Notes I added by hand.", "Add a garden", "2026-08-30");
    assert.ok(page.includes("Notes I added by hand."));
    assert.ok(page.includes("- Add a garden"));
  });
});

test("recording why something was abandoned", async (t) => {
  const lesson = { title: "#12 Add a shop", body: "Needed a server." };

  await t.test("starts a page that does not exist yet", () => {
    const page = withLesson("", lesson, "2026-08-30");
    assert.match(page, /^# Lessons/);
    assert.ok(page.includes("## 2026-08-30 — #12 Add a shop"));
    assert.ok(page.includes("Needed a server."));
  });

  await t.test("puts the newest lesson first, where the Scout reads", () => {
    let page = withLesson("", { title: "Older", body: "x" }, "2026-08-29");
    page = withLesson(page, { title: "Newer", body: "y" }, "2026-08-30");
    assert.ok(page.indexOf("Newer") < page.indexOf("Older"));
  });

  await t.test("keeps the page's intro above the entries", () => {
    let page = withLesson("", { title: "First", body: "x" }, "2026-08-29");
    page = withLesson(page, { title: "Second", body: "y" }, "2026-08-30");
    assert.ok(page.indexOf("not to\nlearn it twice") < page.indexOf("## 2026-08-30"));
  });

  await t.test("is safe to replay", () => {
    const once = withLesson("", lesson, "2026-08-30");
    assert.equal(withLesson(once, lesson, "2026-08-30"), once);
  });
});
