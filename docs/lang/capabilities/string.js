/**
 * String operations capability — provides string concatenation (++),
 * length(), and equality. Each capability lives in its own file and
 * self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';
import { RuntimeError } from '../errors.js';

export const meta = {
  name: 'string',
  summary: 'String operations — concatenation (++), length, and equality',
  examples: [
    { source: '"hello" ++ " world"', result: 'hello world' },
    { source: 'length("abc")', result: '3' },
    { source: '"abc" == "abc"', result: 'true' },
    { source: '"abc" == "def"', result: 'false' },
    { source: '"abc" != "def"', result: 'true' },
    { source: '"abc" != "abc"', result: 'false' },
  ],
};

function describeValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value && value.__closure) return 'a closure';
  if (value && value.__cons) return 'a list cell';
  return typeof value;
}

function registerString(interpreter) {
  interpreter.addOperator('++', { precedence: 10, associativity: 'left', fn: (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new RuntimeError(
        '++ expects strings',
        'two strings',
        `${describeValue(a)} and ${describeValue(b)}`,
        null
      );
    }
    return a + b;
  }});

  interpreter.registerFunction('length', function (args, steps) {
    if (args.length !== 1) {
      throw new RuntimeError(
        `length expects 1 argument but got ${args.length}`,
        '1 argument',
        `${args.length} arguments`,
        null
      );
    }
    const arg = args[0];
    if (typeof arg === 'string') {
      return arg.length;
    }
    // List traversal (nil null or cons cells)
    let count = 0;
    let current = arg;
    while (current !== null) {
      if (!current.__cons) {
        throw new RuntimeError('length: not a proper list', 'a proper list', describeValue(current), null);
      }
      count++;
      current = current.tail;
    }
    return count;
  });
}

export function register(interpreter) {
  registerString(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // String concatenation
  if (run('"hello" ++ " world"') !== 'hello world') {
    failures.push('"hello" ++ " world" should return "hello world"');
  }
  if (run('"" ++ "test"') !== 'test') {
    failures.push('"" ++ "test" should return "test"');
  }
  if (run('"test" ++ ""') !== 'test') {
    failures.push('"test" ++ "" should return "test"');
  }
  // Concatenation associativity
  if (run('("a" ++ "b") ++ "c"') !== run('"a" ++ ("b" ++ "c")')) {
    failures.push('string concatenation should be associative');
  }
  // String length
  if (run('length("abc")') !== '3') {
    failures.push('length("abc") should return "3"');
  }
  if (run('length("")') !== '0') {
    failures.push('length("") should return "0"');
  }
  // Length is always non-negative
  const lenResult = run('length("hello")');
  if (parseInt(lenResult) < 0) {
    failures.push('length of a string should be >= 0');
  }
  // String equality
  if (run('"abc" == "abc"') !== 'true') {
    failures.push('"abc" == "abc" should return "true"');
  }
  if (run('"abc" == "def"') !== 'false') {
    failures.push('"abc" == "def" should return "false"');
  }
  // String inequality
  if (run('"abc" != "def"') !== 'true') {
    failures.push('"abc" != "def" should return "true"');
  }
  if (run('"abc" != "abc"') !== 'false') {
    failures.push('"abc" != "abc" should return "false"');
  }
  // Equality round-trip
  if (run('"abc" == "abc"') === run('"abc" != "abc"')) {
    failures.push('== and != with same string operands should not agree');
  }
  // ++ with non-string should throw a clear error
  try {
    run('1 ++ "hello"');
    failures.push('1 ++ "hello" should throw an error');
  } catch (err) {
    if (!err.message.includes('++') && !err.message.includes('string')) {
      failures.push(`++ with non-string should throw string-related error, got: ${err.message}`);
    }
  }
  // length on non-string non-list should throw a clear error
  try {
    run('length(1)');
    failures.push('length(1) should throw an error');
  } catch (err) {
    // length on a number should fail — it's not a string or a list
  }
  // length of list still works (polymorphic)
  if (run('length(nil)') !== '0') {
    failures.push('length(nil) should return "0" (string capability is polymorphic)');
  }
  if (run('length(cons(1, cons(2, nil)))') !== '2') {
    failures.push('length(cons(1, cons(2, nil))) should return "2" (string capability is polymorphic)');
  }

  return failures;
}

// Self-register at module load time.
registerCapability(meta, register, checkProperties);
