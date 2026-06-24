// ── Off-Screen Garden Aging ──
// Simulates time-based garden progression between visits so the garden
// visibly evolves while the user is away.
//
// Composes existing systems: weather cycling, self-seeding, growth cycles, journal.

import { dom, currentWeather, plantedCount, tileCycleState, tileColorMap, tileFlowerTypeMap, totalVolunteers, journalEntries, petalPalettes } from './state.js';
import { saveGardenState } from './persistence.js';
import { getBloomingCount } from './visitors.js';
import { startGrowthCycle } from './tiles.js';
import { getWeatherModifier } from './weather.js';

var LAST_VISIT_KEY = 'selfgrow_last_visit';
var MAX_SIMULATED_DAYS = 7;
var HOURS_PER_WEATHER_CYCLE = 2;
var lastAgingResults = null; // stored for renderAgingResults
var WILDFLOWER_PALETTES = [
  ['#c4b5a0', '#a89985', '#968a74'],
  ['#b8a9c9', '#9d8db5', '#8a779f'],
  ['#aec6cf', '#95b4be', '#7da2ad'],
  ['#c9ada7', '#b5968f', '#a18077'],
  ['#b5c99a', '#9db582', '#85a16a'],
  ['#d4b8a0', '#c0a48b', '#ad9076'],
  ['#a0c4b8', '#8bb0a4', '#769c90'],
  ['#c0b5d6', '#ab9cc2', '#9683ae'],
  ['#d6c8b0', '#c2b49b', '#aea086'],
];
var WILD_CENTER_COLORS = ['#d4a574', '#c9956a', '#be8560', '#ddd3c4', '#d0c4b2', '#c3b5a0'];

// ── Timestamp management ──

export function recordVisitTimestamp() {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  } catch (e) {
    // silently fail
  }
}

function getLastVisitTimestamp() {
  try {
    var raw = localStorage.getItem(LAST_VISIT_KEY);
    if (!raw) return null;
    var ts = parseInt(raw, 10);
    return isNaN(ts) ? null : ts;
  } catch (e) {
    return null;
  }
}

// ── Compute elapsed hours between visits ──

function computeElapsedHours() {
  var lastVisit = getLastVisitTimestamp();
  if (!lastVisit) return 0;
  var elapsed = Date.now() - lastVisit;
  if (elapsed < 0) return 0;
  var hours = elapsed / 3600000;
  // Cap at 7 days
  var maxMs = MAX_SIMULATED_DAYS * 24 * 3600000;
  if (elapsed > maxMs) return MAX_SIMULATED_DAYS * 24;
  return hours;
}

// ── Weather simulation ──

var WEATHER_CYCLE = ['sunny', 'cloudy', 'rainy']; // no snow at night

function simulateWeatherCycles(hoursElapsed) {
  var cyclesCount = Math.floor(hoursElapsed / HOURS_PER_WEATHER_CYCLE);
  if (cyclesCount <= 0) return [];

  var weatherLog = [];
  // Start from current weather's position in the cycle
  var weatherIdx = WEATHER_CYCLE.indexOf(currentWeather.value);
  if (weatherIdx === -1) weatherIdx = 0;

  for (var i = 0; i < cyclesCount; i++) {
    weatherIdx = (weatherIdx + 1) % WEATHER_CYCLE.length;
    var state = WEATHER_CYCLE[weatherIdx];
    weatherLog.push(state);
  }

  // Apply final weather state
  if (weatherLog.length > 0) {
    currentWeather.value = weatherLog[weatherLog.length - 1];
  }

  return weatherLog;
}

// ── Shared weather messages (used by both addSimulatedWeatherEntries and renderWeatherEntries) ──

var WEATHER_MESSAGES = {
  sunny: ['the sun returned in your absence', 'golden light warmed the soil', 'the garden basked in remembered sunshine'],
  rainy: ['rain fell gently while you were away', 'a quiet rain nourished the earth', 'raindrops visited the garden in silence'],
  cloudy: ['clouds drifted through a grey sky', 'the garden rested under overcast heavens', 'soft grey light held the garden']
};

// ── Add weather entries for simulated changes ──

function addSimulatedWeatherEntries(weatherLog) {
  if (weatherLog.length === 0) return;

  var now = Date.now();

  weatherLog.forEach(function (state, i) {
    var timeOffset = now + (i + 1) * 1000; // stagger timestamps
    var date = new Date(timeOffset);
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var displayHours = hours % 12 || 12;
    var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
    var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;

    var msgs = WEATHER_MESSAGES[state] || WEATHER_MESSAGES.sunny;
    var msg = msgs[Math.floor(Math.random() * msgs.length)];

    var entry = {
      tileIndex: -1,
      petalColor: getWeatherColor(state),
      time: timeStr,
      timestamp: timeOffset,
      cycle: 0,
      type: 'weather',
      weatherState: state,
      weatherMessage: msg
    };
    journalEntries.push(entry);
  });

  // Cap journal entries
  if (journalEntries.length > 30) {
    journalEntries.splice(0, journalEntries.length - 30);
  }
}

function getWeatherColor(state) {
  var colors = { sunny: '#fbbf24', rainy: '#60a5fa', cloudy: '#94a3b8' };
  return colors[state] || '#94a3b8';
}

function renderWeatherEntries(weatherLog) {
  var journalTimeline = dom.journalTimeline;
  if (!journalTimeline || weatherLog.length === 0) return;

  journalTimeline.scrollTop = 0;

  var emojis = { sunny: '☀️', rainy: '🌧️', cloudy: '☁️' };
  var now = Date.now();

  // Add in reverse (newest first) so they appear correctly in the prepend-order timeline
  for (var i = weatherLog.length - 1; i >= 0; i--) {
    var state = weatherLog[i];
    var timeOffset = now + (i + 1) * 1000;
    var date = new Date(timeOffset);
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var displayHours = hours % 12 || 12;
    var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
    var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;
    var msgs = WEATHER_MESSAGES[state] || WEATHER_MESSAGES.sunny;
    var msg = msgs[Math.floor(Math.random() * msgs.length)];

    var entryEl = document.createElement('div');
    entryEl.classList.add('journal-entry', 'journal-entry--weather');
    entryEl.setAttribute('role', 'listitem');

    entryEl.innerHTML =
      '<div class="entry-timeline-dot entry-timeline-dot--weather"></div>' +
      '<div class="entry-content">' +
        '<p class="entry-text">' + emojis[state] + ' ' + msg + '</p>' +
        '<p class="entry-time">' + timeStr + ' &mdash; while you were away</p>' +
      '</div>' +
      '<div class="entry-swatch entry-swatch--weather" style="background: ' + getWeatherColor(state) + '" aria-hidden="true"></div>';

    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
  }
}

// ── Self-seeding simulation (volunteer wildflower) ──

function getEmptyTileIndices() {
  var empty = [];
  var tiles = dom.tiles;
  if (!tiles) return empty;
  tiles.forEach(function (tile) {
    if (!tile.classList.contains('planted')) {
      var idx = parseInt(tile.getAttribute('data-tile'), 10);
      empty.push(idx);
    }
  });
  return empty;
}

function simulateVolunteer(hoursElapsed) {
  if (hoursElapsed < 6) return null;

  var bloomingCount = getBloomingCount();
  if (bloomingCount < 3) return null;

  var emptyIndices = getEmptyTileIndices();
  if (emptyIndices.length === 0) return null;

  // Pick a random empty tile
  var tileIndex = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  var tileEl = dom.tiles[tileIndex];
  if (!tileEl) return null;

  // Apply wildflower
  var wildPalette = WILDFLOWER_PALETTES[tileIndex % WILDFLOWER_PALETTES.length];
  var wildCenter = WILD_CENTER_COLORS[tileIndex % WILD_CENTER_COLORS.length];

  var petalEls = tileEl.querySelectorAll('.tile-petal');
  petalEls.forEach(function (petal, i) {
    petal.style.background = wildPalette[i % wildPalette.length];
  });
  var centerEl = tileEl.querySelector('.tile-center');
  if (centerEl) {
    centerEl.style.background = wildCenter;
    centerEl.style.boxShadow = '0 0 0.2rem rgba(212, 165, 116, 0.5)';
  }

  tileColorMap[tileIndex] = wildPalette[0];
  tileFlowerTypeMap[tileIndex] = 'wildflower';
  tileCycleState[tileIndex] = {
    cycle: 1,
    stage: 'volunteer',
    timeouts: [],
    isVolunteer: true,
    flowerType: 'wildflower'
  };

  // Apply wildflower CSS class
  var sproutEl = tileEl.querySelector('.tile-sprout');
  if (sproutEl) {
    sproutEl.classList.add('flower-wildflower');
  }

  tileEl.classList.add('planted', 'volunteer');
  tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' volunteer plant');

  // Start the growth cycle (volunteer blooms during absence, so mark as grown)
  plantedCount.value++;
  totalVolunteers.value++;

  // Set the tile visually to grown
  var tileSprout = tileEl.querySelector('.tile-sprout');
  var tileSeed = tileEl.querySelector('.tile-seed');
  var badge = tileEl.querySelector('.tile-cycle-badge');

  tileSeed.classList.remove('visible');
  if (tileSprout) {
    tileSprout.classList.remove('growing', 'budding', 'blooming', 'wilting');
    tileSprout.classList.add('grown');
  }
  if (badge) {
    badge.textContent = '🌿 1';
    badge.classList.add('visible');
  }

  // Schedule wilt so the growth cycle continues
  var wMod = getWeatherModifier();
  var sleepFactor = typeof window !== 'undefined' && window.__gardenSleepFactor != null ? window.__gardenSleepFactor : 1;
  var mult = (wMod ? wMod.growthMultiplier : 1.0) * sleepFactor;
  var holdBloom = Math.max(8000 * mult, 200);
  var offset = tileIndex * 1200 * mult;

  setTimeout(function () {
    if (!tileEl.classList.contains('planted')) return;
    var sp = tileEl.querySelector('.tile-sprout');
    if (!sp || !sp.classList.contains('grown')) return;

    sp.classList.remove('grown');
    sp.classList.add('wilting');

    setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;
      if (badge) badge.classList.remove('visible');
      tileCycleState[tileIndex].cycle = 2;
      startGrowthCycle(tileEl, tileIndex);
      saveGardenState();
    }, Math.max(2000 * mult, 200) + Math.max(1500 * mult, 200));
  }, holdBloom + offset);

  return {
    tileIndex: tileIndex,
    petalColor: wildPalette[0]
  };
}

// ── Growth cycle advance simulation ──

function simulateGrowthAdvance(hoursElapsed) {
  if (hoursElapsed < 24) return null;

  var tiles = dom.tiles;
  if (!tiles) return null;

  // Find a planted tile to advance
  var plantedIndices = [];
  tiles.forEach(function (tile) {
    if (tile.classList.contains('planted')) {
      var idx = parseInt(tile.getAttribute('data-tile'), 10);
      var state = tileCycleState[idx];
      if (state) {
        plantedIndices.push(idx);
      }
    }
  });

  if (plantedIndices.length === 0) return null;

  var tileIndex = plantedIndices[Math.floor(Math.random() * plantedIndices.length)];
  var tileEl = dom.tiles[tileIndex];
  if (!tileEl) return null;

  var state = tileCycleState[tileIndex];
  var oldCycle = state.cycle;

  // Advance the cycle: increment and reset to grown so it looks like it bloomed
  state.cycle++;
  if (state.cycle > 1 && state.stage !== 'volunteer') {
    state.stage = 'regrown';
  }

  var sprout = tileEl.querySelector('.tile-sprout');
  var badge = tileEl.querySelector('.tile-cycle-badge');

  // Reset to grown with new cycle number
  if (sprout) {
    sprout.classList.remove('wilting', 'dormant', 'regrowing', 'regrow-bud', 'regrow-bloom', 'regrow-wilt');
    sprout.classList.add('grown');
  }
  if (badge) {
    badge.textContent = state.isVolunteer ? '🌿 ' + state.cycle : '🌸 ' + state.cycle;
    badge.classList.add('visible');
  }

  var primaryColor = tileColorMap[tileIndex] || petalPalettes[tileIndex % petalPalettes.length][0];

  return {
    tileIndex: tileIndex,
    petalColor: primaryColor,
    newCycle: state.cycle,
    oldCycle: oldCycle
  };
}

// ── Welcome-back journal entry ──

function getWelcomeBackPoem(hoursElapsed, weatherLog, volunteerResult, growthResult) {
  var parts = [];

  if (hoursElapsed < 6) {
    parts.push('you were gone but a moment — the garden barely stirred');
  } else if (hoursElapsed < 24) {
    parts.push('a few hours passed, and the garden continued its quiet work');
  } else if (hoursElapsed < 48) {
    parts.push('a day passed like a slow breath — the garden grew in your absence');
  } else if (hoursElapsed < 72) {
    parts.push('two suns rose and set while the garden dreamed of your return');
  } else if (hoursElapsed < 120) {
    parts.push('several days slipped by — the garden wove new stories in petals and leaf');
  } else {
    parts.push('a long week passed, yet the garden held your place in its soil');
  }

  if (weatherLog.length > 0) {
    var weatherCounts = {};
    weatherLog.forEach(function (w) { weatherCounts[w] = (weatherCounts[w] || 0) + 1; });
    var dominant = '';
    var maxCount = 0;
    for (var w in weatherCounts) {
      if (weatherCounts[w] > maxCount) {
        maxCount = weatherCounts[w];
        dominant = w;
      }
    }
    if (dominant === 'rainy') parts.push('rain whispered through the leaves');
    else if (dominant === 'sunny') parts.push('sunlight coaxed new colour from the soil');
    else if (dominant === 'cloudy') parts.push('clouds cradled the garden in soft grey');
  }

  if (volunteerResult) {
    parts.push('a wild guest arrived, rooting where none was sown');
  }

  if (growthResult) {
    parts.push('a flower found the strength to bloom again');
  }

  return parts.join(' · ');
}

function formatHoursElapsed(hours) {
  if (hours < 1) return 'a few minutes';
  if (hours < 2) return 'about an hour';
  if (hours < 24) return Math.round(hours) + ' hours';
  var days = Math.floor(hours / 24);
  var remaining = Math.round(hours % 24);
  if (remaining === 0) return days + ' day' + (days > 1 ? 's' : '');
  return days + ' day' + (days > 1 ? 's' : '') + ' and ' + remaining + ' hr';
}

// ── Welcome-back banner ──

function showWelcomeBackBanner(hoursElapsed, poem) {
  var banner = document.createElement('div');
  banner.classList.add('welcome-back-banner');
  banner.id = 'welcomeBackBanner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  var timeStr = formatHoursElapsed(hoursElapsed);

  banner.innerHTML =
    '<div class="welcome-back-banner__glow" aria-hidden="true"></div>' +
    '<div class="welcome-back-banner__content">' +
      '<p class="welcome-back-banner__heading">welcome back</p>' +
      '<p class="welcome-back-banner__time">' + timeStr + ' away</p>' +
      '<p class="welcome-back-banner__poem">' + poem + '</p>' +
    '</div>';

  document.body.appendChild(banner);

  // Trigger entrance
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      banner.classList.add('welcome-back-banner--visible');
    });
  });

  return banner;
}

// ── Simulated journal entry rendering ──

function renderVolunteerEntry(result) {
  var journalTimeline = dom.journalTimeline;
  if (!journalTimeline || !result) return;

  journalTimeline.scrollTop = 0;

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry', 'journal-entry--volunteer');
  entryEl.setAttribute('role', 'listitem');

  var now = new Date();
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
  var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;

  entryEl.innerHTML =
    '<div class="entry-timeline-dot entry-timeline-dot--volunteer"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text">🌿 <strong>Tile ' + (result.tileIndex + 1) + '</strong> &mdash; volunteer while away</p>' +
      '<p class="entry-time">' + timeStr + ' &mdash; a seed carried by the wind finds its home</p>' +
    '</div>' +
    '<div class="entry-swatch entry-swatch--volunteer" style="background: ' + result.petalColor + '" aria-hidden="true"></div>';

  journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
}

function renderGrowthEntry(result) {
  var journalTimeline = dom.journalTimeline;
  if (!journalTimeline || !result) return;

  journalTimeline.scrollTop = 0;

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry');
  entryEl.setAttribute('role', 'listitem');

  var now = new Date();
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
  var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;

  var cyclePoems = [
    'a new cycle begins in your absence',
    'life renews itself even unwatched',
    'the garden breathes and blooms again',
    'from soil, life returns — quietly, insistently',
    'nature\'s rhythm needs no audience'
  ];
  var poem = cyclePoems[Math.floor(Math.random() * cyclePoems.length)];

  entryEl.innerHTML =
    '<div class="entry-timeline-dot"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text"><strong>Tile ' + (result.tileIndex + 1) + '</strong> &mdash; 🌸 cycle ' + result.newCycle + ' at ' + timeStr + '</p>' +
      '<p class="entry-time">' + poem + ' (while away)</p>' +
    '</div>' +
    '<div class="entry-swatch" style="background: ' + result.petalColor + '" aria-hidden="true"></div>';

  journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
}

function renderWelcomeBackEntry(poem) {
  var journalTimeline = dom.journalTimeline;
  if (!journalTimeline) return;

  journalTimeline.scrollTop = 0;

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry', 'journal-entry--welcome-back');
  entryEl.setAttribute('role', 'listitem');

  entryEl.innerHTML =
    '<div class="entry-timeline-dot entry-timeline-dot--welcome-back"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text">🌱 your garden grew while you were away</p>' +
      '<p class="entry-time">' + poem + '</p>' +
    '</div>';

  journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
}

// ── Add journal entries to in-memory array ──

function addVolunteerJournalEntry(result) {
  if (!result) return;
  var now = new Date();
  journalEntries.push({
    tileIndex: result.tileIndex,
    petalColor: result.petalColor,
    time: formatSimpleTime(now),
    timestamp: now.getTime(),
    cycle: 1,
    type: 'volunteer',
    subText: 'a seed carried by the wind finds its home'
  });
  if (journalEntries.length > 30) journalEntries.splice(0, journalEntries.length - 30);
}

function addGrowthJournalEntry(result) {
  if (!result) return;
  var now = new Date();
  journalEntries.push({
    tileIndex: result.tileIndex,
    petalColor: result.petalColor,
    time: formatSimpleTime(now),
    timestamp: now.getTime(),
    cycle: result.newCycle,
    type: 'cycle'
  });
  if (journalEntries.length > 30) journalEntries.splice(0, journalEntries.length - 30);
}

function formatSimpleTime(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
  return displayHours + ':' + displayMinutes + ' ' + ampm;
}

// ── Public: Run aging simulation ──

export function simulateGardenAging() {
  var elapsed = computeElapsedHours();

  // If less than 1 hour, no meaningful time has passed
  if (elapsed < 1) {
    recordVisitTimestamp();
    return;
  }

  // ── Step 1: Weather simulation ──
  var weatherLog = simulateWeatherCycles(elapsed);
  addSimulatedWeatherEntries(weatherLog);

  // ── Step 2: Volunteer seeding (6+ hours, 3+ blooming, has empty tiles) ──
  var volunteerResult = null;
  if (elapsed >= 6) {
    volunteerResult = simulateVolunteer(elapsed);
    if (volunteerResult) {
      addVolunteerJournalEntry(volunteerResult);
    }
  }

  // ── Step 3: Growth cycle advance (24+ hours) ──
  var growthResult = null;
  if (elapsed >= 24) {
    growthResult = simulateGrowthAdvance(elapsed);
    if (growthResult) {
      addGrowthJournalEntry(growthResult);
    }
  }

  // ── Step 4: Welcome-back journal entry (48+ hours) ──
  if (elapsed >= 48) {
    var poem = getWelcomeBackPoem(elapsed, weatherLog, volunteerResult, growthResult);
    // This entry is rendered by the banner + journal entry below
  }

  // ── Step 5: Save state ──
  saveGardenState();

  // ── Store results for DOM rendering ──
  lastAgingResults = {
    elapsed: elapsed,
    weatherLog: weatherLog,
    volunteerResult: volunteerResult,
    growthResult: growthResult
  };

  // ── Record new visit timestamp ──
  recordVisitTimestamp();
}

// ── Public: Render aging results in DOM (called after journal is restored) ──

export function renderAgingResults() {
  if (!lastAgingResults) return;

  var results = lastAgingResults;
  var elapsed = results.elapsed;
  if (elapsed < 1) return;

  var journalTimeline = dom.journalTimeline;
  if (!journalTimeline) return;

  // ── Weather entries ──
  // Check if weather entries were already added to the journal DOM
  // by looking for existing weather entries with 'while you were away' text
  if (results.weatherLog && results.weatherLog.length > 0) {
    var hasWeatherEntries = false;
    for (var w = 0; w < journalTimeline.children.length; w++) {
      var wChild = journalTimeline.children[w];
      if (wChild.classList.contains('journal-entry--weather')) {
        var wTextEl = wChild.querySelector('.entry-time');
        if (wTextEl && wTextEl.textContent.indexOf('while you were away') !== -1) {
          hasWeatherEntries = true;
          break;
        }
      }
    }
    if (!hasWeatherEntries) {
      renderWeatherEntries(results.weatherLog);
    }
  }

  // ── Volunteer entry ──
  if (results.volunteerResult) {
    // Check if DOM entry already exists
    var volTileIdx = results.volunteerResult.tileIndex;
    var hasVolEntry = false;
    for (var j = 0; j < journalTimeline.children.length; j++) {
      var child = journalTimeline.children[j];
      if (child.classList.contains('journal-entry--volunteer')) {
        var tEl = child.querySelector('.entry-text');
        if (tEl && tEl.textContent.indexOf('Tile ' + (volTileIdx + 1)) !== -1) {
          hasVolEntry = true;
          break;
        }
      }
    }
    if (!hasVolEntry) {
      renderVolunteerEntry(results.volunteerResult);
    }
  }

  // ── Growth cycle advance entry ──
  if (results.growthResult) {
    var grTileIdx = results.growthResult.tileIndex;
    var grCycle = results.growthResult.newCycle;
    var hasGrowthEntry = false;
    for (var j = 0; j < journalTimeline.children.length; j++) {
      var child = journalTimeline.children[j];
      var tEl = child.querySelector('.entry-text');
      if (tEl && tEl.textContent.indexOf('Tile ' + (grTileIdx + 1) + ' \u2014 \ud83c\udf38 cycle ' + grCycle) !== -1) {
        hasGrowthEntry = true;
        break;
      }
    }
    if (!hasGrowthEntry) {
      renderGrowthEntry(results.growthResult);
    }
  }

  // ── Welcome-back journal entry (48+ hours) ──
  if (elapsed >= 48) {
    var hasWelcome = false;
    for (var j = 0; j < journalTimeline.children.length; j++) {
      if (journalTimeline.children[j].classList.contains('journal-entry--welcome-back')) {
        hasWelcome = true;
        break;
      }
    }
    if (!hasWelcome) {
      var welcomePoem = getWelcomeBackPoem(elapsed, results.weatherLog || [], results.volunteerResult, results.growthResult);
      renderWelcomeBackEntry(welcomePoem);
    }
  }

  // ── Welcome-back banner (always for any elapsed time >= 1 hour) ──
  if (elapsed >= 1) {
    var bannerPoem = getWelcomeBackPoem(elapsed, results.weatherLog || [], results.volunteerResult, results.growthResult);
    showWelcomeBackBanner(elapsed, bannerPoem);
  }

  // ── Trim journal entries if needed ──
  if (journalEntries.length > 30) {
    journalEntries.splice(0, journalEntries.length - 30);
    while (journalTimeline.children.length > 30) {
      journalTimeline.removeChild(journalTimeline.lastChild);
    }
  }
}

// ── Public: Record timestamp on page unload ──

export function setupUnloadTimestamp() {
  window.addEventListener('beforeunload', function () {
    recordVisitTimestamp();
  });
}

// ── Public: Check if there's a saved timestamp (for determining if welcome-back applies) ──

export function hasSavedTimestamp() {
  return getLastVisitTimestamp() !== null;
}

// ── Public: Get elapsed hours (for testing/logging) ──
export function getElapsedHours() {
  return computeElapsedHours();
}
