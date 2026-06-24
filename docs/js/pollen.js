// pollen.js - lightweight pollen particle emission
// Emits subtle pollen specks from a blooming flower tile.
// Usage: import { emitPollen } from './pollen.js';
// Then call emitPollen(tileElement) after the bloom completes.

// Configurable constants (kept low for performance)
const PARTICLE_COUNT = 6; // number of particles per bloom
const ANIMATION_DURATION = 3000; // ms, matches CSS animation length

/**
 * Emit pollen particles from the given tile element.
 * @param {HTMLElement} tileEl - The tile element containing the flower.
 */
export function emitPollen(tileEl) {
  if (!tileEl) return;
  const rect = tileEl.getBoundingClientRect();
  // center within tile
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = document.createElement('span');
    p.className = 'pollen-particle';
    // random start offset within small radius
    const startAngle = Math.random() * Math.PI * 2;
    const startDist = Math.random() * 4; // px
    const sx = Math.cos(startAngle) * startDist;
    const sy = Math.sin(startAngle) * startDist;
    p.style.left = `${centerX + sx}px`;
    p.style.top = `${centerY + sy}px`;
    // custom CSS variables for animation randomness
    const endAngle = startAngle + (Math.random() * 0.6 - 0.3); // slight drift direction
    const endDist = 20 + Math.random() * 10; // drift distance
    const ex = Math.cos(endAngle) * endDist;
    const ey = Math.sin(endAngle) * endDist;
    p.style.setProperty('--dx', `${ex}px`);
    p.style.setProperty('--dy', `${ey}px`);
    // delay a little for each particle
    const delay = Math.random() * 0.6;
    p.style.animationDelay = `${delay}s`;
    tileEl.appendChild(p);
    // cleanup after animation ends
    setTimeout(() => {
      p.remove();
    }, (ANIMATION_DURATION + delay * 1000) + 200);
  }
}
