// The agent tool contract. A broken tool renders a perfect page and throws no
// console error, so every other verify layer passes while the product is
// unusable by the agents it claims to serve — this is the only thing that looks.
import test from "node:test";
import assert from "node:assert/strict";
import { validateToolDescriptors } from "./shared.mjs";

// A descriptor the browser has already reduced to its checkable properties.
const summary = (over = {}) => ({
  name: "get-garden-state",
  description: "Describes the garden right now: the season, the weather, and what is growing in the plot.",
  inputSchema: { type: "object", properties: {} },
  hasExecute: true,
  hasExample: true,
  annotated: true,
  mutates: false,
  invocation: { ok: true },
  ...over,
});

const only = (over) => validateToolDescriptors([summary(over)]);

test("a product that declares no usable tools", async (t) => {
  await t.test("reports a product no agent can use", () => {
    assert.match(validateToolDescriptors([])[0], /returned no tools/);
  });

  await t.test("reports a tools() that did not return a list", () => {
    assert.match(validateToolDescriptors(null)[0], /did not return an array/);
  });

  await t.test("passes a sound single-tool product", () => {
    assert.deepEqual(validateToolDescriptors([summary()]), []);
  });
});

test("naming a tool", async (t) => {
  await t.test("rejects a tool with no name", () => {
    assert.match(only({ name: undefined })[0], /has no name/);
  });

  await t.test("rejects a name an agent cannot type unambiguously", () => {
    assert.match(only({ name: "getGardenState" })[0], /kebab-case/);
  });

  await t.test("names the duplicate rather than silently keeping one", () => {
    const problems = validateToolDescriptors([summary(), summary()]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /declared twice/);
  });
});

test("the description is the whole interface", async (t) => {
  await t.test("rejects a missing description", () => {
    assert.match(only({ description: "" })[0], /has no description/);
  });

  await t.test("rejects a label pretending to be a description", () => {
    assert.match(only({ description: "Gets state" })[0], /say what it returns/);
  });

  await t.test("accepts a description that says what it returns and when to ask", () => {
    assert.deepEqual(only({
      description: "Returns the current weather over the garden, and how long it has held.",
    }), []);
  });
});

test("the schema and the handler", async (t) => {
  await t.test("rejects an inputSchema that is not an object schema", () => {
    assert.match(only({ inputSchema: { type: "string" } })[0], /JSON Schema object/);
  });

  await t.test("rejects a described capability nothing implements", () => {
    assert.match(only({ hasExecute: false })[0], /has no execute/);
  });

  await t.test("rejects a tool the build cannot call", () => {
    assert.match(only({ hasExample: false })[0], /no example input/);
  });

  await t.test("reports a handler that failed on its own example", () => {
    const problems = only({ invocation: { ok: false, error: "it did not answer within 3000ms" } });
    assert.match(problems[0], /failed when called with its own example/);
    assert.match(problems[0], /did not answer/);
  });
});

test("a caller deciding whether to ask a human first", async (t) => {
  await t.test("rejects a mutating tool that declares nothing about itself", () => {
    assert.match(only({ mutates: true, annotated: false })[0], /declares no annotations/);
  });

  await t.test("accepts a mutating tool that is annotated", () => {
    assert.deepEqual(only({ mutates: true, annotated: true }), []);
  });

  await t.test("does not ask a read-only tool for annotations it does not need", () => {
    assert.deepEqual(only({ mutates: false, annotated: false }), []);
  });
});

test("reporting more than one fault at a time", async (t) => {
  await t.test("names every problem with a tool rather than the first", () => {
    const problems = only({ name: "Get_State", description: "x", hasExample: false });
    assert.equal(problems.length, 3);
    assert.ok(problems.every((p) => p.includes("Get_State")));
  });
});
