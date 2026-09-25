// The reset's keep-list. Everything not on it is deleted from main, so what these
// pin down is that the machine never deletes itself.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import { join } from "path";
import {
  isHarnessPath,
  incompleteResetMessage,
  closeAllIssues,
  resetBranchName,
  unmergedDeletionGap,
  landProductDeletion,
} from "./reset.mjs";
import { repoRoot, RESET_COMMIT_MESSAGE } from "./shared.mjs";

test("deciding what survives a reset", async (t) => {
  await t.test("keeps every tracked file outside docs/, so a new root harness file cannot be deleted unnoticed", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot }).toString().split("\n").filter(Boolean);
    const unkept = tracked.filter((path) => !path.startsWith("docs/") && !isHarnessPath(path));
    assert.deepEqual(unkept, [], "add these to HARNESS_PATHS in reset.mjs, or move them under docs/ if they are product");
  });

  await t.test("keeps the harness code that lives in docs/", () => {
    assert.equal(isHarnessPath("docs/webmcp.js"), true);
    assert.equal(isHarnessPath("docs/.gitkeep"), true);
  });

  await t.test("deletes product files in docs/", () => {
    assert.equal(isHarnessPath("docs/index.html"), false);
  });

  await t.test("deletes a root-level file the product left behind", () => {
    assert.equal(isHarnessPath("check-seeds.mjs"), false);
  });

  await t.test("matches whole path segments, not name prefixes", () => {
    assert.equal(isHarnessPath("agents-old/run.mjs"), false);
    assert.equal(isHarnessPath("agents/devs.mjs"), true);
  });
});

test("ending a reset that could not do everything", async (t) => {
  await t.test("says nothing when every step was done", () => {
    assert.equal(incompleteResetMessage([]), null);
  });

  // The operator finishes these by hand, so the message is the checklist.
  await t.test("lists every step that was not done, so none reads as success", () => {
    const message = incompleteResetMessage(["clear the board (could not list its items)", "delete label attempts:2"]);
    assert.match(message, /INCOMPLETE — 2 thing\(s\) were not done/);
    assert.match(message, /^- clear the board \(could not list its items\)$/m);
    assert.match(message, /^- delete label attempts:2$/m);
  });
});

// A `gh` first on PATH that records what it was asked and lists two open issues:
// the gh boundary, not our code.
test("closing the previous product's issues", async (t) => {
  const fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-reset-gh-"));
  const callLog = join(fakeBin, "calls.log");
  fs.writeFileSync(
    join(fakeBin, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${callLog}"
case "$1 $2" in
  "issue list") echo '[{"number":3,"title":"Unbuilt"},{"number":4,"title":"Also unbuilt"}]' ;;
esac
`,
    { mode: 0o755 }
  );
  const realPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${realPath}`;
  t.after(() => {
    process.env.PATH = realPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  // Closed as completed, they would count as shipped in the new product's first week.
  await t.test("closes every open issue as not planned", () => {
    closeAllIssues();
    const closes = fs.readFileSync(callLog, "utf-8").split("\n").filter((c) => c.startsWith("issue close"));
    assert.deepEqual(closes, ["issue close 3 --reason not planned", "issue close 4 --reason not planned"]);
  });
});

test("naming the branch that carries the product deletion", async (t) => {
  // Outside agent/, which the reset itself sweeps.
  await t.test("puts it under reset/, named for the day the reset ran", () => {
    assert.equal(resetBranchName(new Date("2026-09-25T13:45:00Z")), "reset/clear-product-2026-09-25");
  });
});

test("reporting a product deletion that did not merge", async (t) => {
  await t.test("links the pull request left open, so the operator can finish it", () => {
    assert.match(
      unmergedDeletionGap(874, "DavidCorrea/selfgrow"),
      /left open as https:\/\/github\.com\/DavidCorrea\/selfgrow\/pull\/874 /
    );
  });

  await t.test("names the pull request by number when the repository is not known", () => {
    assert.match(unmergedDeletionGap(874, undefined), /left open as #874 /);
  });
});

// A `gh` first on PATH that opens PR #9 and answers each merge as scripted: the gh
// boundary, not our code. Auto-merge is refused throughout, so mergePR takes its
// direct merge and nothing here waits on a poll.
test("landing the product deletion through a pull request", async (t) => {
  const fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-reset-land-"));
  const callLog = join(fakeBin, "calls.log");
  fs.writeFileSync(
    join(fakeBin, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${callLog}"
case "$*" in
  "pr create"*) [ "$FAKE_GH_CREATE_FAILS" = 1 ] && exit 1; echo "https://github.com/o/r/pull/9" ;;
  *"--auto"*) exit 1 ;;
  "pr merge"*) [ "$FAKE_GH_MERGE_FAILS" = 1 ] && exit 1; exit 0 ;;
esac
`,
    { mode: 0o755 }
  );
  const realPath = process.env.PATH;
  const realRepository = process.env.GITHUB_REPOSITORY;
  process.env.PATH = `${fakeBin}:${realPath}`;
  process.env.GITHUB_REPOSITORY = "o/r";
  t.after(() => {
    process.env.PATH = realPath;
    if (realRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = realRepository;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });
  t.beforeEach(() => {
    fs.writeFileSync(callLog, "");
    delete process.env.FAKE_GH_CREATE_FAILS;
    delete process.env.FAKE_GH_MERGE_FAILS;
  });
  const calls = () => fs.readFileSync(callLog, "utf-8").split("\n").filter(Boolean);

  // productStartedAt reads the reset commit's own message on main, which a squash
  // would replace with the PR's.
  await t.test("opens it under the reset's message and merges it with a merge commit", async () => {
    assert.equal(await landProductDeletion("reset/clear-product-2026-09-25"), null);
    assert.ok(
      calls().some((call) =>
        call.startsWith(`pr create --base main --head reset/clear-product-2026-09-25 --title ${RESET_COMMIT_MESSAGE}`)
      )
    );
    assert.ok(calls().includes("pr merge 9 --merge --delete-branch"));
  });

  await t.test("leaves the pull request open and reports it by URL when it cannot merge", async () => {
    process.env.FAKE_GH_MERGE_FAILS = "1";
    const gap = await landProductDeletion("reset/clear-product-2026-09-25");
    assert.match(gap, /left open as https:\/\/github\.com\/o\/r\/pull\/9 /);
    assert.ok(!calls().some((call) => call.startsWith("pr close")));
  });

  await t.test("names the branch holding the deletion when the pull request could not be opened", async () => {
    process.env.FAKE_GH_CREATE_FAILS = "1";
    const gap = await landProductDeletion("reset/clear-product-2026-09-25");
    assert.match(gap, /open a pull request from reset\/clear-product-2026-09-25/);
  });
});
