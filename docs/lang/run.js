/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Uses the centralized capability loader (capabilities/index.js) to
 * wire all capabilities into a fresh interpreter instance. run()
 * is synchronous — it creates an interpreter, initializes it, and
 * evaluates source.
 *
 * The interpreter factory is also exported so capabilities and
 * playground code can register directly on interpreter instances.
 */
import { createInterpreter } from './interpreter.js';
import { initialize } from './capabilities/index.js';

export { createInterpreter };

/**
 * Run a selfgrow program and return its printed result.
 *
 * Creates a fresh interpreter instance for each call and
 * initializes it with all registered capabilities.
 * @param {string} source
 * @returns {string} The printed output of the program
 */
export function run(source) {
  const interpreter = createInterpreter();
  initialize(interpreter);
  return interpreter.run(source);
}
