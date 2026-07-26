/**
 * selfgrow language runtime core.
 *
 * Exports a single `run(source)` function that parses source text into an
 * AST, evaluates it with a step-based timeout, and returns the program's
 * result as a string.  Throws plain string error messages (never stack
 * traces) for both user and runtime errors.
 */

// ─── Tokenizer ───────────────────────────────────────────────────────

const TT = {
  NUMBER: 'NUMBER',
  IDENT: 'IDENT',
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  SLASH: 'SLASH',
  EQ: 'EQ',
  LET: 'LET',
  IF: 'IF',
  THEN: 'THEN',
  ELSE: 'ELSE',
  DO: 'DO',
  END: 'END',
  WHILE: 'WHILE',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  EOF: 'EOF',
};

function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    // skip whitespace and comments
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // number literal
    if (/\d/.test(ch)) {
      let s = '';
      while (i < source.length && /\d/.test(source[i])) s += source[i++];
      tokens.push({ type: TT.NUMBER, value: Number(s) });
      continue;
    }

    // identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let s = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) s += source[i++];
      const kw = { let: TT.LET, if: TT.IF, then: TT.THEN, else: TT.ELSE, do: TT.DO, end: TT.END, while: TT.WHILE };
      tokens.push({ type: kw[s] || TT.IDENT, value: s });
      continue;
    }

    // operators & punctuation
    switch (ch) {
      case '+': tokens.push({ type: TT.PLUS, value: '+' }); i++; break;
      case '-': tokens.push({ type: TT.MINUS, value: '-' }); i++; break;
      case '*': tokens.push({ type: TT.STAR, value: '*' }); i++; break;
      case '/': tokens.push({ type: TT.SLASH, value: '/' }); i++; break;
      case '=': tokens.push({ type: TT.EQ, value: '=' }); i++; break;
      case '(': tokens.push({ type: TT.LPAREN, value: '(' }); i++; break;
      case ')': tokens.push({ type: TT.RPAREN, value: ')' }); i++; break;
      default: throw `Unexpected character '${ch}'`;
    }
  }

  tokens.push({ type: TT.EOF, value: null });
  return tokens;
}

// ─── Parser (recursive descent) ──────────────────────────────────────

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  expect(type, value) {
    const tok = this.advance();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw `Expected ${value || type}, got '${tok.value}'`;
    }
    return tok;
  }

  parse() {
    const body = [];
    while (this.peek().type !== TT.EOF) {
      body.push(this.parseStatement());
    }
    return { type: 'Program', body };
  }

  parseStatement() {
    switch (this.peek().type) {
      case TT.LET: return this.parseLet();
      case TT.WHILE: return this.parseWhile();
      case TT.DO: return this.parseBlock();
      default: return this.parseExprStatement();
    }
  }

  parseLet() {
    this.advance(); // consume 'let'
    const name = this.expect(TT.IDENT).value;
    this.expect(TT.EQ);
    const value = this.parseExpr();
    if (this.peek().type === TT.IDENT && this.peek().value === 'in') {
      this.advance(); // consume 'in'
      const body = this.parseExpr();
      return { type: 'LetStatement', name, value, body };
    }
    return { type: 'LetStatement', name, value, body: null };
  }

  parseWhile() {
    this.advance(); // consume 'while'
    const condition = this.parseExpr();
    this.expect(TT.DO);
    // allow empty body (while true do end)
    let body;
    if (this.peek().type === TT.END) {
      body = { type: 'NumberLiteral', value: 0 };
    } else {
      body = this.parseExpr();
    }
    this.expect(TT.END);
    return { type: 'WhileStatement', condition, body };
  }

  parseBlock() {
    this.advance(); // consume 'do'
    const stmts = [];
    while (this.peek().type !== TT.EOF && this.peek().type !== TT.END) {
      stmts.push(this.parseStatement());
    }
    this.expect(TT.END);
    return { type: 'BlockStatement', body: stmts };
  }

  parseExprStatement() {
    const expr = this.parseExpr();
    return { type: 'ExprStatement', expression: expr };
  }

  // ── expression precedence (low → high) ──

  parseExpr() { return this.parseAdd(); }

  parseAdd() {
    let left = this.parseMul();
    while (this.peek().type === TT.PLUS || this.peek().type === TT.MINUS) {
      const op = this.advance().value;
      left = { type: 'Binary', operator: op, left, right: this.parseMul() };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.peek().type === TT.STAR || this.peek().type === TT.SLASH) {
      const op = this.advance().value;
      left = { type: 'Binary', operator: op, left, right: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.peek().type === TT.MINUS) {
      this.advance();
      return { type: 'Unary', operator: '-', argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();

    if (tok.type === TT.NUMBER) {
      this.advance();
      return { type: 'NumberLiteral', value: tok.value };
    }

    if (tok.type === TT.IDENT) {
      this.advance();
      return { type: 'Identifier', name: tok.value };
    }

    if (tok.type === TT.LPAREN) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(TT.RPAREN);
      return expr;
    }

    if (tok.type === TT.IF) {
      this.advance(); // 'if'
      const condition = this.parseExpr();
      this.expect(TT.THEN);
      const thenBranch = this.parseExpr();
      this.expect(TT.ELSE);
      const elseBranch = this.parseExpr();
      this.expect(TT.END);
      return { type: 'If', condition, thenBranch, elseBranch };
    }

    throw `Unexpected token '${tok.value}'`;
  }
}

// ─── Evaluator (step-counted) ────────────────────────────────────────

const MAX_STEPS = 10000;

function evaluate(node, env) {
  return evalNode(node, env, { steps: 0 });
}

function evalNode(node, env, ctx) {
  ctx.steps++;
  if (ctx.steps > MAX_STEPS) {
    throw 'program did not finish — step limit exceeded';
  }

  switch (node.type) {
    case 'Program': {
      let result = undefined;
      for (const stmt of node.body) {
        result = evalNode(stmt, env, ctx);
      }
      return result;
    }

    case 'ExprStatement':
      return evalNode(node.expression, env, ctx);

    case 'NumberLiteral':
      return node.value;

    case 'Identifier': {
      if (!(node.name in env)) {
        throw `Unknown identifier: ${node.name}`;
      }
      return env[node.name];
    }

    case 'Binary': {
      const left = evalNode(node.left, env, ctx);
      const right = evalNode(node.right, env, ctx);
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
          if (right === 0) throw 'Division by zero';
          return left / right;
        default:
          throw `Unknown operator: ${node.operator}`;
      }
    }

    case 'Unary': {
      const arg = evalNode(node.argument, env, ctx);
      if (node.operator === '-') return -arg;
      throw `Unknown unary operator: ${node.operator}`;
    }

    case 'If': {
      const cond = evalNode(node.condition, env, ctx);
      return cond
        ? evalNode(node.thenBranch, env, ctx)
        : evalNode(node.elseBranch, env, ctx);
    }

    case 'LetStatement': {
      const value = evalNode(node.value, env, ctx);
      if (!node.body) return value;
      const newEnv = { ...env, [node.name]: value };
      return evalNode(node.body, newEnv, ctx);
    }

    case 'WhileStatement': {
      let result = undefined;
      while (evalNode(node.condition, env, ctx)) {
        result = evalNode(node.body, env, ctx);
      }
      return result;
    }

    case 'BlockStatement': {
      let result = undefined;
      for (const stmt of node.body) {
        result = evalNode(stmt, env, ctx);
      }
      return result;
    }

    default:
      throw `Unknown node type: ${node.type}`;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Run a selfgrow program and return its printed result.
 * Throws a plain string on any error — never an Error stack trace.
 */
export function run(source) {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const env = { true: true, false: false };
  const result = evaluate(ast, env);
  return result === undefined ? '' : String(result);
}
