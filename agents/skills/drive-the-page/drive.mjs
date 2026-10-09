// Drive docs/ through a sequence of steps in a real browser and report what
// held. The steps are a small module you write, so a symptom can be reproduced
// exactly as reported and a fix confirmed the same way.
//
//   node agents/skills/drive-the-page/drive.mjs <steps.mjs> [desktop|phone]
//
// The steps module default-exports `async ({ page, url, check, shot, note })`.
// It starts on the freshly loaded page with empty storage. Prints each note,
// check and screenshot path, then any errors the page threw, and exits 1 when a
// check failed, the page threw, or the steps crashed.
import os from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { chromium } from "playwright";
import { repoRoot } from "../../paths.mjs";
import { startStaticServer, REVIEW_VIEWPORTS, viewportOptions } from "../../verify.mjs";

const STEPS_TIME_LIMIT_MS = 60_000;

const [stepsPath, viewportLabel = "desktop"] = process.argv.slice(2);
const viewport = REVIEW_VIEWPORTS.find((candidate) => candidate.label === viewportLabel);
if (!stepsPath) {
  console.error("Usage: node agents/skills/drive-the-page/drive.mjs <steps.mjs> [desktop|phone]");
  process.exit(1);
}
if (!viewport) {
  console.error(`Viewport "${viewportLabel}" is not one of: ${REVIEW_VIEWPORTS.map((candidate) => candidate.label).join(", ")}.`);
  process.exit(1);
}

const { default: steps } = await import(pathToFileURL(resolve(stepsPath)).href);
if (typeof steps !== "function") {
  console.error(`${stepsPath} must default-export an async function ({ page, url, check, shot, note }).`);
  process.exit(1);
}

const failures = [];
const pageErrors = [];
let checksRun = 0;

const check = (holds, message) => {
  checksRun += 1;
  console.log(`${holds ? "ok" : "FAILED"}: ${message}`);
  if (!holds) failures.push(message);
};
const note = (message) => console.log(`- ${message}`);
let shotCount = 0;
const shot = async (page, name = `step-${++shotCount}`) => {
  const path = join(os.tmpdir(), `drive-the-page-${name.replace(/[^\w-]/g, "_")}-${viewport.label}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`screenshot: ${path}`);
  return path;
};

const { server, port } = await startStaticServer(join(repoRoot, "docs"));
const browser = await chromium.launch();
let crashed = null;
try {
  const context = await browser.newContext(viewportOptions(viewport));
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
  });
  const url = `http://127.0.0.1:${port}/`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

  let timer;
  const timeLimit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`steps did not finish within ${STEPS_TIME_LIMIT_MS / 1000} s`)), STEPS_TIME_LIMIT_MS);
  });
  try {
    await Promise.race([steps({ page, url, check, note, shot: (name) => shot(page, name) }), timeLimit]);
  } finally {
    clearTimeout(timer);
  }
} catch (error) {
  crashed = error;
} finally {
  await browser.close();
  server.close();
}

for (const message of pageErrors) console.log(`page error: ${message}`);
// Playwright colours its call logs for a terminal; an agent reads them as text.
if (crashed) console.log(`steps crashed: ${crashed.message.replace(/\x1b\[[0-9;]*m/g, "")}`);
console.log(`${failures.length} of ${checksRun} checks failed, ${pageErrors.length} page error(s).`);
process.exit(failures.length || pageErrors.length || crashed ? 1 : 0);
