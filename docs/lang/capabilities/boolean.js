/**
 * Boolean logic capability — provides boolean literals (true, false)
 * and logical operators (and, or, not).
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'boolean',
  summary: 'Boolean literals and logical operators',
  examples: [
    { source: 'true', result: 'true' },
    { source: 'false', result: 'false' },
    { source: 'true and false', result: 'false' },
    { source: 'true or false', result: 'true' },
    { source: 'not true', result: 'false' },
    { source: 'not false', result: 'true' },
    { source: 'print(true and false)', result: 'false' },
    { source: 'print(true or false)', result: 'true' },
  ],
};

function registerBoolean(interpreter) {
  // Boolean literal keywords
  interpreter.addKeyword('true');
  interpreter.addKeyword('false');

  // Boolean logic operators
  interpreter.addOperator('or', { precedence: 2, associativity: 'left', fn: (a, b) => a || b });
  interpreter.addOperator('and', { precedence: 3, associativity: 'left', fn: (a, b) => a && b });

  // Prefix unary operator
  interpreter.addOperator('not', { prefix: true, fn: (a) => !a });

  // Boolean logic keywords (needed for matchKeyword in parseOr/parseAnd/parseNot)
  interpreter.addKeyword('and');
  interpreter.addKeyword('or');
  interpreter.addKeyword('not');
}

export function register(interpreter) {
  registerBoolean(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // Boolean literals
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

  // Boolean properties
  if (run('true and true') !== run('true')) {
    failures.push('true and true should equal true');
  }
  if (run('false or false') !== run('false')) {
    failures.push('false or false should equal false');
  }

  // Precedence: and higher than or
  if (run('true and false or true') !== 'true') {
    failures.push('true and false or true should return "true" (and binds tighter than or)');
  }
  if (run('false or true and false') !== 'false') {
    failures.push('false or true and false should return "false" (and binds tighter than or)');
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
