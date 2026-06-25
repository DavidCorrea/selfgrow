// garden.js – core seed growth animation and autonomous flora agent
// This script creates an initial seed element inside the #garden container and animates its growth.
// It also runs an autonomous agent that periodically spawns additional plant elements.
// All animations respect the user's reduced‑motion preference.

const garden = document.getElementById('garden');
// Global pause flag for garden animations
window.isGardenPaused = false;
if (!garden) {
  console.error('Garden container not found');
}

// Create initial seed element
const seed = document.createElement('div');
seed.className = 'seed';
garden.appendChild(seed);

// Easing function – easeOutCubic
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Animation parameters for seed
const seedDuration = 5000; // 5 seconds for full growth
let seedStartTime = null;

// Reduced motion check – if user prefers reduced motion, we simply show the final state instantly.
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateSeed(timestamp) {
  if (!seedStartTime) seedStartTime = timestamp;
  const elapsed = timestamp - seedStartTime;
  const progress = Math.min(elapsed / seedDuration, 1);
  const eased = easeOutCubic(progress);

  // Scale from 0.1 to 1.0, opacity from 0 to 1
  const scale = 0.1 + 0.9 * eased;
  seed.style.transform = `scale(${scale})`;
  seed.style.opacity = eased.toString();

  if (progress < 1) {
    requestAnimationFrame(animateSeed);
  }
}

if (prefersReduced) {
  // Instantly set to final state
  seed.style.transform = 'scale(1)';
  seed.style.opacity = '1';
} else {
  requestAnimationFrame(animateSeed);
}

// ---------- Autonomous Flora Agent ----------

// Helper to create and animate a plant element
function spawnPlant() {
  const plant = document.createElement('div');
  plant.className = 'plant';

  // Random size between 20px and 50px
  const size = 20 + Math.random() * 30;
  plant.style.width = `${size}px`;
  plant.style.height = `${size}px`;

  // Random horizontal position within garden bounds
  const maxX = Math.max(0, garden.clientWidth - size);
  plant.style.left = `${Math.random() * maxX}px`;

  // Start near the bottom, random offset up to half height
  const maxY = Math.max(0, garden.clientHeight / 2 - size);
  plant.style.bottom = `${Math.random() * maxY}px`;

  // Initial transform for growth animation (scale will transition via CSS)
  plant.style.transform = 'scale(0.1)';
  plant.style.opacity = '0';

  garden.appendChild(plant);

  // Trigger growth animation on next frame
  requestAnimationFrame(() => {
    plant.style.transform = 'scale(1)';
    plant.style.opacity = '1';
  });

  // After a lifespan, fade out and remove
  const lifeTime = 15000; // 15 seconds total
  setTimeout(() => {
    plant.style.opacity = '0';
    // Remove after fade transition (2s defined in CSS)
    setTimeout(() => plant.remove(), 2000);
  }, lifeTime);

  // Record spawn timestamp for persistence
  try {
    localStorage.setItem('lastSpawn', Date.now().toString());
  } catch (_) {}
}

// Start autonomous agent if motion is allowed
if (!prefersReduced) {
  // Immediate spawn on load if no recent spawn recorded
  try {
    const last = parseInt(localStorage.getItem('lastSpawn') || '0', 10);
    if (Date.now() - last > 30000) {
      spawnPlant();
    }
  } catch (_) {}

  // Spawn a new plant every 30 seconds
  const intervalId = setInterval(spawnPlant, 30000);
  // expose for pause control
  window.gardenSpawnInterval = intervalId;
  window.setGardenPaused = function(paused) {
    window.isGardenPaused = paused;
    if (paused) {
      clearInterval(window.gardenSpawnInterval);
    } else {
      // restart interval if not already running
      if (!window.gardenSpawnInterval) {
        window.gardenSpawnInterval = setInterval(spawnPlant, 30000);
      }
    }
  };
}

