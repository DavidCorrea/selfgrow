/**
 * Arithmetic capability — provides the four arithmetic operators (+, -, *, /).
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'arithmetic',
  summary: 'The four arithmetic operators (+, -, *, /)',
  examples: [
    { source: '2 + 3', result: '5' },
    { source: '3 * 4', result: '12' },
    { source: '10 - 3', result: '7' },
    { source: '8 / 2', result: '4' },
    { source: '2 + 3 * 4', result: '14' },
  ],
};

export function register(interpreter) {
  interpreter.addOperator('+', { precedence: 10, associativity: 'left', fn: (a, b) => a + b });
  interpreter.addOperator('-', { precedence: 10, associativity: 'left', fn: (a, b) => a - b });
  interpreter.addOperator('*', { precedence: 20, associativity: 'left', fn: (a, b) => a * b });
  interpreter.addOperator('/', { precedence: 20, associativity: 'left', fn: (a, b) => a / b });
}

export function checkProperties(run) {
  const failures = [];

  if (run('2 + 3') !== '5') {
    failures.push('2 + 3 should return "5"');
  }
  if (run('3 * 4') !== '12') {
    failures.push('3 * 4 should return "12"');
  }
  if (run('10 - 3') !== '7') {
    failures.push('10 - 3 should return "7"');
  }
  if (run('8 / 2') !== '4') {
    failures.push('8 / 2 should return "4"');
  }

  // Operator precedence: * binds tighter than +
  if (run('2 + 3 * 4') !== '14') {
    failures.push('2 + 3 * 4 should return "14"');
  }
  // Commutativity of addition
  if (run('2 + 3') !== run('3 + 2')) {
    failures.push('addition should be commutative');
  }
  // Commutativity of multiplication
  if (run('2 * 3') !== run('3 * 2')) {
    failures.push('multiplication should be commutative');
  }
  // Associativity of addition
  if (run('(2 + 3) + 4') !== run('2 + (3 + 4)')) {
    failures.push('addition should be associative');
  }
  // Associativity of multiplication
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

registerCapability(meta, register, checkProperties);
