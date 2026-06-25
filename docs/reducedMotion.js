// reducedMotion.js – manages reduced‑motion toggle and global flag
// This script should be loaded early (before other modules) so that other
// scripts can query `window.reducedMotionEnabled`.

(function () {
  const STORAGE_KEY = 'reducedMotion';
  const toggleId = 'reducedMotionToggle';

  // Initialise flag from storage; if not set, respect system prefers-reduced-motion
  let enabled = false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      enabled = stored === 'true';
    } else {
      // No explicit preference saved; use OS setting
      enabled = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  } catch (_) {}
  window.reducedMotionEnabled = enabled;

  // Apply class on the root element for CSS overrides
  function applyClass() {
    if (window.reducedMotionEnabled) {
      document.documentElement.classList.add('reduced-motion');
    } else {
      document.documentElement.classList.remove('reduced-motion');
    }
  }
  // Ensure class is set based on initial state
  applyClass();

  // Update toggle UI when DOM is ready
  function initToggle() {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return; // UI may be missing in some contexts
    toggle.checked = !!window.reducedMotionEnabled;
    toggle.addEventListener('change', (e) => {
      window.reducedMotionEnabled = e.target.checked;
      try { localStorage.setItem(STORAGE_KEY, String(window.reducedMotionEnabled)); } catch (_) {}
      applyClass();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggle);
  } else {
    initToggle();
  }
})();
