// Visit tracking utilities for weekly ritual

const VISIT_LOG_KEY = 'selfgrow_visit_log';
const RITUAL_SHOWN_PREFIX = 'selfgrow_weekly_ritual_shown_';

function loadVisitLog() {
  try {
    const raw = localStorage.getItem(VISIT_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveVisitLog(log) {
  try {
    localStorage.setItem(VISIT_LOG_KEY, JSON.stringify(log));
  } catch (e) {
    // ignore storage errors
  }
}

export function recordVisit() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const log = loadVisitLog();
  // Avoid duplicate entry for same day
  const hasToday = log.some(ts => new Date(ts).toISOString().slice(0, 10) === today);
  if (!hasToday) {
    log.push(now.getTime());
    saveVisitLog(log);
  }
}

function getWeekKey(date) {
  // ISO week number
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
  return `${year}-W${week}`;
}

export function getVisitsThisWeek() {
  const now = new Date();
  const currentWeekKey = getWeekKey(now);
  const log = loadVisitLog();
  return log.filter(ts => getWeekKey(new Date(ts)) === currentWeekKey);
}

export function hasWeeklyRitualShown() {
  const now = new Date();
  const weekKey = getWeekKey(now);
  return localStorage.getItem(RITUAL_SHOWN_PREFIX + weekKey) === 'true';
}

export function setWeeklyRitualShown() {
  const now = new Date();
  const weekKey = getWeekKey(now);
  localStorage.setItem(RITUAL_SHOWN_PREFIX + weekKey, 'true');
}
