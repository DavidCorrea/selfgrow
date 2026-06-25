// app.js – handles sunrise and sunset lighting overlay
// The lighting cycle follows the same total duration as the weather cycle (60 seconds).
// It respects the user's reduced‑motion preference.

function isReducedMotion() {
  return window.reducedMotionEnabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const prefersReduced = isReducedMotion();
const overlay = document.getElementById('lightOverlay');
if (!overlay) {
  console.error('Light overlay element not found');
}

// Total day length (ms) – matches weather cycle total (4 states * 15000ms)
const DAY_DURATION = 60000; // 60 seconds
const SUNRISE_DURATION = 5000; // 5 seconds transition from night to day
const SUNSET_DURATION = 5000; // 5 seconds transition from day to night

// Color definitions (rgba)
const NIGHT_COLOR = 'rgba(0,0,0,0.4)'; // dark overlay at night
const DAY_COLOR = 'rgba(255,255,255,0)'; // transparent during day
const SUNSET_COLOR = 'rgba(255,140,0,0.3)'; // warm dusk tint

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgbaString(r, g, b, a) {
  return `rgba(${r},${g},${b},${a})`;
}

// Simple linear interpolation between two rgba colors.
function interpolateColor(start, end, t) {
  const s = start.match(/rgba\((\d+),(\d+),(\d+),(\d*\.?\d+)\)/);
  const e = end.match(/rgba\((\d+),(\d+),(\d+),(\d*\.?\d+)\)/);
  if (!s || !e) return end;
  const r = Math.round(lerp(+s[1], +e[1], t));
  const g = Math.round(lerp(+s[2], +e[2], t));
  const b = Math.round(lerp(+s[3], +e[3], t));
  const a = lerp(+s[4], +e[4], t);
  return rgbaString(r, g, b, a);
}

let startTime = null;
let lightingRAF = null;

function updateLighting(timestamp) {
  if (!startTime) startTime = timestamp;
  const elapsed = (timestamp - startTime) % DAY_DURATION;

  let color;
  if (elapsed < SUNRISE_DURATION) {
    // Sunrise: night -> transparent
    const t = elapsed / SUNRISE_DURATION;
    color = interpolateColor(NIGHT_COLOR, DAY_COLOR, t);
  } else if (elapsed < DAY_DURATION - SUNSET_DURATION) {
    // Daytime: fully transparent
    color = DAY_COLOR;
  } else {
    // Sunset phase
    const t = (elapsed - (DAY_DURATION - SUNSET_DURATION)) / SUNSET_DURATION;
    // Transition from transparent to sunset tint, then to night
    if (t < 0.5) {
      // first half: transparent -> sunset tint
      const subT = t * 2; // 0..1
      color = interpolateColor(DAY_COLOR, SUNSET_COLOR, subT);
    } else {
      // second half: sunset tint -> night
      const subT = (t - 0.5) * 2; // 0..1
      color = interpolateColor(SUNSET_COLOR, NIGHT_COLOR, subT);
    }
  }

  overlay.style.backgroundColor = color;

  if (!prefersReduced) {
  // expose control for pause UI
  window.pauseLighting = function() {
    if (lightingRAF) {
      cancelAnimationFrame(lightingRAF);
      lightingRAF = null;
    }
  };
  window.resumeLighting = function() {
    if (!window.isGardenPaused && !lightingRAF) {
      lightingRAF = requestAnimationFrame(updateLighting);
    }
  };

    lightingRAF = requestAnimationFrame(updateLighting);
  }
}

if (overlay && !prefersReduced) {
  // lighting animation started above
} else if (overlay) {
  // Reduced motion – show night overlay instantly
  overlay.style.backgroundColor = NIGHT_COLOR;
}
