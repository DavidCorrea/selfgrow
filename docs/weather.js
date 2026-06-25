// weather.js – gentle weather cycles for the garden
// This module runs in the browser and cycles through subtle weather states
// (clear, mist, rain, sun). It changes the garden container's background
// via CSS classes and adds lightweight particle effects.

// Respect reduced motion preference – if the user prefers reduced motion,
// we simply keep the garden in the clear state without any particles.
const garden = document.getElementById('garden');
if (!garden) {
  console.error('Garden container not found (weather.js)');
}

function isReducedMotion() {
  return window.reducedMotionEnabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Create a container for particles (mist, rain, sun)
const particlesContainer = document.createElement('div');
particlesContainer.className = 'particles';
garden.appendChild(particlesContainer);

// Weather state definitions
const weatherStates = [
  { name: 'clear', duration: 15000 }, // 15s
  { name: 'mist', duration: 15000 },
  { name: 'rain', duration: 15000 },
  { name: 'sun', duration: 15000 },
];
let currentIndex = 0;

function clearParticles() {
  // Remove all child nodes from particles container
  while (particlesContainer.firstChild) {
    particlesContainer.removeChild(particlesContainer.firstChild);
  }
}

function startClear() {
  clearParticles();
  garden.classList.remove('weather-mist', 'weather-rain', 'weather-sun');
  garden.classList.add('weather-clear');
}

function startMist() {
  clearParticles();
  garden.classList.remove('weather-clear', 'weather-rain', 'weather-sun');
  garden.classList.add('weather-mist');
  // Generate a few mist particles that drift and fade via CSS animation
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.className = 'mist-particle';
    // random start position within garden
    const x = Math.random() * 260; // width 300 - particle width ~30
    const y = Math.random() * 260;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    particlesContainer.appendChild(p);
    // Remove after animation duration (6s)
    setTimeout(() => p.remove(), 6000);
  }
}

function startRain() {
  clearParticles();
  garden.classList.remove('weather-clear', 'weather-mist', 'weather-sun');
  garden.classList.add('weather-rain');
  // Continuously spawn raindrops for the duration of the state
  const spawnInterval = setInterval(() => {
    const drop = document.createElement('div');
    drop.className = 'raindrop';
    const x = Math.random() * 298; // garden width - drop width
    drop.style.left = `${x}px`;
    particlesContainer.appendChild(drop);
    // Remove after fall animation (1s)
    setTimeout(() => drop.remove(), 1000);
  }, 150);
  // Store interval id so we can clear it when leaving rain state
  garden._rainInterval = spawnInterval;
}

function stopRain() {
  if (garden._rainInterval) {
    clearInterval(garden._rainInterval);
    delete garden._rainInterval;
  }
}

function startSun() {
  clearParticles();
  garden.classList.remove('weather-clear', 'weather-mist', 'weather-rain');
  garden.classList.add('weather-sun');
  const sun = document.createElement('div');
  sun.className = 'sun';
  particlesContainer.appendChild(sun);
  // Sun stays for the whole state; will be cleared by clearParticles when state changes.
}

function applyState(state) {
  // Log weather change event
  if (window.garden && typeof window.garden.logEvent === 'function') {
    window.garden.logEvent('weatherChanged', state.name);
  }
  switch (state.name) {
    case 'clear':
      startClear();
      break;
    case 'mist':
      startMist();
      break;
    case 'rain':
      startRain();
      break;
    case 'sun':
      startSun();
      break;
  }
}

function nextState() {
  // Clean up any state‑specific resources
  if (weatherStates[currentIndex].name === 'rain') {
    stopRain();
  }
  // Advance index
  currentIndex = (currentIndex + 1) % weatherStates.length;
  const next = weatherStates[currentIndex];
  applyState(next);
  // Schedule next transition unless reduced motion
  if (!isReducedMotion()) {
    setTimeout(nextState, next.duration);
  }
}

// Initialize
if (!isReducedMotion()) {
  // Start with the first state immediately
  applyState(weatherStates[currentIndex]);
  setTimeout(nextState, weatherStates[currentIndex].duration);
} else {
  // Reduced motion – just set clear state
  startClear();
}
