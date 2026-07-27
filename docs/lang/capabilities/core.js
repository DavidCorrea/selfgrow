/**
 * Core capability for the selfgrow language.
 * Registers the print builtin, formatValue, and arithmetic operations
 * so the language can do useful work from day one.
 */

import { registerCapability } from './registry.js';

/** Format a selfgrow value as a string for print output. */
export function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  return String(value);
}

export const meta = {
  name: 'core',
  summary: 'Core built-in functions available in every selfgrow program',
  examples: [
    { source: 'print(2 + 3)', result: '5' },
    { source: 'print(10 - 4)', result: '6' },
    { source: 'print(3 * 7)', result: '21' },
    { source: 'print(10 / 2)', result: '5' },
    { source: 'print("hello, world")', result: 'hello, world' },
    { source: 'print(true and false or not false)', result: 'true' },
  ],
};

export function register(interpreter) {
  interpreter.functions.set('print', {
    __builtin: true,
    fn: (args) => {
      const str = args.map((a) => formatValue(a)).join('');
      return { __printed: str, __value: undefined };
    },
    arity: -1,
  });

  interpreter.functions.set('+', {
    __builtin: true,
    fn: (args) => args[0] + args[1],
    arity: 2,
  });
  interpreter.functions.set('-', {
    __builtin: true,
    fn: (args) => args[0] - args[1],
    arity: 2,
  });
  interpreter.functions.set('*', {
    __builtin: true,
    fn: (args) => args[0] * args[1],
    arity: 2,
  });
  interpreter.functions.set('/', {
    __builtin: true,
    fn: (args) => {
      if (args[1] === 0) throw new Error('Division by zero');
      return args[0] / args[1];
    },
    arity: 2,
  });
}

export function checkProperties(run) {
  const failures = [];
  if (run('1 + 1') !== '2') failures.push('1 + 1 must equal 2');
  if (run('print(42)') !== '42') failures.push('print(42) must output "42"');
  if (run('(3 + 4) * 2') !== '14') failures.push('(3 + 4) * 2 must equal 14');
  if (run('print("hello")') !== 'hello') failures.push('print("hello") must output "hello"');
  return failures;
}

// Auto-register this capability when the module loads
registerCapability(meta, register, checkProperties);
