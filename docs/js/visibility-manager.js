// ═══════════════════════════════════════════════════════════
// Visibility Manager — Centralized Page Visibility API
// Pauses all timers, intervals, and CSS animations when the
// tab is hidden, eliminating background CPU/GPU/battery drain.
// ═══════════════════════════════════════════════════════════

var isHidden = false;
var managedIntervals = [];
var managedTimeouts = [];
var managedIdCounter = 0;

// ── Visibility State ──

export function isTabHidden() {
  return isHidden;
}

// ── Wrapped setInterval ──
// Returns a handle object with .id and .clear() method.
// When the tab is hidden, the interval is paused automatically
// and resumed when the tab becomes visible again.

export function visibleSetInterval(fn, delay) {
  var handle = { id: ++managedIdCounter, _fn: fn, _delay: delay, _timerId: null, _remaining: null, _lastTick: null };

  function tick() {
    handle._lastTick = Date.now();
    try { fn(); } catch (e) { /* silently ignore */ }
    if (handle._timerId !== null) {
      handle._timerId = setTimeout(tick, handle._delay);
    }
  }

  handle._timerId = setTimeout(tick, delay);
  managedIntervals.push(handle);
  return handle;
}

// ── Wrapped setTimeout ──
// Returns a handle object with .id and .clear() method.
// When the tab is hidden, remaining time is preserved and
// the callback fires when the tab becomes visible (if still
// within a reasonable window) or is skipped if too much time
// has passed.

export function visibleSetTimeout(fn, delay) {
  var handle = { id: ++managedIdCounter, _fn: fn, _delay: delay, _timerId: null, _remaining: delay, _lastTick: null, _isTimeout: true };

  handle._timerId = setTimeout(function () {
    // Remove from managed list
    var idx = managedTimeouts.indexOf(handle);
    if (idx !== -1) managedTimeouts.splice(idx, 1);
    try { fn(); } catch (e) { /* silently ignore */ }
  }, delay);

  managedTimeouts.push(handle);
  return handle;
}

// ── Clear a managed interval ──

export function visibleClearInterval(handle) {
  if (!handle) return;
  if (handle._timerId !== null) {
    clearTimeout(handle._timerId);
    handle._timerId = null;
  }
  var idx = managedIntervals.indexOf(handle);
  if (idx !== -1) managedIntervals.splice(idx, 1);
}

// ── Clear a managed timeout ──

export function visibleClearTimeout(handle) {
  if (!handle) return;
  if (handle._timerId !== null) {
    clearTimeout(handle._timerId);
    handle._timerId = null;
  }
  var idx = managedTimeouts.indexOf(handle);
  if (idx !== -1) managedTimeouts.splice(idx, 1);
}

// ── Pause all managed timers ──

function pauseAll() {
  // Pause intervals
  managedIntervals.forEach(function (handle) {
    if (handle._timerId !== null) {
      clearTimeout(handle._timerId);
      handle._timerId = null;
      if (handle._lastTick) {
        handle._remaining = handle._delay - (Date.now() - handle._lastTick);
      }
    }
  });

  // Pause timeouts — preserve remaining time
  managedTimeouts.forEach(function (handle) {
    if (handle._timerId !== null) {
      clearTimeout(handle._timerId);
      handle._timerId = null;
      if (handle._lastTick) {
        handle._remaining = Math.max(0, handle._remaining - (Date.now() - handle._lastTick));
      }
    }
  });
}

// ── Resume all managed timers ──

function resumeAll() {
  // Resume intervals
  managedIntervals.forEach(function (handle) {
    if (handle._timerId === null) {
      handle._lastTick = Date.now();
      handle._timerId = setTimeout(function tick() {
        handle._lastTick = Date.now();
        try { handle._fn(); } catch (e) { /* silently ignore */ }
        if (handle._timerId !== null) {
          handle._timerId = setTimeout(tick, handle._delay);
        }
      }, handle._delay);
    }
  });

  // Resume timeouts — only if remaining time is reasonable (< 5 min)
  // Otherwise just fire them immediately
  var toRemove = [];
  managedTimeouts.forEach(function (handle) {
    if (handle._timerId === null) {
      var remaining = handle._remaining || 0;
      if (remaining > 300000) {
        // Too much time passed — fire immediately
        toRemove.push(handle);
        try { handle._fn(); } catch (e) { /* silently ignore */ }
      } else {
        handle._timerId = setTimeout(function () {
          var idx = managedTimeouts.indexOf(handle);
          if (idx !== -1) managedTimeouts.splice(idx, 1);
          try { handle._fn(); } catch (e) { /* silently ignore */ }
        }, remaining);
      }
    }
  });
  toRemove.forEach(function (handle) {
    var idx = managedTimeouts.indexOf(handle);
    if (idx !== -1) managedTimeouts.splice(idx, 1);
  });
}

// ── CSS Animation Pause via body class ──

function setAnimationsPaused(paused) {
  if (paused) {
    document.body.classList.add('tab-hidden');
  } else {
    document.body.classList.remove('tab-hidden');
  }
}

// ── Visibility Change Handler ──

function onVisibilityChange() {
  if (document.hidden) {
    isHidden = true;
    setAnimationsPaused(true);
    pauseAll();
  } else {
    isHidden = false;
    setAnimationsPaused(false);
    resumeAll();
  }
}

// ── Initialize ──

export function initVisibilityManager() {
  document.addEventListener('visibilitychange', onVisibilityChange);
}
