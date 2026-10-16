import { chromium } from 'playwright';
const base = 'http://localhost:8765/';
const css = process.argv[2] || '';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto(base);
await page.evaluate(async () => {
  const g = await import('./garden.js');
  const app = await import('./app.js');
  g.setGarden({ beds: 4, plants: 20, seeds: 30, plantCounts: [12,8] });
  g.setGrowth(5000, 45, 40000, 20000, 12);
  g.writeStoredGarden(g.getGarden());
  app.applyReturn(g.getGrowthState(), Date.now() - 3600*1000, Date.now());
});
await page.waitForTimeout(600);
if (css) await page.addStyleTag({ content: css });
await page.waitForTimeout(200);
const info = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => el ? el.getBoundingClientRect() : null;
  const sels = {hud:'.hud', panel:'.garden-panel', title:'#garden-heading', plot:'.plot', side:'.garden-side',
    rfacts:'#return-summary', actions:'.actions', tend:'#tend', herb:'#plant-seed', bloom:'#plant-bloom',
    replant:'#replant', openBed:'#open-bed', goal:'.goal', readout:'.readout', growth:'[data-field="growth"]',
    form:'[data-field="form"]', season:'[data-field="season"]', lifetime:'[data-field="lifetime"]', foot:'.foot'};
  const out = {};
  for (const [k,s] of Object.entries(sels)) { const v=r(q(s)); out[k]= v?{t:Math.round(v.top),b:Math.round(v.bottom),h:Math.round(v.height),w:Math.round(v.width)}:null; }
  const c=q('.plot');
  const vis = (s)=>{const el=q(s); if(!el||el.hidden) return false; const v=el.getBoundingClientRect(); return v.top>=0&&v.bottom<=window.innerHeight;};
  const imgEl=q('.plot');
  return {out, pageH: document.documentElement.scrollHeight, winH: window.innerHeight,
    canvas:{w:imgEl.width,h:imgEl.height,sw:imgEl.clientWidth,sh:imgEl.clientHeight},
    fits:{tend:vis('#tend'),herb:vis('#plant-seed'),bloom:vis('#plant-bloom'),replant:vis('#replant'),growth:vis('[data-field="growth"]'),form:vis('[data-field="form"]')}};
});
const o=info.out;
console.log('pageH', info.pageH, (info.pageH/844).toFixed(2), 'canvas', JSON.stringify(info.canvas));
console.log('hud',o.hud.h,'panelTop',o.panel.t,'plot',o.plot.t,o.plot.h,'rfacts',o.rfacts&&o.rfacts.h,'actions',o.actions.t,o.actions.h,'replant',o.replant.t,o.replant.h,'goal',o.goal.t,o.goal.h,'readout',o.readout.t,'growth',o.growth.t,o.growth.b,'form',o.form.t,o.form.b);
console.log('fits', JSON.stringify(info.fits));
await browser.close();
