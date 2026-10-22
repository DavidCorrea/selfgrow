import { chromium } from "playwright";
import { startStaticServer } from "./agents/verify.mjs";

const { server, port } = await startStaticServer("/home/runner/work/selfgrow/selfgrow/docs");
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const p1 = await ctx.newPage();
await p1.goto(url, { waitUntil: "networkidle" });
const p2 = await ctx.newPage();
await p2.goto(url, { waitUntil: "networkidle" });

const hidden = await p2.evaluate(() => document.hidden);
console.log("page2 hidden?", hidden);

const res = await p2.evaluate(async () => {
  const app = await import("./app.js");
  const { tools } = await import("./agenttools.js");
  const t = Object.fromEntries(tools().map(x => [x.name, x]));
  const g = (f) => document.querySelector(`[data-field="${f}"]`)?.textContent?.trim();
  app.setGarden({ beds: 2, seeds: 0, plants: 12, plantCounts: [12, 0] });
  app.setGrowth(1e6, 0);
  const before = { dom: { beds: g("beds"), capacity: g("capacity"), seeds: g("seeds") } };
  const r = await t["plant-seed"].execute({ kind: "herb" });
  const after = { dom: { beds: g("beds"), capacity: g("capacity"), seeds: g("seeds") },
                  state: { beds: r.beds, capacity: r.capacity, seeds: r.seeds, plants: r.plants } };
  return { before, after };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
server.close();
