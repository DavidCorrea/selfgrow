// flora.js – autonomous background flora generator
// Generates simple plant elements that grow, live, fade and respawn.

const garden = document.getElementById('garden');
const toggleBtn = document.getElementById('toggle-flora');

// Config (feel free to tweak)
const CONFIG = {
  // Approximate number of plants based on visible area (per 2000px²)
  density: 0.0005, // plants per pixel²
  minSize: 20, // px diameter
  maxSize: 80,
  growthDuration: 2000, // ms
  fadeDuration: 3000, // ms
  // Lifespan before start fading (random range)
  lifespanMin: 10000,
  lifespanMax: 30000,
};

// Season names for seasonal filtering
const SEASON_NAMES = ['spring', 'summer', 'fall', 'winter'];

// Sync CSS custom properties with CONFIG
function syncCssVars() {
  garden.style.setProperty('--growth-duration', `${CONFIG.growthDuration}ms`);
  garden.style.setProperty('--fade-duration', `${CONFIG.fadeDuration}ms`);
}

let enabled = true; // default on
let spawnInterval = null;
let targetCount = 0;

// Utility – random integer in [min, max]
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Create a single plant element and animate it
function createPlant() {
  const plant = document.createElement('div');
  plant.className = 'plant';

  // Assign a random season to the plant for seasonal filtering
  const season = SEASON_NAMES[Math.floor(Math.random() * SEASON_NAMES.length)];
  plant.setAttribute('data-season', season);

  const size = randInt(CONFIG.minSize, CONFIG.maxSize);
  plant.style.width = `${size}px`;
  plant.style.height = `${size}px`;

  // Random position ensuring the whole plant stays inside the garden
  const gardenRect = garden.getBoundingClientRect();
  const maxX = gardenRect.width - size;
  const maxY = gardenRect.height - size;
  const left = randInt(0, Math.max(0, maxX));
  const top = randInt(0, Math.max(0, maxY));
  plant.style.left = `${left}px`;
  plant.style.top = `${top}px`;

  garden.appendChild(plant);

  // Trigger growth on next frame
  requestAnimationFrame(() => plant.classList.add('grow'));

  // Schedule fade after a random lifespan
  const lifespan = randInt(CONFIG.lifespanMin, CONFIG.lifespanMax);
  const fadeTimeout = setTimeout(() => {
    plant.classList.add('fade');
    // Remove after fade finishes
    setTimeout(() => {
      plant.remove();
      // Keep count accurate and possibly respawn a new plant
      if (enabled) scheduleIfNeeded();
    }, CONFIG.fadeDuration);
  }, lifespan);

  // Cleanup if disabled before timers fire
  const cleanup = () => {
    clearTimeout(fadeTimeout);
    plant.remove();
  };
  return cleanup;
}

// Ensure we have at least targetCount plants present
function scheduleIfNeeded() {
  const current = garden.querySelectorAll('.plant').length;
  if (current < targetCount) {
    // Create missing plants synchronously (small batch to avoid spikes)
    const needed = targetCount - current;
    for (let i = 0; i < needed; i++) {
      createPlant();
    }
  }
}

function start() {
  if (!enabled) return;
  // Compute target count based on viewport area
  const area = window.innerWidth * window.innerHeight;
  targetCount = Math.round(area * CONFIG.density);
  scheduleIfNeeded();
  // Re‑evaluate on resize
  window.addEventListener('resize', onResize);
}

function stop() {
  enabled = false;
  toggleBtn.setAttribute('aria-pressed', 'false');
  toggleBtn.textContent = 'Enable Flora';
  // Remove all plants
  garden.querySelectorAll('.plant').forEach(p => p.remove());
  // Cancel periodic checks (if any)
  if (spawnInterval) clearInterval(spawnInterval);
  window.removeEventListener('resize', onResize);
}

function onResize() {
  // Re‑calculate target on resize and spawn if needed
  const area = window.innerWidth * window.innerHeight;
  targetCount = Math.round(area * CONFIG.density);
  scheduleIfNeeded();
}

function toggle() {
  if (enabled) {
    enabled = false;
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.textContent = 'Enable Flora';
    // Remove existing plants
    garden.querySelectorAll('.plant').forEach(p => p.remove());
    window.removeEventListener('resize', onResize);
  } else {
    enabled = true;
    toggleBtn.setAttribute('aria-pressed', 'true');
    toggleBtn.textContent = 'Disable Flora';
    start();
  }
}

// Sync CSS variables on load
syncCssVars();

// Initial setup
toggleBtn.addEventListener('click', toggle);
// Start generator on load
start();