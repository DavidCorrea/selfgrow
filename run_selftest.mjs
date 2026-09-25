import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

function serveDir(dir, port) {
  const server = http.createServer((req, res) => {
    let filePath = path.join(dir, req.url === "/" ? "index.html" : req.url);
    filePath = filePath.split("?")[0];
    filePath = path.resolve(filePath);
    if (!filePath.startsWith(path.resolve(dir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    const mime = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".css": "text/css",
    }[ext] || "application/octet-stream";
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({ server, url: `http://localhost:${port}` });
    });
  });
}

async function run() {
  const docsDir = path.resolve("/home/runner/work/selfgrow/selfgrow/docs");
  const { server, url } = await serveDir(docsDir, 8787);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  
  await page.goto(url + "/index.html");
  await page.waitForTimeout(1500); // let it initialize

  const debug = await page.evaluate(() => {
    const plotEl = document.getElementById('plot-description');
    const weatherEl = document.getElementById('weather-display');
    const timeEl = document.getElementById('time-display');
    
    const gs = window.__gardenState;
    
    // Set up clean test state
    weatherEl.textContent = "Clear";
    plotEl.textContent = "A young seedling rises from the rich soil, stretching toward the sun.";
    
    // Trace what happens INSIDE updateWeatherDescription
    // by calling the individual functions manually
    const weatherCtx = gs.chooseWeatherContext();
    const timeCtx = gs.chooseTimeOfDayContext();
    const allContextsStrs = gs._allContextStrings;
    
    // Check what was returned
    const weatherCtxValue = eval('window.__gardenState.chooseWeatherContext()');
    
    // Let me see the actual updateWeatherDescription source
    const fnStr = gs.updateWeatherDescription.toString();
    
    return {
      weatherCtx: weatherCtx,
      timeCtx: timeCtx,
      weatherCtxValue: weatherCtxValue,
      weatherDisplay: weatherEl.textContent,
      plotBefore: plotEl.textContent,
      fnSnippet: fnStr.substring(0, 200),
    };
  });
  
  console.log("DEBUG:", JSON.stringify(debug, null, 2));
  
  await browser.close();
  server.close();
}

run().catch(err => { console.error(err); process.exit(1); });