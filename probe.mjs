import { startStaticServer } from "./agents/verify.mjs";
import { join } from "path";
const { server, port } = await startStaticServer(join(process.cwd(), "docs"));
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
const info = await page.evaluate(async () => {
  const app = await import("./app.js");
  const garden = await import("./garden.js");
  garden.setGarden({ beds: 2, seeds: 0, plants: 0, plantCounts: [12, 0] });
  garden.setGrowth(1e6, 1, 0, 0, 0);
  app.renderAll ? app.renderAll() : null;
  const plot = document.getElementById("plot");
  const rect = plot.getBoundingClientRect();
  return { rect: { w: rect.width, h: rect.height }, cw: plot.width, ch: plot.height, html: plot.outerHTML.slice(0, 200) };
});
console.log(JSON.stringify(info));
const el = await page.$("#plot");
await el.screenshot({ path: "/tmp/plot2bed.png" });
// countability: analyse canvas pixels
const analysis = await page.evaluate(async () => {
  const api = await import("./plotview.js");
  const app = await import("./app.js");
  const state = app.getDisplayedState();
  const canvas = document.createElement("canvas");
  api.drawGarden(canvas, state, app.readPalette(), 0);
  const b = api.plotBounds(state);
  const grid = api.plotCells(state);
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, b.width, b.height).data;
  const px = (x, y) => { const i = (y * b.width + x) * 4; return `${data[i]},${data[i+1]},${data[i+2]}`; };
  const p = app.readPalette();
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; };
  const litKey = hex(p.soilLight), deepKey = hex(p.soilDeep), bareKey = hex(p.soilBare), soilKey = hex(p.soil);
  let emptyInteriorOk = 0, emptyInteriorBad = 0, plantedInteriorBare = 0;
  let rimProblems = [];
  for (const plot of grid.plots) {
    const x = plot.column * b.cell, y = plot.row * b.cell;
    const mid = px(x + 12, y + 12);
    if (plot.occupied) { if (mid === bareKey) plantedInteriorBare++; }
    else { (mid === bareKey ? emptyInteriorOk++ : emptyInteriorBad++); }
    // four sides: sample 4 points per side along the outer 2px
    const samples = [];
    for (const t of [4, 10, 16, 21]) {
      samples.push(["top", px(x + t, y)], ["bottom", px(x + t, y + b.cell - 1)],
                   ["left", px(x, y + t)], ["right", px(x + b.cell - 1, y + t)]);
    }
    for (const [side, key] of samples) if (key !== litKey) rimProblems.push(`plot ${plot.cell} ${side} ${key}`);
  }
  return { rows: b.rows, cells: b.cells, plots: grid.plots.length, beds: grid.beds,
    litKey, deepKey, bareKey, soilKey, emptyInteriorOk, emptyInteriorBad, plantedInteriorBare,
    rimProblems: rimProblems.slice(0, 8), rimProblemCount: rimProblems.length,
    plotCount: grid.plots.filter(p=>p.occupied).length };
});
console.log(JSON.stringify(analysis, null, 1));
await page.setViewportSize({width:390,height:844});
const scale = await page.evaluate(() => {
  const plot = document.getElementById("plot");
  const r = plot.getBoundingClientRect();
  return { elW: r.width, elH: r.height, bmpW: plot.width, bmpH: plot.height,
    scale: Math.min(r.width / plot.width, r.height / plot.height) };
});
console.log("phone scale", JSON.stringify(scale));
await browser.close(); server.close();
