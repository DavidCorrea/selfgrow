// Core specimen growth engine
// Pure functions for growing forms and checking invariants.

/**
 * Grow a form by applying a rule repeatedly.
 * @param {any} seed - Initial state (JSON-serializable).
 * @param {function(any):any} rule - Pure function: state -> nextState.
 * @param {number} generation - Non-negative integer number of rule applications.
 * @returns {any} The grown form (JSON-serializable).
 */
export function grow(seed, rule, generation) {
  if (typeof rule !== 'function') {
    throw new TypeError('rule must be a function');
  }
  if (!Number.isInteger(generation) || generation < 0) {
    throw new TypeError('generation must be a non-negative integer');
  }

  let state = structuredClone(seed);
  for (let i = 0; i < generation; i++) {
    state = rule(structuredClone(state));
  }
  return state;
}

/**
 * Check invariant properties for a grown form.
 * @param {any} form - The grown form (output of grow).
 * @param {number} generation - The generation number of the form.
 * @param {Object.<string, function(any):boolean>} properties - Mapping of property names to pure predicate functions.
 * @returns {Object.<string, boolean>} Map of property name to pass/fail result.
 */
export function checkProperties(form, generation, properties) {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new TypeError('properties must be an object');
  }
  const result = {};
  for (const [key, predicate] of Object.entries(properties)) {
    if (typeof predicate !== 'function') {
      throw new TypeError(`property "${key}" must be a function`);
    }
    // The predicate may optionally use generation; we pass the form only.
    // If a predicate needs generation, it should close over it.
    try {
      result[key] = !!predicate(structuredClone(form));
    } catch {
      // If predicate throws, treat as false.
      result[key] = false;
    }
  }
  return result;
}

