// Standalone app-review runner — measures docs/ and prints the report WITHOUT
// acting on it. Use it to see exactly what the Product Manager will be told about
// the live app, without triggering a full Product Manager run.
//
// No model and no API key involved — the whole review is measurement. Needs only
// a Chromium browser:
//   npx playwright install chromium && node agents/app-review.mjs
import { log, reviewApp, printRunSummary } from "./shared.mjs";

async function main() {
  log("info", "=== App Review (measured — no model involved) ===");
  const report = await reviewApp();
  if (report) {
    console.log(`\n----- App review -----\n${report}\n----------------------`);
  } else {
    log("info", "Nothing to report — see the log above for why (no page yet / Playwright missing / nothing broken).");
  }
  printRunSummary("App Review");
}

main().catch((err) => {
  log("error", `App Review failed: ${err.message || err}`);
  printRunSummary("App Review");
  process.exit(1);
});
