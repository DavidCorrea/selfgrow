import { dom, journalEntries, plantedCount, totalVolunteers, fertilizedTiles } from './state.js';
import { getCurrentSeasonName } from './theme.js';
import { getBloomingCount, getPlantedCount } from './visitors.js';

var statsRevealed = false;
var statsUpdateTimer = null;

var seasonConfig = {
  dawn: { label: 'dawn', emoji: '🌅', poem: 'the garden awakens with the sun' },
  day: { label: 'day', emoji: '☀️', poem: 'light bathes every leaf and petal' },
  dusk: { label: 'dusk', emoji: '🌇', poem: 'golden hour soothes the garden' },
  night: { label: 'night', emoji: '🌙', poem: 'the garden dreams under starlight' }
};

var moodStates = {
  thriving: {
    label: 'thriving',
    emoji: '🌿',
    poem: 'your garden pulses with vibrant life — every petal reaches for the light',
    moodClass: 'mood-thriving'
  },
  flourishing: {
    label: 'flourishing',
    emoji: '🌻',
    poem: 'a warm abundance fills your garden — the fruits of care made visible',
    moodClass: 'mood-flourishing'
  },
  growing: {
    label: 'growing',
    emoji: '🌱',
    poem: 'steady and sure, your garden grows — each day brings new possibility',
    moodClass: 'mood-growing'
  },
  resting: {
    label: 'resting',
    emoji: '🍂',
    poem: 'even gardens need stillness — rest is part of the cycle',
    moodClass: 'mood-resting'
  },
  dormant: {
    label: 'dormant',
    emoji: '💤',
    poem: 'the seeds of return are planted — your garden awaits your touch',
    moodClass: 'mood-dormant'
  }
};

function getFertilizedCount() {
  var count = 0;
  for (var key in fertilizedTiles) {
    if (fertilizedTiles[key]) count++;
  }
  return count;
}

function getTotalFlowersBloomed() {
  var total = 0;
  for (var i = 0; i < journalEntries.length; i++) {
    var entry = journalEntries[i];
    if (entry.type === 'plant') {
      total += 1;
    } else if (entry.type === 'cycle') {
      total += 1;
    } else if (entry.type === 'volunteer') {
      total += 1;
    }
  }
  if (total === 0) {
    var tiles = dom.tiles;
    if (tiles) {
      tiles.forEach(function (tile) {
        if (tile.classList.contains('planted')) {
          total += 1;
        }
      });
    }
  }
  return total;
}

function computeGardenMood() {
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

  var diffMs = now - lastTendedMs;
  var diffHours = diffMs / 3600000;

  if (planted === 0 && blooming === 0) {
    return moodStates.dormant;
  }
  if (blooming >= 3 && diffHours < 1) {
    return moodStates.thriving;
  }
  if (blooming >= 2 && diffHours < 3) {
    return moodStates.flourishing;
  }
  if (planted >= 1 && diffHours < 12) {
    return moodStates.growing;
  }
  if (planted >= 1 && diffHours < 48) {
    return moodStates.resting;
  }
  return moodStates.dormant;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'never';
  var diffMs = Date.now() - timestamp;
  var diffMins = Math.floor(diffMs / 60000);
  var diffHours = Math.floor(diffMs / 3600000);
  var diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + 'm ago';
  if (diffHours < 24) return diffHours + 'h ago';
  if (diffDays < 7) return diffDays + 'd ago';
  return 'a while ago';
}

function animateStatValue(el) {
  if (!el) return;
  el.classList.remove('updating');
  void el.offsetWidth;
  el.classList.add('updating');
  setTimeout(function () {
    el.classList.remove('updating');
  }, 400);
}

function revealStats() {
  if (statsRevealed) return;
  statsRevealed = true;
  var gardenStats = dom.gardenStats;
  if (gardenStats) {
    gardenStats.classList.add('visible');
    gardenStats.setAttribute('aria-hidden', 'false');
  }
}

function updateStats() {
  var gardenStats = dom.gardenStats;
  var statFlowersValue = dom.statFlowersValue;
  var statFlowersEmoji = dom.statFlowersEmoji;
  var statFlowersLabel = dom.statFlowersLabel;
  var statSeasonValue = dom.statSeasonValue;
  var statSeasonEmoji = dom.statSeasonEmoji;
  var statTendedValue = dom.statTendedValue;
  var statTendedEmoji = dom.statTendedEmoji;
  var statMoodValue = dom.statMoodValue;
  var statMoodEmoji = dom.statMoodEmoji;
  var statMoodCard = dom.statMoodCard;
  var statsPoem = dom.statsPoem;

  if (!statsRevealed) {
    if (journalEntries.length > 0 || plantedCount.value > 0) {
      revealStats();
    } else {
      return;
    }
  }

  var totalFlowers = getTotalFlowersBloomed();
  if (statFlowersValue) {
    var newText = '' + totalFlowers;
    if (statFlowersValue.textContent !== newText) {
      statFlowersValue.textContent = newText;
      animateStatValue(statFlowersValue);
    }
  }
  if (statFlowersLabel) {
    statFlowersLabel.textContent = totalFlowers === 1 ? 'flower bloomed' : 'flowers bloomed';
  }
  if (statFlowersEmoji) {
    statFlowersEmoji.textContent = totalFlowers === 1 ? '🌸' : '🌸';
  }

  var seasonName = getCurrentSeasonName();
  var season = seasonConfig[seasonName];
  if (statSeasonValue) {
    statSeasonValue.textContent = season.label;
  }
  if (statSeasonEmoji) {
    statSeasonEmoji.textContent = season.emoji;
  }

  var lastTimestamp = null;
  if (journalEntries.length > 0) {
    var latestEntry = journalEntries[journalEntries.length - 1];
    if (latestEntry.timestamp) {
      lastTimestamp = latestEntry.timestamp;
    }
  }
  if (statTendedValue) {
    statTendedValue.textContent = formatRelativeTime(lastTimestamp);
  }
  if (statTendedEmoji) {
    if (!lastTimestamp) {
      statTendedEmoji.textContent = '🌱';
    } else {
      var diffH = (Date.now() - lastTimestamp) / 3600000;
      if (diffH < 1) statTendedEmoji.textContent = '✨';
      else if (diffH < 12) statTendedEmoji.textContent = '🌱';
      else if (diffH < 48) statTendedEmoji.textContent = '🍂';
      else statTendedEmoji.textContent = '💤';
    }
  }

  var mood = computeGardenMood();
  if (statMoodValue) {
    statMoodValue.textContent = mood.label;
  }
  if (statMoodEmoji) {
    statMoodEmoji.textContent = mood.emoji;
  }
  if (statMoodCard) {
    statMoodCard.classList.remove(
      'mood-thriving', 'mood-flourishing', 'mood-growing', 'mood-resting', 'mood-dormant'
    );
    statMoodCard.classList.add(mood.moodClass);
  }

  if (statsPoem) {
    var poemText = mood.poem;
    if (plantedCount.value === 0 && journalEntries.length === 0) {
      poemText = 'plant a seed to begin your garden\'s story';
    }
    var volunteers = totalVolunteers.value;
    if (volunteers > 0 && plantedCount.value > 0) {
      poemText += ' · ' + volunteers + ' volunteer' + (volunteers !== 1 ? 's' : '') + ' sprouted';
    }
    if (statsPoem.textContent !== poemText) {
      statsPoem.textContent = poemText;
      statsPoem.classList.remove('visible');
      void statsPoem.offsetWidth;
      statsPoem.classList.add('visible');
    }
  }
}

function scheduleStatsUpdate() {
  if (statsUpdateTimer) clearInterval(statsUpdateTimer);
  statsUpdateTimer = setInterval(function () {
    if (statsRevealed) {
      updateStats();
    }
  }, 30000);
}

// Called by other modules to notify stats of changes
export function notifyStatsChange() {
  setTimeout(function () { updateStats(); }, 100);
}

function updateVolunteerStat() {
  var volunteers = totalVolunteers.value;
  var statCard = document.getElementById('statVolunteersCard');
  if (!statCard && volunteers > 0) {
    var statsGrid = document.querySelector('.stats-grid');
    if (!statsGrid) return;
    var statEl = document.createElement('div');
    statEl.classList.add('stat-card', 'stat-card--volunteers');
    statEl.id = 'statVolunteersCard';
    statEl.innerHTML =
      '<span class="stat-emoji">🌿</span>' +
      '<span class="stat-value" id="statVolunteersValue">' + volunteers + '</span>' +
      '<span class="stat-label" id="statVolunteersLabel">' + (volunteers === 1 ? 'volunteer sprouted' : 'volunteers sprouted') + '</span>';
    statsGrid.appendChild(statEl);
    statEl.style.opacity = '0';
    statEl.style.transform = 'translateY(0.5rem)';
    requestAnimationFrame(function () {
      statEl.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      statEl.style.opacity = '1';
      statEl.style.transform = 'translateY(0)';
    });
  } else if (statCard && volunteers > 0) {
    var valEl = document.getElementById('statVolunteersValue');
    var lblEl = document.getElementById('statVolunteersLabel');
    if (valEl) valEl.textContent = '' + volunteers;
    if (lblEl) lblEl.textContent = volunteers === 1 ? 'volunteer sprouted' : 'volunteers sprouted';
  }
}

export function initStats() {
  scheduleStatsUpdate();

  var lastStatsTheme = getCurrentSeasonName();
  setInterval(function () {
    var currentTheme = getCurrentSeasonName();
    if (currentTheme !== lastStatsTheme) {
      lastStatsTheme = currentTheme;
      updateStats();
    }
  }, 60000);

  setInterval(function () {
    updateVolunteerStat();
  }, 15000);

  setInterval(function () {
    updateFertilizedStat();
  }, 15000);
}

function updateFertilizedStat() {
  var count = getFertilizedCount();
  var statCard = document.getElementById('statFertilizedCard');
  if (!statCard && count > 0) {
    var statsGrid = document.querySelector('.stats-grid');
    if (!statsGrid) return;
    var statEl = document.createElement('div');
    statEl.classList.add('stat-card', 'stat-card--fertilized');
    statEl.id = 'statFertilizedCard';
    statEl.innerHTML =
      '<span class="stat-emoji">🌾</span>' +
      '<span class="stat-value" id="statFertilizedValue">' + count + '</span>' +
      '<span class="stat-label" id="statFertilizedLabel">' + (count === 1 ? 'tile fertilized' : 'tiles fertilized') + '</span>';
    statsGrid.appendChild(statEl);
    statEl.style.opacity = '0';
    statEl.style.transform = 'translateY(0.5rem)';
    requestAnimationFrame(function () {
      statEl.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      statEl.style.opacity = '1';
      statEl.style.transform = 'translateY(0)';
    });
  } else if (statCard && count > 0) {
    var valEl = document.getElementById('statFertilizedValue');
    var lblEl = document.getElementById('statFertilizedLabel');
    if (valEl) valEl.textContent = '' + count;
    if (lblEl) lblEl.textContent = count === 1 ? 'tile fertilized' : 'tiles fertilized';
  }
}
