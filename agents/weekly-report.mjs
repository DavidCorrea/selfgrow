// The Product Manager's weekly report — the Story page, and the digest that is
// the one thing in this pipeline addressed to a person.
//
// It lives beside product-manager.mjs rather than inside it because it answers a
// different question on a different cadence. Grooming asks "what should be built
// next"; this asks "what happened, and what does it add up to". Same role, same
// run, separate concerns.
//
// The Scribe used to own the Story as its own weekly agent. It had no consumer
// inside the pipeline and, for its whole existence, no input either — every wiki
// push lost a race with the request ledger, so the changelog it wrote from stayed
// empty and Story.md read "this project is just beginning" through a hundred
// merges. The writing is a communication job, and communication belongs to the
// role that already knows what shipped and why it was queued.
//
// The digest never asks for anything. It reports, mentions the owner so it
// arrives as a notification, and closes itself immediately — an open issue
// addressed to a human is a human on the critical path, and this pipeline is
// meant to run without one.
import { execSync } from "child_process";
import { log, withLogGroup, errorData, recordTicket } from "./log.mjs";
import { readChangelog, writeStory } from "./wiki.mjs";
import {
  repoRoot,
  loadPrompt,
  fillTemplate,
  runAgent,
  createIssue,
  DIGEST_LABEL,
  isBlocked,
  isPlaytestFeedback,
} from "./shared.mjs";

// Who the digest @-mentions. Without it the issue is still filed, just silently.
const NOTIFY_USER = process.env.GH_NOTIFY_USER || "";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Strip the code fence a model wraps prose in about a third of the time. */
export function cleanMarkdown(text) {
  return String(text || "")
    .replace(/^\s*```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/**
 * What the week actually contained, from what the pipeline already wrote down.
 * No model involved — the numbers are counted, not estimated.
 */
export function gatherWeek({ closed, open, ledger }) {
  const since = daysAgo(7);
  const shipped = closed.filter((i) => (i.closedAt || "") >= since);
  const spend = [...ledger.entries()]
    .filter(([day]) => day >= since)
    .reduce((total, [, n]) => total + n, 0);
  return {
    shipped,
    parked: open.filter(isBlocked),
    playtest: open.filter(isPlaytestFeedback),
    openCount: open.length,
    spend,
  };
}

/** The digest body: what shipped, what was heard, where things stand. */
export function renderDigest(week, narrative, milestone) {
  const mention = NOTIFY_USER
    ? `${NOTIFY_USER.startsWith("@") ? NOTIFY_USER : `@${NOTIFY_USER}`} — this week in the garden.\n`
    : "";
  const lines = [mention, "## What the garden grew", narrative || "_(nothing shipped this week)_", ""];

  if (week.playtest.length) {
    lines.push(
      "## What the Playtester said",
      ...week.playtest.map((i) => `- ${i.title} (#${i.number})`),
      ""
    );
  }
  if (week.parked.length) {
    lines.push(
      "## Stuck",
      ...week.parked.map((i) => `- ${i.title} (#${i.number}) — parked after repeated failures`),
      ""
    );
  }
  lines.push(
    "## Where things stand",
    `Shipped this week: ${week.shipped.length} · Open tickets: ${week.openCount} · Requests spent: ${week.spend}`,
    milestone ? `Current milestone: **${milestone.title}**` : "",
    "",
    "_Filed by the Product Manager. Nothing here needs a reply — the pipeline runs itself._"
  );
  return lines.filter((line) => line !== "").join("\n");
}

/**
 * Close the digest as soon as it is filed.
 *
 * The @-mention is what delivers the notification; the open issue is what would
 * make it look like a task waiting on someone. Only the first is wanted.
 */
function fileDigest(title, body) {
  const number = createIssue(title, body, [DIGEST_LABEL]);
  if (!number) return null;
  try {
    execSync(`gh issue close ${number}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    log("warn", `Digest: filed #${number} but could not close it.`, errorData(e));
  }
  recordTicket("created", number, title);
  return number;
}

/**
 * Write the Story page and file the week's digest.
 *
 * One model session for both: the narrative it produces is the body of the
 * digest's "what the garden grew" section as well as the Story page, and asking
 * twice would pay twice for the same paragraphs.
 */
export async function publishWeeklyReport({ closed, open, ledger, milestone }) {
  const week = gatherWeek({ closed, open, ledger });

  const narrative = cleanMarkdown(
    await withLogGroup("Weekly report", () =>
      runAgent({
        label: "Weekly report",
        systemPrompt: fillTemplate(loadPrompt("weekly-report"), {
          CHANGELOG: readChangelog(),
          SHIPPED: week.shipped.length
            ? week.shipped.map((i) => `- ${i.title} (#${i.number})`).join("\n")
            : "(nothing shipped this week)",
        }),
        // This agent's answer IS the artifact, so the JSON envelope every other
        // agent returns would be the wrong shape — and the chain must not reject
        // prose for lacking it.
        task: "Write the two sections now, exactly as described. No JSON, no envelope, no code fences.",
        expectJson: false,
        tools: [],
      })
    )
  );

  const { story, week: weekProse } = splitReport(narrative);

  if (story) {
    writeStory(`${story}\n`);
  } else {
    log("warn", "Weekly report: no story produced — leaving Story unchanged.");
  }

  const title = `Week of ${daysAgo(7)} — ${week.shipped.length} shipped`;
  const number = fileDigest(title, renderDigest(week, weekProse, milestone));
  if (number) log("info", `Weekly report: digest filed as #${number}.`);
  return number;
}

/**
 * Split the one response into its two destinations.
 *
 * The prompt asks for both under fixed headings. When a model ignores that, the
 * whole answer becomes the Story and the digest falls back to the ticket list —
 * losing the prose is better than publishing the wrong half to both pages.
 */
export function splitReport(text) {
  const marker = /^##\s*This week\s*$/im;
  const match = text.match(marker);
  if (!match) return { story: text, week: null };
  const index = text.indexOf(match[0]);
  return {
    story: text.slice(0, index).trim(),
    week: text.slice(index + match[0].length).trim(),
  };
}
