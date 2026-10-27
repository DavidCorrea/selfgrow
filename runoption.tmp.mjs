import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = path.resolve("docs");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp", ".json": "application/json" };
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

const setup = async (page) => {
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
    // grow the hand to 8 by ending turns without playing
    for (let i = 0; i < 4; i++) { try { m.endMatchTurn(); } catch {} }
  });
  await page.waitForTimeout(200);
};

const measure = (page) => page.evaluate(() => {
  const paintedExtent = () => {
    let left = Infinity, right = -Infinity;
    for (const element of [...document.querySelectorAll("body *")].slice(0, 1500)) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const carries = ["IMG","SVG","CANVAS","VIDEO","INPUT","BUTTON","SELECT","TEXTAREA"].includes(element.tagName) ||
        [...element.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!carries) continue;
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      left = Math.min(left, r.left); right = Math.max(right, r.right);
    }
    return { left: Math.round(left), right: Math.round(right) };
  };
  const hand = document.getElementById("match-hand");
  const bar = document.querySelector("#screen-play .actions");
  const hr = hand.getBoundingClientRect();
  const cards = [...hand.querySelectorAll(".match-card")].map((c) => c.getBoundingClientRect());
  const art = hand.querySelector(".match-card svg.card-art")?.getBoundingClientRect();
  return {
    handCount: cards.length,
    handOuter: { top: Math.round(hr.top), bottom: Math.round(hr.bottom), w: Math.round(hr.width), h: Math.round(hr.height) },
    handScroll: { sw: hand.scrollWidth, cw: hand.clientWidth, sh: hand.scrollHeight, ch: hand.clientHeight, ox: getComputedStyle(hand).overflowX, oy: getComputedStyle(hand).overflowY },
    firstCard: cards[0] ? { w: Math.round(cards[0].width), h: Math.round(cards[0].height), top: Math.round(cards[0].top) } : null,
    art: art ? { w: Math.round(art.width), h: Math.round(art.height) } : null,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    docScroll: { sw: document.scrollingElement.scrollWidth, sh: document.scrollingElement.scrollHeight },
    extent: paintedExtent(),
  };
});

for (const vp of [{label:"phone390",w:390,h:844},{label:"phone320",w:320,h:568},{label:"desk1280",w:1280,h:720}]) {
  for (const opt of ["none", "horizontal", "vertical"]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.w < 800, hasTouch: vp.w < 800 });
    await setup(page);
    if (opt !== "none") {
      await page.addStyleTag({ content: opt === "horizontal"
        ? `.match-hand, .match-table { grid-template-columns: none !important; grid-auto-flow: column !important; grid-auto-columns: 9.5rem !important; overflow-x: auto !important; overflow-y: hidden !important; }`
        : `.match-hand { max-height: 12.5rem !important; overflow-y: auto !important; }` });
      await page.waitForTimeout(100);
    }
    const m = await measure(page);
    console.log(vp.label, opt, JSON.stringify(m));
    await page.close();
  }
}
await browser.close();
server.close();
