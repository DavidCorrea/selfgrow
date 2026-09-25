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
import { log, withLogGroup } from "./log.mjs";
import { findDiscussion, postDiscussion } from "./discussions.mjs";
// readPage reaches the Story, which now carries the project's long arc so the
// changelog can be trimmed without amputating its early chapters.
import { readChangelog, readPage, trimSections, writeStory } from "./wiki.mjs";
import {
  loadPrompt,
  fillTemplate,
  runAgent,
  isBlocked,
  isPlaytestFeedback,
  isManualIssue,
} from "./shared.mjs";

// Who the digest @-mentions. Without it the issue is still filed, just silently.
const NOTIFY_USER = process.env.GH_NOTIFY_USER || "";

const daysAgo = (n, now = Date.now()) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);

/** The first day of the week a report written at `now` covers — the week's key. */
export const digestWeekStart = (now = new Date()) => daysAgo(7, now.getTime());

// The part of a digest's title that names its week, and nothing that can change
// between two runs on the same day. The shipped count is deliberately after it:
// the week of 08-30 was posted three times, by three Sunday runs whose counts
// could differ, and a lookup on the whole title would miss every earlier post.
export const digestTitlePrefix = (weekStart) => `Week of ${weekStart} —`;

export const digestTitle = (weekStart, shippedCount) => `${digestTitlePrefix(weekStart)} ${shippedCount} shipped`;

// How much changelog the report reads. The Story carries the arc, so the report
// only needs enough recent history to see this week against the one before it —
// two weeks of dated sections. It used to read the page whole: the 45 days the
// page keeps grew from 5 KB to 17 KB over the three Sundays in which the session
// went from answering in 25 seconds to hitting the 12-minute cap on its first turn.
const REPORT_CHANGELOG_DAYS = Number(process.env.REPORT_CHANGELOG_DAYS || 14);

/** The recent end of the changelog — the part the report actually needs. */
export const reportChangelog = (changelog) => trimSections(changelog, REPORT_CHANGELOG_DAYS);

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
export function gatherWeek({ shipped, open }) {
  const since = daysAgo(7);
  const shippedThisWeek = shipped.filter((i) => (i.closedAt || "") >= since);
  return {
    shipped: shippedThisWeek,
    parked: open.filter(isBlocked),
    playtest: open.filter(isPlaytestFeedback),
    // What the reader themselves asked for, and what became of it. Everything
    // else in this report is the pipeline talking about its own work; this is the
    // only part that answers "what happened to the thing I filed?".
    yours: {
      shipped: shippedThisWeek.filter(isManualIssue),
      open: open.filter((i) => isManualIssue(i) && !isBlocked(i)),
      parked: open.filter((i) => isManualIssue(i) && isBlocked(i)),
    },
    openCount: open.length,
  };
}

/** The digest body: what shipped, what was heard, where things stand. */
export function renderDigest(week, narrative, milestone) {
  const mention = NOTIFY_USER
    ? `${NOTIFY_USER.startsWith("@") ? NOTIFY_USER : `@${NOTIFY_USER}`} — this week in the product.\n`
    : "";
  const lines = [mention, "## What shipped", narrative || "_(nothing shipped this week)_", ""];

  const yours = week.yours || { shipped: [], open: [], parked: [] };
  if (yours.shipped.length || yours.open.length || yours.parked.length) {
    lines.push("## What you asked for");
    yours.shipped.forEach((i) => lines.push(`- **Shipped** — ${i.title} (#${i.number})`));
    yours.parked.forEach((i) => lines.push(`- **Stuck** — ${i.title} (#${i.number}), parked after repeated failures`));
    yours.open.forEach((i) => lines.push(`- Still queued — ${i.title} (#${i.number})`));
    lines.push("");
  }

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
    `Shipped this week: ${week.shipped.length} · Open tickets: ${week.openCount}`,
    milestone ? `Current milestone: **${milestone.title}**` : "",
    "",
    "_Filed by the Product Manager. Nothing here needs a reply — the pipeline runs itself._"
  );
  return lines.filter((line) => line !== "").join("\n");
}

// Where the digest is published. Announcements is the category for a maintainer
// telling everyone what happened, which is exactly what this is.
const DIGEST_CATEGORY = process.env.DIGEST_CATEGORY || "Announcements";

/**
 * Write the Story page and file the week's digest.
 *
 * One model session for both: the narrative it produces is the body of the
 * digest's "what shipped" section as well as the Story page, and asking
 * twice would pay twice for the same paragraphs.
 *
 * Throws when the report cannot be made, rather than logging and returning:
 * it failed silently for two Sundays running — a capped session logged a
 * warning, the run went green, and nothing noticed the digest had stopped.
 */
export async function publishWeeklyReport({ shipped, open, milestone, now = new Date() }) {
  const weekStart = digestWeekStart(now);
  // Checked BEFORE the model runs, and the whole report skipped rather than just
  // the post: a re-run on the same Sunday would otherwise pay for a second
  // session and evolve the Story twice from one week. A lookup that fails throws
  // — "not found" is an instruction to post, so guessing would duplicate.
  const existing = findDiscussion(DIGEST_CATEGORY, digestTitlePrefix(weekStart));
  if (existing) {
    log("info", `Weekly report: the week of ${weekStart} is already published at ${existing.url} — not posting it again.`);
    return existing.url;
  }

  const week = gatherWeek({ shipped, open });

  const narrative = cleanMarkdown(
    await withLogGroup("Weekly report", () =>
      runAgent({
        label: "Weekly report",
        systemPrompt: fillTemplate(loadPrompt("weekly-report"), {
          // The Story carries the arc; the changelog only has to carry what is
          // recent. That split is what lets the changelog be trimmed at all —
          // regenerating the whole history from a trimmed record would quietly
          // amputate the project's early chapters every time the window moved.
          STORY_SO_FAR: readPage("Story.md").trim() || "(nothing written yet — this is the first)",
          CHANGELOG: reportChangelog(readChangelog()),
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
  if (!narrative) throw new Error(`Weekly report: the model returned nothing for the week of ${weekStart}.`);

  const { story, week: weekProse } = splitReport(narrative);

  if (story) {
    writeStory(`${story}\n`);
  } else {
    log("warn", "Weekly report: no story produced — leaving Story unchanged.");
  }

  const url = postDiscussion({
    category: DIGEST_CATEGORY,
    title: digestTitle(weekStart, week.shipped.length),
    body: renderDigest(week, weekProse, milestone),
  });
  if (!url) throw new Error(`Weekly report: the digest for the week of ${weekStart} could not be posted to ${DIGEST_CATEGORY}.`);
  log("info", `Weekly report: published at ${url}`);
  return url;
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
