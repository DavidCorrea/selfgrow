/**
 * Control flow capability - provides let bindings, function definitions,
 * conditionals, and loops. Each capability lives in its own file and
 * self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'control',
  summary: 'Control flow constructs - let bindings, function definitions, conditionals, and loops',
  examples: [
    { source: 'let x = 1 in x', result: '1' },
    { source: 'fn add(a, b) = a + b\nadd(2, 3)', result: '5' },
    { source: 'if true then 1 else 2 end', result: '1' },
    { source: 'if false then 1 else 2 end', result: '2' },
  ],
};

function registerControl(interpreter) {
  interpreter.addKeyword('let');
  interpreter.addKeyword('in');
  interpreter.addKeyword('if');
  interpreter.addKeyword('then');
  interpreter.addKeyword('else');
  interpreter.addKeyword('end');
  interpreter.addKeyword('while');
  interpreter.addKeyword('do');
  interpreter.addKeyword('fn');

  // Statement parsers
  interpreter.addStatementParser('let', (parser) => {
    parser.expectKeyword('let');
    const nameToken = parser.expect('identifier');
    let value = null;
    if (parser.matchOperator('=')) value = parser.parseExpression();
    parser.expectKeyword('in');
    const body = parser.parseExpression();
    return { type: 'Let', name: nameToken.value, value, body };
  });

  interpreter.addStatementParser('fn', (parser) => {
    parser.expectKeyword('fn');
    const nameToken = parser.expect('identifier');
    parser.expectPunctuation('(');
    const params = parser.parseParamList();
    parser.expectPunctuation(')');
    parser.expectOperator('=');
    const body = parser.parseExpression();
    return { type: 'FnDef', name: nameToken.value, params, body };
  });

  interpreter.addStatementParser('if', (parser) => {
    parser.expectKeyword('if');
    const condition = parser.parseExpression();
    parser.expectKeyword('then');
    const thenBranch = parser.parseExpression();
    let elseBranch = null;
    if (parser.matchKeyword('else')) elseBranch = parser.parseExpression();
    parser.expectKeyword('end');
    return { type: 'If', condition, then: thenBranch, else: elseBranch };
  });

  interpreter.addStatementParser('while', (parser) => {
    parser.expectKeyword('while');
    const condition = parser.parseExpression();
    parser.expectKeyword('do');
    let body = null;
    if (!(parser.peek().type === 'keyword' && parser.peek().value === 'end')) body = parser.parseExpression();
    parser.expectKeyword('end');
    return { type: 'While', condition, body };
  });

  interpreter.addStatementParser('do', (parser) => {
    parser.expectKeyword('do');
    const stmts = [];
    while (parser.peek().type !== 'eof' && parser.peek().value !== 'end') stmts.push(parser.parseExpression());
    parser.expectKeyword('end');
    return { type: 'Block', body: stmts };
  });

  // Primary parser for anonymous function expressions
  interpreter.addPrimaryParser('fn', (parser) => {
    parser.expectKeyword('fn');
    parser.expectPunctuation('(');
    const params = parser.parseParamList();
    parser.expectPunctuation(')');
    parser.expectOperator('=');
    const body = parser.parseExpression();
    return { type: 'FnExpr', params, body };
  });

  // Node handlers for evaluation
  interpreter.addNodeHandler('Let', (ast, env, steps, builtins, operators, evaluateFn) => {
    const value = ast.value ? evaluateFn(ast.value, env, steps, builtins, operators) : undefined;
    return evaluateFn(ast.body, { ...env, [ast.name]: value }, steps, builtins, operators);
  });

  interpreter.addNodeHandler('FnDef', (ast, env, steps, builtins, operators, evaluateFn) => {
    const closure = { __closure: true, params: ast.params, body: ast.body, env: { ...env } };
    env[ast.name] = closure;
    return closure;
  });

  interpreter.addNodeHandler('FnExpr', (ast, env, steps, builtins, operators, evaluateFn) => {
    return { __closure: true, params: ast.params, body: ast.body, env: { ...env } };
  });

  interpreter.addNodeHandler('If', (ast, env, steps, builtins, operators, evaluateFn) => {
    const condition = evaluateFn(ast.condition, env, steps, builtins, operators);
    if (condition) return evaluateFn(ast.then, env, steps, builtins, operators);
    else if (ast.else) return evaluateFn(ast.else, env, steps, builtins, operators);
    return undefined;
  });

  interpreter.addNodeHandler('While', (ast, env, steps, builtins, operators, evaluateFn) => {
    let result = undefined;
    while (evaluateFn(ast.condition, env, steps, builtins, operators)) {
      if (ast.body) result = evaluateFn(ast.body, env, steps, builtins, operators);
    }
    return result;
  });

  interpreter.addNodeHandler('Block', (ast, env, steps, builtins, operators, evaluateFn) => {
    let last = undefined;
    for (const stmt of ast.body) last = evaluateFn(stmt, env, steps, builtins, operators);
    return last;
  });
}

export function register(interpreter) {
  registerControl(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // let binding with value
  if (run('let x = 1 in x') !== '1') {
    failures.push('let x = 1 in x should return "1"');
  }

  // let without value (binds undefined, which prints as empty)
  if (run('let x in x') !== '') {
    failures.push('let x in x should return ""');
  }

  // named function definition and call
  if (run('fn add(a, b) = a + b\nadd(2, 3)') !== '5') {
    failures.push('named function add(2, 3) should return "5"');
  }

  // anonymous function expression (primary parser)
  if (run('(fn(a, b) = a + b)(2, 3)') !== '5') {
    failures.push('anonymous function (fn(a, b) = a + b)(2, 3) should return "5"');
  }

  // if/then/else/end
  if (run('if true then 1 else 2 end') !== '1') {
    failures.push('if true then 1 else 2 end should return "1"');
  }
  if (run('if false then 1 else 2 end') !== '2') {
    failures.push('if false then 1 else 2 end should return "2"');
  }

  // if without else branch
  if (run('if true then 1 end') !== '1') {
    failures.push('if true then 1 end should return "1"');
  }

  // while loop (top-level statement)
  if (run('while false do 1 end') !== '') {
    failures.push('while false do 1 end should return ""');
  }

  // block (do...end)
  if (run('do 1 + 2 end') !== '3') {
    failures.push('do 1 + 2 end should return "3"');
  }

  // error: unknown identifier still works after control is loaded
  try {
    run('unknownVar');
    failures.push('unknownVar should throw an error');
  } catch (err) {
    if (!err.message.includes('Unknown identifier')) {
      failures.push('unknownVar should throw "Unknown identifier" error');
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);

