// What App Review's measurements become. They reach the Product Manager only as
// playtest findings: the accessibility ones are filed without a model, worded
// for the player, because a model deciding whether faint text "matters" could
// drop a real barrier; the measured detail travels as Dev Notes.
import test from "node:test";
import assert from "node:assert/strict";
import { measuredFindings, findingBody } from "./playtester.mjs";

const review = (defects = [], functional = []) => ({ report: "(report)", defects, functional });
const defect = (message, viewports = ["phone"]) => ({ message, viewports });

test("turning accessibility measurements into findings", async (t) => {
  await t.test("files faint text as one finding, with every measurement in its Dev Notes", () => {
    const findings = measuredFindings(review([
      defect("text contrast 2.10:1 is below the 4.5:1 minimum (rgb(1,1,1) on rgb(0,0,0)): p.hint", ["desktop", "phone"]),
      defect("text contrast 3.00:1 is below the 4.5:1 minimum (rgb(2,2,2) on rgb(0,0,0)): span.rate"),
    ]));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].title, "Some text is too faint to read");
    assert.doesNotMatch(findings[0].observation, /rgb|p\.hint/);
    assert.match(findings[0].devNotes, /text contrast 2\.10:1[^\n]*p\.hint \(at: desktop; phone\)/);
    assert.match(findings[0].devNotes, /span\.rate \(at: phone\)/);
  });

  await t.test("files each kind of barrier separately", () => {
    const titles = measuredFindings(review(
      [
        defect("tap target 71x33px is under the 40px minimum for touch: button#ok"),
        defect("element runs 24px past the right edge: div.bar"),
        defect("the page scrolls horizontally: content is 420px wide in a 390px viewport."),
      ],
      ['"Gather" — click triggered a JS error: TypeError: x is undefined']
    )).map((finding) => finding.title);
    assert.deepEqual(titles, [
      "Some controls are too small to tap on a phone",
      "Part of the page runs off the screen",
      "Using a control breaks the page",
    ]);
  });

  await t.test("leaves every other measurement to the Playtester's judgement", () => {
    const findings = measuredFindings(review(
      [defect("text overlaps (60% of the smaller box): h2 over p"), defect("narrow centre column: content fills 41% of the 1440px window")],
      ['"Wood" — looks interactive but had no visible effect (may be canvas/JS-only).']
    ));
    assert.deepEqual(findings, []);
  });

  await t.test("files nothing when nothing was measured", () => {
    assert.deepEqual(measuredFindings(null), []);
  });
});

test("writing a finding", async (t) => {
  const finding = { title: "Some text is too faint to read", observation: "The hint is hard to read.", whyItMatters: "Nobody reads it." };

  await t.test("keeps technical detail out of the observation, in Dev Notes", () => {
    const body = findingBody({ ...finding, devNotes: "- text contrast 2.10:1: p.hint" }, "");
    assert.match(body, /## What I noticed\nThe hint is hard to read\./);
    assert.match(body, /## Dev Notes\n- text contrast 2\.10:1: p\.hint/);
  });

  await t.test("has no Dev Notes section when there is nothing technical to say", () => {
    assert.doesNotMatch(findingBody(finding, ""), /## Dev Notes/);
  });

  await t.test("says it waits for the Product Manager to groom it", () => {
    assert.match(findingBody(finding, ""), /Product Manager grooms/);
  });
});
