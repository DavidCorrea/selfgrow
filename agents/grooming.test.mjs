// Grooming is the only way work reaches the Devs. Whoever files a ticket, the PM
// writes what the player gets and marks it groomed; what the filer wrote stays
// on the ticket as Dev Notes, because it is often exactly the evidence a Builder
// needs.
import test from "node:test";
import assert from "node:assert/strict";
import { planGrooming, groomedBody } from "./product-manager.mjs";

const issue = (number, { body = "", labels = [], title = `Ticket ${number}` } = {}) =>
  ({ number, title, body, labels: labels.map((name) => ({ name })) });

const techLeadTicket = issue(5, {
  labels: ["agent"],
  body: "`goals.js` recomputes progress on every tick; cache it per goal.",
});
const personRequest = issue(6, { body: "the buttons are hard to read" });

test("writing a groomed ticket", async (t) => {
  await t.test("leads with the player's view and keeps the filer's text as Dev Notes", () => {
    const body = groomedBody(techLeadTicket, {
      body: "The goal bar keeps up with wood as it is gathered.",
      acceptanceCriteria: ["The bar moves within a second of gathering"],
    });
    assert.ok(body.startsWith("The goal bar keeps up with wood as it is gathered."));
    assert.match(body, /## Acceptance criteria\n- \[ \] The bar moves within a second of gathering/);
    assert.match(body, /## Dev Notes\n`goals\.js` recomputes progress on every tick; cache it per goal\./);
  });

  await t.test("puts each of the PM's notes on its own line when it sends a list", () => {
    const body = groomedBody(techLeadTicket, { body: "The goal bar keeps up.", devNotes: ["Cache per goal", "See goals.js"] });
    assert.match(body, /## Dev Notes\n- Cache per goal\n- See goals\.js/);
  });

  await t.test("keeps a person's words as their original request", () => {
    const body = groomedBody(personRequest, { body: "Button labels are readable at every size." });
    assert.match(body, /## Original request\nthe buttons are hard to read/);
    assert.doesNotMatch(body, /## Dev Notes/);
  });

  await t.test("leaves the body alone when the PM does not rewrite it", () => {
    assert.equal(groomedBody(techLeadTicket, {}), null);
  });
});

test("choosing what to groom", async (t) => {
  await t.test("grooms an open ticket that is not yet groomed, at the priority given", () => {
    const [entry] = planGrooming([{ number: 5, priority: "high" }], [techLeadTicket]);
    assert.equal(entry.issue, techLeadTicket);
    assert.equal(entry.priority, "high");
  });

  await t.test("defaults to medium priority when none is given", () => {
    assert.equal(planGrooming([{ number: 5 }], [techLeadTicket])[0].priority, "medium");
  });

  await t.test("skips a ticket that is already groomed, so its Dev Notes are not nested again", () => {
    assert.deepEqual(planGrooming([{ number: 7 }], [issue(7, { labels: ["groomed"] })]), []);
  });

  await t.test("never grooms a report, which is not work", () => {
    const reports = [issue(8, { labels: ["playtest"] }), issue(9, { labels: ["health"] })];
    assert.deepEqual(planGrooming([{ number: 8 }, { number: 9 }], reports), []);
  });

  await t.test("never grooms a parked ticket, which waits for a ruling first", () => {
    assert.deepEqual(planGrooming([{ number: 10 }], [issue(10, { labels: ["blocked"] })]), []);
  });

  await t.test("ignores a number that is not an open ticket", () => {
    assert.deepEqual(planGrooming([{ number: 99 }], [techLeadTicket]), []);
  });
});
