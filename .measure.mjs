import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const dir = "/home/runner/work/selfgrow/selfgrow/docs";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); res.end(data); });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle" });
  const out = await page.evaluate(() => {
    const c = document.getElementById("garden-plot");
    const r = c.getBoundingClientRect();
    return { client: [c.clientWidth, c.clientHeight], rect: [Math.round(r.width), Math.round(r.height)], bitmap: [c.width, c.height], keys: Object.keys(localStorage) };
  });
  console.log(vp.width, JSON.stringify(out));
  await page.close();
}
await browser.close(); server.close();
