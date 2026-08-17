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
import { getAllCapabilities } from './capabilities/registry.js';
import { tokenize, TT, getLocation, getLocationWithLength } from './tokenize.js';

// Re-export getLocation so capabilities that import it from this
// module continue to work without changes.
export { getLocation };

const MAX_STEPS = 100000;

// === Global capability registry (Map keyed by capability name) ===
export const registry = new Map();

// ============================================================
// Parser
// ============================================================

class Parser {
  constructor(tokens, source, keywords, operators, statementParsers, primaryParsers) {
    this.tokens = tokens; this.source = source; this.pos = 0; this.keywords = keywords; this.operators = operators;
    this.statementParsers = statementParsers || {};
    this.primaryParsers = primaryParsers || {};
  }
  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }
  expect(type, value) {
    const token = this.advance();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      const got = token.type === TT.EOF ? 'end of input' : `'${token.value}'`;
      const expected = value !== undefined ? `'${value}'` : type;
      throw new ParseError(`Expected ${expected}, found ${got}`, expected, got, getLocationWithLength(this.source, token.start, token.length));
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
    while (this.peek().type !== TT.EOF) {
      stmts.push(this.parseStatement());
      this.matchPunctuation(';');
    }
    return { type: 'Program', body: stmts };
  }

  // Match a binary operator with the given precedence from the operators map.
  // Returns the operator symbol or null if the current token is not a matching binary operator.
  _matchBinOp(precedence) {
    const token = this.peek();
    if (token.type === TT.EOF) return null;
    if (token.value in this.operators && !this.operators[token.value].prefix && this.operators[token.value].precedence === precedence) {
      this.advance();
      return token.value;
    }
    return null;
  }

  // Match a prefix operator from the operators map.
  // Returns the operator symbol or null if the current token is not a matching prefix operator.
  _matchPrefixOp() {
    const token = this.peek();
    if (token.type === TT.EOF) return null;
    if (token.value in this.operators && this.operators[token.value].prefix) {
      this.advance();
      return token.value;
    }
    return null;
  }

  parseStatement() {
    const token = this.peek();
    if (token.value in this.statementParsers) {
      return this.statementParsers[token.value](this);
    }
    return { type: 'ExprStmt', expr: this.parseExpression() };
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
    let op = this._matchBinOp(2);
    while (op) { left = { type: 'BinOp', op, left, right: this.parseAnd() }; op = this._matchBinOp(2); }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    let op = this._matchBinOp(3);
    while (op) { left = { type: 'BinOp', op, left, right: this.parseNot() }; op = this._matchBinOp(3); }
    return left;
  }
  parseNot() {
    let op = this._matchPrefixOp();
    if (op) return { type: 'UnaryOp', op, operand: this.parseNot() };
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parseAdd();
    let op = this._matchBinOp(5);
    while (op) { left = { type: 'BinOp', op, left, right: this.parseAdd() }; op = this._matchBinOp(5); }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    let op = this._matchBinOp(10);
    while (op) { left = { type: 'BinOp', op, left, right: this.parseMul(), start: left.start }; op = this._matchBinOp(10); }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    let op = this._matchBinOp(20);
    while (op) { left = { type: 'BinOp', op, left, right: this.parseUnary(), start: left.start }; op = this._matchBinOp(20); }
    return left;
  }
  parseUnary() {
    let op = this._matchPrefixOp();
    if (op) { const operand = this.parseUnary(); return { type: 'UnaryOp', op, operand, start: operand.start }; }
    // Match '-' as a prefix arithmetic operator (not in the operators map by default)
    if (this.matchOperator('-')) { const operand = this.parseUnary(); return { type: 'UnaryOp', op: '-', operand, start: operand.start }; }
    return this.parsePrimary();
  }
  parsePrimary() {
    const expr = this._parsePrimaryBase();
    return this._parseAccessors(expr);
  }

  _parsePrimaryBase() {
    const token = this.peek();
    if (token.type === TT.NUMBER) { this.advance(); return { type: 'Number', value: token.value, start: token.start }; }
    if (token.type === TT.STRING) { this.advance(); return { type: 'String', value: token.value, start: token.start }; }
    if (token.type === TT.KEYWORD && (token.value === 'true' || token.value === 'false')) { this.advance(); return { type: 'Boolean', value: token.value === 'true', start: token.start }; }
    if (token.type === TT.KEYWORD && token.value === 'nil') { this.advance(); return { type: 'Nil', start: token.start }; }
    if (this.matchPunctuation('(')) { const expr = this.parseExpression(); this.expectPunctuation(')'); return expr; }
    if (token.type === TT.PUNCTUATION && token.value === '#') { this.advance(); return this._parseRecordLiteral(token.start); }
    if (token.value in this.primaryParsers) {
      return this.primaryParsers[token.value](this);
    }
    if (token.type === TT.IDENTIFIER) {
      this.advance();
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === '(') return { type: 'Call', callee: { type: 'Identifier', name: token.value, start: token.start }, args: this.parseArgList() };
      return { type: 'Identifier', name: token.value, start: token.start };
    }
    throw new ParseError(`Unexpected token '${token.value}'`, 'an operand', token.type === TT.EOF ? 'end of input' : `'${token.value}'`, getLocationWithLength(this.source, token.start, token.length));
  }

  _parseAccessors(expr) {
    while (true) {
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === '.') {
        this.advance();
        const field = this.expect(TT.IDENTIFIER).value;
        expr = { type: 'FieldAccess', target: expr, field, start: expr.start };
      } else if (this.peek().type === TT.PUNCTUATION && this.peek().value === '(') {
        expr = { type: 'Call', callee: expr, args: this.parseArgList(), start: expr.start };
      } else {
        break;
      }
    }
    return expr;
  }

  _parseRecordLiteral(hashStart) {
    this.expectPunctuation('{');
    const fields = {};
    if (this.peek().type === TT.PUNCTUATION && this.peek().value === '}') {
      this.advance();
      return { type: 'Record', fields, start: hashStart };
    }
    while (true) {
      const keyToken = this.expect(TT.IDENTIFIER);
      this.expectPunctuation(':');
      const value = this.parseExpression();
      fields[keyToken.value] = value;
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === ',') {
        this.advance();
        continue;
      }
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === '}') {
        this.advance();
        break;
      }
      const token = this.peek();
      const loc = getLocationWithLength(this.source, token.start, token.length);
      throw new ParseError('Expected , or } in record literal', "',' or '}'", token.type === TT.EOF ? 'end of input' : `'${token.value}'`, loc);
    }
    return { type: 'Record', fields, start: hashStart };
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

function parse(source, keywords, operators, statementParsers, primaryParsers) {
  return new Parser(tokenize(source, keywords), source, keywords, operators, statementParsers, primaryParsers).parseProgram();
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
  if (value && value.__record) return 'a record';
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
  if (value && value.__cons) return 'a list cell';
  if (value && value.__record) return 'a record';
  return typeof value;
}

function createEvaluator(nodeHandlers) {
  function evaluate(ast, env, steps, builtins, operators) {
    steps.count++;
    if (steps.count > MAX_STEPS) {
      throw new TimeoutError('Program did not finish — the evaluation exceeded the maximum step count, which usually means an infinite loop.', 'program completion', 'step limit exceeded', getLocation(steps.source, 0));
    }

    // Dispatch through nodeHandlers first (capability-managed nodes)
    if (ast.type in nodeHandlers) {
      return nodeHandlers[ast.type](ast, env, steps, builtins, operators, evaluate);
    }

    // Core evaluation (nodes not managed by capabilities)
    switch (ast.type) {
      case 'Program': {
        let lastValue = undefined;
        for (const stmt of ast.body) lastValue = evaluate(stmt, env, steps, builtins, operators);
        return lastValue;
      }
      case 'ExprStmt': return evaluate(ast.expr, env, steps, builtins, operators);
      case 'Number': return ast.value;
      case 'String': return ast.value;
      case 'Boolean': return ast.value;
      case 'Identifier': {
        if (ast.name in env) return env[ast.name];
        const loc = getLocation(steps.source, ast.start);
        throw new RuntimeError(`Undefined symbol '${ast.name}'`, `a defined symbol`, `symbol '${ast.name}'`, loc);
      }
      case 'Call': {
        const callee = evaluate(ast.callee, env, steps, builtins, operators);
        const args = ast.args.map(arg => evaluate(arg, env, steps, builtins, operators));
        let printed = '';
        if (callee && callee.__printed !== undefined) printed = callee.__printed;
        if (callee && callee.__builtin) {
          steps.position = ast.start;
          return callee.fn(args, steps);
        }
        if (callee && callee.__closure) {
          if (callee.params.length !== args.length) {
            throw new TypeError(`Function ${describeCallee(ast.callee)} expects ${callee.params.length} arguments but got ${args.length}`, `${callee.params.length} arguments`, `${args.length} arguments`, getLocation(steps.source, ast.start));
          }
          const closureEnv = { ...callee.env };
          callee.params.forEach((param, i) => { closureEnv[param] = args[i]; });
          const result = evaluate(callee.body, closureEnv, steps, builtins, operators);
          if (result && result.__printed) printed += result.__printed;
          return result && result.__value !== undefined ? result.__value : result;
        }
        throw new TypeError(`${describeCallee(ast.callee)} is not a function`, 'a function', describeValue(callee), getLocation(steps.source, ast.start));
      }
      case 'Record': {
        const record = {};
        for (const [key, valueExpr] of Object.entries(ast.fields)) {
          record[key] = evaluate(valueExpr, env, steps, builtins, operators);
        }
        record.__record = true;
        return record;
      }
      case 'FieldAccess': {
        const target = evaluate(ast.target, env, steps, builtins, operators);
        if (target === null || target === undefined || typeof target !== 'object') {
          throw new RuntimeError(`Cannot access field '${ast.field}' on ${describeValue(target)}`, 'a record', describeValue(target), getLocation(steps.source, ast.start));
        }
        if (!(ast.field in target)) {
          throw new RuntimeError(`Field '${ast.field}' does not exist on record`, `a field named '${ast.field}'`, 'no such field', getLocation(steps.source, ast.start));
        }
        return target[ast.field];
      }
      case 'BinOp': {
        const left = evaluate(ast.left, env, steps, builtins, operators);
        const right = evaluate(ast.right, env, steps, builtins, operators);
        if (ast.op in operators) {
          if (ast.op === '/' && right === 0) throw new RuntimeError('division by zero', 'a non-zero divisor', '0', getLocation(steps.source, ast.start));
          return operators[ast.op].fn(left, right, steps);
        }
        throw new TypeError(`Unknown operator: ${ast.op}`, 'a valid operator', `'${ast.op}'`, getLocation(steps.source, ast.start));
      }
      case 'UnaryOp': {
        const operand = evaluate(ast.operand, env, steps, builtins, operators);
        if (ast.op in operators && operators[ast.op].prefix) {
          return operators[ast.op].fn(operand);
        }
        switch (ast.op) {
          case '-': return -operand;
          default: throw new TypeError(`Unknown unary operator: ${ast.op}`, 'a valid unary operator', `'${ast.op}'`, getLocation(steps.source, ast.start));
        }
      }
      default:
        throw new RuntimeError(`Unknown AST node type: ${ast.type}`, 'a valid AST node type', `'${ast.type}'`, getLocation(steps.source, ast.start));
    }
  }
  return evaluate;
}

function prettyPrint(value) {
  if (value === null || value === undefined) return '';
  if (value && value.__printed !== undefined) return value.__printed;
  return formatValue(value);
}

// ============================================================
// Program runner (parameterized by keywords set, builtins map, and operators map)
// ============================================================

function runProgram(source, keywords, builtins, operators, statementParsers, primaryParsers, nodeHandlers) {
  try {
    const ast = parse(source, keywords, operators, statementParsers, primaryParsers);
    const steps = { count: 0, builtins, operators, source };
    const env = makeInitialEnv(builtins);
    const evaluate = createEvaluator(nodeHandlers);
    steps.evaluate = evaluate;
    const result = evaluate(ast, env, steps, builtins, operators);
    return prettyPrint(result);
  } catch (err) {
    if (err instanceof SelfgrowError) throw err;
    const location = err.location ?? null; throw new RuntimeError(err.message || String(err), null, null, location);
  }
}

// ============================================================
// Interpreter API — createInterpreter() and run()
// ============================================================

/**
 * Create a new interpreter instance.
 * All instances share the same global capability registry.
 * The returned interpreter has register(cap), run(source),
 * registerFunction(name, fn), registerType(name, def),
 * lookupFunction(name), and lookupType(name) methods.
 */
export function createInterpreter() {
  const interp = {
    // Persistent interpreter state — populated by capabilities via registration API.
    builtins: {},
    types: {},

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
     * Register a builtin function so it can be called from selfgrow programs.
     * @param {string} name
     * @param {Function} fn
     */
    registerFunction(name, fn) {
      interp.builtins[name] = { __builtin: true, fn, arity: fn.arity ?? -1 };
    },

    /**
     * Register a type definition so it can be referenced during evaluation.
     * @param {string} name
     * @param {object} def
     */
    registerType(name, def) {
      interp.types[name] = def;
    },

    /**
     * Look up a registered builtin function by name.
     * @param {string} name
     * @returns {Function|null}
     */
    lookupFunction(name) {
      return interp.builtins[name]?.fn ?? null;
    },

    /**
     * Look up a registered type definition by name.
     * @param {string} name
     * @returns {object|null}
     */
    lookupType(name) {
      return interp.types[name] ?? null;
    },

    /**
     * Run a selfgrow program and return its printed result.
     * Creates a fresh interpreter state (keywords set, operators map)
     * and loads all registered capabilities via their registerFn before evaluation.
     * Builtins and types are accumulated on the interpreter instance.
     * @param {string} source
     * @returns {string} The printed output of the program
     */
    run(source) {
      // Keywords start empty — populated by capabilities via addKeyword
      const keywords = new Set();

      // Operators start empty — populated by capabilities via addOperator
      const operators = {};

      // Parsing dispatch tables — populated by capabilities
      const statementParsers = {};
      const primaryParsers = {};

      // Node handlers for evaluation — populated by capabilities
      const nodeHandlers = {};

      // Extension API passed to each capability's registerFn
      const extensions = {
        addKeyword(kw) { keywords.add(kw); },
        registerFunction(name, fn) { interp.registerFunction(name, fn); },
        registerType(name, def) { interp.registerType(name, def); },
        lookupFunction(name) { return interp.lookupFunction(name); },
        lookupType(name) { return interp.lookupType(name); },
        addOperator(symbol, operatorDef) { operators[symbol] = operatorDef; },
        addStatementParser(keyword, fn) { statementParsers[keyword] = fn; },
        addPrimaryParser(keyword, fn) { primaryParsers[keyword] = fn; },
        addNodeHandler(nodeType, fn) { nodeHandlers[nodeType] = fn; },
      };

      // Load all capabilities from the registry so that built‑ins (print,
      // arithmetic, control, comparison, list) are available for evaluation.
      for (const cap of getAllCapabilities()) {
        if (typeof cap.registerFn === 'function') {
          cap.registerFn(extensions);
        }
      }

      return runProgram(source, keywords, interp.builtins, operators, statementParsers, primaryParsers, nodeHandlers);
    }
  };

  return interp;
}
