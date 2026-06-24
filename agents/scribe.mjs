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

const HOME = `# selfgrow — the living garden wiki

selfgrow is a self-contained digital garden that tends and grows itself, guided
by an autonomous team of agents. This wiki is its living record.

- **[Vision](Vision)** — the garden's north star (curated by the Product Owner).
- **[Changelog](Changelog)** — the dated record of what changed (written by the Builder).
- **[The Garden's Story](Garden-Story)** — how the garden has grown over time.
`;

async function main() {
  log("info", "=== Scribe — publish wiki ===");

  const dir = getWikiDir();
  if (!dir) {
    log("error", "Wiki not reachable — nothing published.");
    printRunSummary("Scribe");
    return;
  }

  // Garden Story — LLM narrative from the canonical changelog (in the wiki).
  const story = await withLogGroup("Scribe", () =>
    runAgent({
      label: "Scribe",
      systemPrompt: fillTemplate(loadPrompt("scribe"), { CHANGELOG: readChangelog() }),
      tools: ["read"],
    })
  );
  const storyMd = cleanMarkdown(story);
  if (storyMd) {
    fs.writeFileSync(join(dir, "Garden-Story.md"), storyMd + "\n", "utf-8");
  } else {
    log("warn", "Scribe: empty story output — leaving Garden-Story unchanged.");
  }

  // Home / index.
  fs.writeFileSync(join(dir, "Home.md"), HOME, "utf-8");

  publishWiki("Update wiki: garden story + home");
  printRunSummary("Scribe");
}

main().catch((err) => {
  log("error", `Scribe failed: ${err.message || err}`);
  printRunSummary("Scribe");
  process.exit(1);
});
