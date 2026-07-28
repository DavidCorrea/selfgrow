/**
 * Capability registry — in-memory Map and helper functions
 * for managing selfgrow capabilities.
 *
 * Each capability registers itself via registerCapability(meta, registerFn, checkFn).
 * The registry provides lookup and bulk operations so capabilities
 * can be discovered, loaded, and validated independently.
 */

const capabilities = new Map();

export const meta = {
  name: 'registry',
  summary: 'Infrastructure — manages registration and discovery of language capabilities',
  examples: [
    { source: 'print("ok")', result: 'ok' },
  ],
};

export function register(interpreter) {
  // Registry is infrastructure, not a language runtime feature.
}

export function checkProperties(run) {
  const failures = [];
  if (typeof run !== 'function') {
    failures.push('checkProperties requires a run function');
  }
  return failures;
}

registerCapability(meta, register, checkProperties);

/**
 * Register a capability with the in-memory registry.
 * @param {{ name: string, summary: string, examples: Array<{source: string, result: string}> }} meta
 * @param {(interpreter: object) => void} registerFn - wires the capability into an interpreter
 * @param {(run: (source: string) => string) => string[]} checkFn - runs property checks
 */
export function registerCapability(meta, registerFn, checkFn) {
  capabilities.set(meta.name, { meta, registerFn, checkFn });
}

/**
 * Return metadata for all registered capabilities.
 * @returns {Array}
 */
export function getAllMeta() {
  return Array.from(capabilities.values()).map((c) => c.meta);
}

/**
 * Return all registered capability objects.
 * @returns {Array<{meta: object, registerFn: Function, checkFn: Function}>}
 */
export function getAllCapabilities() {
  return Array.from(capabilities.values()).map((c) => ({
    meta: c.meta,
    registerFn: c.registerFn,
    checkFn: c.checkFn,
  }));
}

/**
 * Run checkProperties for every registered capability and
 * return the combined list of failure messages.
 * @param {(source: string) => string} run - run(source) executes a program and returns its output
 * @returns {string[]} - empty when all properties hold
 */
export function checkAllProperties(run) {
  const failures = [];
  for (const cap of capabilities.values()) {
    const result = cap.checkFn(run);
    if (Array.isArray(result)) {
      failures.push(...result);
    }
  }
  return failures;
}

