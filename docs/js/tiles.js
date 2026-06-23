import { dom, plantedCount, gridRevealed, tendingRevealed, journalEntries, wateredTiles, fertilizedTiles, prunedTiles, tileCycleState, tileColorMap, tileFlowerTypeMap, petalPalettes, flowerTypes, CYCLE_HOLD_BLOOM, CYCLE_WILT_DURATION, CYCLE_PAUSE_AFTER_WILT, CYCLE_SEED_OFFSET, totalTiles, getRandomGridMessage, getRandomWateringHint, getRandomCycleMessage, getRandomFertilizeHint, getRandomFertilizeMessage, getRandomPruneMessage, getRandomPruneHint, getRandomFlowerType } from './state.js';
import { isNightTheme } from './theme.js';
import { saveGardenState, applyTileColors, addWateredIcon, addFertilizedIcon } from './persistence.js';
// Note: addWateredIcon and addFertilizedIcon are imported from persistence.js
// to avoid circular dependency. Do NOT re-declare them locally below.
import { addJournalEntry } from './journal.js';
import { notifyStatsChange } from './stats.js';
import { triggerGardenComplete } from './celebration.js';
import { recordBloom } from './garden-rings.js';
import { getCurrentWeather, getWeatherModifier, onWeatherChange } from './weather.js';
import { getEcosystemGrowthMultiplier } from './ecosystem.js';
import { checkBloomMilestone, recordTendDay } from './milestones.js';

var wateringMode = false;
var fertilizeMode = false;
var pruneMode = false;

// ── Weather-Aware Growth Timing ──
// Returns a duration multiplier based on current weather
function getWeatherGrowthMultiplier() {
  var mod = getWeatherModifier();
  return mod ? mod.growthMultiplier : 1.0;
}

// Apply weather-scaled delay, ensuring a minimum so things don't feel instant
function weatherScaled(baseMs, tileIndex) {
  var scaled = baseMs * getWeatherGrowthMultiplier();
  // Apply ecosystem growth multiplier (e.g., bee pollination = 25% boost)
  if (tileIndex !== undefined && tileIndex !== null) {
    scaled *= getEcosystemGrowthMultiplier(tileIndex);
  }
  return Math.max(scaled, 200); // minimum 200ms so animations remain visible
}

// ── Weather Auto-Water Effect ──
// When rain is active, all planted tiles get auto-watered
function applyRainToAllTiles() {
  var tiles = dom.tiles;
  if (!tiles) return;

  tiles.forEach(function (tile) {
    if (!tile.classList.contains('planted')) return;
    if (tile.classList.contains('rain-watered')) return;

    var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);

    tile.classList.add('rain-watered');

    // Create rain droplets on tile
    createRainTileDroplets(tile);

    // Apply blue glow effect
    var sprout = tile.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.add('rain-bloom');
      setTimeout(function () {
        sprout.classList.remove('rain-bloom');
      }, 1500);
    }

    // If tile is in grown state, accelerate wilt (rain speeds growth)
    var state = tileCycleState[tileIndex];
    if (state && sprout && sprout.classList.contains('grown')) {
      // The rain acts like a gentle water — mark it
      if (!wateredTiles[tileIndex]) {
        wateredTiles[tileIndex] = true;
      }
    }
  });
}

function removeRainFromAllTiles() {
  var tiles = dom.tiles;
  if (!tiles) return;

  tiles.forEach(function (tile) {
    tile.classList.remove('rain-watered');
    var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
    // Reset the rain-watered flag but keep manual watering intact
    // (rain is continuous, not a one-time water)
  });
}

function createRainTileDroplets(tileEl) {
  for (var i = 0; i < 4; i++) {
    var drop = document.createElement('div');
    drop.classList.add('tile-rain-drop');
    drop.style.left = (20 + Math.random() * 60) + '%';
    drop.style.setProperty('--drop-delay', (i * 0.15) + 's');
    tileEl.appendChild(drop);

    (function (d) {
      setTimeout(function () { d.remove(); }, 800);
    })(drop);
  }
}

// ── Weather Change Handler ──
onWeatherChange(function (newWeather, oldWeather) {
  if (newWeather === 'rainy') {
    applyRainToAllTiles();
  } else if (oldWeather === 'rainy') {
    removeRainFromAllTiles();
  }

  // Update all tiles with weather-specific classes
  var tiles = dom.tiles;
  if (!tiles) return;

  tiles.forEach(function (tile) {
    // Remove all weather state classes
    tile.classList.remove('weather-sunny-glow', 'weather-rainy-glow', 'weather-snowy-dormant');
    // Add current
    if (newWeather === 'sunny') {
      tile.classList.add('weather-sunny-glow');
    } else if (newWeather === 'rainy') {
      tile.classList.add('weather-rainy-glow');
    } else if (newWeather === 'snowy') {
      tile.classList.add('weather-snowy-dormant');
    }
  });
});

// ── Tile Visual Effects ──

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
    var hints = [getRandomWateringHint(), getRandomFertilizeHint(), getRandomPruneHint()];
    tendingHint.textContent = hints[Math.floor(Math.random() * hints.length)];
    tendingHint.style.opacity = '1';
  }
}

const MAX_CONCURRENT_BLOOMS = 6;
let bloomQueue = [];
let activeBlooms = 0;
function processBloomQueue() {
  if (activeBlooms >= MAX_CONCURRENT_BLOOMS) return;
  const item = bloomQueue.shift();
  if (!item) return;
  activeBlooms++;
  item.action();
  setTimeout(() => {
    activeBlooms--;
    processBloomQueue();
  }, 800);
}
function enqueueBloom(action) {
  if (activeBlooms < MAX_CONCURRENT_BLOOMS) {
    activeBlooms++;
    action();
    setTimeout(() => {
      activeBlooms--;
      processBloomQueue();
    }, 800);
  } else {
    bloomQueue.push({action});
  }
}

export function startGrowthCycle(tileEl, tileIndex) {
  var state = tileCycleState[tileIndex];
  if (!state) return;

  // Clear any pending timeouts from previous cycle to prevent accumulation
  if (state.timeouts && state.timeouts.length > 0) {
    state.timeouts.forEach(function (t) {
      if (t) clearTimeout(t);
    });
    state.timeouts = [];
  }

  var tileSprout = tileEl.querySelector('.tile-sprout');

  // Re-apply flower type class (it gets removed during cycle transitions)
  var fType = state.flowerType || tileFlowerTypeMap[tileIndex];
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
  var tileSeed = tileEl.querySelector('.tile-seed');
  var badge = tileEl.querySelector('.tile-cycle-badge');
  var palette = petalPalettes[tileIndex % petalPalettes.length];
  var primaryColor = palette[0];
  var gridHint = dom.gridHint;

  var isRegrow = state.cycle > 1;
  var wasFertilized = tileEl.classList.contains('fertilized');

  // Weather-scaled timings (also applies ecosystem multipliers like bee pollination)
  var wsm = getWeatherGrowthMultiplier();
  var holdBloom = weatherScaled(CYCLE_HOLD_BLOOM, tileIndex);
  var wiltDur = weatherScaled(CYCLE_WILT_DURATION, tileIndex);
  var pauseWilt = weatherScaled(CYCLE_PAUSE_AFTER_WILT, tileIndex);

  if (isRegrow) {
    // ── Perennial regrowth: keep stem & leaves, only collapse flower ──
    tileSprout.classList.remove('growing', 'budding', 'blooming', 'grown', 'wilting', 'fertilized-boost', 'dormant', 'regrowing', 'regrow-bud', 'regrow-bloom', 'regrow-wilt');
    tileEl.classList.remove('reseeding', 'pruned-tile');
    tileSeed.classList.remove('visible');

    // Re-apply fertilized boost if tile was fertilized
    if (wasFertilized && tileSprout) {
      tileSprout.classList.add('fertilized-boost');
    }

    // Brief dormant state (stem & leaves persist visibly)
    tileSprout.classList.add('dormant');

    var regrowDormantDelay = weatherScaled(600);
    var regrowBudDelay = regrowDormantDelay + weatherScaled(800);
    var regrowBloomDelay = regrowBudDelay + weatherScaled(900);
    var regrowGrownDelay = regrowBloomDelay + weatherScaled(700);

    var regrowDormantTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      tileSprout.classList.remove('dormant');
      tileSprout.classList.add('regrowing');
    }, regrowDormantDelay);

    var regrowBudTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      tileSprout.classList.remove('regrowing');
      tileSprout.classList.add('regrow-bud');
    }, regrowBudDelay);

    var regrowBloomTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      tileSprout.classList.remove('regrow-bud');
      enqueueBloom(() => {
        tileSprout.classList.add('regrow-bloom');
      });
    }, regrowBloomDelay);

    var regrowGrownTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      tileSprout.classList.remove('regrow-bloom');
      tileSprout.classList.add('grown');
      createTileSparkles(tileEl);

      if (badge) {
        badge.textContent = '🌸 ' + state.cycle;
        badge.classList.add('visible');
      }

      if (state.cycle > 1) {
        addJournalEntry(tileIndex, primaryColor, state.cycle);
      }

      recordBloom(tileIndex, state.cycle);
      notifyStatsChange();
      checkBloomMilestone();

      if (state.cycle > 1 && gridHint) {
        gridHint.style.opacity = '0';
        setTimeout(function () {
          gridHint.textContent = getRandomCycleMessage();
          gridHint.style.opacity = '1';
        }, 300);
      }

      var offset = tileIndex * CYCLE_SEED_OFFSET * wsm;
      var wiltDelay = holdBloom + offset;

      var regrowWiltTimeout = setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;

        tileSprout.classList.remove('grown');
        tileSprout.classList.add('regrow-wilt');

        var regrowRestartTimeout = setTimeout(function () {
          if (!tileEl.classList.contains('planted')) return;

          tileSprout.classList.remove('regrow-wilt');

          if (badge) {
            badge.classList.remove('visible');
          }

          state.cycle++;
          startGrowthCycle(tileEl, tileIndex);
          saveGardenState();
        }, wiltDur + pauseWilt);

        state.timeouts = state.timeouts || [];
        state.timeouts.push(regrowRestartTimeout);
      }, wiltDelay);

      state.timeouts = state.timeouts || [];
      state.timeouts.push(regrowWiltTimeout);

    }, regrowGrownDelay);

    state.timeouts = state.timeouts || [];
    state.timeouts.push(regrowDormantTimeout, regrowBudTimeout, regrowBloomTimeout, regrowGrownTimeout);

  } else {
    // ── First cycle: full seed → stem → bud → bloom ──
    tileSprout.classList.remove('growing', 'budding', 'blooming', 'grown', 'wilting', 'fertilized-boost', 'dormant', 'regrowing', 'regrow-bud', 'regrow-bloom');
    tileEl.classList.remove('reseeding');
    tileSeed.classList.remove('visible');

    // Re-apply fertilized boost if tile was fertilized
    if (wasFertilized && tileSprout) {
      tileSprout.classList.add('fertilized-boost');
    }

    tileEl.classList.add('reseeding');
    tileSeed.classList.add('visible');

    var seedDelay = weatherScaled(500);
    var budDelay = weatherScaled(1400);
    var bloomDelay = weatherScaled(2000);
    var grownDelay = weatherScaled(2700);

    var seedTimeout = setTimeout(function () {
      tileSprout.classList.add('growing');
    }, seedDelay);

    var budTimeout = setTimeout(function () {
      tileSprout.classList.remove('growing');
      tileSprout.classList.add('budding');
    }, budDelay);

    var bloomTimeout = setTimeout(function () {
      enqueueBloom(() => {
        tileSprout.classList.remove('budding');
        tileSprout.classList.add('blooming');
      });
    }, bloomDelay);

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

      recordBloom(tileIndex, state.cycle);
      notifyStatsChange();
      checkBloomMilestone();

      if (state.cycle > 1 && gridHint) {
        gridHint.style.opacity = '0';
        setTimeout(function () {
          gridHint.textContent = getRandomCycleMessage();
          gridHint.style.opacity = '1';
        }, 300);
      }

      var offset = tileIndex * CYCLE_SEED_OFFSET * wsm;
      var wiltDelay = holdBloom + offset;

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
        }, wiltDur + pauseWilt);

        state.timeouts = state.timeouts || [];
        state.timeouts.push(restartTimeout);
      }, wiltDelay);

      state.timeouts = state.timeouts || [];
      state.timeouts.push(wiltTimeout);

    }, grownDelay);

    state.timeouts = state.timeouts || [];
    state.timeouts.push(seedTimeout, budTimeout, bloomTimeout, grownTimeout);
  }
}

export function plantTile(tileEl) {
  if (tileEl.classList.contains('planted')) return;

  var tileIndex = parseInt(tileEl.getAttribute('data-tile'), 10);
  var gridHint = dom.gridHint;

  // Assign a random flower morphology type
  var flowerType = getRandomFlowerType();
  tileFlowerTypeMap[tileIndex] = flowerType;

  var palette = applyTileColors(tileEl, tileIndex, flowerType);
  var primaryColor = palette[0];
  tileColorMap[tileIndex] = primaryColor;

  tileCycleState[tileIndex] = { cycle: 1, stage: 'planted', timeouts: [], flowerType: flowerType };

  tileEl.classList.add('planted');
  tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted');

  // Apply current weather visual class
  var weather = getCurrentWeather();
  if (weather === 'sunny') {
    tileEl.classList.add('weather-sunny-glow');
  } else if (weather === 'rainy') {
    tileEl.classList.add('weather-rainy-glow');
    // If it's already raining, auto-water this tile
    tileEl.classList.add('rain-watered');
    createRainTileDroplets(tileEl);
  } else if (weather === 'snowy') {
    tileEl.classList.add('weather-snowy-dormant');
  }

  var tileSeed = tileEl.querySelector('.tile-seed');
  tileSeed.classList.add('visible');

  // Weather-scaled timings for initial plant (also applies ecosystem multipliers)
  var wsm = getWeatherGrowthMultiplier();
  var seedDelay = weatherScaled(500);
  var budDelay = weatherScaled(1400);
  var bloomDelay = weatherScaled(2000);
  var grownDelay = weatherScaled(2700);
  var holdBloom = weatherScaled(CYCLE_HOLD_BLOOM, tileIndex);
  var wiltDur = weatherScaled(CYCLE_WILT_DURATION, tileIndex);
  var pauseWilt = weatherScaled(CYCLE_PAUSE_AFTER_WILT, tileIndex);

  var timeouts = tileCycleState[tileIndex].timeouts;

  var seedTimeout = setTimeout(function () {
    var tileSprout = tileEl.querySelector('.tile-sprout');
    tileSprout.classList.add('growing');
  }, seedDelay);
  timeouts.push(seedTimeout);

  var budTimeout = setTimeout(function () {
    var tileSprout = tileEl.querySelector('.tile-sprout');
    tileSprout.classList.remove('growing');
    tileSprout.classList.add('budding');
  }, budDelay);
  timeouts.push(budTimeout);

  var bloomTimeout = setTimeout(function () {
    enqueueBloom(() => {
      var tileSprout = tileEl.querySelector('.tile-sprout');
      tileSprout.classList.remove('budding');
      tileSprout.classList.add('blooming');
    });
  }, bloomDelay);
  timeouts.push(bloomTimeout);

  var grownTimeout = setTimeout(function () {
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
    recordBloom(tileIndex, 1);
    saveGardenState();
    notifyStatsChange();
    checkBloomMilestone();

    // Check if all tiles are planted — trigger completion celebration
    if (plantedCount.value >= totalTiles) {
      triggerGardenComplete();
    }

    if (gridHint) {
      gridHint.style.opacity = '0';
      setTimeout(function () {
        gridHint.textContent = getRandomGridMessage();
        gridHint.style.opacity = '1';
      }, 300);
    }

    var offset = tileIndex * CYCLE_SEED_OFFSET * wsm;
    var firstWiltDelay = holdBloom + offset;

    var wiltTimeout = setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;

      tileSprout.classList.remove('grown');
      tileSprout.classList.add('wilting');

      var restartTimeout = setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;

        if (badge) {
          badge.classList.remove('visible');
        }

        tileCycleState[tileIndex].cycle = 2;
        startGrowthCycle(tileEl, tileIndex);
      }, wiltDur + pauseWilt);
      timeouts.push(restartTimeout);
    }, firstWiltDelay);
    timeouts.push(wiltTimeout);
  }, grownDelay);
  timeouts.push(grownTimeout);
}

export function toggleWateringMode() {
  var wateringCanBtn = dom.wateringCanBtn;
  var tendingHint = dom.tendingHint;
  var tiles = dom.tiles;

  wateringMode = !wateringMode;

  // Turn off other modes if watering was just activated
  if (wateringMode) {
    if (fertilizeMode) {
      fertilizeMode = false;
      var fertilizeBtn = dom.fertilizeBtn;
      if (fertilizeBtn) {
        fertilizeBtn.classList.remove('active');
        fertilizeBtn.setAttribute('aria-pressed', 'false');
      }
      tiles.forEach(function (tile) {
        tile.classList.remove('fertilize-target');
      });
    }
    if (pruneMode) {
      pruneMode = false;
      var pruneBtnLocal = dom.pruneBtn;
      if (pruneBtnLocal) {
        pruneBtnLocal.classList.remove('active');
        pruneBtnLocal.setAttribute('aria-pressed', 'false');
      }
      tiles.forEach(function (tile) {
        tile.classList.remove('prune-target');
      });
    }
  }

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
        }, weatherScaled(CYCLE_WILT_DURATION) + weatherScaled(CYCLE_PAUSE_AFTER_WILT));

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
  recordTendDay();
}

export function isWateringMode() {
  return wateringMode;
}

// ── Fertilize Mode ──

function createFertilizeSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.4;

  var colors = ['#d4a574', '#c9a86c', '#a88a50', '#8b7355', '#fbbf24'];

  for (var i = 0; i < 10; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('tile-fertilize-sparkle');
    var angle = (Math.PI * 2 * i) / 10;
    var distance = 1 + Math.random() * 2;
    var tx = Math.cos(angle) * distance * 10 + 'px';
    var ty = Math.sin(angle) * distance * 10 + 'px';
    sparkle.style.setProperty('--tx', tx);
    sparkle.style.setProperty('--ty', ty);
    sparkle.style.left = centerX + 'px';
    sparkle.style.top = centerY + 'px';
    sparkle.style.background = colors[Math.floor(Math.random() * colors.length)];
    tileEl.appendChild(sparkle);

    (function (s) {
      setTimeout(function () { s.remove(); }, 1000);
    })(sparkle);
  }
}

export function toggleFertilizeMode() {
  var fertilizeBtn = dom.fertilizeBtn;
  var tendingHint = dom.tendingHint;
  var tiles = dom.tiles;

  fertilizeMode = !fertilizeMode;

  // Turn off other modes if they were on
  if (fertilizeMode) {
    if (wateringMode) {
      wateringMode = false;
      var wateringCanBtn = dom.wateringCanBtn;
      if (wateringCanBtn) {
        wateringCanBtn.classList.remove('active');
        wateringCanBtn.setAttribute('aria-pressed', 'false');
      }
      tiles.forEach(function (tile) {
        tile.classList.remove('watering-target');
      });
    }
    if (pruneMode) {
      pruneMode = false;
      var pruneBtnLocal = dom.pruneBtn;
      if (pruneBtnLocal) {
        pruneBtnLocal.classList.remove('active');
        pruneBtnLocal.setAttribute('aria-pressed', 'false');
      }
      tiles.forEach(function (tile) {
        tile.classList.remove('prune-target');
      });
    }
  }

  if (fertilizeMode) {
    fertilizeBtn.classList.add('active');
    fertilizeBtn.setAttribute('aria-pressed', 'true');
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'click on planted tiles to fertilize them';
      tendingHint.style.opacity = '1';
    }, 300);

    tiles.forEach(function (tile) {
      if (tile.classList.contains('planted')) {
        tile.classList.add('fertilize-target');
      }
    });
  } else {
    fertilizeBtn.classList.remove('active');
    fertilizeBtn.setAttribute('aria-pressed', 'false');
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = getRandomFertilizeHint();
      tendingHint.style.opacity = '1';
    }, 300);

    tiles.forEach(function (tile) {
      tile.classList.remove('fertilize-target');
    });
  }
}

export function fertilizeTile(tileEl, tileIndex) {
  var tendingHint = dom.tendingHint;

  if (fertilizedTiles[tileIndex]) return;

  fertilizedTiles[tileIndex] = true;

  tileEl.classList.add('fertilized');
  tileEl.classList.add('fertilize-glow');
  createFertilizeSparkles(tileEl);
  addFertilizedIcon(tileEl);

  // Apply permanent growth speed boost (30% faster)
  var state = tileCycleState[tileIndex];
  if (state) {
    state.fertilized = true;
  }

  // Apply boost class to sprout for CSS animation speed-up
  var sprout = tileEl.querySelector('.tile-sprout');
  if (sprout) {
    sprout.classList.add('fertilized-boost');
  }

  // Remove glow class after animation completes
  setTimeout(function () {
    tileEl.classList.remove('fertilize-glow');
  }, 1200);

  var palette = petalPalettes[tileIndex % petalPalettes.length];
  addJournalEntry(tileIndex, palette[0], state ? state.cycle : 1);

  if (journalEntries.length > 0) {
    journalEntries[journalEntries.length - 1].type = 'fertilized';
    journalEntries[journalEntries.length - 1].subText = getRandomFertilizeMessage();
  }

  var journalTimeline = dom.journalTimeline;
  if (journalTimeline) {
    var firstEntry = journalTimeline.firstChild;
    if (firstEntry) {
      var textEl = firstEntry.querySelector('.entry-text');
      if (textEl) {
        textEl.innerHTML = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 🌾 fertilized';
      }
      var timeEl = firstEntry.querySelector('.entry-time');
      if (timeEl) {
        timeEl.textContent = getRandomFertilizeMessage();
      }
    }
  }

  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'soil enriched — growth permanently boosted by 30% 🌾';
      tendingHint.style.opacity = '1';
    }, 300);
  }

  saveGardenState();
  notifyStatsChange();
  recordTendDay();
}

export function isFertilizeMode() {
  return fertilizeMode;
}

// ── Prune Mode ──

function createLeafScatter(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.35;

  var leafColors = ['#6b8f5e', '#7da86b', '#5a7a4d', '#8ab87a', '#4a6a3d', '#a0c48a'];

  for (var i = 0; i < 8; i++) {
    var leaf = document.createElement('div');
    leaf.classList.add('tile-prune-leaf');
    var angle = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.5;
    var distance = 1.5 + Math.random() * 2.5;
    var tx = Math.cos(angle) * distance * 12 + 'px';
    var ty = Math.sin(angle) * distance * 12 + 0.5 + 'rem';
    leaf.style.setProperty('--tx', tx);
    leaf.style.setProperty('--ty', ty);
    leaf.style.setProperty('--leaf-rot', (Math.random() * 360) + 'deg');
    leaf.style.left = centerX + 'px';
    leaf.style.top = centerY + 'px';
    leaf.style.background = leafColors[Math.floor(Math.random() * leafColors.length)];
    tileEl.appendChild(leaf);

    (function (l) {
      setTimeout(function () { l.remove(); }, 1200);
    })(leaf);
  }
}

function createSnipArcs(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.35;

  for (var i = 0; i < 2; i++) {
    var arc = document.createElement('div');
    arc.classList.add('tile-snip-arc');
    arc.style.left = centerX + 'px';
    arc.style.top = centerY + 'px';
    arc.style.setProperty('--arc-side', i === 0 ? '-1' : '1');
    tileEl.appendChild(arc);

    (function (a) {
      setTimeout(function () { a.remove(); }, 600);
    })(arc);
  }
}

export function togglePruneMode() {
  var pruneBtn = dom.pruneBtn;
  var tendingHint = dom.tendingHint;
  var tiles = dom.tiles;

  pruneMode = !pruneMode;

  // Turn off other modes if they were on
  if (pruneMode) {
    if (wateringMode) {
      wateringMode = false;
      var wateringCanBtn = dom.wateringCanBtn;
      if (wateringCanBtn) {
        wateringCanBtn.classList.remove('active');
        wateringCanBtn.setAttribute('aria-pressed', 'false');
      }
      tiles.forEach(function (tile) {
        tile.classList.remove('watering-target');
      });
    }
    if (fertilizeMode) {
      fertilizeMode = false;
      var fertilizeBtn = dom.fertilizeBtn;
      if (fertilizeBtn) {
        fertilizeBtn.classList.remove('active');
        fertilizeBtn.setAttribute('aria-pressed', 'false');
      }
      tiles.forEach(function (tile) {
        tile.classList.remove('fertilize-target');
      });
    }
  }

  if (pruneMode) {
    pruneBtn.classList.add('active');
    pruneBtn.setAttribute('aria-pressed', 'true');
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'click on planted tiles to prune them';
      tendingHint.style.opacity = '1';
    }, 300);

    tiles.forEach(function (tile) {
      if (tile.classList.contains('planted')) {
        tile.classList.add('prune-target');
      }
    });
  } else {
    pruneBtn.classList.remove('active');
    pruneBtn.setAttribute('aria-pressed', 'false');
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = getRandomPruneHint();
      tendingHint.style.opacity = '1';
    }, 300);

    tiles.forEach(function (tile) {
      tile.classList.remove('prune-target');
    });
  }
}

export function pruneTile(tileEl, tileIndex) {
  var tendingHint = dom.tendingHint;

  // Visual effects: snip arcs + leaf scatter
  createSnipArcs(tileEl);
  createLeafScatter(tileEl);

  // Add pruning class for the trim animation
  tileEl.classList.add('pruning');
  tileEl.classList.add('pruned-tile');
  setTimeout(function () {
    tileEl.classList.remove('pruning');
  }, 800);

  // Clear all pending timeouts for this tile
  var state = tileCycleState[tileIndex];
  if (state && state.timeouts) {
    state.timeouts.forEach(function (t) { clearTimeout(t); });
    state.timeouts = [];
  }

  var sprout = tileEl.querySelector('.tile-sprout');
  var badge = tileEl.querySelector('.tile-cycle-badge');

  // Reset visual state: collapse flower back to stem
  if (sprout) {
    sprout.classList.remove('growing', 'budding', 'blooming', 'grown', 'wilting', 'dormant', 'regrowing', 'regrow-bud', 'regrow-bloom', 'regrow-wilt', 'speed-up');
    sprout.classList.add('pruned');

    setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      sprout.classList.remove('pruned');

      // Hide badge during regrowth
      if (badge) {
        badge.classList.remove('visible');
      }

      // Start fresh growth cycle from perennial regrowth path
      // Increment cycle counter
      if (state) {
        state.cycle++;
      }
      startGrowthCycle(tileEl, tileIndex);
      saveGardenState();
    }, 600);
  }

  // Track pruning
  prunedTiles[tileIndex] = true;

  // Add journal entry
  var palette = petalPalettes[tileIndex % petalPalettes.length];
  addJournalEntry(tileIndex, palette[0], state ? state.cycle : 1);

  if (journalEntries.length > 0) {
    journalEntries[journalEntries.length - 1].type = 'pruned';
    journalEntries[journalEntries.length - 1].subText = getRandomPruneMessage();
  }

  var journalTimeline = dom.journalTimeline;
  if (journalTimeline) {
    var firstEntry = journalTimeline.firstChild;
    if (firstEntry) {
      var textEl = firstEntry.querySelector('.entry-text');
      if (textEl) {
        textEl.innerHTML = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; ✂️ pruned';
      }
      var timeEl = firstEntry.querySelector('.entry-time');
      if (timeEl) {
        timeEl.textContent = getRandomPruneMessage();
      }
    }
  }

  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = getRandomPruneMessage() + ' ✂️';
      tendingHint.style.opacity = '1';
    }, 300);
  }

  notifyStatsChange();
  recordTendDay();
}

export function isPruneMode() {
  return pruneMode;
}


