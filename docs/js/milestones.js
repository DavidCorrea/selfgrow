// ── Garden Milestones ──
// Gentle, non-competitive recognition of growth milestones.
// Tracks milestone state in localStorage, listens for bloom/plant/tend events,
// and triggers milestone unlocks as soft notification cards in the journal.

import { dom, flowerTypes } from './state.js';

var STORAGE_KEY = 'selfgrow_milestones';
var TEND_DAYS_KEY = 'selfgrow_tend_days';

// ── Milestone Definitions ──
var MILESTONES = {
  first_bloom: {
    id: 'first_bloom',
    title: 'First Bloom',
    icon: '🌸',
    poem: 'a single flower opens — the garden whispers its first hello',
    check: function (data) {
      return data.totalBlooms >= 1;
    }
  },
  all_types_collected: {
    id: 'all_types_collected',
    title: 'Full Bouquet',
    icon: '💐',
    poem: 'every flower type now calls your garden home — a tapestry of form and color',
    check: function (data) {
      return data.uniqueTypes.length >= 5;
    }
  },
  ten_blooms: {
    id: 'ten_blooms',
    title: 'Ten Blooms',
    icon: '🌺',
    poem: 'ten flowers have opened their faces to the light — the garden breathes with life',
    check: function (data) {
      return data.totalBlooms >= 10;
    }
  },
  seven_day_tender: {
    id: 'seven_day_tender',
    title: 'Steady Hand',
    icon: '🌿',
    poem: 'seven days of tending — the garden knows your gentle rhythm now',
    check: function (data) {
      return data.tendDays >= 7;
    }
  }
};

// ── State ──
var unlockedIds = [];
var pendingChecks = [];

// ── Persistence ──

function loadUnlocked() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      unlockedIds = JSON.parse(raw);
    }
  } catch (e) {
    unlockedIds = [];
  }
}

function persistUnlocked() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unlockedIds));
  } catch (e) {
    // silently fail
  }
}

// ── Tend Days Tracking ──

function loadTendDays() {
  try {
    var raw = localStorage.getItem(TEND_DAYS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    // fall through
  }
  return { days: [], lastDate: null };
}

function saveTendDays(tendData) {
  try {
    localStorage.setItem(TEND_DAYS_KEY, JSON.stringify(tendData));
  } catch (e) {
    // silently fail
  }
}

// Record a tend day (called on any garden interaction)
export function recordTendDay() {
  var tendData = loadTendDays();
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();

  if (tendData.lastDate !== todayStr) {
    tendData.lastDate = todayStr;
    tendData.days.push(todayStr);
    saveTendDays(tendData);
  }

  // Check milestones after recording
  checkMilestones();
}

function getTendDayCount() {
  var tendData = loadTendDays();
  return tendData.days ? tendData.days.length : 0;
}

// ── Collect Data for Milestone Checks ──

function collectMilestoneData() {
  // Count total blooms from journal entries
  var totalBlooms = 0;
  var uniqueTypes = [];
  var tiles = dom.tiles;

  // Count blooms: each planted tile that has bloomed at least once
  if (tiles) {
    tiles.forEach(function (tile) {
      if (tile.classList.contains('planted')) {
        totalBlooms++;
      }
    });
  }

  // Count unique flower types from tileFlowerTypeMap
  // We need to access this from state, but since we can't import it directly
  // (it's a mutable object), we'll read from DOM
  if (tiles) {
    tiles.forEach(function (tile) {
      var tileIndex = parseInt(tile.getAttribute('data-tile'), 10);
      // Check the sprout for flower type class
      var sprout = tile.querySelector('.tile-sprout');
      if (sprout) {
        flowerTypes.forEach(function (ft) {
          if (sprout.classList.contains('flower-' + ft) && uniqueTypes.indexOf(ft) === -1) {
            uniqueTypes.push(ft);
          }
        });
      }
    });
  }

  return {
    totalBlooms: totalBlooms,
    uniqueTypes: uniqueTypes,
    tendDays: getTendDayCount()
  };
}

// ── Milestone Checking ──

function checkMilestones() {
  var data = collectMilestoneData();

  for (var key in MILESTONES) {
    var milestone = MILESTONES[key];
    if (unlockedIds.indexOf(milestone.id) === -1 && milestone.check(data)) {
      unlockMilestone(milestone);
    }
  }

  // Also flush any pending checks
  pendingChecks.forEach(function (m) {
    if (unlockedIds.indexOf(m.id) === -1) {
      unlockMilestone(m);
    }
  });
  pendingChecks = [];
}

// ── Unlock a Milestone ──

function unlockMilestone(milestone) {
  unlockedIds.push(milestone.id);
  persistUnlocked();
  notifyMilestone(milestone);

  // Dispatch custom event so milestones panel can re-render
  try {
    window.dispatchEvent(new CustomEvent('milestoneUnlocked', { detail: { id: milestone.id } }));
  } catch (e) {
    // CustomEvent may not be available in very old browsers; silently fail
  }
}

// ── Create Milestone Notification in Journal ──

export function notifyMilestone(milestone) {
  var journalTimeline = dom.journalTimeline;
  if (!journalTimeline) return;

  // Hide empty state if visible
  var journalEmpty = dom.journalEmpty;
  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  var now = new Date();
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  var timeStr = displayHours + ':' + displayMinutes + ' ' + ampm;

  var entryEl = document.createElement('div');
  entryEl.classList.add('milestone-notification');
  entryEl.setAttribute('role', 'listitem');
  entryEl.setAttribute('aria-label', 'Milestone: ' + milestone.title);

  entryEl.innerHTML =
    '<div class="milestone-icon" aria-hidden="true">' + milestone.icon + '</div>' +
    '<div class="milestone-content">' +
      '<p class="milestone-text">' + milestone.title + '</p>' +
      '<p class="milestone-poem">' + milestone.poem + '</p>' +
      '<p class="milestone-time">' + timeStr + '</p>' +
    '</div>';

  // Prepend to timeline (newest first)
  journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);

  // Trigger entrance animation
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      entryEl.classList.add('milestone-notification--visible');
    });
  });

  // Pulse the journal to draw gentle attention
  var gardenJournal = dom.gardenJournal;
  if (gardenJournal) {
    gardenJournal.classList.remove('pulse');
    void gardenJournal.offsetWidth;
    gardenJournal.classList.add('pulse');
  }
}

// ── Public API ──

// Called from tiles.js after first bloom and cycle blooms
export function checkBloomMilestone() {
  checkMilestones();
}

// Called from seed-collection.js when flower types are collected
export function checkCollectionMilestone() {
  checkMilestones();
}

// Called on init to check tend-day milestone
export function initMilestones() {
  loadUnlocked();
  // Record today's visit as a tend day
  recordTendDay();
  // Check all milestones
  checkMilestones();
}

// For testing/debugging: get unlocked count
export function getUnlockedCount() {
  return unlockedIds.length;
}
