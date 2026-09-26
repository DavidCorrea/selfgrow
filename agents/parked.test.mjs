// Parked tickets: work the Devs gave up on twice. The Tech Lead diagnoses why it
// failed; the Product Manager decides whether it returns smaller or is dropped,
// because whether it is still worth doing is a product question.
import test from "node:test";
import assert from "node:assert/strict";
import { withDiagnosis, hasDiagnosis } from "./tech-lead.mjs";
import { parkedTicketReplaced, renderParked } from "./product-manager.mjs";

const issue = (number, { body = "", labels = [], title = `Ticket ${number}` } = {}) =>
  ({ number, title, body, labels: labels.map((name) => ({ name })) });

const diagnosis = {
  diagnosis: "Both attempts rewrote the whole goal system and ran out of turns.",
  recommendation: "return smaller",
  smallerPiece: "Show the next goal's cost before it unlocks.",
};

test("recording the Tech Lead's diagnosis on a parked ticket", async (t) => {
  await t.test("adds the diagnosis below the ticket, dated, with its recommendation", () => {
    const body = withDiagnosis("Add stone.", diagnosis, "2026-09-26");
    assert.ok(body.startsWith("Add stone."));
    assert.match(body, /## Tech Lead diagnosis \(2026-09-26\)\nBoth attempts rewrote the whole goal system/);
    assert.match(body, /\*\*Recommendation:\*\* return smaller/);
    assert.match(body, /\*\*Smaller piece:\*\* Show the next goal's cost before it unlocks\./);
  });

  await t.test("replaces an earlier diagnosis rather than stacking them", () => {
    const first = withDiagnosis("Add stone.", diagnosis, "2026-09-19");
    const second = withDiagnosis(first, { diagnosis: "Still too big.", recommendation: "drop" }, "2026-09-26");
    assert.equal(second.match(/## Tech Lead diagnosis/g).length, 1);
    assert.match(second, /\(2026-09-26\)\nStill too big\./);
    assert.doesNotMatch(second, /Smaller piece/);
  });

  await t.test("tells a diagnosed ticket from one still waiting for the Tech Lead", () => {
    assert.equal(hasDiagnosis(issue(5, { body: withDiagnosis("x", diagnosis, "2026-09-26") })), true);
    assert.equal(hasDiagnosis(issue(5, { body: "x" })), false);
  });
});

test("the Product Manager deciding a parked ticket", async (t) => {
  const parked = issue(5, { labels: ["blocked"], body: withDiagnosis("Add stone.", diagnosis, "2026-09-26") });

  await t.test("returns a parked ticket through the smaller piece that replaces it", () => {
    assert.equal(parkedTicketReplaced({ replaces: "#5" }, [parked]), parked);
  });

  await t.test("never replaces a ticket that is not parked", () => {
    assert.equal(parkedTicketReplaced({ replaces: 6 }, [issue(6)]), null);
  });

  await t.test("ignores a replacement that names no open ticket", () => {
    assert.equal(parkedTicketReplaced({ replaces: 99 }, [parked]), null);
    assert.equal(parkedTicketReplaced({}, [parked]), null);
  });

  await t.test("shows each parked ticket with its diagnosis", () => {
    assert.match(renderParked([parked]), /### #5 — Ticket 5[\s\S]*Tech Lead diagnosis/);
  });

  await t.test("says when a parked ticket has no diagnosis yet, so it is left for the Tech Lead", () => {
    assert.match(renderParked([issue(7, { labels: ["blocked"] })]), /#7[\s\S]*no diagnosis yet/);
  });

  await t.test("says so when nothing is parked", () => {
    assert.match(renderParked([issue(8, { labels: ["groomed"] })]), /nothing is parked/);
  });
});
