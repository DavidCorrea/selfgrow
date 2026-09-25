// HEALTH — not a role, a dashboard.
//
// Every guard in this pipeline protects the product or the budget. Nothing
// watched the pipeline itself, and it showed: the changelog silently stopped
// growing for three days and ~100 merges, because every wiki push lost a race,
// logged a warning, and let the run report success. The Scribe then had nothing
// to write from. Nobody noticed, because noticing was nobody's job.
//
// So this measures the machine rather than the product, and it is deliberately
// cheap: no model, no browser, no session. It reads what the pipeline has already
// written down — issues, runs, the wiki — and compares it to what a
// working week looks like.
//
// It speaks only on exception. Silence means fine; an issue means something is
// wrong and names it. A dashboard that reports daily is a dashboard people stop
// reading, and this one exists to be believed the one time it fires.
import { pathToFileURL } from "url";
import { log, withLogGroup, appendJobSummary, errorData } from "./log.mjs";
import { readPage, wikiPath } from "./wiki.mjs";
import { postDiscussion, findOpenDiscussion, findDiscussion, resolveDiscussion } from "./discussions.mjs";
import { DIGEST_CATEGORY, digestTitlePrefix, digestWeekStart } from "./weekly-report.mjs";
import {
  ghExec,
  printRunSummary,
  fetchOpenIssues,
  fetchShippedIssues,
  isBuildable,
  isBlocked,
  attemptCount,
  fetchOpenAgentPullRequests,
  classifyAgentPullRequest,
  PR_STALE_MS,
  PLAYTEST_LABEL,
} from "./shared.mjs";

// Who gets the @-mention. The point of an alert is that it reaches a person, so
// it falls back to the repo's owner rather than going quietly nowhere.
const NOTIFY_USER = process.env.GH_NOTIFY_USER || "";

// Where alerts are published, and how one is recognised on a later run.
//
// A discussion rather than an issue, because nothing in docs/ can fix "the
// changelog stopped growing" — the Devs picked one of these up and tried to build
// it. A post carries no board card and no priority, and it still has an
// open/closed state, which is what lets an alert clear itself.
const HEALTH_CATEGORY = process.env.HEALTH_CATEGORY || "Announcements";
const HEALTH_TITLE_PREFIX = "Pipeline health:";

// A day with merges but no changelog entry means the write path is broken, not
// that the day was quiet. Two days of it is not a coincidence.
const CHANGELOG_STALE_DAYS = 2;

// Below this, the Devs are not shipping. Measured over two days so one bad night
// — a capped model, a slow queue — does not page anyone.
const QUIET_DAYS_BEFORE_ALARM = 2;

// Of the tickets the Devs actually engaged with this week, the share that may be
// abandoned before it reads as a systemic problem rather than a few hard tickets.
const ABANDON_RATE_LIMIT = 0.4;

// Where the product actually lives, as far as anyone visiting it is concerned.
// Everything else in this pipeline verifies a local static server before a merge;
// nothing has ever opened the deployed page. A Pages build that fails, serves
// stale content, or 404s is invisible to every other check here — the whole
// system would report a healthy pipeline shipping into a broken site.
const SITE_URL = process.env.SITE_URL || "";

// A marker the served HTML must contain. Deliberately something the product
// cannot lose by accident without being broken anyway: it is the element the
// state layer lives in, which the product contract requires.
const SITE_MARKER = process.env.SITE_MARKER || "state-panel";

// The day the Product Manager writes the weekly report — the same variable it
// reads, so a moved report day moves the deadline this check holds it to.
const DIGEST_DAY = Number(process.env.PM_WEEKLY_DAY ?? 0);

// The same finding filed this many times inside the window means the loop is
// not fixing it: the Playtester keeps seeing it, the PM keeps closing it, and
// nothing that ships changes what a visitor gets. Three, because twice can be a
// fix that had not deployed yet; the canvas-is-a-dark-void finding was filed five
// times in three weeks and closed every time.
const REPEATED_FINDING_LIMIT = 3;
const REPEATED_FINDING_WEEKS = 4;

// Every workflow that runs a model session, and so can have one capped or aborted.
const MODEL_WORKFLOWS = ["devs", "product-manager", "product-owner", "playtester", "tech-lead"];

// Of a role's last RUNS_READ runs, how many may abort a session before it reads
// as the role failing rather than one bad night. An abort does not fail the run —
// the Devs abandon the ticket and carry on — so the run conclusions are green and
// only the run's own annotations say it happened.
const ABORTED_RUNS_READ = 5;
const ABORTED_RUNS_LIMIT = 2;

// What an aborted session leaves in a run's annotations: our own cap warning,
// the error pi raises once aborted, a provider that never answered, and the
// runner killing a job that outlived its timeout-minutes.
const ABORT_PATTERN = /session cap|this operation was aborted|timed out|exceeded the maximum execution time/i;

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Everything the checks below read, gathered once.
 *
 * Deliberately one batch rather than a fetch per check: the checks are cheap and
 * the API calls are not, and a check that quietly costs a request is a check
 * nobody will want to add.
 */
function gatherFacts() {
  return readFacts({
    shippedRecently: () => fetchShippedIssues(200),
    open: () => fetchOpenIssues(),
    runs: () => JSON.parse(ghExec(["run", "list", "--limit", "60", "--json", "workflowName,conclusion,createdAt,status"])),
    agentPrs: () =>
      fetchOpenAgentPullRequests().map((pr) => classifyAgentPullRequest(pr, { staleMs: PR_STALE_MS })),
    changelog: readChangelog,
    site: fetchSite,
    lastDigest: readLastDigest,
    // Open and closed: a finding the PM closed is exactly the one that matters
    // when it comes back. The search only narrows the read; the check applies
    // the window itself.
    playtestFindings: () =>
      JSON.parse(
        ghExec([
          "issue", "list", "--label", PLAYTEST_LABEL, "--state", "all", "--limit", "200",
          "--search", `created:>=${daysAgo(REPEATED_FINDING_WEEKS * 7)}`,
          "--json", "number,title,createdAt",
        ])
      ),
    roleRuns: readRoleRuns,
  });
}

/** Whether the digest for the last reported week exists, and where. */
function readLastDigest() {
  const weekStart = expectedDigestWeek();
  return { weekStart, url: findDiscussion(DIGEST_CATEGORY, digestTitlePrefix(weekStart))?.url || null };
}

/**
 * Each model-running workflow's latest runs, with every annotation they left.
 *
 * Annotations rather than logs: every warning and error this pipeline logs
 * becomes one, so they carry the abort without downloading megabytes of log per
 * run. It costs a request per run and one per job — about sixty a day.
 */
function readRoleRuns() {
  const api = (path) => JSON.parse(ghExec(["api", `repos/{owner}/{repo}/${path}`]));
  return MODEL_WORKFLOWS.map((workflow) => ({
    workflow,
    runs: JSON.parse(
      ghExec([
        "run", "list", "--workflow", `${workflow}.yml`, "--status", "completed",
        "--limit", String(ABORTED_RUNS_READ), "--json", "databaseId,createdAt",
      ])
    ).map((run) => ({
      createdAt: run.createdAt,
      annotations: api(`actions/runs/${run.databaseId}/jobs`).jobs.flatMap((job) =>
        api(`check-runs/${job.id}/annotations`).map((annotation) => annotation.message)
      ),
    })),
  }));
}

/**
 * Read each fact on its own, so one that fails costs only the checks that need it.
 *
 * A fact that could not be read is not left empty. It used to be — or the whole
 * run gave up and exited 0 — and an empty fact reads as a healthy one: no open
 * issues is no abandoned tickets, no PRs is no stalled PRs. So an unreadable fact
 * throws the moment a check touches it, and that check comes back unknown rather
 * than clear.
 */
export async function readFacts(readers) {
  const facts = {};
  const unreadable = [];
  for (const [name, read] of Object.entries(readers)) {
    try {
      facts[name] = await read();
    } catch (e) {
      log("warn", `Health: could not read ${name}.`, errorData(e));
      unreadable.push(name);
      Object.defineProperty(facts, name, {
        enumerable: true,
        get() {
          throw new Error(`${name} could not be read: ${e.message}`);
        },
      });
    }
  }
  return { facts, unreadable };
}

/**
 * The changelog, or a throw when the wiki itself is unreachable. readPage answers
 * "" for both a missing page and a missing wiki, and only the first is a fact.
 */
function readChangelog() {
  if (!wikiPath("Changelog.md")) throw new Error("the wiki could not be cloned");
  return readPage("Changelog.md");
}

/**
 * Fetch the deployed page. Never throws — an unreachable site is a finding, not
 * a crash, and the rest of the health report still has to run.
 */
async function fetchSite() {
  if (!SITE_URL) return null;
  try {
    const response = await fetch(SITE_URL, { redirect: "follow" });
    const body = response.ok ? await response.text() : "";
    return {
      url: SITE_URL,
      status: response.status,
      hasMarker: body.includes(SITE_MARKER),
    };
  } catch (e) {
    return { url: SITE_URL, error: String(e?.message || e) };
  }
}

// --- The checks. Each returns a finding string, or null when all is well. ------

/** Merges are the pipeline's output; no output for two days is the headline fault. */
export function checkShipping({ shippedRecently, open }) {
  const since = daysAgo(QUIET_DAYS_BEFORE_ALARM);
  const shipped = shippedRecently.filter((i) => (i.closedAt || "") >= since);
  if (shipped.length > 0) return null;

  const openNumbers = new Set(open.map((i) => i.number));
  const buildable = open.filter((i) => isBuildable(i, openNumbers)).length;
  // An empty board is a grooming problem, not a shipping one, and the two call
  // for opposite responses — say which.
  return buildable > 0
    ? `Nothing has shipped in ${QUIET_DAYS_BEFORE_ALARM} days, though ${buildable} ticket(s) are buildable. The Devs are stuck, not idle.`
    : `Nothing has shipped in ${QUIET_DAYS_BEFORE_ALARM} days and nothing is buildable. The backlog is empty — grooming has stalled.`;
}

/** A merge that never reaches the changelog is a merge the digest cannot report. */
export function checkChangelogKeepingUp({ changelog, shippedRecently }) {
  const since = daysAgo(CHANGELOG_STALE_DAYS);
  const shipped = shippedRecently.filter((i) => (i.closedAt || "") >= since).length;
  if (shipped === 0) return null; // nothing to record; silence is correct

  const recorded = [...changelog.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gm)].some((m) => m[1] >= since);
  if (recorded) return null;
  return (
    `${shipped} ticket(s) shipped in the last ${CHANGELOG_STALE_DAYS} days but the changelog has no entry ` +
    `since before ${since}. Wiki writes are being dropped — everything downstream (Story, the weekly digest) ` +
    `is working from stale content.`
  );
}

/** Tickets the Devs engaged and gave up on, as a share of what they engaged. */
export function checkAbandonRate({ open, shippedRecently }) {
  const parked = open.filter(isBlocked).length;
  const struggling = open.filter((i) => attemptCount(i) > 0 && !isBlocked(i)).length;
  const shipped = shippedRecently.filter((i) => (i.closedAt || "") >= daysAgo(7)).length;
  const engaged = shipped + parked + struggling;
  if (engaged < 5) return null; // too few to mean anything

  const rate = (parked + struggling) / engaged;
  if (rate < ABANDON_RATE_LIMIT) return null;
  return (
    `${Math.round(rate * 100)}% of engaged tickets are failing (${parked} parked, ${struggling} retrying, ` +
    `${shipped} shipped this week). Tickets are being written the Devs cannot build.`
  );
}

/**
 * The weekly agents, which fail differently from the daily ones: a broken weekly
 * run is invisible for seven days, and a skipped one looks exactly like a quiet
 * one.
 */
export function checkWeeklyAgents({ runs }) {
  const weekly = ["product-owner", "playtester", "tech-lead"];
  const problems = [];
  for (const name of weekly) {
    const mine = runs.filter((r) => r.workflowName === name && r.status === "completed");
    if (!mine.length) continue; // never run, or scrolled off the window — not a fault
    const last = mine[0];
    if (last.conclusion !== "success") {
      problems.push(`${name} last run ${last.conclusion} (${last.createdAt.slice(0, 10)})`);
    }
  }
  return problems.length ? `Weekly agents failing: ${problems.join("; ")}.` : null;
}

/**
 * Is the thing we built actually up?
 *
 * The one check here that leaves the repository. It asks the least it can — does
 * the page load, and does it still contain the state layer — because anything
 * cleverer belongs to the Playtester, which opens the same URL in a real browser
 * once a week. This only has to catch "nobody can see it".
 */
export async function checkDeployedSite({ site }) {
  if (!site) return null; // no URL configured — nothing to say
  if (site.error) return `The live site at ${site.url} could not be reached: ${site.error}.`;
  if (site.status !== 200) return `The live site at ${site.url} returned HTTP ${site.status}.`;
  if (!site.hasMarker) {
    return (
      `The live site at ${site.url} loads, but its HTML no longer contains "${SITE_MARKER}" — ` +
      `the page being served is not the product this repository builds. A stale or failed Pages deploy looks exactly like this.`
    );
  }
  return null;
}


/**
 * Work the pipeline started and never finished.
 *
 * The Devs reconcile these at the top of every run, so a stalled PR should not
 * survive a day. This check is what notices when that is not happening — a Devs
 * run that is failing before it reaches the reconcile, or two PRs open for the
 * same ticket, which is the exact shape of the duplication bug this was written
 * for and the one thing the reconcile cannot report on itself.
 */
export function checkStalledPullRequests({ agentPrs }) {
  const findings = [];

  const byIssue = new Map();
  for (const pr of agentPrs) {
    if (!byIssue.has(pr.issueNumber)) byIssue.set(pr.issueNumber, []);
    byIssue.get(pr.issueNumber).push(pr);
  }
  const duplicated = [...byIssue.entries()].filter(([, prs]) => prs.length > 1);
  if (duplicated.length) {
    findings.push(
      `${duplicated.length} ticket(s) have more than one open PR: ` +
        duplicated.map(([issue, prs]) => `#${issue} (${prs.map((p) => `#${p.number}`).join(", ")})`).join("; ") +
        ". A second PR means a run planned a ticket another run had already built."
    );
  }

  const stuck = agentPrs.filter((pr) => pr.stale && pr.state !== "passing");
  if (stuck.length) {
    findings.push(
      `${stuck.length} agent PR(s) stalled past ${Math.round(PR_STALE_MS / 3_600_000)}h: ` +
        stuck.map((p) => `#${p.number} (${p.state}, ${Math.round(p.ageMs / 3_600_000)}h)`).join("; ") +
        ". The Devs reconcile these at the start of every run, so they should not accumulate — the Devs are not reaching that step."
    );
  }

  return findings.length ? findings.join(" ") : null;
}

/**
 * The week whose digest should exist by now: the one covered by the latest
 * report day strictly before today. Strictly, so the report day itself is not
 * held to a report that may still be on its way.
 */
export function expectedDigestWeek(now = new Date(), reportDay = DIGEST_DAY) {
  const daysSinceReport = (now.getUTCDay() - reportDay + 7) % 7 || 7;
  return digestWeekStart(new Date(now.getTime() - daysSinceReport * 86_400_000));
}

/**
 * The digest is the one thing addressed to a person, and it stopped for two
 * Sundays with every run green. Checking the run is not enough; this checks the
 * post.
 */
export function checkWeeklyDigest({ lastDigest }) {
  if (lastDigest.url) return null;
  return (
    `No weekly digest was posted for the week of ${lastDigest.weekStart}. ` +
    `The Product Manager's Sunday run did not publish it — its report session failed or never ran.`
  );
}

/** Titles that differ only in case, punctuation or spacing are the same finding. */
export function normaliseFindingTitle(title) {
  return String(title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** A finding that keeps being filed and closed is one the loop is not fixing. */
export function checkRepeatedFindings({ playtestFindings }) {
  const since = daysAgo(REPEATED_FINDING_WEEKS * 7);
  const byTitle = new Map();
  for (const finding of playtestFindings.filter((f) => (f.createdAt || "") >= since)) {
    const key = normaliseFindingTitle(finding.title);
    byTitle.set(key, [...(byTitle.get(key) || []), finding]);
  }
  const repeated = [...byTitle.values()].filter((filed) => filed.length >= REPEATED_FINDING_LIMIT);
  if (!repeated.length) return null;
  return (
    `${repeated.length} playtest finding(s) filed ${REPEATED_FINDING_LIMIT}+ times in ${REPEATED_FINDING_WEEKS} weeks: ` +
    repeated.map((filed) => `"${filed[0].title}" (${filed.map((f) => `#${f.number}`).join(", ")})`).join("; ") +
    ". Each was closed and came back — what ships is not changing what the Playtester sees."
  );
}

/** A role whose sessions keep being capped or cut off, though its runs are green. */
export function checkAbortedSessions({ roleRuns }) {
  const failing = roleRuns
    .map(({ workflow, runs }) => {
      const read = runs.slice(0, ABORTED_RUNS_READ);
      const aborted = read.filter((run) => run.annotations.some((message) => ABORT_PATTERN.test(message)));
      return { workflow, read: read.length, aborted: aborted.length };
    })
    .filter((role) => role.aborted >= ABORTED_RUNS_LIMIT);
  if (!failing.length) return null;
  return (
    `Agent sessions are being aborted: ${failing.map((r) => `${r.workflow} in ${r.aborted} of its last ${r.read} runs`).join("; ")}. ` +
    `A capped or timed-out session gives up its ticket or report while the run still reports success.`
  );
}

const CHECKS = [
  checkDeployedSite,
  checkShipping,
  checkChangelogKeepingUp,
  checkAbandonRate,
  checkStalledPullRequests,
  checkWeeklyAgents,
  checkWeeklyDigest,
  checkRepeatedFindings,
  checkAbortedSessions,
];

/**
 * The numbers, whether or not anything is wrong. Always logged and written to the
 * job summary; never filed as an issue on its own.
 */
export function renderVitals({ open, shippedRecently, site, agentPrs = [] }) {
  const openNumbers = new Set(open.map((i) => i.number));
  const shipped7 = shippedRecently.filter((i) => (i.closedAt || "") >= daysAgo(7)).length;
  return [
    site ? `Site: ${site.error ? "unreachable" : `HTTP ${site.status}`}` : "Site: not checked",
    `Shipped (7d): ${shipped7}`,
    `Open: ${open.length} (${open.filter((i) => isBuildable(i, openNumbers)).length} buildable, ${open.filter(isBlocked).length} parked)`,
    `Agent PRs: ${agentPrs.length} open (${agentPrs.filter((p) => p.stale).length} stalled)`,
  ].join(" · ");
}

/**
 * Run every check, keeping "could not tell" apart from "all is well".
 *
 * A broken check must not take the others down with it — the whole point is to
 * still be reporting when something else is wrong. But its silence is not a clear
 * bill: counted as clear, one throwing check was enough to close a real alert.
 */
export async function runChecks(checks, facts) {
  const findings = [];
  const unknown = [];
  for (const check of checks) {
    try {
      const finding = await check(facts);
      if (finding) findings.push(finding);
    } catch (e) {
      log("warn", `Health: the ${check.name} check could not run.`, errorData(e));
      unknown.push(`${check.name}: ${e.message || e}`);
    }
  }
  return { findings, unknown };
}

/**
 * What to do with the standing alert, given this run's results.
 *
 * Only a run where every check came back clear may close it. With any check
 * unknown, the problem it reported may be exactly the one that could not be
 * looked at.
 */
export function alertAction({ findings, unknown, standing }) {
  if (findings.length) return standing ? "hold" : "post";
  if (unknown.length) return "hold";
  return standing ? "close" : "none";
}

/**
 * Publish, update, or clear the standing health alert.
 *
 * One open post at a time, naming everything currently wrong — five separate
 * alerts for one broken wiki push is how a channel gets muted.
 *
 * And it CLOSES itself when the findings clear. The old version filed an issue
 * and never closed it, which was worse than it sounds: the same check that stops
 * it filing duplicates meant one stale alert suppressed every later one. An alert
 * that cannot clear is an alert that only works once.
 */
function publishAlert({ findings, unknown }, vitals) {
  const standing = findOpenDiscussion(HEALTH_CATEGORY, HEALTH_TITLE_PREFIX);
  const action = alertAction({ findings, unknown, standing });

  if (action === "none") return;
  if (action === "close") {
    log("info", "Health: everything it reported is fixed — closing the standing alert.");
    resolveDiscussion(
      standing.id,
      `Clear as of ${new Date().toISOString().slice(0, 10)}. Nothing that was reported here is still true.\n\n${vitals}`
    );
    return;
  }
  if (action === "hold") {
    if (standing) {
      log("info", `Health: ${standing.url} stays open — ${findings.length ? "it is still true" : "not everything could be checked"}.`);
    }
    return;
  }

  const mention = NOTIFY_USER
    ? `${NOTIFY_USER.startsWith("@") ? NOTIFY_USER : `@${NOTIFY_USER}`} — the pipeline needs a look.\n`
    : "";
  const url = postDiscussion({
    category: HEALTH_CATEGORY,
    title: `${HEALTH_TITLE_PREFIX} ${findings.length} problem(s)`,
    body: [
      mention,
      "## What is wrong",
      ...findings.map((f) => `- ${f}`),
      ...(unknown.length ? ["", "## Could not check", ...unknown.map((u) => `- ${u}`)] : []),
      "",
      "## Where things stand",
      vitals,
      "",
      "_Posted by the health check, which runs daily, stays quiet unless something breaks, and closes this by itself once nothing here is true any more._",
    ].join("\n"),
  });
  if (url) log("warn", `Health: ${findings.length} problem(s) — ${url}`);
}

async function main() {
  log("info", "=== Health — measuring the pipeline ===");

  const { facts, unreadable } = await withLogGroup("Gathering", () => gatherFacts());

  const vitals = unreadable.length
    ? `Vitals incomplete — could not read ${unreadable.join(", ")}.`
    : renderVitals(facts);
  log("info", vitals);

  const results = await runChecks(CHECKS, facts);
  const { findings, unknown } = results;

  appendJobSummary(
    [
      `## Health\n\n${vitals}\n`,
      findings.length ? findings.map((f) => `- ${f}`).join("\n") : "No problems found.",
      unknown.length ? `\n### Could not check\n\n${unknown.map((u) => `- ${u}`).join("\n")}` : "",
    ].join("\n")
  );

  findings.forEach((f) => log("warn", `Health: ${f}`));
  if (!findings.length && !unknown.length) log("info", "Health: nothing to report.");
  // Called either way: with findings it raises or holds the alert, and with none
  // it closes a standing one that has been fixed — unless a check could not run.
  publishAlert(results, vitals);
  printRunSummary("Health");

  // Reported first, failed after: a run that could not look at everything must
  // not read as a green one.
  if (unknown.length) {
    log("error", `Health: ${unknown.length} check(s) could not run — the pipeline's health is unknown, not fine.`);
    process.exitCode = 1;
  }
}

// Guarded so the checks above can be exercised without touching the API.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Health failed: ${err.message || err}`);
    printRunSummary("Health");
    process.exit(1);
  });
}
