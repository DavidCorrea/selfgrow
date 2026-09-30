// A skill is only worth shipping if pi actually loads it. pi reports a missing or
// malformed skill as a diagnostic and carries on, so the agent would simply run
// without it and nothing would say so. These tests are where it says so.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { join } from "path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { skillPathsFor, SKILLS_DIR } from "./shared.mjs";

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
    assert.deepEqual(skillPathsFor([name], ["read"]), [join(SKILLS_DIR, name, "SKILL.md")]);
  });

  await t.test("an agent with no skills needs no tools", () => {
    assert.deepEqual(skillPathsFor([], []), []);
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
