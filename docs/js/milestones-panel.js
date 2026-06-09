// ── Milestones Panel ──
// Renders a persistent panel in the sidebar showing unlocked/locked milestones.
// Reads unlocked IDs from localStorage (same key as milestones.js).
// Auto-refreshes on milestone unlock events and garden state changes.

import { dom } from './state.js';

var STORAGE_KEY = 'selfgrow_milestones';

var MILESTONE_DEFS = [
  {
    id: 'first_bloom',
    title: 'First Bloom',
    icon: '🌸',
    poem: 'a single flower opens — the garden whispers its first hello',
  },
  {
    id: 'all_types_collected',
    title: 'Full Bouquet',
    icon: '💐',
    poem: 'every flower type now calls your garden home',
  },
  {
    id: 'ten_blooms',
    title: 'Ten Blooms',
    icon: '🌺',
    poem: 'ten flowers have opened their faces to the light',
  },
  {
    id: 'seven_day_tender',
    title: 'Steady Hand',
    icon: '🌿',
    poem: 'seven days of tending — the garden knows your rhythm',
  },
];

var panelCreated = false;

// ── Persistence ──

function loadUnlockedIds() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return [];
}

// ── Build the persistent panel ──

function createPanel() {
  if (panelCreated) return;
  panelCreated = true;

  // Insert the panel between seed packets and journal in the sidebar
  var seedPacketsPanel = dom.seedPacketsPanel || document.getElementById('seedPacketsPanel');
  var gardenJournal = dom.gardenJournal || document.getElementById('gardenJournal');
  var sidebar = seedPacketsPanel ? seedPacketsPanel.parentElement : null;

  if (!sidebar) return;

  var panel = document.createElement('div');
  panel.classList.add('milestones-panel');
  panel.id = 'milestonesPanel';
  panel.setAttribute('aria-label', 'Garden milestones');

  panel.innerHTML =
    '<div class="milestones-header">' +
      '<span class="milestones-icon">🏆</span>' +
      '<h2 class="milestones-title">milestones</h2>' +
      '<span class="milestones-progress" id="milestonesProgress" aria-label="Milestones progress"></span>' +
    '</div>' +
    '<div class="milestones-list" id="milestonesList" role="list" aria-label="Milestone progress"></div>';

  // Insert before the garden journal (or after seed packets panel)
  if (gardenJournal && gardenJournal.parentElement === sidebar) {
    sidebar.insertBefore(panel, gardenJournal);
  } else if (seedPacketsPanel && seedPacketsPanel.nextSibling) {
    sidebar.insertBefore(panel, seedPacketsPanel.nextSibling);
  } else {
    sidebar.appendChild(panel);
  }

  renderMilestones();
}

// ── Render milestone cards ──

export function renderMilestones() {
  var list = document.getElementById('milestonesList');
  var progress = document.getElementById('milestonesProgress');
  if (!list) return;

  var unlockedIds = loadUnlockedIds();
  var unlockedCount = 0;
  var total = MILESTONE_DEFS.length;

  list.innerHTML = '';

  MILESTONE_DEFS.forEach(function (def) {
    var isUnlocked = unlockedIds.indexOf(def.id) !== -1;
    if (isUnlocked) unlockedCount++;

    var card = document.createElement('div');
    card.classList.add('milestone-card');
    card.classList.add(isUnlocked ? 'milestone-card--unlocked' : 'milestone-card--locked');
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label',
      (isUnlocked ? 'Unlocked' : 'Locked') + ' milestone: ' + def.title
    );

    if (isUnlocked) {
      card.innerHTML =
        '<span class="milestone-card__icon" aria-hidden="true">' + def.icon + '</span>' +
        '<div class="milestone-card__body">' +
          '<p class="milestone-card__title">' + def.title + '</p>' +
          '<p class="milestone-card__poem">' + def.poem + '</p>' +
        '</div>';
    } else {
      card.innerHTML =
        '<span class="milestone-card__icon milestone-card__icon--locked" aria-hidden="true">???</span>' +
        '<div class="milestone-card__body">' +
          '<p class="milestone-card__title milestone-card__title--locked">???</p>' +
          '<p class="milestone-card__poem milestone-card__poem--locked">keep tending to discover</p>' +
        '</div>';
    }

    list.appendChild(card);
  });

  if (progress) {
    progress.textContent = unlockedCount + '/' + total + ' unlocked';
  }

  // Reveal the panel once the sidebar is available
  var panel = document.getElementById('milestonesPanel');
  if (panel) {
    panel.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
  }
}

// ── Listen for milestone unlocks ──

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('milestoneUnlocked', function () {
    renderMilestones();
  });
}

// ── Public: Initialize ──

export function initMilestonesPanel() {
  // DOM might not be fully built yet; defer to next frame
  createPanel();
  renderMilestones();
}
