// The title-overlap dedup, which decides whether a proposed ticket is discarded
// before anyone sees it. It has silently thrown away good work twice: once when
// the measure rewarded a size mismatch, and once when a formatting bug left a
// three-word title that then matched everything. Both are pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { nearDuplicateOf } from "./product-manager.mjs";

// The PM builds these from the open board; the shape is what nearDuplicateOf reads.
const existing = (...titles) => titles.map((title) => ({ title, tokens: tokensOf(title) }));

// Mirrors the PM's own tokeniser closely enough to build fixtures with; the
// assertions below are about the comparison, not this.
const STOP = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with",
  "add", "create", "introduce", "implement", "build", "make", "new",
  "support", "enable", "improve", "update", "fix", "page", "feature"]);
function tokensOf(title) {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

test("catching a ticket the board already has", async (t) => {
  await t.test("matches the same request phrased differently", () => {
    const match = nearDuplicateOf("Introduce the journal", existing("Add a journal"));
    assert.equal(match.title, "Add a journal");
  });

  await t.test("matches across singular and plural", () => {
    assert.ok(nearDuplicateOf("Add pressure cycles", existing("Add a pressure cycle")));
  });

  await t.test("names what it collided with, so a rejection is auditable", () => {
    const match = nearDuplicateOf("Add a journal", existing("Something else", "Add a journal"));
    assert.equal(match.title, "Add a journal");
    assert.ok(match.score > 0, "reports how hard it matched");
  });
});

test("letting genuinely new work through", async (t) => {
  await t.test("does not match a short title merely contained in a longer one", () => {
    // The overlap coefficient scored this a perfect 1.00 and swallowed every
    // ticket about a gallery's contents into the ticket about the gallery.
    const match = nearDuplicateOf(
      "Add a condenser device found in the Condenser Gallery",
      existing("Add the Condenser Gallery")
    );
    assert.equal(match, null);
  });

  await t.test("a title stripped down to a few generic words does not match everything after it", () => {
    // "Fix contrast on  to meet WCAG AA" lost its element name to a formatting
    // bug and then matched every future contrast ticket, permanently.
    const damaged = existing("Fix contrast on  to meet WCAG AA");
    assert.equal(nearDuplicateOf("Fix contrast on the pressure gauge to meet WCAG AA", damaged), null);
  });

  await t.test("does not match on shared phrasing alone", () => {
    assert.equal(nearDuplicateOf("Add a journal", existing("Add a gear")), null);
  });

  await t.test("compares symmetrically, so argument order cannot change the verdict", () => {
    const long = "Add a condenser device found in the Condenser Gallery";
    const short = "Add the Condenser Gallery";
    assert.equal(Boolean(nearDuplicateOf(long, existing(short))), Boolean(nearDuplicateOf(short, existing(long))));
  });

  await t.test("keeps a proposal when there is nothing to compare against", () => {
    assert.equal(nearDuplicateOf("Add a journal", []), null);
  });

  await t.test("keeps a proposal whose title is all generic words rather than matching at random", () => {
    assert.equal(nearDuplicateOf("Add the new feature", existing("Add a journal")), null);
  });
});
