// What the Playtester is told about its own session. Its findings can only be as
// true as this transcript: it once compared the controls as they were at page
// load with the state two minutes later, and filed the difference as a bug that
// no fix could make go away.
import test from "node:test";
import assert from "node:assert/strict";
import { renderSession } from "./playtester.mjs";

const page = ({ state = "Wood 0", controls = [] } = {}) => ({ title: "A game", state, landmarks: [], headings: [], controls });

const session = (overrides = {}) => ({
  url: "http://127.0.0.1:1/",
  opening: page({ controls: ['button#sharpen "Sharpen — locked, gather 10 more wood"'] }),
  tabOrder: [],
  timeline: [
    { atSeconds: 8, state: "Wood 1" },
    { atSeconds: 120, state: "Wood 12" },
  ],
  closing: page({ state: "Wood 12", controls: ['button#sharpen "Sharpen (5 wood)"'] }),
  afterReload: "Wood 12",
  agentTools: null,
  consoleErrors: [],
  frames: [],
  ...overrides,
});

test("the controls the Playtester is shown", async (t) => {
  await t.test("include how they read when watching ended, not only at load", () => {
    const transcript = renderSession(session());
    assert.match(transcript, /Sharpen — locked, gather 10 more wood/);
    assert.match(transcript, /## The page when you stopped watching[\s\S]*Sharpen \(5 wood\)/);
  });

  await t.test("say which moment each list is from", () => {
    assert.match(renderSession(session()), /## The page when it loaded, before any time passed/);
  });
});
