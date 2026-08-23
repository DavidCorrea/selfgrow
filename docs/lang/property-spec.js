/**
 * Property test definition structure and helpers for capability modules.
 * This file provides utilities to write consistent checkProperties functions.
 */

/**
 * Basic correctness test: source should evaluate to expected.
 * @param {function(string): string} run - The run function from the capability.
 * @param {string} source - The source code to run.
 * @param {string} expected - The expected result string.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function basic(run, source, expected) {
  try {
    const result = run(source);
    if (result !== expected) {
      return `${source} should return "${expected}", but got "${result}"`;
    }
    return null;
  } catch (err) {
    return `${source} should return "${expected}", but threw: ${err.message}`;
  }
}

/**
 * Commutativity test: a op b should equal b op a.
 * @param {function(string): string} run - The run function.
 * @param {string} op - The operator as a string (e.g., '+').
 * @param {string} a - Left operand source.
 * @param {string} b - Right operand source.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function commutative(run, op, a, b) {
  const left = `${a} ${op} ${b}`;
  const right = `${b} ${op} ${a}`;
  try {
    const leftResult = run(left);
    const rightResult = run(right);
    if (leftResult !== rightResult) {
      return `${op} should be commutative: ${left} (${leftResult}) !== ${right} (${rightResult})`;
    }
    return null;
  } catch (err) {
    return `${op} commutativity test failed: ${err.message}`;
  }
}

/**
 * Associativity test: (a op b) op c should equal a op (b op c).
 * @param {function(string): string} run - The run function.
 * @param {string} op - The operator as a string.
 * @param {string} a - First operand source.
 * @param {string} b - Second operand source.
 * @param {string} c - Third operand source.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function associative(run, op, a, b, c) {
  const left = `(${a} ${op} ${b}) ${op} ${c}`;
  const right = `${a} ${op} (${b} ${op} ${c})`;
  try {
    const leftResult = run(left);
    const rightResult = run(right);
    if (leftResult !== rightResult) {
      return `${op} should be associative: ${left} (${leftResult}) !== ${right} (${rightResult})`;
    }
    return null;
  } catch (err) {
    return `${op} associativity test failed: ${err.message}`;
  }
}

/**
 * Left-distributivity test: a opOuter (b opInner c) should equal (a opOuter b) opInner (a opOuter c).
 * @param {function(string): string} run - The run function.
 * @param {string} outerOp - The outer operator.
 * @param {string} innerOp - The inner operator.
 * @param {string} a - Operand a.
 * @param {string} b - Operand b.
 * @param {string} c - Operand c.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function distributiveLeft(run, outerOp, innerOp, a, b, c) {
  const left = `${a} ${outerOp} (${b} ${innerOp} ${c})`;
  const right = `(${a} ${outerOp} ${b}) ${innerOp} (${a} ${outerOp} ${c})`;
  try {
    const leftResult = run(left);
    const rightResult = run(right);
    if (leftResult !== rightResult) {
      return `${outerOp} should distribute over ${innerOp}: ${left} (${leftResult}) !== ${right} (${rightResult})`;
    }
    return null;
  } catch (err) {
    return `${outerOp} distributivity test failed: ${err.message}`;
  }
}

/**
 * Type safety test: source should throw a TypeError.
 * @param {function(string): string} run - The run function.
 * @param {string} source - The source code to run.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function typeError(run, source) {
  try {
    run(source);
    return `${source} should throw TypeError but did not`;
  } catch (err) {
    if (!(err instanceof TypeError)) {
      return `${source} should throw TypeError but threw: ${err.constructor.name}: ${err.message}`;
    }
    return null;
  }
}

/**
 * Error containment test: source should throw an error with message containing substring.
 * @param {function(string): string} run - The run function.
 * @param {string} source - The source code to run.
 * @param {string} substring - The substring expected in the error message.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function errorContains(run, source, substring) {
  try {
    run(source);
    return `${source} should throw an error containing "${substring}" but did not throw`;
  } catch (err) {
    if (!err.message.includes(substring)) {
      return `${source} should throw an error containing "${substring}", but got: ${err.message}`;
    }
    return null;
  }
}

/**
 * Precedence test: exprWithoutParens should be equivalent to exprWithParens,
 * assuming the parentheses reflect the correct precedence.
 * @param {function(string): string} run - The run function.
 * @param {string} exprWithoutParens - Expression relying on operator precedence.
 * @param {string} exprWithParens - Expression with explicit parentheses.
 * @returns {string|null} Failure message if test fails, null if passes.
 */
export function precedence(run, exprWithoutParens, exprWithParens) {
  try {
    const resultWithout = run(exprWithoutParens);
    const resultWith = run(exprWithParens);
    if (resultWithout !== resultWith) {
      return `${exprWithoutParens} should equal ${exprWithParens} (precedence), but got ${resultWithout} vs ${resultWith}`;
    }
    return null;
  } catch (err) {
    return `${exprWithoutParens} precedence test failed: ${err.message}`;
  }
}

/**
 * Structural description of property tests (for documentation).
 */
export const propertySpec = {
  basic: { args: ['source', 'expected'], description: 'Verify source evaluates to expected value.' },
  commutative: { args: ['op', 'a', 'b'], description: 'Verify operator is commutative: a op b = b op a.' },
  associative: { args: ['op', 'a', 'b', 'c'], description: 'Verify operator is associative: (a op b) op c = a op (b op c).' },
  distributiveLeft: {
    args: ['outerOp', 'innerOp', 'a', 'b', 'c'],
    description: 'Verify left-distributivity: a opOuter (b opInner c) = (a opOuter b) opInner (a opOuter c).'
  },
  typeError: { args: ['source'], description: 'Verify source throws a TypeError.' },
  errorContains: { args: ['source', 'substring'], description: 'Verify source throws an error containing substring.' },
  precedence: { args: ['exprWithoutParens', 'exprWithParens'], description: 'Verify precedence via parenthesized equivalence.' }
};