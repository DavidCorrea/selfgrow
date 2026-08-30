// The ledger is the only thing standing between the pipeline and the account's
// daily cap, and it is parsed out of a wiki page a human may also edit by hand.
// These cover the parse/render round trip — the part that decides how many
// requests every other agent believes it has left.
import test from "node:test";
import assert from "node:assert/strict";
import { parseLedger, renderLedger } from "./shared.mjs";

test("reading a day's spend from the ledger page", async (t) => {
  await t.test("reads one line per day", () => {
    const days = parseLedger("- 2026-08-30: 412\n- 2026-08-29: 88\n");
    assert.equal(days.get("2026-08-30"), 412);
    assert.equal(days.get("2026-08-29"), 88);
  });

  await t.test("ignores prose around the numbers, so a hand-written note cannot corrupt the count", () => {
    const page = [
      "# Request Budget",
      "",
      "Some explanation an agent wrote.",
      "- 2026-08-30: 412",
      "- not a date: 999",
      "Checked this by hand, looks right.",
    ].join("\n");
    const days = parseLedger(page);
    assert.deepEqual([...days], [["2026-08-30", 412]]);
  });

  await t.test("rejects impossible dates, which would otherwise occupy a slot forever", () => {
    // A loose \d{2}-\d{2} accepts these, and they then sort above every real
    // date — so they can never age out of a window trimmed newest-first.
    const days = parseLedger("- 2026-13-01: 5\n- 2026-01-32: 5\n- 2026-00-10: 5\n");
    assert.equal(days.size, 0);
  });

  await t.test("reports no spend for a day the page has never heard of", () => {
    assert.equal(parseLedger("- 2026-08-30: 412").get("2026-08-29"), undefined);
  });

  await t.test("reads an empty page as an unspent day", () => {
    assert.equal(parseLedger("").size, 0);
  });
});

test("writing the ledger page back", async (t) => {
  await t.test("survives a round trip", () => {
    const original = new Map([["2026-08-30", 412], ["2026-08-29", 88]]);
    assert.deepEqual(parseLedger(renderLedger(original)), original);
  });

  await t.test("keeps the newest days when the history outgrows the window", () => {
    const days = new Map();
    for (let day = 1; day <= 31; day++) days.set(`2026-07-${String(day).padStart(2, "0")}`, day);
    for (let day = 1; day <= 9; day++) days.set(`2026-08-0${day}`, day);
    const kept = parseLedger(renderLedger(days));
    assert.equal(kept.size, 30);
    assert.ok(kept.has("2026-08-09"), "the newest day must survive");
    assert.ok(!kept.has("2026-07-01"), "the oldest day should have aged out");
  });

  await t.test("orders newest first, so the current day is the first line a reader sees", () => {
    const page = renderLedger(new Map([["2026-08-28", 1], ["2026-08-30", 3], ["2026-08-29", 2]]));
    const dates = [...page.matchAll(/^- (\d{4}-\d{2}-\d{2}):/gm)].map((m) => m[1]);
    assert.deepEqual(dates, ["2026-08-30", "2026-08-29", "2026-08-28"]);
  });
});
