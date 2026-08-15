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
 * @returns {Array<{type: string, value: any, start: number}>}
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
    const twoCharOps = ['==', '!=', '<=', '>=', '=>', '++', '&&', '||'];
    if (twoCharOps.includes(twoChar)) { tokens.push({ type: TT.OPERATOR, value: twoChar, start: pos }); pos += 2; continue; }

    // Single-character operators
    if ('+-*/<>=!'.includes(ch)) { tokens.push({ type: TT.OPERATOR, value: ch, start: pos }); pos++; continue; }

    // Punctuation
    if ('(){},;[]:#.'.includes(ch)) { tokens.push({ type: TT.PUNCTUATION, value: ch, start: pos }); pos++; continue; }

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
