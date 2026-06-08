import { dom, tileColorMap, tileFlowerTypeMap, tileCycleState, journalEntries, petalPalettes, flowerTypes, centerColors, seedCollection, plantedCount, totalTiles } from './state.js';
import { saveGardenState } from './persistence.js';
import { addJournalEntry } from './journal.js';
import { notifyStatsChange } from './stats.js';
import { startGrowthCycle, updateCounter } from './tiles.js';
import { triggerGardenComplete } from './celebration.js';

// ── Seed Collection State ──
var collectMode = false;
var plantMode = false;
var selectedSeedIndex = -1;

// ── Seed Type Icons ──
var seedTypeIcons = {
  daisy: '🌼',
  tulip: '🌷',
  rose: '🌹',
  star: '⭐',
  lily: '💐'
};

// ── Seed Type Labels ──
var seedTypeLabels = {
  daisy: 'Daisy',
  tulip: 'Tulip',
  rose: 'Rose',
  star: 'Star',
  lily: 'Lily'
};

// ── Save seed collection to localStorage ──
function saveSeedCollection() {
  try {
    localStorage.setItem('selfgrow_seed_collection', JSON.stringify(seedCollection));
  } catch (e) {
    // localStorage might be full
  }
}

// ── Format date for display ──
function formatCollectionDate(timestamp) {
  var d = new Date(timestamp);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

// ── Create seed packet card HTML ──
function createSeedPacketCard(seed, index) {
  var card = document.createElement('div');
  card.classList.add('seed-packet');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', seedTypeLabels[seed.flowerType] + ' seed packet, collected ' + formatCollectionDate(seed.dateCollected));
  card.setAttribute('data-seed-index', index);

  var icon = seedTypeIcons[seed.flowerType] || '🌱';
  var label = seedTypeLabels[seed.flowerType] || 'Flower';
  var dateStr = formatCollectionDate(seed.dateCollected);

  // Build color swatches from palette
  var swatchesHtml = '';
  if (seed.palette) {
    seed.palette.forEach(function (color) {
      swatchesHtml += '<span class="seed-packet__swatch" style="background: ' + color + '" aria-hidden="true"></span>';
    });
  }

  card.innerHTML =
    '<div class="seed-packet__body">' +
      '<span class="seed-packet__emoji" aria-hidden="true">' + icon + '</span>' +
      '<span class="seed-packet__type">' + label + '</span>' +
      '<span class="seed-packet__date">' + dateStr + '</span>' +
    '</div>' +
    '<div class="seed-packet__swatches">' + swatchesHtml + '</div>' +
    '<div class="seed-packet__plant-hint">tap to plant</div>';

  // Click to select for planting
  card.addEventListener('click', function () {
    selectSeedForPlanting(index);
  });
  card.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectSeedForPlanting(index);
    }
  });

  return card;
}

// ── Render seed packets panel ──
function renderSeedPackets() {
  var list = dom.seedPacketsList;
  if (!list) return;

  list.innerHTML = '';

  if (seedCollection.length === 0) {
    var empty = document.createElement('p');
    empty.classList.add('seed-packets__empty');
    empty.textContent = 'collect seeds from blooming flowers...';
    list.appendChild(empty);
    return;
  }

  seedCollection.forEach(function (seed, index) {
    var card = createSeedPacketCard(seed, index);
    list.appendChild(card);
  });

  // Update count badge
  var countEl = dom.seedPacketsCount;
  if (countEl) {
    countEl.textContent = seedCollection.length;
    countEl.setAttribute('aria-label', seedCollection.length + ' seed packets collected');
  }
}

// ── Show/hide seed packets panel ──
function revealSeedPacketsPanel() {
  var panel = dom.seedPacketsPanel;
  if (!panel) return;
  panel.classList.add('visible');
  panel.setAttribute('aria-hidden', 'false');
}

// ── Create seed packet data from a tile ──
function createSeedFromTile(tileIndex) {
  var flowerType = tileFlowerTypeMap[tileIndex];
  if (!flowerType) return null;

  var paletteIndex = tileIndex % petalPalettes.length;
  var palette = petalPalettes[paletteIndex].slice(); // copy
  var centerColor = centerColors[paletteIndex % centerColors.length];

  return {
    id: Date.now() + '_' + tileIndex,
    flowerType: flowerType,
    palette: palette,
    centerColor: centerColor,
    dateCollected: Date.now()
  };
}

// ── Sparkle effect when collecting ──
function createCollectSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.3;

  var colors = ['#c9a86c', '#d4a574', '#fbbf24', '#8b7355'];

  for (var i = 0; i < 8; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('tile-seed-collect-sparkle');
    var angle = (Math.PI * 2 * i) / 8;
    var distance = 1.5 + Math.random() * 2;
    var tx = Math.cos(angle) * distance * 10 + 'px';
    var ty = Math.sin(angle) * distance * 10 + 'px';
    sparkle.style.setProperty('--tx', tx);
    sparkle.style.setProperty('--ty', ty);
    sparkle.style.left = centerX + 'px';
    sparkle.style.top = centerY + 'px';
    sparkle.style.background = colors[Math.floor(Math.random() * colors.length)];
    tileEl.appendChild(sparkle);

    (function (s) {
      setTimeout(function () { s.remove(); }, 900);
    })(sparkle);
  }
}

// ── Collect a seed from a blooming tile ──
export function collectSeed(tileEl, tileIndex) {
  var state = tileCycleState[tileIndex];
  if (!state) return false;

  // Only collect from grown (blooming) tiles
  var sprout = tileEl.querySelector('.tile-sprout');
  if (!sprout || !sprout.classList.contains('grown')) return false;

  var seed = createSeedFromTile(tileIndex);
  if (!seed) return false;

  seedCollection.push(seed);
  saveSeedCollection();
  renderSeedPackets();
  revealSeedPacketsPanel();

  // Visual feedback on tile
  createCollectSparkles(tileEl);

  // Journal entry
  var fType = seedTypeLabels[seed.flowerType] || 'flower';
  addJournalEntry(tileIndex, seed.palette[0], state.cycle);
  if (journalEntries.length > 0) {
    journalEntries[journalEntries.length - 1].type = 'seed-collect';
    journalEntries[journalEntries.length - 1].subText = 'collected a ' + fType + ' seed packet';
  }

  // Update journal DOM with seed-collect styling
  var journalTimeline = dom.journalTimeline;
  if (journalTimeline) {
    var firstEntry = journalTimeline.firstChild;
    if (firstEntry) {
      firstEntry.classList.remove('journal-entry');
      firstEntry.classList.add('journal-entry', 'journal-entry--seed-collect');
      var dotEl = firstEntry.querySelector('.entry-timeline-dot');
      if (dotEl) {
        dotEl.classList.remove('entry-timeline-dot');
        dotEl.classList.add('entry-timeline-dot', 'entry-timeline-dot--seed-collect');
      }
      var swatchEl = firstEntry.querySelector('.entry-swatch');
      if (swatchEl) {
        swatchEl.classList.remove('entry-swatch');
        swatchEl.classList.add('entry-swatch', 'entry-swatch--seed-collect');
      }
      var textEl = firstEntry.querySelector('.entry-text');
      if (textEl) {
        textEl.innerHTML = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 🌰 seed collected';
      }
      var timeEl = firstEntry.querySelector('.entry-time');
      if (timeEl) {
        timeEl.textContent = fType + ' seed packet added to collection';
      }
    }
  }

  // Update hint
  var tendingHint = dom.tendingHint;
  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'collected a ' + fType + ' seed packet 🌰';
      tendingHint.style.opacity = '1';
    }, 300);
  }

  notifyStatsChange();
  return true;
}

// ── Select a seed for planting ──
function selectSeedForPlanting(index) {
  if (index < 0 || index >= seedCollection.length) return;

  // Toggle: if already selected, deselect
  if (selectedSeedIndex === index && plantMode) {
    exitPlantMode();
    return;
  }

  // Deselect previous card
  var list = dom.seedPacketsList;
  if (list) {
    var cards = list.querySelectorAll('.seed-packet');
    cards.forEach(function (c) { c.classList.remove('selected'); });
  }

  selectedSeedIndex = index;

  // Select this card
  if (list) {
    var card = list.querySelector('.seed-packet[data-seed-index="' + index + '"]');
    if (card) card.classList.add('selected');
  }

  // Enter plant mode
  enterPlantMode();
}

// ── Enter plant-from-seed mode ──
function enterPlantMode() {
  if (selectedSeedIndex < 0 || selectedSeedIndex >= seedCollection.length) return;

  // Turn off collect mode
  if (collectMode) {
    exitCollectMode();
  }

  plantMode = true;

  // Remove collect button active state
  var collectBtn = dom.seedCollectBtn;
  if (collectBtn) {
    collectBtn.classList.remove('active');
    collectBtn.setAttribute('aria-pressed', 'false');
  }

  var seed = seedCollection[selectedSeedIndex];
  var fType = seedTypeLabels[seed.flowerType] || 'flower';

  // Update hint
  var tendingHint = dom.tendingHint;
  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'click an empty tile to plant your ' + fType;
      tendingHint.style.opacity = '1';
    }, 300);
  }

  // Highlight empty tiles
  var tiles = dom.tiles;
  if (tiles) {
    tiles.forEach(function (tile) {
      if (!tile.classList.contains('planted')) {
        tile.classList.add('seed-plant-target');
      }
    });
  }
}

// ── Plant a selected seed on a tile ──
export function plantSelectedSeed(tileEl, tileIndex) {
  if (selectedSeedIndex < 0 || selectedSeedIndex >= seedCollection.length) return false;
  if (tileEl.classList.contains('planted')) return false;

  var seed = seedCollection[selectedSeedIndex];
  var flowerType = seed.flowerType;
  var palette = seed.palette;
  var centerColor = seed.centerColor;
  var fType = seedTypeLabels[flowerType] || 'flower';

  // Store flower type
  tileFlowerTypeMap[tileIndex] = flowerType;

  // Apply colors from the seed's palette
  var petalEls = tileEl.querySelectorAll('.tile-petal');
  petalEls.forEach(function (petal, i) {
    petal.style.background = palette[i % palette.length];
  });
  var centerEl = tileEl.querySelector('.tile-center');
  if (centerEl) {
    centerEl.style.background = centerColor;
    centerEl.style.boxShadow = '0 0 0.2rem rgba(251, 191, 36, 0.5)';
  }

  // Apply flower type CSS class
  var sproutEl = tileEl.querySelector('.tile-sprout');
  if (sproutEl) {
    flowerTypes.forEach(function (ft) {
      sproutEl.classList.remove('flower-' + ft);
    });
    sproutEl.classList.remove('flower-wildflower');
    sproutEl.classList.add('flower-' + flowerType);
  }

  // Store primary color
  tileColorMap[tileIndex] = palette[0];

  // Set up cycle state
  tileCycleState[tileIndex] = { cycle: 1, stage: 'planted', timeouts: [], flowerType: flowerType };

  tileEl.classList.add('planted');
  tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' planted with ' + fType);

  // Increment planted count
  plantedCount.value++;
  updateCounter(plantedCount.value);

  // Check if all tiles are planted
  if (plantedCount.value >= totalTiles) {
    triggerGardenComplete();
  }

  saveGardenState();

  // Planting animation
  var tileSeed = tileEl.querySelector('.tile-seed');
  tileSeed.classList.add('visible');

  // Start growth cycle
  startGrowthCycle(tileEl, tileIndex);

  // Remove seed from collection
  seedCollection.splice(selectedSeedIndex, 1);
  saveSeedCollection();
  renderSeedPackets();

  // Exit plant mode
  exitPlantMode();

  // Journal entry
  addJournalEntry(tileIndex, palette[0], 1);
  if (journalEntries.length > 0) {
    journalEntries[journalEntries.length - 1].type = 'seed-plant';
    journalEntries[journalEntries.length - 1].subText = 'planted a ' + fType + ' from collected seed';
  }

  // Update journal DOM with seed-plant styling
  var journalTimeline = dom.journalTimeline;
  if (journalTimeline) {
    var firstEntry = journalTimeline.firstChild;
    if (firstEntry) {
      firstEntry.classList.remove('journal-entry');
      firstEntry.classList.add('journal-entry', 'journal-entry--seed-plant');
      var dotEl2 = firstEntry.querySelector('.entry-timeline-dot');
      if (dotEl2) {
        dotEl2.classList.remove('entry-timeline-dot');
        dotEl2.classList.add('entry-timeline-dot', 'entry-timeline-dot--seed-plant');
      }
      var swatchEl2 = firstEntry.querySelector('.entry-swatch');
      if (swatchEl2) {
        swatchEl2.classList.remove('entry-swatch');
        swatchEl2.classList.add('entry-swatch', 'entry-swatch--seed-plant');
      }
      var textEl = firstEntry.querySelector('.entry-text');
      if (textEl) {
        textEl.innerHTML = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 🌱 ' + fType + ' from seed';
      }
      var timeEl = firstEntry.querySelector('.entry-time');
      if (timeEl) {
        timeEl.textContent = 'planted from collected seed packet';
      }
    }
  }

  // Update hint
  var tendingHint = dom.tendingHint;
  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = fType + ' planted from seed 🌱';
      tendingHint.style.opacity = '1';
    }, 300);
  }

  saveGardenState();
  notifyStatsChange();

  return true;
}

// ── Exit plant mode ──
function exitPlantMode() {
  plantMode = false;
  selectedSeedIndex = -1;

  var tiles = dom.tiles;
  if (tiles) {
    tiles.forEach(function (tile) {
      tile.classList.remove('seed-plant-target');
    });
  }

  var list = dom.seedPacketsList;
  if (list) {
    var cards = list.querySelectorAll('.seed-packet');
    cards.forEach(function (c) { c.classList.remove('selected'); });
  }

  var tendingHint = dom.tendingHint;
  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'select a seed packet to plant, or click tiles to tend';
      tendingHint.style.opacity = '1';
    }, 300);
  }
}

// ── Exit collect mode ──
function exitCollectMode() {
  collectMode = false;

  var collectBtn = dom.seedCollectBtn;
  if (collectBtn) {
    collectBtn.classList.remove('active');
    collectBtn.setAttribute('aria-pressed', 'false');
  }

  var tendingHint = dom.tendingHint;
  if (tendingHint) {
    tendingHint.style.opacity = '0';
    setTimeout(function () {
      tendingHint.textContent = 'select a seed packet to plant, or click tiles to tend';
      tendingHint.style.opacity = '1';
    }, 300);
  }

  var tiles = dom.tiles;
  if (tiles) {
    tiles.forEach(function (tile) {
      tile.classList.remove('seed-collect-target');
    });
  }
}

// ── Toggle collect mode ──
export function toggleCollectMode() {
  var collectBtn = dom.seedCollectBtn;
  var tendingHint = dom.tendingHint;
  var tiles = dom.tiles;

  collectMode = !collectMode;

  if (collectMode) {
    // Turn off plant mode
    if (plantMode) {
      exitPlantMode();
    }

    if (collectBtn) {
      collectBtn.classList.add('active');
      collectBtn.setAttribute('aria-pressed', 'true');
    }

    if (tendingHint) {
      tendingHint.style.opacity = '0';
      setTimeout(function () {
        tendingHint.textContent = 'click on a blooming flower to collect its seed';
        tendingHint.style.opacity = '1';
      }, 300);
    }

    // Highlight blooming tiles
    if (tiles) {
      tiles.forEach(function (tile) {
        if (tile.classList.contains('planted')) {
          var sprout = tile.querySelector('.tile-sprout');
          if (sprout && sprout.classList.contains('grown')) {
            tile.classList.add('seed-collect-target');
          }
        }
      });
    }
  } else {
    exitCollectMode();
  }
}

// ── Check modes ──
export function isCollectMode() {
  return collectMode;
}

export function isPlantMode() {
  return plantMode;
}

// ── Load from localStorage ──
function loadSeedCollection() {
  try {
    var raw = localStorage.getItem('selfgrow_seed_collection');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Clear and repopulate the exported array reference
        seedCollection.length = 0;
        parsed.forEach(function (item) { seedCollection.push(item); });
      }
    }
  } catch (e) {
    // ignore
  }
}

// ── Initialize ──
export function initSeedCollection() {
  loadSeedCollection();
  renderSeedPackets();
  if (seedCollection.length > 0) {
    revealSeedPacketsPanel();
  }
}
