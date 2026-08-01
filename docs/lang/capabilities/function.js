/**
 * Function definition capability — provides named function definitions
 * (fn keyword) and anonymous function expressions (primary parser).
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'function',
  summary: 'Function definitions — named functions with fn and anonymous function expressions',
  examples: [
    { source: 'fn add(a, b) = a + b\nadd(2, 3)', result: '5' },
    { source: 'fn add(a, b) = a + b\nadd(if true then 1 else 2 end, 3)', result: '4' },
    { source: '(fn(a, b) = a + b)(2, 3)', result: '5' },
  ],
};

function registerFunction(interpreter) {
  interpreter.addKeyword('fn');

  // Statement parser for named function definitions
  interpreter.addStatementParser('fn', (parser) => {
    parser.expectKeyword('fn');
    const nameToken = parser.expect('identifier');
    parser.expectPunctuation('(');
    const params = parser.parseParamList();
    parser.expectPunctuation(')');
    parser.expectOperator('=');
    const body = parser.parseExpression();
    return { type: 'FnDef', name: nameToken.value, params, body, start: nameToken.start };
  });

  // Primary parser for anonymous function expressions
  interpreter.addPrimaryParser('fn', (parser) => {
    const fnToken = parser.expectKeyword('fn');
    parser.expectPunctuation('(');
    const params = parser.parseParamList();
    parser.expectPunctuation(')');
    parser.expectOperator('=');
    const body = parser.parseExpression();
    return { type: 'FnExpr', params, body, start: fnToken.start };
  });

  // Node handlers for evaluation
  interpreter.addNodeHandler('FnDef', (ast, env, steps, builtins, operators, evaluateFn) => {
    const closure = { __closure: true, params: ast.params, body: ast.body, env: { ...env } };
    env[ast.name] = closure;
    return closure;
  });

  interpreter.addNodeHandler('FnExpr', (ast, env, steps, builtins, operators, evaluateFn) => {
    return { __closure: true, params: ast.params, body: ast.body, env: { ...env } };
  });
}

export function register(interpreter) {
  registerFunction(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // named function definition and call
  if (run('fn add(a, b) = a + b\nadd(2, 3)') !== '5') {
    failures.push('named function add(2, 3) should return "5"');
  }

  // anonymous function expression (primary parser)
  if (run('(fn(a, b) = a + b)(2, 3)') !== '5') {
    failures.push('anonymous function (fn(a, b) = a + b)(2, 3) should return "5"');
  }

  // function call with if expression as argument
  if (run('fn add(a, b) = a + b\nadd(if true then 1 else 2 end, 3)') !== '4') {
    failures.push('add(if true then 1 else 2 end, 3) should return "4"');
  }

  // error: unknown identifier in a function call argument
  try {
    run('fn add(a, b) = a + b\nadd(1, unknownVar)');
    failures.push('unknownVar in function call should throw an error');
  } catch (err) {
    if (!err.message.includes('Unknown identifier')) {
      failures.push('unknownVar in function call should throw "Unknown identifier" error');
    }
    if (err.location === null) {
      failures.push('unknownVar in function call error should include a non-null location');
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
