(function () {
  'use strict';

  // ── Garden Persistence (localStorage) ──
  var STORAGE_KEY = 'selfgrow_garden_state';

  function saveGardenState() {
    var state = {
      version: 1,
      lastTended: Date.now(),
      plantedTiles: {},
      wateredTiles: {},
      tileCycleState: {},
      tileColorMap: {},
      journalEntries: journalEntries,
      plantedCount: plantedCount,
      gridRevealed: gridRevealed,
      journalRevealed: journalRevealed,
      tendingRevealed: tendingRevealed
    };

    // Save per-tile state
    tiles.forEach(function (tile) {
      var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
      if (tile.classList.contains('planted')) {
        state.plantedTiles[tileIndex] = true;
      }
      if (wateredTiles[tileIndex]) {
        state.wateredTiles[tileIndex] = true;
      }
      if (tileCycleState[tileIndex]) {
        state.tileCycleState[tileIndex] = {
          cycle: tileCycleState[tileIndex].cycle,
          stage: tileCycleState[tileIndex].stage || 'planted'
        };
      }
      if (tileColorMap[tileIndex]) {
        state.tileColorMap[tileIndex] = tileColorMap[tileIndex];
      }
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage might be full or unavailable
    }
  }

  function loadGardenState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function formatLastTended(timestamp) {
    var date = new Date(timestamp);
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);

    var timeStr = formatTime(date);

    if (diffMins < 1) return 'last tended just now at ' + timeStr;
    if (diffMins < 60) return 'last tended ' + diffMins + ' min ago at ' + timeStr;
    if (diffHours < 24) return 'last tended ' + diffHours + ' hr ago at ' + timeStr;
    if (diffDays < 7) return 'last tended ' + diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago at ' + timeStr;
    return 'last tended on ' + (date.getMonth() + 1) + '/' + date.getDate() + ' at ' + timeStr;
  }

  function showRestoringOverlay() {
    var overlay = document.createElement('div');
    overlay.classList.add('restoring-overlay');
    overlay.id = 'restoringOverlay';
    overlay.innerHTML = '<span class="restoring-text">🌱 restoring your garden...</span>';
    document.body.appendChild(overlay);
    // Trigger fade-in
    requestAnimationFrame(function () {
      overlay.classList.add('visible');
    });
  }

  function hideRestoringOverlay() {
    var overlay = document.getElementById('restoringOverlay');
    if (overlay) {
      overlay.classList.remove('visible');
      setTimeout(function () {
        overlay.remove();
      }, 600);
    }
  }

  function restoreGardenState(state) {
    if (!state) return;

    // Show restoring overlay
    showRestoringOverlay();

    // Restore journal entries array
    if (state.journalEntries && state.journalEntries.length > 0) {
      journalEntries = state.journalEntries;
    }

    // Restore counts
    if (state.plantedCount) plantedCount = state.plantedCount;
    if (state.gridRevealed) gridRevealed = true;
    if (state.journalRevealed) journalRevealed = true;
    if (state.tendingRevealed) tendingRevealed = true;

    // Restore watered tiles tracking
    if (state.wateredTiles) {
      wateredTiles = state.wateredTiles;
    }

    // Restore tile color map
    if (state.tileColorMap) {
      tileColorMap = state.tileColorMap;
    }

    // Restore tile cycle state
    if (state.tileCycleState) {
      for (var idx in state.tileCycleState) {
        tileCycleState[idx] = {
          cycle: state.tileCycleState[idx].cycle,
          stage: state.tileCycleState[idx].stage,
          timeouts: []
        };
      }
    }

    // Reveal grid if it was revealed
    if (gridRevealed) {
      gardenGridWrapper.classList.add('visible');
      gardenGridWrapper.setAttribute('aria-hidden', 'false');
      gridHint.textContent = getRandomGridMessage();
      gridHint.style.opacity = '1';
      updateCounter();
    }

    // Reveal tending toolbar if it was revealed
    if (tendingRevealed) {
      tendingToolbar.classList.add('visible');
      tendingToolbar.setAttribute('aria-hidden', 'false');
      tendingHint.textContent = getRandomWateringHint();
      tendingHint.style.opacity = '1';
    }

    // Reveal journal if it was revealed and populate entries
    if (journalRevealed && journalEntries.length > 0) {
      gardenJournal.classList.add('visible');
      gardenJournal.setAttribute('aria-hidden', 'false');

      // Hide empty state
      if (journalEmpty) {
        journalEmpty.style.display = 'none';
      }

      // Rebuild journal entries in reverse order (newest first)
      for (var i = journalEntries.length - 1; i >= 0; i--) {
        var entry = journalEntries[i];
        var entryEl = document.createElement('div');
        entryEl.classList.add('journal-entry');
        entryEl.setAttribute('role', 'listitem');

        var isCycle = entry.type === 'cycle';
        var isWatered = entry.type === 'watered';
        var entryLabel;
        if (isWatered) {
          entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; 💧 watered';
        } else if (isCycle) {
          entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; 🌸 cycle ' + entry.cycle + ' at ' + entry.time;
        } else {
          entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; planted at ' + entry.time;
        }

        var subText;
        if (isWatered) {
          subText = entry.subText || 'growth speed increased by 50%';
        } else if (isCycle) {
          subText = getRandomCycleMessage();
        } else {
          subText = 'flower #' + (i + 1) + ' in your garden';
        }

        entryEl.innerHTML =
          '<div class="entry-timeline-dot"></div>' +
          '<div class="entry-content">' +
            '<p class="entry-text">' + entryLabel + '</p>' +
            '<p class="entry-time">' + subText + '</p>' +
          '</div>' +
          '<div class="entry-swatch" style="background: ' + entry.petalColor + '" aria-hidden="true"></div>';

        journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
      }
    }

    // Show last tended timestamp
    if (state.lastTended) {
      var lastTendedEl = document.getElementById('journalLastTended');
      if (lastTendedEl) {
        lastTendedEl.textContent = formatLastTended(state.lastTended);
        lastTendedEl.classList.add('visible');
      }
    }

    // Restore planted tiles visually and restart their growth cycles
    var plantedIndices = [];
    if (state.plantedTiles) {
      for (var pIdx in state.plantedTiles) {
        plantedIndices.push(parseInt(pIdx, 10));
      }
    }

    // Sort so we restore in order
    plantedIndices.sort(function (a, b) { return a - b; });

    // Restore each planted tile with a staggered delay for visual effect
    plantedIndices.forEach(function (tileIndex, i) {
      var tileEl = tiles[tileIndex];
      if (!tileEl) return;

      var delay = i * 200;
      setTimeout(function () {
        restorePlantedTile(tileEl, tileIndex, state);
      }, delay);
    });

    // Hide overlay after all tiles are restored
    var totalDelay = plantedIndices.length * 200 + 600;
    setTimeout(function () {
      hideRestoringOverlay();
    }, totalDelay);
  }

  function restorePlantedTile(tileEl, tileIndex, state) {
    // Apply colors
    applyTileColors(tileEl, tileIndex);

    // Mark as planted
    tileEl.classList.add('planted');
    tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted');

    // Apply watered state if it was watered
    if (wateredTiles[tileIndex]) {
      tileEl.classList.add('watered');
      addWateredIcon(tileEl);
    }

    // Get cycle info
    var cycle = 1;
    if (tileCycleState[tileIndex]) {
      cycle = tileCycleState[tileIndex].cycle;
    }

    // Show the tile in its grown/blooming state immediately
    var tileSprout = tileEl.querySelector('.tile-sprout');
    var tileSeed = tileEl.querySelector('.tile-seed');
    var badge = tileEl.querySelector('.tile-cycle-badge');

    // Skip grow animation — show as fully grown
    tileSeed.classList.remove('visible');
    tileSprout.classList.remove('growing', 'budding', 'blooming', 'wilting');
    tileSprout.classList.add('grown');

    // Show cycle badge
    if (badge) {
      badge.textContent = '🌸 ' + cycle;
      badge.classList.add('visible');
    }

    // Restart the growth cycle from the grown stage
    // Schedule wilt after a delay based on cycle timing
    var offset = tileIndex * CYCLE_SEED_OFFSET;
    var wiltDelay = CYCLE_HOLD_BLOOM + offset;

    var wiltTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      if (!tileSprout.classList.contains('grown')) return;

      tileSprout.classList.remove('grown');
      tileSprout.classList.add('wilting');

      var restartTimeout = setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;

        if (badge) {
          badge.classList.remove('visible');
        }

        // Reset watered state
        wateredTiles[tileIndex] = false;
        tileEl.classList.remove('watered');
        var icon = tileEl.querySelector('.tile-watered-icon');
        if (icon) icon.remove();
        tileSprout.classList.remove('speed-up');

        tileCycleState[tileIndex].cycle++;
        startGrowthCycle(tileEl, tileIndex);
      }, CYCLE_WILT_DURATION + CYCLE_PAUSE_AFTER_WILT);

      tileCycleState[tileIndex].timeouts = tileCycleState[tileIndex].timeouts || [];
      tileCycleState[tileIndex].timeouts.push(restartTimeout);
    }, wiltDelay);

    tileCycleState[tileIndex].timeouts = tileCycleState[tileIndex].timeouts || [];
    tileCycleState[tileIndex].timeouts.push(wiltTimeout);
  }

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

  // ── Restore Garden from localStorage ──
  var savedState = loadGardenState();

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

  // ── Tending Toolbar ──
  const tendingToolbar = document.getElementById('tendingToolbar');
  const tendingHint = document.getElementById('tendingHint');
  const wateringCanBtn = document.getElementById('wateringCanBtn');
  let wateringMode = false;
  let wateredTiles = {}; // tileIndex -> boolean
  let tendingRevealed = false;

  const wateringHintMessages = [
    "click a watered tile to speed up its growth",
    "water accelerates the life cycle",
    "your plants love the extra care",
  ];

  function getRandomWateringHint() {
    return wateringHintMessages[Math.floor(Math.random() * wateringHintMessages.length)];
  }

  function revealTending() {
    if (tendingRevealed) return;
    tendingRevealed = true;

    tendingToolbar.classList.add('visible');
    tendingToolbar.setAttribute('aria-hidden', 'false');

    tendingHint.textContent = getRandomWateringHint();
    tendingHint.style.opacity = '1';
  }

  function createWaterDroplets(tileEl) {
    const drop = document.createElement('div');
    drop.classList.add('tile-water-drop');
    tileEl.appendChild(drop);

    setTimeout(function () {
      drop.remove();
    }, 700);
  }

  function createWaterSparkles(tileEl) {
    const rect = tileEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height * 0.4;

    for (let i = 0; i < 8; i++) {
      const sparkle = document.createElement('div');
      sparkle.classList.add('tile-water-sparkle');
      const angle = (Math.PI * 2 * i) / 8;
      const distance = 1.5 + Math.random() * 2;
      const tx = Math.cos(angle) * distance * 10 + 'px';
      const ty = Math.sin(angle) * distance * 10 + 'px';
      sparkle.style.setProperty('--tx', tx);
      sparkle.style.setProperty('--ty', ty);
      sparkle.style.left = centerX + 'px';
      sparkle.style.top = centerY + 'px';
      tileEl.appendChild(sparkle);

      setTimeout(function () {
        sparkle.remove();
      }, 900);
    }
  }

  function addWateredIcon(tileEl) {
    // Remove existing icon if present
    const existing = tileEl.querySelector('.tile-watered-icon');
    if (existing) existing.remove();

    const icon = document.createElement('div');
    icon.classList.add('tile-watered-icon');
    icon.textContent = '💧';
    icon.setAttribute('aria-hidden', 'true');
    tileEl.appendChild(icon);

    // Trigger animation in next frame
    requestAnimationFrame(function () {
      icon.classList.add('visible');
    });
  }

  function applySpeedBoost(tileEl) {
    const sprout = tileEl.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.add('water-bloom');
      setTimeout(function () {
        sprout.classList.remove('water-bloom');
      }, 1000);
    }
  }

  function toggleWateringMode() {
    wateringMode = !wateringMode;

    if (wateringMode) {
      wateringCanBtn.classList.add('active');
      wateringCanBtn.setAttribute('aria-pressed', 'true');
      tendingHint.style.opacity = '0';
      setTimeout(function () {
        tendingHint.textContent = 'click on planted tiles to water them';
        tendingHint.style.opacity = '1';
      }, 300);

      // Add watering-target class to all planted tiles
      tiles.forEach(function (tile) {
        if (tile.classList.contains('planted')) {
          tile.classList.add('watering-target');
        }
      });
    } else {
      wateringCanBtn.classList.remove('active');
      wateringCanBtn.setAttribute('aria-pressed', 'false');
      tendingHint.style.opacity = '0';
      setTimeout(function () {
        tendingHint.textContent = getRandomWateringHint();
        tendingHint.style.opacity = '1';
      }, 300);

      // Remove watering-target class from all tiles
      tiles.forEach(function (tile) {
        tile.classList.remove('watering-target');
      });
    }
  }

  function waterTile(tileEl, tileIndex) {
    if (wateredTiles[tileIndex]) return; // Already watered

    wateredTiles[tileIndex] = true;

    // Mark tile as watered
    tileEl.classList.add('watered');

    // Create water droplet animation
    createWaterDroplets(tileEl);

    // Create extra water sparkles
    createWaterSparkles(tileEl);

    // Add watered icon
    addWateredIcon(tileEl);

    // Apply bloom glow effect
    applySpeedBoost(tileEl);

    // Apply speed-up: halve the cycle timers for this tile
    const state = tileCycleState[tileIndex];
    if (state) {
      // Mark the tile with a speed-up flag class that CSS hooks into
      const sprout = tileEl.querySelector('.tile-sprout');
      if (sprout) {
        sprout.classList.add('speed-up');
      }

      // If the tile is in grown stage, trigger early wilt to speed up the cycle
      if (sprout && sprout.classList.contains('grown')) {
        // Trigger wilt in 2 seconds instead of the normal hold time
        var speedWiltTimeout = setTimeout(function () {
          if (!tileEl.classList.contains('planted')) return;
          // Check sprout still has grown class (hasn't already started wilting)
          if (!sprout.classList.contains('grown')) return;

          sprout.classList.remove('grown');
          sprout.classList.add('wilting');

          var speedRestartTimeout = setTimeout(function () {
            if (!tileEl.classList.contains('planted')) return;

            const badge = tileEl.querySelector('.tile-cycle-badge');
            if (badge) {
              badge.classList.remove('visible');
            }

            // Reset from watered
            wateredTiles[tileIndex] = false;
            tileEl.classList.remove('watered');
            const icon = tileEl.querySelector('.tile-watered-icon');
            if (icon) icon.remove();
            if (sprout) sprout.classList.remove('speed-up');

            state.cycle++;
            startGrowthCycle(tileEl, tileIndex);
          }, CYCLE_WILT_DURATION + CYCLE_PAUSE_AFTER_WILT);

          state.timeouts = state.timeouts || [];
          state.timeouts.push(speedRestartTimeout);
        }, 2000);

        state.timeouts = state.timeouts || [];
        state.timeouts.push(speedWiltTimeout);
      } else {
        // For tiles in other stages, the speed-up CSS class handles the acceleration
        // The natural cycle will proceed with faster CSS animations
        // After the current cycle completes, reset watered state
        var resetTimeout = setTimeout(function () {
          wateredTiles[tileIndex] = false;
          tileEl.classList.remove('watered');
          const icon = tileEl.querySelector('.tile-watered-icon');
          if (icon) icon.remove();
          if (sprout) sprout.classList.remove('speed-up');
        }, 8000);

        state.timeouts = state.timeouts || [];
        state.timeouts.push(resetTimeout);
      }
    }

    // Add journal entry for watering
    const palette = petalPalettes[tileIndex % petalPalettes.length];
    addJournalEntry(tileIndex, palette[0], state ? state.cycle : 1);
    // Override the last journal entry to mark as watered type
    if (journalEntries.length > 0) {
      journalEntries[journalEntries.length - 1].type = 'watered';
      journalEntries[journalEntries.length - 1].subText = 'growth speed increased by 50%';
    }
    // Override the last journal entry text to show watering
    const firstEntry = journalTimeline.firstChild;
    if (firstEntry) {
      const textEl = firstEntry.querySelector('.entry-text');
      if (textEl) {
        textEl.innerHTML = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 💧 watered';
      }
      const timeEl = firstEntry.querySelector('.entry-time');
      if (timeEl) {
        timeEl.textContent = 'growth speed increased by 50%';
      }
    }

    // Update hint
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'growth speed increased by 50% ✨';
      tendingHint.style.opacity = '1';
    }, 300);

    // Save state
    saveGardenState();
  }

  wateringCanBtn.addEventListener('click', function () {
    toggleWateringMode();
  });

  wateringCanBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleWateringMode();
    }
  });

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
    const isCycle = cycleNum && cycleNum > 1;
    const entry = {
      tileIndex: tileIndex,
      petalColor: petalColor,
      time: timeStr,
      timestamp: now.getTime(),
      cycle: cycleNum || 1,
      type: isCycle ? 'cycle' : 'plant'
    };
    journalEntries.push(entry);

    // Create entry element
    const entryEl = document.createElement('div');
    entryEl.classList.add('journal-entry');
    entryEl.setAttribute('role', 'listitem');

    var entryLabel = isCycle
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

    // Save state
    saveGardenState();
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

          // Save state on cycle change
          saveGardenState();
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

      // Reveal tending toolbar on first plant
      revealTending();

      // Add journal entry
      addJournalEntry(tileIndex, primaryColor, 1);

      // Save state
      saveGardenState();

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
      if (wateringMode && tile.classList.contains('planted')) {
        const tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
        waterTile(tile, tileIndex);
      } else {
        plantTile(tile);
      }
    });
    tile.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (wateringMode && tile.classList.contains('planted')) {
          const tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
          waterTile(tile, tileIndex);
        } else {
          plantTile(tile);
        }
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

    // Save state
    saveGardenState();
  }

  garden.addEventListener('click', plantSeed);
  garden.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      plantSeed();
    }
  });

  // ── Restore saved garden after all functions are ready ──
  if (savedState && savedState.plantedCount > 0) {
    restoreGardenState(savedState);
  }

  // ── Garden Visitors System ──
  var visitorsLayer = document.getElementById('visitorsLayer');
  var activeVisitors = [];
  var visitorIdCounter = 0;
  var visitorSpawnTimer = null;
  var fireflyTrailTimer = null;

  // Butterfly color variants
  var butterflyColors = ['pink', 'blue', 'purple', 'orange'];

  // Check if current theme is night
  function isNightTheme() {
    return document.body.classList.contains('theme-night');
  }

  // Get the number of blooming (grown) tiles
  function getBloomingCount() {
    var count = 0;
    tiles.forEach(function (tile) {
      if (tile.classList.contains('planted')) {
        var sprout = tile.querySelector('.tile-sprout');
        if (sprout && sprout.classList.contains('grown')) {
          count++;
        }
      }
    });
    return count;
  }

  // Get total planted count
  function getPlantedCount() {
    var count = 0;
    tiles.forEach(function (tile) {
      if (tile.classList.contains('planted')) count++;
    });
    return count;
  }

  // Get a random blooming tile's position, or null
  function getRandomBloomingTileRect() {
    var bloomingTiles = [];
    tiles.forEach(function (tile) {
      if (tile.classList.contains('planted')) {
        var sprout = tile.querySelector('.tile-sprout');
        if (sprout && sprout.classList.contains('grown')) {
          bloomingTiles.push(tile);
        }
      }
    });
    if (bloomingTiles.length === 0) return null;
    var tile = bloomingTiles[Math.floor(Math.random() * bloomingTiles.length)];
    return tile.getBoundingClientRect();
  }

  // Create a butterfly element
  function createButterfly() {
    var color = butterflyColors[Math.floor(Math.random() * butterflyColors.length)];
    var butterfly = document.createElement('div');
    butterfly.classList.add('visitor', 'butterfly', 'butterfly--' + color, 'flutter-path');
    butterfly.setAttribute('role', 'img');
    butterfly.setAttribute('aria-label', 'Butterfly');
    butterfly.setAttribute('tabindex', '0');

    butterfly.innerHTML =
      '<div class="butterfly-wing butterfly-wing--left"></div>' +
      '<div class="butterfly-wing butterfly-wing--right"></div>' +
      '<div class="butterfly-body"></div>';

    return butterfly;
  }

  // Create a bee element
  function createBee() {
    var bee = document.createElement('div');
    bee.classList.add('visitor', 'bee', 'flutter-path');
    bee.setAttribute('role', 'img');
    bee.setAttribute('aria-label', 'Bee');
    bee.setAttribute('tabindex', '0');

    bee.innerHTML =
      '<div class="bee-wing bee-wing--left"></div>' +
      '<div class="bee-wing bee-wing--right"></div>' +
      '<div class="bee-body"></div>' +
      '<div class="bee-stinger"></div>';

    return bee;
  }

  // Create a firefly element
  function createFirefly() {
    var firefly = document.createElement('div');
    firefly.classList.add('visitor', 'firefly', 'flutter-path');
    firefly.setAttribute('role', 'img');
    firefly.setAttribute('aria-label', 'Firefly');
    firefly.setAttribute('tabindex', '0');

    firefly.innerHTML = '<div class="firefly-glow"></div>';

    return firefly;
  }

  // Position an element at a random screen position
  function positionRandomly(el) {
    var maxX = Math.max(0, window.innerWidth - 40);
    var maxY = Math.max(0, window.innerHeight - 40);
    var x = Math.random() * maxX;
    var y = Math.random() * maxY;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // Position an element near a tile rect
  function positionNearTile(el, rect) {
    var offsetX = (Math.random() - 0.5) * rect.width * 1.5;
    var offsetY = (Math.random() - 0.5) * rect.height * 1.5;
    var x = rect.left + rect.width / 2 + offsetX;
    var y = rect.top + rect.height / 2 + offsetY;
    // Clamp to viewport
    x = Math.max(10, Math.min(window.innerWidth - 30, x));
    y = Math.max(10, Math.min(window.innerHeight - 30, y));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // Handle visitor click — scatter
  function handleVisitorClick(visitorEl) {
    if (visitorEl.classList.contains('scattering') ||
        visitorEl.classList.contains('leaving')) return;

    // Stop all path animations
    visitorEl.classList.remove('flutter-path');

    // Set scatter direction (random)
    var scatterX = (Math.random() - 0.5) * 140;
    var scatterY = -40 - Math.random() * 80;
    visitorEl.style.setProperty('--scatter-x', scatterX + 'px');
    visitorEl.style.setProperty('--scatter-y', scatterY + 'px');

    visitorEl.classList.add('scattering');

    // Remove after animation
    setTimeout(function () {
      removeVisitor(visitorEl);
    }, 900);
  }

  // Remove a visitor from DOM and tracking
  function removeVisitor(visitorEl) {
    var id = parseInt(visitorEl.getAttribute('data-visitor-id'), 10);
    activeVisitors = activeVisitors.filter(function (v) { return v !== id; });
    if (visitorEl.parentNode) {
      visitorEl.remove();
    }
  }

  // Spawn a new visitor
  function spawnVisitor() {
    var planted = getPlantedCount();
    if (planted === 0) return;

    var blooming = getBloomingCount();
    var isNight = isNightTheme();

    var visitorEl;

    if (isNight) {
      // Night: only fireflies
      visitorEl = createFirefly();
    } else {
      // Day/Dawn/Dusk: butterflies and bees
      if (Math.random() < 0.6) {
        visitorEl = createButterfly();
      } else {
        visitorEl = createBee();
      }
    }

    var id = visitorIdCounter++;
    visitorEl.setAttribute('data-visitor-id', id);
    activeVisitors.push(id);

    // Position: attracted to blooming flowers
    var tileRect = getRandomBloomingTileRect();
    if (tileRect && Math.random() < 0.6) {
      positionNearTile(visitorEl, tileRect);
    } else {
      positionRandomly(visitorEl);
    }

    // Add click handler
    visitorEl.addEventListener('click', function (e) {
      e.stopPropagation();
      handleVisitorClick(visitorEl);
    });
    visitorEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        handleVisitorClick(visitorEl);
      }
    });

    visitorsLayer.appendChild(visitorEl);

    // Landing animation
    visitorEl.classList.add('landing');
    setTimeout(function () {
      visitorEl.classList.remove('landing');
    }, 500);

    // Schedule departure
    var lifetime = 4000 + Math.random() * 6000; // 4-10 seconds
    setTimeout(function () {
      if (!visitorEl.parentNode) return;
      if (visitorEl.classList.contains('scattering')) return;

      visitorEl.classList.add('leaving');
      setTimeout(function () {
        removeVisitor(visitorEl);
      }, 700);
    }, lifetime);
  }

  // Create firefly trail particles
  function createFireflyTrails() {
    if (!isNightTheme()) return;

    var fireflies = visitorsLayer.querySelectorAll('.firefly:not(.scattering):not(.leaving)');
    fireflies.forEach(function (firefly) {
      if (Math.random() < 0.3) {
        var trail = document.createElement('div');
        trail.classList.add('firefly-trail');
        trail.style.left = firefly.style.left;
        trail.style.top = firefly.style.top;
        visitorsLayer.appendChild(trail);
        setTimeout(function () {
          trail.remove();
        }, 1500);
      }
    });
  }

  // Schedule the next visitor spawn
  function scheduleNextSpawn() {
    if (visitorSpawnTimer) clearTimeout(visitorSpawnTimer);

    var planted = getPlantedCount();
    if (planted === 0) return;

    // More planted tiles = more frequent spawns
    // Base: 5s, decreases by 500ms per planted tile, min 1.5s
    var interval = Math.max(1500, 5000 - (planted * 500));
    // Add some randomness
    interval += Math.random() * 2000;

    visitorSpawnTimer = setTimeout(function () {
      spawnVisitor();
      scheduleNextSpawn();
    }, interval);
  }

  // Start the visitor system
  function startVisitors() {
    if (visitorSpawnTimer) clearTimeout(visitorSpawnTimer);
    scheduleNextSpawn();

    // Firefly trail timer
    if (fireflyTrailTimer) clearInterval(fireflyTrailTimer);
    fireflyTrailTimer = setInterval(createFireflyTrails, 500);
  }

  // Stop the visitor system
  function stopVisitors() {
    if (visitorSpawnTimer) clearTimeout(visitorSpawnTimer);
    if (fireflyTrailTimer) clearInterval(fireflyTrailTimer);
  }

  // Clear all existing visitors (used on theme change)
  function clearAllVisitors() {
    var existing = visitorsLayer.querySelectorAll('.visitor');
    existing.forEach(function (el) {
      el.remove();
    });
    activeVisitors = [];
  }

  // Watch for theme changes to swap visitors
  var lastThemeCheck = false;
  setInterval(function () {
    var currentNight = isNightTheme();
    if (currentNight !== lastThemeCheck) {
      lastThemeCheck = currentNight;
      // Theme changed — clear visitors so new ones match the theme
      clearAllVisitors();
    }
  }, 2000);

  // Start visitors when grid is revealed
  var originalRevealGrid = revealGrid;
  revealGrid = function () {
    originalRevealGrid();
    startVisitors();
  };

  // Also start on restore if grid is already revealed
  var originalRestoreGardenState = restoreGardenState;
  restoreGardenState = function (state) {
    originalRestoreGardenState(state);
    if (gridRevealed) {
      startVisitors();
    }
  };

  // Update theme check initial state
  lastThemeCheck = isNightTheme();

  // ── Ambient Soundscape (Web Audio API) ──
  var soundscapeToggle = document.getElementById('soundscapeToggle');
  var soundscapeIcon = document.getElementById('soundscapeIcon');
  var audioCtx = null;
  var isSoundscapeActive = false;
  var soundscapeNodes = [];
  var soundscapeTimers = [];
  var masterGain = null;

  // Theme-based soundscape configuration
  var soundscapeConfig = {
    dawn: {
      birdChirpFreq: 0.4,
      birdChirpRate: 3000,
      breezeFreq: 200,
      breezeDepth: 0.3,
      waterDropRate: 8000,
      cricketRate: 0,
      baseVolume: 0.15
    },
    day: {
      birdChirpFreq: 0.6,
      birdChirpRate: 2000,
      breezeFreq: 250,
      breezeDepth: 0.25,
      waterDropRate: 6000,
      cricketRate: 0,
      baseVolume: 0.12
    },
    dusk: {
      birdChirpFreq: 0.3,
      birdChirpRate: 4000,
      breezeFreq: 180,
      breezeDepth: 0.35,
      waterDropRate: 10000,
      cricketRate: 0,
      baseVolume: 0.14
    },
    night: {
      birdChirpFreq: 0.05,
      birdChirpRate: 12000,
      breezeFreq: 120,
      breezeDepth: 0.4,
      waterDropRate: 15000,
      cricketRate: 2500,
      baseVolume: 0.1
    }
  };

  function getCurrentTheme() {
    if (document.body.classList.contains('theme-dawn')) return 'dawn';
    if (document.body.classList.contains('theme-day')) return 'day';
    if (document.body.classList.contains('theme-dusk')) return 'dusk';
    return 'night';
  }

  function initAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(audioCtx.destination);
  }

  function createBreezeDrone(config) {
    if (!audioCtx || !masterGain) return null;

    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    var filter = audioCtx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.value = config.breezeFreq;

    filter.type = 'lowpass';
    filter.frequency.value = config.breezeFreq * 2;
    filter.Q.value = 1;

    gain.gain.value = config.baseVolume * config.breezeDepth;

    // Add gentle frequency modulation for natural feel
    var lfo = audioCtx.createOscillator();
    var lfoGain = audioCtx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1 + Math.random() * 0.2;
    lfoGain.gain.value = config.breezeFreq * 0.1;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start();

    soundscapeNodes.push({ osc: osc, lfo: lfo, gain: gain });

    return { osc: osc, gain: gain, lfo: lfo };
  }

  function createBirdChirp(config) {
    if (!audioCtx || !masterGain) return;
    if (Math.random() > config.birdChirpFreq) return;

    var now = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    var filter = audioCtx.createBiquadFilter();

    // Random bird-like frequency
    var baseFreq = 1500 + Math.random() * 2000;
    osc.type = 'sine';
    osc.frequency.value = baseFreq;

    filter.type = 'bandpass';
    filter.frequency.value = baseFreq;
    filter.Q.value = 10;

    gain.gain.value = 0;

    // Chirp envelope: quick attack, short sustain, quick decay
    var chirpDuration = 0.08 + Math.random() * 0.12;
    var numNotes = 1 + Math.floor(Math.random() * 3);

    for (var i = 0; i < numNotes; i++) {
      var noteStart = now + i * (chirpDuration + 0.05);
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(config.baseVolume * 0.3, noteStart + 0.02);
      gain.gain.linearRampToValueAtTime(config.baseVolume * 0.2, noteStart + chirpDuration * 0.5);
      gain.gain.linearRampToValueAtTime(0, noteStart + chirpDuration);

      // Frequency sweep for natural chirp
      osc.frequency.setValueAtTime(baseFreq + Math.random() * 500, noteStart);
      osc.frequency.linearRampToValueAtTime(baseFreq - 200 + Math.random() * 400, noteStart + chirpDuration);
    }

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + numNotes * (chirpDuration + 0.1) + 0.1);
  }

  function createWaterDrop(config) {
    if (!audioCtx || !masterGain) return;

    var now = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    var filter = audioCtx.createBiquadFilter();

    // Water droplet: high frequency ping with quick decay
    var dropFreq = 2000 + Math.random() * 2000;
    osc.type = 'sine';
    osc.frequency.value = dropFreq;

    filter.type = 'highpass';
    filter.frequency.value = 1500;
    filter.Q.value = 5;

    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(config.baseVolume * 0.15, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  function createCricketClick(config) {
    if (!audioCtx || !masterGain) return;
    if (Math.random() > 0.3) return;

    var now = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    var filter = audioCtx.createBiquadFilter();

    // Cricket: rapid high-frequency pulses
    var cricketFreq = 4000 + Math.random() * 2000;
    osc.type = 'square';
    osc.frequency.value = cricketFreq;

    filter.type = 'bandpass';
    filter.frequency.value = cricketFreq;
    filter.Q.value = 20;

    gain.gain.value = 0;

    // Rapid on-off pattern
    var clickDuration = 0.02;
    var numClicks = 2 + Math.floor(Math.random() * 4);
    for (var i = 0; i < numClicks; i++) {
      var clickStart = now + i * (clickDuration + 0.03);
      gain.gain.setValueAtTime(0, clickStart);
      gain.gain.linearRampToValueAtTime(config.baseVolume * 0.08, clickStart + 0.005);
      gain.gain.linearRampToValueAtTime(0, clickStart + clickDuration);
    }

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + numClicks * (clickDuration + 0.04) + 0.05);
  }

  function scheduleSounds(config) {
    if (!isSoundscapeActive) return;

    // Schedule bird chirps
    if (config.birdChirpFreq > 0) {
      var birdTimer = setTimeout(function () {
        if (!isSoundscapeActive) return;
        createBirdChirp(config);
        scheduleSounds(config);
      }, config.birdChirpRate * (0.5 + Math.random()));
      soundscapeTimers.push(birdTimer);
    }

    // Schedule water drops
    if (config.waterDropRate > 0) {
      var waterTimer = setTimeout(function () {
        if (!isSoundscapeActive) return;
        createWaterDrop(config);
        scheduleSounds(config);
      }, config.waterDropRate * (0.5 + Math.random()));
      soundscapeTimers.push(waterTimer);
    }

    // Schedule cricket clicks (night only)
    if (config.cricketRate > 0) {
      var cricketTimer = setTimeout(function () {
        if (!isSoundscapeActive) return;
        createCricketClick(config);
        scheduleSounds(config);
      }, config.cricketRate * (0.5 + Math.random()));
      soundscapeTimers.push(cricketTimer);
    }
  }

  function startSoundscape() {
    initAudioContext();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    var theme = getCurrentTheme();
    var config = soundscapeConfig[theme];

    // Fade in master volume
    masterGain.gain.linearRampToValueAtTime(config.baseVolume, audioCtx.currentTime + 1);

    // Start breeze drone
    createBreezeDrone(config);

    // Schedule initial sounds
    scheduleSounds(config);

    isSoundscapeActive = true;
    soundscapeToggle.classList.add('active');
    soundscapeIcon.textContent = '🔊';
  }

  function stopSoundscape() {
    if (!audioCtx || !masterGain) return;

    // Fade out
    masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);

    // Clear all timers
    soundscapeTimers.forEach(function (timer) {
      clearTimeout(timer);
    });
    soundscapeTimers = [];

    // Stop all oscillators after fade
    setTimeout(function () {
      soundscapeNodes.forEach(function (node) {
        try {
          node.osc.stop();
          node.lfo.stop();
        } catch (e) {
          // Already stopped
        }
      });
      soundscapeNodes = [];
    }, 600);

    isSoundscapeActive = false;
    soundscapeToggle.classList.remove('active');
    soundscapeIcon.textContent = '🔇';
  }

  function updateSoundscapeForTheme() {
    if (!isSoundscapeActive) return;

    var theme = getCurrentTheme();
    var config = soundscapeConfig[theme];

    // Update master volume for new theme
    masterGain.gain.linearRampToValueAtTime(config.baseVolume, audioCtx.currentTime + 0.5);

    // Restart breeze drone with new params
    soundscapeNodes.forEach(function (node) {
      try {
        node.osc.stop();
        node.lfo.stop();
      } catch (e) {}
    });
    soundscapeNodes = [];

    createBreezeDrone(config);
  }

  // Listen for theme changes to update soundscape
  var lastSoundscapeTheme = getCurrentTheme();
  setInterval(function () {
    var currentTheme = getCurrentTheme();
    if (currentTheme !== lastSoundscapeTheme) {
      lastSoundscapeTheme = currentTheme;
      updateSoundscapeForTheme();
    }
  }, 5000);

  // Toggle handler
  soundscapeToggle.addEventListener('click', function () {
    if (isSoundscapeActive) {
      stopSoundscape();
    } else {
      startSoundscape();
    }
  });

  soundscapeToggle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isSoundscapeActive) {
        stopSoundscape();
      } else {
        startSoundscape();
      }
    }
  });

  // ── Garden Reflection Stats ──
  var gardenStats = document.getElementById('gardenStats');
  var statsRevealed = false;
  var statFlowersValue = document.getElementById('statFlowersValue');
  var statFlowersEmoji = document.getElementById('statFlowersEmoji');
  var statFlowersLabel = document.getElementById('statFlowersLabel');
  var statSeasonValue = document.getElementById('statSeasonValue');
  var statSeasonEmoji = document.getElementById('statSeasonEmoji');
  var statTendedValue = document.getElementById('statTendedValue');
  var statTendedEmoji = document.getElementById('statTendedEmoji');
  var statMoodValue = document.getElementById('statMoodValue');
  var statMoodEmoji = document.getElementById('statMoodEmoji');
  var statMoodCard = document.getElementById('statMoodCard');
  var statsPoem = document.getElementById('statsPoem');
  var statsUpdateTimer = null;

  // Season configuration
  var seasonConfig = {
    dawn: { label: 'dawn', emoji: '🌅', poem: 'the garden awakens with the sun' },
    day: { label: 'day', emoji: '☀️', poem: 'light bathes every leaf and petal' },
    dusk: { label: 'dusk', emoji: '🌇', poem: 'golden hour soothes the garden' },
    night: { label: 'night', emoji: '🌙', poem: 'the garden dreams under starlight' }
  };

  // Garden mood configuration
  var moodStates = {
    thriving: {
      label: 'thriving',
      emoji: '🌿',
      poem: 'your garden pulses with vibrant life — every petal reaches for the light',
      moodClass: 'mood-thriving'
    },
    flourishing: {
      label: 'flourishing',
      emoji: '🌻',
      poem: 'a warm abundance fills your garden — the fruits of care made visible',
      moodClass: 'mood-flourishing'
    },
    growing: {
      label: 'growing',
      emoji: '🌱',
      poem: 'steady and sure, your garden grows — each day brings new possibility',
      moodClass: 'mood-growing'
    },
    resting: {
      label: 'resting',
      emoji: '🍂',
      poem: 'even gardens need stillness — rest is part of the cycle',
      moodClass: 'mood-resting'
    },
    dormant: {
      label: 'dormant',
      emoji: '💤',
      poem: 'the seeds of return are planted — your garden awaits your touch',
      moodClass: 'mood-dormant'
    }
  };

  // Compute total flowers bloomed across all cycles
  function getTotalFlowersBloomed() {
    var total = 0;
    // Count from journal entries (each plant + each cycle)
    for (var i = 0; i < journalEntries.length; i++) {
      var entry = journalEntries[i];
      if (entry.type === 'plant') {
        total += 1;
      } else if (entry.type === 'cycle') {
        total += 1;
      }
      // Water entries don't add flowers
    }
    // If no journal entries yet but tiles are planted, count planted tiles
    if (total === 0) {
      tiles.forEach(function (tile) {
        if (tile.classList.contains('planted')) {
          total += 1;
        }
      });
    }
    return total;
  }

  // Get current season name
  function getCurrentSeasonName() {
    var hour = new Date().getHours();
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 17) return 'day';
    if (hour >= 17 && hour < 20) return 'dusk';
    return 'night';
  }

  // Compute garden mood based on tending recency and blooming flowers
  function computeGardenMood() {
    var blooming = getBloomingCount();
    var planted = getPlantedCount();
    var now = Date.now();
    var lastTendedMs = now;

    // Find the most recent journal entry timestamp
    if (journalEntries.length > 0) {
      var latestEntry = journalEntries[journalEntries.length - 1];
      if (latestEntry.timestamp) {
        lastTendedMs = latestEntry.timestamp;
      }
    }

    var diffMs = now - lastTendedMs;
    var diffHours = diffMs / 3600000;

    // Mood logic:
    // thriving: blooming >= 3 AND tended within 1 hour
    // flourishing: blooming >= 2 AND tended within 3 hours
    // growing: planted >= 1 AND tended within 12 hours
    // resting: planted >= 1 AND tended within 48 hours
    // dormant: planted == 0 OR tended > 48 hours
    if (planted === 0 && blooming === 0) {
      return moodStates.dormant;
    }
    if (blooming >= 3 && diffHours < 1) {
      return moodStates.thriving;
    }
    if (blooming >= 2 && diffHours < 3) {
      return moodStates.flourishing;
    }
    if (planted >= 1 && diffHours < 12) {
      return moodStates.growing;
    }
    if (planted >= 1 && diffHours < 48) {
      return moodStates.resting;
    }
    return moodStates.dormant;
  }

  // Format relative time for display
  function formatRelativeTime(timestamp) {
    if (!timestamp) return 'never';
    var diffMs = Date.now() - timestamp;
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 7) return diffDays + 'd ago';
    return 'a while ago';
  }

  // Animate a stat value change
  function animateStatValue(el) {
    if (!el) return;
    el.classList.remove('updating');
    void el.offsetWidth; // force reflow
    el.classList.add('updating');
    setTimeout(function () {
      el.classList.remove('updating');
    }, 400);
  }

  // Reveal the stats panel
  function revealStats() {
    if (statsRevealed) return;
    statsRevealed = true;
    gardenStats.classList.add('visible');
    gardenStats.setAttribute('aria-hidden', 'false');
  }

  // Update all stats
  function updateStats() {
    if (!statsRevealed) {
      // Check if we should reveal (after first journal entry / first plant)
      if (journalEntries.length > 0 || plantedCount > 0) {
        revealStats();
      } else {
        return;
      }
    }

    // 1. Total flowers bloomed
    var totalFlowers = getTotalFlowersBloomed();
    if (statFlowersValue) {
      var newText = '' + totalFlowers;
      if (statFlowersValue.textContent !== newText) {
        statFlowersValue.textContent = newText;
        animateStatValue(statFlowersValue);
      }
    }
    if (statFlowersLabel) {
      statFlowersLabel.textContent = totalFlowers === 1 ? 'flower bloomed' : 'flowers bloomed';
    }
    if (statFlowersEmoji) {
      statFlowersEmoji.textContent = totalFlowers === 1 ? '🌸' : '🌸';
    }

    // 2. Current season
    var seasonName = getCurrentSeasonName();
    var season = seasonConfig[seasonName];
    if (statSeasonValue) {
      statSeasonValue.textContent = season.label;
    }
    if (statSeasonEmoji) {
      statSeasonEmoji.textContent = season.emoji;
    }

    // 3. Time since last tending
    var lastTimestamp = null;
    if (journalEntries.length > 0) {
      var latestEntry = journalEntries[journalEntries.length - 1];
      if (latestEntry.timestamp) {
        lastTimestamp = latestEntry.timestamp;
      }
    }
    if (statTendedValue) {
      statTendedValue.textContent = formatRelativeTime(lastTimestamp);
    }
    if (statTendedEmoji) {
      if (!lastTimestamp) {
        statTendedEmoji.textContent = '🌱';
      } else {
        var diffH = (Date.now() - lastTimestamp) / 3600000;
        if (diffH < 1) statTendedEmoji.textContent = '✨';
        else if (diffH < 12) statTendedEmoji.textContent = '🌱';
        else if (diffH < 48) statTendedEmoji.textContent = '🍂';
        else statTendedEmoji.textContent = '💤';
      }
    }

    // 4. Garden mood
    var mood = computeGardenMood();
    if (statMoodValue) {
      statMoodValue.textContent = mood.label;
    }
    if (statMoodEmoji) {
      statMoodEmoji.textContent = mood.emoji;
    }
    if (statMoodCard) {
      // Remove old mood classes
      statMoodCard.classList.remove(
        'mood-thriving', 'mood-flourishing', 'mood-growing', 'mood-resting', 'mood-dormant'
      );
      statMoodCard.classList.add(mood.moodClass);
    }

    // 5. Poem
    if (statsPoem) {
      var poemText = mood.poem;
      if (plantedCount === 0 && journalEntries.length === 0) {
        poemText = 'plant a seed to begin your garden\'s story';
      }
      if (statsPoem.textContent !== poemText) {
        statsPoem.textContent = poemText;
        statsPoem.classList.remove('visible');
        void statsPoem.offsetWidth;
        statsPoem.classList.add('visible');
      }
    }
  }

  // Schedule periodic stats updates
  function scheduleStatsUpdate() {
    if (statsUpdateTimer) clearInterval(statsUpdateTimer);
    // Update every 30 seconds to refresh relative times
    statsUpdateTimer = setInterval(function () {
      if (statsRevealed) {
        updateStats();
      }
    }, 30000);
  }

  // Hook into existing events to trigger stats updates
  // Wrap plantTile to update stats after planting
  var originalPlantTile = plantTile;
  plantTile = function (tileEl) {
    originalPlantTile(tileEl);
    // Update stats after the planting animation begins
    setTimeout(function () {
      updateStats();
    }, 100);
    // Also update after bloom completes
    setTimeout(function () {
      updateStats();
    }, 3000);
  };

  // Wrap addJournalEntry to update stats
  var originalAddJournalEntry = addJournalEntry;
  addJournalEntry = function (tileIndex, petalColor, cycleNum) {
    originalAddJournalEntry(tileIndex, petalColor, cycleNum);
    setTimeout(function () {
      updateStats();
    }, 100);
  };

  // Update stats on cycle changes (growth cycle wilting/blooming)
  var originalStartGrowthCycle = startGrowthCycle;
  startGrowthCycle = function (tileEl, tileIndex) {
    originalStartGrowthCycle(tileEl, tileIndex);
    setTimeout(function () {
      updateStats();
    }, 100);
  };

  // Update stats on restore
  var originalRestoreGardenStateForStats = restoreGardenState;
  restoreGardenState = function (state) {
    originalRestoreGardenStateForStats(state);
    setTimeout(function () {
      updateStats();
    }, 200);
  };

  // Start the stats update timer
  scheduleStatsUpdate();

  // Also update on theme change (season display)
  var lastStatsTheme = getCurrentSeasonName();
  setInterval(function () {
    var currentTheme = getCurrentSeasonName();
    if (currentTheme !== lastStatsTheme) {
      lastStatsTheme = currentTheme;
      updateStats();
    }
  }, 60000);
})();
