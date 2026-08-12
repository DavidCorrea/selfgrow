// Ask every model in the chain the same question and report HOW it answers.
//
// The chain is ordered by a guess — biggest and most coding-tuned first — but what
// actually matters is whether a model returns the JSON envelope the agents parse.
// A model that writes beautiful prose where an envelope belongs is useless here,
// however large it is, and one production failure (`</tool_call>` as the entire
// response) suggests the answer depends on whether tools are offered at all.
//
// So this probes each model twice, with and without a tool, and reports the shape
// of what comes back rather than its content.
//
//   node agents/model-probe.mjs              # the configured chain
//   node agents/model-probe.mjs a/b:free,c/d # specific models
//   node agents/model-probe.mjs --json       # machine-readable, for pi-update.mjs
//
// COSTS REAL REQUESTS: two per model, charged against the daily cap whatever the
// answer looks like. runAgent records them in the shared ledger, so a probe run
// is visible to every other agent that day.
import { pathToFileURL } from "url";
import {
  log,
  runAgent,
  TEXT_MODELS,
  getModelRequestCount,
  isDailyQuotaExhausted,
} from "./shared.mjs";

// A realistic stand-in for what every agent is asked to do: think a little, then
// answer in the envelope. Deliberately trivial so a failure is about FORM, never
// about the model finding the task hard.
const SYSTEM_PROMPT = `You are a TEST AGENT verifying your own output format.

Your task: report the number of sides on a triangle.

## Response Format

Respond with **ONLY** a valid JSON object — no prose, no markdown, nothing before or after it.

{
  "status": "success",
  "summary": "One sentence describing the result.",
  "outcome": "approve",
  "data": { "sides": 3 }
}`;

// Classify the response shape. Each flag is something that has actually broken a
// production run, or that the parser has to work around.
function describe(raw) {
  const text = raw || "";
  const trimmed = text.trim();
  const flags = [];

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch { /* not bare JSON */ }

  const fenced = /```/.test(text);
  if (fenced) flags.push("code-fenced");
  if (/<\/?tool_call>|<\|.*?\|>|<function.*?>/i.test(text)) flags.push("TOOL-CALL LEAK");
  if (!parsed && /^[A-Za-z]/.test(trimmed)) flags.push("prose preamble");
  if (/^\s*<think>|<\/think>/i.test(text)) flags.push("thinking tags");

  // Would the agents' own extractor cope?
  let envelope = null;
  if (parsed) envelope = parsed;
  else {
    const block = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = block ? block[1] : text.slice(text.indexOf("{"));
    try { envelope = JSON.parse(candidate.trim()); } catch { /* unparseable */ }
  }
  if (!envelope) {
    const start = text.indexOf("{");
    if (start !== -1) {
      // Brace-count the first object, the way extractJSON does.
      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') inStr = !inStr;
        if (inStr) continue;
        if (c === "{") depth++;
        if (c === "}" && --depth === 0) { end = i; break; }
      }
      if (end !== -1) { try { envelope = JSON.parse(text.slice(start, end + 1)); } catch { /* no */ } }
    }
  }

  const usable = Boolean(envelope && envelope.status && envelope.summary && envelope.data);
  if (envelope && !usable) flags.push("JSON but wrong envelope");
  if (parsed) flags.push("bare JSON");
  else if (envelope) flags.push("JSON needs extraction");

  return { usable, flags, chars: trimmed.length, preview: trimmed.replace(/\s+/g, " ").slice(0, 70) };
}

async function probe(modelId, tools) {
  const started = Date.now();
  try {
    const raw = await runAgent({
      label: `probe ${modelId}`,
      modelId, // pin a single model: no chain, so a failure is attributable
      systemPrompt: SYSTEM_PROMPT,
      tools,
      expectJson: false, // we want the RAW answer, not a retry
    });
    return { ...describe(raw), seconds: ((Date.now() - started) / 1000).toFixed(1) };
  } catch (e) {
    if (isDailyQuotaExhausted(e)) throw e; // no point probing the rest
    return {
      usable: false,
      flags: ["ERROR"],
      chars: 0,
      preview: String(e.message).split("\n")[0].slice(0, 70),
      seconds: ((Date.now() - started) / 1000).toFixed(1),
    };
  }
}

// Both configurations, because one production failure ("</tool_call>" as the whole
// response) suggested the answer depends on whether tools are offered at all.
const CONFIGS = [["no tools", []], ['tools:["read"]', ["read"]]];

/**
 * Probe each model twice and report the shape of what comes back.
 *
 * A model counts as usable only when BOTH configurations produce a parseable
 * envelope: the agents call it with tools and without, so passing one and failing
 * the other means the chain still breaks, just less often. Stops early and marks
 * the remainder "QUOTA" when the account's daily free cap is hit.
 *
 * @param {string[]} models - chain ids to probe
 * @returns {Promise<{rows: object[], usableIds: string[], quotaHit: boolean}>}
 */
export async function probeModels(models) {
  const rows = [];
  let quotaHit = false;

  for (const modelId of models) {
    if (quotaHit) {
      for (const [config] of CONFIGS) {
        rows.push({ modelId, config, usable: false, flags: ["QUOTA"], chars: 0, preview: "", seconds: "-" });
      }
      continue;
    }
    for (const [config, tools] of CONFIGS) {
      try {
        const r = await probe(modelId, tools);
        rows.push({ modelId, config, ...r });
        log("info", `${modelId} [${config}] → ${r.usable ? "usable" : "UNUSABLE"} (${r.seconds}s) ${r.flags.join(", ")}`);
      } catch (e) {
        log("error", `Stopping: ${e.message}`);
        quotaHit = true;
        rows.push({ modelId, config, usable: false, flags: ["QUOTA"], chars: 0, preview: "", seconds: "-" });
      }
    }
  }

  const usableIds = models.filter((id) => {
    const mine = rows.filter((r) => r.modelId === id);
    return mine.length === CONFIGS.length && mine.every((r) => r.usable);
  });
  return { rows, usableIds, quotaHit };
}

/** A Markdown table of probe results, for a PR body or a job summary. */
export function renderProbeTable(rows) {
  const short = (id) => id.replace(/^openrouter\//, "").replace(/:free$/, "");
  return [
    "| model | config | usable | secs | notes |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) => `| \`${short(r.modelId)}\` | ${r.config} | ${r.usable ? "yes" : "**no**"} | ${r.seconds} | ${r.flags.join(", ") || "—"} |`
    ),
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const asJson = process.argv.includes("--json");
  const models = (args[0] || TEXT_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  log("info", `=== Model probe — ${models.length} model(s), ${CONFIGS.length} configurations each (${models.length * CONFIGS.length} requests) ===`);

  const { rows, usableIds, quotaHit } = await probeModels(models);
  if (asJson) console.log(JSON.stringify({ rows, usableIds, quotaHit }, null, 2));
  else printReport(rows);
}

function printReport(rows) {
  const short = (id) => id.replace(/^openrouter\//, "").replace(/:free$/, "");
  console.log(`\n${"model".padEnd(42)}${"config".padEnd(15)}${"usable".padEnd(9)}${"secs".padEnd(7)}notes`);
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      short(r.modelId).padEnd(42) +
      r.config.padEnd(15) +
      (r.usable ? "yes" : "NO").padEnd(9) +
      String(r.seconds).padEnd(7) +
      r.flags.join(", ")
    );
  }
  console.log("\nraw previews:");
  for (const r of rows) {
    console.log(`  ${short(r.modelId)} [${r.config}] ${r.chars}ch: ${r.preview || "(empty)"}`);
  }
  console.log(`\nrequests spent: ${getModelRequestCount()}`);
}

// Only probe when RUN, never when imported. pi-update.mjs imports probeModels and
// renderProbeTable from here, and a bare main() call would make that import spend
// requests as a side effect of loading the module.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    log("error", `Probe failed: ${e.message}`);
    process.exit(1);
  });
}
