/**
 * motion.js — shared prefers-reduced-motion detection
 *
 * A single module that owns one MediaQueryList and one internal 'change'
 * listener for the page-level prefers-reduced-motion preference. Other
 * modules import from here instead of creating their own listeners.
 *
 * The MediaQueryList is NOT eager-initialised at module load time —
 * instead, both isReducedMotion() and onMotionChange() call
 * window.matchMedia() fresh when first needed. This allows tests
 * that mock window.matchMedia to work correctly (e.g. selftest.js
 * creates a creature with a mocked prefers-reduced-motion setting).
 *
 * Exports:
 *   isReducedMotion()       — synchronous boolean for current preference
 *   onMotionChange(callback) — registers a callback fired on preference
 *                              changes; returns an unsubscribe function
 */

/** Internal list of registered callbacks. */
const _callbacks = [];

/** The cached MediaQueryList, created on first use. */
let _mediaQuery = null;

/** Whether we have already attached the shared 'change' listener. */
let _initialised = false;

/**
 * Synchronously check the current reduced-motion preference.
 *
 * Always re-queries window.matchMedia() so that tests mocking
 * matchMedia can produce a controlled result.
 *
 * @returns {boolean} true if the user prefers reduced motion
 */
export function isReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Register a callback that fires when the reduced-motion preference changes.
 *
 * The callback receives one argument: the new matches boolean.
 * Lazily creates the shared MediaQueryList on first registration.
 *
 * @param {(matches: boolean) => void} callback
 * @returns {() => void} unsubscribe function — call to remove this callback
 */
export function onMotionChange(callback) {
  if (!_initialised) {
    _mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    _mediaQuery.addEventListener('change', _onMediaChange);
    _initialised = true;
  }

  _callbacks.push(callback);

  return function unsubscribe() {
    const idx = _callbacks.indexOf(callback);
    if (idx !== -1) {
      _callbacks.splice(idx, 1);

      // Clean up the shared listener when no callbacks remain
      if (_callbacks.length === 0 && _initialised) {
        _mediaQuery.removeEventListener('change', _onMediaChange);
        _initialised = false;
        _mediaQuery = null;
      }
    }
  };
}

/** Internal handler — notifies all registered callbacks. */
function _onMediaChange(e) {
  const matches = e.matches;
  for (let i = 0; i < _callbacks.length; i++) {
    _callbacks[i](matches);
  }
}