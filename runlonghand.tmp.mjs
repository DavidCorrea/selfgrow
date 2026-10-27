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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: "networkidle" });
const res = await page.evaluate(async () => {
  const m = await import("./app.js");
  const snap = m.readCollection();
  const owned = snap.ownedCards ?? snap.cards;
  for (const card of owned) {
    if (m.readState().deck.length >= 10) break;
    for (let i = 0; i < card.copies && m.readState().deck.length < 10; i++) {
      try { m.addCardToDeck(card.id); } catch { break; }
    }
  }
  m.startMatch();
  m.showScreen("play");
  const report = [];
  const measure = (label) => {
    const hand = document.getElementById("match-hand");
    const bar = document.querySelector("#screen-play .actions");
    const r = hand.getBoundingClientRect();
    const cardRects = [...hand.querySelectorAll(".match-card")].map((c) => c.getBoundingClientRect());
    report.push({
      label,
      handCount: cardRects.length,
      handRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
      scroll: { sw: hand.scrollWidth, cw: hand.clientWidth, sh: hand.scrollHeight, ch: hand.clientHeight, overflowX: getComputedStyle(hand).overflowX },
      lastCard: cardRects.length ? { top: Math.round(cardRects.at(-1).top), bottom: Math.round(cardRects.at(-1).bottom), w: Math.round(cardRects.at(-1).width), h: Math.round(cardRects.at(-1).height) } : null,
      barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
      viewportH: document.documentElement.clientHeight,
      docScrollH: document.scrollingElement.scrollHeight,
    });
  };
  measure("start");
  // Just end turns without playing, so the hand grows.
  for (let i = 0; i < 8; i++) {
    try { m.endMatchTurn(); } catch (e) { report.push({ label: "endTurn " + i, error: e.message }); break; }
    measure("after endTurn " + (i + 1));
  }
  return report;
});
console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: "/tmp/phone-longhand.png" });
await browser.close();
server.close();
