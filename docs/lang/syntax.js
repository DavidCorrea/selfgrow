/**
 * Syntax highlighting for the selfgrow language.
 *
 * Uses the tokenizer to produce a DOM fragment with CSS classes for each
 * token type. The highlighted output is rendered behind the
 * editor textarea so the user sees colourised code while typing.
 */
import { tokenize, TT } from './tokenize.js';

// Keywords that the language recognises — used for highlighting.
// These are the same keywords that capabilities register via addKeyword.
const KEYWORDS = new Set([
  'let', 'in', 'if', 'then', 'else', 'end',
  'while', 'do', 'fn', 'letrec',
  'true', 'false', 'nil',
  'and', 'or', 'not',
]);

/**
 * Highlight selfgrow source code and return a DOM fragment
 * with spans for tokens and text nodes for whitespace/comments.
 * @param {string} source
 * @returns {DocumentFragment} fragment to insert into the overlay
 */
export function highlight(source) {
  try {
    const tokens = tokenize(source, KEYWORDS);
    const frag = document.createDocumentFragment();
    for (const token of tokens) {
      const node = token.type === TT.WHITESPACE || token.type === TT.COMMENT
        ? document.createTextNode(token.lexeme)
        : document.createElement('span');
      if (token.type !== TT.WHITESPACE && token.type !== TT.COMMENT) {
        switch (token.type) {
          case TT.KEYWORD:
            node.className = 'tok-keyword'; break;
          case TT.STRING:
            node.className = 'tok-string'; break;
          case TT.NUMBER:
            node.className = 'tok-number'; break;
          case TT.BOOLEAN:
            node.className = 'tok-boolean'; break;
          case TT.IDENTIFIER:
            node.className = 'tok-identifier'; break;
          case TT.OPERATOR:
            node.className = 'tok-operator'; break;
          case TT.PUNCTUATION:
            node.className = 'tok-punctuation'; break;
          default:
            // Should not happen
            node.className = '';
        }
        node.textContent = token.lexeme;
      }
      frag.appendChild(node);
    }
    return frag;
  } catch {
    // If tokenisation fails, show the source as plain text
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(source));
    return frag;
  }
}

// Escape HTML — kept for potential other uses, but not used in highlight.
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}