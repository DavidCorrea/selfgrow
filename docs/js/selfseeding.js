// ── Garden Self-Seeding System ──
// When the garden is thriving, volunteer seeds spontaneously sprout on empty tiles.
// This makes the garden feel like a living, self-sustaining ecosystem.

import { dom, tileCycleState, tileColorMap, tileFlowerTypeMap, plantedCount, journalEntries, totalVolunteers, totalTiles } from './state.js';
import { saveGardenState } from './persistence.js';
import { getCurrentWeather, getWeatherModifier } from './weather.js';
import { getBloomingCount } from './visitors.js';
import { isSoundscapeEnabled } from './soundscape.js';
import { notifyStatsChange } from './stats.js';
import { startGrowthCycle } from './tiles.js';
import { recordBloom } from './garden-rings.js';
import { visibleSetTimeout } from './visibility-manager.js';

var seedingTimer = null;
var isSeedingActive = false;
var pendingPulseTiles = [];

// ── Wildflower Palette ──
// Volunteers get a distinct "wild" color palette — softer, more muted tones
var wildPalettes = [
  ['#c4b5a0', '#a89985', '#968a74'],  // warm sand
  ['#b8a9c9', '#9d8db5', '#8a779f'],  // dusty lavender
  ['#aec6cf', '#95b4be', '#7da2ad'],  // soft blue-grey
  ['#c9ada7', '#b5968f', '#a18077'],  // muted rose
  ['#b5c99a', '#9db582', '#85a16a'],  // sage green
  ['#d4b8a0', '#c0a48b', '#ad9076'],  // warm clay
  ['#a0c4b8', '#8bb0a4', '#769c90'],  // seafoam mist
  ['#c0b5d6', '#ab9cc2', '#9683ae'],  // wisteria haze
  ['#d6c8b0', '#c2b49b', '#aea086'],  // straw gold
];

var wildCenterColors = [
  '#d4a574', '#c9956a', '#be8560',
  '#ddd3c4', '#d0c4b2', '#c3b5a0',
];

var volunteerMessages = [
  'a seed carried by the wind finds its home',
  'nature plants what the heart cannot hold',
  'a volunteer blooms where none was sown',
  'the garden sows itself in quiet wonder',
  'life stirs in the untouched soil',
  'a wild spirit takes root in the stillness',
  'the breeze delivers an unexpected gift',
  'from nowhere, life — soft and insistent',
];

// ── Volunteer Chime ──
// A soft gentle chime when a volunteer seed lands (uses Web Audio API)
function playVolunteerChime() {
  if (!isSoundscapeEnabled()) return;

  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    var ctx = new AudioCtx();
    var now = ctx.currentTime;

    // Two gentle sine tones — like a soft bell
    var osc1 = ctx.createOscillator();
    var osc2 = ctx.createOscillator();
    var gain1 = ctx.createGain();
    var gain2 = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.value = 880; // A5
    osc2.type = 'sine';
    osc2.frequency.value = 1318.5; // E6

    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.06, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.04, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 2);
    osc2.start(now);
    osc2.stop(now + 2);

    setTimeout(function () { ctx.close(); }, 2500);
  } catch (e) {
    // silently fail — chime is non-essential
  }
}

// ── Get Empty Tiles ──
function getEmptyTiles() {
  var empty = [];
  var tiles = dom.tiles;
  if (!tiles) return empty;
  tiles.forEach(function (tile) {
    if (!tile.classList.contains('planted')) {
      empty.push(tile);
    }
  });
  return empty;
}

// ── Calculate Seeding Chance ──
// Returns 0-1 probability based on garden conditions
function getSeedingChance() {
  var blooming = getBloomingCount();
  var weather = getCurrentWeather();
  var mod = getWeatherModifier();

  // Need at least 3 blooming flowers
  if (blooming < 3) return 0;

  // Snow = dormant, no seeding
  if (weather === 'snowy') return 0;

  // Base chance: 25% with 3 blooming, scaling up
  var base = 0.25 + (blooming - 3) * 0.08;
  base = Math.min(base, 0.65); // cap at 65%

  // Weather modifier: rain and sun boost
  if (weather === 'rainy') base *= 1.3;
  else if (weather === 'sunny') base *= 1.15;
  // cloudy: no modifier

  return Math.min(base, 0.75);
}

// ── Tile Pulse Hint ──
// Before a seed lands, hint that something is about to happen
function showTilePulseHint(tileEl) {
  if (tileEl.classList.contains('volunteer-pulse')) return;

  // Check for reduced motion
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    // Skip the pulse animation — just proceed directly to seeding
    plantVolunteer(tileEl);
    return;
  }

  tileEl.classList.add('volunteer-pulse');
  pendingPulseTiles.push(tileEl);

  // The pulse lasts 2-3 seconds, then the seed lands
  var pulseDuration = 2000 + Math.random() * 1000;

  setTimeout(function () {
    tileEl.classList.remove('volunteer-pulse');
    var idx = pendingPulseTiles.indexOf(tileEl);
    if (idx !== -1) pendingPulseTiles.splice(idx, 1);

    // Only plant if tile is still empty
    if (!tileEl.classList.contains('planted') && !tileEl.classList.contains('volunteer-landing')) {
      plantVolunteer(tileEl);
    }
  }, pulseDuration);
}

// ── Create Falling Seed Element ──
function createFallingSeed(tileEl) {
  var seed = document.createElement('div');
  seed.classList.add('volunteer-seed-fall');
  seed.setAttribute('aria-hidden', 'true');

  // Position at top of the tile
  tileEl.appendChild(seed);

  setTimeout(function () {
    seed.remove();
  }, 1200);
}

// ── Plant Volunteer ──
function plantVolunteer(tileEl) {
  if (tileEl.classList.contains('planted')) return;

  var tileIndex = parseInt(tileEl.getAttribute('data-tile'), 10);

  // Use wildflower palette instead of standard
  var wildPalette = wildPalettes[tileIndex % wildPalettes.length];
  var wildCenter = wildCenterColors[tileIndex % wildCenterColors.length];

  // Apply wild colors directly
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

  // Volunteers get the 'wildflower' morphology
  tileFlowerTypeMap[tileIndex] = 'wildflower';

  tileCycleState[tileIndex] = { cycle: 1, stage: 'volunteer', timeouts: [], isVolunteer: true, flowerType: 'wildflower' };

  // Apply wildflower CSS class to sprout
  var sproutEl = tileEl.querySelector('.tile-sprout');
  if (sproutEl) {
    sproutEl.classList.add('flower-wildflower');
  }

  tileEl.classList.add('planted', 'volunteer', 'volunteer-landing');
  tileEl.setAttribute('aria-label', 'Tile ' + (tileIndex + 1) + ' volunteer plant');

  // Animate the falling seed
  var tileSeed = tileEl.querySelector('.tile-seed');
  createFallingSeed(tileEl);

  // Start with seed visible
  tileSeed.classList.add('visible');

  // Play chime
  playVolunteerChime();

  // Weather-scaled timings for volunteer growth
  var wsm = getWeatherModifier();
  var mult = wsm ? wsm.growthMultiplier : 1.0;
  function weatherScaled(baseMs) { return Math.max(baseMs * mult, 200); }

  var seedDelay = weatherScaled(500);
  var budDelay = weatherScaled(1400);
  var bloomDelay = weatherScaled(2000);
  var grownDelay = weatherScaled(2700);
  var holdBloom = weatherScaled(8000);
  var wiltDur = weatherScaled(2000);
  var pauseWilt = weatherScaled(1500);

  setTimeout(function () {
    var sprout = tileEl.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.add('growing');
    }
  }, seedDelay);

  setTimeout(function () {
    var sprout = tileEl.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.remove('growing');
      sprout.classList.add('budding');
    }
  }, budDelay);

  setTimeout(function () {
    var sprout = tileEl.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.remove('budding');
      sprout.classList.add('blooming');
    }
  }, bloomDelay);

  setTimeout(function () {
    var sprout = tileEl.querySelector('.tile-sprout');
    if (sprout) {
      sprout.classList.remove('blooming');
      sprout.classList.add('grown');
    }
    tileEl.classList.remove('volunteer-landing');

    // Volunteer sparkles — slightly different tint
    createVolunteerSparkles(tileEl);

    var badge = tileEl.querySelector('.tile-cycle-badge');
    if (badge) {
      badge.textContent = '🌿 1';
      badge.classList.add('visible');
    }

    plantedCount.value++;
    totalVolunteers.value++;

    if (dom.counter) {
      dom.counter.innerHTML = 'planted <span>' + plantedCount.value + '</span> / ' + totalTiles;
    }

    // Log volunteer entry in journal
    var msg = volunteerMessages[Math.floor(Math.random() * volunteerMessages.length)];
    var journalEntry = {
      tileIndex: tileIndex,
      petalColor: wildPalette[0],
      time: formatTimeSimple(new Date()),
      timestamp: Date.now(),
      cycle: 1,
      type: 'volunteer',
      subText: msg
    };

    // Add entry through journal system
    addVolunteerJournalEntry(journalEntry, tileIndex, wildPalette[0], msg);

    // Record bloom for garden rings
    recordBloom(tileIndex, 1);

    // Update stats
    notifyStatsChange();
    saveGardenState();

    // Grid hint
    if (dom.gridHint) {
      dom.gridHint.style.opacity = '0';
      setTimeout(function () {
        dom.gridHint.textContent = msg;
        dom.gridHint.style.opacity = '1';
      }, 300);
    }

    // Schedule wilt
    var offset = tileIndex * 1200 * mult;
    var firstWiltDelay = holdBloom + offset;

    setTimeout(function () {
      if (!tileEl.classList.contains('planted')) return;

      var sp = tileEl.querySelector('.tile-sprout');
      sp.classList.remove('grown');
      sp.classList.add('wilting');

      setTimeout(function () {
        if (!tileEl.classList.contains('planted')) return;
        if (badge) badge.classList.remove('visible');
        tileCycleState[tileIndex].cycle = 2;
        startGrowthCycle(tileEl, tileIndex);
      }, wiltDur + pauseWilt);
    }, firstWiltDelay);
  }, grownDelay);
}

// ── Volunteer Sparkles ──
function createVolunteerSparkles(tileEl) {
  var rect = tileEl.getBoundingClientRect();
  var centerX = rect.width / 2;
  var centerY = rect.height * 0.35;

  for (var i = 0; i < 6; i++) {
    var sparkle = document.createElement('div');
    sparkle.classList.add('volunteer-sparkle');
    var angle = (Math.PI * 2 * i) / 6;
    var distance = 1.5 + Math.random() * 1.5;
    var tx = Math.cos(angle) * distance * 8 + 'px';
    var ty = Math.sin(angle) * distance * 8 + 'px';
    sparkle.style.setProperty('--tx', tx);
    sparkle.style.setProperty('--ty', ty);
    sparkle.style.left = centerX + 'px';
    sparkle.style.top = centerY + 'px';
    tileEl.appendChild(sparkle);

    (function (s) {
      setTimeout(function () { s.remove(); }, 800);
    })(sparkle);
  }
}

// ── Format time helper (simple) ──
function formatTimeSimple(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  return displayHours + ':' + displayMinutes + ' ' + ampm;
}

// ── Add Volunteer Journal Entry ──
function addVolunteerJournalEntry(entry, tileIndex, petalColor, message) {
  var gardenJournal = dom.gardenJournal;
  var journalTimeline = dom.journalTimeline;
  var journalEmpty = dom.journalEmpty;

  journalEntries.push(entry);

  if (journalEmpty) {
    journalEmpty.style.display = 'none';
  }

  if (journalTimeline) {
    // Reveal journal if not visible
    if (gardenJournal && !journalTimeline.hasChildNodes()) {
      gardenJournal.classList.add('visible');
      gardenJournal.setAttribute('aria-hidden', 'false');
    }

    var entryEl = document.createElement('div');
    entryEl.classList.add('journal-entry', 'journal-entry--volunteer');
    entryEl.setAttribute('role', 'listitem');

    entryEl.innerHTML =
      '<div class="entry-timeline-dot entry-timeline-dot--volunteer"></div>' +
      '<div class="entry-content">' +
        '<p class="entry-text">🌿 <strong>Tile ' + (tileIndex + 1) + '</strong> &mdash; volunteer at ' + entry.time + '</p>' +
        '<p class="entry-time">' + message + '</p>' +
      '</div>' +
      '<div class="entry-swatch entry-swatch--volunteer" style="background: ' + petalColor + '" aria-hidden="true"></div>';

    journalTimeline.insertBefore(entryEl, journalTimeline.firstChild);

    if (gardenJournal) {
      gardenJournal.classList.remove('pulse');
      void gardenJournal.offsetWidth;
      gardenJournal.classList.add('pulse');
    }

    journalTimeline.scrollTop = 0;
  }
}

// ── Attempt Seeding ──
function attemptSeeding() {
  if (!isSeedingActive) return;

  var emptyTiles = getEmptyTiles();
  if (emptyTiles.length === 0) {
    // All tiles planted — reschedule check
    scheduleNextAttempt();
    return;
  }

  var chance = getSeedingChance();

  if (Math.random() < chance) {
    // Pick a random empty tile
    var targetTile = emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
    showTilePulseHint(targetTile);
  }

  scheduleNextAttempt();
}

// ── Schedule Next Attempt ──
function scheduleNextAttempt() {
  if (!isSeedingActive) return;

  // Check every 60-90 seconds
  var interval = 60000 + Math.random() * 30000;
  seedingTimer = visibleSetTimeout(attemptSeeding, interval);
}

// ── Start Self-Seeding ──
export function startSelfSeeding() {
  if (isSeedingActive) return;
  isSeedingActive = true;

  // First attempt after 60 seconds
  seedingTimer = visibleSetTimeout(attemptSeeding, 60000);
}




