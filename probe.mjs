import { chromium } from "playwright";
import { startStaticServer } from "/home/runner/work/selfgrow/selfgrow/agents/verify.mjs";

const { server, port } = await startStaticServer("/home/runner/work/selfgrow/selfgrow/docs");
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();

async function probe(label) {
  const page = await browser.newPage();
  const logs = [];
  page.on("console", m => logs.push(m.text()));
  page.on("pageerror", e => logs.push("ERR " + e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  const res = await page.evaluate(async () => {
    const mod = await import("./app.js");
    const state = mod.getDisplayedState();
    const g = (f) => document.querySelector(`[data-field="${f}"]`)?.textContent?.trim();
    return {
      stateCounts: { seeds: state.seeds, plants: state.plants, beds: state.beds, capacity: state.capacity },
      dom: { seeds: g("seeds"), plants: g("plants"), beds: g("beds"), capacity: g("capacity") },
    };
  });
  console.log(label, JSON.stringify(res), logs.slice(0,5));
  await page.close();
}

await probe("fresh");
await browser.close();
server.close();
