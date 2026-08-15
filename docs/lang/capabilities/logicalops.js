import { registerCapability } from './registry.js';
import { TypeError } from '../errors.js';

/**
 * C-style logical operators capability — provides &&, ||, ! operators.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
export const meta = {
  name: 'logicalops',
  summary: 'C-style logical operators (&&, ||, !)',
  examples: [
    { source: 'true && false', result: 'false' },
    { source: 'true || false', result: 'true' },
    { source: '!true', result: 'false' },
    { source: 'true && true', result: 'true' },
    { source: 'false || false', result: 'false' },
    { source: '!!true', result: 'true' },
    { source: 'true && false || true', result: 'true' },
    { source: 'false || true && false', result: 'false' },
  ],
};

function registerLogicalOps(interpreter) {
  // Logical OR
  interpreter.addOperator('||', {
    precedence: 2,
    associativity: 'left',
    fn: (a, b) => {
      if (typeof a !== 'boolean' || typeof b !== 'boolean') {
        throw new TypeError('Operands of || must be booleans', null, null, null);
      }
      return a || b;
    }
  });

  // Logical AND
  interpreter.addOperator('&&', {
    precedence: 3,
    associativity: 'left',
    fn: (a, b) => {
      if (typeof a !== 'boolean' || typeof b !== 'boolean') {
        throw new TypeError('Operands of && must be booleans', null, null, null);
      }
      return a && b;
    }
  });

  // Logical NOT (prefix)
  interpreter.addOperator('!', {
    prefix: true,
    fn: (a) => {
      if (typeof a !== 'boolean') {
        throw new TypeError('Operand of ! must be boolean', null, null, null);
      }
      return !a;
    }
  });
}

export function register(interpreter) {
  registerLogicalOps(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // Basic operation
  if (run('true && false') !== 'false') {
    failures.push('true && false should return false');
  }
  if (run('true || false') !== 'true') {
    failures.push('true || false should return true');
  }
  if (run('!true') !== 'false') {
    failures.push('!true should return false');
  }

  // Idempotence and complement
  if (run('true && true') !== 'true') {
    failures.push('true && true should return true');
  }
  if (run('false || false') !== 'false') {
    failures.push('false || false should return false');
  }
  if (run('!!true') !== 'true') {
    failures.push('!!true should return true');
  }

  // Precedence: && higher than ||
  if (run('true && false || true') !== 'true') {
    failures.push('true && false || true should return true (&& binds tighter than ||)');
  }
  if (run('false || true && false') !== 'false') {
    failures.push('false || true && false should return false (&& binds tighter than ||)');
  }

  // Type errors
  try {
    run('1 && true');
    failures.push('1 && true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of && must be booleans')) {
      failures.push('1 && true should throw TypeError about boolean operands');
    }
  }
  try {
    run('true || 1');
    failures.push('true || 1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of || must be booleans')) {
      failures.push('true || 1 should throw TypeError about boolean operands');
    }
  }
  try {
    run('!1');
    failures.push('!1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operand of ! must be boolean')) {
      failures.push('!1 should throw TypeError about boolean operand');
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);