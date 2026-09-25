// Prompts are filled with diffs, files and issue bodies — text the pipeline did
// not write. Filling one must put that text in verbatim, never read it as
// template syntax.
import test from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "./shared.mjs";

test("filling a prompt template", async (t) => {
  await t.test("substitutes every occurrence of a placeholder", () => {
    assert.equal(fillTemplate("{{A}} and {{A}}, then {{B}}", { A: "x", B: 2 }), "x and x, then 2");
  });

  await t.test("leaves a placeholder with no replacement as written", () => {
    assert.equal(fillTemplate("{{A}} {{MISSING}}", { A: "x" }), "x {{MISSING}}");
  });

  // String.replace reads `$&`, `$'` and `` $` `` in a replacement string as
  // references to the match — a diff containing them garbled the prompt.
  await t.test("keeps dollar sequences in a value literally", () => {
    const diff = "- price = '$&'\n+ price = `$'` + $`";
    assert.equal(fillTemplate("before {{DIFF}} after", { DIFF: diff }), `before ${diff} after`);
  });

  await t.test("does not expand a placeholder that appears inside a value", () => {
    const prompt = fillTemplate("{{DIFF}}\n\nVision: {{VISION}}", { DIFF: "+ Read {{VISION}} first", VISION: "a garden" });
    assert.equal(prompt, "+ Read {{VISION}} first\n\nVision: a garden");
  });
});
