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

async function main() {
  const models = (process.argv[2] || TEXT_MODELS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  log("info", `=== Model probe — ${models.length} model(s), 2 configurations each ===`);

  const rows = [];
  for (const modelId of models) {
    for (const [config, tools] of [["no tools", []], ['tools:["read"]', ["read"]]]) {
      try {
        const r = await probe(modelId, tools);
        rows.push({ modelId, config, ...r });
        log("info", `${modelId} [${config}] → ${r.usable ? "usable" : "UNUSABLE"} (${r.seconds}s) ${r.flags.join(", ")}`);
      } catch (e) {
        log("error", `Stopping: ${e.message}`);
        rows.push({ modelId, config, usable: false, flags: ["QUOTA"], chars: 0, preview: "", seconds: "-" });
        printReport(rows);
        return;
      }
    }
  }
  printReport(rows);
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

main().catch((e) => {
  log("error", `Probe failed: ${e.message}`);
  process.exit(1);
});
