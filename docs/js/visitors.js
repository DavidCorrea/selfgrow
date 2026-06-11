import { dom, plantedCount } from './state.js';
import { isNightTheme } from './theme.js';
import { getCurrentGardenSeason } from './garden-seasons.js';
import { visibleSetTimeout, visibleClearTimeout, visibleSetInterval, visibleClearInterval } from './visibility-manager.js';

var activeVisitors = [];
var visitorIdCounter = 0;
var visitorSpawnTimer = null;
var fireflyTrailTimer = null;
var visitorsPaused = false;

var MAX_CONCURRENT_VISITORS = 5;
var MIN_SPAWN_INTERVAL = 3000;

var butterflyColors = ['pink', 'blue', 'purple', 'orange'];

function getTiles() {
  return dom.tiles || document.querySelectorAll('.grid-tile');
}

export function getBloomingCount() {
  var count = 0;
  var tiles = getTiles();
  tiles.forEach(function (tile) {
    if (tile.classList.contains('planted')) {
      var sprout = tile.querySelector('.tile-sprout');
      if (sprout && sprout.classList.contains('grown')) {
        count++;
      }
    }
  });
  return count;
}

export function getPlantedCount() {
  return plantedCount.value;
}

function getRandomBloomingTileRect() {
  var tiles = getTiles();
  var bloomingTiles = [];
  tiles.forEach(function (tile) {
    if (tile.classList.contains('planted')) {
      var sprout = tile.querySelector('.tile-sprout');
      if (sprout && sprout.classList.contains('grown')) {
        bloomingTiles.push(tile);
      }
    }
  });
  if (bloomingTiles.length === 0) return null;
  var tile = bloomingTiles[Math.floor(Math.random() * bloomingTiles.length)];
  return tile.getBoundingClientRect();
}

function createButterfly() {
  var color = butterflyColors[Math.floor(Math.random() * butterflyColors.length)];
  var butterfly = document.createElement('div');
  butterfly.classList.add('visitor', 'butterfly', 'butterfly--' + color, 'flutter-path');
  butterfly.setAttribute('role', 'img');
  butterfly.setAttribute('aria-label', 'Butterfly');
  butterfly.setAttribute('tabindex', '0');

  butterfly.innerHTML =
    '<div class="butterfly-wing butterfly-wing--left"></div>' +
    '<div class="butterfly-wing butterfly-wing--right"></div>' +
    '<div class="butterfly-body"></div>';

  return butterfly;
}

function createBee() {
  var bee = document.createElement('div');
  bee.classList.add('visitor', 'bee', 'flutter-path');
  bee.setAttribute('role', 'img');
  bee.setAttribute('aria-label', 'Bee');
  bee.setAttribute('tabindex', '0');

  bee.innerHTML =
    '<div class="bee-wing bee-wing--left"></div>' +
    '<div class="bee-wing bee-wing--right"></div>' +
    '<div class="bee-body"></div>' +
    '<div class="bee-stinger"></div>';

  return bee;
}

function createFirefly() {
  var firefly = document.createElement('div');
  firefly.classList.add('visitor', 'firefly', 'flutter-path');
  firefly.setAttribute('role', 'img');
  firefly.setAttribute('aria-label', 'Firefly');
  firefly.setAttribute('tabindex', '0');

  firefly.innerHTML = '<div class="firefly-glow"></div>';

  return firefly;
}

function positionRandomly(el) {
  var maxX = Math.max(0, window.innerWidth - 40);
  var maxY = Math.max(0, window.innerHeight - 40);
  var x = Math.random() * maxX;
  var y = Math.random() * maxY;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function positionNearTile(el, rect) {
  var offsetX = (Math.random() - 0.5) * rect.width * 1.5;
  var offsetY = (Math.random() - 0.5) * rect.height * 1.5;
  var x = rect.left + rect.width / 2 + offsetX;
  var y = rect.top + rect.height / 2 + offsetY;
  x = Math.max(10, Math.min(window.innerWidth - 30, x));
  y = Math.max(10, Math.min(window.innerHeight - 30, y));
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function handleVisitorClick(visitorEl) {
  if (visitorEl.classList.contains('scattering') ||
      visitorEl.classList.contains('leaving')) return;

  visitorEl.classList.remove('flutter-path');

  var scatterX = (Math.random() - 0.5) * 140;
  var scatterY = -40 - Math.random() * 80;
  visitorEl.style.setProperty('--scatter-x', scatterX + 'px');
  visitorEl.style.setProperty('--scatter-y', scatterY + 'px');

  visitorEl.classList.add('scattering');

  setTimeout(function () {
    removeVisitor(visitorEl);
  }, 900);
}

function removeVisitor(visitorEl) {
  var id = parseInt(visitorEl.getAttribute('data-visitor-id'), 10);
  activeVisitors = activeVisitors.filter(function (v) { return v !== id; });
  if (visitorEl.parentNode) {
    visitorEl.remove();
  }
}

function spawnVisitor() {
  if (plantedCount.value === 0) return;
  if (visitorsPaused) return;
  if (activeVisitors.length >= MAX_CONCURRENT_VISITORS) return;

  var blooming = getBloomingCount();
  var isNight = isNightTheme();

  var visitorEl;

  var season = getCurrentGardenSeason();

  if (isNight) {
    // Fireflies are summer-only — they glow on warm evenings
    if (season === 'summer') {
      visitorEl = createFirefly();
    } else {
      // Other nights: occasional butterfly or bee
      visitorEl = Math.random() < 0.7 ? createButterfly() : createBee();
    }
  } else {
    // Bees are more common during spring and summer (pollination season)
    var beeWeight = (season === 'spring' || season === 'summer') ? 0.45 : 0.20;
    var roll = Math.random();
    if (roll < beeWeight) {
      visitorEl = createBee();
    } else if (roll < beeWeight + 0.40) {
      visitorEl = createButterfly();
    } else {
      // Second chance for butterfly or bee
      visitorEl = Math.random() < 0.5 ? createButterfly() : createBee();
    }
  }

  var visitorsLayer = dom.visitorsLayer || document.getElementById('visitorsLayer');
  var id = visitorIdCounter++;
  visitorEl.setAttribute('data-visitor-id', id);
  activeVisitors.push(id);

  var tileRect = getRandomBloomingTileRect();
  if (tileRect && Math.random() < 0.6) {
    positionNearTile(visitorEl, tileRect);
  } else {
    positionRandomly(visitorEl);
  }

  visitorEl.addEventListener('click', function (e) {
    e.stopPropagation();
    handleVisitorClick(visitorEl);
  });
  visitorEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      handleVisitorClick(visitorEl);
    }
  });

  visitorsLayer.appendChild(visitorEl);

  visitorEl.classList.add('landing');
  setTimeout(function () {
    visitorEl.classList.remove('landing');
  }, 500);

  // Dispatch sighting event for creature encyclopedia
  var sightingType = null;
  if (visitorEl.classList.contains('butterfly')) {
    sightingType = 'butterfly';
  } else if (visitorEl.classList.contains('bee')) {
    sightingType = 'bee';
  } else if (visitorEl.classList.contains('firefly')) {
    sightingType = 'firefly';
  }

  if (sightingType && typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('visitorSpawned', {
      detail: { type: sightingType }
    }));
  }

  var lifetime = 4000 + Math.random() * 6000;
  setTimeout(function () {
    if (!visitorEl.parentNode) return;
    if (visitorEl.classList.contains('scattering')) return;

    visitorEl.classList.add('leaving');
    setTimeout(function () {
      removeVisitor(visitorEl);
    }, 700);
  }, lifetime);
}

function createFireflyTrails() {
  if (visitorsPaused) return;
  var visitorsLayer = dom.visitorsLayer || document.getElementById('visitorsLayer');
  if (!isNightTheme()) return;

  var fireflies = visitorsLayer.querySelectorAll('.firefly:not(.scattering):not(.leaving)');
  fireflies.forEach(function (firefly) {
    if (Math.random() < 0.3) {
      var trail = document.createElement('div');
      trail.classList.add('firefly-trail');
      trail.style.left = firefly.style.left;
      trail.style.top = firefly.style.top;
      visitorsLayer.appendChild(trail);
      setTimeout(function () {
        trail.remove();
      }, 1500);
    }
  });
}

function scheduleNextSpawn() {
  if (visitorSpawnTimer) visibleClearTimeout(visitorSpawnTimer);

  if (plantedCount.value === 0) return;

  var season = getCurrentGardenSeason();
  var interval = Math.max(MIN_SPAWN_INTERVAL, 5000 - (plantedCount.value * 500));
  interval += Math.random() * 2000;

  // Summer has more activity (bees, butterflies, fireflies at night)
  if (season === 'summer') {
    interval *= 0.75;
  } else if (season === 'winter') {
    // Winter has fewer flying visitors
    interval *= 1.6;
  }

  visitorSpawnTimer = visibleSetTimeout(function () {
    spawnVisitor();
    scheduleNextSpawn();
  }, interval);
}

export function startVisitors() {
  if (visitorSpawnTimer) visibleClearTimeout(visitorSpawnTimer);
  scheduleNextSpawn();

  if (fireflyTrailTimer) visibleClearInterval(fireflyTrailTimer);
  fireflyTrailTimer = visibleSetInterval(createFireflyTrails, 500);
}

function clearAllVisitors() {
  var visitorsLayer = dom.visitorsLayer || document.getElementById('visitorsLayer');
  var existing = visitorsLayer.querySelectorAll('.visitor');
  existing.forEach(function (el) {
    el.remove();
  });
  activeVisitors = [];
}

export function initVisitors() {
  var lastThemeCheck = false;
  visibleSetInterval(function () {
    var currentNight = isNightTheme();
    if (currentNight !== lastThemeCheck) {
      lastThemeCheck = currentNight;
      clearAllVisitors();
    }
  }, 2000);

  lastThemeCheck = isNightTheme();

  // Use IntersectionObserver to pause visitors when off-screen
  var visitorsLayer = dom.visitorsLayer || document.getElementById('visitorsLayer');
  if (visitorsLayer && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visitorsPaused = !entry.isIntersecting;
      });
    }, { threshold: 0 });
    observer.observe(visitorsLayer);
  }
}
