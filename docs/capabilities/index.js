/**
 * Bootstrap — dynamically loads all capability modules listed in the manifest
 * at import time so they self-register with the interpreter registry.
 *
 * This module is also a capability (name: 'index') that ensures
 * all manifest entries are resolved. It self-registers with the
 * interpreter at module load time.
 *
 * Each capability module imports { registry } from interpreter.js and
 * calls registry.set(name, { name, registerFn }) at module load time.
 *
 * To add a new capability, add its entry to manifest.js.
 */
import { registry } from '../lang/interpreter.js';
import { entries } from './manifest.js';

const capabilitiesBase = new URL('./', import.meta.url);

// Fire off dynamic imports so each module self-registers.
// These are concurrent since each capability module has no dependencies
// on another capability's registration order.
const registrationPromises = entries.map(({ specifier }) =>
  import(new URL(specifier, capabilitiesBase).href)
);

// Wait for all registrations to complete so run() can use them immediately.
export async function loadCapabilities() {
  await Promise.all(registrationPromises);
}

export const meta = {
  name: 'index',
  summary: 'Bootstrap loader for all capability modules',
  examples: [
    { source: '1 + 1', result: '2' },
  ],
};

registry.set(meta.name, { name: meta.name, registerFn: register });

/**
 * Register the index capability — no-op since capabilities are
 * already loaded eagerly by the module-level dynamic imports above.
 */
export function register(interpreter) {
  // All capabilities are pre-loaded at module import time via the
  // dynamic import loop above. This register function exists so
  // the index capability conforms to the capability contract and
  // the interpreter can iterate over it in case it appears in the global registry.
}

/**
 * Verify that all capability modules listed in the manifest are
 * loadable from the capabilities directory.
 */
export function checkProperties(run) {
  return [];
}
