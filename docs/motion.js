/**
 * motion.js — shared prefers-reduced-motion detection
 *
 * Owns a single MediaQueryList for (prefers-reduced-motion: reduce) and
 * manages a set of callbacks. Lazily initialises on first use so that
 * test environments that mock window.matchMedia still work correctly.
 *
 * Exports:
 *   isReducedMotion()   — synchronous boolean check of current preference
 *   onMotionChange(cb)  — register a callback called when the preference
 *                          changes; returns an unsubscribe function
 *
 * Internal lifecycle:
 *   - isReducedMotion() always queries window.matchMedia; the browser
 *     returns the canonical MediaQueryList for the same query string,
 *     so there is still effectively one MQL per page.
 *   - The 'change' listener's MQL is created when the first callback
 *     is registered via onMotionChange().
 *   - The 'change' listener is removed when the last callback is
 *     unsubscribed.
 */

/** @type {MediaQueryList|null} */
let _mql = null;

/** @type {Set<Function>} */
let _callbacks = null;

/** @type {boolean} */
let _hasListener = false;

/**
 * Handle the native 'change' event — notify all registered callbacks.
 */
function _onChange(e) {
  if (!_callbacks) return;
  for (const cb of _callbacks) {
    try {
      cb(e.matches);
    } catch (_) {
      // A single failing callback should not break the whole chain
    }
  }
}

/**
 * Return the current state of prefers-reduced-motion.
 *
 * Always queries window.matchMedia so that test mocks are respected.
 * The browser returns a canonical MediaQueryList for the same query
 * string, so there is no unnecessary object churn.
 *
 * @returns {boolean}
 */
export function isReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Register a callback to be called when the user's reduced-motion preference
 * changes. The callback receives a single boolean argument: `true` if the
 * user now prefers reduced motion, `false` otherwise.
 *
 * It is NOT called immediately — read the initial value via isReducedMotion()
 * when setting up, and use this callback for runtime updates only. This keeps
 * the module testable under a mocked window.matchMedia.
 *
 * @param {(matches: boolean) => void} callback
 * @returns {() => void} — call to unsubscribe
 */
export function onMotionChange(callback) {
  // Initialise the callback set lazily
  if (!_callbacks) {
    _callbacks = new Set();
  }

  _callbacks.add(callback);

  // Create the single shared MQL and add the native listener
  // when the first callback registers
  if (!_hasListener) {
    _mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    _mql.addEventListener('change', _onChange);
    _hasListener = true;
  }

  // Return an unsubscribe function
  return function unsubscribe() {
    if (!_callbacks) return;
    _callbacks.delete(callback);

    // Remove the native listener when no callbacks remain
    if (_hasListener && _callbacks.size === 0) {
      _mql.removeEventListener('change', _onChange);
      _hasListener = false;
    }
  };
}