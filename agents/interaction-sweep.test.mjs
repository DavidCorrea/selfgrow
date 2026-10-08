// The App Review presses every control on the page and reports what breaks. It
// used to report every control a visitor could not press yet — hidden until
// unlocked, or disabled — as "could not be exercised", which on an idle game is
// most of the page, and buried the one control that really was unreachable.
//
// Needs a real Chromium, so it skips where none is installed (CI's check job).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import { join } from "path";
import { exploreInteractions, startStaticServer } from "./verify.mjs";

const PAGE = `<!doctype html>
<html><body>
  <button onclick="document.body.append('pressed')">Open to everyone</button>
  <button style="display:none" onclick="document.body.append('pressed')">Not unlocked yet</button>
  <button disabled>Locked for now</button>
  <div style="position:relative">
    <button>Under an overlay</button>
    <div style="position:absolute;inset:0"></div>
  </div>
</body></html>`;

const launchChromium = async () => {
  try {
    const { chromium } = await import("playwright");
    return await chromium.launch();
  } catch {
    return null;
  }
};

test("pressing every control on the page", async (t) => {
  const browser = await launchChromium();
  if (!browser) return t.skip("no Chromium installed — run `npx playwright install chromium`");
  const dir = fs.mkdtempSync(join(os.tmpdir(), "sweep-"));
  fs.writeFileSync(join(dir, "index.html"), PAGE);
  const { server, port } = await startStaticServer(dir);
  try {
    const { findings } = await exploreInteractions(browser, `http://127.0.0.1:${port}/`);

    await t.test("skips a control that is hidden until something unlocks it", () => {
      assert.equal(findings.some((finding) => finding.includes("Not unlocked yet")), false, findings.join("\n"));
    });

    await t.test("skips a control that is disabled", () => {
      assert.equal(findings.some((finding) => finding.includes("Locked for now")), false, findings.join("\n"));
    });

    await t.test("still reports a visible, enabled control nobody can press", () => {
      assert.ok(
        findings.some((finding) => finding.includes("Under an overlay") && finding.includes("could not be exercised")),
        findings.join("\n")
      );
    });

    await t.test("says nothing about a control that works", () => {
      assert.equal(findings.some((finding) => finding.includes("Open to everyone")), false, findings.join("\n"));
    });
  } finally {
    await browser.close();
    server.close();
  }
});
