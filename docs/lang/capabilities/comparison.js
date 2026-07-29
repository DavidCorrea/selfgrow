/**
 * Comparison and boolean logic capability — provides comparison operators,
 * boolean literals (true, false), and logical operators (and, or, not).
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'comparison',
  summary: 'Comparison operators, boolean literals, and logical operators',
  examples: [
    { source: '1 == 1', result: 'true' },
    { source: '1 != 2', result: 'true' },
    { source: '1 < 2', result: 'true' },
    { source: '2 > 1', result: 'true' },
    { source: '1 <= 1', result: 'true' },
    { source: '1 >= 2', result: 'false' },
    { source: 'true and false', result: 'false' },
    { source: 'true or false', result: 'true' },
    { source: 'not true', result: 'false' },
    { source: 'not false', result: 'true' },
    { source: 'print(true and false)', result: 'false' },
    { source: 'print(true or false)', result: 'true' },
  ],
};

function registerComparison(interpreter) {
  // Comparison operators (precedence 5, below additive 10)
  interpreter.addOperator('==', { precedence: 5, associativity: 'left', fn: (a, b) => a === b });
  interpreter.addOperator('!=', { precedence: 5, associativity: 'left', fn: (a, b) => a !== b });
  interpreter.addOperator('<', { precedence: 5, associativity: 'left', fn: (a, b) => a < b });
  interpreter.addOperator('>', { precedence: 5, associativity: 'left', fn: (a, b) => a > b });
  interpreter.addOperator('<=', { precedence: 5, associativity: 'left', fn: (a, b) => a <= b });
  interpreter.addOperator('>=', { precedence: 5, associativity: 'left', fn: (a, b) => a >= b });

  // Boolean logic operators
  interpreter.addOperator('or', { precedence: 2, associativity: 'left', fn: (a, b) => a || b });
  interpreter.addOperator('and', { precedence: 3, associativity: 'left', fn: (a, b) => a && b });

  // Prefix unary operator
  interpreter.addOperator('not', { prefix: true, fn: (a) => !a });

  // Boolean literal keywords
  interpreter.addKeyword('true');
  interpreter.addKeyword('false');

  // Boolean logic keywords (needed for matchKeyword in parseOr/parseAnd/parseNot)
  interpreter.addKeyword('and');
  interpreter.addKeyword('or');
  interpreter.addKeyword('not');
}

export function register(interpreter) {
  registerComparison(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // Equality
  if (run('1 == 1') !== 'true') {
    failures.push('1 == 1 should return "true"');
  }
  if (run('1 == 2') !== 'false') {
    failures.push('1 == 2 should return "false"');
  }
  if (run('1 != 2') !== 'true') {
    failures.push('1 != 2 should return "true"');
  }
  if (run('1 != 1') !== 'false') {
    failures.push('1 != 1 should return "false"');
  }

  // Less than / greater than
  if (run('1 < 2') !== 'true') {
    failures.push('1 < 2 should return "true"');
  }
  if (run('2 < 1') !== 'false') {
    failures.push('2 < 1 should return "false"');
  }
  if (run('2 > 1') !== 'true') {
    failures.push('2 > 1 should return "true"');
  }
  if (run('1 > 2') !== 'false') {
    failures.push('1 > 2 should return "false"');
  }

  // Less/greater than or equal
  if (run('1 <= 1') !== 'true') {
    failures.push('1 <= 1 should return "true"');
  }
  if (run('1 <= 2') !== 'true') {
    failures.push('1 <= 2 should return "true"');
  }
  if (run('2 <= 1') !== 'false') {
    failures.push('2 <= 1 should return "false"');
  }
  if (run('1 >= 1') !== 'true') {
    failures.push('1 >= 1 should return "true"');
  }
  if (run('1 >= 2') !== 'false') {
    failures.push('1 >= 2 should return "false"');
  }
  if (run('2 >= 1') !== 'true') {
    failures.push('2 >= 1 should return "true"');
  }

  // boolean literals
  if (run('true') !== 'true') {
    failures.push('true should return "true"');
  }
  if (run('false') !== 'false') {
    failures.push('false should return "false"');
  }

  // Boolean logic
  if (run('true and false') !== 'false') {
    failures.push('true and false should return "false"');
  }
  if (run('false and true') !== 'false') {
    failures.push('false and true should return "false"');
  }
  if (run('true and true') !== 'true') {
    failures.push('true and true should return "true"');
  }
  if (run('false or true') !== 'true') {
    failures.push('false or true should return "true"');
  }
  if (run('false or false') !== 'false') {
    failures.push('false or false should return "false"');
  }
  if (run('true or false') !== 'true') {
    failures.push('true or false should return "true"');
  }
  if (run('true or true') !== 'true') {
    failures.push('true or true should return "true"');
  }

  // not operator
  if (run('not true') !== 'false') {
    failures.push('not true should return "false"');
  }
  if (run('not false') !== 'true') {
    failures.push('not false should return "true"');
  }

  // Comparison operators round-trip: every == is also !=
  if (run('1 == 1') === run('1 != 1')) {
    failures.push('== and != with same operands should not agree');
  }

  // Boolean properties
  if (run('true and true') !== run('true')) {
    failures.push('true and true should equal true');
  }
  if (run('false or false') !== run('false')) {
    failures.push('false or false should equal false');
  }

  // Precedence: comparison higher than and, and higher than or
  if (run('1 < 2 and 2 < 3') !== 'true') {
    failures.push('1 < 2 and 2 < 3 should return "true"');
  }
  if (run('1 > 2 and 2 < 3') !== 'false') {
    failures.push('1 > 2 and 2 < 3 should return "false"');
  }
  if (run('1 < 2 or 2 > 3') !== 'true') {
    failures.push('1 < 2 or 2 > 3 should return "true"');
  }
  if (run('1 > 2 or 2 > 3') !== 'false') {
    failures.push('1 > 2 or 2 > 3 should return "false"');
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
