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
import { isShipped, fetchShippedIssues, retireIssue } from "./shared.mjs";

let fakeBin;
const realPath = process.env.PATH;
const calls = () => fs.readFileSync(process.env.FAKE_GH_LOG, "utf-8").split("\n").filter(Boolean);

const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "issue list") cat "$FAKE_GH_CLOSED" ;;
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
});

beforeEach(() => fs.writeFileSync(process.env.FAKE_GH_LOG, ""));

after(() => {
  process.env.PATH = realPath;
  delete process.env.FAKE_GH_CLOSED;
  delete process.env.FAKE_GH_LOG;
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
