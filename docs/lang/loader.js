/**
 * Centralized capability loader for selfgrow.
 *
 * Static imports of all capability files trigger self-registration
 * at module load time. initialize(interpreter) bridges registered
 * capabilities into interpreter instances. Re-exports the full
 * registry API so consumers don't need to know the internals.
 *
 * Adding a new capability means adding one import line here — no
 * other file changes are needed.
 */
import { registerCapability, getAllCapabilities, getAllMeta, checkAllProperties } from './capabilities/registry.js';
import './capabilities/print.js';
import './capabilities/arithmetic.js';
import './capabilities/boolean.js';
import './capabilities/comparison.js';
import './capabilities/control.js';
import './capabilities/function.js';
import './capabilities/list.js';
import './capabilities/record.js';
import './capabilities/list_ops.js';
import './capabilities/string.js';
import './capabilities/letrec.js';
import './capabilities/logicalops.js';

export { registerCapability, getAllCapabilities, getAllMeta, checkAllProperties };

/**
 * Bridge all registered capabilities into an interpreter instance.
 * Calls interpreter.register() for each capability so that when
 * interpreter.run() is invoked, all capabilities are available.
 * @param {object} interpreter - an interpreter with a register(cap) method
 */
export function initialize(interpreter) {
  for (const cap of getAllCapabilities()) {
    interpreter.register({ name: cap.meta.name, registerFn: cap.registerFn });
  }
}