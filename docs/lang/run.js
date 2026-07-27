/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Uses top-level await to eagerly import all capability modules listed
 * in the manifest at module load time, so they self-register with the
 * interpreter registry before run() is ever called. This makes run()
 * synchronous — it just creates an interpreter and evaluates source.
 *
 * Also loads new-format capabilities from docs/lang/capabilities/ so the
 * capability module format is exercised from day one.
 *
 * To add a new capability, add its entry to docs/capabilities/manifest.js
 * (old format) or docs/lang/capabilities/ (new format).
 */
import { createInterpreter, registry } from './interpreter.js';
import { entries } from '../capabilities/manifest.js';
import { getAllCapabilities } from './capabilities/registry.js';

const capabilitiesBase = new URL('../capabilities/', import.meta.url);

// Eagerly import all old-format capability modules so their top-level
// registration runs before this module's exports are available.
await Promise.all(
  entries.map(({ specifier }) => import(new URL(specifier, capabilitiesBase).href))
);

// Import new-format capability modules so they self-register with the
// in-memory registry in registry.js. Then bridge them into the interpreter's
// global registry so run() picks them up.
await import('./capabilities/core.js');
for (const cap of getAllCapabilities()) {
  registry.set(cap.meta.name, { meta: cap.meta, registerFn: cap.registerFn });
}

/**
 * Run a selfgrow program and return its printed result.
 *
 * All capabilities are pre-loaded (and self-registered) during module
 * import. Creates a fresh interpreter instance for each call.
 * @param {string} source
 * @returns {string} The printed output of the program
 */
export function run(source) {
  const interpreter = createInterpreter();
  return interpreter.run(source);
}
