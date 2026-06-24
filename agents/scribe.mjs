import fs from "fs";
import { join } from "path";
import {
  log,
  withLogGroup,
  printRunSummary,
  loadPrompt,
  fillTemplate,
  runAgent,
  getWikiDir,
  readVision,
  readChangelog,
  publishWiki,
} from "./shared.mjs";

// Strip accidental code fences / preamble the model might wrap around the page.
function cleanMarkdown(text) {
  let t = (text || "").trim();
  const fence = t.match(/```(?:markdown|md)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  return t;
}

// Derive a project name from the Vision's top heading (e.g. "# Foo — Vision" → "Foo").
function projectName() {
  const m = readVision().match(/^#\s+(.+)$/m);
  return (m ? m[1] : "This project").replace(/\s*[—–-]\s*vision\s*$/i, "").trim() || "This project";
}

async function main() {
  log("info", "=== Scribe — publish wiki ===");

  const dir = getWikiDir();
  if (!dir) {
    log("error", "Wiki not reachable — nothing published.");
    printRunSummary("Scribe");
    return;
  }

  // Story — LLM narrative from the canonical changelog (in the wiki).
  const story = await withLogGroup("Scribe", () =>
    runAgent({
      label: "Scribe",
      systemPrompt: fillTemplate(loadPrompt("scribe"), { CHANGELOG: readChangelog() }),
      tools: ["read"],
    })
  );
  const storyMd = cleanMarkdown(story);
  if (storyMd) {
    fs.writeFileSync(join(dir, "Story.md"), storyMd + "\n", "utf-8");
  } else {
    log("warn", "Scribe: empty story output — leaving Story unchanged.");
  }

  // Home / index.
  const home = `# ${projectName()} — wiki

The living record of this project, maintained by its autonomous agents.

- **[Vision](Vision)** — the north star (curated by the Product Owner).
- **[Changelog](Changelog)** — the dated record of what changed (written by the Builder).
- **[The Story So Far](Story)** — how the project has grown over time.
`;
  fs.writeFileSync(join(dir, "Home.md"), home, "utf-8");

  publishWiki("Update wiki: story + home");
  printRunSummary("Scribe");
}

main().catch((err) => {
  log("error", `Scribe failed: ${err.message || err}`);
  printRunSummary("Scribe");
  process.exit(1);
});
