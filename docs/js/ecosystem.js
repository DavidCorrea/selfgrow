// ═══════════════════════════════════════════════════════════
// Ecosystem Interactions — Creatures & Plants Influence Each Other
// Bees boost growth on blooming flowers, ladybugs clear adjacent
// weeds, and ground creatures are season-gated.
// ═══════════════════════════════════════════════════════════

import { dom, plantedCount, journalEntries, tileCycleState } from './state.js';
import { addJournalEntry } from './journal.js';
import { getCurrentGardenSeason } from './garden-seasons.js';
import { visibleSetInterval, visibleClearInterval } from './visibility-manager.js';

var ecosystemInterval = null;
var ecosystemPaused = false;

// ── Helpers ──

function getTiles() {
  return dom.tiles || document.querySelectorAll('.grid-tile');
}

function getPlantedTiles() {
  var tiles = getTiles();
  var planted = [];
  tiles.forEach(function (tile) {
    if (tile.classList.contains('planted')) {
      planted.push(tile);
    }
  });
  return planted;
}

function getBloomingTiles() {
  var tiles = getTiles();
  var blooming = [];
  tiles.forEach(function (tile) {
    if (tile.classList.contains('planted')) {
      var sprout = tile.querySelector('.tile-sprout');
      if (sprout && sprout.classList.contains('grown')) {
        blooming.push(tile);
      }
    }
  });
  return blooming;
}

// Get adjacent tile indices (grid neighbors in a 3x3 grid)
function getAdjacentTileIndices(tileIndex) {
  var cols = 3;
  var row = Math.floor(tileIndex / cols);
  var col = tileIndex % cols;
  var neighbors = [];

  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      var nr = row + dr;
      var nc = col + dc;
      if (nr >= 0 && nr < cols && nc >= 0 && nc < cols) {
        neighbors.push(nr * cols + nc);
      }
    }
  }
  return neighbors;
}

// ── Bee Pollination ──
// When a bee is near a blooming flower, it applies a gentle glow
// and triggers a 25% growth speed boost on that tile.

function applyBeePollination(tileEl, tileIndex) {
  var sprout = tileEl.querySelector('.tile-sprout');
  if (!sprout || !sprout.classList.contains('grown')) return;

  // Add pollination glow class
  tileEl.classList.add('bee-pollinated');
  sprout.classList.add('pollination-glow');

  // Create pollination sparkles
  createPollinationSparkles(tileEl);

  // Apply 25% growth speed boost (reduces hold bloom time)
  var state = tileCycleState[tileIndex];
  if (state) {
    state.beePollinated = true;
  }

  // Journal entry
  var palette = getTilePalette(tileIndex);
  addJournalEntry(tileIndex, palette[0], state ? state.cycle : 1);

  if (journalEntries.length > 0) {
    journalEntries[journalEntries.length - 1].type = 'pollinated';
    journalEntries[journalEntries.length - 1].subText = 'a bee visited — growth boosted by 25%';
  }

  // Remove glow after a delay
  setTimeout(function () {
    tileEl.classList.remove('bee-pollinated');
    if (sprout) sprout.classList.remove('pollination-glow');
  }, 4000);
}

function createPollinationSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.35;

  for (var i = 0; i < 5; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('pollination-sparkle');
    var angle = (Math.PI * 2 * i) / 5;
    var distance = 1 + Math.random() * 1.5;
    var tx = Math.cos(angle) * distance * 6 + 'px';
    var ty = Math.sin(angle) * distance * 6 + 'px';
    sparkle.style.setProperty('--tx', tx);
    sparkle.style.setProperty('--ty', ty);
    sparkle.style.left = centerX + 'px';
    sparkle.style.top = centerY + 'px';
    tileEl.appendChild(sparkle);

    (function (s) {
      setTimeout(function () { s.remove(); }, 1200);
    })(sparkle);
  }
}

function getTilePalette(tileIndex) {
  var palettes = [
    ['#f472b6', '#ec4899', '#db2777'],
    ['#fb923c', '#f97316', '#ea580c'],
    ['#a78bfa', '#8b5cf6', '#7c3aed'],
    ['#60a5fa', '#3b82f6', '#2563eb'],
    ['#fbbf24', '#f59e0b', '#d97706'],
    ['#f472b6', '#a78bfa', '#60a5fa'],
    ['#fb923c', '#f472b6', '#fbbf24'],
    ['#60a5fa', '#34d399', '#a78bfa'],
    ['#fbbf24', '#fb923c', '#f472b6'],
  ];
  return palettes[tileIndex % palettes.length];
}

// ── Ladybug Pest Control ──
// When a ladybug lands on a planted tile, adjacent tiles that
// are volunteer/weed tiles get a 'pest-cleaned' effect —
// a one-time growth boost and journal acknowledgment.

function applyLadybugPestControl(tileEl, tileIndex) {
  var adjacentIndices = getAdjacentTileIndices(tileIndex);
  var cleanedCount = 0;

  adjacentIndices.forEach(function (adjIndex) {
    var tiles = getTiles();
    var adjTile = tiles[adjIndex];
    if (!adjTile) return;

    // Ladybugs eat aphids — they benefit volunteer/weed tiles
    // by clearing pests from them, giving a one-time growth boost
    // They also help regular planted tiles, but volunteers benefit most
    if (adjTile.classList.contains('planted')) {
      var adjSprout = adjTile.querySelector('.tile-sprout');
      if (!adjSprout) return;

      // Skip if tile was recently cleaned
      if (adjTile.classList.contains('pest-cleaned')) return;

      // Apply pest-cleaned effect
      adjTile.classList.add('pest-cleaned');
      adjSprout.classList.add('pest-cleaned-glow');

      createPestCleanedSparkles(adjTile);

      // Apply a one-time growth speed boost to the adjacent tile
      var adjState = tileCycleState[adjIndex];
      if (adjState) {
        adjState.ladybugBoosted = true;
      }

      cleanedCount++;

      setTimeout(function () {
        adjTile.classList.remove('pest-cleaned');
        adjSprout.classList.remove('pest-cleaned-glow');
        // Clear the boost after the effect wears off
        if (adjState) {
          adjState.ladybugBoosted = false;
        }
      }, 3000);
    }
  });

  if (cleanedCount > 0) {
    var palette = getTilePalette(tileIndex);
    var state = tileCycleState[tileIndex];
    addJournalEntry(tileIndex, palette[0], state ? state.cycle : 1);

    if (journalEntries.length > 0) {
      journalEntries[journalEntries.length - 1].type = 'pest-cleaned';
      journalEntries[journalEntries.length - 1].subText = 'a ladybug cleared pests from ' + cleanedCount + ' nearby tile' + (cleanedCount > 1 ? 's' : '');
    }
  }
}

function createPestCleanedSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.4;

  for (var i = 0; i < 4; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('pest-cleaned-sparkle');
    var angle = (Math.PI * 2 * i) / 4;
    var distance = 0.8 + Math.random() * 1;
    var tx = Math.cos(angle) * distance * 5 + 'px';
    var ty = Math.sin(angle) * distance * 5 + 'px';
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

// ── Season-Gated Creature Spawning ──
// Returns a season-appropriate creature type based on current season.
// Earthworms only in spring, crickets/fireflies only in summer.
// Ladybugs favor spring/summer, snails favor autumn.

export function getSeasonWeightedCreatureType() {
  var season = getCurrentGardenSeason();
  var rand = Math.random();

  switch (season) {
    case 'spring':
      // Spring: ladybugs (40%), worms (35%), snails (25%)
      // Worms are spring-only — they surface when soil is soft
      if (rand < 0.40) return 'ladybug';
      if (rand < 0.75) return 'worm';
      return 'snail';

    case 'summer':
      // Summer: ladybugs (50%), snails (30%), crickets (20%)
      // No worms in summer — they retreat deep into the soil
      if (rand < 0.50) return 'ladybug';
      if (rand < 0.80) return 'snail';
      return 'cricket';

    case 'autumn':
      // Autumn: snails (55%), ladybugs (35%), crickets (10%)
      // No worms in autumn
      if (rand < 0.55) return 'snail';
      if (rand < 0.90) return 'ladybug';
      return 'cricket';

    case 'winter':
      // Winter: snails (60%), ladybugs (40%)
      // No worms or crickets in winter — the ground is too cold
      if (rand < 0.60) return 'snail';
      return 'ladybug';

    default:
      // Default fallback
      if (rand < 0.4) return 'ladybug';
      if (rand < 0.7) return 'snail';
      if (rand < 0.85) return 'worm';
      return 'cricket';
  }
}

// Check if a creature type is allowed in the current season
export function isCreatureSeasonAllowed(creatureType) {
  var season = getCurrentGardenSeason();

  // Worms are spring-only (they surface when soil is soft)
  if (creatureType === 'worm' && season !== 'spring') {
    return false;
  }

  // Crickets are summer-only (they sing in the warm evenings)
  if (creatureType === 'cricket' && season !== 'summer') {
    return false;
  }

  return true;
}

// ── Ecosystem Tick ──
// Periodic check: scan for bees near blooming flowers and
// ladybugs on planted tiles, then apply interactions.

function ecosystemTick() {
  if (ecosystemPaused) return;
  if (plantedCount.value === 0) return;

  var visitorsLayer = dom.visitorsLayer || document.getElementById('visitorsLayer');
  if (!visitorsLayer) return;

  // ── Bee pollination check ──
  var bees = visitorsLayer.querySelectorAll('.bee:not(.scattering):not(.leaving)');
  var bloomingTiles = getBloomingTiles();

  bees.forEach(function (bee) {
    var beeRect = bee.getBoundingClientRect();

    bloomingTiles.forEach(function (tile) {
      // Skip if already pollinated recently
      if (tile.classList.contains('bee-pollinated')) return;

      var tileRect = tile.getBoundingClientRect();

      // Check proximity: bee within ~80px of tile center
      var tileCenterX = tileRect.left + tileRect.width / 2;
      var tileCenterY = tileRect.top + tileRect.height / 2;
      var beeCenterX = beeRect.left + beeRect.width / 2;
      var beeCenterY = beeRect.top + beeRect.height / 2;

      var dx = tileCenterX - beeCenterX;
      var dy = tileCenterY - beeCenterY;
      var dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 80) {
        var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
        applyBeePollination(tile, tileIndex);
      }
    });
  });

  // ── Ladybug pest control check ──
  var gardenGrid = dom.gardenGrid;
  if (!gardenGrid) return;

  var ladybugs = gardenGrid.querySelectorAll('.ground-creature--ladybug:not(.ground-creature--leaving):not(.ground-creature--flying-away)');
  var plantedTiles = getPlantedTiles();

  ladybugs.forEach(function (ladybug) {
    // Only trigger pest control occasionally (not every tick)
    if (Math.random() > 0.15) return;

    var ladybugRect = ladybug.getBoundingClientRect();

    plantedTiles.forEach(function (tile) {
      var tileRect = tile.getBoundingClientRect();

      // Check if ladybug is on this tile (centered within tile bounds)
      var ladybugCenterX = ladybugRect.left + ladybugRect.width / 2;
      var ladybugCenterY = ladybugRect.top + ladybugRect.height / 2;

      if (ladybugCenterX >= tileRect.left && ladybugCenterX <= tileRect.right &&
          ladybugCenterY >= tileRect.top && ladybugCenterY <= tileRect.bottom) {

        // Skip if tile was recently cleaned
        if (tile.classList.contains('pest-cleaned')) return;

        var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
        applyLadybugPestControl(tile, tileIndex);
      }
    });
  });
}

// ── Public API ──

export function startEcosystem() {
  if (ecosystemInterval) visibleClearInterval(ecosystemInterval);
  // Run ecosystem tick every 3 seconds
  ecosystemInterval = visibleSetInterval(ecosystemTick, 3000);
}

export function stopEcosystem() {
  if (ecosystemInterval) {
    visibleClearInterval(ecosystemInterval);
    ecosystemInterval = null;
  }
}

export function pauseEcosystem() {
  ecosystemPaused = true;
}

export function resumeEcosystem() {
  ecosystemPaused = false;
}

export function initEcosystem() {
  // Visibility pause is now handled centrally by visibility-manager.js
  // via the tab-hidden body class and wrapped timers
}

// Apply ecosystem growth multipliers to weather-scaled timing
// Returns a combined multiplier for growth speed
// Bee pollination: 25% faster (0.75)
// Ladybug pest control: 15% faster (0.85)
// Combined: ~36% faster (0.75 * 0.85 = 0.6375)
export function getEcosystemGrowthMultiplier(tileIndex) {
  var multiplier = 1.0;
  var state = tileCycleState[tileIndex];
  if (state) {
    if (state.beePollinated) {
      multiplier *= 0.75; // 25% faster
    }
    if (state.ladybugBoosted) {
      multiplier *= 0.85; // 15% faster
    }
  }
  return multiplier;
}
