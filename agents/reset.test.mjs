// The reset's keep-list. Everything not on it is deleted from main, so what these
// pin down is that the machine never deletes itself.
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "child_process";
import { isHarnessPath } from "./reset.mjs";
import { repoRoot } from "./shared.mjs";

test("deciding what survives a reset", async (t) => {
  await t.test("keeps every tracked file outside docs/, so a new root harness file cannot be deleted unnoticed", () => {
    const tracked = execSync("git ls-files", { cwd: repoRoot }).toString().split("\n").filter(Boolean);
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
