import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, normalize } from 'path';

const root = join(process.cwd(), 'docs');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) { res.writeHead(403); return res.end(); }
    let stat;
    try { stat = await readFile(filePath); } catch {
      filePath = join(root, 'index.html');
      stat = await readFile(filePath);
    }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
    res.end(stat);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

await new Promise(r => server.listen(8123, r));
const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

await page.goto('http://localhost:8123/', { waitUntil: 'networkidle' });
const started = performance.now();
const result = await page.evaluate(async () => {
  const mod = await import('./selftest.js');
  const problems = await mod.checks();
  return problems;
});
const elapsed = performance.now() - started;
console.log('--- SELFTEST RESULT ---');
console.log('Failures:', result.length);
for (const p of result) console.log('  -', p);
console.log('Elapsed:', Math.round(elapsed) + 'ms');
console.log('--- CONSOLE ERRORS ---');
for (const e of consoleErrors) console.log('  -', e);
await browser.close();
server.close();
process.exit(result.length > 0 ? 1 : 0);
