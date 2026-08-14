/**
 * letrec capability — recursive local function bindings.
 *
 * letrec makes a binding visible in the value expression of the binding
 * itself, enabling recursive local function definitions.
 *
 * Syntax: letrec name = value in body
 *
 * The value expression is evaluated in an environment where the binding
 * is already present (as a placeholder), so recursive functions can
 * reference themselves. After the value is computed, the binding is
 * updated with the actual result, and the body is evaluated.
 *
 * letrec works as both a statement and an expression (primary parser),
 * so it can be used inside let bindings, if expressions, and other
 * expression contexts.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'letrec',
  summary: 'Recursive local function bindings — letrec makes the binding visible in its own value expression',
  examples: [
    { source: 'letrec factorial = function(n) = if n <= 1 then 1 else n * factorial(n - 1) end in factorial(5)', result: '120' },
    { source: 'letrec fib = function(n) = if n <= 1 then n else fib(n - 1) + fib(n - 2) end in fib(10)', result: '55' },
    { source: 'letrec count = function(n) = if n <= 0 then 0 else 1 + count(n - 1) end in count(5)', result: '5' },
    { source: 'letrec double = function(x) = x * 2 in double(3)', result: '6' },
    { source: 'letrec outer = function(x) = letrec inner = function(y) = x + y in inner(10) in outer(5)', result: '15' },
  ],
};

function registerLetrec(interpreter) {
  interpreter.addKeyword('letrec');

  // Statement parser for top-level letrec bindings
  interpreter.addStatementParser('letrec', (parser) => {
    parser.expectKeyword('letrec');
    const nameToken = parser.expect('identifier');
    parser.expectOperator('=');
    const value = parser.parseExpression();
    parser.expectKeyword('in');
    const body = parser.parseExpression();
    return { type: 'LetRec', name: nameToken.value, value, body };
  });

  // Primary parser so letrec can be used as an expression (inside let, if, etc.)
  interpreter.addPrimaryParser('letrec', (parser) => {
    parser.expectKeyword('letrec');
    const nameToken = parser.expect('identifier');
    parser.expectOperator('=');
    const value = parser.parseExpression();
    parser.expectKeyword('in');
    const body = parser.parseExpression();
    return { type: 'LetRec', name: nameToken.value, value, body };
  });

  interpreter.addNodeHandler('LetRec', (ast, env, steps, builtins, operators, evaluateFn) => {
    // Create an env where the binding is already present (as undefined placeholder)
    // so the value expression can reference the binding for recursion.
    const letrecEnv = { ...env, [ast.name]: undefined };
    // Evaluate the value expression in the env where the binding is visible.
    const value = evaluateFn(ast.value, letrecEnv, steps, builtins, operators);
    // Update the binding with the actual value so the closure (if any) sees it.
    letrecEnv[ast.name] = value;
    // Evaluate the body with the binding visible.
    return evaluateFn(ast.body, letrecEnv, steps, builtins, operators);
  });
}

export function register(interpreter) {
  registerLetrec(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // recursive factorial
  if (run('letrec factorial = function(n) = if n <= 1 then 1 else n * factorial(n - 1) end in factorial(5)') !== '120') {
    failures.push('letrec factorial(5) should return "120"');
  }

  // recursive fibonacci
  if (run('letrec fib = function(n) = if n <= 1 then n else fib(n - 1) + fib(n - 2) end in fib(10)') !== '55') {
    failures.push('letrec fib(10) should return "55"');
  }

  // letrec binding visible in value expression (the core property)
  if (run('letrec f = function(x) = if x <= 0 then 0 else f(x - 1) end in f(1)') !== '0') {
    failures.push('letrec binding must be visible in value expression for recursion');
  }

  // letrec works inside let bindings
  if (run('let x = letrec f = function(n) = if n <= 1 then 1 else n * f(n - 1) end in f(5) in x + 1') !== '121') {
    failures.push('letrec inside let binding should return "121"');
  }

  // letrec works inside if expressions
  if (run('if true then letrec f = function(n) = if n <= 1 then 1 else n * f(n - 1) end in f(5) else 0 end') !== '120') {
    failures.push('letrec inside if expression should return "120"');
  }

  // letrec with non-function value
  if (run('letrec x = 42 in x') !== '42') {
    failures.push('letrec with non-function value should return "42"');
  }

  // letrec with no body reference (simple binding)
  if (run('letrec x = 10 in x + 5') !== '15') {
    failures.push('letrec x = 10 in x + 5 should return "15"');
  }

  // error: undefined symbol inside letrec body (not the binding itself)
  try {
    run('letrec x = 1 in unknownVar');
    failures.push('unknownVar in letrec body should throw an error');
  } catch (err) {
    if (!err.message.includes('Undefined symbol')) {
      failures.push(`letrec body with unknownVar should throw "Undefined symbol" error, got: ${err.message}`);
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
