import { dom, plantedCount, gridRevealed, tendingRevealed, journalRevealed, wateredTiles, tileCycleState, tileColorMap, petalPalettes, CYCLE_HOLD_BLOOM, CYCLE_WILT_DURATION, CYCLE_PAUSE_AFTER_WILT, CYCLE_SEED_OFFSET, totalTiles, getRandomGridMessage, getRandomWateringHint, getRandomCycleMessage } from './state.js';
import { saveGardenState, applyTileColors } from './persistence.js';
import { addJournalEntry } from './journal.js';
import { notifyStatsChange } from './stats.js';

var wateringMode = false;

function createTileSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.35;

  for (var i = 0; i < 6; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('tile-sparkle');
    var angle = (Math.PI * 2 * i) / 6;
    var distance = 1.5 + Math.random() * 1.5;
    var tx = Math.cos(angle) * distance * 8 + 'px';
    var ty = Math.sin(angle) * distance * 8 + 'px';
    sparkle.style.setProperty('--tx', tx);
    sparkle.style.setProperty('--ty', ty);
    sparkle.style.left = centerX + 'px';
    sparkle.style.top = centerY + 'px';
    tileEl.appendChild(sparkle);

    (function (s) {
      setTimeout(function () { s.remove(); }, 800);
    })(sparkle);
  }
}

function createWaterDroplets(tileEl) {
  var drop = document.createElement('div');
  drop.classList.add('tile-water-drop');
  tileEl.appendChild(drop);

  setTimeout(function () {
    drop.remove();
  }, 700);
}

function createWaterSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.4;

  for (var i = 0; i < 8; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('tile-water-sparkle');
    var angle = (Math.PI * 2 * i) / 8;
    var distance = 1.5 + Math.random() * 2;
    var tx = Math.cos(angle) * distance * 10 + 'px';
    var ty = Math.sin(angle) * distance * 10 + 'px';
    sparkle.style.setProperty('--tx', tx);
    sparkle.style.setProperty('--ty', ty);
    sparkle.style.left = centerX + 'px';
    sparkle.style.top = centerY + 'px';
    tileEl.appendChild(sparkle);

    (function (s) {
      setTimeout(function () { s.remove(); }, 900);
    })(sparkle);
  }
}

function addWateredIcon(tileEl) {
  var existing = tileEl.querySelector('.tile-watered-icon');
  if (existing) existing.remove();

  var icon = document.createElement('div');
  icon.classList.add('tile-watered-icon');
  icon.textContent = '💧';
  icon.setAttribute('aria-hidden', 'true');
  tileEl.appendChild(icon);

  requestAnimationFrame(function () {
    icon.classList.add('visible');
  });
}

function applySpeedBoost(tileEl) {
  var sprout = tileEl.querySelector('.tile-sprout');
  if (sprout) {
    sprout.classList.add('water-bloom');
    setTimeout(function () {
      sprout.classList.remove('water-bloom');
    }, 1000);
  }
}

export function updateCounter(count) {
  var counter = dom.counter;
  if (!counter) return;
  counter.innerHTML = 'planted <span>' + count + '</span> / ' + totalTiles;
  counter.style.opacity = '1';
}

export function revealGrid() {
  if (gridRevealed.value) return;
  gridRevealed.value = true;

  var gardenGridWrapper = dom.gardenGridWrapper;
  var gridHint = dom.gridHint;

  if (gardenGridWrapper) {
    gardenGridWrapper.classList.add('visible');
    gardenGridWrapper.setAttribute('aria-hidden', 'false');
  }

  if (gridHint) {
    gridHint.textContent = getRandomGridMessage();
    gridHint.style.opacity = '1';
  }

  updateCounter(plantedCount.value);
}

function revealTending() {
  if (tendingRevealed.value) return;
  tendingRevealed.value = true;

  var tendingToolbar = dom.tendingToolbar;
  var tendingHint = dom.tendingHint;

  if (tendingToolbar) {
    tendingToolbar.classList.add('visible');
    tendingToolbar.setAttribute('aria-hidden', 'false');
  }

  if (tendingHint) {
    tendingHint.textContent = getRandomWateringHint();
    tendingHint.style.opacity = '1';
  }
}

export function startGrowthCycle(tileEl, tileIndex) {
  var state = tileCycleState[tileIndex];
  if (!state) return;

  var tileSprout = tileEl.querySelector('.tile-sprout');
  var tileSeed = tileEl.querySelector('.tile-seed');
  var badge = tileEl.querySelector('.tile-cycle-badge');
  var palette = petalPalettes[tileIndex % petalPalettes.length];
  var primaryColor = palette[0];
  var gridHint = dom.gridHint;

  tileSprout.classList.remove('growing', 'budding', 'blooming', 'grown', 'wilting');
  tileEl.classList.remove('reseeding');
  tileSeed.classList.remove('visible');

  tileEl.classList.add('reseeding');
  tileSeed.classList.add('visible');

  var seedTimeout = setTimeout(function () {
    tileSprout.classList.add('growing');
  }, 500);

  var budTimeout = setTimeout(function () {
    tileSprout.classList.remove('growing');
    tileSprout.classList.add('budding');
  }, 1400);

  var bloomTimeout = setTimeout(function () {
    tileSprout.classList.remove('budding');
    tileSprout.classList.add('blooming');
  }, 2000);

  var grownTimeout = setTimeout(function () {
    tileSprout.classList.remove('blooming');
    tileSprout.classList.add('grown');
    createTileSparkles(tileEl);

    if (badge) {
      badge.textContent = '🌸 ' + state.cycle;
      badge.classList.add('visible');
    }

    if (state.cycle > 1) {
      addJournalEntry(tileIndex, primaryColor, state.cycle);
    }

    notifyStatsChange();

    if (state.cycle > 1 && gridHint) {
      gridHint.style.opacity = '0';
      setTimeout(function () {
        gridHint.textContent = getRandomCycleMessage();
        gridHint.style.opacity = '1';
      }, 300);
    }

    var offset = tileIndex * CYCLE_SEED_OFFSET;
    var wiltDelay = CYCLE_HOLD_BLOOM + offset;

    var wiltTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;

      tileSprout.classList.remove('grown');
      tileSprout.classList.add('wilting');

      var restartTimeout = setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;

        if (badge) {
          badge.classList.remove('visible');
        }

        state.cycle++;
        startGrowthCycle(tileEl, tileIndex);
        saveGardenState();
      }, CYCLE_WILT_DURATION + CYCLE_PAUSE_AFTER_WILT);

      state.timeouts = state.timeouts || [];
      state.timeouts.push(restartTimeout);
    }, wiltDelay);

    state.timeouts = state.timeouts || [];
    state.timeouts.push(wiltTimeout);

  }, 2700);

  state.timeouts = state.timeouts || [];
  state.timeouts.push(seedTimeout, budTimeout, bloomTimeout, grownTimeout);
}

export function plantTile(tileEl) {
  if (tileEl.classList.contains('planted')) return;

  var tileIndex = parseInt(tileEl.getAttribute('data-tile'), 10);
  var gridHint = dom.gridHint;

  var palette = applyTileColors(tileEl, tileIndex);
  var primaryColor = palette[0];
  tileColorMap[tileIndex] = primaryColor;

  tileCycleState[tileIndex] = { cycle: 1, stage: 'planted', timeouts: [] };

  tileEl.classList.add('planted');
  tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted');

  var tileSeed = tileEl.querySelector('.tile-seed');
  tileSeed.classList.add('visible');

  setTimeout(function () {
    var tileSprout = tileEl.querySelector('.tile-sprout');
    tileSprout.classList.add('growing');
  }, 500);

  setTimeout(function () {
    var tileSprout = tileEl.querySelector('.tile-sprout');
    tileSprout.classList.remove('growing');
    tileSprout.classList.add('budding');
  }, 1400);

  setTimeout(function () {
    var tileSprout = tileEl.querySelector('.tile-sprout');
    tileSprout.classList.remove('budding');
    tileSprout.classList.add('blooming');
  }, 2000);

  setTimeout(function () {
    var tileSprout = tileEl.querySelector('.tile-sprout');
    tileSprout.classList.remove('blooming');
    tileSprout.classList.add('grown');
    createTileSparkles(tileEl);

    var badge = tileEl.querySelector('.tile-cycle-badge');
    if (badge) {
      badge.textContent = '🌸 1';
      badge.classList.add('visible');
    }

    plantedCount.value++;
    updateCounter(plantedCount.value);

    revealTending();
    addJournalEntry(tileIndex, primaryColor, 1);
    saveGardenState();
    notifyStatsChange();

    if (gridHint) {
      gridHint.style.opacity = '0';
      setTimeout(function () {
        gridHint.textContent = getRandomGridMessage();
        gridHint.style.opacity = '1';
      }, 300);
    }

    var offset = tileIndex * CYCLE_SEED_OFFSET;
    var firstWiltDelay = CYCLE_HOLD_BLOOM + offset;

    setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;

      tileSprout.classList.remove('grown');
      tileSprout.classList.add('wilting');

      setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;

        if (badge) {
          badge.classList.remove('visible');
        }

        tileCycleState[tileIndex].cycle = 2;
        startGrowthCycle(tileEl, tileIndex);
      }, CYCLE_WILT_DURATION + CYCLE_PAUSE_AFTER_WILT);
    }, firstWiltDelay);
  }, 2700);
}

export function toggleWateringMode() {
  var wateringCanBtn = dom.wateringCanBtn;
  var tendingHint = dom.tendingHint;
  var tiles = dom.tiles;

  wateringMode = !wateringMode;

  if (wateringMode) {
    wateringCanBtn.classList.add('active');
    wateringCanBtn.setAttribute('aria-pressed', 'true');
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'click on planted tiles to water them';
      tendingHint.style.opacity = '1';
    }, 300);

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

    tiles.forEach(function (tile) {
      tile.classList.remove('watering-target');
    });
  }
}

export function waterTile(tileEl, tileIndex) {
  var tendingHint = dom.tendingHint;

  if (wateredTiles[tileIndex]) return;

  wateredTiles[tileIndex] = true;

  tileEl.classList.add('watered');
  createWaterDroplets(tileEl);
  createWaterSparkles(tileEl);
  addWateredIcon(tileEl);
  applySpeedBoost(tileEl);

  var state = tileCycleState[tileIndex];
  if (state) {
    var sprout = tileEl.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.add('speed-up');
    }

    if (sprout && sprout.classList.contains('grown')) {
      var speedWiltTimeout = setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;
        if (!sprout.classList.contains('grown')) return;

        sprout.classList.remove('grown');
        sprout.classList.add('wilting');

        var speedRestartTimeout = setTimeout(function () {
          if (!tileEl.classList.contains('planted')) return;

          var badge = tileEl.querySelector('.tile-cycle-badge');
          if (badge) {
            badge.classList.remove('visible');
          }

          wateredTiles[tileIndex] = false;
          tileEl.classList.remove('watered');
          var icon = tileEl.querySelector('.tile-watered-icon');
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
      var resetTimeout = setTimeout(function () {
        wateredTiles[tileIndex] = false;
        tileEl.classList.remove('watered');
        var icon = tileEl.querySelector('.tile-watered-icon');
        if (icon) icon.remove();
        if (sprout) sprout.classList.remove('speed-up');
      }, 8000);

      state.timeouts = state.timeouts || [];
      state.timeouts.push(resetTimeout);
    }
  }

  var palette = petalPalettes[tileIndex % petalPalettes.length];
  addJournalEntry(tileIndex, palette[0], state ? state.cycle : 1);

  if (journalEntries.length > 0) {
    journalEntries[journalEntries.length - 1].type = 'watered';
    journalEntries[journalEntries.length - 1].subText = 'growth speed increased by 50%';
  }

  var journalTimeline = dom.journalTimeline;
  if (journalTimeline) {
    var firstEntry = journalTimeline.firstChild;
    if (firstEntry) {
      var textEl = firstEntry.querySelector('.entry-text');
      if (textEl) {
        textEl.innerHTML = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 💧 watered';
      }
      var timeEl = firstEntry.querySelector('.entry-time');
      if (timeEl) {
        timeEl.textContent = 'growth speed increased by 50%';
      }
    }
  }

  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'growth speed increased by 50% ✨';
      tendingHint.style.opacity = '1';
    }, 300);
  }

  saveGardenState();
  notifyStatsChange();
}

export function isWateringMode() {
  return wateringMode;
}
