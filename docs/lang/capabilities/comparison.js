/**
 * Comparison capability — provides comparison operators that return boolean values.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'comparison',
  summary: 'Comparison operators',
  examples: [
    { source: '1 == 1', result: 'true' },
    { source: '1 != 2', result: 'true' },
    { source: '1 < 2', result: 'true' },
    { source: '2 > 1', result: 'true' },
    { source: '1 <= 1', result: 'true' },
    { source: '1 >= 2', result: 'false' },
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

  // Comparison operators round-trip: every == is also !=
  if (run('1 == 1') === run('1 != 1')) {
    failures.push('== and != with same operands should not agree');
  }

  // Precedence: comparison higher than arithmetic
  if (run('1 + 2 == 3') !== 'true') {
    failures.push('1 + 2 == 3 should return "true"');
  }
  if (run('1 + 2 == 4') !== 'false') {
    failures.push('1 + 2 == 4 should return "false"');
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
