import { dom, gridRevealed } from './js/state.js';
import { saveGardenState, loadGardenState, restoreGardenState } from './js/persistence.js';
import { initTheme } from './js/theme.js';
import { addJournalEntry, getRandomMessage } from './js/journal.js';
import { plantTile, startGrowthCycle, updateCounter, revealGrid, toggleWateringMode, waterTile, isWateringMode, toggleFertilizeMode, fertilizeTile, isFertilizeMode, togglePruneMode, pruneTile, isPruneMode } from './js/tiles.js';
import { startVisitors, initVisitors } from './js/visitors.js';
import { initSoundscape } from './js/soundscape.js';
import { initStats } from './js/stats.js';
import { startSelfSeeding } from './js/selfseeding.js';


(function () {
  'use strict';

  // ── Capture DOM References ──
  dom.garden = document.getElementById('garden');
  dom.seed = document.getElementById('seed');
  dom.sprout = document.getElementById('sprout');
  dom.hint = document.getElementById('hint');
  dom.message = document.getElementById('message');
  dom.card = document.getElementById('welcomeCard');
  dom.gardenGridWrapper = document.getElementById('gardenGridWrapper');
  dom.gardenGrid = document.getElementById('gardenGrid');
  dom.gridHint = document.getElementById('gridHint');
  dom.counter = document.getElementById('counter');
  dom.tiles = dom.gardenGrid.querySelectorAll('.grid-tile');
  dom.tendingToolbar = document.getElementById('tendingToolbar');
  dom.tendingHint = document.getElementById('tendingHint');
  dom.wateringCanBtn = document.getElementById('wateringCanBtn');
  dom.pruneBtn = document.getElementById('pruneBtn');
  dom.fertilizeBtn = document.getElementById('fertilizeBtn');
  dom.gardenJournal = document.getElementById('gardenJournal');
  dom.journalTimeline = document.getElementById('journalTimeline');
  dom.journalEmpty = document.getElementById('journalEmpty');
  dom.visitorsLayer = document.getElementById('visitorsLayer');
  dom.soundscapeToggle = document.getElementById('soundscapeToggle');
  dom.soundscapeIcon = document.getElementById('soundscapeIcon');
  dom.gardenStats = document.getElementById('gardenStats');
  dom.statFlowersValue = document.getElementById('statFlowersValue');
  dom.statFlowersEmoji = document.getElementById('statFlowersEmoji');
  dom.statFlowersLabel = document.getElementById('statFlowersLabel');
  dom.statSeasonValue = document.getElementById('statSeasonValue');
  dom.statSeasonEmoji = document.getElementById('statSeasonEmoji');
  dom.statTendedValue = document.getElementById('statTendedValue');
  dom.statTendedEmoji = document.getElementById('statTendedEmoji');
  dom.statMoodValue = document.getElementById('statMoodValue');
  dom.statMoodEmoji = document.getElementById('statMoodEmoji');
  dom.statMoodCard = document.getElementById('statMoodCard');
  dom.statsPoem = document.getElementById('statsPoem');

  // ── Initialize Theme ──
  initTheme();

  // ── Restore Garden from localStorage ──
  var savedState = loadGardenState();

  // ── Welcome Garden (seed-bloom) ──
  var planted = false;

  function createSparkles() {
    var garden = dom.garden;
    var rect = garden.getBoundingClientRect();
    var centerX = rect.width / 2;
    var centerY = rect.height / 2 - 10;

    for (var i = 0; i < 8; i++) {
      var sparkle = document.createElement('div');
      sparkle.classList.add('sparkle');
      var angle = (Math.PI * 2 * i) / 8;
      var distance = 2 + Math.random() * 2;
      var tx = Math.cos(angle) * distance * 10 + 'px';
      var ty = Math.sin(angle) * distance * 10 + 'px';
      sparkle.style.setProperty('--tx', tx);
      sparkle.style.setProperty('--ty', ty);
      sparkle.style.left = centerX + 'px';
      sparkle.style.top = centerY + 'px';
      garden.appendChild(sparkle);

      (function (s) {
        setTimeout(function () { s.remove(); }, 1000);
      })(sparkle);
    }
  }

  function plantSeed() {
    if (planted) return;
    planted = true;

    var hint = dom.hint;
    var card = dom.card;
    var seed = dom.seed;
    var sprout = dom.sprout;
    var message = dom.message;

    hint.classList.add('fade-out');
    card.classList.add('glow-intensify');
    seed.classList.add('visible');

    setTimeout(function () {
      sprout.classList.add('growing');
    }, 800);

    setTimeout(function () {
      sprout.classList.remove('growing');
      sprout.classList.add('grown');
      createSparkles();

      message.textContent = getRandomMessage();
      message.classList.add('visible');
    }, 3500);

    setTimeout(function () {
      revealGrid();
      startVisitors();
    }, 5000);

    saveGardenState();
  }

  dom.garden.addEventListener('click', plantSeed);
  dom.garden.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      plantSeed();
    }
  });

  // ── Tile click handlers ──
  dom.tiles.forEach(function (tile) {
    tile.addEventListener('click', function () {
      var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
      if (isPruneMode() && tile.classList.contains('planted')) {
        pruneTile(tile, tileIndex);
      } else if (isFertilizeMode() && tile.classList.contains('planted')) {
        fertilizeTile(tile, tileIndex);
      } else if (isWateringMode() && tile.classList.contains('planted')) {
        waterTile(tile, tileIndex);
      } else {
        plantTile(tile);
      }
    });
    tile.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
        if (isPruneMode() && tile.classList.contains('planted')) {
          pruneTile(tile, tileIndex);
        } else if (isFertilizeMode() && tile.classList.contains('planted')) {
          fertilizeTile(tile, tileIndex);
        } else if (isWateringMode() && tile.classList.contains('planted')) {
          waterTile(tile, tileIndex);
        } else {
          plantTile(tile);
        }
      }
    });
  });

  // ── Watering can button ──
  dom.wateringCanBtn.addEventListener('click', function () {
    toggleWateringMode();
  });

  dom.wateringCanBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleWateringMode();
    }
  });

  // ── Prune button ──
  dom.pruneBtn.addEventListener('click', function () {
    togglePruneMode();
  });

  dom.pruneBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePruneMode();
    }
  });

  // ── Fertilize button ──
  dom.fertilizeBtn.addEventListener('click', function () {
    toggleFertilizeMode();
  });

  dom.fertilizeBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFertilizeMode();
    }
  });

  // ── Initialize Visitors ──
  initVisitors();

  // ── Initialize Soundscape ──
  initSoundscape();

  // ── Initialize Stats ──
  initStats();

  // ── Initialize Self-Seeding ──
  startSelfSeeding();

  // ── Restore saved garden after all functions are ready ──
  if (savedState && savedState.plantedCount > 0) {
    restoreGardenState(
      savedState,
      {
        addJournalEntry: addJournalEntry,
        startGrowthCycle: startGrowthCycle,
        updateCounter: updateCounter
      }
    );
    if (gridRevealed.value) {
      startVisitors();
    }
  }
})();
