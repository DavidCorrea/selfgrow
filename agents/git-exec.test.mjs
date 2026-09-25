// gitExec runs git from an argv array, with no shell in between.
//
// Commit messages and branch names carry model-written text, and the runner that
// executes them holds a PAT. Through a shell, a backtick or `$(...)` in a commit
// message is a command. These tests commit into a throwaway repository and read
// the message back, so they prove the text arrives exactly as written rather than
// trusting that it does.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { gitExec } from "./shared.mjs";

describe("gitExec with model-written text", () => {
  let repo;
  const inRepo = (argv) => gitExec(argv, { cwd: repo, stdio: "pipe" });

  before(() => {
    repo = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-git-exec-"));
    inRepo(["init", "--quiet"]);
    inRepo(["config", "user.name", "test"]);
    inRepo(["config", "user.email", "test@example.com"]);
  });

  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  test("commits a message with backticks, $(...), quotes and newlines literally", () => {
    const canary = join(repo, "pwned");
    const message =
      `Fix the \`tile\` layout $(touch ${canary}) \`touch ${canary}\`\n\n` +
      `He said "don't" and 'do' — $HOME stays $HOME; a \\ backslash too`;

    inRepo(["commit", "--allow-empty", "--quiet", "-m", message]);

    assert.equal(inRepo(["log", "-1", "--format=%B"]), message);
    assert.equal(fs.existsSync(canary), false, "a substitution in the message ran as a command");
  });

  test("treats a branch name full of shell metacharacters as one argument", () => {
    const branch = "agent/fix-$(whoami)-`id`;true&&false";

    inRepo(["branch", branch]);

    assert.equal(inRepo(["branch", "--list", branch, "--format=%(refname:short)"]), branch);
  });
});
