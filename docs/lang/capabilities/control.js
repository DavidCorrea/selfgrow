/**
 * Control flow capability - provides let bindings, conditionals, and loops.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';

export const meta = {
  name: 'control',
  summary: 'Control flow constructs - let bindings, conditionals, and loops',
  examples: [
    { source: 'let x = 1 in x', result: '1' },
    { source: 'if true then 1 else 2 end', result: '1' },
    { source: 'if false then 1 else 2 end', result: '2' },
    { source: 'let x = if true then 1 else 2 end in x', result: '1' },
    { source: 'if true then if false then 1 else 2 end else 3 end', result: '2' },
    { source: 'print(if true then 1 else 2 end)', result: '1' },
    { source: 'while false do print(1) end', result: '' },
    { source: 'while false do let x = 1 in print(x) end', result: '' },
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
    const stmts = [];
    while (parser.peek().type !== 'eof' && !(parser.peek().type === 'keyword' && parser.peek().value === 'end')) {
      stmts.push(parser.parseStatement());
    }
    parser.expectKeyword('end');
    return { type: 'While', condition, body: { type: 'Block', body: stmts } };
  });

  interpreter.addStatementParser('do', (parser) => {
    parser.expectKeyword('do');
    const stmts = [];
    while (parser.peek().type !== 'eof' && parser.peek().value !== 'end') stmts.push(parser.parseExpression());
    parser.expectKeyword('end');
    return { type: 'Block', body: stmts };
  });

  // Primary parser for if expressions (if/then/else/end usable in expression contexts)
  interpreter.addPrimaryParser('if', (parser) => {
    parser.expectKeyword('if');
    const condition = parser.parseExpression();
    parser.expectKeyword('then');
    const thenBranch = parser.parseExpression();
    let elseBranch = null;
    if (parser.matchKeyword('else')) elseBranch = parser.parseExpression();
    parser.expectKeyword('end');
    return { type: 'If', condition, then: thenBranch, else: elseBranch };
  });

  // Node handlers for evaluation
  interpreter.addNodeHandler('Let', (ast, env, steps, builtins, operators, evaluateFn) => {
    const value = ast.value ? evaluateFn(ast.value, env, steps, builtins, operators) : undefined;
    return evaluateFn(ast.body, { ...env, [ast.name]: value }, steps, builtins, operators);
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

  // if as an expression in a let binding
  if (run('let x = if true then 1 else 2 end in x') !== '1') {
    failures.push('let x = if true then 1 else 2 end in x should return "1"');
  }

  // if as an expression passed to print
  if (run('print(if true then 1 else 2 end)') !== '1') {
    failures.push('print(if true then 1 else 2 end) should return "1"');
  }

  // nested if as an expression
  if (run('if true then if false then 1 else 2 end else 3 end') !== '2') {
    failures.push('nested if expression should return "2"');
  }

  // while loop (single expression body)
  if (run('while false do 1 end') !== '') {
    failures.push('while false do 1 end should return ""');
  }

  // while loop with block body (let binding inside loop)
  if (run('while false do let x = 1 in print(x) end') !== '') {
    failures.push('while false do let x = 1 in print(x) end should return ""');
  }

  // while loop with block body and multiple statements
  if (run('while false do print(1) print(2) end') !== '') {
    failures.push('while false do print(1) print(2) end should return ""');
  }

  // block (do...end)
  if (run('do 1 + 2 end') !== '3') {
    failures.push('do 1 + 2 end should return "3"');
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);

