import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, normalize } from 'path';

const root = join(process.cwd(), 'docs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) { res.writeHead(403); return res.end(); }
    let stat;
    try { stat = await readFile(filePath); } catch { filePath = join(root, 'index.html'); stat = await readFile(filePath); }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
    res.end(stat);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => server.listen(8125, r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8125/', { waitUntil: 'networkidle' });
const result = await page.evaluate(async () => {
  const { createInitialState } = await import('./game.js');
  const out = {};
  for (const s of ['2g7w0o', '68h6cv', '47wjbo', 'kayu14', '0i470i']) {
    out[s] = createInitialState(s).gallerySequence;
  }
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
