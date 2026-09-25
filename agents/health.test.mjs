// The health checks. Each is a pure function of the facts gathered once per run,
// so what these pin down is the judgement: when is a quiet day a quiet day, and
// when is it a broken pipeline.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkShipping,
  checkChangelogKeepingUp,
  checkAbandonRate,
  checkWeeklyAgents,
  checkStalledPullRequests,
  checkDeployedSite,
  readFacts,
  runChecks,
  alertAction,
  expectedDigestWeek,
  checkWeeklyDigest,
  normaliseFindingTitle,
  checkRepeatedFindings,
  checkAbortedSessions,
} from "./health.mjs";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const closed = (n, day) => Array.from({ length: n }, (_, i) => ({ number: i, closedAt: `${day}T12:00:00Z` }));
const issue = (number, labels = [], body = "") => ({ number, title: `#${number}`, body, labels: labels.map((name) => ({ name })) });

test("noticing that nothing is shipping", async (t) => {
  await t.test("says nothing while work is merging", () => {
    assert.equal(checkShipping({ shippedRecently: closed(3, daysAgo(0)), open: [] }), null);
  });

  await t.test("distinguishes stuck from idle when the board still has work", () => {
    const finding = checkShipping({ shippedRecently: closed(2, daysAgo(9)), open: [issue(1)] });
    assert.match(finding, /stuck, not idle/);
  });

  await t.test("blames grooming when there is nothing left to build", () => {
    const finding = checkShipping({ shippedRecently: [], open: [] });
    assert.match(finding, /backlog is empty/);
  });

  await t.test("does not count a blocked ticket as buildable work", () => {
    const finding = checkShipping({ shippedRecently: [], open: [issue(1, ["blocked"])] });
    assert.match(finding, /backlog is empty/);
  });
});

test("noticing that the changelog stopped keeping up", async (t) => {
  await t.test("says nothing when recent merges are recorded", () => {
    const changelog = `# Changelog\n\n## ${daysAgo(0)}\n\n- Add a scene\n`;
    assert.equal(checkChangelogKeepingUp({ changelog, shippedRecently: closed(3, daysAgo(0)) }), null);
  });

  await t.test("catches the case that ran silently for three days", () => {
    // Tickets shipping, changelog frozen — every wiki push losing its race.
    const finding = checkChangelogKeepingUp({
      changelog: "# Changelog\n",
      shippedRecently: closed(30, daysAgo(0)),
    });
    assert.match(finding, /30 ticket\(s\) shipped/);
    assert.match(finding, /Wiki writes are being dropped/);
  });

  await t.test("stays quiet on a genuinely quiet day, when there is nothing to record", () => {
    assert.equal(checkChangelogKeepingUp({ changelog: "# Changelog\n", shippedRecently: [] }), null);
  });
});

test("noticing that tickets are being written the Devs cannot build", async (t) => {
  await t.test("ignores a small sample, where one hard ticket proves nothing", () => {
    assert.equal(checkAbandonRate({ open: [issue(1, ["blocked"])], shippedRecently: closed(1, daysAgo(1)) }), null);
  });

  await t.test("says nothing when most engaged tickets ship", () => {
    assert.equal(
      checkAbandonRate({ open: [issue(1, ["blocked"])], shippedRecently: closed(9, daysAgo(1)) }),
      null
    );
  });

  await t.test("reports the rate once failures dominate", () => {
    const open = [issue(1, ["blocked"]), issue(2, ["blocked"]), issue(3, ["attempts:1"])];
    const finding = checkAbandonRate({ open, shippedRecently: closed(3, daysAgo(1)) });
    assert.match(finding, /50% of engaged tickets are failing/);
  });
});

test("noticing a weekly agent that has stopped working", async (t) => {
  const run = (conclusion, day) => ({ conclusion, createdAt: `${day}T09:00:00Z` });
  const weekly = (workflow, ...runs) => ({ workflow, runs });

  await t.test("says nothing when the last run succeeded", () => {
    assert.equal(checkWeeklyAgents({ weeklyRuns: [weekly("tech-lead", run("success", daysAgo(1)))] }), null);
  });

  await t.test("names the agent whose last run failed", () => {
    const finding = checkWeeklyAgents({ weeklyRuns: [weekly("tech-lead", run("failure", daysAgo(1)))] });
    assert.match(finding, /tech-lead last run failure/);
  });

  await t.test("judges only the most recent run, so an old failure since fixed is not reported", () => {
    const weeklyRuns = [weekly("tech-lead", run("success", daysAgo(1)), run("failure", daysAgo(8)))];
    assert.equal(checkWeeklyAgents({ weeklyRuns }), null);
  });

  await t.test("ignores an agent that has never run", () => {
    assert.equal(checkWeeklyAgents({ weeklyRuns: [weekly("tech-lead")] }), null);
  });

  await t.test("still sees a failure a week old, however busy the other workflows were", () => {
    const weeklyRuns = [
      weekly("product-owner", run("success", daysAgo(2))),
      weekly("playtester", run("failure", daysAgo(7))),
      weekly("tech-lead", run("success", daysAgo(3))),
    ];
    assert.match(checkWeeklyAgents({ weeklyRuns }), /playtester last run failure/);
  });
});

test("noticing that nobody can see the product", async (t) => {
  // Every other check in this pipeline verifies a local copy before a merge.
  // This is the only one that asks whether the deployed page actually works.
  await t.test("says nothing when the site serves the product", async () => {
    const site = { url: "https://x.github.io/y/", status: 200, hasMarker: true };
    assert.equal(await checkDeployedSite({ site }), null);
  });

  await t.test("reports an unreachable site", async () => {
    const finding = await checkDeployedSite({ site: { url: "https://x/", error: "getaddrinfo ENOTFOUND" } });
    assert.match(finding, /could not be reached/);
  });

  await t.test("reports a non-200, which is what a failed deploy looks like", async () => {
    const finding = await checkDeployedSite({ site: { url: "https://x/", status: 404 } });
    assert.match(finding, /returned HTTP 404/);
  });

  await t.test("catches a page that loads but is not our product", async () => {
    // A stale or half-finished Pages deploy returns 200 and looks fine.
    const finding = await checkDeployedSite({ site: { url: "https://x/", status: 200, hasMarker: false } });
    assert.match(finding, /no longer contains/);
    assert.match(finding, /stale or failed Pages deploy/);
  });

  await t.test("stays quiet when no site is configured", async () => {
    assert.equal(await checkDeployedSite({ site: null }), null);
  });
});

test("noticing work the pipeline started and never finished", async (t) => {
  const openPr = (over = {}) => ({
    number: 713,
    issueNumber: 687,
    state: "failing",
    stale: true,
    ageMs: 30 * 3_600_000,
    failedChecks: ["verify-product"],
    ...over,
  });

  await t.test("says nothing when every open PR is still in flight", () => {
    assert.equal(
      checkStalledPullRequests({ agentPrs: [openPr({ state: "pending", stale: false })] }),
      null
    );
  });

  await t.test("says nothing when there are no agent PRs at all", () => {
    assert.equal(checkStalledPullRequests({ agentPrs: [] }), null);
  });

  await t.test("reports a PR the Devs should have reaped and did not", () => {
    const finding = checkStalledPullRequests({ agentPrs: [openPr()] });
    assert.match(finding, /1 agent PR\(s\) stalled/);
    assert.match(finding, /not reaching that step/);
  });

  await t.test("a stale PR that is merely waiting to merge is not a fault", () => {
    assert.equal(checkStalledPullRequests({ agentPrs: [openPr({ state: "passing" })] }), null);
  });

  await t.test("two PRs for one ticket is reported as the duplication it is", () => {
    const finding = checkStalledPullRequests({
      agentPrs: [openPr({ number: 694, stale: false, state: "pending" }), openPr({ number: 713 })],
    });
    assert.match(finding, /#687 \(#694, #713\)/);
    assert.match(finding, /already built/);
  });
});

test("telling a check that could not run apart from one that came back clear", async (t) => {
  const failingRead = () => {
    throw new Error("gh: HTTP 502");
  };

  await t.test("a fact that could not be read makes the checks that need it unknown, not clear", async () => {
    const { facts, unreadable } = await readFacts({ open: failingRead, shippedRecently: () => [] });
    assert.deepEqual(unreadable, ["open"]);
    const { findings, unknown } = await runChecks([checkShipping, checkAbandonRate], facts);
    assert.deepEqual(findings, []);
    assert.equal(unknown.length, 2);
    assert.match(unknown[0], /checkShipping: open could not be read: gh: HTTP 502/);
  });

  await t.test("an unreadable fact costs only the checks that read it", async () => {
    const { facts } = await readFacts({ weeklyRuns: failingRead, site: () => ({ url: "https://x/", status: 404 }) });
    const { findings, unknown } = await runChecks([checkDeployedSite, checkWeeklyAgents], facts);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /returned HTTP 404/);
    assert.equal(unknown.length, 1);
    assert.match(unknown[0], /^checkWeeklyAgents:/);
  });

  await t.test("an unreadable site is unknown, though an unconfigured one is silent", async () => {
    const { facts } = await readFacts({ site: failingRead });
    const { unknown } = await runChecks([checkDeployedSite], facts);
    assert.equal(unknown.length, 1);
  });

  await t.test("a check that throws is reported as unknown", async () => {
    const brokenCheck = () => {
      throw new Error("bad data");
    };
    const { findings, unknown } = await runChecks([brokenCheck], {});
    assert.deepEqual(findings, []);
    assert.deepEqual(unknown, ["brokenCheck: bad data"]);
  });
});

test("deciding what happens to the standing alert", async (t) => {
  const standing = { id: "D_1", url: "https://example.test/discussions/1" };

  await t.test("closes it only when every check came back clear", () => {
    assert.equal(alertAction({ findings: [], unknown: [], standing }), "close");
  });

  await t.test("keeps it open when nothing was found but a check could not run", () => {
    assert.equal(alertAction({ findings: [], unknown: ["checkShipping: open could not be read"], standing }), "hold");
  });

  await t.test("keeps it open while its problem is still true", () => {
    assert.equal(alertAction({ findings: ["broken"], unknown: [], standing }), "hold");
  });

  await t.test("posts one when something is wrong and none is open", () => {
    assert.equal(alertAction({ findings: ["broken"], unknown: ["x"], standing: null }), "post");
  });

  await t.test("does nothing when all is clear and nothing is open", () => {
    assert.equal(alertAction({ findings: [], unknown: [], standing: null }), "none");
  });

  await t.test("posts nothing on unknowns alone, since there is no finding to name", () => {
    assert.equal(alertAction({ findings: [], unknown: ["x"], standing: null }), "hold");
  });
});

test("noticing that the weekly digest did not go out", async (t) => {
  await t.test("expects the week the last Sunday report covered, from Monday on", () => {
    // Sunday 09-20 reported the week of 09-13.
    assert.equal(expectedDigestWeek(new Date("2026-09-21T16:00:00Z"), 0), "2026-09-13");
    assert.equal(expectedDigestWeek(new Date("2026-09-26T16:00:00Z"), 0), "2026-09-13");
  });

  await t.test("does not hold the report day to a report that may still be coming", () => {
    assert.equal(expectedDigestWeek(new Date("2026-09-27T16:00:00Z"), 0), "2026-09-13");
  });

  await t.test("follows a moved report day", () => {
    // A Wednesday report day: Thursday 09-24 expects Wednesday 09-23's week.
    assert.equal(expectedDigestWeek(new Date("2026-09-24T16:00:00Z"), 3), "2026-09-16");
  });

  await t.test("says nothing when that week's digest exists", () => {
    assert.equal(checkWeeklyDigest({ lastDigest: { weekStart: "2026-09-13", url: "https://x/d/1" } }), null);
  });

  await t.test("names the missing week when it does not", () => {
    assert.match(checkWeeklyDigest({ lastDigest: { weekStart: "2026-09-13", url: null } }), /week of 2026-09-13/);
  });

  await t.test("is unknown, not clear, when the digests could not be read", async () => {
    const { facts } = await readFacts({ lastDigest: () => { throw new Error("gh: HTTP 502"); } });
    const { findings, unknown } = await runChecks([checkWeeklyDigest], facts);
    assert.deepEqual(findings, []);
    assert.equal(unknown.length, 1);
  });
});

test("noticing a playtest finding the loop is not fixing", async (t) => {
  const finding = (number, title, daysBack = 1) => ({ number, title, createdAt: `${daysAgo(daysBack)}T10:00:00Z` });
  const voidTitle = "The visual canvas is a dark void";

  await t.test("names a finding filed three times", () => {
    const result = checkRepeatedFindings({
      playtestFindings: [finding(1, voidTitle), finding(2, voidTitle, 7), finding(3, voidTitle, 14)],
    });
    assert.match(result, /dark void/);
    assert.match(result, /#1, #2, #3/);
  });

  await t.test("says nothing about a finding filed twice", () => {
    assert.equal(checkRepeatedFindings({ playtestFindings: [finding(1, voidTitle), finding(2, voidTitle)] }), null);
  });

  await t.test("treats titles that differ only in case and punctuation as one finding", () => {
    const result = checkRepeatedFindings({
      playtestFindings: [finding(1, voidTitle), finding(2, "the visual canvas is a dark void."), finding(3, "The visual  canvas — is a DARK void")],
    });
    assert.ok(result);
  });

  await t.test("ignores filings older than the window", () => {
    const result = checkRepeatedFindings({
      playtestFindings: [finding(1, voidTitle), finding(2, voidTitle), finding(3, voidTitle, 60)],
    });
    assert.equal(result, null);
  });

  await t.test("normalises a title to lowercase words", () => {
    assert.equal(normaliseFindingTitle("  The 'GROWING' text, cut off! "), "the growing text cut off");
  });
});

test("noticing a role whose sessions keep aborting", async (t) => {
  const run = (...annotations) => ({ createdAt: "2026-09-24T05:00:00Z", annotations });
  const capped = run("Builder (m): hit the 40-turn session cap — aborting it.");
  const clean = run("Reviewer: REVISE — 3 issue(s)");

  await t.test("names a role with two aborted runs among its last five", () => {
    const result = checkAbortedSessions({ roleRuns: [{ workflow: "devs", runs: [capped, clean, capped, clean, clean] }] });
    assert.match(result, /devs in 2 of its last 5 runs/);
  });

  await t.test("says nothing about a single bad run", () => {
    assert.equal(checkAbortedSessions({ roleRuns: [{ workflow: "devs", runs: [capped, clean, clean] }] }), null);
  });

  await t.test("counts only the most recent runs", () => {
    const result = checkAbortedSessions({ roleRuns: [{ workflow: "devs", runs: [clean, clean, clean, clean, clean, capped, capped] }] });
    assert.equal(result, null);
  });

  await t.test("recognises a provider abort, a timeout, a silent model and a runner kill", () => {
    const aborted = run("Product Manager failed: model call failed: This operation was aborted");
    const timedOut = run("Scout: request timed out");
    const silent = run("Weekly report (m): aborted after 180s — the model sent nothing for 3 minute(s); trying the next model.");
    const killed = run("The job has exceeded the maximum execution time of 30m0s");
    for (const other of [timedOut, silent, killed]) {
      assert.ok(checkAbortedSessions({ roleRuns: [{ workflow: "product-manager", runs: [aborted, other] }] }));
    }
  });

  await t.test("does not count ordinary warnings as aborts", () => {
    assert.equal(checkAbortedSessions({ roleRuns: [{ workflow: "devs", runs: [clean, clean, clean] }] }), null);
  });
});
