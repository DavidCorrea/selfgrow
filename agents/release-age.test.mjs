// Which pi release the weekly bump installs.
//
// The bump merges itself with no human in the loop, into a runtime that holds the
// model key and a PAT. So it waits: only a release that has been public long
// enough for anyone else to notice it is bad is a candidate.
import test from "node:test";
import assert from "node:assert/strict";
import { newestSettledVersion, compareVersions } from "./pi-update.mjs";

const now = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
const registry = (published, latest) => ({
  time: { created: daysAgo(400), modified: daysAgo(0), ...published },
  versions: Object.keys(published),
  "dist-tags": { latest: latest ?? Object.keys(published).at(-1) },
});
const pick = (reg, minAgeDays = 7) => newestSettledVersion(reg, { minAgeDays, now });

test("choosing a release old enough to trust", async (t) => {
  await t.test("skips a release published inside the waiting period", () => {
    assert.equal(pick(registry({ "0.85.1": daysAgo(20), "0.87.1": daysAgo(3) })), "0.85.1");
  });

  await t.test("takes a release exactly as old as the waiting period", () => {
    assert.equal(pick(registry({ "0.85.1": daysAgo(20), "0.86.0": daysAgo(7) })), "0.86.0");
  });

  await t.test("takes the newest by version, not by publish date, among settled ones", () => {
    assert.equal(pick(registry({ "0.86.0": daysAgo(10), "0.74.3": daysAgo(9) }, "0.86.0")), "0.86.0");
  });

  await t.test("returns nothing when every release is too new", () => {
    assert.equal(pick(registry({ "0.87.0": daysAgo(2), "0.87.1": daysAgo(1) })), null);
  });
});

test("releases that are never candidates", async (t) => {
  await t.test("ignores prereleases however old", () => {
    assert.equal(pick(registry({ "0.86.0": daysAgo(30), "0.87.0-beta.1": daysAgo(20) }, "0.86.0")), "0.86.0");
  });

  await t.test("ignores anything above the latest tag, which is how a bad release is withdrawn", () => {
    assert.equal(pick(registry({ "0.85.0": daysAgo(30), "0.86.0": daysAgo(20) }, "0.85.0")), "0.85.0");
  });

  await t.test("ignores a version the time map remembers but the registry no longer serves", () => {
    const reg = registry({ "0.85.0": daysAgo(30) });
    reg.time["0.86.0"] = daysAgo(20);
    assert.equal(pick(reg), "0.85.0");
  });
});

test("comparing versions", async (t) => {
  await t.test("compares each part as a number, so 0.10.0 is newer than 0.9.0", () => {
    assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  });

  await t.test("treats equal versions as equal", () => {
    assert.equal(compareVersions("0.87.0", "0.87.0"), 0);
  });
});
