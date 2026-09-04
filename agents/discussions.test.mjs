// The pure halves of the Discussions layer: who may be obeyed, and what an entry
// looks like. Both are safety-relevant and neither needs the network.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isTrustedAuthor,
  isOwnThread,
  renderJournalEntry,
  renderLessonThreads,
} from "./discussions.mjs";

test("deciding whose words count as guidance", async (t) => {
  await t.test("accepts accounts with write access", () => {
    for (const who of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      assert.equal(isTrustedAuthor(who), true, who);
    }
  });

  // The inbound category is unlocked on purpose, so anyone can post there. Their
  // words are worth reading and must never be executed: an agent that treats a
  // stranger's comment as an instruction has write access to main and a key.
  await t.test("refuses everyone else", () => {
    for (const who of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE", "MANNEQUIN", ""]) {
      assert.equal(isTrustedAuthor(who), false, who || "(empty)");
    }
  });

  await t.test("refuses a missing association rather than assuming one", () => {
    assert.equal(isTrustedAuthor(undefined), false);
    assert.equal(isTrustedAuthor(null), false);
  });
});

test("writing a journal entry", async (t) => {
  await t.test("renders the three fields in a fixed order", () => {
    const entry = renderJournalEntry({
      decided: "Milestone: depth before breadth",
      because: "QA says the scene reads as a diagram",
      deferred: "Audio work until the visual holds up",
    });
    assert.equal(
      entry,
      "**Decided:** Milestone: depth before breadth\n" +
        "**Because:** QA says the scene reads as a diagram\n" +
        "**Deferred:** Audio work until the visual holds up"
    );
  });

  // Padding is context spent on nothing: these get read back into a prompt.
  await t.test("drops empty fields instead of printing placeholders", () => {
    assert.equal(renderJournalEntry({ decided: "X" }), "**Decided:** X");
    assert.equal(renderJournalEntry({}), "");
  });

  await t.test("carries role-specific fields after the fixed ones", () => {
    const entry = renderJournalEntry({
      decided: "Parked #123",
      extra: { Ruling: "Return it smaller", Coverage: "selftest.js untested" },
    });
    assert.match(entry, /\*\*Decided:\*\* Parked #123\n\*\*Ruling:\*\*/);
    assert.match(entry, /\*\*Coverage:\*\* selftest\.js untested/);
  });

  await t.test("trims what an agent wrote", () => {
    assert.equal(renderJournalEntry({ decided: "  spaced  " }), "**Decided:** spaced");
  });
});

test("recognising the pipeline's own thread", async (t) => {
  const thread = (over = {}) => ({
    title: "Playtester — log",
    authorAssociation: "OWNER",
    category: { name: "Journals" },
    ...over,
  });

  await t.test("accepts its own thread", () => {
    assert.equal(isOwnThread(thread(), "Journals", "Playtester — log"), true);
  });

  await t.test("accepts a title that starts with the prefix", () => {
    assert.equal(isOwnThread(thread({ title: "Playtester — log (2026)" }), "Journals", "Playtester — log"), true);
  });

  // The whole point: category + title is only safe while nobody else can post in
  // the category, and that is a repo setting this code cannot read.
  await t.test("refuses a thread wearing the name but written by someone else", () => {
    assert.equal(isOwnThread(thread({ authorAssociation: "NONE" }), "Journals", "Playtester — log"), false);
    assert.equal(isOwnThread(thread({ authorAssociation: "CONTRIBUTOR" }), "Journals", "Playtester — log"), false);
  });

  await t.test("refuses the right title in the wrong category", () => {
    assert.equal(isOwnThread(thread({ category: { name: "General" } }), "Journals", "Playtester — log"), false);
  });

  await t.test("refuses a different thread in the right category", () => {
    assert.equal(isOwnThread(thread({ title: "Tech Lead — log" }), "Journals", "Playtester — log"), false);
  });

  await t.test("refuses nothing at all", () => {
    assert.equal(isOwnThread(null, "Journals", "Playtester — log"), false);
    assert.equal(isOwnThread({}, "Journals", "Playtester — log"), false);
  });
});

test("rendering lessons for a planner", async (t) => {
  const lesson = (title, occurrences, latest) => ({ title, occurrences, latest });

  await t.test("leads with how often each one has happened", () => {
    const out = renderLessonThreads([lesson("Needs a system that does not exist yet", 4, "#152 died on it.")]);
    assert.match(out, /### Needs a system that does not exist yet/);
    assert.match(out, /_Seen 4 time\(s\)\._/);
    assert.match(out, /#152 died on it\./);
  });

  // The count is the reason for threading at all: an unrecurring lesson and one
  // seen four times must not read the same to whoever is planning.
  await t.test("keeps the order it was given", () => {
    const out = renderLessonThreads([lesson("Often", 4, "a"), lesson("Once", 1, "b")]);
    assert.ok(out.indexOf("Often") < out.indexOf("Once"));
  });

  await t.test("says so rather than printing an empty section", () => {
    assert.match(renderLessonThreads([lesson("No detail", 1, "")]), /\(no detail recorded\)/);
    assert.equal(renderLessonThreads([]), "");
  });
});
