/**
 * Bootstrap — dynamically loads all capability modules listed in the manifest
 * at import time so they self-register with the registry.
 * Updated to import core.js from the new capabilities directory
 * and use the new registry pattern (docs/lang/capabilities/registry.js).
 */
import { registerCapability } from '../lang/capabilities/registry.js';
import { entries } from './manifest.js';

const capabilitiesBase = new URL('./', import.meta.url);

// Fire off dynamic imports so each module self-registers.
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

registerCapability(meta, function register(_interpreter) {
  // All capabilities are pre-loaded at module import time via the
  // dynamic import loop above. This register function exists so
  // the index capability conforms to the capability contract.
}, function checkProperties(run) {
  return [];
});