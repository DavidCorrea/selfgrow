/**
 * Runtime core for the selfgrow language.
 * Parses source into an AST, evaluates it, and returns the printed result.
 * Uses a step counter to detect and terminate infinite loops.
 * Throws user-facing error messages (not stack traces) for all errors.
 */

const MAX_STEPS = 100000;

// --- Token types ---
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

const KEYWORDS = new Set([
  'let', 'in', 'if', 'then', 'else', 'end',
  'while', 'do', 'fn', 'and', 'or', 'not',
  'true', 'false',
]);

// --- Tokenizer ---

function tokenize(source) {
  const tokens = [];
  let pos = 0;

  while (pos < source.length) {
    const ch = source[pos];

    // Whitespace
    if (/\s/.test(ch)) {
      pos++;
      continue;
    }

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
      // Scientific notation
      if (pos < source.length && /[eE]/.test(source[pos])) {
        numStr += source[pos];
        pos++;
        if (pos < source.length && /[+\-]/.test(source[pos])) {
          numStr += source[pos];
          pos++;
        }
        while (pos < source.length && /[0-9]/.test(source[pos])) {
          numStr += source[pos];
          pos++;
        }
      }
      tokens.push({ type: TT.NUMBER, value: parseFloat(numStr), start: pos - numStr.length });
      continue;
    }

    // Double-quoted strings
    if (ch === '"') {
      let str = '';
      pos++; // skip opening quote
      while (pos < source.length && source[pos] !== '"') {
        if (source[pos] === '\\') {
          pos++;
          const esc = source[pos];
          if (esc === 'n') str += '\n';
          else if (esc === 't') str += '\t';
          else if (esc === 'r') str += '\r';
          else if (esc === '\\') str += '\\';
          else if (esc === '"') str += '"';
          else str += '\\' + esc;
        } else {
          str += source[pos];
        }
        pos++;
      }
      if (pos >= source.length) throw new Error('Unterminated string');
      pos++; // skip closing quote
      tokens.push({ type: TT.STRING, value: str, start: pos - str.length - 2 });
      continue;
    }

    // Multi-character operators
    const twoChar = source.slice(pos, pos + 2);
    const twoCharOps = ['==', '!=', '<=', '>=', '=>'];
    if (twoCharOps.includes(twoChar)) {
      tokens.push({ type: TT.OPERATOR, value: twoChar, start: pos });
      pos += 2;
      continue;
    }

    // Single-character operators
    if ('+-*/<>='.includes(ch)) {
      tokens.push({ type: TT.OPERATOR, value: ch, start: pos });
      pos++;
      continue;
    }

    // Punctuation
    if ('(){},;[]'.includes(ch)) {
      tokens.push({ type: TT.PUNCTUATION, value: ch, start: pos });
      pos++;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) {
        ident += source[pos];
        pos++;
      }
      const type = KEYWORDS.has(ident) ? TT.KEYWORD : TT.IDENTIFIER;
      tokens.push({ type, value: ident, start: pos - ident.length });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${pos}`);
  }

  tokens.push({ type: TT.EOF, value: '', start: pos });
  return tokens;
}

// --- Parser ---

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  advance() {
    return this.tokens[this.pos++];
  }

  expect(type, value) {
    const token = this.advance();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      const got = token.type === TT.EOF ? 'end of input' : `'${token.value}'`;
      const expected = value !== undefined ? `'${value}'` : type;
      throw new Error(`Expected ${expected} but got ${got} at position ${token.start}`);
    }
    return token;
  }

  match(type, value) {
    const token = this.peek();
    if (token.type === type && (value === undefined || token.value === value)) {
      return this.advance();
    }
    return null;
  }

  matchKeyword(value) {
    return this.match(TT.KEYWORD, value);
  }

  matchOperator(value) {
    return this.match(TT.OPERATOR, value);
  }

  // ---- Grammar ----

  // Program → Statement+
  parseProgram() {
    const statements = [];
    while (this.peek().type !== TT.EOF) {
      statements.push(this.parseStatement());
    }
    return { type: 'Program', body: statements };
  }

  // Statement → LetStmt | FnStmt | IfStmt | WhileStmt | Block | ExprStmt
  parseStatement() {
    const token = this.peek();

    if (token.value === 'let') return this.parseLet();
    if (token.value === 'fn') return this.parseFn();
    if (token.value === 'if') return this.parseIf();
    if (token.value === 'while') return this.parseWhile();
    if (token.value === 'do') return this.parseBlock();

    return { type: 'ExprStmt', expr: this.parseExpression() };
  }

  // LetStmt → 'let' IDENT ('=' Expr)? 'in' Expr
  parseLet() {
    this.expectKeyword('let');
    const nameToken = this.expect(TT.IDENTIFIER);
    let value = null;
    if (this.matchOperator('=')) {
      value = this.parseExpression();
    }
    this.expectKeyword('in');
    const body = this.parseExpression();
    return { type: 'Let', name: nameToken.value, value, body };
  }

  // FnStmt → 'fn' IDENT '(' Params? ')' '=' Expr
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

  // IfStmt → 'if' Expr 'then' Expr ('else' Expr)? 'end'
  parseIf() {
    this.expectKeyword('if');
    const condition = this.parseExpression();
    this.expectKeyword('then');
    const thenBranch = this.parseExpression();
    let elseBranch = null;
    if (this.matchKeyword('else')) {
      elseBranch = this.parseExpression();
    }
    this.expectKeyword('end');
    return { type: 'If', condition, then: thenBranch, else: elseBranch };
  }

  // WhileStmt → 'while' Expr 'do' Expr 'end'
  parseWhile() {
    this.expectKeyword('while');
    const condition = this.parseExpression();
    this.expectKeyword('do');
    let body = null;
    if (!(this.peek().type === TT.KEYWORD && this.peek().value === 'end')) {
      body = this.parseExpression();
    }
    this.expectKeyword('end');
    return { type: 'While', condition, body };
  }

  // Block → 'do' Expr* 'end'
  parseBlock() {
    this.expectKeyword('do');
    const statements = [];
    while (this.peek().type !== TT.EOF && this.peek().value !== 'end') {
      statements.push(this.parseExpression());
    }
    this.expectKeyword('end');
    return { type: 'Block', body: statements };
  }

  // Params → IDENT (',' IDENT)*
  parseParamList() {
    const params = [];
    if (this.peek().type === TT.IDENTIFIER) {
      params.push(this.advance().value);
      while (this.matchPunctuation(',')) {
        params.push(this.expect(TT.IDENTIFIER).value);
      }
    }
    return params;
  }

  // ---- Expression parsing (precedence climbing) ----

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.matchKeyword('or')) {
      const right = this.parseAnd();
      left = { type: 'BinOp', op: 'or', left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.matchKeyword('and')) {
      const right = this.parseNot();
      left = { type: 'BinOp', op: 'and', left, right };
    }
    return left;
  }

  parseNot() {
    if (this.matchKeyword('not')) {
      const operand = this.parseNot();
      return { type: 'UnaryOp', op: 'not', operand };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdd();
    while (true) {
      const op = this.peek();
      if (op.type === TT.OPERATOR && ['==', '!=', '<', '>', '<=', '>='].includes(op.value)) {
        this.advance();
        const right = this.parseAdd();
        left = { type: 'BinOp', op: op.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.matchOperator('+') || this.matchOperator('-')) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseMul();
      left = { type: 'BinOp', op, left, right };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.matchOperator('*') || this.matchOperator('/')) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseUnary();
      left = { type: 'BinOp', op, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.matchOperator('-')) {
      const operand = this.parseUnary();
      return { type: 'UnaryOp', op: '-', operand };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();

    // Number literal
    if (token.type === TT.NUMBER) {
      this.advance();
      return { type: 'Number', value: token.value };
    }

    // String literal
    if (token.type === TT.STRING) {
      this.advance();
      return { type: 'String', value: token.value };
    }

    // Boolean literal
    if (token.type === TT.KEYWORD && (token.value === 'true' || token.value === 'false')) {
      this.advance();
      return { type: 'Boolean', value: token.value === 'true' };
    }

    // Parenthesized expression
    if (this.matchPunctuation('(')) {
      const expr = this.parseExpression();
      this.expectPunctuation(')');
      // Check for call: (expr)(args)
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === '(') {
        return { type: 'Call', callee: expr, args: this.parseArgList() };
      }
      return expr;
    }

    // Lambda: (Params?) => Expr
    if (token.value === '(') {
      // We already handled '(' above; check for lambda after ')'
      // This is handled by the paren case above checking for '(' after expr
    }

    // Lambda shorthand: identifier '(' ... ) '=>' — handled by call check

    // Identifier
    if (token.type === TT.IDENTIFIER) {
      this.advance();
      // Check for call
      if (this.peek().type === TT.PUNCTUATION && this.peek().value === '(') {
        return { type: 'Call', callee: { type: 'Identifier', name: token.value }, args: this.parseArgList() };
      }
      return { type: 'Identifier', name: token.value };
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.start}`);
  }

  parseArgList() {
    this.expectPunctuation('(');
    const args = [];
    if (!(this.peek().type === TT.PUNCTUATION && this.peek().value === ')')) {
      args.push(this.parseExpression());
      while (this.matchPunctuation(',')) {
        args.push(this.parseExpression());
      }
    }
    this.expectPunctuation(')');
    return args;
  }

  // ---- Helpers ----

  expectKeyword(value) {
    return this.expect(TT.KEYWORD, value);
  }

  expectPunctuation(value) {
    return this.expect(TT.PUNCTUATION, value);
  }

  expectOperator(value) {
    return this.expect(TT.OPERATOR, value);
  }

  matchKeyword(value) {
    return this.match(TT.KEYWORD, value);
  }

  matchPunctuation(value) {
    return this.match(TT.PUNCTUATION, value);
  }

  matchOperator(value) {
    return this.match(TT.OPERATOR, value);
  }
}

function parse(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  return ast;
}

// --- Evaluator ---

class EvalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvalError';
  }
}

const BUILTINS = {
  print: {
    fn: (args) => {
      const str = args.map((a) => formatValue(a)).join('');
      // We store the printed output in a special key
      return { __printed: str, __value: undefined };
    },
    arity: -1,
  },
};

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  return String(value);
}

function evaluate(ast, env, steps) {
  // Step counter — abort if we exceed the limit
  steps.count++;
  if (steps.count > MAX_STEPS) {
    throw new EvalError('Program did not finish — the evaluation exceeded the maximum step count, which usually means an infinite loop.');
  }

  switch (ast.type) {
    case 'Program': {
      let lastValue = undefined;
      for (const stmt of ast.body) {
        lastValue = evaluate(stmt, env, steps);
      }
      return lastValue;
    }

    case 'ExprStmt':
      return evaluate(ast.expr, env, steps);

    case 'Block': {
      let lastValue = undefined;
      for (const stmt of ast.body) {
        lastValue = evaluate(stmt, env, steps);
      }
      return lastValue;
    }

    case 'Number':
      return ast.value;

    case 'String':
      return ast.value;

    case 'Boolean':
      return ast.value;

    case 'Identifier': {
      if (ast.name in env) return env[ast.name];
      throw new EvalError(`Unknown identifier: ${ast.name}`);
    }

    case 'Let': {
      const value = ast.value ? evaluate(ast.value, env, steps) : undefined;
      const newEnv = { ...env, [ast.name]: value };
      return evaluate(ast.body, newEnv, steps);
    }

    case 'FnDef': {
      const closure = {
        __closure: true,
        params: ast.params,
        body: ast.body,
        env: { ...env },
      };
      const newEnv = { ...env, [ast.name]: closure };
      return evaluate({ type: 'Identifier', name: ast.name }, newEnv, steps);
    }

    case 'Call': {
      const callee = evaluate(ast.callee, env, steps);
      const args = ast.args.map((arg) => evaluate(arg, env, steps));

      // Handle printed values (side-effect capture)
      let printed = '';
      if (callee && callee.__printed !== undefined) {
        printed = callee.__printed;
      }

      if (callee && callee.__closure) {
        if (callee.params.length !== args.length) {
          throw new EvalError(`Function ${describeCallee(ast.callee)} expects ${callee.params.length} arguments but got ${args.length}`);
        }
        const closureEnv = { ...callee.env };
        callee.params.forEach((param, i) => {
          closureEnv[param] = args[i];
        });
        const result = evaluate(callee.body, closureEnv, steps);
        if (result && result.__printed) {
          printed += result.__printed;
        }
        return result && result.__value !== undefined ? result.__value : result;
      }

      // Built-in functions
      const builtin = BUILTINS[callee && callee.__name];
      // Also check if callee is a string that matches a builtin name (for Identifier calls)
      if (!builtin && ast.callee.type === 'Identifier') {
        const name = ast.callee.name;
        if (BUILTINS[name]) {
          const result = BUILTINS[name].fn(args);
          return result;
        }
      }

      throw new EvalError(`${describeCallee(ast.callee)} is not a function`);
    }

    case 'BinOp': {
      const left = evaluate(ast.left, env, steps);
      const right = evaluate(ast.right, env, steps);

      switch (ast.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
          if (right === 0) throw new EvalError('Division by zero');
          return left / right;
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        case 'and': return left && right;
        case 'or': return left || right;
        default: throw new EvalError(`Unknown operator: ${ast.op}`);
      }
    }

    case 'UnaryOp': {
      const operand = evaluate(ast.operand, env, steps);
      switch (ast.op) {
        case '-': return -operand;
        case 'not': return !operand;
        default: throw new EvalError(`Unknown unary operator: ${ast.op}`);
      }
    }

    case 'If': {
      const condition = evaluate(ast.condition, env, steps);
      if (condition) {
        return evaluate(ast.then, env, steps);
      } else if (ast.else) {
        return evaluate(ast.else, env, steps);
      }
      return undefined;
    }

    case 'While': {
      let result = undefined;
      while (evaluate(ast.condition, env, steps)) {
        if (ast.body) {
          result = evaluate(ast.body, env, steps);
        }
      }
      return result;
    }

    default:
      throw new EvalError(`Unknown AST node type: ${ast.type}`);
  }
}

function describeCallee(callee) {
  if (callee.type === 'Identifier') return callee.name;
  return 'expression';
}

// --- Pretty-printer ---

function prettyPrint(value) {
  if (value === null || value === undefined) return '';
  return formatValue(value);
}

// --- Public API ---

/**
 * Run a selfgrow program and return its printed result as a string.
 * Throws a user-facing error message for syntax errors, unknown identifiers,
 * infinite loops, or runtime errors — never a stack trace.
 */
export function run(source) {
  try {
    const ast = parse(source);
    const steps = { count: 0 };
    const result = evaluate(ast, {}, steps);
    return prettyPrint(result);
  } catch (err) {
    if (err instanceof EvalError) {
      throw new Error(err.message);
    }
    throw new Error(err.message || String(err));
  }
}
