import { startStaticServer } from "/home/runner/work/selfgrow/selfgrow/agents/verify.mjs";
import { join } from "path";
const { server, port } = await startStaticServer(join("/home/runner/work/selfgrow/selfgrow", "docs"));
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 20000 });
const res = await page.evaluate(async () => {
  const t0 = performance.now();
  const mod = await import("./selftest.js");
  const problems = await mod.checks();
  return { ms: Math.round(performance.now() - t0), problems: problems.map(String).slice(0, 20) };
});
console.log("elapsed ms:", res.ms);
console.log("problems:", res.problems.length ? res.problems : "(none)");
await browser.close();
server.close();
