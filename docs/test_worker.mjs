import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
const requests = [];
page.on('pageerror', (err) => {
  errors.push(err.message);
  console.error('Page error:', err.message);
});

page.on('request', req => {
  requests.push({ url: req.url(), resourceType: req.resourceType(), method: req.method() });
});
page.on('requestfailed', req => {
  console.error('Request failed:', req.url(), req.failure()?.errorText);
});

await page.goto('http://localhost:8082');
await page.waitForTimeout(1000);

console.log('=== Requests ===');
for (const r of requests) {
  console.log(`${r.resourceType}: ${r.url}`);
}

// Try running a program
await page.$eval('#editor', (el, val) => { el.value = val; }, '1 + 2');
await page.click('#runBtn');
await page.waitForTimeout(2000);

const outputText = await page.$eval('#output', el => el.textContent);
console.log('Output after run:', JSON.stringify(outputText));
console.log('Page errors:', errors.length > 0 ? errors : 'none');

// Check worker creation
const workerInfo = await page.evaluate(() => {
  // Check if worker exists
  return typeof Worker !== 'undefined' ? 'Worker supported' : 'Worker not supported';
});
console.log('Worker support:', workerInfo);

await browser.close();
