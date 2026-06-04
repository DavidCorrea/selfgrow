import { currentWeather, getRandomWeatherMessage } from './state.js';
import { addWeatherEntry as addWeatherJournalEntry } from './journal.js';
import { notifyStatsChange } from './stats.js';

// ── Weather System ──
// Four weather states: sunny, rainy, cloudy, snowy
// Auto-cycles every 2-3 minutes with smooth transitions
// Pure CSS animations, no external dependencies
// Now connected to garden growth mechanics:
//   - rainy: auto-waters all planted tiles, growth speed boost
//   - sunny: gentle growth acceleration
//   - snowy: extends cycle durations by 40% (dormant feel)
//   - cloudy: neutral, no modifier

var weatherStates = ['sunny', 'rainy', 'cloudy', 'snowy'];
var currentWeatherIndex = 0;
var weatherTimer = null;
var isWeatherActive = true;
var weatherChangeCallbacks = [];

// Weather icon mapping
var weatherIcons = {
  sunny: '☀️',
  rainy: '🌧️',
  cloudy: '☁️',
  snowy: '❄️'
};

// Weather label mapping
var weatherLabels = {
  sunny: 'sunny',
  rainy: 'rainy',
  cloudy: 'cloudy',
  snowy: 'snowy'
};

// ── Weather Modifiers (used internally and via getWeatherModifier) ──
var weatherModifiers = {
  sunny: {
    label: 'sunny',
    growthMultiplier: 0.85,  // 15% faster
    autoWater: false,
    description: 'sunlight accelerates growth'
  },
  rainy: {
    label: 'rainy',
    growthMultiplier: 0.6,   // 40% faster
    autoWater: true,
    description: 'rain auto-waters all tiles'
  },
  cloudy: {
    label: 'cloudy',
    growthMultiplier: 1.0,   // neutral
    autoWater: false,
    description: 'cloudy skies, neutral growth'
  },
  snowy: {
    label: 'snowy',
    growthMultiplier: 1.4,   // 40% slower
    autoWater: false,
    description: 'snow slows the cycles'
  }
};

export function getCurrentWeather() {
  return currentWeather.value;
}

export function getWeatherModifier() {
  return weatherModifiers[currentWeather.value] || weatherModifiers.sunny;
}

export function onWeatherChange(callback) {
  if (typeof callback === 'function') {
    weatherChangeCallbacks.push(callback);
  }
}

function notifyWeatherCallbacks(oldWeather, newWeather) {
  weatherChangeCallbacks.forEach(function (cb) {
    try {
      cb(newWeather, oldWeather);
    } catch (e) {
      // silently ignore callback errors
    }
  });
}

// Create the weather overlay DOM elements
function createWeatherOverlay() {
  // Check if already created
  if (document.getElementById('weatherOverlay')) return;

  var overlay = document.createElement('div');
  overlay.id = 'weatherOverlay';
  overlay.classList.add('weather-overlay');
  overlay.setAttribute('aria-hidden', 'true');

  // Sunny layer: light rays
  var sunnyLayer = document.createElement('div');
  sunnyLayer.classList.add('weather-layer', 'weather-sunny');
  sunnyLayer.id = 'weatherSunny';
  for (var i = 0; i < 5; i++) {
    var ray = document.createElement('div');
    ray.classList.add('sun-ray');
    ray.style.setProperty('--ray-angle', (i * 72) + 'deg');
    ray.style.setProperty('--ray-delay', (i * 0.4) + 's');
    sunnyLayer.appendChild(ray);
  }
  overlay.appendChild(sunnyLayer);

  // Rain layer: droplets
  var rainLayer = document.createElement('div');
  rainLayer.classList.add('weather-layer', 'weather-rain');
  rainLayer.id = 'weatherRain';
  for (var r = 0; r < 60; r++) {
    var drop = document.createElement('div');
    drop.classList.add('rain-drop');
    drop.style.left = Math.random() * 100 + '%';
    drop.style.setProperty('--drop-delay', (Math.random() * 2) + 's');
    drop.style.setProperty('--drop-duration', (0.6 + Math.random() * 0.4) + 's');
    drop.style.setProperty('--drop-opacity', (0.2 + Math.random() * 0.3));
    rainLayer.appendChild(drop);
  }
  overlay.appendChild(rainLayer);

  // Cloudy layer: mist / fog
  var cloudyLayer = document.createElement('div');
  cloudyLayer.classList.add('weather-layer', 'weather-cloudy');
  cloudyLayer.id = 'weatherCloudy';
  for (var c = 0; c < 4; c++) {
    var cloud = document.createElement('div');
    cloud.classList.add('cloud');
    cloud.style.setProperty('--cloud-y', (15 + c * 20) + '%');
    cloud.style.setProperty('--cloud-delay', (c * 1.5) + 's');
    cloud.style.setProperty('--cloud-duration', (8 + c * 2) + 's');
    cloud.style.setProperty('--cloud-opacity', (0.15 + c * 0.05));
    cloudyLayer.appendChild(cloud);
  }
  // Mist layers
  for (var m = 0; m < 3; m++) {
    var mist = document.createElement('div');
    mist.classList.add('mist-layer');
    mist.style.setProperty('--mist-y', (30 + m * 25) + '%');
    mist.style.setProperty('--mist-delay', (m * 2) + 's');
    mist.style.setProperty('--mist-duration', (6 + m * 1.5) + 's');
    mist.style.setProperty('--mist-opacity', (0.08 + m * 0.04));
    cloudyLayer.appendChild(mist);
  }
  overlay.appendChild(cloudyLayer);

  // Snow layer: flakes
  var snowLayer = document.createElement('div');
  snowLayer.classList.add('weather-layer', 'weather-snow');
  snowLayer.id = 'weatherSnow';
  for (var s = 0; s < 50; s++) {
    var flake = document.createElement('div');
    flake.classList.add('snow-flake');
    flake.style.left = Math.random() * 100 + '%';
    flake.style.setProperty('--flake-delay', (Math.random() * 5) + 's');
    flake.style.setProperty('--flake-duration', (4 + Math.random() * 4) + 's');
    flake.style.setProperty('--flake-drift', (-20 + Math.random() * 40) + 'px');
    flake.style.setProperty('--flake-size', (0.3 + Math.random() * 0.4) + 'rem');
    flake.style.setProperty('--flake-opacity', (0.5 + Math.random() * 0.5));
    snowLayer.appendChild(flake);
  }
  overlay.appendChild(snowLayer);

  // Insert as first child of body so it's behind everything
  document.body.insertBefore(overlay, document.body.firstChild);

  // Create weather icon indicator
  var iconEl = document.createElement('div');
  iconEl.id = 'weatherIcon';
  iconEl.classList.add('weather-icon');
  iconEl.setAttribute('aria-label', 'Weather: sunny');
  iconEl.setAttribute('title', 'Current weather');
  iconEl.textContent = weatherIcons.sunny;
  document.body.appendChild(iconEl);

  // Create weather label
  var labelEl = document.createElement('div');
  labelEl.id = 'weatherLabel';
  labelEl.classList.add('weather-label');
  labelEl.textContent = weatherLabels.sunny;
  document.body.appendChild(labelEl);

  // Make icon and label visible after a short delay for fade-in
  setTimeout(function () {
    iconEl.classList.add('visible');
    labelEl.classList.add('visible');
  }, 2500);
}

// Transition to a specific weather state
function setWeatherState(state) {
  var overlay = document.getElementById('weatherOverlay');
  if (!overlay) return;

  var oldWeather = currentWeather.value;

  // Remove all weather state classes
  weatherStates.forEach(function (s) {
    overlay.classList.remove('weather-active-' + s);
  });

  // Add the new state class
  overlay.classList.add('weather-active-' + state);

  // Update icon
  var iconEl = document.getElementById('weatherIcon');
  if (iconEl) {
    iconEl.textContent = weatherIcons[state];
    iconEl.setAttribute('aria-label', 'Weather: ' + state);
    iconEl.classList.add('visible');
    // Trigger change animation
    iconEl.classList.remove('changing');
    void iconEl.offsetWidth;
    iconEl.classList.add('changing');
  }

  // Update label
  var labelEl = document.getElementById('weatherLabel');
  if (labelEl) {
    labelEl.textContent = weatherLabels[state];
    labelEl.classList.add('visible');
  }

  // Update shared state
  currentWeather.value = state;

  // Add journal entry for weather transition
  var weatherMsg = getRandomWeatherMessage(state);
  addWeatherJournalEntry(state, weatherMsg);

  // Notify stats
  notifyStatsChange();

  // Notify registered callbacks (tiles.js, etc.)
  notifyWeatherCallbacks(oldWeather, state);
}

// Advance to next weather state
function advanceWeather() {
  if (!isWeatherActive) return;

  currentWeatherIndex = (currentWeatherIndex + 1) % weatherStates.length;
  setWeatherState(weatherStates[currentWeatherIndex]);

  // Schedule next transition: 2-3 minutes (120-180s)
  var nextInterval = (120000 + Math.random() * 60000);
  weatherTimer = setTimeout(advanceWeather, nextInterval);
}

// Start the weather cycle
function startWeather() {
  if (!isWeatherActive) return;

  createWeatherOverlay();
  setWeatherState(weatherStates[currentWeatherIndex]);

  // Schedule first transition
  var nextInterval = (120000 + Math.random() * 60000);
  weatherTimer = setTimeout(advanceWeather, nextInterval);
}

// Stop the weather cycle
function stopWeather() {
  isWeatherActive = false;
  if (weatherTimer) {
    clearTimeout(weatherTimer);
    weatherTimer = null;
  }
  var overlay = document.getElementById('weatherOverlay');
  if (overlay) {
    overlay.remove();
  }
  var iconEl = document.getElementById('weatherIcon');
  if (iconEl) {
    iconEl.remove();
  }
  var labelEl = document.getElementById('weatherLabel');
  if (labelEl) {
    labelEl.remove();
  }
}

// Initialize weather after a short delay (let the garden load first)
setTimeout(function () {
  startWeather();
}, 2000);
