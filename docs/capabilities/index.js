/**
 * Bootstrap — dynamically loads all capability modules listed in the manifest
 * at import time so they self-register with the interpreter registry.
 *
 * Each capability module imports { registry } from interpreter.js and
 * calls registry.set(name, { name, registerFn }) at module load time.
 *
 * To add a new capability, add its entry to manifest.js.
 */
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
