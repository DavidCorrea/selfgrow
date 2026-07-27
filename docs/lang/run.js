/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Imports the core capability module so it self-registers with the
 * registry at module load time. This makes run() synchronous — it
 * just creates an interpreter and evaluates source.
 */
import { createInterpreter } from './interpreter.js';

// Core capability self-registers at module load time.
import './capabilities/core.js';

/**
 * Run a selfgrow program and return its printed result.
 *
 * Creates a fresh interpreter, registers all capabilities from
 * the global registry, then evaluates source.
 * @param {string} source
 * @returns {string} The printed output of the program
 */
export function run(source) {
  const interpreter = createInterpreter();
  return interpreter.run(source);
}
