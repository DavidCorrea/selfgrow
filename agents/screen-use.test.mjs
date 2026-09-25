// Whether the app uses the screen it is on. The layout checks elsewhere say a
// page is broken; these say a page that works is still wrong for the device —
// a desktop window left mostly empty, a phone control too small for a thumb.
import test from "node:test";
import assert from "node:assert/strict";
import { describeNarrowLayout, describeSmallTapTargets } from "./shared.mjs";

const desktop = (contentLeft, contentRight) => ({ viewportWidth: 1440, contentLeft, contentRight });

test("content on a desktop window", async (t) => {
  await t.test("passes a layout that uses most of the window", () => {
    assert.equal(describeNarrowLayout(desktop(40, 1400)), null);
  });

  await t.test("flags a narrow column in the middle of the window", () => {
    const defect = describeNarrowLayout(desktop(480, 960));
    assert.match(defect, /narrow centre column/);
    assert.match(defect, /33% of the 1440px window/);
  });

  await t.test("passes a layout exactly at the threshold", () => {
    assert.equal(describeNarrowLayout(desktop(0, 864)), null);
  });

  await t.test("counts only the part of the content inside the window", () => {
    assert.match(describeNarrowLayout(desktop(-2000, 400)), /28% of the 1440px window \(0px to 400px\)/);
  });

  await t.test("says nothing about a page with no visible content", () => {
    assert.equal(describeNarrowLayout(desktop(Infinity, -Infinity)), null);
  });
});

const target = (width, height, label = "button") => ({ width, height, label });

test("controls on a touch phone", async (t) => {
  await t.test("passes controls a thumb can hit", () => {
    assert.deepEqual(describeSmallTapTargets([target(48, 48), target(200, 40)]), []);
  });

  await t.test("flags a control too short or too narrow to tap", () => {
    const defects = describeSmallTapTargets([target(120, 24, 'a ("more")'), target(30, 60, "button#close")]);
    assert.equal(defects.length, 2);
    assert.match(defects[0], /tap target 120x24px is under the 40px minimum for touch: a \("more"\)/);
    assert.match(defects[1], /button#close/);
  });

  await t.test("ignores a visually-hidden control meant only for screen readers", () => {
    assert.deepEqual(describeSmallTapTargets([target(165, 1, 'a ("Skip to content")'), target(1, 1)]), []);
  });

  await t.test("names the smallest offenders first and caps the list", () => {
    const many = [30, 10, 35, 20, 25, 15, 5].map((size) => target(size, size, `button${size}`));
    const defects = describeSmallTapTargets(many);
    assert.equal(defects.length, 5);
    assert.match(defects[0], /button5$/);
    assert.match(defects[4], /button25$/);
  });
});
