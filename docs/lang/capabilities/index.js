/**
 * Central capability loader for selfgrow.
 *
 * Loads both new-format capabilities (static imports from this directory)
 * and old-format capabilities (dynamic imports from docs/capabilities/).
 * Bridges new-format capabilities into the interpreter's global registry
 * so they are available when run() is called.
 *
 * To add a new new-format capability, add its import below.
 * To add a new old-format capability, add it to docs/capabilities/manifest.js.
 */
import { registry } from '../interpreter.js';
import { entries } from '../../capabilities/manifest.js';
import { getAllCapabilities, getAllMeta } from './registry.js';

const capabilitiesBase = new URL('../../capabilities/', import.meta.url);

// Dynamically import old-format capabilities so they self-register with
// the interpreter's global registry at load time.
await Promise.all(
  entries.map(({ specifier }) => import(new URL(specifier, capabilitiesBase).href))
);

// Static imports of all new-format capability modules.
// Adding a new capability means adding its import here — it registers
// itself via registerCapability() at module load time.
import './core.js';

// Bridge new-format capabilities from the in-memory registry into the
// interpreter's global registry so createInterpreter().run() picks them up.
for (const cap of getAllCapabilities()) {
  registry.set(cap.meta.name, { meta: cap.meta, registerFn: cap.registerFn });
}

export { registry, getAllCapabilities, getAllMeta };

/**
 * Initialize the interpreter with all capabilities.
 * Capabilities are already loaded and bridged at import time, so this is
 * provided for API compatibility and for consumers that need to explicitly
 * trigger initialization.
 */
export function initialize() {
  // All capabilities are already initialized at import time.
}

export const meta = {
  name: 'capability-loader',
  summary: 'Central loader for all selfgrow capabilities',
  examples: [],
};
