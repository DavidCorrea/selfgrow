// PRODUCT OWNER — direction, and the weekly look back that informs it.
//
// Two jobs that are really one. The retro asks what the last week actually
// amounted to; the Vision and the milestone are what that answer changes. They
// were going to be separate agents until the obvious hit: judging the week in
// order to decide where to point next is not a new ritual, it is what a Product
// Owner reading the board was always supposed to be doing.
//
// The retro is also the only place the pipeline learns about ITSELF at the level
// of a week. Post-mortems record why one ticket failed and are read by the Scout
// before it plans; this records what a run of tickets adds up to, and is read
// here, next week, before direction is set again.
import { execSync } from "child_process";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  extractAgentResponse,
  errorData,
  repoRoot,
  getBoardSnapshot,
  readVision,
  commitToWiki,
  getCurrentMilestone,
  startMilestone,
  isBlocked,
  isPlaytestFeedback,
  fetchOpenIssues,
} from "./shared.mjs";
import {
  readJournal,
  appendJournal,
  renderJournalEntry,
  readLessonThreads,
  renderLessonThreads,
  readDecisions,
  renderDecisions,
} from "./discussions.mjs";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * The week as it actually went, from what the pipeline wrote down: what shipped,
 * what got stuck, what the Playtester noticed. This is the retro's evidence, and
 * it is counted rather than recalled.
 */
function readWeek() {
  let closed = [];
  try {
    closed = JSON.parse(
      execSync(`gh issue list --state closed --limit 200 --json number,title,closedAt`, {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      }).toString()
    );
  } catch (e) {
    log("warn", "Could not read what shipped this week.", errorData(e));
  }
  const open = fetchOpenIssues(200);
  const since = daysAgo(7);
  return {
    shipped: closed.filter((i) => (i.closedAt || "") >= since),
    parked: open.filter(isBlocked),
    playtest: open.filter(isPlaytestFeedback),
  };
}

function renderWeek({ shipped, parked, playtest }) {
  const section = (title, items, empty) =>
    `### ${title}\n${items.length ? items.map((i) => `- #${i.number} ${i.title}`).join("\n") : empty}`;
  return [
    section("Shipped this week", shipped, "(nothing shipped)"),
    section("Parked — the Devs gave up after repeated failures", parked, "(nothing parked)"),
    section("What the Playtester noticed, still untriaged", playtest, "(nothing outstanding)"),
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Apply a refinement to the canonical Vision page (in the wiki)
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyRefinement(parsed) {
  if (!parsed || parsed.outcome === "skip") {
    return { changed: false, reason: parsed?.summary || "No refinement needed." };
  }

  const { action, section, content, oldText } = parsed.data;
  const summary = parsed.summary;

  if (!section || !action || !content || !summary) {
    log("warn", "Missing required fields in Product Owner output.", { parsed: parsed.data });
    return null;
  }

  return {
    summary,
    // Pure: takes the Vision as it is on the remote right now and returns what it
    // should become, or null when the edit no longer applies. commitToWiki may
    // call this several times, once per push attempt.
    refine(current) {
      if (!current.trim()) {
        log("warn", "Vision.md is empty in the wiki (seed it first).");
        return null;
      }
      if (action === "append") {
        const sectionRegex = new RegExp(`(${escapeRegex(section)}[\\s\\S]*?)(?=\\n## |$)`, "i");
        if (!sectionRegex.test(current)) {
          log("warn", `Section "${section}" not found in Vision.`);
          return null;
        }
        return current.replace(sectionRegex, (fullMatch) => fullMatch.trimEnd() + "\n\n" + content + "\n");
      }
      if (action === "refine") {
        if (!oldText) {
          log("warn", "Refine action requires oldText.");
          return null;
        }
        if (!current.includes(oldText)) {
          log("warn", "oldText not found in Vision.");
          return null;
        }
        return current.replace(oldText, content);
      }
      log("warn", `Unknown action: ${action}`);
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Main — steward the vision (canonical in the wiki); the PM owns the backlog
// ---------------------------------------------------------------------------

// The thread this role remembers itself in.
const JOURNAL = "Product Owner — log";

/**
 * Write down the direction and the reason for it.
 *
 * Terse on purpose: three lines a future run can skim, not a narrative it will
 * read its own voice back out of. `milestone` is the one that was RUNNING when
 * this decided, so an entry says what changed rather than only what is true.
 */
function recordDecision(data, previousMilestone) {
  const chosen = data.milestone?.title;
  appendJournal(
    JOURNAL,
    renderJournalEntry({
      decided: chosen
        ? `Milestone: ${chosen}${previousMilestone && previousMilestone.title !== chosen ? ` (was "${previousMilestone.title}")` : ""}`
        : `Milestone unchanged${previousMilestone ? `: ${previousMilestone.title}` : " — none set"}`,
      because: data.milestone?.description || data.retro?.title || "",
      deferred: data.deferred || "",
    })
  );
}

async function main() {
  log("info", "=== Product Owner — the week, the direction ===");

  const { boardState } = getBoardSnapshot();
  const vision = readVision();
  if (vision.startsWith("(Vision unavailable")) {
    log("error", "Wiki not reachable / not seeded — skipping the review.");
    printRunSummary("Product Owner");
    return;
  }

  const week = readWeek();
  const milestone = getCurrentMilestone();
  // Its own past reasoning. The Vision and the milestone record what was decided;
  // nothing recorded WHY, so each Monday used to re-argue the same direction from
  // scratch and could contradict last week without noticing.
  const past = readJournal(JOURNAL);
  log("info", `Reviewing a week of ${week.shipped.length} shipped, ${week.parked.length} parked.`);

  const rawOutput = await withLogGroup("Product Owner", () =>
    runAgent({
      label: "Product Owner",
      systemPrompt: fillTemplate(loadPrompt("product-owner"), {
        VISION: vision,
        BOARD_STATE: boardState,
        WEEK: renderWeek(week),
        // Most-recurrent first, the same ordering the Scout reads.
        LESSONS: (() => {
          const threads = readLessonThreads();
          return threads.length ? renderLessonThreads(threads) : "(nothing recorded yet)";
        })(),
        PAST: past.length ? past.join("\n\n") : "(nothing recorded yet — this is the first)",
        // What the project has already settled. This role changes direction, so it
        // is the one most able to undo a decision without realising there was one.
        DECISIONS: (() => {
          const decisions = readDecisions();
          return decisions.length ? renderDecisions(decisions) : "(nothing settled yet)";
        })(),
        MILESTONE: milestone
          ? `**${milestone.title}** — ${milestone.description || "no description"} (${milestone.closed} shipped, ${milestone.open} still open)`
          : "(none set — this is the first)",
      }),
    })
  );

  const parsed = extractAgentResponse("Product Owner", rawOutput, {});
  if (!parsed) {
    printRunSummary("Product Owner");
    return;
  }
  const data = parsed.data || {};

  // 1. The retro, into this role's OWN journal — not the Lessons page.
  //
  //    It used to go to Lessons, which is titled "what the agents have tried and
  //    abandoned, and why" and is read by every Scout before planning. A retro is
  //    not that: it is a weekly narrative of what shipped, and because retros are
  //    weekly and parked tickets are rare, they crowded the actual failures out
  //    entirely. The Scout was reading two cheerful summaries ending "Nothing
  //    parked" as its dead-end context.
  //
  //    Recorded first and unconditionally either way: it is this run's most durable
  //    output and what next week reads before deciding. A skipped Vision change is
  //    not a reason to skip the record.
  if (data.retro?.title && data.retro?.body) {
    appendJournal(
      JOURNAL,
      renderJournalEntry({
        decided: `Retro — ${data.retro.title}`,
        because: data.retro.body,
      })
    );
  } else {
    log("warn", "Product Owner: no retro produced this week.");
  }

  // 2. The milestone. What the project is trying to do next; the Product Manager
  //    grooms against it every morning.
  if (data.milestone?.title) {
    startMilestone(data.milestone.title, data.milestone.description);
  } else if (!milestone) {
    log("warn", "Product Owner: no milestone set, and none was running.");
  }

  // 3. The decision, in this role's own journal — before the Vision step, because
  //    that step returns early most weeks and the record must not depend on it.
  //    Same reasoning as the retro above: this is what next Monday reads first.
  recordDecision(data, milestone);

  // 4. The Vision, which most weeks should not move at all.
  if (parsed.outcome === "skip") {
    log("info", `Product Owner: vision unchanged. ${parsed.summary || ""}`);
    printRunSummary("Product Owner");
    return;
  }
  const refinement = applyRefinement(parsed);
  if (refinement && commitToWiki("Vision.md", refinement.refine, refinement.summary)) {
    log("info", `Product Owner: ${refinement.summary}`);
  }
  printRunSummary("Product Owner");
}

main().catch((err) => {
  log("error", `Product Owner failed: ${err.message || err}`);
  printRunSummary("Product Owner");
  process.exit(1);
});
