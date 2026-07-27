/**
 * Capability registry for the selfgrow language.
 * Stores capability modules in an in-memory Map and provides
 * lookup and property-checking utilities.
 */

const capabilities = new Map();

/**
 * Register a capability with the in-memory map.
 * @param {object} meta - Capability metadata (name, summary, examples)
 * @param {function} registerFn - Called with the interpreter to wire in the capability
 * @param {function} checkFn - Returns an array of failure strings (empty when all checks pass)
 */
export function registerCapability(meta, registerFn, checkFn) {
  capabilities.set(meta.name, { meta, registerFn, checkFn });
}

/**
 * Return metadata for every registered capability.
 */
export function getAllMeta() {
  return Array.from(capabilities.values()).map((c) => c.meta);
}

/**
 * Return every registered capability object { meta, registerFn, checkFn }.
 */
export function getAllCapabilities() {
  return Array.from(capabilities.values());
}

/**
 * Run checkProperties for every registered capability and collect failures.
 * @param {function} run - The selfgrow run function used to execute example programs
 * @returns {string[]} Array of failure messages (empty when all pass)
 */
export function checkAllProperties(run) {
  const failures = [];
  for (const { meta, checkFn } of capabilities.values()) {
    const result = checkFn(run);
    if (result && result.length > 0) {
      failures.push(...result.map((f) => `${meta.name}: ${f}`));
    }
  }
  return failures;
}
