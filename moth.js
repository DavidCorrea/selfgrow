// moth.js – nocturnal autonomous moth agent
// Appears after sunset, moves slowly with eased motion, respects reduced‑motion preference.

class Moth {
  // id is a string, x/y are pixel coordinates relative to the garden container.
  constructor(id, x, y) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.elem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.elem.classList.add('moth');
    this.elem.setAttribute('viewBox', '0 0 24 24');
    // Simple moth‑like shape: a pair of wings and a body.
    this.elem.innerHTML = `
      <path d="M12 2 C8 2 6 5 6 9 C6 13 8 16 12 16 C16 16 18 13 18 9 C18 5 16 2 12 2 Z"
            fill="#e0e0e0"/>
      <circle cx="12" cy="12" r="2" fill="#b0b0b0"/>
    `;
    this.elem.style.position = 'absolute';
    this.elem.style.width = '24px';
    this.elem.style.height = '24px';
    this.updatePos();
    document.getElementById('garden').appendChild(this.elem);
  }

  updatePos() {
    this.elem.style.left = `${this.x}px`;
    this.elem.style.top = `${this.y}px`;
  }

  // Return true if current time is considered night (20:00–06:00)
  static isNight() {
    const hour = new Date().getHours();
    return hour >= 20 || hour < 6;
  }

  step() {
    // Respect reduced‑motion preference
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.elem.style.display = 'none = 'none';
    }
    // Show only at night
    if (!Moth.isNight()) {
      this.elem.style.display = 'none';
      return;
    }
    this.elem.style.display = '';

    // Base speed – slower than daytime creatures
    let speed = 0.15; // pixels per frame
    // Optional: add a very slow sinusoidal easing to simulate gentle drift
    const t = Date.now() * 0.0005; // slow cycle
    const ease = Math.sin(t) * 0.05; // small oscillation
    speed += ease;

    // Bias toward flowers (plants) – stronger at night
    const flowers = document.querySelectorAll('.plant');
    let biasX = 0, biasY = 0;
    if (flowers.length) {
      let nearest = null, minDist = Infinity;
      flowers.forEach(f => {
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
        biasX = Math.sign(nearest.dx) * 0.1;
        biasY = Math.sign(nearest.dy) * 0.1;
      }
    }

    // Random walk with bias
    this.x += (Math.random() - 0.5) * speed + biasX;
    this.y += (Math.random() - 0.5) * speed + biasY;

    // Keep within garden bounds
    const garden = document.getElementById('garden');
    const maxX = Math.max(0, garden.clientWidth - 24);
    this.x = Math.max(0, Math.min(maxX, this.x));
    const maxY = Math.max(0, garden.clientHeight - 24);
    this.y = Math.max(0, Math.min(maxY, this.y));

    this.updatePos();
  }
}

function loadMoths() {
  const saved = JSON.parse(localStorage.getItem('moths') || '[]');
  const moths = saved.map(c => new Moth(c.id, c.x, c.y));
  if (moths.length === 0) {
    // Create a couple of default moths
    const garden = document.getElementById('garden');
    const maxX = Math.max(0, garden.clientWidth - 24);
    const maxY = Math.max(0, garden.clientHeight - 24);
    for (let i = 0; i < 2; i++) {
      const x = Math.random() * maxX;
      const y = Math.random() * maxY;
      moths.push(new Moth('m' + i, x, y));
    }
  }
  return moths;
}

function saveMoths(moths) {
  const data = moths.map(m => ({id: m.id, x: m.x, y: m.y}));
  localStorage.setItem('moths', JSON.stringify(data));
}

// Initialization
window.addEventListener('load', () => {
  const moths = loadMoths();
  function tick() {
    moths.forEach(m => m.step());
    requestAnimationFrame(tick);
  }
  tick();
  window.addEventListener('beforeunload', () => saveMoths(moths));
});

