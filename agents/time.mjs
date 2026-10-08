// Calendar arithmetic shared by every role that reports on "this week".
//
// Dates here are UTC calendar days (YYYY-MM-DD), and they compare as strings
// against GitHub's ISO timestamps: "2026-10-01T09:00:00Z" >= "2026-10-01".

const DAY_MS = 86_400_000;

/** The UTC calendar day `days` days before `now`. */
export function daysAgo(days, now = Date.now()) {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

/** The issues closed within the last `days` days. One without a close date never is. */
export function closedWithin(issues, days, now = Date.now()) {
  const since = daysAgo(days, now);
  return issues.filter((issue) => (issue.closedAt || "") >= since);
}
