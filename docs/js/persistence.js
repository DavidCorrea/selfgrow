import { dom, journalEntries, wateredTiles, fertilizedTiles, prunedTiles, tileCycleState, tileColorMap, tileFlowerTypeMap, plantedCount, totalVolunteers, gridRevealed, journalRevealed, tendingRevealed, petalPalettes, centerColors, flowerTypes, getRandomGridMessage, getRandomWateringHint, getRandomCycleMessage, CYCLE_HOLD_BLOOM, CYCLE_SEED_OFFSET, CYCLE_WILT_DURATION, CYCLE_PAUSE_AFTER_WILT } from './state.js';

import { formatTime } from './journal.js';
import { getCurrentWeather, getWeatherModifier } from './weather.js';
import { isNightTheme } from './theme.js';

var STORAGE_KEY = 'selfgrow_garden_state';

export function saveGardenState() {
  var state = {
    version: 1,
    lastTended: Date.now(),
    plantedTiles: {},
    wateredTiles: {},
    fertilizedTiles: {},
    prunedTiles: {},
    tileCycleState: {},
    tileColorMap: {},
    tileFlowerTypeMap: {},
    journalEntries: journalEntries,
    plantedCount: plantedCount.value,
    totalVolunteers: totalVolunteers.value,
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
      if (fertilizedTiles[tileIndex]) {
        state.fertilizedTiles[tileIndex] = true;
      }
      if (prunedTiles[tileIndex]) {
        state.prunedTiles[tileIndex] = true;
      }
      if (tileCycleState[tileIndex]) {
        state.tileCycleState[tileIndex] = {
          cycle: tileCycleState[tileIndex].cycle,
          stage: tileCycleState[tileIndex].stage || 'planted',
          isVolunteer: tileCycleState[tileIndex].isVolunteer || false,
          flowerType: tileCycleState[tileIndex].flowerType || tileFlowerTypeMap[tileIndex] || null
        };
      }
      if (tileColorMap[tileIndex]) {
        state.tileColorMap[tileIndex] = tileColorMap[tileIndex];
      }
      if (tileFlowerTypeMap[tileIndex]) {
        state.tileFlowerTypeMap[tileIndex] = tileFlowerTypeMap[tileIndex];
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

export function applyTileColors(tileEl, tileIndex, flowerType) {
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

  // Apply flower type CSS class for morphology
  if (flowerType) {
    var sproutEl = tileEl.querySelector('.tile-sprout');
    if (sproutEl) {
      // Remove any existing flower type classes
      flowerTypes.forEach(function (ft) {
        sproutEl.classList.remove('flower-' + ft);
      });
      sproutEl.classList.add('flower-' + flowerType);

      // Moonflower: closed bud during day, blooming at night
      if (flowerType === 'moonflower') {
        if (isNightTheme()) {
          sproutEl.classList.remove('moonflower-closed');
          sproutEl.classList.add('moonflower-bloom');
        } else {
          sproutEl.classList.remove('moonflower-bloom');
          sproutEl.classList.add('moonflower-closed');
        }
      }
    }
  }

  return palette;
}

export function addWateredIcon(tileEl) {
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

export function addFertilizedIcon(tileEl) {
  var existing = tileEl.querySelector('.tile-fertilized-icon');
  if (existing) existing.remove();

  var icon = document.createElement('div');
  icon.classList.add('tile-fertilized-icon');
  icon.textContent = '🌾';
  icon.setAttribute('aria-hidden', 'true');
  tileEl.appendChild(icon);

  requestAnimationFrame(function () {
    icon.classList.add('visible');
  });
}

function getWeatherEmoji(weatherState) {
  var emojis = { sunny: '☀️', rainy: '🌧️', cloudy: '☁️', snowy: '❄️' };
  return emojis[weatherState] || '🌤️';
}

function getWeatherDefaultMessage(weatherState) {
  var msgs = {
    sunny: 'sunlight quickens the blooms',
    rainy: 'a gentle rain nourishes your garden',
    cloudy: 'the garden breathes under overcast skies',
    snowy: 'snow blankets the garden in stillness'
  };
  return msgs[weatherState] || 'the sky shifts';
}

export function restoreWelcomeCard(state) {
  if (!state || !state.plantedCount || state.plantedCount === 0) return;

  var seed = dom.seed;
  var sprout = dom.sprout;
  var hint = dom.hint;
  var message = dom.message;
  var card = dom.card;
  var garden = dom.garden;

  if (hint) {
    hint.classList.add('fade-out');
  }

  if (card) {
    card.classList.add('glow-intensify');
  }

  if (seed) {
    seed.classList.add('visible');
  }

  if (sprout) {
    sprout.classList.add('grown');
  }

  var count = state.plantedCount || 0;

  if (message) {
    var returningMessages = [
      'welcome back, garden keeper — ' + count + ' flower' + (count !== 1 ? 's' : '') + ' blooming',
      'your garden remembers you — ' + count + ' flower' + (count !== 1 ? 's' : '') + ' await',
      'the soil stirs with familiarity — ' + count + ' bloom' + (count !== 1 ? 's' : '') + ' strong',
      'you return to find ' + count + ' flower' + (count !== 1 ? 's' : '') + ' thriving',
      'the garden has been waiting — ' + count + ' bloom' + (count !== 1 ? 's' : '') + ' greet you'
    ];
    message.textContent = returningMessages[Math.floor(Math.random() * returningMessages.length)];
    message.classList.add('visible');
  }

  if (garden) {
    garden.setAttribute('aria-label', 'Your garden — ' + count + ' flowers blooming');
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
  if (state.totalVolunteers) totalVolunteers.value = state.totalVolunteers;
  if (state.gridRevealed) gridRevealed.value = true;
  if (state.journalRevealed) journalRevealed.value = true;
  if (state.tendingRevealed) tendingRevealed.value = true;

  if (state.wateredTiles) {
    for (var wKey in state.wateredTiles) {
      wateredTiles[wKey] = state.wateredTiles[wKey];
    }
  }

  if (state.fertilizedTiles) {
    for (var fKey in state.fertilizedTiles) {
      fertilizedTiles[fKey] = state.fertilizedTiles[fKey];
    }
  }

  if (state.prunedTiles) {
    for (var pKey in state.prunedTiles) {
      prunedTiles[pKey] = state.prunedTiles[pKey];
    }
  }

  if (state.tileColorMap) {
    for (var cKey in state.tileColorMap) {
      tileColorMap[cKey] = state.tileColorMap[cKey];
    }
  }

  if (state.tileFlowerTypeMap) {
    for (var fKey in state.tileFlowerTypeMap) {
      tileFlowerTypeMap[fKey] = state.tileFlowerTypeMap[fKey];
    }
  }

  if (state.tileCycleState) {
    for (var idx in state.tileCycleState) {
      tileCycleState[idx] = {
        cycle: state.tileCycleState[idx].cycle,
        stage: state.tileCycleState[idx].stage,
        timeouts: [],
        flowerType: state.tileCycleState[idx].flowerType || null,
        isVolunteer: state.tileCycleState[idx].isVolunteer || false
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
      var isFertilized = entry.type === 'fertilized';
      var isPruned = entry.type === 'pruned';
      var isWeather = entry.type === 'weather';
      var isVolunteer = entry.type === 'volunteer';
      var isSeason = entry.type === 'season' || entry.type === 'spring-dew' || entry.type === 'spring-butterfly' || entry.type === 'summer-shimmer' || entry.type === 'autumn-leaves' || entry.type === 'autumn-frost' || entry.type === 'winter-frost' || entry.type.indexOf('season') === 0;
      var entryLabel;
      if (isSeason) {
        entryLabel = entry.seasonMessage || entry.weatherMessage || ('🌿 a rare moment in the garden');
      } else if (isWeather) {
        var weatherEmoji = getWeatherEmoji(entry.weatherState);
        entryLabel = weatherEmoji + ' ' + (entry.weatherMessage || getWeatherDefaultMessage(entry.weatherState));
      } else if (isPruned) {
        entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; ✂️ pruned';
      } else if (isFertilized) {
        entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; 🌾 fertilized';
      } else if (isWatered) {
        entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; 💧 watered';
      } else if (isCycle) {
        entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; 🌸 cycle ' + entry.cycle + ' at ' + entry.time;
      } else if (entry.type === 'volunteer') {
        entryLabel = '🌿 <strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; volunteer at ' + entry.time;
      } else {
        entryLabel = '<strong>Tile ' + (entry.tileIndex + 1) + '</strong> &mdash; planted at ' + entry.time;
      }

      var subText;
      if (isSeason) {
        subText = entry.time + ' &mdash; a rare moment';
      } else if (isWeather) {
        subText = entry.time + ' &mdash; the sky shifts';
      } else if (isPruned) {
        subText = entry.subText || 'you pinch away what has faded, inviting renewal';
      } else if (isFertilized) {
        subText = entry.subText || 'soil enriched — growth permanently boosted by 30%';
      } else if (isWatered) {
        subText = entry.subText || 'growth speed increased by 50%';
      } else if (isCycle) {
        subText = getRandomCycleMessage();
      } else if (entry.type === 'volunteer') {
        subText = entry.subText || 'a seed carried by the wind finds its home';
      } else {
        subText = 'flower #' + (i + 1) + ' in your garden';
      }

      var isVolunteerType = entry.type === 'volunteer';
      var dotClass = isSeason ? 'entry-timeline-dot entry-timeline-dot--season-event' : (isWeather ? 'entry-timeline-dot entry-timeline-dot--weather' : (isPruned ? 'entry-timeline-dot entry-timeline-dot--pruned' : (isVolunteerType ? 'entry-timeline-dot entry-timeline-dot--volunteer' : 'entry-timeline-dot')));
      var swatchClass = isSeason ? 'entry-swatch entry-swatch--season-event' : (isWeather ? 'entry-swatch entry-swatch--weather' : (isPruned ? 'entry-swatch entry-swatch--pruned' : (isVolunteerType ? 'entry-swatch entry-swatch--volunteer' : 'entry-swatch')));
      var entryClass = isSeason ? 'journal-entry journal-entry--season-event' : (isWeather ? 'journal-entry journal-entry--weather' : (isPruned ? 'journal-entry journal-entry--pruned' : (isVolunteerType ? 'journal-entry journal-entry--volunteer' : 'journal-entry')));
      entryEl.classList = entryClass;

      entryEl.innerHTML =
        '<div class="' + dotClass + '"></div>' +
        '<div class="entry-content">' +
          '<p class="entry-text">' + entryLabel + '</p>' +
          '<p class="entry-time">' + subText + '</p>' +
        '</div>' +
        '<div class="' + swatchClass + '" style="background: ' + entry.petalColor + '" aria-hidden="true"></div>';

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
  // Check if this was a volunteer tile
  var cycleData = state.tileCycleState && state.tileCycleState[tileIndex] ? state.tileCycleState[tileIndex] : null;
  var wasVolunteer = cycleData && cycleData.isVolunteer;

  var savedFlowerType = tileFlowerTypeMap[tileIndex];
  applyTileColors(tileEl, tileIndex, savedFlowerType);

  tileEl.classList.add('planted');
  if (wasVolunteer) {
    tileEl.classList.add('volunteer');
    tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' volunteer plant');
  } else {
    tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted');
  }

  if (wateredTiles[tileIndex]) {
    tileEl.classList.add('watered');
    addWateredIcon(tileEl);
  }

  if (fertilizedTiles[tileIndex]) {
    tileEl.classList.add('fertilized');
    addFertilizedIcon(tileEl);
    if (tileCycleState[tileIndex]) {
      tileCycleState[tileIndex].fertilized = true;
    }
  }

  // Apply current weather visual class to restored tile
  var currentW = getCurrentWeather();
  if (currentW === 'sunny') {
    tileEl.classList.add('weather-sunny-glow');
  } else if (currentW === 'rainy') {
    tileEl.classList.add('weather-rainy-glow');
  } else if (currentW === 'snowy') {
    tileEl.classList.add('weather-snowy-dormant');
  }

  var cycle = 1;
  if (tileCycleState[tileIndex]) {
    cycle = tileCycleState[tileIndex].cycle;
  }

  // Restore flower type CSS class on sprout
  var fType = tileFlowerTypeMap[tileIndex];
  var tileSprout = tileEl.querySelector('.tile-sprout');
  var tileSeed = tileEl.querySelector('.tile-seed');
  var badge = tileEl.querySelector('.tile-cycle-badge');

  if (fType && tileSprout) {
    flowerTypes.forEach(function (ft) {
      tileSprout.classList.remove('flower-' + ft);
    });
    tileSprout.classList.remove('flower-wildflower');
    tileSprout.classList.add('flower-' + fType);

    // Moonflower: closed bud during day, blooming at night
    if (fType === 'moonflower') {
      if (isNightTheme()) {
        tileSprout.classList.remove('moonflower-closed');
        tileSprout.classList.add('moonflower-bloom');
      } else {
        tileSprout.classList.remove('moonflower-bloom');
        tileSprout.classList.add('moonflower-closed');
      }
    }
  }

  tileSeed.classList.remove('visible');
  tileSprout.classList.remove('growing', 'budding', 'blooming', 'wilting');
  tileSprout.classList.add('grown');

  if (badge) {
    badge.textContent = wasVolunteer ? '🌿 ' + cycle : '🌸 ' + cycle;
    badge.classList.add('visible');
  }
  // Ensure flower element is visible on restored tiles
  var tileFlower = tileEl.querySelector('.tile-flower');
  if (tileFlower) {
    tileFlower.style.opacity = '1';
    tileFlower.style.width = '1.1rem';
    tileFlower.style.height = '1.1rem';
  }

  var gridHint = dom.gridHint;

  // Use weather-scaled timing on restore so weather affects growth correctly
  var wMod = getWeatherModifier();
  var wsm = wMod ? wMod.growthMultiplier : 1.0;
  var weatherScaled = function (baseMs) {
    return Math.max(baseMs * wsm, 200);
  };

  var offset = tileIndex * CYCLE_SEED_OFFSET * wsm;
  var holdBloom = weatherScaled(CYCLE_HOLD_BLOOM);
  var wiltDur = weatherScaled(CYCLE_WILT_DURATION);
  var pauseWilt = weatherScaled(CYCLE_PAUSE_AFTER_WILT);
  var wiltDelay = holdBloom + offset;

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
    }, wiltDur + pauseWilt);

    tileCycleState[tileIndex].timeouts = tileCycleState[tileIndex].timeouts || [];
    tileCycleState[tileIndex].timeouts.push(restartTimeout);
  }, wiltDelay);

  tileCycleState[tileIndex].timeouts = tileCycleState[tileIndex].timeouts || [];
  tileCycleState[tileIndex].timeouts.push(wiltTimeout);
}
