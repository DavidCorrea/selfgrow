// The PM grooms twice a day, but its weekly work — the curation pass and the
// week's report — belongs to one run only. Curation allows a removal per run, so
// a second Sunday run would double the week's removals.
import test from "node:test";
import assert from "node:assert/strict";
import { isWeeklyRun } from "./product-manager.mjs";

test("choosing the run that does the weekly work", async (t) => {
  await t.test("is the Sunday morning run", () => {
    assert.equal(isWeeklyRun(new Date("2026-10-04T00:30:00Z")), true);
  });

  await t.test("is not the Sunday midday run", () => {
    assert.equal(isWeeklyRun(new Date("2026-10-04T12:30:00Z")), false);
  });

  await t.test("is not a morning run on any other day", () => {
    assert.equal(isWeeklyRun(new Date("2026-10-05T00:30:00Z")), false);
  });
});
