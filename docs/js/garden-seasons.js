// ── Garden Seasons — Calendar-Based Meteorological Seasons ──
// Uses new Date().getMonth() to determine the current season:
// Spring (Mar-May), Summer (Jun-Aug), Autumn (Sep-Nov), Winter (Dec-Feb)
// Each season brings a CSS overlay class on <body>, rare transient events,
// and a journal entry on first detection of a seasonal shift.

import { dom, journalEntries, plantedCount, totalTiles } from './state.js';
import { saveGardenState } from './persistence.js';
import { formatTime } from './journal.js';
import { getBloomingCount } from './visitors.js';

var SEASON_STATE_KEY = 'selfgrow_last_season';

var seasonConfig = {
  spring: {
    label: 'spring',
    emoji: '🌷',
    flowerEmoji: '🌱',
    poem: 'the garden stirs beneath the melting frost',
    dewMessage: 'morning dew clings to each petal, refracting the pale light',
    butterflyMessage: 'a butterfly migration drifts through the garden on warm currents',
    dewClass: 'season-dew-sparkle',
  },
  summer: {
    label: 'summer',
    emoji: '🌻',
    flowerEmoji: '☀️',
    poem: 'golden warmth bathes every leaf and petal',
    harvestMessage: 'a harvest breeze carries the scent of ripening seeds',
    shimmerClass: 'season-golden-shimmer',
  },
  autumn: {
    label: 'autumn',
    emoji: '🍂',
    flowerEmoji: '🍁',
    poem: 'amber leaves drift as the garden prepares for rest',
    leavesMessage: 'a warm wind scorns dead leaves from wilting petals',
    frostMessage: 'the first frost traces delicate patterns on empty soil',
    leafClass: 'season-leaf-drift',
  },
  winter: {
    label: 'winter',
    emoji: '❄️',
    flowerEmoji: '🌨️',
    poem: 'the garden sleeps beneath a veil of frost',
    frostMessage: 'frost crystallizes along the garden\'s quiet borders',
    frostClass: 'season-frost-border',
  },
};

// Determine the current meteorological season from month
export function getCurrentGardenSeason() {
  var month = new Date().getMonth(); // 0=Jan, 1=Feb, ...
  if (month >= 2 && month <= 4) return 'spring';   // Mar, Apr, May
  if (month >= 5 && month <= 7) return 'summer';   // Jun, Jul, Aug
  if (month >= 8 && month <= 10) return 'autumn';   // Sep, Oct, Nov
  return 'winter';                                   // Dec, Jan, Feb
}

// Apply the season class to <body> (layered on top of time-of-day classes)
function applySeasonClass(season) {
  var body = document.body;
  // Remove any existing season classes
  body.classList.remove('season-spring', 'season-summer', 'season-autumn', 'season-winter');
  body.classList.add('season-' + season);
}

// Check if the season has changed since last visit — if so, log a journal entry
function detectSeasonShift(currentSeason) {
  var lastRecorded = null;
  try {
    lastRecorded = localStorage.getItem(SEASON_STATE_KEY);
  } catch (e) {
    // localStorage unavailable
  }

  if (lastRecorded !== currentSeason) {
    // Season has changed — record it
    try {
      localStorage.setItem(SEASON_STATE_KEY, currentSeason);
    } catch (e) {
      // ignore
    }

    // Add journal entry for the shift
    addSeasonJournalEntry(currentSeason);
  }
}

// Add a seasonal shift journal entry
function addSeasonJournalEntry(season) {
  var config = seasonConfig[season] || seasonConfig.spring;
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;

  if (!gardenJournal) return;

  // Show the journal if not already visible
  gardenJournal.classList.add('visible');
  gardenJournal.setAttribute('aria-hidden', 'false');

  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  var now = new Date();
  var timeStr = formatTime(now);

  var entry = {
    tileIndex: -1,
    petalColor: getSeasonColor(season),
    time: timeStr,
    timestamp: now.getTime(),
    cycle: 0,
    type: 'season',
    season: season,
    seasonMessage: config.poem,
  };
  journalEntries.push(entry);

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry', 'journal-entry--season');
  entryEl.setAttribute('role', 'listitem');

  entryEl.innerHTML =
    '<div class="entry-timeline-dot entry-timeline-dot--season"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text">' + config.emoji + ' ' + config.poem + '</p>' +
      '<p class="entry-time">' + timeStr + ' &mdash; the season turns</p>' +
    '</div>' +
    '<div class="entry-swatch entry-swatch--season" style="background: ' + getSeasonColor(season) + '" aria-hidden="true"></div>';

  if (journalTimeline) {
    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
    journalTimeline.scrollTop = 0;
  }

  if (gardenJournal) {
    gardenJournal.classList.remove('pulse');
    void gardenJournal.offsetWidth;
    gardenJournal.classList.add('pulse');
  }

  saveGardenState();
}

function getSeasonColor(season) {
  var colors = {
    spring: '#93d9a0',
    summer: '#fcd34d',
    autumn: '#c2884a',
    winter: '#b8c8e0',
  };
  return colors[season] || '#93d9a0';
}

// ── Rare Transient Events ──
// Each season can trigger ONE rare transient event per garden visit.
// Events are purely CSS-animated overlays that briefly augment the garden.

var rareEventTriggered = false;

function triggerRareEvent(season) {
  if (rareEventTriggered) return;
  rareEventTriggered = true;

  var config = seasonConfig[season];
  if (!config) return;

  // Only trigger if there are blooming flowers or planted tiles
  var blooming = getBloomingCount();
  var planted = plantedCount.value;
  if (blooming === 0 && planted === 0) return;

  // Small delay so it doesn't all fire at once on page load
  setTimeout(function () {
    switch (season) {
      case 'spring':
        triggerSpringEvent(config);
        break;
      case 'summer':
        triggerSummerEvent(config);
        break;
      case 'autumn':
        triggerAutumnEvent(config);
        break;
      case 'winter':
        triggerWinterEvent(config);
        break;
    }
  }, 2000 + Math.random() * 3000);
}

function triggerSpringEvent(config) {
  // Try dew first if there are blooming flowers, otherwise butterfly
  var blooming = getBloomingCount();
  if (blooming >= 2) {
    applyDewEvent(config);
    // Maybe also spawn extra butterflies
    var extraButterflies = document.querySelectorAll('.visitors-layer .butterfly').length < 6;
    if (extraButterflies) {
      addRareJournalEntry(config.emoji + ' ' + config.butterflyMessage, 'spring-butterfly');
    }
  } else {
    addRareJournalEntry(config.emoji + ' ' + config.dewMessage, 'spring-dew');
  }
}

function triggerSummerEvent(config) {
  // Golden shimmer on the garden
  var tileEl = getRandomBloomingTile();
  if (tileEl) {
    tileEl.classList.add(config.shimmerClass);
    setTimeout(function () {
      tileEl.classList.remove(config.shimmerClass);
    }, 6000);
  }
  addRareJournalEntry(config.emoji + ' ' + config.poem + ' — golden warmth intensifies', 'summer-shimmer');
}

function triggerAutumnEvent(config) {
  // Drifting leaves across wilted tiles
  var tiles = document.querySelectorAll('.grid-tile.planted');
  var wiltedFound = false;
  tiles.forEach(function (tile) {
    if (tile.classList.contains('wilted') || tile.querySelector('.tile-sprout.wilting')) {
      tile.classList.add(config.leafClass);
      wiltedFound = true;
      setTimeout(function () {
        tile.classList.remove(config.leafClass);
      }, 8000);
    }
  });
  var msg = wiltedFound ? config.leavesMessage : config.frostMessage;
  addRareJournalEntry(config.emoji + ' ' + msg, wiltedFound ? 'autumn-leaves' : 'autumn-frost');
}

function triggerWinterEvent(config) {
  // Frost borders on all tiles
  var tiles = document.querySelectorAll('.grid-tile.planted');
  if (tiles.length === 0) {
    // Frost empty tiles instead
    var allTiles = document.querySelectorAll('.grid-tile');
    allTiles.forEach(function (tile) {
      tile.classList.add(config.frostClass);
      setTimeout(function () {
        tile.classList.remove(config.frostClass);
      }, 7000);
    });
  } else {
    tiles.forEach(function (tile) {
      tile.classList.add(config.frostClass);
      setTimeout(function () {
        tile.classList.remove(config.frostClass);
      }, 7000);
    });
  }
  addRareJournalEntry(config.emoji + ' ' + config.frostMessage, 'winter-frost');
}

function applyDewEvent(config) {
  var tiles = document.querySelectorAll('.grid-tile.planted');
  tiles.forEach(function (tile) {
    var sprout = tile.querySelector('.tile-sprout.grown');
    if (sprout) {
      tile.classList.add(config.dewClass);
      setTimeout(function () {
        tile.classList.remove(config.dewClass);
      }, 6000);
    }
  });
  addRareJournalEntry(config.emoji + ' ' + config.dewMessage, 'spring-dew');
}

function getRandomBloomingTile() {
  var tiles = document.querySelectorAll('.grid-tile.planted .tile-sprout.grown');
  if (!tiles || tiles.length === 0) return null;
  var arr = Array.from(tiles);
  return arr[Math.floor(Math.random() * arr.length)].closest('.grid-tile');
}

function addRareJournalEntry(message, type) {
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;

  if (!gardenJournal || !journalTimeline) return;

  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  var now = new Date();
  var timeStr = formatTime(now);

  var entry = {
    tileIndex: -1,
    petalColor: '#93d9a0',
    time: timeStr,
    timestamp: now.getTime(),
    cycle: 0,
    type: type || 'season-event',
    seasonMessage: message,
  };
  journalEntries.push(entry);

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry', 'journal-entry--season-event');
  entryEl.setAttribute('role', 'listitem');

  entryEl.innerHTML =
    '<div class="entry-timeline-dot entry-timeline-dot--season-event"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text">' + message + '</p>' +
      '<p class="entry-time">' + timeStr + ' &mdash; a rare moment</p>' +
    '</div>' +
    '<div class="entry-swatch entry-swatch--season-event" aria-hidden="true"></div>';

  journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
  journalTimeline.scrollTop = 0;

  if (gardenJournal) {
    gardenJournal.classList.remove('pulse');
    void gardenJournal.offsetWidth;
    gardenJournal.classList.add('pulse');
  }

  saveGardenState();
}

// ── Update Season Indicator in Stats Panel ──
function updateSeasonIndicator(season) {
  var config = seasonConfig[season];
  if (!config) return;

  // Update the stat season emoji to show garden season
  var statSeasonEmoji = dom.statSeasonEmoji;
  var statSeasonValue = dom.statSeasonValue;

  if (statSeasonEmoji) {
    statSeasonEmoji.textContent = config.emoji;
  }
  if (statSeasonValue) {
    statSeasonValue.textContent = config.label;
  }
}

// ── Public Init ──
export function initGardenSeasons() {
  var currentSeason = getCurrentGardenSeason();

  // 1. Apply season class to body
  applySeasonClass(currentSeason);

  // 2. Detect season shift and log journal entry
  detectSeasonShift(currentSeason);

  // 3. Update the stats panel season indicator
  updateSeasonIndicator(currentSeason);

  // 4. Schedule a rare transient event for this visit
  triggerRareEvent(currentSeason);

  // 5. Reapply season class periodically in case of long-lived page sessions
  setInterval(function() {
    var updated = getCurrentGardenSeason();
    if (updated !== currentSeason) {
      currentSeason = updated;
      applySeasonClass(currentSeason);
      detectSeasonShift(currentSeason);
      updateSeasonIndicator(currentSeason);
    }
  }, 3600000); // Check every hour
}

// Export for use in other modules
export { seasonConfig };
