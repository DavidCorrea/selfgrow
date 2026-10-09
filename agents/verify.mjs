// Judging a built product: verifyBuild gates a merge, reviewApp measures the
// page for the Playtester.

import { execFileSync } from "child_process";
import fs from "fs";
import http from "http";
import { join, extname, relative } from "path";
import { log, errorData } from "./log.mjs";
import { projectSkillProblems } from "./agent.mjs";
import { repoRoot } from "./paths.mjs";

// ---------------------------------------------------------------------------
// Layered build verification: syntax → static analysis (lint) → runtime smoke.
// Cheap checks first; stop at the first failing layer. ESLint and Playwright
// are best-effort — if a tool isn't installed, that layer is skipped (warned),
// never blocking the pipeline.
// ---------------------------------------------------------------------------

function listJsFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const STATIC_MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

/**
 * Serve a directory on a random loopback port. Exported so an agent that drives
 * the live app can host it the same way the build's own verify does, rather than
 * standing up a second, subtly different server.
 */
export function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const filePath = join(rootDir, p);
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": STATIC_MIME[extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Chromium, when there is a page to load and Playwright to load it with; null
 * otherwise, saying which. Both are skips rather than failures: a brand-new
 * project has no page yet, and a runner without Playwright still has to ship.
 */
async function chromiumFor(dir, prefix, skipping) {
  if (!fs.existsSync(join(dir, "index.html"))) {
    log("info", `${prefix}: no index.html yet — ${skipping}.`);
    return null;
  }
  try {
    return (await import("playwright")).chromium;
  } catch (e) {
    log("warn", `${prefix}: Playwright unavailable — ${skipping}.`, errorData(e));
    return null;
  }
}

/**
 * Serve `dir` and launch Chromium, hand both to `use(browser, url)`, and close
 * them afterwards however `use` ends. A browser that will not launch throws, with
 * the server already closed.
 */
async function withServedSite(chromium, dir, use) {
  const { server, port } = await startStaticServer(dir);
  let browser;
  try {
    browser = await chromium.launch();
    return await use(browser, `http://127.0.0.1:${port}/`);
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
}

/**
 * Load the page and run `inPage(arg)` inside it, where it can import the
 * product's own modules. Returns what `inPage` returned, or null — logged — when
 * the product has no `file` yet or the page could not run it.
 *
 * A product that ships no such file yet passes its layer, so a brand-new repo
 * isn't blocked before it has anything to check. No model is involved in either
 * layer, so they cost nothing and cannot be argued with.
 */
async function runInProductPage(browser, url, dir, { file, layer, what, inPage, arg }) {
  if (!fs.existsSync(join(dir, file))) {
    log("info", `Verify: no docs/${file} yet — skipping the ${layer} layer.`);
    return null;
  }
  let page;
  try {
    page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    return await page.evaluate(inPage, arg);
  } catch (e) {
    log("warn", `Verify: ${what} could not run.`, errorData(e));
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}

// How long the product's whole self-check suite may run. A suite that can hang
// the page is itself a defect, and a Builder waiting on it is burning its clock.
const SELF_TEST_TIMEOUT_MS = 2000;

/**
 * Run the product's own self-checks, in the real browser, against the real page.
 *
 * Layers 1-3 prove the code parses, lints, and loads without throwing. None of
 * them prove the product actually DOES what it claims — which is exactly the
 * failure a Builder is most likely to ship, because it looks green everywhere
 * else. This is where that claim is enforced.
 *
 * The contract is deliberately tiny (see agents/prompts/_product-contract.md):
 * `docs/selftest.js` exports `checks()`, which returns an array of
 * human-readable failure strings — empty when everything holds. What counts as
 * a check is the product's business; that it can be executed is ours.
 */
async function checkSelfTests(browser, url, dir) {
  const failures = await runInProductPage(browser, url, dir, {
    file: "selftest.js",
    layer: "self-check",
    what: "self-checks",
    arg: { timeoutMs: SELF_TEST_TIMEOUT_MS },
    inPage: async ({ timeoutMs }) => {
      let mod;
      try {
        mod = await import("./selftest.js");
      } catch (e) {
        return [`docs/selftest.js could not be imported — ${e.message}`];
      }
      if (typeof mod.checks !== "function") {
        return ["docs/selftest.js does not export checks()"];
      }

      // Time the suite here rather than letting the browser give up, so a
      // runaway check is reported as the product's failure to bound itself.
      const started = performance.now();
      let problems;
      try {
        problems = await mod.checks();
      } catch (e) {
        return [`docs/selftest.js checks() threw — ${e.message}`];
      }
      const elapsed = performance.now() - started;
      if (elapsed > timeoutMs) {
        return [`docs/selftest.js checks() took ${Math.round(elapsed)}ms — it must finish within ${timeoutMs}ms`];
      }
      if (!Array.isArray(problems)) {
        return ["docs/selftest.js checks() did not return an array of failure strings"];
      }
      return problems.map(String).slice(0, 12); // enough to act on
    },
  });
  return failures ?? [];
}

// How long the whole tool layer may take to answer. Every handler is called
// once, so this bounds the product, not a single tool.
const AGENT_TOOLS_TIMEOUT_MS = 3000;

// A tool name is what an agent types. Lowercase kebab-case keeps it unambiguous
// across the JSON boundary and matches the names in the WebMCP specification's
// own examples.
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Below this a description is a label, not an interface. The caller cannot see
// the screen and picks the tool from these words alone.
const MIN_TOOL_DESCRIPTION_CHARS = 40;

/**
 * Judge the tool descriptors a product declares.
 *
 * Pure, and separate from the browser work on purpose: everything here is a
 * property of the descriptors themselves, so it can be tested in Node against
 * hand-written cases instead of only against whatever the product happens to
 * ship today. The browser's job is to collect these summaries and to call the
 * handlers; deciding what is wrong with them is this function's.
 *
 * `summaries` are plain objects, one per tool — see checkAgentTools.
 * Returns an array of plain-language failure messages, empty when all holds.
 */
export function validateToolDescriptors(summaries) {
  if (!Array.isArray(summaries)) {
    return ["docs/agenttools.js tools() did not return an array of tool descriptors"];
  }
  if (!summaries.length) {
    return ["docs/agenttools.js tools() returned no tools — a product no agent can use"];
  }

  const problems = [];
  const seen = new Set();

  for (const [index, tool] of summaries.entries()) {
    const label = tool.name ? `"${tool.name}"` : `tool #${index + 1}`;

    if (!tool.name) {
      problems.push(`${label} has no name — every tool needs one an agent can call it by.`);
    } else if (!TOOL_NAME_PATTERN.test(tool.name)) {
      problems.push(`${label} is not a lowercase kebab-case name (expected e.g. "get-state").`);
    } else if (seen.has(tool.name)) {
      problems.push(`${label} is declared twice — a caller cannot tell which one it is invoking.`);
    }
    if (tool.name) seen.add(tool.name);

    const description = (tool.description || "").trim();
    if (!description) {
      problems.push(`${label} has no description — it is the whole interface, and the caller cannot see the screen.`);
    } else if (description.length < MIN_TOOL_DESCRIPTION_CHARS) {
      problems.push(
        `${label} has a ${description.length}-character description — say what it returns and when it is worth `
        + `asking, in at least ${MIN_TOOL_DESCRIPTION_CHARS} characters.`
      );
    }

    if (!tool.inputSchema || tool.inputSchema.type !== "object") {
      problems.push(`${label} needs an inputSchema that is a JSON Schema object (\`{ type: "object", ... }\`).`);
    }

    if (!tool.hasExecute) {
      problems.push(`${label} has no execute() — a described capability nothing implements.`);
    }
    if (!tool.hasExample) {
      problems.push(`${label} has no example input — the build calls every tool, and cannot call this one.`);
    }

    if (tool.mutates && !tool.annotated) {
      problems.push(
        `${label} changes something but declares no annotations — set readOnlyHint: false, and `
        + `consequentialHint: true when it is destructive, so a caller knows whether to ask a human first.`
      );
    }

    if (tool.invocation && !tool.invocation.ok) {
      problems.push(`${label} failed when called with its own example — ${tool.invocation.error}`);
    }
  }

  return problems;
}

/**
 * Run the product's declared tools, in the real browser, on the real page.
 *
 * The self-check contract proves the product does what it claims for a person.
 * This proves it does what it claims for an agent — a surface that is invisible
 * in every other layer, because a broken tool breaks no page and throws no
 * console error. It is assembled one ticket at a time by whoever ships each
 * feature, which is the same way selftest.js is assembled and the same reason
 * somebody has to read it whole.
 *
 * Registration is deliberately NOT exercised here: `document.modelContext` does
 * not exist in headless Chromium, so the only honest thing to verify is that the
 * descriptors are sound and the handlers work. Whether the browser accepts them
 * is docs/webmcp.js's business, and it is one call.
 */
async function checkAgentTools(browser, url, dir) {
  const result = await runInProductPage(browser, url, dir, {
    file: "agenttools.js",
    layer: "agent-tools",
    what: "agent tools",
    arg: { timeoutMs: AGENT_TOOLS_TIMEOUT_MS },
    inPage: async ({ timeoutMs }) => {
      let mod;
      try {
        mod = await import("./agenttools.js");
      } catch (e) {
        return { fatal: `docs/agenttools.js could not be imported — ${e.message}` };
      }
      if (typeof mod.tools !== "function") {
        return { fatal: "docs/agenttools.js does not export tools()" };
      }

      let declared;
      try {
        declared = mod.tools();
      } catch (e) {
        return { fatal: `docs/agenttools.js tools() threw — ${e.message}` };
      }
      if (!Array.isArray(declared)) return { summaries: declared };

      const deadline = Date.now() + timeoutMs;
      const collected = [];
      for (const tool of declared) {
        const summary = {
          name: tool && tool.name,
          description: tool && tool.description,
          inputSchema: tool && tool.inputSchema,
          hasExecute: !!(tool && typeof tool.execute === "function"),
          hasExample: !!(tool && tool.example !== undefined),
          annotated: !!(tool && tool.annotations),
          mutates: !(tool && tool.annotations && tool.annotations.readOnlyHint),
        };

        if (summary.hasExecute && summary.hasExample) {
          const remaining = deadline - Date.now();
          const controller = new AbortController();
          try {
            if (remaining <= 0) throw new Error("the tool layer ran out of time before this tool was reached");
            const result = await Promise.race([
              tool.execute(tool.example, { signal: controller.signal }),
              new Promise((_, reject) =>
                setTimeout(() => {
                  controller.abort();
                  reject(new Error(`it did not answer within ${timeoutMs}ms`));
                }, remaining)
              ),
            ]);
            // An agent receives this across a JSON boundary, so a result it
            // cannot carry is the same as no result at all.
            JSON.stringify(result === undefined ? null : result);
            summary.invocation = { ok: true };
          } catch (e) {
            summary.invocation = { ok: false, error: e.message };
          }
        }

        collected.push(summary);
      }
      return { summaries: collected };
    },
  });
  if (!result) return [];
  if (result.fatal) return [result.fatal];
  return validateToolDescriptors(result.summaries).slice(0, 12);
}

const PASSED = { ok: true, layer: null, errors: [] };
const failed = (layer, errors) => ({ ok: false, layer, errors: [...new Set(errors)] });

/** Run `layers` ([name, check] pairs) in order; the first to report errors fails the build. */
async function firstFailingLayer(layers) {
  for (const [layer, check] of layers) {
    const errors = await check();
    if (errors.length) return failed(layer, errors);
  }
  return null;
}

function syntaxErrors(dir) {
  const errors = [];
  for (const file of listJsFiles(dir)) {
    try {
      execFileSync(process.execPath, ["--check", file], { cwd: repoRoot, stdio: "pipe" });
    } catch (e) {
      errors.push(`${relative(repoRoot, file)}: ${String(e.stderr || e.message).split("\n")[0]}`);
    }
  }
  return errors;
}

/** ESLint's errors under `relDir`, or none when ESLint is unavailable (warned). */
async function lintErrors(relDir) {
  try {
    const { ESLint } = await import("eslint");
    // Don't throw when a pattern matches nothing (no .mjs files, or an empty
    // docs/ on a brand-new project) — that's not a verification failure.
    const eslint = new ESLint({ errorOnUnmatchedPattern: false });
    const results = await eslint.lintFiles([join(relDir, "**/*.js"), join(relDir, "**/*.mjs")]);
    return results.flatMap((result) =>
      result.messages
        .filter((message) => message.severity === 2)
        .map((message) => `${relative(repoRoot, result.filePath)}:${message.line} ${message.message} (${message.ruleId || "parse"})`)
    );
  } catch (e) {
    log("warn", "Verify: ESLint unavailable — skipping lint layer.", errorData(e));
    return [];
  }
}

/**
 * Load the page and collect what goes wrong: console errors, uncaught exceptions,
 * failed loads. The page stays open and keeps listening while the later layers
 * run, so the array can still grow after this returns.
 */
async function pageLoadErrors(browser, url) {
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    page.on("requestfailed", (r) => {
      const t = r.failure()?.errorText || "";
      if (!/aborted/i.test(t)) errors.push(`failed load: ${r.url()} (${t})`);
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2500);
  } catch (e) {
    errors.push(`navigation: ${e.message}`);
  }
  return errors;
}

/**
 * Verify the built app under `relDir`. Returns { ok, layer, errors }:
 *   - layer "syntax"     — a JS file fails `node --check`
 *   - layer "lint"       — ESLint reports an error (e.g. no-undef: undefined function)
 *   - layer "skills"     — a skill in docs/skills/ would not load (see projectSkillProblems)
 *   - layer "runtime"    — the page throws a console error / uncaught exception / failed load
 *   - layer "selftest"   — the product's own checks() reported a broken claim
 *   - layer "agenttools" — a tool the product declares is unsound or does not run
 * ok:true (layer null) means all available layers passed (or were skipped).
 */
export async function verifyBuild(relDir = "docs") {
  const dir = join(repoRoot, relDir);
  const staticFailure = await firstFailingLayer([
    ["syntax", () => syntaxErrors(dir)],
    ["lint", () => lintErrors(relDir)],
    // Only for the real product: it is the one whose skills the agents are handed.
    ["skills", () => (dir === join(repoRoot, "docs") ? projectSkillProblems() : [])],
  ]);
  if (staticFailure) return staticFailure;

  const chromium = await chromiumFor(dir, "Verify", "skipping runtime check");
  if (!chromium) return PASSED;
  try {
    return await withServedSite(chromium, dir, async (browser, url) => {
      const loadErrors = await pageLoadErrors(browser, url);
      // The product against its own claims, then against what it promises an
      // agent — each only once the layer before it is sound, because a page that
      // is already throwing fails its checks, and a product failing its checks
      // reports broken tools, from the same root cause.
      const productFailure = loadErrors.length
        ? null
        : await firstFailingLayer([
            ["selftest", () => checkSelfTests(browser, url, dir)],
            ["agenttools", () => checkAgentTools(browser, url, dir)],
          ]);
      // Read the load errors last: the page went on listening while the product's
      // own layers ran, and anything it reported meanwhile is still the page failing.
      if (loadErrors.length) return failed("runtime", loadErrors);
      return productFailure ?? PASSED;
    });
  } catch (e) {
    // The browser would not launch, so the page never loaded.
    return failed("runtime", [`navigation: ${e.message}`]);
  }
}

// ---------------------------------------------------------------------------
// App review — judge the built site WITHOUT a vision model.
//
// The agents can't see, but "can't see" turned out not to require a pair of eyes:
// everything a screenshot critique was asked to spot — overflow, overlap,
// unreadable contrast, collapsed regions, broken images, unstyled content — is a
// measurable property of the rendered page. So the browser measures it directly
// via getBoundingClientRect + getComputedStyle, and reports exact selectors
// instead of "something looks off on mobile".
//
// This is deterministic, costs ZERO model requests, and cannot invent a defect
// that isn't there — which matters more than it sounds: a hallucinated defect
// became a ticket, and the Builder then spent real requests "fixing" nothing.
// ---------------------------------------------------------------------------

// Viewports the layout is measured at. Defects are reported per viewport, since
// nearly all of them are width-dependent.
//
// The phone is a real one, not a narrow desktop window: touch and isMobile change
// what the page is told about itself (pointer media queries, the meta viewport),
// and a layout that only reflows for a narrow mouse-driven window has not been
// tested on the device a visitor holds. The desktop is a common laptop-to-monitor
// size wide enough that a layout leaving most of it empty is visibly doing so.
export const REVIEW_VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900, touch: false },
  { label: "phone", width: 390, height: 844, touch: true },
];

// Playwright context options for a viewport, so every page opened at one is the
// same device rather than the same width.
export const viewportOptions = (vp) => ({
  viewport: { width: vp.width, height: vp.height },
  isMobile: vp.touch,
  hasTouch: vp.touch,
});

// A page whose content spans less than this share of a desktop window is a
// narrow column in the middle of an empty screen. Loose on purpose: a sidebar
// layout with generous margins clears it easily, and only a layout that ignores
// most of the window does not.
const MIN_DESKTOP_CONTENT_SPAN = 0.6;

// The smallest comfortable touch target. WCAG asks for 44px at AAA and 24px at
// AA; 40 sits between them because a phone game is tapped repeatedly, and a
// target a thumb misses one time in five is a control that does not work.
const MIN_TAP_TARGET_PX = 40;

/**
 * How much of a desktop window the page's content actually uses, as a defect
 * message — or null when it uses enough. `span` is the horizontal extent of every
 * visible piece of content (text, media, controls) — not of the containers around
 * it, since a full-width background behind a centred column is still a column.
 */
export function describeNarrowLayout({ viewportWidth, contentLeft, contentRight }) {
  if (!(viewportWidth > 0) || !(contentRight > contentLeft)) return null;
  const left = Math.max(0, contentLeft);
  const right = Math.min(viewportWidth, contentRight);
  const share = (right - left) / viewportWidth;
  if (share >= MIN_DESKTOP_CONTENT_SPAN) return null;
  return `narrow centre column: content spans ${Math.round(share * 100)}% of the ${viewportWidth}px window ` +
    `(${Math.round(left)}px to ${Math.round(right)}px) — a large screen should use the whole window, ` +
    `not leave ${Math.round((1 - share) * 100)}% of it empty.`;
}

/**
 * Controls too small to hit reliably with a thumb, as defect messages — capped
 * like every other kind, so a toolbar of tiny icons names the worst few rather
 * than all of them. `targets` are the rendered boxes of interactive elements.
 */
export function describeSmallTapTargets(targets) {
  // A box a pixel thin is the visually-hidden pattern (a skip link, a label for
  // screen readers) — present for assistive technology, never meant to be tapped.
  const isVisuallyHidden = (target) => target.width <= 1 || target.height <= 1;
  return targets
    .filter((target) => !isVisuallyHidden(target))
    .filter((target) => target.width < MIN_TAP_TARGET_PX || target.height < MIN_TAP_TARGET_PX)
    .sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))
    .slice(0, MAX_DEFECTS_PER_KIND)
    .map((target) =>
      `tap target ${Math.round(target.width)}x${Math.round(target.height)}px is under the ${MIN_TAP_TARGET_PX}px minimum for touch: ${target.label}`
    );
}

/**
 * The raw boxes the screen-use checks above judge: the horizontal extent of all
 * visible content, and the size of every visible control. Measured in the page,
 * judged in node, so the thresholds are testable without a browser.
 */
async function measureScreenUse(page) {
  return page.evaluate(() => {
    const isShown = (el, rect) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${text ? ` ("${text}")` : ""}`;
    };

    let contentLeft = Infinity;
    let contentRight = -Infinity;
    for (const el of [...document.querySelectorAll("body *")].slice(0, 1500)) {
      const isContent = ["IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(el.tagName.toUpperCase()) ||
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!isContent) continue;
      const rect = el.getBoundingClientRect();
      if (!isShown(el, rect)) continue;
      contentLeft = Math.min(contentLeft, rect.left);
      contentRight = Math.max(contentRight, rect.right);
    }

    const controls = document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]');
    const tapTargets = [];
    for (const el of controls) {
      // A checkbox wrapped in its label is tapped through the label, so the label
      // is the target a thumb actually aims at.
      const target = el.closest("label") || el;
      const rect = target.getBoundingClientRect();
      if (!isShown(target, rect)) continue;
      tapTargets.push({ label: describe(el), width: rect.width, height: rect.height });
    }
    return { viewportWidth: window.innerWidth, contentLeft, contentRight, tapTargets };
  });
}

/**
 * The screen-use defects for one viewport. Each check only means something on its
 * own kind of screen — a phone column is SUPPOSED to be narrow, and a mouse does
 * not need a 40px target.
 */
async function measureScreenUseDefects(page, vp) {
  const measured = await measureScreenUse(page);
  if (vp.touch) return describeSmallTapTargets(measured.tapTargets);
  const narrow = describeNarrowLayout(measured);
  return narrow ? [narrow] : [];
}

// A screen where fewer pixels than this differ from its dominant colour shows
// nothing. A count, not a share of the screen: a single word on an otherwise
// empty page is dozens of pixels even shrunk onto a phone, and is not a blank
// page — one that painted only its background, or an opaque layer over
// everything, is.
const MIN_PAINTED_PIXELS = 20;
// How far a pixel's luminance (0-255) may sit from the dominant one and still
// count as the same colour — enough to absorb a gradient's banding, not a glyph.
const SAME_COLOUR_TOLERANCE = 10;

/**
 * Whether the page shows anything at all, as a defect message — or null when it
 * does. Every other layout check measures what is on screen and so says nothing
 * when nothing is: an empty page has no overflow, no overlap and no bad contrast.
 * `contentElements` is how many visible elements carry text or media, which tells
 * a page that rendered nothing from one whose content is hidden behind something.
 */
export function describeBlankScreen({ paintedPixels, contentElements }) {
  if (paintedPixels >= MIN_PAINTED_PIXELS) return null;
  const cause = contentElements
    ? `${contentElements} element(s) carry text or media, but none of it can be seen — it is covered, off-screen, or the colour of the background`
    : "no element carries any text or media";
  return `the page renders visually empty: ${paintedPixels} pixel(s) differ from its background colour, and ${cause}.`;
}

/**
 * What the blank-screen check judges, read from pixels rather than the DOM: a
 * scene drawn into a canvas is invisible to every element-based check, and a
 * canvas that painted nothing looks exactly like one that painted a world.
 *
 * The screenshot is decoded by the browser on a page of its own, because decoding
 * a PNG in node would mean a dependency, and decoding it inside the product's own
 * page would let the product's scripts and policies interfere with the measurement.
 */
async function measureBlankness(page) {
  const contentElements = await page.evaluate(() =>
    [...document.querySelectorAll("body *")].slice(0, 1500).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      return ["img", "svg", "canvas", "video"].includes(el.tagName.toLowerCase()) ||
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    }).length
  );
  const screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  const decoder = await page.context().browser().newPage();
  try {
    const paintedPixels = await decoder.evaluate(async ({ png, tolerance }) => {
      const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const pixels = data.length / 4;
      const luminance = new Uint8Array(pixels);
      const histogram = new Array(256).fill(0);
      for (let i = 0; i < pixels; i++) {
        luminance[i] = Math.round(0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]);
        histogram[luminance[i]]++;
      }
      const dominant = histogram.indexOf(Math.max(...histogram));
      let painted = 0;
      for (let i = 0; i < pixels; i++) if (Math.abs(luminance[i] - dominant) > tolerance) painted++;
      return painted;
    }, { png: screenshot, tolerance: SAME_COLOUR_TOLERANCE });
    return { paintedPixels, contentElements };
  } finally {
    await decoder.close().catch(() => {});
  }
}

// Caps so one badly-broken page can't produce a thousand-line report. The point
// is to name the worst offenders, not to enumerate every instance.
const MAX_DEFECTS_PER_KIND = 5;

/**
 * Containers that have children but were laid out into no space. One that
 * generates no box at all is inside hidden content (`display: none` on it or an
 * ancestor, or `display: contents`), which is supposed to take no space: flagging
 * those turned a hidden overlay into three tickets asking to make invisible
 * content measurable, each with "no visible change" as its goal.
 */
export function describeCollapsedContainers(containers) {
  return containers
    .filter((container) => container.generatesBox)
    .slice(0, MAX_DEFECTS_PER_KIND)
    .map((container) =>
      `collapsed container (${Math.round(container.width)}x${Math.round(container.height)}) despite ${container.childCount} child element(s): ${container.label}`
    );
}
// WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or >=19px bold).
const CONTRAST_MIN_NORMAL = 4.5;
const CONTRAST_MIN_LARGE = 3;

/**
 * Measure layout/appearance defects in the page as rendered. Runs entirely in the
 * browser and returns plain strings. Anything genuinely subjective (does this feel
 * right? is the hierarchy right?) is deliberately NOT here — this function only
 * reports things that are true or false, never matters of taste.
 */
async function measureLayoutDefects(page) {
  const measured = await page.evaluate(
    ({ maxPerKind, minNormal, minLarge }) => {
      const defects = [];
      const add = (kind, list, msg) => {
        if (list.length < maxPerKind) {
          list.push(msg);
          defects.push(msg);
        }
      };

      // A short, stable, human-readable handle for an element.
      const describe = (el) => {
        const id = el.id ? `#${el.id}` : "";
        const cls = el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : "";
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
        return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` ("${text}")` : ""}`;
      };

      // An element can have a healthy box of its own and still be invisible,
      // because an ancestor collapsed to nothing and clips it. Such children are
      // not on screen, so measuring their overlap or contrast reports defects the
      // visitor can never see.
      const isClippedByAncestor = (el) => {
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
          const s = getComputedStyle(node);
          if (s.overflow === "hidden" || s.overflow === "clip") {
            const r = node.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return true;
          }
        }
        return false;
      };

      const isRendered = (el, style, rect) =>
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !isClippedByAncestor(el);

      // --- Unstyled content: no author CSS applied at all. -------------------
      if (document.styleSheets.length === 0) {
        defects.push("no stylesheet is applied — the page is rendering unstyled.");
      }

      // --- Page-level horizontal overflow. ----------------------------------
      const doc = document.scrollingElement || document.documentElement;
      if (doc.scrollWidth > window.innerWidth + 1) {
        defects.push(
          `the page scrolls horizontally: content is ${doc.scrollWidth}px wide in a ${window.innerWidth}px viewport.`
        );
      }

      const all = [...document.querySelectorAll("body *")].slice(0, 1500);
      const visible = [];
      const overflowing = [];
      const collapsed = [];
      const brokenImages = [];
      const lowContrast = [];

      for (const el of all) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        // --- Broken images. -------------------------------------------------
        if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0) {
          add("broken", brokenImages, `broken or missing image: ${describe(el)} (src="${el.getAttribute("src") || ""}")`);
          continue;
        }

        // --- Collapsed containers: has children but no rendered size. -------
        if (
          el.children.length > 0 &&
          (rect.width === 0 || rect.height === 0) &&
          style.position !== "absolute" &&
          style.position !== "fixed"
        ) {
          collapsed.push({
            width: rect.width,
            height: rect.height,
            childCount: el.children.length,
            generatesBox: el.getClientRects().length > 0,
            label: describe(el),
          });
        }

        if (!isRendered(el, style, rect)) continue;

        // --- Elements past the right edge. ----------------------------------
        if (rect.right > window.innerWidth + 1 && rect.left < window.innerWidth) {
          add("overflow", overflowing, `element runs ${Math.round(rect.right - window.innerWidth)}px past the right edge: ${describe(el)}`);
        }

        // Track leaf-ish text nodes for overlap + contrast.
        const ownText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0
        );
        if (ownText) visible.push({ el, rect, style });
      }

      // --- Contrast of text against its effective background. ---------------
      const parseColor = (c) => {
        const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
      };
      // Walk up until an ancestor paints an opaque background; default to white.
      const effectiveBackground = (el) => {
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          const bg = parseColor(getComputedStyle(node).backgroundColor);
          if (bg && bg.a > 0.5) return bg;
        }
        const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
        return bodyBg && bodyBg.a > 0.5 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
      };
      const luminance = ({ r, g, b }) => {
        const ch = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };

      for (const { el, style } of visible) {
        const fg = parseColor(style.color);
        if (!fg || fg.a < 0.5) continue;
        const bg = effectiveBackground(el);
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(style.fontSize) || 16;
        const bold = Number(style.fontWeight) >= 700;
        const floor = size >= 24 || (size >= 19 && bold) ? minLarge : minNormal;
        if (ratio < floor) {
          add("contrast", lowContrast, `text contrast ${ratio.toFixed(2)}:1 is below the ${floor}:1 minimum (${style.color} on rgb(${bg.r},${bg.g},${bg.b})): ${describe(el)}`);
        }
      }

      // --- Overlapping text: two text elements sharing the same pixels. -----
      const overlaps = [];
      for (let i = 0; i < visible.length && overlaps.length < maxPerKind; i++) {
        for (let j = i + 1; j < visible.length && overlaps.length < maxPerKind; j++) {
          const a = visible[i];
          const b = visible[j];
          // Nested elements legitimately share space — only compare siblings.
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (w <= 0 || h <= 0) continue;
          const areaA = a.rect.width * a.rect.height;
          const areaB = b.rect.width * b.rect.height;
          const share = (w * h) / Math.min(areaA, areaB);
          if (share > 0.4) {
            add("overlap", overlaps, `text overlaps (${Math.round(share * 100)}% of the smaller box): ${describe(a.el)} over ${describe(b.el)}`);
          }
        }
      }

      return { defects, collapsed };
    },
    {
      maxPerKind: MAX_DEFECTS_PER_KIND,
      minNormal: CONTRAST_MIN_NORMAL,
      minLarge: CONTRAST_MIN_LARGE,
    }
  );
  return [...measured.defects, ...describeCollapsedContainers(measured.collapsed)];
}

// Most interactive elements the sweep will exercise per run.
const MAX_INTERACTIONS = 12;

// A sample value the sweep types into text fields, so form-driven behavior
// (validation, persistence, errors) gets exercised — not just clicks.
const FILL_VALUE = "Automated review test entry";
const TEXT_INPUT_TYPES = ["", "text", "search", "email", "url", "tel", "password", "number"];

// Exercise one element the way a user would: type into text fields, choose an
// option in selects, click everything else. Returns the verb performed so the
// caller can phrase findings and skip the no-effect check for fills/selects.
async function exerciseTarget(loc, t) {
  if (t.tag === "select") {
    try {
      await loc.selectOption({ index: 1 });
      return "select";
    } catch {
      await loc.click({ timeout: 2000 });
      return "click";
    }
  }
  if (t.tag === "textarea" || (t.tag === "input" && TEXT_INPUT_TYPES.includes(t.type))) {
    await loc.fill(FILL_VALUE, { timeout: 2000 });
    return "fill";
  }
  await loc.click({ timeout: 2000 });
  return "click";
}

/**
 * Drive the app like a user: click each interactive element and record what
 * happens — a JS error it triggers (high-confidence bug) or no DOM effect at all
 * (low-confidence; a canvas/JS-only app can legitimately not change the DOM).
 * Returns a list of human-readable findings. Best-effort; never throws.
 */
export async function exploreInteractions(browser, url) {
  const page = await browser.newPage(viewportOptions(REVIEW_VIEWPORTS[0]));
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));

  // Tag the interactive elements so we can re-locate each one to click it.
  const tagTargets = () =>
    page.evaluate((limit) => {
      const sel = 'a[href], button, input, select, textarea, [role="button"], [onclick]';
      const found = new Set(document.querySelectorAll(sel));
      for (const el of document.querySelectorAll("*")) {
        if (getComputedStyle(el).cursor === "pointer") found.add(el);
      }
      return Array.from(found).slice(0, limit).map((el, i) => {
        el.setAttribute("data-explore-id", String(i));
        const text = (el.innerText || el.value || el.getAttribute("aria-label") || "")
          .trim().replace(/\s+/g, " ");
        return {
          id: i,
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute("type") || "").toLowerCase(),
          label: (text || el.tagName.toLowerCase()).slice(0, 40),
        };
      });
    }, MAX_INTERACTIONS);

  const findings = [];
  const base = url.split("#")[0];
  let postDefects = [];
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    const targets = await tagTargets();
    for (const t of targets) {
      const loc = page.locator(`[data-explore-id="${t.id}"]`);
      if ((await loc.count()) === 0) continue; // DOM changed out from under us
      // Checked at the moment of pressing, not when tagged: an earlier control
      // may have revealed this one. One a visitor cannot press yet is the game
      // withholding it, not a defect, and reporting it drowned out the controls
      // that are on offer and still cannot be pressed.
      if (!(await loc.isVisible()) || !(await loc.isEnabled())) continue;
      const errBefore = errors.length;
      const htmlBefore = await page.evaluate(() => document.body.innerHTML);
      let action;
      try {
        action = await exerciseTarget(loc, t);
      } catch (e) {
        findings.push(`"${t.label}" — could not be exercised: ${String(e.message).split("\n")[0]}`);
        continue;
      }
      await page.waitForTimeout(500);
      const newErrors = errors.slice(errBefore);
      if (newErrors.length) {
        findings.push(`"${t.label}" — ${action} triggered a JS error: ${newErrors[0]}`);
      } else if (page.url().split("#")[0] !== base) {
        findings.push(`"${t.label}" — navigated away to ${page.url()}`);
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
        await tagTargets().catch(() => {});
      } else if (action === "click" && !["input", "textarea", "select"].includes(t.tag)) {
        // Only clicked controls are expected to mutate the DOM; fills/selects
        // change their own value, not structure, so they're not "no-effect" bugs.
        const htmlAfter = await page.evaluate(() => document.body.innerHTML);
        if (htmlAfter === htmlBefore) {
          findings.push(`"${t.label}" — looks interactive but had no visible effect (may be canvas/JS-only).`);
        }
      }
    }
    // Measure the app as the user LEAVES it — panels open, fields filled. First
    // paint is the easy case; a layout usually breaks once something is expanded,
    // and this state is unreachable from a fresh page load.
    postDefects = await measureLayoutDefects(page);
  } catch (e) {
    findings.push(`interaction sweep stopped early: ${String(e.message).split("\n")[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
  return { findings, postDefects };
}
/**
 * Review the built site with no model involved at all: measure the rendered
 * layout at each viewport, then drive every interactive element and record what
 * breaks. Returns `{ report, defects, functional }` — the `## Defects` /
 * `## Functional` text, each defect with the viewports it occurs at, and each
 * functional note — or null when there's nothing to review (no page yet,
 * Playwright missing) or nothing was found. The Playtester reads it as evidence.
 *
 * Costs zero model requests and never throws — any failure degrades to a partial
 * report or null, and the caller proceeds.
 */
export async function reviewApp(relDir = "docs") {
  const dir = join(repoRoot, relDir);
  const chromium = await chromiumFor(dir, "App review", "skipping");
  if (!chromium) return null;

  // defect message -> the viewports it occurs at. Most faults reproduce at every
  // width, and repeating each one per viewport buried the width-specific ones
  // (which are the interesting kind) in three times as much text.
  const defectsByViewport = new Map();
  const recordDefects = (label, messages) => {
    for (const msg of messages) {
      if (!defectsByViewport.has(msg)) defectsByViewport.set(msg, []);
      defectsByViewport.get(msg).push(label);
    }
  };
  let functional = [];
  try {
    await withServedSite(chromium, dir, async (browser, url) => {
      // Measure the layout at each viewport (best-effort per viewport, so one bad
      // width still lets the others report).
      for (const vp of REVIEW_VIEWPORTS) {
        let page;
        try {
          page = await browser.newPage(viewportOptions(vp));
          await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
          // The product may animate in; let it settle so we measure a steady state.
          await page.waitForTimeout(1500);
          recordDefects(vp.label, await measureLayoutDefects(page));
          recordDefects(vp.label, await measureScreenUseDefects(page, vp));
          const blank = describeBlankScreen(await measureBlankness(page));
          if (blank) recordDefects(vp.label, [blank]);
        } catch (e) {
          log("warn", `App review: could not measure the ${vp.label} layout.`, errorData(e));
        } finally {
          if (page) await page.close().catch(() => {});
        }
      }

      // Drive the app and record what breaks, then measure the state it's left in.
      try {
        const sweep = await exploreInteractions(browser, url);
        functional = sweep.findings;
        recordDefects("desktop, after interacting", sweep.postDefects);
      } catch (e) {
        log("warn", "App review: interaction sweep failed.", errorData(e));
      }
    });
  } catch (e) {
    // Everything inside is caught per step, so only the launch itself lands here.
    log("warn", "App review: could not launch browser — skipping.", errorData(e));
    return null;
  }

  const parts = [];
  if (defectsByViewport.size) {
    const lines = [...defectsByViewport].map(([msg, labels]) => `- ${msg} (at: ${labels.join("; ")})`);
    parts.push(`## Defects (measured in the rendered page)\n${lines.join("\n")}`);
  }
  if (functional.length) {
    parts.push(`## Functional (observed behavior)\n${functional.map((f) => `- ${f}`).join("\n")}`);
  }
  if (!parts.length) {
    log("info", "App review: no defects measured and nothing broke when exercised.");
    return null;
  }
  const report = parts.join("\n\n");
  log("info", `App review (measured layout + interaction sweep):\n${report}`);
  return {
    report,
    defects: [...defectsByViewport].map(([message, viewports]) => ({ message, viewports })),
    functional,
  };
}
