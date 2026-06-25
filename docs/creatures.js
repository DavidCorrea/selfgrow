// Simple autonomous creature agents for selfgrow

// This module adds small creature entities that wander within the garden.
// Creatures are rendered as SVG circles and persist their positions via localStorage.
// Motion respects the user's reduced‑motion preference.

class Creature {
  // x and y are stored in pixels relative to the garden container.
  constructor(id, x, y) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.elem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.elem.classList.add('creature');
    this.elem.setAttribute('viewBox', '0 0 20 20');
    this.elem.innerHTML = `<circle cx="10" cy="10" r="5" fill="orange" />`;
    this.elem.style.position = 'absolute';
    // Ensure the SVG has a reasonable size
    this.elem.style.width = '20px';
    this.elem.style.height = '20px';
    this.updatePos();
    document.getElementById('garden').appendChild(this.elem);
  }

  updatePos() {
    // Position within the garden using pixel coordinates
    this.elem.style.left = `${this.x}px`;
    this.elem.style.top = `${this.y}px`;
  }

  step() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const speed = reduced ? 0.1 : 0.5; // slower if reduced motion preferred
    // random walk with slight bias toward nearest flower
    // Treat plants as flowers for biasing movement
    const flowers = document.querySelectorAll('.plant');
    let biasX = 0, biasY = 0;
    if (flowers.length) {
      let nearest = null, minDist = Infinity;
      flowers.forEach(f => {
        // Compute plant position relative to the garden container using bounding rectangles
        const gardenRect = document.getElementById('garden').getBoundingClientRect();
        const plantRect = f.getBoundingClientRect();
        const fx = plantRect.left - gardenRect.left + plantRect.width / 2;
        const fy = plantRect.top - gardenRect.top + plantRect.height / 2;

        const dx = fx - this.x;
        const dy = fy - this.y;
        const d = dx*dx + dy*dy;
        if (d < minDist) { minDist = d; nearest = {dx, dy}; }
      });
      if (nearest) {
        biasX = Math.sign(nearest.dx) * 0.2;
        biasY = Math.sign(nearest.dy) * 0.2;
      }
    }
    this.x += (Math.random() - 0.5) * speed + biasX;
    this.y += (Math.random() - 0.5) * speed + biasY;
    // keep within bounds
    // Constrain to garden bounds (using garden dimensions)
    const garden = document.getElementById('garden');
    const maxX = Math.max(0, garden.clientWidth - 20);
    this.x = Math.max(0, Math.min(maxX, this.x));
    const maxY = Math.max(0, garden.clientHeight - 20);
    this.y = Math.max(0, Math.min(maxY, this.y));
    // Attempt pollination if near a plant
    const now = Date.now();
    if (!this.lastPollinate || now - this.lastPollinate > 1000) {
      const plants = document.querySelectorAll('.plant');
      const gardenRect = document.getElementById('garden').getBoundingClientRect();
      for (const p of plants) {
        const rect = p.getBoundingClientRect();
        const px = rect.left - gardenRect.left + rect.width / 2;
        const py = rect.top - gardenRect.top + rect.height / 2;
        const dx = px - this.x;
        const dy = py - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 30) { // within pollination range
          if (typeof p.pollinate === 'function') {
            p.pollinate();
            this.lastPollinate = now;
          }
          break;
        }
      }
    }
    this.updatePos();
  }
}

function loadCreatures() {
  const saved = JSON.parse(localStorage.getItem('creatures') || '[]');
  const creatures = saved.map(c => new Creature(c.id, c.x, c.y));
  if (creatures.length === 0) {
    // create a few default creatures
    const garden = document.getElementById('garden');
    const maxX = Math.max(0, garden.clientWidth - 20);
    const maxY = Math.max(0, garden.clientHeight - 20);
    for (let i = 0; i < 3; i++) {
      const x = Math.random() * maxX;
      const y = Math.random() * maxY;
      creatures.push(new Creature('c' + i, x, y));
    }
  }
  return creatures;
}

function saveCreatures(creatures) {
  const data = creatures.map(c => ({id: c.id, x: c.x, y: c.y}));
  localStorage.setItem('creatures', JSON.stringify(data));
}

window.addEventListener('load', () => {
  const creatures = loadCreatures();
  function tick() {
    creatures.forEach(c => c.step());
    requestAnimationFrame(tick);
  }
  tick();
  window.addEventListener('beforeunload', () => saveCreatures(creatures));
});
