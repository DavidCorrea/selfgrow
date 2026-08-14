/**
 * Function definition capability — provides named function definitions
 * (function keyword) and anonymous function expressions (primary parser).
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'function',
  summary: 'Function definitions — named functions with function and anonymous function expressions',
  examples: [
    { source: 'function add(a, b) = a + b\nadd(2, 3)', result: '5' },
    { source: 'function add(a, b) = a + b\nadd(if true then 1 else 2 end, 3)', result: '4' },
    { source: '(function(a, b) = a + b)(2, 3)', result: '5' },
    { source: 'function double(x) = x * 2\nhead(listMap(double, cons(1, cons(2, nil))))', result: '2' },
    { source: 'let double = function(x) = x * 2 in head(listMap(double, cons(1, cons(2, nil))))', result: '2' },
    { source: 'head(listFilter(function(x) = x > 1, cons(1, cons(2, cons(3, nil)))))', result: '2' },
    { source: 'listFold(function(acc, x) = acc + x, 0, cons(1, cons(2, cons(3, nil))))', result: '6' },
    { source: '(function() = 42)()', result: '42' },
  ],
};

function registerFunction(interpreter) {
  interpreter.addKeyword('function');

  // Statement parser for named function definitions
  interpreter.addStatementParser('function', (parser) => {
    parser.expectKeyword('function');
    const nameToken = parser.expect('identifier');
    parser.expectPunctuation('(');
    const params = parser.parseParamList();
    parser.expectPunctuation(')');
    parser.expectOperator('=');
    const body = parser.parseExpression();
    return { type: 'FnDef', name: nameToken.value, params, body, start: nameToken.start };
  });

  // Primary parser for anonymous function expressions
  interpreter.addPrimaryParser('function', (parser) => {
    const keywordToken = parser.expectKeyword('function');
    parser.expectPunctuation('(');
    const params = parser.parseParamList();
    parser.expectPunctuation(')');
    parser.expectOperator('=');
    const body = parser.parseExpression();
    return { type: 'FnExpr', params, body, start: keywordToken.start };
  });

  // Node handlers for evaluation
  interpreter.addNodeHandler('FnDef', (ast, env, steps, builtins, operators, evaluateFn) => {
    const closure = { __closure: true, params: ast.params, body: ast.body, env };
    env[ast.name] = closure;
    return closure;
  });

  interpreter.addNodeHandler('FnExpr', (ast, env, steps, builtins, operators, evaluateFn) => {
    return { __closure: true, params: ast.params, body: ast.body, env };
  });
}

export function register(interpreter) {
  registerFunction(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // named function definition and call
  if (run('function add(a, b) = a + b\nadd(2, 3)') !== '5') {
    failures.push('named function add(2, 3) should return "5"');
  }

  // anonymous function expression (primary parser)
  if (run('(function(a, b) = a + b)(2, 3)') !== '5') {
    failures.push('anonymous function (function(a, b) = a + b)(2, 3) should return "5"');
  }

  // function call with if expression as argument
  if (run('function add(a, b) = a + b\nadd(if true then 1 else 2 end, 3)') !== '4') {
    failures.push('add(if true then 1 else 2 end, 3) should return "4"');
  }

  // closure capture: function captures variable from outer environment
  if (run('let x = 10 in (function() = x)()') !== '10') {
    failures.push('closure should capture x from outer environment, returning "10"');
  }

  // no-arg function
  if (run('(function() = 42)()') !== '42') {
    failures.push('no-arg function (function() = 42)() should return "42"');
  }

  // named function passed as argument to higher-order function
  if (run('function double(x) = x * 2\nhead(listMap(double, cons(1, cons(2, nil))))') !== '2') {
    failures.push('named function double passed to listMap should return "2"');
  }

  // let-bound function passed as argument
  if (run('let double = function(x) = x * 2 in head(listMap(double, cons(1, cons(2, nil))))') !== '2') {
    failures.push('let-bound function double passed to listMap should return "2"');
  }

  // anonymous function passed to listFilter
  if (run('head(listFilter(function(x) = x > 1, cons(1, cons(2, cons(3, nil)))))') !== '2') {
    failures.push('anonymous function passed to listFilter should return "2"');
  }

  // anonymous function passed to listFold
  if (run('listFold(function(acc, x) = acc + x, 0, cons(1, cons(2, cons(3, nil))))') !== '6') {
    failures.push('anonymous function passed to listFold should return "6"');
  }

  // error: calling a non-function value
  try {
    run('5()');
    failures.push('calling a non-function (5) should throw an error');
  } catch (err) {
    if (!err.message.includes('not a function')) {
      failures.push(`calling a non-function should throw "not a function" error, got: ${err.message}`);
    }
  }

  // error: unknown identifier in a function call argument
  try {
    run('function add(a, b) = a + b\nadd(1, unknownVar)');
    failures.push('unknownVar in function call should throw an error');
  } catch (err) {
    if (!err.message.includes('Undefined symbol')) {
      failures.push('unknownVar in function call should throw "Undefined symbol" error');
    }
    if (err.location === null) {
      failures.push('unknownVar in function call error should include a non-null location');
    }
  }

  // error: unknown identifier used as a function
  try {
    run('unknownFn()');
    failures.push('unknownFn() should throw an error');
  } catch (err) {
    if (!err.message.includes('Undefined symbol') && !err.message.includes('not a function')) {
      failures.push(`unknownFn() should throw "Undefined symbol" or "not a function" error, got: ${err.message}`);
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
