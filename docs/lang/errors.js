/**
 * Structured error hierarchy for the selfgrow language.
 * Errors carry message, expected/found, and location (line, column, offset)
 * so the playground can render helpful, context-aware error messages.
 */

export class SelfgrowError extends Error {
  constructor(message, expected, found, location, length) {
    super(message);
    this.name = 'SelfgrowError';
    this.expected = expected ?? null;
    this.found = found ?? null;
    this.location = location ?? null;
    this.length = length ?? undefined;
  }
}

export class ParseError extends SelfgrowError {
  constructor(message, expected, found, location, length) {
    super(message, expected, found, location, length);
    this.name = 'ParseError';
  }
}

export class TypeError extends SelfgrowError {
  constructor(message, expected, found, location, length) {
    super(message, expected, found, location, length);
    this.name = 'TypeError';
  }
}

export class RuntimeError extends SelfgrowError {
  constructor(message, expected, found, location, length) {
    super(message, expected, found, location, length);
    this.name = 'RuntimeError';
  }
}

export class TimeoutError extends SelfgrowError {
  constructor(message, expected, found, location, length) {
    super(message, expected, found, location, length);
    this.name = 'TimeoutError';
  }
}
