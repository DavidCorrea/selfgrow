import { dom, journalEntries, journalRevealed, getRandomCycleMessage } from './state.js';
import { saveGardenState } from './persistence.js';

export var MAX_JOURNAL_ENTRIES = 50;

// ── Centralized Cap ──
// Trims both the journalEntries array and the journalTimeline DOM
// to MAX_JOURNAL_ENTRIES, removing oldest entries first.
// Call this after ANY direct push to journalEntries.
export function capJournalEntries() {
  var journalTimeline = dom.journalTimeline;
  if (journalEntries.length > MAX_JOURNAL_ENTRIES) {
    journalEntries.splice(0, journalEntries.length - MAX_JOURNAL_ENTRIES);
  }
  if (journalTimeline) {
    while (journalTimeline.children.length > MAX_JOURNAL_ENTRIES) {
      journalTimeline.removeChild(journalTimeline.lastChild);
    }
  }
}

var messages = [
  "a tiny seed finds its place in the soil",
  "with patience, it reaches toward the light",
  "your garden is beginning to grow",
  "every bloom starts with a single seed",
  "nurture it and watch what happens",
];

export function getRandomMessage() {
  return messages[Math.floor(Math.random() * messages.length)];
}

export function formatTime(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  return displayHours + ':' + displayMinutes + ' ' + ampm;
}

function revealJournal() {
  if (journalRevealed.value) return;
  journalRevealed.value = true;

  var gardenJournal = dom.gardenJournal;
  if (gardenJournal) {
    gardenJournal.classList.add('visible');
    gardenJournal.setAttribute('aria-hidden', 'false');
  }
}

export function addJournalEntry(tileIndex, petalColor, cycleNum, options) {
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;

  if (!journalRevealed.value) {
    setTimeout(function () {
      revealJournal();
    }, 600);
  }

  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  var now = new Date();
  var timeStr = formatTime(now);
  var isCycle = cycleNum && cycleNum > 1;
  var entryType = (options && options.type) ? options.type : (isCycle ? 'cycle' : 'plant');
  var entry = {
    tileIndex: tileIndex,
    petalColor: petalColor,
    time: timeStr,
    timestamp: now.getTime(),
    cycle: cycleNum || 1,
    type: entryType
  };
  if (options && options.subText) {
    entry.subText = options.subText;
  }
  journalEntries.push(entry);

  var entryEl = document.createElement('div');
  entryEl.classList.add('journal-entry');
  // Add type-specific CSS class for styled entries (e.g., journal-entry--pollinated)
  if (entryType && entryType !== 'plant' && entryType !== 'cycle') {
    entryEl.classList.add('journal-entry--' + entryType);
  }
  entryEl.setAttribute('role', 'listitem');

  var entryLabel;
  var entrySubText;
  if (options && options.customLabel) {
    entryLabel = options.customLabel;
    entrySubText = options.subText || '';
  } else if (isCycle) {
    entryLabel = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; 🌸 cycle ' + cycleNum + ' at ' + timeStr;
    entrySubText = getRandomCycleMessage();
  } else {
    entryLabel = '<strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; planted at ' + timeStr;
    entrySubText = 'flower #' + journalEntries.length + ' in your garden';
  }

  var subHtml = entrySubText ? '<p class="entry-time">' + entrySubText + '</p>' : '';
  var dotClass = entryType && entryType !== 'plant' && entryType !== 'cycle' ? 'entry-timeline-dot entry-timeline-dot--' + entryType : 'entry-timeline-dot';
  var swatchClass = entryType && entryType !== 'plant' && entryType !== 'cycle' ? 'entry-swatch entry-swatch--' + entryType : 'entry-swatch';

  entryEl.innerHTML =
    '<div class="' + dotClass + '"></div>' +
    '<div class="entry-content">' +
      '<p class="entry-text">' + entryLabel + '</p>' +
      subHtml +
    '</div>' +
    '<div class="' + swatchClass + '" style="background: ' + petalColor + '" aria-hidden="true"></div>';

  if (journalTimeline) {
    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);
  }

  // Cap after adding the new DOM entry so array and DOM stay in sync
  capJournalEntries();

  if (gardenJournal) {
    gardenJournal.classList.remove('pulse');
    void gardenJournal.offsetWidth;
    gardenJournal.classList.add('pulse');
  }

  if (journalTimeline) {
    journalTimeline.scrollTop = 0;
  }

  saveGardenState();
}

// ── Weather Journal Entry ──
// Adds a weather transition entry to the journal with a poetic message.
// Called by weather.js when the weather state changes.
export function addWeatherEntry(weatherState, message) {
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;

  if (!journalRevealed.value) {
    setTimeout(function () {
      revealJournal();
    }, 600);
  }

  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  var now = new Date();
  var timeStr = formatTime(now);

  var entry = {
    tileIndex: -1,
    petalColor: getWeatherColor(weatherState),
    time: timeStr,
    timestamp: now.getTime(),
    cycle: 0,
    type: 'weather',
    weatherState: weatherState,
    weatherMessage: message
  };
  journalEntries.push(entry);

  // Only create DOM entry if journal timeline exists
  if (journalTimeline) {
    var weatherEmoji = getWeatherEmoji(weatherState);

    var entryEl = document.createElement('div');
    entryEl.classList.add('journal-entry', 'journal-entry--weather');
    entryEl.setAttribute('role', 'listitem');

    entryEl.innerHTML =
      '<div class="entry-timeline-dot entry-timeline-dot--weather"></div>' +
      '<div class="entry-content">' +
        '<p class="entry-text">' + weatherEmoji + ' ' + message + '</p>' +
        '<p class="entry-time">' + timeStr + ' &mdash; the sky shifts</p>' +
      '</div>' +
      '<div class="entry-swatch entry-swatch--weather" style="background: ' + getWeatherColor(weatherState) + '" aria-hidden="true"></div>';

    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);

    journalTimeline.scrollTop = 0;
  }

  // Cap after adding the new DOM entry so array and DOM stay in sync
  capJournalEntries();

  if (gardenJournal) {
    gardenJournal.classList.remove('pulse');
    void gardenJournal.offsetWidth;
    gardenJournal.classList.add('pulse');
  }

  saveGardenState();
}

function getWeatherEmoji(weatherState) {
  var emojis = {
    sunny: '☀️',
    rainy: '🌧️',
    cloudy: '☁️',
    snowy: '❄️'
  };
  return emojis[weatherState] || '🌤️';
}

function getWeatherColor(weatherState) {
  var colors = {
    sunny: '#fbbf24',
    rainy: '#60a5fa',
    cloudy: '#94a3b8',
    snowy: '#e2e8f0'
  };
  return colors[weatherState] || '#94a3b8';
}
