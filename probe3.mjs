import { chromium } from "playwright";
import { startStaticServer } from "./agents/verify.mjs";

const { server, port } = await startStaticServer("/home/runner/work/selfgrow/selfgrow/docs");
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle" });

const res = await page.evaluate(async () => {
  const app = await import("./app.js");
  const garden = await import("./garden.js");
  const { tools } = await import("./agenttools.js");
  const t = Object.fromEntries(tools().map(x => [x.name, x]));
  const g = (f) => document.querySelector(`[data-field="${f}"]`)?.textContent?.trim();
  // make the page read as hidden for the rest of this evaluation
  Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
  Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
  garden.setGarden({ beds: 2, seeds: 0, plants: 12, plantCounts: [12, 0] });
  garden.setGrowth(1e6, 0);
  const before = { dom: { beds: g("beds"), capacity: g("capacity"), seeds: g("seeds"), plants: g("plants") } };
  const r = await t["plant-seed"].execute({ kind: "herb" });
  const after = { dom: { beds: g("beds"), capacity: g("capacity"), seeds: g("seeds"), plants: g("plants") },
                  state: { beds: r.beds, capacity: r.capacity, seeds: r.seeds, plants: r.plants } };
  return { before, after };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
server.close();
