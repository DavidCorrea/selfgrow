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

server.listen(8088, async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Override the console to capture everything
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`ERROR: ${err.message}`));

  // Intercept requests to see what the page is trying to load for the worker
  page.on('request', req => {
    if (req.resourceType() === 'document' || req.resourceType() === 'script' || req.resourceType() === 'xhr' || req.resourceType() === 'fetch' || req.resourceType() === 'websocket') {
      logs.push(`REQUEST: ${req.resourceType()} ${req.url()}`);
    }
  });
  page.on('requestfailed', req => {
    logs.push(`FAILED: ${req.url()} - ${req.failure()?.errorText}`);
  });

  await page.goto('http://localhost:8088/');
  await page.waitForTimeout(1000);

  // Set editor and run
  await page.$eval('#editor', (el, val) => { el.value = val; }, '1 + 2');
  await page.click('#runBtn');
  await page.waitForTimeout(1500);

  const output = await page.$eval('#output', el => el.textContent);
  
  console.log('=== LOGS ===');
  logs.forEach(l => console.log(l));
  console.log('=== OUTPUT ===');
  console.log(JSON.stringify(output));

  await browser.close();
  server.close();
});
