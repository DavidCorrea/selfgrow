import { run } from './lang/run.js';

// Test list operations
const tests = [
  ['head(cons(1, nil))', '1'],
  ['tail(cons(1, nil))', ''],
  ['length(nil)', '0'],
  ['length(cons(1, cons(2, nil)))', '2'],
  ['head(tail(cons(1, cons(2, nil))))', '2'],
  ['head(nil)', 'error'],
  ['tail(nil)', 'error'],
];

for (const [source, expected] of tests) {
  try {
    const result = run(source);
    console.log(`${source} => ${JSON.stringify(result)} (expected: ${expected})`);
  } catch (e) {
    console.log(`${source} => Error: ${e.message} (expected: ${expected})`);
  }
}
