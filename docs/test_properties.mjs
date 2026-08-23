import { run } from './lang/run.js';
import { checkAllProperties } from './lang/loader.js';

const failures = checkAllProperties(run);

if (failures.length > 0) {
  console.error('Property test failures:');
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  throw new Error(`Property tests failed with ${failures.length} failure(s)`);
} else {
  console.log('All property tests passed.');
}
