// A lookup that failed, or came back incomplete, must not read as one that found
// nothing.
//
// These listings used to answer [] when gh failed, and every caller took that for
// an empty board: no open PRs meant no ticket was claimed, so a run opened a
// second PR beside one already in flight. They also stopped silently at their
// --limit, so an open blocker past the cutoff looked shipped. These tests put a
// scripted `gh` first on PATH — the gh boundary, not our code — and check each
// failure arrives as a failure, naming what could not be read.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import {
  fetchOpenIssues,
  fetchOpenAgentPullRequests,
  listProjectItems,
  getCurrentMilestone,
  isConfirmedShipped,
  fetchShippedIssues,
} from "./shared.mjs";

let fakeBin;
const realPath = process.env.PATH;

// The fake answers with whatever the test scripted: stdout from a file, a line on
// stderr, and an exit code.
const FAKE_GH = `#!/bin/sh
[ -n "$FAKE_GH_STDOUT_FILE" ] && cat "$FAKE_GH_STDOUT_FILE"
[ -n "$FAKE_GH_STDERR" ] && echo "$FAKE_GH_STDERR" >&2
exit "\${FAKE_GH_EXIT:-0}"
`;

function scriptGh({ stdout = "", stderr = "", exit = 0 }) {
  const stdoutFile = join(fakeBin, "stdout");
  fs.writeFileSync(stdoutFile, stdout);
  process.env.FAKE_GH_STDOUT_FILE = stdoutFile;
  process.env.FAKE_GH_STDERR = stderr;
  process.env.FAKE_GH_EXIT = String(exit);
}

before(() => {
  fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-fake-gh-"));
  fs.writeFileSync(join(fakeBin, "gh"), FAKE_GH, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:${realPath}`;
});

after(() => {
  process.env.PATH = realPath;
  delete process.env.FAKE_GH_STDOUT_FILE;
  delete process.env.FAKE_GH_STDERR;
  delete process.env.FAKE_GH_EXIT;
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

test("a listing gh could not answer throws instead of reading as empty", async (t) => {
  scriptGh({ stderr: "HTTP 502: Bad Gateway", exit: 1 });

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

  await t.test("what shipped, where 'nothing' would be published as the week", () => {
    assert.throws(() => fetchShippedIssues(), /Could not list closed issues/);
  });
});

test("a listing that reached its limit throws instead of passing for the whole", async (t) => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `#${i + 1}`, labels: [] }));

  await t.test("open issues", () => {
    scriptGh({ stdout: JSON.stringify(rows(1000)) });
    assert.throws(() => fetchOpenIssues(), /open issues reached its limit of 1000/);
  });

  await t.test("the board's items", () => {
    scriptGh({ stdout: JSON.stringify({ items: rows(1000) }) });
    assert.throws(() => listProjectItems(), /board's items reached its limit/);
  });

  await t.test("open pull requests", () => {
    scriptGh({ stdout: JSON.stringify(rows(1000)) });
    assert.throws(() => fetchOpenAgentPullRequests(), /open pull requests reached its limit/);
  });

  await t.test("a listing under its limit is returned whole", () => {
    scriptGh({ stdout: JSON.stringify(rows(3)) });
    assert.equal(fetchOpenIssues().length, 3);
  });
});

test("confirming a dependency missing from the open listing has shipped", async (t) => {
  await t.test("a closed issue has shipped", () => {
    scriptGh({ stdout: "closed\n" });
    assert.equal(isConfirmedShipped(101), true);
  });

  await t.test("an open one has not, though the listing missed it", () => {
    scriptGh({ stdout: "open\n" });
    assert.equal(isConfirmedShipped(102), false);
  });

  await t.test("one that never existed is a stale reference, not a blocker", () => {
    scriptGh({ stderr: "gh: Not Found (HTTP 404)", exit: 1 });
    assert.equal(isConfirmedShipped(103), true);
  });

  await t.test("one gh could not look up has not been shown to ship", () => {
    scriptGh({ stderr: "HTTP 502: Bad Gateway", exit: 1 });
    assert.equal(isConfirmedShipped(104), false);
  });
});
