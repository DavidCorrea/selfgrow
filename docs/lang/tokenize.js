/**
 * Tokenizer for the selfgrow language.
 *
 * Exports the TT token-type constants and the tokenize(source, keywords)
 * function. Both the interpreter and the syntax highlighter import from
 * this module so the tokenizer is defined in exactly one place.
 */
import { ParseError } from './errors.js';

// === Token types ===
export const TT = {
  NUMBER: 'number',
  STRING: 'string',
  BOOLEAN: 'boolean',
  IDENTIFIER: 'identifier',
  KEYWORD: 'keyword',
  OPERATOR: 'operator',
  PUNCTUATION: 'punctuation',
  EOF: 'eof',
};

// ============================================================
// Tokenizer
// ============================================================

/**
 * Tokenize a selfgrow source string.
 * @param {string} source
 * @param {Set<string>} keywords - set of keyword strings recognised by the language
 * @returns {Array<{type: string, value: any, start: number, length: number}>}
 */
export function tokenize(source, keywords) {
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
      const start = pos;
      while (pos < source.length && (/[0-9]/.test(source[pos]) || (source[pos] === '.' && !hasDot && pos + 1 < source.length && /[0-9]/.test(source[pos + 1])))) {
        if (source[pos] === '.') hasDot = true;
        numStr += source[pos];
        pos++;
      }
      if (pos < source.length && /[eE]/.test(source[pos])) {
        numStr += source[pos]; pos++;
        if (pos < source.length && /[+\-]/.test(source[pos])) { numStr += source[pos]; pos++; }
        while (pos < source.length && /[0-9]/.test(source[pos])) { numStr += source[pos]; pos++; }
      }
      tokens.push({ type: TT.NUMBER, value: parseFloat(numStr), start, length: pos - start });
      continue;
    }

    // Double-quoted strings
    if (ch === '"') {
      const start = pos;
      let str = '';
      pos++; // move past opening quote
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
        // Unterminated string: highlight from opening quote to end of input
        const length = pos - start; // pos == source.length
        const loc = getLocationWithLength(source, start, length);
        throw new ParseError('Unterminated string', 'a closing quote', 'end of input', loc);
      }
      pos++; // move past closing quote
      tokens.push({ type: TT.STRING, value: str, start, length: pos - start });
      continue;
    }

    // Multi-character operators
    const twoChar = source.slice(pos, pos + 2);
    const twoCharOps = ['==', '!=', '<=', '>=', '=>', '++', '&&', '||'];
    if (twoCharOps.includes(twoChar)) {
      const start = pos;
      tokens.push({ type: TT.OPERATOR, value: twoChar, start, length: 2 });
      pos += 2;
      continue;
    }

    // Single-character operators
    if ('+-*/<>=!'.includes(ch)) {
      const start = pos;
      tokens.push({ type: TT.OPERATOR, value: ch, start, length: 1 });
      pos++;
      continue;
    }

    // Punctuation
    if ('(){},;[]:#.'.includes(ch)) {
      const start = pos;
      tokens.push({ type: TT.PUNCTUATION, value: ch, start, length: 1 });
      pos++;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      const start = pos;
      while (pos < source.length && /[a-zA-Z0-9_]/.test(source[pos])) { ident += source[pos]; pos++; }
      const type = keywords.has(ident) ? TT.KEYWORD : TT.IDENTIFIER;
      tokens.push({ type, value: ident, start, length: pos - start });
      continue;
    }

    // Unexpected character
    const start = pos;
    const loc = getLocationWithLength(source, start, 1);
    throw new ParseError(`Unexpected character '${ch}'`, 'a valid character', `'${ch}'`, loc);
  }

  tokens.push({ type: TT.EOF, value: '', start: pos, length: 0 });
  return tokens;
}

// ============================================================
// Shared helper (also used by interpreter.js)
// ============================================================

/**
 * Compute line and column for a given character offset in source.
 */
export function getLocation(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column, offset };
}

/**
 * Compute line, column, offset, and length for a given token range in source.
 */
export function getLocationWithLength(source, offset, length) {
  const lines = source.slice(0, offset).split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column, offset, length };
}