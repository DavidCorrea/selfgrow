// A session can be stopped by us for three reasons, and each one means something
// different for the rest of the model chain. A cap stops the chain: a runaway
// usually repeats on the next model. A silent model does not: one hung provider
// request used to spend the whole 12-minute session (the weekly report on 09-13
// and 09-20) while the next model in the chain was never asked.
import test from "node:test";
import assert from "node:assert/strict";
import {
  chainVerdict,
  createModelSilenceClock,
  sessionAbortError,
  MAX_MODEL_SILENCE_MINUTES,
  MAX_SESSION_MINUTES,
} from "./shared.mjs";

const fakeClock = () => {
  let ms = 0;
  return { now: () => ms, advance: (by) => (ms += by) };
};

test("hearing from the model", async (t) => {
  await t.test("counts the time since the model's last event", () => {
    const time = fakeClock();
    const silence = createModelSilenceClock(time.now);
    time.advance(90_000);
    assert.equal(silence.silentForMs(), 90_000);
  });

  await t.test("any event resets the silence", () => {
    const time = fakeClock();
    const silence = createModelSilenceClock(time.now);
    time.advance(90_000);
    silence.hear({ type: "message_update" });
    time.advance(5_000);
    assert.equal(silence.silentForMs(), 5_000);
  });

  await t.test("a running tool is not the model's silence", () => {
    const time = fakeClock();
    const silence = createModelSilenceClock(time.now);
    silence.hear({ type: "tool_execution_start" });
    time.advance(10 * 60_000);
    assert.equal(silence.silentForMs(), 0);
  });

  await t.test("the clock restarts when the tool finishes", () => {
    const time = fakeClock();
    const silence = createModelSilenceClock(time.now);
    silence.hear({ type: "tool_execution_start" });
    time.advance(10 * 60_000);
    silence.hear({ type: "tool_execution_end" });
    time.advance(20_000);
    assert.equal(silence.silentForMs(), 20_000);
  });

  await t.test("stays paused until every parallel tool has finished", () => {
    const time = fakeClock();
    const silence = createModelSilenceClock(time.now);
    silence.hear({ type: "tool_execution_start" });
    silence.hear({ type: "tool_execution_start" });
    silence.hear({ type: "tool_execution_end" });
    time.advance(10 * 60_000);
    assert.equal(silence.silentForMs(), 0);
  });
});

test("what a stopped session means for the chain", async (t) => {
  await t.test("a silent model lets the chain try the next model", () => {
    assert.equal(chainVerdict(sessionAbortError("Weekly report", "silent", 1)), "next");
  });

  await t.test("a turn cap stops the chain", () => {
    assert.equal(chainVerdict(sessionAbortError("Builder", "turns", 40)), "capped");
  });

  await t.test("a time cap stops the chain", () => {
    assert.equal(chainVerdict(sessionAbortError("Builder", "minutes", 12)), "capped");
  });

  await t.test("a billing refusal stops the chain", () => {
    assert.equal(chainVerdict(Object.assign(new Error("x"), { status: 402 })), "billing");
  });

  await t.test("an ordinary model failure moves on", () => {
    assert.equal(chainVerdict(new Error("Provider returned error")), "next");
  });
});

test("saying why we stopped a session", async (t) => {
  await t.test("names the silence, not pi's generic abort", () => {
    const { message } = sessionAbortError("Weekly report", "silent", 1);
    assert.match(message, new RegExp(`sent nothing for ${MAX_MODEL_SILENCE_MINUTES} minute`));
    assert.doesNotMatch(message, /operation was aborted/);
  });

  await t.test("names which cap it was", () => {
    assert.match(sessionAbortError("Builder", "turns", 40).message, /-turn session cap/);
    assert.match(
      sessionAbortError("Builder", "minutes", 3).message,
      new RegExp(`${MAX_SESSION_MINUTES}-minute session cap`)
    );
  });

  await t.test("names the cap the session actually had, when a role brings its own", () => {
    const builderLimits = { turns: 80, minutes: 20 };
    assert.match(sessionAbortError("Builder", "turns", 80, builderLimits).message, /80-turn session cap/);
    assert.match(sessionAbortError("Builder", "minutes", 61, builderLimits).message, /20-minute session cap/);
  });

  await t.test("the silence limit sits well under the session cap", () => {
    assert.ok(MAX_MODEL_SILENCE_MINUTES * 2 <= MAX_SESSION_MINUTES);
  });
});
