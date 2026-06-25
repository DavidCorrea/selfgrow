// garden.js – core seed growth animation
// This script creates a single seed element inside the #garden container
// and animates its growth using requestAnimationFrame with an easing function.
// It respects the user's reduced‑motion preference.

const garden = document.getElementById('garden');
if (!garden) {
  console.error('Garden container not found');
}

// Create seed element
const seed = document.createElement('div');
seed.className = 'seed';
garden.appendChild(seed);

// Easing function – easeOutCubic
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Animation parameters
const duration = 5000; // 5 seconds for full growth
let startTime = null;

// Reduced motion check – if user prefers reduced motion, we simply show the final state instantly.
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animate(timestamp) {
  if (!startTime) startTime = timestamp;
  const elapsed = timestamp - startTime;
  const progress = Math.min(elapsed / duration, 1);
  const eased = easeOutCubic(progress);

  // Scale from 0.1 to 1.0, opacity from 0 to 1
  const scale = 0.1 + 0.9 * eased;
  seed.style.transform = `scale(${scale})`;
  seed.style.opacity = eased.toString();

  if (progress < 1) {
    requestAnimationFrame(animate);
  }
}

if (prefersReduced) {
  // Instantly set to final state
  seed.style.transform = 'scale(1)';
  seed.style.opacity = '1';
} else {
  requestAnimationFrame(animate);
}
