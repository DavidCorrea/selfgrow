/**
 * Capability manifest — lists all capability module specifiers
 * so the bootstrap can dynamically import them.
 *
 * This module itself is also a capability (name: 'manifest') that
 * makes the manifest entries available as a builtin so programs
 * can introspect what capabilities exist.
 *
 * To add a new capability, add its URL (relative to this file)
 * to the list below. The bootstrap will import it eagerly.
 */
import { registry } from '../lang/interpreter.js';

export const entries = [
  { name: 'manifest', specifier: './manifest.js' },
  { name: 'print', specifier: './print.js' },
];

export const specifiers = entries.map(e => e.specifier);

export const meta = {
  name: 'manifest',
  summary: 'Lists the capabilities available for dynamic loading',
  examples: [
    { source: 'manifest()', result: 'manifest,print' },
  ],
};

function registerManifest(interpreter) {
  interpreter.addBuiltin('manifest', function() {
    return entries.map(e => e.name).join(',');
  });
}

registry.set(meta.name, { name: meta.name, registerFn: registerManifest });

/**
 * Register the manifest capability with the interpreter,
 * adding the manifest() builtin that returns a comma-separated
 * list of available capability names.
 */
export function register(interpreter) {
  registerManifest(interpreter);
}

/**
 * Verify that the manifest builtin lists all registered capabilities.
 */
export function checkProperties(run) {
  const failures = [];
  const result = run('manifest()');
  if (!result.includes('print')) {
    failures.push('manifest() must list print capability');
  }
  if (!result.includes('manifest')) {
    failures.push('manifest() must list manifest capability');
  }
  return failures;
}
