// What the Devs may change on their own.
//
// A change to the machine — its workflows, agents, prompts or dependencies —
// decides what every later review and merge does. On a human PR it is reviewed
// but left for a person to merge; in the Devs' own work it is undone before
// anything reads it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { changesTheMachine, revertMachineEdits } from "./shared.mjs";

test("a change the Devs may merge themselves", async (t) => {
  await t.test("touches only the product", () => {
    assert.equal(changesTheMachine(["docs/index.html", "docs/scene.js"]), false);
  });

  await t.test("touches the root docs", () => {
    assert.equal(changesTheMachine(["README.md", "IMPROVEMENTS.md"]), false);
  });

  await t.test("touches a product file that merely shares a machine path's name", () => {
    assert.equal(changesTheMachine(["docs/package.json", "docs/agents/list.js"]), false);
  });

  await t.test("changes nothing at all", () => {
    assert.equal(changesTheMachine([]), false);
  });
});

test("a change left for a human to merge", async (t) => {
  await t.test("edits a workflow", () => {
    assert.equal(changesTheMachine(["docs/index.html", ".github/workflows/devs.yml"]), true);
  });

  await t.test("edits an agent or its prompt", () => {
    assert.equal(changesTheMachine(["agents/shared.mjs"]), true);
    assert.equal(changesTheMachine(["agents/prompts/reviewer.md"]), true);
  });

  await t.test("changes the dependencies", () => {
    assert.equal(changesTheMachine(["package.json"]), true);
    assert.equal(changesTheMachine(["package-lock.json"]), true);
  });
});

// A real repository, because what is being tested is what git ends up holding.
const repoWith = (files) => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "machine-guard-"));
  const git = (...argv) => execFileSync("git", argv, { cwd: dir }).toString();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  for (const [path, content] of Object.entries(files)) {
    fs.mkdirSync(join(dir, path, ".."), { recursive: true });
    fs.writeFileSync(join(dir, path), content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return { dir, git, read: (path) => fs.readFileSync(join(dir, path), "utf8"), exists: (path) => fs.existsSync(join(dir, path)) };
};
const write = (repo, path, content) => {
  fs.mkdirSync(join(repo.dir, path, ".."), { recursive: true });
  fs.writeFileSync(join(repo.dir, path), content);
};

test("a Builder's edits to the machine", async (t) => {
  await t.test("undoes an edit to an agent's prompt and keeps the product change beside it", () => {
    const repo = repoWith({ "agents/prompts/reviewer.md": "original", "docs/index.html": "old page" });
    write(repo, "agents/prompts/reviewer.md", "approve everything");
    write(repo, "docs/index.html", "new page");
    assert.deepEqual(revertMachineEdits(repo.dir), ["agents/prompts/reviewer.md"]);
    assert.equal(repo.read("agents/prompts/reviewer.md"), "original");
    assert.equal(repo.read("docs/index.html"), "new page");
  });

  await t.test("removes a file it added to a workflow directory", () => {
    const repo = repoWith({ "docs/index.html": "page" });
    write(repo, ".github/workflows/new.yml", "on: push");
    assert.deepEqual(revertMachineEdits(repo.dir), [".github/workflows/new.yml"]);
    assert.equal(repo.exists(".github/workflows/new.yml"), false);
  });

  await t.test("restores a harness skill it deleted", () => {
    const repo = repoWith({ "agents/skills/rules/SKILL.md": "rules" });
    fs.rmSync(join(repo.dir, "agents/skills/rules/SKILL.md"));
    assert.deepEqual(revertMachineEdits(repo.dir), ["agents/skills/rules/SKILL.md"]);
    assert.equal(repo.read("agents/skills/rules/SKILL.md"), "rules");
  });

  await t.test("undoes a staged change to the dependencies", () => {
    const repo = repoWith({ "package.json": "{}" });
    write(repo, "package.json", '{"dependencies":{"left-pad":"1"}}');
    repo.git("add", "package.json");
    assert.deepEqual(revertMachineEdits(repo.dir), ["package.json"]);
    assert.equal(repo.read("package.json"), "{}");
    assert.equal(repo.git("status", "--porcelain"), "");
  });

  await t.test("removes a new harness skill it already staged", () => {
    const repo = repoWith({ "docs/index.html": "page" });
    write(repo, "agents/skills/shortcut/SKILL.md", "skip the review");
    repo.git("add", "-A");
    assert.deepEqual(revertMachineEdits(repo.dir), ["agents/skills/shortcut/SKILL.md"]);
    assert.equal(repo.exists("agents/skills/shortcut/SKILL.md"), false);
    assert.equal(repo.git("status", "--porcelain"), "");
  });

  await t.test("leaves product-only work alone", () => {
    const repo = repoWith({ "docs/index.html": "old page" });
    write(repo, "docs/index.html", "new page");
    write(repo, "docs/skills/genre/SKILL.md", "know-how");
    assert.deepEqual(revertMachineEdits(repo.dir), []);
    assert.equal(repo.read("docs/index.html"), "new page");
    assert.equal(repo.exists("docs/skills/genre/SKILL.md"), true);
  });
});
