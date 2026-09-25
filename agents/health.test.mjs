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
} from "./health.mjs";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const closed = (n, day) => Array.from({ length: n }, (_, i) => ({ number: i, closedAt: `${day}T12:00:00Z` }));
const issue = (number, labels = [], body = "") => ({ number, title: `#${number}`, body, labels: labels.map((name) => ({ name })) });

test("noticing that nothing is shipping", async (t) => {
  await t.test("says nothing while work is merging", () => {
    assert.equal(checkShipping({ closedRecently: closed(3, daysAgo(0)), open: [] }), null);
  });

  await t.test("distinguishes stuck from idle when the board still has work", () => {
    const finding = checkShipping({ closedRecently: closed(2, daysAgo(9)), open: [issue(1)] });
    assert.match(finding, /stuck, not idle/);
  });

  await t.test("blames grooming when there is nothing left to build", () => {
    const finding = checkShipping({ closedRecently: [], open: [] });
    assert.match(finding, /backlog is empty/);
  });

  await t.test("does not count a blocked ticket as buildable work", () => {
    const finding = checkShipping({ closedRecently: [], open: [issue(1, ["blocked"])] });
    assert.match(finding, /backlog is empty/);
  });
});

test("noticing that the changelog stopped keeping up", async (t) => {
  await t.test("says nothing when recent merges are recorded", () => {
    const changelog = `# Changelog\n\n## ${daysAgo(0)}\n\n- Add a garden\n`;
    assert.equal(checkChangelogKeepingUp({ changelog, closedRecently: closed(3, daysAgo(0)) }), null);
  });

  await t.test("catches the case that ran silently for three days", () => {
    // Tickets shipping, changelog frozen — every wiki push losing its race.
    const finding = checkChangelogKeepingUp({
      changelog: "# Changelog\n",
      closedRecently: closed(30, daysAgo(0)),
    });
    assert.match(finding, /30 ticket\(s\) shipped/);
    assert.match(finding, /Wiki writes are being dropped/);
  });

  await t.test("stays quiet on a genuinely quiet day, when there is nothing to record", () => {
    assert.equal(checkChangelogKeepingUp({ changelog: "# Changelog\n", closedRecently: [] }), null);
  });
});

test("noticing that tickets are being written the Devs cannot build", async (t) => {
  await t.test("ignores a small sample, where one hard ticket proves nothing", () => {
    assert.equal(checkAbandonRate({ open: [issue(1, ["blocked"])], closedRecently: closed(1, daysAgo(1)) }), null);
  });

  await t.test("says nothing when most engaged tickets ship", () => {
    assert.equal(
      checkAbandonRate({ open: [issue(1, ["blocked"])], closedRecently: closed(9, daysAgo(1)) }),
      null
    );
  });

  await t.test("reports the rate once failures dominate", () => {
    const open = [issue(1, ["blocked"]), issue(2, ["blocked"]), issue(3, ["attempts:1"])];
    const finding = checkAbandonRate({ open, closedRecently: closed(3, daysAgo(1)) });
    assert.match(finding, /50% of engaged tickets are failing/);
  });
});

test("noticing a weekly agent that has stopped working", async (t) => {
  const run = (workflowName, conclusion, day) => ({
    workflowName, conclusion, status: "completed", createdAt: `${day}T09:00:00Z`,
  });

  await t.test("says nothing when the last run succeeded", () => {
    assert.equal(checkWeeklyAgents({ runs: [run("tech-lead", "success", daysAgo(1))] }), null);
  });

  await t.test("names the agent whose last run failed", () => {
    const finding = checkWeeklyAgents({ runs: [run("tech-lead", "failure", daysAgo(1))] });
    assert.match(finding, /tech-lead last run failure/);
  });

  await t.test("judges only the most recent run, so an old failure since fixed is not reported", () => {
    const runs = [run("tech-lead", "success", daysAgo(1)), run("tech-lead", "failure", daysAgo(8))];
    assert.equal(checkWeeklyAgents({ runs }), null);
  });

  await t.test("ignores an agent that has never run", () => {
    assert.equal(checkWeeklyAgents({ runs: [] }), null);
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
    const { facts, unreadable } = await readFacts({ open: failingRead, closedRecently: () => [] });
    assert.deepEqual(unreadable, ["open"]);
    const { findings, unknown } = await runChecks([checkShipping, checkAbandonRate], facts);
    assert.deepEqual(findings, []);
    assert.equal(unknown.length, 2);
    assert.match(unknown[0], /checkShipping: open could not be read: gh: HTTP 502/);
  });

  await t.test("an unreadable fact costs only the checks that read it", async () => {
    const { facts } = await readFacts({ runs: failingRead, site: () => ({ url: "https://x/", status: 404 }) });
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
