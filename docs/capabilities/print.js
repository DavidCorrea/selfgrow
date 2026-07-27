/**
 * Print capability — adds the `print` builtin function to the language.
 * This capability registers itself with the interpreter at module load time.
 */
import { registry } from '../lang/interpreter.js';

export const meta = {
  name: 'print',
  summary: 'Output a value to the console',
  examples: [
    { source: 'print("hello")', result: 'hello' },
    { source: 'print(1 + 2)', result: '3' },
    { source: 'print(true)', result: 'true' },
  ],
};

function registerPrint(interpreter) {
  interpreter.addBuiltin('print', function(args, steps) {
    let output = '';
    for (const arg of args) {
      if (typeof arg === 'string') { output += arg; }
      else if (typeof arg === 'number') { output += Number.isInteger(arg) ? String(arg) : String(arg); }
      else if (typeof arg === 'boolean') { output += arg ? 'true' : 'false'; }
      else if (arg === null || arg === undefined) { /* nothing */ }
      else { output += String(arg); }
    }
    return { __printed: output, __value: undefined };
  });
}

registry.set(meta.name, { meta, registerFn: registerPrint });

export function checkProperties(run) {
  const failures = [];
  const result = run('print("hello")');
  if (result !== 'hello') {
    failures.push('print("hello") should return "hello"');
  }
  const numResult = run('print(1 + 2)');
  if (numResult !== '3') {
    failures.push('print(1 + 2) should return "3"');
  }
  const boolResult = run('print(true)');
  if (boolResult !== 'true') {
    failures.push('print(true) should return "true"');
  }
  return failures;
}
