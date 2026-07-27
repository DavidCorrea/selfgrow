/**
 * Capability index — static loader for all new-format capability modules.
 *
 * Each import line below causes the imported module to call
 * registerCapability() at top-level scope, wiring itself into the
 * in-memory registry in registry.js. When a new capability file is added,
 * adding one import line is the only change needed.
 *
 * Exports initialize(interpreter) and registry APIs so run.js and
 * worker.js can bootstrap capabilities in one place.
 */

// Re-export registry APIs so consumers can access them directly.
export {
  registerCapability,
  getAllCapabilities,
  getAllMeta,
  checkAllProperties,
} from './registry.js';

// New-format capability modules — each self-registers at import time.
import './core.js';

import { getAllCapabilities } from './registry.js';

/**
 * Wire all registered capabilities into an interpreter instance.
 * Calls interpreter.register({ name, registerFn }) for each capability
 * so that interpreter.run() loads them when evaluating source.
 * @param {object} interpreter - an interpreter instance with register(cap) method
 */
export function initialize(interpreter) {
  for (const cap of getAllCapabilities()) {
    interpreter.register({ name: cap.meta.name, registerFn: cap.registerFn });
  }
}
