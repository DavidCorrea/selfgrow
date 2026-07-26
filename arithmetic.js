/**
 * Arithmetic capability — exposes basic math operations as named functions.
 * One file, one capability — add new capabilities as new files in this directory.
 */
export const meta = {
  name: 'arithmetic',
  summary: 'Basic arithmetic operators: add, sub, mul, div, and mod.',
  types: ['number'],
  functions: ['add', 'sub', 'mul', 'div', 'mod'],
  properties: {
    commutativity: 'add and mul are commutative',
    associativity: 'add and mul are associative',
    divisionByZero: 'div by zero raises a RuntimeError',
  },
  examples: [
    { source: 'add(1, 2)', result: '3' },
    { source: 'sub(5, 3)', result: '2' },
    { source: 'mul(4, 3)', result: '12' },
    { source: 'div(10, 2)', result: '5' },
    { source: 'mod(10, 3)', result: '1' },
    { source: 'add(mul(2, 3), sub(10, 4))', result: '10' },
  ],
};

export function register(interpreter) {
  interpreter.define('add', (args) => {
    if (args.length !== 2) throw new Error('add expects 2 arguments');
    return args[0] + args[1];
  }, 2);

  interpreter.define('sub', (args) => {
    if (args.length !== 2) throw new Error('sub expects 2 arguments');
    return args[0] - args[1];
  }, 2);

  interpreter.define('mul', (args) => {
    if (args.length !== 2) throw new Error('mul expects 2 arguments');
    return args[0] * args[1];
  }, 2);

  interpreter.define('div', (args) => {
    if (args.length !== 2) throw new Error('div expects 2 arguments');
    if (args[1] === 0) throw new Error('Division by zero');
    return args[0] / args[1];
  }, 2);

  interpreter.define('mod', (args) => {
    if (args.length !== 2) throw new Error('mod expects 2 arguments');
    if (args[1] === 0) throw new Error('Modulo by zero');
    return args[0] % args[1];
  }, 2);
}

export function checkProperties(run) {
  const failures = [];

  const addResult = run('add(2, 3)');
  if (addResult !== '5') failures.push(`add(2, 3) expected "5", got "${addResult}"`);

  const mulResult = run('mul(4, 5)');
  if (mulResult !== '20') failures.push(`mul(4, 5) expected "20", got "${mulResult}"`);

  try {
    run('div(1, 0)');
    failures.push('div(1, 0) should have thrown an error');
  } catch (e) {
    if (!e.message || !e.message.includes('zero')) {
      failures.push(`div(1, 0) threw unexpected error: ${e.message}`);
    }
  }

  return failures;
}

// Export individual fields as required by the capability module format
export const { name, types, functions, properties, examples } = meta;
