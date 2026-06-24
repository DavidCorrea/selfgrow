// One-time migration: copy the existing docs/VISION.md and docs/CHANGELOG.md
// into the wiki, which becomes their canonical home. Run once (workflow_dispatch)
// AFTER the wiki is initialized and BEFORE removing the files from docs/.
import fs from "fs";
import { join } from "path";
import { repoRoot, log, printRunSummary, getWikiDir, publishWiki } from "./shared.mjs";

function main() {
  log("info", "=== Seed wiki from docs/ (one-time) ===");

  const dir = getWikiDir();
  if (!dir) {
    log("error", "Wiki not reachable — enable it and create one page in the UI first.");
    printRunSummary("Seed Wiki");
    return;
  }

  for (const [src, dest] of [
    ["docs/VISION.md", "Vision.md"],
    ["docs/CHANGELOG.md", "Changelog.md"],
  ]) {
    try {
      fs.writeFileSync(join(dir, dest), fs.readFileSync(join(repoRoot, src), "utf-8"), "utf-8");
      log("info", `Seeded ${dest} from ${src}.`);
    } catch (e) {
      log("warn", `Could not seed ${dest} from ${src}: ${e.message}`);
    }
  }

  publishWiki("Seed wiki: Vision + Changelog from docs/");
  printRunSummary("Seed Wiki");
}

main();
