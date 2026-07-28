/**
 * Print capability — adds the `print` builtin function to the language.
 * This capability registers itself with the interpreter at module load time.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'print',
  summary: 'Output a value to the playground',
  examples: [
    { source: 'print("hello")', result: 'hello' },
    { source: 'print(1 + 2)', result: '3' },
    { source: 'print(true)', result: 'true' },
  ],
};

function registerPrint(interpreter) {
  interpreter.addBuiltin('print', function (args, steps) {
    let output = '';
    for (const arg of args) {
      if (typeof arg === 'string') { output += arg; }
      else if (typeof arg === 'number') { output += String(arg); }
      else if (typeof arg === 'boolean') { output += arg ? 'true' : 'false'; }
      else if (arg === null || arg === undefined) { /* nothing */ }
      else { output += String(arg); }
    }
    return { __printed: output, __value: undefined };
  });
}

export function register(interpreter) {
  registerPrint(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  if (run('print("hello")') !== 'hello') {
    failures.push('print("hello") should return "hello"');
  }
  if (run('print(1 + 2)') !== '3') {
    failures.push('print(1 + 2) should return "3"');
  }
  if (run('print(true)') !== 'true') {
    failures.push('print(true) should return "true"');
  }

  return failures;
}

// Self-register at module load time.
registerCapability(meta, register, checkProperties);
