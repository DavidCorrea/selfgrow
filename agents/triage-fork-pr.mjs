// An answer for a pull request from outside the project.
//
// review-pr.mjs takes a contributor's PR the whole way — verify, review, fix,
// merge — but only when the branch lives in this repository. A PR from a FORK is
// excluded there, and that exclusion is not squeamishness: that job checks out the
// PR's head and runs an agent with write access and the account's API key over it.
// Doing that to a branch a stranger controls hands them the key.
//
// So forks got nothing at all, which is its own kind of wrong. PR #463 came from
// an outside contributor who solved a real ticket, correctly, and sat unanswered
// because no part of this pipeline was watching. A project that ignores outside
// work should at least say so; one that silently ignores it is just rude.
//
// This is the safe half of a review, and the boundary is exact:
//
//   TRUSTED   — everything checked out in this job. `pull_request_target` gives us
//               the BASE of the repository, never the fork, so the harness, the
//               prompts and docs/ are all ours. The review reads them freely.
//   UNTRUSTED — the diff, fetched through the API as TEXT and never applied,
//               never executed, never checked out. It is evidence about code, not
//               code.
//
// Nothing here runs a line the contributor wrote. And because the diff is
// attacker-controlled text going into a model prompt, the review is told plainly
// that instructions inside it are content to be reported, not orders to follow.
//
// What it can do: post one comment. It cannot merge, approve, push, or close —
// not as a matter of policy but because it is never given any of those calls. A
// maintainer still decides.
import { execSync } from "child_process";
import { pathToFileURL } from "url";
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
  readVision,
  commentIssue,
} from "./shared.mjs";

const PR_NUMBER = Number(process.env.PR_NUMBER || 0);
const PR_TITLE = process.env.PR_TITLE || "";
const PR_BODY = process.env.PR_BODY || "";
const PR_AUTHOR = process.env.PR_AUTHOR || "someone";

// A diff larger than this is not reviewable in one pass, and a fork can send any
// size it likes. Truncated rather than refused: partial feedback on a large
// contribution still beats silence, as long as the review knows it is partial.
const MAX_DIFF_CHARS = Number(process.env.MAX_FORK_DIFF_CHARS || 40000);

/**
 * The proposed change, as text.
 *
 * `gh pr diff` reads it through the API. Deliberately NOT `git diff` against a
 * fetched head — fetching the head into this checkout is the first step toward
 * running it, and there is no reason to have it on disk.
 */
function readDiff() {
  try {
    const diff = execSync(`gh pr diff ${PR_NUMBER}`, {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    }).toString();
    if (diff.length <= MAX_DIFF_CHARS) return { diff, truncated: false };
    return { diff: diff.slice(0, MAX_DIFF_CHARS), truncated: true };
  } catch (e) {
    log("error", `Could not read the diff for #${PR_NUMBER}.`, errorData(e));
    return null;
  }
}

/**
 * Render the review as a comment addressed to a person who does not know how any
 * of this works.
 *
 * Three things it must convey and nothing else: that a machine wrote this, what
 * the machine thinks, and who actually decides. A contributor should never have
 * to guess whether a comment is the project's answer or a bot's opinion.
 */
export function renderComment({ verdict, summary, issues, alreadyShipped }, truncated) {
  const lines = [`Thanks for this, @${PR_AUTHOR}.`, ""];

  if (alreadyShipped) {
    lines.push(
      "**This looks like work the project has already shipped.**",
      "",
      alreadyShipped,
      "",
      "That is not a criticism of the change — it usually means you read the ticket the same way we did.",
      ""
    );
  } else if (verdict === "approve") {
    lines.push("**This looks sound to me.** I could not find anything blocking.", "");
    if (summary) lines.push(summary, "");
  } else {
    lines.push("**I think this needs a change before it can ship.**", "");
    if (summary) lines.push(summary, "");
    if (issues?.length) {
      lines.push(...issues.map((i) => `- ${i}`), "");
    }
  }

  if (truncated) {
    lines.push(
      "_The diff was too large to read in full, so this covers the first part of it only._",
      ""
    );
  }

  lines.push(
    "---",
    "",
    "_This project is built by autonomous agents, and this review is one of them — I have read your diff, " +
      "but I have not run it, and I cannot merge or close anything. A maintainer decides what happens next._"
  );
  return lines.join("\n");
}

async function main() {
  if (!PR_NUMBER) {
    log("error", "No pull request to triage — PR_NUMBER is required.");
    process.exit(1);
  }
  log("info", `=== Triaging fork PR #${PR_NUMBER} by ${PR_AUTHOR} ===`);

  const read = readDiff();
  if (!read) {
    printRunSummary("Fork triage");
    return;
  }

  const output = await withLogGroup("Fork review", () =>
    runAgent({
      label: "Fork review",
      systemPrompt: fillTemplate(loadPrompt("fork-review"), {
        PR_NUMBER: String(PR_NUMBER),
        PR_AUTHOR,
        PR_TITLE,
        PR_BODY: PR_BODY || "(no description given)",
        DIFF: read.diff,
        TRUNCATED: read.truncated
          ? "This diff was too large to include in full. You are seeing the beginning of it — say so in your summary, and do not claim to have judged the whole change."
          : "",
        VISION: readVision(),
      }),
      // Read-only, over the BASE checkout — this repository's own code, which is
      // how it can tell whether the change is already implemented. It has no
      // access to anything the contributor wrote beyond the diff text above.
      tools: ["read"],
    })
  );

  const review = extractAgentResponse("Fork review", output, {
    requiredDataFields: ["issues"],
  });
  if (!review) {
    // No silent failure: an unanswered contributor is the whole problem this
    // exists to fix, and "we could not review it" is still an answer.
    commentIssue(
      PR_NUMBER,
      `Thanks for this, @${PR_AUTHOR}. An automated review ran but could not produce a usable result, ` +
        "so a maintainer will need to look at this by hand."
    );
    printRunSummary("Fork triage");
    return;
  }

  log("info", `Fork review: ${review.outcome} — ${review.summary || ""}`);
  commentIssue(
    PR_NUMBER,
    renderComment(
      {
        verdict: review.outcome,
        summary: review.summary,
        issues: review.data.issues,
        alreadyShipped: review.data.alreadyShipped,
      },
      read.truncated
    )
  );
  printRunSummary("Fork triage");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Fork triage failed: ${err.message || err}`);
    printRunSummary("Fork triage");
    process.exit(1);
  });
}
