import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = "/home/runner/work/selfgrow/selfgrow/docs";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json" };
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
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGE EXC:", e.message));
await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle", timeout: 20000 });
const out = await page.evaluate(async () => {
  const mod = await import("./selftest.js");
  const t = performance.now();
  const problems = await mod.checks();
  return { ms: Math.round(performance.now() - t), count: problems.length, problems: problems.map(String) };
});
console.log("elapsed", out.ms, "ms; failures:", out.count);
for (const p of out.problems) console.log("-", p);
await browser.close();
server.close();
