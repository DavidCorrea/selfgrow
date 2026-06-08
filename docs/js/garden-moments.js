import { dom, plantedCount, totalTiles, tileColorMap, tileFlowerTypeMap, journalEntries, totalVolunteers, fertilizedTiles } from './state.js';
import { getCurrentSeasonName } from './theme.js';
import { getCurrentWeather } from './weather.js';
import { getBloomingCount, getPlantedCount } from './visitors.js';

var momentsRevealed = false;
var momentCaptureCooldown = false;

// ── Moment poetry based on garden state ──
var momentPoetry = {
  dawn: [
    'in the quiet hours, your garden stirs awake',
    'dawn light whispers through each petal',
    'the garden greets the new day with open blooms',
  ],
  day: [
    'sunlight weaves gold through your garden',
    'the garden basks in the fullness of day',
    'open to the sky, your garden flourishes',
  ],
  dusk: [
    'golden hour softens every leaf',
    'the garden holds the warmth of the day',
    'as light fades, your garden glows within',
  ],
  night: [
    'under starlight, your garden dreams',
    'the garden rests in silver quiet',
    'moonlight traces each sleeping petal',
  ],
};

function getRandomPoem(season) {
  var poems = momentPoetry[season] || momentPoetry.day;
  return poems[Math.floor(Math.random() * poems.length)];
}

function getMoodLabel() {
  var blooming = getBloomingCount();
  var planted = getPlantedCount();
  var now = Date.now();
  var lastTendedMs = now;

  if (journalEntries.length > 0) {
    var latestEntry = journalEntries[journalEntries.length - 1];
    if (latestEntry.timestamp) {
      lastTendedMs = latestEntry.timestamp;
    }
  }

  var diffHours = (now - lastTendedMs) / 3600000;

  if (planted === 0 && blooming === 0) return 'dormant';
  if (planted >= totalTiles) return 'complete';
  if (blooming >= 3 && diffHours < 1) return 'thriving';
  if (blooming >= 2 && diffHours < 3) return 'flourishing';
  if (planted >= 1 && diffHours < 12) return 'growing';
  if (planted >= 1 && diffHours < 48) return 'resting';
  return 'dormant';
}

function getWeatherEmoji(weather) {
  var emojis = { sunny: '☀️', rainy: '🌧️', cloudy: '☁️', snowy: '❄️' };
  return emojis[weather] || '☀️';
}

function getWeatherLabel(weather) {
  var labels = { sunny: 'sunny', rainy: 'rainy', cloudy: 'cloudy', snowy: 'snowy' };
  return labels[weather] || 'sunny';
}

function getMoodEmoji(mood) {
  var emojis = {
    thriving: '🌿', flourishing: '🌻', growing: '🌱',
    resting: '🍂', dormant: '💤', complete: '🌾'
  };
  return emojis[mood] || '✨';
}

function getSeasonEmoji(season) {
  var emojis = { dawn: '🌅', day: '☀️', dusk: '🌇', night: '🌙' };
  return emojis[season] || '☀️';
}

function getBloomColors() {
  var colors = [];
  var tiles = dom.tiles;
  if (tiles) {
    tiles.forEach(function (tile, index) {
      if (tile.classList.contains('planted') || tile.classList.contains('blooming') || 
          tile.querySelector('.tile-sprout.grown') || tile.querySelector('.tile-sprout.blooming')) {
        var color = tileColorMap[index];
        if (color) colors.push(color);
      }
    });
  }
  return colors;
}

function formatTimestamp() {
  var now = new Date();
  var hours = now.getHours();
  var minutes = now.getMinutes();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  var displayHours = hours % 12 || 12;
  var displayMinutes = minutes < 10 ? '0' + minutes : '' + minutes;
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var month = months[now.getMonth()];
  var day = now.getDate();
  return displayHours + ':' + displayMinutes + ' ' + ampm + ' · ' + month + ' ' + day;
}

// ── Create the moments button ──
function createMomentsButton() {
  var statsPoem = dom.statsPoem;
  if (!statsPoem) return;

  var btn = document.createElement('button');
  btn.classList.add('gallery-btn');
  btn.id = 'captureMomentBtn';
  btn.setAttribute('aria-label', 'Capture a garden moment');
  btn.innerHTML =
    '<span class="gallery-btn__icon">📷</span>' +
    '<span class="gallery-btn__label">capture this moment</span>';

  btn.addEventListener('click', openMomentModal);

  statsPoem.parentNode.insertBefore(btn, statsPoem.nextSibling);
}

// ── Build the moment card content ──
function buildMomentCard() {
  var season = getCurrentSeasonName();
  var weather = getCurrentWeather();
  var mood = getMoodLabel();
  var planted = getPlantedCount();
  var colors = getBloomColors();
  var poem = getRandomPoem(season);
  var timestamp = formatTimestamp();

  var card = document.createElement('div');
  card.classList.add('moment-card');

  // Header
  var header = document.createElement('div');
  header.classList.add('moment-card__header');
  header.innerHTML =
    '<span class="moment-card__season">' + getSeasonEmoji(season) + ' ' + season + '</span>' +
    '<span class="moment-card__time">' + timestamp + '</span>';
  card.appendChild(header);

  // Garden visualization mini-grid
  var grid = document.createElement('div');
  grid.classList.add('moment-card__grid');

  for (var i = 0; i < 9; i++) {
    var tile = document.createElement('div');
    tile.classList.add('moment-tile');

    var tileColor = tileColorMap[i];
    var isPlanted = tileColor !== undefined;

    if (isPlanted) {
      tile.classList.add('moment-tile--planted');
      // Create a mini flower representation
      var flower = document.createElement('div');
      flower.classList.add('moment-flower');
      flower.style.setProperty('--flower-color', tileColor);
      var fType = tileFlowerTypeMap[i];
      if (fType) {
        flower.classList.add('flower-' + fType);
      }

      var center = document.createElement('div');
      center.classList.add('moment-flower__center');
      flower.appendChild(center);

      // Add petals
      for (var p = 0; p < 6; p++) {
        var petal = document.createElement('div');
        petal.classList.add('moment-petal');
        petal.style.transform = 'rotate(' + (p * 60) + 'deg) translateY(-0.18rem)';
        flower.appendChild(petal);
      }

      tile.appendChild(flower);
    }

    grid.appendChild(tile);
  }
  card.appendChild(grid);

  // Bloom colors strip
  if (colors.length > 0) {
    var colorStrip = document.createElement('div');
    colorStrip.classList.add('moment-card__colors');
    colors.forEach(function (color) {
      var dot = document.createElement('div');
      dot.classList.add('moment-color-dot');
      dot.style.background = color;
      colorStrip.appendChild(dot);
    });
    card.appendChild(colorStrip);
  }

  // Stats row
  var statsRow = document.createElement('div');
  statsRow.classList.add('moment-card__stats');
  statsRow.innerHTML =
    '<div class="moment-stat">' +
      '<span class="moment-stat__emoji">🌸</span>' +
      '<span class="moment-stat__value">' + planted + '/' + totalTiles + '</span>' +
      '<span class="moment-stat__label">planted</span>' +
    '</div>' +
    '<div class="moment-stat">' +
      '<span class="moment-stat__emoji">' + getWeatherEmoji(weather) + '</span>' +
      '<span class="moment-stat__value">' + getWeatherLabel(weather) + '</span>' +
      '<span class="moment-stat__label">weather</span>' +
    '</div>' +
    '<div class="moment-stat">' +
      '<span class="moment-stat__emoji">' + getMoodEmoji(mood) + '</span>' +
      '<span class="moment-stat__value">' + mood + '</span>' +
      '<span class="moment-stat__label">mood</span>' +
    '</div>';
  card.appendChild(statsRow);

  // Poem
  var poemEl = document.createElement('p');
  poemEl.classList.add('moment-card__poem');
  poemEl.textContent = poem;
  card.appendChild(poemEl);

  return card;
}

// ── Open the moment modal ──
function openMomentModal() {
  if (momentCaptureCooldown) return;
  momentCaptureCooldown = true;

  // Create overlay
  var overlay = document.createElement('div');
  overlay.classList.add('gallery-modal');
  overlay.id = 'momentModal';

  var backdrop = document.createElement('div');
  backdrop.classList.add('gallery-modal__overlay');
  overlay.appendChild(backdrop);

  var content = document.createElement('div');
  content.classList.add('gallery-modal__content');
  content.style.maxWidth = '24rem';

  // Close button
  var closeBtn = document.createElement('button');
  closeBtn.classList.add('gallery-modal__close');
  closeBtn.setAttribute('aria-label', 'Close moment view');
  closeBtn.innerHTML = '×';
  content.appendChild(closeBtn);

  // Title
  var title = document.createElement('h2');
  title.classList.add('gallery-modal__title');
  title.textContent = 'a garden moment';
  content.appendChild(title);

  var subtitle = document.createElement('p');
  subtitle.classList.add('gallery-modal__subtitle');
  subtitle.textContent = 'your garden, captured in time';
  content.appendChild(subtitle);

  // Build and append the moment card
  var card = buildMomentCard();
  content.appendChild(card);

  // Close action
  function closeModal() {
    overlay.classList.remove('visible');
    setTimeout(function () {
      overlay.remove();
    }, 400);
    setTimeout(function () {
      momentCaptureCooldown = false;
    }, 1000);
  }

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  overlay.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Trigger animation
  void overlay.offsetWidth;
  overlay.classList.add('visible');

  // Focus the close button for accessibility
  closeBtn.focus();
}

// ── Reveal the moments button ──
function revealMoments() {
  if (momentsRevealed) return;
  momentsRevealed = true;

  createMomentsButton();
}

// ── Public: Initialize ──
export function initGardenMoments() {
  if (plantedCount.value > 0 || journalEntries.length > 0) {
    revealMoments();
  }
}

// ── Public: Called when garden state changes ──
export function notifyMomentsRevealed() {
  if (!momentsRevealed && (plantedCount.value > 0 || journalEntries.length > 0)) {
    revealMoments();
  }
}
