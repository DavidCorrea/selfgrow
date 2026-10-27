import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = path.resolve("docs");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".json": "application/json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(dir, p);
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const viewports = [
  { label: "default", opts: {} },
  { label: "desktop", opts: { viewport: { width: 1440, height: 900 } } },
  { label: "phone", opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
];
for (const vp of viewports) {
  const page = await browser.newPage(vp.opts);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
  const res = await page.evaluate(async () => {
    const mod = await import("./selftest.js");
    const t0 = performance.now();
    try {
      const problems = await mod.checks();
      return { ms: Math.round(performance.now() - t0), problems, w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    } catch (e) {
      return { error: e.message + "\n" + e.stack };
    }
  });
  console.log("=== " + vp.label + " " + (res.w ?? "") + "x" + (res.h ?? "") + " (" + res.ms + "ms) errors=" + errors.length);
  if (res.error) console.log("THREW:", res.error);
  else {
    console.log("failures:", res.problems.length);
    for (const p of res.problems) console.log(" - " + p);
  }
  if (errors.length) console.log("page errors:", errors.slice(0,5).join("\n"));
  await page.close();
}
await browser.close();
server.close();
