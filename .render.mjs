import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = "/home/runner/work/selfgrow/selfgrow/docs";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle" });
const shot = await page.evaluate(async () => {
  const pv = await import("./plotview.js");
  const app = await import("./app.js");
  const palette = app.readPalette();
  const state = { growth: 1e6, beds: 2, capacity: 24, plantCounts: [12, 0], pollinator: { visiting: false } };
  const c = document.createElement("canvas");
  pv.drawGarden(c, state, palette, 0);
  const plots = pv.plotBounds(state);
  const big = document.createElement("canvas");
  big.width = c.width * 5; big.height = c.height * 5;
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(c, 0, 0, big.width, big.height);
  return { data: big.toDataURL("image/png"), width: c.width, height: c.height, plotsWidth: plots.width, rows: plots.rows };
});
fs.writeFileSync("/tmp/render-current.png", Buffer.from(shot.data.split(",")[1], "base64"));
console.log(shot.width, shot.height, shot.plotsWidth, shot.rows);
await browser.close();
server.close();
