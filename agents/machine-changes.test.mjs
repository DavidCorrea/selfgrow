// Which human PRs the Devs may approve and merge on their own.
//
// A change to the machine — its workflows, agents, prompts or dependencies —
// decides what every later review and merge does. Those are reviewed but left
// for a person to merge; everything else goes through as before.
import test from "node:test";
import assert from "node:assert/strict";
import { changesTheMachine } from "./review-pr.mjs";

test("a change the Devs may merge themselves", async (t) => {
  await t.test("touches only the product", () => {
    assert.equal(changesTheMachine(["docs/index.html", "docs/garden.js"]), false);
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
