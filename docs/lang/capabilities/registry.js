/**
 * In-memory capability registry for the selfgrow language.
 *
 * Capabilities register themselves at module load time via
 * registerCapability(). The registry stores metadata, registration,
 * and property-checking functions, making all capabilities discoverable
 * and testable from a single place.
 */
const capabilities = new Map();

/**
 * Register a capability with the registry.
 * @param {{ name: string, summary: string, examples: Array<{source: string, result: string}> }} meta
 * @param {(interpreter: object) => void} registerFn - called with the interpreter instance to wire builtins
 * @param {(run: (source: string) => string) => string[]} [checkFn] - optional property checker, returns failure messages
 */
export function registerCapability(meta, registerFn, checkFn) {
  capabilities.set(meta.name, { meta, registerFn, checkFn });
}

/**
 * Get metadata for all registered capabilities.
 * @returns {Array<{name: string, summary: string, examples: Array<{source: string, result: string}>}>}
 */
export function getAllMeta() {
  return Array.from(capabilities.values()).map(c => c.meta);
}

/**
 * Get all registered capability entries.
 * @returns {Array<{meta: object, registerFn: Function, checkFn?: Function}>}
 */
export function getAllCapabilities() {
  return Array.from(capabilities.values());
}

/**
 * Run checkProperties for every capable capability and collect failures.
 * @param {(source: string) => string} run - the language's run function
 * @returns {string[]} Array of failure messages; empty when all properties hold
 */
export function checkAllProperties(run) {
  const failures = [];
  for (const cap of capabilities.values()) {
    if (typeof cap.checkFn === 'function') {
      failures.push(...cap.checkFn(run));
    }
  }
  return failures;
}
