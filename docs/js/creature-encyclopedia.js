// ═══════════════════════════════════════════════════════════
// Creature Encyclopedia — Gentle observation log
// Tracks creature sightings across visits, displaying them
// as illustrated observation cards with poetic descriptions,
// first-sighted dates, and visit counts.
// ═══════════════════════════════════════════════════════════

import { dom } from './state.js';
import { visibleSetTimeout, visibleClearTimeout, visibleSetInterval } from './visibility-manager.js';

var STORAGE_KEY = 'selfgrow_creature_encyclopedia';

// ── Creature definitions ──
var CREATURE_DEFS = [
  {
    id: 'butterfly',
    name: 'Butterfly',
    emoji: '🦋',
    poem: 'winged petals drifting between bloom and bloom',
    description: 'Delicate visitors that dance on warm currents, drawn to color and light.',
  },
  {
    id: 'bee',
    name: 'Bee',
    emoji: '🐝',
    poem: 'golden messengers between bloom and bloom',
    description: 'Industrious pollinators carrying pollen from flower to flower.',
  },
  {
    id: 'firefly',
    name: 'Firefly',
    emoji: '✨',
    poem: 'tiny lanterns floating through summer dusk',
    description: 'Luminous beetles that light up warm evening air with gentle pulses.',
  },
  {
    id: 'ladybug',
    name: 'Ladybug',
    emoji: '🐞',
    poem: 'small red wanderers on a leafy path',
    description: 'Gentle beetles with spotted shells that rest upon your plants.',
  },
  {
    id: 'snail',
    name: 'Snail',
    emoji: '🐌',
    poem: 'slow travelers leaving silver trails',
    description: 'Patient explorers that glide across the garden after rain.',
  },
  {
    id: 'worm',
    name: 'Worm',
    emoji: '🪱',
    poem: 'quiet tillers beneath the soil',
    description: 'Humble earthworkers that aerate and enrich the ground.',
  },
  {
    id: 'cricket',
    name: 'Cricket',
    emoji: '🦗',
    poem: 'evening songsters hidden in the grass',
    description: 'Musical insects whose chirps fill warm summer nights.',
  },
];

var panelCreated = false;
var encyclopediaOpen = false;
var sightingRefreshTimer = null;

// ── Persistence ──

function loadSightings() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {};
}

function saveSightings(sightings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sightings));
  } catch (e) { /* ignore */ }
}

// ── Record a sighting ──

function recordSighting(creatureId) {
  var sightings = loadSightings();
  var now = new Date().toISOString();

  if (!sightings[creatureId]) {
    sightings[creatureId] = {
      firstSighted: now,
      visitCount: 0,
    };
  }

  sightings[creatureId].visitCount++;
  sightings[creatureId].lastSighted = now;

  saveSightings(sightings);
  return sightings;
}

// ── Build the panel ──

function createPanel() {
  if (panelCreated) return;
  panelCreated = true;

  var sidebar = dom.seedPacketsPanel ? dom.seedPacketsPanel.parentElement : null;
  if (!sidebar) return;

  var milestonesPanel = document.getElementById('milestonesPanel');
  var gardenJournal = dom.gardenJournal || document.getElementById('gardenJournal');

  // Create the encyclopedia toggle button
  var toggleBtn = document.createElement('button');
  toggleBtn.classList.add('encyclopedia-toggle');
  toggleBtn.id = 'encyclopediaToggle';
  toggleBtn.setAttribute('aria-label', 'Creature encyclopedia');
  toggleBtn.setAttribute('title', 'Creature encyclopedia');
  toggleBtn.innerHTML = '<span class="encyclopedia-toggle__icon">🦋</span>';

  // Insert the toggle button into the sidebar header area
  var statsHeader = document.querySelector('.stats-header');
  if (statsHeader && statsHeader.parentElement) {
    statsHeader.parentElement.insertBefore(toggleBtn, statsHeader);
  } else {
    sidebar.insertBefore(toggleBtn, sidebar.firstChild);
  }

  // Create the encyclopedia panel
  var panel = document.createElement('div');
  panel.classList.add('creature-encyclopedia');
  panel.id = 'creatureEncyclopedia';
  panel.setAttribute('aria-label', 'Creature encyclopedia');
  panel.setAttribute('aria-hidden', 'true');

  panel.innerHTML =
    '<div class="creature-encyclopedia__header">' +
      '<span class="creature-encyclopedia__icon">🦋</span>' +
      '<h2 class="creature-encyclopedia__title">creature encyclopedia</h2>' +
      '<span class="creature-encyclopedia__count" id="encyclopediaCount" aria-label="Creatures discovered"></span>' +
    '</div>' +
    '<p class="creature-encyclopedia__subtitle">every visitor you\'ve noticed in the garden</p>' +
    '<div class="creature-encyclopedia__grid" id="encyclopediaGrid" role="list" aria-label="Creature sightings"></div>';

  // Insert between milestones panel and garden journal
  if (gardenJournal && gardenJournal.parentElement === sidebar) {
    sidebar.insertBefore(panel, gardenJournal);
  } else if (milestonesPanel && milestonesPanel.parentElement === sidebar && milestonesPanel.nextSibling) {
    sidebar.insertBefore(panel, milestonesPanel.nextSibling);
  } else {
    sidebar.appendChild(panel);
  }

  // Toggle button click handler
  toggleBtn.addEventListener('click', function () {
    toggleEncyclopedia();
  });
  toggleBtn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleEncyclopedia();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && encyclopediaOpen) {
      toggleEncyclopedia();
    }
  });
}

// ── Toggle panel visibility ──

function toggleEncyclopedia() {
  var panel = document.getElementById('creatureEncyclopedia');
  var toggleBtn = document.getElementById('encyclopediaToggle');
  if (!panel) return;

  encyclopediaOpen = !encyclopediaOpen;

  if (encyclopediaOpen) {
    panel.classList.add('visible');
    panel.setAttribute('aria-hidden', 'false');
    if (toggleBtn) toggleBtn.classList.add('active');
    renderEncyclopedia();
  } else {
    panel.classList.remove('visible');
    panel.setAttribute('aria-hidden', 'true');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }
}

// ── Render creature cards ──

export function renderEncyclopedia() {
  var grid = document.getElementById('encyclopediaGrid');
  var count = document.getElementById('encyclopediaCount');
  if (!grid) return;

  var sightings = loadSightings();
  var discovered = 0;
  var total = CREATURE_DEFS.length;

  grid.innerHTML = '';

  CREATURE_DEFS.forEach(function (def) {
    var sighting = sightings[def.id];
    var isDiscovered = !!sighting;
    if (isDiscovered) discovered++;

    var card = document.createElement('div');
    card.classList.add('creature-card');
    card.classList.add(isDiscovered ? 'creature-card--discovered' : 'creature-card--locked');
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-label',
      (isDiscovered ? 'Discovered' : 'Undiscovered') + ' creature: ' + def.name
    );

    if (isDiscovered) {
      var firstDate = formatDate(sighting.firstSighted);
      var visitCount = sighting.visitCount;
      var visitLabel = visitCount === 1 ? 'visit' : 'visits';

      card.innerHTML =
        '<div class="creature-card__header">' +
          '<span class="creature-card__emoji" aria-hidden="true">' + def.emoji + '</span>' +
          '<div class="creature-card__info">' +
            '<span class="creature-card__name">' + def.name + '</span>' +
            '<span class="creature-card__count">' + visitCount + ' ' + visitLabel + '</span>' +
          '</div>' +
        '</div>' +
        '<p class="creature-card__poem">' + def.poem + '</p>' +
        '<p class="creature-card__description">' + def.description + '</p>' +
        '<div class="creature-card__meta">' +
          '<span class="creature-card__first-sighted">first seen ' + firstDate + '</span>' +
        '</div>';
    } else {
      card.innerHTML =
        '<div class="creature-card__header">' +
          '<span class="creature-card__emoji creature-card__emoji--locked" aria-hidden="true">???</span>' +
          '<div class="creature-card__info">' +
            '<span class="creature-card__name creature-card__name--locked">???</span>' +
          '</div>' +
        '</div>' +
        '<p class="creature-card__poem creature-card__poem--locked">keep watching the garden...</p>';
    }

    grid.appendChild(card);
  });

  if (count) {
    count.textContent = discovered + '/' + total;
  }
}

// ── Format date helper ──

function formatDate(isoString) {
  try {
    var date = new Date(isoString);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var month = months[date.getMonth()];
    var day = date.getDate();
    var year = date.getFullYear();
    return month + ' ' + day + ', ' + year;
  } catch (e) {
    return 'unknown';
  }
}

// ── Listen for creature spawns ──

function setupSpawnListeners() {
  // Listen for visitor spawns (butterflies, bees, fireflies)
  document.addEventListener('visitorSpawned', function (e) {
    var creatureType = e.detail && e.detail.type;
    if (creatureType) {
      recordSighting(creatureType);
      if (encyclopediaOpen) {
        visibleSetTimeout(function () { renderEncyclopedia(); }, 100);
      }
    }
  });

  // Listen for ground creature spawns (ladybugs, snails, worms, crickets)
  document.addEventListener('groundCreatureSpawned', function (e) {
    var creatureType = e.detail && e.detail.type;
    if (creatureType) {
      recordSighting(creatureType);
      if (encyclopediaOpen) {
        visibleSetTimeout(function () { renderEncyclopedia(); }, 100);
      }
    }
  });
}

// ── Periodic sighting check (passive observation from existing creatures) ──

function setupPassiveObservation() {
  // Every 15 seconds, check for active creatures and record sightings
  // This catches creatures that were spawned before the encyclopedia existed
  sightingRefreshTimer = visibleSetInterval(function () {
    if (!encyclopediaOpen) return;

    var visitorsLayer = dom.visitorsLayer || document.getElementById('visitorsLayer');
    var gardenGrid = dom.gardenGrid;

    var sightings = loadSightings();
    var changed = false;

    // Check for active visitors
    if (visitorsLayer) {
      var butterflies = visitorsLayer.querySelectorAll('.butterfly');
      var bees = visitorsLayer.querySelectorAll('.bee');
      var fireflies = visitorsLayer.querySelectorAll('.firefly');

      if (butterflies.length > 0 && !sightings['butterfly']) {
        recordSighting('butterfly');
        changed = true;
      }
      if (bees.length > 0 && !sightings['bee']) {
        recordSighting('bee');
        changed = true;
      }
      if (fireflies.length > 0 && !sightings['firefly']) {
        recordSighting('firefly');
        changed = true;
      }
    }

    // Check for active ground creatures
    if (gardenGrid) {
      var ladybugs = gardenGrid.querySelectorAll('.ground-creature--ladybug');
      var snails = gardenGrid.querySelectorAll('.ground-creature--snail');
      var worms = gardenGrid.querySelectorAll('.ground-creature--worm');
      var crickets = gardenGrid.querySelectorAll('.ground-creature--cricket');

      if (ladybugs.length > 0 && !sightings['ladybug']) {
        recordSighting('ladybug');
        changed = true;
      }
      if (snails.length > 0 && !sightings['snail']) {
        recordSighting('snail');
        changed = true;
      }
      if (worms.length > 0 && !sightings['worm']) {
        recordSighting('worm');
        changed = true;
      }
      if (crickets.length > 0 && !sightings['cricket']) {
        recordSighting('cricket');
        changed = true;
      }
    }

    if (changed) {
      renderEncyclopedia();
    }
  }, 15000);
}

// ── Public API ──

export function initCreatureEncyclopedia() {
  // Wait for DOM to be ready
  visibleSetTimeout(function () {
    createPanel();
    setupSpawnListeners();
    setupPassiveObservation();
  }, 100);
}

export function getCreatureDefs() {
  return CREATURE_DEFS;
}

export function getCreatureSightings() {
  return loadSightings();
}
