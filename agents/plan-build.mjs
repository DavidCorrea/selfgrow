// Decide whether the day can afford a Builder run at all, and how big a one.
//
// This used to assign tickets to parallel slots and hand a matrix to the workflow.
// The slots were never actually parallel — same-file collisions forced
// max-parallel: 1 — so they were a queue wearing a fan-out's clothes, and each one
// paid a fresh VM, checkout, npm ci and Chromium install (~3 minutes) for
// isolation it only needed against siblings that no longer ran beside it. The
// queue now lives inside ONE job, which builder-team.mjs already knew how to
// drain, and the setup is paid once.
//
// Two things fall out of that, both of which mean more shipped work per request:
//
//   - No per-ticket division. The run gets the day's whole Builder share as a
//     POOL and checks it between tickets, so a ticket that comes in cheap leaves
//     the remainder to the next one instead of retiring an unspent slot budget.
//   - No assignment. The Builder re-reads the board before every ticket and picks
//     by the same priority order used here, so a merge that unblocks a dependent
//     ticket mid-run makes it available immediately — where a matrix fixed the
//     line-up before the first build started.
//
// What's left is the question a runner can't cheaply answer for itself: is there
// buildable work, and does the ledger still have the requests to do it? Answering
// that here keeps a heavy job from booting only to find neither is true.
//
// Prints `count` and `budget` to GITHUB_OUTPUT for the workflow to consume.
import fs from "fs";
import {
  log,
  printRunSummary,
  fetchOpenIssues,
  isBuildable,
  unmetDependencies,
  initDailyLedger,
  getDailySpend,
  isLedgerActive,
  DAILY_REQUEST_CAP,
  PRIORITY_LABELS,
} from "./shared.mjs";

// Most tickets one run will attempt, one after another. A ceiling on the queue,
// not a target: the run stops earlier whenever the board empties, the pooled
// budget runs out, or the wall clock does.
const MAX_TICKETS = Number(process.env.MAX_TICKETS_PER_RUN || 6);

// The Builder's share of the day's requests, for the whole run.
//
// This used to be multiplied by the slot count somewhere else, so the day's real
// Builder ceiling was a product written in no single place: raising the slot count
// from 4 to 8 silently doubled the day. It is now simply the pool the one job
// spends, and the number below decides how many tickets that pool can carry.
const BUILDER_DAY_BUDGET = Number(process.env.BUILDER_DAY_BUDGET || 600);

// What one ticket needs to have a real chance of shipping (a merged ticket
// measured 33-50 requests, and a ticket that needs a review round or two costs
// more). Used to size the queue, not to ration it: a run given fewer requests than
// this would spend everything it has and throw the half-built work away.
const MIN_TICKET_BUDGET = Number(process.env.MIN_TICKET_BUDGET || 100);

const PRIORITY_RANK = {
  [PRIORITY_LABELS.high]: 0,
  [PRIORITY_LABELS.medium]: 1,
  [PRIORITY_LABELS.low]: 2,
};

function priorityRank(issue) {
  const names = (issue.labels || []).map((l) => l.name || l);
  for (const [label, rank] of Object.entries(PRIORITY_RANK)) {
    if (names.includes(label)) return rank;
  }
  return 3; // unlabelled sorts last
}

function writeOutput({ count = 0, budget = 0 } = {}) {
  const out = process.env.GITHUB_OUTPUT;
  const payload = `count=${count}\nbudget=${budget}\n`;
  if (out) fs.appendFileSync(out, payload);
  else console.log(payload.trim()); // local runs just print it
}

function main() {
  log("info", `=== Plan build — sizing a run of up to ${MAX_TICKETS} ticket(s) ===`);

  // Opened up front: the ledger decides how much work this run may queue at all.
  initDailyLedger();

  const open = fetchOpenIssues(100);
  const openNumbers = new Set(open.map((i) => i.number));
  const buildable = open.filter((i) => isBuildable(i, openNumbers));

  if (!buildable.length) {
    const waiting = open
      .map((i) => ({ n: i.number, deps: unmetDependencies(i, openNumbers) }))
      .filter((w) => w.deps.length);
    if (waiting.length) {
      log("info", `Nothing buildable: ${waiting.map((w) => `#${w.n} waits on ${w.deps.map((d) => `#${d}`).join(", ")}`).join("; ")}.`);
    } else {
      log("info", "Nothing buildable — the backlog is empty or entirely parked.");
    }
    writeOutput();
    printRunSummary("Plan build");
    return;
  }

  // Highest priority first, then oldest, so ordering is stable and a re-run
  // assigns the same tickets to the same slots.
  //
  // Attempt count is deliberately NOT a tiebreak. It used to be, on the reasoning
  // that a ticket which has burned attempts shouldn't crowd out fresh work — but
  // that inverts the project's priorities in practice. Hard, foundational tickets
  // are exactly the ones that fail once, and demoting them means every easy
  // peripheral ticket overtakes them forever: the runtime core sat at attempts:1
  // while a skip-link fix shipped ahead of it. Perpetual failures are already
  // handled properly by parking at MAX_TICKET_ATTEMPTS; they don't need a second
  // mechanism that quietly reorders the roadmap.
  const ordered = [...buildable].sort(
    (a, b) => priorityRank(a) - priorityRank(b) || a.number - b.number
  );

  // What the day has actually got left, not what the Builder is nominally allowed.
  // Read here — before any runner spins up — so a day already spent by the PM, a
  // weekly agent, or an earlier Builder run declines to queue work instead of
  // starting a job that installs Chromium and then refuses to make a single call.
  const dayLeft = isLedgerActive() ? DAILY_REQUEST_CAP - getDailySpend() : BUILDER_DAY_BUDGET;
  const dayBudget = Math.max(0, Math.min(BUILDER_DAY_BUDGET, dayLeft));
  if (dayBudget < MIN_TICKET_BUDGET) {
    // Say WHICH ceiling bound it. "The day is spent" and "the Builder's share is
    // set too low" call for opposite responses, and the number alone can't tell
    // them apart.
    const why =
      dayLeft < BUILDER_DAY_BUDGET
        ? `only ${dayLeft} of the day's ${DAILY_REQUEST_CAP} request(s) are left (the cap resets at 00:00 UTC)`
        : `BUILDER_DAY_BUDGET is ${BUILDER_DAY_BUDGET}`;
    log(
      "info",
      `Queueing nothing: ${why}, under the ${MIN_TICKET_BUDGET} one ticket needs to ship.`
    );
    writeOutput();
    printRunSummary("Plan build");
    return;
  }

  // How long a queue the pool can carry, at what one ticket needs to finish. This
  // does NOT ration the run — the Builder spends the pool as the tickets in front
  // of it actually cost, and a cheap first ticket leaves more for the second. It
  // only decides where to stop asking for more work.
  const count = Math.min(MAX_TICKETS, ordered.length, Math.floor(dayBudget / MIN_TICKET_BUDGET));

  log(
    "info",
    `${ordered.length} buildable ticket(s), ${dayBudget} request(s) in the pool — ` +
      `queueing ${count}, in priority order:`
  );
  // The Builder re-picks by this same ordering, so these are what it should reach
  // for — but it re-reads the board between tickets, so a merge that unblocks
  // something can legitimately change what comes second.
  for (const issue of ordered.slice(0, count)) {
    log("info", `  #${issue.number} ${issue.title}`);
  }
  if (ordered.length > count) {
    log("info", `${ordered.length - count} more buildable ticket(s) left for the next run.`);
  }

  writeOutput({ count, budget: dayBudget });
  printRunSummary("Plan build");
}

main();
