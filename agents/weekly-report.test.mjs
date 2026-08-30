// The weekly report's pure parts: what the week contained, and how one model
// response is split between the two pages it has to serve.
import test from "node:test";
import assert from "node:assert/strict";
import { splitReport, cleanMarkdown, gatherWeek, renderDigest } from "./weekly-report.mjs";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const issue = (number, title, labels = []) => ({ number, title, labels: labels.map((name) => ({ name })) });

test("splitting one response into the story and the week", async (t) => {
  await t.test("separates the two pieces at the heading", () => {
    const { story, week } = splitReport("# The Story So Far\n\nIt began small.\n\n## This week\n\nNights got deeper.");
    assert.match(story, /It began small/);
    assert.equal(week, "Nights got deeper.");
    assert.ok(!story.includes("Nights got deeper"), "the week must not leak into the story");
  });

  await t.test("keeps everything as the story when the heading is missing", () => {
    // Losing the digest prose is recoverable — it falls back to the ticket list.
    // Publishing the wrong half to both pages is not.
    const { story, week } = splitReport("# The Story So Far\n\nIt began small.");
    assert.match(story, /It began small/);
    assert.equal(week, null);
  });

  await t.test("is not fooled by a similar heading deeper in the prose", () => {
    const { week } = splitReport("# Story\n\nText.\n\n## This week\n\nReal week.");
    assert.equal(week, "Real week.");
  });
});

test("unwrapping a fenced response", async (t) => {
  await t.test("strips a markdown fence", () => {
    assert.equal(cleanMarkdown("```markdown\n# Title\n```"), "# Title");
  });

  await t.test("strips a bare fence", () => {
    assert.equal(cleanMarkdown("```\n# Title\n```"), "# Title");
  });

  await t.test("leaves unfenced prose alone", () => {
    assert.equal(cleanMarkdown("# Title\n\nBody."), "# Title\n\nBody.");
  });
});

test("counting what the week contained", async (t) => {
  const facts = {
    closed: [
      { number: 1, title: "Shipped", closedAt: `${daysAgo(1)}T10:00:00Z` },
      { number: 2, title: "Old", closedAt: `${daysAgo(30)}T10:00:00Z` },
    ],
    open: [issue(3, "Parked", ["blocked"]), issue(4, "Feedback", ["playtest"]), issue(5, "Normal")],
    ledger: new Map([[daysAgo(1), 400], [daysAgo(2), 300], [daysAgo(40), 999]]),
  };

  await t.test("counts only what closed inside the week", () => {
    assert.equal(gatherWeek(facts).shipped.length, 1);
  });

  await t.test("separates parked work from untriaged feedback", () => {
    const week = gatherWeek(facts);
    assert.deepEqual(week.parked.map((i) => i.number), [3]);
    assert.deepEqual(week.playtest.map((i) => i.number), [4]);
  });

  await t.test("sums only the week's spend", () => {
    assert.equal(gatherWeek(facts).spend, 700);
  });
});

test("writing the digest", async (t) => {
  const week = { shipped: [{ number: 1, title: "x" }], parked: [], playtest: [], openCount: 3, spend: 700 };

  await t.test("leads with the narrative, not the ticket list", () => {
    const body = renderDigest(week, "Nights got deeper.", null);
    assert.ok(body.indexOf("Nights got deeper.") < body.indexOf("Where things stand"));
  });

  await t.test("names the milestone when one is running", () => {
    assert.match(renderDigest(week, "x", { title: "A night worth staying up for" }), /A night worth staying up for/);
  });

  await t.test("omits sections with nothing in them", () => {
    const body = renderDigest(week, "x", null);
    assert.ok(!body.includes("What the Playtester said"));
    assert.ok(!body.includes("Stuck"));
  });

  await t.test("surfaces parked work and outstanding feedback when there is any", () => {
    const busy = { ...week, parked: [{ number: 9, title: "Hard" }], playtest: [{ number: 8, title: "Static" }] };
    const body = renderDigest(busy, "x", null);
    assert.match(body, /Stuck/);
    assert.match(body, /#9/);
    assert.match(body, /What the Playtester said/);
  });

  await t.test("asks the reader for nothing", () => {
    assert.match(renderDigest(week, "x", null), /Nothing here needs a reply/);
  });
});
