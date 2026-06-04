import { dom, journalEntries, wateredTiles, tileCycleState, tileColorMap, plantedCount, gridRevealed, journalRevealed, tendingRevealed, petalPalettes, centerColors, getRandomGridMessage, getRandomWateringHint, getRandomCycleMessage, CYCLE_HOLD_BLOOM, CYCLE_SEED_OFFSET, CYCLE_WILT_DURATION, CYCLE_PAUSE_AFTER_WILT } from './state.js';

var STORAGE_KEY = 'selfgrow_garden_state';

export function saveGardenState() {
  var state = {
    version: 1,
    lastTended: Date.now(),
    plantedTiles: {},
    wateredTiles: {},
    tileCycleState: {},
    tileColorMap: {},
    journalEntries: journalEntries,
    plantedCount: plantedCount.value,
    gridRevealed: gridRevealed.value,
    journalRevealed: journalRevealed.value,
    tendingRevealed: tendingRevealed.value
  };

  var tiles = dom.tiles;
  if (tiles) {
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
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // localStorage might be full or unavailable
  }
}

export function loadGardenState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function formatTime(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  return displayHours + ':' + displayMinutes + ' ' + ampm;
}

export function formatLastTended(timestamp) {
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

export function showRestoringOverlay() {
  var overlay = document.createElement('div');
  overlay.classList.add('restoring-overlay');
  overlay.id = 'restoringOverlay';
  overlay.innerHTML = '<span class="restoring-text">🌱 restoring your garden...</span>';
  document.body.appendChild(overlay);
  requestAnimationFrame(function () {
    overlay.classList.add('visible');
  });
}

export function hideRestoringOverlay() {
  var overlay = document.getElementById('restoringOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    setTimeout(function () {
      overlay.remove();
    }, 600);
  }
}

export function applyTileColors(tileEl, tileIndex) {
  var palette = petalPalettes[tileIndex % petalPalettes.length];
  var centerColor = centerColors[tileIndex % centerColors.length];
  var petalEls = tileEl.querySelectorAll('.tile-petal');

  petalEls.forEach(function (petal, i) {
    petal.style.background = palette[i % palette.length];
  });

  var centerEl = tileEl.querySelector('.tile-center');
  if (centerEl) {
    centerEl.style.background = centerColor;
    centerEl.style.boxShadow = '0 0 0.2rem rgba(251, 191, 36, 0.5)';
  }

  return palette;
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

export function restoreGardenState(state, callbacks) {
  if (!state) return;

  showRestoringOverlay();

  var addJournalEntry = callbacks.addJournalEntry;
  var startGrowthCycle = callbacks.startGrowthCycle;
  var updateCounter = callbacks.updateCounter;

  if (state.journalEntries && state.journalEntries.length > 0) {
    journalEntries.length = 0;
    state.journalEntries.forEach(function (e) { journalEntries.push(e); });
  }

  if (state.plantedCount) plantedCount.value = state.plantedCount;
  if (state.gridRevealed) gridRevealed.value = true;
  if (state.journalRevealed) journalRevealed.value = true;
  if (state.tendingRevealed) tendingRevealed.value = true;

  if (state.wateredTiles) {
    for (var wKey in state.wateredTiles) {
      wateredTiles[wKey] = state.wateredTiles[wKey];
    }
  }

  if (state.tileColorMap) {
    for (var cKey in state.tileColorMap) {
      tileColorMap[cKey] = state.tileColorMap[cKey];
    }
  }

  if (state.tileCycleState) {
    for (var idx in state.tileCycleState) {
      tileCycleState[idx] = {
        cycle: state.tileCycleState[idx].cycle,
        stage: state.tileCycleState[idx].stage,
        timeouts: []
      };
    }
  }

  var gardenGridWrapper = dom.gardenGridWrapper;
  var gridHint = dom.gridHint;
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;
  var tendingToolbar = dom.tendingToolbar;
  var tendingHint = dom.tendingHint;

  if (gridRevealed.value && gardenGridWrapper) {
    gardenGridWrapper.classList.add('visible');
    gardenGridWrapper.setAttribute('aria-hidden', 'false');
    gridHint.textContent = getRandomGridMessage();
    gridHint.style.opacity = '1';
    updateCounter(plantedCount.value);
  }

  if (tendingRevealed.value && tendingToolbar) {
    tendingToolbar.classList.add('visible');
    tendingToolbar.setAttribute('aria-hidden', 'false');
    tendingHint.textContent = getRandomWateringHint();
    tendingHint.style.opacity = '1';
  }

  if (journalRevealed.value && journalEntries.length > 0 && gardenJournal) {
    gardenJournal.classList.add('visible');
    gardenJournal.setAttribute('aria-hidden', 'false');

    if (journalEmpty) {
      journalEmpty.style.display = 'none';
    }

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

  if (state.lastTended) {
    var lastTendedEl = document.getElementById('journalLastTended');
    if (lastTendedEl) {
      lastTendedEl.textContent = formatLastTended(state.lastTended);
      lastTendedEl.classList.add('visible');
    }
  }

  var tiles = dom.tiles;
  if (!tiles) {
    hideRestoringOverlay();
    return;
  }

  var plantedIndices = [];
  if (state.plantedTiles) {
    for (var pIdx in state.plantedTiles) {
      plantedIndices.push(parseInt(pIdx, 10));
    }
  }

  plantedIndices.sort(function (a, b) { return a - b; });

  plantedIndices.forEach(function (tileIndex, i) {
    var tileEl = tiles[tileIndex];
    if (!tileEl) return;

    var delay = i * 200;
    setTimeout(function () {
      restorePlantedTile(tileEl, tileIndex, state, startGrowthCycle, updateCounter, addJournalEntry);
    }, delay);
  });

  var totalDelay = plantedIndices.length * 200 + 600;
  setTimeout(function () {
    hideRestoringOverlay();
  }, totalDelay);
}

function restorePlantedTile(tileEl, tileIndex, state, startGrowthCycle, updateCounter, addJournalEntry) {
  applyTileColors(tileEl, tileIndex);

  tileEl.classList.add('planted');
  tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted');

  if (wateredTiles[tileIndex]) {
    tileEl.classList.add('watered');
    addWateredIcon(tileEl);
  }

  var cycle = 1;
  if (tileCycleState[tileIndex]) {
    cycle = tileCycleState[tileIndex].cycle;
  }

  var tileSprout = tileEl.querySelector('.tile-sprout');
  var tileSeed = tileEl.querySelector('.tile-seed');
  var badge = tileEl.querySelector('.tile-cycle-badge');

  tileSeed.classList.remove('visible');
  tileSprout.classList.remove('growing', 'budding', 'blooming', 'wilting');
  tileSprout.classList.add('grown');

  if (badge) {
    badge.textContent = '🌸 ' + cycle;
    badge.classList.add('visible');
  }

  var gridHint = dom.gridHint;

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
