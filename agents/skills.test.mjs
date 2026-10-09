// A skill is only worth shipping if pi actually loads it. pi reports a missing or
// malformed skill as a diagnostic and carries on, so the agent would simply run
// without it and nothing would say so. These tests are where it says so.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { skillPathsFor, projectSkillProblems, SKILLS_DIR } from "./agent.mjs";

const shippedSkills = () =>
  fs.existsSync(SKILLS_DIR)
    ? fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];

test("shipped skills", async (t) => {
  for (const name of shippedSkills()) {
    await t.test(`${name} loads in pi without diagnostics`, () => {
      const { skills, diagnostics } = loadSkillsFromDir({ dir: join(SKILLS_DIR, name), source: "harness" });
      assert.deepEqual(diagnostics, []);
      assert.deepEqual(skills.map((skill) => skill.name), [name]);
    });
  }
});

test("giving an agent skills", async (t) => {
  await t.test("resolves each named skill to its SKILL.md", (t) => {
    const name = shippedSkills()[0];
    if (!name) return t.skip("no skills shipped yet");
    assert.deepEqual(skillPathsFor([name], ["read"], emptyProject()), [join(SKILLS_DIR, name, "SKILL.md")]);
  });

  await t.test("an agent with no skills needs no tools", () => {
    assert.deepEqual(skillPathsFor([], [], emptyProject()), []);
  });

  await t.test("rejects a skill the harness does not ship", () => {
    assert.throws(() => skillPathsFor(["no-such-skill"], ["read"]), /Unknown skill "no-such-skill"/);
  });

  await t.test("rejects skills for an agent that cannot read them", (t) => {
    const name = shippedSkills()[0];
    if (!name) return t.skip("no skills shipped yet");
    assert.throws(() => skillPathsFor([name], []), /needs the read or bash tool/);
  });
});

// A docs/skills/ stand-in, so these tests do not depend on what the current
// product happens to ship.
const projectWith = (skills) => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "project-skills-"));
  for (const [name, content] of Object.entries(skills)) {
    fs.mkdirSync(join(dir, name));
    if (content !== null) fs.writeFileSync(join(dir, name, "SKILL.md"), content);
  }
  return dir;
};
const emptyProject = () => projectWith({});
const skillFile = (name, description = "When to use it.") => `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`;

test("project skills", async (t) => {
  await t.test("are offered to every agent that can read them", () => {
    const project = projectWith({ "game-design": skillFile("game-design") });
    assert.deepEqual(skillPathsFor([], ["read"], project), [join(project, "game-design", "SKILL.md")]);
    assert.deepEqual(skillPathsFor([], ["bash"], project), [join(project, "game-design", "SKILL.md")]);
  });

  await t.test("are left out, without an error, for an agent that cannot read", () => {
    const project = projectWith({ "game-design": skillFile("game-design") });
    assert.deepEqual(skillPathsFor([], [], project), []);
  });

  await t.test("come after the skills the caller named", (t) => {
    const name = shippedSkills()[0];
    if (!name) return t.skip("no skills shipped yet");
    const project = projectWith({ "game-design": skillFile("game-design") });
    assert.deepEqual(skillPathsFor([name], ["read"], project), [
      join(SKILLS_DIR, name, "SKILL.md"),
      join(project, "game-design", "SKILL.md"),
    ]);
  });

  await t.test("a product with no docs/skills/ has none", () => {
    assert.deepEqual(skillPathsFor([], ["read"], join(os.tmpdir(), "no-such-project-skills")), []);
  });
});

test("checking project skills in the build", async (t) => {
  await t.test("passes skills pi loads cleanly", () => {
    assert.deepEqual(projectSkillProblems(projectWith({ "game-design": skillFile("game-design") })), []);
  });

  await t.test("passes a product with no docs/skills/", () => {
    assert.deepEqual(projectSkillProblems(join(os.tmpdir(), "no-such-project-skills")), []);
  });

  await t.test("fails a skill directory with no SKILL.md", () => {
    const problems = projectSkillProblems(projectWith({ "game-design": null }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /game-design.*has no SKILL\.md/);
  });

  await t.test("fails a skill pi would skip, with pi's reason", () => {
    const problems = projectSkillProblems(projectWith({ "game-design": "---\nname: game-design\n---\n\nBody.\n" }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /game-design.*description is required/);
  });

  await t.test("fails a skill whose name is not its directory's", () => {
    const problems = projectSkillProblems(projectWith({ "game-design": skillFile("design") }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /named "design".*directory is "game-design"/);
  });

  await t.test("fails a skill that takes a harness skill's name", (t) => {
    const name = shippedSkills()[0];
    if (!name) return t.skip("no skills shipped yet");
    const problems = projectSkillProblems(projectWith({ [name]: skillFile(name) }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`"${name}" is already a harness skill`));
  });
});
