// The product's source as the agents that judge it read it: which files count,
// how they are listed, and how much of them fits in a prompt. The Tech Lead
// reviews it weekly and the Product Manager curates against it on Sundays.
import fs from "fs";
import { join, relative } from "path";
import { repoRoot } from "./paths.mjs";

const SOURCE_DIR = join(repoRoot, "docs");

// What counts as a unit of shipped work. Markup is deliberately excluded: a page
// is rarely removable on its own, and including it crowds out the code where
// accumulated cruft actually hides.
const SOURCE_EXTENSIONS = /\.(m?js|css)$/;

const SELFTEST_FILE = "selftest.js";
const AGENT_TOOLS_FILE = "agenttools.js";
// Harness code that lives in docs/ because it runs in the browser. It is not the
// product's to reshape, so it is kept out of the review entirely rather than
// offered as a module the Tech Lead might propose restructuring.
const HARNESS_IN_PRODUCT = new Set(["webmcp.js"]);

// How much source is INLINED in the prompt. Deliberately modest, because it is
// no longer how the review sees the codebase.
//
// It used to be everything, capped at 24,000 characters — and the product is
// 136,000. Eight of fourteen files were dropped without being named, the largest
// was cut to its first tenth, and the review would conclude the codebase was
// sound having read under a fifth of it. Raising the cap only moves the number at
// which that happens again.
//
// So the prompt carries a complete MANIFEST of what exists — every file, its
// size, its exports — and inlines only the recently changed ones. Everything else
// the review opens for itself with the `read` tool, which it has always had. That
// is how a person would do it: read the map, then open what matters.
const MAX_CHARS_PER_FILE = 6000;
const MAX_INLINED_CHARS = 30000;

// The self-check suite gets its own allowance and is read as a whole. Judging
// whether a suite's checks could fail is impossible from a truncated third of it,
// and it is the one file the Tech Lead is here to own.
const MAX_SELFTEST_CHARS = 20000;

/** Every source file under docs/, deepest paths included, as repo-relative names. */
function listSourceFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(path));
    } else if (
      SOURCE_EXTENSIONS.test(entry.name)
      && entry.name !== SELFTEST_FILE
      && entry.name !== AGENT_TOOLS_FILE
      && !HARNESS_IN_PRODUCT.has(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Read the shipped source. The judgement here is about craft, so it gets the
 * actual code rather than a file listing — a name says almost nothing about
 * whether a module earns its place.
 */
export function readSources() {
  return listSourceFiles(SOURCE_DIR).map((path) => {
    let source = "";
    try { source = fs.readFileSync(path, "utf-8"); } catch { /* unreadable — report the name alone */ }
    return { name: relative(repoRoot, path), source };
  });
}

/**
 * Order the source so the most relevant files come first.
 *
 * Recently changed files, then the rest largest-first. Changed files earn the
 * front because they are where a new problem is most likely to be; large files
 * come next because cruft accumulates by volume — a 4,000-line module is a better
 * place to look for two jobs in one file than a 40-line one.
 */
export function prioritizeSources(sources, changedFiles = new Set()) {
  const changed = (file) => changedFiles.has(file.name);
  return [...sources].sort((a, b) => {
    if (changed(a) !== changed(b)) return changed(a) ? -1 : 1;
    return b.source.length - a.source.length;
  });
}

// `export function foo`, `export const bar`, `export class Baz` — enough to say
// what a module offers without reading it. Not a parser, and it does not need to
// be: a missed export costs a line of the map, not a wrong judgement.
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm;

function exportsOf(source) {
  return [...source.matchAll(EXPORT_RE)].map((m) => m[1]);
}

/**
 * Every file in the product, with its size and what it offers.
 *
 * Always complete, whatever the budget. This is what makes "I have not read that
 * file" something the review can know rather than a silent gap: it can see that
 * groundNoise.js exists and exports createGroundNoiseTexture even on a week when
 * nothing inlined it.
 */
export function renderManifest(sources, changedFiles = new Set()) {
  const rows = prioritizeSources(sources, changedFiles).map((file) => {
    const names = exportsOf(file.source);
    const marker = changedFiles.has(file.name) ? " *" : "";
    return `- \`${file.name}\`${marker} — ${file.source.length} chars, exports: ${names.length ? names.join(", ") : "(none)"}`;
  });
  return [
    rows.join("\n"),
    changedFiles.size ? "\n`*` marks a file touched since your last review." : "",
  ].filter(Boolean).join("\n");
}

/**
 * Inline the most relevant source, and say plainly what was left for the review
 * to open itself.
 *
 * The distinction matters more than the budget: a file that is merely NOT INLINED
 * is one the review can still read, while a file it does not know exists is a
 * silent hole it will conclude around. The manifest above covers the second case;
 * this only decides what is convenient to have already.
 */
export function formatSources(sources, changedFiles = new Set()) {
  const ordered = prioritizeSources(sources, changedFiles);
  const blocks = [];
  const notInlined = [];
  let budget = MAX_INLINED_CHARS;

  for (const file of ordered) {
    if (budget <= 0) {
      notInlined.push(file.name);
      continue;
    }
    const body = file.source.slice(0, Math.min(MAX_CHARS_PER_FILE, budget));
    budget -= body.length;
    const truncated = body.length < file.source.length
      ? `\n_(showing the first ${body.length} of ${file.source.length} characters — open the file to see the rest)_`
      : "";
    blocks.push(`### ${file.name}\n\`\`\`\n${body}\n\`\`\`${truncated}`);
  }

  if (notInlined.length) {
    blocks.push(
      `### Not inlined\nThese are in the manifest above but not reproduced here, to keep this readable. ` +
        `Open any of them with the read tool — do NOT judge them unread:\n` +
        notInlined.map((name) => `- ${name}`).join("\n")
    );
  }
  return blocks.join("\n\n");
}

/** A product file read whole, up to the suite's allowance. */
function readWhole(file, noun) {
  try {
    const source = fs.readFileSync(join(SOURCE_DIR, file), "utf-8");
    return source.length > MAX_SELFTEST_CHARS
      ? `${source.slice(0, MAX_SELFTEST_CHARS)}\n\n_(truncated — the ${noun} is ${source.length} characters)_`
      : source;
  } catch {
    return "";
  }
}

/** The self-check suite, read on its own terms. */
export function readSelfTest() {
  return readWhole(SELFTEST_FILE, "suite");
}

/** The agent tool layer, read whole for the same reason the suite is. */
export function readAgentTools() {
  return readWhole(AGENT_TOOLS_FILE, "layer");
}
