// The page mutations, which commitToWiki replays against freshly fetched content
// on every push attempt. Two properties matter and both are load-bearing:
// the transformation has to be correct, and it has to be safe to run twice —
// a retry that duplicates the entry it just wrote is how a changelog rots.
import test from "node:test";
import assert from "node:assert/strict";
import { withChangelogEntry, trimSections } from "./wiki.mjs";

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

test("keeping the changelog from growing without bound", async (t) => {
  // Both pages are read WHOLE into prompts — the Scout gets every lesson before
  // planning each of the day's tickets. Untrimmed, they inflate a fixed context
  // until something silently falls out of it.
  await t.test("keeps the newest sections and drops the oldest", () => {
    const page = "# Lessons\n\nIntro.\n" +
      [3, 2, 1].map((n) => `\n## 2026-08-0${n} — Entry ${n}\n\nBody ${n}.\n`).join("");
    const trimmed = trimSections(page, 2);
    assert.ok(trimmed.includes("Entry 3") && trimmed.includes("Entry 2"));
    assert.ok(!trimmed.includes("Entry 1"), "the oldest entry should have aged out");
  });

  await t.test("always keeps the title and intro above the entries", () => {
    const page = "# Lessons\n\nRead this before planning.\n\n## 2026-08-01 — One\n\nBody.\n";
    const trimmed = trimSections(page, 0);
    assert.match(trimmed, /^# Lessons/);
    assert.match(trimmed, /Read this before planning/);
  });

  await t.test("leaves a page that already fits completely alone", () => {
    const page = "# Lessons\n\nIntro.\n\n## 2026-08-01 — One\n\nBody.\n";
    assert.equal(trimSections(page, 20), page);
  });

  await t.test("leaves a page with no entries alone", () => {
    assert.equal(trimSections("# Changelog\n\nIntro only.\n", 5), "# Changelog\n\nIntro only.\n");
  });

  await t.test("bounds the changelog as days accumulate", () => {
    let page = "";
    for (let day = 1; day <= 60; day++) {
      page = withChangelogEntry(page, `Shipped ${day}`, `2026-07-${String((day % 28) + 1).padStart(2, "0")}`);
    }
    const days = (page.match(/^## \d{4}-\d{2}-\d{2}$/gm) || []).length;
    assert.ok(days <= 45, `expected at most 45 days, got ${days}`);
  });
});
