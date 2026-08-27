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
await new Promise(r => server.listen(8124, r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8124/', { waitUntil: 'networkidle' });

const result = await page.evaluate(async () => {
  const { createInitialState } = await import('./game.js');
  const deviceHosts = new Set(['boiler-room', 'pipe-gallery', 'condenser-room']);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randSeed = n => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  const boilerAt1 = [];
  const firstHostsDevice = [];
  for (let i = 0; i < 20000; i++) {
    const s = randSeed(6);
    const st = createInitialState(s);
    const seq = st.gallerySequence;
    if (seq[1] === 'boiler-room' && boilerAt1.length < 3) boilerAt1.push(s);
    if (deviceHosts.has(seq[1]) && firstHostsDevice.length < 3) firstHostsDevice.push(s);
    if (boilerAt1.length >= 3 && firstHostsDevice.length >= 3) break;
  }

  // Also show what 'aab' and 'device-discovery-dom-test' now give
  const aab = createInitialState('aab').gallerySequence;
  const dd = createInitialState('device-discovery-dom-test').gallerySequence;
  const gs = createInitialState('gallery-seq-test').gallerySequence;
  return { boilerAt1, firstHostsDevice, aab, dd, gs };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
