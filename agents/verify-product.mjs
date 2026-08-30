// Run the build's own verification and FAIL the job when it does not pass.
//
// verifyBuild is used in two places that both merge on its result: the Devs
// before opening a PR, and review-pr before merging someone else's. Both are the
// agents grading their own work — which is fine until a swallowed error, an early
// return, or a future edit that reorders the steps skips the grading entirely.
//
// This is the same function, in a job whose exit code a repository ruleset can
// require. Nothing here is new verification; it is the existing verification made
// non-optional.
import { log, printRunSummary, verifyBuild } from "./shared.mjs";

const report = await verifyBuild();

if (report.ok) {
  log("info", "Product verification passed.");
  printRunSummary("Verify product");
  process.exit(0);
}

log("error", `Product verification failed at the ${report.layer} layer.`, { errors: report.errors });
printRunSummary("Verify product");
process.exit(1);
