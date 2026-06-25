// Standalone visual-critique runner — screenshots docs/ and prints the vision
// model's critique WITHOUT acting on it. Use it to watch how the critique behaves
// and to tune VISION_MODEL or the prompt, without triggering a full Product
// Manager run.
//
// Needs OPENROUTER_API_KEY and a Chromium browser:
//   OPENROUTER_API_KEY=... npx playwright install chromium && node agents/visual-critique.mjs
import { log, readVision, visualCritique, printRunSummary } from "./shared.mjs";

async function main() {
  log("info", `=== Visual Critique (model: ${process.env.VISION_MODEL || "default"}) ===`);
  const vision = readVision();
  const critique = await visualCritique(vision);
  if (critique) {
    console.log(`\n----- Visual critique -----\n${critique}\n---------------------------`);
  } else {
    log("info", "No critique produced — see the log above for why (missing key / no page / model error).");
  }
  printRunSummary("Visual Critique");
}

main().catch((err) => {
  log("error", `Visual Critique failed: ${err.message || err}`);
  printRunSummary("Visual Critique");
  process.exit(1);
});
