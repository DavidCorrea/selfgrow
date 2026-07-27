/**
 * Runtime bootstrap for the selfgrow language.
 *
 * Dynamically imports all capability modules listed in the manifest,
 * so they self-register with the interpreter registry at module load time.
 * Then creates a fresh interpreter instance and runs the source program.
 *
 * To add a new capability, add its entry to docs/capabilities/manifest.js.
 * No changes needed here.
 */
import { createInterpreter } from './interpreter.js';
import { entries } from '../capabilities/manifest.js';

const capabilitiesBase = new URL('../capabilities/', import.meta.url);

/**
 * Run a selfgrow program and return its printed result.
 *
 * Dynamically loads all registered capability modules so they
 * self-register with the interpreter, creates a fresh interpreter,
 * and evaluates the source.
 * @param {string} source
 * @returns {Promise<string>} The printed output of the program
 */
export async function run(source) {
  // Import all capability modules so their top-level registration runs.
  // Each module calls registry.set(...) at load time to register itself.
  for (const { specifier } of entries) {
    await import(new URL(specifier, capabilitiesBase).href);
  }

  const interpreter = createInterpreter();
  return interpreter.run(source);
}

