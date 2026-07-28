/**
 * Arithmetic capability — registers numeric literals and four binary arithmetic
 * operators (+, -, *, /) with correct precedence into the interpreter.
 *
 * This capability follows the selfgrow capability contract: it exports meta,
 * register(interpreter), and checkProperties(run). Its examples serve as both
 * documentation and the test suite (each example is executed via run() and
 * compared to the expected result).
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'arithmetic',
  summary: 'Numeric literals and four binary arithmetic operators (+, -, *, /) with correct precedence',
  examples: [
    { source: '2 + 3', result: '5' },
    { source: '3 * 4', result: '12' },
    { source: '10 - 3', result: '7' },
    { source: '8 / 2', result: '4' },
    { source: '2 + 3 * 4', result: '14' },
  ],
};

function registerArithmetic(interpreter) {
  interpreter.addOperator('+', { precedence: 10, associativity: 'left', fn: (a, b) => a + b });
  interpreter.addOperator('-', { precedence: 10, associativity: 'left', fn: (a, b) => a - b });
  interpreter.addOperator('*', { precedence: 20, associativity: 'left', fn: (a, b) => a * b });
  interpreter.addOperator('/', { precedence: 20, associativity: 'left', fn: (a, b) => a / b });
}

export function register(interpreter) {
  registerArithmetic(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // Commutativity of +
  if (run('2 + 3') !== run('3 + 2')) {
    failures.push('addition should be commutative');
  }

  // Commutativity of *
  if (run('2 * 3') !== run('3 * 2')) {
    failures.push('multiplication should be commutative');
  }

  // Associativity of +
  if (run('(2 + 3) + 4') !== run('2 + (3 + 4)')) {
    failures.push('addition should be associative');
  }

  // Associativity of *
  if (run('(2 * 3) * 4') !== run('2 * (3 * 4)')) {
    failures.push('multiplication should be associative');
  }

  // Division by zero must be rejected with a user-facing error
  try {
    run('1 / 0');
    failures.push('division by zero should throw');
  } catch (err) {
    if (!err.message.includes('division by zero')) {
      failures.push('division by zero should throw "division by zero" error');
    }
  }

  return failures;
}

// Self-register at module load time.
registerCapability(meta, register, checkProperties);
