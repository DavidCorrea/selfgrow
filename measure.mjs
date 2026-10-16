import { chromium } from 'playwright';
const base = 'http://localhost:8765/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto(base);
await page.evaluate(async () => {
  const g = await import('./garden.js');
  g.setGarden({ beds: 4, plants: 20, seeds: 30, plantCounts: [12,8] });
  g.setGrowth(5000, 45, 40000, 20000, 12);
  g.writeStoredGarden(g.getGarden());
});
await page.reload();
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const rects = {};
  for (const [k, sel] of Object.entries({
    hud: '.hud', panel: '.garden-panel', title: '#garden-heading', plot: '.plot',
    side: '.garden-side', rfacts: '#return-summary', actions: '.actions',
    tend: '#tend', herb: '#plant-seed', bloom: '#plant-bloom', replant: '#replant',
    goal: '.goal', readout: '.readout', growth: '[data-field="growth"]', form: '[data-field="form"]',
    openBed: '#open-bed',
  })) { rects[k] = r(q(sel)); }
  const out = {};
  for (const [k,v] of Object.entries(rects)) out[k] = v ? {top: Math.round(v.top), bottom: Math.round(v.bottom), h: Math.round(v.height), w: Math.round(v.width)} : null;
  const c = q('.plot');
  return { out, pageH: document.documentElement.scrollHeight, winH: window.innerHeight, canvas: {w:c.width,h:c.height, sw: c.clientWidth, sh: c.clientHeight},
    formText: q('[data-field="form"]')?.textContent, growthText: q('[data-field="growth"]')?.textContent };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
