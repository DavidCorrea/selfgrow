// Performance numbers for docs/: how it loads, then what it costs to leave it
// running. Measured at every viewport the App Review uses, with the phone's CPU
// slowed four times, because a fast desktop hides what a cheap phone feels.
//
//   node agents/skills/interface-performance/measure.mjs [seconds]
//
// `seconds` is how long the page is left running after load; it defaults to 15.
// Nothing here is pressed or typed: it measures the page a visitor leaves open.
import { join } from "path";
import { chromium } from "playwright";
import { repoRoot } from "../../paths.mjs";
import { startStaticServer, REVIEW_VIEWPORTS, viewportOptions } from "../../verify.mjs";

const PHONE_CPU_SLOWDOWN = 4;
const LONG_TASK_MS = 50;

const seconds = Number(process.argv[2] ?? 15);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120) {
  console.error(`Run length "${process.argv[2]}" must be a number of seconds between 1 and 120.`);
  process.exit(1);
}

// Installed before any page script runs, so the first long task and the first
// shift are caught too.
function installObservers() {
  window.__performance = { longTasks: [], shifts: [], frames: 0 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__performance.longTasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) window.__performance.shifts.push({ start: entry.startTime, value: entry.value });
    }
  }).observe({ type: "layout-shift", buffered: true });
  const countFrame = () => {
    window.__performance.frames += 1;
    requestAnimationFrame(countFrame);
  };
  requestAnimationFrame(countFrame);
}

const heapMegabytes = async (cdp) => {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.find((metric) => metric.name === "JSHeapUsedSize").value / 1_048_576;
};

const pageState = (page) =>
  page.evaluate(() => ({
    now: performance.now(),
    elements: document.getElementsByTagName("*").length,
    frames: window.__performance.frames,
  }));

async function measure(browser, url, viewport) {
  const context = await browser.newContext(viewportOptions(viewport));
  await context.addInitScript(installObservers);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const slowdown = viewport.touch ? PHONE_CPU_SLOWDOWN : 1;
  if (slowdown > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowdown });

  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  const load = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const firstPaint = performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint");
    return {
      firstPaintMs: firstPaint ? firstPaint.startTime : null,
      loadedMs: navigation.loadEventEnd,
      requests: performance.getEntriesByType("resource").length + 1,
    };
  });

  const start = { ...(await pageState(page)), heap: await heapMegabytes(cdp) };
  await page.waitForTimeout(seconds * 1000);
  const end = { ...(await pageState(page)), heap: await heapMegabytes(cdp) };
  const recorded = await page.evaluate(() => window.__performance);
  await context.close();

  const during = (entry) => entry.start >= start.now && entry.start < end.now;
  const loadTasks = recorded.longTasks.filter((task) => task.start < start.now);
  const runTasks = recorded.longTasks.filter(during);
  const sum = (entries, field) => entries.reduce((total, entry) => total + entry[field], 0);
  const runSeconds = (end.now - start.now) / 1000;

  return [
    `== ${viewport.label} (${viewport.width}x${viewport.height}${slowdown > 1 ? `, CPU ${slowdown}x slower` : ""})`,
    `load: first paint ${load.firstPaintMs === null ? "never" : `${Math.round(load.firstPaintMs)} ms`}, loaded ${Math.round(load.loadedMs)} ms, ${load.requests} requests`,
    `load: ${loadTasks.length} long tasks (over ${LONG_TASK_MS} ms), longest ${Math.round(Math.max(0, ...loadTasks.map((task) => task.duration)))} ms`,
    `load: layout shift ${sum(recorded.shifts.filter((shift) => shift.start < start.now), "value").toFixed(3)}`,
    `running ${Math.round(runSeconds)} s: ${runTasks.length} long tasks, ${Math.round(sum(runTasks, "duration"))} ms blocked, longest ${Math.round(Math.max(0, ...runTasks.map((task) => task.duration)))} ms`,
    `running ${Math.round(runSeconds)} s: ${Math.round((end.frames - start.frames) / runSeconds)} frames per second`,
    `running ${Math.round(runSeconds)} s: layout shift ${sum(recorded.shifts.filter(during), "value").toFixed(3)}`,
    `running ${Math.round(runSeconds)} s: elements ${start.elements} → ${end.elements}, JS heap ${start.heap.toFixed(1)} → ${end.heap.toFixed(1)} MB`,
  ].join("\n");
}

const { server, port } = await startStaticServer(join(repoRoot, "docs"));
const browser = await chromium.launch();
try {
  for (const viewport of REVIEW_VIEWPORTS) {
    console.log(await measure(browser, `http://127.0.0.1:${port}/`, viewport));
  }
} finally {
  await browser.close();
  server.close();
}
