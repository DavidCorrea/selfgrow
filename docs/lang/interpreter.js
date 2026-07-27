/**
 * Interpreter core for the selfgrow language.
 *
 * The interpreter is extensible through capabilities that register
 * themselves at module load time via the global registry (a Map
 * keyed by capability name in this module).
 *
 * createInterpreter() returns an object with register(cap) and run(source) methods.
 * Capabilities register by calling interpreter.register({ name, registerFn }) at
 * module load time. When run() is called, it creates a fresh evaluation state,
 * loads all registered capabilities (calling their registerFn with the extensions
 * API), then evaluates source.
 *
 * No capability names are hardcoded in the interpreter core — all builtins,
 * keywords, and evaluation rules come from registered capabilities.
 */
import { SelfgrowError, ParseError, TypeError, RuntimeError, TimeoutError } from './errors.js';

const MAX_STEPS = 100000;

// === Token types ===
const TT = {
  NUMBER: 'number',
  STRING: 'string',
  BOOLEAN: 'boolean',
  IDENTIFIER: 'identifier',
  KEYWORD: 'keyword',
  OPERATOR: 'operator',
  PUNCTUATION: 'punctuation',
  EOF: 'eof',
};

// === Global capability registry (Map keyed by capability name) ===
export const registry = new Map();

// ============================================================
// Tokenizer
// ============================================================

function tokenize(source, keywords) {
  const tokens = [];
  let pos = 0;

  while (pos < source.length) {
    const ch = source[pos];

    // Whitespace
    if (/\s/.test(ch)) { pos++; continue; }

    // Single-line comments
    if (ch === '/' && source[pos + 1] === '/') {
      while (pos < source.length && source[pos] !== '\n') pos++;
      continue;
    }

    // Numbers (integers, decimals, scientific notation)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[pos + 1]))) {
      let numStr = '';
      let hasDot = false;
      while (pos < source.length && (/[0-9]/.test(source[pos]) || (source[pos] === '.' && !hasDot))) {
        if (source[pos] === '.') hasDot = true;
        numStr += source[pos];
        pos++;
      }
      if (pos < source.length && /[eE]/.test(source[pos])) {
        numStr += source[pos]; pos++;
        if (pos < source.length && /[+\-]/.test(source[pos])) { numStr += source[pos]; pos++; }
        while (pos < source.length && /[0-9]/.test(source[pos])) { numStr += source[pos]; pos++; }
      }
      tokens.push({ type: TT.NUMBER, value: parseFloat(numStr), start: pos - numStr.length });
      continue;
    }

    // Double-quoted strings
    if (ch === '"') {
      let str = ''; pos++;
      while (pos < source.length && source[pos] !== '"') {
        if (source[pos] === '\\') {
          pos++; const esc = source[pos];
          if (esc === 'n') str += '\n';
          else if (esc === 't') str += '\t';
          else if (esc === 'r') str += '\r';
          else if (esc === '\\') str += '\\';
          else if (esc === '"') str += '"';
          else str += '\\' + esc;
        } else { str += source[pos]; }
        pos++;
      }
      if (pos >= source.length) {
        const loc = getLocation(source, pos);
        throw new ParseError('Unterminated string', 'a closing quote', 'end of input', loc);
      }
      pos++; tokens.push({ type: TT.STRING, value: str, start: pos - str.length - 2 });
      continue;
    }

    // Multi-character operators
    const twoChar = source.slice(pos, pos + 2);
    const twoCharOps = ['==', '!=', '<=', '>=', '=>'];
    if (twoCharOps.includes(twoChar)) { tokens.push({ type: TT.OPERATOR, value: twoChar, start: pos }); pos += 2; continue; }

    // Single-character operators
    if ('+-*/<>='.includes(ch)) { tokens.push({ type: TT.OPERATOR, value: ch, start: pos }); pos++; continue; }

    // Punctuation
    if ('(){},;[]'.includes(ch)) { tokens.push({ type: TT.PUNCTUATION, value: ch, start: pos }); pos++; continue; }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) { ident += source[pos]; pos++; }
      const type = keywords.has(ident) ? TT.KEYWORD : TT.IDENTIFIER;
      tokens.push({ type, value: ident, start: pos - ident.length });
      continue;
    }

    const loc = getLocation(source, pos);
    throw new ParseError(`Unexpected character '${ch}'`, 'a valid character', `'${ch}'`, loc);
  }

  tokens.push({ type: TT.EOF, value: '', start: pos });
  return tokens;
}

// ============================================================
// Parser
// ============================================================

export function getLocation(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column, offset };
}

class Parser {
  constructor(tokens, source, keywords) {
    this.tokens = tokens; this.source = source; this.pos = 0; this.keywords = keywords;
  }
  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }
  expect(type, value) {
    const token = this.advance();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      const got = token.type === TT.EOF ? 'end of input' : `'${token.value}'`;
      const expected = value !== undefined ? `'${value}'` : type;
      throw new ParseError(`Expected ${expected}, found ${got}`, expected, got, getLocation(this.source, token.start));
    }
    return token;
  }
  match(type, value) {
    const token = this.peek();
    if (token.type === type && (value === undefined || token.value === value)) return this.advance();
    return null;
  }
  matchKeyword(value) { return this.match(TT.KEYWORD, value); }
  matchOperator(value) { return this.match(TT.OPERATOR, value); }
  matchPunctuation(value) { return this.match(TT.PUNCTUATION, value); }

  parseProgram() {
    const stmts = [];
    while (this.peek().type !== TT.EOF) stmts.push(this.parseStatement());
    return { type: 'Program', body: stmts };
  }

  parseStatement() {
    const token = this.peek();
    if (token.value === 'let') return this.parseLet();
    if (token.value === 'fn') return this.parseFn();
    if (token.value === 'if') return this.parseIf();
    if (token.value === 'while') return this.parseWhile();
    if (token.value === 'do') return this.parseBlock();
    return { type: 'ExprStmt', expr: this.parseExpression() };
  }

  parseLet() {
    this.expectKeyword('let');
    const nameToken = this.expect(TT.IDENTIFIER);
    let value = null;
    if (this.matchOperator('=')) value = this.parseExpression();
    this.expectKeyword('in');
    const body = this.parseExpression();
    return { type: 'Let', name: nameToken.value, value, body };
  }

  parseFn() {
    this.expectKeyword('fn');
    const nameToken = this.expect(TT.IDENTIFIER);
    this.expectPunctuation('(');
    const params = this.parseParamList();
    this.expectPunctuation(')');
    this.expectOperator('=');
    const body = this.parseExpression();
    return { type: 'FnDef', name: nameToken.value, params, body };
  }

  parseIf() {
    this.expectKeyword('if');
    const condition = this.parseExpression();
    this.expectKeyword('then');
    const thenBranch = this.parseExpression();
    let elseBranch = null;
    if (this.matchKeyword('else')) elseBranch = this.parseExpression();
    this.expectKeyword('end');
    return { type: 'If', condition, then: thenBranch, else: elseBranch };
  }

  parseWhile() {
    this.expectKeyword('while');
    const condition = this.parseExpression();
    this.expectKeyword('do');
    let body = null;
    if (!(this.peek().type === TT.KEYWORD && this.peek().value === 'end')) body = this.parseExpression();
    this.expectKeyword('end');
    return { type: 'While', condition, body };
  }

  parseBlock() {
    this.expectKeyword('do');
    const stmts = [];
    while (this.peek().type !== TT.EOF && this.peek().value !== 'end') stmts.push(this.parseExpression());
    this.expectKeyword('end');
    return { type: 'Block', body: stmts };
  }

  parseParamList() {
    const params = [];
    if (this.peek().type === TT.IDENTIFIER) {
      params.push(this.advance().value);
      while (this.matchPunctuation(',')) params.push(this.expect(TT.IDENTIFIER).value);
    }
    return params;
  }

  parseExpression() { return this.parseOr(); }
  parseOr() {
    let left = this.parseAnd();
    while (this.matchKeyword('or')) left = { type: 'BinOp', op: 'or', left, right: this.parseAnd() };
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.matchKeyword('and')) left = { type: 'BinOp', op: 'and', left, right: this.parseNot() };
    return left;
  }
  parseNot() {
    if (this.matchKeyword('not')) return { type: 'UnaryOp', op: 'not', operand: this.parseNot() };
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parseAdd();
    const compOps = ['==', '!=', '<', '>', '<=', '>='];
    while (true) {
      const op = this.peek();
      if (op.type === TT.OPERATOR && compOps.includes(op.value)) { this.advance(); left = { type: 'BinOp', op: op.value, left, right: this.parseAdd() }; }
      else break;
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.matchOperator('+') || this.matchOperator('-')) { const op = this.tokens[this.pos - 1].value; left = { type: 'BinOp', op, left, right: this.parseMul() }; }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (this.matchOperator('*') || this.matchOperator('/')) { const op = this.tokens[this.pos - 1].value; left = { type: 'BinOp', op, left, right: this.parseUnary() }; }
    return left;
  }
  parseUnary() {
    if (this.matchOperator('-')) return { type: 'UnaryOp', op: '-', operand: this.parseUnary() };
    return this.parsePrimary();
  }
  parsePrimary() {
    const token = this.peek();
    if (token.type === TT.NUMBER) { this.advance(); return { type: 'Number', value: token.value }; }
    if (token.type === TT.STRING) { this.advance(); return { type: 'String', value: token.value }; }
    if (token.type === TT.KEYWORD && (token.value === 'true' || token.value === 'false')) { this.advance(); return { type: 'Boolean', value: token.value === 'true' }; }
    if (this.matchPunctuation('(')) { const expr = this.parseExpression(); this.expectPunctuation(')'); if (this.peek().type === TT.PUNCTUATION && this.peek().value === '(') return { type: 'Call', callee: expr, args: this.parseArgList() }; return expr; }
    if (token.type === TT.KEYWORD && token.value === 'fn') {
      this.advance(); this.expectPunctuation('('); const params = this.parseParamList(); this.expectPunctuation(')'); this.expectOperator('='); const body = this.parseExpression(); return { type: 'FnExpr', params, body };
    }
    if (token.type === TT.IDENTIFIER) {
      this.advance();
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === '(') return { type: 'Call', callee: { type: 'Identifier', name: token.value }, args: this.parseArgList() };
      return { type: 'Identifier', name: token.value };
    }
    throw new ParseError(`Unexpected token '${token.value}'`, 'an operand', token.type === TT.EOF ? 'end of input' : `'${token.value}'`, getLocation(this.source, token.start));
  }

  parseArgList() {
    this.expectPunctuation('('); const args = [];
    if (!(this.peek().type === TT.PUNCTUATION && this.peek().value === ')')) {
      args.push(this.parseExpression());
      while (this.matchPunctuation(',')) args.push(this.parseExpression());
    }
    this.expectPunctuation(')'); return args;
  }

  expectKeyword(value) { return this.expect(TT.KEYWORD, value); }
  expectPunctuation(value) { return this.expect(TT.PUNCTUATION, value); }
  expectOperator(value) { return this.expect(TT.OPERATOR, value); }
}

function parse(source, keywords) {
  return new Parser(tokenize(source, keywords), source, keywords).parseProgram();
}

// ============================================================
// Evaluator
// ============================================================

function makeInitialEnv(builtins) {
  const env = {};
  for (const [name, builtin] of Object.entries(builtins)) env[name] = builtin;
  return env;
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { if (Number.isInteger(value)) return String(value); return String(value); }
  return String(value);
}

function describeCallee(callee) {
  if (callee.type === 'Identifier') return callee.name;
  return 'expression';
}

function describeValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value && value.__closure) return 'a closure';
  return typeof value;
}

function evaluate(ast, env, steps, builtins) {
  steps.count++;
  if (steps.count > MAX_STEPS) {
    throw new TimeoutError('Program did not finish — the evaluation exceeded the maximum step count, which usually means an infinite loop.', 'program completion', 'step limit exceeded', null);
  }

  switch (ast.type) {
    case 'Program': {
      let lastValue = undefined;
      for (const stmt of ast.body) lastValue = evaluate(stmt, env, steps, builtins);
      return lastValue;
    }
    case 'ExprStmt': return evaluate(ast.expr, env, steps, builtins);
    case 'Block': { let last = undefined; for (const stmt of ast.body) last = evaluate(stmt, env, steps, builtins); return last; }
    case 'Number': return ast.value;
    case 'String': return ast.value;
    case 'Boolean': return ast.value;
    case 'Identifier': {
      if (ast.name in env) return env[ast.name];
      throw new RuntimeError(`Unknown identifier: ${ast.name}`, 'a defined identifier', `undefined identifier '${ast.name}'`, null);
    }
    case 'Let': {
      const value = ast.value ? evaluate(ast.value, env, steps, builtins) : undefined;
      return evaluate(ast.body, { ...env, [ast.name]: value }, steps, builtins);
    }
    case 'FnDef': {
      const closure = { __closure: true, params: ast.params, body: ast.body, env: { ...env } };
      env[ast.name] = closure;
      return closure;
    }
    case 'FnExpr': {
      return { __closure: true, params: ast.params, body: ast.body, env: { ...env } };
    }
    case 'Call': {
      const callee = evaluate(ast.callee, env, steps, builtins);
      const args = ast.args.map(arg => evaluate(arg, env, steps, builtins));
      let printed = '';
      if (callee && callee.__printed !== undefined) printed = callee.__printed;
      if (callee && callee.__builtin) {
        return callee.fn(args, steps);
      }
      if (callee && callee.__closure) {
        if (callee.params.length !== args.length) {
          throw new TypeError(`Function ${describeCallee(ast.callee)} expects ${callee.params.length} arguments but got ${args.length}`, `${callee.params.length} arguments`, `${args.length} arguments`, null);
        }
        const closureEnv = { ...callee.env };
        callee.params.forEach((param, i) => { closureEnv[param] = args[i]; });
        const result = evaluate(callee.body, closureEnv, steps, builtins);
        if (result && result.__printed) printed += result.__printed;
        return result && result.__value !== undefined ? result.__value : result;
      }
      throw new TypeError(`${describeCallee(ast.callee)} is not a function`, 'a function', describeValue(callee), null);
    }
    case 'BinOp': {
      const left = evaluate(ast.left, env, steps, builtins);
      const right = evaluate(ast.right, env, steps, builtins);
      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': if (right === 0) throw new RuntimeError('Division by zero', 'a non-zero divisor', '0', null); return left / right;
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        case 'and': return left && right;
        case 'or': return left || right;
        default: throw new TypeError(`Unknown operator: ${ast.op}`, 'a valid operator', `'${ast.op}'`, null);
      }
    }
    case 'UnaryOp': {
      const operand = evaluate(ast.operand, env, steps, builtins);
      switch (ast.op) {
        case '-': return -operand;
        case 'not': return !operand;
        default: throw new TypeError(`Unknown unary operator: ${ast.op}`, 'a valid unary operator', `'${ast.op}'`, null);
      }
    }
    case 'If': {
      const condition = evaluate(ast.condition, env, steps, builtins);
      if (condition) return evaluate(ast.then, env, steps, builtins);
      else if (ast.else) return evaluate(ast.else, env, steps, builtins);
      return undefined;
    }
    case 'While': {
      let result = undefined;
      while (evaluate(ast.condition, env, steps, builtins)) { if (ast.body) result = evaluate(ast.body, env, steps, builtins); }
      return result;
    }
    default:
      throw new RuntimeError(`Unknown AST node type: ${ast.type}`, 'a valid AST node type', `'${ast.type}'`, null);
  }
}

function prettyPrint(value) {
  if (value === null || value === undefined) return '';
  if (value && value.__printed !== undefined) return value.__printed;
  return formatValue(value);
}

// ============================================================
// Program runner (parameterized by keywords set and builtins map)
// ============================================================

function runProgram(source, keywords, builtins) {
  try {
    const ast = parse(source, keywords);
    const steps = { count: 0 };
    const env = makeInitialEnv(builtins);
    const result = evaluate(ast, env, steps, builtins);
    return prettyPrint(result);
  } catch (err) {
    if (err instanceof SelfgrowError) throw err;
    throw new RuntimeError(err.message || String(err), null, null, null);
  }
}

// ============================================================
// Interpreter API — createInterpreter() and run()
// ============================================================

/**
 * Create a new interpreter instance.
 * All instances share the same global capability registry.
 * The returned interpreter has register(cap) and run(source) methods.
 */
export function createInterpreter() {
  return {
    /**
     * Register a capability with the global registry.
     * @param {{ name: string, registerFn: Function }} cap
     */
    register(cap) {
      if (!cap || typeof cap.name !== 'string') {
        throw new Error('Capability must be an object with a string "name" property');
      }
      if (typeof cap.registerFn !== 'function') {
        throw new Error(`Capability "${cap.name}" must have a registerFn function`);
      }
      registry.set(cap.name, cap);
    },

    /**
     * Run a selfgrow program and return its printed result.
     * Creates a fresh interpreter state (keywords set + builtins map) and loads
     * all registered capabilities via their registerFn before evaluation.
     * @param {string} source
     * @returns {string} The printed output of the program
     */
    run(source) {
      // Core language keywords (part of the interpreter's default state)
      const keywords = new Set([
        'let', 'in', 'if', 'then', 'else', 'end',
        'while', 'do', 'fn', 'and', 'or', 'not',
        'true', 'false',
      ]);

      // Builtins start empty — populated by capabilities
      const builtins = {};

      // Extension API passed to each capability's registerFn
      const extensions = {
        addKeyword(kw) { keywords.add(kw); },
        addBuiltin(name, fn) { builtins[name] = { __builtin: true, fn, arity: fn.arity ?? -1 }; },
      };

      // Load all registered capabilities (in insertion order)
      for (const cap of registry.values()) {
        if (typeof cap.registerFn === 'function') {
          cap.registerFn(extensions);
        }
      }

      return runProgram(source, keywords, builtins);
    }
  };
}
