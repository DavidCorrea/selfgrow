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
import { registerCapability, getAllCapabilities, getAllMeta, checkAllProperties } from './registry.js';
import './print.js';
import './arithmetic.js';
import './comparison.js';
import './control.js';
import './list.js';
import './record.js';
import './list_ops.js';

export { registerCapability, getAllCapabilities, getAllMeta, checkAllProperties };

export const meta = {
  name: 'loader',
  summary: 'Centralized loader — imports all capabilities and bridges them into interpreter instances',
  examples: [
    { source: 'print("hello")', result: 'hello' },
    { source: '2 + 3', result: '5' },
  ],
};

/**
 * No-op: capabilities self-register at import time via static imports,
 * so the loader itself does not add language features when registered.
 */
export function register(interpreter) {
  // Capabilities already self-registered at module load time.
}

/**
 * Verify the loader works by running a program that uses both loaded
 * capabilities (print and arithmetic).
 */
export function checkProperties(run) {
  const failures = [];
  if (run('print("hello")') !== 'hello') {
    failures.push('print("hello") should return "hello"');
  }
  if (run('2 + 3') !== '5') {
    failures.push('2 + 3 should return "5"');
  }
  return failures;
}

// Self-register at module load time so the loader capability is discoverable.
registerCapability(meta, register, checkProperties);

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
