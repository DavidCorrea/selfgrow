(function () {
  'use strict';

  // ── Welcome Garden (existing seed-bloom) ──
  const garden = document.getElementById('garden');
  const seed = document.getElementById('seed');
  const sprout = document.getElementById('sprout');
  const hint = document.getElementById('hint');
  const message = document.getElementById('message');
  const card = document.getElementById('welcomeCard');

  // ── Garden Grid (new) ──
  const gardenGridWrapper = document.getElementById('gardenGridWrapper');
  const gardenGrid = document.getElementById('gardenGrid');
  const gridHint = document.getElementById('gridHint');
  const counter = document.getElementById('counter');
  const tiles = gardenGrid.querySelectorAll('.grid-tile');

  // Color palettes for tile flowers (pinks, oranges, purples, blues, yellows)
  const petalPalettes = [
    ['#f472b6', '#ec4899', '#db2777'],  // pinks
    ['#fb923c', '#f97316', '#ea580c'],  // oranges
    ['#a78bfa', '#8b5cf6', '#7c3aed'],  // purples
    ['#60a5fa', '#3b82f6', '#2563eb'],  // blues
    ['#fbbf24', '#f59e0b', '#d97706'],  // yellows
    ['#f472b6', '#a78bfa', '#60a5fa'],  // mixed pastel
    ['#fb923c', '#f472b6', '#fbbf24'],  // warm mix
    ['#60a5fa', '#34d399', '#a78bfa'],  // cool mix
    ['#fbbf24', '#fb923c', '#f472b6'],  // sunset
  ];

  const centerColors = ['#fbbf24', '#fde68a', '#fcd34d', '#f59e0b', '#eab308'];

  const gridMessages = [
    "your garden is growing",
    "each tile holds a new possibility",
    "life finds a way",
    "tend it gently",
    "watch it flourish",
  ];

  let planted = false;
  let gridRevealed = false;
  let plantedCount = 0;
  const totalTiles = 9;

  const messages = [
    "a tiny seed finds its place in the soil",
    "with patience, it reaches toward the light",
    "your garden is beginning to grow",
    "every bloom starts with a single seed",
    "nurture it and watch what happens",
  ];

  function getRandomMessage() {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  function getRandomGridMessage() {
    return gridMessages[Math.floor(Math.random() * gridMessages.length)];
  }

  function createSparkles() {
    const rect = garden.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2 - 10;

    for (let i = 0; i < 8; i++) {
      const sparkle = document.createElement('div');
      sparkle.classList.add('sparkle');
      const angle = (Math.PI * 2 * i) / 8;
      const distance = 2 + Math.random() * 2;
      const tx = Math.cos(angle) * distance * 10 + 'px';
      const ty = Math.sin(angle) * distance * 10 + 'px';
      sparkle.style.setProperty('--tx', tx);
      sparkle.style.setProperty('--ty', ty);
      sparkle.style.left = centerX + 'px';
      sparkle.style.top = centerY + 'px';
      garden.appendChild(sparkle);

      setTimeout(function () {
        sparkle.remove();
      }, 1000);
    }
  }

  function createTileSparkles(tileEl) {
    const rect = tileEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height * 0.35;

    for (let i = 0; i < 6; i++) {
      const sparkle = document.createElement('div');
      sparkle.classList.add('tile-sparkle');
      const angle = (Math.PI * 2 * i) / 6;
      const distance = 1.5 + Math.random() * 1.5;
      const tx = Math.cos(angle) * distance * 8 + 'px';
      const ty = Math.sin(angle) * distance * 8 + 'px';
      sparkle.style.setProperty('--tx', tx);
      sparkle.style.setProperty('--ty', ty);
      sparkle.style.left = centerX + 'px';
      sparkle.style.top = centerY + 'px';
      tileEl.appendChild(sparkle);

      setTimeout(function () {
        sparkle.remove();
      }, 800);
    }
  }

  function applyTileColors(tileEl, tileIndex) {
    const palette = petalPalettes[tileIndex % petalPalettes.length];
    const centerColor = centerColors[tileIndex % centerColors.length];
    const petalEls = tileEl.querySelectorAll('.tile-petal');

    petalEls.forEach(function (petal, i) {
      petal.style.background = palette[i % palette.length];
    });

    const centerEl = tileEl.querySelector('.tile-center');
    if (centerEl) {
      centerEl.style.background = centerColor;
      centerEl.style.boxShadow = '0 0 0.2rem rgba(251, 191, 36, 0.5)';
    }
  }

  function updateCounter() {
    counter.innerHTML = 'planted <span>' + plantedCount + '</span> / ' + totalTiles;
    counter.style.opacity = '1';
  }

  function revealGrid() {
    if (gridRevealed) return;
    gridRevealed = true;

    gardenGridWrapper.classList.add('visible');
    gardenGridWrapper.setAttribute('aria-hidden', 'false');

    gridHint.textContent = getRandomGridMessage();
    gridHint.style.opacity = '1';

    updateCounter();
  }

  function plantTile(tileEl) {
    if (tileEl.classList.contains('planted')) return;

    const tileIndex = parseInt(tileEl.getAttribute('data-tile'), 10);

    // Apply random colors
    applyTileColors(tileEl, tileIndex);

    // Mark as planted
    tileEl.classList.add('planted');
    tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted');

    // Show seed
    const tileSeed = tileEl.querySelector('.tile-seed');
    tileSeed.classList.add('visible');

    // Start sprout growth after seed lands
    setTimeout(function () {
      const tileSprout = tileEl.querySelector('.tile-sprout');
      tileSprout.classList.add('growing');
    }, 500);

    // After bloom, switch to grown state and show sparkles
    setTimeout(function () {
      const tileSprout = tileEl.querySelector('.tile-sprout');
      tileSprout.classList.remove('growing');
      tileSprout.classList.add('grown');
      createTileSparkles(tileEl);

      plantedCount++;
      updateCounter();

      // Update grid hint with a new message
      gridHint.style.opacity = '0';
      setTimeout(function () {
        gridHint.textContent = getRandomGridMessage();
        gridHint.style.opacity = '1';
      }, 300);
    }, 2200);
  }

  // Tile click handlers
  tiles.forEach(function (tile) {
    tile.addEventListener('click', function () {
      plantTile(tile);
    });
    tile.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        plantTile(tile);
      }
    });
  });

  function plantSeed() {
    if (planted) return;
    planted = true;

    // Fade out hint
    hint.classList.add('fade-out');

    // Intensify card glow
    card.classList.add('glow-intensify');

    // Show seed with drop animation
    seed.classList.add('visible');

    // After seed lands, start sprout growth
    setTimeout(function () {
      sprout.classList.add('growing');
    }, 800);

    // After flower blooms, show message and sparkles
    setTimeout(function () {
      sprout.classList.remove('growing');
      sprout.classList.add('grown');
      createSparkles();

      message.textContent = getRandomMessage();
      message.classList.add('visible');
    }, 3500);

    // Reveal the garden grid after the main flower blooms and message fades
    setTimeout(function () {
      revealGrid();
    }, 5000);
  }

  garden.addEventListener('click', plantSeed);
  garden.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      plantSeed();
    }
  });
})();
