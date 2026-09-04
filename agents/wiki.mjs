// The wiki — the pipeline's long-term memory.
//
// Three pages, each owned by a different agent: Vision (the Product Owner),
// Changelog and Story (the Product Manager). It is a separate
// git repo, which is what makes it usable here: writing to it triggers no workflow
// and touches no branch the Devs are merging.
//
// EVERY WRITE IS A RETRIED READ-MODIFY-WRITE against the live remote, because
// sibling jobs write these pages concurrently — the request ledger used to push to
// this same repo after every single agent session, which is how the race was found
// in the first place. It is gone; the discipline stays, because two agents still
// finish inside the same second often enough. The old write path — edit the working tree, then `add; commit; push` with no fetch and
// no retry — lost that race on every merge for three days and dropped ~100
// changelog entries on the floor. It caught the rejection, logged a *warning*,
// and the run reported success; the Scribe then had nothing to write from and
// nobody noticed.
//
// So a caller never edits the clone directly. It hands `commitToWiki` a function
// from the page's current content to its next content, and that function is
// re-run against freshly fetched content on every attempt. Two consequences worth
// knowing:
//   - A mutation must be pure and idempotent-ish. It may run several times.
//   - Nothing may be left uncommitted in the clone between calls, because each
//     attempt hard-resets it. The API makes that impossible to get wrong: there
//     is no way to write to a page except through a mutation.
import { execSync } from "child_process";
import fs from "fs";
import { join } from "path";
import { log, errorData } from "./log.mjs";

const DEFAULT_WIKI_DIR = "/tmp/selfgrow-wiki";

// Attempts for one page write. A push loses to a sibling only when that sibling
// pushed between our fetch and our push — a window of milliseconds — so a
// handful of retries covers a very busy remote.
const PUSH_ATTEMPTS = 5;

/**
 * Clone the wiki into `dir`, replacing whatever was there.
 *
 * Returns the directory, or null when the wiki cannot be reached — every caller
 * degrades rather than failing, because a missing wiki must never stop a build.
 */
export function cloneWiki(dir = DEFAULT_WIKI_DIR, { cwd = process.cwd() } = {}) {
  try {
    const repo = JSON.parse(
      execSync("gh repo view --json nameWithOwner", { cwd, maxBuffer: 10 * 1024 * 1024 }).toString()
    ).nameWithOwner;
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
    const url = `https://x-access-token:${token}@github.com/${repo}.wiki.git`;
    execSync(`rm -rf "${dir}" && git clone "${url}" "${dir}"`, { cwd, maxBuffer: 10 * 1024 * 1024 });
    execSync(`git -C "${dir}" config user.name "github-actions[bot]"`, { maxBuffer: 10 * 1024 * 1024 });
    execSync(`git -C "${dir}" config user.email "github-actions[bot]@users.noreply.github.com"`, { maxBuffer: 10 * 1024 * 1024 });
    log("info", `Wiki: cloned ${repo}.wiki.`);
    return dir;
  } catch (e) {
    // Report what actually broke. This used to blame an uninitialized wiki
    // whatever the cause, which sent a reader to enable a wiki that was already
    // enabled while the real fault — usually a spent API rate limit — sat
    // unread in the stack dump underneath.
    const detail = String(e?.message || e);
    let cause = "is the wiki enabled and initialized (create one page in the UI first)?";
    if (/rate limit/i.test(detail)) {
      cause = "the GitHub API rate limit is spent — this is temporary, and the wiki is fine. Check `gh api rate_limit`.";
    } else if (/Authentication failed|Invalid username or token|could not read Username/i.test(detail)) {
      cause = "the token cannot push to the wiki — check GH_TOKEN, and note the wiki is a SEPARATE repo from the code.";
    } else if (/not found|Could not resolve/i.test(detail)) {
      cause = "the wiki repo could not be found — is the wiki enabled and initialized (create one page in the UI first)?";
    }
    log("warn", `Wiki: clone failed — ${cause}`, errorData(e));
    return null;
  }
}

// One clone per process, shared by every page read and write.
let _wikiDir;
export function getWikiDir() {
  if (_wikiDir !== undefined) return _wikiDir;
  _wikiDir = cloneWiki() || null;
  return _wikiDir;
}

/** Absolute path to a page inside the cloned wiki, or null if unreachable. */
export function wikiPath(pageFile) {
  const dir = getWikiDir();
  return dir ? join(dir, pageFile) : null;
}

/** A page's current content, or "" when the page or the wiki is missing. */
export function readPage(pageFile) {
  const path = wikiPath(pageFile);
  if (!path) return "";
  try {
    return fs.readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function git(dir, args) {
  return execSync(`git -C "${dir}" ${args}`, { maxBuffer: 10 * 1024 * 1024, stdio: "pipe" });
}

function currentBranch(dir) {
  try {
    // GitHub wikis are still `master`; read it rather than assume it.
    return git(dir, "rev-parse --abbrev-ref HEAD").toString().trim() || "master";
  } catch {
    return "master";
  }
}

/**
 * Apply `mutate` to one wiki page and push the result, retrying against the live
 * remote until it lands.
 *
 * @param {string} pageFile        e.g. "Changelog.md"
 * @param {(current: string) => string|null} mutate
 *        The page's next content, given whatever is on the remote right now.
 *        Return null to abandon the write (nothing to say, already recorded).
 *        Called once per attempt, so it must not depend on outside mutable state.
 * @param {string} message         commit message
 * @returns {boolean} whether the change is now on the remote
 */
export function commitToWiki(pageFile, mutate, message) {
  const dir = getWikiDir();
  if (!dir) {
    log("error", `Wiki: cannot write ${pageFile} — the wiki is unreachable, so this change is LOST.`);
    return false;
  }
  const branch = currentBranch(dir);
  const path = join(dir, pageFile);
  let lastErr;

  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      // Start from the remote every time. A previous attempt may have left a
      // local commit that lost its race, and a sibling has almost certainly
      // pushed since we cloned.
      git(dir, "fetch --quiet origin");
      git(dir, `reset --hard --quiet origin/${branch}`);

      let current = "";
      try {
        current = fs.readFileSync(path, "utf-8");
      } catch { /* the page does not exist yet */ }

      const next = mutate(current);
      if (next === null || next === undefined) return true; // nothing to write
      if (next === current) return true; // already recorded by someone else

      fs.writeFileSync(path, next, "utf-8");
      git(dir, `add "${pageFile}"`);
      git(dir, `commit -q -m "${String(message).replace(/"/g, '\\"')}"`);
      git(dir, "push --quiet");
      log("info", `Wiki: updated ${pageFile}.`);
      return true;
    } catch (e) {
      lastErr = e;
    }
  }

  // Loud, and an error rather than a warning. A dropped wiki write is invisible
  // in every other way — the run still succeeds, the ticket still merges, and the
  // page just quietly stops growing.
  log(
    "error",
    `Wiki: could not write ${pageFile} after ${PUSH_ATTEMPTS} attempts — this change is LOST. ` +
      "Whatever reads this page will be working from stale content.",
    errorData(lastErr)
  );
  return false;
}

// ---------------------------------------------------------------------------
// The pages
//
// Each write below is a pure function of the page's current content, so it can be
// replayed safely by commitToWiki's retry loop. They are also exported bare, for
// tests: the interesting behaviour is the text transformation, not the git.
// ---------------------------------------------------------------------------

const VISION_PAGE = "Vision.md";
const CHANGELOG_PAGE = "Changelog.md";
const STORY_PAGE = "Story.md";

/** The Vision, or a placeholder that reads as missing rather than as empty. */
export function readVision() {
  return readPage(VISION_PAGE) || "(Vision unavailable — wiki not reachable or not yet seeded)";
}

export function readChangelog() {
  return readPage(CHANGELOG_PAGE) || "(no changelog yet)";
}

const today = () => new Date().toISOString().slice(0, 10);

// How much of the changelog survives.
//
// It is read WHOLE into the weekly report, so untrimmed it grew without bound into
// a fixed context, degrading silently the way an untrimmed source dump does. So it
// is trimmed: keep what is still useful, drop what has aged out of relevance.
//
// Days are the natural unit for a dated record. The long arc the changelog
// used to be the only source for now lives in Story.md, which the weekly report
// evolves rather than regenerating from raw history.
const CHANGELOG_DAYS_KEPT = Number(process.env.CHANGELOG_DAYS_KEPT || 45);

/**
 * Drop all but the newest `keep` dated sections of a page.
 *
 * Sections are `## ...` headings; everything above the first one is the page's
 * title and intro and is always preserved. Exported for tests.
 */
export function trimSections(content, keep) {
  const first = content.indexOf("\n## ");
  if (first === -1) return content;
  const head = content.slice(0, first + 1);
  const sections = content.slice(first + 1).split(/(?=^## )/m).filter((s) => s.trim());
  if (sections.length <= keep) return content;
  return head + sections.slice(0, keep).join("");
}

/** Add one entry under today's date, newest day first. Exported for tests. */
export function withChangelogEntry(content, entry, date = today()) {
  const header = `## ${date}`;
  const bullet = `- ${String(entry).trim()}`;
  if (!content.trim()) return `# Changelog\n\n${header}\n\n${bullet}\n`;
  // Already recorded — a retry that lost its race and came back, or two agents
  // reporting the same merge. Writing it twice is worse than not writing it.
  if (content.includes(bullet)) return content;
  const withEntry = content.includes(header)
    ? content.replace(header, `${header}\n${bullet}`)
    : (() => {
        const title = content.match(/^# .*$/m);
        return title
          ? content.replace(title[0], `${title[0]}\n\n${header}\n\n${bullet}`)
          : `# Changelog\n\n${header}\n\n${bullet}\n\n${content}`;
      })();
  // One section per day, so the kept window is a number of days.
  return trimSections(withEntry, CHANGELOG_DAYS_KEPT);
}

/** Record what shipped. Returns whether it reached the remote. */
export function appendChangelogEntry(entry, message = "Changelog") {
  return commitToWiki(CHANGELOG_PAGE, (current) => withChangelogEntry(current, entry), message);
}

/** Replace a page wholesale — the Story and the Vision are authored, not appended. */
export function writePage(pageFile, content, message) {
  return commitToWiki(pageFile, () => content, message);
}

export function writeStory(content) {
  return writePage(STORY_PAGE, content, "Story: refresh the narrative");
}
