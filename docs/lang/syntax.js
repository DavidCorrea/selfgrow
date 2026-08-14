/**
 * Syntax highlighting for the selfgrow language.
 *
 * Uses the tokenizer to produce HTML with CSS classes for each
 * token type. The highlighted output is rendered behind the
 * editor textarea so the user sees colourised code while typing.
 */
import { tokenize, TT } from './tokenize.js';

// Keywords that the language recognises — used for highlighting.
// These are the same keywords that capabilities register via addKeyword.
const KEYWORDS = new Set([
  'let', 'in', 'if', 'then', 'else', 'end',
  'while', 'do', 'function', 'letrec',
  'true', 'false', 'nil',
  'and', 'or', 'not',
]);

/**
 * Highlight selfgrow source code and return an HTML string
 * with span elements carrying CSS classes for each token type.
 * @param {string} source
 * @returns {string} HTML with token spans
 */
export function highlight(source) {
  try {
    const tokens = tokenize(source, KEYWORDS);
    return tokens
      .map((token) => {
        const text = escapeHtml(String(token.value));
        switch (token.type) {
          case TT.KEYWORD:
            return `<span class="tok-keyword">${text}</span>`;
          case TT.STRING:
            return `<span class="tok-string">${text}</span>`;
          case TT.NUMBER:
            return `<span class="tok-number">${text}</span>`;
          case TT.BOOLEAN:
            return `<span class="tok-boolean">${text}</span>`;
          case TT.IDENTIFIER:
            return `<span class="tok-identifier">${text}</span>`;
          case TT.OPERATOR:
            return `<span class="tok-operator">${text}</span>`;
          case TT.PUNCTUATION:
            return `<span class="tok-punctuation">${text}</span>`;
          default:
            return text;
        }
      })
      .join('');
  } catch {
    // If tokenisation fails (e.g. unterminated string), return
    // the raw source escaped so the user still sees their code.
    return escapeHtml(source);
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
