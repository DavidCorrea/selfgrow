/**
 * Negation capability — provides unary minus operator.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'negation',
  summary: 'Unary minus operator — negation of a value',
  examples: [
    { source: '-5', result: '-5' },
    { source: '--5', result: '5' },
    { source: '2 + -3 * 4', result: '-10' },
  ],
};

function registerNegation(interpreter) {
  // Intentionally left empty — unary minus is already supported by the core parser/evaluator.
  // This capability exists to document the feature and run property tests.
}

export function register(interpreter) {
  registerNegation(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // -a = -(a)
  if (run('-5') !== '-5') {
    failures.push('unary minus of 5 should be -5');
  }
  // --a = a
  if (run('--5') !== '5') {
    failures.push('double unary minus should cancel out');
  }
  // distributive over addition: -(a + b) = (-a) + (-b)
  if (run('-(2 + 3)') !== run('-2 + -3')) {
    failures.push('negation should distribute over addition');
  }
  // -(-a) = a
  if (run('-(-5)') !== '5') {
    failures.push('double negation should cancel');
  }
  return failures;
}

// Self-register at module load time
registerCapability(meta, register, checkProperties);
