// ── Seasonal Time-of-Day Theme ──

export function applyTimeTheme() {
  var hour = new Date().getHours();
  var theme;

  if (hour >= 5 && hour < 8) {
    theme = 'dawn';
  } else if (hour >= 8 && hour < 17) {
    theme = 'day';
  } else if (hour >= 17 && hour < 20) {
    theme = 'dusk';
  } else {
    theme = 'night';
  }

  document.body.classList.remove('theme-dawn', 'theme-day', 'theme-dusk', 'theme-night');
  document.body.classList.add('theme-' + theme);
}

export function getCurrentTheme() {
  if (document.body.classList.contains('theme-dawn')) return 'dawn';
  if (document.body.classList.contains('theme-day')) return 'day';
  if (document.body.classList.contains('theme-dusk')) return 'dusk';
  return 'night';
}

export function getCurrentSeasonName() {
  var hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

export function isNightTheme() {
  return document.body.classList.contains('theme-night');
}

export function initTheme() {
  applyTimeTheme();
  setInterval(applyTimeTheme, 60000);
}
