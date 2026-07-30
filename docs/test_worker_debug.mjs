import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = '/home/runner/work/selfgrow/selfgrow/docs';
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css',
};

const server = http.createServer((req, res) => {
  let fp = req.url === '/' ? '/index.html' : req.url;
  fp = path.join(ROOT, fp);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(fp);
  try {
    const content = fs.readFileSync(fp);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch(e) {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(8087, async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', msg => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log('Navigating to http://localhost:8087/');
  await page.goto('http://localhost:8087/');
  await page.waitForTimeout(1500);

  console.log('=== Console messages after load ===');
  consoleMsgs.forEach(m => console.log(m));
  console.log('=== Page errors after load ===');
  pageErrors.forEach(e => console.log(e));

  // Set editor value
  await page.$eval('#editor', (el, val) => { el.value = val; }, '1 + 2');
  console.log('Set editor to: 1 + 2');

  // Click run
  await page.click('#runBtn');
  console.log('Clicked Run');
  await page.waitForTimeout(2000);

  // Check output
  const output = await page.$eval('#output', el => el.textContent);
  console.log('Output:', JSON.stringify(output));
  console.log('Page errors after run:', pageErrors.length > 0 ? pageErrors : 'none');

  await browser.close();
  server.close();
});
