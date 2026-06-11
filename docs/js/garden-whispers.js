// ── Garden Whispers — Ambient Context-Aware Poetic Observations ──
// Periodically evaluates garden state and displays soft, fading
// poetic whispers as translucent text overlays on the grid.

import { dom, plantedCount, tileCycleState } from './state.js';
import { getCurrentTheme, getCurrentCalendarSeason } from './theme.js';
import { getBloomingCount } from './visitors.js';
import { visibleSetTimeout, visibleClearTimeout } from './visibility-manager.js';

var whispersEnabled = true;
var whisperTimer = null;
var activeWhispers = [];

// ── Curated Whisper Pools ──
// Each whisper is a plain string. Selection is context-aware.

var genericWhispers = [
  "the garden breathes in quiet rhythms",
  "roots reach deeper into the dark earth",
  "a petal unfolds in its own time",
  "the soil remembers every seed",
  "growth is a slow conversation with light",
  "the garden dreams in green",
  "each leaf turns toward the light",
  "patience is the gardener's truest tool",
  "the earth hums with hidden life",
  "a flower is a slow explosion of color",
  "the garden holds its breath between blooms",
  "time moves differently here",
  "the roots know what the eyes cannot see",
  "every ending is a beginning in disguise",
  "the garden whispers in colors",
];

var rainWhispers = [
  "the rain sings quietly to {count} open petals",
  "raindrops trace silver paths down each leaf",
  "the garden drinks deeply from the grey sky",
  "soft rain coaxes new life from sleeping soil",
  "each raindrop carries a tiny world of light",
  "the flowers bow gently under rain's caress",
  "the earth sighs as rain finds its way home",
  "a thousand tiny drums play on broad leaves",
];

var sunnyWhispers = [
  "sunlight weaves gold through every petal",
  "warm light coaxes the blooms to open wider",
  "the garden basks in a slow golden hour",
  "each leaf catches and holds a piece of the sun",
  "the warmth settles deep into the soil",
  "flowers turn their faces to follow the light",
  "the garden glows with quiet contentment",
  "sunlight paints shadows that dance and shift",
];

var nightWhispers = [
  "silver moonlight touches the open petals",
  "the garden breathes slowly under starlight",
  "moonflowers open their faces to the dark",
  "the night air carries the scent of blooms",
  "shadows grow long and soft between the stems",
  "the garden rests in the hush of midnight",
  "starlight filters through each delicate petal",
  "the moon watches over the sleeping garden",
];

var winterWhispers = [
  "the garden breathes slowly under winter's hush",
  "frost traces delicate patterns on each leaf",
  "the cold air sharpens the garden's quiet beauty",
  "snow settles like a gentle blanket over the soil",
  "the garden sleeps, but does not dream",
  "winter light falls soft and pale on bare stems",
  "the earth rests beneath a crystalline veil",
  "even in cold, life waits patiently below",
];

var springWhispers = [
  "new life pushes through the warming soil",
  "the garden stirs with the first breath of spring",
  "tender shoots reach for the pale morning light",
  "the earth awakens with a gentle sigh",
  "green returns to the garden like a promise",
  "the first buds swell with quiet anticipation",
  "spring rain feeds the hungry, waiting roots",
  "the garden remembers how to grow",
];

var autumnWhispers = [
  "amber leaves drift through the cooling air",
  "the garden prepares for its long rest",
  "golden light slants through the thinning leaves",
  "the soil holds the warmth of summer past",
  "petals fall like whispered memories",
  "the garden lets go with quiet grace",
  "seeds settle into the earth's dark pockets",
  "the cycle turns toward stillness and reflection",
];

var bloomWhispers = [
  "{count} blooms open their faces to the world",
  "a flower unfolds like a whispered secret",
  "the garden wears its colors with quiet pride",
  "petals catch the light and hold it gently",
  "each bloom is a small celebration of life",
  "the air sweetens where the flowers open",
  "a new bloom joins the garden's quiet chorus",
  "the flowers speak in colors, not in words",
];

var creatureWhispers = [
  "a butterfly traces the color of your flowers",
  "a ladybug rests on a leaf, then moves on",
  "the garden hums with tiny, hidden lives",
  "a snail carries its slow world across the soil",
  "worms turn the earth in silent industry",
  "a cricket's song threads through the stillness",
  "bees drift from bloom to bloom like thoughts",
  "the garden is alive with small movements",
];

var tendedWhispers = [
  "the garden remembers your gentle hands",
  "your care lingers in the soil like warmth",
  "the plants lean toward where you last stood",
  "tending is a conversation without words",
  "the garden grows in response to your attention",
  "your presence lingers like the scent of rain",
  "the garden holds the memory of your touch",
  "each act of care ripples through the roots",
];

var emptyGardenWhispers = [
  "the soil waits, patient and full of possibility",
  "an empty garden is a story yet to be told",
  "the earth holds space for what will come",
  "silence here is not absence — it is potential",
  "the garden dreams of the seeds yet to be planted",
  "bare soil holds the memory of every bloom before",
  "the empty garden breathes with quiet anticipation",
  "in stillness, the garden gathers its strength",
];

// ── Helper Functions ──

function getTileCount() {
  return dom.tiles ? dom.tiles.length : 9;
}

function getPlantedTilesCount() {
  if (!dom.tiles) return 0;
  var count = 0;
  dom.tiles.forEach(function (tile) {
    if (tile.classList.contains('planted')) count++;
  });
  return count;
}

function getBloomingTilesCount() {
  return getBloomingCount();
}

function hasActiveCreatures() {
  if (!dom.visitorsLayer) return false;
  var visitors = dom.visitorsLayer.querySelectorAll('.visitor');
  var creatures = document.querySelectorAll('.ground-creature');
  return visitors.length > 0 || creatures.length > 0;
}

function getWeather() {
  // Read from the weather module's exported state if available
  // Fallback: check body class or default to sunny
  var body = document.body;
  if (body.classList.contains('weather-rainy')) return 'rainy';
  if (body.classList.contains('weather-snowy')) return 'snowy';
  if (body.classList.contains('weather-cloudy')) return 'cloudy';
  return 'sunny';
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatWhisper(text, context) {
  var result = text;
  if (context.count !== undefined) {
    result = result.replace('{count}', String(context.count));
  }
  return result;
}

// ── Context-Aware Selection ──

function selectWhisper() {
  var planted = getPlantedTilesCount();
  var blooming = getBloomingTilesCount();
  var theme = getCurrentTheme();
  var season = getCurrentCalendarSeason();
  var weather = getWeather();
  var creatures = hasActiveCreatures();
  var total = getTileCount();

  // Build a weighted pool based on context
  var pool = [];

  // Empty garden — gentle encouragement
  if (planted === 0) {
    pool = pool.concat(emptyGardenWhispers);
    return pickRandom(pool);
  }

  // Weather-specific whispers (strong weight when relevant)
  if (weather === 'rainy') {
    pool = pool.concat(rainWhispers);
    pool = pool.concat(rainWhispers); // double weight
  }

  // Night whispers
  if (theme === 'night') {
    pool = pool.concat(nightWhispers);
    pool = pool.concat(nightWhispers);
  }

  // Season whispers
  if (season === 'winter') {
    pool = pool.concat(winterWhispers);
  } else if (season === 'spring') {
    pool = pool.concat(springWhispers);
  } else if (season === 'autumn') {
    pool = pool.concat(autumnWhispers);
  }

  // Sunny whispers
  if (weather === 'sunny' && theme !== 'night') {
    pool = pool.concat(sunnyWhispers);
  }

  // Bloom-specific whispers
  if (blooming > 0) {
    var bloomCounted = bloomWhispers.map(function (w) {
      return formatWhisper(w, { count: blooming });
    });
    pool = pool.concat(bloomCounted);
    if (blooming >= 3) {
      pool = pool.concat(bloomCounted); // more blooms = more likely
    }
  }

  // Creature whispers
  if (creatures) {
    pool = pool.concat(creatureWhispers);
  }

  // Tended whispers (if any tiles have been watered/fertilized/pruned)
  var hasTended = false;
  if (dom.tiles) {
    dom.tiles.forEach(function (tile) {
      if (tile.classList.contains('watered') ||
          tile.classList.contains('fertilized') ||
          tile.classList.contains('pruned-tile')) {
        hasTended = true;
      }
    });
  }
  if (hasTended) {
    pool = pool.concat(tendedWhispers);
  }

  // Generic whispers as fallback
  pool = pool.concat(genericWhispers);

  // If pool is somehow empty, use generic
  if (pool.length === 0) {
    pool = genericWhispers;
  }

  return pickRandom(pool);
}

// ── Whisper Display ──

function createWhisperElement(text) {
  var grid = dom.gardenGrid;
  if (!grid) return null;

  var wrapper = dom.gardenGridWrapper;
  if (!wrapper) return null;

  var whisper = document.createElement('div');
  whisper.classList.add('garden-whisper');
  whisper.textContent = text;
  whisper.setAttribute('aria-hidden', 'true');
  whisper.setAttribute('role', 'presentation');

  // Position randomly within the grid area
  var gridRect = grid.getBoundingClientRect();
  var wrapperRect = wrapper.getBoundingClientRect();

  // Calculate position relative to wrapper
  var relX = gridRect.left - wrapperRect.left;
  var relY = gridRect.top - wrapperRect.top;

  // Random position within grid bounds (with padding)
  var padding = 15; // percentage
  var x = padding + Math.random() * (100 - padding * 2);
  var y = padding + Math.random() * (100 - padding * 2);

  whisper.style.left = x + '%';
  whisper.style.top = y + '%';

  // Random slight rotation for organic feel
  var rotation = (Math.random() - 0.5) * 6; // -3 to +3 degrees
  whisper.style.setProperty('--whisper-rot', rotation + 'deg');

  // Random animation delay for staggered appearance
  var delay = Math.random() * 0.5;
  whisper.style.animationDelay = delay + 's';

  wrapper.appendChild(whisper);

  return whisper;
}

function showWhisper() {
  if (!whispersEnabled) return;
  if (!dom.gardenGridWrapper || !dom.gardenGridWrapper.classList.contains('visible')) return;

  var text = selectWhisper();
  var whisper = createWhisperElement(text);
  if (!whisper) return;

  activeWhispers.push(whisper);

  // Remove after animation completes (2s fade-in + 6-8s hold + 3s fade-out = ~11-13s)
  var totalDuration = 12000 + Math.random() * 2000; // 12-14s

  visibleSetTimeout(function () {
    if (whisper.parentNode) {
      whisper.remove();
    }
    var idx = activeWhispers.indexOf(whisper);
    if (idx !== -1) {
      activeWhispers.splice(idx, 1);
    }
  }, totalDuration);
}

// ── Scheduling ──

function scheduleNextWhisper() {
  if (!whispersEnabled) return;

  // Random interval between 20-40 seconds
  var interval = 20000 + Math.random() * 20000;

  whisperTimer = visibleSetTimeout(function () {
    showWhisper();
    scheduleNextWhisper();
  }, interval);
}

// ── Public API ──

export function initGardenWhispers() {
  // Start the whisper cycle after a short initial delay
  visibleSetTimeout(function () {
    scheduleNextWhisper();
  }, 5000);
}

export function setWhispersEnabled(enabled) {
  whispersEnabled = enabled;
  if (!enabled) {
    // Clear pending timer
    if (whisperTimer) {
      visibleClearTimeout(whisperTimer);
      whisperTimer = null;
    }
    // Remove active whispers
    activeWhispers.forEach(function (w) {
      if (w.parentNode) w.remove();
    });
    activeWhispers = [];
  } else {
    // Restart if timer is not running
    if (!whisperTimer) {
      scheduleNextWhisper();
    }
  }
}

export function isWhispersEnabled() {
  return whispersEnabled;
}
