// ambientSound.js – manages ambient nature sound playback with UI toggle
// The sound respects the global `window.reducedMotionEnabled` flag and persists the
// user preference in localStorage.

(function () {
  const STORAGE_KEY = 'ambientSound';
  const TOGGLE_ID = 'ambientSoundToggle';

  // Base64‑encoded short ambient loop (wind + birds). Replace with a proper file if desired.
  const AUDIO_DATA_URI =
    'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAABhTEFNRTMuMTAwA8MAAAAAAAAAAAAA//sQxA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wAAACJmaWx0ZXI='; // placeholder minimal mp3

  // Create audio element
  const audio = new Audio(AUDIO_DATA_URI);
  audio.loop = true;
  audio.volume = 0.2; // low volume for calm ambience
  audio.preload = 'auto';

  // Determine initial enabled state
  let enabled = true; // default on
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      enabled = stored === 'true';
    }
  } catch (_) {}

  // Helper to start/stop playback respecting reduced motion
  function updatePlayback() {
    if (enabled && !window.reducedMotionEnabled) {
      audio.play().catch(() => {
        // autoplay may be blocked; user interaction (toggle) will retry.
      });
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  // Initialise UI toggle when DOM is ready
  function initToggle() {
    const toggle = document.getElementById(TOGGLE_ID);
    if (!toggle) return; // UI may be missing in some contexts
    toggle.checked = enabled;
    // Ensure accessibility: use role="switch" and aria-checked reflects state
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(enabled));
    // Disable when reduced motion is enabled
    toggle.disabled = !!window.reducedMotionEnabled;
    toggle.addEventListener('change', (e) => {
      enabled = e.target.checked;
      try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch (_) {}
      // Update ARIA attribute
      toggle.setAttribute('aria-checked', String(enabled));
      updatePlayback();
    });
  }

  // React to reduced‑motion changes (the reducedMotion script mutates the same toggle)
  function hookReducedMotionToggle() {
    const rmToggle = document.getElementById('reducedMotionToggle');
    const ambToggle = document.getElementById(TOGGLE_ID);
    if (!rmToggle) return;
    rmToggle.addEventListener('change', () => {
      // reducedMotionEnabled will be updated by reducedMotion.js before this fires.
      // Disable ambient sound toggle when reduced motion is enabled
      if (ambToggle) {
        const rmEnabled = !!window.reducedMotionEnabled;
        ambToggle.disabled = rmEnabled;
        if (rmEnabled) {
          // Force ambient sound off
          enabled = false;
          ambToggle.checked = false;
          ambToggle.setAttribute('aria-checked', 'false');
          try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch (_) {}
        }
      }
      updatePlayback();
    });
    // Initial sync in case reduced motion is already enabled
    const rmEnabledInit = !!window.reducedMotionEnabled;
    if (ambToggle) {
      ambToggle.disabled = rmEnabledInit;
      if (rmEnabledInit) {
        enabled = false;
        ambToggle.checked = false;
        ambToggle.setAttribute('aria-checked', 'false');
        try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch (_) {}
      }
    }
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initToggle();
      hookReducedMotionToggle();
      updatePlayback();
    });
  } else {
    initToggle();
    hookReducedMotionToggle();
    updatePlayback();
  }
})();
