/**
 * String operations capability — provides concatenation (++), length(),
 * and string comparison (==, !=) operators.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';
import { RuntimeError, TypeError } from '../errors.js';

export const meta = {
  name: 'string',
  summary: 'String operations — concatenation, length, and comparison',
  examples: [
    { source: '"hello" ++ " world"', result: 'hello world' },
    { source: 'length("abc")', result: '3' },
    { source: 'length("")', result: '0' },
    { source: '"abc" == "abc"', result: 'true' },
    { source: '"abc" != "def"', result: 'true' },
    { source: '"abc" == "def"', result: 'false' },
    { source: 'print("hello" ++ " " ++ "world")', result: 'hello world' },
  ],
};

function describeValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value && value.__closure) return 'a closure';
  if (value && value.__cons) return 'a list cell';
  if (value && value.__record) return 'a record';
  return typeof value;
}

function registerString(interpreter) {
  // Polymorphic length — works on both strings and lists (nil / cons)
  interpreter.registerFunction('length', function (args, steps) {
    if (args.length !== 1) {
      throw new RuntimeError(
        `length expects 1 argument but got ${args.length}`,
        '1 argument',
        `${args.length} arguments`,
        null
      );
    }
    const value = args[0];
    if (typeof value === 'string') {
      return value.length;
    }
    // List length — walk the cons cells
    if (value === null) {
      return 0;
    }
    if (value && value.__cons) {
      let count = 0;
      let current = value;
      while (current !== null) {
        if (!current.__cons) {
          throw new RuntimeError('length: not a proper list', 'a proper list', 'improper list', null);
        }
        count++;
        current = current.tail;
      }
      return count;
    }
    throw new TypeError(
      `length expects a string or list argument but got ${describeValue(value)}`,
      'a string or list',
      describeValue(value),
      null
    );
  });

  // String concatenation operator
  interpreter.addOperator('++', { precedence: 10, associativity: 'left', fn: (a, b) => {
    if (typeof a !== 'string') {
      throw new TypeError(
        `concatenation operator (++) expects a string left operand but got ${describeValue(a)}`,
        'a string',
        describeValue(a),
        null
      );
    }
    if (typeof b !== 'string') {
      throw new TypeError(
        `concatenation operator (++) expects a string right operand but got ${describeValue(b)}`,
        'a string',
        describeValue(b),
        null
      );
    }
    return a + b;
  }});
}

export function register(interpreter) {
  registerString(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // Concatenation
  if (run('"hello" ++ " world"') !== 'hello world') {
    failures.push('"hello" ++ " world" should return "hello world"');
  }
  if (run('"a" ++ "b" ++ "c"') !== 'abc') {
    failures.push('"a" ++ "b" ++ "c" should return "abc"');
  }
  if (run('"" ++ "test"') !== 'test') {
    failures.push('"" ++ "test" should return "test"');
  }

  // Length on strings
  if (run('length("abc")') !== '3') {
    failures.push('length("abc") should return "3"');
  }
  if (run('length("")') !== '0') {
    failures.push('length("") should return "0"');
  }
  if (run('length("hello world")') !== '11') {
    failures.push('length("hello world") should return "11"');
  }

  // String equality
  if (run('"abc" == "abc"') !== 'true') {
    failures.push('"abc" == "abc" should return "true"');
  }
  if (run('"abc" == "def"') !== 'false') {
    failures.push('"abc" == "def" should return "false"');
  }
  if (run('"abc" != "def"') !== 'true') {
    failures.push('"abc" != "def" should return "true"');
  }
  if (run('"abc" != "abc"') !== 'false') {
    failures.push('"abc" != "abc" should return "false"');
  }

  // Concatenation with non-string should throw
  try {
    run('1 ++ "a"');
    failures.push('1 ++ "a" should throw an error');
  } catch (err) {
    if (!err.message.includes('string')) {
      failures.push(`1 ++ "a" should throw a type error, got: ${err.message}`);
    }
  }

  // Length with non-string/non-list should throw
  try {
    run('length(true)');
    failures.push('length(true) should throw an error');
  } catch (err) {
    if (!err.message.includes('string or list')) {
      failures.push(`length(true) should throw a type error, got: ${err.message}`);
    }
  }

  // String equality round-trip
  if (run('"abc" == "abc"') === run('"abc" != "abc"')) {
    failures.push('== and != with same string operands should not agree');
  }

  // Concatenation result is always a string
  const concatResult = run('"a" ++ "b"');
  if (concatResult !== 'ab') {
    failures.push('"a" ++ "b" should return "ab"');
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
