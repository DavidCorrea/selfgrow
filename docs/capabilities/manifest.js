/**
 * Capability manifest — lists all capability module specifiers
 * so the bootstrap can dynamically import them.
 * Updated to use the new registry pattern (docs/lang/capabilities/registry.js).
 *
 * To add a new capability, add its URL (relative to this file)
 * to the entries list below. The bootstrap will import it eagerly.
 */
import { registerCapability } from '../lang/capabilities/registry.js';

export const entries = [
  { name: 'core', specifier: '../lang/capabilities/core.js' },
  { name: 'manifest', specifier: './manifest.js' },
  { name: 'print', specifier: './print.js' },
];

export const specifiers = entries.map(e => e.specifier);

export const meta = {
  name: 'manifest',
  summary: 'Lists the capabilities available for dynamic loading',
  examples: [
    { source: 'manifest()', result: 'core,manifest,print' },
  ],
};

function registerManifest(interpreter) {
  interpreter.addBuiltin('manifest', function() {
    return entries.map(e => e.name).join(',');
  });
}

registerCapability(meta, registerManifest, function(run) {
  const failures = [];
  const result = run('manifest()');
  if (!result.includes('print')) {
    failures.push('manifest() must list print capability');
  }
  if (!result.includes('manifest')) {
    failures.push('manifest() must list manifest capability');
  }
  if (!result.includes('core')) {
    failures.push('manifest() must list core capability');
  }
  return failures;
});
