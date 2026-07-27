/**
 * Core capability for the selfgrow language.
 *
 * Seeds the interpreter with the print builtin and arithmetic
 * operators so the language is functional from day one.
 *
 * This module self-registers with the capability registry at load time.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'core',
  summary: 'Core capabilities: print and arithmetic',
  examples: [
    { source: 'print("hello")', result: 'hello' },
    { source: 'print(1 + 2)', result: '3' },
    { source: '1 + 2', result: '3' },
    { source: '10 / 2', result: '5' },
  ],
};

export function register(interpreter) {
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

export function checkProperties(run) {
  const failures = [];

  const strResult = run('print("hello")');
  if (strResult !== 'hello') {
    failures.push(`print("hello") should return "hello", got "${strResult}"`);
  }

  const numResult = run('print(1 + 2)');
  if (numResult !== '3') {
    failures.push(`print(1 + 2) should return "3", got "${numResult}"`);
  }

  const arithResult = run('1 + 2');
  if (arithResult !== '3') {
    failures.push(`1 + 2 should return "3", got "${arithResult}"`);
  }

  const divResult = run('10 / 2');
  if (divResult !== '5') {
    failures.push(`10 / 2 should return "5", got "${divResult}"`);
  }

  return failures;
}

registerCapability(meta, register, checkProperties);
