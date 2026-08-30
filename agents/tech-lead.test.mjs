// How the Tech Lead decides what fits in one pass. The review reads the whole
// codebase on purpose — shape is a property of the whole — so the only real
// decision here is what survives when there is more source than budget, and
// whether the review is told what it did not see.
import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeSources, formatSources, renderManifest } from "./tech-lead.mjs";

const file = (name, size) => ({ name, source: "x".repeat(size) });

test("ordering the source so the useful files survive the budget", async (t) => {
  await t.test("puts recently changed files first", () => {
    const sources = [file("docs/a.js", 100), file("docs/b.js", 100), file("docs/c.js", 100)];
    const ordered = prioritizeSources(sources, new Set(["docs/c.js"]));
    assert.equal(ordered[0].name, "docs/c.js");
  });

  await t.test("orders the rest largest-first, where cruft accumulates", () => {
    const sources = [file("docs/small.js", 50), file("docs/big.js", 5000)];
    assert.equal(prioritizeSources(sources, new Set())[0].name, "docs/big.js");
  });

  await t.test("prefers a small changed file over a large untouched one", () => {
    const sources = [file("docs/big.js", 9000), file("docs/tiny.js", 20)];
    const ordered = prioritizeSources(sources, new Set(["docs/tiny.js"]));
    assert.equal(ordered[0].name, "docs/tiny.js");
  });

  await t.test("does not drop anything — ordering is not filtering", () => {
    const sources = [file("docs/a.js", 10), file("docs/b.js", 10)];
    assert.equal(prioritizeSources(sources, new Set()).length, 2);
  });
});

test("rendering the source within the budget", async (t) => {
  await t.test("includes everything when it fits", () => {
    const rendered = formatSources([file("docs/a.js", 100), file("docs/b.js", 100)]);
    assert.ok(rendered.includes("docs/a.js") && rendered.includes("docs/b.js"));
    assert.ok(!rendered.includes("Not shown"));
  });

  await t.test("names what it did not inline, and says to open it rather than judge it", () => {
    const many = Array.from({ length: 20 }, (_, i) => file(`docs/f${i}.js`, 6000));
    const rendered = formatSources(many);
    assert.match(rendered, /### Not inlined/);
    assert.match(rendered, /- docs\/f\d+\.js/);
    assert.match(rendered, /do NOT judge them unread/);
  });

  await t.test("inlines changed files first when the budget forces a choice", () => {
    const many = Array.from({ length: 20 }, (_, i) => file(`docs/f${i}.js`, 6000));
    const rendered = formatSources(many, new Set(["docs/f19.js"]));
    const inlined = rendered.slice(0, rendered.indexOf("### Not inlined"));
    assert.ok(inlined.includes("docs/f19.js"), "the changed file must be inlined, not deferred");
  });

  await t.test("says when a file was cut short, so nothing reads as complete when it isn't", () => {
    const rendered = formatSources([file("docs/huge.js", 9000)]);
    assert.match(rendered, /showing the first 6000 of 9000 characters/);
  });
});

test("mapping what the product is made of", async (t) => {
  const withExports = {
    name: "docs/garden.js",
    source: "export function initGarden() {}\nexport const SEASONS = [];\nfunction hidden() {}",
  };

  await t.test("lists every file, whatever the inlining budget did", () => {
    // The whole point: a file the review never opened is still a file it KNOWS
    // exists, so it cannot conclude around a silent hole.
    const many = Array.from({ length: 20 }, (_, i) => file(`docs/f${i}.js`, 6000));
    const manifest = renderManifest(many);
    for (let i = 0; i < 20; i++) assert.ok(manifest.includes(`docs/f${i}.js`), `f${i} missing`);
  });

  await t.test("names what each file offers, without reading it", () => {
    const manifest = renderManifest([withExports]);
    assert.match(manifest, /initGarden/);
    assert.match(manifest, /SEASONS/);
    assert.ok(!manifest.includes("hidden"), "an unexported function is not part of the interface");
  });

  await t.test("reports size, which is where a module doing two jobs shows up", () => {
    assert.match(renderManifest([file("docs/big.js", 39821)]), /39821 chars/);
  });

  await t.test("marks the files that changed", () => {
    const manifest = renderManifest([file("docs/a.js", 10), file("docs/b.js", 10)], new Set(["docs/a.js"]));
    assert.match(manifest, /`docs\/a\.js` \* —/);
    assert.match(manifest, /`docs\/b\.js` —/);
    assert.match(manifest, /marks a file touched since your last review/);
  });

  await t.test("says nothing about markers when nothing has changed", () => {
    assert.ok(!renderManifest([file("docs/a.js", 10)]).includes("marks a file"));
  });

  await t.test("handles a file that exports nothing", () => {
    assert.match(renderManifest([{ name: "docs/x.js", source: "const a = 1;" }]), /exports: \(none\)/);
  });
});
