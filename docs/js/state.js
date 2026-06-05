// ── Shared Mutable State ──
// All modules read/write these shared objects to coordinate behavior.

export var currentWeather = { value: 'sunny' };
export var plantedCount = { value: 0 };
export var gridRevealed = { value: false };
export var journalRevealed = { value: false };
export var tendingRevealed = { value: false };
export var journalEntries = [];
export var wateredTiles = {};
export var tileCycleState = {};
export var tileColorMap = {};
export var totalVolunteers = { value: 0 };

// DOM refs (set by main script.js after DOM ready)
export var dom = {};

// Constants
export var CYCLE_HOLD_BLOOM = 8000;
export var CYCLE_WILT_DURATION = 2000;
export var CYCLE_PAUSE_AFTER_WILT = 1500;
export var CYCLE_SEED_OFFSET = 1200;
export var totalTiles = 9;

export var petalPalettes = [
  ['#f472b6', '#ec4899', '#db2777'],
  ['#fb923c', '#f97316', '#ea580c'],
  ['#a78bfa', '#8b5cf6', '#7c3aed'],
  ['#60a5fa', '#3b82f6', '#2563eb'],
  ['#fbbf24', '#f59e0b', '#d97706'],
  ['#f472b6', '#a78bfa', '#60a5fa'],
  ['#fb923c', '#f472b6', '#fbbf24'],
  ['#60a5fa', '#34d399', '#a78bfa'],
  ['#fbbf24', '#fb923c', '#f472b6'],
];

export var centerColors = ['#fbbf24', '#fde68a', '#fcd34d', '#f59e0b', '#eab308'];

export var gridMessages = [
  "your garden is growing",
  "each tile holds a new possibility",
  "life finds a way",
  "tend it gently",
  "watch it flourish",
];

export var cycleMessages = [
  "a new cycle begins",
  "life renews itself",
  "the garden breathes",
  "from soil, life returns",
  "nature's rhythm continues",
];

export var wateringHintMessages = [
  "click a watered tile to speed up its growth",
  "water accelerates the life cycle",
  "your plants love the extra care",
];

export var weatherMessages = {
  sunny: [
    "sunlight quickens the blooms",
    "warm rays coax the petals open",
    "the garden basks in golden light",
    "sunlight weaves through every leaf",
  ],
  rainy: [
    "a gentle rain nourishes your garden",
    "raindrops kiss the soil and roots drink deep",
    "the garden sighs in the rain",
    "soft rain feeds every waiting seed",
  ],
  cloudy: [
    "clouds gather, the garden rests in grey",
    "a quiet stillness settles over the soil",
    "the garden breathes under overcast skies",
    "soft diffused light wraps the garden",
  ],
  snowy: [
    "snow blankets the garden in stillness",
    "frost slows the pulse of the garden",
    "the garden sleeps beneath a white veil",
    "snow hushes every growing thing",
  ],
};

export function getRandomWeatherMessage(weather) {
  var msgs = weatherMessages[weather] || weatherMessages.sunny;
  return msgs[Math.floor(Math.random() * msgs.length)];
}

export function getRandomGridMessage() {
  return gridMessages[Math.floor(Math.random() * gridMessages.length)];
}

export function getRandomCycleMessage() {
  return cycleMessages[Math.floor(Math.random() * cycleMessages.length)];
}

export function getRandomWateringHint() {
  return wateringHintMessages[Math.floor(Math.random() * wateringHintMessages.length)];
}
