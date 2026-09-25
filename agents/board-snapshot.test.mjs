// The board as the PM, PO and Tech Lead read it. Every column but Done is shown
// whole; Done only grows, so it is capped to its most recent tickets — otherwise
// every run's prompt is longer than the last, without limit.
import test from "node:test";
import assert from "node:assert/strict";
import { formatBoardState, RECENT_DONE_SHOWN, AGENT_LABEL } from "./shared.mjs";

const card = (number, status, title = `Ticket ${number}`) => ({ number, title, status });
const agentIssue = (number, title = `Ticket ${number}`) =>
  ({ number, title, labels: [{ name: AGENT_LABEL }] });
const shipped = (count) => Array.from({ length: count }, (_, i) => card(i + 1, "Done"));

test("showing the columns still in play", async (t) => {
  await t.test("lists every open ticket, however many there are", () => {
    const todo = Array.from({ length: RECENT_DONE_SHOWN + 10 }, (_, i) => card(i + 1, "Todo"));
    const text = formatBoardState(todo, todo.map((c) => agentIssue(c.number)));
    const lines = text.split("\n");
    for (const c of todo) assert.ok(lines.includes(`- #${c.number} Ticket ${c.number}`), `#${c.number} missing`);
    assert.doesNotMatch(text, /more shipped earlier/);
  });

  await t.test("folds open issues missing from the board into their own group", () => {
    const text = formatBoardState([], [agentIssue(7, "Loose ticket")]);
    assert.match(text, /\*\*Todo \(not yet on board\)\*\* \(1\):\n- #7 Loose ticket/);
  });

  await t.test("marks a ticket a person filed", () => {
    const text = formatBoardState([card(3, "Todo")], [{ number: 3, title: "Ticket 3", labels: [] }]);
    assert.match(text, /#3 Ticket 3 _\(from a person\)_/);
  });

  await t.test("says so when the board is empty", () => {
    assert.equal(formatBoardState([], []), "(no tickets yet — the board is empty)");
  });
});

test("keeping the Done column from growing without bound", async (t) => {
  await t.test("lists all of Done while it fits", () => {
    const text = formatBoardState(shipped(RECENT_DONE_SHOWN), []);
    assert.ok(text.split("\n").includes("- #1 Ticket 1"));
    assert.doesNotMatch(text, /more shipped earlier/);
  });

  await t.test("names only the most recent tickets and counts the rest", () => {
    const text = formatBoardState(shipped(RECENT_DONE_SHOWN + 12), []);
    assert.match(text, new RegExp(`#${RECENT_DONE_SHOWN + 12} Ticket`));
    assert.match(text, /#13 Ticket 13/);
    assert.doesNotMatch(text, /#12 Ticket 12/);
    assert.match(text, /…and 12 more shipped earlier/);
  });

  await t.test("still reports the column's full size in its heading", () => {
    const text = formatBoardState(shipped(RECENT_DONE_SHOWN + 12), []);
    assert.match(text, new RegExp(`\\*\\*Done\\*\\* \\(${RECENT_DONE_SHOWN + 12}\\)`));
  });

  await t.test("puts the newest first even when the board lists oldest first", () => {
    const newest = RECENT_DONE_SHOWN + 1;
    const text = formatBoardState(shipped(newest), []);
    assert.ok(text.startsWith(`**Done** (${newest}):\n- #${newest} Ticket ${newest}\n`));
    assert.ok(!text.split("\n").includes("- #1 Ticket 1"));
  });

  await t.test("treats a draft card with no number as the oldest", () => {
    const board = [card(null, "Done", "Old draft"), ...shipped(RECENT_DONE_SHOWN)];
    const text = formatBoardState(board, []);
    assert.doesNotMatch(text, /Old draft/);
    assert.match(text, /…and 1 more shipped earlier/);
  });

  await t.test("stays the same size as the project ships more", () => {
    const lines = (count) => formatBoardState(shipped(count), []).split("\n").length;
    assert.equal(lines(100), lines(1000));
  });
});
