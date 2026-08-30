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
  writeStory,
  writePage,
} from "./shared.mjs";

// The Scribe is the one agent that returns prose rather than the JSON envelope,
// so its output needs unwrapping before it becomes a wiki page: strip code fences,
// and unwrap a JSON envelope if the model produced one anyway (it has — a page
// once shipped reading `{ "markdown": "# The Story So Far\n..." }`, braces and
// escapes and all, because a stray JSON instruction outranked the prompt).
function cleanMarkdown(text) {
  let t = (text || "").trim();

  if (t.startsWith("{")) {
    try {
      const parsed = JSON.parse(t);
      const body = parsed.markdown ?? parsed.content ?? parsed.body ?? parsed.story;
      if (typeof body === "string" && body.trim()) t = body.trim();
    } catch {
      // Not JSON after all — fall through and treat it as the prose it looks like.
    }
  }

  const fence = t.match(/```(?:markdown|md)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();

  // A page that isn't the story is worse than no update at all, since it
  // overwrites a good one. Require the heading the prompt asks for.
  if (!/^#\s+/.test(t)) {
    log("warn", "Scribe: output doesn't start with a Markdown heading — refusing to publish it.");
    return "";
  }
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
      // Override the default kickoff turn, which tells agents to answer with the
      // JSON envelope. This is the one agent whose output IS the artifact, so
      // asking for JSON here contradicts its own prompt — and the task won.
      task: "Write the page now. Respond with only the Markdown body of the page — no JSON, no envelope, no code fences.",
      // This agent's answer is prose, so the chain must not reject it for
      // lacking the JSON envelope every other agent returns.
      expectJson: false,
      tools: ["read"],
    })
  );
  const storyMd = cleanMarkdown(story);
  if (storyMd) {
    writeStory(storyMd + "\n");
  } else {
    log("warn", "Scribe: empty story output — leaving Story unchanged.");
  }

  // Home / index.
  const home = `# ${projectName()} — wiki

The living record of this project, maintained by its autonomous agents.

- **[Vision](Vision)** — the north star (curated by the Product Owner).
- **[Changelog](Changelog)** — the dated record of what changed (written by the Builder).
- **[The Story So Far](Story)** — how the project has grown over time.
- **[Lessons](Lessons)** — work the agents abandoned, and why (written when a ticket is parked).
`;
  writePage("Home.md", home, "Home: refresh the wiki index");
  printRunSummary("Scribe");
}

main().catch((err) => {
  log("error", `Scribe failed: ${err.message || err}`);
  printRunSummary("Scribe");
  process.exit(1);
});
