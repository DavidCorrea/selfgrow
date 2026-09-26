// What the layout checks call a collapsed container. The boxes are measured in
// the page and judged here, so what counts as broken is testable without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { describeCollapsedContainers } from "./shared.mjs";

const container = (overrides = {}) => ({
  width: 0,
  height: 0,
  childCount: 2,
  generatesBox: true,
  label: "div.panel",
  ...overrides,
});

test("collapsed containers", async (t) => {
  await t.test("flags a container that lays out its children into no space", () => {
    const [defect] = describeCollapsedContainers([container({ width: 320 })]);
    assert.match(defect, /collapsed container \(320x0\) despite 2 child element\(s\): div\.panel/);
  });

  await t.test("ignores a container inside hidden content, which is meant to take no space", () => {
    assert.deepEqual(describeCollapsedContainers([container({ generatesBox: false })]), []);
  });

  await t.test("reports at most five, so one broken region cannot crowd out the rest", () => {
    const many = Array.from({ length: 8 }, (_, index) => container({ label: `div.row-${index}` }));
    assert.equal(describeCollapsedContainers(many).length, 5);
  });
});
