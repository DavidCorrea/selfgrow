/**
 * selfgrow — a self-growing functional language runtime
 * Self-contained ES module exposing run(source) for the playground.
 */

// ============================================================================
// Lexer
// ============================================================================

const TokenType = {
  // Literals
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  NIL: 'NIL',
  IDENTIFIER: 'IDENTIFIER',

  // Operators
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  SLASH: 'SLASH',
  PERCENT: 'PERCENT',
  EQ: 'EQ',
  NEQ: 'NEQ',
  LT: 'LT',
  GT: 'GT',
  LTE: 'LTE',
  GTE: 'GTE',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  ASSIGN: 'ASSIGN',
  ARROW: 'ARROW',

  // Delimiters
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  COMMA: 'COMMA',
  SEMICOLON: 'SEMICOLON',
  COLON: 'COLON',

  // Keywords
  LET: 'LET',
  IN: 'IN',
  IF: 'IF',
  THEN: 'THEN',
  ELSE: 'ELSE',
  FN: 'FN',
  REC: 'REC',

  // Special
  EOF: 'EOF',
  NEWLINE: 'NEWLINE',
};

const KEYWORDS = {
  'let': TokenType.LET,
  'in': TokenType.IN,
  'if': TokenType.IF,
  'then': TokenType.THEN,
  'else': TokenType.ELSE,
  'fn': TokenType.FN,
  'rec': TokenType.REC,
  'true': TokenType.TRUE,
  'false': TokenType.FALSE,
  'nil': TokenType.NIL,
  'and': TokenType.AND,
  'or': TokenType.OR,
  'not': TokenType.NOT,
  'in': TokenType.IN,
};

class Token {
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }

  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.column})`;
  }
}

class Lexer {
  constructor(input) {
    this.input = input;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
  }

  peek(offset = 0) {
    const pos = this.pos + offset;
    return pos < this.input.length ? this.input[pos] : '\0';
  }

  advance() {
    const char = this.peek();
    this.pos++;
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  skipWhitespace() {
    while (true) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\r') {
        this.advance();
      } else if (char === '\n') {
        this.advance();
        return TokenType.NEWLINE;
      } else {
        break;
      }
    }
    return null;
  }

  skipComment() {
    if (this.peek() === '/' && this.peek(1) === '/') {
      this.advance(); // /
      this.advance(); // /
      while (this.peek() !== '\n' && this.peek() !== '\0') {
        this.advance();
      }
      return true;
    }
    return false;
  }

  readNumber() {
    let value = '';
    let hasDot = false;
    while (true) {
      const char = this.peek();
      if (char >= '0' && char <= '9') {
        value += this.advance();
      } else if (char === '.' && !hasDot) {
        hasDot = true;
        value += this.advance();
      } else {
        break;
      }
    }
    return parseFloat(value);
  }

  readString() {
    const quote = this.advance(); // consume opening quote
    let value = '';
    while (true) {
      const char = this.peek();
      if (char === '\0' || char === '\n') {
        throw this.error(`Unterminated string`);
      }
      if (char === quote) {
        this.advance(); // consume closing quote
        break;
      }
      if (char === '\\') {
        this.advance();
        const escaped = this.peek();
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          default: value += escaped;
        }
        this.advance();
      } else {
        value += this.advance();
      }
    }
    return value;
  }

  readIdentifier() {
    let value = '';
    while (true) {
      const char = this.peek();
      if ((char >= 'a' && char <= 'z') ||
          (char >= 'A' && char <= 'Z') ||
          (char >= '0' && char <= '9') ||
          char === '_') {
        value += this.advance();
      } else {
        break;
      }
    }
    return value;
  }

  error(message) {
    return new Error(`${message} at line ${this.line}, column ${this.column}`);
  }

  nextToken() {
    while (true) {
      const ws = this.skipWhitespace();
      if (ws === TokenType.NEWLINE) {
        return new Token(TokenType.NEWLINE, '\n', this.line, this.column);
      }
      if (this.skipComment()) continue;
      break;
    }

    const char = this.peek();
    const line = this.line;
    const column = this.column;

    if (char === '\0') {
      return new Token(TokenType.EOF, null, line, column);
    }

    // Numbers
    if (char >= '0' && char <= '9') {
      const value = this.readNumber();
      return new Token(TokenType.NUMBER, value, line, column);
    }

    // Strings
    if (char === '"' || char === "'") {
      const value = this.readString();
      return new Token(TokenType.STRING, value, line, column);
    }

    // Identifiers and keywords
    if ((char >= 'a' && char <= 'z') ||
        (char >= 'A' && char <= 'Z') ||
        char === '_') {
      const value = this.readIdentifier();
      const type = KEYWORDS[value] || TokenType.IDENTIFIER;
      return new Token(type, value, line, column);
    }

    // Two-char operators
    const twoChar = char + this.peek(1);
    const twoCharTokens = {
      '==': TokenType.EQ,
      '!=': TokenType.NEQ,
      '<=': TokenType.LTE,
      '>=': TokenType.GTE,
      '&&': TokenType.AND,
      '||': TokenType.OR,
      '=>': TokenType.ARROW,
    };
    if (twoCharTokens[twoChar]) {
      this.advance();
      this.advance();
      return new Token(twoCharTokens[twoChar], twoChar, line, column);
    }

    // Single-char tokens
    const singleCharTokens = {
      '+': TokenType.PLUS,
      '-': TokenType.MINUS,
      '*': TokenType.STAR,
      '/': TokenType.SLASH,
      '%': TokenType.PERCENT,
      '<': TokenType.LT,
      '>': TokenType.GT,
      '=': TokenType.ASSIGN,
      '!': TokenType.NOT,
      '(': TokenType.LPAREN,
      ')': TokenType.RPAREN,
      '[': TokenType.LBRACKET,
      ']': TokenType.RBRACKET,
      ',': TokenType.COMMA,
      ';': TokenType.SEMICOLON,
      ':': TokenType.COLON,
    };
    if (singleCharTokens[char]) {
      this.advance();
      return new Token(singleCharTokens[char], char, line, column);
    }

    throw this.error(`Unexpected character: '${char}'`);
  }

  tokenize() {
    const tokens = [];
    while (true) {
      const token = this.nextToken();
      tokens.push(token);
      if (token.type === TokenType.EOF) break;
    }
    return tokens;
  }
}

// ============================================================================
// AST Nodes
// ============================================================================

class ASTNode {
  constructor(type, loc = {}) {
    this.type = type;
    this.loc = loc;
  }
}

class NumberLiteral extends ASTNode {
  constructor(value, loc) { super('NumberLiteral', loc); this.value = value; }
}

class StringLiteral extends ASTNode {
  constructor(value, loc) { super('StringLiteral', loc); this.value = value; }
}

class BooleanLiteral extends ASTNode {
  constructor(value, loc) { super('BooleanLiteral', loc); this.value = value; }
}

class NilLiteral extends ASTNode {
  constructor(loc) { super('NilLiteral', loc); }
}

class Identifier extends ASTNode {
  constructor(name, loc) { super('Identifier', loc); this.name = name; }
}

class BinaryExpression extends ASTNode {
  constructor(operator, left, right, loc) {
    super('BinaryExpression', loc);
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

class UnaryExpression extends ASTNode {
  constructor(operator, argument, loc) {
    super('UnaryExpression', loc);
    this.operator = operator;
    this.argument = argument;
  }
}

class CallExpression extends ASTNode {
  constructor(callee, args, loc) {
    super('CallExpression', loc);
    this.callee = callee;
    this.arguments = args;
  }
}

class ListExpression extends ASTNode {
  constructor(elements, loc) {
    super('ListExpression', loc);
    this.elements = elements;
  }
}

class FunctionExpression extends ASTNode {
  constructor(params, body, isRecursive, name, loc) {
    super('FunctionExpression', loc);
    this.params = params;
    this.body = body;
    this.isRecursive = isRecursive;
    this.name = name;
  }
}

class LetExpression extends ASTNode {
  constructor(bindings, body, loc) {
    super('LetExpression', loc);
    this.bindings = bindings; // [{ name, value }]
    this.body = body;
  }
}

class IfExpression extends ASTNode {
  constructor(test, consequent, alternate, loc) {
    super('IfExpression', loc);
    this.test = test;
    this.consequent = consequent;
    this.alternate = alternate;
  }
}

class Program extends ASTNode {
  constructor(body, loc) {
    super('Program', loc);
    this.body = body;
  }
}

// ============================================================================
// Parser (Recursive Descent)
// ============================================================================

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
  }

  advance() {
    return this.tokens[this.pos++];
  }

  match(...types) {
    if (types.includes(this.peek().type)) {
      return this.advance();
    }
    return null;
  }

  expect(type) {
    const token = this.peek();
    if (token.type === type) {
      return this.advance();
    }
    throw new Error(`Expected ${type} but got ${token.type} at ${token.line}:${token.column}`);
  }

  expectOptional(type) {
    if (this.peek().type === type) {
      return this.advance();
    }
    return null;
  }

  error(message) {
    const token = this.peek();
    return new Error(`${message} at line ${token.line}, column ${token.column}`);
  }

  // Precedence levels (lowest to highest)
  // 1. Assignment (lowest)
  // 2. Logical OR
  // 3. Logical AND
  // 4. Equality
  // 5. Comparison
  // 6. Additive
  // 7. Multiplicative
  // 8. Unary
  // 9. Call / Member / Primary (highest)

  parse() {
    const body = [];
    while (this.peek().type !== TokenType.EOF) {
      if (this.peek().type === TokenType.NEWLINE) {
        this.advance();
        continue;
      }
      body.push(this.parseExpression(1));
      this.expectOptional(TokenType.SEMICOLON);
      this.expectOptional(TokenType.NEWLINE);
    }
    return new Program(body, { start: body[0]?.loc?.start, end: this.peek().loc });
  }

  parseExpression(precedence = 1) {
    let left = this.parseUnary();

    while (true) {
      const token = this.peek();
      const opPrecedence = this.getBinaryPrecedence(token.type);
      if (opPrecedence < precedence) break;

      const operator = this.advance().type;
      const nextPrecedence = opPrecedence + 1;
      const right = this.parseExpression(nextPrecedence);
      left = new BinaryExpression(operator, left, right, left.loc);
    }

    return left;
  }

  getBinaryPrecedence(type) {
    switch (type) {
      case TokenType.OR: return 2;
      case TokenType.AND: return 3;
      case TokenType.EQ: case TokenType.NEQ: return 4;
      case TokenType.LT: case TokenType.GT: case TokenType.LTE: case TokenType.GTE: return 5;
      case TokenType.PLUS: case TokenType.MINUS: return 6;
      case TokenType.STAR: case TokenType.SLASH: case TokenType.PERCENT: return 7;
      default: return 0;
    }
  }

  parseUnary() {
    const token = this.peek();
    if (token.type === TokenType.NOT || token.type === TokenType.MINUS) {
      const operator = this.advance().type;
      const argument = this.parseUnary();
      return new UnaryExpression(operator, argument, token.loc);
    }
    return this.parseCall();
  }

  parseCall() {
    let expr = this.parsePrimary();

    while (true) {
      if (this.peek().type === TokenType.LPAREN) {
        this.advance(); // (
        const args = [];
        if (this.peek().type !== TokenType.RPAREN) {
          args.push(this.parseExpression(1));
          while (this.match(TokenType.COMMA)) {
            args.push(this.parseExpression(1));
          }
        }
        this.expect(TokenType.RPAREN);
        expr = new CallExpression(expr, args, expr.loc);
      } else {
        break;
      }
    }

    return expr;
  }

  parsePrimary() {
    const token = this.peek();

    // Literals
    if (token.type === TokenType.NUMBER) {
      this.advance();
      return new NumberLiteral(token.value, token.loc);
    }
    if (token.type === TokenType.STRING) {
      this.advance();
      return new StringLiteral(token.value, token.loc);
    }
    if (token.type === TokenType.TRUE) {
      this.advance();
      return new BooleanLiteral(true, token.loc);
    }
    if (token.type === TokenType.FALSE) {
      this.advance();
      return new BooleanLiteral(false, token.loc);
    }
    if (token.type === TokenType.NIL) {
      this.advance();
      return new NilLiteral(token.loc);
    }

    // Identifier
    if (token.type === TokenType.IDENTIFIER) {
      this.advance();
      return new Identifier(token.value, token.loc);
    }

    // Parenthesized expression
    if (token.type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseExpression(1);
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // List literal
    if (token.type === TokenType.LBRACKET) {
      return this.parseList();
    }

    // Function expression: fn (params) => body  OR  rec fn (params) => body
    if (token.type === TokenType.FN || token.type === TokenType.REC) {
      return this.parseFunction();
    }

    // Let expression: let x = val in body
    if (token.type === TokenType.LET) {
      return this.parseLet();
    }

    // If expression: if test then consequent else alternate
    if (token.type === TokenType.IF) {
      return this.parseIf();
    }

    throw this.error(`Unexpected token: ${token.type}`);
  }

  parseList() {
    const startToken = this.expect(TokenType.LBRACKET);
    const elements = [];
    if (this.peek().type !== TokenType.RBRACKET) {
      elements.push(this.parseExpression(1));
      while (this.match(TokenType.COMMA)) {
        elements.push(this.parseExpression(1));
      }
    }
    this.expect(TokenType.RBRACKET);
    return new ListExpression(elements, startToken.loc);
  }

  parseFunction() {
    const startToken = this.advance(); // fn or rec
    const isRecursive = startToken.type === TokenType.REC;

    // Optional name for recursive functions
    let name = null;
    if (this.peek().type === TokenType.IDENTIFIER && isRecursive) {
      name = this.advance().value;
    }

    this.expect(TokenType.LPAREN);
    const params = [];
    if (this.peek().type !== TokenType.RPAREN) {
      params.push(this.expect(TokenType.IDENTIFIER).value);
      while (this.match(TokenType.COMMA)) {
        params.push(this.expect(TokenType.IDENTIFIER).value);
      }
    }
    this.expect(TokenType.RPAREN);
    this.expect(TokenType.ARROW);
    const body = this.parseExpression(1);

    return new FunctionExpression(params, body, isRecursive, name, startToken.loc);
  }

  parseLet() {
    const startToken = this.expect(TokenType.LET);
    const bindings = [];

    // Parse bindings: let x = 1, y = 2 in body
    while (true) {
      const name = this.expect(TokenType.IDENTIFIER).value;
      this.expect(TokenType.ASSIGN);
      const value = this.parseExpression(1);
      bindings.push({ name, value });

      if (!this.match(TokenType.COMMA)) break;
    }

    this.expect(TokenType.IN);
    const body = this.parseExpression(1);

    return new LetExpression(bindings, body, startToken.loc);
  }

  parseIf() {
    const startToken = this.expect(TokenType.IF);
    const test = this.parseExpression(1);
    this.expect(TokenType.THEN);
    const consequent = this.parseExpression(1);
    this.expect(TokenType.ELSE);
    const alternate = this.parseExpression(1);
    return new IfExpression(test, consequent, alternate, startToken.loc);
  }
}

// ============================================================================
// Evaluator / Runtime
// ============================================================================

class Environment {
  constructor(parent = null) {
    this.bindings = new Map();
    this.parent = parent;
  }

  define(name, value) {
    this.bindings.set(name, value);
  }

  lookup(name) {
    if (this.bindings.has(name)) {
      return this.bindings.get(name);
    }
    if (this.parent) {
      return this.parent.lookup(name);
    }
    throw new Error(`Undefined variable: ${name}`);
  }

  assign(name, value) {
    if (this.bindings.has(name)) {
      this.bindings.set(name, value);
      return;
    }
    if (this.parent) {
      this.parent.assign(name, value);
      return;
    }
    throw new Error(`Undefined variable: ${name}`);
  }
}

class Closure {
  constructor(params, body, env, isRecursive = false, name = null) {
    this.params = params;
    this.body = body;
    this.env = env;
    this.isRecursive = isRecursive;
    this.name = name;
  }

  call(args, evaluator) {
    if (args.length !== this.params.length) {
      throw new Error(`Expected ${this.params.length} arguments, got ${args.length}`);
    }
    const callEnv = new Environment(this.env);
    for (let i = 0; i < this.params.length; i++) {
      callEnv.define(this.params[i], args[i]);
    }
    // For recursive functions, bind the function to its own name in its closure
    if (this.isRecursive && this.name) {
      callEnv.define(this.name, this);
    }
    return evaluator.evaluate(this.body, callEnv);
  }
}

class BuiltinFunction {
  constructor(name, fn, arity = -1) {
    this.name = name;
    this.fn = fn;
    this.arity = arity; // -1 = variadic
  }

  call(args, evaluator) {
    if (this.arity >= 0 && args.length !== this.arity) {
      throw new Error(`${this.name} expects ${this.arity} arguments, got ${args.length}`);
    }
    return this.fn(args, evaluator);
  }
}

class List {
  constructor(elements) {
    this.elements = elements;
  }

  static fromArray(arr) {
    return new List(arr);
  }

  toArray() {
    return this.elements;
  }

  toString() {
    return `[${this.elements.map(e => valueToString(e)).join(', ')}]`;
  }
}

function valueToString(val) {
  if (val === null || val === undefined) return 'nil';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return `"${val}"`;
  if (val instanceof List) return val.toString();
  if (val instanceof Closure) return `<fn ${val.name || ''}>`;
  if (val instanceof BuiltinFunction) return `<builtin ${val.name}>`;
  return String(val);
}

function valueToBool(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return val.length > 0;
  if (val instanceof List) return val.elements.length > 0;
  if (val instanceof Closure) return true;
  if (val instanceof BuiltinFunction) return true;
  return true;
}

function valueEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    if (a instanceof List && b instanceof List) {
      if (a.elements.length !== b.elements.length) return false;
      return a.elements.every((v, i) => valueEqual(v, b.elements[i]));
    }
    if (a instanceof Closure && b instanceof Closure) {
      return a === b; // reference equality for closures
    }
  }
  return false;
}

class Evaluator {
  constructor() {
    this.globalEnv = this.createGlobalEnvironment();
    this.capabilities = this.createCapabilities();
    this.startTime = 0;
    this.timeout = 5000; // 5 second timeout
    this.callDepth = 0;
    this.maxCallDepth = 500; // well below JS stack limit
  }

  checkTimeout() {
    if (Date.now() - this.startTime > this.timeout) {
      throw new Error('Execution timeout — program did not finish');
    }
  }

  checkDepth() {
    this.callDepth++;
    if (this.callDepth > this.maxCallDepth) {
      throw new Error('Execution timeout — program did not finish');
    }
  }

  releaseDepth() {
    this.callDepth--;
  }

  createGlobalEnvironment() {
    const env = new Environment();
    // Built-in functions
    this.registerBuiltins(env);
    return env;
  }

  registerBuiltins(env) {
    const builtins = [
      // Arithmetic
      ['+', (args) => args.reduce((a, b) => this.toNumber(a) + this.toNumber(b)), -1],
      ['-', (args) => {
        if (args.length === 1) return -this.toNumber(args[0]);
        return args.reduce((a, b) => this.toNumber(a) - this.toNumber(b));
      }, -1],
      ['*', (args) => args.reduce((a, b) => this.toNumber(a) * this.toNumber(b), 1), -1],
      ['/', (args) => args.reduce((a, b) => this.toNumber(a) / this.toNumber(b)), -1],
      ['%', (args) => this.toNumber(args[0]) % this.toNumber(args[1]), 2],

      // Comparison
      ['==', (args) => valueEqual(args[0], args[1]), 2],
      ['!=', (args) => !valueEqual(args[0], args[1]), 2],
      ['<', (args) => this.toNumber(args[0]) < this.toNumber(args[1]), 2],
      ['>', (args) => this.toNumber(args[0]) > this.toNumber(args[1]), 2],
      ['<=', (args) => this.toNumber(args[0]) <= this.toNumber(args[1]), 2],
      ['>=', (args) => this.toNumber(args[0]) >= this.toNumber(args[1]), 2],

      // Logic
      ['and', (args) => args.every(a => valueToBool(a)), -1],
      ['or', (args) => args.some(a => valueToBool(a)), -1],
      ['not', (args) => !valueToBool(args[0]), 1],

      // Lists
      ['list', (args) => new List(args), -1],
      ['head', (args) => {
        const list = this.toList(args[0]);
        if (list.elements.length === 0) throw new Error('head of empty list');
        return list.elements[0];
      }, 1],
      ['tail', (args) => {
        const list = this.toList(args[0]);
        if (list.elements.length === 0) throw new Error('tail of empty list');
        return new List(list.elements.slice(1));
      }, 1],
      ['cons', (args) => {
        const head = args[0];
        const tail = this.toList(args[1]);
        return new List([head, ...tail.elements]);
      }, 2],
      ['length', (args) => this.toList(args[0]).elements.length, 1],
      ['map', (args) => {
        const fn = this.toFunction(args[0]);
        const list = this.toList(args[1]);
        return new List(list.elements.map(x => fn.call([x], this)));
      }, 2],
      ['filter', (args) => {
        const fn = this.toFunction(args[0]);
        const list = this.toList(args[1]);
        return new List(list.elements.filter(x => valueToBool(fn.call([x], this))));
      }, 2],
      ['reduce', (args) => {
        const fn = this.toFunction(args[0]);
        const initial = args[1];
        const list = this.toList(args[2]);
        return list.elements.reduce((acc, x) => fn.call([acc, x], this), initial);
      }, -1],

      // Type checks
      ['isNumber', (args) => typeof args[0] === 'number', 1],
      ['isString', (args) => typeof args[0] === 'string', 1],
      ['isBoolean', (args) => typeof args[0] === 'boolean', 1],
      ['isList', (args) => args[0] instanceof List, 1],
      ['isFunction', (args) => args[0] instanceof Closure || args[0] instanceof BuiltinFunction, 1],
      ['isNil', (args) => args[0] === null || args[0] === undefined, 1],

      // I/O
      ['print', (args) => {
        console.log(...args.map(valueToString));
        return null;
      }, -1],

      // Error
      ['error', (args) => { throw new Error(valueToString(args[0])); }, 1],
    ];

    for (const [name, fn, arity] of builtins) {
      env.define(name, new BuiltinFunction(name, fn.bind(this), arity));
    }
  }

  toNumber(val) {
    if (typeof val === 'number') return val;
    throw new Error(`Expected number, got ${valueToString(val)}`);
  }

  toList(val) {
    if (val instanceof List) return val;
    throw new Error(`Expected list, got ${valueToString(val)}`);
  }

  toFunction(val) {
    if (val instanceof Closure || val instanceof BuiltinFunction) return val;
    throw new Error(`Expected function, got ${valueToString(val)}`);
  }

  createCapabilities() {
    const caps = new Map();
    // Arithmetic
    this.addCap(caps, 'Arithmetic', '+, -, *, /, %', 'Arithmetic operations on numbers',
      ['1 + 2 => 3', '10 - 3 => 7', '6 * 7 => 42', '20 / 4 => 5', '17 % 5 => 2']);
    this.addCap(caps, 'Comparison', '==, !=, <, >, <=, >=', 'Comparison operations',
      ['1 < 2 => true', '5 == 5 => true', '3 != 4 => true']);
    this.addCap(caps, 'Logic', 'and, or, not', 'Logical operations',
      ['true and false => false', 'true or false => true', 'not true => false']);
    this.addCap(caps, 'Lists', 'list, head, tail, cons, length, map, filter, reduce', 'List operations',
      ['list(1, 2, 3) => [1, 2, 3]', 'head([1, 2, 3]) => 1', 'tail([1, 2, 3]) => [2, 3]',
       'cons(0, [1, 2]) => [0, 1, 2]', 'length([1, 2, 3]) => 3',
       'map((x) => x * 2, [1, 2, 3]) => [2, 4, 6]',
       'filter((x) => x > 2, [1, 2, 3]) => [3]',
       'reduce((a, b) => a + b, 0, [1, 2, 3]) => 6']);
    this.addCap(caps, 'Functions', 'fn (params) => body, rec name (params) => body', 'Function definitions',
      ['fn (x) => x + 1 => <fn>', '(fn (x) => x * 2)(5) => 10',
       'rec fact (n) => if n == 0 then 1 else n * fact(n - 1) => <fn>', 'fact(5) => 120']);
    this.addCap(caps, 'Let Bindings', 'let x = 1, y = 2 in x + y', 'Local bindings',
      ['let x = 10 in x * 2 => 20', 'let x = 1, y = 2 in x + y => 3']);
    this.addCap(caps, 'Conditionals', 'if test then consequent else alternate', 'Conditional expressions',
      ['if true then 1 else 2 => 1', 'if 1 < 2 then "yes" else "no" => "yes"']);
    this.addCap(caps, 'Variables', 'x, myVar, etc.', 'Variable references',
      ['let x = 42 in x => 42']);
    this.addCap(caps, 'Literals', 'Numbers, strings, booleans, nil, lists', 'Literal values',
      ['42', '3.14', '"hello"', 'true', 'false', 'nil', '[1, 2, 3]']);
    this.addCap(caps, 'Type Checks', 'isNumber, isString, isBoolean, isList, isFunction, isNil', 'Type predicates',
      ['isNumber(42) => true', 'isList([1, 2]) => true', 'isFunction(fn (x) => x) => true']);
    this.addCap(caps, 'I/O', 'print', 'Side-effecting output',
      ['print("hello") => prints "hello"']);
    this.addCap(caps, 'Error Handling', 'error', 'Throw runtime errors',
      ['error("oops") => throws error']);
    return caps;
  }

  addCap(caps, name, syntax, summary, examples) {
    caps.set(name, { name, syntax, summary, examples });
  }

  evaluate(node, env = this.globalEnv) {
    this.checkTimeout();
    this.checkDepth();
    try {
      switch (node.type) {
      case 'Program':
        let result = null;
        for (const stmt of node.body) {
          result = this.evaluate(stmt, env);
        }
        return result;

      case 'NumberLiteral':
        return node.value;

      case 'StringLiteral':
        return node.value;

      case 'BooleanLiteral':
        return node.value;

      case 'NilLiteral':
        return null;

      case 'Identifier':
        return env.lookup(node.name);

      case 'BinaryExpression':
        return this.evalBinary(node, env);

      case 'UnaryExpression':
        return this.evalUnary(node, env);

      case 'CallExpression': {
        const callee = this.evaluate(node.callee, env);
        const args = node.arguments.map(arg => this.evaluate(arg, env));
        if (!(callee instanceof Closure || callee instanceof BuiltinFunction)) {
          throw new Error(`Not callable: ${valueToString(callee)}`);
        }
        return callee.call(args, this);
      }

      case 'ListExpression': {
        const elements = node.elements.map(e => this.evaluate(e, env));
        return new List(elements);
      }

      case 'FunctionExpression': {
        return new Closure(node.params, node.body, env, node.isRecursive, node.name);
      }

      case 'LetExpression': {
        const letEnv = new Environment(env);
        for (const { name, value } of node.bindings) {
          letEnv.define(name, this.evaluate(value, env));
        }
        return this.evaluate(node.body, letEnv);
      }

      case 'IfExpression': {
        const test = this.evaluate(node.test, env);
        if (valueToBool(test)) {
          return this.evaluate(node.consequent, env);
        } else {
          return this.evaluate(node.alternate, env);
        }
      }

      default:
        throw new Error(`Unknown AST node: ${node.type}`);
    }
    } finally {
      this.releaseDepth();
    }
  }

  evalBinary(node, env) {
    const left = this.evaluate(node.left, env);
    const right = this.evaluate(node.right, env);
    const op = node.operator;

    // Handle logical operators with short-circuit evaluation
    if (op === TokenType.AND) {
      return valueToBool(left) ? right : left;
    }
    if (op === TokenType.OR) {
      return valueToBool(left) ? left : right;
    }

    // Arithmetic
    if (op === TokenType.PLUS) {
      // Support string concatenation
      if (typeof left === 'string' || typeof right === 'string') {
        const l = typeof left === 'string' ? left : valueToString(left);
        const r = typeof right === 'string' ? right : valueToString(right);
        return l + r;
      }
      return this.toNumber(left) + this.toNumber(right);
    }
    if (op === TokenType.MINUS) return this.toNumber(left) - this.toNumber(right);
    if (op === TokenType.STAR) return this.toNumber(left) * this.toNumber(right);
    if (op === TokenType.SLASH) return this.toNumber(left) / this.toNumber(right);
    if (op === TokenType.PERCENT) return this.toNumber(left) % this.toNumber(right);

    // Comparison
    if (op === TokenType.EQ) return valueEqual(left, right);
    if (op === TokenType.NEQ) return !valueEqual(left, right);
    if (op === TokenType.LT) return this.toNumber(left) < this.toNumber(right);
    if (op === TokenType.GT) return this.toNumber(left) > this.toNumber(right);
    if (op === TokenType.LTE) return this.toNumber(left) <= this.toNumber(right);
    if (op === TokenType.GTE) return this.toNumber(left) >= this.toNumber(right);

    throw new Error(`Unknown binary operator: ${op}`);
  }

  evalUnary(node, env) {
    const arg = this.evaluate(node.argument, env);
    const op = node.operator;
    if (op === TokenType.NOT) return !valueToBool(arg);
    if (op === TokenType.MINUS) return -this.toNumber(arg);
    throw new Error(`Unknown unary operator: ${op}`);
  }

  eval(source) {
    this.startTime = Date.now();
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return this.evaluate(ast);
  }

  // Capability registry for the playground reference
  getCapabilities() {
    return Array.from(this.capabilities.values());
  }

  // Expose the evaluator instance for capability registration at runtime
  static create() {
    return new Evaluator();
  }
}

// ============================================================================
// Public API
// ============================================================================

// Create a singleton evaluator instance
const evaluator = Evaluator.create();

/**
 * Evaluate a selfgrow source string and return the result.
 * @param {string} source - The selfgrow source code
 * @returns {*} The evaluation result
 */
export function evalSource(source) {
  return evaluator.eval(source);
}

/**
 * Run a selfgrow source string and return a string representation of the result.
 * This is the function exposed to the playground.
 * @param {string} source - The selfgrow source code
 * @returns {string} String representation of the result
 */
export function run(source) {
  try {
    const result = evalSource(source);
    if (result === null || result === undefined) {
      return '';
    }
    return valueToString(result);
  } catch (err) {
    // Convert native stack overflow to our timeout error
    if (err instanceof RangeError && err.message.includes('call stack')) {
      throw new Error('Execution timeout — program did not finish');
    }
    throw err;
  }
}

/**
 * Get the capability registry for the playground reference documentation.
 * @returns {Array} Array of capability objects
 */
export function getCapabilities() {
  return evaluator.getCapabilities();
}

// Export for debugging / testing
export { Lexer, Parser, Evaluator, Environment, Closure, List, BuiltinFunction, TokenType };
