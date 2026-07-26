/**
 * Registry — discovers and registers all capability modules.
 * Uses top-level await to wait for capabilities to load.
 */
import { createInterpreter } from './interpreter.js';
import capabilitiesPromise from './capabilities/index.js';

const interpreter = createInterpreter();
export const capabilityMeta = [];

// Wait for capabilities to load and register them
(async () => {
  const capabilities = await capabilitiesPromise;
  for (const cap of capabilities) {
    cap.register(interpreter);
    capabilityMeta.push(cap.meta);
  }
})();

/**
 * Execute a selfgrow program using the registered interpreter.
 * Capability functions are available as identifiers during evaluation.
 */
export function run(source) {
  return interpreter.run(source);
}
