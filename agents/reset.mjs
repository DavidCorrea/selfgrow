// One-time RESET for a fresh project. Run via workflow_dispatch with workflows
// paused. Does the mechanical GitHub-state cleanup:
//   1. Close every open issue.
//   2. Remove every item from the board (keeps the columns).
//   3. Reset the wiki Changelog to an empty `# Changelog`.
// It does NOT touch the Vision (you paste the new one) or delete docs/ (you
// `git rm` that), since both are deliberate human decisions. Safe to delete
// this file (and reset.yml) after the reset.
import fs from "fs";
import { join } from "path";
import { execSync } from "child_process";
import {
  log,
  printRunSummary,
  errorData,
  repoRoot,
  getWikiDir,
  publishWiki,
  fetchOpenIssues,
  PROJECT_OWNER,
  PROJECT_NUMBER,
} from "./shared.mjs";

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString();
}

function closeAllIssues() {
  const issues = fetchOpenIssues(500);
  log("info", `Closing ${issues.length} open issue(s)...`);
  for (const i of issues) {
    try {
      sh(`gh issue close ${i.number} --reason "not planned"`);
      log("info", `Closed #${i.number}: ${i.title}`);
    } catch (e) {
      log("warn", `Could not close #${i.number}`, errorData(e));
    }
  }
}

function clearBoard() {
  let items = [];
  try {
    const res = JSON.parse(
      sh(`gh project item-list ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json --limit 500`)
    );
    items = res.items || [];
  } catch (e) {
    log("warn", "Could not list board items — skipping board clear.", errorData(e));
    return;
  }
  log("info", `Removing ${items.length} board item(s)...`);
  for (const it of items) {
    try {
      sh(`gh project item-delete ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --id ${it.id}`);
    } catch (e) {
      log("warn", `Could not remove board item ${it.id}`, errorData(e));
    }
  }
}

function resetChangelog() {
  const dir = getWikiDir();
  if (!dir) {
    log("warn", "Wiki unreachable — changelog not reset.");
    return;
  }
  fs.writeFileSync(join(dir, "Changelog.md"), "# Changelog\n", "utf-8");
  publishWiki("Reset changelog for a fresh project");
}

function main() {
  log("info", "=== RESET — fresh-project cleanup ===");
  closeAllIssues();
  clearBoard(); // after closing, so any closed-→-Done items are removed too
  resetChangelog();
  log("info", "Reset complete. Remaining manual steps: set the new Vision in the wiki, delete docs/, re-enable workflows, then dispatch the Product Manager.");
  printRunSummary("Reset");
}

main();
