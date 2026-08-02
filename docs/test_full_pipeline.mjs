import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
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

server.listen(8091, async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:8091/');
  await page.waitForTimeout(1500);

  // Test 1: 1 + 2 => 3
  await page.$eval('#editor', (el, val) => { el.value = val; }, '1 + 2');
  await page.click('#runBtn');
  await page.waitForTimeout(1500);
  const out1 = await page.$eval('#output', el => el.textContent);
  console.log('Test 1 (1+2=3):', out1 === '3' ? 'PASS' : 'FAIL (' + out1 + ')');

  // Test 2: print("hello") => hello
  await page.$eval('#editor', (el, val) => { el.value = val; }, 'print("hello")');
  await page.click('#runBtn');
  await page.waitForTimeout(1500);
  const out2 = await page.$eval('#output', el => el.textContent);
  console.log('Test 2 (print hello):', out2 === 'hello' ? 'PASS' : 'FAIL (' + out2 + ')');

  // Test 3: 1/0 => structured error
  await page.$eval('#editor', (el, val) => { el.value = val; }, '1 / 0');
  await page.click('#runBtn');
  await page.waitForTimeout(1500);
  const out3 = await page.$eval('#output', el => el.textContent);
  const hasStructuredError = out3.includes('RuntimeError') && out3.includes('division by zero');
  console.log('Test 3 (1/0 structured error):', hasStructuredError ? 'PASS' : 'FAIL (' + out3 + ')');

  // Test 4: Run button re-enables
  const btnDisabled = await page.$eval('#runBtn', el => el.disabled);
  console.log('Test 4 (run button re-enables):', !btnDisabled ? 'PASS' : 'FAIL (still disabled)');

  // Test 5: Complex program
  await page.$eval('#editor', (el, val) => { el.value = val; }, 'fn double(x) = x + x\ndouble(5)');
  await page.click('#runBtn');
  await page.waitForTimeout(1500);
  const out5 = await page.$eval('#output', el => el.textContent);
  console.log('Test 5 (fn double(5)=10):', out5 === '10' ? 'PASS' : 'FAIL (' + out5 + ')');

  // Test 6: unknownVar shows error in output (not page error)
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.$eval('#editor', (el, val) => { el.value = val; }, 'unknownVar');
  await page.click('#runBtn');
  await page.waitForTimeout(1500);
  const out6 = await page.$eval('#output', el => el.textContent);
  console.log('Test 6 (unknownVar in output not page error):');
  console.log('  Page errors:', pageErrors.length === 0 ? 'none (good)' : pageErrors.join(', '));
  console.log('  Output contains error:', out6.includes('Undefined symbol') ? 'PASS' : 'FAIL (' + out6 + ')');

  await browser.close();
  server.close();
});
