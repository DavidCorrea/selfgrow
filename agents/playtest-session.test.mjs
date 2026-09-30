// What the Playtester is told about its own session. Its findings can only be as
// true as this transcript: it once compared the controls as they were at page
// load with the state two minutes later, and called a return after a 2-second
// reload "nothing happened while you were away". Four findings stayed open for
// days, answered by six builds, because no fix could change what it was shown.
import test from "node:test";
import assert from "node:assert/strict";
import { renderSession, formatAbsence } from "./playtester.mjs";

const page = ({ state = "Wood 0", controls = [], dialog = "" } = {}) => ({
  title: "A game",
  state,
  dialog,
  landmarks: [],
  headings: [],
  controls,
});

const session = (overrides = {}) => ({
  url: "http://127.0.0.1:1/",
  opening: page({ controls: ['button#sharpen "Sharpen — locked, gather 10 more wood"'] }),
  tabOrder: [],
  timeline: [
    { atSeconds: 8, state: "Wood 1" },
    { atSeconds: 120, state: "Wood 12" },
  ],
  closing: page({ state: "Wood 12", controls: ['button#sharpen "Sharpen (5 wood)"'] }),
  awayMs: 60 * 60 * 1000,
  returned: page({
    state: "Wood 371",
    controls: ['button#sharpen "Sharpen (5 wood)"'],
    dialog: "Welcome back. While you were away for 1h 0m, you gathered 359 wood.",
  }),
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
    const transcript = renderSession(session());
    assert.match(transcript, /## The page when it loaded, before any time passed/);
  });
});

test("the return the Playtester is shown", async (t) => {
  await t.test("is a real absence, named by its length", () => {
    const transcript = renderSession(session());
    assert.match(transcript, /## Coming back 1 hour later/);
    assert.match(transcript, /closed the page/);
  });

  await t.test("includes what the page said on the way back in", () => {
    assert.match(renderSession(session()), /Welcome back\. While you were away for 1h 0m, you gathered 359 wood\./);
  });

  await t.test("says plainly when the absence changed nothing", () => {
    const unchanged = session({ returned: page({ state: "Wood 12", controls: ['button#sharpen "Sharpen (5 wood)"'] }) });
    assert.match(renderSession(unchanged), /came back exactly as it was left/);
  });

  await t.test("says the state panel was hidden behind what came up, rather than reading it", () => {
    const covered = session({
      returned: { ...page({ state: "", controls: [], dialog: "Welcome back." }), stateHidden: true },
    });
    const transcript = renderSession(covered);
    assert.match(transcript, /state panel was hidden behind it/);
    assert.doesNotMatch(transcript, /The state panel on your return:/);
  });

  await t.test("says when the page showed nothing on the way back in", () => {
    const quiet = session({ returned: page({ state: "Wood 371" }) });
    assert.match(renderSession(quiet), /Nothing appeared on top of the page/);
  });
});

test("naming an absence", async (t) => {
  await t.test("in whole hours and days", () => {
    assert.equal(formatAbsence(60 * 60 * 1000), "1 hour");
    assert.equal(formatAbsence(3 * 60 * 60 * 1000), "3 hours");
    assert.equal(formatAbsence(24 * 60 * 60 * 1000), "1 day");
  });

  await t.test("in minutes when shorter than an hour", () => {
    assert.equal(formatAbsence(90 * 1000), "2 minutes");
    assert.equal(formatAbsence(60 * 1000), "1 minute");
  });
});
