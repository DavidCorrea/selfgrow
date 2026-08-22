/**
 * Boolean logic capability — provides boolean literals (true, false)
 * and logical operators (and, or, not, &&, ||, !).
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';
import { TypeError } from '../errors.js';

export const meta = {
  name: 'boolean',
  summary: 'Boolean literals and logical operators (including &&, ||, !)',
  examples: [
    { source: 'true', result: 'true' },
    { source: 'false', result: 'false' },
    { source: 'true and false', result: 'false' },
    { source: 'true or false', result: 'true' },
    { source: 'not true', result: 'false' },
    { source: 'not false', result: 'true' },
    { source: 'print(true and false)', result: 'false' },
    { source: 'print(true or false)', result: 'true' },
    // C-style logical operators
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

function registerBoolean(interpreter) {
  // Boolean literal keywords
  interpreter.addKeyword('true');
  interpreter.addKeyword('false');

  // Boolean logic operators with type checking
  interpreter.addOperator('or', { 
    precedence: 2, 
    associativity: 'left', 
    fn: (left, right, steps) => {
      if (typeof left !== 'boolean' || typeof right !== 'boolean') {
        throw new TypeError('Operands of \'or\' must be booleans');
      }
      return left || right;
    } 
  });
  interpreter.addOperator('and', { 
    precedence: 3, 
    associativity: 'left', 
    fn: (left, right, steps) => {
      if (typeof left !== 'boolean' || typeof right !== 'boolean') {
        throw new TypeError('Operands of \'and\' must be booleans');
      }
      return left && right;
    } 
  });

  // Prefix unary operator
  interpreter.addOperator('not', { 
    prefix: true, 
    fn: (operand) => {
      if (typeof operand !== 'boolean') {
        throw new TypeError('Operand of \'not\' must be boolean');
      }
      return !operand;
    } 
  });

  // Boolean logic keywords (needed for matchKeyword in parseOr/parseAnd/parseNot)
  interpreter.addKeyword('and');
  interpreter.addKeyword('or');
  interpreter.addKeyword('not');

  // C-style logical operators
  interpreter.addOperator('||', {
    precedence: 2,
    associativity: 'left',
    fn: (a, b) => {
      if (typeof a !== 'boolean' || typeof b !== 'boolean') {
        throw new TypeError('Operands of || must be booleans');
      }
      return a || b;
    }
  });

  interpreter.addOperator('&&', {
    precedence: 3,
    associativity: 'left',
    fn: (a, b) => {
      if (typeof a !== 'boolean' || typeof b !== 'boolean') {
        throw new TypeError('Operands of && must be booleans');
      }
      return a && b;
    }
  });

  interpreter.addOperator('!', {
    prefix: true,
    fn: (a) => {
      if (typeof a !== 'boolean') {
        throw new TypeError('Operand of ! must be boolean');
      }
      return !a;
    }
  });
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

  // Boolean logic (and/or/not)
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

  // C-style logical operators
  if (run('true && false') !== 'false') {
    failures.push('true && false should return false');
  }
  if (run('true || false') !== 'true') {
    failures.push('true || false should return true');
  }
  if (run('!true') !== 'false') {
    failures.push('!true should return false');
  }

  // Idempotence and complement for &&, ||, !
  if (run('true && true') !== 'true') {
    failures.push('true && true should return true');
  }
  if (run('false || false') !== 'false') {
    failures.push('false || false should return false');
  }
  if (run('!!true') !== 'true') {
    failures.push('!!true should return true');
  }

  // Precedence: and higher than or (already covered)
  if (run('true and false or true') !== 'true') {
    failures.push('true and false or true should return "true" (and binds tighter than or)');
  }
  if (run('false or true and false') !== 'false') {
    failures.push('false or true and false should return "false" (and binds tighter than or)');
  }

  // Precedence: && higher than ||
  if (run('true && false || true') !== 'true') {
    failures.push('true && false || true should return true (&& binds tighter than ||)');
  }
  if (run('false || true && false') !== 'false') {
    failures.push('false || true && false should return false (&& binds tighter than ||)');
  }

  // Type safety: and operator
  try {
    run('true and 1');
    failures.push('true and 1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('true and 1 should throw TypeError, got ' + e);
    }
  }
  try {
    run('0 and true');
    failures.push('0 and true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('0 and true should throw TypeError, got ' + e);
    }
  }
  try {
    run('\"true\" and false');
    failures.push('\"true\" and false should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('\"true\" and false should throw TypeError, got ' + e);
    }
  }

  // Type safety: or operator
  try {
    run('true or 1');
    failures.push('true or 1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('true or 1 should throw TypeError, got ' + e);
    }
  }
  try {
    run('0 or true');
    failures.push('0 or true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('0 or true should throw TypeError, got ' + e);
    }
  }
  try {
    run('\"false\" or true');
    failures.push('\"false\" or true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('\"false\" or true should throw TypeError, got ' + e);
    }
  }

  // Type safety: not operator
  try {
    run('not 1');
    failures.push('not 1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('not 1 should throw TypeError, got ' + e);
    }
  }
  try {
    run('not \"true\"');
    failures.push('not \"true\" should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError)) {
      failures.push('not \"true\" should throw TypeError, got ' + e);
    }
  }

  // Type safety: && operator
  try {
    run('1 && true');
    failures.push('1 && true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of && must be booleans')) {
      failures.push('1 && true should throw TypeError about boolean operands');
    }
  }
  try {
    run('true && 1');
    failures.push('true && 1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of && must be booleans')) {
      failures.push('true && 1 should throw TypeError about boolean operands');
    }
  }
  try {
    run('\"true\" && false');
    failures.push('\"true\" && false should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of && must be booleans')) {
      failures.push('\"true\" && false should throw TypeError about boolean operands');
    }
  }

  // Type safety: || operator
  try {
    run('1 || true');
    failures.push('1 || true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of || must be booleans')) {
      failures.push('1 || true should throw TypeError about boolean operands');
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
    run('\"false\" || true');
    failures.push('\"false\" || true should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operands of || must be booleans')) {
      failures.push('\"false\" || true should throw TypeError about boolean operands');
    }
  }

  // Type safety: ! operator
  try {
    run('!1');
    failures.push('!1 should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operand of ! must be boolean')) {
      failures.push('!1 should throw TypeError about boolean operand');
    }
  }
  try {
    run('!\"true\"');
    failures.push('!\"true\" should throw TypeError');
  } catch (e) {
    if (!(e instanceof TypeError) || !e.message.includes('Operand of ! must be boolean')) {
      failures.push('!\"true\" should throw TypeError about boolean operand');
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);