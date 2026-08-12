// Assert the configured model chain against the pi version that is actually
// installed. Free: pi's model snapshot is BUNDLED, so this reads no network and
// needs no OPENROUTER_API_KEY, and it spends zero requests.
//
// It exists because the failure it catches is silent. resolveTextModels() drops
// ids pi doesn't know and auto-discovers substitutes, so a pi bump that rotates
// the whole chain out doesn't crash — it quietly demotes the pipeline to
// "whatever four free models pi happens to list first", and the only trace is a
// warning inside a run nobody reads. A day's 1000 requests is too much to spend
// discovering that.
//
// Three ways a chain entry breaks, all of them checked here:
//   missing   — the id is no longer in pi's snapshot (its free lineup rotates)
//   paid      — the id still exists but no longer costs 0/0, so every fallback
//               now bills real money against a key provisioned for free models
//   router    — a meta-router, which dispatches to an arbitrary model and makes
//               the run unreproducible
//
//   node agents/model-check.mjs           # human-readable, exit 1 on any breakage
//   node agents/model-check.mjs --json    # machine-readable, for the update workflow
import {
  log,
  readModelChain,
  listRegistryModels,
  registryModelId,
  META_ROUTER_IDS,
  TEXT_MODELS,
} from "./shared.mjs";

// How many replacement candidates to name. Enough to choose from, few enough that
// probing them all stays affordable (each costs 2 requests in pi-update.mjs).
const MAX_SUGGESTIONS = 6;

const isFree = (m) => m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0;

/**
 * Classify every configured id against the registry. Returns
 * { ok, entries: [{ id, why, status }], broken, suggestions } where status is
 * "ok" | "missing" | "paid" | "router".
 */
export async function checkModelChain() {
  const all = await listRegistryModels();
  const byId = new Map(all.map((m) => [registryModelId(m), m]));

  // TEXT_MODEL (env) overrides the file, so check whatever the agents would
  // actually use — a CI run pinning a model deserves the same assertion.
  const configured = process.env.TEXT_MODEL
    ? TEXT_MODELS.map((id) => ({ id, why: "(from the TEXT_MODEL environment variable)" }))
    : readModelChain();

  const entries = configured.map((entry) => {
    const model = byId.get(entry.id);
    let status = "ok";
    if (!model) status = "missing";
    else if (META_ROUTER_IDS.has(model.id) || META_ROUTER_IDS.has(entry.id)) status = "router";
    else if (!isFree(model)) status = "paid";
    return { ...entry, status };
  });

  const broken = entries.filter((e) => e.status !== "ok");

  // Candidates for anything broken: free, non-router, and not already in the chain.
  // Deliberately NOT ranked by size — the chain is ordered by envelope reliability,
  // which only a live probe can measure, so these are unordered candidates rather
  // than a recommendation.
  const inChain = new Set(entries.map((e) => e.id));
  const suggestions = all
    .filter(
      (m) =>
        m.provider === "openrouter" &&
        isFree(m) &&
        !META_ROUTER_IDS.has(m.id) &&
        !inChain.has(registryModelId(m))
    )
    .map(registryModelId)
    .sort()
    .slice(0, MAX_SUGGESTIONS);

  return { ok: broken.length === 0, entries, broken, suggestions, registrySize: all.length };
}

async function main() {
  const asJson = process.argv.includes("--json");
  let result;
  try {
    result = await checkModelChain();
  } catch (e) {
    // A registry that can't be read at all is a hard failure, not a warning: it
    // means the installed pi is broken or incompatible, and every agent would
    // fail on its first call anyway.
    if (asJson) console.log(JSON.stringify({ ok: false, error: e.message }, null, 2));
    log("error", `Model check: could not read pi's registry — ${e.message}`);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (!result.entries.length) {
    log("error", "Model check: the chain is EMPTY — agents/models.json is missing, unreadable, or has no `text` entries.");
    process.exit(1);
  }

  log("info", `=== Model check — ${result.entries.length} configured model(s) against ${result.registrySize} pi knows ===`);
  for (const entry of result.entries) {
    const note = {
      ok: "ok",
      missing: "MISSING from pi's registry (rotated out?)",
      paid: "NO LONGER FREE — it would bill real money",
      router: "META-ROUTER — dispatches to an arbitrary model, so runs aren't reproducible",
    }[entry.status];
    log(entry.status === "ok" ? "info" : "error", `  ${entry.status === "ok" ? "ok     " : "BROKEN "} ${entry.id} — ${note}`);
  }

  if (result.ok) {
    log("info", "The whole chain is valid against the installed pi.");
    return;
  }

  log("error", `${result.broken.length} of ${result.entries.length} configured model(s) are unusable.`);
  if (result.suggestions.length) {
    log("info", `Free models pi currently knows that aren't in the chain:\n  ${result.suggestions.join("\n  ")}`);
    log("info", "Verify any replacement with `node agents/model-probe.mjs <id>` before trusting it — existing in the registry says nothing about whether it returns the JSON envelope the agents parse.");
  } else {
    log("error", "pi knows no other free OpenRouter models — the chain cannot be repaired automatically.");
  }
  process.exit(1);
}

main();
