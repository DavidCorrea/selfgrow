/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Loads new-format capability modules via the capability index so each
 * self-registers at module load time. Then bridges all registered
 * capabilities into the interpreter's global registry so run() picks
 * them up when evaluating source.
 *
 * To add a new capability, add one import line to index.js.
 */
import { createInterpreter } from './interpreter.js';
import { initialize } from './capabilities/index.js';

// Bridge all new-format capabilities into the interpreter's global registry
// at module load time so they are available before run() is ever called.
initialize(createInterpreter());

/**
 * Run a selfgrow program and return its printed result.
 * All capabilities are pre-loaded (and self-registered) during module
 * import. Creates a fresh interpreter instance for each call.
 * @param {string} source
 * @returns {string} The printed output of the program
 */
export function run(source) {
  const interpreter = createInterpreter();
  return interpreter.run(source);
}
