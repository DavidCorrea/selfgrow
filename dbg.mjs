import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:390,height:844} });
await page.goto('http://localhost:8765/');
await page.evaluate(async () => {
  const g = await import('./garden.js');
  g.setGarden({ beds: 4, plants: 20, seeds: 30, plantCounts: [12,8] });
  g.setGrowth(5000, 45, 40000, 20000, 12);
  g.writeStoredGarden(g.getGarden());
  localStorage.setItem('selfgrow.garden.seen', String(Date.now()-3600*1000));
  return localStorage.getItem('selfgrow.garden.seen');
});
await page.reload();
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const e = document.getElementById('return-summary');
  return {seen: localStorage.getItem('selfgrow.garden.seen'), now: Date.now(), hidden: e.hidden, html: e.innerHTML.slice(0,400), r: e.getBoundingClientRect().height};
});
console.log(JSON.stringify(info,null,2));
await browser.close();
