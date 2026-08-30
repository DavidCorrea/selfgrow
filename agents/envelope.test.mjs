// Every agent answers in a JSON envelope, and free models are careless about it.
// What these pin down is the boundary between "the model said something usable"
// and "fall through to the next model in the chain" — get it wrong in the lenient
// direction and malformed work reaches the branch; get it wrong in the strict
// direction and the run burns the whole chain on answers that were fine.
import test from "node:test";
import assert from "node:assert/strict";
import { extractJSON, extractAgentResponse } from "./shared.mjs";

const envelope = (over = {}) => JSON.stringify({
  status: "success",
  summary: "Did the thing.",
  outcome: "approve",
  data: { commitMessage: "Add the thing" },
  ...over,
});

test("finding JSON in whatever the model actually returned", async (t) => {
  await t.test("parses a bare object", () => {
    assert.deepEqual(extractJSON("t", '{"a":1}'), { a: 1 });
  });

  await t.test("parses a fenced block", () => {
    assert.deepEqual(extractJSON("t", '```json\n{"a":1}\n```'), { a: 1 });
  });

  await t.test("parses an unlabelled fenced block", () => {
    assert.deepEqual(extractJSON("t", '```\n{"a":1}\n```'), { a: 1 });
  });

  await t.test("digs the object out of surrounding chatter", () => {
    assert.deepEqual(extractJSON("t", 'Sure! Here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
  });

  await t.test("is not fooled by braces inside strings", () => {
    assert.deepEqual(extractJSON("t", '{"a":"} not the end {"}'), { a: "} not the end {" });
  });

  await t.test("is not fooled by an escaped quote before a brace", () => {
    assert.deepEqual(extractJSON("t", '{"a":"say \\" }"}'), { a: 'say " }' });
  });

  await t.test("keeps nested objects whole", () => {
    assert.deepEqual(extractJSON("t", 'text {"a":{"b":2}} more'), { a: { b: 2 } });
  });

  await t.test("returns nothing for prose with no object at all", () => {
    assert.equal(extractJSON("t", "I could not complete this task."), null);
  });

  await t.test("returns nothing for an object that was cut off mid-stream", () => {
    assert.equal(extractJSON("t", '{"a": 1, "b": '), null);
  });

  await t.test("returns nothing for empty output", () => {
    assert.equal(extractJSON("t", ""), null);
  });
});

test("validating the agent envelope", async (t) => {
  await t.test("accepts a complete response", () => {
    const parsed = extractAgentResponse("t", envelope());
    assert.equal(parsed.outcome, "approve");
    assert.equal(parsed.data.commitMessage, "Add the thing");
  });

  await t.test("rejects a response missing the envelope fields", () => {
    assert.equal(extractAgentResponse("t", '{"summary":"x","data":{}}'), null, "no status");
    assert.equal(extractAgentResponse("t", '{"status":"success","data":{}}'), null, "no summary");
    assert.equal(extractAgentResponse("t", '{"status":"success","summary":"x"}'), null, "no data");
  });

  await t.test("rejects a response the agent itself marked as an error", () => {
    assert.equal(extractAgentResponse("t", envelope({ status: "error" })), null);
  });

  await t.test("requires an outcome from a gate agent", () => {
    const withoutOutcome = JSON.stringify({ status: "success", summary: "x", data: {} });
    assert.equal(extractAgentResponse("t", withoutOutcome), null);
    assert.ok(extractAgentResponse("t", withoutOutcome, { requireOutcome: false }));
  });

  await t.test("rejects a response whose data is missing a field the caller needs", () => {
    const parsed = extractAgentResponse("t", envelope(), { requiredDataFields: ["files"] });
    assert.equal(parsed, null);
  });

  await t.test("accepts a required field that is present but empty, which is an answer", () => {
    // "no files changed" is a real result; treating it as a missing field would
    // send a correct response back round the retry loop.
    const empty = envelope({ data: { commitMessage: "x", files: [] } });
    assert.ok(extractAgentResponse("t", empty, { requiredDataFields: ["files"] }));
  });
});
