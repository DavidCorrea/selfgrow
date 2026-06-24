// ── Seasonal Time-of-Day Theme ──
import { visibleSetInterval } from './visibility-manager.js';

function applyTimeTheme() {
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

  document.body.classList.remove('theme-dawn', 'theme-day', 'theme-dusk', 'theme-night', 'dusk-to-night');
  document.body.classList.add('theme-' + theme);
  if (theme === 'dusk' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Trigger dusk to night transition over 5 minutes
    document.body.classList.add('dusk-to-night');
  }
}

export function getCurrentTheme() {
  if (document.body.classList.contains('theme-dawn')) return 'dawn';
  if (document.body.classList.contains('theme-day')) return 'day';
  if (document.body.classList.contains('theme-dusk')) return 'dusk';
  return 'night';
}

// Returns the time-of-day name (dawn/day/dusk/night)
// Kept for backward compatibility with stats.js which uses it for mood/poem display
export function getCurrentSeasonName() {
  var hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

// Returns the calendar-based garden season (spring/summer/autumn/winter)
export function getCurrentCalendarSeason() {
  var month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

export function isNightTheme() {
  return document.body.classList.contains('theme-night');
}

export function initTheme() {
  applyTimeTheme();
  visibleSetInterval(applyTimeTheme, 60000);
}
