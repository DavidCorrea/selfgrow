// Closing a ticket is not shipping it.
//
// Retirements used to close as "completed" and move the card to Done, so every
// report that counted closed tickets listed retired ones as shipped — a retired
// playtest finding appeared under "Shipped this week" and the retro concluded it
// was solved. These tests put a `gh` first on PATH that records what it was asked
// and answers from fixtures: the gh boundary, not our code.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { isShipped, fetchShippedIssues, retireIssue, productStartedAt, RESET_COMMIT_MESSAGE } from "./shared.mjs";

let fakeBin;
const realPath = process.env.PATH;
const calls = () => fs.readFileSync(process.env.FAKE_GH_LOG, "utf-8").split("\n").filter(Boolean);

const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "issue list") cat "$FAKE_GH_CLOSED" ;;
  "search commits") [ -n "$FAKE_GH_SEARCH_FAILS" ] && { echo "HTTP 503" >&2; exit 1; }; cat "$FAKE_GH_RESETS" ;;
  "issue comment") cat > /dev/null ;;
  "project item-list") echo '{"items":[{"id":"ITEM_7","content":{"number":7}}]}' ;;
esac
`;

before(() => {
  fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-recording-gh-"));
  fs.writeFileSync(join(fakeBin, "gh"), FAKE_GH, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:${realPath}`;
  process.env.FAKE_GH_CLOSED = join(fakeBin, "closed.json");
  process.env.FAKE_GH_LOG = join(fakeBin, "calls.log");
  process.env.FAKE_GH_RESETS = join(fakeBin, "resets.json");
  process.env.GITHUB_REPOSITORY = "owner/repo";
});

beforeEach(() => {
  fs.writeFileSync(process.env.FAKE_GH_LOG, "");
  fs.writeFileSync(process.env.FAKE_GH_RESETS, "[]");
  delete process.env.FAKE_GH_SEARCH_FAILS;
});

after(() => {
  process.env.PATH = realPath;
  delete process.env.FAKE_GH_CLOSED;
  delete process.env.FAKE_GH_LOG;
  delete process.env.FAKE_GH_RESETS;
  delete process.env.GITHUB_REPOSITORY;
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

test("deciding whether a closed ticket shipped", async (t) => {
  await t.test("counts a ticket closed as completed", () => {
    assert.equal(isShipped({ stateReason: "COMPLETED" }), true);
  });

  await t.test("does not count a ticket closed as not planned", () => {
    assert.equal(isShipped({ stateReason: "NOT_PLANNED" }), false);
  });

  await t.test("does not count a ticket whose close reason is unknown", () => {
    assert.equal(isShipped({ number: 1 }), false);
  });

  await t.test("does not count a verified playtest finding, which is an observation and not work", () => {
    assert.equal(isShipped({ stateReason: "COMPLETED", labels: [{ name: "playtest" }] }), false);
  });
});

test("listing what shipped", async (t) => {
  await t.test("leaves out tickets that were closed without being built", () => {
    fs.writeFileSync(
      process.env.FAKE_GH_CLOSED,
      JSON.stringify([
        { number: 1, title: "Built", stateReason: "COMPLETED" },
        { number: 2, title: "The visual canvas is a dark void", stateReason: "NOT_PLANNED" },
      ])
    );
    assert.deepEqual(fetchShippedIssues().map((i) => i.number), [1]);
  });

  await t.test("asks gh for the close reason, without which nothing would count", () => {
    fs.writeFileSync(process.env.FAKE_GH_CLOSED, "[]");
    fetchShippedIssues();
    assert.match(calls().find((c) => c.startsWith("issue list")), /stateReason/);
  });
});

// A reset keeps closed issues, so without a lower bound the old product's work,
// shipped in the days before the reset, was the new product's first week.
const commit = (message, date) => ({ commit: { message, committer: { date } } });

test("finding when the current product began", async (t) => {
  await t.test("is the newest reset, when there have been several", () => {
    const start = productStartedAt([
      commit(RESET_COMMIT_MESSAGE, "2026-08-24T17:02:11Z"),
      commit(RESET_COMMIT_MESSAGE, "2026-08-28T18:36:11Z"),
    ]);
    assert.equal(start, "2026-08-28T18:36:11Z");
  });

  await t.test("ignores a commit that only mentions the reset", () => {
    const start = productStartedAt([
      commit(`Explain why "${RESET_COMMIT_MESSAGE}" runs last`, "2026-09-01T00:00:00Z"),
      commit(RESET_COMMIT_MESSAGE, "2026-08-28T18:36:11Z"),
    ]);
    assert.equal(start, "2026-08-28T18:36:11Z");
  });

  await t.test("is unbounded when there has never been a reset", () => {
    assert.equal(productStartedAt([]), null);
  });
});

test("listing what shipped after a reset", async (t) => {
  const closed = [
    { number: 1, title: "Old product, shipped before the reset", stateReason: "COMPLETED", closedAt: "2026-08-27T10:00:00Z" },
    { number: 2, title: "New product, shipped after it", stateReason: "COMPLETED", closedAt: "2026-08-29T10:00:00Z" },
  ];

  await t.test("leaves out work the previous product shipped", () => {
    fs.writeFileSync(process.env.FAKE_GH_CLOSED, JSON.stringify(closed));
    fs.writeFileSync(process.env.FAKE_GH_RESETS, JSON.stringify([commit(RESET_COMMIT_MESSAGE, "2026-08-28T18:36:11Z")]));
    assert.deepEqual(fetchShippedIssues().map((i) => i.number), [2]);
  });

  await t.test("keeps everything when there has never been a reset", () => {
    fs.writeFileSync(process.env.FAKE_GH_CLOSED, JSON.stringify(closed));
    assert.deepEqual(fetchShippedIssues().map((i) => i.number), [1, 2]);
  });

  await t.test("searches this repository for the reset's own commit message", () => {
    fs.writeFileSync(process.env.FAKE_GH_CLOSED, "[]");
    fetchShippedIssues();
    const search = calls().find((c) => c.startsWith("search commits"));
    assert.ok(search.includes(RESET_COMMIT_MESSAGE) && search.includes("--repo owner/repo"), search);
  });

  await t.test("throws rather than guessing there was no reset when the search fails", () => {
    fs.writeFileSync(process.env.FAKE_GH_CLOSED, JSON.stringify(closed));
    process.env.FAKE_GH_SEARCH_FAILS = "1";
    assert.throws(() => fetchShippedIssues(), /Could not find when the current product began/);
  });
});

test("retiring a ticket", async (t) => {
  await t.test("closes it as not planned", async () => {
    await retireIssue(7, "Superseded by #8.");
    assert.ok(calls().includes("issue close 7 --reason not planned"), calls().join("\n"));
  });

  await t.test("takes its card off the board rather than moving it to Done", async () => {
    await retireIssue(7, "Superseded by #8.");
    assert.ok(calls().some((c) => c.startsWith("project item-delete") && c.includes("--id ITEM_7")), calls().join("\n"));
    assert.ok(!calls().some((c) => c.startsWith("project item-edit")), "a retired card must never be moved to a column");
  });
});
