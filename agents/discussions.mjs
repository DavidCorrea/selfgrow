// GitHub Discussions — where the pipeline talks to a person.
//
// Two things it publishes are not work and never become work: the weekly digest,
// and a health alert. Both were issues, because an issue was the only primitive
// reached for. Both were wrong in the same way.
//
// The digest was created and closed in the same breath, which is a broadcast
// wearing a task's clothes: the close existed only to stop an open issue
// addressed to a human from looking like a human on the critical path. And a
// health alert describes the PIPELINE, which nothing in docs/ can fix — the Devs
// picked one up and tried to build it, which is why isBuildable has to know about
// labels that mean "not actually a request".
//
// A discussion is the primitive both wanted: a post, not a task. It carries no
// board card, no priority, nothing the Devs will ever pick up, and — unlike the
// issue-then-close trick — it still has an open/closed state, so an alert can
// clear itself when the thing it reported is fixed.
//
// It is also where the pipeline remembers things, which is the second job this
// module grew into. A wiki page is a blob that must be read and rewritten whole,
// and that single fact is why Lessons is capped at 20 entries and the Changelog
// at 30 days: both are read whole into prompts, so the only way to bound the
// context was to DELETE history — forgetting by recency rather than by relevance.
//
// A discussion is the shape that fixes it: the body is the current summary, the
// comments are an append-only log. Appending is atomic, so nothing needs the
// retried read-modify-write the wiki does; the thread can grow forever; and a
// reader takes the LAST FEW comments rather than the whole page. Context is
// bounded by selection instead of by deletion.
//
// Everything the pipeline posts is LOCKED. Locking leaves a discussion publicly
// readable and restricts new comments to accounts with write access — verified
// against the live API, including that the agents themselves can still append.
// Pipeline memory therefore cannot be forged or argued with by a stranger, which
// matters because agents read it back as guidance and hold a key to main. One
// category is deliberately left unlocked as the inbound channel; see
// isTrustedAuthor for how what arrives there is treated.
//
// Discussions are GraphQL-only. Everything below is a thin wrapper over one
// mutation or query, and every string that could contain model-written text is
// passed as a VARIABLE rather than interpolated into the document.
import { execFileSync } from "child_process";
import { log, errorData } from "./log.mjs";
import { repoRoot } from "./shared.mjs";

const OWNER = process.env.GITHUB_REPOSITORY_OWNER || "";

/**
 * Run one GraphQL document with variables.
 *
 * execFileSync, not execSync, and that is not a style preference. A GraphQL
 * document is full of `$variable` declarations, and passing one through a shell
 * lets the shell expand them first — `query($owner: String!)` arrives at GitHub as
 * `query(: String!)` and is rejected with a parse error that names a colon and
 * explains nothing. Passing argv directly means no shell, so no expansion, and
 * no quoting rules to get wrong on a body a model wrote.
 */
function graphql(query, variables = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    // -F types its value (123, true, null); -f keeps it a string. The choice is
    // per-variable and not cosmetic: a GraphQL `Int!` passed with -f is rejected
    // as "provided invalid value", and every wrapper here catches its own errors,
    // so the query silently returns nothing instead of failing loudly. That is
    // exactly how the first version of readJournal came out empty every time
    // while the writes it was meant to read were landing perfectly.
    //
    // Strings keep -f deliberately. -F would coerce a body that happens to read
    // like a number or `true` into the wrong type, and these bodies are written
    // by models.
    args.push(typeof value === "number" || typeof value === "boolean" ? "-F" : "-f", `${key}=${value}`);
  }
  return JSON.parse(
    execFileSync("gh", args, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString()
  );
}

/** The repository and the category to post in, resolved together. */
function resolveTarget(categoryName) {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.includes("/") ? repo.split("/") : [OWNER, ""];
  const result = graphql(
    `query($owner: String!, $name: String!) {
       repository(owner: $owner, name: $name) {
         id
         discussionCategories(first: 25) { nodes { id name } }
       }
     }`,
    { owner, name }
  );
  const repository = result?.data?.repository;
  if (!repository) return null;
  const category = repository.discussionCategories.nodes.find((c) => c.name === categoryName);
  if (!category) {
    log("warn", `Discussions: no "${categoryName}" category in this repository.`);
    return null;
  }
  return { repositoryId: repository.id, categoryId: category.id };
}

/**
 * Whose words may be read as GUIDANCE rather than as data.
 *
 * The inbound category is unlocked on purpose — it is how a person contributes a
 * thought without it becoming a ticket. That makes it an untrusted input to agents
 * that write to main and hold an API key, which is the same risk triage-fork-pr
 * already refuses to take with a stranger's branch.
 *
 * So trust is by write access and nothing else. Everything from anyone else is
 * still worth reading — it is why the channel exists — but it is quoted into a
 * prompt as somebody's opinion, never as an instruction.
 */
export function isTrustedAuthor(authorAssociation) {
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(String(authorAssociation || ""));
}

/**
 * Whether a discussion is the pipeline's own thread, and not one wearing its name.
 *
 * Both lookups in this module find a thread by CATEGORY + TITLE PREFIX, which is
 * enough only for as long as nobody else can create a discussion in that
 * category. That is true today — Journals, Lessons and Decisions are Announcement
 * categories, where only maintainers may post — but it is a repo SETTING, not
 * something this code can see: the API exposes no field for it, so a category
 * quietly switched to open-ended would let a stranger publish `Playtester — log`
 * and have the agents read it as their own memory, then append to it.
 *
 * So authorship is checked here too. A mis-set category degrades to "the journal
 * cannot be found" — an agent with no memory, which is how it already behaves on
 * a first run — rather than to an agent reading text a stranger wrote as its own
 * prior reasoning.
 */
export function isOwnThread(node, category, prefix) {
  if (!node || node.category?.name !== category) return false;
  if (!String(node.title || "").startsWith(prefix)) return false;
  return isTrustedAuthor(node.authorAssociation);
}

/**
 * Restrict new comments to accounts with write access, leaving the post publicly
 * readable. Best-effort: an unlocked memory post is worse than a locked one but
 * far better than no post, so a failure here never fails the write before it.
 */
function lockDiscussion(discussionId) {
  try {
    graphql(
      `mutation($id: ID!) { lockLockable(input: {lockableId: $id}) { lockedRecord { locked } } }`,
      { id: discussionId }
    );
    return true;
  } catch (e) {
    log("warn", "Discussions: could not lock a post — it stays open to comments.", errorData(e));
    return false;
  }
}

/**
 * Post a discussion. Returns its URL, or null — never throws, because nothing
 * that publishes a report should be able to fail the run that produced it.
 *
 * Locked by default: see the header. Pass `lock: false` only for a post that is
 * meant to be replied to.
 */
export function postDiscussion({ category, title, body, lock = true }) {
  try {
    const target = resolveTarget(category);
    if (!target) return null;
    const result = graphql(
      `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
         createDiscussion(input: {
           repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body
         }) { discussion { id url number } }
       }`,
      { ...target, title, body }
    );
    const discussion = result?.data?.createDiscussion?.discussion;
    if (!discussion) {
      log("warn", "Discussions: the post was rejected.", { result });
      return null;
    }
    if (lock) lockDiscussion(discussion.id);
    log("info", `Discussions: posted ${discussion.url}${lock ? " (locked)" : ""}`);
    return discussion.url;
  } catch (e) {
    log("warn", `Discussions: could not post "${title}".`, errorData(e));
    return null;
  }
}

/**
 * The open discussion whose title starts with `prefix`, if there is one.
 *
 * This is how an alert avoids repeating itself: one open post per ongoing
 * problem, rather than a new one every day the problem persists.
 */
export function findOpenDiscussion(category, prefix) {
  try {
    const repo = process.env.GITHUB_REPOSITORY || "";
    const [owner, name] = repo.includes("/") ? repo.split("/") : [OWNER, ""];
    const result = graphql(
      `query($owner: String!, $name: String!) {
         repository(owner: $owner, name: $name) {
           discussions(first: 25, orderBy: {field: CREATED_AT, direction: DESC}) {
             nodes { id number title url closed authorAssociation category { name } }
           }
         }
       }`,
      { owner, name }
    );
    const nodes = result?.data?.repository?.discussions?.nodes || [];
    // Authorship matters here too: this is how the standing health alert finds
    // itself, and a thread it wrongly adopted would be one it then edits and
    // closes on somebody else's behalf.
    return nodes.find((d) => !d.closed && isOwnThread(d, category, prefix)) || null;
  } catch (e) {
    log("warn", "Discussions: could not read existing posts.", errorData(e));
    return null;
  }
}

/**
 * Close a discussion because what it reported is no longer true.
 *
 * The reason an alert has a lifecycle at all: a monitoring signal that cannot
 * clear itself becomes a stale page nobody trusts, and the health alert used to
 * be exactly that — filed once, never closed, and silently suppressing every
 * later alert for as long as it stayed open.
 */
export function resolveDiscussion(discussionId, comment) {
  try {
    if (comment) {
      graphql(
        `mutation($discussionId: ID!, $body: String!) {
           addDiscussionComment(input: {discussionId: $discussionId, body: $body}) { comment { id } }
         }`,
        { discussionId, body: comment }
      );
    }
    graphql(
      `mutation($discussionId: ID!) {
         closeDiscussion(input: {discussionId: $discussionId, reason: RESOLVED}) { discussion { number } }
       }`,
      { discussionId }
    );
    log("info", "Discussions: closed a resolved post.");
    return true;
  } catch (e) {
    log("warn", "Discussions: could not close a post.", errorData(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Journals — one long-lived thread per role, one comment per run.
//
// Agents are stateless: every run starts from a fresh checkout, so the Product
// Owner sets a milestone each Monday having forgotten why it set the last one,
// and the Tech Lead rules on parked tickets with no record of previous rulings.
// The wiki holds conclusions (the Vision, the Story) and not the reasoning behind
// them, so nothing stops a role contradicting itself week to week.
//
// A journal is the cheapest fix: find-or-create one thread per role, append one
// comment per run, read the last few before deciding. Deliberately NOT a category
// per role — categories are repo settings that no API can create, so they cannot
// be renamed or recreated when the team shape changes, and this pipeline has
// already deleted one role and merged another. Threads are cheap and disposable;
// categories are not.
//
// Two rules keep a journal from becoming a liability:
//
//   TERSE. An entry states what was decided, why, and what was deferred. Prose
//   invites an agent to read its own voice back and elaborate on it, which is how
//   confident drift happens with no external correction. The value is continuity
//   of DECISIONS, not of narration.
//
//   BOUNDED. A reader takes the last few entries, never the thread. Reading the
//   whole journal would rebuild the untrimmed wiki page this exists to replace —
//   the thread is allowed to grow forever precisely because nobody reads all of
//   it.
// ---------------------------------------------------------------------------

// Where journals live. Repo settings, so it cannot be created from here: when it
// is missing every journal call degrades to a warning and a no-op, which is the
// same way a missing wiki degrades rather than failing a run.
export const JOURNAL_CATEGORY = process.env.JOURNAL_CATEGORY || "Journals";

// How many past entries a reader gets. Three is enough to see a direction and a
// contradiction, and short enough that it cannot crowd out the run's real input.
const JOURNAL_TAIL = Number(process.env.JOURNAL_TAIL || 3);

/** Find a discussion by title prefix in a category, open or closed. */
function findDiscussion(category, prefix) {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.includes("/") ? repo.split("/") : [OWNER, ""];
  const result = graphql(
    `query($owner: String!, $name: String!) {
       repository(owner: $owner, name: $name) {
         discussions(first: 50, orderBy: {field: CREATED_AT, direction: DESC}) {
           nodes { id number title url authorAssociation category { name } }
         }
       }
     }`,
    { owner, name }
  );
  const nodes = result?.data?.repository?.discussions?.nodes || [];
  const mine = nodes.find((d) => isOwnThread(d, category, prefix)) || null;
  if (!mine) {
    // Say so when something is WEARING the name — a thread that matches but was
    // written by somebody else is either a mis-set category or an attempt to plant
    // memory, and both deserve more than silence.
    const impostor = nodes.find(
      (d) => d.category?.name === category && String(d.title || "").startsWith(prefix)
    );
    if (impostor) {
      log(
        "error",
        `Discussions: "${impostor.title}" in ${category} was not written by an account with write access ` +
          `(${impostor.authorAssociation}) — ignoring it. Check that ${category} is an Announcement category.`
      );
    }
  }
  return mine;
}

/**
 * The last few entries in a role's journal, oldest first, as plain strings.
 *
 * Returns [] for anything that is not there yet — a missing category, a first run
 * with no thread, an unreachable API. A journal is context, never a precondition:
 * no agent may fail because it could not remember.
 */
export function readJournal(title, { last = JOURNAL_TAIL } = {}) {
  try {
    const thread = findDiscussion(JOURNAL_CATEGORY, title);
    if (!thread) return [];
    const result = graphql(
      `query($number: Int!, $owner: String!, $name: String!, $last: Int!) {
         repository(owner: $owner, name: $name) {
           discussion(number: $number) {
             comments(last: $last) { nodes { body createdAt } }
           }
         }
       }`,
      {
        owner: (process.env.GITHUB_REPOSITORY || "").split("/")[0] || OWNER,
        name: (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "",
        // Numbers, so graphql() sends them typed — these are GraphQL Int!.
        number: Number(thread.number),
        last: Math.max(1, Number(last)),
      }
    );
    const nodes = result?.data?.repository?.discussion?.comments?.nodes || [];
    return nodes.map((c) => `[${(c.createdAt || "").slice(0, 10)}] ${(c.body || "").trim()}`);
  } catch (e) {
    log("warn", `Discussions: could not read the "${title}" journal — continuing without it.`, errorData(e));
    return [];
  }
}

/**
 * Append one entry to a role's journal, creating and locking the thread on first
 * use. Returns true when the entry landed.
 *
 * Best-effort throughout, for the same reason as readJournal: writing down what a
 * run decided must never be able to fail the run that decided it.
 */
export function appendJournal(title, entry) {
  const body = String(entry || "").trim();
  if (!body) return false;
  try {
    let thread = findDiscussion(JOURNAL_CATEGORY, title);
    if (!thread) {
      const url = postDiscussion({
        category: JOURNAL_CATEGORY,
        title,
        // The body is the thread's purpose, not its content: entries are comments,
        // so the body never needs rewriting and never races anything.
        body:
          `Running log for **${title.replace(/ — log$/, "")}**. One entry per run: what was ` +
          `decided, why, and what was deferred.\n\n` +
          `Written by the pipeline and locked — readable by anyone, appendable only by ` +
          `accounts with write access. Each run reads the last ${JOURNAL_TAIL} entries, not the thread.`,
      });
      if (!url) return false; // postDiscussion already said why
      thread = findDiscussion(JOURNAL_CATEGORY, title);
      if (!thread) return false;
    }
    graphql(
      `mutation($discussionId: ID!, $body: String!) {
         addDiscussionComment(input: {discussionId: $discussionId, body: $body}) { comment { id } }
       }`,
      { discussionId: thread.id, body }
    );
    log("info", `Discussions: appended an entry to "${title}".`);
    return true;
  } catch (e) {
    log("warn", `Discussions: could not append to the "${title}" journal.`, errorData(e));
    return false;
  }
}

/**
 * Render a journal entry from fields, so every role writes the same shape and a
 * reader can skim four weeks of them at a glance.
 *
 * Empty fields are dropped rather than printed as "(none)": an entry is read back
 * into a prompt, and padding is context spent on nothing.
 */
export function renderJournalEntry({ decided, because, deferred, extra = {} }) {
  const lines = [];
  if (decided) lines.push(`**Decided:** ${String(decided).trim()}`);
  if (because) lines.push(`**Because:** ${String(because).trim()}`);
  if (deferred) lines.push(`**Deferred:** ${String(deferred).trim()}`);
  for (const [label, value] of Object.entries(extra)) {
    if (value) lines.push(`**${label}:** ${String(value).trim()}`);
  }
  return lines.join("\n");
}
