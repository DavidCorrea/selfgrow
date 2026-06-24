import { dom, journalEntries, journalRevealed, getRandomCycleMessage, plantedCount } from './state.js';
import { saveGardenState } from './persistence.js';

var MAX_JOURNAL_ENTRIES = 30;

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

import { recordVisit, getVisitsThisWeek, hasWeeklyRitualShown, setWeeklyRitualShown } from './visits.js';
import { getBloomingCount } from './visitors.js';

function revealJournal() {
  // Record a visit each time the journal is opened
  recordVisit();
  // Show weekly ritual if conditions met
  maybeShowWeeklyRitual();

  if (journalRevealed.value) return;
  journalRevealed.value = true;

  var gardenJournal = dom.gardenJournal;
  if (gardenJournal) {
    gardenJournal.classList.add('visible');
    gardenJournal.setAttribute('aria-hidden', 'false');
  }
}

// Helper to maybe show weekly ritual
function maybeShowWeeklyRitual() {
  // Ensure journal DOM elements exist
  if (!dom.journalTimeline) return;
  if (hasWeeklyRitualShown()) return;
  const visits = getVisitsThisWeek();
  if (visits.length < 7) return;
  // Build summary
  const planted = plantedCount.value;
  const blooming = getBloomingCount();
  const mood = (function(){
    // simple mood based on blooming
    if (blooming >= 3) return 'thriving';
    if (blooming >= 2) return 'flourishing';
    return 'growing';
  })();
  const poem = `this week the garden ${mood} with ${blooming} blooms and ${planted} planted tiles`; // simple poetic line
  const card = document.createElement('div');
  card.className = 'journal-entry journal-entry--weekly-ritual';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  // Dismiss button
  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'weekly-ritual-dismiss';
  dismissBtn.setAttribute('aria-label', 'Dismiss weekly reflection');
  dismissBtn.innerHTML = '&times;';
  dismissBtn.addEventListener('click', function(){
    card.remove();
  });
  // Content
  const content = document.createElement('div');
  content.className = 'weekly-ritual-content';
  content.innerHTML = `<p class="weekly-ritual-poem">${poem}</p>`;
  card.appendChild(dismissBtn);
  card.appendChild(content);
  // Dismiss on Escape key
  card.addEventListener('keydown', function(e){
    if (e.key === 'Escape') {
      card.remove();
    }
  });
  // Insert at top of timeline
  dom.journalTimeline.insertBefore(card, dom.journalTimeline.firstChild);
  // Ensure focus for accessibility
  dismissBtn.focus();
  setWeeklyRitualShown();
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

  // Cap journal entries to prevent unbounded growth
  if (journalEntries.length > MAX_JOURNAL_ENTRIES) {
    journalEntries.splice(0, journalEntries.length - MAX_JOURNAL_ENTRIES);
    // Remove oldest DOM entries from timeline
    while (journalTimeline.children.length > MAX_JOURNAL_ENTRIES) {
      journalTimeline.removeChild(journalTimeline.lastChild);
    }
  }

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

  // Cap journal entries to prevent unbounded growth
  if (journalEntries.length > MAX_JOURNAL_ENTRIES) {
    journalEntries.splice(0, journalEntries.length - MAX_JOURNAL_ENTRIES);
    // Remove oldest DOM entries from timeline
    while (journalTimeline.children.length > MAX_JOURNAL_ENTRIES) {
      journalTimeline.removeChild(journalTimeline.lastChild);
    }
  }

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

    if (gardenJournal) {
      gardenJournal.classList.remove('pulse');
      void gardenJournal.offsetWidth;
      gardenJournal.classList.add('pulse');
    }

    journalTimeline.scrollTop = 0;
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
