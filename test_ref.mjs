import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', err => errors.push(err.message));
await page.goto('http://localhost:8877/');
await page.waitForTimeout(2000);
console.log('Page errors:', errors.length > 0 ? errors : 'none');

const refCount = await page.evaluate(() => document.querySelectorAll('.capability-item').length);
console.log('Capability items rendered:', refCount);

const runBtns = await page.$$('.example button');
console.log('Run buttons found:', runBtns.length);

if (runBtns.length > 0) {
  await runBtns[0].click();
  await page.waitForTimeout(500);
  const resultHandles = await page.$$('.example-result');
  const firstResult = await resultHandles[0].textContent();
  console.log('First example result:', JSON.stringify(firstResult));
}

await browser.close();
