// The pure halves of the Discussions layer: who may be obeyed, and what an entry
// looks like. Both are safety-relevant and neither needs the network.
import test from "node:test";
import assert from "node:assert/strict";
import { isTrustedAuthor, renderJournalEntry } from "./discussions.mjs";

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
