/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Uses top-level await to eagerly import all capability modules listed
 * in the manifest at module load time, so they self-register with the
 * interpreter registry before run() is ever called. This makes run()
 * synchronous — it just creates an interpreter and evaluates source.
 *
 * To add a new capability, add its entry to docs/capabilities/manifest.js.
 * No changes needed here.
 */
import { createInterpreter } from './interpreter.js';
import { entries } from '../capabilities/manifest.js';
import { checkAllProperties as registryCheckAllProperties, getAllMeta, getAllCapabilities } from './capabilities/registry.js';
import { register as coreRegister } from './capabilities/core.js';

const capabilitiesBase = new URL('../capabilities/', import.meta.url);

// Eagerly import all capability modules so their top-level registration
// runs before this module's exports are available. Top-level await
// blocks module evaluation until all imports resolve.
await Promise.all(
  entries.map(({ specifier }) => import(new URL(specifier, capabilitiesBase).href))
);

// Create a module-level interpreter instance used by run().
// Core capabilities are registered via coreRegister which seeds the
// interpreter.functions Map with print builtins and arithmetic operations.
const interpreter = createInterpreter();
coreRegister(interpreter);

/**
 * Run a selfgrow program and return its printed result.
 *
 * All capabilities are pre-loaded (and self-registered) during module
 * import. Creates a fresh evaluation state for each call.
 * @param {string} source
 * @returns {string} The printed output of the program
 */
export function run(source) {
  return interpreter.run(source);
}

export { registryCheckAllProperties as checkAllProperties, getAllMeta, getAllCapabilities };
