// ── Garden Sleep Mode (night cycles) ──
// Dim overlay + slower growth (global factor) + optional twinkling stars.

import { isNightTheme } from './theme.js';
import { visibleSetInterval } from './visibility-manager.js';

// Global factor used by tiles.weatherScaled to slow growth timers.
// Initialized to 1 (normal speed). When sleep mode active, set to 0.5.
if (typeof window !== 'undefined') {
  window.__gardenSleepFactor = 1;
}

let canvas = null;
let animationId = null;
let stars = [];
let reducedMotion = false;

function createCanvas() {
  canvas = document.createElement('canvas');
  canvas.id = 'nightStarsCanvas';
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '6';
  document.body.appendChild(canvas);
  resizeCanvas();
  initStars();
  drawStars();
  if (!reducedMotion) {
    animate();
  }
}

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initStars() {
  const count = Math.max(100, Math.floor((canvas.width * canvas.height) / 5000));
  stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 1.2 + 0.3,
      twinkleSpeed: Math.random() * 0.02 + 0.01,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function drawStars() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  for (const star of stars) {
    const opacity = reducedMotion ? 0.8 : 0.5 + 0.5 * Math.sin(star.phase);
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
    if (!reducedMotion) {
      star.phase += star.twinkleSpeed;
    }
  }
  ctx.globalAlpha = 1;
}

function animate() {
  drawStars();
  animationId = requestAnimationFrame(animate);
}

function removeCanvas() {
  if (animationId) cancelAnimationFrame(animationId);
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  canvas = null;
  animationId = null;
  stars = [];
}

function enableSleepMode() {
  document.body.classList.add('night-sleep');
  window.__gardenSleepFactor = 0.5;
  // Ensure overlay exists
  createOverlay();
  // Only create canvas if not already present
  if (!canvas) createCanvas();
}

function createOverlay() {
  if (document.getElementById('nightSleepOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'nightSleepOverlay';
  overlay.className = 'night-sleep-overlay';
  document.body.appendChild(overlay);
}

function removeOverlay() {
  const overlay = document.getElementById('nightSleepOverlay');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

function disableSleepMode() {
  document.body.classList.remove('night-sleep');
  window.__gardenSleepFactor = 1;
  removeCanvas();
  removeOverlay();
}

function checkAndToggle() {
  const night = isNightTheme();
  const currently = document.body.classList.contains('night-sleep');
  if (night && !currently) {
    enableSleepMode();
  } else if (!night && currently) {
    disableSleepMode();
  }
}

export function initSleepMode() {
  // Respect reduced motion preference
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Initial check
  checkAndToggle();
  // Re‑check when theme may change – poll every 30 seconds (lightweight)
  visibleSetInterval(checkAndToggle, 30000);
  // Handle resize for canvas
  window.addEventListener('resize', () => {
    if (canvas) resizeCanvas();
  });
}

// Expose for testing (optional)
export const __sleep = { enableSleepMode, disableSleepMode, checkAndToggle };
