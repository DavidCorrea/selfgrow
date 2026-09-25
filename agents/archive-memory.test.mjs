// A reset archives the product's memory and then deletes the product, so an
// archive that did not happen must stop it rather than read as "nothing to do".
//
// These put a fake `gh` first on PATH — the gh boundary, not our code — that
// serves one journal and one product lesson, and fails whichever call
// FAKE_GH_FAILS names: the read of a category, every page of it (the page cap),
// or the rename of one thread.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { archiveProductMemory } from "./discussions.mjs";

const FAKE_GH = `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
const fails = process.env.FAKE_GH_FAILS || "";
const reply = (data) => { process.stdout.write(JSON.stringify({ data })); process.exit(0); };
const refuse = () => { process.stderr.write("HTTP 502: Bad Gateway"); process.exit(1); };
if (args.includes("updateDiscussion")) {
  if (fails === "rename" && args.includes("id=journal")) refuse();
  reply({ updateDiscussion: { discussion: { number: 1 } } });
}
if (args.includes("discussionCategories")) {
  reply({ repository: { id: "repo", discussionCategories: { nodes: [
    { id: "cat-journals", name: "Journals" }, { id: "cat-lessons", name: "Lessons" } ] } } });
}
if (fails === "read") refuse();
const thread = args.includes("cat-journals")
  ? { id: "journal", title: "Playtester — log", category: { name: "Journals" }, labels: { nodes: [] } }
  : { id: "lesson", title: "A product failure", category: { name: "Lessons" }, labels: { nodes: [{ name: "product" }] } };
reply({ repository: { discussions: {
  nodes: fails === "endless" ? [] : [{ ...thread, authorAssociation: "OWNER" }],
  pageInfo: { hasNextPage: fails === "endless", endCursor: "next" } } } });
`;

let fakeBin;
const realPath = process.env.PATH;

before(() => {
  fakeBin = fs.mkdtempSync(join(os.tmpdir(), "selfgrow-archive-gh-"));
  fs.writeFileSync(join(fakeBin, "gh"), FAKE_GH, { mode: 0o755 });
  process.env.PATH = `${fakeBin}:${realPath}`;
  process.env.GITHUB_REPOSITORY = "owner/repo";
});

beforeEach(() => {
  delete process.env.FAKE_GH_FAILS;
});

after(() => {
  process.env.PATH = realPath;
  delete process.env.FAKE_GH_FAILS;
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

test("archiving the product's memory before a reset deletes the product", async (t) => {
  await t.test("archives the journal and the product lesson when every call succeeds", () => {
    assert.equal(archiveProductMemory(), 2);
  });

  await t.test("throws when the categories cannot be read, instead of archiving nothing", () => {
    process.env.FAKE_GH_FAILS = "read";
    assert.throws(() => archiveProductMemory(), /could not read the journals and lessons to archive/);
  });

  await t.test("throws when a category runs past the page cap", () => {
    process.env.FAKE_GH_FAILS = "endless";
    assert.throws(() => archiveProductMemory(), /could not read.*DISCUSSION_PAGE_CAP/);
  });

  // Something else was archived, which is what used to let this through: the
  // journal left under its own title is the one the next product appends to.
  await t.test("throws when one journal cannot be renamed, naming it", () => {
    process.env.FAKE_GH_FAILS = "rename";
    assert.throws(() => archiveProductMemory(), /could not archive 1 of 2 thread\(s\).*\[Journals\] Playtester — log/);
  });
});
