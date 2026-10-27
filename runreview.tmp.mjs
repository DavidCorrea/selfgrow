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
for (const vp of [{label:"desktop",w:1440,h:900,touch:false},{label:"phone",w:390,h:844,touch:true}]) {
  const page = await browser.newPage({ viewport:{width:vp.w,height:vp.h}, isMobile: vp.touch, hasTouch: vp.touch });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
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
  });
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const out = {};
    const q = (s) => document.querySelector(s);
    const hand = q("#match-hand");
    const cards = [...document.querySelectorAll("#match-hand .match-card, #match-table .match-card, #match-opponent-table .match-card")];
    out.handRect = hand.getBoundingClientRect().toJSON();
    out.handScroll = { sw: hand.scrollWidth, cw: hand.clientWidth, sh: hand.scrollHeight, ch: hand.clientHeight };
    out.cards = cards.map((c) => {
      const r = c.getBoundingClientRect();
      const art = c.querySelector("svg.card-art");
      const ar = art ? art.getBoundingClientRect() : null;
      const head = c.querySelector(".match-card-head");
      const hr = head ? head.getBoundingClientRect() : null;
      const btn = c.querySelector("button");
      const br = btn ? btn.getBoundingClientRect() : null;
      return { id: c.dataset.cardId, w: Math.round(r.width), h: Math.round(r.height), art: ar ? {w:Math.round(ar.width),h:Math.round(ar.height),top:Math.round(ar.top),bottom:Math.round(ar.bottom)} : null, head: hr?{top:Math.round(hr.top),bottom:Math.round(hr.bottom)}:null, btn: br?{top:Math.round(br.top),bottom:Math.round(br.bottom),w:Math.round(br.width),h:Math.round(br.height)}:null };
    });
    out.actionBar = q("#screen-play .actions")?.getBoundingClientRect().toJSON();
    out.handBottom = hand.getBoundingClientRect().bottom;
    out.viewport = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    out.docScroll = { sw: document.scrollingElement.scrollWidth, cw: document.documentElement.clientWidth };
    return out;
  });
  console.log("=== " + vp.label, JSON.stringify(info, null, 1));
  await page.screenshot({ path: `/tmp/${vp.label}-play.png`, fullPage: false });
  await page.close();
}
await browser.close();
server.close();
