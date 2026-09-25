// A lookup that fails must not read as a lookup that found nothing.
//
// These listings used to answer [] when gh failed, and every caller took that for
// an empty board: no open PRs meant no ticket was claimed, so a run opened a
// second PR beside one already in flight. These tests put a `gh` that always fails
// first on PATH — the gh boundary, not our code — and check the failure arrives
// as a failure, naming what could not be read.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { fetchOpenIssues, fetchOpenAgentPullRequests, listProjectItems, getCurrentMilestone } from "./shared.mjs";

let fakeBin;
const realPath = process.env.PATH;

before(() => {
  fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-failing-gh-"));
  fs.writeFileSync(join(fakeBin, "gh"), "#!/bin/sh\necho 'HTTP 502: Bad Gateway' >&2\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}:${realPath}`;
});

after(() => {
  process.env.PATH = realPath;
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

test("a listing gh could not answer throws instead of reading as empty", async (t) => {
  await t.test("open issues", () => {
    assert.throws(() => fetchOpenIssues(), /Could not list open issues/);
  });

  await t.test("open agent pull requests, which are the guard against building a ticket twice", () => {
    assert.throws(() => fetchOpenAgentPullRequests(), /Could not list open pull requests/);
  });

  await t.test("the board's items, which new tickets are deduped against", () => {
    assert.throws(() => listProjectItems(), /Could not list the board's items/);
  });

  await t.test("the open milestones, where 'none' would start a second one", () => {
    assert.throws(() => getCurrentMilestone(), /Could not read the open milestones/);
  });
});
