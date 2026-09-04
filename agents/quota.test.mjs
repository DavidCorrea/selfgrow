// isDailyQuotaExhausted decides whether a failure is FATAL (the account cannot
// pay, so stop) or RETRYABLE (one model misbehaved, so try again). Getting that
// backwards is expensive in one direction only: a wasted retry costs one request,
// a wrong "we are out of money" costs the ticket and can fail the run.
//
// On 2026-09-04 it cost four tickets and a failed run while $30 of $40 sat on the
// key, because two patterns matched things that were never about money.
import test from "node:test";
import assert from "node:assert/strict";
import { isDailyQuotaExhausted } from "./shared.mjs";

const err = (message, extra = {}) => Object.assign(new Error(message), extra);

test("recognising an account that cannot pay", async (t) => {
  await t.test("a 402 status is unambiguous", () => {
    assert.equal(isDailyQuotaExhausted(err("Request failed", { status: 402 })), true);
  });

  await t.test("wording that names credits or a balance", () => {
    for (const message of [
      "Insufficient credits to make this request",
      "This request requires more credits, or fewer max_tokens",
      "Your account has a negative balance",
      "You have exceeded your monthly credit limit",
    ]) {
      assert.equal(isDailyQuotaExhausted(err(message)), true, message);
    }
  });

  await t.test("the free tier's per-day request cap", () => {
    assert.equal(isDailyQuotaExhausted(err("free-models-per-day limit reached")), true);
    assert.equal(isDailyQuotaExhausted(err("error: free_models_per_day")), true);
  });

  await t.test("an error it has already relabelled once", () => {
    assert.equal(isDailyQuotaExhausted(err("rewritten text", { quotaExhausted: true })), true);
  });
});

test("not mistaking a model failure for an empty wallet", async (t) => {
  // The 2026-09-04 regression. Upstream providers use `insufficient_quota` for
  // THEIR capacity limits, which is transient and says nothing about the balance.
  await t.test("a provider's own quota is retryable, not fatal", () => {
    assert.equal(isDailyQuotaExhausted(err("insufficient_quota")), false);
    assert.equal(isDailyQuotaExhausted(err("Provider error: insufficient_quota for this model")), false);
  });

  await t.test("the digits 402 appearing in unrelated text", () => {
    assert.equal(isDailyQuotaExhausted(err("upstream returned 402 tokens")), false);
    assert.equal(isDailyQuotaExhausted(err("run 4020 failed")), false);
  });

  await t.test("ordinary transient failures", () => {
    for (const message of [
      "429 Too Many Requests",
      "503 Service Unavailable",
      "socket hang up",
      "rate limit exceeded, please retry",
      "upstream provider is overloaded",
      "",
    ]) {
      assert.equal(isDailyQuotaExhausted(err(message)), false, message);
    }
  });

  await t.test("nothing at all", () => {
    assert.equal(isDailyQuotaExhausted(null), false);
    assert.equal(isDailyQuotaExhausted(undefined), false);
    assert.equal(isDailyQuotaExhausted({}), false);
  });
});
