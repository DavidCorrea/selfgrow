// Decide whether there is anything for a Builder run to do at all.
//
// This used to assign tickets to parallel slots and hand a matrix to the workflow.
// The slots were never actually parallel — same-file collisions forced
// max-parallel: 1 — so they were a queue wearing a fan-out's clothes, and each one
// paid a fresh VM, checkout, npm ci and Chromium install (~3 minutes) for
// isolation it only needed against siblings that no longer ran beside it. The
// queue now lives inside ONE job, which devs.mjs already knew how to drain, and
// the setup is paid once.
//
// It also used to size that queue against the day's remaining request budget.
// There is no request budget any more — spend is capped on the OpenRouter key
// itself — so the arithmetic that decided how many tickets a run could afford,
// and the four ways it could refuse to queue any, are gone with it.
//
// What is left is the one question a runner cannot cheaply answer for itself:
// is there buildable work? Answering it here keeps a heavy job — VM, checkout,
// Chromium — from booting only to find an empty board.
//
// Prints `count` and `queue` to GITHUB_OUTPUT for the workflow to consume.
import fs from "fs";
import {
  log,
  printRunSummary,
  fetchOpenIssues,
  isBuildable,
  unmetDependencies,
  priorityRank,
  effectivePriorityRank,
} from "./shared.mjs";

// Most tickets one run will attempt, one after another. A ceiling on the queue,
// not a target: the run stops earlier whenever the board empties or the wall
// clock does.
const MAX_TICKETS = Number(process.env.MAX_TICKETS_PER_RUN || 6);

function writeOutput({ count = 0, queue = 0 } = {}) {
  const out = process.env.GITHUB_OUTPUT;
  const payload = `count=${count}\nqueue=${queue}\n`;
  if (out) fs.appendFileSync(out, payload);
  else console.log(payload.trim()); // local runs just print it
}

function main() {
  log("info", `=== Plan build — sizing a run of up to ${MAX_TICKETS} ticket(s) ===`);

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
  // reaches for the same tickets in the same order.
  //
  // Attempt count is deliberately NOT a tiebreak. It used to be, on the reasoning
  // that a ticket which has burned attempts shouldn't crowd out fresh work — but
  // that inverts the project's priorities in practice. Hard, foundational tickets
  // are exactly the ones that fail once, and demoting them means every easy
  // peripheral ticket overtakes them forever: the runtime core sat at attempts:1
  // while a skip-link fix shipped ahead of it. Perpetual failures are already
  // handled properly by parking at MAX_TICKET_ATTEMPTS; they don't need a second
  // mechanism that quietly reorders the roadmap.
  // Ranked by what each ticket UNBLOCKS, not only by its own label — a blocker is
  // worth what waits on it. See effectivePriorityRank.
  const ordered = [...buildable].sort(
    (a, b) =>
      effectivePriorityRank(a, open) - effectivePriorityRank(b, open) ||
      a.number - b.number
  );

  // Deliberately NOT capped at the number buildable RIGHT NOW. Shipping a ticket
  // is what releases the tickets waiting on it, so the board grows during the run:
  // #152 is the only buildable ticket as this is written, and merging it frees
  // #153 and #168 immediately. Sizing the queue to a count taken before the first
  // build would stop the run at one and leave two tickets it had just unblocked
  // for tomorrow — which is precisely the frozen line-up the matrix imposed and
  // this job exists to avoid.
  const queue = MAX_TICKETS;

  log("info", `${ordered.length} buildable ticket(s) now, queue capped at ${queue}. Highest priority first:`);
  // The Builder re-picks by this same ordering, so these are what it should reach
  // for first — but it re-reads the board between tickets, so both what comes
  // second and how many there are can legitimately change mid-run.
  for (const issue of ordered.slice(0, queue)) {
    // Say when a ticket is being built above its own label, and why. A low ticket
    // sorting first otherwise looks like the ordering is broken.
    const lifted =
      effectivePriorityRank(issue, open) < priorityRank(issue)
        ? " (lifted — it unblocks higher-priority work)"
        : "";
    log("info", `  #${issue.number} ${issue.title}${lifted}`);
  }
  if (ordered.length > queue) {
    log("info", `${ordered.length - queue} more buildable ticket(s) left for the next run.`);
  }

  // `count` only answers "is there anything to do at all", which is what gates the
  // build job. `queue` is how far the run may go, and is deliberately the larger
  // of the two whenever the board is expected to grow.
  writeOutput({ count: ordered.length, queue });
  printRunSummary("Plan build");
}

main();
