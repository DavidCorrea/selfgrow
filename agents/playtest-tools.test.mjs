// How the tool pass reaches the reporting agent. This is the only place the tool
// surface is judged as something to USE rather than something that runs, so the
// transcript has to carry what a caller actually met: what it was told, what it
// got back, and what it was not allowed to touch.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToolPass } from "./playtester.mjs";

const tool = (over = {}) => ({
  name: "get-state",
  description: "Describes the page right now.",
  schema: '{"type":"object"}',
  readOnly: true,
  consequential: false,
  call: { ok: true, returned: '{"status":"ready"}' },
  ...over,
});

const pass = (tools, over = {}) => renderToolPass({ path: "the browser's own agent API", tools, ...over });

test("a product an agent cannot use", async (t) => {
  await t.test("says so plainly when nothing is declared", () => {
    assert.match(pass([]), /declares no tools, so an agent cannot use it at all/);
  });

  await t.test("does not pretend a failed pass was an empty one", () => {
    assert.match(renderToolPass(null), /could not run/);
  });
});

test("what the caller was told and what came back", async (t) => {
  await t.test("carries the description, because that is the whole interface", () => {
    assert.match(pass([tool()]), /Told: "Describes the page right now\."/);
  });

  await t.test("shows what the tool actually returned", () => {
    assert.match(pass([tool()]), /"status":"ready"/);
  });

  await t.test("reports a failed call as a failure rather than omitting it", () => {
    const rendered = pass([tool({ call: { ok: false, error: "Failed to parse input arguments" } })]);
    assert.match(rendered, /\*\*It failed: Failed to parse input arguments\*\*/);
  });

  await t.test("marks a read-only tool so the reader knows it changed nothing", () => {
    assert.match(pass([tool()]), /### get-state \(read-only\)/);
  });
});

test("tools that were deliberately not called", async (t) => {
  await t.test("says a consequential tool was left alone, and why", () => {
    const rendered = pass([tool({ consequential: true, readOnly: false, call: { skipped: true } })]);
    assert.match(rendered, /marked consequential, so a caller is meant to ask a person first/);
  });

  await t.test("distinguishes running out of time from choosing not to call", () => {
    const rendered = pass([tool({ consequential: false, call: { skipped: true } })]);
    assert.match(rendered, /ran out of time/);
    assert.doesNotMatch(rendered, /consequential/);
  });
});

test("which path reached the tools", async (t) => {
  await t.test("names the browser API when the tools were really registered", () => {
    assert.match(pass([tool()]), /Reached through the browser's own agent API/);
  });

  await t.test("names the fallback, so a silent downgrade is visible", () => {
    const rendered = renderToolPass({ path: "a direct import — this browser has no agent API", tools: [tool()] });
    assert.match(rendered, /a direct import — this browser has no agent API/);
  });
});

test("reporting several tools", async (t) => {
  await t.test("renders every tool rather than the first", () => {
    const rendered = pass([tool(), tool({ name: "advance-time", readOnly: false })]);
    assert.match(rendered, /### get-state/);
    assert.match(rendered, /### advance-time/);
  });
});
