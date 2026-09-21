/**
 * webmcp.js — publishes the product's tools to the browser's agent API.
 *
 * HARNESS CODE. This file is not part of the product: do not edit it as part of
 * a product ticket, and never call the WebMCP API from anywhere else.
 *
 * The specification is young and has already moved once — the call was
 * `navigator.modelContext.provideContext()` and is now
 * `document.modelContext.registerTool()`. Every product this pipeline grows
 * would otherwise have to learn that separately, from a model whose training
 * predates the change. Keeping the one call here means a spec revision costs one
 * commit against one file, and `docs/agenttools.js` never names the API at all.
 *
 * Registration is best-effort by design. `document.modelContext` is undefined in
 * a browser that has not shipped WebMCP, and in any non-secure context. The
 * product must work where the API does not exist, so nothing here throws into
 * the page.
 */

import { tools } from "./agenttools.js";

/**
 * Register every tool the product declares.
 *
 * @returns {Promise<number>} how many tools were accepted by the browser.
 */
export async function registerAgentTools(target = globalThis.document) {
  const modelContext = target && target.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return 0;

  let registered = 0;
  for (const tool of tools()) {
    try {
      // Only the specification's own fields are forwarded. `example` is ours,
      // and exists for the build rather than for the browser.
      await modelContext.registerTool({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute: tool.execute,
      });
      registered += 1;
    } catch (e) {
      // One malformed tool must not cost the page the rest of them. A warning
      // rather than an error: the build treats console errors as failures, and
      // the tool layer has its own verification layer that reports this better.
      console.warn(`webmcp: could not register "${tool.name}" — ${e.message}`);
    }
  }
  return registered;
}

registerAgentTools();
