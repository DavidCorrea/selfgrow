// HEALTH — not a role, a dashboard.
//
// Every guard in this pipeline protects the product or the budget. Nothing
// watched the pipeline itself, and it showed: the changelog silently stopped
// growing for three days and ~100 merges, because every wiki push lost a race,
// logged a warning, and let the run report success. The Scribe then had nothing
// to write from. Nobody noticed, because noticing was nobody's job.
//
// So this measures the machine rather than the garden, and it is deliberately
// cheap: no model, no browser, no session. It reads what the pipeline has already
// written down — issues, runs, the ledger, the wiki — and compares it to what a
// working week looks like.
//
// It speaks only on exception. Silence means fine; an issue means something is
// wrong and names it. A dashboard that reports daily is a dashboard people stop
// reading, and this one exists to be believed the one time it fires.
import { execSync } from "child_process";
import { pathToFileURL } from "url";
import { log, withLogGroup, appendJobSummary, errorData } from "./log.mjs";
import { readPage } from "./wiki.mjs";
import {
  repoRoot,
  printRunSummary,
  fetchOpenIssues,
  isBuildable,
  isBlocked,
  attemptCount,
  createIssue,
  HEALTH_LABEL,
  parseLedger,
  DAILY_REQUEST_CAP,
} from "./shared.mjs";

// Who gets the @-mention. The point of an alert is that it reaches a person, so
// it falls back to the repo's owner rather than going quietly nowhere.
const NOTIFY_USER = process.env.GH_NOTIFY_USER || "";

// A day with merges but no changelog entry means the write path is broken, not
// that the day was quiet. Two days of it is not a coincidence.
const CHANGELOG_STALE_DAYS = 2;

// Below this, the Devs are not shipping. Measured over two days so one bad night
// — a capped model, a slow queue — does not page anyone.
const QUIET_DAYS_BEFORE_ALARM = 2;

// Of the tickets the Devs actually engaged with this week, the share that may be
// abandoned before it reads as a systemic problem rather than a few hard tickets.
const ABANDON_RATE_LIMIT = 0.4;

// Spending this much of the daily cap is fine once; every day means the pipeline
// is sized past its allowance and something is being starved.
const LEDGER_HOT_FRACTION = 0.95;

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

const gh = (args) =>
  execSync(`gh ${args}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString();

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Everything the checks below read, gathered once.
 *
 * Deliberately one batch rather than a fetch per check: the checks are cheap and
 * the API calls are not, and a check that quietly costs a request is a check
 * nobody will want to add.
 */
async function gatherFacts() {
  const closedRecently = JSON.parse(
    gh(`issue list --state closed --limit 200 --json number,title,closedAt,labels`)
  );
  const open = fetchOpenIssues(200);
  const runs = JSON.parse(
    gh(`run list --limit 60 --json workflowName,conclusion,createdAt,status`)
  );
  return {
    open,
    closedRecently,
    runs,
    ledger: parseLedger(readPage("Budget.md")),
    changelog: readPage("Changelog.md"),
    site: await fetchSite(),
  };
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
export function checkShipping({ closedRecently, open }) {
  const since = daysAgo(QUIET_DAYS_BEFORE_ALARM);
  const shipped = closedRecently.filter((i) => (i.closedAt || "") >= since);
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
export function checkChangelogKeepingUp({ changelog, closedRecently }) {
  const since = daysAgo(CHANGELOG_STALE_DAYS);
  const shipped = closedRecently.filter((i) => (i.closedAt || "") >= since).length;
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
export function checkAbandonRate({ open, closedRecently }) {
  const parked = open.filter(isBlocked).length;
  const struggling = open.filter((i) => attemptCount(i) > 0 && !isBlocked(i)).length;
  const shipped = closedRecently.filter((i) => (i.closedAt || "") >= daysAgo(7)).length;
  const engaged = shipped + parked + struggling;
  if (engaged < 5) return null; // too few to mean anything

  const rate = (parked + struggling) / engaged;
  if (rate < ABANDON_RATE_LIMIT) return null;
  return (
    `${Math.round(rate * 100)}% of engaged tickets are failing (${parked} parked, ${struggling} retrying, ` +
    `${shipped} shipped this week). Tickets are being written the Devs cannot build.`
  );
}

/** The account's allowance, which nothing else reports until it runs out. */
export function checkBudgetHeadroom({ ledger }) {
  const week = [...ledger.entries()].filter(([day]) => day >= daysAgo(7));
  if (week.length < 3) return null;
  const hot = week.filter(([, spent]) => spent >= DAILY_REQUEST_CAP * LEDGER_HOT_FRACTION);
  if (hot.length < 3) return null;
  return (
    `${hot.length} of the last ${week.length} days spent ≥${Math.round(LEDGER_HOT_FRACTION * 100)}% of the ` +
    `${DAILY_REQUEST_CAP}/day cap (${hot.map(([d, n]) => `${d}: ${n}`).join(", ")}). ` +
    `Some agent is being starved at the end of every day.`
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

const CHECKS = [
  checkDeployedSite,
  checkShipping,
  checkChangelogKeepingUp,
  checkAbandonRate,
  checkBudgetHeadroom,
  checkWeeklyAgents,
];

/**
 * The numbers, whether or not anything is wrong. Always logged and written to the
 * job summary; never filed as an issue on its own.
 */
export function renderVitals({ open, closedRecently, ledger, site }) {
  const openNumbers = new Set(open.map((i) => i.number));
  const shipped7 = closedRecently.filter((i) => (i.closedAt || "") >= daysAgo(7)).length;
  const spend7 = [...ledger.entries()]
    .filter(([day]) => day >= daysAgo(7))
    .reduce((total, [, spent]) => total + spent, 0);
  return [
    site ? `Site: ${site.error ? "unreachable" : `HTTP ${site.status}`}` : "Site: not checked",
    `Shipped (7d): ${shipped7}`,
    `Open: ${open.length} (${open.filter((i) => isBuildable(i, openNumbers)).length} buildable, ${open.filter(isBlocked).length} parked)`,
    `Spend (7d): ${spend7}/${DAILY_REQUEST_CAP * 7} requests`,
  ].join(" · ");
}

/**
 * Raise one issue naming everything that is wrong, rather than one per fault.
 * Five separate alerts for a single broken wiki push is how an alert channel
 * gets muted.
 */
function raise(findings, vitals) {
  const title = `Pipeline health: ${findings.length} problem(s)`;
  const open = fetchOpenIssues(200);
  const existing = open.find((i) => (i.title || "").startsWith("Pipeline health:"));
  if (existing) {
    log("info", `Health: #${existing.number} is already open for this — not filing another.`);
    return;
  }
  const mention = NOTIFY_USER ? `${NOTIFY_USER.startsWith("@") ? NOTIFY_USER : `@${NOTIFY_USER}`} — the pipeline needs a look.\n` : "";
  const body = [
    mention,
    "## What is wrong",
    ...findings.map((f) => `- ${f}`),
    "",
    "## Where things stand",
    vitals,
    "",
    "_Filed by the health check, which runs daily and stays quiet unless something breaks._",
  ].join("\n");
  const number = createIssue(title, body, [HEALTH_LABEL]);
  if (number) log("warn", `Health: filed #${number} — ${findings.length} problem(s).`);
}

async function main() {
  log("info", "=== Health — measuring the pipeline ===");

  let facts;
  try {
    facts = await withLogGroup("Gathering", () => gatherFacts());
  } catch (e) {
    log("error", "Health: could not read the pipeline's own records.", errorData(e));
    printRunSummary("Health");
    return;
  }

  const vitals = renderVitals(facts);
  log("info", vitals);

  const findings = (
    await Promise.all(
      CHECKS.map(async (check) => {
        try {
          return await check(facts);
        } catch (e) {
          // A broken check must not take the others down with it — the whole
          // point is to still be reporting when something else is wrong.
          log("warn", `Health: the ${check.name} check threw.`, errorData(e));
          return null;
        }
      })
    )
  ).filter(Boolean);

  appendJobSummary(`## Health\n\n${vitals}\n\n${findings.length ? findings.map((f) => `- ${f}`).join("\n") : "No problems found."}`);

  if (!findings.length) {
    log("info", "Health: nothing to report.");
    printRunSummary("Health");
    return;
  }
  findings.forEach((f) => log("warn", `Health: ${f}`));
  raise(findings, vitals);
  printRunSummary("Health");
}

// Guarded so the checks above can be exercised without touching the API.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Health failed: ${err.message || err}`);
    printRunSummary("Health");
    process.exit(1);
  });
}
