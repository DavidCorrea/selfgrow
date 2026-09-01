// Assert the configured model chain against the pi version that is actually
// installed. Free: pi's model snapshot is BUNDLED, so this reads no network and
// needs no OPENROUTER_API_KEY, and it spends zero requests.
//
// It exists because the failure it catches is silent. resolveTextModels() drops
// ids pi doesn't know and auto-discovers substitutes, so a pi bump that rotates
// the whole chain out doesn't crash — it quietly demotes the pipeline to
// "whatever pi happens to list first", and the only trace is a warning inside a
// run nobody reads.
//
// Two ways a chain entry breaks, both checked here:
//   missing   — the id is no longer in pi's snapshot
//   router    — a meta-router, which dispatches to an arbitrary model and makes
//               the run unreproducible
//
// It used to check a third: an entry that had stopped being free. The chain is
// two deliberately paid models now, so "it costs money" is the configuration
// rather than the breakage, and the `paid` flag that used to exempt the head from
// a free-only rule went with the rule.
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

/**
 * Classify every configured id against the registry. Returns
 * { ok, entries: [{ id, why, status, cost }], broken } where status is
 * "ok" | "missing" | "router".
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
    return { ...entry, status, cost: model?.cost };
  });

  const broken = entries.filter((e) => e.status !== "ok");
  return { ok: broken.length === 0, entries, broken, registrySize: all.length };
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
      ok: `ok — $${entry.cost?.input}/$${entry.cost?.output} per M tokens`,
      missing: "MISSING from pi's registry (rotated out?)",
      router: "META-ROUTER — dispatches to an arbitrary model, so runs aren't reproducible",
    }[entry.status];
    log(entry.status === "ok" ? "info" : "error", `  ${entry.status === "ok" ? "ok     " : "BROKEN "} ${entry.id} — ${note}`);
  }

  if (result.ok) {
    log("info", "The whole chain is valid against the installed pi.");
    return;
  }

  log("error", `${result.broken.length} of ${result.entries.length} configured model(s) are unusable.`);
  // Deliberately no suggestion list. Picking the models this pipeline runs on is a
  // judgement about cost, coding ability and provider independence — the previous
  // version could offer candidates because "any free model" was an answer, and it
  // is not one any more.
  log("info", "Choose a replacement by hand in agents/models.json: a paid model from a different provider family than the surviving entry, coding-tuned, with reasoning support.");
  process.exit(1);
}

main();
