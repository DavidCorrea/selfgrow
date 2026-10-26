// How the Playtester plays. It used to only watch, which suited a product that
// moves on by itself and reported every product that waits for a choice as
// inert. Playing goes through the product's own tools, so the rules here are
// what a player may do with them and what the report is told it did.
import test from "node:test";
import assert from "node:assert/strict";
import { createPlay, renderPlay, renderSession, WAIT_TOOL } from "./playtester.mjs";

const declared = [
  { name: "get-state", description: "Shows the table.", inputSchema: { type: "object", properties: {} }, consequential: false },
  { name: "play-card", description: "Plays a card from your hand.", inputSchema: { type: "object", properties: { card: { type: "string" } } }, consequential: false },
  { name: "clear-save", description: "Deletes your collection.", consequential: true },
];

const setup = (overrides = {}) => {
  const calls = [];
  const waits = [];
  let state = "Hand: 5 cards";
  let clock = 0;
  const play = createPlay({
    declared,
    callTool: async (name, input) => {
      calls.push({ name, input });
      if (name === "play-card") state = "Hand: 4 cards";
      return { ok: true, returned: `{"tool":"${name}"}` };
    },
    waitFor: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    readState: async () => state,
    now: () => clock,
    ...overrides,
  });
  const tool = (name) => play.tools.find((candidate) => candidate.name === name);
  const use = (name, params) => tool(name).execute("call", params);
  return { play, calls, waits, tool, use, advance: (ms) => (clock += ms) };
};

const textOf = (result) => result.content[0].text;

test("the tools a player is given", async (t) => {
  await t.test("are the product's own, under its names, descriptions and schemas", () => {
    const { tool } = setup();
    assert.equal(tool("play-card").description, "Plays a card from your hand.");
    assert.deepEqual(tool("play-card").parameters, declared[1].inputSchema);
  });

  await t.test("include a way to let time pass", () => {
    assert.ok(setup().tool(WAIT_TOOL));
  });

  await t.test("give a tool with no schema an empty object to take", () => {
    assert.deepEqual(setup().tool("clear-save").parameters, { type: "object", properties: {} });
  });

  await t.test("say which tools are consequential", () => {
    assert.match(setup().tool("clear-save").description, /consequential/);
  });
});

test("making a move", async (t) => {
  await t.test("calls the product's tool and hands back what it returned", async () => {
    const { use, calls } = setup();
    const result = await use("play-card", { card: "Ember" });
    assert.deepEqual(calls, [{ name: "play-card", input: { card: "Ember" } }]);
    assert.equal(textOf(result), '{"tool":"play-card"}');
  });

  await t.test("records what the page showed afterwards", async () => {
    const { use, play } = setup();
    await use("play-card", { card: "Ember" });
    assert.equal(play.record[0].state, "Hand: 4 cards");
  });

  await t.test("tells the player when a tool failed, rather than returning nothing", async () => {
    const { use } = setup({ callTool: async () => ({ ok: false, error: "no such card" }) });
    assert.match(textOf(await use("play-card", { card: "Nope" })), /The tool failed: no such card/);
  });

  await t.test("refuses a consequential tool without calling it", async () => {
    const { use, calls, play } = setup();
    assert.match(textOf(await use("clear-save", {})), /ask a person first/);
    assert.deepEqual(calls, []);
    assert.equal(play.record[0].declined, true);
  });

  await t.test("lets time pass for at most a minute at a time", async () => {
    const { use, waits } = setup();
    await use(WAIT_TOOL, { seconds: 600 });
    assert.deepEqual(waits, [60_000]);
  });
});

test("the end of a session", async (t) => {
  await t.test("comes after the last move, and the next is not made", async () => {
    const { use, calls } = setup({ moves: 1 });
    await use("get-state", {});
    assert.match(textOf(await use("play-card", { card: "Ember" })), /Your time is up/);
    assert.equal(calls.length, 1);
  });

  await t.test("comes when the minutes run out, however few moves were made", async () => {
    const { use, calls, advance } = setup({ minutes: 1 });
    advance(61_000);
    assert.match(textOf(await use("get-state", {})), /Your time is up/);
    assert.equal(calls.length, 0);
  });
});

test("the played session, as the report is told it", async (t) => {
  const move = (overrides = {}) => ({ atSeconds: 3, tool: "play-card", input: { card: "Ember" }, ok: true, returned: "{}", state: "Hand: 4 cards", ...overrides });
  const played = (overrides = {}) => ({ path: "the browser's own agent API", moves: [move()], account: "I played a fire card.", ...overrides });

  await t.test("names each move and what it was called with", () => {
    assert.match(renderPlay(played()), /Move 1, at 3s: called `play-card` with `\{"card":"Ember"\}`/);
  });

  await t.test("says only when the page changed, so the difference is the move", () => {
    const rendered = renderPlay(played({ moves: [move(), move({ tool: "get-state", input: {} })] }));
    assert.match(rendered, /Move 1[\s\S]*The page then showed:\nHand: 4 cards/);
    assert.match(rendered, /Move 2[\s\S]*The page did not change\./);
  });

  await t.test("reports a refused and a failed move as such", () => {
    const rendered = renderPlay(played({ moves: [move({ ok: undefined, declined: true }), move({ ok: false, error: "boom" })] }));
    assert.match(rendered, /Refused: it is marked consequential/);
    assert.match(rendered, /\*\*It failed: boom\*\*/);
  });

  await t.test("carries the player's own account", () => {
    assert.match(renderPlay(played()), /## What you said when you stopped\nI played a fire card\./);
  });

  await t.test("says when the player stopped without an account", () => {
    assert.match(renderPlay(played({ account: "" })), /stopped without writing an account/);
  });

  await t.test("says plainly when no move was made", () => {
    assert.match(renderPlay(played({ moves: [] })), /You made no moves at all/);
  });

  await t.test("replaces the watching in the transcript", () => {
    const page = { title: "", state: "", dialog: "", landmarks: [], headings: [], controls: [] };
    const transcript = renderSession({
      opening: page, tabOrder: [], played: played(), timeline: [], closing: page, awayMs: 60_000,
      returned: page, agentTools: null, consoleErrors: [], frames: [],
    });
    assert.match(transcript, /## What you did, playing through its tools/);
    assert.match(transcript, /## The page when you stopped playing/);
    assert.doesNotMatch(transcript, /watching for/);
  });
});
