// Assign tickets to parallel Builder slots, then hand the assignment to a matrix.
//
// The obvious design — N builders each picking their own ticket — needs a claim
// mechanism, and GitHub gives no atomic one: two runners can both add a "claimed"
// label and neither learns about the other, so they duplicate a ticket and race on
// the merge. So nobody claims anything. ONE reader decides, up front, and each
// slot is told exactly which ticket is its own. A race you never create needs no
// lock.
//
// Prints `matrix` and `count` to GITHUB_OUTPUT for the workflow to consume.
import fs from "fs";
import {
  log,
  printRunSummary,
  fetchOpenIssues,
  isBuildable,
  unmetDependencies,
  attemptCount,
  PRIORITY_LABELS,
} from "./shared.mjs";

// How many tickets to build at once. Deliberately small: every extra slot is
// another branch that can touch the same file, and the dependency graph makes
// tickets logically independent without making them independent on disk.
const SLOTS = Number(process.env.PARALLEL_BUILDERS || 2);

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

function writeOutput(matrix) {
  const out = process.env.GITHUB_OUTPUT;
  const payload = `matrix=${JSON.stringify({ include: matrix })}\ncount=${matrix.length}\n`;
  if (out) fs.appendFileSync(out, payload);
  else console.log(payload.trim()); // local runs just print it
}

function main() {
  log("info", `=== Plan build — assigning up to ${SLOTS} ticket(s) ===`);

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
    writeOutput([]);
    printRunSummary("Plan build");
    return;
  }

  // Highest priority first; then fewest previous failures, so a ticket that has
  // already burned attempts doesn't keep crowding out fresh work; then oldest, so
  // ordering is stable and a re-run assigns the same tickets to the same slots.
  const ordered = [...buildable].sort(
    (a, b) => priorityRank(a) - priorityRank(b) || attemptCount(a) - attemptCount(b) || a.number - b.number
  );

  const assigned = ordered.slice(0, SLOTS).map((issue, index) => ({
    slot: index + 1,
    ticket: issue.number,
    title: issue.title,
  }));

  for (const a of assigned) log("info", `Slot ${a.slot} → #${a.ticket} ${a.title}`);
  if (ordered.length > assigned.length) {
    log("info", `${ordered.length - assigned.length} more buildable ticket(s) left for the next run.`);
  }

  writeOutput(assigned);
  printRunSummary("Plan build");
}

main();
