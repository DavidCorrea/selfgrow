// ═══════════════════════════════════════════════════════════
// Ground Creatures — Ladybugs, Snails, Worms
// Small CSS-animated critters that crawl across planted tiles,
// complementing the existing aerial visitors.
// ═══════════════════════════════════════════════════════════

import { dom, plantedCount } from './state.js';
import { getCurrentGardenSeason } from './garden-seasons.js';
import { getSeasonWeightedCreatureType, isCreatureSeasonAllowed } from './ecosystem.js';
import { visibleSetTimeout, visibleClearTimeout } from './visibility-manager.js';

var activeCreatures = [];
var creatureIdCounter = 0;
var creatureSpawnTimer = null;
var creaturesPaused = false;
var creaturesEnabled = true;

var MAX_CONCURRENT_CREATURES = 4;
var MIN_SPAWN_INTERVAL = 5000;

// ── Creature type definitions ──
var creatureTypes = ['ladybug', 'snail', 'worm', 'cricket'];

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

function getRandomPlantedTile() {
  var planted = getPlantedTiles();
  if (planted.length === 0) return null;
  return planted[Math.floor(Math.random() * planted.length)];
}

// ── Create creature DOM elements ──

function createLadybug() {
  var el = document.createElement('div');
  el.classList.add('ground-creature', 'ground-creature--ladybug');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Ladybug');
  el.setAttribute('tabindex', '0');

  // Body (red shell with black spots)
  var body = document.createElement('div');
  body.classList.add('ladybug-body');

  // Head
  var head = document.createElement('div');
  head.classList.add('ladybug-head');

  // Spots
  var spot1 = document.createElement('div');
  spot1.classList.add('ladybug-spot', 'ladybug-spot--1');
  var spot2 = document.createElement('div');
  spot2.classList.add('ladybug-spot', 'ladybug-spot--2');
  var spot3 = document.createElement('div');
  spot3.classList.add('ladybug-spot', 'ladybug-spot--3');
  var spot4 = document.createElement('div');
  spot4.classList.add('ladybug-spot', 'ladybug-spot--4');

  // Wings (for occasional flutter)
  var wingLeft = document.createElement('div');
  wingLeft.classList.add('ladybug-wing', 'ladybug-wing--left');
  var wingRight = document.createElement('div');
  wingRight.classList.add('ladybug-wing', 'ladybug-wing--right');

  // Legs
  var legLeft1 = document.createElement('div');
  legLeft1.classList.add('ladybug-leg', 'ladybug-leg--left-1');
  var legLeft2 = document.createElement('div');
  legLeft2.classList.add('ladybug-leg', 'ladybug-leg--left-2');
  var legLeft3 = document.createElement('div');
  legLeft3.classList.add('ladybug-leg', 'ladybug-leg--left-3');
  var legRight1 = document.createElement('div');
  legRight1.classList.add('ladybug-leg', 'ladybug-leg--right-1');
  var legRight2 = document.createElement('div');
  legRight2.classList.add('ladybug-leg', 'ladybug-leg--right-2');
  var legRight3 = document.createElement('div');
  legRight3.classList.add('ladybug-leg', 'ladybug-leg--right-3');

  // Antennae
  var antennaLeft = document.createElement('div');
  antennaLeft.classList.add('ladybug-antenna', 'ladybug-antenna--left');
  var antennaRight = document.createElement('div');
  antennaRight.classList.add('ladybug-antenna', 'ladybug-antenna--right');

  body.appendChild(spot1);
  body.appendChild(spot2);
  body.appendChild(spot3);
  body.appendChild(spot4);
  body.appendChild(wingLeft);
  body.appendChild(wingRight);
  body.appendChild(legLeft1);
  body.appendChild(legLeft2);
  body.appendChild(legLeft3);
  body.appendChild(legRight1);
  body.appendChild(legRight2);
  body.appendChild(legRight3);
  body.appendChild(antennaLeft);
  body.appendChild(antennaRight);

  el.appendChild(head);
  el.appendChild(body);

  return el;
}

function createSnail() {
  var el = document.createElement('div');
  el.classList.add('ground-creature', 'ground-creature--snail');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Snail');
  el.setAttribute('tabindex', '0');

  // Shell
  var shell = document.createElement('div');
  shell.classList.add('snail-shell');

  // Shell spiral
  var spiral = document.createElement('div');
  spiral.classList.add('snail-shell-spiral');
  shell.appendChild(spiral);

  // Body (the soft part that extends from shell)
  var body = document.createElement('div');
  body.classList.add('snail-body');

  // Head
  var head = document.createElement('div');
  head.classList.add('snail-head');

  // Eye stalks
  var eyeStalkLeft = document.createElement('div');
  eyeStalkLeft.classList.add('snail-eye-stalk', 'snail-eye-stalk--left');
  var eyeLeft = document.createElement('div');
  eyeLeft.classList.add('snail-eye');
  eyeStalkLeft.appendChild(eyeLeft);

  var eyeStalkRight = document.createElement('div');
  eyeStalkRight.classList.add('snail-eye-stalk', 'snail-eye-stalk--right');
  var eyeRight = document.createElement('div');
  eyeRight.classList.add('snail-eye');
  eyeStalkRight.appendChild(eyeRight);

  head.appendChild(eyeStalkLeft);
  head.appendChild(eyeStalkRight);

  // Trail element
  var trail = document.createElement('div');
  trail.classList.add('snail-trail');

  el.appendChild(trail);
  el.appendChild(shell);
  el.appendChild(body);
  el.appendChild(head);

  return el;
}

function createWorm() {
  var el = document.createElement('div');
  el.classList.add('ground-creature', 'ground-creature--worm');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Worm');
  el.setAttribute('tabindex', '0');

  // Worm segments (for wiggle animation)
  var segment1 = document.createElement('div');
  segment1.classList.add('worm-segment', 'worm-segment--1');
  var segment2 = document.createElement('div');
  segment2.classList.add('worm-segment', 'worm-segment--2');
  var segment3 = document.createElement('div');
  segment3.classList.add('worm-segment', 'worm-segment--3');
  var segment4 = document.createElement('div');
  segment4.classList.add('worm-segment', 'worm-segment--4');
  var segment5 = document.createElement('div');
  segment5.classList.add('worm-segment', 'worm-segment--5');

  // Head (front segment)
  var head = document.createElement('div');
  head.classList.add('worm-head');

  el.appendChild(segment1);
  el.appendChild(segment2);
  el.appendChild(segment3);
  el.appendChild(segment4);
  el.appendChild(segment5);
  el.appendChild(head);

  return el;
}

// ── Positioning ──

function positionOnTile(creatureEl, tile) {
  var tileRect = tile.getBoundingClientRect();
  var gardenRect = dom.gardenGrid ? dom.gardenGrid.getBoundingClientRect() : tileRect;

  // Position relative to the tile
  var offsetX = (Math.random() - 0.5) * tileRect.width * 0.6;
  var offsetY = (Math.random() - 0.5) * tileRect.height * 0.3;

  var x = tileRect.left - gardenRect.left + tileRect.width / 2 + offsetX;
  var y = tileRect.top - gardenRect.top + tileRect.height / 2 + offsetY;

  // Clamp to tile bounds
  x = Math.max(tileRect.left - gardenRect.left + 0.25, Math.min(tileRect.left - gardenRect.left + tileRect.width - 0.25, x));
  y = Math.max(tileRect.top - gardenRect.top + 0.25, Math.min(tileRect.top - gardenRect.top + tileRect.height - 0.25, y));

  creatureEl.style.left = x + 'px';
  creatureEl.style.top = y + 'px';
}

// ── Creature interaction ──

function handleCreatureClick(creatureEl, e) {
  if (e) e.stopPropagation();
  if (creatureEl.classList.contains('ground-creature--leaving')) return;

  var type = creatureEl.getAttribute('data-creature-type');

  if (type === 'ladybug') {
    // Ladybug flies away
    creatureEl.classList.add('ground-creature--flying-away');
  } else if (type === 'snail') {
    // Snail retreats into shell
    creatureEl.classList.add('ground-creature--retreating');
  } else if (type === 'worm') {
    // Worm burrows down
    creatureEl.classList.add('ground-creature--burrowing');
  }

  setTimeout(function () {
    removeCreature(creatureEl);
  }, 800);
}

function removeCreature(creatureEl) {
  var id = parseInt(creatureEl.getAttribute('data-creature-id'), 10);
  activeCreatures = activeCreatures.filter(function (v) { return v !== id; });
  if (creatureEl.parentNode) {
    creatureEl.remove();
  }
}

// ── Spawning ──

function spawnCreature() {
  if (!creaturesEnabled) return;
  if (plantedCount.value === 0) return;
  if (creaturesPaused) return;
  if (activeCreatures.length >= MAX_CONCURRENT_CREATURES) return;

  var tile = getRandomPlantedTile();
  if (!tile) return;

  // Pick a creature type weighted by current season
  var type = getSeasonWeightedCreatureType();

  // Double-check season gating (belt-and-suspenders with the weighted function)
  if (!isCreatureSeasonAllowed(type)) {
    // Fallback to a season-appropriate type
    var season = getCurrentGardenSeason();
    if (season === 'winter') {
      type = Math.random() < 0.6 ? 'snail' : 'ladybug';
    } else {
      type = 'snail';
    }
  }

  var creatureEl;
  if (type === 'ladybug') {
    creatureEl = createLadybug();
  } else if (type === 'snail') {
    creatureEl = createSnail();
  } else if (type === 'cricket') {
    creatureEl = createCricket();
  } else {
    creatureEl = createWorm();
  }

  var gardenGrid = dom.gardenGrid;
  if (!gardenGrid) return;

  // Store the tile index the creature spawned on for ecosystem interactions
  var spawnTileIndex = parseInt(tile.getAttribute('data-tile'), 10);
  creatureEl.setAttribute('data-spawn-tile', spawnTileIndex);

  var id = creatureIdCounter++;
  creatureEl.setAttribute('data-creature-id', id);
  creatureEl.setAttribute('data-creature-type', type);
  activeCreatures.push(id);

  // Position on the tile
  positionOnTile(creatureEl, tile);

  // Click/tap interaction
  creatureEl.addEventListener('click', function (e) {
    handleCreatureClick(creatureEl, e);
  });
  creatureEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      handleCreatureClick(creatureEl, null);
    }
  });

  gardenGrid.appendChild(creatureEl);

  // Entrance animation
  creatureEl.classList.add('ground-creature--entering');
  setTimeout(function () {
    creatureEl.classList.remove('ground-creature--entering');
  }, 400);

  // Dispatch sighting event for creature encyclopedia
  if (type && typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('groundCreatureSpawned', {
      detail: { type: type }
    }));
  }

  // Set crawl direction (random)
  var direction = Math.random() < 0.5 ? 'left' : 'right';
  creatureEl.setAttribute('data-direction', direction);
  if (direction === 'left') {
    creatureEl.classList.add('ground-creature--facing-left');
  }

  // Lifetime: crawl around then despawn
  var lifetime = 8000 + Math.random() * 12000;

  // Start crawling after a brief pause
  setTimeout(function () {
    if (creatureEl.parentNode && !creatureEl.classList.contains('ground-creature--leaving') &&
        !creatureEl.classList.contains('ground-creature--flying-away') &&
        !creatureEl.classList.contains('ground-creature--retreating') &&
        !creatureEl.classList.contains('ground-creature--burrowing')) {
      creatureEl.classList.add('ground-creature--crawling');
    }
  }, 500);

  setTimeout(function () {
    if (!creatureEl.parentNode) return;
    if (creatureEl.classList.contains('ground-creature--leaving') ||
        creatureEl.classList.contains('ground-creature--flying-away') ||
        creatureEl.classList.contains('ground-creature--retreating') ||
        creatureEl.classList.contains('ground-creature--burrowing')) return;

    creatureEl.classList.remove('ground-creature--crawling');
    creatureEl.classList.add('ground-creature--leaving');
    setTimeout(function () {
      removeCreature(creatureEl);
    }, 700);
  }, lifetime);
}

function scheduleNextSpawn() {
  if (creatureSpawnTimer) clearTimeout(creatureSpawnTimer);

  if (!creaturesEnabled) return;
  if (plantedCount.value === 0) return;

  var interval = Math.max(MIN_SPAWN_INTERVAL, 8000 - (plantedCount.value * 800));
  interval += Math.random() * 4000;

  creatureSpawnTimer = visibleSetTimeout(function () {
    spawnCreature();
    scheduleNextSpawn();
  }, interval);
}

function clearAllCreatures() {
  var gardenGrid = dom.gardenGrid;
  if (!gardenGrid) return;
  var existing = gardenGrid.querySelectorAll('.ground-creature');
  existing.forEach(function (el) {
    el.remove();
  });
  activeCreatures = [];
}

// ── Cricket (summer-only ground creature) ──

function createCricket() {
  var el = document.createElement('div');
  el.classList.add('ground-creature', 'ground-creature--cricket');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Cricket');
  el.setAttribute('tabindex', '0');

  // Body
  var body = document.createElement('div');
  body.classList.add('cricket-body');

  // Head
  var head = document.createElement('div');
  head.classList.add('cricket-head');

  // Eyes
  var eyeLeft = document.createElement('div');
  eyeLeft.classList.add('cricket-eye', 'cricket-eye--left');
  var eyeRight = document.createElement('div');
  eyeRight.classList.add('cricket-eye', 'cricket-eye--right');
  head.appendChild(eyeLeft);
  head.appendChild(eyeRight);

  // Antennae
  var antennaLeft = document.createElement('div');
  antennaLeft.classList.add('cricket-antenna', 'cricket-antenna--left');
  var antennaRight = document.createElement('div');
  antennaRight.classList.add('cricket-antenna', 'cricket-antenna--right');

  // Legs (hind legs for jumping)
  var hindLegLeft = document.createElement('div');
  hindLegLeft.classList.add('cricket-leg', 'cricket-leg--hind-left');
  var hindLegRight = document.createElement('div');
  hindLegRight.classList.add('cricket-leg', 'cricket-leg--hind-right');

  // Wings (folded)
  var wingLeft = document.createElement('div');
  wingLeft.classList.add('cricket-wing', 'cricket-wing--left');
  var wingRight = document.createElement('div');
  wingRight.classList.add('cricket-wing', 'cricket-wing--right');

  body.appendChild(hindLegLeft);
  body.appendChild(hindLegRight);
  body.appendChild(wingLeft);
  body.appendChild(wingRight);

  el.appendChild(body);
  el.appendChild(head);
  el.appendChild(antennaLeft);
  el.appendChild(antennaRight);

  return el;
}

// ── Public API ──

export function startGroundCreatures() {
  if (creatureSpawnTimer) visibleClearTimeout(creatureSpawnTimer);
  scheduleNextSpawn();
}

export function stopGroundCreatures() {
  if (creatureSpawnTimer) {
    visibleClearTimeout(creatureSpawnTimer);
    creatureSpawnTimer = null;
  }
  clearAllCreatures();
}

export function initGroundCreatures() {
  // Visibility pause is now handled centrally by visibility-manager.js
  // via the tab-hidden body class and wrapped timers


  // Pause when garden grid is off-screen
  var gardenGrid = dom.gardenGrid;
  if (gardenGrid && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        creaturesPaused = !entry.isIntersecting;
      });
    }, { threshold: 0 });
    observer.observe(gardenGrid);
  }
}

export function setGroundCreaturesEnabled(enabled) {
  creaturesEnabled = enabled;
  if (!enabled) {
    clearAllCreatures();
    if (creatureSpawnTimer) {
      visibleClearTimeout(creatureSpawnTimer);
      creatureSpawnTimer = null;
    }
  } else {
    scheduleNextSpawn();
  }
}

export function isGroundCreaturesEnabled() {
  return creaturesEnabled;
}
