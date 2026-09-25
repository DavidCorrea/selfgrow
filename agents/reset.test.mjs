// The reset's keep-list. Everything not on it is deleted from main, so what these
// pin down is that the machine never deletes itself.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import { isHarnessPath, incompleteResetMessage } from "./reset.mjs";
import { repoRoot } from "./shared.mjs";

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
