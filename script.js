(function () {
  'use strict';

  // ── Seasonal Time-of-Day Theme ──
  function applyTimeTheme() {
    const hour = new Date().getHours();
    let theme;

    if (hour >= 5 && hour < 8) {
      // Dawn: 5am - 7:59am
      theme = 'dawn';
    } else if (hour >= 8 && hour < 17) {
      // Day: 8am - 4:59pm
      theme = 'day';
    } else if (hour >= 17 && hour < 20) {
      // Dusk: 5pm - 7:59pm
      theme = 'dusk';
    } else {
      // Night: 8pm - 4:59am
      theme = 'night';
    }

    document.body.classList.remove('theme-dawn', 'theme-day', 'theme-dusk', 'theme-night');
    document.body.classList.add('theme-' + theme);
  }

  // Apply theme on load
  applyTimeTheme();

  // Update theme every minute to catch transitions
  setInterval(applyTimeTheme, 60000);

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

  // ── Garden Journal ──
  const gardenJournal = document.getElementById('gardenJournal');
  const journalTimeline = document.getElementById('journalTimeline');
  const journalEmpty = document.getElementById('journalEmpty');
  let journalRevealed = false;
  let journalEntries = [];

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

  // Store tile colors for journal swatches
  const tileColorMap = {};

  // ── Growth Cycle State ──
  // Each planted tile tracks its cycle count and stage
  const tileCycleState = {}; // tileIndex -> { cycle: number, stage: string }

  // Growth cycle timing (ms) — base values, per-tile offsets applied
  const CYCLE_HOLD_BLOOM = 8000;   // hold bloom for ~8s
  const CYCLE_WILT_DURATION = 2000; // wilt over ~2s
  const CYCLE_PAUSE_AFTER_WILT = 1500; // brief pause after wilt before reset
  const CYCLE_SEED_OFFSET = 1200;   // extra offset per tile index to desync

  const cycleMessages = [
    "a new cycle begins",
    "life renews itself",
    "the garden breathes",
    "from soil, life returns",
    "nature's rhythm continues",
  ];

  function getRandomCycleMessage() {
    return cycleMessages[Math.floor(Math.random() * cycleMessages.length)];
  }

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

  function formatTime(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes < 10 ? '0' + minutes : minutes;
    return displayHours + ':' + displayMinutes + ' ' + ampm;
  }

  function revealJournal() {
    if (journalRevealed) return;
    journalRevealed = true;

    gardenJournal.classList.add('visible');
    gardenJournal.setAttribute('aria-hidden', 'false');
  }

  function addJournalEntry(tileIndex, petalColor, cycleNum) {
    // Reveal journal on first entry
    if (!journalRevealed) {
      // Small delay so it appears after the grid
      setTimeout(function () {
        revealJournal();
      }, 600);
    }

    // Hide empty state
    if (journalEmpty) {
      journalEmpty.style.display = 'none';
    }

    const now = new Date();
    const timeStr = formatTime(now);
    const entry = {
      tileIndex: tileIndex,
      petalColor: petalColor,
      time: timeStr,
      timestamp: now.getTime(),
      cycle: cycleNum || 1
    };
    journalEntries.push(entry);

    // Create entry element
    const entryEl = document.createElement('div');
    entryEl.classList.add('journal-entry');
    entryEl.setAttribute('role', 'listitem');

    const isCycle = cycleNum && cycleNum > 1;
    const entryLabel = isCycle
      ? '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 🌸 cycle ' + cycleNum + ' at ' + timeStr
      : '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; planted at ' + timeStr;

    entryEl.innerHTML =
      '<div class="entry-timeline-dot"></div>' +
      '<div class="entry-content">' +
        '<p class="entry-text">' + entryLabel + '</p>' +
        '<p class="entry-time">' + (isCycle ? getRandomCycleMessage() : 'flower #' + journalEntries.length + ' in your garden') + '</p>' +
      '</div>' +
      '<div class="entry-swatch" style="background: ' + petalColor + '" aria-hidden="true"></div>';

    // Insert at top of timeline
    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);

    // Pulse the journal to draw attention
    gardenJournal.classList.remove('pulse');
    // Force reflow to restart animation
    void gardenJournal.offsetWidth;
    gardenJournal.classList.add('pulse');

    // Scroll to top to show new entry
    journalTimeline.scrollTop = 0;
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

  function startGrowthCycle(tileEl, tileIndex) {
    const state = tileCycleState[tileIndex];
    if (!state) return;

    const tileSprout = tileEl.querySelector('.tile-sprout');
    const tileSeed = tileEl.querySelector('.tile-seed');
    const badge = tileEl.querySelector('.tile-cycle-badge');
    const palette = petalPalettes[tileIndex % petalPalettes.length];
    const primaryColor = palette[0];

    // Reset all sprout animation classes
    tileSprout.classList.remove('growing', 'budding', 'blooming', 'grown', 'wilting');
    tileEl.classList.remove('reseeding');
    tileSeed.classList.remove('visible');

    // Show soil pulse for reseed
    tileEl.classList.add('reseeding');

    // Show seed drop
    tileSeed.classList.add('visible');

    // Start sprout growth after seed lands
    var seedTimeout = setTimeout(function () {
      tileSprout.classList.add('growing');
    }, 500);

    // After stem + leaves grow, show bud stage
    var budTimeout = setTimeout(function () {
      tileSprout.classList.remove('growing');
      tileSprout.classList.add('budding');
    }, 1400);

    // Bud opens into bloom
    var bloomTimeout = setTimeout(function () {
      tileSprout.classList.remove('budding');
      tileSprout.classList.add('blooming');
    }, 2000);

    // After bloom animation completes, switch to grown (sway) state
    var grownTimeout = setTimeout(function () {
      tileSprout.classList.remove('blooming');
      tileSprout.classList.add('grown');
      createTileSparkles(tileEl);

      // Update cycle badge
      if (badge) {
        badge.textContent = '🌸 ' + state.cycle;
        badge.classList.add('visible');
      }

      // Add journal entry for cycle 2+
      if (state.cycle > 1) {
        addJournalEntry(tileIndex, primaryColor, state.cycle);
      }

      // Update grid hint with cycle message on subsequent cycles
      if (state.cycle > 1) {
        gridHint.style.opacity = '0';
        setTimeout(function () {
          gridHint.textContent = getRandomCycleMessage();
          gridHint.style.opacity = '1';
        }, 300);
      }

      // Schedule wilt phase — varied timing per tile
      var offset = tileIndex * CYCLE_SEED_OFFSET;
      var wiltDelay = CYCLE_HOLD_BLOOM + offset;

      var wiltTimeout = setTimeout(function () {
        // Check tile is still planted (hasn't been removed)
        if (!tileEl.classList.contains('planted')) return;

        tileSprout.classList.remove('grown');
        tileSprout.classList.add('wilting');

        // After wilt completes, reset and restart cycle
        var restartTimeout = setTimeout(function () {
          if (!tileEl.classList.contains('planted')) return;

          // Hide badge during transition
          if (badge) {
            badge.classList.remove('visible');
          }

          // Increment cycle
          state.cycle++;

          // Restart the growth cycle
          startGrowthCycle(tileEl, tileIndex);
        }, CYCLE_WILT_DURATION + CYCLE_PAUSE_AFTER_WILT);

        // Store timeout on state so it could be cleared if needed
        state.timeouts = state.timeouts || [];
        state.timeouts.push(restartTimeout);
      }, wiltDelay);

      state.timeouts = state.timeouts || [];
      state.timeouts.push(wiltTimeout);

    }, 2700);

    state.timeouts = state.timeouts || [];
    state.timeouts.push(seedTimeout, budTimeout, bloomTimeout, grownTimeout);
  }

  function plantTile(tileEl) {
    if (tileEl.classList.contains('planted')) return;

    const tileIndex = parseInt(tileEl.getAttribute('data-tile'), 10);

    // Apply random colors
    applyTileColors(tileEl, tileIndex);

    // Store the primary petal color for journal swatch
    const palette = petalPalettes[tileIndex % petalPalettes.length];
    const primaryColor = palette[0];
    tileColorMap[tileIndex] = primaryColor;

    // Initialize cycle state
    tileCycleState[tileIndex] = { cycle: 1, stage: 'planted', timeouts: [] };

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

    // After stem + leaves grow, show bud stage (new!)
    setTimeout(function () {
      const tileSprout = tileEl.querySelector('.tile-sprout');
      tileSprout.classList.remove('growing');
      tileSprout.classList.add('budding');
    }, 1400);

    // Bud opens into bloom
    setTimeout(function () {
      const tileSprout = tileEl.querySelector('.tile-sprout');
      tileSprout.classList.remove('budding');
      tileSprout.classList.add('blooming');
    }, 2000);

    // After bloom animation completes, switch to grown (sway) state
    setTimeout(function () {
      const tileSprout = tileEl.querySelector('.tile-sprout');
      tileSprout.classList.remove('blooming');
      tileSprout.classList.add('grown');
      createTileSparkles(tileEl);

      // Show cycle badge
      const badge = tileEl.querySelector('.tile-cycle-badge');
      if (badge) {
        badge.textContent = '🌸 1';
        badge.classList.add('visible');
      }

      plantedCount++;
      updateCounter();

      // Add journal entry
      addJournalEntry(tileIndex, primaryColor, 1);

      // Update grid hint with a new message
      gridHint.style.opacity = '0';
      setTimeout(function () {
        gridHint.textContent = getRandomGridMessage();
        gridHint.style.opacity = '1';
      }, 300);

      // Schedule the first wilt → reseed cycle
      var offset = tileIndex * CYCLE_SEED_OFFSET;
      var firstWiltDelay = CYCLE_HOLD_BLOOM + offset;

      setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;

        tileSprout.classList.remove('grown');
        tileSprout.classList.add('wilting');

        // After wilt completes, reset and restart cycle
        setTimeout(function () {
          if (!tileEl.classList.contains('planted')) return;

          // Hide badge during transition
          if (badge) {
            badge.classList.remove('visible');
          }

          // Increment cycle and restart
          tileCycleState[tileIndex].cycle = 2;
          startGrowthCycle(tileEl, tileIndex);
        }, CYCLE_WILT_DURATION + CYCLE_PAUSE_AFTER_WILT);
      }, firstWiltDelay);
    }, 2700);
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
