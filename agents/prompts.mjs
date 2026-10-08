/**
 * Prompts, and reading what an agent sends back.
 *
 * Standard agent response envelope:
 *   { status: "success"|"error", summary: string, outcome?: string, data: object }
 *
 * Outcome values for gate agents:
 *   "approve" — yes, proceed
 *   "reject"  — no, stop
 *   "revise"  — needs changes
 *   "skip"    — nothing to do
 */

import fs from "fs";
import { join } from "path";
import { log } from "./log.mjs";
import { promptsDir } from "./paths.mjs";

// ---------------------------------------------------------------------------
// Prompt loading
// ---------------------------------------------------------------------------

export function loadPrompt(name) {
  const raw = fs.readFileSync(join(promptsDir, `${name}.md`), "utf-8");
  // Inline shared partials referenced as {{include:partial-name}} (one level).
  return raw.replace(/\{\{include:([\w-]+)\}\}/g, (_, partial) =>
    fs.readFileSync(join(promptsDir, `${partial}.md`), "utf-8").trim()
  );
}

/**
 * Substitute `{{NAME}}` placeholders; a name with no replacement stays as written.
 *
 * One pass with a replacer function, and both halves matter. The values are
 * diffs, files and issue bodies, so as a replacement STRING a `$&` or `$'` in
 * them expanded into the template around it. And substituting one key at a time
 * meant a value that happened to contain `{{VISION}}` — a prompt file in a diff,
 * a stranger's PR body — was expanded by the next key, splicing prompt text in
 * wherever the value said.
 */
export function fillTemplate(template, replacements) {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name) =>
    Object.hasOwn(replacements, name) ? String(replacements[name]) : placeholder
  );
}

// ---------------------------------------------------------------------------
// JSON extraction + envelope validation
// ---------------------------------------------------------------------------

export function extractJSON(label, text) {
  // Try to extract from a fenced code block first
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = blockMatch ? blockMatch[1].trim() : text.trim();

  // Try direct parse first
  try {
    return JSON.parse(candidate);
  } catch { /* fall through */ }

  // Try to find a complete JSON object by matching braces.
  const jsonObj = extractFirstJSONObject(candidate);
  if (jsonObj) {
    try {
      return JSON.parse(jsonObj);
    } catch { /* fall through */ }
  }

  const snippet = text.length > 200 ? text.slice(0, 200) + "…" : text;
  log("warn", `${label}: output could not be parsed as JSON`, { raw: snippet });
  return null;
}

/**
 * Quietly test whether text contains a parseable JSON object, for deciding
 * whether to accept a model's answer or fall through to the next model. Unlike
 * extractJSON this logs nothing — a rejected attempt is routine, not a problem.
 */
export function containsParseableJSON(text) {
  const t = (text || "").trim();
  if (!t) return false;
  const block = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = block ? block[1].trim() : t;
  try {
    JSON.parse(candidate);
    return true;
  } catch { /* fall through */ }
  const obj = extractFirstJSONObject(candidate);
  if (!obj) return false;
  try {
    JSON.parse(obj);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the first complete JSON object from a string by counting brace depth.
 * Handles braces inside JSON strings correctly.
 */
function extractFirstJSONObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse and validate the standard agent response envelope + data shape.
 *
 * @param {string} label - Agent name for logging
 * @param {string} text - Raw agent output
 * @param {object} options
 * @param {boolean} [options.requireOutcome=true] - Whether outcome field is required
 * @param {string[]} [options.requiredDataFields] - Required fields in data object
 * @returns {object|null} Parsed response or null on failure
 */
export function extractAgentResponse(label, text, { requireOutcome = true, requiredDataFields = [] } = {}) {
  const parsed = extractJSON(label, text);
  if (!parsed) return null;

  if (!parsed.status || !parsed.summary || !parsed.data) {
    log("warn", `${label}: response missing required envelope fields (status, summary, data)`);
    return null;
  }

  if (requireOutcome && !parsed.outcome) {
    log("warn", `${label}: response missing required envelope field: outcome`);
    return null;
  }

  if (parsed.status === "error") {
    log("warn", `${label}: ${parsed.summary}`);
    return null;
  }

  // Validate data shape
  if (requiredDataFields.length > 0) {
    const missing = requiredDataFields.filter((f) => !(f in parsed.data));
    if (missing.length > 0) {
      log("warn", `${label}: data missing required fields: ${missing.join(", ")}`);
      return null;
    }
  }

  return parsed;
}
