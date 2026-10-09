// When a role file is the process entry point.
//
// A role that decides it was merely imported returns without running and exits
// 0 — for verify-product, a required check, that is a pass nobody earned. So the
// decision has to hold however the file was reached, including through a symlink.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { isEntrypoint } from "./agent.mjs";

test("deciding whether a role file is the entry point", async (t) => {
  const realDir = fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(), "entrypoint-")));
  const rolePath = join(realDir, "role.mjs");
  fs.writeFileSync(rolePath, "");
  const linkDir = `${realDir}-link`;
  fs.symlinkSync(realDir, linkDir);
  t.after(() => {
    fs.unlinkSync(linkDir);
    fs.rmSync(realDir, { recursive: true });
  });

  // Node resolves a module's own URL to its real path, but leaves argv as typed.
  const moduleUrl = pathToFileURL(rolePath).href;

  await t.test("runs when the file was invoked by its real path", () => {
    assert.equal(isEntrypoint(moduleUrl, rolePath), true);
  });

  await t.test("runs when the file was invoked through a symlinked directory", () => {
    assert.equal(isEntrypoint(moduleUrl, join(linkDir, "role.mjs")), true);
  });

  await t.test("does not run when another file is the entry point", () => {
    assert.equal(isEntrypoint(moduleUrl, join(realDir, "other.mjs")), false);
  });

  await t.test("does not run when there is no entry script", () => {
    assert.equal(isEntrypoint(moduleUrl, undefined), false);
  });
});
