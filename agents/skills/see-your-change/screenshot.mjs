// Screenshots of docs/ at every viewport the App Review measures, for an agent
// to look at what it built. Prints one PNG path per line.
//
//   node agents/skills/see-your-change/screenshot.mjs [name]
//
// `name` keeps a before and an after apart; it defaults to "now". The files go
// to the temp dir, which the read tool can open and a commit never picks up.
import os from "os";
import { join } from "path";
import { chromium } from "playwright";
import { repoRoot, startStaticServer, REVIEW_VIEWPORTS, viewportOptions } from "../../shared.mjs";

const name = process.argv[2] || "now";
if (!/^[\w-]+$/.test(name)) {
  console.error(`Screenshot name "${name}" must be letters, digits, - or _.`);
  process.exit(1);
}

const { server, port } = await startStaticServer(join(repoRoot, "docs"));
const browser = await chromium.launch();
try {
  for (const viewport of REVIEW_VIEWPORTS) {
    const context = await browser.newContext(viewportOptions(viewport));
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
    // Long enough for the first tick to paint, which is what a visitor first sees.
    await page.waitForTimeout(1500);
    const path = join(os.tmpdir(), `see-your-change-${name}-${viewport.label}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(path);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
