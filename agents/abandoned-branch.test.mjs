// What an abandoned ticket leaves in the working tree, and whether the next
// ticket can start from it.
//
// The Devs drain several tickets in one working tree, so whatever one leaves
// behind is what the next branches from. These tests abandon work in a throwaway
// clone — uncommitted edits, stray files, a merge stopped halfway — and check that
// the tree comes back as origin/main, because that is the only state
// createBranch can start from.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { gitExec, returnToCleanMain } from "./shared.mjs";

describe("returning to main after abandoning a ticket", () => {
  let root;
  let work;
  const inWork = (argv) => gitExec(argv, { cwd: work, stdio: "pipe" });
  const write = (name, text) => fs.writeFileSync(join(work, name), text);
  const commitAll = (message) => {
    inWork(["add", "-A"]);
    inWork(["commit", "--quiet", "-m", message]);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-abandoned-branch-"));
    work = join(root, "work");
    gitExec(["init", "--quiet", "--bare", "--initial-branch=main", join(root, "origin.git")], { stdio: "pipe" });
    gitExec(["clone", "--quiet", join(root, "origin.git"), work], { stdio: "pipe" });
    inWork(["config", "user.name", "test"]);
    inWork(["config", "user.email", "test@example.com"]);
    inWork(["checkout", "--quiet", "-B", "main"]);
    write("scene.js", "export const items = 1;\n");
    commitAll("Add the scene");
    inWork(["push", "--quiet", "origin", "main"]);
    inWork(["checkout", "--quiet", "-b", "agent/issue-7-more-items"]);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const assertCleanOnOriginMain = () => {
    assert.equal(inWork(["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    assert.equal(inWork(["rev-parse", "HEAD"]), inWork(["rev-parse", "origin/main"]));
    assert.equal(inWork(["status", "--porcelain"]), "");
    assert.equal(inWork(["branch", "--list", "agent/issue-7-more-items"]), "");
  };

  test("discards uncommitted edits and stray files a failed verify left behind", () => {
    write("scene.js", "export const items = 2; // broken\n");
    write("scratch.js", "leftover\n");

    returnToCleanMain("agent/issue-7-more-items", { cwd: work });

    assertCleanOnOriginMain();
    assert.equal(fs.existsSync(join(work, "scratch.js")), false);
  });

  test("abandons a merge with main that was stopped halfway through a conflict", () => {
    write("scene.js", "export const items = 3;\n");
    commitAll("Add three items");
    inWork(["checkout", "--quiet", "main"]);
    write("scene.js", "export const items = 4;\n");
    commitAll("Add four items");
    inWork(["push", "--quiet", "origin", "main"]);
    inWork(["checkout", "--quiet", "agent/issue-7-more-items"]);
    assert.throws(() => inWork(["merge", "origin/main", "--no-edit"]));

    returnToCleanMain("agent/issue-7-more-items", { cwd: work });

    assertCleanOnOriginMain();
    assert.equal(fs.existsSync(join(work, ".git", "MERGE_HEAD")), false);
  });

  test("drops the ticket's committed work that never reached main", () => {
    write("scene.js", "export const items = 5;\n");
    commitAll("Add five items");

    returnToCleanMain("agent/issue-7-more-items", { cwd: work });

    assertCleanOnOriginMain();
    assert.equal(fs.readFileSync(join(work, "scene.js"), "utf8"), "export const items = 1;\n");
  });

  test("fails loudly when there is no main to return to", () => {
    inWork(["remote", "remove", "origin"]);

    assert.throws(() => returnToCleanMain("agent/issue-7-more-items", { cwd: work }));
  });
});
