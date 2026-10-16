import { chromium } from 'playwright';
const base = 'http://localhost:8765/';
const browser = await chromium.launch();
async function run(css, label, away=true, vp={width:390,height:844}) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto(base);
  await page.evaluate(async () => {
    const g = await import('./garden.js');
    g.setGarden({ beds: 4, plants: 20, seeds: 30, plantCounts: [12,8] });
    g.setGrowth(5000, 45, 40000, 20000, 12);
    g.writeStoredGarden(g.getGarden());
  });
  if (away) await page.addInitScript(() => { localStorage.setItem('selfgrow.garden.seen', String(Date.now()-3600*1000)); });
  await page.reload();
  if (css) await page.addStyleTag({ content: css });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const r = (s) => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.top),Math.round(b.bottom)]; };
    const btns = [...document.querySelectorAll('.garden-panel .actions .btn')].map(b=>[Math.round(b.getBoundingClientRect().top),Math.round(b.getBoundingClientRect().bottom)]);
    return {
      rfacts: r('#return-summary'), actions: r('.garden-panel .actions'), btns,
      plot: r('.garden-panel .plot'), openBed: r('#open-bed'), replant: r('#replant'),
      goal: r('.garden-panel .goal'),
      growth: r('.garden-panel [data-field="growth"]'), form: r('.garden-panel [data-field="form"]'),
      pageH: document.documentElement.scrollHeight, plotH: document.querySelector('.garden-panel .plot').clientHeight,
    };
  });
  console.log(label, JSON.stringify(info));
  await page.close();
}
function mk(v){ return `@media (max-width:759px){
  .plot{max-height:${v}dvh}
  .garden-side{display:grid;grid-template-columns:1fr 1fr;gap:0;align-items:start}
  .garden-side > .return-facts{grid-column:1/-1;font-size:11px;gap:4px 8px;padding-bottom:2px}
  .garden-side .actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
  .garden-side .actions .btn{min-width:0;min-height:40px;padding:8px 6px;font-size:12px;line-height:1.25}
  #tend{grid-column:1/-1}
  .garden-side > .plant{grid-column:auto;margin-top:6px;min-height:40px;padding:8px 6px;font-size:12px;line-height:1.25}
  .garden-side > .goal{grid-column:1/-1;margin-top:8px;padding-top:8px}
  .goal-title{font-size:13px}
  .meter{height:8px;margin:5px 0}
  .garden-side > .readout{grid-column:1/-1;margin-top:8px}
  .readout{gap:4px 10px}
  .garden-panel .readout-row:first-child{order:-2}
  .garden-panel .readout-row:has([data-field="form"]){order:-1}
}`; }
for (const v of [30,26,24,22,20]) await run(mk(v), 'v'+v+'-away', true);
await browser.close();
