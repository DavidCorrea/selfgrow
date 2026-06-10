import { dom, plantedCount, totalTiles, journalEntries, totalVolunteers, fertilizedTiles } from './state.js';
import { getCurrentSeasonName } from './theme.js';
import { getCurrentWeather } from './weather.js';
import { getBloomingCount, getPlantedCount } from './visitors.js';

var HISTORY_KEY = 'selfgrow_garden_history';
var MAX_SNAPSHOTS = 20;

// ── Snapshot poetry based on mood ──
var visitPoetry = {
  thriving: [
    'you return to a garden alive with colour',
    'the blooms remember your care',
    'life has multiplied in your absence',
  ],
  flourishing: [
    'your garden greets you with quiet abundance',
    'new growth reaches toward the light',
    'the soil hums with gentle activity',
  ],
  growing: [
    'small changes mark the passage of time',
    'your garden has been busy growing',
    'new possibilities have taken root',
  ],
  resting: [
    'the garden rests, but does not sleep',
    'stillness holds a quiet promise',
    'patience lives in every petal',
  ],
  dormant: [
    'the garden waits for your return',
    'seeds dream beneath the soil',
    'even in waiting, beauty persists',
  ],
  complete: [
    'all nine tiles tell their stories',
    'a living tapestry welcomes you home',
    'wholeness greets you at the gate',
  ],
};

function getRandomPoem(mood) {
  var poems = visitPoetry[mood] || visitPoetry.growing;
  return poems[Math.floor(Math.random() * poems.length)];
}

function getMoodLabel() {
  var blooming = getBloomingCount();
  var planted = getPlantedCount();
  var now = Date.now();
  var lastTendedMs = now;

  if (journalEntries.length > 0) {
    var latestEntry = journalEntries[journalEntries.length - 1];
    if (latestEntry.timestamp) {
      lastTendedMs = latestEntry.timestamp;
    }
  }

  var diffHours = (now - lastTendedMs) / 3600000;

  if (planted === 0 && blooming === 0) return 'dormant';
  if (planted >= totalTiles) return 'complete';
  if (blooming >= 3 && diffHours < 1) return 'thriving';
  if (blooming >= 2 && diffHours < 3) return 'flourishing';
  if (planted >= 1 && diffHours < 12) return 'growing';
  if (planted >= 1 && diffHours < 48) return 'resting';
  return 'dormant';
}

function getWeatherEmoji(weather) {
  var emojis = { sunny: '☀️', rainy: '🌧️', cloudy: '☁️', snowy: '❄️' };
  return emojis[weather] || '☀️';
}

function getMoodEmoji(mood) {
  var emojis = {
    thriving: '🌿', flourishing: '🌻', growing: '🌱',
    resting: '🍂', dormant: '💤', complete: '🌾'
  };
  return emojis[mood] || '✨';
}

function formatSnapshotDate(timestamp) {
  var date = new Date(timestamp);
  var now = new Date();
  var diffMs = now.getTime() - date.getTime();
  var diffMins = Math.floor(diffMs / 60000);
  var diffHours = Math.floor(diffMs / 3600000);
  var diffDays = Math.floor(diffMs / 86400000);

  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
  var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;

  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var month = months[date.getMonth()];
  var day = date.getDate();

  var relStr;
  if (diffMins < 1) relStr = 'just now';
  else if (diffMins < 60) relStr = diffMins + ' min ago';
  else if (diffHours < 24) relStr = diffHours + ' hr ago';
  else if (diffDays === 1) relStr = 'yesterday';
  else if (diffDays < 7) relStr = diffDays + ' days ago';
  else relStr = month + ' ' + day;

  return {
    relative: relStr,
    time: timeStr,
    fullDate: month + ' ' + day
  };
}

function getFertilizedCount() {
  var count = 0;
  for (var key in fertilizedTiles) {
    if (fertilizedTiles[key]) count++;
  }
  return count;
}

function getTotalFlowersBloomed() {
  var total = 0;
  for (var i = 0; i < journalEntries.length; i++) {
    var entry = journalEntries[i];
    if (entry.type === 'plant' || entry.type === 'cycle' || entry.type === 'volunteer') {
      total += 1;
    }
  }
  if (total === 0) {
    var tiles = dom.tiles;
    if (tiles) {
      tiles.forEach(function (tile) {
        if (tile.classList.contains('planted')) {
          total += 1;
        }
      });
    }
  }
  return total;
}

// ── Snapshot capture ──
function captureSnapshot() {
  var weather = getCurrentWeather();
  var mood = getMoodLabel();
  var planted = getPlantedCount();
  var flowers = getTotalFlowersBloomed();
  var season = getCurrentSeasonName();
  var volunteers = totalVolunteers.value;
  var fertilized = getFertilizedCount();

  var snapshot = {
    timestamp: Date.now(),
    weather: weather,
    mood: mood,
    planted: planted,
    flowers: flowers,
    season: season,
    volunteers: volunteers,
    fertilized: fertilized,
    poem: getRandomPoem(mood),
  };

  return snapshot;
}

// ── Save snapshot to localStorage ──
function saveSnapshot(snapshot) {
  var snapshots = loadSnapshots();
  snapshots.push(snapshot);

  // Cap at MAX_SNAPSHOTS to prevent bloat
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS);
  }

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(snapshots));
  } catch (e) {
    // localStorage might be full
  }
}

// ── Load snapshots from localStorage ──
function loadSnapshots() {
  try {
    var raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

// ── Create the toggle button ──
function createHistoryToggle() {
  var journalHeader = document.querySelector('.journal-header');
  if (!journalHeader) return;

  // Check if already created
  if (document.getElementById('historyToggleBtn')) return;

  var btn = document.createElement('button');
  btn.classList.add('history-toggle');
  btn.id = 'historyToggleBtn';
  btn.setAttribute('aria-label', 'View garden history');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('title', 'Garden history');
  btn.type = 'button';
  btn.innerHTML = '<span class="history-toggle__icon" aria-hidden="true">📖</span><span class="history-toggle__label">history</span>';

  btn.addEventListener('click', function () {
    toggleHistory();
  });

  journalHeader.appendChild(btn);
}

// ── Create the history section ──
function createHistorySection() {
  var gardenJournal = dom.gardenJournal;
  if (!gardenJournal) return;

  // Check if already created
  if (document.getElementById('gardenHistory')) return;

  var historySection = document.createElement('div');
  historySection.classList.add('garden-history');
  historySection.id = 'gardenHistory';
  historySection.setAttribute('aria-hidden', 'true');

  var historyHeader = document.createElement('div');
  historyHeader.classList.add('garden-history__header');

  historyHeader.innerHTML =
    '<span class="garden-history__title">garden history</span>' +
    '<span class="garden-history__count" id="historyCount"></span>';

  var historyList = document.createElement('div');
  historyList.classList.add('garden-history__list');
  historyList.id = 'historyList';
  historyList.setAttribute('role', 'list');
  historyList.setAttribute('aria-label', 'Garden visit history');

  historySection.appendChild(historyHeader);
  historySection.appendChild(historyList);

  // Insert before the journal timeline
  var journalTimeline = dom.journalTimeline;
  if (journalTimeline) {
    gardenJournal.insertBefore(historySection, journalTimeline);
  } else {
    gardenJournal.appendChild(historySection);
  }

  renderHistoryCards();
}

// ── Render visit cards from snapshots ──
function renderHistoryCards() {
  var historyList = document.getElementById('historyList');
  var historyCount = document.getElementById('historyCount');
  if (!historyList) return;

  var snapshots = loadSnapshots();

  if (historyCount) {
    historyCount.textContent = snapshots.length + ' visit' + (snapshots.length !== 1 ? 's' : '');
  }

  historyList.innerHTML = '';

  if (snapshots.length === 0) {
    var emptyMsg = document.createElement('p');
    emptyMsg.classList.add('garden-history__empty');
    emptyMsg.textContent = 'visit history will appear here over time...';
    historyList.appendChild(emptyMsg);
    return;
  }

  // Render in reverse chronological order (newest first)
  for (var i = snapshots.length - 1; i >= 0; i--) {
    var snapshot = snapshots[i];
    var dateInfo = formatSnapshotDate(snapshot.timestamp);
    var card = document.createElement('div');
    card.classList.add('history-visit-card');
    card.setAttribute('role', 'listitem');

    // Determine if this is the most recent snapshot
    if (i === snapshots.length - 1) {
      card.classList.add('history-visit-card--latest');
    }

    card.innerHTML =
      '<div class="history-visit-card__weather">' + getWeatherEmoji(snapshot.weather) + '</div>' +
      '<div class="history-visit-card__body">' +
        '<div class="history-visit-card__mood">' +
          '<span class="history-visit-card__mood-emoji">' + getMoodEmoji(snapshot.mood) + '</span>' +
          '<span class="history-visit-card__mood-label">' + snapshot.mood + '</span>' +
        '</div>' +
        '<div class="history-visit-card__stats">' +
          '<span class="history-visit-card__stat">🌸 ' + snapshot.planted + '/' + totalTiles + '</span>' +
          '<span class="history-visit-card__stat">🌺 ' + snapshot.flowers + '</span>' +
          (snapshot.volunteers > 0 ? '<span class="history-visit-card__stat">🌿 ' + snapshot.volunteers + '</span>' : '') +
          (snapshot.fertilized > 0 ? '<span class="history-visit-card__stat">🌾 ' + snapshot.fertilized + '</span>' : '') +
        '</div>' +
        '<p class="history-visit-card__poem">' + snapshot.poem + '</p>' +
      '</div>' +
      '<div class="history-visit-card__time">' +
        '<span class="history-visit-card__relative">' + dateInfo.relative + '</span>' +
        '<span class="history-visit-card__date">' + dateInfo.fullDate + '</span>' +
      '</div>';

    historyList.appendChild(card);
  }
}

// ── Toggle history visibility ──
var historyVisible = false;

function toggleHistory() {
  var historySection = document.getElementById('gardenHistory');
  var toggleBtn = document.getElementById('historyToggleBtn');
  if (!historySection) return;

  historyVisible = !historyVisible;

  if (historyVisible) {
    historySection.classList.add('visible');
    historySection.setAttribute('aria-hidden', 'false');
    if (toggleBtn) {
      toggleBtn.classList.add('active');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
    renderHistoryCards();
  } else {
    historySection.classList.remove('visible');
    historySection.setAttribute('aria-hidden', 'true');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  }
}

// ── Auto-capture on significant events ──
var lastCaptureTime = 0;
var CAPTURE_COOLDOWN = 60000; // 1 minute between auto-captures

function shouldAutoCapture() {
  var now = Date.now();
  if (now - lastCaptureTime < CAPTURE_COOLDOWN) return false;
  lastCaptureTime = now;
  return true;
}

// ── Public: Initialize ──
export function initGardenHistory() {
  createHistoryToggle();
  createHistorySection();

  // Only capture if there's meaningful garden state
  if (plantedCount.value > 0 || journalEntries.length > 0) {
    var snapshot = captureSnapshot();
    saveSnapshot(snapshot);
  }
}

// ── Public: Capture a visit snapshot (called on each session start) ──
export function captureGardenVisit() {
  if (plantedCount.value > 0 || journalEntries.length > 0) {
    var snapshot = captureSnapshot();
    saveSnapshot(snapshot);
  }
}


