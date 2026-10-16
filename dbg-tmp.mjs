import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', m=>console.log('PAGE:', m.text()));
await page.goto('http://localhost:8765/');
await page.evaluate(async () => {
  const g = await import('./garden.js');
  g.setGarden({ beds: 4, plants: 20, seeds: 30, plantCounts: [12,8] });
  g.setGrowth(5000, 45, 40000, 20000, 12);
  g.writeStoredGarden(g.getGarden());
  g.writeLastSeen(Date.now() - 3600*1000);
  console.log('seen written', localStorage.getItem('selfgrow.garden.seen'));
});
await page.reload();
await page.waitForTimeout(800);
console.log(await page.evaluate(()=>{ const e=document.getElementById('return-summary'); return {hidden:e.hidden, h:e.getBoundingClientRect().height, text:e.textContent.slice(0,200), seen: localStorage.getItem('selfgrow.garden.seen'), now: Date.now()}; }));
await browser.close();
