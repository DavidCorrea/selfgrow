/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Uses top-level await to eagerly import all capability modules so
 * they self-register with the interpreter registry before run() is
 * ever called. This makes run() synchronous — it just creates an
 * interpreter and evaluates source.
 *
 * New-format capabilities live in docs/lang/capabilities/. To add a
 * new capability, add its module there.
 */
import { createInterpreter, registry } from './interpreter.js';
import { getAllCapabilities } from './capabilities/registry.js';

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
