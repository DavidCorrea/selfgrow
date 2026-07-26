/**
 * Runtime entry point for the selfgrow language.
 * Delegates to the registry and interpreter core.
 * Also exports capability metadata for the reference section.
 */
import { run, capabilityMeta } from './registry.js';

export { run, capabilityMeta };