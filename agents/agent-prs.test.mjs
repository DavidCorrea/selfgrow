// The policy that decides what happens to a PR an earlier run left open.
//
// Tested here rather than through devs.mjs because the judgement is pure: given a
// PR's checks and its age, what should happen to it. The acting on that verdict
// — closing, striking, re-arming a merge — is GitHub's, and is not mocked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  issueNumberFromAgentBranch,
  classifyAgentPullRequest,
  decideAgentPullRequest,
  agentPullRequestBody,
  whyTicketNoLongerWanted,
} from "./shared.mjs";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-16T12:00:00Z");
const hoursOld = (n) => new Date(NOW - n * HOUR).toISOString();

const pr = (over = {}) => ({
  number: 713,
  headRefName: "agent/issue-687-established-sprouts-survive-winter-35115003499",
  createdAt: hoursOld(24),
  url: "https://example.invalid/pull/713",
  mergeable: "MERGEABLE",
  statusCheckRollup: [{ name: "check", conclusion: "SUCCESS" }],
  ...over,
});

const verdict = (over) =>
  classifyAgentPullRequest(pr(over), { now: NOW, staleMs: 12 * HOUR });

describe("recognising the ticket a branch belongs to", () => {
  test("reads the issue number out of an agent branch", () => {
    assert.equal(
      issueNumberFromAgentBranch("agent/issue-687-sprouts-survive-winter-35115003499"),
      687
    );
  });

  test("ignores a branch the pipeline did not cut", () => {
    assert.equal(issueNumberFromAgentBranch("fix/issue-459-orbit-zoom-limits"), null);
    assert.equal(issueNumberFromAgentBranch("dependabot/npm_and_yarn/dev-deps"), null);
    assert.equal(issueNumberFromAgentBranch("main"), null);
    assert.equal(issueNumberFromAgentBranch(undefined), null);
  });

  test("ignores an agent branch cut for no ticket", () => {
    assert.equal(issueNumberFromAgentBranch("agent/feature-add-rain-sound"), null);
  });
});

describe("judging an open pull request", () => {
  test("a PR whose checks all passed is waiting on nothing", () => {
    assert.equal(verdict().state, "passing");
  });

  test("a failing required check is named, so the strike says what broke", () => {
    const v = verdict({
      statusCheckRollup: [
        { name: "check", conclusion: "SUCCESS" },
        { name: "verify-product", conclusion: "FAILURE" },
      ],
    });
    assert.equal(v.state, "failing");
    assert.deepEqual(v.failedChecks, ["verify-product"]);
  });

  test("a cancelled check counts as failed, not as still running", () => {
    assert.equal(verdict({ statusCheckRollup: [{ name: "check", conclusion: "CANCELLED" }] }).state, "failing");
  });

  test("a conflicting branch outranks its checks", () => {
    const v = verdict({
      mergeable: "CONFLICTING",
      statusCheckRollup: [{ name: "check", conclusion: "SUCCESS" }],
    });
    assert.equal(v.state, "conflicting");
  });

  test("checks still running leave the verdict open", () => {
    assert.equal(verdict({ statusCheckRollup: [{ name: "check", state: "PENDING" }] }).state, "pending");
  });

  test("a PR with no checks at all is pending, never passing", () => {
    // Otherwise a PR whose checks never started would read as green and be merged.
    assert.equal(verdict({ statusCheckRollup: [] }).state, "pending");
  });
});

describe("deciding whether a run may take a PR back", () => {
  test("a PR younger than the threshold belongs to the run that opened it", () => {
    assert.equal(verdict({ createdAt: hoursOld(2) }).stale, false);
  });

  test("a PR older than the threshold has no run watching it", () => {
    assert.equal(verdict({ createdAt: hoursOld(13) }).stale, true);
  });

  test("age is reported so a closing comment can say how long it sat", () => {
    assert.equal(verdict({ createdAt: hoursOld(30) }).ageMs, 30 * HOUR);
  });
});

describe("deciding what a run does about an open pull request", () => {
  const decide = (over, { issueOpen = true, alreadyAwaited = false } = {}) =>
    decideAgentPullRequest(verdict(over), { issueOpen, alreadyAwaited });

  test("a young PR is left to the run that opened it and keeps its ticket", () => {
    assert.deepEqual(decide({ createdAt: hoursOld(2) }), { action: "leave", claimed: true });
  });

  test("a stale passing PR has its merge re-armed and keeps its ticket", () => {
    // Claimed even though the merge is being retried: if it does not land in time
    // the PR is still open, and the same run must not build the ticket beside it.
    assert.deepEqual(decide(), { action: "merge", claimed: true });
  });

  test("a passing PR already waited on this run is not waited on again", () => {
    assert.deepEqual(decide({}, { alreadyAwaited: true }), { action: "leave", claimed: true });
  });

  test("a stale PR still waiting on its checks is left and keeps its ticket", () => {
    assert.deepEqual(
      decide({ statusCheckRollup: [{ name: "check", state: "PENDING" }] }),
      { action: "leave", claimed: true }
    );
  });

  test("a stale failing PR is closed and releases its ticket for a fresh attempt", () => {
    assert.deepEqual(
      decide({ statusCheckRollup: [{ name: "check", conclusion: "FAILURE" }] }),
      { action: "close", claimed: false }
    );
  });

  test("a stale conflicting PR is closed and releases its ticket", () => {
    assert.deepEqual(decide({ mergeable: "CONFLICTING" }), { action: "close", claimed: false });
  });

  test("a stale passing PR whose ticket is no longer open is retired, not merged", () => {
    assert.deepEqual(decide({}, { issueOpen: false }), { action: "retire", claimed: false });
  });

  test("a young PR whose ticket closed is still left to the run that opened it", () => {
    assert.deepEqual(decide({ createdAt: hoursOld(2) }, { issueOpen: false }), { action: "leave", claimed: true });
  });
});

describe("writing the body of a ticket's pull request", () => {
  test("closes the ticket on merge with a keyword GitHub acts on", () => {
    assert.equal(agentPullRequestBody("Add rain sound.", 687), "Add rain sound.\n\nCloses #687");
  });

  test("a PR for no ticket carries only its summary", () => {
    assert.equal(agentPullRequestBody("Add rain sound.", null), "Add rain sound.");
  });
});

// A run that is already building does not see its ticket retired: the stale-PR
// reconcile only runs between tickets. #922 merged two minutes after its ticket
// #916 was closed as not planned, shipping the workaround the retirement refused.
describe("re-checking the ticket right before merging", () => {
  const ticket = (state, labels = ["groomed"]) => ({ state, labels: labels.map((name) => ({ name })) });

  test("merges a ticket that is still open and groomed", () => {
    assert.equal(whyTicketNoLongerWanted(ticket("open")), null);
  });

  test("stands down when the ticket was closed while it was being built", () => {
    assert.match(whyTicketNoLongerWanted(ticket("closed")), /closed while this was being built/);
  });

  test("stands down when the ticket lost its grooming while it was being built", () => {
    assert.match(whyTicketNoLongerWanted(ticket("open", [])), /no longer groomed/);
  });
});
