// PLAYTESTER — the only agent that experiences the product instead of measuring it.
//
// reviewApp already tells the Product Manager what is measurably wrong: contrast
// below the WCAG minimum, an element past the viewport edge, a container collapsed
// to zero height. Those are facts, and they are narrow on purpose. Nothing in the
// pipeline asks the question a person asks after two minutes with the garden —
// did anything happen? did I understand what I was looking at? was it worth
// staying for? An empty defect list reads as "nothing is wrong" when it means
// "nothing measurable is wrong", and that gap is where a calm, correct, boring
// product ships unchallenged.
//
// It plays through the DOM, not the canvas. That is not a limitation worked
// around — the product is required to maintain a real state layer beside the
// scene (see prompts/_profile.md), precisely because a canvas is opaque to a
// screen reader and to automation alike. So the surface this agent reads is the
// same one a blind visitor gets, and a garden whose state layer is dull or wrong
// is failing them first.
//
// It also SEES two frames of it. The state layer answers "what is happening"; a
// screenshot answers "what does this look like", which is the one question the
// pipeline could not ask before — reviewApp measures everything about a rendered
// page that is true or false (overflow, contrast, collapsed boxes) and
// deliberately nothing about whether it is any good.
//
// Eyes went HERE rather than to the Product Manager on purpose. A vision model
// can report a defect that isn't there; reviewApp's own header records what that
// cost when a hallucinated defect became a ticket and the Builder spent real
// requests fixing nothing. What this agent files is explicitly NOT a ticket, so a
// mistaken impression costs the PM one line of triage. The containment already
// existed; this is the one role it fits.
//
// What it files is FEEDBACK, not work. Findings land as `playtest`-labelled
// issues, which isBuildable excludes, so the Builder never picks up "the first
// minute felt static" as though it were a ticket. The Product Manager converts
// each one into a real ticket with acceptance criteria, or drops it, and closes
// the original either way.
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  firstVisionModel,
  extractAgentResponse,
  errorData,
  repoRoot,
  readVision,
  startStaticServer,
  fetchOpenIssues,
  createIssue,
  recordTicket,
  PLAYTEST_LABEL,
} from "./shared.mjs";
import { pathToFileURL } from "url";
import { join } from "path";
import fs from "fs";

// How long to sit with the app, and how often to write down what the state layer
// says. The garden runs on seasonal and day/night cycles, so a single snapshot
// cannot tell a living scene from a frozen one — the whole question is what
// changes between samples. Two minutes is long enough to catch a slow cycle and
// short enough to stay well inside the session cap.
// Overridable so the session can be shortened when running this by hand — two
// minutes is the right length for a judgement and the wrong one for a smoke test.
const OBSERVATION_MS = Number(process.env.PLAYTEST_OBSERVATION_MS || 120_000);
const SAMPLE_EVERY_MS = Number(process.env.PLAYTEST_SAMPLE_MS || 8_000);

// Findings one run may file. A ceiling, not a target. Feedback is cheap to
// produce and expensive to triage — twenty impressions a week would bury the
// Product Manager and turn a signal into a chore it learns to skip.
const MAX_FINDINGS = Number(process.env.MAX_PLAYTEST_FINDINGS || 3);

// The two viewports the pipeline already judges layout at (see REVIEW_VIEWPORTS in
// shared.mjs). Kept identical so a finding here and a defect there describe the
// same page rather than two different ones.
const SHOT_VIEWPORTS = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "mobile", width: 390, height: 844 },
];

// JPEG, not PNG. The garden is a canvas scene — photo-shaped content, where JPEG
// is several times smaller for no loss that matters to a judgement about mood and
// hierarchy. Size is not about the bill (two frames cost a fraction of a cent); an
// oversized attachment makes the provider reject the whole conversation rather
// than the offending turn.
const SHOT_QUALITY = Number(process.env.PLAYTEST_SHOT_QUALITY || 70);

/**
 * Two frames of the garden as a visitor would see it, as pi image parts.
 *
 * Best-effort by construction: a screenshot that cannot be taken returns an empty
 * list, and the session is reported from the state layer exactly as it was before
 * this existed. Never throws — a broken capture must not cost the week's feedback.
 */
async function captureFrames(page) {
  const frames = [];
  for (const viewport of SHOT_VIEWPORTS) {
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // One animation frame plus a beat: the scene resizes on a rAF, so shooting
      // immediately catches the previous layout at the new size.
      await page.waitForTimeout(1200);
      const buffer = await page.screenshot({ type: "jpeg", quality: SHOT_QUALITY });
      frames.push({
        label: viewport.label,
        width: viewport.width,
        image: { type: "image", data: buffer.toString("base64"), mimeType: "image/jpeg" },
      });
    } catch (e) {
      log("warn", `Playtest: could not capture the ${viewport.label} frame — reporting without it.`, errorData(e));
    }
  }
  return frames;
}

const APP_DIR = join(repoRoot, "docs");

// The deployed site, when there is one. Playing the LIVE page rather than a local
// copy of the repository is the difference between "the code we merged works" and
// "what a visitor gets works" — and only the second is what this agent is for.
// Everything else in the pipeline verifies the first, before a merge, against a
// local server. Falls back to serving docs/ when no URL is configured.
const SITE_URL = process.env.SITE_URL || "";

/**
 * Everything the state layer is currently saying, plus how the page is built.
 * Read from the DOM the product is required to maintain, which is also what a
 * screen reader would announce.
 */
function readPage() {
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const label = el.getAttribute("aria-label");
    return `${el.tagName.toLowerCase()}${id}${label ? ` "${label}"` : ""}`;
  };
  const panel = document.querySelector('[role="region"], aside, main');
  return {
    title: document.title,
    state: (panel?.innerText || document.body.innerText || "").trim().slice(0, 1200),
    landmarks: [...document.querySelectorAll("[role], main, nav, aside, header, footer")].map(describe),
    headings: [...document.querySelectorAll("h1,h2,h3")].map((h) => h.innerText.trim()).filter(Boolean),
    controls: [...document.querySelectorAll("button, a[href], input, select, [tabindex]")].map(describe),
  };
}

/**
 * Sit with the app and write down what it says over time.
 *
 * Returns null when there is nothing to play — no product yet, or no browser —
 * so a run on an empty repo is a quiet no-op rather than a failure, matching how
 * verifyBuild and reviewApp already degrade.
 */
export async function observeApp() {
  if (!SITE_URL && !fs.existsSync(join(APP_DIR, "index.html"))) {
    log("info", "Playtest: no app yet — nothing to play.");
    return null;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    log("warn", "Playtest: Playwright unavailable — skipping.", errorData(e));
    return null;
  }

  // The live site when we have one; a local copy of the repository otherwise.
  const local = SITE_URL ? null : await startStaticServer(APP_DIR);
  const url = SITE_URL || `http://127.0.0.1:${local.port}/`;
  log("info", SITE_URL ? `Playing the live site at ${url}` : "Playing a local copy of docs/");
  const consoleErrors = [];
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    log("warn", "Playtest: could not launch a browser — skipping.", errorData(e));
    local?.server.close();
    return null;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(`uncaught: ${e.message}`));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    const opening = await page.evaluate(readPage);

    // What the keyboard alone can reach, in the order it reaches it. The Vision
    // makes screen-reader visitors first-class, so "can you get to the state
    // layer without a mouse" is a question about the product, not a checklist.
    const tabOrder = [];
    for (let stop = 0; stop < 8; stop++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const id = el.id ? `#${el.id}` : "";
        return `${el.tagName.toLowerCase()}${id}: ${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 60)}`;
      });
      if (!focused) break;
      if (tabOrder.includes(focused)) break; // wrapped around
      tabOrder.push(focused);
    }

    // The actual sit-and-watch. Each sample is what the state layer would tell
    // someone who asked "what's happening now?" at that moment.
    const timeline = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < OBSERVATION_MS) {
      await page.waitForTimeout(SAMPLE_EVERY_MS);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const { state } = await page.evaluate(readPage);
      timeline.push({ atSeconds: seconds, state });
    }

    // Does the garden remember you? persistence is the difference between a
    // screensaver and a place you return to, so it is worth one reload to find out.
    await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);
    const afterReload = (await page.evaluate(readPage)).state;

    // Shot last, and after the reload, so the frames show the same garden the
    // final timeline sample describes rather than a fresh one. Resizing for the
    // mobile frame is destructive to the desktop layout, which is why nothing is
    // measured after this point.
    const frames = await captureFrames(page);

    return { opening, tabOrder, timeline, afterReload, consoleErrors, url, frames };
  } catch (e) {
    log("warn", "Playtest: the session broke off early — reporting what was seen.", errorData(e));
    return null;
  } finally {
    await browser.close().catch(() => {});
    local?.server.close();
  }
}

/**
 * Render the session as something a reader can follow in order: what the page
 * offered, what changed while watching, what survived a reload.
 *
 * Deliberately prose-shaped rather than a JSON dump. The agent reading it is
 * being asked for an impression of an experience, and a wall of serialized DOM
 * invites it to audit structure instead.
 */
export function renderSession(session, { showingFrames = true } = {}) {
  const { opening, tabOrder, timeline, afterReload, consoleErrors, url } = session;
  // The transcript must describe the turn it is actually part of. The text-only
  // fallback in report() sends this same session with no images attached, and a
  // transcript that still announced two screenshots would have the agent describe
  // frames it was never shown.
  const frames = showingFrames ? session.frames || [] : [];

  const unchanged = timeline.length > 1 && timeline.every((s) => s.state === timeline[0].state);
  const sameAfterReload = afterReload === timeline[timeline.length - 1]?.state;

  return [
    url ? `_Played at ${url}._\n` : "",
    `## The page when it loaded`,
    `Title: ${opening.title || "(none)"}`,
    `Headings: ${opening.headings.join(" / ") || "(none)"}`,
    `Landmarks: ${opening.landmarks.join(", ") || "(none)"}`,
    `Interactive elements: ${opening.controls.join(", ") || "(none — nothing to click or type into)"}`,
    "",
    `## What the keyboard reached, in order`,
    tabOrder.length ? tabOrder.map((t, i) => `${i + 1}. ${t}`).join("\n") : "(nothing — Tab moved focus nowhere)",
    "",
    `## What the state layer said, watching for ${Math.round(OBSERVATION_MS / 1000)}s`,
    timeline.map((s) => `### at ${s.atSeconds}s\n${s.state || "(the panel said nothing)"}`).join("\n\n"),
    "",
    unchanged
      ? `**Nothing in the state layer changed across the whole ${Math.round(OBSERVATION_MS / 1000)} seconds.**`
      : `The state layer changed while watching — compare the samples above to see what moved and what stayed put.`,
    "",
    `## After a reload`,
    sameAfterReload
      ? "The garden came back exactly as it was left."
      : `The garden came back different:\n${afterReload || "(the panel said nothing)"}`,
    "",
    `## Errors in the console during the session`,
    consoleErrors.length ? consoleErrors.map((e) => `- ${e}`).join("\n") : "(none)",
    "",
    // Named in the transcript because the images are attached to the turn rather
    // than embedded here, and an agent told "look at the screenshots" with no idea
    // how many there are or what they show will invent the missing one.
    frames.length
      ? `## Screenshots attached to this message\n${frames
          .map((f, i) => `${i + 1}. ${f.label} — ${f.width}px wide, taken after the reload above`)
          .join("\n")}`
      // Reached both when the capture failed and when this is the text-only
      // fallback in report(). The instruction is the same either way, and naming a
      // cause we cannot distinguish would just be a guess in the prompt.
      : `## Screenshots\n(none attached — judge from the state layer alone, and say nothing about how the app looks)`,
  ].join("\n");
}

/**
 * File the findings as untriaged feedback.
 *
 * Deduped against the open board by title, so a complaint the Playtester has
 * every week — and a garden that is genuinely static will produce the same one —
 * doesn't accumulate as a new issue each time.
 */
function fileFindings(findings, verdict) {
  // Exact titles only. The Playtester repeats itself in the obvious way — the
  // same complaint, worded the same — and anything subtler is caught downstream
  // by the PM's own dedup, which already runs over everything it grooms.
  const seen = new Set(fetchOpenIssues(100).map((i) => (i.title || "").toLowerCase().trim()));

  let filed = 0;
  for (const finding of findings.slice(0, MAX_FINDINGS)) {
    if (!finding?.title || !finding?.observation) continue;
    if (seen.has(finding.title.toLowerCase().trim())) {
      log("info", `Playtest: "${finding.title}" is already on the board — skipping.`);
      continue;
    }
    const body = [
      "_Filed by the Playtester after spending time with the live app. This is an",
      "observation, not a ticket — the Product Manager decides whether it becomes",
      "work, and what that work is._",
      "",
      "## What I noticed",
      finding.observation,
      "",
      "## Why it matters",
      finding.whyItMatters || "(not stated)",
      // The verdict on the whole session, repeated on each finding. One finding
      // read alone says nothing about whether the visit was good overall, and the
      // Product Manager triages these one at a time — a complaint about a static
      // scene means something different in a session that was otherwise worth
      // staying for than in one that was not.
      ...(verdict
        ? ["", "## The session overall", verdict]
        : []),
    ].join("\n");
    const number = createIssue(finding.title, body, [PLAYTEST_LABEL]);
    if (number) {
      recordTicket("created", number, finding.title);
      filed++;
    }
  }
  if (!filed) log("info", "Playtest: nothing new to file.");
  return filed;
}

/**
 * Ask for the impression. Runs the seeing version first and falls back to the
 * text-only one, because the frames are an upgrade to the report and not a
 * precondition for it — a week with no feedback is worse than a week of feedback
 * that only read the state layer.
 *
 * Returns the agent's raw output, or null when neither attempt produced any.
 */
async function report(session) {
  const promptFor = (showingFrames) => {
    const transcript = renderSession(session, { showingFrames });
    log("info", `Playtest session:\n${transcript}`);
    return fillTemplate(loadPrompt("playtester"), {
      VISION: readVision(),
      SESSION: transcript,
      MAX_FINDINGS: String(MAX_FINDINGS),
    });
  };
  const frames = session.frames || [];
  // Pinned, not chained: the chain head is text-only, and a pinned model gets no
  // fallback of its own — which is what the second attempt below is for.
  const visionModel = frames.length ? await firstVisionModel() : null;

  if (visionModel) {
    try {
      return await withLogGroup(`Playtester (seeing, ${visionModel})`, () =>
        runAgent({
          label: "Playtester",
          systemPrompt: promptFor(true),
          // Deliberately still no tools. The frames arrive attached to the turn, so
          // seeing the garden costs the agent no ability to go reading the source —
          // which is a different job, and one that would pull an impression into an
          // audit (see renderSession).
          tools: [],
          modelId: visionModel,
          images: frames.map((f) => f.image),
        })
      );
    } catch (e) {
      log("warn", `Playtest: ${visionModel} could not report on the frames — retrying from the state layer alone.`, errorData(e));
    }
  } else if (frames.length) {
    log("warn", "Playtest: no configured model accepts images — reporting from the state layer alone.");
  }

  try {
    return await withLogGroup("Playtester", () =>
      runAgent({ label: "Playtester", systemPrompt: promptFor(false), tools: [] })
    );
  } catch (e) {
    log("error", "Playtest: the reporting agent failed.", errorData(e));
    return null;
  }
}

async function main() {
  const session = await withLogGroup("Playing the app", () => observeApp());
  if (!session) {
    log("info", "Playtest: no session to report on.");
    printRunSummary("Playtester");
    return;
  }

  const output = await report(session);
  if (output === null) {
    log("warn", "Playtest: the reporting agent failed both with and without the screenshots — nothing filed.");
    printRunSummary("Playtester");
    return;
  }

  const result = extractAgentResponse("Playtester", output, {
    requireOutcome: false,
    // `verdict` is asked for in the prompt but deliberately NOT required here. A
    // missing field would discard the whole report, and this agent runs once a
    // week — losing a session's findings over an absent sentence costs more than
    // the sentence is worth. It is logged, and its absence is warned about.
    requiredDataFields: ["findings"],
  });
  if (!result) {
    log("warn", "Playtest: no usable report — nothing filed.");
    printRunSummary("Playtester");
    return;
  }

  log("info", `Playtester: ${result.summary}`);
  // Logged whether or not anything is filed. A week the Playtester files nothing
  // still owes an answer to "was this worth being here", and the prompt requires
  // it to name the weakest thing even then — that sentence is the only record of
  // a good week, so it must not be conditional on there being a complaint.
  const verdict = typeof result.data.verdict === "string" ? result.data.verdict.trim() : "";
  if (verdict) log("info", `Playtester verdict: ${verdict}`);
  else log("warn", "Playtester: no verdict — the prompt asks for one in every session, filed or not.");

  const findings = Array.isArray(result.data.findings) ? result.data.findings : [];
  const filed = fileFindings(findings, verdict);
  log("info", `Playtest complete — ${filed} finding(s) filed for the Product Manager to triage.`);
  printRunSummary("Playtester");
}

// Guarded so the observation half can be imported and exercised without spending
// a model request — same convention as the Product Manager and the Tech Lead.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    log("error", `Playtester failed: ${err.message || err}`);
    printRunSummary("Playtester");
    process.exit(1);
  });
}
